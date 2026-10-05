import { afterEach, expect, it, vi } from 'vitest';
import type { CalendarItem } from '../packages/contracts/src/index.js';
import { PlanningOrchestrator, type PlanningProvider } from '../packages/core/src/planning.js';

const fingerprint = (item: CalendarItem) => JSON.stringify([item.title, item.startAtUtc, item.endAtUtc, item.twitchCategoryId ?? '']);
async function setup() {
  vi.useFakeTimers(); vi.setSystemTime('2026-10-01T00:00:00Z');
  const remote = new Map<string, CalendarItem>(); let next = 0;
  let saved: CalendarItem[] = [];
  const provider: PlanningProvider = {
    create: vi.fn(async item => { const id = `remote-${++next}`; remote.set(id, structuredClone(item)); return { id, fingerprint: fingerprint(item) }; }),
    read: vi.fn(async id => {
      const item = remote.get(id);
      return item ? { remote: { title: item.title, startAtUtc: item.startAtUtc, endAtUtc: item.endAtUtc, twitchCategoryId: item.twitchCategoryId }, fingerprint: fingerprint(item) } : { deleted: true };
    }),
    update: vi.fn(async (id, item) => {
      if (item.providers?.twitch?.fingerprint !== fingerprint(remote.get(id)!)) throw Object.assign(new Error('Remote changed again'), { code: 'CONFLICT' });
      remote.set(id, structuredClone(item)); return { fingerprint: fingerprint(item) };
    }),
    delete: vi.fn(async id => { remote.delete(id); }),
  };
  const persist = async (items: CalendarItem[]) => { saved = structuredClone(items); };
  const restart = () => new PlanningOrchestrator(structuredClone(saved), { twitch: provider }, persist);
  const orchestrator = restart();
  await orchestrator.create({ id: 'series', title: 'Local', startAtUtc: '2026-10-01T12:00:00Z', endAtUtc: '2026-10-01T13:00:00Z', category: 'live', recurrence: { frequency: 'daily', interval: 1, timeZone: 'UTC' }, desiredPublication: { local: true, twitch: true, google: false } });
  const key = Object.keys(orchestrator.all()[0].providers!.twitch!.projections!)[0];
  const remoteId = orchestrator.all()[0].providers!.twitch!.projections![key].remoteId!;
  remote.get(remoteId)!.title = 'Remote';
  await orchestrator.refreshTwitch();
  return { orchestrator, remote, remoteId, key, provider, restart };
}
afterEach(() => vi.useRealTimers());

it.each(['local', 'remote'] as const)('explicit %s resolution survives restart and subsequent reconciliation', async strategy => {
  const ctx = await setup();
  const parent = ctx.orchestrator.all()[0];
  expect(parent.providers!.twitch!.projections![ctx.key].status).toBe('conflict');
  await expect(ctx.restart().retry('series', 'twitch')).rejects.toThrow();
  expect(ctx.provider.update).not.toHaveBeenCalled();
  // Change both sides after detecting the conflict: resolution must read now,
  // and local choice must use current intent rather than the last synced event.
  const changed = await ctx.restart().update('series', { ...parent, title: 'Current local' });
  expect(changed.providers!.twitch!.projections![ctx.key].status).toBe('conflict');
  ctx.remote.get(ctx.remoteId)!.title = 'Current remote';
  ctx.remote.get(ctx.remoteId)!.startAtUtc = '2026-10-03T16:00:00Z';
  ctx.remote.get(ctx.remoteId)!.endAtUtc = '2026-10-03T17:00:00Z';
  vi.mocked(ctx.provider.update).mockClear();
  const result = await ctx.restart().resolveConflict('series', 'twitch', strategy, ctx.key);
  expect(result.providers!.twitch!.status).toBe('synced');
  expect(ctx.remote.get(ctx.remoteId)!.title).toBe(strategy === 'local' ? 'Current local' : 'Current remote');
  expect(ctx.provider.update).toHaveBeenCalledTimes(strategy === 'local' ? 1 : 0);
  if (strategy === 'remote') expect(result.recurrence!.exceptions![ctx.key].patch).toMatchObject({ title: 'Current remote', startAtUtc: '2026-10-03T16:00:00Z' });
  const writes = vi.mocked(ctx.provider.update).mock.calls.length;
  await ctx.restart().refreshTwitch(); await ctx.restart().retry('series', 'twitch');
  expect(ctx.provider.update).toHaveBeenCalledTimes(writes);
  expect(ctx.provider.create).toHaveBeenCalledTimes(7);
  expect(ctx.restart().all()[0].providers!.twitch!.projections![ctx.key].remoteId).toBe(ctx.remoteId);
});

it('retains a failed resolution as conflict after restart and requires a new explicit choice', async () => {
  const ctx = await setup();
  vi.mocked(ctx.provider.update).mockImplementationOnce(async () => {
    ctx.remote.get(ctx.remoteId)!.title = 'Concurrent edit';
    throw Object.assign(new Error('Changed during resolution'), { code: 'CONFLICT' });
  });
  await expect(ctx.restart().resolveConflict('series', 'twitch', 'local', ctx.key)).rejects.toThrow('Changed during');
  expect(ctx.restart().all()[0].providers!.twitch!.projections![ctx.key].status).toBe('conflict');
  await expect(ctx.restart().retry('series', 'twitch')).rejects.toThrow();
  expect(ctx.provider.update).toHaveBeenCalledTimes(1);
  await ctx.restart().resolveConflict('series', 'twitch', 'local', ctx.key);
  expect(ctx.remote.get(ctx.remoteId)!.title).toBe('Local');
  await ctx.restart().refreshTwitch(); expect(ctx.provider.update).toHaveBeenCalledTimes(2);
});

it('resolves only the chosen occurrence and refuses missing remote preconditions', async () => {
  const ctx = await setup();
  const secondKey = Object.keys(ctx.orchestrator.all()[0].providers!.twitch!.projections!)[1];
  const secondId = ctx.orchestrator.all()[0].providers!.twitch!.projections![secondKey].remoteId!;
  ctx.remote.get(secondId)!.title = 'Second remote edit';
  await ctx.orchestrator.refreshTwitch();
  vi.mocked(ctx.provider.read!).mockResolvedValueOnce({ remote: { title: 'No fingerprint', startAtUtc: '2026-10-01T12:00:00Z', endAtUtc: '2026-10-01T13:00:00Z' } });
  await expect(ctx.restart().resolveConflict('series', 'twitch', 'local', ctx.key)).rejects.toThrow('empreinte');
  expect(ctx.provider.update).not.toHaveBeenCalled();
  const resolved = await ctx.restart().resolveConflict('series', 'twitch', 'remote', ctx.key);
  expect(resolved.providers!.twitch!.projections![ctx.key].status).toBe('synced');
  expect(resolved.providers!.twitch!.projections![secondKey].status).toBe('conflict');
  expect(resolved.providers!.twitch!.status).toBe('error');
});
