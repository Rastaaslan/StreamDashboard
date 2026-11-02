import type { CalendarItem } from '../../../packages/contracts/src/index.js';
import { inspectPlanningSlot } from '../../../packages/core/src/streamcockpit-planning.js';

/**
 * F06: a deliberate local assisted draft is reviewed again on the authoritative
 * FIXE host, INSIDE the serialized planning queue, before any creation/provider
 * operation. No external Google/Twitch availability is inferred.
 *
 * This guards concurrent host planning writes, not an external provider change
 * or a power loss after the storage operation has begun.
 */
export function assertAssistedLocalSlot(
  input: Partial<CalendarItem>,
  current: CalendarItem[],
  now = Date.now(),
): void {
  const desired = input.desiredPublication;
  if (input.category !== 'live' || input.allDay === true || input.recurrence ||
      desired?.local !== true || desired.twitch !== false || desired.google !== false ||
      !Array.isArray(current)) {
    throw new Error('Brouillon assisté local uniquement : publication, récurrence ou source invalide.');
  }
  const from = input.startAtUtc, to = input.endAtUtc;
  const start = typeof from === 'string' ? Date.parse(from) : NaN;
  const end = typeof to === 'string' ? Date.parse(to) : NaN;
  if (!Number.isFinite(now) || !Number.isFinite(start) || !Number.isFinite(end) ||
      start <= now + 5 * 60_000 || end <= start || end - start > 24 * 60 * 60_000) {
    throw new Error('Créneau assisté dépassé ou invalide. Choisissez une nouvelle proposition.');
  }
  // The canonical inspector checks explicit time zones, recurrence exceptions,
  // deleted or conflicting rows, including imported Google copies. Any
  // uncertain/corrupt row fails closed instead of being silently skipped.
  const snapshot = [
    { source: 'local' as const, status: 'observed' as const,
      observedAt: new Date(now).toISOString(), from: from!, to: to!, items: current },
    { source: 'google' as const, status: 'disabled' as const,
      observedAt: '', from: '', to: '', items: [] },
  ];
  let conflicts;
  try {
    conflicts = inspectPlanningSlot(snapshot, { from: from!, to: to! }, now).conflicts;
  } catch {
    throw Object.assign(new Error('Planning autoritaire incertain : actualisez avant une nouvelle création.'), {
      name: 'REVISION_CONFLICT',
    });
  }
  if (conflicts.length) {
    throw Object.assign(new Error('Créneau désormais occupé sur FIXE : choisissez une autre proposition.'), {
      name: 'REVISION_CONFLICT',
    });
  }
}
