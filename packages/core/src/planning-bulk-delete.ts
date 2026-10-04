import type { CalendarItem } from '../../contracts/src/index.js';

export function bulkDeleteSelection(items: CalendarItem[], start: string, end: string, busyIds: string[] = []) {
  const from = Date.parse(start), to = Date.parse(end);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) throw new Error('Période invalide : le début doit précéder la fin.');
  const eligible: CalendarItem[] = [];
  const excluded: { id: string; title: string; reason: string }[] = [];
  for (const item of items) {
    const recurring = item.recurrence || item.seriesId || item.occurrenceKey || item.twitchRecurring || Object.values(item.providers ?? {}).some(link => link.occurrences && Object.keys(link.occurrences).length);
    const a = Date.parse(item.startAtUtc), b = Date.parse(item.endAtUtc);
    // Include canonical series in the exclusions even if their first occurrence predates the window.
    if (!recurring && !(a < to && b > from)) continue;
    let reason = '';
    if (recurring) reason = 'Série ou occurrence récurrente protégée : utiliser la gestion individuelle de la série.';
    else if (item.external || item.ownership === 'EXTERNAL' || item.editable === false || (item.ownership !== 'LOCAL' && item.source && item.source !== 'DAMPLANNER')) reason = 'Événement externe.';
    else if (!(a >= from && b <= to && a < b)) reason = 'Événement non entièrement compris dans la période.';
    else if (busyIds.includes(item.id) || Object.values(item.providers ?? {}).some(link => link.uncertainCreate || link.status === 'pending')) reason = 'Synchronisation en cours ou création distante incertaine : réconcilier avant suppression.';
    if (reason) excluded.push({ id: item.id, title: item.title, reason });
    else eligible.push(item);
  }
  return { eligible, excluded };
}
