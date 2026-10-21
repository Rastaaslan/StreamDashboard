import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';

// Android signature stubs and a map-backed JSONObject exercise payload policy, not Android/OAuth runtime.
test('ProviderBridge compiles and enforces provider isolation, deletion and Streamlabs payload policy', t => {
  try { execFileSync('javac', ['-version'], { stdio: 'inherit' }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; t.skip('javac unavailable'); return; }
  mkdirSync('test-results', { recursive: true });
  const directory = mkdtempSync(path.resolve('test-results/provider-bridge-'));
  const pkg = 'com.rastaaslan.streamdashboard.remote';
  const stubs = {
    'android/app/Activity.java': 'package android.app; public class Activity { public static final int RESULT_OK=-1; public void runOnUiThread(Runnable r) {} public void startActivity(android.content.Intent i) {} }',
    'com/google/android/gms/common/ConnectionResult.java': 'package com.google.android.gms.common; public class ConnectionResult { public static final int SUCCESS=0; }',
    'com/google/android/gms/common/GoogleApiAvailability.java': 'package com.google.android.gms.common; public class GoogleApiAvailability { public static GoogleApiAvailability getInstance() { return new GoogleApiAvailability(); } public int isGooglePlayServicesAvailable(android.app.Activity activity) { return 0; } }',
    'android/content/Intent.java': 'package android.content; public class Intent { public static final String ACTION_VIEW=""; public Intent(String a, android.net.Uri u) {} }',
    'android/net/Uri.java': 'package android.net; public class Uri { public static Uri parse(String s) { return null; } public String getQueryParameter(String s) { return null; } public Builder buildUpon() { return null; } public static class Builder { public Builder appendQueryParameter(String k, String v) { return this; } public Uri build() { return null; } } }',
    'android/webkit/JavascriptInterface.java': 'package android.webkit; public @interface JavascriptInterface {}',
    'org/json/JSONException.java': 'package org.json; public class JSONException extends Exception {}',
    'org/json/JSONObject.java': `package org.json; public class JSONObject {
      private final java.util.Map<String,Object> values = new java.util.HashMap<>();
      public String toString() { return values.toString(); }
      public JSONObject() {} public JSONObject(String s) throws JSONException {}
      public JSONObject put(String k,Object v) throws JSONException { values.put(k,v); return this; }
      public String getString(String k) throws JSONException { return (String)values.get(k); } public Object opt(String k) { return values.get(k); }
      public String optString(String k) { return optString(k, ""); } public String optString(String k,String d) { return (String)values.getOrDefault(k,d); }
      public long getLong(String k) throws JSONException { Object value=values.get(k); if(!(value instanceof Number))throw new JSONException(); return ((Number)value).longValue(); }
      public long optLong(String k) { return 0; } public long optLong(String k,long d) { return d; }
      public boolean optBoolean(String k) { return java.lang.Boolean.TRUE.equals(values.get(k)); } public boolean has(String k) { return values.containsKey(k); }
      public JSONObject getJSONObject(String k) throws JSONException { return (JSONObject)values.get(k); }
      public JSONObject optJSONObject(String k) { return (JSONObject)values.get(k); }
      public JSONArray getJSONArray(String k) throws JSONException { return (JSONArray)values.get(k); }
      public JSONArray optJSONArray(String k) { return (JSONArray)values.get(k); }
    }`,
    'org/json/JSONArray.java': 'package org.json; public class JSONArray { private java.util.List<Object> values=new java.util.ArrayList<>(); public JSONArray put(Object v) { values.add(v); return this; } public int length() { return values.size(); } public Object get(int i) throws JSONException { return values.get(i); } public String getString(int i) throws JSONException { return (String)values.get(i); } public JSONObject getJSONObject(int i) throws JSONException { return (JSONObject)values.get(i); } }',
    'SecureCredentialStore.java': `package ${pkg}; class SecureCredentialStore { SecureCredentialStore(android.app.Activity a) {} String get(String k) { return ""; } void put(String k,String v) {} void clear(String k) {} }`,
    'BuildConfig.java': `package ${pkg}; class BuildConfig { static final String TWITCH_ANDROID_CLIENT_ID="", GOOGLE_ANDROID_CLIENT_ID=""; static final boolean PREVIEW_MODE=false; }`,
    'GoogleAuthorizationAdapter.java': `package ${pkg}; class GoogleAuthorizationAdapter implements GoogleAuthorizationFlow.Adapter {
      private final String account;
      GoogleAuthorizationAdapter(android.app.Activity activity, String title) { account=title.contains("YouTube")?"video@example.test":"agenda@example.test"; }
      boolean acceptAccountResult(int requestCode, int resultCode, android.content.Intent data) { return false; }
      public void authorize(java.util.List<String> scopes, GoogleAuthorizationFlow.Callback callback) { callback.success(new GoogleAuthorizationFlow.Grant("token-"+account,scopes,null,account)); }
      public void launch(Object resolution, int requestCode) {}
      public GoogleAuthorizationFlow.Grant result(Object data) { return null; }
      public GoogleAuthorizationFlow.Grant refresh(java.util.List<String> scopes, String selected) { if(!account.equals(selected))throw new AssertionError("Wrong refresh account"); return new GoogleAuthorizationFlow.Grant("token-"+account,scopes,null,account); }
    }`,
    'DeletionPolicyTest.java': `package ${pkg}; public class DeletionPolicyTest {
      public static void main(String[] args) throws Exception {
        ProviderBridge bridge = new ProviderBridge(new android.app.Activity());
        bridge.googleAuthorize("{}"); bridge.youtubeAuthorize("{}");
        if(!bridge.googleStatus("{}").contains("agenda@example.test")||!bridge.youtubeStatus("{}").contains("video@example.test"))throw new AssertionError("Accounts not separated");
        java.lang.reflect.Method providerToken=ProviderBridge.class.getDeclaredMethod("token",String.class); providerToken.setAccessible(true);
        org.json.JSONObject calendarToken=(org.json.JSONObject)providerToken.invoke(bridge,"google");
        org.json.JSONObject videoToken=(org.json.JSONObject)providerToken.invoke(bridge,"youtube");
        if(!calendarToken.getString("access_token").equals("token-agenda@example.test")||!videoToken.getString("access_token").equals("token-video@example.test"))throw new AssertionError("Cross-provider token routing");
        bridge.youtubeLogout("{}");
        if(!bridge.googleStatus("{}").contains("connected=true")||!bridge.youtubeStatus("{}").contains("connected=false"))throw new AssertionError("YouTube logout disconnected Calendar");
        bridge.youtubeAuthorize("{}"); bridge.googleLogout("{}");
        if(!bridge.youtubeStatus("{}").contains("connected=true")||!bridge.googleStatus("{}").contains("connected=false"))throw new AssertionError("Calendar logout disconnected YouTube");
        bridge.close();
        String diagnostic = ProviderBridge.safeProviderMessage("Invalid duration token-secret", java.util.Map.of("Authorization", "Bearer token-secret"));
        if (!diagnostic.equals("Invalid duration [redacted]")) throw new AssertionError(diagnostic);

        org.json.JSONObject original = new org.json.JSONObject().put("title", "Old").put("start_time", "2020-01-01T18:00:00Z").put("end_time", "2020-01-01T19:00:00Z").put("category", new org.json.JSONObject().put("id", "42"));
        org.json.JSONObject event = new org.json.JSONObject().put("title", "New").put("startAtUtc", "2020-01-01T18:00:00Z").put("endAtUtc", "2020-01-01T19:00:00Z").put("twitchCategoryId", "42");
        org.json.JSONObject patch = ProviderBridge.twitchSchedulePayload(event, original);
        if (!patch.getString("title").equals("New") || patch.has("start_time") || patch.has("duration") || patch.has("timezone") || patch.has("category_id")) throw new AssertionError("Recurring title PATCH overspecified: " + patch);
        event.put("endAtUtc", "2020-01-01T20:00:00Z");
        if (!ProviderBridge.twitchSchedulePayload(event, original).getString("duration").equals("120")) throw new AssertionError("Duration must be a string");

        org.json.JSONObject allDay=new org.json.JSONObject().put("id","event").put("localId","local").put("title","Jour").put("allDay",true).put("description","x".repeat(4000)).put("startAtUtc","2030-11-01T00:00:00Z").put("endAtUtc","2030-11-02T00:00:00Z");
        org.json.JSONObject payload=ProviderBridge.googlePlanningPayload(allDay);
        if(!payload.getJSONObject("start").getString("date").equals("2030-11-01")||payload.getJSONObject("start").has("dateTime"))throw new AssertionError("all-day flattened to time");
        if(payload.getString("description").length()!=4000)throw new AssertionError("description truncated");
        if(!payload.getJSONObject("extendedProperties").getJSONObject("private").getString("streamDashboardId").equals("local"))throw new AssertionError("identity missing");
        if(!ProviderBridge.googleRemoteId(allDay).equals("sd25bf8e1a2393f1108d37029b3df5593236c755742ec93465bbafa9b290bddcf6"))throw new AssertionError("Google ID differs from server SHA256");
        allDay.put("allDay",false).put("recurrence",new org.json.JSONObject().put("timeZone","Europe/Paris")).put("recurrenceLines",new org.json.JSONArray().put("RRULE:FREQ=WEEKLY;INTERVAL=1"));
        payload=ProviderBridge.googlePlanningPayload(allDay);
        if(!payload.getJSONObject("start").getString("timeZone").equals("Europe/Paris")||!payload.getJSONArray("recurrence").getString(0).startsWith("RRULE:"))throw new AssertionError("recurrence omitted");
        String resource="ajax/list/commands_list.php?t="+"a".repeat(64);
        if(!ProviderBridge.wizebotResource("ajax: '"+resource+"'").equals(resource))throw new AssertionError("WizeBot list discovery");
        try{ProviderBridge.wizebotResource("ajax: 'https://example.test/steal'");throw new AssertionError("External list URL accepted");}catch(Exception expected){}

        String widget="abcdefghijklmnopqrstuvwxyz123456";
        if(!StreamlabsCloudClient.widgetToken(widget).equals(widget)||!StreamlabsCloudClient.widgetToken("https://streamlabs.com/alert-box/v3?token="+widget).equals(widget)||!StreamlabsCloudClient.widgetToken("https://streamlabs.com/widgets/"+widget).equals(widget))throw new AssertionError("Widget token parsing");
        for(String invalid:new String[]{"https://example.test/?token="+widget,"http://streamlabs.com/?token="+widget,"https://streamlabs.com:444/?token="+widget,"https://name@streamlabs.com/?token="+widget,"https://streamlabs.com/?token="+widget+"&token="+widget,"https://streamlabs.com/widgets/"+widget+"?token=another_widget_abcdefghijklmnopqrstuvwxyz","socket-token"}){
          try{StreamlabsCloudClient.widgetToken(invalid);throw new AssertionError("Unsafe widget accepted");}catch(StreamlabsCloudClient.Failure expected){}
        }
        if(!StreamlabsCloudClient.accountKey(widget).matches("[a-f0-9]{64}")||StreamlabsCloudClient.accountKey(widget).equals(StreamlabsCloudClient.accountKey(widget+"x")))throw new AssertionError("Streamlabs account isolation");
        org.json.JSONObject donor=new org.json.JSONObject().put("type","donation").put("platform","streamlabs").put("_id","event1").put("display_name","Alice").put("amount",3).put("currency","EUR").put("message","Bravo").put("email","private@example.test").put("oauth_token","should-not-cross").put("donor",new org.json.JSONObject().put("email","hidden@example.test"));
        org.json.JSONObject widgetRow=new org.json.JSONObject().put("type","rollendcredits").put("platform","twitch_account").put("_id","noise");
        org.json.JSONObject rawHistory=new org.json.JSONObject().put("access_token","secret-top").put("data",new org.json.JSONObject().put("donations",new org.json.JSONArray().put(donor).put("malformed")).put("follows",new org.json.JSONArray().put(widgetRow)).put("credentials",new org.json.JSONObject().put("token","secret-nested")));
        org.json.JSONObject cleanHistory=StreamlabsCloudClient.publicPayload(rawHistory),cleanData=cleanHistory.getJSONObject("data"),cleanDonor=cleanData.getJSONArray("donations").getJSONObject(0);
        if(cleanHistory.has("access_token")||cleanData.has("credentials")||cleanDonor.has("email")||cleanDonor.has("oauth_token")||cleanDonor.has("donor"))throw new AssertionError("Streamlabs private fields crossed native boundary");
        if(cleanData.getJSONArray("donations").length()!=1||cleanData.getJSONArray("follows").length()!=0||!cleanDonor.getString("message").equals("Bravo")||!cleanDonor.opt("amount").equals(3))throw new AssertionError("Public activity lost or widget noise retained");
        try{StreamlabsCloudClient.publicPayload(new org.json.JSONObject().put("data",new org.json.JSONObject().put("token","secret")));throw new AssertionError("Invalid history treated as success");}catch(StreamlabsCloudClient.Failure expected){}

        for (String code : new String[]{"INVALID_PAYLOAD", "INVALID_LINK", "REAUTH_REQUIRED", "HTTP_400", "HTTP_401", "HTTP_403", "HTTP_404", "HTTP_405", "HTTP_410", "HTTP_412", "HTTP_413", "HTTP_415", "HTTP_422", "HTTP_429"}) {
          if (!ProviderBridge.isDefinitiveNonCreation(code)) throw new AssertionError(code);
        }
        for (String code : new String[]{"NETWORK", "HTTP_408", "HTTP_409", "HTTP_500", "HTTP_503", "CONFLICT", "CREATE_UNCERTAIN", "INTERNAL"}) {
          if (ProviderBridge.isDefinitiveNonCreation(code)) throw new AssertionError(code);
        }
        java.lang.reflect.Method iso = ProviderBridge.class.getDeclaredMethod("iso", String.class);
        iso.setAccessible(true);
        try { iso.invoke(null, "not-a-date"); throw new AssertionError("Invalid date accepted"); }
        catch (java.lang.reflect.InvocationTargetException error) {
          java.lang.reflect.Field code = error.getCause().getClass().getDeclaredField("code");
          code.setAccessible(true);
          if (!code.get(error.getCause()).equals("INVALID_PAYLOAD")) throw new AssertionError("Lost validation evidence");
        }

        for (String provider : new String[]{"google", "twitch"}) {
          for (String code : new String[]{"HTTP_404", "HTTP_410", "HTTP_403", "HTTP_500", "CONFLICT", "NETWORK", "REAUTH_REQUIRED"}) {
            boolean expected = code.equals("HTTP_404") || (provider.equals("google") && code.equals("HTTP_410"));
            if (ProviderBridge.isAbsentPlanningDelete(provider, code) != expected) throw new AssertionError(provider + ":" + code);
          }
        }
      }
    }`,
    'MainActivity.java': `package ${pkg}; class MainActivity extends android.app.Activity { void dispatchProviderAuth(String p,boolean c) {} void dispatchProviderResult(String id,String result) {} }`,
    'DeepLinkRouter.java': `package ${pkg}; class DeepLinkRouter { enum Route { OAUTH } static Route route(String s) { return null; } }`,
  };
  try {
    const files = Object.entries(stubs).map(([name, source]) => {
      const file = path.join(directory, name);
      mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, source); return file;
    });
    execFileSync('javac', ['-d', path.join(directory, 'classes'), ...files, 'android/app/src/main/java/com/rastaaslan/streamdashboard/remote/ProviderBridge.java', 'android/app/src/main/java/com/rastaaslan/streamdashboard/remote/GoogleAuthorizationFlow.java', 'android/app/src/main/java/com/rastaaslan/streamdashboard/remote/StreamlabsCloudClient.java'], { stdio: 'inherit' });
    execFileSync('java', ['-cp', path.join(directory, 'classes'), pkg + '.DeletionPolicyTest'], { stdio: 'inherit' });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
