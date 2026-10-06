import { afterEach, expect, it, vi } from 'vitest';
import { PlanningOrchestrator, type PlanningProvider } from '../packages/core/src/planning.js';
import { projectRecurrence } from '../packages/core/src/recurrence.js';
import type { CalendarItem } from '../packages/contracts/src/index.js';
const now = Date.parse('2026-03-25T00:00:00Z');
afterEach(() => vi.useRealTimers());
function setup(names: ('twitch' | 'google')[], materialized = false) {
  vi.useFakeTimers(); vi.setSystemTime(now);
  let disk: CalendarItem[] = [];
  const remote = new Set<string>(['unowned']);
  let sequence = 0;
  const provider: PlanningProvider = {
    create: vi.fn(async () => { const id = `remote-${++sequence}`; remote.add(id); return { id, revision: 'v1', fingerprint: 'f1', owned: true }; }),
    update: vi.fn(async () => ({})),
    read: vi.fn(async () => ({ revision: 'v2', fingerprint: 'f2', remote: { title: 'changed', startAtUtc: '', endAtUtc: '' } })),
    delete: vi.fn(async id => { remote.delete(id); }),
  };
  const providers = Object.fromEntries(names.map(name => [name, provider]));
  const restart = () => new PlanningOrchestrator(structuredClone(disk), providers, async items => { disk = structuredClone(items); });
  const item: CalendarItem = { id: 'series', title: 'Live', ownership: 'LOCAL', startAtUtc: '2026-03-25T19:00:00Z', endAtUtc: '2026-03-25T20:00:00Z', recurrence: { frequency: 'weekly', interval: 1, timeZone: 'UTC', ...(materialized ? { exceptions: { ignored: { cancelled: true } } } : {}) }, desiredPublication: { local: true, twitch: names.includes('twitch'), google: names.includes('google') } };
  return { provider, providers, remote, restart, item };
}
it.each([
  [[], false], [['twitch'], false], [['twitch'], true], [['google'], false], [['google'], true], [['twitch', 'google'], true], [['twitch', 'google'], false],
] as [ ('twitch' | 'google')[], boolean ][])('deletes owned %j materialized=%s, durably and idempotently', async (names, materialized) => {
  const ctx = setup(names, materialized);
  await ctx.restart().create(ctx.item);
  expect(ctx.remote.size).toBe(1 + names.length * (materialized ? 7 : 1));
  await ctx.restart().remove('series', { local: true, confirmRecurring: true });
  expect([...ctx.remote]).toEqual(['unowned']);
  expect(ctx.restart().all()).toEqual([]);
  await ctx.restart().remove('series', { local: true, confirmRecurring: true });
  await ctx.restart().refreshTwitch(now + 90 * 86400000);
  expect(ctx.provider.create).toHaveBeenCalledTimes(names.length * (materialized ? 7 : 1));
});
it.each([false, true])('partial failure + restart + retry finishes local deletion; materialized=%s', async materialized => {
  const ctx = setup(['twitch', 'google'], materialized);
  await ctx.restart().create(ctx.item);
  const original = ctx.provider.delete;
  ctx.providers.google = { ...ctx.provider, delete: vi.fn(async () => { throw new Error('offline'); }) };
  await expect(ctx.restart().remove('series', { local: true, confirmRecurring: true })).rejects.toThrow(/incomplète/);
  const pending = ctx.restart().all()[0];
  expect(pending.deletionPending).toBe(true);
  expect(projectRecurrence(pending, { windowStart: now, nextCount: 7 })).toEqual([]);
  expect(pending.desiredPublication).toEqual({ local: true, twitch: false, google: false });
  expect(pending.providers?.twitch).toBeUndefined();
  expect(materialized ? Object.values(pending.providers!.google!.projections!).every(entry => entry.remoteId) : pending.providers?.google?.remoteId).toBeTruthy();
  await ctx.restart().refreshTwitch(now + 90 * 86400000);
  await expect(ctx.restart().update('series', { title: 'edit', startAtUtc: '', endAtUtc: '' })).rejects.toThrow(/Suppression/);
  expect(ctx.provider.create).toHaveBeenCalledTimes(materialized ? 14 : 2);
  ctx.providers.google.delete = original;
  await ctx.restart().retry('series', 'google');
  expect(ctx.restart().all()).toEqual([]);
  expect([...ctx.remote]).toEqual(['unowned']);
});
it.each([false, true])('404 settles owned identities and 412 retains them until explicit retry; materialized=%s', async materialized => {
  const ctx = setup(['google'], materialized); await ctx.restart().create(ctx.item);
  ctx.provider.delete = vi.fn(async () => { throw Object.assign(new Error('conflict'), { status: 412 }); });
  await expect(ctx.restart().remove('series', { local: true })).rejects.toThrow(/incomplète/);
  await ctx.restart().refreshTwitch();
  expect(ctx.provider.read).not.toHaveBeenCalled();
  ctx.provider.delete = vi.fn(async (_id, _item, revision) => { expect(revision).toBe('v2'); throw Object.assign(new Error('gone'), { status: 404 }); });
  await ctx.restart().retry('series', 'google');
  expect(ctx.provider.read).toHaveBeenCalledTimes(materialized ? 7 : 1);
  expect(ctx.restart().all()).toEqual([]);
});
it('does not touch linked unowned native or occurrence identities', async () => {
  const ctx = setup([], true);
  ctx.item.providers = { twitch: { status: 'synced', remoteId: 'unowned', projectionOwned: false, projections: { foreign: { status: 'synced', occurrenceKey: 'foreign', managedBy: 'other' as any, remoteId: 'unowned', event: ctx.item } } } };
  const planning = new PlanningOrchestrator([ctx.item], { twitch: ctx.provider }, async () => {});
  await planning.remove('series', { local: true });
  expect(planning.all()).toEqual([]);
  expect(ctx.provider.delete).not.toHaveBeenCalled();
  expect([...ctx.remote]).toEqual(['unowned']);
});

it.each((['twitch', 'google'] as const).flatMap(name => [false, true].map(materialized => ({ name, materialized }))))('recovers lost $name CREATE read-only while deleting, materialized=$materialized', async ({ name, materialized }) => {
  const ctx = setup([name], materialized);
  const requests = new Map<string, string>();
  ctx.provider.create = vi.fn(async event => {
    const id = `lost-${requests.size}`;
    requests.set(event.startAtUtc, id); ctx.remote.add(id);
    throw new Error('response lost');
  });
  ctx.provider.recoverCreation = vi.fn(async event => {
    const id = requests.get(event.startAtUtc)!;
    return { id, owned: true as const, revision: 'v1', fingerprint: 'f1' };
  });
  await ctx.restart().create(ctx.item);
  const creates = vi.mocked(ctx.provider.create).mock.calls.length;
  ctx.providers[name] = undefined as any;
  await expect(ctx.restart().remove('series', { local: true, confirmRecurring: true })).rejects.toThrow(/incomplète/);
  expect(ctx.restart().all()[0].deletionPending).toBe(true);
  ctx.providers[name] = ctx.provider;
  await ctx.restart().refreshTwitch(now + 86400000);
  const saved = ctx.restart().all()[0].providers![name]!;
  const identities = materialized ? Object.values(saved.projections!) : [saved];
  expect(identities.every(link => link.remoteId && link.projectionOwned && !link.uncertainCreate)).toBe(true);
  expect(ctx.provider.delete).not.toHaveBeenCalled();
  await ctx.restart().retry('series', name);
  expect(ctx.restart().all()).toEqual([]);
  expect([...ctx.remote]).toEqual(['unowned']);
  expect(ctx.provider.create).toHaveBeenCalledTimes(creates);
  expect(ctx.provider.recoverCreation).toHaveBeenCalledTimes(creates);
});

it('keeps actionable uncertainty when lookup cannot prove ownership, then allows read-only recovery on retry', async () => {
  const ctx = setup(['twitch']);
  ctx.provider.create = vi.fn(async () => { ctx.remote.add('lost'); throw new Error('lost response'); });
  ctx.provider.recoverCreation = vi.fn(async () => ({ id: 'unowned', owned: false as any }));
  await ctx.restart().create(ctx.item);
  await expect(ctx.restart().remove('series', { local: true })).rejects.toThrow(/ownership non établi/);
  await ctx.restart().refreshTwitch();
  expect(ctx.restart().all()[0].providers!.twitch!.uncertainCreate).toBeTruthy();
  expect(ctx.provider.delete).not.toHaveBeenCalled();
  ctx.provider.recoverCreation = vi.fn(async () => ({ id: 'lost', owned: true as const }));
  await ctx.restart().retry('series', 'twitch');
  expect(ctx.restart().all()).toEqual([]);
  expect([...ctx.remote]).toEqual(['unowned']);
  expect(ctx.provider.create).toHaveBeenCalledOnce();
});
