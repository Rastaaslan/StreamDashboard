package com.rastaaslan.streamdashboard.remote;

import java.nio.ByteBuffer;
import java.nio.file.*;
import java.security.*;
import java.security.cert.X509Certificate;
import javax.net.ssl.*;

/** Executes real TLS handshakes in memory: no network, Android runtime or credentials. */
public class PairingTlsCheck {
  static void tasks(SSLEngine e) { Runnable task;while((task=e.getDelegatedTask())!=null)task.run(); }
  static void handshake(SSLContext serverContext,String pin)throws Exception {
    SSLEngine server=serverContext.createSSLEngine(),client=PeerTlsPolicy.context(pin).createSSLEngine("FIXE",48136);
    server.setUseClientMode(false);client.setUseClientMode(true);
    server.beginHandshake();client.beginHandshake();
    ByteBuffer toServer=ByteBuffer.allocate(131072),toClient=ByteBuffer.allocate(131072),empty=ByteBuffer.allocate(0),application=ByteBuffer.allocate(131072);
    for(int i=0;i<100;i++) {
      tasks(client);tasks(server);
      if(client.getHandshakeStatus()==SSLEngineResult.HandshakeStatus.NEED_WRAP)client.wrap(empty,toServer);
      toServer.flip();while(toServer.hasRemaining()) {SSLEngineResult r=server.unwrap(toServer,application);tasks(server);if(r.getStatus()==SSLEngineResult.Status.BUFFER_UNDERFLOW||r.bytesConsumed()==0)break;}toServer.compact();
      if(server.getHandshakeStatus()==SSLEngineResult.HandshakeStatus.NEED_WRAP)server.wrap(empty,toClient);
      toClient.flip();while(toClient.hasRemaining()) {SSLEngineResult r=client.unwrap(toClient,application);tasks(client);if(r.getStatus()==SSLEngineResult.Status.BUFFER_UNDERFLOW||r.bytesConsumed()==0)break;}toClient.compact();
      if(client.getHandshakeStatus()==SSLEngineResult.HandshakeStatus.NOT_HANDSHAKING&&server.getHandshakeStatus()==SSLEngineResult.HandshakeStatus.NOT_HANDSHAKING)return;
    }
    throw new AssertionError("TLS handshake did not finish");
  }
  public static void main(String[] args)throws Exception {
    KeyStore store=KeyStore.getInstance("PKCS12");try(var input=Files.newInputStream(Path.of(args[0]))){store.load(input,"test-only".toCharArray());}
    X509Certificate cert=(X509Certificate)store.getCertificate(store.aliases().nextElement());
    KeyManagerFactory managers=KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());managers.init(store,"test-only".toCharArray());
    SSLContext server=SSLContext.getInstance("TLSv1.2");server.init(managers.getKeyManagers(),null,null);
    String pin=PeerTlsPolicy.certificateFingerprint(cert);
    handshake(server,pin);
    try{handshake(server,"00".repeat(32));throw new AssertionError("MITM certificate accepted");}catch(SSLException expected){}
    // Reconnection revalidates the saved pin with a fresh TLS session.
    handshake(server,pin);
    for(String origin:new String[]{"http://FIXE:48136","https://attacker.example","https://user@FIXE","https://FIXE?x"}) {
      try{PeerTlsPolicy.origin(origin);throw new AssertionError("Unsafe origin accepted");}catch(IllegalArgumentException expected){}
    }
    System.out.println("PASS: valid TLS identity, rejected wrong pin, pinned reconnect, unsafe origins rejected");
  }
}
