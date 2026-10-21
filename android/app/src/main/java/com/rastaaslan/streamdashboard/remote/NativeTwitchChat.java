package com.rastaaslan.streamdashboard.remote;

import org.json.*;
import java.io.*;
import java.net.InetSocketAddress;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import javax.net.ssl.*;

/** TLS IRC reader; OAuth stays native. Sending uses the existing Helix API. */
final class NativeTwitchChat {
  private String userId="",login="",display="",token="";
  private boolean connected=false;
  private long generation=0,lastPoll=0,retryAt=0;
  private Thread worker;
  private SSLSocket socket;
  private final LinkedHashMap<String,JSONObject> messages=new LinkedHashMap<>();
  synchronized JSONObject state(String id,String name,String label,String access,boolean read,boolean write)throws Exception{
    lastPoll=System.currentTimeMillis();
    if(!id.equals(userId)||!access.equals(token)){
      boolean another=!id.equals(userId);close();if(another)messages.clear();userId=id;login=name;display=label;token=access;
    }
    if(read&&worker==null&&System.currentTimeMillis()>=retryAt){long current=generation;String channel=login,secret=token,owner=userId;worker=new Thread(()->receive(current,channel,owner,secret),"twitch-chat");worker.setDaemon(true);worker.start();}
    JSONArray rows=new JSONArray();for(JSONObject value:messages.values())rows.put(value);
    return new JSONObject().put("ok",true).put("accountConnected",true).put("identity",new JSONObject().put("broadcasterId",id).put("userName",name).put("displayName",label))
      .put("capabilities",new JSONObject().put("chatRead",read).put("chatWrite",write)).put("chat",new JSONObject().put("connected",read&&connected).put("messages",rows));
  }
  synchronized void close(){generation++;connected=false;worker=null;token="";try{if(socket!=null)socket.close();}catch(IOException ignored){}socket=null;}
  synchronized void clear(){close();userId="";login="";display="";messages.clear();}
  private synchronized boolean current(long value){return generation==value&&System.currentTimeMillis()-lastPoll<65000;}
  private void receive(long current,String channel,String owner,String access){
    SSLSocket connection=null;
    try{
      connection=(SSLSocket)SSLSocketFactory.getDefault().createSocket();
      SSLParameters parameters=connection.getSSLParameters();parameters.setEndpointIdentificationAlgorithm("HTTPS");connection.setSSLParameters(parameters);
      connection.connect(new InetSocketAddress("irc.chat.twitch.tv",6697),10000);connection.setSoTimeout(35000);connection.startHandshake();
      synchronized(this){if(!current(current)){connection.close();return;}socket=connection;}
      BufferedWriter writer=new BufferedWriter(new OutputStreamWriter(connection.getOutputStream(),StandardCharsets.UTF_8));
      writer.write("CAP REQ :twitch.tv/tags twitch.tv/commands\r\nPASS oauth:"+access+"\r\nNICK "+channel+"\r\nJOIN #"+channel+"\r\n");writer.flush();
      Reader reader=new InputStreamReader(connection.getInputStream(),StandardCharsets.UTF_8);
      while(current(current)){
        String line;
        try{line=line(reader);}catch(SocketTimeoutException idle){continue;}
        if(line==null)break;
        if(line.startsWith("PING ")){writer.write("PONG "+line.substring(5)+"\r\n");writer.flush();continue;}
        if(line.contains(" RECONNECT")||line.contains("Login authentication failed")||line.contains("Improperly formatted auth"))break;
        synchronized(this){
          if(!current(current))break;
          if(line.contains(" 366 ")||line.contains(" ROOMSTATE #"+channel))connected=true;
          if(line.contains(" CLEARCHAT #"+channel)){messages.clear();continue;}
          if(line.contains(" CLEARMSG #"+channel)){messages.remove(tags(line).getOrDefault("target-msg-id",""));continue;}
          JSONObject message=decode(line,channel,owner);if(message!=null){connected=true;messages.put(message.getString("id"),message);while(messages.size()>200)messages.remove(messages.keySet().iterator().next());}
        }
      }
    }catch(Exception ignored){/* No raw exception may contain the authentication line. */}
    finally{try{if(connection!=null)connection.close();}catch(IOException ignored){}synchronized(this){if(generation==current){connected=false;worker=null;socket=null;retryAt=System.currentTimeMillis()+5000;}}}
  }
  private static String line(Reader reader)throws IOException{StringBuilder s=new StringBuilder();for(int c;(c=reader.read())!=-1;){if(c=='\n')return s.toString();if(c!='\r')s.append((char)c);if(s.length()>16384)throw new IOException("IRC line too long");}return null;}
  private static Map<String,String> tags(String line){Map<String,String> values=new HashMap<>();if(line.startsWith("@")){int end=line.indexOf(' ');if(end>0)for(String pair:line.substring(1,end).split(";")){String[] p=pair.split("=",2);values.put(p[0],p.length==2?p[1].replace("\\s"," ").replace("\\:",";").replace("\\r","").replace("\\n","").replace("\\\\","\\"):"");}}return values;}
  static JSONObject decode(String line,String channel,String owner)throws Exception{
    String marker=" PRIVMSG #"+channel+" :";int at=line.indexOf(marker);if(at<0||line.length()>16384)return null;
    Map<String,String> tags=tags(line);String id=tags.getOrDefault("id","");if(id.isEmpty()||(!tags.getOrDefault("room-id",owner).equals(owner)))return null;
    String text=line.substring(at+marker.length());if(text.length()>2000)text=text.substring(0,2000);
    int prefix=line.indexOf(':',line.startsWith("@")?line.indexOf(' '):0),bang=line.indexOf('!',prefix);String author=prefix>=0&&bang>prefix?line.substring(prefix+1,bang):"";
    JSONArray badges=new JSONArray();for(String item:tags.getOrDefault("badges","").split(",")){String name=item.split("/",2)[0];if(Set.of("broadcaster","moderator","vip","subscriber").contains(name))badges.put(new JSONObject().put("setId",name));}
    return new JSONObject().put("id",id).put("broadcasterId",owner).put("text",text).put("receivedAt",Instant.now().toString())
      .put("chatter",new JSONObject().put("id",tags.getOrDefault("user-id","")).put("login",author).put("displayName",tags.getOrDefault("display-name",author)).put("color",tags.getOrDefault("color","")).put("badges",badges));
  }
}
