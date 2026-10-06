const DEFAULT_ZONE = 'Europe/Paris';
/** Lazy, lossless migration: callers persist the returned value on their next write. */
export function migrateRecurrence(rule) {
    if (!rule || ![undefined, 1, 2].includes(rule.version)
        || !['daily', 'weekly', 'monthly'].includes(rule.frequency)
        || !Number.isSafeInteger(rule.interval) || rule.interval < 1
        || (rule.version !== 2 && !(rule.interval === 1 || rule.interval === 2))
        || (rule.custom && (rule.version !== 2 || typeof rule.custom.engine !== 'string' || !rule.custom.engine
            || !Number.isSafeInteger(rule.custom.version) || rule.custom.version < 1
            || !rule.custom.parameters || typeof rule.custom.parameters !== 'object' || Array.isArray(rule.custom.parameters)))) {
        throw new Error('Version ou règle de récurrence non prise en charge.');
    }
    return { ...structuredClone(rule), version: 2 };
}
const formatterCache = new Map();
function formatter(zone) {
    if (!formatterCache.has(zone))
        formatterCache.set(zone, new Intl.DateTimeFormat('en-CA', {
            timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
        }));
    return formatterCache.get(zone);
}
function parts(at, zone) {
    return Object.fromEntries(formatter(zone).formatToParts(at).filter(value => value.type !== 'literal').map(value => [value.type, Number(value.value)]));
}
function validZone(zone) {
    try {
        formatter(zone);
        return zone;
    }
    catch {
        return DEFAULT_ZONE;
    }
}
const DAY = 86400000;
const pad = (value) => String(value).padStart(2, '0');
const wallKey = (v) => `${v.year}-${pad(v.month)}-${pad(v.day)}T${pad(v.hour)}:${pad(v.minute)}:${pad(v.second)}`;
const wallEpoch = (v) => Date.UTC(v.year, v.month - 1, v.day, v.hour, v.minute, v.second);
function instant(value) {
    const result = +new Date(value);
    if (!Number.isFinite(result))
        throw new Error('Invalid recurrence date');
    return result;
}
function bounds(window) {
    const start = instant(window.windowStart), end = instant(window.windowEnd);
    if (end <= start)
        throw new Error('Invalid projection window');
    return [start, end];
}
function clock(zone) {
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    const parts = (at) => Object.fromEntries(formatter.formatToParts(new Date(at)).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
    // Compatible disambiguation: earlier instant in a fold; shift forward by the gap.
    const resolve = (wall) => {
        const target = wallEpoch(wall);
        const offsets = new Set([-2, -1, 0, 1, 2].map(days => {
            const probe = target + days * DAY;
            return wallEpoch(parts(probe)) - probe;
        }));
        const candidates = [...offsets].map(offset => target - offset).sort((a, b) => a - b);
        return candidates.find(at => wallEpoch(parts(at)) === target) ?? Math.max(...candidates);
    };
    return { parts, resolve };
}
/** Indexed wall-clock schedule. Add custom cadence generation here, independently of identity,
 * exception handling, window selection and reconciliation. No UI/provider rules live here. */
function schedule(anchor, rule) {
    if (!['daily', 'weekly', 'monthly'].includes(rule.frequency) || !Number.isSafeInteger(rule.interval) || rule.interval < 1)
        throw new Error('Invalid recurrence cadence');
    const stride = rule.interval * (rule.frequency === 'weekly' ? 7 : 1);
    return (step) => {
        if (rule.frequency === 'monthly') {
            const monthIndex = anchor.year * 12 + anchor.month - 1 + step * stride;
            const year = Math.floor(monthIndex / 12), month = monthIndex % 12 + 1;
            return { ...anchor, year, month, day: Math.min(anchor.day, new Date(Date.UTC(year, month, 0)).getUTCDate()) };
        }
        const date = new Date(wallEpoch(anchor) + step * stride * DAY);
        return { ...anchor, year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
    };
}
/** Pure projection of a canonical recurring master. Effective ranges overlap [start,end).
 * nextCount selects the earliest effective future slots instead of an end date.
 * until is inclusive on the ORIGINAL start, before exceptions; duration is elapsed UTC time. */
export function projectRecurrence(source, window) {
    if (source.deletionPending) return [];
    const counted = window.nextCount !== undefined;
    if (counted && (!Number.isSafeInteger(window.nextCount) || window.nextCount < 1 || window.nextCount > 10000))
        throw new Error('Invalid nextCount (1–10000 required)');
    const [from, to] = counted ? [instant(window.windowStart), Infinity] : bounds(window);
    if (!source.recurrence || source.occurrenceKey)
        throw new Error('Expected a canonical recurring master');
    const rule = migrateRecurrence(source.recurrence);
    if (rule.custom)
        throw new Error('Moteur de récurrence requis : ' + rule.custom.engine);
    const start = instant(source.startAtUtc), duration = instant(source.endAtUtc) - start;
    if (duration <= 0)
        throw new Error('Invalid recurrence duration');
    const until = rule.until == null ? Infinity : instant(rule.until);
    const { parts, resolve } = clock(rule.timeZone || 'Europe/Paris');
    const anchor = parts(start), at = schedule(anchor, rule);
    const seriesId = source.localId || source.id;
    if (!seriesId)
        throw new Error('Missing series identity');
    const key = (wall) => `${seriesId}:${wallKey(wall)}`;
    // Seek directly, avoiding a historical iteration cap (even for decades-old series).
    const seek = (target) => {
        let low = 0, high = 1;
        while (resolve(at(high)) < target)
            high *= 2;
        while (low < high) {
            const mid = Math.floor((low + high) / 2);
            if (resolve(at(mid)) < target)
                low = mid + 1;
            else
                high = mid;
        }
        return low;
    };
    const candidates = new Map();
    // Moved exceptions can enter the window from either side of the nominal range.
    for (const exceptionKey of Object.keys(rule.exceptions ?? {})) {
        const prefix = `${seriesId}:`;
        if (!exceptionKey.startsWith(prefix))
            continue;
        const local = exceptionKey.slice(prefix.length);
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(local))
            continue;
        const target = Date.parse(`${local}Z`);
        if (!Number.isFinite(target))
            continue;
        // Seek using wall time so a gap-shifted occurrence retains its nominal key.
        let low = 0, high = 1;
        while (wallEpoch(at(high)) < target)
            high *= 2;
        while (low < high) {
            const mid = Math.floor((low + high) / 2);
            if (wallEpoch(at(mid)) < target)
                low = mid + 1;
            else
                high = mid;
        }
        const wall = at(low);
        if (key(wall) === exceptionKey && resolve(wall) <= until)
            candidates.set(exceptionKey, wall);
    }
    const output = new Map();
    const add = (occurrenceKey, wall) => {
        const exception = rule.exceptions?.[occurrenceKey];
        if (exception?.cancelled)
            return;
        const original = resolve(wall);
        const item = {
            ...structuredClone(source), ...structuredClone(exception?.patch ?? {}),
            id: `${source.id}::${wallKey(wall)}`, seriesId: source.id, occurrenceKey, recurrence: structuredClone(source.recurrence),
            startAtUtc: exception?.patch?.startAtUtc ?? new Date(original).toISOString(),
            endAtUtc: exception?.patch?.endAtUtc ?? new Date(original + duration).toISOString(),
        };
        const effectiveStart = instant(item.startAtUtc), effectiveEnd = instant(item.endAtUtc);
        if (effectiveEnd <= effectiveStart)
            throw new Error('Invalid occurrence duration');
        if (effectiveStart < to && effectiveEnd > from && (!window.accept || window.accept(item)))
            output.set(occurrenceKey, item);
    };
    for (const [occurrenceKey, wall] of candidates) add(occurrenceKey, wall);
    const sorted = () => [...output.values()].sort((a, b) => instant(a.startAtUtc) - instant(b.startAtUtc) || (a.occurrenceKey < b.occurrenceKey ? -1 : a.occurrenceKey > b.occurrenceKey ? 1 : 0));
    let scanned = 0;
    for (let step = seek(from - duration - 2 * DAY);; step++) {
        if (++scanned > 100000) throw new Error('Recurrence scan limit exceeded');
        const wall = at(step), original = resolve(wall);
        if (!Number.isFinite(original)) throw new Error('Invalid recurrence cadence range');
        if (original >= to || original > until) break;
        // All exceptions were considered first; later nominal slots cannot precede
        // the last selected effective start, even when an exception moved far away.
        if (counted && output.size >= window.nextCount && original > instant(sorted()[window.nextCount - 1].startAtUtc)) break;
        add(key(wall), wall);
    }
    return counted ? sorted().slice(0, window.nextCount) : sorted();
}
export function expandRecurringItems(items, { from, to, nextCount, accept }) {
    const [start, end] = nextCount === undefined ? bounds({ windowStart: from, windowEnd: to }) : [instant(from), Infinity];
    return (items || []).flatMap(item => item.deletionPending ? [structuredClone(item)] : item.recurrence && !item.occurrenceKey
        ? projectRecurrence(item, { windowStart: from, windowEnd: to, nextCount, accept })
        : Date.parse(item.startAtUtc) < end && (Number.isFinite(Date.parse(item.endAtUtc)) ? Date.parse(item.endAtUtc) > start : Date.parse(item.startAtUtc) >= start) ? [structuredClone(item)] : [])
        .sort((a, b) => Date.parse(a.startAtUtc) - Date.parse(b.startAtUtc));
}
export function recurrenceSummary(item, locale = 'fr-FR') {
    if (!item?.recurrence)
        return '';
    const rule = item.recurrence;
    const zone = validZone(rule.timeZone || DEFAULT_ZONE);
    const date = new Date(item.startAtUtc);
    const local = parts(date, zone);
    const weekday = new Intl.DateTimeFormat(locale, { timeZone: zone, weekday: 'long' }).format(date);
    const time = new Intl.DateTimeFormat(locale, { timeZone: zone, hour: '2-digit', minute: '2-digit' }).format(date);
    if (rule.custom)
        return `↻ Récurrence personnalisée · ${time}`;
    if (rule.frequency === 'daily')
        return rule.interval === 1 ? `↻ Tous les jours · ${time}` : `↻ Tous les ${rule.interval} jours · ${time}`;
    if (rule.frequency === 'monthly')
        return rule.interval === 1 ? `↻ Chaque mois · le ${local.day} à ${time}` : `↻ Tous les ${rule.interval} mois · le ${local.day} à ${time}`;
    return rule.interval > 1 ? `↻ Toutes les ${rule.interval} semaines · ${weekday} ${time}` : `↻ Chaque ${weekday} à ${time}`;
}
