import { safeStorage } from 'electron';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SecretStore } from '../../server/src/storage.js';

interface SecurePayload { twitch?: Record<string, string>; obsPassword?: string }
export class ElectronSecretStore implements SecretStore {
  readonly persistent: boolean = true;
  private file: string;
  constructor(userData: string) { this.file = path.join(userData, 'secure', 'credentials.dat'); }
  private async read(): Promise<SecurePayload> {
    try { const encrypted = await readFile(this.file); return JSON.parse(safeStorage.decryptString(encrypted)) as SecurePayload; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error; }
  }
  private async write(value: SecurePayload) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Le stockage sécurisé Windows est indisponible. Les secrets ne seront pas enregistrés.');
    await mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, safeStorage.encryptString(JSON.stringify(value)));
    await rename(temporary, this.file);
  }
  async getTwitchTokens() { return (await this.read()).twitch ?? null; }
  async setTwitchTokens(twitch: Record<string, string>) { await this.write({ ...await this.read(), twitch }); }
  async clearTwitchTokens() { const value = await this.read(); delete value.twitch; await this.write(value); }
  async getObsPassword() { return (await this.read()).obsPassword ?? ''; }
  async setObsPassword(obsPassword: string) { await this.write({ ...await this.read(), obsPassword }); }
}
