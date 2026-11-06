package com.rastaaslan.streamdashboard.remote;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.AtomicFile;
import java.io.*;
import java.security.MessageDigest;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.ZipFile;
import org.json.JSONArray;
import org.json.JSONObject;

/** Platform adapter only. System PackageInstaller owns replacement, signature
 * verification and preservation of this app's data/keystore. No root, uninstall,
 * downgrade, backup restore, provider command or automatic recommit.
 */
final class NativeUpdateManager implements AutoCloseable {
  static final int PICK_APK = 731;
  private final MainActivity activity;
  private final File directory, apk;
  private final AtomicFile record;
  private final ExecutorService worker = Executors.newSingleThreadExecutor();
  private boolean dialogOpen;
  private volatile boolean busy, closed;
  private static final Object RECORD_LOCK = new Object();
  private String challenge;
  private long challengeTime;
  private Runnable afterSafety;
  NativeUpdateManager(MainActivity activity) {
    this.activity = activity;
    directory = new File(activity.getNoBackupFilesDir(), "prepared-update");
    apk = new File(directory, "candidate.apk");
    record = new AtomicFile(new File(directory, "receipt.json"));
  }
  private static byte[] bounded(InputStream input, int limit) throws Exception {
    ByteArrayOutputStream bytes = new ByteArrayOutputStream();
    byte[] buffer = new byte[8192]; int count;
    while ((count = input.read(buffer)) != -1) {
      if (bytes.size() + count > limit) throw new IOException();
      bytes.write(buffer, 0, count);
    }
    return bytes.toByteArray();
  }
  void observe() {
    if (closed || busy) return;
    busy = true;
    worker.execute(() -> { try { reconcile(); } catch (Exception ignored) {} finally { busy = false; } });
  }
  static String hash(File file) throws Exception {
    MessageDigest digest = MessageDigest.getInstance("SHA-256");
    try (InputStream input = new FileInputStream(file)) {
      byte[] buffer = new byte[65536]; int n;
      while ((n = input.read(buffer)) != -1) digest.update(buffer, 0, n);
    }
    StringBuilder value = new StringBuilder();
    for (byte b : digest.digest()) value.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
    return value.toString();
  }
  private static long code(PackageInfo info) {
    return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
  }
  private static String[] signers(PackageInfo info) throws Exception {
    Signature[] signatures = Build.VERSION.SDK_INT >= 28 ?
        (info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners()) : info.signatures;
    if (signatures == null || signatures.length == 0) throw new IOException();
    String[] result = new String[signatures.length];
    for (int i = 0; i < signatures.length; i++) {
      byte[] digest = MessageDigest.getInstance("SHA-256").digest(signatures[i].toByteArray());
      StringBuilder text = new StringBuilder();
      for (byte b : digest) text.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
      result[i] = text.toString();
    }
    return result;
  }
  private int flags() {
    return Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
  }
  private PackageInfo installed() throws Exception {
    return activity.getPackageManager().getPackageInfo(activity.getPackageName(), flags());
  }
  private JSONObject read() throws Exception { synchronized (RECORD_LOCK) {
    try (InputStream input = record.openRead()) {
      byte[] bytes = bounded(input, 32768);
      if (bytes.length > 32768) throw new IOException();
      JSONObject value = new JSONObject(new String(bytes, java.nio.charset.StandardCharsets.UTF_8));
      if (value.getInt("schema") != 1 || !value.getString("package").equals(activity.getPackageName()) ||
          !value.getString("sha256").matches("[a-f0-9]{64}")) throw new IOException();
      return value;
    } catch (FileNotFoundException absent) { return null; }
  }}
  private void save(JSONObject value) throws Exception { synchronized (RECORD_LOCK) {
    if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException();
    FileOutputStream output = record.startWrite();
    try {
      output.write(value.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
      record.finishWrite(output);
    } catch (Exception error) { record.failWrite(output); throw error; }
    if (!value.toString().equals(read().toString())) throw new IOException();
  }}
  private void ui(Runnable action) { activity.runOnUiThread(() -> { if (!closed && !activity.isFinishing() && !activity.isDestroyed()) action.run(); }); }
  private void message(String text) {
    ui(() -> new AlertDialog.Builder(activity).setTitle("Mise à jour Android").setMessage(text).setPositiveButton("Fermer", null).show());
  }
  void open() {
    if (BuildConfig.PREVIEW_MODE || closed || busy || dialogOpen) return;
    busy = true;
    worker.execute(() -> {
      try {
        JSONObject value = reconcile();
        ui(() -> { busy = false; show(value); });
      } catch (Exception error) { busy = false; message("Lecture du suivi impossible. Aucune installation ni nouvelle tentative automatique."); }
    });
  }
  private void show(JSONObject value) {
    if (dialogOpen) return;
    String phase = value == null ? "" : value.optString("phase");
    if (!AndroidUpdatePolicy.canPrepare(phase)) {
      message("Résultat de l’installation encore inconnu. Le paquet ne sera pas renvoyé. Relancez l’application pour relire la version installée ou consultez l’installateur Android. Les données sont conservées.");
      return;
    }
    dialogOpen = true;
    AlertDialog.Builder dialog = new AlertDialog.Builder(activity).setTitle("Mise à jour Android");
    if (value != null && ("prepared".equals(phase) || "deferred".equals(phase))) {
      dialog.setMessage("Version préparée : " + value.optString("version") + "\n" + value.optString("sha256") +
          "\n\nInstallation sur place, uniquement hors live. Android vérifie la signature avant remplacement. Aucun retour à une version de code inférieure ; récupération par correctif ultérieur du même signataire.");
      dialog.setPositiveButton("Installer hors live", (d, w) -> requestConsent(value));
      dialog.setNeutralButton("Choisir un autre APK", (d, w) -> choose());
      dialog.setNegativeButton("Reporter", (d, w) -> worker.execute(() -> { try { value.put("phase", "deferred"); save(value); } catch (Exception ignored) {} }));
    } else {
      dialog.setMessage(("superseded".equals(phase) ? "Une version supérieure du même signataire est installée ; la tentative précédente reste conservée sans renvoi.\n\n" : "") + ("installed".equals(phase) ? "Version et APK installés confirmés après relecture.\n\n" : "") +
          "Choisissez un APK de cette application, de version supérieure et signé comme l’installation actuelle. Les comptes, associations et journaux restent dans les données de l’application. Aucun effacement ni désinstallation.");
      dialog.setPositiveButton("Choisir un APK", (d, w) -> choose()).setNegativeButton("Fermer", null);
    }
    dialog.setOnDismissListener(d -> dialogOpen = false).show();
  }
  private void choose() {
    try {
      activity.startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
          .setType("application/vnd.android.package-archive"), PICK_APK);
    } catch (Exception error) { message("Sélecteur de fichier indisponible."); }
  }
  void selected(Uri uri) {
    if (closed || busy || uri == null || !"content".equals(uri.getScheme())) return;
    busy = true;
    worker.execute(() -> {
      try {
        JSONObject previous = read();
        if (!AndroidUpdatePolicy.canPrepare(previous == null ? "" : previous.optString("phase"))) throw new IOException();
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException();
        File temporary = new File(directory, "incoming.apk");
        try (InputStream input = activity.getContentResolver().openInputStream(uri); FileOutputStream output = new FileOutputStream(temporary)) {
          if (input == null) throw new IOException();
          byte[] buffer = new byte[65536]; int n; long size = 0;
          while ((n = input.read(buffer)) != -1) { size += n; if (size > 256L * 1024 * 1024) throw new IOException(); output.write(buffer, 0, n); }
          output.getFD().sync();
        }
        PackageInfo current = installed(), candidate = activity.getPackageManager().getPackageArchiveInfo(temporary.getPath(), flags());
        if (candidate == null || !AndroidUpdatePolicy.sameIdentity(current.packageName, candidate.packageName, signers(current), signers(candidate)) ||
            code(candidate) <= code(current) || candidate.versionName == null) throw new IOException();
        JSONObject provenance;
        try (ZipFile zip = new ZipFile(temporary)) {
          java.util.zip.ZipEntry entry = zip.getEntry("assets/public/streamcockpit-build.json");
          if (entry == null || entry.getSize() < 1 || entry.getSize() > 16384) throw new IOException();
          try (InputStream input = zip.getInputStream(entry)) {
            provenance = new JSONObject(new String(bounded(input, 16384), java.nio.charset.StandardCharsets.UTF_8));
          }
        }
        if (!provenance.getString("sourceCommit").matches("[a-f0-9]{40}") || provenance.getBoolean("sourceTreeDirty") ||
            !provenance.getString("sourceTreeSha256").matches("[a-f0-9]{64}") ||
            !candidate.versionName.equals(provenance.getString("version") + ("qa".equals(BuildConfig.BUILD_TYPE) ? "-qa" : ""))) throw new IOException();
        String digest = hash(temporary);
        // The old record still pins its exact bytes if replacement is interrupted.
        java.nio.file.Files.move(temporary.toPath(), apk.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        if (!digest.equals(hash(apk))) throw new IOException();
        JSONObject next = new JSONObject().put("schema", 1).put("package", candidate.packageName).put("code", code(candidate))
            .put("fromCode", code(current)).put("version", candidate.versionName).put("sha256", digest).put("signers", new JSONArray(signers(candidate)))
            .put("sourceCommit", provenance.getString("sourceCommit")).put("dataDirectory", new File(activity.getApplicationInfo().dataDir).getCanonicalPath())
            .put("phase", "prepared").put("sessionId", -1);
        save(next);
        ui(() -> { busy = false; show(next); });
      } catch (Exception error) { busy = false; message("APK refusé : identité, signature déclarée, version, provenance ou fichier incompatible. Aucune installation effectuée."); }
    });
  }
  private void requestConsent(JSONObject value) {
    if (!activity.getPackageManager().canRequestPackageInstalls()) {
      new AlertDialog.Builder(activity).setTitle("Autorisation Android requise")
          .setMessage("Autorisez cette application à demander une installation, puis revenez choisir explicitement Installer hors live. Aucun lancement automatique.")
          .setPositiveButton("Ouvrir les réglages", (d, w) -> {
            try { activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName()))); }
            catch (Exception error) { message("Réglages Android indisponibles."); }
          }).setNegativeButton("Reporter", null).show();
      return;
    }
    challenge = UUID.randomUUID().toString(); challengeTime = android.os.SystemClock.elapsedRealtime();
    afterSafety = () -> commit(value);
    activity.requestUpdateSafety(challenge);
  }
  void safety(String id, boolean safe) {
    activity.runOnUiThread(() -> {
      if (challenge == null || !challenge.equals(id)) return;
      Runnable action = afterSafety; challenge = null; afterSafety = null;
      if (!safe || android.os.SystemClock.elapsedRealtime() - challengeTime > 5000) {
        message("Installation reportée : la régie doit confirmer un état hors live frais. Revenez ici après la diffusion."); return;
      }
      if (action != null) action.run();
    });
  }
  private void commit(JSONObject prepared) {
    if (busy || closed) return;
    busy = true;
    worker.execute(() -> {
      PackageInstaller.Session session = null;
      try {
        JSONObject value = read();
        PackageInfo current = installed(), candidate = activity.getPackageManager().getPackageArchiveInfo(apk.getPath(), flags());
        if (value == null || !value.getString("sha256").equals(prepared.getString("sha256")) || !value.getString("sha256").equals(hash(apk)) ||
            candidate == null || code(candidate) != value.getLong("code") ||
            !AndroidUpdatePolicy.sameIdentity(current.packageName, candidate.packageName, signers(current), signers(candidate)) ||
            !AndroidUpdatePolicy.canCommit(value.getString("phase"), code(current), code(candidate),
                android.os.SystemClock.elapsedRealtime() - challengeTime <= 5000, true)) throw new IOException();
        PackageInstaller installer = activity.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(activity.getPackageName());
        if (Build.VERSION.SDK_INT >= 31) params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED);
        // Record the attempted effect BEFORE session creation: an ambiguous create
        // cannot be retried after a process exit.
        if (closed) throw new IOException();
        value.put("phase", "committing"); save(value);
        int sessionId = installer.createSession(params);
        value.put("sessionId", sessionId); save(value);
        session = installer.openSession(sessionId);
        try (InputStream input = new FileInputStream(apk); OutputStream output = session.openWrite("base.apk", 0, apk.length())) {
          byte[] buffer = new byte[65536]; int n;
          while ((n = input.read(buffer)) != -1) output.write(buffer, 0, n);
          session.fsync(output);
        }
        if (!value.getString("sha256").equals(hash(apk))) throw new IOException();
        Intent result = new Intent(activity, UpdateResultReceiver.class).setAction(activity.getPackageName() + ".UPDATE_RESULT");
        int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
        PendingIntent receiver = PendingIntent.getBroadcast(activity, sessionId, result, pendingFlags);
        value.put("phase", "committed"); save(value);
        if (closed || android.os.SystemClock.elapsedRealtime() - challengeTime > 5000) throw new IOException();
        session.commit(receiver.getIntentSender());
      } catch (Exception error) { message("Installation non confirmée. Aucun renvoi automatique du paquet. Le suivi sera relu au prochain démarrage."); }
      finally { if (session != null) session.close(); busy = false; }
    });
  }
  private JSONObject reconcile() throws Exception {
    JSONObject value = read(); if (value == null) return null;
    PackageInfo actual = installed();
    String[] expected = new String[value.getJSONArray("signers").length()];
    for (int i = 0; i < expected.length; i++) expected[i] = value.getJSONArray("signers").getString(i);
    if (code(actual) == value.getLong("code") && AndroidUpdatePolicy.confirmsInstall(value.getLong("code"), code(actual),
        value.getString("sha256"), hash(new File(activity.getApplicationInfo().sourceDir)),
        AndroidUpdatePolicy.sameIdentity(value.getString("package"), actual.packageName, expected, signers(actual)),
        value.getString("dataDirectory"), new File(activity.getApplicationInfo().dataDir).getCanonicalPath())) {
      value.put("phase", "installed"); save(value);
    } else if (AndroidUpdatePolicy.confirmsForwardRecovery(value.getLong("code"), code(actual),
        AndroidUpdatePolicy.sameIdentity(value.getString("package"), actual.packageName, expected, signers(actual)),
        value.getString("dataDirectory"), new File(activity.getApplicationInfo().dataDir).getCanonicalPath())) {
      // A separately consented HIGHER system-installed correction supersedes
      // this attempt. Retain its original hash/session, never claim it succeeded.
      value.put("phase", "superseded").put("forwardRecoveryCode", code(actual))
          .put("forwardRecoverySha256", hash(new File(activity.getApplicationInfo().sourceDir)));
      save(value);
    }
    return value;
  }
  static void result(android.content.Context context, Intent intent) { synchronized (RECORD_LOCK) {
    try {
      NativeUpdateManager active = MainActivity.activeUpdates;
      File directory = new File(context.getNoBackupFilesDir(), "prepared-update");
      AtomicFile record = new AtomicFile(new File(directory, "receipt.json"));
      JSONObject value;
      try (InputStream input = record.openRead()) { value = new JSONObject(new String(bounded(input, 32768), java.nio.charset.StandardCharsets.UTF_8)); }
      if (value.getInt("sessionId") != intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID, -2) ||
          !context.getPackageName().equals(value.getString("package"))) return;
      int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
      if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
        value.put("phase", "awaiting-user");
      } else if (status == PackageInstaller.STATUS_SUCCESS) {
        value.put("phase", "readback-required"); // A broadcast alone is never installation proof.
      } else value.put("phase", "failed");
      FileOutputStream output = record.startWrite();
      try { output.write(value.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8)); record.finishWrite(output); }
      catch (Exception error) { record.failWrite(output); throw error; }
      if (active != null && status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
        Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
        if (confirm != null) active.ui(() -> {
          try { active.activity.startActivity(confirm); }
          catch (Exception error) { active.message("Consentement système en attente. Consultez l’installateur Android ; aucun renvoi automatique."); }
        });
      } else if (active != null) active.message(status == PackageInstaller.STATUS_SUCCESS ?
          "Installation annoncée par Android. Relancez l’application pour confirmer la version, le paquet et la conservation du dossier de données." :
          "Android a refusé ou annulé l’installation. L’application et ses données restent en place. Choisissez explicitement un APK compatible pour récupérer.");
    } catch (Exception ignored) { /* Preserve uncertain evidence; never replay. */ }
  }}
  public void close() { closed = true; challenge = null; afterSafety = null; worker.shutdown(); }
}
