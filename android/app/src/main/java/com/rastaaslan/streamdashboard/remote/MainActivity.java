package com.rastaaslan.streamdashboard.remote;

import android.app.Activity;
import android.content.Intent;
import android.content.ClipData;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.InputStream;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.FileOutputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

public class MainActivity extends Activity {
  private static final String ORIGIN = "http://localhost";
  private WebView webView;
  private ProviderBridge providerBridge;

  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    getWindow().setStatusBarColor(Color.rgb(9, 9, 20));
    webView = new WebView(this);
    WebSettings settings = webView.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setAllowFileAccess(false);
    settings.setAllowContentAccess(false);
    settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
    settings.setSupportMultipleWindows(false);
    webView.addJavascriptInterface(new NativeBridge(), "StreamDashboardNative");
    providerBridge = new ProviderBridge(this);
    webView.addJavascriptInterface(providerBridge, "StreamDashboardProviders");
    webView.setWebViewClient(new LocalOnlyClient());
    setContentView(webView);
    webView.loadUrl(ORIGIN + "/mobile/index.html");
  }

  @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); deliverPairingLink(); deliverOAuthLink(); }
  @Override protected void onResume() { super.onResume(); deliverPairingLink(); deliverOAuthLink(); webView.evaluateJavascript("document.dispatchEvent(new Event('visibilitychange'))", null); }
  @Override public void onBackPressed() { if (webView.canGoBack()) webView.goBack(); else super.onBackPressed(); }

  private void deliverPairingLink() {
    Uri data = getIntent().getData();
    if (data != null && "streamdashboard".equals(data.getScheme())) {
      String quoted = org.json.JSONObject.quote(data.toString());
      webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('native-pairing',{detail:" + quoted + "}))", null);
      getIntent().setData(null);
    }
  }
  private void deliverOAuthLink() { Uri data=getIntent().getData(); if(data!=null&&"streamdashboard".equals(data.getScheme())&&"oauth".equals(data.getHost())){providerBridge.acceptOAuthCallback(data);getIntent().setData(null);} }
  void dispatchProviderAuth(String provider, boolean connected) { webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('provider-auth',{detail:{provider:"+org.json.JSONObject.quote(provider)+",connected:"+connected+"}}))",null); }

  private final class LocalOnlyClient extends WebViewClient {
    @Override public void onPageFinished(WebView view, String url) { deliverPairingLink(); }
    @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
      Uri uri = request.getUrl();
      if ("localhost".equals(uri.getHost()) && uri.getPath().startsWith("/mobile/")) {
        String asset = "public/" + uri.getPath().substring("/mobile/".length());
        if (asset.endsWith("/")) asset += "index.html";
        try {
          InputStream stream = getAssets().open(asset);
          String mime = asset.endsWith(".html") ? "text/html" : asset.endsWith(".css") ? "text/css" : asset.endsWith(".png") ? "image/png" : "application/javascript";
          return new WebResourceResponse(mime, "UTF-8", stream);
        } catch (Exception ignored) { return null; }
      }
      return null;
    }
    @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
      Uri uri = request.getUrl();
      return !("http".equals(uri.getScheme()) && "localhost".equals(uri.getHost()) && uri.getPath().startsWith("/mobile/"));
    }
  }

  public final class NativeBridge {
    private static final String ALIAS = "streamdashboard.remote.credential";
    private static final String PREFS = "secure_remote";
    @JavascriptInterface public boolean isAndroid() { return true; }
    @JavascriptInterface public String getCredential() {
      try {
        String blob = getSharedPreferences(PREFS, MODE_PRIVATE).getString("credential", "");
        if (blob.isEmpty()) return "";
        String[] values = blob.split("\\.", 2);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(values[0], Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(values[1], Base64.NO_WRAP)), java.nio.charset.StandardCharsets.UTF_8);
      } catch (Exception ignored) { clearCredential(); return ""; }
    }
    @JavascriptInterface public void setCredential(String value) {
      try {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        String blob = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + "." + Base64.encodeToString(cipher.doFinal(value.getBytes(java.nio.charset.StandardCharsets.UTF_8)), Base64.NO_WRAP);
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString("credential", blob).apply();
      } catch (Exception ignored) { clearCredential(); }
    }
    @JavascriptInterface public void clearCredential() { getSharedPreferences(PREFS, MODE_PRIVATE).edit().remove("credential").apply(); }
    @JavascriptInterface public void setKeepAwake(boolean enabled) { runOnUiThread(() -> { if (enabled) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); }); }
    @JavascriptInterface public void haptic(String strength) {
      Vibrator vibrator = (Vibrator)getSystemService(VIBRATOR_SERVICE);
      if (vibrator != null) vibrator.vibrate(VibrationEffect.createOneShot("strong".equals(strength) ? 45 : 18, VibrationEffect.DEFAULT_AMPLITUDE));
    }
    @JavascriptInterface public String shareImage(String encodedPng, String requestedName, String mimeType) {
      if (!"image/png".equals(mimeType)) return "Type d’image refusé.";
      if (encodedPng == null || encodedPng.length() > 14_000_000) return "Image trop volumineuse.";
      try {
        String payload = encodedPng.startsWith("data:image/png;base64,") ? encodedPng.substring(22) : encodedPng;
        byte[] png = Base64.decode(payload, Base64.DEFAULT);
        if (png.length == 0 || png.length > 10_000_000) return "Image PNG invalide ou trop volumineuse.";
        String safeName = requestedName == null ? "planning.png" : requestedName.replaceAll("[^A-Za-z0-9._-]", "-");
        if (!safeName.toLowerCase(java.util.Locale.ROOT).endsWith(".png")) safeName += ".png";
        if (safeName.length() > 80) safeName = safeName.substring(safeName.length() - 80);
        File shared = new File(getCacheDir(), "shared");
        if (!shared.exists() && !shared.mkdirs()) return "Cache de partage indisponible.";
        File[] oldExports = shared.listFiles();
        if (oldExports != null) for (File oldExport : oldExports) if (oldExport.isFile()) oldExport.delete();
        File image = new File(shared, safeName);
        try (FileOutputStream output = new FileOutputStream(image)) { output.write(png); }
        Uri contentUri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".fileprovider", image);
        Intent send = new Intent(Intent.ACTION_SEND).setType("image/png").putExtra(Intent.EXTRA_STREAM, contentUri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        send.setClipData(ClipData.newRawUri("Planning StreamDashboard", contentUri));
        AtomicReference<String> launchError = new AtomicReference<>("");
        CountDownLatch launched = new CountDownLatch(1);
        runOnUiThread(() -> { try { startActivity(Intent.createChooser(send, "Partager le planning")); } catch (Exception error) { launchError.set("Impossible d’ouvrir le partage Android."); } finally { launched.countDown(); } });
        if (!launched.await(3, TimeUnit.SECONDS)) return "Impossible d’ouvrir le partage Android.";
        return launchError.get();
      } catch (Exception error) {
        return "Impossible d’ouvrir le partage Android.";
      }
    }
    private SecretKey key() throws Exception {
      KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
      if (!store.containsAlias(ALIAS)) {
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
      }
      return (SecretKey)store.getKey(ALIAS, null);
    }
  }
}
