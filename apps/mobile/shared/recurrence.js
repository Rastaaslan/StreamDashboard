const DEFAULT_ZONE = 'Europe/Paris';
const formatterCache = new Map();

function formatter(zone) {
  if (!formatterCache.has(zone)) formatterCache.set(zone, new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }));
  return formatterCache.get(zone);
}

function parts(at, zone) {
  return Object.fromEntries(formatter(zone).formatToParts(at).filter(value => value.type !== 'literal').map(value => [value.type, Number(value.value)]));
}

function validZone(zone) {
  try { formatter(zone); return zone; } catch { return DEFAULT_ZONE; }
}

/** Converts wall-clock components to UTC, iterating across DST offset changes. */
function wallToUtc(value, zone) {
  const target = Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute, value.second);
  let guess = target;
  for (let index = 0; index < 4; index++) {
    const rendered = parts(new Date(guess), zone);
    const renderedUtc = Date.UTC(rendered.year, rendered.month - 1, rendered.day, rendered.hour, rendered.minute, rendered.second);
    const correction = target - renderedUtc;
    guess += correction;
    if (!correction) break;
  }
  return new Date(guess);
}

const pad = value => String(value).padStart(2, '0');
const localKey = value => `${value.year}-${pad(value.month)}-${pad(value.day)}T${pad(value.hour)}:${pad(value.minute)}:${pad(value.second)}`;
const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

function occurrenceWall(anchor, rule, step) {
  if (rule.frequency === 'weekly') {
    const date = new Date(Date.UTC(anchor.year, anchor.month - 1, anchor.day + step * 7 * rule.interval, anchor.hour, anchor.minute, anchor.second));
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: anchor.hour, minute: anchor.minute, second: anchor.second };
  }
  const absoluteMonth = anchor.year * 12 + anchor.month - 1 + step * rule.interval;
  const year = Math.floor(absoluteMonth / 12); const month = absoluteMonth % 12 + 1;
  return { year, month, day: Math.min(anchor.day, daysInMonth(year, month)), hour: anchor.hour, minute: anchor.minute, second: anchor.second };
}

/** Expands canonical series only inside a finite half-open interval [from,to). */
export function expandRecurringItems(items, { from, to }) {
  const fromMs = +new Date(from); const toMs = +new Date(to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) throw new Error('Fenêtre de récurrence invalide.');
  const output = [];
  for (const source of items || []) {
    const start = Date.parse(source.startAtUtc); const end = Date.parse(source.endAtUtc);
    if (!source.recurrence) {
      if (start < toMs && (Number.isFinite(end) ? end > fromMs : start >= fromMs)) output.push(structuredClone(source));
      continue;
    }
    const rule = source.recurrence; const zone = validZone(rule.timeZone || DEFAULT_ZONE);
    const anchor = parts(new Date(start), zone); const duration = end - start;
    const until = rule.until ? Date.parse(rule.until) : Infinity;
    // The hard cap is defensive only; a finite requested window normally ends first.
    for (let step = 0; step < 20_000; step++) {
      const wall = occurrenceWall(anchor, rule, step); const occurrenceStart = wallToUtc(wall, zone); const occurrenceMs = +occurrenceStart;
      if (occurrenceMs >= toMs || occurrenceMs > until) break;
      const key = `${source.localId || source.id}:${localKey(wall)}`;
      const exception = rule.exceptions?.[key];
      if (!exception?.cancelled && occurrenceMs + duration > fromMs) {
        const item = { ...structuredClone(source), ...structuredClone(exception?.patch || {}), id: `${source.id}::${localKey(wall)}`, seriesId: source.id, occurrenceKey: key, recurrence: structuredClone(rule), startAtUtc: occurrenceStart.toISOString(), endAtUtc: new Date(occurrenceMs + duration).toISOString() };
        if (exception?.patch?.startAtUtc) item.startAtUtc = exception.patch.startAtUtc;
        if (exception?.patch?.endAtUtc) item.endAtUtc = exception.patch.endAtUtc;
        output.push(item);
      }
    }
  }
  return output.sort((left, right) => Date.parse(left.startAtUtc) - Date.parse(right.startAtUtc));
}

export function recurrenceSummary(item, locale = 'fr-FR') {
  if (!item?.recurrence) return '';
  const rule = item.recurrence; const zone = validZone(rule.timeZone || DEFAULT_ZONE);
  const date = new Date(item.startAtUtc);
  const local = parts(date, zone);
  const weekday = new Intl.DateTimeFormat(locale, { timeZone: zone, weekday: 'long' }).format(date);
  const time = new Intl.DateTimeFormat(locale, { timeZone: zone, hour: '2-digit', minute: '2-digit' }).format(date);
  if (rule.frequency === 'monthly') return `↻ Chaque mois · le ${local.day} à ${time}`;
  return rule.interval === 2 ? `↻ Toutes les 2 semaines · ${weekday} ${time}` : `↻ Chaque ${weekday} à ${time}`;
}
