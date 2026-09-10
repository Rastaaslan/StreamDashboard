import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

export const DASHBOARD_SCHEMA_VERSION = 3;

export interface SecretStore {
  readonly persistent: boolean;
  getTwitchTokens(): Promise<Record<string, string> | null>;
  setTwitchTokens(tokens: Record<string, string>): Promise<void>;
  clearTwitchTokens(): Promise<void>;
  getObsPassword(): Promise<string>;
  setObsPassword(password: string): Promise<void>;
  getGoogleTokens?(): Promise<Record<string, string> | null>;
  setGoogleTokens?(tokens: Record<string, string>): Promise<void>;
  clearGoogleTokens?(): Promise<void>;
}

export class MemorySecretStore implements SecretStore {
  readonly persistent: boolean = false;
  private tokens: Record<string, string> | null = null;
  private obsPassword = '';
  private google: Record<string, string> | null = null;
  async getTwitchTokens() { return this.tokens ? { ...this.tokens } : null; }
  async setTwitchTokens(tokens: Record<string, string>) { this.tokens = { ...tokens }; }
  async clearTwitchTokens() { this.tokens = null; }
  async getObsPassword() { return this.obsPassword; }
  async setObsPassword(password: string) { this.obsPassword = password; }
  async getGoogleTokens() { return this.google ? { ...this.google } : null; }
  async setGoogleTokens(tokens: Record<string, string>) { this.google = { ...tokens }; }
  async clearGoogleTokens() { this.google = null; }
}

/** JSON configuration store using serialized temp + fsync + rename writes. */
export class AtomicJsonStore<T extends object> {
  private writes: Promise<void> = Promise.resolve();
  constructor(readonly file: string) {}

  async read(fallback: T): Promise<T> {
    await this.writes;
    try {
      const value = JSON.parse(await readFile(this.file, 'utf8')) as Partial<T>;
      return { ...fallback, ...value };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(fallback);
      await this.quarantineCorruptFile();
      return structuredClone(fallback);
    }
  }

  write(value: T): Promise<void> {
    const snapshot = structuredClone(value);
    const operation = this.writes.then(() => this.writeNow(snapshot));
    this.writes = operation.catch(() => undefined);
    return operation;
  }

  private async writeNow(value: T): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
    const handle = await open(temporary, 'wx');
    try {
      await handle.writeFile(JSON.stringify(value, null, 2), 'utf8');
      await handle.sync();
    } finally { await handle.close(); }
    try { await rename(temporary, this.file); }
    catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
  }

  private async quarantineCorruptFile() {
    await mkdir(path.dirname(this.file), { recursive: true });
    await rename(this.file, `${this.file}.corrupt-${Date.now()}`).catch(() => undefined);
  }
}

/** Migrates legacy plaintext Twitch OAuth fields only after the secure destination confirms its write. */
export async function migratePlaintextTwitchTokens<T extends { twitch?: object; schemaVersion?: number }>(data: T, secrets: SecretStore) {
  const twitch = data.twitch as Record<string, unknown> | undefined;
  const accessToken = typeof twitch?.accessToken === 'string' ? twitch.accessToken : '';
  const refreshToken = typeof twitch?.refreshToken === 'string' ? twitch.refreshToken : '';
  if ((accessToken || refreshToken) && secrets.persistent) {
    await secrets.setTwitchTokens({ accessToken, refreshToken });
    delete twitch?.accessToken; delete twitch?.refreshToken;
  }
  data.schemaVersion = DASHBOARD_SCHEMA_VERSION;
  return Boolean((accessToken || refreshToken) && secrets.persistent);
}
