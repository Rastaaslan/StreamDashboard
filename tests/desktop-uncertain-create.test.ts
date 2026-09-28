import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startDashboardServer, type DashboardServerHandle } from '../apps/server/src/index.js';
import { MemorySecretStore } from '../apps/server/src/storage.js';
import { createCompanionStore } from '../apps/mobile/companion-store.js';
import { createStandaloneProviderSync } from '../apps/mobile/provider-sync.js';
import { PlanningOrchestrator } from '../packages/core/src/planning.js';
import { TwitchClient } from '../integrations/twitch/src/client.js';

let server: DashboardServerHandle | undefined;
let dataDir = '';
afterEach(async () => {
  await server?.stop(); server = undefined;
  vi.unstubAllGlobals();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

it.each(['google', 'twitch'] as const)('blocks %s CREATE after lost Android response, handover, restart and Desktop edit/retry', async provider => {
  const data = new Map<string, string>();
  const mobile = createCompanionStore({ getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); } } as Storage);
  mobile.createEvent({ id: 'uncertain', title: 'Original', category: 'live', twitchCategoryId: 'game',
    startAtUtc: '2030-10-01T18:00:00Z', endAtUtc: '2030-10-01T20:00:00Z',
    desiredPublication: { local: true, google: provider === 'google', twitch: provider === 'twitch' },
    providerLinks: { [provider]: { calendarId: 'calendar' } },
  });
  let remoteCount = 0;
  const nativeCreate = vi.fn(async () => { remoteCount++; throw new Error('response lost after commit'); });
  await createStandaloneProviderSync({ store: mobile, adapter: { mutate: nativeCreate } as any })
    .apply('ONLINE_STANDALONE', mobile.snapshot().planning[0], 'create');

  dataDir = await mkdtemp(path.join(os.tmpdir(), 'cb16-desktop-uncertain-'));
  await writeFile(path.join(dataDir, 'dashboard.json'), JSON.stringify({ twitch: { broadcasterId: '42', userName: 'tester', displayName: 'Tester' } }));
  const secrets = new MemorySecretStore();
  await secrets.setGoogleTokens({ accessToken: 'google-token', refreshToken: 'refresh', expiresAt: String(Date.now() + 3600_000) });
  await secrets.setTwitchTokens({ accessToken: 'twitch-token' });
  const nativeFetch = globalThis.fetch;
  const remoteWrites = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('http://127.0.0.1:')) return nativeFetch(input, init);
    if (init?.method === 'POST') { remoteWrites(); remoteCount++; }
    if (url.includes('/schedule')) return Response.json({ data: { segments: init?.method === 'POST' ? [{ id: 'duplicate' }] : [] } });
    if (url.includes('googleapis.com')) return Response.json(init?.method === 'POST'
      ? { id: 'duplicate', summary: 'Edited', start: { dateTime: '2030-10-01T18:00:00Z' }, end: { dateTime: '2030-10-01T20:00:00Z' } }
      : { items: [] });
    throw new Error('Unexpected request: ' + url);
  }));
  const options = { port: 0, remoteEnabled: true, dataDir, secretStore: secrets, googleClientId: 'google', twitchClientId: 'twitch',
    logger: { info() {}, warn() {}, error() {} } };
  server = await startDashboardServer(options);
  const pairing = await nativeFetch(server.url + '/api/v1/remote/pairing', { method: 'POST' }).then(r => r.json());
  const paired = await nativeFetch(server.url + '/api/v1/remote/pair', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: pairing.id, code: pairing.code, name: 'Android' }) }).then(r => r.json());
  const headers = { 'content-type': 'application/json', authorization: 'Device ' + paired.credential };
  const sync = await nativeFetch(server.url + '/api/v1/companion/sync', { method: 'POST', headers,
    body: JSON.stringify({ schemaVersion: 3, deviceId: paired.deviceId, operations: mobile.snapshot().pending }) });
  expect(sync.status).toBe(200);
  expect(remoteCount).toBe(1);
  await server.stop(); server = await startDashboardServer(options);
  const edit = await nativeFetch(server.url + '/api/v1/planning/uncertain', { method: 'PUT',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Edited on Desktop' }) });
  expect(edit.status, await edit.clone().text()).toBe(200);
  const snapshot = await nativeFetch(server.url + '/api/v1/companion/snapshot').then(r => r.json());
  const item = snapshot.planning[0];
  expect(item.title).toBe('Edited on Desktop');
  expect(item.providers[provider]).toMatchObject({ status: 'error', uncertainCreate: { event: { title: 'Original' } } });
  const retry = await nativeFetch(server.url + '/api/v1/planning/uncertain/retry/' + provider, { method: 'POST', headers, body: '{}' });
  expect(retry.ok).toBe(false);
  // Calling the core directly must be protected too, without the HTTP outbox guard.
  const create = vi.fn(async () => ({ id: 'duplicate' }));
  const orchestrator = new PlanningOrchestrator([item], { [provider]: { create, update: vi.fn(), delete: vi.fn() } }, async () => {});
  await expect(orchestrator.retry(item.id, provider)).rejects.toThrow(/incertaine/);
  expect(create).not.toHaveBeenCalled();
  // A provider-wide Twitch refresh has a separate create path.
  if (provider === 'twitch') {
    const twitch = new TwitchClient({ clientId: 'twitch', accessToken: 'token', refreshToken: '', broadcasterId: '42', userName: '', displayName: '' });
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(Response.json({ client_id: 'twitch', user_id: '42', scopes: ['channel:manage:schedule'] }));
    expect(await twitch.validateSession()).toBe(true);
    vi.mocked(globalThis.fetch).mockClear();
    await expect(twitch.sync([item])).rejects.toThrow(/incertaine/);
  }
  expect(remoteWrites).not.toHaveBeenCalled();
  expect(remoteCount).toBe(1);
  await server.stop(); server = await startDashboardServer(options);
  expect((await nativeFetch(server.url + '/api/v1/companion/snapshot').then(r => r.json())).planning[0].providers[provider].uncertainCreate).toBeTruthy();
});

it.each(['google', 'twitch'] as const)('persists a Desktop %s create intent before I/O and only resumes publication after identity recovery', async provider => {
  let persisted = '[]';
  const create = vi.fn(async () => {
    expect(JSON.parse(persisted)[0].providers[provider].uncertainCreate.event.title).toBe('Original');
    throw new Error('response lost');
  });
  const update = vi.fn(async () => ({ revision: 'r2' }));
  const adapters = { [provider]: { create, update, delete: vi.fn() } };
  const persist = async (items: unknown) => { persisted = JSON.stringify(items); };
  const first = new PlanningOrchestrator([], adapters, persist);
  const item = await first.create({ id: 'desktop', title: 'Original', category: 'live',
    startAtUtc: '2030-10-01T18:00:00Z', endAtUtc: '2030-10-01T20:00:00Z',
    desiredPublication: { local: true, google: provider === 'google', twitch: provider === 'twitch' } });
  const restartedItems = JSON.parse(persisted);
  const restarted = new PlanningOrchestrator(restartedItems, adapters, persist);
  await restarted.update(item.id, { title: 'Edited', startAtUtc: item.startAtUtc, endAtUtc: item.endAtUtc });
  await expect(restarted.retry(item.id, provider)).rejects.toThrow(/incertaine/);
  expect(create).toHaveBeenCalledTimes(1);
  // A provider reconciliation has recovered the existing object's identity.
  restartedItems[0].providers[provider].remoteId = 'recovered';
  await restarted.update(item.id, { title: 'Latest', startAtUtc: item.startAtUtc, endAtUtc: item.endAtUtc });
  expect(update).toHaveBeenCalledWith('recovered', expect.objectContaining({ title: 'Latest' }), undefined);
  expect(create).toHaveBeenCalledTimes(1);
  expect(restarted.all()[0].providers?.[provider]?.status).toBe('synced');
  expect(restarted.all()[0].providers?.[provider]?.uncertainCreate).toBeUndefined();
});
