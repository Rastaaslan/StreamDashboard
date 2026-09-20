import { afterEach, describe, expect, it } from 'vitest';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { startDashboardServer, type DashboardServerHandle } from '../apps/server/src/index.js';
import { MemorySecretStore } from '../apps/server/src/storage.js';

let dashboard: DashboardServerHandle | undefined; let dataDir = '';
afterEach(async () => { if (dashboard) await dashboard.stop(); if (dataDir) await rm(dataDir, { recursive: true, force: true }); dashboard = undefined; dataDir = ''; });
async function start(options: Parameters<typeof startDashboardServer>[0] = {}) { dataDir = await mkdtemp(path.join(os.tmpdir(), 'streamdashboard-api-')); dashboard = await startDashboardServer({ port: 0, dataDir, logger: { info() {}, warn() {}, error() {} }, ...options }); return dashboard; }
async function wsRejected(url: string, origin: string) {
  await expect(new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(url, { origin });
    ws.on('open', () => { ws.close(); reject(new Error(`origine acceptée : ${origin}`)); });
    ws.on('error', () => resolve());
  })).resolves.toBeUndefined();
}

describe('API publique v1', () => {
  it('annonce protocole, capacités et état sans secrets', async () => {
    const app = await start({ twitchClientId: '' });
    const capabilities = await fetch(`${app.url}/api/v1/capabilities`).then(r => r.json());
    const stateText = await fetch(`${app.url}/api/v1/state`).then(r => r.text());
    const connections = await fetch(`${app.url}/api/v1/connections`).then(r => r.json());
    expect(connections.items.find((item: { id: string }) => item.id === 'obs')).toMatchObject({ mode: 'custom', capabilities: ['test','configure','scenes','audio'] });
    expect(connections.items.find((item: { id: string }) => item.id === 'twitch')).toMatchObject({ status: 'unavailable', mode: 'official', capabilities: [], message: 'Configuration mainteneur requise' });
    expect(connections.items.find((item: { id: string }) => item.id === 'discord')).toMatchObject({ status: 'unavailable', mode: 'official', capabilities: [] });
    expect(capabilities).toMatchObject({ protocolVersion: 1, accessMode: 'desktop-local' });
    for (const feature of ['mobile-profile-presentation','mobile-live-control-config','mobile-provider-actions','soundboard-live-volume']) expect(capabilities.features).toContain(feature);
    expect(stateText).not.toMatch(/accessToken|refreshToken|deviceCode|obsPassword\"/);
    const event = await new Promise<string>((resolve, reject) => { const ws = new WebSocket(app.url.replace('http:', 'ws:') + '/ws/v1'); ws.on('message', data => { const text = data.toString(); if (text.includes('state.updated')) { ws.close(); resolve(text); } }); ws.on('error', reject); });
    expect(event).not.toMatch(/accessToken|refreshToken|deviceCode|obsPassword\"/);
    const response = await fetch(`${app.url}/`);
    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain('ws://127.0.0.1:*');
    expect(csp).not.toContain('connect-src *');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
  });

  it('annonce Twitch disponible quand un Client ID officiel est provisionné', async () => {
    const app = await start({ twitchClientId: 'test-client-id' });
    const connections = await fetch(`${app.url}/api/v1/connections`).then(r => r.json());
    expect(connections.items.find((item: { id: string }) => item.id === 'twitch')).toMatchObject({
      status: 'disconnected',
      mode: 'official',
      capabilities: ['connect','disconnect','test','chat','audience','clips'],
    });
  });

  it('persiste, exporte et réimporte le profil YAML canonique après restart', async () => {
    const app = await start();
    const initial = await fetch(`${app.url}/api/v1/profile`).then(response => response.json());
    initial.profile.profile.displayName = 'Profil persistant';
    initial.profile.onboarding.completed = true;
    expect((await fetch(`${app.url}/api/v1/profile`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(initial.profile) })).status).toBe(200);
    const exported = await fetch(`${app.url}/api/v1/profile/export`); const yaml = await exported.text();
    expect(exported.headers.get('content-type')).toContain('application/yaml');
    expect(exported.headers.get('content-disposition')).toContain('streamdashboard.streamdashboard.yaml');
    expect(yaml).toMatch(/^version: 1\nprofile:\n/); expect(yaml.trimStart()).not.toMatch(/^\{/);
    const invalid = await fetch(`${app.url}/api/v1/profile/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'version: 1\nprofile:\n  accessToken: nope' }) });
    expect(invalid.status).toBe(400);
    const imported = await fetch(`${app.url}/api/v1/profile/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: yaml }) }).then(response => response.json());
    expect(imported.backup).toMatch(/backup/);
    await dashboard!.stop(); dashboard = undefined; dashboard = await startDashboardServer({ port: 0, dataDir, logger: { info() {}, warn() {}, error() {} } });
    expect(await fetch(`${dashboard.url}/api/v1/profile`).then(response => response.json())).toMatchObject({ profile: { profile: { displayName: 'Profil persistant' }, onboarding: { completed: true } } });
  });

  it('borne l’édition Mobile du profil à la présentation et à l’apparence', async () => {
    const app = await start();
    const updated = await fetch(`${app.url}/api/v1/profile/presentation`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        profile: { displayName: 'Mobile', channelName: 'Chaîne Mobile', language: 'fr' },
        appearance: { theme: 'oled', preset: 'compact', accent: '#663399', density: 'compact', radius: 'round', textScale: 'large' },
      }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ profile: { profile: { displayName: 'Mobile', channelName: 'Chaîne Mobile' }, appearance: { theme: 'oled', preset: 'compact', accent: '#663399', density: 'compact', radius: 'round', textScale: 'large' } } });

    const forbidden = await fetch(`${app.url}/api/v1/profile/presentation`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modules: { twitch: false } }),
    });
    expect(forbidden.status).toBe(400);
    const current = await fetch(`${app.url}/api/v1/profile`).then(response => response.json());
    expect(current.profile.modules.twitch).toBe(true);
  });

  it('borne la configuration contextuelle Mobile aux mappings Live non sensibles', async () => {
    const app = await start();
    const mic = await fetch(`${app.url}/api/v1/settings/live-control`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ primaryMicInput: 'Mic USB' }),
    });
    expect(mic.status).toBe(200);
    expect(await mic.json()).toMatchObject({ settings: { primaryMicInput: 'Mic USB' } });

    const scene = await fetch(`${app.url}/api/v1/settings/live-control`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'chatting', scene: 'Chatting' }),
    });
    expect(scene.status).toBe(200);
    expect(await scene.json()).toMatchObject({ settings: { chattingScene: 'Chatting' } });

    const forbidden = await fetch(`${app.url}/api/v1/settings/live-control`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ obsUrl: 'ws://127.0.0.1:4455' }),
    });
    expect(forbidden.status).toBe(400);
  });

  it('migre une installation sans profil sans déplacer ni perdre les secrets providers', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'streamdashboard-migration-'));
    await writeFile(path.join(dataDir, 'dashboard.json'), JSON.stringify({ schemaVersion: 6, settings: { streamerName: 'Ancienne chaîne' }, twitch: { displayName: 'LegacyChannel' } }));
    const secrets = new MemorySecretStore(); await secrets.setTwitchTokens({ accessToken: 'twitch-a', refreshToken: 'twitch-r' }); await secrets.setDiscordToken('discord-secret'); await secrets.setGoogleTokens?.({ accessToken: 'google-a', refreshToken: 'google-r' }); await secrets.setStreamlabsToken?.('streamlabs-secret'); await secrets.setWizeBotConfiguration?.({ apiBaseUrl: 'https://example.test/', token: 'wize-secret' });
    dashboard = await startDashboardServer({ port: 0, dataDir, secretStore: secrets, googleClientId: 'google-client', streamlabsTransport: { connect: async () => async () => undefined }, wizebotTransport: { status: async () => ({ name: 'Legacy', connected: true }) }, logger: { info() {}, warn() {}, error() {} } });
    const product = await fetch(`${dashboard.url}/api/v1/profile`).then(response => response.json());
    expect(product.profile).toMatchObject({ version: 1, profile: { displayName: 'Ancienne chaîne', channelName: 'LegacyChannel' }, modules: { twitch: true, googleCalendar: true, discord: true, streamlabs: true, wizebot: true } });
    expect(await secrets.getTwitchTokens()).toEqual({ accessToken: 'twitch-a', refreshToken: 'twitch-r' }); expect(await secrets.getDiscordToken()).toBe('discord-secret'); expect(await secrets.getStreamlabsToken?.()).toBe('streamlabs-secret'); expect((await secrets.getWizeBotConfiguration?.())?.token).toBe('wize-secret');
  });

  it('expose un cockpit mobile honnête et des événements bornés', async () => {
    const app = await start();
    const hub = await fetch(`${app.url}/api/v1/control-hub`).then(response => response.json());
    expect(hub).toMatchObject({
      live: { isLive: false, viewerCount: null },
      audience: { viewerCount: null, chatters: [] },
      integrations: { runtime: { status: 'CONNECTED' }, streamlabs: { status: 'NOT_CONFIGURED' }, wizebot: { status: 'NOT_CONFIGURED' } },
      availability: { chat: 'NOT_CONFIGURED', support: 'NOT_CONFIGURED', soundboard: 'AVAILABLE' },
    });
    await fetch(`${app.url}/api/v1/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'timer.reset' }) });
    const events = await fetch(`${app.url}/api/v1/events?type=dashboard.state.updated&limit=10`).then(response => response.json());
    expect(events.items).toHaveLength(1);
    expect(events.items[0]).toMatchObject({ schemaVersion: 1, type: 'dashboard.state.updated', source: 'runtime' });
  });

  it('accepte l’origine Android WebViewAssetLoader pour REST et WebSocket', async () => {
    const app = await start();
    const origin = 'http://appassets.androidplatform.net';
    const response = await fetch(`${app.url}/api/v1/state`, { headers: { Origin: origin } });
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(origin);
    await expect(new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(app.url.replace('http:', 'ws:') + '/ws/v1', { origin });
      ws.on('open', () => { ws.close(); resolve(); });
      ws.on('error', reject);
    })).resolves.toBeUndefined();
  });

  it('refuse une origine WebSocket étrangère ou un faux port local', async () => {
    const app = await start(); const wsUrl = app.url.replace('http:', 'ws:') + '/ws/v1';
    await wsRejected(wsUrl, 'https://evil.example');
    await wsRejected(wsUrl, 'http://127.0.0.1:1');
  });

  it('accepte le WebSocket du même origin exact', async () => {
    const app = await start();
    await expect(new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(app.url.replace('http:', 'ws:') + '/ws/v1', { origin: app.url });
      ws.on('open', () => { ws.close(); resolve(); }); ws.on('error', reject);
    })).resolves.toBeUndefined();
  });

  it('valide et borne une commande distante avant le bus unique', async () => {
    const app = await start();
    const invalid = await fetch(`${app.url}/api/v1/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'obs.volume', input: '', volume: 'fort' }) });
    expect(invalid.status).toBe(400);
    const dangerous = await fetch(`${app.url}/api/v1/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'timer.reset', shell: 'cmd.exe' }) });
    expect(dangerous.status).toBe(400);
    const excessive = await fetch(`${app.url}/api/v1/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'timer.add', seconds: 9_999_999 }) });
    expect(excessive.status).toBe(400);
    const valid = await fetch(`${app.url}/api/v1/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'timer.add', seconds: 10 }) });
    expect(await valid.json()).toMatchObject({ ok: true, commandType: 'timer.add', state: { timer: { remaining: 310 } } });
    const persisted = await readFile(path.join(dataDir, 'dashboard.json'), 'utf8');
    expect(persisted).not.toMatch(/accessToken|refreshToken|deviceCode|obsPassword/);
  });

  it('déduplique les retries commandId et publie une révision monotone', async () => {
    const app = await start();
    const command = { type: 'timer.add', seconds: 60, commandId: 'retry_timer_0001', correlationId: 'corr_timer_0001' };
    const responses = await Promise.all(Array.from({ length: 3 }, () => fetch(`${app.url}/api/v1/commands`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(command),
    }).then(response => response.json())));
    expect(responses.every(response => response.commandId === command.commandId)).toBe(true);
    expect(new Set(responses.map(response => response.stateRevision)).size).toBe(1);
    const state = await fetch(`${app.url}/api/v1/state`).then(response => response.json());
    expect(state.timer.remaining).toBe(360);
    expect(state.stateRevision).toBeGreaterThan(0);

    const collision = await fetch(`${app.url}/api/v1/commands`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...command, seconds: 30 }),
    });
    expect(collision.status).toBe(400);
  });

  it('rejette les URLs OBS non locales et expose les réglages valides par v1', async () => {
    const app = await start();
    const remote = await fetch(`${app.url}/api/v1/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ obsUrl: 'ws://example.com:4455' }) });
    expect(remote.status).toBe(400);
    const updated = await fetch(`${app.url}/api/v1/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ streamerName: 'Smoke', obsExecutablePath: 'C:\\OBS\\bin\\64bit\\obs64.exe', streamerPingRewardIds: ['reward-water', 'reward-stretch'] }) }).then(r => r.json());
    expect(updated.settings).toMatchObject({ streamerName: 'Smoke', obsExecutablePath: 'C:\\OBS\\bin\\64bit\\obs64.exe', obsUrl: 'ws://127.0.0.1:4455', streamerPingRewardIds: ['reward-water', 'reward-stretch'] });
    await dashboard!.stop(); dashboard = undefined;
    dashboard = await startDashboardServer({ port: 0, dataDir, logger: { info() {}, warn() {}, error() {} } });
    const restarted = await fetch(`${dashboard.url}/api/v1/state`).then(r => r.json());
    expect(restarted.settings.streamerPingRewardIds).toEqual(['reward-water', 'reward-stretch']);
    const probe = await fetch(`${dashboard.url}/api/v1/obs/test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ obsUrl: 'wss://evil.example/ws' }) });
    expect(probe.status).toBe(400);
    expect((await fetch(`${dashboard.url}/api/v1/diagnostics`)).status).toBe(200);
  });

  it('rejette un planning aux dates invalides', async () => {
    const app = await start();
    const response = await fetch(`${app.url}/api/v1/planning`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Impossible', startAtUtc: 'pas-une-date', endAtUtc: 'encore-moins', category: 'live' }) });
    expect(response.status).toBe(400);
    const state = await fetch(`${app.url}/api/v1/state`).then(r => r.json());
    expect(state.planning).toEqual([]);
  });

  it('termine réellement le timer côté serveur et persiste 00:00', async () => {
    const app = await start();
    const started = await fetch(`${app.url}/api/v1/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'timer.start', seconds: 1 }) });
    expect(started.status).toBe(200);
    await new Promise(resolve => setTimeout(resolve, 1_150));
    const state = await fetch(`${app.url}/api/v1/state`).then(r => r.json());
    expect(state.timer).toMatchObject({ running: false, remaining: 0, deadline: null, duration: 1 });
    const persisted = JSON.parse(await readFile(path.join(dataDir, 'dashboard.json'), 'utf8'));
    expect(persisted.timer).toMatchObject({ running: false, remaining: 0, deadline: null, duration: 1 });
  });

  it('refuse une écoute LAN sans pairing authentifié', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'streamdashboard-api-'));
    await expect(startDashboardServer({ port: 0, host: '0.0.0.0', dataDir })).rejects.toThrow(/remote-LAN/);
  });

  it('gère la bibliothèque Soundboard locale sans exposer le chemin source', async () => {
    const app = await start(); const library = path.join(dataDir, 'soundboard'); const file = path.join(library, 'bonk.mp3');
    await writeFile(file, 'fake-audio');
    const created = await fetch(`${app.url}/api/v1/soundboard/sounds`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ libraryId: 'bonk.mp3', name: 'BONK', category: 'Réactions', volume: .8, cooldownMs: 500, favorite: true, enabled: true, monitoringMode: 'stream' }) });
    expect(created.status).toBe(201); const snapshot = await created.json();
    expect(snapshot.sounds[0]).toMatchObject({ name: 'BONK', category: 'Réactions', volume: .8, monitoringMode: 'stream', sourceAvailable: true });
    expect(JSON.stringify(snapshot)).not.toContain(file); const id = snapshot.sounds[0].id;
    const edited = await fetch(`${app.url}/api/v1/soundboard/sounds/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ monitoringMode: 'monitor', volume: .5 }) });
    expect(await edited.json()).toMatchObject({ sounds: [expect.objectContaining({ id, monitoringMode: 'monitor', volume: .5 })] });
    expect((await fetch(`${app.url}/api/v1/soundboard/sounds/${id}`, { method: 'DELETE' })).status).toBe(204);
    await expect(access(file)).rejects.toThrow();
  });

  it('partage Notes, Checklist et Templates via le Companion canonique', async () => {
    const app = await start();
    const initial = await fetch(`${app.url}/api/v1/companion/snapshot`).then(r => r.json());
    expect(initial.checklist.length).toBeGreaterThan(0);

    const noteCreated = await fetch(`${app.url}/api/v1/companion/notes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Note Desktop' }) }).then(r => r.json());
    expect(noteCreated.notes).toEqual(expect.arrayContaining([expect.objectContaining({ text: 'Note Desktop', revision: 1 })]));
    const note = noteCreated.notes.find((value: { text?: string }) => value.text === 'Note Desktop');

    const noteUpdated = await fetch(`${app.url}/api/v1/companion/notes/${note.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Note partagée Android' }) }).then(r => r.json());
    expect(noteUpdated.notes.find((value: { id: string }) => value.id === note.id)).toMatchObject({ text: 'Note partagée Android', revision: 2 });

    const templateCreated = await fetch(`${app.url}/api/v1/companion/templates`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'FC26', description: 'Club Pro', twitchCategoryId: '1745202732', twitchCategoryName: 'EA SPORTS FC 26', desiredPublication: { local: false, twitch: true, google: false } }) }).then(r => r.json());
    expect(templateCreated.templates).toEqual(expect.arrayContaining([expect.objectContaining({ title: 'FC26', twitchCategoryName: 'EA SPORTS FC 26' })]));

    const firstCheck = initial.checklist[0];
    const toggled = await fetch(`${app.url}/api/v1/companion/checklist/${firstCheck.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label: firstCheck.label, done: !firstCheck.done }) }).then(r => r.json());
    expect(toggled.checklist.find((value: { id: string }) => value.id === firstCheck.id)?.done).toBe(!firstCheck.done);

    expect((await fetch(`${app.url}/api/v1/companion/notes/${note.id}`, { method: 'DELETE' })).status).toBe(200);
    const final = await fetch(`${app.url}/api/v1/companion/snapshot`).then(r => r.json());
    expect(final.notes.some((value: { id: string }) => value.id === note.id)).toBe(false);
  });

  it('exécute les automatisations génériques via le bus Runtime', async () => {
    const app = await start();
    const capabilities = await fetch(`${app.url}/api/v1/automations/capabilities`).then(r => r.json());
    expect(capabilities.triggers).toContain('twitch.reward.redeemed');
    expect(capabilities.actions).toEqual(expect.arrayContaining(['soundboard.play', 'obs.scene', 'timer.add']));

    const created = await fetch(`${app.url}/api/v1/automations`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Ajoute une minute', enabled: true, trigger: 'test.support', conditions: [{ path: 'amountMinor', operator: 'gte', value: 500 }], actions: [{ type: 'timer.add', payload: { seconds: 60 } }], cooldownMs: 0 }),
    });
    expect(created.status).toBe(201);

    expect((await fetch(`${app.url}/api/v1/automations/test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amountMinor: 500 }) })).status).toBe(202);
    await expect.poll(async () => (await fetch(`${app.url}/api/v1/state`).then(r => r.json())).timer.remaining).toBe(360);

    await expect.poll(async () => {
      const automations = await fetch(`${app.url}/api/v1/automations`).then(r => r.json());
      return automations.items[0]?.lastResult?.status ?? null;
    }).toBe('succeeded');
  });

  it('arrête le serveur proprement et de façon idempotente', async () => {
    const app = await start(); await app.stop(); await app.stop(); dashboard = undefined;
    expect(app.server.listening).toBe(false);
  });
});
