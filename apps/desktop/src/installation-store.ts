import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {ensureRc117Backup} from './migration-backup.js';
import { migrateInstallation, planInstallationChange, installationRequiresRestart, validateInstallation, type Installation, type InstallationChanges, type InstallationPlan } from '../../mobile/shared/installation.js';

type Transition = { version: 1; before: Installation; next: Installation; backupBefore: Installation | null };
export class InstallationStore {
  private tail: Promise<unknown> = Promise.resolve();
  private readFlight?: Promise<Installation>;
  readonly file: string;
  constructor(private directory: string, private initialRole = 'stream') { this.file = path.join(directory, 'installation-v2.json'); }
  private async atomic(file: string, value: unknown) {
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); }
    finally { await handle.close(); }
    try { await rename(temporary, file); }
    finally { await unlink(temporary).catch(() => undefined); }
  }
  read(): Promise<Installation> {
    this.readFlight ??= this.load().finally(() => { this.readFlight = undefined; });
    return this.readFlight.then(value => structuredClone(value));
  }
  private async optional(file: string): Promise<unknown | undefined> {
    try { return JSON.parse(await readFile(file, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  private async load(): Promise<Installation> {
    const stored = await this.optional(this.file);
    if (stored !== undefined) return validateInstallation(stored);
    // A missing current file during a recorded transition is not a first run.
    if (await this.optional(this.file + '.pending') !== undefined) throw new Error('Installation interrompue : le fichier courant manque. Conservez les fichiers de récupération.');
    let legacy: {name?:string;role?:string;configured?:boolean} = {role:this.initialRole};
    const previous = await this.optional(path.join(this.directory, 'device-role.json'));
    if (previous !== undefined) legacy = { ...previous as typeof legacy, configured: true };
    await ensureRc117Backup(this.directory);
    const value = migrateInstallation({ id: randomUUID(), platform: 'windows', legacy });
    await this.atomic(this.file, value);
    return value;
  }
  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work); this.tail = result.catch(() => undefined); return result;
  }
  /** The current atomic document chooses the outcome. Reconcile OS effects
   * before consuming the journal; a failed recovery remains safely retryable. */
  recover(applyEffects: (current: Installation) => Promise<void>): Promise<Installation> {
    return this.serialized(async () => {
      const current = await this.read();
      const raw = await this.optional(this.file + '.pending') as Transition | undefined;
      if (raw === undefined) return current;
      if (raw.version !== 1) throw new Error('Journal de transition incompatible.');
      const before = validateInstallation(raw.before), next = validateInstallation(raw.next);
      const backupBefore = raw.backupBefore === null ? null : validateInstallation(raw.backupBefore);
      if (before.localDeviceId !== current.localDeviceId || next.localDeviceId !== current.localDeviceId || before.runtimeProfile !== current.runtimeProfile || next.runtimeProfile !== current.runtimeProfile || next.revision !== before.revision + 1) throw new Error('Journal de transition d’une autre installation.');
      const committed = JSON.stringify(current) === JSON.stringify(next);
      if (!committed && JSON.stringify(current) !== JSON.stringify(before)) throw new Error('La configuration a changé depuis l’interruption. Récupération automatique suspendue.');
      await applyEffects(structuredClone(current));
      if (committed) await this.atomic(this.file + '.backup', before);
      else if (backupBefore) await this.atomic(this.file + '.backup', backupBefore);
      else await unlink(this.file + '.backup').catch(error => { if (error.code !== 'ENOENT') throw error; });
      await unlink(this.file + '.pending');
      return current;
    });
  }
  private async commit(current: Installation, plan: InstallationPlan, beforeCommit: (plan: InstallationPlan) => Promise<void>) {
    if (await this.optional(this.file + '.pending') !== undefined) throw new Error('Une transition interrompue doit être récupérée avant un nouveau changement.');
    const saved = await this.optional(this.file + '.backup');
    const transition: Transition = { version: 1, before: current, next: plan.next, backupBefore: saved === undefined ? null : validateInstallation(saved) };
    await this.atomic(this.file + '.pending', transition);
    await beforeCommit(plan);
    await this.atomic(this.file + '.backup', current);
    await beforeCommit(plan);
    await this.atomic(this.file, plan.next);
    // A cleanup failure must not report that an already committed change failed.
    await unlink(this.file + '.pending').catch(() => undefined);
    return plan;
  }
  change(changes: InstallationChanges, expectedRevision: number, beforeCommit: (plan: InstallationPlan) => Promise<void>) {
    return this.serialized(async () => {
      const current = await this.read(), plan = planInstallationChange(current, changes, expectedRevision);
      return this.commit(current, plan, beforeCommit);
    });
  }
  restore(expectedRevision: number, beforeCommit: (plan: InstallationPlan) => Promise<void>) {
    return this.serialized(async () => {
      const current = await this.read();
      if (current.revision !== expectedRevision) throw new Error('Installation modifiée ailleurs.');
      const next = validateInstallation(JSON.parse(await readFile(this.file + '.backup', 'utf8')));
      if (next.localDeviceId !== current.localDeviceId || next.runtimeProfile !== current.runtimeProfile) throw new Error('Sauvegarde d’un autre appareil.');
      next.revision = current.revision + 1;
      return this.commit(current, { next, restart: installationRequiresRestart(current, next), summary: ['Configuration précédente restaurée.'] }, beforeCommit);
    });
  }
}
