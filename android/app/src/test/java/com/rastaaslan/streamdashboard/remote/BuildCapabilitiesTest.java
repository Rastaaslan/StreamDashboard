package com.rastaaslan.streamdashboard.remote;
import org.junit.Test;
import static org.junit.Assert.*;
public class BuildCapabilitiesTest {
  @Test public void previewAlwaysDisablesProviders() {
    assertEquals("PREVIEW", BuildCapabilities.code(true, "public-id"));
    assertEquals("PREVIEW", BuildCapabilities.code(true, ""));
  }
  @Test public void releaseRequiresProvisioning() {
    assertEquals("NOT_CONFIGURED", BuildCapabilities.code(false, " "));
    assertEquals("", BuildCapabilities.code(false, "public-id"));
  }
  @Test public void diagnosticNamesGoogleAdapterWithoutExposingIds() {
    String diagnostic = BuildCapabilities.json(false, "google-id", "twitch-id");
    assertTrue(diagnostic.contains("google-authorization-client"));
    assertFalse(diagnostic.contains("google-id"));
    assertFalse(diagnostic.contains("streamdashboard://"));
  }
}
