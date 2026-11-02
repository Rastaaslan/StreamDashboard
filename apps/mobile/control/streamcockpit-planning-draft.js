import { inspectPlanningSlot } from './streamcockpit-planning.js';

/**
 * F06 — local-only preflight for an assistant slot.
 * All previously imported Google events remain blockers, but current Google
 * availability is UNKNOWN. No network call, provider write, or new clock owner.
 */
export function prepareAssistedLocalDraft(items, slot, now = Date.now()) {
  if (!Array.isArray(items) || !slot || typeof slot.from !== 'string' ||
      typeof slot.to !== 'string' || !Number.isFinite(now)) {
    throw new Error('Copie du planning ou dates indisponibles.');
  }
  const start = Date.parse(slot.from);
  const end = Date.parse(slot.to);
  if (!Number.isFinite(start) || !Number.isFinite(end) ||
      start <= now + 5 * 60_000 || end <= start || end - start > 24 * 3_600_000) {
    throw new Error('Créneau futur valide requis (début dans plus de cinq minutes, durée maximum 24 h).');
  }
  // Only explicit instants (with Z or an offset) are accepted by the canonical
  // core. Validate every item and recurrence; conflicts/deletions fail closed.
  const observations = [
    {source:'local', status:'observed', observedAt:new Date(now).toISOString(),
      from:slot.from, to:slot.to, items},
    {source:'google', status:'disabled', observedAt:'', from:'', to:'', items:[]},
  ];
  const review = inspectPlanningSlot(observations, slot, now);
  if (review.conflicts.length) {
    throw new Error('Chevauchement dans la copie locale : actualiser ou choisir un autre créneau.');
  }
  return {
    title: '', description: '', startAtUtc:review.from, endAtUtc:review.to,
    category:'live', allDay:false, source:'DAMPLANNER',
    desiredPublication:{local:true,twitch:false,google:false},
    providers:{},
  };
}
