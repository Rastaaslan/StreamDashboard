import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createGoogleOAuthAttempt, GoogleCalendarClient } from '../integrations/google-calendar/src/client.js';
import { TwitchPreflight } from '../integrations/twitch/src/preflight.js';
import { PlanningOrchestrator, type PlanningProvider } from '../packages/core/src/planning.js';
import { RemoteAuth } from '../apps/server/src/remote-auth.js';
import { startDashboardServer } from '../apps/server/src/index.js';

const event = { title: 'Counter-Strike 2', startAtUtc: '2030-01-01T10:00:00.000Z', endAtUtc: '2030-01-01T11:00:00.000Z', category: 'live' as const };
const provider = (): PlanningProvider & { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> } => ({
  create: vi.fn(async () => ({ id: crypto.randomUUID(), revision: '1' })),
  update: vi.fn(async () => ({ revision: '2' })),
  delete: vi.fn(async () => undefined),
});

describe('planning multi-provider', () => {
  it('isole Local/Twitch/Google et reste idempotent sur les liens distants', async () => {
    const twitch = provider(), google = provider(), saved: unknown[] = [];
    const planning = new PlanningOrchestrator([], { twitch, google }, async rows => { saved.push(structuredClone(rows)); });
    await planning.create({ ...event, desiredPublication: { local: true, twitch: false, google: false } });
    expect(twitch.create).not.toHaveBeenCalled(); expect(google.create).not.toHaveBeenCalled();
    const both = await planning.create({ ...event, desiredPublication: { local: true, twitch: true, google: true } });
    expect(twitch.create).toHaveBeenCalledOnce(); expect(google.create).toHaveBeenCalledOnce();
    await planning.retry(both.id, 'twitch'); await planning.retry(both.id, 'twitch');
    expect(twitch.create).toHaveBeenCalledOnce(); expect(twitch.update).toHaveBeenCalledTimes(2); expect(saved.length).toBeGreaterThan(3);
  });

  it('conserve le succès Google quand Twitch échoue et détecte conflit/suppression', async () => {
    const twitch = provider(), google = provider(); twitch.create.mockRejectedValue(new Error('Twitch down'));
    const planning = new PlanningOrchestrator([], { twitch, google }, async () => undefined);
    const item = await planning.create({ ...event, desiredPublication: { local: true, twitch: true, google: true } });
    expect(item.providers?.twitch?.status).toBe('error'); expect(item.providers?.google?.status).toBe('synced');
    await planning.markConflict(item.id, 'google', { ...event }); expect(planning.all()[0].providers?.google?.status).toBe('conflict');
    await planning.markRemoteDeleted(item.id, 'google'); expect(planning.all()[0].providers?.google?.deletedRemotely).toBe(true);
  });

  it('ne perd jamais le suivi local si une suppression distante échoue', async () => {
    const twitch = provider(); const planning = new PlanningOrchestrator([], { twitch }, async () => undefined);
    const item = await planning.create({ ...event, desiredPublication: { local: true, twitch: true, google: false } });
    twitch.delete.mockRejectedValueOnce(new Error('Twitch indisponible'));
    await expect(planning.remove(item.id, { local: true, twitch: true })).rejects.toThrow(/local est conservé/i);
    expect(planning.all()).toHaveLength(1); expect(planning.all()[0].providers?.twitch?.status).toBe('error');
  });
});

describe('Google Calendar OAuth et synchronisation', () => {
  it('produit PKCE et refuse un state invalide sans persister de token', async () => {
    const attempt = createGoogleOAuthAttempt('client', 'http://127.0.0.1/callback');
    expect(new URL(attempt.authorizationUrl).searchParams.get('code_challenge_method')).toBe('S256');
    const persist = vi.fn(); const client = new GoogleCalendarClient('client', null, persist, vi.fn());
    await expect(client.exchangeCode('code', 'bad', attempt)).rejects.toThrow('invalide'); expect(persist).not.toHaveBeenCalled();
  });

  it('n’autorise pas une réponse OAuth tardive à ressusciter des credentials après déconnexion', async () => {
    const attempt = createGoogleOAuthAttempt('client', 'http://127.0.0.1/callback');
    let release!: (response: Response) => void; const pending = new Promise<Response>(resolve => { release = resolve; });
    const persist = vi.fn(async () => undefined); const request = vi.fn(async () => pending);
    const client = new GoogleCalendarClient('client', null, persist, request as typeof fetch);
    const exchange = client.exchangeCode('code', attempt.state, attempt); await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    await client.disconnect(); release(new Response(JSON.stringify({ access_token: 'late', refresh_token: 'late-refresh', expires_in: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } }));
    await expect(exchange).rejects.toThrow(/annulée/); expect(client.connected).toBe(false); expect(persist).toHaveBeenLastCalledWith(null);
  });

  it('parcourt les pages Google et conserve les événements journée entière', async () => {
    const urls: string[] = [];
    const request = vi.fn(async (input: string | URL | Request) => {
      const url = String(input); urls.push(url);
      if (!url.includes('pageToken=')) return new Response(JSON.stringify({ items: [{ id: 'all-day', summary: 'Congé', start: { date: '2030-01-01' }, end: { date: '2030-01-02' } }], nextPageToken: 'next' }), { status: 200, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({ items: [{ id: 'timed', summary: 'Live', start: { dateTime: event.startAtUtc }, end: { dateTime: event.endAtUtc }, extendedProperties: { private: { streamDashboardManaged: 'true', streamDashboardId: 'local-1' } } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const client = new GoogleCalendarClient('client', { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 60_000 }, async () => undefined, request as typeof fetch);
    const rows = await client.events('primary');
    expect(rows).toHaveLength(2); expect(rows[0]).toMatchObject({ id: 'all-day', startAtUtc: '2030-01-01T00:00:00.000Z', managed: false });
    expect(rows[1]).toMatchObject({ id: 'timed', localId: 'local-1', managed: true }); expect(urls[1]).toContain('pageToken=next');
  });

  it('récupère un événement géré existant au retry au lieu de le recréer', async () => {
    const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if ((init?.method ?? 'GET') === 'GET') return new Response(JSON.stringify({ items: [{ id: 'g-existing', etag: 'e1', summary: event.title, start: { dateTime: event.startAtUtc }, end: { dateTime: event.endAtUtc }, extendedProperties: { private: { streamDashboardManaged: 'true', streamDashboardId: 'local-1' } } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      throw new Error(`POST inattendu ${url}`);
    });
    const client = new GoogleCalendarClient('client', { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 60_000 }, async () => undefined, request as typeof fetch);
    const created = await client.create('primary', { localId: 'local-1', ...event }); expect(created.id).toBe('g-existing');
    expect(request).toHaveBeenCalledOnce(); expect(String(request.mock.calls[0][0])).toContain('privateExtendedProperty=streamDashboardId%3Dlocal-1');
  });

  it('écrit la propriété privée streamDashboardId sur une vraie création', async () => {
    const request = vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({ id: 'g1', etag: 'e1', summary: 'Live', start: { dateTime: event.startAtUtc }, end: { dateTime: event.endAtUtc }, extendedProperties: { private: { streamDashboardManaged: 'true', streamDashboardId: 'local-1' } } }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const client = new GoogleCalendarClient('client', { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 60_000 }, async () => undefined, request as typeof fetch);
    await client.create('primary', { localId: 'local-1', ...event }); const post = request.mock.calls.find(call => call[1]?.method === 'POST');
    expect(String(post?.[1]?.body)).toContain('streamDashboardId');
  });
});

describe('preflight Twitch', () => {
  it('n’invente pas une catégorie générique et ne démarre jamais OBS', async () => {
    const api = { getChannel: vi.fn(async () => ({ title: 'ancien', gameId: '0' })), searchGame: vi.fn(async () => [{ id: '32399', name: 'Counter-Strike 2' }]), updateChannel: vi.fn(async () => undefined) };
    const preflight = new TwitchPreflight(api);
    expect((await preflight.prepare({ eventId: '1', title: event.title, category: 'live' })).status).toBe('action-required');
    await preflight.prepare({ eventId: '1', title: event.title, category: event.title }); expect(api.updateChannel).toHaveBeenCalledOnce();
  });

  it('corrige un drift Twitch même si le même preflight avait déjà réussi', async () => {
    let current = { title: 'ancien', gameId: '0' };
    const api = { getChannel: vi.fn(async () => current), searchGame: vi.fn(async () => [{ id: '32399', name: 'Counter-Strike 2' }]), updateChannel: vi.fn(async value => { current = value; }) };
    const preflight = new TwitchPreflight(api); const input = { eventId: '1', title: event.title, category: event.title };
    await preflight.prepare(input); expect(api.updateChannel).toHaveBeenCalledOnce(); current = { title: 'modifié ailleurs', gameId: '0' }; await preflight.prepare(input); expect(api.updateChannel).toHaveBeenCalledTimes(2);
  });
});

describe('télécommande sécurisée', () => {
  it('pairing est aléatoire, usage unique, expirant et révocable', () => {
    let now = 10; const auth = new RemoteAuth(() => now); const pairing = auth.createPairing(100); const device = auth.pair(pairing.id, pairing.code, 'Pixel');
    expect(auth.authenticate(device.credential)).toBe(device.deviceId); expect(() => auth.pair(pairing.id, pairing.code, 'Replay')).toThrow(); auth.revoke(device.deviceId); expect(auth.authenticate(device.credential)).toBeNull();
    const expired = auth.createPairing(1); now = 20; expect(() => auth.pair(expired.id, expired.code, 'Late')).toThrow();
  });

  it('persiste les appareils sans persister le credential brut et les tickets WS sont à usage unique', () => {
    const auth = new RemoteAuth(); const pairing = auth.createPairing(); const device = auth.pair(pairing.id, pairing.code, 'S24'); const serialized = auth.serialize();
    expect(JSON.stringify(serialized)).not.toContain(device.credential); const restored = new RemoteAuth(Date.now, serialized); expect(restored.authenticate(device.credential)).toBe(device.deviceId);
    const ticket = restored.createWsTicket(device.credential); expect(restored.consumeWsTicket(ticket.ticket)).toBe(device.deviceId); expect(restored.consumeWsTicket(ticket.ticket)).toBeNull();
  });

  it('applique réellement la limite de 10 tentatives de pairing par minute', () => {
    const auth = new RemoteAuth(() => 1000); const pairing = auth.createPairing();
    for (let index = 0; index < 10; index++) expect(() => auth.pair(pairing.id, 'FAUX', 'Phone', '1.2.3.4')).toThrow(/invalide/);
    expect(() => auth.pair(pairing.id, 'FAUX', 'Phone', '1.2.3.4')).toThrow(/Trop de tentatives/);
  });
});

describe('persistance du modèle NEXT', () => {
  it('conserve localId, liens providers et conflit après un redémarrage serveur', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'streamdashboard-next-'));
    try {
      await writeFile(path.join(dataDir, 'dashboard.json'), JSON.stringify({ schemaVersion: 3, mode: 'idle', timer: { running: false, duration: 300, remaining: 300, deadline: null }, planning: [{ id: 'local-1', localId: 'stable-1', ...event, desiredPublication: { local: true, twitch: true, google: true }, providers: { google: { status: 'synced', remoteId: 'g1', calendarId: 'primary', remoteRevision: 'etag-1' }, twitch: { status: 'error', remoteId: 't1', lastError: 'test' } }, conflict: { provider: 'google', detectedAt: '2030-01-01T00:00:00.000Z', remote: { title: 'Remote', startAtUtc: event.startAtUtc, endAtUtc: event.endAtUtc } } }], checklist: [], settings: {}, twitch: {}, twitchLastSyncedAt: null, google: { targetCalendarId: null, lastSyncedAt: null }, remoteDevices: [] }), 'utf8');
      const dashboard = await startDashboardServer({ port: 0, dataDir, logger: { info() {}, warn() {}, error() {} } });
      try { const item = dashboard.state().planning[0]; expect(item).toMatchObject({ localId: 'stable-1', desiredPublication: { google: true }, providers: { google: { remoteId: 'g1', remoteRevision: 'etag-1' }, twitch: { remoteId: 't1' } }, conflict: { provider: 'google' } }); }
      finally { await dashboard.stop(); }
    } finally { await rm(dataDir, { recursive: true, force: true }); }
  });
});
