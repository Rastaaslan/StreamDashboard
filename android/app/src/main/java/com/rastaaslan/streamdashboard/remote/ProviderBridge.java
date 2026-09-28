package com.rastaaslan.streamdashboard.remote;

import android.accounts.Account;
import android.app.Activity;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.IntentSender;
import android.net.Uri;
import android.webkit.JavascriptInterface;
import com.google.android.gms.auth.api.identity.AuthorizationClient;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.auth.api.identity.RevokeAccessRequest;
import com.google.android.gms.auth.api.signin.GoogleSignInAccount;
import com.google.android.gms.common.api.Scope;
import com.google.android.gms.tasks.Tasks;
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
  private static final List<Scope> GOOGLE_SCOPES = Arrays.asList(
    new Scope("https://www.googleapis.com/auth/calendar.events"),
    new Scope("https://www.googleapis.com/auth/calendar.readonly")
  );
  private static final int GOOGLE_AUTH_REQUEST_CODE = 7102;
  private static final long OAUTH_PENDING_TTL_MS = 10 * 60_000L;
  private final Activity activity;
  private final SecureCredentialStore credentials;
  private final AuthorizationClient googleAuthorization;

  ProviderBridge(Activity activity) {
    this.activity = activity;
    credentials = new SecureCredentialStore(activity);
    googleAuthorization = Identity.getAuthorizationClient(activity);
  }
  @JavascriptInterface public String twitchStatus(String ignored) { return status("twitch", BuildConfig.TWITCH_ANDROID_CLIENT_ID); }
  @JavascriptInterface public String googleStatus(String ignored) { return googleStatus(); }
  @JavascriptInterface public String twitchAuthorize(String ignored) { return authorize("twitch", BuildConfig.TWITCH_ANDROID_CLIENT_ID, "https://id.twitch.tv/oauth2/authorize", TWITCH_SCOPES); }
  @JavascriptInterface public String googleAuthorize(String ignored) { return authorizeGoogle(); }
  @JavascriptInterface public String twitchLogout(String ignored) { credentials.clear("twitch"); credentials.clear(pendingKey("twitch")); return ok().toString(); }
  @JavascriptInterface public String googleLogout(String ignored) { return logoutGoogle(); }
  @JavascriptInterface public String twitchSearchCategories(String raw) { return guarded(() -> twitchSearch(body(raw).optString("query"))); }
  @JavascriptInterface public String twitchCreatePlanning(String raw) { return guarded(() -> twitchMutate("create", body(raw))); }
  @JavascriptInterface public String twitchUpdatePlanning(String raw) { return guarded(() -> twitchMutate("update", body(raw))); }
  @JavascriptInterface public String twitchDeletePlanning(String raw) { return guarded(() -> twitchMutate("delete", body(raw))); }
  @JavascriptInterface public String googleCreatePlanning(String raw) { return guarded(() -> googleMutate("create", body(raw))); }
  @JavascriptInterface public String googleUpdatePlanning(String raw) { return guarded(() -> googleMutate("update", body(raw))); }
  @JavascriptInterface public String googleDeletePlanning(String raw) { return guarded(() -> googleMutate("delete", body(raw))); }

  void acceptOAuthCallback(Uri uri) {
    if (uri == null || DeepLinkRouter.route(uri.toString()) != DeepLinkRouter.Route.OAUTH) return;
    String provider = uri.getQueryParameter("provider");
    if (!"twitch".equals(provider)) return;
    String code = uri.getQueryParameter("code");
    String state = uri.getQueryParameter("state");
    if (code == null || state == null) { notifyAuth("twitch", false); return; }
    final String verifier;
    try { verifier = consumePendingVerifier("twitch", state); }
    catch (Exception ignored) { notifyAuth("twitch", false); return; }
    if (verifier == null) { notifyAuth("twitch", false); return; }
    new Thread(() -> { try { exchangeTwitchCode(code, verifier); notifyAuth("twitch", true); } catch (Exception ignored) { notifyAuth("twitch", false); } }).start();
  }

  boolean handleActivityResult(int requestCode, int resultCode, Intent data) {
    if (requestCode != GOOGLE_AUTH_REQUEST_CODE) return false;
    if (resultCode != Activity.RESULT_OK || data == null) {
      notifyAuth("google", false);
      return true;
    }
    try {
      AuthorizationResult result = googleAuthorization.getAuthorizationResultFromIntent(data);
      saveGoogleAuthorization(result);
      notifyAuth("google", true);
    } catch (Exception ignored) {
      notifyAuth("google", false);
    }
    return true;
  }

  private void notifyAuth(String provider, boolean connected) { activity.runOnUiThread(() -> ((MainActivity)activity).dispatchProviderAuth(provider, connected)); }
  private String status(String provider, String clientId) { try { String label = "Twitch"; return new JSONObject().put("ok", true).put("configured", !clientId.isEmpty()).put("connected", !credentials.get(provider).isEmpty()).put("message", clientId.isEmpty() ? label + " autonome non configuré" : JSONObject.NULL).toString(); } catch (Exception e) { return failure("INTERNAL", "État indisponible."); } }
  private String googleStatus() {
    try {
      return new JSONObject()
        .put("ok", true)
        .put("configured", true)
        .put("connected", !credentials.get("google").isEmpty())
        .put("message", JSONObject.NULL)
        .toString();
    } catch (Exception e) {
      return failure("INTERNAL", "État Google indisponible.");
    }
  }
  private String authorize(String provider, String clientId, String endpoint, String scopes) {
    if (clientId.isEmpty()) return failure("NOT_CONFIGURED", provider.equals("google") ? "Google autonome non configuré" : "Twitch autonome non configuré");
    try {
      String verifier = random(48), state = random(24), challenge = base64(MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII)));
      long now = System.currentTimeMillis();
      JSONObject pending = new JSONObject()
        .put("provider", provider)
        .put("state", state)
        .put("verifier", verifier)
        .put("createdAt", now)
        .put("expiresAt", now + OAUTH_PENDING_TTL_MS);
      credentials.put(pendingKey(provider), pending.toString());
      Uri uri = Uri.parse(endpoint).buildUpon().appendQueryParameter("client_id", clientId).appendQueryParameter("redirect_uri", "streamdashboard://oauth?provider=" + provider).appendQueryParameter("response_type", "code").appendQueryParameter("scope", scopes).appendQueryParameter("state", state).appendQueryParameter("code_challenge", challenge).appendQueryParameter("code_challenge_method", "S256").build();
      activity.startActivity(new Intent(Intent.ACTION_VIEW, uri)); return ok().put("launched", true).toString();
    } catch (Exception e) { return failure("AUTH", "Impossible de lancer l’autorisation."); }
  }
  private static String pendingKey(String provider) { return "oauth_pending_" + provider; }

  private String consumePendingVerifier(String provider, String state) throws Exception {
    String key = pendingKey(provider);
    String raw = credentials.get(key);
    credentials.clear(key); // single-use even for malformed/expired callbacks
    if (raw.isEmpty()) return null;
    JSONObject pending;
    try { pending = new JSONObject(raw); }
    catch (JSONException error) { return null; }
    long now = System.currentTimeMillis();
    long createdAt = pending.optLong("createdAt", 0);
    long expiresAt = pending.optLong("expiresAt", 0);
    if (!provider.equals(pending.optString("provider")) || createdAt <= 0 || expiresAt <= now || expiresAt - createdAt > OAUTH_PENDING_TTL_MS) return null;
    String expectedState = pending.optString("state");
    if (!constantTimeEquals(expectedState, state)) return null;
    String verifier = pending.optString("verifier");
    return verifier.isEmpty() ? null : verifier;
  }

  private static boolean constantTimeEquals(String left, String right) {
    if (left == null || right == null) return false;
    return MessageDigest.isEqual(left.getBytes(StandardCharsets.UTF_8), right.getBytes(StandardCharsets.UTF_8));
  }

  private AuthorizationRequest googleAuthorizationRequest() {
    return AuthorizationRequest.builder().setRequestedScopes(GOOGLE_SCOPES).build();
  }

  private String authorizeGoogle() {
    activity.runOnUiThread(() ->
      googleAuthorization.authorize(googleAuthorizationRequest())
        .addOnSuccessListener(result -> {
          if (result.hasResolution()) {
            PendingIntent pendingIntent = result.getPendingIntent();
            if (pendingIntent == null) {
              notifyAuth("google", false);
              return;
            }
            try {
              activity.startIntentSenderForResult(
                pendingIntent.getIntentSender(),
                GOOGLE_AUTH_REQUEST_CODE,
                null,
                0,
                0,
                0
              );
            } catch (IntentSender.SendIntentException error) {
              notifyAuth("google", false);
            }
            return;
          }
          try {
            saveGoogleAuthorization(result);
            notifyAuth("google", true);
          } catch (Exception error) {
            notifyAuth("google", false);
          }
        })
        .addOnFailureListener(error -> notifyAuth("google", false))
    );
    return ok().put("launched", true).toString();
  }

  private void saveGoogleAuthorization(AuthorizationResult result) throws Exception {
    String accessToken = result.getAccessToken();
    if (accessToken == null || accessToken.isEmpty()) throw new ProviderException("AUTH", "Autorisation Google incomplète.");
    JSONObject marker = new JSONObject().put("connected", true);
    GoogleSignInAccount signInAccount = result.toGoogleSignInAccount();
    if (signInAccount != null && signInAccount.getAccount() != null) {
      marker.put("account", signInAccount.getAccount().name);
    }
    credentials.put("google", marker.toString());
  }

  private String logoutGoogle() {
    try {
      String raw = credentials.get("google");
      credentials.clear("google");
      if (!raw.isEmpty()) {
        String accountName = new JSONObject(raw).optString("account");
        if (!accountName.isEmpty()) {
          RevokeAccessRequest request = RevokeAccessRequest.builder()
            .setAccount(new Account(accountName, "com.google"))
            .setScopes(GOOGLE_SCOPES)
            .build();
          googleAuthorization.revokeAccess(request);
        }
      }
      return ok().toString();
    } catch (Exception error) {
      credentials.clear("google");
      return failure("AUTH", "Déconnexion Google locale effectuée, révocation distante indisponible.");
    }
  }

  private String googleAccessToken() throws Exception {
    AuthorizationResult result = Tasks.await(
      googleAuthorization.authorize(googleAuthorizationRequest()),
      15,
      java.util.concurrent.TimeUnit.SECONDS
    );
    if (result.hasResolution() || result.getAccessToken() == null || result.getAccessToken().isEmpty()) {
      throw new ProviderException("REAUTH_REQUIRED", "Reconnectez Google autonome.");
    }
    saveGoogleAuthorization(result);
    return result.getAccessToken();
  }

  private void exchangeTwitchCode(String code, String verifier) throws Exception {
    String form = form(Map.of(
      "client_id", BuildConfig.TWITCH_ANDROID_CLIENT_ID,
      "code", code,
      "code_verifier", verifier,
      "grant_type", "authorization_code",
      "redirect_uri", "streamdashboard://oauth?provider=twitch"
    ));
    JSONObject token = request("POST", "https://id.twitch.tv/oauth2/token", null, form, null);
    token.put("obtained_at", System.currentTimeMillis());
    credentials.put("twitch", token.toString());
  }

  private synchronized JSONObject twitchToken() throws Exception {
    JSONObject token = new JSONObject(credentials.get("twitch"));
    long expires = token.optLong("expires_in", 3600) * 1000L, obtained = token.optLong("obtained_at");
    if (System.currentTimeMillis() < obtained + expires - 60_000) return token;
    String refresh = token.optString("refresh_token");
    if (refresh.isEmpty()) throw new ProviderException("REAUTH_REQUIRED", "Reconnectez Twitch autonome.");
    JSONObject fresh = request(
      "POST",
      "https://id.twitch.tv/oauth2/token",
      null,
      form(Map.of(
        "client_id", BuildConfig.TWITCH_ANDROID_CLIENT_ID,
        "refresh_token", refresh,
        "grant_type", "refresh_token"
      )),
      null
    );
    if (!fresh.has("refresh_token")) fresh.put("refresh_token", refresh);
    fresh.put("obtained_at", System.currentTimeMillis());
    credentials.put("twitch", fresh.toString());
    return fresh;
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
  private JSONObject twitch(String method,String url,String body)throws Exception { JSONObject t=twitchToken(); return request(method,url,body,null,Map.of("Authorization","Bearer "+t.getString("access_token"),"Client-Id",BuildConfig.TWITCH_ANDROID_CLIENT_ID)); }
  private JSONObject google(String method,String url,String body,String etag)throws Exception { Map<String,String> h=new HashMap<>(); h.put("Authorization","Bearer "+googleAccessToken()); if(etag!=null&&!etag.isEmpty())h.put("If-Match",etag); return request(method,url,body,null,h); }
  private String twitchUserId()throws Exception { return twitch("GET","https://api.twitch.tv/helix/users",null).getJSONArray("data").getJSONObject(0).getString("id"); }
  private JSONObject request(String method,String address,String json,String form,Map<String,String> headers)throws Exception {
    HttpURLConnection c=(HttpURLConnection)new URL(address).openConnection(); c.setRequestMethod(method); c.setConnectTimeout(10000); c.setReadTimeout(15000); c.setRequestProperty("Accept","application/json");
    if(headers!=null)for(Map.Entry<String,String> h:headers.entrySet())c.setRequestProperty(h.getKey(),h.getValue()); String outgoing=json!=null?json:form;
    if(outgoing!=null){c.setDoOutput(true);c.setRequestProperty("Content-Type",json!=null?"application/json":"application/x-www-form-urlencoded");try(OutputStream o=c.getOutputStream()){o.write(outgoing.getBytes(StandardCharsets.UTF_8));}}
    int status=c.getResponseCode(); InputStream stream=status>=400?c.getErrorStream():c.getInputStream(); String value=stream==null?"":readStream(stream);
    if(status==401)throw new ProviderException("REAUTH_REQUIRED","Session provider expirée."); if(status==409||status==412)throw new ProviderException("CONFLICT","Le provider a changé ailleurs.",value.isEmpty()?null:new JSONObject(value)); if(status>=400)throw new ProviderException("HTTP_"+status,"Le provider a refusé l’opération.");
    return value.isEmpty()?new JSONObject():new JSONObject(value);
  }
  private static String readStream(InputStream stream) throws IOException {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    byte[] buffer = new byte[4096];
    int read;
    while ((read = stream.read(buffer)) != -1) out.write(buffer, 0, read);
    return new String(out.toByteArray(), StandardCharsets.UTF_8);
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
  private static String enc(String value)throws Exception{return URLEncoder.encode(value,"UTF-8");}
  private static String form(Map<String,String> values)throws Exception{StringJoiner j=new StringJoiner("&");for(Map.Entry<String,String> e:values.entrySet())j.add(enc(e.getKey())+'='+enc(e.getValue()));return j.toString();}
  private static JSONObject ok(){
    try { return new JSONObject().put("ok",true); }
    catch (JSONException e) { throw new IllegalStateException(e); }
  }
  private static String failure(String code,String message){return failure(code,message,null);}
  private static String failure(String code,String message,JSONObject current){
    try {
      JSONObject o=new JSONObject().put("ok",false).put("code",code).put("message",message);
      if(current!=null)o.put("current",current);
      return o.toString();
    } catch (JSONException e) {
      return "{\"ok\":false,\"code\":\"INTERNAL\",\"message\":\"Erreur interne.\"}";
    }
  }
  private static final class ProviderException extends Exception { final String code; final JSONObject current; ProviderException(String c,String m){this(c,m,null);} ProviderException(String c,String m,JSONObject v){super(m);code=c;current=v;} }
}
