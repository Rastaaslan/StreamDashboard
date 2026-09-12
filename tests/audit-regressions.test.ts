import { describe, expect, it, vi } from 'vitest';
import { createGoogleOAuthAttempt, GoogleCalendarClient } from '../integrations/google-calendar/src/client.js';
import { TwitchClient } from '../integrations/twitch/src/client.js';
import { PlanningOrchestrator, type PlanningProvider } from '../packages/core/src/planning.js';
import { parseRemoteCommand, toRemoteDashboardState } from '../apps/server/src/remote-policy.js';
import type { CalendarItem, DashboardState } from '../packages/contracts/src/index.js';

const baseEvent = {
  title: 'Audit Live',
  startAtUtc: '2030-01-01T10:00:00.000Z',
  endAtUtc: '2030-01-01T11:00:00.000Z',
  category: 'live' as const,
  kind: 'LIVE' as const,
};

function provider(): PlanningProvider & {
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
} {
  return {
    create: vi.fn(async () => ({ id: 'remote-new', revision: 'r-new' })),
    update: vi.fn(async () => ({ revision: 'r-updated' })),
    delete: vi.fn(async () => undefined),
  };
}

describe('audit planning multi-provider', () => {
  it('recrée un objet distant supprimé au retry au lieu de PATCHer son ancien id', async () => {
    const twitch = provider();
    const items: CalendarItem[] = [{
      id: 'local-1', localId: 'local-1', ...baseEvent, ownership: 'LOCAL', editable: true,
      desiredPublication: { local: true, twitch: true, google: false },
      twitchSegmentId: 'gone',
      providers: { twitch: { status: 'error', remoteId: 'gone', remoteRevision: 'old', deletedRemotely: true } },
    }];
    const planning = new PlanningOrchestrator(items, { twitch }, async () => undefined);
    const result = await planning.retry('local-1', 'twitch');
    expect(twitch.update).not.toHaveBeenCalled();
    expect(twitch.create).toHaveBeenCalledOnce();
    expect(result.twitchSegmentId).toBe('remote-new');
    expect(result.providers?.twitch).toMatchObject({ status: 'synced', remoteId: 'remote-new', deletedRemotely: false });
  });

  it('réconcilie un changement explicite de destinations dans les deux sens', async () => {
    const twitch = provider();
    const planning = new PlanningOrchestrator([], { twitch }, async () => undefined);
    const item = await planning.create({ ...baseEvent, desiredPublication: { local: true, twitch: true, google: false } });
    expect(twitch.create).toHaveBeenCalledOnce();

    const unpublished = await planning.update(item.id, { ...baseEvent }, { desiredPublication: { twitch: false } });
    expect(twitch.delete).toHaveBeenCalledOnce();
    expect(unpublished.desiredPublication?.twitch).toBe(false);
    expect(unpublished.providers?.twitch?.status).toBe('not-published');

    const republished = await planning.update(item.id, { ...baseEvent }, { desiredPublication: { twitch: true } });
    expect(twitch.create).toHaveBeenCalledTimes(2);
    expect(republished.providers?.twitch?.status).toBe('synced');
  });

  it('garde le local et l’intention de dépublication quand le DELETE distant échoue', async () => {
    const twitch = provider();
    const planning = new PlanningOrchestrator([], { twitch }, async () => undefined);
    const item = await planning.create({ ...baseEvent, desiredPublication: { local: true, twitch: true, google: false } });
    twitch.delete.mockRejectedValueOnce(new Error('network down'));
    const updated = await planning.update(item.id, { ...baseEvent }, { desiredPublication: { twitch: false } });
    expect(updated.desiredPublication?.twitch).toBe(false);
    expect(updated.providers?.twitch).toMatchObject({ status: 'error', lastError: 'network down' });
    expect(updated.providers?.twitch?.remoteId).toBeTruthy();
  });
});

describe('audit Google Calendar', () => {
  it('neutralise une écriture de credentials qui termine après un disconnect', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const persisted: Array<unknown> = [];
    let tokenWriteStarted!: () => void;
    const started = new Promise<void>(resolve => { tokenWriteStarted = resolve; });
    const persist = vi.fn(async value => {
      if (value) { tokenWriteStarted(); await gate; }
      persisted.push(value);
    });
    const request = vi.fn(async () => new Response(JSON.stringify({ access_token: 'late', refresh_token: 'late-r', expires_in: 3600 }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    const attempt = createGoogleOAuthAttempt('client-race', 'http://127.0.0.1/callback');
    const client = new GoogleCalendarClient('client-race', null, persist, request as typeof fetch);
    const exchange = client.exchangeCode('code', attempt.state, attempt);
    await started;
    await client.disconnect();
    release();
    await expect(exchange).rejects.toThrow(/annulée/);
    expect(client.connected).toBe(false);
    expect(persisted.at(-1)).toBeNull();
  });

  it('préserve une journée entière en date/date au lieu de la convertir en faux horaire UTC', async () => {
    let body = '';
    const request = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') {
        return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      body = String(init.body ?? '');
      return new Response(JSON.stringify({
        id: 'g-all-day', etag: 'e1', summary: 'Congé',
        start: { date: '2030-01-01' }, end: { date: '2030-01-02' },
        extendedProperties: { private: { streamDashboardManaged: 'true', streamDashboardId: 'local-all-day' } },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const client = new GoogleCalendarClient('client', { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 60_000 }, async () => undefined, request as typeof fetch);
    const created = await client.create('primary', {
      localId: 'local-all-day', title: 'Congé', startAtUtc: '2030-01-01T00:00:00.000Z', endAtUtc: '2030-01-02T00:00:00.000Z', allDay: true,
    });
    expect(JSON.parse(body)).toMatchObject({ start: { date: '2030-01-01' }, end: { date: '2030-01-02' } });
    expect(body).not.toContain('dateTime');
    expect(created).toMatchObject({ allDay: true, startAtUtc: '2030-01-01T00:00:00.000Z', endAtUtc: '2030-01-02T00:00:00.000Z' });
  });

  it('efface une session dont le refresh token est rejeté', async () => {
    const persisted: Array<unknown> = [];
    const request = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'invalid_grant' } }), {
      status: 400, headers: { 'content-type': 'application/json' },
    }));
    const client = new GoogleCalendarClient('client', { accessToken: 'expired', refreshToken: 'bad', expiresAt: 0 }, async value => { persisted.push(value); }, request as typeof fetch);
    await expect(client.calendars()).rejects.toThrow(/Reconnectez Google Calendar/);
    expect(client.connected).toBe(false);
    expect(persisted.at(-1)).toBeNull();
  });
});

describe('audit Twitch reconciliation', () => {
  it('ne publie ni ne rattache automatiquement un événement local-only qui ressemble à Twitch', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input); calls.push({ url, method: init?.method ?? 'GET' });
      return new Response(JSON.stringify({ data: { segments: [{
        id: 'remote-1', title: baseEvent.title, start_time: baseEvent.startAtUtc, end_time: baseEvent.endAtUtc,
      }] } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const client = new TwitchClient({ clientId: 'id', accessToken: 'token', refreshToken: '', broadcasterId: '42', userName: 'u', displayName: 'U' });
    const local: CalendarItem = { id: 'local-only', ...baseEvent, ownership: 'LOCAL', desiredPublication: { local: true, twitch: false, google: false } };
    const result = await client.sync([local]);
    expect(result.find(item => item.id === 'local-only')?.twitchSegmentId).toBeUndefined();
    expect(result.some(item => item.id === 'twitch:remote-1')).toBe(true);
    expect(calls.some(call => call.method === 'POST')).toBe(false);
    vi.unstubAllGlobals();
  });

  it('signale un changement distant de catégorie comme conflit sans écraser le local', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { segments: [{
      id: 't1', title: baseEvent.title, start_time: baseEvent.startAtUtc, end_time: baseEvent.endAtUtc,
      category: { id: 'remote-game', name: 'Remote Game' },
    }] } }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const client = new TwitchClient({ clientId: 'id', accessToken: 'token', refreshToken: '', broadcasterId: '42', userName: 'u', displayName: 'U' });
    const item: CalendarItem = {
      id: 'local-1', ...baseEvent, ownership: 'LOCAL', twitchSegmentId: 't1', twitchCategoryId: 'local-game', twitchCategoryName: 'Local Game',
      desiredPublication: { local: true, twitch: true, google: false }, providers: { twitch: { status: 'synced', remoteId: 't1' } },
    };
    const synced = await client.sync([item]);
    expect(synced[0].conflict).toMatchObject({ provider: 'twitch', remote: { twitchCategoryId: 'remote-game', twitchCategoryName: 'Remote Game' } });
    expect(synced[0].twitchCategoryId).toBe('local-game');
    vi.unstubAllGlobals();
  });
});

describe('audit politique télécommande', () => {
  const state = {
    at: new Date().toISOString(), mode: 'idle', timer: { running: false, duration: 300, remaining: 300, deadline: null }, planning: [], checklist: [],
    obs: { connected: true, streaming: false, recording: false, scene: 'Intro', scenes: ['Intro'], inputs: { Micro: { muted: false, volume: 1, volumeDb: 0 }, Musique: { muted: false, volume: 1, volumeDb: 0 } }, activeAudioInputs: ['Micro'], mediaInputs: ['Jingle'], error: null, obsVersion: '32', websocketVersion: '5' },
    nextLive: null, health: { storage: { ok: true, detail: 'C:/secret/path', reconnects: 0 } },
    settings: { streamerName: 'Dam', accent: 'violet', confirmStop: true, obsUrl: 'ws://127.0.0.1:4455', obsPasswordSet: true, twitchConnected: true, twitchUserName: 'dam', launchObs: true, obsExecutablePath: 'C:/OBS/obs64.exe', modeScenes: { live: 'Live' }, chattingScene: 'Just Chatting', startMode: 'intro', remoteEnabled: true },
    twitch: { connected: true, userName: 'dam', displayName: 'Dam', error: null, syncing: false, lastSyncedAt: null, deviceAuthorization: null },
    google: { configured: true, connected: true, targetCalendarId: 'private-calendar', calendars: [{ id: 'private-calendar', summary: 'Perso', writable: true }], error: null, lastSyncedAt: null },
    remote: { supported: true, enabled: true, devices: [{ id: 'd', name: 'phone', createdAt: '', lastSeenAt: '' }], urls: ['http://192.168.1.2'] },
    runtime: { serverVersion: '1', nodeVersion: '22', electronVersion: '43', platform: 'win32', port: 47832, logsPath: 'C:/secret/logs' },
  } as DashboardState;

  it('refuse force, enregistrement, scène arbitraire et accepte les contrôles nécessaires', () => {
    expect(() => parseRemoteCommand({ type: 'session.start', force: true }, state)).toThrow(/checklist/i);
    expect(() => parseRemoteCommand({ type: 'obs.record', start: true }, state)).toThrow(/réservée au PC/i);
    expect(() => parseRemoteCommand({ type: 'obs.scene', scene: 'Secret' }, state)).toThrow(/réservée au PC/i);
    expect(parseRemoteCommand({ type: 'scene.chatting' }, state)).toEqual({ type: 'scene.chatting' });
    expect(parseRemoteCommand({ type: 'obs.mute', input: 'Micro', muted: true }, state)).toMatchObject({ type: 'obs.mute' });
    expect(() => parseRemoteCommand({ type: 'obs.mute', input: 'Musique', muted: true }, state)).toThrow(/inactive/i);
    expect(parseRemoteCommand({ type: 'obs.media.restart', input: 'Jingle' }, state)).toMatchObject({ type: 'obs.media.restart' });
  });

  it('projette un état mobile sans chemins, comptes ou configuration desktop', () => {
    const remote = toRemoteDashboardState(state);
    const text = JSON.stringify(remote);
    expect(text).not.toMatch(/obsUrl|obsExecutablePath|logsPath|private-calendar|twitchUserName|devices|health|runtime/);
    expect(remote).toMatchObject({ settings: { confirmStop: true, chattingScene: 'Just Chatting', modeScenes: { live: 'Live' } }, obs: { scene: 'Intro' } });
  });
});
