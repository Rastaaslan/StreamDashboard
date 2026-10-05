import { expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { startDashboardServer } from '../apps/server/src/index.js';
import { expandRecurringItems } from '../packages/core/src/recurrence.js';
import { resolveTags } from '../packages/core/src/tags.js';
import { TwitchClient } from '../integrations/twitch/src/client.js';
import { TwitchPreflight } from '../integrations/twitch/src/preflight.js';

it('reaccepts a rejected tag from projected occurrence → series editor → regeneration → save → projected preflight, retaining other records feedback', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'cb118-tags-'));
  const observe = vi.spyOn(TwitchClient.prototype, 'getStreamsForGame').mockResolvedValue([]);
  const server = await startDashboardServer({ port: 0, dataDir, logger: { info() {}, warn() {}, error() {} } });
  const payloads: any[] = [];
  const request = async (route: string, options: RequestInit = {}) => {
    if (route.endsWith('/regenerate')) payloads.push(JSON.parse(String(options.body)));
    const response = await fetch(server.url + route, { ...options, headers: { 'Content-Type': 'application/json' } });
    expect(response.ok).toBe(true); return response.json();
  };
  const create = (body: unknown) => request('/api/v1/planning', { method: 'POST', body: JSON.stringify(body) });
  try {
    const base = { title: 'Live', twitchCategoryId: '42', startAtUtc: '2030-01-01T10:00:00Z', endAtUtc: '2030-01-01T11:00:00Z' };
    await create({ ...base, title: 'Other record', tags: { values: ['Community'], source: 'manual', rejectedValues: ['Speedrun'] } });
    const created = await create({ ...base, recurrence: { frequency: 'daily', interval: 1, timeZone: 'UTC' }, tags: { values: [], source: 'manual', rejectedValues: ['Coop'] } });
    const series = created.planning.find((item: any) => item.title === 'Live');
    const window = { from: Date.parse(base.startAtUtc), to: Date.parse(base.startAtUtc) + 86400000 };
    const occurrence = expandRecurringItems([series], window)[0];
    expect(occurrence.id).not.toBe(series.id);
    const nodes: Record<string, any> = {};
    const node = (selector: string) => nodes[selector] ??= { value: '', checked: false, options: [{ value: 'daily' }], reset() {}, replaceChildren() {}, close() {} };
    const source = await readFile('apps/web/preview/preview.js', 'utf8');
    const slice = (start: string, end: string) => source.slice(source.indexOf(start), source.indexOf(end));
    const context = {
      dialogCompletion: () => () => true,
      draftRevision: () => 0, /* No user events here; browser tests cover revisions. */
      document: { querySelector: node }, structuredClone,
      state: { runtime: true, eventEdit: { occurrence, series, scope: 'occurrence' } },
      eventTagMetadata: undefined, eventRejectedObservations: [], eventTagsGeneration: 0,
      request, requireRuntime: () => true, renderObservedTags() {}, renderEventProviderStatus() {}, eventCanonical: (item: any) => item,
      localDate: (value: string) => value.slice(0, 10), localTime: (value: string) => value.slice(11, 16),
      recurrenceValue: () => 'daily', editedRecurrence: () => series.recurrence,
      eventTimes: () => ({ startAtUtc: base.startAtUtc, endAtUtc: base.endAtUtc }),
      refreshRuntime: async () => true, toast: vi.fn(),
    };
    runInNewContext(
      slice('function readEventTags(', 'function renderObservedTags(') +
      slice('function populateEventForm(', 'function renderEventProviderStatus(') +
      slice("document.querySelector('#event-scope').onchange=", "document.querySelector('#event-duplicate').onclick=") +
      ';populateEventForm(state.eventEdit.occurrence,"occurrence");', context);
    // An occurrence draft must not replace or teach the master record.
    node('#event-tags').value = 'Coop, OccurrenceOnly';
    await node('#event-tags-regenerate').onclick();
    expect(payloads.at(-1)).toMatchObject({ id: occurrence.id, occurrenceKey: occurrence.occurrenceKey, seriesId: series.id });
    expect(node('#event-tags').value).not.toContain('Coop');
    expect(node('#event-tags').value).not.toContain('OccurrenceOnly');
    node('#event-scope').value = 'series';
    node('#event-scope').onchange();
    node('#event-tags').value = 'Coop, Speedrun';
    await node('#event-tags-regenerate').onclick();
    expect(payloads.at(-1).id).toBe(series.id);
    expect(payloads.at(-1).occurrenceKey).toBeUndefined();
    expect(node('#event-tags').value.split(', ')).toEqual(['Community', 'Coop']);
    await node('#event-form').onsubmit({ preventDefault() {}, currentTarget: node('#event-form') });
    expect(context.toast).not.toHaveBeenCalledWith(expect.anything(), true);
    const saved = await request('/api/v1/state');
    const master = saved.planning.find((item: any) => item.id === series.id);
    expect(master.tags).toMatchObject({ values: ['Community', 'Coop'], source: 'manual', validated: true });
    expect(master.tags.rejectedValues).not.toContain('Coop');
    expect(saved.planning.find((item: any) => item.title === 'Other record').tags).toEqual({ values: ['Community'], source: 'manual', rejectedValues: ['Speedrun'] });
    const projected = expandRecurringItems([master], window)[0];
    const resolved = await resolveTags(projected);
    const updateChannel = vi.fn(async () => {});
    const preflight = new TwitchPreflight({ getChannel: async () => ({ title: '', gameId: '' }), searchGame: vi.fn(), updateChannel });
    await preflight.prepare({ eventId: projected.id, title: projected.title, categoryId: projected.twitchCategoryId, tags: resolved.tags?.values });
    expect(updateChannel).toHaveBeenCalledWith({ title: 'Live', gameId: '42', tags: ['Community', 'Coop'] });
  } finally { await server.stop(); observe.mockRestore(); await rm(dataDir, { recursive: true, force: true }); }
});
