import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlanningOrchestrator, type PlanningProvider } from '../packages/core/src/planning.js';
import type { CalendarItem } from '../packages/contracts/src/index.js';
import { expandRecurringItems } from '../packages/core/src/recurrence.js';

const now = Date.parse('2026-01-01T00:00:00Z');
function series(frequency: 'daily' | 'weekly' | 'monthly' = 'daily', interval: 1 | 2 = 1): CalendarItem {
  return { id: 's', localId: 's', title: 'Live', category: 'live', ownership: 'LOCAL', startAtUtc: '2026-01-01T12:00:00.000Z', endAtUtc: '2026-01-01T13:00:00.000Z', recurrence: { frequency, interval, timeZone: 'UTC', exceptions: {} }, desiredPublication: { local: true, twitch: true, google: false } };
}
function setup() {
  vi.useFakeTimers(); vi.setSystemTime(now);
  let saved: CalendarItem[] = [];
  const remote = new Map<string, CalendarItem>(); let next = 0;
  const provider: PlanningProvider = {
    create: vi.fn(async item => { const id = `remote-${++next}`; remote.set(id, structuredClone(item)); return { id }; }),
    update: vi.fn(async (id, item) => { remote.set(id, structuredClone(item)); return {}; }),
    delete: vi.fn(async id => { remote.delete(id); }),
    read: vi.fn(async id => ({ deleted: !remote.has(id) })),
  };
  const persist = async (items: CalendarItem[]) => { saved = structuredClone(items); };
  const restart = () => new PlanningOrchestrator(structuredClone(saved), { twitch: provider }, persist);
  return { orchestrator: new PlanningOrchestrator([], { twitch: provider }, persist), provider, remote, restart };
}
afterEach(() => vi.useRealTimers());

describe('Twitch rolling materialization', () => {
  it.each([['daily', 1, 28], ['weekly', 2, 2], ['monthly', 1, 1]] as const)('%s/%s uses the 28-day window and survives restart without duplicates', async (frequency, interval, count) => {
    const ctx = setup();
    const result = await ctx.orchestrator.create(series(frequency, interval));
    expect(result.providers?.twitch?.projectionMode).toBe('materialized');
    expect(ctx.remote.size).toBe(count);
    for (const value of ctx.remote.values()) { expect(value.recurrence).toBeUndefined(); expect(value.occurrenceKey).toBeUndefined(); expect(value.twitchRecurring).toBe(false); }
    await ctx.restart().refreshTwitch();
    await ctx.restart().retry('s', 'twitch');
    expect(ctx.provider.create).toHaveBeenCalledTimes(count);
    expect(ctx.provider.update).not.toHaveBeenCalled();
  });
  it('keeps exact weekly-1 native, materializes until and exceptions', async () => {
    const ctx = setup(); const native = await ctx.orchestrator.create(series('weekly'));
    expect(native.providers?.twitch?.projectionMode).toBe('native');
    expect(ctx.provider.create).toHaveBeenCalledTimes(1);
    const other = setup(); const item = series('weekly'); item.recurrence!.until = '2026-01-20T23:59:59Z';
    const occurrences = expandRecurringItems([item], { from: now, to: now + 28 * 86400000 });
    item.recurrence!.exceptions![occurrences[1].occurrenceKey!] = { cancelled: true };
    await other.orchestrator.create(item);
    expect([...other.remote.values()].map(item => item.startAtUtc.slice(0, 10))).toEqual(['2026-01-01', '2026-01-15']);
  });
  it('shifts the window and deletes only owned obsolete occurrences', async () => {
    const ctx = setup(); await ctx.orchestrator.create(series());
    ctx.remote.set('external', series());
    await ctx.orchestrator.refreshTwitch(now + 7 * 86400000);
    expect(ctx.provider.delete).toHaveBeenCalledTimes(7);
    expect(ctx.provider.create).toHaveBeenCalledTimes(35);
    expect(ctx.remote.size).toBe(29); expect(ctx.remote.has('external')).toBe(true);
    await ctx.orchestrator.refreshTwitch(now + 7 * 86400000);
    expect(ctx.provider.create).toHaveBeenCalledTimes(35);
  });
  it('keeps a moved occurrence through window shifts using its effective date and stable identity', async () => {
    const ctx = setup(); const item = series();
    const key = 's:2026-01-01T12:00:00';
    item.recurrence!.exceptions = { [key]: { patch: { startAtUtc: '2026-01-03T15:00:00Z', endAtUtc: '2026-01-03T16:00:00Z' } } };
    const created = await ctx.orchestrator.create(item);
    const remoteId = created.providers!.twitch!.projections![key].remoteId!;
    await ctx.orchestrator.refreshTwitch(now + 86400000);
    expect(ctx.orchestrator.all()[0].providers!.twitch!.projections![key].remoteId).toBe(remoteId);
    expect(ctx.remote.get(remoteId)?.startAtUtc).toBe('2026-01-03T15:00:00Z');
    expect(ctx.provider.delete).not.toHaveBeenCalledWith(remoteId, expect.anything(), expect.anything());
    await ctx.orchestrator.refreshTwitch(now + 3 * 86400000);
    expect(ctx.remote.has(remoteId)).toBe(false);
  });
  it('projects future anchors moved into the window and excludes anchors moved out', async () => {
    const ctx = setup(); const item = series();
    const incoming = 's:2026-02-05T12:00:00', outgoing = 's:2026-01-02T12:00:00';
    item.recurrence!.exceptions = {
      [incoming]: { patch: { startAtUtc: '2026-01-03T15:00:00Z', endAtUtc: '2026-01-03T16:00:00Z' } },
      [outgoing]: { patch: { startAtUtc: '2026-02-06T15:00:00Z', endAtUtc: '2026-02-06T16:00:00Z' } },
    };
    await ctx.orchestrator.create(item);
    const initial = ctx.orchestrator.all()[0].providers!.twitch!.projections!;
    expect(initial[incoming].remoteId).toBeTruthy(); expect(initial[outgoing]).toBeUndefined();
    expect(ctx.remote.size).toBe(28);
    await ctx.orchestrator.refreshTwitch(Date.parse('2026-02-05T00:00:00Z'));
    const shifted = ctx.orchestrator.all()[0].providers!.twitch!.projections!;
    expect(shifted[incoming]).toBeUndefined(); expect(shifted[outgoing].remoteId).toBeTruthy();
    expect(ctx.remote.size).toBe(28);
  });
  it('isolates definitive failures and retries only failed occurrences', async () => {
    const ctx = setup(); vi.mocked(ctx.provider.create).mockRejectedValueOnce(Object.assign(new Error('rate limited'), { status: 429 }));
    const item = await ctx.orchestrator.create(series());
    expect(ctx.remote.size).toBe(27); expect(item.providers?.twitch?.status).toBe('error');
    expect(Object.values(item.providers!.twitch!.projections!).filter(entry => entry.lastError)).toHaveLength(1);
    await ctx.restart().retry('s', 'twitch');
    expect(ctx.remote.size).toBe(28); expect(ctx.provider.create).toHaveBeenCalledTimes(29);
  });
  it('persists ambiguous create intent across restart and never repeats it', async () => {
    const ctx = setup(); const create = ctx.provider.create;
    vi.mocked(create).mockImplementationOnce(async event => { ctx.remote.set('response-lost', event); throw new Error('timeout'); });
    await ctx.orchestrator.create(series());
    await expect(ctx.restart().retry('s', 'twitch')).rejects.toThrow('incertaine');
    expect(ctx.remote.size).toBe(28); expect(create).toHaveBeenCalledTimes(28);
  });
  it('does not resurrect a remote deletion until explicit retry', async () => {
    const ctx = setup(); await ctx.orchestrator.create(series()); ctx.remote.delete('remote-1');
    await ctx.restart().refreshTwitch(); expect(ctx.remote.size).toBe(27);
    await ctx.restart().retry('s', 'twitch'); expect(ctx.remote.size).toBe(28);
    expect(ctx.provider.create).toHaveBeenCalledTimes(29);
  });
  it('reconciles content updates, exception cancellations and withdrawal', async () => {
    const ctx = setup(); const created = await ctx.orchestrator.create(series());
    const key = Object.keys(created.providers!.twitch!.projections!)[0];
    const item = series(); item.recurrence!.exceptions![key] = { cancelled: true };
    await ctx.orchestrator.update('s', { ...item, title: 'Changed' });
    expect(ctx.remote.size).toBe(27); expect(ctx.provider.update).toHaveBeenCalledTimes(27);
    await ctx.orchestrator.remove('s', { twitch: true, local: true });
    expect(ctx.remote.size).toBe(0); expect(ctx.orchestrator.all()).toHaveLength(0);
  });

  it('converts owned native series and returns to native without leftover occurrences', async () => {
    const ctx = setup(); await ctx.orchestrator.create(series('weekly'));
    await ctx.orchestrator.update('s', series());
    expect(ctx.remote.size).toBe(28); expect(ctx.provider.delete).toHaveBeenCalledTimes(1);
    await ctx.orchestrator.update('s', series('weekly'));
    expect(ctx.remote.size).toBe(1); expect(ctx.provider.delete).toHaveBeenCalledTimes(29);
    expect(ctx.orchestrator.all()[0].providers?.twitch?.projectionMode).toBe('native');
    await ctx.restart().refreshTwitch(); expect(ctx.remote.size).toBe(1);
  });
  it('finishes native publication on refresh after failed cleanup and persisted restart', async () => {
    const ctx = setup(); await ctx.orchestrator.create(series());
    vi.mocked(ctx.provider.delete).mockRejectedValueOnce(new Error('offline'));
    const changed = await ctx.orchestrator.update('s', series('weekly'));
    expect(changed.providers?.twitch?.status).toBe('error');
    expect(ctx.remote.size).toBe(1);
    await ctx.restart().refreshTwitch();
    expect(ctx.remote.size).toBe(1);
    expect([...ctx.remote.values()][0].recurrence).toMatchObject({ frequency: 'weekly', interval: 1 });
    expect(ctx.restart().all()[0].providers?.twitch).toMatchObject({ status: 'synced', projectionMode: 'native' });
    await ctx.restart().refreshTwitch(); await ctx.restart().refreshTwitch();
    expect(ctx.provider.create).toHaveBeenCalledTimes(29);
    expect(ctx.provider.delete).toHaveBeenCalledTimes(29);
  });
  it('refresh retries a definitive native create failure after transition cleanup', async () => {
    const ctx = setup(); await ctx.orchestrator.create(series());
    vi.mocked(ctx.provider.create).mockRejectedValueOnce(Object.assign(new Error('rate limit'), { status: 429 }));
    await ctx.orchestrator.update('s', series('weekly'));
    expect(ctx.remote.size).toBe(0);
    await ctx.restart().refreshTwitch(); await ctx.restart().refreshTwitch();
    expect(ctx.remote.size).toBe(1); expect(ctx.provider.create).toHaveBeenCalledTimes(30);
  });
  it('never automatically deletes an adopted native identity, but permits explicit withdrawal', async () => {
    const ctx = setup();
    const item = series('weekly'); item.providers = { twitch: { status: 'synced', remoteId: 'external', projectionOwned: false } }; item.twitchRecurring = true;
    ctx.remote.set('external', item);
    await ctx.orchestrator.create(item);
    await ctx.orchestrator.update('s', series());
    expect(ctx.provider.delete).not.toHaveBeenCalled(); expect(ctx.provider.create).not.toHaveBeenCalled();
    await ctx.orchestrator.remove('s', { twitch: true, confirmRecurring: true });
    expect(ctx.remote.size).toBe(0);
  });
  it('does not bypass an ambiguous native creation when the recurrence changes', async () => {
    const ctx = setup(); vi.mocked(ctx.provider.create).mockRejectedValueOnce(new Error('timeout'));
    await ctx.orchestrator.create(series('weekly'));
    const changed = await ctx.orchestrator.update('s', series());
    expect(changed.providers?.twitch?.lastError).toMatch(/native distante incertaine/);
    await expect(ctx.restart().retry('s', 'twitch')).rejects.toThrow('incertaine');
    expect(ctx.provider.create).toHaveBeenCalledTimes(1); expect(ctx.provider.delete).not.toHaveBeenCalled();
  });
  it('retains local identities if cleanup fails and retries withdrawal after restart', async () => {
    const ctx = setup(); await ctx.orchestrator.create(series('monthly'));
    vi.mocked(ctx.provider.delete).mockRejectedValueOnce(new Error('offline'));
    await expect(ctx.orchestrator.remove('s', { twitch: true, local: true })).rejects.toThrow('incomplète');
    expect(ctx.orchestrator.all()).toHaveLength(1);
    await ctx.restart().retry('s', 'twitch'); expect(ctx.remote.size).toBe(0);
  });
});
