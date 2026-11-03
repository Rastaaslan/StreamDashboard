import { validateUpgradeManifest, type UpgradeJournal, type UpgradeManifest } from '../../../packages/core/src/streamcockpit-upgrade.js';
import { requireDesktopRestartSafety, type RestartSafety } from './restart-safety.js';

export interface UpgradeReleaseArtifact {
  manifest: UpgradeManifest;
  revision: string;
  applicationId: string;
  /** Authenticode / Android signing certificate identity, independently verified. */
  signer: string;
  staged: string;
}
export interface UpgradeReleaseEvidence {
  windows: UpgradeReleaseArtifact;
  android: UpgradeReleaseArtifact;
  installed: {
    windowsId: string; androidId: string;
    windowsSigner: string; androidSigner: string;
    windowsVersion: string; androidVersion: string;
  };
  journal: UpgradeJournal;
}
export interface UpgradeObservation {
  authority: 'fixe-agent';
  session: string;
  observedAt: number;
  obs: 'idle' | 'live' | 'unknown';
  twitch: 'offline' | 'live' | 'unknown';
}
export interface DesktopUpgradePreflightDependencies {
  assessRestartSafety(): Promise<RestartSafety>;
  /** Read from the authenticated FIXE authority; never infer offline from disconnection. */
  observe?(): Promise<UpgradeObservation>;
  evidence?(): Promise<UpgradeReleaseEvidence>;
  /** Must authenticate the whole release binding (revision, identities and both manifests),
   * verify both staged byte hashes/signatures against independently pinned trust,
   * and attest the installed identities. A manifest's signature field is not proof. */
  verifyRelease?(evidence: UpgradeReleaseEvidence): Promise<boolean>;
  now?(): number;
}
export interface DesktopUpgradePreflightReport {
  state: 'blocked';
  launchAllowed: false;
  releaseVerified: boolean;
  reasons: string[];
}

// Only messages authored by this guard are safe to present. OAuth/download/OS
// providers may throw credential-bearing errors; never echo those to UI or logs.
class PreflightRejected extends Error {}

/** Read-only diagnostic. No installer is connected: success of checks is NOT launch permission. */
export async function preflightDesktopUpgrade(deps: DesktopUpgradePreflightDependencies): Promise<DesktopUpgradePreflightReport> {
  const result: DesktopUpgradePreflightReport = {
    state: 'blocked', launchAllowed: false, releaseVerified: false, reasons: [],
  };
  const observe = async () => {
    const value = await deps.observe?.();
    const now = (deps.now ?? Date.now)();
    if (!value || value.authority !== 'fixe-agent' || !value.session?.trim()
      || !Number.isFinite(now) || !Number.isFinite(value.observedAt) || value.observedAt > now
      || now - value.observedAt > 5_000 || value.obs !== 'idle' || value.twitch !== 'offline') {
      throw new PreflightRejected('OBS/Twitch actif, UNKNOWN, déconnecté ou observation périmée');
    }
    // Snapshot the sample and clock together. A reused/mutated provider object must
    // not hide a backwards authority observation during release verification.
    return { ...value, checkedAt: now };
  };
  try {
    await requireDesktopRestartSafety(() => deps.assessRestartSafety());
    const initial = await observe();
    const raw = await deps.evidence?.();
    if (!raw) throw new PreflightRejected('Contrat Windows/Android signé et journal staged absents');
    const evidence = structuredClone(raw);
    const { windows, android, installed, journal } = evidence;
    for (const artifact of [windows, android]) {
      validateUpgradeManifest(artifact.manifest);
      if (!/^[a-f0-9]{40}$/.test(artifact.revision) || !artifact.applicationId?.trim()
        || !artifact.signer?.trim() || !artifact.staged?.trim()) throw new PreflightRejected('Identité ou révision absente');
    }
    if (windows.manifest.target !== 'desktop' || android.manifest.target !== 'android'
      || windows.revision !== android.revision || windows.manifest.version !== android.manifest.version
      || windows.applicationId !== installed.windowsId || android.applicationId !== installed.androidId
      || windows.signer !== installed.windowsSigner || android.signer !== installed.androidSigner
      || windows.manifest.fromVersion !== installed.windowsVersion || android.manifest.fromVersion !== installed.androidVersion) {
      throw new PreflightRejected('Identités, signatures de mise à niveau, versions ou révisions divergentes');
    }
    if (journal.pending || journal.installed || journal.rolledBack || journal.phase !== 'verified'
      || journal.staged !== windows.staged || JSON.stringify(journal.manifest) !== JSON.stringify(windows.manifest)) {
      throw new PreflightRejected('Journal non vérifié ou opération interrompue : récupération explicite requise');
    }
    if (await deps.verifyRelease?.(structuredClone(evidence)) !== true) {
      throw new PreflightRejected('Authenticité de la release et des octets staged non prouvée');
    }
    await requireDesktopRestartSafety(() => deps.assessRestartSafety());
    const final = await observe();
    if (final.session !== initial.session) throw new PreflightRejected('Agent redémarré pendant le préflight');
    if (final.observedAt < initial.observedAt || final.checkedAt < initial.checkedAt) {
      throw new PreflightRejected('Horloge ou observation de la régie revenue en arrière pendant le préflight');
    }
    result.releaseVerified = true;
  } catch (error) {
    result.reasons.push(error instanceof PreflightRejected ? error.message : 'Préflight indisponible : vérification non confirmée');
  }
  result.reasons.push('Lancement bloqué : transaction durable sauvegarde/migration/installation/rollback non raccordée à Squirrel');
  return result;
}
