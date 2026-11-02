/** Read-only projection of the in-memory agenda, NOT a provider observation.
 * Google is excluded from the calculation, never declared available/disabled remotely.
 * Cached imported events remain blockers with their original provenance displayed.
 */
export function renderPlanningAssistant(items, { esc, online = false, now = Date.now() }) {
  const heading = '<section class="panel spacer" data-planning-assistant aria-label="Planning assisté"><h2>Planning assisté</h2>';
  const warning = '<p>Suggestion locale non publiée · Google / Twitch : UNKNOWN. Fraîcheur distante inconnue ; aucune disponibilité ni synchronisation garantie.</p>' +
    '<p>' + (online ? 'Connexion régie disponible' : 'Hors ligne / connexion non vérifiée') + ' · calcul sur la copie locale uniquement, sans réservation.</p>';
  const disabled = '<button type="button" disabled>Dupliquer vers un brouillon (indisponible)</button><p>La duplication assistée attend une confirmation de sauvegarde et une vérification des conflits dans l’éditeur.</p></section>';
  try {
    if (!Array.isArray(items)) throw new Error('Copie locale indisponible.');
    // Leave enough time to review the draft. A slot at exactly 'now' cannot
    // pass the safety preflight when the user presses the suggestion button.
    const from = new Date(Math.ceil((now + 15 * 60_000) / 1800000) * 1800000).toISOString();
    const to = new Date(Date.parse(from) + 86400000).toISOString();
    // observedAt dates this synchronous local read only; it does not refresh provider data.
    const snapshot = [{ source: 'local', status: 'observed', observedAt: new Date(now).toISOString(), from, to, items },
      { source: 'google', status: 'disabled', observedAt: '', from: '', to: '', items: [] }];
    const slots = suggestPlanningSlots(snapshot, { from, to, durationMinutes: 60, limit: 3 }, now);
    const format = new Intl.DateTimeFormat('fr-FR', { timeZone: PLANNING_ZONE, dateStyle: 'short', timeStyle: 'long' });
    const provenance = [...new Set(items.map(item => [item.source || 'origine inconnue', ...Object.keys(item.providers || {})].join(' / ')))];
    return heading + warning + '<p>' + items.length + ' événement(s) de la copie locale pris en compte, sans les filtres de la page. Provenance : ' + esc(provenance.join(', ') || 'aucun événement') + '.</p>' +
      '<p>Créneaux de 60 minutes dans les prochaines 24 heures · Europe/Paris · sans chevauchement connu dans cette copie.</p><ul>' +
      slots.map(slot => '<li>' + esc(format.format(new Date(slot.from)) + ' → ' + format.format(new Date(slot.to))) +
        ' <button type="button" data-planning="assist-new" data-from="' + esc(slot.from) +
        '" data-to="' + esc(slot.to) + '"' + (online ? '' : ' disabled') +
        '>Vérifier et préparer un brouillon local</button></li>').join('') +
      '</ul>' + (slots.length ? '' : '<p>Aucun créneau trouvé dans cette copie.</p>') + disabled;
  } catch (error) {
    return heading + warning + '<p role="status">Calcul indisponible : ' + esc(error instanceof Error ? error.message : String(error)) + '</p>' + disabled;
  }
}

/** Isolated review panel. readLatest is read-only; draft retrieval does not save it. */
export function mountPlanningProposal(root, { proposal, readLatest, now = Date.now }) {
  const doc = root.ownerDocument;
  const panel = doc.createElement('section');
  panel.setAttribute('aria-label', 'Proposition de planning');
  const title = doc.createElement('h3');
  const dates = doc.createElement('p');
  const status = doc.createElement('p');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const confirm = doc.createElement('button');
  const cancel = doc.createElement('button');
  confirm.type = cancel.type = 'button';
  confirm.textContent = 'Confirmer le brouillon';
  cancel.textContent = 'Annuler';
  let destroyed = false, cancelled = false, busy = false, draft;
  const format = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'full', timeStyle: 'long' });
  title.textContent = `Dupliquer : ${proposal.preview.title}`;
  dates.textContent = `${format.format(new Date(proposal.preview.from))} → ${format.format(new Date(proposal.preview.to))} (Europe/Paris)`;
  const conflicts = proposal.preview.conflicts;
  status.textContent = conflicts.length
    ? `Chevauchement : ${conflicts.map(c => c.title).join(', ')}. Choisir un autre créneau.`
    : 'Proposition en lecture seule. La confirmation prépare un brouillon ; aucun calendrier ni Twitch ne sera modifié.';
  confirm.disabled = conflicts.length > 0;
  async function confirmDraft() {
    if (destroyed || cancelled || busy || draft || confirm.disabled) return;
    busy = true;
    confirm.disabled = true;
    status.textContent = 'Vérification des observations…';
    try {
      const latest = await readLatest();
      if (destroyed || cancelled) return;
      draft = proposal.confirm(latest, now());
      status.textContent = 'Brouillon préparé, non enregistré et non publié. Reprendre dans Planning pour enregistrer.';
      cancel.disabled = true;
    } catch (error) {
      if (!destroyed && !cancelled) {
        status.textContent = `Confirmation impossible : ${error instanceof Error ? error.message : String(error)}`;
        confirm.disabled = false;
      }
    } finally { busy = false; }
  }
  function cancelDraft() {
    if (destroyed || draft) return;
    cancelled = true;
    proposal.cancel();
    confirm.disabled = cancel.disabled = true;
    status.textContent = 'Proposition annulée. Aucun événement créé.';
  }
  confirm.addEventListener('click', confirmDraft);
  cancel.addEventListener('click', cancelDraft);
  panel.append(title, dates, status, confirm, cancel);
  root.append(panel);
  return {
    confirm: confirmDraft,
    cancel: cancelDraft,
    getDraft: () => draft ? structuredClone(draft) : undefined,
    destroy() {
      destroyed = true;
      if (!draft) proposal.cancel();
      confirm.removeEventListener('click', confirmDraft);
      cancel.removeEventListener('click', cancelDraft);
      panel.remove();
    },
  };
}

// BEGIN core adapter: TypeScript ES2022 transpilation; see LOT_O_WAVE4.md.
import { expandRecurringItems, migrateRecurrence } from '../shared/recurrence.js';
import { randomUuid } from '../shared/uuid.js';
const MINUTE = 60_000;
const DAY = 86_400_000;
export const PLANNING_ZONE = 'Europe/Paris';
const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: PLANNING_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
function wall(at) { return formatter.format(new Date(at)).replace(' ', 'T'); }
function instant(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
        throw new Error('Date avec fuseau explicite requise.');
    }
    const at = Date.parse(value);
    // Date.parse normalizes impossible dates such as February 30.
    const date = value.slice(0, 10);
    if (new Date(Date.parse(`${date}T00:00:00Z`)).toISOString().slice(0, 10) !== date)
        throw new Error('Date civile invalide.');
    return at;
}
/** Manual wall-clock input: gaps fail, folds require an explicit choice. */
export function parisInstant(value, fold) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
        throw new Error('Date Paris invalide.');
    const target = instant(`${value}:00Z`);
    const candidates = [target - 2 * 60 * MINUTE, target - 60 * MINUTE].filter(at => wall(at) === `${value}:00`);
    if (!candidates.length)
        throw new Error('Heure Paris inexistante ou date invalide.');
    if (candidates.length > 1 && !fold)
        throw new Error('Heure Paris ambiguë : choisir earlier ou later.');
    return new Date(fold === 'later' ? candidates[candidates.length - 1] : candidates[0]).toISOString();
}
function range(value) {
    const start = instant(value.from), end = instant(value.to);
    if (end <= start || end - start > 31 * DAY)
        throw new Error('Fenêtre requise : durée positive, maximum 31 jours.');
    return { start, end };
}
function eventRange(item) {
    if (item.allDay) {
        const civil = (s) => {
            if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(s))
                throw new Error('Date journée entière invalide.');
            return parisInstant(`${s.slice(0, 10)}T00:00`);
        };
        return { from: civil(item.startAtUtc), to: civil(item.endAtUtc) };
    }
    return { from: item.startAtUtc, to: item.endAtUtc };
}
function validateItem(item) {
    if (!item.id || typeof item.title !== 'string')
        throw new Error('Identité événement manquante.');
    if (item.deletionPending)
        throw new Error('Suppression en attente : disponibilité incertaine.');
    const dates = eventRange(item);
    if (instant(dates.to) <= instant(dates.from))
        throw new Error('Durée événement invalide.');
    if (item.conflict || Object.values(item.providers ?? {}).some(link => link?.status === 'conflict'))
        throw new Error(`Conflit non résolu : ${item.title}`);
    if (item.recurrence) {
        const rule = migrateRecurrence(item.recurrence);
        if (rule.custom || item.allDay)
            throw new Error('Récurrence personnalisée ou journée entière non prise en charge par les suggestions.');
        new Intl.DateTimeFormat('fr-FR', { timeZone: rule.timeZone }).format(0);
        if (!rule.timeZone)
            throw new Error('Fuseau récurrence manquant.');
        if (rule.until != null)
            instant(rule.until);
        for (const exception of Object.values(rule.exceptions ?? {})) {
            if (!exception.cancelled && exception.patch)
                validateItem({ ...item, ...exception.patch, recurrence: undefined });
        }
    }
}
function observed(snapshot, window, now) {
    const { start, end } = range(window);
    if (!Number.isFinite(now))
        throw new Error('Horloge invalide.');
    if (snapshot.length !== 2 || new Set(snapshot.map(s => s.source)).size !== 2 || !snapshot.some(s => s.source === 'local') || !snapshot.some(s => s.source === 'google'))
        throw new Error('Observations local et Google requises (Google peut être désactivé explicitement).');
    return snapshot.flatMap(observation => {
        if (observation.source === 'google' && observation.status === 'disabled' && observation.items.length === 0)
            return [];
        const age = now - instant(observation.observedAt);
        if (observation.status !== 'observed' || age < 0 || age > 5 * MINUTE || instant(observation.from) > start || instant(observation.to) < end)
            throw new Error(observation.error || `Observation ${observation.source} indisponible, périmée ou incomplète.`);
        const ids = new Set();
        for (const item of observation.items) {
            validateItem(item);
            if (ids.has(item.id))
                throw new Error('Identités observées dupliquées.');
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
export function inspectPlanningSlot(snapshot, slot, now) {
    const { start, end } = range(slot);
    const conflicts = observed(snapshot, slot, now).filter(({ item }) => instant(item.startAtUtc) < end && instant(item.endAtUtc) > start)
        .map(({ item, source }) => ({ source, id: item.id, title: item.title, occurrenceKey: item.occurrenceKey }));
    return { ...slot, conflicts };
}
/** Earliest free slots on an elapsed-time grid; no speculative availability. */
export function suggestPlanningSlots(snapshot, request, now) {
    const { start, end } = range(request);
    const step = request.stepMinutes ?? 30, limit = request.limit ?? 5;
    if (![request.durationMinutes, step, limit].every(n => Number.isSafeInteger(n) && n > 0) || limit > 100 || request.durationMinutes > 24 * 60)
        throw new Error('Durée, pas ou limite invalide.');
    const events = observed(snapshot, request, now);
    const result = [];
    for (let at = Math.max(start, start + Math.ceil((now - start) / (step * MINUTE)) * step * MINUTE); at + request.durationMinutes * MINUTE <= end && result.length < limit; at += step * MINUTE) {
        const finish = at + request.durationMinutes * MINUTE;
        if (events.some(({ item }) => instant(item.startAtUtc) < finish && instant(item.endAtUtc) > at))
            continue;
        result.push({ from: new Date(at).toISOString(), to: new Date(finish).toISOString(), conflicts: [] });
    }
    return result;
}
/** Stateful, memory-only review. Confirmation returns a draft, never persists or publishes. */
export function proposeSessionDuplicate(snapshot, source, slot, now) {
    const ownedSnapshot = structuredClone(snapshot), target = { ...slot };
    const observation = ownedSnapshot.find(s => s.source === source.source);
    const master = observation?.items.find(item => item.id === source.id);
    if (!master)
        throw new Error('Session source introuvable.');
    validateItem(master);
    // Resolve a single occurrence; never clone a complete sequence or provider identities.
    let session = master;
    if (master.recurrence && !master.occurrenceKey) {
        if (!source.occurrenceKey || !observation)
            throw new Error('Choisir une occurrence précise de la série.');
        range(observation);
        const occurrence = expandRecurringItems([master], { from: observation.from, to: observation.to }).find(item => item.occurrenceKey === source.occurrenceKey);
        if (!occurrence)
            throw new Error('Occurrence annulée ou hors observation.');
        session = occurrence;
    }
    if (session.allDay || session.deletionPending || session.transferId || session.transferredTo || (session.category !== 'live' && session.kind !== 'LIVE'))
        throw new Error('Choisir une session live active et datée.');
    const preview = inspectPlanningSlot(ownedSnapshot, target, now);
    const fingerprintOf = (values) => JSON.stringify(values.map(({ observedAt: _at, ...value }) => value));
    const fingerprint = fingerprintOf(ownedSnapshot);
    let state = 'proposed';
    return {
        preview: { ...structuredClone(preview), title: session.title, timeZone: PLANNING_ZONE },
        get state() { return state; },
        cancel() { if (state === 'proposed')
            state = 'cancelled'; },
        confirm(latest, at) {
            if (state !== 'proposed')
                throw new Error('Proposition annulée ou déjà confirmée.');
            const check = inspectPlanningSlot(latest, target, at);
            if (instant(target.from) < at)
                throw new Error('Créneau passé.');
            if (check.conflicts.length)
                throw new Error('Chevauchement : choisir un autre créneau.');
            if (fingerprintOf(latest) !== fingerprint)
                throw new Error('Observations modifiées : recalculer la proposition.');
            const id = randomUuid();
            if (latest.some(s => s.items.some(item => item.id === id || item.localId === id)))
                throw new Error('Collision identifiant : recommencer.');
            const draft = {
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
// END core adapter
