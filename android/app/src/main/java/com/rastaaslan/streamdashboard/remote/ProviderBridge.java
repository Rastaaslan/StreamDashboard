package com.rastaaslan.streamdashboard.remote;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.webkit.JavascriptInterface;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;
import org.json.*;

/** Narrow, local-origin-only provider API. OAuth credentials never cross this bridge. */
public final class ProviderBridge {
  private static final String TWITCH_SCOPES = "channel:manage:schedule channel:read:schedule";
  private static final String GOOGLE_SCOPES = "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly";
  private final Activity activity;
  private final SecureCredentialStore credentials;
  private final Map<String,String> verifiers = new HashMap<>();

  ProviderBridge(Activity activity) { this.activity = activity; credentials = new SecureCredentialStore(activity); }
  @JavascriptInterface public String twitchStatus(String ignored) { return status("twitch", BuildConfig.TWITCH_ANDROID_CLIENT_ID); }
  @JavascriptInterface public String googleStatus(String ignored) { return status("google", BuildConfig.GOOGLE_ANDROID_CLIENT_ID); }
  @JavascriptInterface public String twitchAuthorize(String ignored) { return authorize("twitch", BuildConfig.TWITCH_ANDROID_CLIENT_ID, "https://id.twitch.tv/oauth2/authorize", TWITCH_SCOPES); }
  @JavascriptInterface public String googleAuthorize(String ignored) { return authorize("google", BuildConfig.GOOGLE_ANDROID_CLIENT_ID, "https://accounts.google.com/o/oauth2/v2/auth", GOOGLE_SCOPES); }
  @JavascriptInterface public String twitchLogout(String ignored) { credentials.clear("twitch"); return ok().toString(); }
  @JavascriptInterface public String googleLogout(String ignored) { credentials.clear("google"); return ok().toString(); }
  @JavascriptInterface public String twitchSearchCategories(String raw) { return guarded(() -> twitchSearch(body(raw).optString("query"))); }
  @JavascriptInterface public String twitchCreatePlanning(String raw) { return guarded(() -> twitchMutate("create", body(raw))); }
  @JavascriptInterface public String twitchUpdatePlanning(String raw) { return guarded(() -> twitchMutate("update", body(raw))); }
  @JavascriptInterface public String twitchDeletePlanning(String raw) { return guarded(() -> twitchMutate("delete", body(raw))); }
  @JavascriptInterface public String googleCreatePlanning(String raw) { return guarded(() -> googleMutate("create", body(raw))); }
  @JavascriptInterface public String googleUpdatePlanning(String raw) { return guarded(() -> googleMutate("update", body(raw))); }
  @JavascriptInterface public String googleDeletePlanning(String raw) { return guarded(() -> googleMutate("delete", body(raw))); }

  void acceptOAuthCallback(Uri uri) {
    String provider = uri.getHost();
    if (!"oauth".equals(provider)) return;
    provider = uri.getQueryParameter("provider");
    String code = uri.getQueryParameter("code"), state = uri.getQueryParameter("state");
    String verifier = verifiers.remove(provider + ":" + state);
    if (code == null || verifier == null) return;
    final String selected = provider;
    new Thread(() -> { try { exchangeCode(selected, code, verifier); notifyAuth(selected, true); } catch (Exception ignored) { notifyAuth(selected, false); } }).start();
  }

  private void notifyAuth(String provider, boolean connected) { activity.runOnUiThread(() -> ((MainActivity)activity).dispatchProviderAuth(provider, connected)); }
  private String status(String provider, String clientId) { try { return new JSONObject().put("ok", true).put("configured", !clientId.isEmpty()).put("connected", !credentials.get(provider).isEmpty()).put("message", clientId.isEmpty() ? "Google autonome non configuré" : JSONObject.NULL).toString(); } catch (Exception e) { return failure("INTERNAL", "État indisponible."); } }
  private String authorize(String provider, String clientId, String endpoint, String scopes) {
    if (clientId.isEmpty()) return failure("NOT_CONFIGURED", provider.equals("google") ? "Google autonome non configuré" : "Twitch autonome non configuré");
    try {
      String verifier = random(48), state = random(24), challenge = base64(MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII)));
      verifiers.put(provider + ":" + state, verifier);
      Uri uri = Uri.parse(endpoint).buildUpon().appendQueryParameter("client_id", clientId).appendQueryParameter("redirect_uri", "streamdashboard://oauth?provider=" + provider).appendQueryParameter("response_type", "code").appendQueryParameter("scope", scopes).appendQueryParameter("state", state).appendQueryParameter("code_challenge", challenge).appendQueryParameter("code_challenge_method", "S256").build();
      activity.startActivity(new Intent(Intent.ACTION_VIEW, uri)); return ok().put("launched", true).toString();
    } catch (Exception e) { return failure("AUTH", "Impossible de lancer l’autorisation."); }
  }
  private void exchangeCode(String provider, String code, String verifier) throws Exception {
    String clientId = provider.equals("twitch") ? BuildConfig.TWITCH_ANDROID_CLIENT_ID : BuildConfig.GOOGLE_ANDROID_CLIENT_ID;
    String endpoint = provider.equals("twitch") ? "https://id.twitch.tv/oauth2/token" : "https://oauth2.googleapis.com/token";
    String form = form(Map.of("client_id",clientId,"code",code,"code_verifier",verifier,"grant_type","authorization_code","redirect_uri","streamdashboard://oauth?provider="+provider));
    JSONObject token = request("POST", endpoint, null, form, null);
    token.put("obtained_at", System.currentTimeMillis()); credentials.put(provider, token.toString());
  }
  private synchronized JSONObject token(String provider) throws Exception {
    JSONObject token = new JSONObject(credentials.get(provider));
    long expires = token.optLong("expires_in", 3600) * 1000L, obtained = token.optLong("obtained_at");
    if (System.currentTimeMillis() < obtained + expires - 60_000) return token;
    String refresh = token.optString("refresh_token"); if (refresh.isEmpty()) throw new ProviderException("REAUTH_REQUIRED", "Reconnectez le provider autonome.");
    String clientId = provider.equals("twitch") ? BuildConfig.TWITCH_ANDROID_CLIENT_ID : BuildConfig.GOOGLE_ANDROID_CLIENT_ID;
    String endpoint = provider.equals("twitch") ? "https://id.twitch.tv/oauth2/token" : "https://oauth2.googleapis.com/token";
    JSONObject fresh = request("POST", endpoint, null, form(Map.of("client_id",clientId,"refresh_token",refresh,"grant_type","refresh_token")), null);
    if (!fresh.has("refresh_token")) fresh.put("refresh_token", refresh); fresh.put("obtained_at", System.currentTimeMillis()); credentials.put(provider, fresh.toString()); return fresh;
  }
  private JSONObject twitchSearch(String query) throws Exception {
    query = limited(query, 80); if (query.trim().length() < 2) return ok().put("items", new JSONArray());
    JSONObject value = twitch("GET", "https://api.twitch.tv/helix/search/categories?first=20&query=" + enc(query), null);
    return ok().put("items", value.getJSONArray("data"));
  }
  private JSONObject twitchMutate(String action, JSONObject input) throws Exception {
    JSONObject event = input.getJSONObject("event"), link = input.optJSONObject("link"); if (link == null) link = new JSONObject();
    String broadcaster = twitchUserId(), remoteId = limited(link.optString("remoteId"), 120);
    if (action.equals("delete")) { requireId(remoteId); twitch("DELETE", "https://api.twitch.tv/helix/schedule/segment?broadcaster_id="+enc(broadcaster)+"&id="+enc(remoteId), null); return ok().put("remoteId", remoteId); }
    if (action.equals("update")) {
      requireId(remoteId); JSONObject current = twitch("GET", "https://api.twitch.tv/helix/schedule?broadcaster_id="+enc(broadcaster)+"&id="+enc(remoteId), null);
      String currentFingerprint = twitchFingerprint(current.getJSONObject("data").getJSONArray("segments").getJSONObject(0));
      if (!link.optString("fingerprint").isEmpty() && !link.optString("fingerprint").equals(currentFingerprint)) throw new ProviderException("CONFLICT", "Le planning Twitch a changé ailleurs.", current);
    }
    JSONObject payload = new JSONObject().put("title", limited(event.optString("title"), 140)).put("category_id", limited(event.optString("twitchCategoryId"), 40)).put("start_time", iso(event.getString("startAtUtc"))).put("duration", duration(event));
    String url = "https://api.twitch.tv/helix/schedule/segment?broadcaster_id="+enc(broadcaster) + (action.equals("update") ? "&id="+enc(remoteId) : "");
    JSONObject response = twitch(action.equals("create") ? "POST" : "PATCH", url, payload.toString());
    JSONObject segment = response.getJSONObject("data").getJSONArray("segments").getJSONObject(0);
    return ok().put("remoteId", segment.getString("id")).put("fingerprint", twitchFingerprint(segment)).put("remoteSnapshot", segment);
  }
  private JSONObject googleMutate(String action, JSONObject input) throws Exception {
    JSONObject event=input.getJSONObject("event"), link=input.optJSONObject("link"); if(link==null)link=new JSONObject();
    String calendar=limited(link.optString("calendarId","primary"),200), remoteId=limited(link.optString("remoteId"),200);
    String base="https://www.googleapis.com/calendar/v3/calendars/"+enc(calendar)+"/events";
    if(action.equals("delete")){requireId(remoteId);google("DELETE",base+"/"+enc(remoteId),null,link.optString("revision"));return ok().put("remoteId",remoteId).put("calendarId",calendar);}
    JSONObject payload=new JSONObject().put("summary",limited(event.optString("title"),140)).put("description",limited(event.optString("description"),500)).put("start",new JSONObject().put("dateTime",iso(event.getString("startAtUtc")))).put("end",new JSONObject().put("dateTime",iso(event.getString("endAtUtc")))).put("extendedProperties",new JSONObject().put("private",new JSONObject().put("streamDashboardEventId",limited(event.getString("id"),200))));
    String method=action.equals("create")?"POST":"PATCH";if(!action.equals("create")){requireId(remoteId);base+="/"+enc(remoteId);}
    JSONObject response=google(method,base,payload.toString(),action.equals("update")?link.optString("revision"):null);
    return ok().put("remoteId",response.getString("id")).put("calendarId",calendar).put("revision",response.optString("etag")).put("remoteSnapshot",response);
  }
  private JSONObject twitch(String method,String url,String body)throws Exception { JSONObject t=token("twitch"); return request(method,url,body,null,Map.of("Authorization","Bearer "+t.getString("access_token"),"Client-Id",BuildConfig.TWITCH_ANDROID_CLIENT_ID)); }
  private JSONObject google(String method,String url,String body,String etag)throws Exception { Map<String,String> h=new HashMap<>(); h.put("Authorization","Bearer "+token("google").getString("access_token")); if(etag!=null&&!etag.isEmpty())h.put("If-Match",etag); return request(method,url,body,null,h); }
  private String twitchUserId()throws Exception { return twitch("GET","https://api.twitch.tv/helix/users",null).getJSONArray("data").getJSONObject(0).getString("id"); }
  private JSONObject request(String method,String address,String json,String form,Map<String,String> headers)throws Exception {
    HttpURLConnection c=(HttpURLConnection)new URL(address).openConnection(); c.setRequestMethod(method); c.setConnectTimeout(10000); c.setReadTimeout(15000); c.setRequestProperty("Accept","application/json");
    if(headers!=null)for(Map.Entry<String,String> h:headers.entrySet())c.setRequestProperty(h.getKey(),h.getValue()); String outgoing=json!=null?json:form;
    if(outgoing!=null){c.setDoOutput(true);c.setRequestProperty("Content-Type",json!=null?"application/json":"application/x-www-form-urlencoded");try(OutputStream o=c.getOutputStream()){o.write(outgoing.getBytes(StandardCharsets.UTF_8));}}
    int status=c.getResponseCode(); InputStream stream=status>=400?c.getErrorStream():c.getInputStream(); String value=stream==null?"":new String(stream.readAllBytes(),StandardCharsets.UTF_8);
    if(status==401)throw new ProviderException("REAUTH_REQUIRED","Session provider expirée."); if(status==409||status==412)throw new ProviderException("CONFLICT","Le provider a changé ailleurs.",value.isEmpty()?null:new JSONObject(value)); if(status>=400)throw new ProviderException("HTTP_"+status,"Le provider a refusé l’opération.");
    return value.isEmpty()?new JSONObject():new JSONObject(value);
  }
  private interface Work { JSONObject run()throws Exception; }
  private String guarded(Work work){try{return work.run().put("ok",true).toString();}catch(ProviderException e){return failure(e.code,e.getMessage(),e.current);}catch(Exception e){return failure("NETWORK","Provider temporairement indisponible.");}}
  private static JSONObject body(String raw)throws Exception {if(raw==null||raw.length()>16_000)throw new ProviderException("INVALID_PAYLOAD","Payload provider invalide.");return new JSONObject(raw);}
  private static String limited(String value,int max)throws Exception {if(value==null)return "";if(value.length()>max)throw new ProviderException("INVALID_PAYLOAD","Champ provider trop long.");return value;}
  private static void requireId(String id)throws Exception{if(id.isEmpty())throw new ProviderException("INVALID_LINK","Identifiant provider absent.");}
  private static String iso(String raw){return Instant.parse(raw).truncatedTo(ChronoUnit.SECONDS).toString();}
  private static int duration(JSONObject e)throws Exception{return Math.max(30,(int)Duration.between(Instant.parse(e.getString("startAtUtc")),Instant.parse(e.getString("endAtUtc"))).toMinutes());}
  private static String twitchFingerprint(JSONObject s)throws Exception{return base64(MessageDigest.getInstance("SHA-256").digest((s.optString("title")+'\u001f'+s.optString("start_time")+'\u001f'+s.optString("end_time")+'\u001f'+(s.optJSONObject("category")==null?"":s.optJSONObject("category").optString("id"))).getBytes(StandardCharsets.UTF_8)));}
  private static String random(int bytes){byte[] b=new byte[bytes];new SecureRandom().nextBytes(b);return base64(b);}
  private static String base64(byte[] value){return Base64.getUrlEncoder().withoutPadding().encodeToString(value);}
  private static String enc(String value)throws Exception{return URLEncoder.encode(value,StandardCharsets.UTF_8);}
  private static String form(Map<String,String> values)throws Exception{StringJoiner j=new StringJoiner("&");for(Map.Entry<String,String> e:values.entrySet())j.add(enc(e.getKey())+'='+enc(e.getValue()));return j.toString();}
  private static JSONObject ok(){return new JSONObject().put("ok",true);}
  private static String failure(String code,String message){return failure(code,message,null);}
  private static String failure(String code,String message,JSONObject current){JSONObject o=new JSONObject().put("ok",false).put("code",code).put("message",message);if(current!=null)o.put("current",current);return o.toString();}
  private static final class ProviderException extends Exception { final String code; final JSONObject current; ProviderException(String c,String m){this(c,m,null);} ProviderException(String c,String m,JSONObject v){super(m);code=c;current=v;} }
}
