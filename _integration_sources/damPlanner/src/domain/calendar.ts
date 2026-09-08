import { DateTime } from 'luxon';
import type { EventPublication, PlannerEvent } from './models.js';
import type { RemoteSlot } from '../providers/contracts.js';

export type CalendarSource = 'DAMPLANNER' | 'GOOGLE' | 'TWITCH';

export interface CalendarItem {
  id: string;
  source: CalendarSource;
  ownership: 'LOCAL' | 'EXTERNAL';
  title: string;
  description?: string;
  startAtUtc: string;
  endAtUtc: string;
  allDay: boolean;
  editable: boolean;
  color?: string;
  localEventId?: string;
  externalId?: string;
  calendarId?: string;
  calendarName?: string;
  kind?: 'LIVE' | 'PERSONAL';
  draft?: boolean;
  lifecycleState?: PlannerEvent['lifecycleState'];
  actualStartAt?: string | null;
  actualEndAt?: string | null;
  google?: EventPublication;
  twitch?: EventPublication;
  metadata?: Record<string, string | undefined>;
}

export interface PlannerRow {
  event: PlannerEvent;
  google?: EventPublication;
  twitch?: EventPublication;
}

export function mergeCalendarItems(rows: PlannerRow[], google: RemoteSlot[], twitch: RemoteSlot[]): CalendarItem[] {
  const googleIds = new Set(rows.flatMap(row => row.google?.externalId
    ? [row.google.externalId, row.google.externalId.split('|').at(-1)!]
    : []));
  const twitchIds = new Set(rows.flatMap(row => row.twitch?.externalId ? [row.twitch.externalId] : []));
  const localIds = new Set(rows.map(row => row.event.id));

  const local = rows.map(({ event, google: googlePublication, twitch: twitchPublication }): CalendarItem => ({
    id: `local:${event.id}`,
    source: 'DAMPLANNER',
    ownership: 'LOCAL',
    title: event.title,
    description: event.description,
    startAtUtc: event.startAtUtc,
    endAtUtc: event.endAtUtc,
    allDay: false,
    editable: true,
    localEventId: event.id,
    kind: event.kind,
    draft: event.status === 'DRAFT',
    lifecycleState: event.lifecycleState,
    actualStartAt: event.actualStartAt,
    actualEndAt: event.actualEndAt,
    google: googlePublication,
    twitch: twitchPublication,
    metadata: {
      checklist: `${event.checklist?.filter(item => item.done).length ?? 0}/${event.checklist?.length ?? 0}`,
      conflictAccepted: event.conflictOverrideHash ? 'true' : undefined,
    },
  }));

  const remoteGoogle = google
    .filter(slot => !slot.damplannerEventId || !localIds.has(slot.damplannerEventId))
    .filter(slot => !googleIds.has(slot.id) && !googleIds.has(`${slot.calendarId}|${slot.id}`))
    .map((slot): CalendarItem => ({
      id: `google:${slot.calendarId ?? 'primary'}:${slot.id}`,
      source: 'GOOGLE',
      ownership: 'EXTERNAL',
      title: slot.title,
      description: slot.description,
      startAtUtc: slot.startAtUtc,
      endAtUtc: slot.endAtUtc,
      allDay: Boolean(slot.allDay),
      editable: false,
      externalId: slot.id,
      calendarId: slot.calendarId,
      calendarName: slot.calendarName,
      color: slot.color,
      metadata: { recurringEventId: slot.recurringEventId },
    }));

  const remoteTwitch = twitch
    .filter(slot => !twitchIds.has(slot.id))
    .map((slot): CalendarItem => ({
      id: `twitch:${slot.id}`,
      source: 'TWITCH',
      ownership: 'EXTERNAL',
      title: slot.title,
      startAtUtc: slot.startAtUtc,
      endAtUtc: slot.endAtUtc,
      allDay: false,
      editable: false,
      externalId: slot.id,
      color: '#9146ff',
      metadata: { categoryId: slot.categoryId, categoryName: slot.categoryName },
    }));

  return [...local, ...remoteGoogle, ...remoteTwitch].sort((a, b) => a.startAtUtc.localeCompare(b.startAtUtc));
}

export function freeSlots(
  items: CalendarItem[],
  day: string,
  zone: string,
  minMinutes = 30,
  buffers = { before: 0, after: 0 },
) {
  const start = DateTime.fromISO(day, { zone }).startOf('day');
  const end = start.plus({ days: 1 });
  const busy = items
    .filter(item => item.endAtUtc > start.toUTC().toISO()! && item.startAtUtc < end.toUTC().toISO()!)
    .map(item => ({
      start: Math.max(start.toMillis(), DateTime.fromISO(item.startAtUtc).minus({ minutes: buffers.before }).toMillis()),
      end: Math.min(end.toMillis(), DateTime.fromISO(item.endAtUtc).plus({ minutes: buffers.after }).toMillis()),
    }))
    .sort((a, b) => a.start - b.start);

  const merged: { start: number; end: number }[] = [];
  for (const slot of busy) {
    const last = merged.at(-1);
    if (last && slot.start <= last.end) last.end = Math.max(last.end, slot.end);
    else merged.push({ ...slot });
  }

  const result: { startAtUtc: string; endAtUtc: string; minutes: number }[] = [];
  let cursor = start.toMillis();
  for (const slot of merged) {
    if (slot.start - cursor >= minMinutes * 60_000) {
      result.push({
        startAtUtc: DateTime.fromMillis(cursor).toUTC().toISO()!,
        endAtUtc: DateTime.fromMillis(slot.start).toUTC().toISO()!,
        minutes: (slot.start - cursor) / 60_000,
      });
    }
    cursor = Math.max(cursor, slot.end);
  }
  if (end.toMillis() - cursor >= minMinutes * 60_000) {
    result.push({
      startAtUtc: DateTime.fromMillis(cursor).toUTC().toISO()!,
      endAtUtc: end.toUTC().toISO()!,
      minutes: (end.toMillis() - cursor) / 60_000,
    });
  }
  return result;
}

export function bufferWarning(
  candidate: Pick<PlannerEvent, 'startAtUtc' | 'endAtUtc' | 'kind'>,
  items: CalendarItem[],
  before: number,
  after: number,
) {
  const ordered = [...items].sort((a, b) => a.startAtUtc.localeCompare(b.startAtUtc));
  const previous = ordered.filter(item => item.endAtUtc <= candidate.startAtUtc).at(-1);
  const next = ordered.find(item => item.startAtUtc >= candidate.endAtUtc);
  const warnings: string[] = [];
  if (previous) {
    const actual = (Date.parse(candidate.startAtUtc) - Date.parse(previous.endAtUtc)) / 60_000;
    if (actual < before) warnings.push(`Seulement ${Math.max(0, actual)} min avant cet événement, ${before} min recommandées.`);
  }
  if (next) {
    const actual = (Date.parse(next.startAtUtc) - Date.parse(candidate.endAtUtc)) / 60_000;
    if (actual < after) warnings.push(`Seulement ${Math.max(0, actual)} min après cet événement, ${after} min recommandées.`);
  }
  return warnings;
}

export class TimedCache<T> {
  private value?: { data: T; fetchedAt: number };
  constructor(private ttlMs = 5 * 60_000) {}
  get(now = Date.now()) { return this.value && now - this.value.fetchedAt < this.ttlMs ? this.value : undefined; }
  stale() { return this.value; }
  set(data: T, now = Date.now()) { this.value = { data, fetchedAt: now }; return this.value; }
  clear() { this.value = undefined; }
}

export function expandRecurrence(event: PlannerEvent, rangeStart: string, rangeEnd: string) {
  if (!event.recurrence) return [event];
  const rule = event.recurrence;
  const result: PlannerEvent[] = [];
  const duration = Date.parse(event.endAtUtc) - Date.parse(event.startAtUtc);
  const first = DateTime.fromISO(event.startAtUtc).setZone(event.timezone);
  const firstWeek = first.startOf('week');
  let cursor = first;
  let occurrences = 0;

  while (cursor.toUTC().toISO()! < rangeEnd && occurrences < (rule.count ?? 500)) {
    const daysFromStart = Math.floor(cursor.startOf('day').diff(first.startOf('day'), 'days').days);
    const weeksFromStart = Math.floor(cursor.startOf('week').diff(firstWeek, 'weeks').weeks);
    const dailyMatch = rule.frequency === 'DAILY' && daysFromStart % rule.interval === 0;
    const weeklyMatch = rule.frequency === 'WEEKLY'
      && weeksFromStart % rule.interval === 0
      && (rule.weekdays?.length ? rule.weekdays.includes(cursor.weekday) : cursor.weekday === first.weekday);
    if (dailyMatch || weeklyMatch) {
      const iso = cursor.toUTC().toISO()!;
      if (!rule.until || iso <= rule.until) {
        occurrences += 1;
        if (iso >= rangeStart) {
          result.push({
            ...event,
            id: `${event.id}:${iso}`,
            startAtUtc: iso,
            endAtUtc: cursor.plus({ milliseconds: duration }).toUTC().toISO()!,
          });
        }
      }
    }
    if (rule.until && cursor.toUTC().toISO()! > rule.until) break;
    cursor = cursor.plus({ days: 1 });
  }
  return result;
}

export function parseIcs(text: string, zone = 'UTC') {
  if (text.length > 2_000_000) throw new Error('Fichier ICS trop volumineux');
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const blocks = [...unfolded.matchAll(/BEGIN:VEVENT\r?\n([\s\S]*?)\r?\nEND:VEVENT/g)].slice(0, 1000);
  return blocks.flatMap((match, index) => {
    const lines = match[1]!.split(/\r?\n/);
    const value = (name: string) => lines.find(line => line.startsWith(name))?.split(':').slice(1).join(':');
    const rawStart = value('DTSTART');
    const rawEnd = value('DTEND');
    const title = (value('SUMMARY') ?? 'Événement importé').replace(/\\([,;nN\\])/g, (_, token: string) => token.toLowerCase() === 'n' ? '\n' : token);
    if (!rawStart || !rawEnd) return [];
    const parse = (raw: string) => /^\d{8}$/.test(raw)
      ? DateTime.fromFormat(raw, 'yyyyLLdd', { zone })
      : DateTime.fromFormat(raw.replace(/Z$/, ''), "yyyyLLdd'T'HHmmss", { zone: raw.endsWith('Z') ? 'UTC' : zone });
    const start = parse(rawStart);
    const end = parse(rawEnd);
    if (!start.isValid || !end.isValid || end <= start) return [];
    return [{
      id: value('UID') ?? `ics-${index}`,
      title,
      startAtUtc: start.toUTC().toISO()!,
      endAtUtc: end.toUTC().toISO()!,
      allDay: /^\d{8}$/.test(rawStart),
    }];
  });
}
