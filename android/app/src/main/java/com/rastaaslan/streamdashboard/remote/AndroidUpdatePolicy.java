package com.rastaaslan.streamdashboard.remote;

import java.util.Arrays;

/** Rules shared by preparation and independent installed-package readback.
 * Android recovery is a forward update with the same identity, never uninstall
 * or an unsupported version-code downgrade. No provider operation is replayed.
 */
final class AndroidUpdatePolicy {
  static boolean sameIdentity(String currentPackage, String nextPackage,
      String[] currentSigners, String[] nextSigners) {
    if (currentPackage == null || !currentPackage.equals(nextPackage) ||
        currentSigners == null || nextSigners == null || currentSigners.length == 0 ||
        currentSigners.length != nextSigners.length) return false;
    String[] a = currentSigners.clone(), b = nextSigners.clone();
    for (String s : a) if (s == null || !s.matches("[a-f0-9]{64}")) return false;
    for (String s : b) if (s == null || !s.matches("[a-f0-9]{64}")) return false;
    Arrays.sort(a); Arrays.sort(b);
    return Arrays.equals(a, b);
  }
  static boolean canPrepare(String phase) {
    return phase == null || phase.isEmpty() || phase.equals("prepared") ||
        phase.equals("deferred") || phase.equals("failed") || phase.equals("installed") || phase.equals("superseded");
  }
  static boolean canCommit(String phase, long installedCode, long candidateCode,
      boolean freshOffline, boolean explicitConsent) {
    return ("prepared".equals(phase) || "deferred".equals(phase)) &&
        installedCode > 0 && candidateCode > installedCode && freshOffline && explicitConsent;
  }
  static boolean confirmsInstall(long expectedCode, long actualCode, String expectedHash,
      String actualHash, boolean sameIdentity, String oldDataDirectory, String actualDataDirectory) {
    return expectedCode > 0 && expectedCode == actualCode && sameIdentity &&
        expectedHash != null && expectedHash.matches("[a-f0-9]{64}") &&
        expectedHash.equals(actualHash) && oldDataDirectory != null &&
        !oldDataDirectory.isEmpty() && oldDataDirectory.equals(actualDataDirectory);
  }
  static boolean confirmsForwardRecovery(long requestedCode, long actualCode,
      boolean sameIdentity, String oldDataDirectory, String actualDataDirectory) {
    return requestedCode > 0 && actualCode > requestedCode && sameIdentity &&
        oldDataDirectory != null && !oldDataDirectory.isEmpty() &&
        oldDataDirectory.equals(actualDataDirectory);
  }
  private AndroidUpdatePolicy() {}
}
