export const DEFAULT_FILTERS = { twitch: true, google: true, allDay: true, live: true, personal: true, production: true };

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

export function weekAgenda(items, filters = DEFAULT_FILTERS, now = new Date()) {
  const { start } = periodBounds('next-week', now); const events = filterPlanning(items, filters, 'next-week', now);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start); date.setDate(date.getDate() + index);
    const next = new Date(date); next.setDate(next.getDate() + 1);
    return { date, events: events.filter(item => Date.parse(item.startAtUtc) >= +date && Date.parse(item.startAtUtc) < +next) };
  });
}
