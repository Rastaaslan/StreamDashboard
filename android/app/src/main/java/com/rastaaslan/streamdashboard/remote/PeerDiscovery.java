package com.rastaaslan.streamdashboard.remote;

import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.json.*;

/** UDP hints only. Pairing and certificate verification remain mandatory. */
final class PeerDiscovery implements AutoCloseable {
  static final int PORT=48137,SIZE=1024;
  static final String PREFIX="SDNEXT21-DISCOVER:";
  private final DatagramSocket socket;
  private final Thread thread;
  private final JSONObject device;
  private volatile boolean closed;
  private final Map<String,Long> recent=new LinkedHashMap<>();
  PeerDiscovery(JSONObject advertised)throws Exception {
    if(!valid(advertised))throw new IllegalArgumentException();device=new JSONObject(advertised.toString());
    socket=new DatagramSocket(null);try{socket.bind(new InetSocketAddress(PORT));}catch(Exception error){socket.close();throw error;}
    thread=new Thread(this::receive,"StreamDashboard-discovery");thread.setDaemon(true);thread.start();
  }
  static boolean privateAddress(InetAddress address){return address instanceof Inet4Address&&!address.isLoopbackAddress()&&(address.isSiteLocalAddress()||address.isLinkLocalAddress());}
  static boolean valid(JSONObject value){return value!=null&&value.optString("id").matches("[-A-Za-z0-9_]{1,100}")&&!value.optString("name").trim().isEmpty()&&value.optString("name").length()<=80&&Arrays.asList("windows","android").contains(value.optString("platform"))&&value.optInt("port")>0&&value.optInt("port")<=65535;}
  static byte[] query(String nonce){if(!nonce.matches("[a-f0-9]{32}"))throw new IllegalArgumentException();byte[] data=new byte[SIZE];Arrays.fill(data,(byte)' ');byte[] start=(PREFIX+nonce+"\n").getBytes(StandardCharsets.US_ASCII);System.arraycopy(start,0,data,0,start.length);return data;}
  static byte[] answer(byte[] data,int length,JSONObject device)throws Exception {
    if(length!=SIZE||!valid(device))return null;String text=new String(data,0,length,StandardCharsets.US_ASCII);
    if(!text.startsWith(PREFIX)||text.charAt(PREFIX.length()+32)!='\n'||!text.substring(PREFIX.length()+33).trim().isEmpty())return null;
    String nonce=text.substring(PREFIX.length(),PREFIX.length()+32);if(!nonce.matches("[a-f0-9]{32}"))return null;
    return new JSONObject().put("protocol","SDNEXT21").put("nonce",nonce).put("id",device.getString("id")).put("name",device.getString("name")).put("platform",device.getString("platform")).put("port",device.getInt("port")).toString().getBytes(StandardCharsets.UTF_8);
  }
  static JSONObject hint(byte[] data,int length,InetAddress address,String nonce)throws Exception {
    if(length>SIZE||!privateAddress(address))return null;
    JSONObject value=new JSONObject(new String(data,0,length,StandardCharsets.UTF_8));
    if(!value.optString("protocol").equals("SDNEXT21")||!value.optString("nonce").equals(nonce)||!valid(value))return null;
    return new JSONObject().put("id",value.getString("id")).put("name",value.getString("name")).put("platform",value.getString("platform")).put("port",value.getInt("port")).put("endpoint","https://"+address.getHostAddress()+":"+value.getInt("port"));
  }
  private void receive(){
    while(!closed)try{
      byte[] buffer=new byte[SIZE+1];DatagramPacket packet=new DatagramPacket(buffer,buffer.length);socket.receive(packet);
      if(!privateAddress(packet.getAddress()))continue;String address=packet.getAddress().getHostAddress();long now=System.currentTimeMillis();
      if(now-recent.getOrDefault(address,0L)<1000)continue;byte[] response=answer(buffer,packet.getLength(),device);if(response==null)continue;
      recent.put(address,now);if(recent.size()>128)recent.remove(recent.keySet().iterator().next());
      socket.send(new DatagramPacket(response,response.length,packet.getAddress(),packet.getPort()));
    }catch(Exception ignored){if(closed)return;}
  }
  static JSONArray scan()throws Exception {
    String nonce=UUID.randomUUID().toString().replace("-","");byte[] query=query(nonce);Map<String,JSONObject> found=new LinkedHashMap<>();
    try(DatagramSocket scanner=new DatagramSocket()){
      scanner.setBroadcast(true);scanner.setSoTimeout(200);Set<InetAddress> targets=new HashSet<>();targets.add(InetAddress.getByName("255.255.255.255"));
      Enumeration<NetworkInterface> interfaces=NetworkInterface.getNetworkInterfaces();
      while(interfaces!=null&&interfaces.hasMoreElements()){NetworkInterface adapter=interfaces.nextElement();if(!adapter.isUp()||adapter.isLoopback())continue;for(InterfaceAddress address:adapter.getInterfaceAddresses())if(address.getBroadcast()!=null&&privateAddress(address.getAddress()))targets.add(address.getBroadcast());}
      int sent=0;for(InetAddress target:targets){if(sent++>=32)break;try{scanner.send(new DatagramPacket(query,query.length,target,PORT));}catch(Exception ignored){}}
      long until=System.nanoTime()+1800000000L;
      while(System.nanoTime()<until&&found.size()<64){
        byte[] buffer=new byte[SIZE+1];DatagramPacket packet=new DatagramPacket(buffer,buffer.length);
        try{scanner.receive(packet);if(packet.getPort()!=PORT)continue;JSONObject value=hint(buffer,packet.getLength(),packet.getAddress(),nonce);if(value!=null)found.put(value.getString("id")+"@"+value.getString("endpoint"),value);}catch(SocketTimeoutException ignored){}catch(JSONException ignored){}
      }
    }
    return new JSONArray(found.values());
  }
  public void close(){closed=true;socket.close();try{thread.join(500);}catch(InterruptedException error){Thread.currentThread().interrupt();}}
}
