import { mountMomentsTimeline } from './streamcockpit-moments.js';
import { mountManualMomentForm } from './streamcockpit-moments-manual.js';

const validSession = /^[A-Za-z0-9_-]{1,128}$/;

/** F09: explicit read of a known session on the paired FIXE only.
 * No locally inferred session, offline cache, provider write or background polling.
 */
export function mountMomentsPage(root, { online, request }) {
  const doc = root.ownerDocument;
  const section = doc.createElement('section');
  section.setAttribute('class', 'cockpit-moments-page');
  section.setAttribute('aria-label', 'Journal de moments du FIXE');

  const heading = doc.createElement('h2');
  heading.textContent = 'Moments marquants';
  const hint = doc.createElement('p');
  hint.textContent = 'Consultation des sessions réelles du fixe. Un repère manuel exige un live OBS actif et une session identifiée par le fixe ; rien n’est déduit du téléphone.';
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
  const browse = doc.createElement('div');
  browse.setAttribute('class', 'cockpit-moments-browse');
  const browseButton = doc.createElement('button');
  browseButton.setAttribute('type', 'button');
  browseButton.textContent = 'Lister les sessions enregistrées sur le fixe';
  const browseSelect = doc.createElement('select');
  browseSelect.setAttribute('aria-label', 'Choisir une session réellement enregistrée');
  browseSelect.hidden = true;
  const browseStatus = doc.createElement('p');
  browseStatus.setAttribute('role', 'status');
  browse.append(browseButton, browseSelect, browseStatus);
  section.append(browse);
  root.append(section);

  let disposed = false, connected = Boolean(online), timeline, browseGeneration = 0;
  const manual = mountManualMomentForm(section, {
    online: connected, request,
    onRecorded(sessionId) {
      if (disposed || !connected) return;
      input.value = sessionId;
      clear();
      status.textContent = 'Repère enregistré : sélectionnez Consulter pour vérifier la session du fixe.';
    },
  });
  const clear = () => {
    timeline?.destroy();
    timeline = undefined;
    results.replaceChildren();
    refresh.hidden = true;
  };
  const clearBrowse = () => {
    browseGeneration++;
    browseSelect.replaceChildren();
    browseSelect.hidden = true;
    browseStatus.textContent = '';
  };
  browseButton.addEventListener('click', async () => {
    if (disposed || !connected) return;
    clearBrowse();
    const generation = browseGeneration;
    browseStatus.textContent = 'Lecture des sessions du fixe…';
    try {
      const data = await request('/api/v1/streamcockpit-moments');
      if (disposed || !connected || generation !== browseGeneration) return;
      if (data?.readOnly !== true || data.schemaVersion !== 1 ||
          data.kind !== 'streamcockpit-moment-sessions' ||
          !Array.isArray(data.sessions) || data.sessions.length > 1000) throw new Error('UNVERIFIED_SESSIONS');
      const ids = new Set();
      for (const session of data.sessions) {
        if (!session || !validSession.test(session.sessionId) || ids.has(session.sessionId) ||
            !Number.isSafeInteger(session.markerCount) || session.markerCount < 1 ||
            session.markerCount > 10000 || !Number.isSafeInteger(session.lastMarkerAt) ||
            session.lastMarkerAt < 0 || session.lastMarkerAt > 8640000000000000) throw new Error('INVALID_SESSIONS');
        ids.add(session.sessionId);
      }
      if (!data.sessions.length) {
        browseStatus.textContent = 'Journal présent, aucune session avec repère enregistré.';
        return;
      }
      const placeholder = doc.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Choisir une session';
      browseSelect.append(placeholder);
      for (const session of data.sessions) {
        const option = doc.createElement('option');
        option.value = session.sessionId;
        option.textContent = `${session.sessionId} · ${session.markerCount} repère(s) · dernier repère ${new Date(session.lastMarkerAt).toLocaleString()}`;
        browseSelect.append(option);
      }
      browseSelect.value = '';
      browseSelect.hidden = false;
      browseStatus.textContent = `${data.sessions.length} session(s) avec repères durables · sélection explicite requise.`;
    } catch {
      if (disposed || !connected || generation !== browseGeneration) return;
      clearBrowse();
      browseStatus.textContent = 'Liste indisponible : aucune session déduite localement.';
    }
  });
  browseSelect.addEventListener('change', () => {
    if (disposed || !connected || !validSession.test(browseSelect.value)) return;
    input.value = browseSelect.value;
    clear();
    status.textContent = 'Session sélectionnée. Appuyez sur Consulter pour lire les repères du fixe.';
  });
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
    browseButton.disabled = true;
  }
  status.textContent = connected
    ? 'Aucune session consultée. Saisissez un identifiant vérifié.'
    : 'Fixe indisponible : les moments ne sont pas accessibles hors connexion.';

  return {
    isAvailable() { return !disposed && connected; },
    unavailable() {
      if (disposed) return;
      connected = false;
      manual.unavailable();
      clear();
      clearBrowse();
      input.value = '';
      browseButton.disabled = true;
      input.disabled = true;
      submit.disabled = true;
      status.textContent = 'Fixe déconnecté : données effacées, nouvelle connexion nécessaire.';
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      manual.destroy();
      clear();
      clearBrowse();
      input.value = '';
      section.remove();
    },
  };
}
