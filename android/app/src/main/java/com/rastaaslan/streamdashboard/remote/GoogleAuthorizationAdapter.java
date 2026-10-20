package com.rastaaslan.streamdashboard.remote;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.Intent;
import android.accounts.Account;
import android.accounts.AccountManager;
import com.google.android.gms.common.AccountPicker;
import com.google.android.gms.auth.api.identity.*;
import com.google.android.gms.common.api.Scope;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.tasks.Tasks;
import java.util.*;
import java.util.concurrent.TimeUnit;

/** Thin binding to Google Identity Services; no OAuth token is exposed to JavaScript. */
final class GoogleAuthorizationAdapter implements GoogleAuthorizationFlow.Adapter {
  private final Activity activity;
  private final String title;
  private final java.util.concurrent.atomic.AtomicInteger generation = new java.util.concurrent.atomic.AtomicInteger();
  private volatile GoogleAuthorizationFlow.Callback pickerCallback;
  private List<String> pickerScopes;
  private int pickerCode, pickerGeneration;
  private String pendingAccount = "";
  GoogleAuthorizationAdapter(Activity activity, String title) { this.activity = activity; this.title = title; }
  private AuthorizationRequest request(List<String> scopes, String account) {
    if (account == null || account.isEmpty()) throw new IllegalArgumentException("ACCOUNT_SELECTION_REQUIRED");
    List<Scope> requested = new ArrayList<>();
    for (String scope : scopes) requested.add(new Scope(scope));
    return AuthorizationRequest.builder().setAccount(new Account(account, "com.google"))
      .setOptOutIncludingGrantedScopes(true).setRequestedScopes(requested).build();
  }
  private GoogleAuthorizationFlow.Grant grant(AuthorizationResult result, String account) {
    return new GoogleAuthorizationFlow.Grant(result.getAccessToken(), result.getGrantedScopes(), result.hasResolution() ? result.getPendingIntent() : null, account);
  }
  public void authorize(List<String> scopes, GoogleAuthorizationFlow.Callback callback) {
    int attempt = generation.incrementAndGet();
    activity.runOnUiThread(() -> {
      if (attempt != generation.get()) return;
      try {
        pickerCallback = callback; pickerScopes = new ArrayList<>(scopes); pickerGeneration = attempt;
        pickerCode = GoogleAuthorizationFlow.nextRequestCode();
        Intent intent = AccountPicker.newChooseAccountIntent(new AccountPicker.AccountChooserOptions.Builder()
          .setAllowableAccountsTypes(Collections.singletonList("com.google"))
          .setAlwaysShowAccountPicker(true).setTitleOverrideText(title).build());
        activity.startActivityForResult(intent, pickerCode);
      } catch (Exception error) { pickerCallback = null; callback.failure(diagnostic(error)); }
    });
  }
  boolean acceptAccountResult(int requestCode, int resultCode, Intent data) {
    GoogleAuthorizationFlow.Callback callback = pickerCallback;
    if (requestCode != pickerCode || callback == null || pickerGeneration != generation.get()) return false;
    pickerCallback = null;
    int attempt = pickerGeneration;
    try {
      if (resultCode != Activity.RESULT_OK || data == null) throw new GoogleAuthorizationFlow.AuthException("CANCELED");
      String account = data.getStringExtra(AccountManager.KEY_ACCOUNT_NAME);
      if (account == null || account.isEmpty() || !"com.google".equals(data.getStringExtra(AccountManager.KEY_ACCOUNT_TYPE)))
        throw new GoogleAuthorizationFlow.AuthException("ACCOUNT_SELECTION_REQUIRED");
      pendingAccount = account;
      Identity.getAuthorizationClient(activity).authorize(request(pickerScopes, account))
        .addOnSuccessListener(result -> { if (attempt == generation.get()) callback.success(grant(result, account)); })
        .addOnFailureListener(error -> { if (attempt == generation.get()) callback.failure(diagnostic(error)); });
    } catch (Exception error) { callback.failure(error instanceof GoogleAuthorizationFlow.AuthException ? error : diagnostic(error)); }
    return true;
  }
  public void cancel() { generation.incrementAndGet(); pickerCallback = null; }
  public void launch(Object resolution, int requestCode) throws Exception {
    activity.startIntentSenderForResult(((PendingIntent)resolution).getIntentSender(), requestCode, null, 0, 0, 0);
  }
  public GoogleAuthorizationFlow.Grant result(Object data) throws Exception {
    try { return grant(Identity.getAuthorizationClient(activity).getAuthorizationResultFromIntent((Intent)data), pendingAccount); }
    catch (Exception error) { throw diagnostic(error); }
  }
  public GoogleAuthorizationFlow.Grant refresh(List<String> scopes, String account) throws Exception {
    try { return grant(Tasks.await(Identity.getAuthorizationClient(activity).authorize(request(scopes, account)), 30, TimeUnit.SECONDS), account); }
    catch (Exception error) { throw diagnostic(error); }
  }
  static GoogleAuthorizationFlow.AuthException diagnostic(Exception error) {
    Throwable cause = error;
    while (cause instanceof java.util.concurrent.ExecutionException && cause.getCause() != null) cause = cause.getCause();
    // Only a public status code crosses the bridge, never SDK messages or tokens.
    return new GoogleAuthorizationFlow.AuthException(cause instanceof ApiException
      ? "GOOGLE_API_" + ((ApiException)cause).getStatusCode()
      : cause instanceof java.util.concurrent.TimeoutException ? "TIMEOUT" : "AUTH");
  }
}
