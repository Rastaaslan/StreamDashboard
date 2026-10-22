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
  String encode(String value)throws Exception {
    Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());
    return Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)+"."+Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP);
  }
  String decode(String blob)throws Exception {
    if(blob.isEmpty())return "";
    try{String[] parts=blob.split("\\.",2);Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(parts[0],Base64.NO_WRAP)));return new String(cipher.doFinal(Base64.decode(parts[1],Base64.NO_WRAP)),StandardCharsets.UTF_8);}
    catch(Exception error){throw new java.io.IOException("Lecture sécurisée temporairement impossible",error);}
  }
  void put(String provider,String value)throws Exception{if(!context.getSharedPreferences("secure_providers",Context.MODE_PRIVATE).edit().putString(provider,encode(value)).commit())throw new java.io.IOException("Sauvegarde sécurisée impossible");}
  String get(String provider)throws Exception{return decode(context.getSharedPreferences("secure_providers",Context.MODE_PRIVATE).getString(provider,""));}
  java.util.List<String> receiptKeys(){java.util.List<String> keys=new java.util.ArrayList<>();for(String key:context.getSharedPreferences("secure_providers",Context.MODE_PRIVATE).getAll().keySet())if(key.startsWith("chat_message_")||key.startsWith("wizebot_edit_")||key.startsWith("wizebot_command_")||key.startsWith("planning_twitch_"))keys.add(key);return keys;}
  void clear(String provider){if(!context.getSharedPreferences("secure_providers",Context.MODE_PRIVATE).edit().remove(provider).commit())throw new IllegalStateException("Suppression sécurisée impossible");}
  private synchronized SecretKey key()throws Exception{KeyStore s=KeyStore.getInstance("AndroidKeyStore");s.load(null);if(!s.containsAlias(ALIAS)){KeyGenerator g=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");g.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());return g.generateKey();}return(SecretKey)s.getKey(ALIAS,null);}
}
