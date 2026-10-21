package com.rastaaslan.streamdashboard.remote;

import android.content.Context;
import java.net.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.BiConsumer;
import org.json.*;

/** Local main-frame bridge. HTTP commands cannot invoke these administrative operations. */
final class ExecutorBridge implements AutoCloseable {
  private final SecureCredentialStore secrets;
  private final BiConsumer<String,String> dispatch;
  private final ThreadPoolExecutor worker=new ThreadPoolExecutor(1,1,0,TimeUnit.SECONDS,new ArrayBlockingQueue<>(32));
  private final ConcurrentHashMap<String,CompletableFuture<ExecutorHttpServer.Reply>> replies=new ConcurrentHashMap<>();
  private ExecutorIdentity identity;
  private ExecutorHttpServer server;
  private volatile boolean closed;
  ExecutorBridge(Context context,BiConsumer<String,String> callback){secrets=new SecureCredentialStore(context);dispatch=callback;}
  void receive(String raw){
    String id="";
    try{
      if(closed||raw==null||raw.length()>8*1024*1024)throw new IllegalArgumentException();
      JSONObject value=new JSONObject(raw);id=value.getString("id");if(!id.matches("[-A-Za-z0-9_]{8,100}"))throw new IllegalArgumentException();
      String operation=value.getString("operation");
      if(operation.equals("reply")){
        CompletableFuture<ExecutorHttpServer.Reply> future=replies.remove(id);
        if(future!=null){int status=value.getInt("status");if(status<200||status>599)status=500;future.complete(new ExecutorHttpServer.Reply(status,value.getJSONObject("body").toString()));}return;
      }
      final String requestId=id;
      worker.execute(()->{
        JSONObject result=new JSONObject();
        try{
          Object answer;
          switch(operation){
            case "load":String stored=secrets.get("executor.settings.v1");answer=stored.isEmpty()?JSONObject.NULL:new JSONObject(stored);break;
            case "save":String data=value.getJSONObject("value").toString();if(data.length()>65536)throw new IllegalArgumentException();secrets.put("executor.settings.v1",data);answer=true;break;
            case "start":if(server==null){if(identity==null)identity=new ExecutorIdentity();server=new ExecutorHttpServer(identity.context,48136,this::request);}answer=info();break;
            case "stop":if(server!=null){server.close();server=null;}answer=info();break;
            case "info":answer=info();break;
            default:throw new IllegalArgumentException();
          }
          result.put("ok",true).put("value",answer);
        }catch(Exception error){try{result.put("ok",false).put("message","Agent Android indisponible. Vérifiez le partage réseau, le port 48136 et le stockage sécurisé.");}catch(JSONException ignored){}}
        if(!closed)dispatch.accept("executor-result",new JSONObjectWrapper(requestId,result.toString()).json());
      });
    }catch(Exception error){if(!id.isEmpty())dispatch.accept("executor-result",new JSONObjectWrapper(id,"{\"ok\":false,\"message\":\"Agent occupé ou requête locale invalide.\"}").json());}
  }
  private ExecutorHttpServer.Reply request(ExecutorHttpServer.Request request)throws Exception {
    if(closed||replies.size()>=16)return unavailable();
    String id=UUID.randomUUID().toString();CompletableFuture<ExecutorHttpServer.Reply> future=new CompletableFuture<>();replies.put(id,future);
    try{
      JSONObject payload=new JSONObject().put("id",id).put("method",request.method).put("path",request.path).put("authorization",request.authorization).put("remote",request.remote).put("body",request.body);
      dispatch.accept("executor-request",payload.toString());
      return future.get(125,TimeUnit.SECONDS);
    }catch(Exception error){return unavailable();}finally{replies.remove(id);}
  }
  private static ExecutorHttpServer.Reply unavailable(){return new ExecutorHttpServer.Reply(503,"{\"error\":{\"code\":\"DEVICE_UNAVAILABLE\",\"message\":\"Application Android indisponible. Vérifiez le résultat avant de réessayer.\",\"retryable\":false}}");}
  private JSONObject info()throws Exception {
    JSONArray urls=new JSONArray();
    if(server!=null){Enumeration<NetworkInterface> interfaces=NetworkInterface.getNetworkInterfaces();while(interfaces!=null&&interfaces.hasMoreElements()){
      NetworkInterface adapter=interfaces.nextElement();if(!adapter.isUp()||adapter.isLoopback())continue;
      Enumeration<InetAddress> addresses=adapter.getInetAddresses();while(addresses.hasMoreElements()){InetAddress address=addresses.nextElement();
        if(address instanceof Inet4Address&&!address.isLoopbackAddress())urls.put("https://"+address.getHostAddress()+":"+server.port());
      }
    }}
    return new JSONObject().put("enabled",server!=null).put("fingerprint",identity==null?"":identity.fingerprint).put("urls",urls).put("requiresOpenApplication",true);
  }
  public void close(){closed=true;if(server!=null)server.close();for(CompletableFuture<ExecutorHttpServer.Reply> future:replies.values())future.complete(unavailable());replies.clear();worker.shutdownNow();}
  private static final class JSONObjectWrapper {
    final String id,result;JSONObjectWrapper(String i,String r){id=i;result=r;}
    String json(){try{return new JSONObject().put("id",id).put("result",result).toString();}catch(JSONException error){throw new IllegalStateException(error);}}
  }
}
