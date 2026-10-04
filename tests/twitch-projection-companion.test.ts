import { afterEach, expect, it, vi } from 'vitest';
import { PlanningOrchestrator, type PlanningProvider } from '../packages/core/src/planning.js';
import type { CalendarItem } from '../packages/contracts/src/index.js';
import { emptyCompanionState, reconcileCompanionBatch, resolveCompanionConflict } from '../apps/server/src/companion-sync.js';
import { drainCompanionProviders } from '../apps/server/src/companion-providers.js';

async function setup() {
  vi.useFakeTimers(); vi.setSystemTime('2026-10-01T00:00:00Z');
  const remote = new Map<string, CalendarItem>(); let next = 0;
  const provider: PlanningProvider = {
    create: vi.fn(async item => { const id = `segment-${++next}`; remote.set(id, structuredClone(item)); return { id }; }),
    update: vi.fn(async (id, item) => { remote.set(id, structuredClone(item)); return {}; }),
    delete: vi.fn(async id => { remote.delete(id); }),
    read: vi.fn(async id => ({ deleted: !remote.has(id) })),
  };
  const orchestrator = new PlanningOrchestrator([], { twitch: provider }, async () => {});
  const item = await orchestrator.create({ id: 'series', title: 'Live', startAtUtc: '2026-10-01T12:00:00Z', endAtUtc: '2026-10-01T13:00:00Z', category: 'live', recurrence: { frequency: 'daily', interval: 1, timeZone: 'UTC' }, desiredPublication: { local: true, twitch: true, google: false } });
  expect(remote.size).toBe(28);
  const state = emptyCompanionState(); state.eventRevisions[item.id] = 1;
  return { item, state, remote, provider };
}
afterEach(() => vi.useRealTimers());

it.each([false, true])('companion deletion cleans projections across restart/retry, conflict resolution=%s', async conflict => {
  const ctx = await setup();
  ctx.remote.set('external', { ...ctx.item, ownership: 'EXTERNAL' });
  const batch = reconcileCompanionBatch([ctx.item], [], ctx.state, [{ id: 'delete-series', eventId: ctx.item.id, type: 'delete', baseRevision: conflict ? 0 : 1, patch: {} }]);
  const result = conflict ? resolveCompanionConflict(batch.planning, batch.companion, 'delete-series', 'android') : batch;
  expect(result.planning).toHaveLength(0);
  expect(result.companion.providerWork['series:twitch']).toMatchObject({ action: 'delete', status: 'queued' });
  expect(result.companion.providerWork['series:twitch'].item.providers?.twitch?.remoteId).toBeUndefined();
  let runtime = structuredClone({ planning: result.planning, companion: result.companion });
  let saved = structuredClone(runtime);
  const persist = async () => { saved = structuredClone(runtime); };
  vi.mocked(ctx.provider.delete).mockRejectedValueOnce(new Error('offline'));
  await drainCompanionProviders(runtime.planning, runtime.companion, { twitch: ctx.provider }, persist);
  expect(ctx.remote.size).toBe(2);
  expect(saved.companion.providerWork['series:twitch'].status).toBe('error');
  expect(Object.keys((saved.companion.tombstones.series.providerLinks as CalendarItem['providers'])!.twitch!.projections!)).toHaveLength(1);
  runtime = structuredClone(saved); // Disk reload, then the same targeted retry as the API.
  runtime.companion.providerWork['series:twitch'].status = 'queued';
  await drainCompanionProviders(runtime.planning, runtime.companion, { twitch: ctx.provider }, persist, 'series:twitch');
  expect(runtime.companion.providerWork).toEqual({});
  expect([...ctx.remote.keys()]).toEqual(['external']);
  expect(ctx.provider.create).toHaveBeenCalledTimes(28);
  const deletes = vi.mocked(ctx.provider.delete).mock.calls.length;
  runtime = structuredClone(saved);
  await drainCompanionProviders(runtime.planning, runtime.companion, { twitch: ctx.provider }, persist);
  expect(ctx.provider.delete).toHaveBeenCalledTimes(deletes);
});

it.each([false, true])('companion conversion publishes one native series after cleanup, retry=%s', async retry => {
  const ctx = await setup();
  const batch = reconcileCompanionBatch([ctx.item], [], ctx.state, [{ id: 'make-weekly', eventId: ctx.item.id, type: 'update', baseRevision: 1, patch: { recurrence: { frequency: 'weekly', interval: 1, timeZone: 'UTC' } } }]);
  let runtime = structuredClone({ planning: batch.planning, companion: batch.companion });
  let saved = structuredClone(runtime);
  const persist = async () => { saved = structuredClone(runtime); };
  if (retry) vi.mocked(ctx.provider.create).mockRejectedValueOnce(Object.assign(new Error('rate limit'), { status: 429 }));
  await drainCompanionProviders(runtime.planning, runtime.companion, { twitch: ctx.provider }, persist);
  if (retry) {
    expect(ctx.remote.size).toBe(0);
    expect(saved.companion.providerWork['series:twitch'].status).toBe('error');
    runtime = structuredClone(saved); runtime.companion.providerWork['series:twitch'].status = 'queued';
    await drainCompanionProviders(runtime.planning, runtime.companion, { twitch: ctx.provider }, persist);
  }
  expect(ctx.remote.size).toBe(1);
  expect([...ctx.remote.values()][0].recurrence).toMatchObject({ frequency: 'weekly', interval: 1 });
  expect(runtime.planning[0].providers?.twitch).toMatchObject({ status: 'synced', projectionMode: 'native', remoteId: 'segment-29' });
  expect(runtime.companion.providerWork).toEqual({});
  runtime = structuredClone(saved);
  await drainCompanionProviders(runtime.planning, runtime.companion, { twitch: ctx.provider }, persist);
  expect(ctx.remote.size).toBe(1);
  expect(ctx.provider.delete).toHaveBeenCalledTimes(28);
  expect(ctx.provider.create).toHaveBeenCalledTimes(retry ? 30 : 29);
});

it('retains cleanup work for an uncertain occurrence without a remote identity', async () => {
  const ctx = await setup();
  const entry = Object.values(ctx.item.providers!.twitch!.projections!)[0];
  delete entry.remoteId; entry.uncertainCreate = { event: {}, publishedContent: 'unknown' };
  ctx.item.providers!.twitch!.projections = { [entry.occurrenceKey]: entry };
  const batch = reconcileCompanionBatch([ctx.item], [], ctx.state, [{ id: 'delete-uncertain', eventId: ctx.item.id, type: 'delete', baseRevision: 1, patch: {} }]);
  expect(batch.companion.providerWork['series:twitch'].action).toBe('delete');
  await drainCompanionProviders(batch.planning, batch.companion, { twitch: ctx.provider }, async () => {});
  expect(batch.companion.providerWork['series:twitch'].error).toMatch(/incertaine/);
  expect(ctx.provider.delete).not.toHaveBeenCalled();
});
