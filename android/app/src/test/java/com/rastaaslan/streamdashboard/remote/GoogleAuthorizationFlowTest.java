package com.rastaaslan.streamdashboard.remote;

import org.junit.Test;
import java.util.*;
import static org.junit.Assert.*;

public class GoogleAuthorizationFlowTest {
  private static final List<String> CALENDAR = Arrays.asList(
    "https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.readonly");
  private static GoogleAuthorizationFlow.Grant token(String token) {
    return new GoogleAuthorizationFlow.Grant(token, CALENDAR, null);
  }
  private static class FakeAdapter implements GoogleAuthorizationFlow.Adapter {
    GoogleAuthorizationFlow.Callback callback;
    GoogleAuthorizationFlow.Grant result = token("interactive"), renewed = token("renewed");
    List<String> requested, refreshScopes;
    Object launched, receivedData;
    int requestCode, launches, refreshes;
    boolean brokenResolution, brokenResult;
    public void authorize(List<String> scopes, GoogleAuthorizationFlow.Callback callback) { requested = scopes; this.callback = callback; }
    public void launch(Object resolution, int code) throws Exception {
      if (brokenResolution) throw new Exception("resolution failed");
      launched = resolution; requestCode = code; launches++;
    }
    public GoogleAuthorizationFlow.Grant result(Object data) throws Exception {
      if (brokenResult) throw new Exception("invalid activity result");
      receivedData = data; return result;
    }
    public GoogleAuthorizationFlow.Grant refresh(List<String> scopes) { refreshes++; refreshScopes = scopes; return renewed; }
  }
  private final FakeAdapter adapter = new FakeAdapter();
  private final List<String> events = new ArrayList<>();
  private final GoogleAuthorizationFlow flow = new GoogleAuthorizationFlow(adapter, (connected, code) -> events.add(connected + ":" + code));
  private Object resolve() {
    flow.authorizeGoogle(); Object resolution = new Object();
    adapter.callback.success(new GoogleAuthorizationFlow.Grant(null, Collections.emptyList(), resolution));
    return resolution;
  }
  private void connected() { flow.authorizeGoogle(); adapter.callback.success(token("initial")); }

  @Test public void immediateSuccessRequestsCalendarScopesAndConnectsWithoutResolution() throws Exception {
    connected();
    assertEquals(CALENDAR, adapter.requested); assertTrue(flow.connected());
    assertEquals(Collections.singletonList("true:"), events); assertEquals(0, adapter.launches);
  }
  @Test public void interactiveResolutionConnectsOnlyAfterAcceptedActivityResult() {
    Object resolution = resolve();
    assertSame(resolution, adapter.launched); assertEquals(GoogleAuthorizationFlow.REQUEST_CODE, adapter.requestCode);
    assertFalse(flow.connected()); assertTrue(events.isEmpty());
    Object data = new Object();
    flow.acceptGoogleResult(999, true, data); assertFalse(flow.connected());
    flow.acceptGoogleResult(adapter.requestCode, true, data);
    assertSame(data, adapter.receivedData); assertTrue(flow.connected()); assertEquals(Collections.singletonList("true:"), events);
    flow.acceptGoogleResult(adapter.requestCode, true, data); assertEquals(1, events.size());
  }
  @Test public void cancellationClearsSessionAndReportsFailure() {
    connected(); resolve();
    flow.acceptGoogleResult(adapter.requestCode, false, null);
    assertFalse(flow.connected()); assertEquals("false:AUTH", events.get(events.size()-1));
  }
  @Test public void sdkFailureAndInvalidResultNeverConnect() {
    flow.authorizeGoogle(); adapter.callback.failure(); assertEquals("false:AUTH", events.get(0));
    resolve(); adapter.brokenResult = true;
    flow.acceptGoogleResult(adapter.requestCode, true, new Object());
    assertFalse(flow.connected()); assertEquals("false:AUTH", events.get(1));
  }
  @Test public void resolutionLaunchFailureIsReported() {
    adapter.brokenResolution = true; resolve();
    assertFalse(flow.connected()); assertEquals(Collections.singletonList("false:AUTH"), events);
  }
  @Test public void insufficientGrantedScopesRejectImmediateAndInteractiveResults() {
    GoogleAuthorizationFlow.Grant partial = new GoogleAuthorizationFlow.Grant("partial", Collections.singletonList(CALENDAR.get(0)), null);
    flow.authorizeGoogle(); adapter.callback.success(partial);
    assertFalse(flow.connected()); assertEquals("false:SCOPES", events.get(0));
    resolve(); adapter.result = partial; flow.acceptGoogleResult(adapter.requestCode, true, new Object());
    assertFalse(flow.connected()); assertEquals("false:SCOPES", events.get(1));
  }
  @Test public void refreshUsesSdkAndItsNewTokenAndScopes() throws Exception {
    connected();
    assertEquals("renewed", flow.refresh().token); assertEquals(CALENDAR, adapter.refreshScopes);
    assertEquals(1, adapter.refreshes); assertEquals(0, adapter.launches);
  }
  @Test public void refreshRequiringConsentDisconnectsWithoutLaunchingUi() throws Exception {
    connected(); adapter.renewed = new GoogleAuthorizationFlow.Grant(null, Collections.emptyList(), new Object());
    GoogleAuthorizationFlow.AuthException error = assertThrows(GoogleAuthorizationFlow.AuthException.class, () -> flow.refresh());
    assertEquals("REAUTH_REQUIRED", error.code); assertFalse(flow.connected()); assertEquals(0, adapter.launches);
    assertThrows(GoogleAuthorizationFlow.AuthException.class, () -> flow.refresh()); assertEquals(1, adapter.refreshes);
  }
  @Test public void refreshWithRevokedScopesRequiresReauthorization() throws Exception {
    connected(); adapter.renewed = new GoogleAuthorizationFlow.Grant("partial", Collections.emptyList(), null);
    assertEquals("SCOPES", assertThrows(GoogleAuthorizationFlow.AuthException.class, () -> flow.refresh()).code);
    assertFalse(flow.connected());
  }
  @Test public void logoutIgnoresLateSdkAndActivityResults() {
    flow.authorizeGoogle(); flow.logout(); adapter.callback.success(token("late"));
    assertFalse(flow.connected()); assertTrue(events.isEmpty());
    resolve(); flow.logout(); flow.acceptGoogleResult(adapter.requestCode, true, new Object());
    assertFalse(flow.connected()); assertTrue(events.isEmpty());
  }
}
