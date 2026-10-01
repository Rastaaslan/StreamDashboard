import { afterEach, expect, it, vi } from 'vitest';
import { PlanningOrchestrator } from '../packages/core/src/planning.js';
import { TwitchClient } from '../integrations/twitch/src/client.js';
import { createWithDurableIntent } from '../packages/core/src/provider-identity.js';
import type { CalendarItem } from '../packages/contracts/src/index.js';

const item: CalendarItem = { id: 'test', title: 'Live', category: 'live', startAtUtc: '2030-10-01T18:00:00Z', endAtUtc: '2030-10-01T19:00:00Z', desiredPublication: { local: true, twitch: true, google: false } };
afterEach(() => vi.unstubAllGlobals());
it.each(['validation', 'rejection'] as const)('retries real Twitch create after %s and restart without retaining uncertainty', async reason => {
  let rejected = reason === 'rejection';
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (String(_url).endsWith('/validate')) return Response.json({ client_id: 'client', user_id: '42', scopes: ['channel:manage:schedule'] });
    if (init?.method === 'POST') {
      if (rejected) { rejected = false; return Response.json({ message: 'forbidden' }, { status: 403 }); }
      return Response.json({ data: { segments: [{ id: 'created' }] } });
    }
    return Response.json({ data: { segments: [] } });
  });
  vi.stubGlobal('fetch', fetch);
  const twitch = new TwitchClient({ clientId: 'client', accessToken: 'token', refreshToken: '', broadcasterId: '42', userName: '', displayName: '' });
  vi.mocked(globalThis.fetch).mockResolvedValueOnce(Response.json({ client_id: 'client', user_id: '42', scopes: ['channel:manage:schedule'] }));
  expect(await twitch.validateSession()).toBe(true);
  vi.mocked(globalThis.fetch).mockClear();
  const googleCreate = vi.fn();
  const adapters = { twitch: { create: (event: CalendarItem) => twitch.createSegment(event), update: vi.fn(), delete: vi.fn() }, google: { create: googleCreate, update: vi.fn(), delete: vi.fn() } };
  let disk = '[]';
  const persist = async (items: unknown) => { disk = JSON.stringify(items); };
  await new PlanningOrchestrator([], adapters, persist).create({ ...item, endAtUtc: reason === 'validation' ? '2030-10-01T18:15:00Z' : item.endAtUtc });
  const recovered = JSON.parse(disk);
  expect(recovered[0].providers.twitch.status).toBe('error');
  expect(recovered[0].providers.twitch.uncertainCreate).toBeUndefined();
  if (reason === 'validation') expect(fetch).not.toHaveBeenCalled();
  const restarted = new PlanningOrchestrator(recovered, adapters, persist);
  if (reason === 'validation') await restarted.update(item.id, { title: item.title, startAtUtc: item.startAtUtc, endAtUtc: item.endAtUtc });
  else await restarted.retry(item.id, 'twitch');
  expect(restarted.all()[0].providers?.twitch).toMatchObject({ remoteId: 'created', status: 'synced' });
  expect(googleCreate).not.toHaveBeenCalled();
});
it.each([400, 403, 422, 429, 408, 500, 503])('persists the correct create uncertainty for HTTP %s', async status => {
  const event = structuredClone(item) as CalendarItem;
  let disk = '';
  await expect(createWithDurableIntent(event, 'google', async () => { disk = JSON.stringify(event); }, async () => { throw Object.assign(new Error('HTTP failure'), { status }); })).rejects.toThrow();
  expect(Boolean(JSON.parse(disk).providers.google.uncertainCreate)).toBe([408, 500, 503].includes(status));
});

it('clears the outbox uncertainty durably on provider rejection and retries only that provider after restart', async () => {
  const { reconcileCompanionBatch, emptyCompanionState } = await import('../apps/server/src/companion-sync.js');
  const { drainCompanionProviders } = await import('../apps/server/src/companion-providers.js');
  const result = reconcileCompanionBatch([], [], emptyCompanionState(), [{ id: 'op', type: 'create', eventId: item.id, baseRevision: 0, patch: { ...item } }]);
  const create = vi.fn().mockRejectedValueOnce(Object.assign(new Error('rate limited'), { status: 429 })).mockResolvedValue({ id: 'one' });
  const adapters = { twitch: { create, update: vi.fn(), delete: vi.fn() } };
  let disk = '';
  await drainCompanionProviders(result.planning, result.companion, adapters, async () => { disk = JSON.stringify(result); });
  const restarted = JSON.parse(disk);
  expect(restarted.companion.providerWork['test:twitch']).toMatchObject({ status: 'error', uncertain: false });
  expect(restarted.planning[0].providers.twitch.uncertainCreate).toBeUndefined();
  restarted.companion.providerWork['test:twitch'].status = 'queued';
  await drainCompanionProviders(restarted.planning, restarted.companion, adapters, async () => {}, 'test:twitch');
  expect(create).toHaveBeenCalledTimes(2);
  expect(restarted.companion.providerWork).toEqual({});
  expect(restarted.planning[0].providers.twitch.remoteId).toBe('one');
});
