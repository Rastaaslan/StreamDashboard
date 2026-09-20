package com.rastaaslan.streamdashboard.remote;

import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
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
import androidx.core.app.NotificationCompat;
import androidx.core.content.FileProvider;
import androidx.webkit.WebViewAssetLoader;
import java.io.ByteArrayInputStream;
import java.net.URLConnection;
import java.util.Collections;
import java.io.File;
import java.io.FileOutputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

public class MainActivity extends Activity {
  private static final String APP_HOST = WebViewAssetLoader.DEFAULT_DOMAIN;
  // HTTP is intentionally retained for the local app origin so the WebView can
  // still reach the authenticated cleartext LAN Runtime without mixed-content exceptions.
  private static final String ORIGIN = "http://" + APP_HOST;
  private static final String PING_CHANNEL_ID = "streamer-pings";
  private static final int NOTIFICATION_PERMISSION_REQUEST = 7001;
  private WebView webView;
  private ProviderBridge providerBridge;
  private WebViewAssetLoader assetLoader;
  private Uri pendingDeepLink;
  private boolean pageReady = false;

  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    getWindow().setStatusBarColor(Color.rgb(9, 9, 20));
    webView = new WebView(this);
    WebSettings settings = webView.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setAllowFileAccess(false);
    settings.setAllowContentAccess(false);
    settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    settings.setSupportMultipleWindows(false);
    assetLoader = new WebViewAssetLoader.Builder()
      .setDomain(APP_HOST)
      .setHttpAllowed(true)
      .addPathHandler("/mobile/", this::localAsset)
      .build();
    webView.addJavascriptInterface(new NativeBridge(), "StreamDashboardNative");
    if (!BuildConfig.PREVIEW_MODE) {
      providerBridge = new ProviderBridge(this);
      webView.addJavascriptInterface(providerBridge, "StreamDashboardProviders");
    }
    webView.setWebChromeClient(new WebChromeClient());
    webView.setWebViewClient(new LocalOnlyClient());
    setContentView(webView);
    ensurePingNotifications();
    captureDeepLink(getIntent());
    webView.loadUrl(ORIGIN + "/mobile/index.html");
  }

  @Override protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    captureDeepLink(intent);
    deliverPendingDeepLink();
  }

  @Override protected void onResume() {
    super.onResume();
    deliverPendingDeepLink();
    if (pageReady) webView.evaluateJavascript("document.dispatchEvent(new Event('visibilitychange'))", null);
  }

  private void ensurePingNotifications() {
    if (BuildConfig.PREVIEW_MODE) return;
    NotificationManager manager = (NotificationManager)getSystemService(NOTIFICATION_SERVICE);
    if (manager != null && Build.VERSION.SDK_INT >= 26) {
      NotificationChannel channel = new NotificationChannel(PING_CHANNEL_ID, "Streamer Pings", NotificationManager.IMPORTANCE_HIGH);
      channel.setDescription("Récompenses Twitch et rappels importants pendant le live");
      manager.createNotificationChannel(channel);
    }
    if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
      requestPermissions(new String[]{ Manifest.permission.POST_NOTIFICATIONS }, NOTIFICATION_PERMISSION_REQUEST);
    }
  }

  @Override public void onBackPressed() {
    if (!pageReady) { super.onBackPressed(); return; }
    webView.evaluateJavascript(
      "Boolean(window.StreamDashboardHandleBack && window.StreamDashboardHandleBack())",
      handled -> {
        if ("true".equals(handled)) return;
        if (webView.canGoBack()) webView.goBack(); else MainActivity.super.onBackPressed();
      }
    );
  }

  private void captureDeepLink(Intent intent) {
    if (BuildConfig.PREVIEW_MODE) return;
    Uri data = intent == null ? null : intent.getData();
    if (data == null) return;
    if (DeepLinkRouter.route(data.toString()) != DeepLinkRouter.Route.INVALID) pendingDeepLink = data;
    intent.setData(null);
  }

  private void deliverPendingDeepLink() {
    if (!pageReady || pendingDeepLink == null) return;
    Uri data = pendingDeepLink;
    pendingDeepLink = null;
    DeepLinkRouter.Route route = DeepLinkRouter.route(data.toString());
    if (route == DeepLinkRouter.Route.PAIR) {
      String quoted = org.json.JSONObject.quote(data.toString());
      webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('native-pairing',{detail:" + quoted + "}))", null);
    } else if (route == DeepLinkRouter.Route.OAUTH && providerBridge != null) {
      providerBridge.acceptOAuthCallback(data);
    }
  }

  void dispatchProviderAuth(String provider, boolean connected) {
    if (BuildConfig.PREVIEW_MODE || !pageReady) return;
    webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('provider-auth',{detail:{provider:"+org.json.JSONObject.quote(provider)+",connected:"+connected+"}}))",null);
  }

  private WebResourceResponse localAsset(String relativePath) {
    String asset = "public/" + relativePath;
    if (asset.endsWith("/")) asset += "index.html";
    try {
      InputStream stream = getAssets().open(asset);
      String mime = URLConnection.guessContentTypeFromName(asset);
      if (mime == null) mime = asset.endsWith(".js") ? "application/javascript" : "text/plain";
      return new WebResourceResponse(mime, "UTF-8", stream);
    } catch (Exception ignored) {
      return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }
  }

  private final class LocalOnlyClient extends WebViewClient {
    @Override public void onPageFinished(WebView view, String url) {
      Uri uri = Uri.parse(url);
      if (APP_HOST.equals(uri.getHost()) && uri.getPath() != null && uri.getPath().startsWith("/mobile/")) {
        pageReady = true;
        deliverPendingDeepLink();
      }
    }

    @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
      Uri uri = request.getUrl();
      if (APP_HOST.equals(uri.getHost())) {
        if (uri.getPath() != null && uri.getPath().startsWith("/mobile/")) return assetLoader.shouldInterceptRequest(uri);
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
      }
      return null;
    }

    @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
      Uri uri = request.getUrl();
      return !("http".equals(uri.getScheme()) && APP_HOST.equals(uri.getHost()) && uri.getPath() != null && uri.getPath().startsWith("/mobile/"));
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
    @JavascriptInterface public void openExternal(String value) {
      try {
        Uri uri = Uri.parse(value);
        if (!"https".equalsIgnoreCase(uri.getScheme())) return;
        runOnUiThread(() -> {
          try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
          catch (Exception ignored) { }
        });
      } catch (Exception ignored) { }
    }
    @JavascriptInterface public void copyText(String label, String value) {
      if (value == null || value.length() > 500) return;
      runOnUiThread(() -> {
        ClipboardManager clipboard = (ClipboardManager)getSystemService(CLIPBOARD_SERVICE);
        if (clipboard != null) clipboard.setPrimaryClip(ClipData.newPlainText(label == null ? "StreamDashboard" : label, value));
      });
    }
    @JavascriptInterface public void notifyStreamerPing(String id, String title, String message) {
      if (BuildConfig.PREVIEW_MODE) return;
      if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
      String safeId = id == null ? "" : id;
      String safeTitle = title == null || title.isBlank() ? "Streamer Ping" : title.substring(0, Math.min(120, title.length()));
      String safeMessage = message == null ? "" : message.substring(0, Math.min(500, message.length()));
      Intent launch = new Intent(MainActivity.this, MainActivity.class)
        .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
      PendingIntent pending = PendingIntent.getActivity(MainActivity.this, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
      NotificationCompat.Builder notification = new NotificationCompat.Builder(MainActivity.this, PING_CHANNEL_ID)
        .setSmallIcon(R.drawable.ic_launcher)
        .setContentTitle(safeTitle)
        .setContentText(safeMessage)
        .setStyle(new NotificationCompat.BigTextStyle().bigText(safeMessage))
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setAutoCancel(true)
        .setContentIntent(pending);
      NotificationManager manager = (NotificationManager)getSystemService(NOTIFICATION_SERVICE);
      if (manager != null) manager.notify(safeId.hashCode() & 0x7fffffff, notification.build());
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
