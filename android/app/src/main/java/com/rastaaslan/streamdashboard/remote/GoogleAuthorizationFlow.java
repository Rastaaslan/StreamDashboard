package com.rastaaslan.streamdashboard.remote;

import java.util.*;

/** Native authorization state machine. The SDK adapter owns Android UI and account grants. */
final class GoogleAuthorizationFlow {
  static final int REQUEST_CODE = 731;
  static final List<String> SCOPES = Collections.unmodifiableList(Arrays.asList(
    "https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.readonly"));
  static final class Grant {
    final String token;
    final List<String> scopes;
    final Object resolution;
    Grant(String token, List<String> scopes, Object resolution) {
      this.token = token; this.scopes = new ArrayList<>(scopes); this.resolution = resolution;
    }
  }
  interface Callback { void success(Grant grant); void failure(); }
  interface Adapter {
    void authorize(List<String> scopes, Callback callback);
    void launch(Object resolution, int requestCode) throws Exception;
    Grant result(Object data) throws Exception;
    Grant refresh(List<String> scopes) throws Exception;
  }
  interface Observer { void completed(boolean connected, String code); }
  static final class AuthException extends Exception {
    final String code;
    AuthException(String code) { super(code); this.code = code; }
  }
  private final Adapter adapter;
  private final Observer observer;
  private Grant session;
  private int generation;
  private boolean pendingResolution;
  GoogleAuthorizationFlow(Adapter adapter, Observer observer) { this.adapter = adapter; this.observer = observer; }
  synchronized boolean connected() { return session != null; }
  synchronized void logout() { generation++; pendingResolution = false; session = null; }
  synchronized void authorizeGoogle() {
    final int attempt = ++generation;
    pendingResolution = false;
    try {
      adapter.authorize(SCOPES, new Callback() {
        public void success(Grant grant) { synchronized (GoogleAuthorizationFlow.this) {
          if (attempt != generation) return;
          try {
            if (grant.resolution != null) { pendingResolution = true; adapter.launch(grant.resolution, REQUEST_CODE); }
            else complete(grant);
          } catch (Exception error) { fail(error); }
        } }
        public void failure() { synchronized (GoogleAuthorizationFlow.this) { if (attempt == generation) fail(new AuthException("AUTH")); } }
      });
    } catch (Exception error) { fail(error); }
  }
  synchronized void acceptGoogleResult(int requestCode, boolean accepted, Object data) {
    if (requestCode != REQUEST_CODE || !pendingResolution) return;
    pendingResolution = false;
    try {
      if (!accepted || data == null) throw new AuthException("AUTH");
      complete(adapter.result(data));
    } catch (Exception error) { fail(error); }
  }
  private Grant validate(Grant grant) throws AuthException {
    if (grant.resolution != null || grant.token == null || grant.token.isEmpty()) throw new AuthException("REAUTH_REQUIRED");
    if (!grant.scopes.containsAll(SCOPES)) throw new AuthException("SCOPES");
    return grant;
  }
  private void complete(Grant grant) throws AuthException {
    session = validate(grant); observer.completed(true, "");
  }
  private void fail(Exception error) {
    session = null; pendingResolution = false;
    observer.completed(false, error instanceof AuthException ? ((AuthException)error).code : "AUTH");
  }
  synchronized Grant refresh() throws Exception {
    if (session == null) throw new AuthException("REAUTH_REQUIRED");
    try {
      // Refresh never launches interactive UI from a background Calendar operation.
      session = validate(adapter.refresh(SCOPES));
      return session;
    } catch (AuthException error) { session = null; throw error; }
  }
}
