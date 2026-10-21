package com.rastaaslan.streamdashboard.remote;
import org.junit.Test;
import static org.junit.Assert.*;
import java.net.*;
import java.nio.charset.StandardCharsets;

public class PeerDiscoveryTest {
 @Test public void requestUsesTheSameBoundedNonceContractAsWindows(){
  String nonce="abababababababababababababababab";byte[] query=PeerDiscovery.query(nonce);
  assertEquals(1024,query.length);String text=new String(query,StandardCharsets.US_ASCII);
  assertTrue(text.startsWith("SDNEXT21-DISCOVER:"+nonce+"\n"));assertTrue(text.substring(50).trim().isEmpty());
  assertThrows(IllegalArgumentException.class,()->PeerDiscovery.query("anything"));
 }
 @Test public void onlyPrivateIPv4PeersCanAdvertise()throws Exception {
  for(String value:new String[]{"10.1.2.3","192.168.2.3","172.16.0.1","172.31.255.254","169.254.1.2"})assertTrue(PeerDiscovery.privateAddress(InetAddress.getByName(value)));
  for(String value:new String[]{"8.8.8.8","127.0.0.1","172.32.0.1","::1"})assertFalse(PeerDiscovery.privateAddress(InetAddress.getByName(value)));
 }
}
