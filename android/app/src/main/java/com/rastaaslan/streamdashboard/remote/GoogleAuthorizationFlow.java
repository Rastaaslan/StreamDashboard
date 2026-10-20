package com.rastaaslan.streamdashboard.remote;

import java.util.*;

/** Native authorization state machine. The SDK adapter owns Android UI and account grants. */
final class GoogleAuthorizationFlow {
  private static final java.util.concurrent.atomic.AtomicInteger REQUEST_CODES = new java.util.concurrent.atomic.AtomicInteger(731);
  static int nextRequestCode() {
    int code = REQUEST_CODES.getAndIncrement();
    if (code > 65535) throw new IllegalStateException("AUTH");
    return code;
  }
  static final List<String> SCOPES = Collections.unmodifiableList(Arrays.asList(
    "https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.readonly"));
  static final class Grant {
    final String token;
    final List<String> scopes;
    final Object resolution;
    final String account;
    Grant(String token, List<String> scopes, Object resolution, String account) {
      this.token = token; this.scopes = scopes == null ? Collections.emptyList() : new ArrayList<>(scopes); this.resolution = resolution;
      this.account = account == null ? "" : account;
    }
  }
  interface Callback { void success(Grant grant); void failure(Exception error); }
  interface Adapter {
    void authorize(List<String> scopes, Callback callback);
    void launch(Object resolution, int requestCode) throws Exception;
    Grant result(Object data) throws Exception;
    Grant refresh(List<String> scopes, String account) throws Exception;
    default void cancel() { }
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
  private int pendingRequestCode;
  GoogleAuthorizationFlow(Adapter adapter, Observer observer) { this.adapter = adapter; this.observer = observer; }
  synchronized boolean connected() { return session != null; }
  synchronized boolean authorizing() { return authorizing; }
  synchronized void logout() { generation++; pendingResolution = false; authorizing = false; session = null; adapter.cancel(); }
  synchronized String account() { return session == null ? "" : session.account; }
  synchronized List<String> scopes() { return session == null ? Collections.emptyList() : new ArrayList<>(session.scopes); }
  synchronized void restore(List<String> scopes, String account) throws Exception {
    if (generation != 0 || session != null || pendingResolution) return;
    if (account == null || account.isEmpty()) throw new AuthException("ACCOUNT_SELECTION_REQUIRED");
    requested = new ArrayList<>(scopes);
    session = validateAccount(validate(adapter.refresh(requested, account)), account);
  }
  synchronized void authorizeGoogle() { authorizeScopes(SCOPES); }
  synchronized boolean authorizeScopes(List<String> scopes) {
    if (authorizing) return false;
    authorizing = true;
    // Each flow belongs to one service. Never merge scopes from a different account.
    requested = new ArrayList<>(new LinkedHashSet<>(scopes));
    final int attempt = ++generation;
    pendingResolution = false;
    try {
      adapter.authorize(requested, new Callback() {
        public void success(Grant grant) { synchronized (GoogleAuthorizationFlow.this) {
          if (attempt != generation) return;
          try {
            if (grant.resolution != null) { pendingResolution = true; pendingRequestCode = nextRequestCode(); adapter.launch(grant.resolution, pendingRequestCode); }
            else complete(grant);
          } catch (Exception error) { fail(error); }
        } }
        public void failure(Exception error) { synchronized (GoogleAuthorizationFlow.this) { if (attempt == generation) fail(error); } }
      });
    } catch (Exception error) { fail(error); }
    return true;
  }
  synchronized void acceptGoogleResult(int requestCode, boolean accepted, Object data) {
    if (requestCode != pendingRequestCode || !pendingResolution) return;
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
    if (grant.account.isEmpty()) throw new AuthException("ACCOUNT_SELECTION_REQUIRED");
    if (!grant.scopes.containsAll(scopes)) throw new AuthException("SCOPES");
    // Store only this service's scopes even if the SDK returns other existing grants.
    return new Grant(grant.token, scopes, null, grant.account);
  }
  private Grant validateAccount(Grant grant, String account) throws AuthException {
    if (!grant.account.equals(account)) throw new AuthException("ACCOUNT_MISMATCH");
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
      session = validateAccount(validate(adapter.refresh(granted, session.account), granted), session.account);
      return session;
    } catch (AuthException error) {
      if (error.code.equals("REAUTH_REQUIRED") || error.code.equals("SCOPES") || error.code.equals("ACCOUNT_MISMATCH")) session = null;
      throw error;
    }
  }
}
