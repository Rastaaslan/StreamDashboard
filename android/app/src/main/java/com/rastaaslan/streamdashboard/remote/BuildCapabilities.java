package com.rastaaslan.streamdashboard.remote;

/** Public build diagnostics only: never exposes credentials or tokens. */
final class BuildCapabilities {
  static String code(boolean preview, String clientId) {
    return preview ? "PREVIEW" : clientId == null || clientId.trim().isEmpty() ? "NOT_CONFIGURED" : "";
  }
  static String json(boolean preview, String google, String twitch) {
    // AuthorizationClient identifies Android builds by package + signing certificate.
    // An embedded OAuth client ID is not used for this native flow.
    return "{\"preview\":" + preview + ",\"providers\":{\"google\":{\"code\":\"" + (preview ? "PREVIEW" : "")
      + "\",\"auth\":\"google-authorization-client\"},\"twitch\":{\"code\":\"" + code(preview, twitch) + "\"}}}";
  }
}
