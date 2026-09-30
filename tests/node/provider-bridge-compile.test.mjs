import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';

// Signature-only stubs: this checks Java compilation, not Android/OAuth runtime behavior.
test('ProviderBridge compiles with javac and accepts only idempotent deletion responses', t => {
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
      public JSONObject() {} public JSONObject(String s) throws JSONException {}
      public JSONObject put(String k,Object v) throws JSONException { return this; }
      public String getString(String k) throws JSONException { return ""; }
      public String optString(String k) { return ""; } public String optString(String k,String d) { return d; }
      public long optLong(String k) { return 0; } public long optLong(String k,long d) { return d; }
      public boolean optBoolean(String k) { return false; } public boolean has(String k) { return false; }
      public JSONObject getJSONObject(String k) throws JSONException { return this; }
      public JSONObject optJSONObject(String k) { return this; }
      public JSONArray getJSONArray(String k) throws JSONException { return null; }
      public JSONArray optJSONArray(String k) { return null; }
    }`,
    'org/json/JSONArray.java': 'package org.json; public class JSONArray { public JSONArray put(Object v) { return this; } public int length() { return 0; } public String getString(int i) throws JSONException { return ""; } public JSONObject getJSONObject(int i) throws JSONException { return null; } }',
    'SecureCredentialStore.java': `package ${pkg}; class SecureCredentialStore { SecureCredentialStore(android.app.Activity a) {} String get(String k) { return ""; } void put(String k,String v) {} void clear(String k) {} }`,
    'BuildConfig.java': `package ${pkg}; class BuildConfig { static final String TWITCH_ANDROID_CLIENT_ID="", GOOGLE_ANDROID_CLIENT_ID=""; static final boolean PREVIEW_MODE=false; }`,
    'GoogleAuthorizationAdapter.java': `package ${pkg}; class GoogleAuthorizationAdapter implements GoogleAuthorizationFlow.Adapter {
      GoogleAuthorizationAdapter(android.app.Activity activity) {}
      public void authorize(java.util.List<String> scopes, GoogleAuthorizationFlow.Callback callback) {}
      public void launch(Object resolution, int requestCode) {}
      public GoogleAuthorizationFlow.Grant result(Object data) { return null; }
      public GoogleAuthorizationFlow.Grant refresh(java.util.List<String> scopes) { return null; }
    }`,
    'DeletionPolicyTest.java': `package ${pkg}; public class DeletionPolicyTest {
      public static void main(String[] args) throws Exception {
        String diagnostic = ProviderBridge.safeProviderMessage("Invalid duration token-secret", java.util.Map.of("Authorization", "Bearer token-secret"));
        if (!diagnostic.equals("Invalid duration [redacted]")) throw new AssertionError(diagnostic);

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
    'MainActivity.java': `package ${pkg}; class MainActivity extends android.app.Activity { void dispatchProviderAuth(String p,boolean c) {} }`,
    'DeepLinkRouter.java': `package ${pkg}; class DeepLinkRouter { enum Route { OAUTH } static Route route(String s) { return null; } }`,
  };
  try {
    const files = Object.entries(stubs).map(([name, source]) => {
      const file = path.join(directory, name);
      mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, source); return file;
    });
    execFileSync('javac', ['-d', path.join(directory, 'classes'), ...files, 'android/app/src/main/java/com/rastaaslan/streamdashboard/remote/ProviderBridge.java', 'android/app/src/main/java/com/rastaaslan/streamdashboard/remote/GoogleAuthorizationFlow.java'], { stdio: 'inherit' });
    execFileSync('java', ['-cp', path.join(directory, 'classes'), pkg + '.DeletionPolicyTest'], { stdio: 'inherit' });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
