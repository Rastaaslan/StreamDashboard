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

/** Stable identity check: a duplicate must use the same reviewed live after refresh. */
export function assistedDuplicateSourceFingerprint(item) {
  if (!item || typeof item.id !== 'string' || !item.id || item.category !== 'live' ||
      typeof item.title !== 'string' || !item.title.trim() ||
      item.allDay || item.recurrence || item.deletionPending || item.conflict ||
      item.transferId || item.transferredTo ||
      !Number.isFinite(Date.parse(item.startAtUtc)) ||
      !Number.isFinite(Date.parse(item.endAtUtc)) ||
      Date.parse(item.endAtUtc) <= Date.parse(item.startAtUtc) ||
      Object.values(item.providers || {}).some(p => !p ||
        ['conflict', 'error', 'pending'].includes(p.status))) {
    throw new Error('Session à dupliquer indisponible ou incertaine.');
  }
  const copy = { id:item.id, title:item.title, description:item.description,
    startAtUtc:item.startAtUtc, endAtUtc:item.endAtUtc, category:item.category,
    twitchCategoryId:item.twitchCategoryId, twitchCategoryName:item.twitchCategoryName,
    tags:item.tags, tagPreferences:item.tagPreferences, providers:item.providers };
  return JSON.stringify(copy);
}

/** Duplicate a single reviewed live into an UNSAVED, LOCAL-ONLY editor.
 * Never clone IDs, recurrence, provider projections or publication authority.
 */
export function prepareAssistedLocalDuplicate(items, sourceId, slot, now = Date.now()) {
  const base = prepareAssistedLocalDraft(items, slot, now);
  const found = items.filter(item => item?.id === sourceId);
  if (typeof sourceId !== 'string' || !sourceId || found.length !== 1)
    throw new Error('Session source introuvable ou ambiguë.');
  const source = found[0];
  assistedDuplicateSourceFingerprint(source);
  if (source.tags && (!Array.isArray(source.tags.values) ||
      !source.tags.values.every(value => typeof value === 'string')))
    throw new Error('Tags de la session source invalides.');
  const title = source.title.slice(0, 132).trimEnd() + ' (copie)';
  return {...base, title, description: typeof source.description === 'string' ?
      source.description.slice(0, 4000) : '',
    twitchCategoryId: typeof source.twitchCategoryId === 'string' ? source.twitchCategoryId : '',
    twitchCategoryName: typeof source.twitchCategoryName === 'string' ? source.twitchCategoryName : '',
    ...(source.tags ? {tags:structuredClone(source.tags)} : {}),
    ...(source.tagPreferences ? {tagPreferences:structuredClone(source.tagPreferences)} : {})};
}
