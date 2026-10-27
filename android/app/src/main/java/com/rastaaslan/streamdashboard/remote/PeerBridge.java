package com.rastaaslan.streamdashboard.remote;

import android.content.Context;
import android.util.Base64;
import java.io.*;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.cert.X509Certificate;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.BiConsumer;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONObject;

/** Called only by a main-frame, app-origin WebMessageListener. */
final class PeerBridge implements AutoCloseable {
  private static final long MAX_UPLOAD=100L*1024*1024;
  private final SecureCredentialStore secrets;
  private final File cache;
  private final BiConsumer<String,String> reply;
  private final ThreadPoolExecutor workers=new ThreadPoolExecutor(4,4,0,TimeUnit.SECONDS,new ArrayBlockingQueue<>(32));
  private final ScheduledExecutorService deadlines=Executors.newSingleThreadScheduledExecutor();
  private final ConcurrentHashMap<String,Flight> flights=new ConcurrentHashMap<>();
  private final Map<String,Upload> uploads=new HashMap<>();
  private volatile boolean closed;
  private static final class Flight {
    volatile HttpsURLConnection connection;volatile boolean cancelled;String origin;ScheduledFuture<?> deadline;
    void cancel(){cancelled=true;HttpsURLConnection active=connection;if(active!=null)active.disconnect();}
  }
  private static final class Upload {final File file;final long expected;long length,changed=System.currentTimeMillis();Upload(File f,long size){file=f;expected=size;}}
  PeerBridge(Context context,BiConsumer<String,String> result) {
    secrets=new SecureCredentialStore(context);reply=result;cache=new File(context.getCacheDir(),"peer-uploads");
    if(!cache.isDirectory()&&!cache.mkdirs())throw new IllegalStateException("Cache audio indisponible");
    File[] old=cache.listFiles();if(old!=null)for(File file:old)if(file.getName().matches("upload-[a-f0-9-]+\\.bin"))file.delete();
    deadlines.scheduleWithFixedDelay(this::expireUploads,60,60,TimeUnit.SECONDS);
  }
  private static JSONObject failure(){try{return new JSONObject().put("ok",false).put("error",new JSONObject().put("code","PEER_TRANSPORT_FAILED").put("message","Connexion sécurisée non confirmée. Vérifiez l’empreinte de l’agent et son réseau ; aucune commande ne sera répétée."));}catch(Exception impossible){throw new IllegalStateException(impossible);}}
  private String key(String origin)throws Exception {
    PeerTlsPolicy.origin(origin);byte[] bytes=java.security.MessageDigest.getInstance("SHA-256").digest(origin.getBytes(StandardCharsets.UTF_8));return "peer."+Base64.encodeToString(bytes,Base64.NO_WRAP|Base64.URL_SAFE);
  }
  private synchronized String pin(String origin)throws Exception{return secrets.get(key(origin));}
  private synchronized void trust(String origin,String fingerprint,String expected)throws Exception {
    String next=fingerprint.isEmpty()?"":PeerTlsPolicy.fingerprint(fingerprint),previous=expected.isEmpty()?"":PeerTlsPolicy.fingerprint(expected);
    if(!pin(origin).equals(previous))throw new IOException("Identité modifiée ailleurs");
    secrets.put(key(origin),next);
    for(Flight flight:flights.values())if(origin.equals(flight.origin))flight.cancel();
  }
  void receive(String raw) {
    String id="";
    try {
      if(closed||raw==null||raw.length()>16*1024*1024)throw new IOException();
      JSONObject value=new JSONObject(raw);id=value.getString("id");if(!id.matches("[-A-Za-z0-9_]{8,100}"))throw new IOException();
      String operation=value.getString("operation"),requestId=id;
      if(operation.equals("cancel")){Flight flight=flights.get(value.getString("requestId"));if(flight!=null)flight.cancel();return;}
      if(operation.equals("request")){
        int timeout=value.getInt("timeoutMs");if(timeout<1000||timeout>120000||flights.size()>=32)throw new IOException();
        Flight flight=new Flight();flight.origin=PeerTlsPolicy.requestOrigin(value.getString("url"));
        if(flights.putIfAbsent(id,flight)!=null)throw new IOException();
        flight.deadline=deadlines.schedule(flight::cancel,timeout,TimeUnit.MILLISECONDS);
      }
      try{workers.execute(()->{
        JSONObject result;
        try{result=execute(requestId,operation,value);}catch(Exception error){result=failure();}
        finally{if(operation.equals("request")){Flight flight=flights.remove(requestId);if(flight!=null){flight.cancel();flight.deadline.cancel(false);}}}
        if(!closed)reply.accept(requestId,result.toString());
      });}catch(RejectedExecutionException error){Flight flight=flights.remove(id);if(flight!=null){flight.cancel();flight.deadline.cancel(false);}throw error;}
    }catch(Exception error){if(!id.isEmpty()&&!closed)reply.accept(id,failure().toString());}
  }
  private JSONObject execute(String id,String operation,JSONObject value)throws Exception {
    if(closed)throw new IOException();
    Object result;
    switch(operation){
      case "fingerprint":result=pin(value.getString("origin"));break;
      case "trust":trust(value.getString("origin"),value.getString("fingerprint"),value.getString("expected"));result=true;break;
      case "uploadBegin":result=begin(value.getLong("size"));break;
      case "uploadAppend":append(value.getString("uploadId"),value.getLong("offset"),value.getString("chunk"));result=true;break;
      case "uploadDiscard":discard(value.getString("uploadId"));result=true;break;
      case "request":return request(id,value);
      default:throw new IOException();
    }
    return new JSONObject().put("ok",true).put("value",result);
  }
  private synchronized String begin(long size)throws Exception {
    expireUploads();if(size<0||size>MAX_UPLOAD||uploads.size()>=4)throw new IOException();
    String id=UUID.randomUUID().toString();File file=new File(cache,"upload-"+id+".bin");if(!file.createNewFile())throw new IOException();uploads.put(id,new Upload(file,size));return id;
  }
  private synchronized void append(String id,long offset,String chunk)throws Exception {
    Upload upload=uploads.get(id);if(upload==null||offset!=upload.length||chunk.length()>90000)throw new IOException();
    byte[] data=Base64.decode(chunk,Base64.NO_WRAP);if(data.length>65536||upload.length+data.length>upload.expected)throw new IOException();
    try(FileOutputStream out=new FileOutputStream(upload.file,true)){out.write(data);}upload.length+=data.length;upload.changed=System.currentTimeMillis();
  }
  private synchronized Upload take(String id)throws Exception {Upload upload=uploads.get(id);if(upload==null||upload.length!=upload.expected)throw new IOException();uploads.remove(id);return upload;}
  private synchronized void discard(String id){Upload upload=uploads.remove(id);if(upload!=null)upload.file.delete();}
  private synchronized void expireUploads(){long now=System.currentTimeMillis();for(String id:new ArrayList<>(uploads.keySet()))if(now-uploads.get(id).changed>120000)discard(id);}
  private JSONObject request(String id,JSONObject value)throws Exception {
    String url=value.getString("url"),origin=PeerTlsPolicy.requestOrigin(url),method=value.getString("method"),credential=value.optString("credential","");
    int timeout=value.getInt("timeoutMs");
    if(url.length()>4096||!Arrays.asList("GET","POST","PUT","DELETE").contains(method)||credential.length()>256||timeout<1000||timeout>120000)throw new IOException();
    Flight flight=flights.get(id);if(flight==null||flight.cancelled)throw new IOException();
    String fingerprint=pin(origin);PeerTlsPolicy.fingerprint(fingerprint);
    Upload upload=null;
    try {
      if(value.has("uploadId")){if(!"POST".equals(method)||!URI.create(url).getPath().equals("/api/v2/sounds/upload"))throw new IOException();upload=take(value.getString("uploadId"));}
      byte[] body=value.has("body")?value.getString("body").getBytes(StandardCharsets.UTF_8):null;
      if(body!=null&&body.length>16*1024*1024)throw new IOException();
      HttpsURLConnection connection=(HttpsURLConnection)URI.create(url).toURL().openConnection();flight.connection=connection;
      connection.setSSLSocketFactory(PeerTlsPolicy.context(fingerprint).getSocketFactory());
      connection.setHostnameVerifier((host,session)->{try{return host.equals(URI.create(origin).getHost())&&PeerTlsPolicy.matches((X509Certificate)session.getPeerCertificates()[0],fingerprint);}catch(Exception error){return false;}});
      connection.setInstanceFollowRedirects(false);connection.setUseCaches(false);connection.setConnectTimeout(Math.min(timeout,15000));connection.setReadTimeout(timeout);connection.setRequestMethod(method);
      // One connection per request prevents cached TLS decisions from surviving a pin change.
      connection.setRequestProperty("Connection","close");
      if(!credential.isEmpty())connection.setRequestProperty("Authorization","Device "+credential);
      if(body!=null||upload!=null){connection.setDoOutput(true);connection.setRequestProperty("Content-Type",upload!=null?"application/octet-stream":"application/json");connection.setFixedLengthStreamingMode(upload!=null?upload.length:body.length);}
      if(flight.cancelled||!pin(origin).equals(fingerprint))throw new IOException();
      if(body!=null||upload!=null)try(OutputStream output=connection.getOutputStream()){
        if(upload!=null)try(InputStream input=new FileInputStream(upload.file)){byte[] buffer=new byte[65536];int count;while((count=input.read(buffer))!=-1){if(flight.cancelled)throw new IOException();output.write(buffer,0,count);}}
        else output.write(body);
      }
      int status=connection.getResponseCode();
      if(status>=300&&status<400)throw new IOException("Redirection refusée");
      InputStream stream=status>=400?connection.getErrorStream():connection.getInputStream();
      ByteArrayOutputStream bytes=new ByteArrayOutputStream();
      if(stream!=null)try(InputStream input=stream){byte[] buffer=new byte[16384];int count;while((count=input.read(buffer))!=-1){if(flight.cancelled||bytes.size()+count>32*1024*1024)throw new IOException();bytes.write(buffer,0,count);}}
      if(flight.cancelled)throw new IOException();
      return new JSONObject().put("ok",true).put("status",status).put("body",bytes.toString("UTF-8"));
    }finally{flight.cancel();if(upload!=null)upload.file.delete();}
  }
  public void close(){closed=true;for(Flight flight:flights.values())flight.cancel();workers.shutdownNow();deadlines.shutdownNow();synchronized(this){for(String id:new ArrayList<>(uploads.keySet()))discard(id);}}
}
