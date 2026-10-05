import { afterEach, expect, it, vi } from 'vitest';
import { TwitchClient } from '../integrations/twitch/src/client.js';
import { GoogleCalendarClient } from '../integrations/google-calendar/src/client.js';
import { projectGoogleSeries, reconcileGoogleProjection } from '../integrations/google-calendar/src/projection.js';
import { reconcileTwitchProjection } from '../integrations/twitch/src/projection.js';
import { expandRecurringItems } from '../packages/core/src/recurrence.js';
import { SyncHttp, syncDiagnostics } from '../packages/core/src/sync-performance.js';
import type { CalendarItem } from '../packages/contracts/src/index.js';

const now = Date.parse('2026-01-01T00:00:00Z');
const fixture = (interval = 1): CalendarItem => ({ id: 'series', localId: 'series', title: 'PRIVATE TITLE', ownership: 'LOCAL', category: 'live',
  startAtUtc: '2026-01-01T12:00:00Z', endAtUtc: '2026-01-01T13:00:00Z',
  desiredPublication: { local: true, twitch: true, google: true },
  recurrence: { frequency: interval === 1 ? 'daily' : 'weekly', interval, timeZone: 'UTC', exceptions: { ignored: { cancelled: true } } } });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

// Actual client HTTP paths, with deterministic 100–300ms transport latency.
// Baseline reproduces the old sequential per-occurrence read+write loop.
it.each([['twitch', 1, 7], ['twitch', 2, 7], ['google', 1, 7], ['google', 2, 7]] as const)('%s interval %s shares inventory and bounds independent writes', async (name, interval, count) => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  async function run(optimized: boolean) {
    let reads = 0, writes = 0, active = 0, peak = 0;
    const remote = new Map<string, any>();
    const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/validate')) return Response.json({ client_id: 'client', user_id: '42', scopes: ['channel:manage:schedule'] });
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, init?.method === 'POST' ? 300 : 100)); active--;
      if (init?.method === 'POST') {
        writes++;
        const body = JSON.parse(String(init.body));
        if (name === 'twitch') {
          const segment = { ...body, id: `remote-${writes}`, end_time: new Date(Date.parse(body.start_time) + Number(body.duration) * 60_000).toISOString() };
          remote.set(segment.id, segment); return Response.json({ data: { segments: [segment] } });
        }
        const event = { ...body, etag: 'v1' }; remote.set(event.id, event); return Response.json(event);
      }
      reads++;
      if (name === 'twitch') return Response.json({ data: { segments: [...remote.values()].filter(value => !url.searchParams.has('id') || value.id === url.searchParams.get('id')) } });
      const id = url.pathname.split('/events/')[1];
      return id ? Response.json(remote.get(id)) : Response.json({ items: [...remote.values()] });
    });
    vi.stubGlobal('fetch', request);
    const twitch = new TwitchClient({ clientId: 'client', accessToken: 'SECRET', refreshToken: '', broadcasterId: '42', userName: '', displayName: '' });
    await twitch.validateSession();
    const google = new GoogleCalendarClient('client', { accessToken: 'SECRET', refreshToken: '', expiresAt: now + 99999999 }, async () => {}, request);
    const item = fixture(interval);
    const googleInput = (event: CalendarItem) => ({ ...event, localId: event.localId ?? event.id });
    const adapter = name === 'twitch' ? {
      create: (event: CalendarItem) => twitch.createSegment(event), read: (id: string) => twitch.readSegment(id),
      update: (id: string, event: CalendarItem) => twitch.updateSegment(id, event), delete: (id: string) => twitch.deleteSegment(id),
    } : {
      prepareCreate: () => ({ calendarId: 'calendar' }),
      create: async (event: CalendarItem) => { const result = await google.create('calendar', googleInput(event)); return { id: result.id, revision: result.etag }; },
      read: async (id: string) => ({ revision: (await google.event('calendar', id)).etag }),
      update: async () => { throw new Error('Unnecessary update'); }, delete: async () => {},
    };
    const start = Date.now();
    const operation = optimized ? (name === 'twitch' ? reconcileTwitchProjection : reconcileGoogleProjection)(item, adapter, async () => {}, { now }) : (async () => {
      const events = name === 'twitch' ? expandRecurringItems([item], { from: now, nextCount: 7 }).map(event => ({ ...event, recurrence: undefined, seriesId: undefined, occurrenceKey: undefined, twitchRecurring: false }))
        : projectGoogleSeries(item, { from: now, nextCount: 7 }).entries.map(entry => ({ ...item, ...entry.input, recurrence: undefined }));
      for (const event of events) await adapter.create(event);
    })();
    await vi.runAllTimersAsync(); await operation;
    const elapsed = Date.now() - start;
    if (optimized) {
      expect(item.providers?.[name]?.status).toBe('synced');
      // New pass/restart uses fresh remote reads, keeps identities and never creates again.
      const restarted = structuredClone(item);
      const retry = (name === 'twitch' ? reconcileTwitchProjection : reconcileGoogleProjection)(restarted, adapter, async () => {}, { now, retry: true });
      await vi.runAllTimersAsync(); await retry;
      expect(writes).toBe(count);
      expect(restarted.providers?.[name]?.status).toBe('synced');
    }
    return { reads: reads - (optimized ? count : 0), writes, elapsed, peak };
  }
  const baseline = await run(false); const optimized = await run(true);
  expect(baseline.reads).toBe(count); expect(optimized.reads).toBe(1);
  expect(optimized.writes).toBe(count); expect(optimized.peak).toBeLessThanOrEqual(3);
  expect(optimized.elapsed).toBeLessThan(baseline.elapsed * 0.65);
  console.info(`${name}/${interval}: ${baseline.reads + count} -> ${optimized.reads + count} HTTP; ${baseline.elapsed} -> ${optimized.elapsed} simulated ms`);
  expect(JSON.stringify(syncDiagnostics())).not.toMatch(/SECRET|PRIVATE TITLE|calendar|series/);
});

it('honors Retry-After across workers and does not replay ambiguous mutations', async () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  const transport = new SyncHttp('twitch');
  const calls: number[] = [];
  const request = vi.fn(async () => { calls.push(Date.now()); return new Response('{}', { status: calls.length === 1 ? 429 : 200, headers: { 'Retry-After': '2' } }); });
  const result = transport.request(request, 'POST', new AbortController().signal);
  await vi.advanceTimersByTimeAsync(1000); expect(calls).toEqual([now]);
  const second = transport.request(request, 'POST', new AbortController().signal);
  await vi.runAllTimersAsync(); await Promise.all([result, second]);
  expect(calls.slice(1).every(time => time >= now + 2000)).toBe(true);
  const ambiguous = vi.fn(async () => new Response('{}', { status: 503 }));
  expect((await transport.request(ambiguous, 'POST', new AbortController().signal)).status).toBe(503);
  expect(ambiguous).toHaveBeenCalledTimes(1);
  const safe = transport.request(ambiguous, 'GET', new AbortController().signal);
  await vi.runAllTimersAsync(); expect((await safe).status).toBe(503);
  expect(ambiguous).toHaveBeenCalledTimes(4);
});

it('keeps a partial failure durable while independent occurrences finish, then retries only the failed create', async () => {
  const { PlanningOrchestrator } = await import('../packages/core/src/planning.js');
  vi.useFakeTimers(); vi.setSystemTime(now);
  let saved: CalendarItem[] = [];
  let firstFailure = true;
  const remote = new Map<string, CalendarItem>();
  const create = vi.fn(async (event: CalendarItem) => {
    // Every invocation has a durable intent before any network mutation starts.
    expect(Object.values(saved[0].providers!.twitch!.projections!).some(entry => entry.event.startAtUtc === event.startAtUtc && entry.uncertainCreate)).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 100));
    if (firstFailure) { firstFailure = false; throw Object.assign(new Error('Rate limited'), { status: 429 }); }
    const id = event.startAtUtc; remote.set(id, event); return { id };
  });
  const provider = { create, read: async (id: string) => ({ deleted: !remote.has(id) }), update: vi.fn(async () => ({})), delete: async () => {} };
  const persist = async (items: CalendarItem[]) => { saved = structuredClone(items); };
  const source = fixture(); source.desiredPublication!.google = false;
  const orchestrator = new PlanningOrchestrator([], { twitch: provider }, persist);
  const operation = orchestrator.create(source); await vi.runAllTimersAsync(); const result = await operation;
  expect(remote.size).toBe(6); expect(result.providers?.twitch?.status).toBe('error');
  const retry = new PlanningOrchestrator(saved, { twitch: provider }, persist).retry('series', 'twitch');
  await vi.runAllTimersAsync(); await retry;
  expect(remote.size).toBe(7); expect(create).toHaveBeenCalledTimes(8);
  expect(provider.update).not.toHaveBeenCalled();
});

it('publishes a requested simple event to both providers without scanning unrelated rolling series', async () => {
  const { PlanningOrchestrator } = await import('../packages/core/src/planning.js');
  const provider = () => ({ create: vi.fn(async () => ({ id: crypto.randomUUID() })), read: vi.fn(async () => ({})), update: vi.fn(async () => ({})), delete: vi.fn(async () => {}) });
  const twitch = provider(), google = provider();
  const orchestrator = new PlanningOrchestrator([fixture()], { twitch, google }, async () => {});
  await orchestrator.create({ ...fixture(), id: 'simple', localId: 'simple', recurrence: undefined });
  for (const adapter of [twitch, google]) {
    expect(adapter.create).toHaveBeenCalledTimes(1); expect(adapter.read).not.toHaveBeenCalled();
    expect(adapter.update).not.toHaveBeenCalled(); expect(adapter.delete).not.toHaveBeenCalled();
  }
  expect(orchestrator.all()[0].providers).toBeUndefined();
});

it('replaces durable uncertainty with the remote identity before yielding to another persistence worker', async () => {
  const { createWithDurableIntent } = await import('../packages/core/src/provider-identity.js');
  const event = { ...fixture(), recurrence: undefined };
  const returned = createWithDurableIntent(event, 'google', async () => {}, async () => ({ id: 'remote', revision: 'etag' }));
  await returned.then(() => {
    expect(event.providers?.google).toMatchObject({ remoteId: 'remote', remoteRevision: 'etag' });
    expect(event.providers?.google?.uncertainCreate).toBeUndefined();
  });
});

it('honors HTTP-date Retry-After and cancels a waiting retry without sending another request', async () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  const transport = new SyncHttp('google');
  const request = vi.fn(async () => new Response('{}', { status: 429, headers: { 'Retry-After': new Date(now + 5000).toUTCString() } }));
  const abort = new AbortController();
  const pending = transport.request(request, 'POST', abort.signal);
  const assertion = expect(pending).rejects.toThrow('Stopped');
  await vi.advanceTimersByTimeAsync(4000);
  expect(request).toHaveBeenCalledTimes(1);
  abort.abort(new Error('Stopped'));
  await assertion;
  expect(request).toHaveBeenCalledTimes(1);
});

it('keeps a definitive 429 retryable when its cooldown exceeds the request deadline', async () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  const controller = new AbortController();
  const request = vi.fn(async () => new Response('{}', { status: 429, headers: { 'Retry-After': '120' } }));
  const pending = new SyncHttp('google').request(request, 'POST', controller.signal);
  const assertion = expect(pending).rejects.toMatchObject({ mutationNotStarted: true });
  await vi.advanceTimersByTimeAsync(15000);
  controller.abort(new Error('Deadline'));
  await assertion; expect(request).toHaveBeenCalledTimes(1);
});

it.each(['disconnect', 'invalidate'] as const)('cancels Google mutation cooldown on %s without another HTTP attempt', async reason => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  const requests: string[] = [];
  let releaseRead!: () => void;
  const readGate = new Promise<void>(resolve => { releaseRead = resolve; });
  const request: typeof fetch = async (_url, init) => {
    requests.push(init?.method ?? 'GET');
    if (init?.method === 'DELETE') return new Response('{}', { status: 429, headers: { 'Retry-After': '2' } });
    await readGate;
    return new Response('{}', { status: 401 });
  };
  const client = new GoogleCalendarClient('client', { accessToken: 'old-account', refreshToken: '', expiresAt: now + 3600000 }, async () => {}, request);
  const invalidating = reason === 'invalidate' ? expect(client.calendars()).rejects.toThrow(/Reconnectez/) : undefined;
  const deleting = client.delete('calendar', 'event', 'etag');
  const rejected = expect(deleting).rejects.toThrow(/annulée/);
  await vi.advanceTimersByTimeAsync(500);
  expect(requests.filter(method => method === 'DELETE')).toHaveLength(1);
  if (reason === 'disconnect') await client.disconnect();
  else { releaseRead(); await invalidating; }
  await rejected; // Cancellation settles immediately, before Retry-After expires.
  await vi.advanceTimersByTimeAsync(5000);
  expect(requests.filter(method => method === 'DELETE')).toHaveLength(1);
  expect(client.connected).toBe(false);
});

it('coalesces rolling checkpoints without releasing CREATE before durable intent or worker identity', async () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  const item = fixture();
  let disk = structuredClone(item), saves = 0, active = 0, peak = 0;
  const created: string[] = [];
  const persist = async () => {
    const snapshot = structuredClone(item);
    saves++; active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 16));
    disk = snapshot; active--;
  };
  const create = vi.fn(async (event: CalendarItem) => {
    const entries = Object.values(disk.providers!.twitch!.projections!);
    expect(entries.find(entry => entry.event.startAtUtc === event.startAtUtc)?.uncertainCreate).toBeDefined();
    // Three workers: each worker's previous result must be durable before advancing.
    if (created.length >= 3) expect(entries.some(entry => entry.remoteId === created[created.length - 3])).toBe(true);
    const id = `remote-${created.length}`; created.push(id);
    return { id };
  });
  const provider = { create, read: async () => ({}), update: vi.fn(), delete: vi.fn() };
  const work = reconcileTwitchProjection(item, provider, persist, { now });
  await vi.runAllTimersAsync(); await work;
  expect(create).toHaveBeenCalledTimes(7);
  expect(peak).toBe(1);
  expect(saves).toBeLessThanOrEqual(12);
  expect(Object.values(disk.providers!.twitch!.projections!).every(entry => entry.remoteId && !entry.uncertainCreate)).toBe(true);
  saves = 0;
  const retry = reconcileTwitchProjection(item, provider, persist, { now, retry: true });
  await vi.runAllTimersAsync(); await retry;
  expect(create).toHaveBeenCalledTimes(7);
  expect(saves).toBe(1);
});

it('never releases queued rolling CREATEs when the durable checkpoint fails', async () => {
  const item = fixture();
  const create = vi.fn();
  const persist = vi.fn(async () => { throw new Error('disk unavailable'); });
  await expect(reconcileTwitchProjection(item, { create, update: vi.fn(), delete: vi.fn() }, persist, { now })).rejects.toThrow('disk unavailable');
  expect(create).not.toHaveBeenCalled();
});
