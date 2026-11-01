/** Offline contracts: no transport, installer, OBS writer or user-data path. */
export type UpgradePhase = 'downloaded' | 'staged' | 'verified' | 'deferred' | 'installed' | 'rolledBack';
export interface UpgradeManifest {
  id: string;
  version: string;
  fromVersion: string;
  source: string;
  sha256: string;
  signature: { keyId: string; value: string };
  schema: { from: number; to: number };
  target: 'desktop' | 'agent' | 'android';
}
export type UpgradeOperation = 'stage' | 'backup' | 'migrate' | 'install' | 'rollback';
export interface UpgradeEvent {
  sequence: number;
  phase: UpgradePhase;
  message: string;
}
export interface UpgradeJournal {
  manifest: UpgradeManifest;
  artifact: string;
  phase: UpgradePhase;
  events: UpgradeEvent[];
  pending?: { operation: UpgradeOperation; key: string };
  staged?: string;
  backup?: string;
  migration?: string;
  installed: boolean;
  rolledBack: boolean;
}
export interface UpgradeReceipt {
  /** Durable reference; never the contents of a profile, pairing or secret. */
  reference: string;
}
export interface UpgradeAdapters {
  /** Must serialize ALL updates for this installation, including other processes. */
  exclusive<T>(work: () => Promise<T>): Promise<T>;
  /** Atomic durable writes; failed writes must prevent further side effects. */
  read(): Promise<UpgradeJournal | undefined>;
  write(journal: UpgradeJournal): Promise<void>;
  /** Verify signed manifest + staged bytes/hash against an independently trusted source/key. */
  verify(manifest: UpgradeManifest, staged: string): Promise<boolean>;
  stage(manifest: UpgradeManifest, artifact: string, key: string): Promise<UpgradeReceipt>;
  /** Immutable complete snapshot including associations/profiles and previous application. */
  backup(manifest: UpgradeManifest, key: string): Promise<UpgradeReceipt>;
  /** Prepare a versioned copy from backup, never mutate the active data. */
  migrate(manifest: UpgradeManifest, backup: string, key: string): Promise<UpgradeReceipt>;
  /** Receipt requires re-reading active version + data, not merely launching an installer. */
  install(journal: UpgradeJournal, key: string): Promise<UpgradeReceipt>;
  /** Restore application AND data from backup; receipt requires re-read confirmation. */
  rollback(journal: UpgradeJournal, key: string): Promise<UpgradeReceipt>;
  /** Read only. Undefined means uncertain: no automatic replay, even for a missing effect. */
  reconcile(operation: UpgradeOperation, key: string): Promise<UpgradeReceipt | undefined>;
  requireSafe(): Promise<void>;
}

export function validateUpgradeManifest(manifest: UpgradeManifest): void {
  const version = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
  if (!manifest || !/^[A-Za-z0-9._-]{1,100}$/.test(manifest.id)
    || !version.test(manifest.version) || !version.test(manifest.fromVersion)
    || manifest.version === manifest.fromVersion
    || !['desktop', 'agent', 'android'].includes(manifest.target)
    || !/^[a-f0-9]{64}$/.test(manifest.sha256)
    || !manifest.signature?.keyId?.trim() || !manifest.signature?.value?.trim()
    || !Number.isSafeInteger(manifest.schema?.from) || manifest.schema.from < 1
    || !Number.isSafeInteger(manifest.schema?.to) || manifest.schema.to < manifest.schema.from) {
    throw new Error('Manifest de mise à jour invalide');
  }
  const source = new URL(manifest.source);
  if (source.protocol !== 'https:' || source.username || source.password || source.hash) {
    throw new Error('Source de mise à jour invalide');
  }
}

export type UpgradeData = {
  schemaVersion: number;
  associations: Record<string, unknown>;
  profiles: Record<string, unknown>;
  [key: string]: unknown;
};
export interface UpgradeMigration {
  from: number;
  to: number;
  apply(copy: UpgradeData): UpgradeData;
}

/** Explicit contiguous migrations on a detached snapshot; preservation is mandatory. */
export function migrateUpgradeData(snapshot: UpgradeData, to: number, migrations: UpgradeMigration[]): UpgradeData {
  if (!Number.isSafeInteger(snapshot.schemaVersion) || snapshot.schemaVersion < 1
    || !Number.isSafeInteger(to) || to < snapshot.schemaVersion
    || !snapshot.associations || !snapshot.profiles) throw new Error('Schéma de données invalide');
  let result = structuredClone(snapshot);
  const associations = JSON.stringify(snapshot.associations);
  const profiles = JSON.stringify(snapshot.profiles);
  while (result.schemaVersion < to) {
    const candidates = migrations.filter(step => step.from === result.schemaVersion && step.to === step.from + 1);
    if (candidates.length !== 1) throw new Error('Migration versionnée manquante ou ambiguë');
    const step = candidates[0];
    result = step.apply(structuredClone(result));
    if (result.schemaVersion !== step.to || JSON.stringify(result.associations) !== associations
      || JSON.stringify(result.profiles) !== profiles) throw new Error('Migration altère associations ou profils');
  }
  return structuredClone(result);
}

/** One durable journal per installation; a new release requires explicit archival by the host. */
export class UpgradePlanner {
  constructor(private readonly adapters: UpgradeAdapters) {}

  private event(journal: UpgradeJournal, phase: UpgradePhase, message: string) {
    journal.phase = phase;
    const last = journal.events.at(-1);
    if (last?.phase !== phase || last.message !== message) {
      journal.events.push({ sequence: journal.events.length + 1, phase, message });
    }
  }

  private async save(journal: UpgradeJournal) {
    await this.adapters.write(structuredClone(journal));
  }

  private async defer(journal: UpgradeJournal, message: string): Promise<UpgradeJournal> {
    this.event(journal, 'deferred', message);
    await this.save(journal);
    return structuredClone(journal);
  }

  private accept(journal: UpgradeJournal, operation: UpgradeOperation, receipt: UpgradeReceipt) {
    if (!receipt?.reference?.trim()) throw new Error('Confirmation durable absente');
    if (operation === 'stage') { journal.staged = receipt.reference; this.event(journal, 'staged', 'Artefact isolé'); }
    if (operation === 'backup') journal.backup = receipt.reference;
    if (operation === 'migrate') journal.migration = receipt.reference;
    if (operation === 'install') { journal.installed = true; this.event(journal, 'installed', 'Version et données relues'); }
    if (operation === 'rollback') { journal.rolledBack = true; this.event(journal, 'rolledBack', 'Application et sauvegarde restaurées et relues'); }
    delete journal.pending;
  }

  private async effect(journal: UpgradeJournal, operation: UpgradeOperation, action: (key: string) => Promise<UpgradeReceipt>) {
    const key = `${journal.manifest.id}:${operation}`;
    journal.pending = { operation, key };
    await this.save(journal); // Write-ahead intent: never execute without durable intent.
    if (operation === 'install' || operation === 'rollback') {
      try { await this.adapters.requireSafe(); }
      catch (error) {
        // The effect has definitely not run; a later explicit attempt is safe.
        delete journal.pending;
        await this.save(journal);
        throw error;
      }
    }
    const receipt = await action(key);
    this.accept(journal, operation, receipt);
    await this.save(journal);
  }

  async register(manifest: UpgradeManifest, artifact: string): Promise<UpgradeJournal> {
    // Detach before waiting for the installation lock.
    const input = structuredClone(manifest);
    validateUpgradeManifest(input);
    if (!artifact.trim()) throw new Error('Artefact local requis');
    return this.adapters.exclusive(async () => {
      const existing = await this.adapters.read();
      if (existing) {
        if (JSON.stringify(existing.manifest) !== JSON.stringify(input) || existing.artifact !== artifact) {
          throw new Error('Un autre contrat occupe déjà le journal');
        }
        return structuredClone(existing);
      }
      const journal: UpgradeJournal = {
        manifest: input, artifact, phase: 'downloaded', installed: false, rolledBack: false,
        events: [{ sequence: 1, phase: 'downloaded', message: 'Artefact local déclaré, non vérifié' }],
      };
      await this.save(journal);
      return structuredClone(journal);
    });
  }

  async prepare(): Promise<UpgradeJournal> { return this.run('prepare'); }
  /** Call only following explicit user confirmation; never schedule an automatic restart. */
  async install(): Promise<UpgradeJournal> { return this.run('install'); }
  /** Explicit recovery action, also guarded against active/unknown OBS. */
  async rollback(): Promise<UpgradeJournal> { return this.run('rollback'); }

  private run(mode: 'prepare' | 'install' | 'rollback'): Promise<UpgradeJournal> {
    return this.adapters.exclusive(async () => {
      const stored = await this.adapters.read();
      if (!stored) throw new Error('Aucune mise à jour enregistrée');
      const journal = structuredClone(stored);
      validateUpgradeManifest(journal.manifest);
      // Reconciliation only reads evidence; it cannot retry a possibly applied effect.
      if (journal.pending) {
        let receipt: UpgradeReceipt | undefined;
        try { receipt = await this.adapters.reconcile(journal.pending.operation, journal.pending.key); }
        catch { return this.defer(journal, 'Relecture de l’opération interrompue impossible'); }
        if (!receipt?.reference?.trim()) return this.defer(journal, 'Opération interrompue incertaine : récupération manuelle requise');
        this.accept(journal, journal.pending.operation, receipt);
        await this.save(journal);
      }
      if (journal.rolledBack || (journal.installed && mode !== 'rollback')) return structuredClone(journal);
      try {
        await this.adapters.requireSafe();
        if (mode === 'rollback') {
          if (!journal.backup) return this.defer(journal, 'Rollback impossible : sauvegarde absente');
          await this.adapters.requireSafe();
          await this.effect(journal, 'rollback', key => this.adapters.rollback(structuredClone(journal), key));
        } else {
          if (!journal.staged) await this.effect(journal, 'stage', key => this.adapters.stage(structuredClone(journal.manifest), journal.artifact, key));
          // Reverify on every invocation, including after a crash or a long deferral.
          if (await this.adapters.verify(structuredClone(journal.manifest), journal.staged!) !== true) {
            return this.defer(journal, 'Signature, source ou empreinte non vérifiée');
          }
          if (journal.phase !== 'verified') this.event(journal, 'verified', 'Signature, source et empreinte vérifiées');
          await this.save(journal);
          if (mode === 'prepare') return structuredClone(journal);
          if (!journal.backup) await this.effect(journal, 'backup', key => this.adapters.backup(structuredClone(journal.manifest), key));
          if (!journal.migration) await this.effect(journal, 'migrate', key => this.adapters.migrate(structuredClone(journal.manifest), journal.backup!, key));
          await this.adapters.requireSafe();
          await this.effect(journal, 'install', key => this.adapters.install(structuredClone(journal), key));
        }
        return structuredClone(journal);
      } catch (error) {
        // Read durable state: a failed completion write must retain the pending intent.
        const durable = await this.adapters.read();
        if (!durable) throw error;
        return this.defer(structuredClone(durable), `Mise à jour différée : ${error instanceof Error ? error.message : 'échec adapter'}`);
      }
    });
  }
}
