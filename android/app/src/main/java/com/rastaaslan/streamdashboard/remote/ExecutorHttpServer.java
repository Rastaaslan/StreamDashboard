package com.rastaaslan.streamdashboard.remote;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import javax.net.ssl.*;

/** Small, bounded JSON-only HTTPS endpoint. No files, cookies, redirects or UI. */
final class ExecutorHttpServer implements AutoCloseable {
  interface Handler { Reply handle(Request request) throws Exception; }
  static final class Request {
    final String method,path,authorization,body,remote;
    Request(String m,String p,String a,String b,String r){method=m;path=p;authorization=a;body=b;remote=r;}
  }
  static final class Reply {
    final int status;final String body;
    Reply(int code,String value){status=code;body=value;}
  }
  private final SSLServerSocket listener;
  private final Handler handler;
  private final Set<Socket> sockets=ConcurrentHashMap.newKeySet();
  private final ThreadPoolExecutor workers=new ThreadPoolExecutor(4,4,0,TimeUnit.SECONDS,new ArrayBlockingQueue<>(12));
  private final Thread acceptor;
  private volatile boolean closed;
  ExecutorHttpServer(SSLContext context,int port,Handler handle)throws IOException {
    handler=handle;listener=(SSLServerSocket)context.getServerSocketFactory().createServerSocket();
    listener.setReuseAddress(false);listener.bind(new InetSocketAddress(port),16);
    List<String> enabled=new ArrayList<>();for(String protocol:listener.getSupportedProtocols())if(protocol.equals("TLSv1.2")||protocol.equals("TLSv1.3"))enabled.add(protocol);
    listener.setEnabledProtocols(enabled.toArray(new String[0]));
    acceptor=new Thread(this::accept,"sd-device-listener");acceptor.setDaemon(true);acceptor.start();
  }
  int port(){return listener.getLocalPort();}
  private void accept(){
    while(!closed)try{
      Socket socket=listener.accept();socket.setSoTimeout(10000);sockets.add(socket);
      try{workers.execute(()->serve(socket));}catch(RejectedExecutionException error){sockets.remove(socket);socket.close();}
    }catch(IOException error){if(!closed)close();}
  }
  private void serve(Socket socket){
    try(Socket connection=socket){
      Reply response;
      try{Request request=read(connection.getInputStream(),connection.getInetAddress().getHostAddress());response=handler.handle(request);}
      catch(Exception error){response=new Reply(400,"{\"error\":{\"code\":\"INVALID_REQUEST\",\"message\":\"Requête refusée.\"}}");}
      byte[] body=response.body.getBytes(StandardCharsets.UTF_8);if(body.length>8*1024*1024)throw new IOException("Response limit");
      String headers="HTTP/1.1 "+response.status+" Result\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: "+body.length+"\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n";
      OutputStream out=connection.getOutputStream();out.write(headers.getBytes(StandardCharsets.US_ASCII));out.write(body);out.flush();
    }catch(Exception ignored){/* A disconnect never repeats a command. */}finally{sockets.remove(socket);}
  }
  static Request read(InputStream input,String remote)throws IOException {
    String[] first=line(input,4096).split(" ",-1);
    if(first.length!=3||!Arrays.asList("GET","POST","PUT","DELETE").contains(first[0])||!first[2].equals("HTTP/1.1"))throw new IOException("Method or version");
    String path=first[1];
    if(!path.startsWith("/api/")||path.contains("#")||path.contains("\\")||path.contains("..")||path.indexOf('%')>=0)throw new IOException("Path");
    Map<String,String> headers=new HashMap<>();int total=0;
    for(int n=0;;n++){
      String value=line(input,4096);total+=value.length();if(value.isEmpty())break;
      int colon=value.indexOf(':');if(n>=48||total>16384||colon<1||!value.substring(0,colon).matches("[A-Za-z0-9-]+"))throw new IOException("Headers");
      String key=value.substring(0,colon).toLowerCase(Locale.ROOT);if(headers.put(key,value.substring(colon+1).trim())!=null)throw new IOException("Duplicate header");
    }
    if(!headers.containsKey("host")||headers.containsKey("transfer-encoding")||headers.containsKey("origin")||headers.containsKey("cookie"))throw new IOException("Unsupported origin or framing");
    String length=headers.getOrDefault("content-length","0");if(!length.matches("[0-9]{1,7}"))throw new IOException("Length");
    int size=Integer.parseInt(length);if(size>(path.equals("/api/v2/planning/handoff")?524288:262144)||(first[0].equals("GET")&&size!=0))throw new IOException("Body limit");
    if(size>0&&!headers.getOrDefault("content-type","").split(";",2)[0].trim().equals("application/json"))throw new IOException("JSON required");
    byte[] bytes=new byte[size];int at=0;while(at<size){int count=input.read(bytes,at,size-at);if(count<0)throw new EOFException();at+=count;}
    return new Request(first[0],path,headers.getOrDefault("authorization",""),new String(bytes,StandardCharsets.UTF_8),remote);
  }
  private static String line(InputStream input,int limit)throws IOException {
    ByteArrayOutputStream value=new ByteArrayOutputStream();
    while(value.size()<=limit){int next=input.read();if(next<0)throw new EOFException();if(next=='\r'){if(input.read()!='\n')throw new IOException("CRLF required");return value.toString("US-ASCII");}if(next<32||next>126)throw new IOException("Invalid header byte");value.write(next);}
    throw new IOException("Line limit");
  }
  public void close(){closed=true;try{listener.close();}catch(IOException ignored){}for(Socket socket:sockets)try{socket.close();}catch(IOException ignored){}workers.shutdownNow();
    // close() wakes accept(), but its native listening descriptor can remain
    // alive until the acceptor returns. Do not report shutdown before that exit.
    if(Thread.currentThread()!=acceptor)try{acceptor.join(1000);}catch(InterruptedException error){Thread.currentThread().interrupt();}
  }
}
