import { describe, expect, it, vi } from 'vitest';
import { GoogleCalendarClient } from '../integrations/google-calendar/src/client.js';
import { googleRecurrence } from '../integrations/google-calendar/src/recurrence.js';
import { PlanningOrchestrator } from '../packages/core/src/planning.js';
import type { CalendarItem, RecurrenceRule } from '../packages/contracts/src/index.js';

const item = (rule?: Partial<RecurrenceRule>): CalendarItem => ({
  id: 'local', localId: 'local', title: 'Series', startAtUtc: '2026-03-17T19:00:00.000Z', endAtUtc: '2026-03-17T20:00:00.000Z',
  desiredPublication: { local: true, google: true, twitch: false },
  recurrence: { frequency: 'weekly', interval: 1, timeZone: 'Europe/Paris', ...rule },
});
const input = (rule?: Partial<RecurrenceRule>) => ({ ...item(rule), localId: 'local' });
const remote = (body: Record<string, unknown> = {}) => ({ id: 'master', etag: 'v2', start: { dateTime: input().startAtUtc }, end: { dateTime: input().endAtUtc }, extendedProperties: { private: { streamDashboardManaged: 'true', streamDashboardId: 'local' } }, ...body });
function client(request: typeof fetch) { return new GoogleCalendarClient('client', { accessToken: 'access', refreshToken: 'refresh', expiresAt: Date.now() + 3600000 }, async () => {}, request); }

describe('Google RRULE', () => {
  it.each([
    ['daily', 1, 'RRULE:FREQ=DAILY;INTERVAL=1'],
    ['weekly', 1, 'RRULE:FREQ=WEEKLY;INTERVAL=1'],
    ['weekly', 2, 'RRULE:FREQ=WEEKLY;INTERVAL=2'],
    ['monthly', 1, 'RRULE:FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=17'],
  ] as const)('serializes %s/%s and inclusive UTC until', (frequency, interval, expected) => {
    expect(googleRecurrence(item({ frequency, interval, until: '2026-04-17T21:00:00+02:00' }))).toEqual([expected + ';UNTIL=20260417T190000Z']);
  });
  it.each([29, 30, 31])('clamps monthly day %s to the last valid day', day => {
    const value = item({ frequency: 'monthly' }); value.startAtUtc = `2026-01-${day}T19:00:00Z`;
    const candidates = Array.from({ length: 32 - day }, (_, index) => day + index).join(',');
    expect(googleRecurrence(value)).toEqual([`RRULE:FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=${candidates},-1;BYSETPOS=1`]);
  });
  it('uses timezone-local monthly anchor and DATE until for all-day', () => {
    const value = item({ frequency: 'monthly', timeZone: 'Asia/Tokyo', until: '2026-05-01T00:00:00Z' });
    value.startAtUtc = '2026-01-31T23:00:00Z';
    expect(googleRecurrence(value)[0]).toContain('BYMONTHDAY=1');
    value.allDay = true;
    expect(() => googleRecurrence(value)).toThrow(/all-day/);
  });
  it('sends timezone on both endpoints, identity, RRULE and If-Match', async () => {
    const request = vi.fn<typeof fetch>(async (_url, init) => init?.method === 'PATCH' ? Response.json(remote(JSON.parse(String(init.body)))) : Response.json({ items: [] }));
    await client(request).update('calendar', 'master', input(), 'v1');
    const init = request.mock.calls[1][1]!; const body = JSON.parse(String(init.body));
    expect(init.method).toBe('PATCH'); expect(init.headers).toMatchObject({ 'If-Match': 'v1' });
    expect(body.start).toEqual({ dateTime: input().startAtUtc, timeZone: 'Europe/Paris' });
    expect(body.end.timeZone).toBe('Europe/Paris');
    expect(body.recurrence).toEqual(['RRULE:FREQ=WEEKLY;INTERVAL=1']);
    expect(body.extendedProperties.private.streamDashboardId).toBe('local');
  });
  it.each([{ cancelled: true }, { patch: { title: 'Moved' } }])('rejects exceptions before any request, including create recovery', async exception => {
    const request = vi.fn<typeof fetch>(); const api = client(request);
    const value = input({ exceptions: { occurrence: exception } });
    await expect(api.create('calendar', value)).rejects.toMatchObject({ mutationNotStarted: true });
    await expect(api.update('calendar', 'master', value, 'v1')).rejects.toThrow(/exceptions/);
    expect(request).not.toHaveBeenCalled();
  });
  it.each([{ timeZone: 'Invalid/Zone' }, { frequency: 'daily', interval: 2 }, { until: 'invalid' }] as Partial<RecurrenceRule>[])('rejects invalid rules before mutation', async rule => {
    const request = vi.fn<typeof fetch>();
    await expect(client(request).create('calendar', input(rule))).rejects.toMatchObject({ mutationNotStarted: true });
    expect(request).not.toHaveBeenCalled();
  });
  it('recovers the master identity on retry without POST', async () => {
    const request = vi.fn<typeof fetch>(async () => Response.json({ items: [remote({ recurrence: ['RRULE:FREQ=WEEKLY;INTERVAL=1'], start: { dateTime: input().startAtUtc, timeZone: 'Europe/Paris' } })] }));
    expect((await client(request).create('calendar', input())).id).toBe('master');
    expect(request).toHaveBeenCalledTimes(1);
    expect(String(request.mock.calls[0][0])).toContain('singleEvents=false');
  });
  it('refuses recovery of a different recurrence instead of reporting a false success', async () => {
    const request = vi.fn<typeof fetch>(async () => Response.json({ items: [remote()] }));
    await expect(client(request).create('calendar', input())).rejects.toMatchObject({ mutationNotStarted: true });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1]?.method).toBeUndefined();
  });
  it('collapses managed expanded instances to their master for reconciliation', async () => {
    const request = vi.fn<typeof fetch>(async url => String(url).includes('singleEvents=false')
      ? Response.json({ items: [remote({ recurrence: ['RRULE:FREQ=WEEKLY;INTERVAL=1'] })] })
      : String(url).includes('/events?')
      ? Response.json({ items: [remote({ id: 'instance1', recurringEventId: 'master' }), remote({ id: 'instance2', recurringEventId: 'master' })] })
      : Response.json(remote({ recurrence: ['RRULE:FREQ=WEEKLY;INTERVAL=1'] })));
    const events = await client(request).events('calendar');
    expect(events.map(event => event.id)).toEqual(['master']);
    expect(events[0].recurrenceLines).toEqual(['RRULE:FREQ=WEEKLY;INTERVAL=1']);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it.each([false, true])('preserves simple/all-day payloads and clears old recurrence (allDay=%s)', async allDay => {
    const request = vi.fn<typeof fetch>(async (_url, init) => init?.method === 'PATCH' ? Response.json(remote(JSON.parse(String(init.body)))) : Response.json({ items: [] }));
    const value = { ...input(), recurrence: undefined, allDay };
    await client(request).update('calendar', 'master', value, 'v1');
    const body = JSON.parse(String(request.mock.calls[1][1]?.body));
    expect(body.start).toEqual(allDay ? { date: '2026-03-17' } : { dateTime: value.startAtUtc });
    expect(body.recurrence).toEqual([]);
  });
  it('preserves 412 conflicts and conditional delete', async () => {
    const request = vi.fn<typeof fetch>(async (_url, init) => init?.method
      ? Response.json({ error: { message: 'conflict' } }, { status: 412 })
      : Response.json({ items: [] }));
    const api = client(request);
    await expect(api.update('calendar', 'master', input(), 'v1')).rejects.toMatchObject({ status: 412 });
    await expect(api.delete('calendar', 'master', 'v1')).rejects.toMatchObject({ status: 412 });
    expect(request.mock.calls[1][1]).toMatchObject({ method: 'PATCH', headers: { 'If-Match': 'v1' } });
    expect(request.mock.calls[2][1]).toMatchObject({ method: 'DELETE', headers: { 'If-Match': 'v1' } });
  });
  it('orchestrates create/update/retry/delete while retaining identity and revisions', async () => {
    const provider = { create: vi.fn(async () => ({ id: 'master', revision: 'v1' })), update: vi.fn(async () => ({ revision: 'v2' })), delete: vi.fn(async () => {}) };
    const planning = new PlanningOrchestrator([], { google: provider }, async () => {});
    await planning.create(item());
    await planning.update('local', { ...item(), title: 'Changed' });
    await planning.retry('local', 'google');
    expect(provider.create).toHaveBeenCalledTimes(1);
    expect(provider.update.mock.calls[1]).toEqual(['master', expect.anything(), 'v2']);
    await planning.remove('local', { google: true, local: true });
    expect(provider.delete).toHaveBeenCalledWith('master', expect.anything(), 'v2');
    expect(planning.all()).toEqual([]);
  });
  it('retains local exceptions and refuses both initial publish and retry', async () => {
    const provider = { create: vi.fn(), update: vi.fn(), delete: vi.fn() };
    const planning = new PlanningOrchestrator([], { google: provider }, async () => {});
    const value = item({ exceptions: { occurrence: { cancelled: true } } });
    const created = await planning.create(value);
    expect(created.providers?.google?.status).toBe('error');
    await expect(planning.retry('local', 'google')).rejects.toThrow(/récurrence/);
    expect(planning.all()[0].recurrence).toEqual(value.recurrence);
    expect(provider.create).not.toHaveBeenCalled();
  });
});
