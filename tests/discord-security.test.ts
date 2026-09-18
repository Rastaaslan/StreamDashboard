import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MemorySecretStore } from '../apps/server/src/storage.js';
import { toRemoteDashboardState } from '../apps/server/src/remote-policy.js';

describe('frontière de secret Discord', () => {
  it('conserve le token dans le SecretStore et jamais dans les assets mobiles', async () => {
    const secrets = new MemorySecretStore(); await secrets.setDiscordToken('bot-secret'); expect(await secrets.getDiscordToken()).toBe('bot-secret'); await secrets.clearDiscordToken(); expect(await secrets.getDiscordToken()).toBe('');
    for (const file of ['index.html', 'mobile.js', 'transport.js', 'companion-store.js']) expect(readFileSync(new URL(`../apps/mobile/${file}`, import.meta.url), 'utf8')).not.toContain('DISCORD_BOT_TOKEN');
  });

  it('projette seulement l’état public Discord vers la télécommande', () => {
    const remote = toRemoteDashboardState({ at: '', mode: 'idle', timer: { running: false, duration: 1, remaining: 1, deadline: null }, planning: [], checklist: [], obs: { connected: false, streaming: false, recording: false, scene: null, scenes: [], inputs: {}, activeAudioInputs: [], mediaInputs: [], error: null, obsVersion: null, websocketVersion: null }, nextLive: null, health: {}, settings: { streamerName: 'x', accent: 'violet', confirmStop: true, obsUrl: '', obsPasswordSet: false, twitchConnected: false, twitchUserName: null, launchObs: false, modeScenes: {} }, twitch: { connected: false, userName: null, displayName: null, error: null, syncing: false, lastSyncedAt: null, deviceAuthorization: null }, discord: { configured: true, connected: true, guildId: '1', guildName: 'Camp', channelId: '2', channelName: 'planning', error: null }, runtime: { serverVersion: '', nodeVersion: '', electronVersion: null, platform: '', port: 0, logsPath: null } });
    expect(remote.discord).toEqual({ configured: true, connected: true, guildId: '1', guildName: 'Camp', channelId: '2', channelName: 'planning', error: null }); expect(JSON.stringify(remote)).not.toContain('token');
  });
});
