import { randomUuid } from '../shared/uuid.js';

const validSession = /^[A-Za-z0-9_-]{1,128}$/;
const validCorrelation = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Explicit F09 manual marker on the single paired FIXE authority.
 * No synthetic session, offline outbox, automatic retry or OBS command.
 */
export function mountManualMomentForm(root, { online, request, onRecorded }) {
  const doc = root.ownerDocument;
  const section = doc.createElement('section');
  section.setAttribute('class', 'cockpit-moments-manual panel');
  section.setAttribute('aria-label', 'Ajouter un repère manuel');
  const heading = doc.createElement('h3');
  heading.textContent = 'Repère manuel';
  const description = doc.createElement('p');
  description.textContent = 'Uniquement pendant un live OBS confirmé et rattaché à une session du fixe. Aucune commande OBS ou Twitch.';
  const form = doc.createElement('form');
  const label = doc.createElement('label');
  label.textContent = 'Nom du moment';
  const input = doc.createElement('input');
  input.setAttribute('maxlength', '120');
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('aria-label', 'Nom du repère manuel');
  label.append(input);
  const submit = doc.createElement('button');
  submit.setAttribute('type', 'submit');
  submit.textContent = 'Enregistrer un repère manuel';
  const status = doc.createElement('p');
  status.setAttribute('role', 'status');
  status.textContent = online
    ? 'En attente de votre validation. Le fixe refusera toute session incertaine.'
    : 'Fixe indisponible : aucun repère local ne sera créé.';
  form.append(label, submit);
  section.append(heading, description, form, status);
  root.append(section);

  let connected = Boolean(online), disposed = false, inFlight = false, generation = 0, uncertain = false;
  const update = () => {
    input.disabled = disposed || !connected || inFlight || uncertain;
    submit.disabled = disposed || !connected || inFlight || uncertain;
  };
  update();
  form.addEventListener('submit', async event => {
    event?.preventDefault?.();
    if (disposed || !connected || inFlight || uncertain) return;
    const title = input.value.trim();
    if (!title || title.length > 120 || /[\x00-\x1f\x7f]|(?:https?:\/\/|oauth:|bearer\s|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|stream[_ -]?key)/i.test(title)) {
      status.textContent = 'Nom invalide : 1 à 120 caractères, sans URL ni identifiant secret.';
      return;
    }
    let requestId;
    try { requestId = randomUuid(); } catch {
      status.textContent = 'Génération sécurisée indisponible : aucun repère envoyé.';
      return;
    }
    inFlight = true;
    update();
    const current = ++generation;
    status.textContent = 'Écriture demandée au fixe, confirmation en cours…';
    try {
      const result = await request('/api/v1/streamcockpit-moments/manual/add', { requestId, title });
      if (disposed || !connected || current !== generation) return;
      if (result?.schemaVersion !== 1 || result.kind !== 'streamcockpit-manual-marker' ||
          !['created','replayed'].includes(result.outcome) || !validSession.test(result.sessionId) ||
          !Number.isSafeInteger(result.instant) || !Number.isSafeInteger(result.sequence) ||
          result.sequence < 1 || !/^[a-f0-9]{64}$/.test(result.correlationId) ||
          result.source !== 'manual' || result.status !== 'observed') throw new Error('UNVERIFIED_RECEIPT');
      input.value = '';
      status.textContent = result.outcome === 'created'
        ? 'Repère journalisé sur le fixe. Consultez cette session pour vérifier la chronologie.'
        : 'Demande déjà enregistrée sur le fixe : aucun second repère créé.';
      onRecorded?.(result.sessionId);
    } catch (error) {
      if (disposed || !connected || current !== generation) return;
      const code = error?.body?.error?.code;
      if (code === 'MOMENTS_NO_TRUSTED_LIVE_SESSION') {
        status.textContent = 'Aucune session OBS active et certaine sur le fixe : rien envoyé.';
      } else if (code === 'INVALID_MANUAL_MARKER') {
        status.textContent = 'Nom refusé par le fixe : aucun repère confirmé.';
      } else {
        // The server may have committed even when its response was lost.
        uncertain = true;
        input.value = '';
        status.textContent = 'Résultat incertain : vérifiez le journal sur le fixe avant toute nouvelle création. Aucun renvoi automatique.';
      }
    } finally {
      inFlight = false;
      if (!disposed && connected && current === generation) update();
    }
  });
  return {
    unavailable() {
      if (disposed) return;
      generation++; connected = false; uncertain = true;
      input.value = '';
      status.textContent = 'Fixe déconnecté : aucun renvoi. Vérifiez son journal après reconnexion.';
      update();
    },
    destroy() {
      if (disposed) return;
      disposed = true; generation++; input.value = ''; update();
      section.remove();
    },
  };
}
