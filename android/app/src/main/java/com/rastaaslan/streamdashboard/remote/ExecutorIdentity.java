package com.rastaaslan.streamdashboard.remote;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.math.BigInteger;
import java.net.Socket;
import java.security.*;
import java.security.cert.X509Certificate;
import java.util.Date;
import javax.net.ssl.*;
import javax.security.auth.x500.X500Principal;

/** The TLS private key stays in Android Keystore, separate from OAuth accounts. */
final class ExecutorIdentity {
  private static final String ALIAS="streamdashboard.executor.tls.v1";
  final SSLContext context;final String fingerprint;
  ExecutorIdentity()throws Exception {
    KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
    if(!store.containsAlias(ALIAS)){
      KeyPairGenerator generator=KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA,"AndroidKeyStore");
      generator.initialize(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_SIGN|KeyProperties.PURPOSE_VERIFY)
        .setKeySize(2048).setDigests(KeyProperties.DIGEST_SHA256,KeyProperties.DIGEST_SHA384,KeyProperties.DIGEST_SHA512)
        .setSignaturePaddings(KeyProperties.SIGNATURE_PADDING_RSA_PKCS1,KeyProperties.SIGNATURE_PADDING_RSA_PSS)
        .setCertificateSubject(new X500Principal("CN=StreamDashboard Android"))
        .setCertificateSerialNumber(new BigInteger(128,new SecureRandom()))
        .setCertificateNotBefore(new Date(System.currentTimeMillis()-86400000L))
        .setCertificateNotAfter(new Date(System.currentTimeMillis()+315360000000L)).build());generator.generateKeyPair();
    }
    final PrivateKey key=(PrivateKey)store.getKey(ALIAS,null);
    final X509Certificate cert=(X509Certificate)store.getCertificate(ALIAS);cert.checkValidity();cert.verify(cert.getPublicKey());
    StringBuilder hex=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(cert.getEncoded()))hex.append(String.format("%02x",b&255));fingerprint=hex.toString();
    X509ExtendedKeyManager manager=new X509ExtendedKeyManager(){
      public String[] getClientAliases(String type,Principal[] issuers){return null;}
      public String chooseClientAlias(String[] types,Principal[] issuers,Socket socket){return null;}
      public String[] getServerAliases(String type,Principal[] issuers){return "RSA".equals(type)?new String[]{ALIAS}:null;}
      public String chooseServerAlias(String type,Principal[] issuers,Socket socket){return "RSA".equals(type)?ALIAS:null;}
      public String chooseEngineServerAlias(String type,Principal[] issuers,SSLEngine engine){return "RSA".equals(type)?ALIAS:null;}
      public X509Certificate[] getCertificateChain(String alias){return ALIAS.equals(alias)?new X509Certificate[]{cert}:null;}
      public PrivateKey getPrivateKey(String alias){return ALIAS.equals(alias)?key:null;}
    };
    context=SSLContext.getInstance("TLS");context.init(new KeyManager[]{manager},null,new SecureRandom());
  }
}
