import { safeStorage } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { SecretStore } from '../../server/src/storage.js';

interface SecurePayload {
  twitch?: Record<string, string>;
  google?: Record<string, string>;
  obsPassword?: string;
}

export class ElectronSecretStore implements SecretStore {
  readonly persistent: boolean = true;
  private readonly file: string;
  private writes: Promise<void> = Promise.resolve();

  constructor(userData: string) { this.file = path.join(userData, 'secure', 'credentials.dat'); }

  private async readNow(): Promise<SecurePayload> {
    try {
      const encrypted = await readFile(this.file);
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Le stockage sécurisé Windows est indisponible.');
      return JSON.parse(safeStorage.decryptString(encrypted)) as SecurePayload;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw error;
    }
  }

  private async read(): Promise<SecurePayload> {
    await this.writes;
    return this.readNow();
  }

  private async writeNow(value: SecurePayload) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Le stockage sécurisé Windows est indisponible. Les secrets ne seront pas enregistrés.');
    }
    await mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
    const encrypted = safeStorage.encryptString(JSON.stringify(value));
    const handle = await open(temporary, 'wx');
    try {
      await handle.writeFile(encrypted);
      await handle.sync();
    } catch (error) {
      await handle.close().catch(() => undefined);
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
    await handle.close();
    try {
      await rename(temporary, this.file);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  private update(change: (value: SecurePayload) => void) {
    const operation = this.writes.then(async () => {
      const value = await this.readNow();
      change(value);
      await this.writeNow(value);
    });
    this.writes = operation.catch(() => undefined);
    return operation;
  }

  async getTwitchTokens() { return (await this.read()).twitch ?? null; }
  async setTwitchTokens(twitch: Record<string, string>) { await this.update(value => { value.twitch = { ...twitch }; }); }
  async clearTwitchTokens() { await this.update(value => { delete value.twitch; }); }
  async getObsPassword() { return (await this.read()).obsPassword ?? ''; }
  async setObsPassword(obsPassword: string) { await this.update(value => { value.obsPassword = obsPassword; }); }
  async getGoogleTokens() { return (await this.read()).google ?? null; }
  async setGoogleTokens(google: Record<string, string>) { await this.update(value => { value.google = { ...google }; }); }
  async clearGoogleTokens() { await this.update(value => { delete value.google; }); }
}
