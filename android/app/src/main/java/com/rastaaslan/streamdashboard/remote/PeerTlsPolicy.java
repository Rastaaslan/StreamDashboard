package com.rastaaslan.streamdashboard.remote;

import java.net.URI;
import java.security.MessageDigest;
import java.security.cert.X509Certificate;
import java.util.Locale;
import javax.net.ssl.*;

/** A pin identifies one explicitly associated origin; it never changes global TLS trust. */
final class PeerTlsPolicy {
  static String fingerprint(String value) {
    if(value==null||value.length()>200)throw new IllegalArgumentException("Empreinte invalide");
    String normalized=value.replaceAll("[:\\s-]","").toLowerCase(Locale.ROOT);
    if(!normalized.matches("[a-f0-9]{64}"))throw new IllegalArgumentException("Empreinte SHA-256 invalide");
    return normalized;
  }
  static URI origin(String value) {
    URI uri=URI.create(value);
    String host=uri.getHost(),path=uri.getRawPath();
    if(value.length()>2048||!"https".equals(uri.getScheme())||host==null||uri.getRawUserInfo()!=null||uri.getRawQuery()!=null||uri.getRawFragment()!=null||(path!=null&&!path.isEmpty())||uri.getPort()==0||uri.getPort()>65535)throw new IllegalArgumentException("Adresse HTTPS invalide");
    boolean local=host.equals("localhost")||host.endsWith(".local")||host.matches("[A-Za-z0-9-]+");
    if(host.matches("[0-9.]+")) {
      String[] parts=host.split("\\.");local=false;
      if(parts.length==4){int[] p=new int[4];for(int i=0;i<4;i++){p[i]=Integer.parseInt(parts[i]);if(p[i]>255||p[i]<0)throw new IllegalArgumentException("Adresse invalide");}
        local=p[0]==10||(p[0]==127&&p[1]==0&&p[2]==0&&p[3]==1)||(p[0]==172&&p[1]>=16&&p[1]<=31)||(p[0]==192&&p[1]==168)||(p[0]==100&&p[1]>=64&&p[1]<=127);
      }
    }
    if(!local)throw new IllegalArgumentException("Adresse locale ou Tailscale requise");
    return uri;
  }
  static String requestOrigin(String value) {
    URI uri=URI.create(value);
    if(uri.getRawUserInfo()!=null||uri.getFragment()!=null||uri.getPath()==null||!uri.getPath().matches("/api/v[12]/.*")||!uri.normalize().getPath().equals(uri.getPath()))throw new IllegalArgumentException("Requête d’agent invalide");
    return origin(uri.getScheme()+"://"+uri.getRawAuthority()).toString();
  }
  static String certificateFingerprint(X509Certificate certificate)throws Exception {
    certificate.checkValidity();
    byte[] digest=MessageDigest.getInstance("SHA-256").digest(certificate.getEncoded());
    StringBuilder result=new StringBuilder();for(byte b:digest)result.append(String.format(Locale.ROOT,"%02x",b&255));
    return result.toString();
  }
  static boolean matches(X509Certificate certificate,String expected) {
    try{return MessageDigest.isEqual(certificateFingerprint(certificate).getBytes(java.nio.charset.StandardCharsets.US_ASCII),fingerprint(expected).getBytes(java.nio.charset.StandardCharsets.US_ASCII));}catch(Exception error){return false;}
  }
  static SSLContext context(String expected)throws Exception {
    String pin=fingerprint(expected);
    X509TrustManager trust=new X509TrustManager(){
      public X509Certificate[] getAcceptedIssuers(){return new X509Certificate[0];}
      public void checkClientTrusted(X509Certificate[] chain,String type)throws java.security.cert.CertificateException{throw new java.security.cert.CertificateException("Client non autorisé");}
      public void checkServerTrusted(X509Certificate[] chain,String type)throws java.security.cert.CertificateException{
        if(chain==null||chain.length==0||!matches(chain[0],pin))throw new java.security.cert.CertificateException("L’identité de l’agent a changé ou son certificat a expiré");
      }
    };
    SSLContext context=SSLContext.getInstance("TLSv1.2");context.init(null,new TrustManager[]{trust},null);return context;
  }
  private PeerTlsPolicy(){}
}
