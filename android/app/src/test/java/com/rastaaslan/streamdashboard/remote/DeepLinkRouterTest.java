package com.rastaaslan.streamdashboard.remote;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class DeepLinkRouterTest {
  private static final String STANDARD = "streamdashboard-next";
  private static final String QA = "streamdashboard-next-qa";
  private static final String PREVIEW = "streamdashboard-preview";

  @Test public void routesPairOnly() {
    assertEquals(DeepLinkRouter.Route.PAIR, DeepLinkRouter.route("streamdashboard-next://pair?v=1&id=abc", STANDARD));
  }

  @Test public void routesOAuthOnly() {
    assertEquals(DeepLinkRouter.Route.OAUTH, DeepLinkRouter.route("streamdashboard-next://oauth?provider=twitch&code=x&state=y", STANDARD));
  }

  @Test public void qaCanReceiveOwnPairAndOAuthLinks() {
    assertEquals(DeepLinkRouter.Route.PAIR, DeepLinkRouter.route("streamdashboard-next-qa://pair?v=1&id=abc", QA));
    assertEquals(DeepLinkRouter.Route.OAUTH, DeepLinkRouter.route("streamdashboard-next-qa://oauth?provider=twitch&code=x&state=y", QA));
  }

  @Test public void variantsNeverAcceptEachOthersCallbacks() {
    assertEquals(DeepLinkRouter.Route.INVALID, DeepLinkRouter.route("streamdashboard-next://pair", QA));
    assertEquals(DeepLinkRouter.Route.INVALID, DeepLinkRouter.route("streamdashboard-next-qa://pair", STANDARD));
    assertEquals(DeepLinkRouter.Route.INVALID, DeepLinkRouter.route("streamdashboard-preview://oauth", STANDARD));
    assertEquals(DeepLinkRouter.Route.INVALID, DeepLinkRouter.route("streamdashboard-next-qa://oauth", PREVIEW));
  }

  @Test public void generatedBuildVariantOwnsExactlyItsScheme() {
    if (BuildConfig.APPLICATION_ID.endsWith(".qa")) {
      assertEquals(QA, BuildConfig.DEEP_LINK_SCHEME);
      assertEquals(false, BuildConfig.PREVIEW_MODE);
    } else if (BuildConfig.APPLICATION_ID.endsWith(".preview")) {
      assertEquals(PREVIEW, BuildConfig.DEEP_LINK_SCHEME);
      assertEquals(true, BuildConfig.PREVIEW_MODE);
    } else {
      assertEquals(STANDARD, BuildConfig.DEEP_LINK_SCHEME);
    }
    assertEquals(DeepLinkRouter.Route.PAIR, DeepLinkRouter.route(BuildConfig.DEEP_LINK_SCHEME + "://pair?v=2", BuildConfig.DEEP_LINK_SCHEME));
    assertEquals(DeepLinkRouter.Route.INVALID, DeepLinkRouter.route("streamdashboard://pair?v=1", BuildConfig.DEEP_LINK_SCHEME));
  }

  @Test public void rejectsForeignSchemeAndHost() {
    assertEquals(DeepLinkRouter.Route.INVALID, DeepLinkRouter.route("https://pair", STANDARD));
    assertEquals(DeepLinkRouter.Route.INVALID, DeepLinkRouter.route("streamdashboard-next://other", STANDARD));
  }

  @Test public void rejectsUnexpectedPathFragmentPortOrUserInfo() {
    assertEquals(DeepLinkRouter.Route.INVALID, DeepLinkRouter.route("streamdashboard-next://pair/extra", STANDARD));
    assertEquals(DeepLinkRouter.Route.INVALID, DeepLinkRouter.route("streamdashboard-next://pair#fragment", STANDARD));
    assertEquals(DeepLinkRouter.Route.INVALID, DeepLinkRouter.route("streamdashboard-next://pair:1234", STANDARD));
    assertEquals(DeepLinkRouter.Route.INVALID, DeepLinkRouter.route("streamdashboard-next://user@pair", STANDARD));
    assertEquals(DeepLinkRouter.Route.INVALID, DeepLinkRouter.route("streamdashboard-next-qa://pair#fragment", QA));
  }

  @Test public void rejectsMalformedInputOrMissingScheme() {
    assertEquals(DeepLinkRouter.Route.INVALID, DeepLinkRouter.route("%%%", STANDARD));
    assertEquals(DeepLinkRouter.Route.INVALID, DeepLinkRouter.route("", STANDARD));
    assertEquals(DeepLinkRouter.Route.INVALID, DeepLinkRouter.route("streamdashboard-next://pair", null));
    assertEquals(DeepLinkRouter.Route.INVALID, DeepLinkRouter.route("streamdashboard-next://pair", ""));
  }
}
