package com.rastaaslan.streamdashboard.remote;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class DeepLinkRouterTest {
  @Test public void routesPairOnly() {
    assertEquals(DeepLinkRouter.Route.PAIR, DeepLinkRouter.route("streamdashboard://pair?v=1&id=abc"));
  }

  @Test public void routesOAuthOnly() {
    assertEquals(DeepLinkRouter.Route.OAUTH, DeepLinkRouter.route("streamdashboard://oauth?provider=twitch&code=x&state=y"));
  }

  @Test public void rejectsForeignSchemeAndHost() {
    assertEquals(DeepLinkRouter.Route.INVALID, DeepLinkRouter.route("https://pair"));
    assertEquals(DeepLinkRouter.Route.INVALID, DeepLinkRouter.route("streamdashboard://other"));
  }

  @Test public void rejectsUnexpectedPathFragmentPortOrUserInfo() {
    assertEquals(DeepLinkRouter.Route.INVALID, DeepLinkRouter.route("streamdashboard://pair/extra"));
    assertEquals(DeepLinkRouter.Route.INVALID, DeepLinkRouter.route("streamdashboard://pair#fragment"));
    assertEquals(DeepLinkRouter.Route.INVALID, DeepLinkRouter.route("streamdashboard://pair:1234"));
    assertEquals(DeepLinkRouter.Route.INVALID, DeepLinkRouter.route("streamdashboard://user@pair"));
  }

  @Test public void rejectsMalformedInput() {
    assertEquals(DeepLinkRouter.Route.INVALID, DeepLinkRouter.route("%%%"));
    assertEquals(DeepLinkRouter.Route.INVALID, DeepLinkRouter.route(""));
  }
}
