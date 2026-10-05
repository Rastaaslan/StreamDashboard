import { expect, it, vi } from 'vitest';
import type { CalendarItem } from '../packages/contracts/src/index.js';
import { projectRecurrence, expandRecurringItems } from '../packages/core/src/recurrence.js';
import { reconcileTwitchProjection } from '../integrations/twitch/src/projection.js';
import { reconcileGoogleProjection } from '../integrations/google-calendar/src/projection.js';
const now = Date.parse('2026-03-25T00:00:00Z');
const master = (): CalendarItem => ({ id: 's', localId: 's', title: 'Live', ownership: 'LOCAL', startAtUtc: '2026-03-25T19:00:00Z', endAtUtc: '2026-03-25T20:00:00Z', desiredPublication: { local: true, twitch: true, google: true }, recurrence: { frequency: 'daily', interval: 1, timeZone: 'Europe/Paris', exceptions: { ignored: { cancelled: true } } } });
const next = (item: CalendarItem, windowStart = now) => projectRecurrence(item, { windowStart, nextCount: 7 });
it('selects seven effective daily slots across DST and rolls one identity', () => {
  const item = master(), initial = next(item), rolled = next(item, now + 86400000);
  expect(initial).toHaveLength(7);
  expect(initial.map(o => o.startAtUtc)).toEqual(['2026-03-25T19:00:00.000Z', '2026-03-26T19:00:00.000Z', '2026-03-27T19:00:00.000Z', '2026-03-28T19:00:00.000Z', '2026-03-29T18:00:00.000Z', '2026-03-30T18:00:00.000Z', '2026-03-31T18:00:00.000Z']);
  expect(rolled.slice(0, 6)).toEqual(initial.slice(1));
  expect(next(JSON.parse(JSON.stringify(item)))).toEqual(initial);
});
it.each(['weekly', 'monthly'] as const)('selects seven %s dates beyond a month', frequency => {
  const item = master(); item.recurrence!.frequency = frequency; item.recurrence!.interval = frequency === 'weekly' ? 2 : 1;
  expect(next(item).map(o => o.startAtUtc.slice(0, 10))).toEqual(frequency === 'weekly' ? ['2026-03-25', '2026-04-08', '2026-04-22', '2026-05-06', '2026-05-20', '2026-06-03', '2026-06-17'] : ['2026-03-25', '2026-04-25', '2026-05-25', '2026-06-25', '2026-07-25', '2026-08-25', '2026-09-25']);
});
it('fills cancellations and moves using effective ordering, with until on anchors', () => {
  const item = master();
  item.recurrence!.exceptions = {
    's:2026-03-25T20:00:00': { cancelled: true },
    's:2026-03-26T20:00:00': { patch: { startAtUtc: '2026-12-01T10:00:00Z', endAtUtc: '2026-12-01T11:00:00Z' } },
    's:2026-08-25T20:00:00': { patch: { title: 'Moved in', startAtUtc: '2026-03-25T10:00:00Z', endAtUtc: '2026-03-25T11:00:00Z' } },
  };
  expect(next(item).map(o => o.startAtUtc.slice(0, 10))).toEqual(['2026-03-25', '2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31', '2026-04-01']);
  expect(next(item)[0].title).toBe('Moved in');
  item.recurrence!.until = '2026-03-27T19:00:00Z';
  expect(next(item).map(o => o.startAtUtc.slice(0, 10))).toEqual(['2026-03-27', '2026-12-01']);
});
it('rejects invalid counts, unsupported engines and pathological cadence explicitly', () => {
  for (const nextCount of [0, -1, Infinity, 1.5, 10001]) expect(() => projectRecurrence(master(), { windowStart: now, nextCount })).toThrow(/nextCount/);
  const item = master(); item.recurrence!.interval = 0; expect(() => next(item)).toThrow();
  item.recurrence = { ...master().recurrence!, version: 2, interval: Number.MAX_SAFE_INTEGER };
  expect(() => next(item)).toThrow();
  item.recurrence = { ...master().recurrence!, version: 2, custom: { engine: 'future', version: 1, parameters: {} } };
  expect(() => next(item)).toThrow(/Moteur/);
});
it.each(['twitch', 'google'] as const)('%s migrates legacy owned surplus, preserves unowned, rolls once and restarts idempotently', async name => {
  const item = master();
  const legacy = expandRecurringItems([item], { from: now, to: now + 28 * 86400000 });
  const remote = new Set(legacy.map(o => o.occurrenceKey!)); remote.add('unowned');
  item.providers = { [name]: { status: 'synced', projections: Object.fromEntries(legacy.map(o => [o.occurrenceKey!, { occurrenceKey: o.occurrenceKey!, managedBy: 'StreamDashboard', projectionOwned: true, remoteId: o.occurrenceKey, event: o, status: 'synced' }])) } };
  const entries = item.providers[name]!.projections!;
  entries.foreign = { ...entries[legacy[0].occurrenceKey!], managedBy: 'someone-else' as any, remoteId: 'unowned' };
  const provider = { create: vi.fn(async (o: CalendarItem) => { const id = o.startAtUtc; remote.add(id); return { id }; }), update: vi.fn(async () => ({})), read: async () => ({}), delete: vi.fn(async (id: string) => { remote.delete(id); }) };
  const reconcile = name === 'twitch' ? reconcileTwitchProjection : reconcileGoogleProjection;
  await reconcile(item, provider, async () => {}, { now });
  expect(remote.size).toBe(8); expect(remote.has('unowned')).toBe(true);
  expect(provider.delete).toHaveBeenCalledTimes(21); expect(provider.create).not.toHaveBeenCalled();
  await reconcile(item, provider, async () => {}, { now: now + 86400000 });
  expect(provider.delete).toHaveBeenCalledTimes(22); expect(provider.create).toHaveBeenCalledTimes(1);
  await reconcile(JSON.parse(JSON.stringify(item)), provider, async () => {}, { now: now + 86400000 });
  expect(remote.size).toBe(8); expect(provider.delete).toHaveBeenCalledTimes(22); expect(provider.create).toHaveBeenCalledTimes(1);
});
it('measures daily operation and durable checkpoint reduction against the coalesced 28-day baseline', async () => {
  async function run(legacy: boolean) {
    const item = master(); let checkpoints = 0;
    const provider = { create: vi.fn(async () => ({ id: crypto.randomUUID() })), update: vi.fn(), delete: vi.fn() };
    await reconcileTwitchProjection(item, provider, async () => { checkpoints++; await Promise.resolve(); }, { now, ...(legacy ? { expand: (items: CalendarItem[]) => expandRecurringItems(items, { from: now, to: now + 28 * 86400000 }) } : {}) });
    return { creates: provider.create.mock.calls.length, checkpoints };
  }
  const before = await run(true), after = await run(false);
  expect(before.creates).toBe(28); expect(after.creates).toBe(7);
  expect(after.checkpoints).toBeLessThan(before.checkpoints / 2);
  console.info('CB-129 daily coalesced baseline -> next-7', { before, after });
});
it('clamps seven monthly anchors without drift and seeks an old master directly', () => {
  const item = master(); item.startAtUtc = '2024-01-31T19:00:00Z'; item.endAtUtc = '2024-01-31T20:00:00Z'; item.recurrence!.frequency = 'monthly';
  expect(next(item, Date.parse('2024-01-01')).map(o => o.startAtUtc.slice(0, 10))).toEqual(['2024-01-31', '2024-02-29', '2024-03-31', '2024-04-30', '2024-05-31', '2024-06-30', '2024-07-31']);
  item.startAtUtc = '1900-01-01T19:00:00Z'; item.endAtUtc = '1900-01-01T20:00:00Z'; item.recurrence!.frequency = 'daily';
  expect(next(item)).toHaveLength(7);
});
it.each(['twitch', 'google'] as const)('%s fills slots excluded by occurrence publication preferences', async name => {
  const item = master();
  item.recurrence!.exceptions!['s:2026-03-25T20:00:00'] = { patch: { desiredPublication: { local: true, twitch: false, google: false } } };
  const create = vi.fn(async () => ({ id: crypto.randomUUID() }));
  await (name === 'twitch' ? reconcileTwitchProjection : reconcileGoogleProjection)(item, { create, update: vi.fn(), delete: vi.fn() }, async () => {}, { now });
  const dates = Object.values(item.providers![name]!.projections!).map(entry => entry.event.startAtUtc.slice(0, 10)).sort();
  expect(dates).toEqual(['2026-03-26', '2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31', '2026-04-01']);
  expect(create).toHaveBeenCalledTimes(7);
});
