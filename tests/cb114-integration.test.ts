import { afterEach, expect, it, vi } from 'vitest';
import type { CalendarItem } from '../packages/contracts/src/index.js';
import { PlanningOrchestrator, type PlanningProvider } from '../packages/core/src/planning.js';
import { bulkDeleteSelection } from '../packages/core/src/planning-bulk-delete.js';
import { expandRecurringItems, migrateRecurrence } from '../packages/core/src/recurrence.js';

const now = Date.parse('2026-03-20T00:00:00Z');
function master(): CalendarItem {
  return { id: 'series', localId: 'durable', title: 'Live', ownership: 'LOCAL',
    startAtUtc: '2026-03-20T19:00:00Z', endAtUtc: '2026-03-20T20:00:00Z',
    recurrence: { frequency: 'daily', interval: 1, timeZone: 'Europe/Paris', exceptions: { 'durable:2026-03-21T20:00:00': { cancelled: true } } },
    desiredPublication: { local: true, twitch: false, google: true } };
}
function setup() {
  vi.useFakeTimers(); vi.setSystemTime(now);
  const remote = new Map<string, { item: CalendarItem; revision: string }>();
  let disk: CalendarItem[] = []; let revision = 0;
  const provider: PlanningProvider = {
    create: vi.fn(async item => {
      const id = item.localId!;
      const existing = remote.get(id);
      if (existing) return { id, revision: existing.revision, calendarId: 'calendar' };
      const version = String(++revision); remote.set(id, { item: structuredClone(item), revision: version });
      return { id, revision: version, calendarId: 'calendar' };
    }),
    read: vi.fn(async id => { const value = remote.get(id); return value ? { revision: value.revision, remote: value.item } : { deleted: true }; }),
    update: vi.fn(async (id, item, version) => {
      if (remote.get(id)?.revision !== version) throw Object.assign(new Error('etag'), { status: 412 });
      const next = String(++revision); remote.set(id, { item: structuredClone(item), revision: next }); return { revision: next };
    }),
    delete: vi.fn(async (id, _item, version) => {
      if (remote.has(id) && remote.get(id)?.revision !== version) throw Object.assign(new Error('etag'), { status: 412 });
      remote.delete(id);
    }),
  };
  const persist = async (items: CalendarItem[]) => { disk = structuredClone(items); };
  const restart = () => new PlanningOrchestrator(structuredClone(disk), { google: provider }, persist);
  return { remote, provider, restart, planning: restart() };
}
afterEach(() => vi.useRealTimers());

it('Google fallback persists individual identities/etags through DST, restart, window shift and complete withdrawal', async () => {
  const ctx = setup(); await ctx.planning.create(master());
  expect(ctx.remote.size).toBe(27);
  expect([...ctx.remote.values()].some(v => v.item.startAtUtc === '2026-03-29T18:00:00.000Z')).toBe(true);
  ctx.remote.set('unowned', { item: master(), revision: 'foreign' });
  await ctx.restart().refreshTwitch(); await ctx.restart().retry('series', 'google');
  expect(ctx.provider.create).toHaveBeenCalledTimes(27);
  await ctx.restart().refreshTwitch(now + 7 * 86400000);
  expect(ctx.remote.size).toBe(29);
  await ctx.restart().remove('series', { google: true, local: true });
  expect([...ctx.remote.keys()]).toEqual(['unowned']);
  expect(ctx.restart().all()).toEqual([]);
});

it.each(['local', 'remote'] as const)('Google occurrence conflict %s resolution is durable and does not duplicate', async strategy => {
  const ctx = setup(); const created = await ctx.planning.create(master());
  const [key, entry] = Object.entries(created.providers!.google!.projections!)[0];
  const remote = ctx.remote.get(entry.remoteId!)!; remote.item.title = 'Remote edit'; remote.revision = 'remote-edit';
  await ctx.restart().refreshTwitch();
  await expect(ctx.restart().retry('series', 'google')).rejects.toThrow();
  await ctx.restart().resolveConflict('series', 'google', strategy, key);
  expect(ctx.remote.get(entry.remoteId!)!.item.title).toBe(strategy === 'local' ? 'Live' : 'Remote edit');
  const writes = vi.mocked(ctx.provider.update).mock.calls.length;
  await ctx.restart().refreshTwitch();
  expect(ctx.provider.update).toHaveBeenCalledTimes(writes);
  expect(ctx.provider.create).toHaveBeenCalledTimes(27);
});

it('Google recovers a lost CREATE response with the same deterministic occurrence identity', async () => {
  const ctx = setup(); const create = ctx.provider.create;
  let lost = false;
  ctx.provider.create = async item => { const result = await create(item); if (!lost) { lost = true; throw new Error('response lost'); } return result; };
  await ctx.planning.create(master());
  expect(ctx.remote.size).toBe(27);
  await ctx.restart().retry('series', 'google');
  expect(ctx.remote.size).toBe(27);
  expect(ctx.restart().all()[0].providers!.google!.status).toBe('synced');
});

it('period bulk delete protects projected series even when the anchor is outside the period', async () => {
  const ctx = setup(); await ctx.planning.create(master());
  const selection = bulkDeleteSelection(ctx.planning.all(), '2026-04-01', '2026-04-10');
  expect(selection.eligible).toEqual([]); expect(selection.excluded).toHaveLength(1);
  expect(ctx.provider.delete).not.toHaveBeenCalled(); expect(ctx.remote.size).toBe(27);
});

it('legacy rules migrate losslessly and keep canonical keys across application IDs and moved exceptions', () => {
  const item = master(); const original = structuredClone(item.recurrence!);
  const migrated = migrateRecurrence(original); expect(original.version).toBeUndefined();
  expect(migrated).toEqual({ ...original, version: 2 });
  item.recurrence = migrated;
  item.recurrence.exceptions!['durable:2026-05-01T20:00:00'] = { patch: { startAtUtc: '2026-03-22T10:00:00Z', endAtUtc: '2026-03-22T11:00:00Z' } };
  const first = expandRecurringItems([item], { from: now, to: now + 3 * 86400000 });
  const next = expandRecurringItems([{ ...item, id: 'changed-ui-id' }], { from: now, to: now + 3 * 86400000 });
  expect(first.map(v => v.occurrenceKey)).toEqual(next.map(v => v.occurrenceKey));
  expect(first.some(v => v.occurrenceKey === 'durable:2026-05-01T20:00:00')).toBe(true);
  item.recurrence.until = '2026-04-01T00:00:00Z';
  expect(expandRecurringItems([item], { from: now, to: now + 3 * 86400000 })).toHaveLength(2);
});

it('a failed Google delete keeps the local series and its occurrence inventory for retry', async () => {
  const ctx = setup(); await ctx.planning.create(master());
  const remove = ctx.provider.delete; let fail = true;
  ctx.provider.delete = async (...args) => { if (fail) throw new Error('offline'); return remove(...args); };
  await expect(ctx.planning.remove('series', { google: true, local: true })).rejects.toThrow(/incomplète/);
  expect(ctx.restart().all()).toHaveLength(1); expect(ctx.remote.size).toBe(27);
  fail = false;
  await ctx.restart().retry('series', 'google'); expect(ctx.remote.size).toBe(0);
});

it('removing a native Twitch rule requires withdrawal and clears remote recurring state before republish', async () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  const provider = { create: vi.fn(async (_item: CalendarItem) => ({ id: 'native' })), update: vi.fn(async () => ({})), delete: vi.fn(async () => {}) };
  const planning = new PlanningOrchestrator([], { twitch: provider }, async () => {});
  const item = master(); item.recurrence = { frequency: 'weekly', interval: 1, timeZone: 'UTC' };
  item.desiredPublication = { local: true, twitch: true, google: false };
  await planning.create(item);
  const changed = await planning.update(item.id, { title: item.title, startAtUtc: item.startAtUtc, endAtUtc: item.endAtUtc, recurrence: undefined });
  expect(changed.providers?.twitch?.status).toBe('error'); expect(provider.update).not.toHaveBeenCalled();
  await expect(planning.remove(item.id, { twitch: true })).rejects.toThrow(/explicite/);
  await planning.remove(item.id, { twitch: true, confirmRecurring: true });
  expect(planning.all()[0].twitchRecurring).toBe(false);
  await planning.update(item.id, { title: item.title, startAtUtc: item.startAtUtc, endAtUtc: item.endAtUtc }, { desiredPublication: { twitch: true } });
  expect(provider.create).toHaveBeenCalledTimes(2);
  expect(provider.create.mock.calls.at(-1)?.[0].twitchRecurring).toBe(false);
  expect(planning.all()[0].twitchRecurring).toBe(false);
});

it('companion deletion retains and drains the Google occurrence journal', async () => {
  const { emptyCompanionState, reconcileCompanionBatch } = await import('../apps/server/src/companion-sync.js');
  const { drainCompanionProviders } = await import('../apps/server/src/companion-providers.js');
  const ctx = setup(); const item = await ctx.planning.create(master());
  const state = emptyCompanionState(); state.eventRevisions[item.id] = 1;
  const batch = reconcileCompanionBatch([item], [], state, [{ id: 'delete', eventId: item.id, type: 'delete', baseRevision: 1, patch: {} }]);
  expect(batch.companion.providerWork['series:google'].action).toBe('delete');
  await drainCompanionProviders(batch.planning, batch.companion, { google: ctx.provider }, async () => {});
  expect(ctx.remote.size).toBe(0);
  expect(batch.companion.providerWork['series:google']).toBeUndefined();
});
