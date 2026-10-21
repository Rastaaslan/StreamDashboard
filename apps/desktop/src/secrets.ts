import { safeStorage } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { SecretStore } from '../../server/src/storage.js';

interface SecurePayload {
  controller?: { credential: string };
  controllerDevices?: Record<string, string>;
  controllerBindings?: import('../../../packages/contracts/src/control.js').ControllerConfiguration;
  youtube?: Record<string, string>;
  twitch?: Record<string, string>;
  google?: Record<string, string>;
  googleClientSecret?: string;
  obsPassword?: string;
  discordToken?: string;
  streamlabsToken?: string;
  streamlabsWidgetToken?: string;
  streamlabsOAuth?: { clientId: string; clientSecret: string; accessToken?: string };
  wizebot?: { apiBaseUrl: string; token: string };
}

export class ElectronSecretStore implements SecretStore {
  readonly persistent: boolean = true;
  private readonly file: string;
  private static writes = new Map<string,Promise<void>>();

  constructor(userData: string) { this.file = path.resolve(userData, 'secure', 'credentials.dat'); }

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
    await ElectronSecretStore.writes.get(this.file);
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
    const operation = (ElectronSecretStore.writes.get(this.file) ?? Promise.resolve()).then(async () => {
      const value = await this.readNow();
      change(value);
      await this.writeNow(value);
    });
    const tail = operation.catch(() => undefined);
    ElectronSecretStore.writes.set(this.file, tail);
    void tail.then(() => { if(ElectronSecretStore.writes.get(this.file) === tail) ElectronSecretStore.writes.delete(this.file); });
    return operation;
  }

  async getTwitchTokens() { return (await this.read()).twitch ?? null; }
  async getController() { return (await this.read()).controller ?? null; }
  async getControllerDevice(server: string) { return (await this.read()).controllerDevices?.[server] || ''; }
  async setControllerDevice(server: string, credential: string) { await this.update(value => { value.controllerDevices = { ...value.controllerDevices, [server]:credential }; }); }
  async setController(controller: { credential: string }) { await this.update(value => { if (value.controller?.credential !== controller.credential) delete value.controllerBindings; value.controller = { ...controller }; }); }
  async getControllerBindings() { return (await this.read()).controllerBindings ?? null; }
  async setControllerBindings(bindings: SecurePayload['controllerBindings']) { await this.update(value => { if (bindings) value.controllerBindings = structuredClone(bindings); else delete value.controllerBindings; }); }
  async getYouTubeTokens() { return (await this.read()).youtube ?? null; }
  async setYouTubeTokens(youtube: Record<string, string>) { await this.update(value => { value.youtube = { ...youtube }; }); }
  async clearYouTubeTokens() { await this.update(value => { delete value.youtube; }); }
  async setTwitchTokens(twitch: Record<string, string>) { await this.update(value => { value.twitch = { ...twitch }; }); }
  async clearTwitchTokens() { await this.update(value => { delete value.twitch; }); }
  async getObsPassword() { return (await this.read()).obsPassword ?? ''; }
  async setObsPassword(obsPassword: string) { await this.update(value => { value.obsPassword = obsPassword; }); }
  async getGoogleClientSecret() { return (await this.read()).googleClientSecret ?? ''; }
  async setGoogleClientSecret(secret: string) { await this.update(value => { value.googleClientSecret = secret; }); }
  async clearGoogleClientSecret() { await this.update(value => { delete value.googleClientSecret; }); }
  async getGoogleTokens() { return (await this.read()).google ?? null; }
  async setGoogleTokens(google: Record<string, string>) { await this.update(value => { value.google = { ...google }; }); }
  async clearGoogleTokens() { await this.update(value => { delete value.google; }); }
  async getDiscordToken() { return (await this.read()).discordToken ?? ''; }
  async setDiscordToken(discordToken: string) { await this.update(value => { value.discordToken = discordToken; }); }
  async clearDiscordToken() { await this.update(value => { delete value.discordToken; }); }
  async getStreamlabsToken() { return (await this.read()).streamlabsToken ?? ''; }
  async setStreamlabsToken(streamlabsToken: string) { await this.update(value => { value.streamlabsToken = streamlabsToken; }); }
  async clearStreamlabsToken() { await this.update(value => { delete value.streamlabsToken; }); }
  async getStreamlabsWidgetToken() { return (await this.read()).streamlabsWidgetToken ?? ''; }
  async setStreamlabsWidgetToken(token: string) { await this.update(value => { value.streamlabsWidgetToken = token; }); }
  async clearStreamlabsWidgetToken() { await this.update(value => { delete value.streamlabsWidgetToken; }); }
  async getStreamlabsOAuth() { const value = (await this.read()).streamlabsOAuth; return value ? { ...value } : null; }
  async setStreamlabsOAuth(streamlabsOAuth: { clientId: string; clientSecret: string; accessToken?: string }) { await this.update(value => { value.streamlabsOAuth = { ...streamlabsOAuth }; }); }
  async clearStreamlabsOAuth() { await this.update(value => { delete value.streamlabsOAuth; }); }
  async getWizeBotConfiguration() { const value = (await this.read()).wizebot; return value ? { ...value } : null; }
  async setWizeBotConfiguration(wizebot: { apiBaseUrl: string; token: string }) { await this.update(value => { value.wizebot = { ...wizebot }; }); }
  async clearWizeBotConfiguration() { await this.update(value => { delete value.wizebot; }); }
}
