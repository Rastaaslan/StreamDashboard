import { afterEach, expect, it, vi } from 'vitest';
import { PlanningOrchestrator, type PlanningProvider } from '../packages/core/src/planning.js';
import type { CalendarItem } from '../packages/contracts/src/index.js';
import { emptyCompanionState } from '../apps/server/src/companion-sync.js';
import { drainCompanionProviders } from '../apps/server/src/companion-providers.js';

afterEach(() => vi.useRealTimers());
function fixture() {
  vi.useFakeTimers(); vi.setSystemTime('2026-10-05T00:00:00Z');
  const item: CalendarItem = { id: 'series', title: 'Native', ownership: 'LOCAL', editable: true, startAtUtc: '2026-10-05T12:00:00Z', endAtUtc: '2026-10-05T13:00:00Z',
    recurrence: { frequency: 'daily', interval: 1, timeZone: 'UTC' }, desiredPublication: { local: true, google: true, twitch: false }, providers: {} };
  const remote = new Set<string>(); let next = 0;
  const provider: PlanningProvider = {
    create: vi.fn(async () => { const id = `event-${++next}`; remote.add(id); return { id, calendarId: 'A', revision: 'etag' }; }),
    update: vi.fn(async () => ({})), delete: vi.fn(async (id, body, revision) => {
      expect(body.providers?.google?.calendarId).toBe('A'); expect(revision).toBe('etag'); remote.delete(id);
    }),
  };
  const constrain = (value: CalendarItem) => { value.recurrence!.exceptions = { 'series:2026-10-05T12:00:00': { patch: { title: 'Exception' } } }; };
  return { item, remote, provider, constrain };
}

it('legacy Google conversion refuses automatic deletion but explicit withdrawal survives failure and restart', async () => {
  const { item, remote, provider, constrain } = fixture();
  item.providers!.google = { status: 'synced', remoteId: 'legacy', calendarId: 'A', remoteRevision: 'etag' }; remote.add('legacy');
  constrain(item); let disk = [item];
  const restart = () => new PlanningOrchestrator(structuredClone(disk), { google: provider }, async rows => { disk = structuredClone(rows); });
  await restart().refreshTwitch(); await expect(restart().retry('series', 'google')).rejects.toThrow('explicitement');
  expect(provider.delete).not.toHaveBeenCalled(); expect(provider.create).not.toHaveBeenCalled();
  expect(disk[0].providers!.google!.projections).toEqual({});
  vi.mocked(provider.delete).mockRejectedValueOnce(new Error('offline'));
  await restart().remove('series', { local: false, google: true });
  expect(disk[0].providers!.google).toMatchObject({ remoteId: 'legacy', calendarId: 'A', remoteRevision: 'etag', nativeWithdrawalRequested: true, projections: {} });
  await restart().retry('series', 'google');
  expect(remote.size).toBe(0); expect(provider.create).not.toHaveBeenCalled();
  await restart().remove('series', { local: true }); expect(disk).toEqual([]);
});

it.each([false, true])('companion Google native ownership converts and cleans up after restart; legacy=%s', async legacy => {
  const { item, remote, provider, constrain } = fixture();
  let runtime = { planning: [item], companion: emptyCompanionState() }; let disk = structuredClone(runtime);
  const persist = async () => { disk = structuredClone(runtime); };
  const drain = () => drainCompanionProviders(runtime.planning, runtime.companion, { google: provider }, persist);
  runtime.companion.providerWork['series:google'] = { item, provider: 'google', action: 'publish', status: 'queued' };
  await drain();
  expect(disk.planning[0].providers!.google).toMatchObject({ projectionOwned: true, projectionMode: 'native', calendarId: 'A', remoteRevision: 'etag' });
  runtime = structuredClone(disk); const saved = runtime.planning[0]; constrain(saved);
  if (legacy) delete saved.providers!.google!.projectionOwned;
  runtime.companion.providerWork['series:google'] = { item: saved, provider: 'google', action: 'publish', status: 'queued' };
  await drain();
  expect(remote.size).toBe(legacy ? 1 : 7);
  expect(provider.create).toHaveBeenCalledTimes(legacy ? 1 : 8);
  runtime = structuredClone(disk);
  const deleted = runtime.planning.pop()!;
  runtime.companion.providerWork['series:google'] = { item: deleted, provider: 'google', action: 'delete', status: 'queued' };
  runtime.companion.tombstones.series = { eventId: 'series', item: deleted, providerLinks: deleted.providers } as any;
  vi.mocked(provider.delete).mockRejectedValueOnce(new Error('offline'));
  await drain(); runtime = structuredClone(disk);
  expect(runtime.companion.providerWork['series:google'].status).toBe('error');
  runtime.companion.providerWork['series:google'].status = 'queued'; await drain();
  runtime = structuredClone(disk); await drain();
  expect(remote.size).toBe(0); expect(runtime.companion.providerWork).toEqual({});
  expect(provider.create).toHaveBeenCalledTimes(legacy ? 1 : 8);
});

it.each([false, true].flatMap(owned => (['local', 'remote'] as const).map(strategy => ({ owned, strategy }))))(
  'native withdrawal 412: owned=$owned, choice=$strategy remains durable across refresh and retry', async ({ owned, strategy }) => {
    const { item, remote, provider, constrain } = fixture();
    item.providers!.google = { status: 'synced', remoteId: 'native', calendarId: 'A', remoteRevision: 'v1', projectionOwned: owned, projectionMode: 'native' };
    remote.add('native'); constrain(item);
    let disk = [item];
    const restart = () => new PlanningOrchestrator(structuredClone(disk), { google: provider }, async rows => { disk = structuredClone(rows); });
    const revision = 'v2';
    vi.mocked(provider.delete).mockImplementation(async (id, body, etag) => {
      expect(body.providers?.google?.calendarId).toBe('A');
      if (etag !== revision) throw Object.assign(new Error('Precondition failed'), { status: 412 });
      expect(disk[0].providers!.google!.nativeWithdrawalRequested).toBe(true);
      expect(disk[0].providers!.google!.remoteRevision).toBe(revision);
      remote.delete(id);
    });
    provider.read = vi.fn(async () => ({ revision, remote: { title: 'Remote chosen', startAtUtc: item.startAtUtc, endAtUtc: item.endAtUtc } }));
    // Legacy conversion creates the journal but must not delete the native link.
    if (!owned) await restart().refreshTwitch();
    await restart().remove('series', { local: false, google: true });
    const calls = vi.mocked(provider.delete).mock.calls.length;
    await restart().refreshTwitch(); await expect(restart().retry('series', 'google')).rejects.toThrow();
    expect(provider.delete).toHaveBeenCalledTimes(calls);
    await restart().resolveConflict('series', 'google', strategy);
    expect(provider.update).not.toHaveBeenCalled(); expect(provider.create).not.toHaveBeenCalled();
    await restart().refreshTwitch(); await restart().retry('series', 'google'); await restart().refreshTwitch();
    if (strategy === 'remote') {
      expect(remote.has('native')).toBe(true); expect(provider.delete).toHaveBeenCalledTimes(calls);
      expect(disk[0].desiredPublication!.google).toBe(true);
      expect(disk[0].providers!.google).toMatchObject({ status: 'synced', remoteId: 'native', remoteRevision: 'v2', nativeRetained: true });
      expect(disk[0].providers!.google!.nativeWithdrawalRequested).toBeUndefined();
      await restart().remove('series', { local: false, google: true });
    }
    expect(remote.size).toBe(0); expect(provider.update).not.toHaveBeenCalled(); expect(provider.create).not.toHaveBeenCalled();
  });
