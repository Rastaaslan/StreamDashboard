package com.rastaaslan.streamdashboard.remote;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.Intent;
import com.google.android.gms.auth.api.identity.*;
import com.google.android.gms.common.api.Scope;
import com.google.android.gms.tasks.Tasks;
import java.util.*;
import java.util.concurrent.TimeUnit;

/** Thin binding to Google Identity Services; no OAuth token is exposed to JavaScript. */
final class GoogleAuthorizationAdapter implements GoogleAuthorizationFlow.Adapter {
  private final Activity activity;
  GoogleAuthorizationAdapter(Activity activity) { this.activity = activity; }
  private AuthorizationRequest request(List<String> scopes) {
    List<Scope> requested = new ArrayList<>();
    for (String scope : scopes) requested.add(new Scope(scope));
    return AuthorizationRequest.builder().setRequestedScopes(requested).build();
  }
  private GoogleAuthorizationFlow.Grant grant(AuthorizationResult result) {
    return new GoogleAuthorizationFlow.Grant(result.getAccessToken(), result.getGrantedScopes(), result.hasResolution() ? result.getPendingIntent() : null);
  }
  public void authorize(List<String> scopes, GoogleAuthorizationFlow.Callback callback) {
    activity.runOnUiThread(() -> Identity.getAuthorizationClient(activity).authorize(request(scopes))
      .addOnSuccessListener(result -> callback.success(grant(result)))
      .addOnFailureListener(error -> callback.failure()));
  }
  public void launch(Object resolution, int requestCode) throws Exception {
    activity.startIntentSenderForResult(((PendingIntent)resolution).getIntentSender(), requestCode, null, 0, 0, 0);
  }
  public GoogleAuthorizationFlow.Grant result(Object data) throws Exception {
    return grant(Identity.getAuthorizationClient(activity).getAuthorizationResultFromIntent((Intent)data));
  }
  public GoogleAuthorizationFlow.Grant refresh(List<String> scopes) throws Exception {
    return grant(Tasks.await(Identity.getAuthorizationClient(activity).authorize(request(scopes)), 30, TimeUnit.SECONDS));
  }
}
