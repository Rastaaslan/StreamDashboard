package com.rastaaslan.streamdashboard.remote;

import static org.junit.Assert.assertEquals;

import android.net.Uri;
import org.junit.Test;

public class DeepLinkRouterTest {
  @Test public void routesPairOnly() {
    assertEquals(DeepLinkRouter.Route.PAIR, DeepLinkRouter.route(Uri.parse("streamdashboard://pair?v=1&id=abc")));
  }

  @Test public void routesOAuthOnly() {
    assertEquals(DeepLinkRouter.Route.OAUTH, DeepLinkRouter.route(Uri.parse("streamdashboard://oauth?provider=twitch&code=x&state=y")));
  }

  @Test public void rejectsForeignSchemeAndHost() {
    assertEquals(DeepLinkRouter.Route.INVALID, DeepLinkRouter.route(Uri.parse("https://pair")));
    assertEquals(DeepLinkRouter.Route.INVALID, DeepLinkRouter.route(Uri.parse("streamdashboard://other")));
  }

  @Test public void rejectsUnexpectedPathFragmentPortOrUserInfo() {
    assertEquals(DeepLinkRouter.Route.INVALID, DeepLinkRouter.route(Uri.parse("streamdashboard://pair/extra")));
    assertEquals(DeepLinkRouter.Route.INVALID, DeepLinkRouter.route(Uri.parse("streamdashboard://pair#fragment")));
    assertEquals(DeepLinkRouter.Route.INVALID, DeepLinkRouter.route(Uri.parse("streamdashboard://pair:1234")));
    assertEquals(DeepLinkRouter.Route.INVALID, DeepLinkRouter.route(Uri.parse("streamdashboard://user@pair")));
  }
}
