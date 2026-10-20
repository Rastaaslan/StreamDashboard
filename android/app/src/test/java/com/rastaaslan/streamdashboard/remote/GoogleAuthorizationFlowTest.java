package com.rastaaslan.streamdashboard.remote;

import org.junit.Test;
import java.util.*;
import static org.junit.Assert.*;

public class GoogleAuthorizationFlowTest {
  private static final List<String> CALENDAR = Arrays.asList(
    "https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.readonly");
  private static GoogleAuthorizationFlow.Grant token(String token) {
    return new GoogleAuthorizationFlow.Grant(token, CALENDAR, null, "agenda@example.test");
  }
  private static class FakeAdapter implements GoogleAuthorizationFlow.Adapter {
    GoogleAuthorizationFlow.Callback callback;
    GoogleAuthorizationFlow.Grant result = token("interactive"), renewed = token("renewed");
    List<String> requested, refreshScopes;
    String refreshAccount;
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
    public GoogleAuthorizationFlow.Grant refresh(List<String> scopes, String account) { refreshes++; refreshScopes = scopes; refreshAccount = account; return renewed; }
  }
  private final FakeAdapter adapter = new FakeAdapter();
  private final List<String> events = new ArrayList<>();
  private final GoogleAuthorizationFlow flow = new GoogleAuthorizationFlow(adapter, (connected, code) -> events.add(connected + ":" + code));
  private Object resolve() {
    flow.authorizeGoogle(); Object resolution = new Object();
    adapter.callback.success(new GoogleAuthorizationFlow.Grant(null, Collections.emptyList(), resolution, "agenda@example.test"));
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
    assertSame(resolution, adapter.launched); assertTrue(adapter.requestCode > 0);
    assertFalse(flow.connected()); assertTrue(events.isEmpty());
    Object data = new Object();
    flow.acceptGoogleResult(999, true, data); assertFalse(flow.connected());
    flow.acceptGoogleResult(adapter.requestCode, true, data);
    assertSame(data, adapter.receivedData); assertTrue(flow.connected()); assertEquals(Collections.singletonList("true:"), events);
    flow.acceptGoogleResult(adapter.requestCode, true, data); assertEquals(1, events.size());
  }
  @Test public void cancellationRetainsExistingSessionAndReportsCancellation() {
    connected(); resolve();
    flow.acceptGoogleResult(adapter.requestCode, false, null);
    assertTrue(flow.connected()); assertEquals("true:CANCELED", events.get(events.size()-1));
  }
  @Test public void sdkFailureAndInvalidResultNeverConnect() {
    flow.authorizeGoogle(); adapter.callback.failure(new Exception("private SDK detail")); assertEquals("false:AUTH", events.get(0));
    resolve(); adapter.brokenResult = true;
    flow.acceptGoogleResult(adapter.requestCode, true, new Object());
    assertFalse(flow.connected()); assertEquals("false:AUTH", events.get(1));
  }
  @Test public void resolutionLaunchFailureIsReported() {
    adapter.brokenResolution = true; resolve();
    assertFalse(flow.connected()); assertEquals(Collections.singletonList("false:AUTH"), events);
  }
  @Test public void insufficientGrantedScopesRejectImmediateAndInteractiveResults() {
    GoogleAuthorizationFlow.Grant partial = new GoogleAuthorizationFlow.Grant("partial", Collections.singletonList(CALENDAR.get(0)), null, "agenda@example.test");
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
    connected(); adapter.renewed = new GoogleAuthorizationFlow.Grant(null, Collections.emptyList(), new Object(), "agenda@example.test");
    GoogleAuthorizationFlow.AuthException error = assertThrows(GoogleAuthorizationFlow.AuthException.class, () -> flow.refresh());
    assertEquals("REAUTH_REQUIRED", error.code); assertFalse(flow.connected()); assertEquals(0, adapter.launches);
    assertThrows(GoogleAuthorizationFlow.AuthException.class, () -> flow.refresh()); assertEquals(1, adapter.refreshes);
  }
  @Test public void refreshWithRevokedScopesRequiresReauthorization() throws Exception {
    connected(); adapter.renewed = new GoogleAuthorizationFlow.Grant("partial", Collections.emptyList(), null, "agenda@example.test");
    assertEquals("SCOPES", assertThrows(GoogleAuthorizationFlow.AuthException.class, () -> flow.refresh()).code);
    assertFalse(flow.connected());
  }
  @Test public void logoutIgnoresLateSdkAndActivityResults() {
    flow.authorizeGoogle(); flow.logout(); adapter.callback.success(token("late"));
    assertFalse(flow.connected()); assertTrue(events.isEmpty());
    resolve(); flow.logout(); flow.acceptGoogleResult(adapter.requestCode, true, new Object());
    assertFalse(flow.connected()); assertTrue(events.isEmpty());
  }
  @Test public void restartRestoresGrantsWithoutAccountUi() throws Exception {
    flow.restore(CALENDAR, "agenda@example.test");
    assertTrue(flow.connected()); assertEquals(0, adapter.launches); assertEquals(1, adapter.refreshes);
    assertEquals(CALENDAR, adapter.refreshScopes);
  }
  @Test public void restartNeedsConsentWithoutLaunchingUiOrClaimingConnected() {
    adapter.renewed = new GoogleAuthorizationFlow.Grant(null, Collections.emptyList(), new Object(), "agenda@example.test");
    assertThrows(GoogleAuthorizationFlow.AuthException.class, () -> flow.restore(CALENDAR, "agenda@example.test"));
    assertFalse(flow.connected()); assertEquals(0, adapter.launches);
  }
  @Test public void lateRestoreCannotUndoLogout() throws Exception {
    flow.logout(); flow.restore(CALENDAR, "agenda@example.test");
    assertFalse(flow.connected()); assertEquals(0, adapter.refreshes);
  }
  @Test public void newAuthorizationRequestsOnlyTheChosenServiceScopes() {
    connected(); String youtube = "https://www.googleapis.com/auth/youtube.readonly";
    flow.authorizeScopes(Collections.singletonList(youtube));
    assertEquals(Collections.singletonList(youtube), adapter.requested);
    adapter.callback.success(token("missing-youtube"));
    assertTrue(flow.connected()); assertEquals("true:SCOPES", events.get(events.size()-1));
  }

  @Test public void sdkStatusIsRetainedWithoutTheSdkMessage() {
    flow.authorizeGoogle();
    adapter.callback.failure(new GoogleAuthorizationFlow.AuthException("GOOGLE_API_10"));
    assertEquals(Collections.singletonList("false:GOOGLE_API_10"), events);
    assertFalse(flow.authorizing());
  }
  @Test public void canceledResultStillReportsGoogleErrorWhenDataExists() {
    resolve();
    FakeAdapter replacementAdapter = new FakeAdapter() {
      public GoogleAuthorizationFlow.Grant result(Object data) throws Exception {
        throw new GoogleAuthorizationFlow.AuthException("GOOGLE_API_10");
      }
      public void authorize(List<String> scopes, GoogleAuthorizationFlow.Callback callback) {
        callback.success(new GoogleAuthorizationFlow.Grant(null, null, new Object(), "agenda@example.test"));
      }
    };
    GoogleAuthorizationFlow replacement = new GoogleAuthorizationFlow(replacementAdapter, (connected, code) -> events.add(connected + ":" + code));
    replacement.authorizeGoogle(); replacement.acceptGoogleResult(replacementAdapter.requestCode, false, new Object());
    assertEquals(Collections.singletonList("false:GOOGLE_API_10"), events);
  }
  @Test public void overlappingRequestsCannotReplacePendingConsent() {
    resolve();
    assertFalse(flow.authorizeScopes(Collections.singletonList("youtube")));
    assertEquals(1, adapter.launches);
    flow.acceptGoogleResult(adapter.requestCode, true, new Object());
    assertTrue(flow.connected()); assertFalse(flow.authorizing());
  }
  @Test public void failedYoutubeRequestDoesNotRequireYoutubeForCalendarRefresh() throws Exception {
    connected();
    flow.authorizeScopes(Collections.singletonList("https://www.googleapis.com/auth/youtube.readonly"));
    adapter.callback.failure(new GoogleAuthorizationFlow.AuthException("GOOGLE_API_7"));
    assertTrue(flow.connected()); assertEquals(CALENDAR, flow.refresh().scopes);
    assertEquals(CALENDAR, adapter.refreshScopes);
    assertEquals("true:GOOGLE_API_7", events.get(events.size()-1));
  }

  @Test public void twoServicesKeepDistinctAccountsTokensAndScopesAfterRefreshAndRestart() throws Exception {
    connected();
    List<String> youtube = Collections.singletonList("https://www.googleapis.com/auth/youtube.readonly");
    FakeAdapter videoAdapter = new FakeAdapter();
    GoogleAuthorizationFlow video = new GoogleAuthorizationFlow(videoAdapter, (connected, code) -> {});
    video.authorizeScopes(youtube);
    videoAdapter.callback.success(new GoogleAuthorizationFlow.Grant("video-token", youtube, null, "video@example.test"));
    videoAdapter.renewed = new GoogleAuthorizationFlow.Grant("video-renewed", youtube, null, "video@example.test");
    assertEquals("agenda@example.test", flow.account()); assertEquals("video@example.test", video.account());
    assertEquals("renewed", flow.refresh().token); assertEquals("video-renewed", video.refresh().token);
    assertEquals("agenda@example.test", adapter.refreshAccount); assertEquals("video@example.test", videoAdapter.refreshAccount);
    assertEquals(CALENDAR, adapter.refreshScopes); assertEquals(youtube, videoAdapter.refreshScopes);
    GoogleAuthorizationFlow restoredCalendar = new GoogleAuthorizationFlow(adapter, (connected, code) -> {});
    GoogleAuthorizationFlow restoredVideo = new GoogleAuthorizationFlow(videoAdapter, (connected, code) -> {});
    restoredCalendar.restore(CALENDAR, flow.account()); restoredVideo.restore(youtube, video.account());
    assertEquals("agenda@example.test", restoredCalendar.account()); assertEquals("video@example.test", restoredVideo.account());
    video.logout(); assertTrue(flow.connected()); assertFalse(video.connected());
    flow.logout(); assertTrue(restoredVideo.connected());
  }

  @Test public void sameAccountIsAllowedForTwoSeparateServices() {
    connected();
    FakeAdapter otherAdapter = new FakeAdapter();
    GoogleAuthorizationFlow other = new GoogleAuthorizationFlow(otherAdapter, (connected, code) -> {});
    List<String> scopes = Collections.singletonList("youtube");
    other.authorizeScopes(scopes);
    otherAdapter.callback.success(new GoogleAuthorizationFlow.Grant("other-token", scopes, null, "agenda@example.test"));
    other.logout(); assertTrue(flow.connected()); assertEquals(CALENDAR, flow.scopes());
  }

  @Test public void switchingAccountFailureKeepsThePreviouslyConnectedAccount() throws Exception {
    connected(); resolve();
    adapter.result = new GoogleAuthorizationFlow.Grant("different-token", Collections.emptyList(), null, "other@example.test");
    flow.acceptGoogleResult(adapter.requestCode, true, new Object());
    assertEquals("agenda@example.test", flow.account()); assertEquals("renewed", flow.refresh().token);
    assertEquals("agenda@example.test", adapter.refreshAccount);
  }

  @Test public void unknownLegacyAccountIsNotSilentlyRestoredUsingDefaultAccount() {
    assertEquals("ACCOUNT_SELECTION_REQUIRED", assertThrows(GoogleAuthorizationFlow.AuthException.class, () -> flow.restore(CALENDAR, "")).code);
    assertEquals(0, adapter.refreshes); assertFalse(flow.connected());
  }

  @Test public void refreshCannotSilentlySwitchAccounts() {
    connected(); adapter.renewed = new GoogleAuthorizationFlow.Grant("wrong-account", CALENDAR, null, "wrong@example.test");
    assertEquals("ACCOUNT_MISMATCH", assertThrows(GoogleAuthorizationFlow.AuthException.class, () -> flow.refresh()).code);
    assertFalse(flow.connected());
  }

  @Test public void lateConsentCannotCompleteANewerAttempt() {
    resolve(); int oldCode = adapter.requestCode; flow.logout(); resolve();
    assertNotEquals(oldCode, adapter.requestCode);
    flow.acceptGoogleResult(oldCode, true, new Object()); assertFalse(flow.connected());
    flow.acceptGoogleResult(adapter.requestCode, true, new Object()); assertTrue(flow.connected());
  }

  @Test public void sdkExtraGrantsDoNotExpandThisServicesStoredScopes() {
    flow.authorizeGoogle(); List<String> combined = new ArrayList<>(CALENDAR); combined.add("youtube");
    adapter.callback.success(new GoogleAuthorizationFlow.Grant("token", combined, null, "agenda@example.test"));
    assertEquals(CALENDAR, flow.scopes());
  }
}
