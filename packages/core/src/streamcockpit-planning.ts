import type { CalendarItem } from '../../contracts/src/index.js';
import { expandRecurringItems, migrateRecurrence } from './recurrence.js';
import { randomUuid } from './uuid.js';

const MINUTE = 60_000;
const DAY = 86_400_000;
export const PLANNING_ZONE = 'Europe/Paris';
export interface PlanningObservation {
  source: 'local' | 'google';
  status: 'observed' | 'unavailable' | 'disabled';
  observedAt: string;
  from: string;
  to: string;
  /** Canonical CalendarItems, not raw Google RRULEs. Include masters and exceptions. */
  items: CalendarItem[];
  error?: string;
}
export interface PlanningWindow { from: string; to: string }
export interface PlanningSlot extends PlanningWindow {
  conflicts: Array<{ source: 'local' | 'google'; id: string; title: string; occurrenceKey?: string }>;
}
export interface SuggestionRequest extends PlanningWindow {
  durationMinutes: number;
  stepMinutes?: number;
  limit?: number;
}
const formatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: PLANNING_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
function wall(at: number) { return formatter.format(new Date(at)).replace(' ', 'T'); }
function instant(value: string) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error('Date avec fuseau explicite requise.');
  }
  const at = Date.parse(value);
  // Date.parse normalizes impossible dates such as February 30.
  const date = value.slice(0, 10);
  if (new Date(Date.parse(`${date}T00:00:00Z`)).toISOString().slice(0, 10) !== date) throw new Error('Date civile invalide.');
  return at;
}
/** Manual wall-clock input: gaps fail, folds require an explicit choice. */
export function parisInstant(value: string, fold?: 'earlier' | 'later'): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Date Paris invalide.');
  const target = instant(`${value}:00Z`);
  const candidates = [target - 2 * 60 * MINUTE, target - 60 * MINUTE].filter(at => wall(at) === `${value}:00`);
  if (!candidates.length) throw new Error('Heure Paris inexistante ou date invalide.');
  if (candidates.length > 1 && !fold) throw new Error('Heure Paris ambiguë : choisir earlier ou later.');
  return new Date(fold === 'later' ? candidates[candidates.length - 1] : candidates[0]).toISOString();
}
function range(value: PlanningWindow) {
  const start = instant(value.from), end = instant(value.to);
  if (end <= start || end - start > 31 * DAY) throw new Error('Fenêtre requise : durée positive, maximum 31 jours.');
  return { start, end };
}
function eventRange(item: CalendarItem): PlanningWindow {
  if (item.allDay) {
    const civil = (s: string) => {
      if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(s)) throw new Error('Date journée entière invalide.');
      return parisInstant(`${s.slice(0, 10)}T00:00`);
    };
    return { from: civil(item.startAtUtc), to: civil(item.endAtUtc) };
  }
  return { from: item.startAtUtc, to: item.endAtUtc };
}
function validateItem(item: CalendarItem) {
  if (!item.id || typeof item.title !== 'string') throw new Error('Identité événement manquante.');
  if (item.deletionPending) throw new Error('Suppression en attente : disponibilité incertaine.');
  const dates = eventRange(item);
  if (instant(dates.to) <= instant(dates.from)) throw new Error('Durée événement invalide.');
  if (item.conflict || Object.values(item.providers ?? {}).some(link => link?.status === 'conflict')) throw new Error(`Conflit non résolu : ${item.title}`);
  if (item.recurrence) {
    const rule = migrateRecurrence(item.recurrence);
    if (rule.custom || item.allDay) throw new Error('Récurrence personnalisée ou journée entière non prise en charge par les suggestions.');
    new Intl.DateTimeFormat('fr-FR', { timeZone: rule.timeZone }).format(0);
    if (!rule.timeZone) throw new Error('Fuseau récurrence manquant.');
    if (rule.until != null) instant(rule.until);
    for (const exception of Object.values(rule.exceptions ?? {})) {
      if (!exception.cancelled && exception.patch) validateItem({ ...item, ...exception.patch, recurrence: undefined });
    }
  }
}
function observed(snapshot: PlanningObservation[], window: PlanningWindow, now: number) {
  const { start, end } = range(window);
  if (!Number.isFinite(now)) throw new Error('Horloge invalide.');
  if (snapshot.length !== 2 || new Set(snapshot.map(s => s.source)).size !== 2 || !snapshot.some(s => s.source === 'local') || !snapshot.some(s => s.source === 'google')) throw new Error('Observations local et Google requises (Google peut être désactivé explicitement).');
  return snapshot.flatMap(observation => {
    if (observation.source === 'google' && observation.status === 'disabled' && observation.items.length === 0) return [];
    const age = now - instant(observation.observedAt);
    if (observation.status !== 'observed' || age < 0 || age > 5 * MINUTE || instant(observation.from) > start || instant(observation.to) < end) throw new Error(observation.error || `Observation ${observation.source} indisponible, périmée ou incomplète.`);
    const ids = new Set<string>();
    for (const item of observation.items) {
      validateItem(item);
      if (ids.has(item.id)) throw new Error('Identités observées dupliquées.');
      ids.add(item.id);
    }
    // All-day civil dates must be converted BEFORE the overlap filter, including DST.
    const normalized = observation.items.map(item => {
      const dates = eventRange(item);
      return { ...structuredClone(item), startAtUtc: dates.from, endAtUtc: dates.to };
    });
    return expandRecurringItems(normalized, { from: start, to: end }).map(item => ({ item, source: observation.source }));
  });
}
export function inspectPlanningSlot(snapshot: PlanningObservation[], slot: PlanningWindow, now: number): PlanningSlot {
  const { start, end } = range(slot);
  const conflicts = observed(snapshot, slot, now).filter(({ item }) => instant(item.startAtUtc) < end && instant(item.endAtUtc) > start)
    .map(({ item, source }) => ({ source, id: item.id, title: item.title, occurrenceKey: item.occurrenceKey }));
  return { ...slot, conflicts };
}
/** Earliest free slots on an elapsed-time grid; no speculative availability. */
export function suggestPlanningSlots(snapshot: PlanningObservation[], request: SuggestionRequest, now: number): PlanningSlot[] {
  const { start, end } = range(request);
  const step = request.stepMinutes ?? 30, limit = request.limit ?? 5;
  if (![request.durationMinutes, step, limit].every(n => Number.isSafeInteger(n) && n > 0) || limit > 100 || request.durationMinutes > 24 * 60) throw new Error('Durée, pas ou limite invalide.');
  const events = observed(snapshot, request, now);
  const result: PlanningSlot[] = [];
  for (let at = Math.max(start, start + Math.ceil((now - start) / (step * MINUTE)) * step * MINUTE); at + request.durationMinutes * MINUTE <= end && result.length < limit; at += step * MINUTE) {
    const finish = at + request.durationMinutes * MINUTE;
    if (events.some(({ item }) => instant(item.startAtUtc) < finish && instant(item.endAtUtc) > at)) continue;
    result.push({ from: new Date(at).toISOString(), to: new Date(finish).toISOString(), conflicts: [] });
  }
  return result;
}

/** Stateful, memory-only review. Confirmation returns a draft, never persists or publishes. */
export function proposeSessionDuplicate(snapshot: PlanningObservation[], source: { source: 'local' | 'google'; id: string; occurrenceKey?: string }, slot: PlanningWindow, now: number) {
  const ownedSnapshot = structuredClone(snapshot), target = { ...slot };
  const observation = ownedSnapshot.find(s => s.source === source.source);
  const master = observation?.items.find(item => item.id === source.id);
  if (!master) throw new Error('Session source introuvable.');
  validateItem(master);
  // Resolve a single occurrence; never clone a complete sequence or provider identities.
  let session = master;
  if (master.recurrence && !master.occurrenceKey) {
    if (!source.occurrenceKey || !observation) throw new Error('Choisir une occurrence précise de la série.');
    range(observation);
    const occurrence = expandRecurringItems([master], { from: observation.from, to: observation.to }).find(item => item.occurrenceKey === source.occurrenceKey);
    if (!occurrence) throw new Error('Occurrence annulée ou hors observation.');
    session = occurrence;
  }
  if (session.allDay || session.deletionPending || session.transferId || session.transferredTo || (session.category !== 'live' && session.kind !== 'LIVE')) throw new Error('Choisir une session live active et datée.');
  const preview = inspectPlanningSlot(ownedSnapshot, target, now);
  const fingerprintOf = (values: PlanningObservation[]) => JSON.stringify(values.map(({ observedAt: _at, ...value }) => value));
  const fingerprint = fingerprintOf(ownedSnapshot);
  let state: 'proposed' | 'cancelled' | 'confirmed' = 'proposed';
  return {
    preview: { ...structuredClone(preview), title: session.title, timeZone: PLANNING_ZONE },
    get state() { return state; },
    cancel() { if (state === 'proposed') state = 'cancelled'; },
    confirm(latest: PlanningObservation[], at: number): CalendarItem {
      if (state !== 'proposed') throw new Error('Proposition annulée ou déjà confirmée.');
      const check = inspectPlanningSlot(latest, target, at);
      if (instant(target.from) < at) throw new Error('Créneau passé.');
      if (check.conflicts.length) throw new Error('Chevauchement : choisir un autre créneau.');
      if (fingerprintOf(latest) !== fingerprint) throw new Error('Observations modifiées : recalculer la proposition.');
      const id = randomUuid();
      if (latest.some(s => s.items.some(item => item.id === id || item.localId === id))) throw new Error('Collision identifiant : recommencer.');
      const draft: CalendarItem = {
        id, localId: id, title: session.title, description: session.description,
        startAtUtc: target.from, endAtUtc: target.to, category: 'live', kind: 'LIVE',
        twitchCategoryId: session.twitchCategoryId, twitchCategoryName: session.twitchCategoryName,
        tags: structuredClone(session.tags), tagPreferences: structuredClone(session.tagPreferences),
        source: 'DAMPLANNER', ownership: 'LOCAL', editable: true, draft: true,
        providers: {}, desiredPublication: { local: true, google: false, twitch: false },
      };
      state = 'confirmed';
      return draft;
    },
  };
}
