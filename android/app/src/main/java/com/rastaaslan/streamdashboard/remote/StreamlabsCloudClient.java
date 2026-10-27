package com.rastaaslan.streamdashboard.remote;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.regex.Pattern;
import org.json.*;

/** The same read-only recent-events endpoint used by the desktop runtime.
 * Only whitelisted public row fields cross the native bridge, never the raw
 * response (which can contain platform credentials). */
final class StreamlabsCloudClient {
  private static final Pattern TOKEN = Pattern.compile("[A-Za-z0-9_-]{20,256}");
  private static final int MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
  private static final Map<String,String> COLLECTIONS = Map.of("donations","donation","subscriptions","subscription","follows","follow","raids","raid","bits","bits");
  static final class Failure extends Exception {
    final String code;
    Failure(String code,String message){super(message);this.code=code;}
  }
  static String widgetToken(String raw) throws Exception {
    if(raw==null||raw.length()>4000)throw new Failure("INVALID_PAYLOAD","URL de widget Streamlabs invalide.");
    String value=raw.trim();if(TOKEN.matcher(value).matches())return value;
    URI uri;
    try{uri=new URI(value);}catch(Exception error){throw new Failure("INVALID_PAYLOAD","Collez une URL de widget Streamlabs complète.");}
    if(!"https".equalsIgnoreCase(uri.getScheme())||uri.getHost()==null||!Arrays.asList("streamlabs.com","www.streamlabs.com").contains(uri.getHost().toLowerCase(Locale.ROOT))||(uri.getPort()!=-1&&uri.getPort()!=443)||uri.getUserInfo()!=null)
      throw new Failure("INVALID_PAYLOAD","Utilisez une URL HTTPS de widget streamlabs.com.");
    Set<String> candidates=new HashSet<>();int queryTokens=0;
    if(uri.getRawQuery()!=null)for(String entry:uri.getRawQuery().split("&")){
      String[] pair=entry.split("=",2);
      if(URLDecoder.decode(pair[0],"UTF-8").equals("token")){queryTokens++;candidates.add(pair.length==2?URLDecoder.decode(pair[1],"UTF-8"):"");}
    }
    for(String segment:(uri.getRawPath()==null?"":uri.getRawPath()).split("/"))if(TOKEN.matcher(segment).matches())candidates.add(segment);
    if(queryTokens>1||candidates.size()!=1||!TOKEN.matcher(candidates.iterator().next()).matches())throw new Failure("INVALID_PAYLOAD","Cette URL ne contient pas un jeton de widget Streamlabs unique.");
    return candidates.iterator().next();
  }
  static String accountKey(String token) throws Exception {
    StringBuilder out=new StringBuilder();for(byte value:MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8)))out.append(String.format(Locale.ROOT,"%02x",value));return out.toString();
  }
  static JSONObject read(String token) throws Exception {
    HttpURLConnection connection=(HttpURLConnection)new URL("https://streamlabs.com/api/v5/slobs/recentevents/"+token).openConnection();
    connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(10000);connection.setReadTimeout(15000);
    connection.setRequestMethod("GET");connection.setRequestProperty("Accept","application/json");connection.setRequestProperty("Cache-Control","no-store");connection.setUseCaches(false);
    try{
      int status=connection.getResponseCode();
      if(status==429)throw new Failure("HTTP_429","Streamlabs limite les requêtes. Réessayez dans une minute.");
      if(status==401||status==403)throw new Failure("HTTP_"+status,"Streamlabs refuse cet historique. Vérifiez l’URL du widget.");
      if(status<200||status>=300)throw new Failure("NETWORK","L’historique Streamlabs est temporairement indisponible.");
      String type=connection.getContentType();if(type==null||!type.toLowerCase(Locale.ROOT).contains("application/json"))throw new Failure("FORMAT","Streamlabs n’a pas renvoyé un historique valide.");
      try(InputStream stream=connection.getInputStream();ByteArrayOutputStream bytes=new ByteArrayOutputStream()){
        byte[] chunk=new byte[8192];int count;
        while((count=stream.read(chunk))!=-1){if(bytes.size()+count>MAX_RESPONSE_BYTES)throw new Failure("LIMIT","L’historique Streamlabs dépasse la taille acceptée.");bytes.write(chunk,0,count);}
        return publicPayload(new JSONObject(bytes.toString("UTF-8")));
      }
    }finally{connection.disconnect();}
  }
  static JSONObject publicPayload(JSONObject payload) throws Exception {
    JSONObject input=payload.optJSONObject("data"),data=new JSONObject();boolean hasCollection=false;
    if(input==null)throw new Failure("FORMAT","Streamlabs n’a pas renvoyé un historique valide.");
    for(Map.Entry<String,String> collection:COLLECTIONS.entrySet()){
      JSONArray rows=input.optJSONArray(collection.getKey());if(rows==null)continue;hasCollection=true;JSONArray clean=new JSONArray();
      for(int i=0;i<rows.length();i++){
        Object candidate=rows.get(i);if(!(candidate instanceof JSONObject))continue;JSONObject row=(JSONObject)candidate;
        if(!collection.getValue().equals(row.optString("type")))continue;
        String platform=row.optString("platform");if(!Arrays.asList("twitch_account","youtube_account","streamlabs").contains(platform))continue;
        JSONObject out=new JSONObject().put("type",collection.getValue()).put("platform",platform);
        for(String field:new String[]{"_id","id","created_at","display_name","name","from_display_name","from","gifter_display_name","gifter","message","comment","amount","currency","formatted_amount","formattedAmount","displayString","raiders","viewers","months","gifted","count","sub_type","subType","recipient","recipient_name","isTest","is_test"}){
          Object value=row.opt(field);
          if(value instanceof String){int limit=field.equals("_id")||field.equals("id")?6000:field.equals("message")||field.equals("comment")?2000:100;out.put(field,((String)value).substring(0,Math.min(limit,((String)value).length())));}
          else if(value instanceof Number||value instanceof Boolean)out.put(field,value);
        }
        clean.put(out);
      }
      data.put(collection.getKey(),clean);
    }
    if(!hasCollection)throw new Failure("FORMAT","Streamlabs n’a pas renvoyé un historique valide.");
    return new JSONObject().put("data",data);
  }
}
