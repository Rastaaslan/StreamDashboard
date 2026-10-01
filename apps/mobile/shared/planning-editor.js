// Date inputs use the viewer's local calendar, never the UTC date substring.
export function localDate(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function eventTimes(date, start, end, endDate) {
  const first = new Date(`${date}T${start}`);
  const last = new Date(`${endDate || date}T${end}`);
  if (!endDate && last <= first) last.setDate(last.getDate() + 1);
  if (!Number.isFinite(+first) || !Number.isFinite(+last) || last <= first) throw new Error('La fin doit être après le début.');
  return { startAtUtc: first.toISOString(), endAtUtc: last.toISOString() };
}

export function editedRecurrence(previous, value, untilDate) {
  if (!value) return null;
  const [frequency, interval] = value.split('-');
  return {
    ...structuredClone(previous || {}), frequency, interval: Number(interval),
    timeZone: previous?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris',
    until: untilDate ? previous?.until && localDate(previous.until) === untilDate
      ? previous.until : new Date(`${untilDate}T23:59:59`).toISOString() : null,
  };
}
