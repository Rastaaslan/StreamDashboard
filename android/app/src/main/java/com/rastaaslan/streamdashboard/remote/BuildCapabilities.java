package com.rastaaslan.streamdashboard.remote;

/** Public build diagnostics only: never exposes credentials or tokens. */
final class BuildCapabilities {
  static String code(boolean preview, String clientId) {
    return preview ? "PREVIEW" : clientId == null || clientId.trim().isEmpty() ? "NOT_CONFIGURED" : "";
  }
  static String json(boolean preview, String google, String twitch) {
    return "{\"preview\":" + preview + ",\"providers\":{\"google\":{\"code\":\"" + code(preview, google)
      + "\",\"auth\":\"google-authorization-client\"},\"twitch\":{\"code\":\"" + code(preview, twitch) + "\"}}}";
  }
}
