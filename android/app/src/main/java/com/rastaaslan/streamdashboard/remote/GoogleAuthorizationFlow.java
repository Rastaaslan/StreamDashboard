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
      this.token = token; this.scopes = scopes == null ? Collections.emptyList() : new ArrayList<>(scopes); this.resolution = resolution;
    }
  }
  interface Callback { void success(Grant grant); void failure(Exception error); }
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
  private List<String> requested = SCOPES;
  private int generation;
  private boolean pendingResolution;
  private boolean authorizing;
  GoogleAuthorizationFlow(Adapter adapter, Observer observer) { this.adapter = adapter; this.observer = observer; }
  synchronized boolean connected() { return session != null; }
  synchronized boolean authorizing() { return authorizing; }
  synchronized void logout() { generation++; pendingResolution = false; authorizing = false; session = null; }
  synchronized List<String> scopes() { return session == null ? Collections.emptyList() : new ArrayList<>(session.scopes); }
  synchronized void restore(List<String> scopes) throws Exception {
    if (generation != 0 || session != null || pendingResolution) return;
    requested = new ArrayList<>(scopes);
    session = validate(adapter.refresh(requested)); // never launches account UI on restart
  }
  synchronized void authorizeGoogle() { authorizeScopes(SCOPES); }
  synchronized boolean authorizeScopes(List<String> scopes) {
    if (authorizing) return false;
    authorizing = true;
    LinkedHashSet<String> union = new LinkedHashSet<>(scopes);
    if (session != null) union.addAll(session.scopes);
    requested = new ArrayList<>(union);
    final int attempt = ++generation;
    pendingResolution = false;
    try {
      adapter.authorize(requested, new Callback() {
        public void success(Grant grant) { synchronized (GoogleAuthorizationFlow.this) {
          if (attempt != generation) return;
          try {
            if (grant.resolution != null) { pendingResolution = true; adapter.launch(grant.resolution, REQUEST_CODE); }
            else complete(grant);
          } catch (Exception error) { fail(error); }
        } }
        public void failure(Exception error) { synchronized (GoogleAuthorizationFlow.this) { if (attempt == generation) fail(error); } }
      });
    } catch (Exception error) { fail(error); }
    return true;
  }
  synchronized void acceptGoogleResult(int requestCode, boolean accepted, Object data) {
    if (requestCode != REQUEST_CODE || !pendingResolution) return;
    pendingResolution = false;
    try {
      if (data == null) throw new AuthException(accepted ? "AUTH" : "CANCELED");
      Grant grant = adapter.result(data); // Preserve a Google SDK status even on RESULT_CANCELED.
      if (!accepted) throw new AuthException("CANCELED");
      complete(grant);
    } catch (Exception error) { fail(error); }
  }
  private Grant validate(Grant grant) throws AuthException {
    return validate(grant, requested);
  }
  private Grant validate(Grant grant, List<String> scopes) throws AuthException {
    if (grant.resolution != null || grant.token == null || grant.token.isEmpty()) throw new AuthException("REAUTH_REQUIRED");
    if (!grant.scopes.containsAll(scopes)) throw new AuthException("SCOPES");
    return grant;
  }
  private void complete(Grant grant) throws AuthException {
    session = validate(grant); authorizing = false; observer.completed(true, "");
  }
  private void fail(Exception error) {
    // A failed request for additional access must not revoke a working connection.
    pendingResolution = false; authorizing = false;
    requested = session == null ? SCOPES : new ArrayList<>(session.scopes);
    observer.completed(session != null, error instanceof AuthException ? ((AuthException)error).code : "AUTH");
  }
  synchronized Grant refresh() throws Exception {
    if (session == null) throw new AuthException("REAUTH_REQUIRED");
    try {
      // Refresh never launches interactive UI from a background Calendar operation.
      List<String> granted = new ArrayList<>(session.scopes);
      session = validate(adapter.refresh(granted), granted);
      return session;
    } catch (AuthException error) {
      if (error.code.equals("REAUTH_REQUIRED") || error.code.equals("SCOPES")) session = null;
      throw error;
    }
  }
}
