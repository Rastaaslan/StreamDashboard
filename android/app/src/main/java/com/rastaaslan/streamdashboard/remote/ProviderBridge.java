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
  private static final String TWITCH_SCOPES = "channel:manage:schedule channel:read:schedule";
  private static final String GOOGLE_SCOPES = "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly";
  private static final long OAUTH_PENDING_TTL_MS = 10 * 60_000L;
  private final Map<String, JSONObject> diagnostics = new java.util.concurrent.ConcurrentHashMap<>();
  private final GoogleAuthorizationFlow googleAuth;
  private final Activity activity;
  private final SecureCredentialStore credentials;

  ProviderBridge(Activity activity) {
    this.activity = activity; credentials = new SecureCredentialStore(activity);
    googleAuth = new GoogleAuthorizationFlow(new GoogleAuthorizationAdapter(activity), (connected, code) -> {
      credentials.clear("google"); // retire tokens from the former custom-scheme flow
      notifyAuth("google", connected, code);
    });
  }
  @JavascriptInterface public String twitchTest(String ignored) { return testProvider("twitch"); }
  @JavascriptInterface public String googleTest(String ignored) { return testProvider("google"); }
  @JavascriptInterface public String twitchStatus(String ignored) { return status("twitch", BuildConfig.TWITCH_ANDROID_CLIENT_ID); }
  @JavascriptInterface public String googleStatus(String ignored) {
    if (!BuildConfig.GOOGLE_ANDROID_CLIENT_ID.trim().isEmpty() && GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(activity) != ConnectionResult.SUCCESS)
      return "{\"ok\":true,\"configured\":false,\"connected\":false,\"code\":\"GOOGLE_PLAY_SERVICES\",\"capabilities\":[]}";
    return status("google", BuildConfig.GOOGLE_ANDROID_CLIENT_ID);
  }
  @JavascriptInterface public String twitchAuthorize(String ignored) { return authorize("twitch", BuildConfig.TWITCH_ANDROID_CLIENT_ID, "https://id.twitch.tv/oauth2/authorize", TWITCH_SCOPES); }
  @JavascriptInterface public String googleAuthorize(String ignored) { return authorizeGoogle(); }
  @JavascriptInterface public String twitchLogout(String ignored) { diagnostics.remove("twitch"); credentials.clear("twitch"); credentials.clear(pendingKey("twitch")); return ok().toString(); }
  @JavascriptInterface public String googleLogout(String ignored) { googleAuth.logout(); diagnostics.remove("google"); credentials.clear("google"); credentials.clear(pendingKey("google")); return ok().toString(); }
  @JavascriptInterface public String twitchSearchCategories(String raw) { return guarded(() -> twitchSearch(body(raw).optString("query"))); }
  @JavascriptInterface public String twitchCreatePlanning(String raw) { return guardedMutation("twitch", () -> twitchMutate("create", body(raw))); }
  @JavascriptInterface public String twitchUpdatePlanning(String raw) { return guardedMutation("twitch", () -> twitchMutate("update", body(raw))); }
  @JavascriptInterface public String twitchDeletePlanning(String raw) { return guardedMutation("twitch", () -> twitchMutate("delete", body(raw))); }
  @JavascriptInterface public String googleCreatePlanning(String raw) { return guardedMutation("google", () -> googleMutate("create", body(raw))); }
  @JavascriptInterface public String googleUpdatePlanning(String raw) { return guardedMutation("google", () -> googleMutate("update", body(raw))); }
  @JavascriptInterface public String googleDeletePlanning(String raw) { return guardedMutation("google", () -> googleMutate("delete", body(raw))); }

  @JavascriptInterface public String twitchReconcilePlanning(String raw) { return guarded(() -> reconcilePlanning("twitch", body(raw))); }
  @JavascriptInterface public String googleReconcilePlanning(String raw) { return guarded(() -> reconcilePlanning("google", body(raw))); }

  void acceptOAuthCallback(Uri uri) {
    if (uri == null || DeepLinkRouter.route(uri.toString()) != DeepLinkRouter.Route.OAUTH) return;
    String provider = uri.getQueryParameter("provider");
    String code = uri.getQueryParameter("code");
    String state = uri.getQueryParameter("state");
    if (!"twitch".equals(provider)) return;
    if (code == null || state == null) { notifyAuth(provider, false); return; }
    final String verifier;
    try { verifier = consumePendingVerifier(provider, state); }
    catch (Exception ignored) { notifyAuth(provider, false); return; }
    if (verifier == null) { notifyAuth(provider, false); return; }
    final String selected = provider;
    new Thread(() -> { try { exchangeCode(selected, code, verifier); notifyAuth(selected, true); } catch (Exception ignored) { notifyAuth(selected, false); } }).start();
  }

  private void notifyAuth(String provider, boolean connected) { notifyAuth(provider, connected, "AUTH"); }
  private void notifyAuth(String provider, boolean connected, String code) { diagnostics.remove(provider); if (!connected) { try { diagnostics.put(provider, ok().put("code", code)); } catch (JSONException ignored) { } } activity.runOnUiThread(() -> ((MainActivity)activity).dispatchProviderAuth(provider, connected)); }
  private String status(String provider, String clientId) {
    try {
      boolean configured = !clientId.isEmpty(), connected = provider.equals("google") ? googleAuth.connected() : !credentials.get(provider).isEmpty();
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
          if (cap.equals("calendar") || cap.equals("schedule") || cap.equals("categories")) capabilities.put(cap);
        }
      }
      String lastSync = credentials.get(provider + "_last_sync");
      result.put("lastSync", lastSync.isEmpty() ? 0 : Long.parseLong(lastSync));
      return result.put("ok", true).put("configured", configured).put("connected", connected).put("capabilities", capabilities).toString();
    } catch (Exception e) { return failure("INTERNAL", "État indisponible."); }
  }
  private synchronized String testProvider(String provider) {
    String clientId = provider.equals("twitch") ? BuildConfig.TWITCH_ANDROID_CLIENT_ID : BuildConfig.GOOGLE_ANDROID_CLIENT_ID;
    JSONObject result = ok();
    try {
      if (clientId.isEmpty()) throw new ProviderException("NOT_CONFIGURED", "Configuration requise.");
      if (provider.equals("google") ? !googleAuth.connected() : credentials.get(provider).isEmpty()) throw new ProviderException("REAUTH_REQUIRED", "Connexion requise.");
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
        if (!granted.toString().contains("channel:manage:schedule")) throw new ProviderException("SCOPES", "Permissions requises.");
        JSONObject user = twitch("GET", "https://api.twitch.tv/helix/users", null).getJSONArray("data").getJSONObject(0);
        capabilities.put("categories");
        // Twitch only permits schedule writes for affiliates and partners.
        if (user.optString("broadcaster_type").isEmpty()) throw new ProviderException("ACCOUNT", "Compte affilié ou partenaire requis.");
        capabilities.put("schedule");
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
        result.put("calendar", "primary"); capabilities.put("calendar");
      }
      result.put("tested", true).put("testedAt", System.currentTimeMillis()).put("capabilities", capabilities);
    } catch (ProviderException e) {
      try { result.put("code", e.code).put("requiresReauth", e.code.equals("REAUTH_REQUIRED") || e.code.equals("SCOPES") || e.code.equals("HTTP_403")); } catch (JSONException ignored) { }
    } catch (Exception e) { try { result.put("code", e instanceof ProviderException ? ((ProviderException)e).code : "NETWORK"); } catch (JSONException ignored) { } }
    try { if (diagnostics.containsKey(provider)) result.put("lastSync", diagnostics.get(provider).optLong("lastSync", 0)); } catch (JSONException ignored) { }
    diagnostics.put(provider, result);
    return status(provider, clientId);
  }
  private String authorizeGoogle() {
    if (BuildConfig.PREVIEW_MODE || BuildConfig.GOOGLE_ANDROID_CLIENT_ID.trim().isEmpty())
      return failure("NOT_CONFIGURED", "Google Android non provisionné : Client ID Android, package et certificat requis.");
    googleAuth.authorizeGoogle();
    return ok().toString();
  }
  void acceptGoogleResult(int requestCode, int resultCode, Intent data) {
    googleAuth.acceptGoogleResult(requestCode, resultCode == Activity.RESULT_OK, data);
  }

  private String authorize(String provider, String clientId, String endpoint, String scopes) {
    if (clientId.isEmpty()) return failure("NOT_CONFIGURED", provider.equals("google") ? "Google autonome non configuré" : "Twitch autonome non configuré");
    try {
      diagnostics.remove(provider);
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

  private void exchangeCode(String provider, String code, String verifier) throws Exception {
    String clientId = provider.equals("twitch") ? BuildConfig.TWITCH_ANDROID_CLIENT_ID : BuildConfig.GOOGLE_ANDROID_CLIENT_ID;
    String endpoint = "https://id.twitch.tv/oauth2/token";
    String form = form(Map.of("client_id",clientId,"code",code,"code_verifier",verifier,"grant_type","authorization_code","redirect_uri","streamdashboard://oauth?provider="+provider));
    JSONObject token = request("POST", endpoint, null, form, null);
    token.put("obtained_at", System.currentTimeMillis()); credentials.put(provider, token.toString());
  }
  private synchronized JSONObject token(String provider) throws Exception {
    if (provider.equals("google")) {
      if (!googleAuth.connected()) throw new ProviderException("REAUTH_REQUIRED", "Reconnecter Google.");
      try {
        GoogleAuthorizationFlow.Grant grant = googleAuth.refresh();
        return new JSONObject().put("access_token", grant.token).put("scope", String.join(" ", grant.scopes));
      } catch (GoogleAuthorizationFlow.AuthException error) {
        throw new ProviderException(error.code, "Réautoriser Google avec les permissions Calendar.");
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
    if (!fresh.has("scope")) fresh.put("scope", token.optString("scope"));
    if (!fresh.has("refresh_token")) fresh.put("refresh_token", refresh); fresh.put("obtained_at", System.currentTimeMillis()); credentials.put(provider, fresh.toString()); return fresh;
  }
  private void requirePublication(String provider) throws Exception {
    JSONObject result = new JSONObject(testProvider(provider));
    if (!result.optBoolean("tested")) throw new ProviderException(result.optString("code", "SCOPES"), "Tester les permissions de ce compte avant publication.");
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
    String calendar = limited(link.optString("calendarId", "primary"), 200);
    String base = isGoogle
      ? "https://www.googleapis.com/calendar/v3/calendars/" + enc(calendar) + "/events?showDeleted=false&privateExtendedProperty=" + enc("streamDashboardEventId=" + event.getString("id"))
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
            && event.getString("id").equals(properties.optString("streamDashboardEventId"));
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
    if (action.equals("delete")) {
      requireId(remoteId);
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
    JSONObject response = twitch(action.equals("create") ? "POST" : "PATCH", url, payload.toString());
    JSONObject segment = response.getJSONObject("data").getJSONArray("segments").getJSONObject(0);
    return ok().put("remoteId", segment.getString("id")).put("fingerprint", twitchFingerprint(segment)).put("remoteSnapshot", segment);
  }
  static JSONObject twitchSchedulePayload(JSONObject event, JSONObject currentSegment) throws Exception {
    JSONObject payload = new JSONObject();
    String title = limited(event.optString("title"), 140), category = limited(event.optString("twitchCategoryId"), 40), start = iso(event.getString("startAtUtc"));
    if (currentSegment == null || !title.equals(currentSegment.optString("title"))) payload.put("title", title);
    JSONObject currentCategory = currentSegment == null ? null : currentSegment.optJSONObject("category");
    if (!category.isEmpty() && (currentCategory == null || !category.equals(currentCategory.optString("id")))) payload.put("category_id", category);
    if (currentSegment == null || !start.equals(iso(currentSegment.getString("start_time")))) payload.put("start_time", start).put("timezone", "UTC");
    int minutes = duration(event);
    if (currentSegment == null || minutes != Duration.between(Instant.parse(currentSegment.getString("start_time")), Instant.parse(currentSegment.getString("end_time"))).toMinutes()) payload.put("duration", String.valueOf(minutes));
    return payload;
  }
  private JSONObject googleMutate(String action, JSONObject input) throws Exception {
    requirePublication("google");
    JSONObject event=input.getJSONObject("event"), link=input.optJSONObject("link"); if(link==null)link=new JSONObject();
    String calendar=limited(link.optString("calendarId","primary"),200), remoteId=limited(link.optString("remoteId"),200);
    String base="https://www.googleapis.com/calendar/v3/calendars/"+enc(calendar)+"/events";
    if(action.equals("delete")){
      requireId(remoteId);
      try { google("DELETE",base+"/"+enc(remoteId),null,link.optString("revision")); }
      catch (ProviderException error) { if (!isAbsentPlanningDelete("google", error.code)) throw error; }
      return ok().put("remoteId",remoteId).put("calendarId",calendar);
    }
    JSONObject payload=new JSONObject().put("summary",limited(event.optString("title"),140)).put("description",limited(event.optString("description"),500)).put("start",new JSONObject().put("dateTime",iso(event.getString("startAtUtc")))).put("end",new JSONObject().put("dateTime",iso(event.getString("endAtUtc")))).put("extendedProperties",new JSONObject().put("private",new JSONObject().put("streamDashboardEventId",limited(event.getString("id"),200))));
    String method=action.equals("create")?"POST":"PATCH";if(!action.equals("create")){requireId(remoteId);base+="/"+enc(remoteId);}
    JSONObject response=google(method,base,payload.toString(),action.equals("update")?link.optString("revision"):null);
    return ok().put("remoteId",response.getString("id")).put("calendarId",calendar).put("revision",response.optString("etag")).put("remoteSnapshot",response);
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
  private JSONObject google(String method,String url,String body,String etag)throws Exception { Map<String,String> h=new HashMap<>(); h.put("Authorization","Bearer "+token("google").getString("access_token")); if(etag!=null&&!etag.isEmpty())h.put("If-Match",etag); return request(method,url,body,null,h); }
  private String twitchUserId()throws Exception { return twitch("GET","https://api.twitch.tv/helix/users",null).getJSONArray("data").getJSONObject(0).getString("id"); }
  private JSONObject request(String method,String address,String json,String form,Map<String,String> headers)throws Exception {
    HttpURLConnection c=(HttpURLConnection)new URL(address).openConnection(); c.setRequestMethod(method); c.setConnectTimeout(10000); c.setReadTimeout(15000); c.setRequestProperty("Accept","application/json");
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
    while ((read = stream.read(buffer)) != -1) out.write(buffer, 0, read);
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
  private static JSONObject body(String raw)throws Exception {if(raw==null||raw.length()>16_000)throw new ProviderException("INVALID_PAYLOAD","Payload provider invalide.");try { return new JSONObject(raw); } catch (JSONException e) { throw new ProviderException("INVALID_PAYLOAD", "Payload provider invalide."); }}
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
