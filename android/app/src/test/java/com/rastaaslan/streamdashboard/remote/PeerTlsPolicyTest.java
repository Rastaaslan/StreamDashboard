package com.rastaaslan.streamdashboard.remote;

import org.junit.Test;
import static org.junit.Assert.*;
import java.io.*;
import java.net.*;
import java.security.*;
import java.security.cert.X509Certificate;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import javax.net.ssl.*;

public class PeerTlsPolicyTest {
  private KeyStore fixture()throws Exception {
    KeyStore store=KeyStore.getInstance("PKCS12");try(InputStream input=getClass().getResourceAsStream("/tls/agent.p12")){store.load(input,"test-only".toCharArray());}return store;
  }
  @Test public void rejectsAmbiguousOriginsAndNonApiRequests() {
    for(String value:new String[]{"http://pc:48136","https://user@pc","https://pc/","https://pc?x","https://example.com","https://100.128.1.1","https://192.168.1.300"})assertThrows(IllegalArgumentException.class,()->PeerTlsPolicy.origin(value));
    assertEquals("https://100.100.1.1:48136",PeerTlsPolicy.origin("https://100.100.1.1:48136").toString());
    assertThrows(IllegalArgumentException.class,()->PeerTlsPolicy.requestOrigin("https://pc:48136/api/v2/../../other"));
    assertThrows(IllegalArgumentException.class,()->PeerTlsPolicy.requestOrigin("https://pc:48136/oauth"));
  }
  @Test public void wrongCertificateCannotReceiveAnAuthorizationHeader()throws Exception {
    KeyStore store=fixture();X509Certificate cert=(X509Certificate)store.getCertificate(store.aliases().nextElement());
    String pin=PeerTlsPolicy.certificateFingerprint(cert);assertTrue(PeerTlsPolicy.matches(cert,pin));assertFalse(PeerTlsPolicy.matches(cert,"00".repeat(32)));
    KeyManagerFactory managers=KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());managers.init(store,"test-only".toCharArray());
    SSLContext serverContext=SSLContext.getInstance("TLS");serverContext.init(managers.getKeyManagers(),null,null);
    AtomicInteger requests=new AtomicInteger();ExecutorService worker=Executors.newSingleThreadExecutor();
    try(SSLServerSocket server=(SSLServerSocket)serverContext.getServerSocketFactory().createServerSocket(0,10,InetAddress.getLoopbackAddress())) {
      server.setSoTimeout(5000);
      Future<?> serve=worker.submit(()->{for(int i=0;i<2;i++)try(SSLSocket socket=(SSLSocket)server.accept()){
        socket.setSoTimeout(5000);socket.startHandshake();BufferedReader input=new BufferedReader(new InputStreamReader(socket.getInputStream()));String line=input.readLine();if(line!=null){requests.incrementAndGet();while(!(line=input.readLine()).isEmpty()){}socket.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Length:2\r\nConnection:close\r\n\r\n{}".getBytes());}
      }catch(IOException expected){}});
      for(String identity:new String[]{"00".repeat(32),pin}){
        HttpsURLConnection connection=(HttpsURLConnection)new URL("https://127.0.0.1:"+server.getLocalPort()+"/api/v2/state").openConnection();
        connection.setSSLSocketFactory(PeerTlsPolicy.context(identity).getSocketFactory());connection.setHostnameVerifier((hostname,session)->{try{return hostname.equals("127.0.0.1")&&PeerTlsPolicy.matches((X509Certificate)session.getPeerCertificates()[0],identity);}catch(Exception error){return false;}});
        connection.setConnectTimeout(5000);connection.setReadTimeout(5000);connection.setRequestProperty("Authorization","Device TEST_SECRET");
        try{if(identity.equals(pin))assertEquals(200,connection.getResponseCode());else{assertThrows(IOException.class,connection::getResponseCode);assertEquals(0,requests.get());}}finally{connection.disconnect();}
      }
      serve.get(10,TimeUnit.SECONDS);assertEquals(1,requests.get());
    }finally{worker.shutdownNow();}
  }
}
