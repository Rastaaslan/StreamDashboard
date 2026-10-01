package com.rastaaslan.streamdashboard.remote;
import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;

final class SecureCredentialStore {
  private static final String ALIAS="streamdashboard.standalone.providers";
  private final Context context;
  SecureCredentialStore(Context value){context=value;}
  void put(String provider,String value)throws Exception{Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.ENCRYPT_MODE,key());String blob=Base64.encodeToString(c.getIV(),Base64.NO_WRAP)+"."+Base64.encodeToString(c.doFinal(value.getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP);context.getSharedPreferences("secure_providers",Context.MODE_PRIVATE).edit().putString(provider,blob).apply();}
  String get(String provider)throws Exception{String blob=context.getSharedPreferences("secure_providers",Context.MODE_PRIVATE).getString(provider,"");if(blob.isEmpty())return "";try{String[] p=blob.split("\\.",2);Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(p[0],Base64.NO_WRAP)));return new String(c.doFinal(Base64.decode(p[1],Base64.NO_WRAP)),StandardCharsets.UTF_8);}catch(Exception e){clear(provider);return "";}}
  void clear(String provider){context.getSharedPreferences("secure_providers",Context.MODE_PRIVATE).edit().remove(provider).apply();}
  private SecretKey key()throws Exception{KeyStore s=KeyStore.getInstance("AndroidKeyStore");s.load(null);if(!s.containsAlias(ALIAS)){KeyGenerator g=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");g.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());return g.generateKey();}return(SecretKey)s.getKey(ALIAS,null);}
}
