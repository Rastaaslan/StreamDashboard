import { safeStorage } from 'electron';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SecretStore } from '../../server/src/storage.js';

interface SecurePayload { twitch?: Record<string, string>; obsPassword?: string }
export class ElectronSecretStore implements SecretStore {
  readonly persistent: boolean = true;
  private file: string;
  private writes: Promise<void> = Promise.resolve();
  constructor(userData: string) { this.file = path.join(userData, 'secure', 'credentials.dat'); }
  private async read(): Promise<SecurePayload> {
    try { const encrypted = await readFile(this.file); return JSON.parse(safeStorage.decryptString(encrypted)) as SecurePayload; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error; }
  }
  private async write(value: SecurePayload) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Le stockage sécurisé Windows est indisponible. Les secrets ne seront pas enregistrés.');
    await mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    await writeFile(temporary, safeStorage.encryptString(JSON.stringify(value)));
    await rename(temporary, this.file);
  }
  private update(change: (value: SecurePayload) => void) { const operation = this.writes.then(async () => { const value = await this.read(); change(value); await this.write(value); }); this.writes = operation.catch(() => undefined); return operation; }
  async getTwitchTokens() { return (await this.read()).twitch ?? null; }
  async setTwitchTokens(twitch: Record<string, string>) { await this.update(value => { value.twitch = twitch; }); }
  async clearTwitchTokens() { await this.update(value => { delete value.twitch; }); }
  async getObsPassword() { return (await this.read()).obsPassword ?? ''; }
  async setObsPassword(obsPassword: string) { await this.update(value => { value.obsPassword = obsPassword; }); }
}
