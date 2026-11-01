import { mountMomentsTimeline } from './streamcockpit-moments.js';

const validSession = /^[A-Za-z0-9_-]{1,128}$/;

/** F09: explicit read of a known session on the paired FIXE only.
 * No locally inferred session, offline cache, provider write or background polling.
 */
export function mountMomentsPage(root, { online, request }) {
  const doc = root.ownerDocument;
  const section = doc.createElement('section');
  section.setAttribute('class', 'cockpit-moments-page');
  section.setAttribute('aria-label', 'Journal de moments — lecture seule');

  const heading = doc.createElement('h2');
  heading.textContent = 'Moments marquants';
  const hint = doc.createElement('p');
  hint.textContent = 'Consultez une session déjà enregistrée par le fixe. Aucun marqueur n’est créé ici et les sessions ne sont pas devinées.';
  const form = doc.createElement('form');
  form.setAttribute('aria-label', 'Consulter une session enregistrée');
  const label = doc.createElement('label');
  label.textContent = 'Identifiant exact de session';
  const input = doc.createElement('input');
  input.setAttribute('type', 'text');
  input.setAttribute('maxlength', '128');
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('spellcheck', 'false');
  input.setAttribute('aria-label', 'Identifiant exact de session');
  label.append(input);
  const submit = doc.createElement('button');
  submit.setAttribute('type', 'submit');
  submit.textContent = 'Consulter';
  const refresh = doc.createElement('button');
  refresh.setAttribute('type', 'button');
  refresh.textContent = 'Actualiser cette session';
  refresh.hidden = true;
  const status = doc.createElement('p');
  status.setAttribute('role', 'status');
  const results = doc.createElement('div');
  results.setAttribute('class', 'cockpit-moments-results');
  form.append(label, submit);
  section.append(heading, hint, form, refresh, status, results);
  root.append(section);

  let disposed = false, connected = Boolean(online), timeline;
  const clear = () => {
    timeline?.destroy();
    timeline = undefined;
    results.replaceChildren();
    refresh.hidden = true;
  };
  const show = event => {
    event?.preventDefault?.();
    if (disposed) return;
    clear();
    if (!connected) {
      status.textContent = 'Fixe déconnecté : aucun journal disponible.';
      return;
    }
    const id = input.value.trim();
    if (!validSession.test(id)) {
      status.textContent = 'Identifiant invalide : 1 à 128 lettres, chiffres, tirets ou underscores.';
      return;
    }
    status.textContent = 'Consultation sur le fixe · lecture seule';
    timeline = mountMomentsTimeline(results, {
      sessionId: id,
      read: async session => {
        const data = await request('/api/v1/streamcockpit-moments/' + encodeURIComponent(session));
        if (data?.readOnly !== true) throw new Error('UNVERIFIED_MOMENTS');
        return data;
      },
    });
    refresh.hidden = false;
  };
  form.addEventListener('submit', show);
  refresh.addEventListener('click', () => {
    if (!disposed && connected) void timeline?.refresh();
  });
  input.addEventListener('input', () => {
    if (disposed) return;
    clear();
    status.textContent = connected
      ? 'Identifiant modifié : consultation nécessaire.'
      : 'Fixe déconnecté : aucun journal disponible.';
  });
  if (!connected) {
    input.disabled = true;
    submit.disabled = true;
  }
  status.textContent = connected
    ? 'Aucune session consultée. Saisissez un identifiant vérifié.'
    : 'Fixe indisponible : les moments ne sont pas accessibles hors connexion.';

  return {
    isAvailable() { return !disposed && connected; },
    unavailable() {
      if (disposed) return;
      connected = false;
      clear();
      input.disabled = true;
      submit.disabled = true;
      status.textContent = 'Fixe déconnecté : données effacées, nouvelle connexion nécessaire.';
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      clear();
      section.remove();
    },
  };
}
