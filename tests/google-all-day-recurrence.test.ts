import { expect, it, vi } from 'vitest';
import { expandRecurringItems } from '../packages/core/src/recurrence.js';
import { googleRecurrence } from '../integrations/google-calendar/src/recurrence.js';
import { GoogleCalendarClient } from '../integrations/google-calendar/src/client.js';
import type { CalendarItem, RecurrenceRule } from '../packages/contracts/src/index.js';

function series(start: string, rule: Partial<RecurrenceRule>): CalendarItem & { localId: string } {
  return { id: 'local', localId: 'local', title: 'All-day', allDay: true, startAtUtc: start,
    endAtUtc: new Date(Date.parse(start) + 86400000).toISOString(),
    recurrence: { frequency: 'monthly', interval: 1, timeZone: 'UTC', ...rule } };
}
const canonicalDates = (value: CalendarItem) => expandRecurringItems([value], { from: value.startAtUtc, to: '2026-05-01' }).map(item => item.startAtUtc.slice(0, 10));

// Enumerate DATE RRULE candidates independently of the canonical instant engine.
function googleDates(start: string, rrule: string) {
  const parts: Record<string, string> = Object.fromEntries(rrule.slice(6).split(';').map(part => part.split('=')));
  const dates: string[] = [];
  const anchor = new Date(start); const cursor = new Date(start);
  while (cursor.toISOString().slice(0, 10).replaceAll('-', '') <= parts.UNTIL) {
    const day = cursor.getUTCDate();
    const last = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0)).getUTCDate();
    const monthDays = (parts.BYMONTHDAY ?? '').split(',').map(Number).map(value => value === -1 ? last : value).filter(value => value > 0 && value <= last).sort((a, b) => a - b);
    const elapsed = (+cursor - +anchor) / 86400000;
    const matches = parts.FREQ === 'DAILY' || parts.FREQ === 'WEEKLY' && elapsed % (7 * Number(parts.INTERVAL)) === 0
      || parts.FREQ === 'MONTHLY' && (parts.BYSETPOS === '1' ? day === monthDays[0] : monthDays.includes(day));
    if (matches) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(day + 1);
  }
  return dates;
}

it.each([
  ['monthly', 1, '2026-01-31T00:00:00Z', '2026-03-31T00:00:00Z'],
  ['monthly', 1, '2026-01-31T00:00:00Z', '2026-03-30T23:59:59Z'],
  ['daily', 1, '2026-03-27T00:00:00Z', '2026-03-30T00:00:00Z'],
  ['daily', 1, '2026-03-27T00:00:00Z', '2026-03-29T23:59:59Z'],
  ['weekly', 1, '2026-03-15T00:00:00Z', '2026-04-05T00:00:00Z'],
  ['weekly', 2, '2026-03-15T00:00:00Z', '2026-04-12T00:00:00Z'],
] as const)('matches canonical UTC all-day dates: %s/%s from %s until %s', (frequency, interval, start, until) => {
  const value = series(start, { frequency, interval, until });
  expect(googleDates(start, googleRecurrence(value)[0])).toEqual(canonicalDates(value));
});

it.each([
  ['monthly', '2026-01-31T00:00:00Z', '2026-04-02T00:00:00Z', ['2026-01-31', '2026-03-01', '2026-03-30']],
  ['daily', '2026-03-07T00:00:00Z', '2026-03-11T00:00:00Z', ['2026-03-07', '2026-03-08', '2026-03-08', '2026-03-09', '2026-03-10']],
  ['daily', '2026-03-07T00:00:00Z', '2026-03-08T23:30:00Z', ['2026-03-07', '2026-03-08', '2026-03-08']],
] as const)('refuses unrepresentable LA dates before create/update: %s, %s, %s', async (frequency, start, until, dates) => {
  const value = series(start, { frequency, until, timeZone: 'America/Los_Angeles' });
  expect(canonicalDates(value)).toEqual(dates);
  const request = vi.fn<typeof fetch>();
  const api = new GoogleCalendarClient('client', { accessToken: 'token', refreshToken: 'refresh', expiresAt: Date.now() + 3600000 }, async () => {}, request);
  await expect(api.create('calendar', value)).rejects.toMatchObject({ mutationNotStarted: true });
  await expect(api.update('calendar', 'master', value, 'v1')).rejects.toThrow(/all-day/);
  expect(request).not.toHaveBeenCalled();
});

it('refuses non-midnight UTC anchors whose DATE until would include an extra occurrence', () => {
  const value = series('2026-03-27T23:00:00Z', { frequency: 'daily', until: '2026-03-29T12:00:00Z' });
  expect(canonicalDates(value)).toEqual(['2026-03-27', '2026-03-28']);
  expect(() => googleRecurrence(value)).toThrow(/minuit UTC/);
});
