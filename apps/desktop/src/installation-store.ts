import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { migrateInstallation, planInstallationChange, validateInstallation, type Installation, type InstallationChanges, type InstallationPlan } from '../../mobile/shared/installation.js';

export class InstallationStore {
  private tail: Promise<unknown> = Promise.resolve();
  private readFlight?: Promise<Installation>;
  readonly file: string;
  constructor(private directory: string, private initialRole = 'stream') { this.file = path.join(directory, 'installation-v2.json'); }
  private async atomic(file: string, value: Installation) {
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
  private async load(): Promise<Installation> {
    try { return validateInstallation(JSON.parse(await readFile(this.file, 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    let legacy: {name?:string;role?:string;configured?:boolean} = {role:this.initialRole};
    try { legacy = { ...JSON.parse(await readFile(path.join(this.directory, 'device-role.json'), 'utf8')), configured: true }; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const value = migrateInstallation({ id: randomUUID(), platform: 'windows', legacy });
    await this.atomic(this.file, value);
    return value;
  }
  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work); this.tail = result.catch(() => undefined); return result;
  }
  change(changes: InstallationChanges, expectedRevision: number, beforeCommit: (plan: InstallationPlan) => Promise<void>) {
    return this.serialized(async () => {
      const current = await this.read(), plan = planInstallationChange(current, changes, expectedRevision);
      await beforeCommit(plan);
      await this.atomic(this.file + '.backup', current);
      await beforeCommit(plan);
      await this.atomic(this.file, plan.next);
      return plan;
    });
  }
  restore(expectedRevision: number, beforeCommit: (plan: InstallationPlan) => Promise<void>) {
    return this.serialized(async () => {
      const current = await this.read();
      if (current.revision !== expectedRevision) throw new Error('Installation modifiée ailleurs.');
      const next = validateInstallation(JSON.parse(await readFile(this.file + '.backup', 'utf8')));
      // Runtime paths and local identity are immutable across all transitions.
      if (next.localDeviceId !== current.localDeviceId || next.runtimeProfile !== current.runtimeProfile) throw new Error('Sauvegarde d’un autre appareil.');
      next.revision = current.revision + 1;
      const obs = (v: Installation) => v.devices.find(d => d.id === v.localDeviceId)!.roles.includes('obs-executor');
      const plan = { next, restart: obs(next) !== obs(current), summary: ['Configuration précédente restaurée.'] };
      await beforeCommit(plan);
      await this.atomic(this.file + '.backup', current);
      await beforeCommit(plan);
      await this.atomic(this.file, next);
      return plan;
    });
  }
}
