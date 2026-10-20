package com.rastaaslan.streamdashboard.remote;

import android.app.Activity;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.android.gms.common.ConnectionResult;
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
  private static final String TWITCH_SCOPES = "channel:manage:schedule user:write:chat";
  private static final String GOOGLE_SCOPES = "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly";
  private static final String DEVICE_PENDING = "twitch_device_pending";
  private final Map<String, JSONObject> diagnostics = new java.util.concurrent.ConcurrentHashMap<>();
  private final GoogleAuthorizationFlow googleAuth, youtubeAuth;
  private final GoogleAuthorizationAdapter googleAdapter, youtubeAdapter;
  private final Activity activity;
  private final SecureCredentialStore credentials;

  ProviderBridge(Activity activity) {
    this.activity = activity; credentials = new SecureCredentialStore(activity);
    googleAdapter = new GoogleAuthorizationAdapter(activity, "Compte pour Google Agenda");
    youtubeAdapter = new GoogleAuthorizationAdapter(activity, "Compte pour YouTube");
    googleAuth = new GoogleAuthorizationFlow(googleAdapter, (connected, code) -> completeGoogleAccount("google", connected, code));
    youtubeAuth = new GoogleAuthorizationFlow(youtubeAdapter, (connected, code) -> completeGoogleAccount("youtube", connected, code));
    new Thread(() -> {
      restoreGoogleAccount("google");
      restoreGoogleAccount("youtube");
    }, "provider-restore").start();
  }
  private static final List<String> YOUTUBE_SCOPES = Collections.singletonList("https://www.googleapis.com/auth/youtube.readonly");
  private boolean googleFamily(String provider) { return provider.equals("google") || provider.equals("youtube"); }
  private GoogleAuthorizationFlow googleFlow(String provider) { return provider.equals("youtube") ? youtubeAuth : googleAuth; }
  private void restoreGoogleAccount(String provider) {
    try {
      String saved = credentials.get(provider + "_account_grant");
      if (!saved.isEmpty()) {
        JSONObject grant = new JSONObject(saved);
        googleFlow(provider).restore(provider.equals("youtube") ? YOUTUBE_SCOPES : GoogleAuthorizationFlow.SCOPES, grant.getString("account"));
      } else if (!credentials.get("google_grants").isEmpty()) {
        // Legacy grants do not identify an account. Require an explicit choice rather than guessing.
        notifyAuth(provider, false, "ACCOUNT_SELECTION_REQUIRED");
      }
    } catch (Exception error) {
      notifyAuth(provider, false, error instanceof GoogleAuthorizationFlow.AuthException ? ((GoogleAuthorizationFlow.AuthException)error).code : "AUTH");
    }
  }
  private void completeGoogleAccount(String provider, boolean connected, String code) {
    if (connected && code.isEmpty()) {
      try {
        GoogleAuthorizationFlow flow = googleFlow(provider);
        credentials.put(provider + "_account_grant", new JSONObject().put("account", flow.account()).put("scopes", String.join(" ", flow.scopes())).toString());
      } catch (Exception error) { code = "ACCOUNT_SAVE_FAILED"; }
    }
    notifyAuth(provider, connected, code);
  }

  private final java.util.concurrent.ExecutorService operations = new java.util.concurrent.ThreadPoolExecutor(1,1,0L,java.util.concurrent.TimeUnit.MILLISECONDS,new java.util.concurrent.ArrayBlockingQueue<Runnable>(32));
  void close(){googleAuth.logout();youtubeAuth.logout();operations.shutdown();}
  @JavascriptInterface public String requestAsync(String raw) {
    try {
      if(raw==null||raw.length()>14_100_000)throw new IllegalArgumentException();
      JSONObject input=new JSONObject(raw);String id=input.getString("id"),method=input.getString("method");
      Set<String> allowed=Set.of("twitchTest","googleTest","youtubeTest","youtubeStatus","twitchStatus","googleStatus","twitchAuthorize","googleAuthorize","youtubeAuthorize","twitchPoll","twitchLogout","googleLogout","youtubeLogout","twitchSearchCategories","twitchCreatePlanning","twitchUpdatePlanning","twitchDeletePlanning","googleCreatePlanning","googleUpdatePlanning","googleDeletePlanning","twitchReconcilePlanning","googleReconcilePlanning","googleCalendars","googleEvents","googleReadPlanning","twitchReadPlanning","deviceService","wizebotSendEdit");
      if(!id.matches("[a-zA-Z0-9_-]{8,100}")||!allowed.contains(method))throw new IllegalArgumentException();
      String payload=input.getJSONObject("payload").toString();
      operations.execute(() -> {
        String result;
        try { result=(String)ProviderBridge.class.getMethod(method,String.class).invoke(this,payload); }
        catch(Exception error){result=failure("NETWORK","Résultat non confirmé. Vérifiez ce service avant de recommencer.");}
        final String delivered=result;
        activity.runOnUiThread(() -> ((MainActivity)activity).dispatchProviderResult(id,delivered));
      });
      return ok().toString();
    }catch(Exception error){return failure("BUSY","Service occupé ou requête invalide. Aucune opération ajoutée.");}
  }
  @JavascriptInterface public String twitchTest(String ignored) { return testProvider("twitch"); }
  @JavascriptInterface public String googleTest(String ignored) { return testProvider("google"); }
  @JavascriptInterface public String twitchStatus(String ignored) { return status("twitch", BuildConfig.TWITCH_ANDROID_CLIENT_ID); }
  @JavascriptInterface public String googleStatus(String ignored) { return googleProviderStatus("google"); }
  @JavascriptInterface public String youtubeStatus(String ignored) { return googleProviderStatus("youtube"); }
  private String googleProviderStatus(String provider) {
    if (GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(activity) != ConnectionResult.SUCCESS)
      return "{\"ok\":true,\"configured\":false,\"connected\":false,\"code\":\"GOOGLE_PLAY_SERVICES\",\"capabilities\":[]}";
    return status(provider, BuildConfig.GOOGLE_ANDROID_CLIENT_ID);
  }
  @JavascriptInterface public String twitchAuthorize(String ignored) { return guarded(() -> startTwitchDevice()); }
  @JavascriptInterface public String googleAuthorize(String ignored) { return authorizeGoogle(false); }
  @JavascriptInterface public String youtubeAuthorize(String ignored) { return authorizeGoogle(true); }
  @JavascriptInterface public synchronized String twitchPoll(String ignored) { return guarded(() -> pollTwitchDevice()); }
  @JavascriptInterface public String youtubeTest(String ignored) { return testProvider("youtube"); }
  @JavascriptInterface public synchronized String twitchLogout(String ignored) { diagnostics.remove("twitch"); credentials.clear("twitch"); credentials.clear(DEVICE_PENDING); return ok().toString(); }
  @JavascriptInterface public String googleLogout(String ignored) { return logoutGoogleAccount("google"); }
  @JavascriptInterface public String youtubeLogout(String ignored) { return logoutGoogleAccount("youtube"); }
  private String logoutGoogleAccount(String provider) { return guarded(() -> {
    googleFlow(provider).logout(); diagnostics.remove(provider); credentials.clear(provider + "_account_grant");
    if (provider.equals("google")) { credentials.clear("google"); credentials.clear("google_grants"); }
    return ok();
  }); }
  @JavascriptInterface public String twitchSearchCategories(String raw) { return guarded(() -> twitchSearch(body(raw).optString("query"))); }
  @JavascriptInterface public String twitchCreatePlanning(String raw) { return guardedMutation("twitch", () -> twitchMutate("create", body(raw))); }
  @JavascriptInterface public String twitchUpdatePlanning(String raw) { return guardedMutation("twitch", () -> twitchMutate("update", body(raw))); }
  @JavascriptInterface public String twitchDeletePlanning(String raw) { return guardedMutation("twitch", () -> twitchMutate("delete", body(raw))); }
  @JavascriptInterface public String googleCreatePlanning(String raw) { return guardedMutation("google", () -> googleMutate("create", body(raw))); }
  @JavascriptInterface public String googleUpdatePlanning(String raw) { return guardedMutation("google", () -> googleMutate("update", body(raw))); }
  @JavascriptInterface public String googleDeletePlanning(String raw) { return guardedMutation("google", () -> googleMutate("delete", body(raw))); }

  @JavascriptInterface public String twitchReconcilePlanning(String raw) { return guarded(() -> reconcilePlanning("twitch", body(raw))); }
  @JavascriptInterface public String googleReconcilePlanning(String raw) { return guarded(() -> reconcilePlanning("google", body(raw))); }

  @JavascriptInterface public String googleCalendars(String raw) { return guarded(() -> googleCalendars()); }
  @JavascriptInterface public String googleEvents(String raw) { return guarded(() -> googleEvents(body(raw))); }
  @JavascriptInterface public String googleReadPlanning(String raw) { return guarded(() -> readPlanning("google", body(raw))); }
  @JavascriptInterface public String twitchReadPlanning(String raw) { return guarded(() -> readPlanning("twitch", body(raw))); }

  private JSONObject googleCalendars() throws Exception {
    JSONArray items = new JSONArray(); String cursor = ""; int pages = 0;
    do {
      JSONObject result = google("GET", "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250" + (cursor.isEmpty() ? "" : "&pageToken=" + enc(cursor)), null, null);
      JSONArray values = result.optJSONArray("items");
      if (values != null) for (int i=0; i<values.length(); i++) { JSONObject c=values.getJSONObject(i); items.put(new JSONObject().put("id",c.getString("id")).put("summary",c.optString("summary")).put("primary",c.optBoolean("primary")).put("accessRole",c.optString("accessRole")).put("writable",c.optString("accessRole").equals("owner")||c.optString("accessRole").equals("writer"))); }
      cursor=result.optString("nextPageToken"); if (++pages>20) throw new ProviderException("LIMIT", "Trop de calendriers pour une lecture complète.");
    } while (!cursor.isEmpty());
    return ok().put("items",items);
  }
  private JSONObject googleEvents(JSONObject input) throws Exception {
    String calendar=limited(input.optString("calendarId","primary"),200);
    JSONObject selected=google("GET","https://www.googleapis.com/calendar/v3/users/me/calendarList/"+enc(calendar),null,null);
    calendar=selected.getString("id"); JSONArray items=new JSONArray(); String cursor=""; int pages=0;
    do {
      JSONObject result=google("GET","https://www.googleapis.com/calendar/v3/calendars/"+enc(calendar)+"/events?maxResults=250&singleEvents=false&showDeleted=false"+(cursor.isEmpty()?"":"&pageToken="+enc(cursor)),null,null);
      JSONArray values=result.optJSONArray("items");
      if(values!=null)for(int i=0;i<values.length();i++){JSONObject value=values.getJSONObject(i);if(!value.optString("status").equals("cancelled")&&value.has("start")&&value.has("end"))items.put(googleRemote(value).put("remoteId",value.getString("id")).put("revision",value.optString("etag")));}
      cursor=result.optString("nextPageToken");if(++pages>40)throw new ProviderException("LIMIT","Import trop volumineux. Aucun résultat partiel n’a été enregistré.");
    }while(!cursor.isEmpty());
    return ok().put("items",items).put("calendarId",calendar);
  }
  static JSONObject googleRemote(JSONObject value) throws Exception {
    JSONObject start=value.getJSONObject("start"),end=value.getJSONObject("end"); boolean allDay=start.has("date");
    return new JSONObject().put("title",value.optString("summary","Sans titre")).put("description",value.optString("description"))
      .put("startAtUtc",allDay?start.getString("date")+"T00:00:00.000Z":start.getString("dateTime"))
      .put("endAtUtc",allDay?end.getString("date")+"T00:00:00.000Z":end.getString("dateTime"))
      .put("allDay",allDay).put("category","personal").put("recurrenceLines",value.optJSONArray("recurrence") == null ? new JSONArray() : value.getJSONArray("recurrence"))
      .put("recurrenceTimeZone",start.optString("timeZone"));
  }
  private JSONObject readPlanning(String provider, JSONObject input) throws Exception {
    JSONObject link=input.getJSONObject("link");String id=limited(link.optString("remoteId"),200);requireId(id);
    try {
      if(provider.equals("google")){
        String calendar=limited(link.optString("calendarId","primary"),200);
        JSONObject value=google("GET","https://www.googleapis.com/calendar/v3/calendars/"+enc(calendar)+"/events/"+enc(id),null,null);
        if(value.optString("status").equals("cancelled"))return ok().put("deleted",true);
        return ok().put("revision",value.optString("etag")).put("remote",googleRemote(value));
      }
      JSONObject response=twitch("GET","https://api.twitch.tv/helix/schedule?broadcaster_id="+enc(twitchUserId())+"&id="+enc(id),null);
      JSONArray values=response.getJSONObject("data").optJSONArray("segments");
      if(values==null||values.length()==0)return ok().put("deleted",true);
      JSONObject value=values.getJSONObject(0),category=value.optJSONObject("category");
      return ok().put("fingerprint",twitchFingerprint(value)).put("recurring",value.optBoolean("is_recurring")).put("remote",new JSONObject().put("title",value.optString("title")).put("startAtUtc",value.getString("start_time")).put("endAtUtc",value.getString("end_time")).put("twitchCategoryId",category==null?"":category.optString("id")).put("twitchCategoryName",category==null?"":category.optString("name")));
    } catch(ProviderException e){if(isAbsentPlanningDelete(provider,e.code))return ok().put("deleted",true);throw e;}
  }

  @JavascriptInterface public String deviceService(String raw) { return guarded(() -> {
    if(raw==null||raw.length()>14_000_000)throw new ProviderException("INVALID_PAYLOAD","Données trop volumineuses.");
    JSONObject input=new JSONObject(raw);String provider=input.optString("provider"),operation=input.optString("operation");
    if(!Arrays.asList("discord","streamlabs","wizebot").contains(provider))throw new ProviderException("INVALID_PAYLOAD","Service inconnu.");
    String key="service_"+provider;
    if(operation.equals("configure")) {
      JSONObject value=input.getJSONObject("value");String token=limited(value.optString("token"),4096).trim();
      if(token.isEmpty()||token.contains("\n")||token.contains("\r"))throw new ProviderException("INVALID_PAYLOAD","Jeton invalide.");
      credentials.put(key,new JSONObject().put("token",token).toString());return ok().put("configured",true);
    }
    if(provider.equals("wizebot")&&operation.equals("catalog"))return publicWizebot();
    String saved=credentials.get(key);if(saved.isEmpty()){if(operation.equals("status"))return ok().put("connected",false).put("configured",false);throw new ProviderException("REAUTH_REQUIRED","Connectez ce service sur cet appareil.");}
    String token=new JSONObject(saved).getString("token");
    if(provider.equals("discord")&&operation.equals("status")) {
      JSONObject user=request("GET","https://discord.com/api/v10/users/@me",null,null,Map.of("Authorization","Bot "+token));
      return ok().put("connected",true).put("configured",true).put("account",user.optString("username"));
    }
    if(provider.equals("discord")&&operation.equals("publish"))return discordPlanning(input,token);
    if(operation.equals("status"))return ok().put("configured",true);
    throw new ProviderException("INVALID_PAYLOAD","Opération de service inconnue.");
  }); }
  @JavascriptInterface public synchronized String wizebotSendEdit(String raw) { return guarded(() -> {
    JSONObject input=body(raw);String id=input.optString("id"),commandId=input.optString("commandId"),response=input.optString("response").trim();
    String message="!cmd edit "+commandId+" "+response;
    if(!id.matches("[a-zA-Z0-9_-]{8,100}")||!commandId.matches("[0-9]{1,30}")||response.isEmpty()||message.length()>500||response.matches("(?s).*[\\x00-\\x1f\\x7f].*")||response.contains("###")||response.toLowerCase(Locale.ROOT).matches("(?s).*\\$cmd\\s*\\(.*"))throw new ProviderException("INVALID_PAYLOAD","Réponse WizeBot invalide.");
    JSONObject test=new JSONObject(testProvider("twitch"));if(!test.optBoolean("tested")||!test.optJSONArray("capabilities").toString().contains("chat"))throw new ProviderException("REAUTH_REQUIRED","Réautorisez Twitch pour modifier WizeBot depuis cet appareil.");
    JSONObject user=twitch("GET","https://api.twitch.tv/helix/users",null).getJSONArray("data").getJSONObject(0);
    if(!input.optString("channel").equals(user.getString("login")))throw new ProviderException("INVALID_LINK","La chaîne Twitch a changé.");
    String signature=base64(MessageDigest.getInstance("SHA-256").digest((user.getString("id")+"\n"+message).getBytes(StandardCharsets.UTF_8))),key="wizebot_edit_"+id,old=credentials.get(key);
    if(!old.isEmpty()){JSONObject previous=new JSONObject(old);if(!signature.equals(previous.optString("signature")))throw new ProviderException("INVALID_PAYLOAD","Identifiant réutilisé.");return previous;}
    JSONObject receipt=ok().put("signature",signature).put("status","uncertain").put("message","Envoi Twitch non confirmé. Vérifiez WizeBot avant de recommencer.");
    credentials.put(key,receipt.toString());
    JSONObject result=twitch("POST","https://api.twitch.tv/helix/chat/messages",new JSONObject().put("broadcaster_id",user.getString("id")).put("sender_id",user.getString("id")).put("message",message).toString()).getJSONArray("data").getJSONObject(0);
    if(result.optBoolean("is_sent")&&!result.optString("message_id").isEmpty())receipt.put("status","sent").put("messageId",result.getString("message_id"));
    else receipt.put("status","failed").put("message","Message refusé par Twitch.");
    credentials.put(key,receipt.toString());return receipt;
  }); }
  private JSONObject publicWizebot() throws Exception {
    String channel=twitch("GET","https://api.twitch.tv/helix/users",null).getJSONArray("data").getJSONObject(0).getString("login").toLowerCase(Locale.ROOT);
    if(!channel.matches("[a-z0-9_]{1,25}"))throw new ProviderException("ACCOUNT","Chaîne Twitch invalide.");
    String base="https://"+channel+".streaming.lv/";
    Map<String,String> cookies=new HashMap<>();
    publicPage(base+"?commands",null,cookies);
    String page=publicPage(base+"ajax.php","p=commands&request%5Bcommands%5D=",cookies);
    String resource=wizebotResource(page);
    return ok().put("channel",channel).put("canSend",new JSONObject(testProvider("twitch")).optJSONArray("capabilities").toString().contains("chat")).put("catalog",new JSONObject(publicPage(base+resource,null,cookies)));
  }
  static String wizebotResource(String page)throws Exception {
    java.util.regex.Matcher match=java.util.regex.Pattern.compile("ajax:\\s*['\"](ajax/list/commands_list\\.php\\?t=[a-f0-9]{32,128})['\"]",java.util.regex.Pattern.CASE_INSENSITIVE).matcher(page);
    if(!match.find())throw new ProviderException("FORMAT","Activez la liste publique des commandes dans WizeBot, ou vérifiez son format.");
    return match.group(1);
  }
  private String publicPage(String address,String form,Map<String,String> cookies) throws Exception {
    HttpURLConnection connection=(HttpURLConnection)new URL(address).openConnection();
    connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(10000);connection.setReadTimeout(15000);
    connection.setRequestProperty("Accept","*/*");connection.setRequestProperty("Cache-Control","no-cache");
    if(!cookies.isEmpty())connection.setRequestProperty("Cookie",String.join("; ",cookies.values()));
    try {
      if(form!=null){connection.setRequestMethod("POST");connection.setDoOutput(true);connection.setRequestProperty("Content-Type","application/x-www-form-urlencoded");try(OutputStream out=connection.getOutputStream()){out.write(form.getBytes(StandardCharsets.UTF_8));}}
      int status=connection.getResponseCode();if(status<200||status>=300)throw new ProviderException("HTTP_"+status,"Catalogue public WizeBot indisponible.");
      for(Map.Entry<String,List<String>> entry:connection.getHeaderFields().entrySet())if(entry.getKey()!=null&&entry.getKey().equalsIgnoreCase("Set-Cookie"))for(String cookie:entry.getValue()){String pair=cookie.split(";",2)[0];cookies.put(pair.split("=",2)[0],pair);}
      try(InputStream in=connection.getInputStream()){return readStream(in);}
    }finally{connection.disconnect();}
  }
  private JSONObject discordPlanning(JSONObject input,String token) throws Exception {
    String channel=input.optString("channelId");if(!channel.matches("[0-9]{1,24}"))throw new ProviderException("INVALID_PAYLOAD","Choisissez un salon Discord.");
    byte[] image=Base64.getDecoder().decode(input.getString("imageBase64"));
    if(image.length>10_000_000||image.length<8||image[0]!=(byte)137||image[1]!=80||image[2]!=78||image[3]!=71)throw new ProviderException("INVALID_PAYLOAD","Image PNG requise (10 Mo maximum).");
    String boundary="StreamDashboard"+UUID.randomUUID().toString().replace("-","");
    JSONObject payload=new JSONObject().put("content",limited(input.optString("defaultMessage"),2000)).put("allowed_mentions",new JSONObject().put("parse",new JSONArray()));
    ByteArrayOutputStream bytes=new ByteArrayOutputStream();
    bytes.write(("--"+boundary+"\r\nContent-Disposition: form-data; name=\"payload_json\"\r\nContent-Type: application/json\r\n\r\n"+payload+"\r\n--"+boundary+"\r\nContent-Disposition: form-data; name=\"files[0]\"; filename=\"planning.png\"\r\nContent-Type: image/png\r\n\r\n").getBytes(StandardCharsets.UTF_8));
    bytes.write(image);bytes.write(("\r\n--"+boundary+"--\r\n").getBytes(StandardCharsets.UTF_8));
    HttpURLConnection connection=(HttpURLConnection)new URL("https://discord.com/api/v10/channels/"+channel+"/messages").openConnection();
    connection.setInstanceFollowRedirects(false);connection.setRequestMethod("POST");connection.setConnectTimeout(10000);connection.setReadTimeout(15000);connection.setDoOutput(true);
    connection.setRequestProperty("Authorization","Bot "+token);connection.setRequestProperty("Content-Type","multipart/form-data; boundary="+boundary);
    try {
      try(OutputStream out=connection.getOutputStream()){bytes.writeTo(out);}
      int status=connection.getResponseCode();if(status<200||status>=300)throw new ProviderException("HTTP_"+status,"Discord n’a pas confirmé l’envoi. Vérifiez le salon avant de recommencer.");
      JSONObject result;try(InputStream in=connection.getInputStream()){result=new JSONObject(readStream(in));}
      if(result.optString("id").isEmpty())throw new ProviderException("UNCERTAIN","Résultat Discord incomplet : vérifiez le salon.");
      return ok().put("messageId",result.getString("id")).put("channelName",channel);
    }finally{connection.disconnect();}
  }

  // Old custom-scheme code exchanges are no longer accepted; Twitch uses DCF.
  void acceptOAuthCallback(Uri uri) { }

  private void notifyAuth(String provider, boolean connected) { notifyAuth(provider, connected, connected ? "" : "AUTH"); }
  private void notifyAuth(String provider, boolean connected, String code) { diagnostics.remove(provider); if (!code.isEmpty()) { try { diagnostics.put(provider, ok().put("code", code).put("authorizationError", true)); } catch (JSONException ignored) { } } activity.runOnUiThread(() -> ((MainActivity)activity).dispatchProviderAuth(provider, connected)); }
  private String status(String provider, String clientId) {
    try {
      boolean configured = googleFamily(provider) || !clientId.isEmpty(), connected = googleFamily(provider) ? googleFlow(provider).connected() : !credentials.get(provider).isEmpty();
      JSONObject result = diagnostics.containsKey(provider) ? new JSONObject(diagnostics.get(provider).toString()) : ok();
      JSONArray capabilities = new JSONArray();
      if (configured) capabilities.put("connect");
      if (connected) { capabilities.put("disconnect"); capabilities.put("test"); }
      boolean fresh = connected && System.currentTimeMillis() - result.optLong("testedAt", 0) < 300_000;
      if (!fresh) result.put("tested", false);
      if (fresh && result.optBoolean("tested") && result.optJSONArray("capabilities") != null) {
        JSONArray previous = result.getJSONArray("capabilities");
        for (int i = 0; i < previous.length(); i++) {
          String cap = previous.getString(i);
          if (cap.equals("calendar") || cap.equals("schedule") || cap.equals("categories") || cap.equals("metadata") || cap.equals("chat") || cap.equals("channel")) capabilities.put(cap);
        }
      }
      if (provider.equals("twitch")) {
        String raw = credentials.get(DEVICE_PENDING);
        if (!raw.isEmpty()) { JSONObject pending = new JSONObject(raw); if (pending.optLong("expiresAt") > System.currentTimeMillis()) result.put("pending", publicDevice(pending)); }
      }
      String lastSync = credentials.get(provider + "_last_sync");
      result.put("lastSync", lastSync.isEmpty() ? 0 : Long.parseLong(lastSync));
      if (googleFamily(provider)) {
        GoogleAuthorizationFlow flow = googleFlow(provider);
        result.put("account", flow.account()).put("authorizing", flow.authorizing());
        if (provider.equals("google")) result.put("calendarAuthorized", flow.connected());
        else result.put("youtubeAuthorized", flow.connected());
      }
      return result.put("ok", true).put("configured", configured).put("connected", connected).put("capabilities", capabilities).toString();
    } catch (Exception e) { return failure("INTERNAL", "État indisponible."); }
  }
  private synchronized String testProvider(String provider) {
    String clientId = provider.equals("twitch") ? BuildConfig.TWITCH_ANDROID_CLIENT_ID : BuildConfig.GOOGLE_ANDROID_CLIENT_ID;
    JSONObject result = ok();
    try {
      if (provider.equals("twitch") && clientId.isEmpty()) throw new ProviderException("NOT_CONFIGURED", "Configuration requise.");
      if (googleFamily(provider) ? !googleFlow(provider).connected() : credentials.get(provider).isEmpty()) throw new ProviderException("REAUTH_REQUIRED", "Connexion requise.");
      JSONObject session = token(provider);
      JSONArray granted = new JSONArray();
      JSONArray capabilities = new JSONArray();
      if (provider.equals("twitch")) {
        JSONObject validation = request("GET", "https://id.twitch.tv/oauth2/validate", null, null, Map.of("Authorization", "OAuth " + session.getString("access_token")));
        JSONArray scopes = validation.optJSONArray("scopes");
        if (scopes != null) for (int i = 0; i < scopes.length(); i++) {
          String scope = scopes.getString(i);
          if (Arrays.asList(TWITCH_SCOPES.split(" ")).contains(scope)) granted.put(scope);
        }
        result.put("scopes", granted);

        JSONObject user = twitch("GET", "https://api.twitch.tv/helix/users", null).getJSONArray("data").getJSONObject(0);
        capabilities.put("categories");
        result.put("account", user.optString("display_name")).put("channelId", user.getString("id"));
        if (granted.toString().contains("channel:manage:broadcast")) capabilities.put("metadata");
        if (granted.toString().contains("user:write:chat")) capabilities.put("chat");
        if (!user.optString("broadcaster_type").isEmpty() && granted.toString().contains("channel:manage:schedule")) capabilities.put("schedule");
      } else if (provider.equals("youtube")) {
        JSONObject response = googleRequest("youtube", "GET", "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", null, null);
        JSONArray items = response.optJSONArray("items");
        if (items == null || items.length() == 0) throw new ProviderException("ACCOUNT", "Aucune chaîne YouTube sur ce compte.");
        JSONObject channel = items.getJSONObject(0);
        result.put("channelId", channel.getString("id")).put("channelName", channel.getJSONObject("snippet").getString("title"));
        capabilities.put("channel");
      } else {
        // Token scope is returned by Google OAuth; never return the token itself.
        for (String scope : session.optString("scope").split(" ")) {
          if (Arrays.asList(GOOGLE_SCOPES.split(" ")).contains(scope)) granted.put(scope);
        }
        result.put("scopes", granted);
        if (!granted.toString().contains("calendar.events") || !granted.toString().contains("calendar.readonly")) throw new ProviderException("SCOPES", "Permissions requises.");
        JSONObject calendar = google("GET", "https://www.googleapis.com/calendar/v3/users/me/calendarList/primary", null, null);
        String role = calendar.optString("accessRole");
        if (!role.equals("owner") && !role.equals("writer")) throw new ProviderException("CALENDAR", "Calendrier non accessible en écriture.");
        result.put("calendar", calendar.getString("id")); capabilities.put("calendar");
      }
      result.put("tested", true).put("testedAt", System.currentTimeMillis()).put("capabilities", capabilities);
    } catch (ProviderException e) {
      try { result.put("code", e.code).put("requiresReauth", e.code.equals("REAUTH_REQUIRED") || e.code.equals("SCOPES") || e.code.equals("HTTP_403")); } catch (JSONException ignored) { }
    } catch (Exception e) { try { result.put("code", e instanceof ProviderException ? ((ProviderException)e).code : "NETWORK"); } catch (JSONException ignored) { } }
    try { if (diagnostics.containsKey(provider)) result.put("lastSync", diagnostics.get(provider).optLong("lastSync", 0)); } catch (JSONException ignored) { }
    diagnostics.put(provider, result);
    return status(provider, clientId);
  }
  private synchronized String authorizeGoogle(boolean youtube) {
    if (BuildConfig.PREVIEW_MODE) return failure("NOT_CONFIGURED", "Autorisation désactivée dans la prévisualisation.");
    if (GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(activity) != ConnectionResult.SUCCESS)
      return failure("GOOGLE_PLAY_SERVICES", "Services Google Play indisponibles.");
    if (googleAuth.authorizing() || youtubeAuth.authorizing()) return failure("BUSY", "Une autorisation Google est déjà en cours. Terminez-la avant de recommencer.");
    String provider = youtube ? "youtube" : "google";
    diagnostics.remove(provider);
    googleFlow(provider).authorizeScopes(youtube ? YOUTUBE_SCOPES : GoogleAuthorizationFlow.SCOPES);
    try { return ok().put("nativeAuthorization", true).toString(); }
    catch (JSONException error) { return failure("INTERNAL", "État indisponible."); }
  }
  void acceptGoogleResult(int requestCode, int resultCode, Intent data) {
    if (googleAdapter.acceptAccountResult(requestCode, resultCode, data) || youtubeAdapter.acceptAccountResult(requestCode, resultCode, data)) return;
    googleAuth.acceptGoogleResult(requestCode, resultCode == Activity.RESULT_OK, data);
    youtubeAuth.acceptGoogleResult(requestCode, resultCode == Activity.RESULT_OK, data);
  }
  private synchronized JSONObject startTwitchDevice() throws Exception {
    if (BuildConfig.TWITCH_ANDROID_CLIENT_ID.isEmpty()) throw new ProviderException("NOT_CONFIGURED", "Identifiant public Twitch absent de cette distribution.");
    String raw = credentials.get(DEVICE_PENDING);
    if (!raw.isEmpty()) { JSONObject previous = new JSONObject(raw); if (previous.optLong("expiresAt") > System.currentTimeMillis()) return publicDevice(previous); }
    JSONObject value = request("POST", "https://id.twitch.tv/oauth2/device", null, form(Map.of("client_id", BuildConfig.TWITCH_ANDROID_CLIENT_ID, "scopes", TWITCH_SCOPES)), null);
    long now = System.currentTimeMillis();
    value.put("expiresAt", now + Math.max(1, value.optLong("expires_in", 600)) * 1000);
    value.put("interval", Math.max(5, value.optLong("interval", 5))).put("nextPoll", now + 5000);
    credentials.put(DEVICE_PENDING, value.toString());
    return publicDevice(value);
  }
  private JSONObject publicDevice(JSONObject pending) throws Exception {
    // Device code and provider tokens stay in encrypted native storage.
    return ok().put("user_code", pending.getString("user_code")).put("verification_uri", pending.getString("verification_uri"))
      .put("expiresAt", pending.optLong("expiresAt")).put("interval", pending.optLong("interval", 5));
  }
  private synchronized JSONObject pollTwitchDevice() throws Exception {
    String raw = credentials.get(DEVICE_PENDING);
    if (raw.isEmpty()) return ok().put("pending", false);
    JSONObject pending = new JSONObject(raw); long now = System.currentTimeMillis();
    if (now >= pending.optLong("expiresAt")) { credentials.clear(DEVICE_PENDING); throw new ProviderException("EXPIRED", "Code expiré. Relancez la connexion Twitch."); }
    if (now < pending.optLong("nextPoll")) return ok().put("pending", true);
    pending.put("nextPoll", now + pending.optLong("interval", 5) * 1000); credentials.put(DEVICE_PENDING, pending.toString());
    try {
      JSONObject token = request("POST", "https://id.twitch.tv/oauth2/token", null, form(Map.of("client_id", BuildConfig.TWITCH_ANDROID_CLIENT_ID,
        "scopes", TWITCH_SCOPES, "device_code", pending.getString("device_code"), "grant_type", "urn:ietf:params:oauth:grant-type:device_code")), null);
      if (token.optString("access_token").isEmpty()) throw new ProviderException("AUTH", "Autorisation Twitch incomplète.");
      token.put("obtained_at", now); credentials.put("twitch", token.toString()); credentials.clear(DEVICE_PENDING); notifyAuth("twitch", true);
      return ok().put("connected", true).put("pending", false);
    } catch (ProviderException error) {
      if (error.getMessage().equals("authorization_pending")) return ok().put("pending", true);
      if (error.getMessage().equals("slow_down") || error.code.equals("HTTP_429")) {
        long interval = pending.optLong("interval", 5) + 5;
        pending.put("interval", interval).put("nextPoll", now + interval * 1000); credentials.put(DEVICE_PENDING, pending.toString());
        return ok().put("pending", true);
      }
      if (error.code.equals("HTTP_400") || error.code.equals("HTTP_403")) credentials.clear(DEVICE_PENDING);
      throw error;
    }
  }
  private synchronized JSONObject token(String provider) throws Exception {
    if (googleFamily(provider)) {
      GoogleAuthorizationFlow flow = googleFlow(provider);
      if (!flow.connected()) throw new ProviderException("REAUTH_REQUIRED", "Reconnecter le compte de ce service.");
      try {
        GoogleAuthorizationFlow.Grant grant = flow.refresh();
        return new JSONObject().put("access_token", grant.token).put("scope", String.join(" ", grant.scopes));
      } catch (GoogleAuthorizationFlow.AuthException error) {
        throw new ProviderException(error.code, "Réautoriser Google avec les permissions du service demandé.");
      }
    }
    JSONObject token = new JSONObject(credentials.get(provider));
    long expires = token.optLong("expires_in", 3600) * 1000L, obtained = token.optLong("obtained_at");
    if (System.currentTimeMillis() < obtained + expires - 60_000) return token;
    String refresh = token.optString("refresh_token"); if (refresh.isEmpty()) throw new ProviderException("REAUTH_REQUIRED", "Reconnectez le provider autonome.");
    String clientId = provider.equals("twitch") ? BuildConfig.TWITCH_ANDROID_CLIENT_ID : BuildConfig.GOOGLE_ANDROID_CLIENT_ID;
    String endpoint = "https://id.twitch.tv/oauth2/token";
    JSONObject fresh;
    try { fresh = request("POST", endpoint, null, form(Map.of("client_id",clientId,"refresh_token",refresh,"grant_type","refresh_token")), null); }
    catch (ProviderException e) { if (e.code.equals("HTTP_400") || e.code.equals("REAUTH_REQUIRED")) throw new ProviderException("REAUTH_REQUIRED", "Réautoriser ce compte."); throw e; }
    if (!fresh.has("scope")) fresh.put("scope", token.optJSONArray("scope"));
    if (!fresh.has("refresh_token")) fresh.put("refresh_token", refresh); fresh.put("obtained_at", System.currentTimeMillis()); credentials.put(provider, fresh.toString()); return fresh;
  }
  private void requirePublication(String provider) throws Exception {
    JSONObject result = new JSONObject(testProvider(provider));
    if (!result.optBoolean("tested") || !result.optJSONArray("capabilities").toString().contains(provider.equals("twitch") ? "schedule" : "calendar")) throw new ProviderException(result.optString("code", "SCOPES"), "Tester les permissions de ce compte avant publication.");
  }
  private JSONObject recordSync(String provider, JSONObject value) throws Exception {
    JSONObject result = diagnostics.get(provider);
    long now = System.currentTimeMillis();
    credentials.put(provider + "_last_sync", Long.toString(now));
    if (result != null) result.put("lastSync", now);
    return value;
  }
  private JSONObject twitchSearch(String query) throws Exception {
    query = limited(query, 80); if (query.trim().length() < 2) return ok().put("items", new JSONArray());
    JSONObject value = twitch("GET", "https://api.twitch.tv/helix/search/categories?first=20&query=" + enc(query), null);
    return ok().put("items", value.getJSONArray("data"));
  }
  // Recovery is read-only: no match (including eventual-consistency delays) or
  // multiple matches keeps the create uncertain instead of issuing another POST.
  private JSONObject reconcilePlanning(String provider, JSONObject input) throws Exception {
    requirePublication(provider);
    JSONObject event = input.getJSONObject("event"), link = input.optJSONObject("link");
    if (link == null) link = new JSONObject();
    boolean isGoogle = provider.equals("google");
    if(!isGoogle&&event.has("localId")) {
      String receipt=credentials.get(twitchReceiptKey(event));
      if(receipt.isEmpty())throw new ProviderException("CREATE_UNCERTAIN","Aucun reçu Twitch confirmé. Vérifiez le planning Twitch avant de résoudre cette publication.");
      JSONObject confirmed=new JSONObject(receipt);
      if(!confirmed.getString("accountId").equals(twitchUserId()))throw new ProviderException("INVALID_LINK","Reconnectez le compte Twitch d’origine.");
      return confirmed;
    }
    if(!isGoogle&&!link.optString("accountId").isEmpty()&&!link.optString("accountId").equals(twitchUserId()))throw new ProviderException("INVALID_LINK","Reconnectez la chaîne Twitch propriétaire avant réconciliation.");
    String calendar = limited(link.optString("calendarId", "primary"), 200);
    String base = isGoogle
      ? "https://www.googleapis.com/calendar/v3/calendars/" + enc(calendar) + "/events?showDeleted=false&privateExtendedProperty=" + enc((event.has("localId") ? "streamDashboardId=" + event.getString("localId") : "streamDashboardEventId=" + event.getString("id")))
      : "https://api.twitch.tv/helix/schedule?first=25&broadcaster_id=" + enc(twitchUserId());
    JSONObject found = null;
    String cursor = "";
    Set<String> pages = new HashSet<>();
    do {
      String url = base + (cursor.isEmpty() ? "" : (isGoogle ? "&pageToken=" : "&after=") + enc(cursor));
      JSONObject response = isGoogle ? google("GET", url, null, null) : twitch("GET", url, null);
      JSONArray items = isGoogle ? response.optJSONArray("items") : response.getJSONObject("data").optJSONArray("segments");
      if (items != null) for (int index = 0; index < items.length(); index++) {
        JSONObject candidate = items.getJSONObject(index);
        boolean match;
        if (isGoogle) {
          JSONObject extended = candidate.optJSONObject("extendedProperties");
          JSONObject properties = extended == null ? null : extended.optJSONObject("private");
          match = !candidate.optString("status").equals("cancelled") && properties != null
            && (event.has("localId") ? event.getString("localId").equals(properties.optString("streamDashboardId")) : event.getString("id").equals(properties.optString("streamDashboardEventId")))
            && (event.optJSONObject("projection") == null || event.getJSONObject("projection").optString("creationId").equals(properties.optString("streamDashboardCreationId")));
        } else {
          JSONObject category = candidate.optJSONObject("category");
          match = event.optString("title").equals(candidate.optString("title"))
            && iso(event.getString("startAtUtc")).equals(iso(candidate.getString("start_time")))
            && iso(event.getString("endAtUtc")).equals(iso(candidate.getString("end_time")))
            && event.optString("twitchCategoryId").equals(category == null ? "" : category.optString("id"));
        }
        if (match) {
          if (found != null && !found.getString("id").equals(candidate.getString("id")))
            throw new ProviderException("CREATE_UNCERTAIN", "Plusieurs publications correspondent. Réconciliation manuelle requise.");
          found = candidate;
        }
      }
      JSONObject pagination = response.optJSONObject("pagination");
      cursor = isGoogle ? response.optString("nextPageToken") : pagination == null ? "" : pagination.optString("cursor");
      if (!cursor.isEmpty() && (!pages.add(cursor) || pages.size() > 100))
        throw new ProviderException("CREATE_UNCERTAIN", "Réconciliation incomplète.");
    } while (!cursor.isEmpty());
    if (found == null) throw new ProviderException("CREATE_UNCERTAIN", "Publication non retrouvée. La création reste incertaine.");
    JSONObject result = ok().put("remoteId", found.getString("id")).put("remoteSnapshot", found);
    return isGoogle ? result.put("calendarId", calendar).put("revision", found.optString("etag"))
      : result.put("fingerprint", twitchFingerprint(found));
  }

  private JSONObject twitchMutate(String action, JSONObject input) throws Exception {
    requirePublication("twitch");
    JSONObject event = input.getJSONObject("event"), link = input.optJSONObject("link"); if (link == null) link = new JSONObject();
    String broadcaster = twitchUserId(), remoteId = limited(link.optString("remoteId"), 120);
    if(!link.optString("accountId").isEmpty()&&!link.optString("accountId").equals(broadcaster))throw new ProviderException("INVALID_LINK","Reconnectez la chaîne Twitch propriétaire de cet événement.");
    if (action.equals("delete")) {
      requireId(remoteId);
      JSONObject current=readPlanning("twitch",input);
      if(current.optBoolean("deleted"))return ok().put("remoteId",remoteId);
      if(!link.optString("fingerprint").isEmpty()&&!link.optString("fingerprint").equals(current.optString("fingerprint")))throw new ProviderException("CONFLICT","Le planning Twitch a changé avant la suppression.");
      try { twitch("DELETE", "https://api.twitch.tv/helix/schedule/segment?broadcaster_id="+enc(broadcaster)+"&id="+enc(remoteId), null); }
      catch (ProviderException error) { if (!isAbsentPlanningDelete("twitch", error.code)) throw error; }
      return ok().put("remoteId", remoteId);
    }
    JSONObject currentSegment = null;
    if (action.equals("update")) {
      requireId(remoteId); JSONObject current = twitch("GET", "https://api.twitch.tv/helix/schedule?broadcaster_id="+enc(broadcaster)+"&id="+enc(remoteId), null);
      currentSegment = current.getJSONObject("data").getJSONArray("segments").getJSONObject(0);
      String currentFingerprint = twitchFingerprint(currentSegment);
      if (!link.optString("fingerprint").isEmpty() && !link.optString("fingerprint").equals(currentFingerprint)) throw new ProviderException("CONFLICT", "Le planning Twitch a changé ailleurs.", current);
    }
    JSONObject payload = twitchSchedulePayload(event, currentSegment);
    if (currentSegment != null && payload.toString().equals("{}")) return ok().put("remoteId", remoteId).put("fingerprint", twitchFingerprint(currentSegment)).put("remoteSnapshot", currentSegment);
    String url = "https://api.twitch.tv/helix/schedule/segment?broadcaster_id="+enc(broadcaster) + (action.equals("update") ? "&id="+enc(remoteId) : "");
    if(action.equals("create")&&event.has("localId"))credentials.clear(twitchReceiptKey(event));
    JSONObject response = twitch(action.equals("create") ? "POST" : "PATCH", url, payload.toString());
    JSONObject segment = response.getJSONObject("data").getJSONArray("segments").getJSONObject(0);
    JSONObject confirmed=ok().put("remoteId", segment.getString("id")).put("fingerprint", twitchFingerprint(segment)).put("remoteSnapshot", segment).put("accountId",broadcaster);
    if(action.equals("create")&&event.has("localId"))credentials.put(twitchReceiptKey(event),confirmed.toString());
    return confirmed;
  }
  private static String twitchReceiptKey(JSONObject event)throws Exception {
    return "planning_twitch_"+base64(MessageDigest.getInstance("SHA-256").digest(new JSONArray().put(event.optString("localId",event.getString("id"))).put(event.getString("id")).put(event.getString("startAtUtc")).put(event.getString("endAtUtc")).toString().getBytes(StandardCharsets.UTF_8)));
  }
  static JSONObject twitchSchedulePayload(JSONObject event, JSONObject currentSegment) throws Exception {
    JSONObject payload = new JSONObject();
    String title = limited(event.optString("title"), 140), category = limited(event.optString("twitchCategoryId"), 40), start = iso(event.getString("startAtUtc"));
    if (currentSegment == null || !title.equals(currentSegment.optString("title"))) payload.put("title", title);
    JSONObject currentCategory = currentSegment == null ? null : currentSegment.optJSONObject("category");
    if (!category.isEmpty() && (currentCategory == null || !category.equals(currentCategory.optString("id")))) payload.put("category_id", category);
    if (currentSegment == null || (!currentSegment.optBoolean("is_recurring") && !start.equals(iso(currentSegment.getString("start_time"))))) payload.put("start_time", start).put("timezone", event.optJSONObject("recurrence") == null ? "UTC" : event.getJSONObject("recurrence").optString("timeZone","UTC"));
    if (currentSegment == null) payload.put("is_recurring", event.optJSONObject("recurrence") != null || event.optBoolean("twitchRecurring"));
    int minutes = duration(event);
    if (currentSegment == null || minutes != Duration.between(Instant.parse(currentSegment.getString("start_time")), Instant.parse(currentSegment.getString("end_time"))).toMinutes()) payload.put("duration", String.valueOf(minutes));
    return payload;
  }
  private JSONObject googleMutate(String action, JSONObject input) throws Exception {
    requirePublication("google");
    JSONObject event=input.getJSONObject("event"), link=input.optJSONObject("link"); if(link==null)link=new JSONObject();
    String calendar=limited(link.optString("calendarId","primary"),200), remoteId=limited(link.optString("remoteId"),200);
    String base="https://www.googleapis.com/calendar/v3/calendars/"+enc(calendar)+"/events";
    if(!action.equals("create") && event.optJSONObject("projection") != null) {
      JSONObject current=google("GET",base+"/"+enc(remoteId),null,null);
      JSONObject ext=current.optJSONObject("extendedProperties"),properties=ext==null?null:ext.optJSONObject("private"),projection=event.getJSONObject("projection");
      if(properties==null||!properties.optString("streamDashboardManaged").equals("true")||!event.optString("localId",event.getString("id")).equals(properties.optString("streamDashboardId"))
        ||!projection.optString("seriesLocalId").equals(properties.optString("streamDashboardSeriesId"))||!projection.optString("occurrenceKey").equals(properties.optString("streamDashboardOccurrenceKey"))
        ||!projection.optString("creationId").equals(properties.optString("streamDashboardCreationId")))throw new ProviderException("CONFLICT","Identité de projection Google différente. Aucune modification effectuée.");
    }
    if(action.equals("delete")){
      requireId(remoteId);
      if(link.optString("revision").isEmpty())throw new ProviderException("INVALID_LINK","Révision Google requise avant suppression.");
      try { google("DELETE",base+"/"+enc(remoteId),null,link.optString("revision")); }
      catch (ProviderException error) { if (!isAbsentPlanningDelete("google", error.code)) throw error; }
      return ok().put("remoteId",remoteId).put("calendarId",calendar);
    }
    JSONObject payload=googlePlanningPayload(event);
    if(action.equals("create") && event.optJSONObject("projection") != null && event.getJSONObject("projection").optString("mode").equals("materialized"))payload.put("id", googleRemoteId(event));
    if(!action.equals("create") && link.optString("revision").isEmpty())throw new ProviderException("INVALID_LINK","Révision Google manquante : relisez cet événement avant de le modifier.");
    String method=action.equals("create")?"POST":"PATCH";if(!action.equals("create")){requireId(remoteId);base+="/"+enc(remoteId);}
    JSONObject response=null;
    if(action.equals("create")&&payload.has("id")) {
      try { response=google("GET",base+"/"+enc(payload.getString("id")),null,null); validateGoogleIdentity(event,response); }
      catch(ProviderException error){if(!error.code.equals("HTTP_404"))throw error;}
    }
    if(response==null)try { response=google(method,base,payload.toString(),action.equals("update")?link.optString("revision"):null); }
    catch(ProviderException error){
      if(!action.equals("create")||!payload.has("id")||!error.code.equals("CONFLICT"))throw error;
      response=google("GET",base+"/"+enc(payload.getString("id")),null,null);validateGoogleIdentity(event,response);
    }
    return ok().put("remoteId",response.getString("id")).put("calendarId",calendar).put("revision",response.optString("etag")).put("remoteSnapshot",response);
  }
  private static void validateGoogleIdentity(JSONObject event,JSONObject remote)throws Exception {
    if(remote.optString("status").equals("cancelled"))throw new ProviderException("GOOGLE_PROJECTION_RETIRED","Cette incarnation Google a été supprimée.");
    JSONObject ext=remote.optJSONObject("extendedProperties"),properties=ext==null?null:ext.optJSONObject("private"),projection=event.optJSONObject("projection");
    if(properties==null||!properties.optString("streamDashboardManaged").equals("true")||!event.optString("localId",event.getString("id")).equals(properties.optString("streamDashboardId"))
      ||projection!=null&&(!projection.optString("seriesLocalId").equals(properties.optString("streamDashboardSeriesId"))||!projection.optString("occurrenceKey").equals(properties.optString("streamDashboardOccurrenceKey"))||!projection.optString("creationId").equals(properties.optString("streamDashboardCreationId"))))throw new ProviderException("CONFLICT","Identité Google différente. Aucune publication effectuée.");
  }
  static String googleRemoteId(JSONObject event) throws Exception {
    String localId=event.optString("localId",event.getString("id")); JSONObject projection=event.optJSONObject("projection");
    String identity=projection!=null&&!projection.optString("creationId").isEmpty()?new JSONArray().put(localId).put(projection.getString("creationId")).toString():localId;
    byte[] hash=MessageDigest.getInstance("SHA-256").digest(identity.getBytes(StandardCharsets.UTF_8));StringBuilder out=new StringBuilder("sd");for(byte b:hash)out.append(String.format("%02x",b));return out.toString();
  }
  static JSONObject googlePlanningPayload(JSONObject event) throws Exception {
    boolean allDay=event.optBoolean("allDay");String start=iso(event.getString("startAtUtc")),end=iso(event.getString("endAtUtc"));
    if(!Instant.parse(end).isAfter(Instant.parse(start)))throw new ProviderException("INVALID_PAYLOAD","Période Google invalide.");
    JSONObject beginning=new JSONObject(),ending=new JSONObject();
    if(allDay){if(!start.endsWith("T00:00:00Z")||!end.endsWith("T00:00:00Z"))throw new ProviderException("INVALID_PAYLOAD","Journée entière : bornes UTC requises.");beginning.put("date",start.substring(0,10));ending.put("date",end.substring(0,10));}
    else {beginning.put("dateTime",start);ending.put("dateTime",end);JSONObject rule=event.optJSONObject("recurrence");if(rule!=null){String zone=rule.getString("timeZone");ZoneId.of(zone);beginning.put("timeZone",zone);ending.put("timeZone",zone);}}
    JSONObject properties=new JSONObject().put("streamDashboardManaged","true").put("streamDashboardId",limited(event.optString("localId",event.getString("id")),200)).put("streamDashboardEventId",event.getString("id"));
    JSONObject projection=event.optJSONObject("projection");
    if(projection!=null){properties.put("streamDashboardProjection",projection.getString("mode")).put("streamDashboardSeriesId",projection.getString("seriesLocalId"));if(projection.has("occurrenceKey"))properties.put("streamDashboardOccurrenceKey",projection.getString("occurrenceKey"));if(projection.has("creationId"))properties.put("streamDashboardCreationId",projection.getString("creationId"));}
    return new JSONObject().put("summary",limited(event.optString("title"),140)).put("description",limited(event.optString("description"),4000)).put("start",beginning).put("end",ending)
      .put("recurrence",event.optJSONArray("recurrenceLines")==null?new JSONArray():event.getJSONArray("recurrenceLines")).put("extendedProperties",new JSONObject().put("private",properties));
  }
  static boolean isAbsentPlanningDelete(String provider, String code) {
    return (provider.equals("twitch") || provider.equals("google")) && code.equals("HTTP_404")
      || provider.equals("google") && code.equals("HTTP_410");
  }
  static boolean isDefinitiveNonCreation(String code) {
    return java.util.Set.of("INVALID_PAYLOAD", "INVALID_LINK", "REAUTH_REQUIRED",
      "HTTP_400", "HTTP_401", "HTTP_403", "HTTP_404", "HTTP_405", "HTTP_410",
      "HTTP_412", "HTTP_413", "HTTP_415", "HTTP_422", "HTTP_429").contains(code);
  }
  private JSONObject twitch(String method,String url,String body)throws Exception { JSONObject t=token("twitch"); return request(method,url,body,null,Map.of("Authorization","Bearer "+t.getString("access_token"),"Client-Id",BuildConfig.TWITCH_ANDROID_CLIENT_ID)); }
  private JSONObject google(String method,String url,String body,String etag)throws Exception { return googleRequest("google",method,url,body,etag); }
  private JSONObject googleRequest(String provider,String method,String url,String body,String etag)throws Exception { Map<String,String> h=new HashMap<>(); h.put("Authorization","Bearer "+token(provider).getString("access_token")); if(etag!=null&&!etag.isEmpty())h.put("If-Match",etag); return request(method,url,body,null,h); }
  private String twitchUserId()throws Exception { return twitch("GET","https://api.twitch.tv/helix/users",null).getJSONArray("data").getJSONObject(0).getString("id"); }
  private JSONObject request(String method,String address,String json,String form,Map<String,String> headers)throws Exception {
    HttpURLConnection c=(HttpURLConnection)new URL(address).openConnection(); c.setInstanceFollowRedirects(false); c.setRequestMethod(method); c.setConnectTimeout(10000); c.setReadTimeout(15000); c.setRequestProperty("Accept","application/json");
    if(headers!=null)for(Map.Entry<String,String> h:headers.entrySet())c.setRequestProperty(h.getKey(),h.getValue()); String outgoing=json!=null?json:form;
    if(outgoing!=null){c.setDoOutput(true);c.setRequestProperty("Content-Type",json!=null?"application/json":"application/x-www-form-urlencoded");try(OutputStream o=c.getOutputStream()){o.write(outgoing.getBytes(StandardCharsets.UTF_8));}}
    int status=c.getResponseCode(); InputStream stream=status>=400?c.getErrorStream():c.getInputStream(); String value=stream==null?"":readStream(stream);
    if(status==401)throw new ProviderException("REAUTH_REQUIRED","Session provider expirée."); if(status==409||status==412)throw new ProviderException("CONFLICT","Le provider a changé ailleurs."); if(status>=400) {
      String message = "Le provider a refusé l’opération.";
      try { JSONObject response = new JSONObject(value); message = response.optString("message", message); JSONObject detail = response.optJSONObject("error"); if (detail != null) message = detail.optString("message", message); } catch (JSONException ignored) { }
      throw new ProviderException("HTTP_"+status, safeProviderMessage(message, headers));
    }
    return value.isEmpty()?new JSONObject():new JSONObject(value);
  }
  static String safeProviderMessage(String message, Map<String,String> headers) {
    String result = message;
    if (headers != null) for (Map.Entry<String,String> header : headers.entrySet()) {
      if (header.getKey().equalsIgnoreCase("Authorization")) {
        String secret = header.getValue().replaceFirst("(?i)^(Bearer|OAuth) ", "");
        if (!secret.isEmpty()) result = result.replace(secret, "[redacted]");
      }
    }
    result = result.replaceAll("(?i)(Bearer|OAuth)\\s+[^\\s,;\"']+", "$1 [redacted]")
      .replaceAll("(?i)((access_token|refresh_token|client_secret|authorization|api_key|password|secret|token)[\"']?\\s*[:=]\\s*[\"']?)[^\\s,;\"'}]+", "$1[redacted]");
    return result.substring(0, Math.min(result.length(), 1000));
  }
  private static String readStream(InputStream stream) throws IOException {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    byte[] buffer = new byte[4096];
    int read;
    while ((read = stream.read(buffer)) != -1) { if (out.size()+read>8_000_000) throw new IOException("Réponse trop volumineuse"); out.write(buffer, 0, read); }
    return new String(out.toByteArray(), StandardCharsets.UTF_8);
  }
  private interface Work { JSONObject run()throws Exception; }
  private String guardedMutation(String provider, Work work) {
    try { return recordSync(provider, work.run()).put("ok", true).toString(); }
    catch (Exception e) {
      String code = e instanceof ProviderException ? ((ProviderException)e).code : "NETWORK";
      try { diagnostics.put(provider, ok().put("code", code).put("tested", false)); } catch (JSONException ignored) { }
      return failure(code, e instanceof ProviderException ? e.getMessage() : "Publication refusée : vérifier le diagnostic du compte.", e instanceof ProviderException ? ((ProviderException)e).current : null);
    }
  }
  private String guarded(Work work){try{return work.run().put("ok",true).toString();}catch(ProviderException e){return failure(e.code,e.getMessage(),e.current);}catch(Exception e){return failure("NETWORK","Provider temporairement indisponible.");}}
  private static JSONObject body(String raw)throws Exception {if(raw==null||raw.length()>256_000)throw new ProviderException("INVALID_PAYLOAD","Payload provider invalide.");try { return new JSONObject(raw); } catch (JSONException e) { throw new ProviderException("INVALID_PAYLOAD", "Payload provider invalide."); }}
  private static String limited(String value,int max)throws Exception {if(value==null)return "";if(value.length()>max)throw new ProviderException("INVALID_PAYLOAD","Champ provider trop long.");return value;}
  private static void requireId(String id)throws Exception{if(id.isEmpty())throw new ProviderException("INVALID_LINK","Identifiant provider absent.");}
  private static String iso(String raw)throws Exception{try{return Instant.parse(raw).truncatedTo(ChronoUnit.SECONDS).toString();}catch(java.time.format.DateTimeParseException e){throw new ProviderException("INVALID_PAYLOAD","Date provider invalide.");}}
  private static int duration(JSONObject e)throws Exception{long minutes=Duration.between(Instant.parse(iso(e.getString("startAtUtc"))),Instant.parse(iso(e.getString("endAtUtc")))).toMinutes();if(minutes<30||minutes>1380)throw new ProviderException("INVALID_PAYLOAD","Durée Twitch invalide.");return (int)minutes;}
  private static String twitchFingerprint(JSONObject s)throws Exception{return base64(MessageDigest.getInstance("SHA-256").digest((s.optString("title")+'\u001f'+s.optString("start_time")+'\u001f'+s.optString("end_time")+'\u001f'+(s.optJSONObject("category")==null?"":s.optJSONObject("category").optString("id"))).getBytes(StandardCharsets.UTF_8)));}
  private static String random(int bytes){byte[] b=new byte[bytes];new SecureRandom().nextBytes(b);return base64(b);}
  private static String base64(byte[] value){return Base64.getUrlEncoder().withoutPadding().encodeToString(value);}
  private static String enc(String value)throws Exception{return URLEncoder.encode(value,"UTF-8");}
  private static String form(Map<String,String> values)throws Exception{StringJoiner j=new StringJoiner("&");for(Map.Entry<String,String> e:values.entrySet())j.add(enc(e.getKey())+'='+enc(e.getValue()));return j.toString();}
  private static JSONObject ok(){
    try { return new JSONObject().put("ok",true); }
    catch (JSONException e) { throw new IllegalStateException(e); }
  }
  private static String failure(String code,String message){return failure(code,message,null);}
  private static String failure(String code,String message,JSONObject current){
    try {
      JSONObject o=new JSONObject().put("ok",false).put("code",code).put("message",message).put("nonCreation",isDefinitiveNonCreation(code));
      if(code.matches("HTTP_[45][0-9]{2}")) o.put("providerMessage", safeProviderMessage(message, null));
      if(current!=null)o.put("current",current);
      return o.toString();
    } catch (JSONException e) {
      return "{\"ok\":false,\"code\":\"INTERNAL\",\"message\":\"Erreur interne.\"}";
    }
  }
  private static final class ProviderException extends Exception { final String code; final JSONObject current; ProviderException(String c,String m){this(c,m,null);} ProviderException(String c,String m,JSONObject v){super(m);code=c;current=v;} }
}
