import { describe, expect, it, vi } from 'vitest';
import type { CalendarItem } from '../packages/contracts/src/index.js';
import { expandRecurringItems, migrateRecurrence } from '../packages/core/src/recurrence.js';
import { projectGoogleSeries } from '../integrations/google-calendar/src/projection.js';
import { googleRecurrence, parseGoogleRecurrence } from '../integrations/google-calendar/src/recurrence.js';
import { GoogleCalendarClient } from '../integrations/google-calendar/src/client.js';

const window = { from: '2026-01-01', to: '2026-02-01' };
const item: CalendarItem = { id: 'series', localId: 'local-series', title: 'Live', startAtUtc: '2026-01-06T19:00:00.000Z', endAtUtc: '2026-01-06T20:00:00.000Z', recurrence: { frequency: 'weekly', interval: 1, timeZone: 'Europe/Paris', until: '2026-01-27T19:00:00.000Z', exceptions: {} } };

describe('versioned recurrence and Google rolling projection', () => {
  it.each([['daily', 1], ['weekly', 1], ['weekly', 2], ['monthly', 1]] as const)('keeps %s/%s native before and after migration', (frequency, interval) => {
    const legacy = { ...item, recurrence: { ...item.recurrence!, frequency, interval } };
    const migrated = { ...legacy, recurrence: migrateRecurrence(legacy.recurrence) };
    expect(legacy.recurrence).not.toHaveProperty('version');
    expect(migrateRecurrence(migrated.recurrence)).toEqual(migrated.recurrence);
    expect(googleRecurrence(migrated)).toEqual(googleRecurrence(legacy));
    expect(projectGoogleSeries(migrated, window).mode).toBe('master');
    const normalized = (source: CalendarItem) => expandRecurringItems([source], window).map(value => ({ ...value, recurrence: migrateRecurrence(value.recurrence!) }));
    expect(normalized(legacy)).toEqual(normalized(migrated));
  });

  it('maps versioned interval N exactly while refusing the ambiguous legacy shape', () => {
    const rule = { ...item.recurrence!, frequency: 'daily' as const, interval: 3 };
    expect(() => migrateRecurrence(rule)).toThrow();
    const recurrenceLines = googleRecurrence({ ...item, recurrence: { ...rule, version: 2 } });
    expect(recurrenceLines[0]).toContain('FREQ=DAILY;INTERVAL=3');
    expect(parseGoogleRecurrence({ ...item, recurrenceLines, recurrenceTimeZone: rule.timeZone })).toMatchObject({ version: 2, frequency: 'daily', interval: 3 });
  });

  it('preserves until, cancellations, overrides and stable identities across rolling windows', () => {
    const rule = migrateRecurrence(item.recurrence!);
    rule.interval = 3;
    rule.exceptions = { 'local-series:2026-01-06T20:00:00': { patch: { title: 'Special' } } };
    const source = { ...item, recurrence: rule };
    const plan = projectGoogleSeries(source, window);
    expect(plan.mode).toBe('materialized');
    expect(plan.entries.map(e => e.input.title)).toEqual(['Special', 'Live']);
    expect(plan.entries[0].input.recurrence).toBeUndefined();
    expect(plan.entries[0].input.localId).not.toBe(item.localId);
    const next = projectGoogleSeries(source, { from: '2026-01-20', to: '2026-03-01' });
    expect(next.entries).toEqual([plan.entries[1]]);
    rule.exceptions['local-series:2026-01-27T20:00:00'] = { cancelled: true };
    expect(projectGoogleSeries(source, window).entries).toHaveLength(1);
  });

  it('requires an explicit custom engine and supports a mock multiple-weekdays engine', () => {
    const custom = { ...item, recurrence: { ...migrateRecurrence(item.recurrence!), custom: { engine: 'weekdays', version: 1, parameters: { weekdays: ['TU', 'TH'] } } } };
    expect(() => projectGoogleSeries(custom, window)).toThrow('Moteur');
    const expand = vi.fn(() => [
      { ...item, seriesId: item.id, occurrenceKey: 'tuesday' },
      { ...item, seriesId: item.id, occurrenceKey: 'thursday', startAtUtc: '2026-01-08T19:00:00Z', endAtUtc: '2026-01-08T20:00:00Z' },
    ]);
    const plan = projectGoogleSeries(custom, window, { expand });
    expect(expand).toHaveBeenCalledWith([custom], window);
    expect(plan.entries).toHaveLength(2);
    expect(new Set(plan.entries.map(e => e.input.localId)).size).toBe(2);
    expect(plan.entries.every(e => e.identity.mode === 'materialized')).toBe(true);
    expect(() => projectGoogleSeries(custom, window, { expand: () => [expand()[0], expand()[0]] })).toThrow('dupliquée');
    expect(() => migrateRecurrence({ ...item.recurrence!, version: 99 } as any)).toThrow('Version');
  });

  it('recovers a concurrent create by deterministic remote ID after HTTP 409', async () => {
    const input = projectGoogleSeries({ ...item, recurrence: { ...item.recurrence!, exceptions: { ignored: { cancelled: true } } } }, window).entries[0].input;
    let remote: any;
    const request = vi.fn(async (_url: any, init: any) => {
      if (init.method === 'POST') {
        remote = { ...JSON.parse(init.body), etag: 'v1' };
        return new Response('{}', { status: 409 });
      }
      return Response.json(String(_url).includes('/events?') ? { items: [] } : remote);
    });
    const client = new GoogleCalendarClient('client', { accessToken: 'token', refreshToken: '', expiresAt: Date.now() + 3600000 }, async () => {}, request);
    expect((await client.create('calendar', input)).projection).toEqual(input.projection);
    expect(request.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1);
  });

  it('recovers a lost create, detects conflicts and requires occurrence etags', async () => {
    const input = projectGoogleSeries({ ...item, recurrence: { ...migrateRecurrence(item.recurrence!), interval: 3, exceptions: { 'local-series:2026-01-06T20:00:00': { patch: { title: 'Special' } } } } }, window).entries[0].input;
    let remote: any; let posts = 0;
    const request = vi.fn(async (_url: any, init: any) => {
      if (init.method === 'POST') {
        posts++;
        remote = { ...JSON.parse(init.body), etag: 'revision-1' };
        throw new Error('response lost');
      }
      if (init.method === 'PATCH' || init.method === 'DELETE') {
        expect(init.headers['If-Match']).toBe('revision-1');
        return new Response(JSON.stringify({ error: { message: 'changed remotely' } }), { status: 412 });
      }
      return new Response(JSON.stringify(String(_url).includes('/events?') ? { items: remote ? [remote] : [] } : remote));
    });
    const client = new GoogleCalendarClient('client', { accessToken: 'token', refreshToken: '', expiresAt: Date.now() + 3600000 }, async () => {}, request);
    await expect(client.create('calendar', input)).rejects.toThrow('response lost');
    const recovered = await client.create('calendar', input);
    expect(posts).toBe(1);
    expect(recovered.projection).toEqual(input.projection);
    expect(remote.recurrence).toEqual([]);
    expect(remote.id).toMatch(/^sd[0-9a-f]{64}$/);
    await expect(client.update('calendar', recovered.id, input)).rejects.toThrow('ETag');
    await expect(client.update('calendar', recovered.id, input, recovered.etag)).rejects.toMatchObject({ status: 412 });
    await expect(client.deleteProjected('calendar', recovered.id, input, recovered.etag!)).rejects.toMatchObject({ status: 412 });
    remote.summary = 'Remote edit';
    await expect(client.create('calendar', input)).rejects.toMatchObject({ code: 'GOOGLE_PROJECTION_CONFLICT' });
    remote.extendedProperties.private.streamDashboardOccurrenceKey = 'other';
    await expect(client.update('calendar', recovered.id, input, recovered.etag)).rejects.toMatchObject({ code: 'GOOGLE_PROJECTION_CONFLICT' });
  });
});

describe('projection window and all-day regressions', () => {
  it('moves occurrences out of January and into February beyond until without changing identity', () => {
    const key = 'local-series:2026-01-06T20:00:00';
    const series = structuredClone(item);
    series.recurrence!.exceptions = { [key]: { patch: { startAtUtc: '2026-02-03T19:00:00Z', endAtUtc: '2026-02-03T20:00:00Z' } } };
    const january = projectGoogleSeries(series, window);
    const february = projectGoogleSeries(series, { from: '2026-02-01', to: '2026-03-01' });
    expect(january.entries).toHaveLength(3);
    expect(january.entries.some(e => e.identity.mode === 'materialized' && e.identity.occurrenceKey === key)).toBe(false);
    expect(february.entries).toHaveLength(1);
    expect(february.entries[0].identity).toEqual({ mode: 'materialized', seriesLocalId: item.localId, occurrenceKey: key });
    expect(february.entries[0].input.startAtUtc).toBe('2026-02-03T19:00:00Z');
    expect(projectGoogleSeries(series, { from: '2026-01-01', to: '2026-03-01' }).entries).toContainEqual(february.entries[0]);
  });

  it('includes future anchors moved backwards, but never invents an anchor beyond until or off cadence', () => {
    const series = structuredClone(item);
    series.recurrence!.until = '2026-02-10T19:00:00Z';
    const patch = { startAtUtc: '2026-01-02T19:00:00Z', endAtUtc: '2026-01-02T20:00:00Z' };
    series.recurrence!.exceptions = {
      'local-series:2026-02-10T20:00:00': { patch }, // inclusive until
      'local-series:2026-02-17T20:00:00': { patch }, // past until
      'local-series:2026-02-09T20:00:00': { patch }, // not a Tuesday
      'local-series:2026-02-03T20:00:00': { cancelled: true, patch },
    };
    const result = projectGoogleSeries(series, { from: '2026-01-02', to: '2026-01-03' });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].identity).toMatchObject({ occurrenceKey: 'local-series:2026-02-10T20:00:00' });
    expect(projectGoogleSeries(series, { from: '2026-02-10', to: '2026-02-11' }).entries).toEqual([]);
  });

  it.each(['daily', 'weekly', 'monthly'] as const)('keeps moved %s occurrences overlapping a window, with no duplicate', frequency => {
    const series = structuredClone(item);
    series.recurrence!.frequency = frequency;
    series.recurrence!.exceptions = { 'local-series:2026-01-06T20:00:00': { patch: { startAtUtc: '2026-02-01T23:00:00Z', endAtUtc: '2026-02-02T01:00:00Z' } } };
    const result = projectGoogleSeries(series, { from: '2026-02-02', to: '2026-02-03' });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].input.endAtUtc).toBe('2026-02-02T01:00:00Z');
  });

  const allDaySeries = (timeZone: string): CalendarItem => ({ ...item, allDay: true,
    startAtUtc: '2026-03-28T00:00:00.000Z', endAtUtc: '2026-03-29T00:00:00.000Z',
    recurrence: { frequency: 'daily', interval: 1, timeZone, until: '2026-04-01T00:00:00Z', exceptions: { 'local-series:2026-03-28T00:00:00': { patch: { title: 'Special' } } } },
  });

  it('rejects the Paris DST fallback without truncating its 23:00 occurrences', async () => {
    const series = allDaySeries('Europe/Paris');
    const bounds = { from: '2026-03-28', to: '2026-04-02' };
    const occurrences = expandRecurringItems([series], bounds);
    const shifted = occurrences.find(o => o.startAtUtc === '2026-03-29T23:00:00.000Z')!;
    expect(shifted).toBeDefined();
    expect(() => projectGoogleSeries(series, bounds)).toThrow('all-day Google non représentable');
    const input = projectGoogleSeries(allDaySeries('UTC'), bounds).entries[0].input;
    const request = vi.fn<typeof fetch>();
    const client = new GoogleCalendarClient('client', { accessToken: 'token', refreshToken: '', expiresAt: Date.now() + 3600000 }, async () => {}, request);
    const invalid = { ...input, startAtUtc: shifted.startAtUtc, endAtUtc: shifted.endAtUtc };
    await expect(client.create('calendar', invalid)).rejects.toMatchObject({ mutationNotStarted: true });
    await expect(client.update('calendar', 'remote', invalid, 'etag')).rejects.toMatchObject({ mutationNotStarted: true });
    expect(request).not.toHaveBeenCalled();
  });

  it.each(['UTC', 'Europe/Paris'])('recovers a lost all-day response for exact DATE ranges (%s)', async timeZone => {
    const bounds = timeZone === 'UTC' ? { from: '2026-03-28', to: '2026-04-02' } : { from: '2026-03-28', to: '2026-03-29' };
    const plan = projectGoogleSeries(allDaySeries(timeZone), bounds);
    expect(plan.mode).toBe('materialized');
    const remotes: any[] = [];
    const request = vi.fn(async (_url: any, init: any) => {
      if (init.method === 'POST') {
        const body = JSON.parse(init.body);
        expect(body.start).toEqual({ date: body.start.date });
        remotes.push({ ...body, etag: 'v1' });
        throw new Error('response lost');
      }
      return Response.json({ items: remotes });
    });
    const client = new GoogleCalendarClient('client', { accessToken: 'token', refreshToken: '', expiresAt: Date.now() + 3600000 }, async () => {}, request);
    for (const { input } of plan.entries) {
      await expect(client.create('calendar', input)).rejects.toThrow('response lost');
      const recovered = await client.create('calendar', input);
      expect(recovered.startAtUtc).toBe(input.startAtUtc);
      expect(recovered.endAtUtc).toBe(input.endAtUtc);
      expect(recovered.projection).toEqual(input.projection);
    }
    expect(remotes).toHaveLength(plan.entries.length);
  });
});
