package com.rastaaslan.streamdashboard.remote;

import java.net.URI;

final class DeepLinkRouter {
  enum Route { PAIR, OAUTH, INVALID }

  private DeepLinkRouter() {}

  static Route route(String raw) {
    if (raw == null || raw.isBlank()) return Route.INVALID;
    try {
      URI uri = URI.create(raw);
      if (!"streamdashboard".equals(uri.getScheme())) return Route.INVALID;
      if (uri.getRawUserInfo() != null || uri.getPort() != -1 || uri.getRawFragment() != null) return Route.INVALID;
      String host = uri.getHost();
      String path = uri.getPath();
      if (path != null && !path.isEmpty() && !"/".equals(path)) return Route.INVALID;
      if ("pair".equals(host)) return Route.PAIR;
      if ("oauth".equals(host)) return Route.OAUTH;
      return Route.INVALID;
    } catch (IllegalArgumentException error) {
      return Route.INVALID;
    }
  }
}
