package com.rastaaslan.streamdashboard.remote;
import org.junit.Test;
import static org.junit.Assert.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.cert.X509Certificate;
import java.util.concurrent.atomic.AtomicInteger;
import javax.net.ssl.*;

public class ExecutorHttpServerTest {
  private ExecutorHttpServer.Request parse(String value)throws Exception{return ExecutorHttpServer.read(new ByteArrayInputStream(value.getBytes(StandardCharsets.US_ASCII)),"test");}
  @Test public void rejectsAmbiguousFramingBrowserOriginsAndUnboundedBodies()throws Exception {
    for(String headers:new String[]{"Content-Length: 0\r\nContent-Length: 0\r\n","Transfer-Encoding: chunked\r\n","Origin: https://untrusted.example\r\n","Cookie: token=bad\r\n","Content-Length: 262145\r\n"," folded: header\r\n"}){
      assertThrows(IOException.class,()->parse("POST /api/v2/actions HTTP/1.1\r\nHost: phone\r\n"+headers+"\r\n"));
    }
    for(String path:new String[]{"/secret","/api/../other","/api/%2e%2e/other","https://elsewhere/api/state"})assertThrows(IOException.class,()->parse("GET "+path+" HTTP/1.1\r\nHost: phone\r\n\r\n"));
    ExecutorHttpServer.Request request=parse("POST /api/v2/actions HTTP/1.1\r\nHost: phone\r\nContent-Type: application/json\r\nContent-Length: 2\r\nAuthorization: Device TEST\r\n\r\n{}");
    assertEquals("{}",request.body);assertEquals("Device TEST",request.authorization);
  }
  @Test public void actualTlsReceiverRejectsWrongPinBeforeDispatchAndClosesItsPort()throws Exception {
    KeyStore store=KeyStore.getInstance("PKCS12");try(InputStream input=getClass().getResourceAsStream("/tls/agent.p12")){store.load(input,"test-only".toCharArray());}
    X509Certificate cert=(X509Certificate)store.getCertificate(store.aliases().nextElement());String pin=PeerTlsPolicy.certificateFingerprint(cert);
    KeyManagerFactory manager=KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());manager.init(store,"test-only".toCharArray());SSLContext context=SSLContext.getInstance("TLS");context.init(manager.getKeyManagers(),null,null);
    AtomicInteger calls=new AtomicInteger();int port;
    try(ExecutorHttpServer receiver=new ExecutorHttpServer(context,0,request->{calls.incrementAndGet();return new ExecutorHttpServer.Reply(200,"{}");})){
      port=receiver.port();
      for(String identity:new String[]{"0".repeat(64),pin}){
        HttpsURLConnection connection=(HttpsURLConnection)new URL("https://127.0.0.1:"+port+"/api/v2/state").openConnection();
        connection.setSSLSocketFactory(PeerTlsPolicy.context(identity).getSocketFactory());connection.setHostnameVerifier((host,session)->true);connection.setConnectTimeout(5000);connection.setReadTimeout(5000);connection.setRequestProperty("Authorization","Device TEST");
        try{if(identity.equals(pin))assertEquals(200,connection.getResponseCode());else assertThrows(IOException.class,connection::getResponseCode);}finally{connection.disconnect();}
      }
      assertEquals(1,calls.get());
    }
    assertThrows(IOException.class,()->{try(Socket ignored=new Socket("127.0.0.1",port)){};});
  }
}
