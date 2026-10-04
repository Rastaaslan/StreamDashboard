import type { CalendarItem } from '../../../packages/contracts/src/index.js';

/** Recover only rules whose round trip through the local model is lossless.
 * Unknown RRULE clauses must never become an editable, non-recurring event.
 */
export function parseGoogleRecurrence(input: Pick<CalendarItem, 'startAtUtc' | 'allDay'> & {
  recurrenceLines?: string[]; recurrenceTimeZone?: string;
}): CalendarItem['recurrence'] {
  const lines = input.recurrenceLines ?? [];
  if (!lines.length) return undefined;
  const refuse = (): never => { throw Object.assign(new Error('Récurrence Google non représentable : import de la série refusé pour préserver ses occurrences.'), { mutationNotStarted: true }); };
  if (lines.length !== 1 || typeof lines[0] !== 'string' || !lines[0].startsWith('RRULE:')) return refuse();
  const parts: Record<string, string> = Object.create(null);
  for (const clause of lines[0].slice(6).split(';')) {
    const pair = clause.split('=');
    if (pair.length !== 2 || !pair[1] || Object.hasOwn(parts, pair[0])) return refuse();
    parts[pair[0]] = pair[1];
  }
  parts.INTERVAL ??= '1';
  const timeZone = input.allDay ? 'UTC' : input.recurrenceTimeZone;
  if (!timeZone) return refuse();
  let until: string | undefined;
  if (parts.UNTIL) {
    const raw = parts.UNTIL;
    if (!(input.allDay ? /^\d{8}$/ : /^\d{8}T\d{6}Z$/).test(raw)) return refuse();
    until = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${input.allDay ? '00:00:00' : `${raw.slice(9, 11)}:${raw.slice(11, 13)}:${raw.slice(13, 15)}`}Z`;
  }
  const rule = { frequency: parts.FREQ?.toLowerCase(), interval: Number(parts.INTERVAL), timeZone, ...(until ? { until } : {}) } as NonNullable<CalendarItem['recurrence']>;
  const canonical = googleRecurrence({ ...input, recurrence: rule })[0].slice(6).split(';').sort();
  if (JSON.stringify(canonical) !== JSON.stringify(Object.entries(parts).map(([key, value]) => `${key}=${value}`).sort())) return refuse();
  return rule;
}

/** Google uses the event's start/end timezone, and a UTC UNTIL for timed series. */
export function googleRecurrence(input: Pick<CalendarItem, 'recurrence' | 'startAtUtc' | 'allDay' | 'seriesId' | 'occurrenceKey'>): string[] {
  const refuse = (message: string): never => {
    throw Object.assign(new Error(`Récurrence Google non représentable : ${message}`), { mutationNotStarted: true });
  };
  if (input.seriesId || input.occurrenceKey) refuse('publiez la série, pas une occurrence virtuelle.');
  const rule = input.recurrence;
  if (!rule) return [];
  if (Object.keys(rule.exceptions ?? {}).length) refuse('les exceptions doivent être conservées localement ; aucune mutation Google effectuée.');
  if (!(['daily', 'weekly', 'monthly'].includes(rule.frequency)) || !(rule.interval === 1 || (rule.frequency === 'weekly' && rule.interval === 2))) refuse('cadence non prise en charge.');
  let formatter: Intl.DateTimeFormat;
  try { formatter = new Intl.DateTimeFormat('en-CA', { timeZone: rule.timeZone, day: 'numeric' }); }
  catch { return refuse('fuseau horaire invalide.'); }
  if (!rule.timeZone || !Number.isFinite(Date.parse(input.startAtUtc))) refuse('ancre ou fuseau horaire invalide.');
  // The canonical engine advances wall-clock instants even for all-day items.
  // DATE RRULEs cannot encode resulting UTC date shifts or time-based UNTIL cuts.
  // Only UTC midnight anchors are guaranteed faithful for an unbounded series.
  if (input.allDay && (formatter!.resolvedOptions().timeZone !== 'UTC'
    || new Date(input.startAtUtc).toISOString().slice(11) !== '00:00:00.000Z')) {
    refuse('une série all-day exige une ancre à minuit UTC et un fuseau UTC ; les autres fuseaux peuvent décaler les dates et la borne until.');
  }
  const parts = [`FREQ=${rule.frequency.toUpperCase()}`, `INTERVAL=${rule.interval}`];
  if (rule.frequency === 'monthly') {
    const day = Number(formatter!.format(new Date(input.startAtUtc)));
    // The local model clamps 29–31 to the last valid day, rather than skipping months.
    parts.push(`BYMONTHDAY=${day > 28 ? Array.from({ length: 32 - day }, (_, index) => day + index).join(',') + ',-1' : day}`);
    if (day > 28) parts.push('BYSETPOS=1');
  }
  if (rule.until) {
    const until = new Date(rule.until);
    if (!Number.isFinite(+until) || +until < Date.parse(input.startAtUtc)) refuse('fin invalide ou antérieure à la série.');
    parts.push(`UNTIL=${input.allDay ? until.toISOString().slice(0, 10).replaceAll('-', '') : until.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`);
  }
  return [`RRULE:${parts.join(';')}`];
}
