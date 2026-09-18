package com.rastaaslan.streamdashboard.remote;

import android.net.Uri;

final class DeepLinkRouter {
  enum Route { PAIR, OAUTH, INVALID }

  private DeepLinkRouter() {}

  static Route route(Uri uri) {
    if (uri == null || !"streamdashboard".equals(uri.getScheme())) return Route.INVALID;
    if (uri.getUserInfo() != null || uri.getPort() != -1 || uri.getFragment() != null) return Route.INVALID;
    String host = uri.getHost();
    String path = uri.getPath();
    if (path != null && !path.isEmpty() && !"/".equals(path)) return Route.INVALID;
    if ("pair".equals(host)) return Route.PAIR;
    if ("oauth".equals(host)) return Route.OAUTH;
    return Route.INVALID;
  }
}
