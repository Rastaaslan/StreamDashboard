export const DEFAULT_FILTERS = { twitch: true, google: true, allDay: true, live: true, personal: true, production: true };
export const TEMPORAL_FILTERS = Object.freeze({ UPCOMING: 'upcoming', PAST: 'past', ALL: 'all' });

export function periodBounds(period, now = new Date()) {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  if (period === 'today') { const end = new Date(start); end.setDate(end.getDate() + 1); return { start: +start, end: +end }; }
  const day = (start.getDay() + 6) % 7; start.setDate(start.getDate() - day + 7);
  const end = new Date(start); end.setDate(end.getDate() + 7); return { start: +start, end: +end };
}

export function filterPlanning(items, filters = DEFAULT_FILTERS, period = null, now = new Date()) {
  const bounds = period ? periodBounds(period, now) : null;
  return [...(items || [])].filter(item => {
    const providerOk = (filters.twitch && (item.source === 'TWITCH' || item.desiredPublication?.twitch))
      || (filters.google && (item.source === 'GOOGLE' || item.desiredPublication?.google))
      || (item.source !== 'TWITCH' && item.source !== 'GOOGLE' && !item.desiredPublication?.twitch && !item.desiredPublication?.google);
    const category = item.category || 'live'; const start = Date.parse(item.startAtUtc);
    return providerOk && (filters.allDay || !item.allDay) && filters[category] && (!bounds || (start >= bounds.start && start < bounds.end));
  }).sort((a, b) => Date.parse(a.startAtUtc) - Date.parse(b.startAtUtc));
}

function localDateKey(value) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function filterPlanningTemporal(items, temporal = TEMPORAL_FILTERS.UPCOMING, now = new Date()) {
  const at = +now;
  const today = localDateKey(now);
  const values = [...(items || [])];
  const isPast = item => {
    if (item.allDay) {
      // Les événements journée entière utilisent une date de fin exclusive
      // (Google Calendar et StreamDashboard). Leur temporalité doit donc être
      // comparée comme une date civile locale, pas comme un instant UTC.
      const exclusiveEndDate = typeof item.endAtUtc === 'string' ? item.endAtUtc.slice(0, 10) : '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(exclusiveEndDate)) return exclusiveEndDate <= today;
    }
    const end = Date.parse(item.endAtUtc);
    return Number.isFinite(end) && end <= at;
  };
  const ascending = (a, b) => Date.parse(a.startAtUtc) - Date.parse(b.startAtUtc);
  const descending = (a, b) => Date.parse(b.startAtUtc) - Date.parse(a.startAtUtc);
  if (temporal === TEMPORAL_FILTERS.PAST) return values.filter(isPast).sort(descending);
  if (temporal === TEMPORAL_FILTERS.ALL) {
    return [
      ...values.filter(item => !isPast(item)).sort(ascending),
      ...values.filter(isPast).sort(descending),
    ];
  }
  return values.filter(item => !isPast(item)).sort(ascending);
}

export function paginatePlanning(items, page = 1, pageSize = 8) {
  const values = [...(items || [])];
  const size = Number.isFinite(Number(pageSize)) ? Math.max(1, Math.floor(Number(pageSize))) : 8;
  const total = values.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const currentPage = Math.min(totalPages, Math.max(1, Math.floor(Number(page) || 1)));
  const start = (currentPage - 1) * size;
  return { items: values.slice(start, start + size), page: currentPage, pageSize: size, total, totalPages };
}

export function weekAgenda(items, filters = DEFAULT_FILTERS, now = new Date()) {
  const { start } = periodBounds('next-week', now); const events = filterPlanning(items, filters, 'next-week', now);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start); date.setDate(date.getDate() + index);
    const next = new Date(date); next.setDate(next.getDate() + 1);
    return { date, events: events.filter(item => Date.parse(item.startAtUtc) >= +date && Date.parse(item.startAtUtc) < +next) };
  });
}
