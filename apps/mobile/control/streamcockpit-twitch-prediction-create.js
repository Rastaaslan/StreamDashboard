/** F08: user-initiated Twitch prediction. The only authority is the paired FIXE.
 * Never queues, auto-creates, retries a lost receipt or stores OAuth secrets.
 */
const PREVIEW = '/api/v1/twitch/advanced/prediction/preview';
const CONFIRM = '/api/v1/twitch/advanced/prediction/confirm';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safeId = /^[A-Za-z0-9-]{1,128}$/;

export function mountTwitchPredictionCreate(root, { request } = {}) {
  const doc = root.ownerDocument, view = doc.defaultView;
  const section = doc.createElement('section');
  section.className = 'cockpit-twitch-prediction-create panel';
  section.setAttribute('aria-label', 'Créer une prédiction Twitch');
  const header = doc.createElement('h3'); header.textContent = 'Créer une prédiction Twitch';
  const note = doc.createElement('p'); note.className = 'small muted';
  note.textContent = 'Deux validations obligatoires. Twitch rend la prédiction publique immédiatement après la confirmation. Aucun renvoi automatique.';
  const form = doc.createElement('form');
  const make = (labelText, type) => {
    const label = doc.createElement('label'); label.textContent = labelText;
    const input = doc.createElement(type);
    input.setAttribute('aria-label', labelText);
    if (input.style) {
      input.style.width = '100%'; input.style.maxWidth = '100%';
      input.style.minWidth = '0'; input.style.boxSizing = 'border-box';
    }
    label.append(input); form.append(label); return input;
  };
  const title = make('Question de la prédiction', 'input');
  title.maxLength = 45; title.autocomplete = 'off';
  const outcomes = make('Issues (2 à 10, une par ligne)', 'textarea');
  outcomes.rows = 3; outcomes.maxLength = 260;
  const windowSeconds = make('Durée de la prédiction', 'select');
  for (const seconds of [60,120,300,600,900]) {
    const option = doc.createElement('option'); option.value = String(seconds);
    option.textContent = (seconds / 60) + ' min'; windowSeconds.append(option);
  }
  windowSeconds.value = '60';
  const preview = doc.createElement('button'); preview.type = 'submit';
  preview.textContent = 'Prévisualiser la prédiction'; form.append(preview);
  const confirmation = doc.createElement('div'); confirmation.hidden = true;
  const summary = doc.createElement('p'); summary.setAttribute('role', 'status');
  const consent = doc.createElement('label');
  const checkbox = doc.createElement('input'); checkbox.type = 'checkbox';
  const consentText = doc.createElement('span');
  consentText.textContent = 'Je confirme la publication immédiate de cette prédiction sur Twitch.';
  consent.append(checkbox, consentText);
  const publish = doc.createElement('button'); publish.type = 'button';
  publish.textContent = 'Confirmer la création sur Twitch';
  confirmation.append(summary, consent, publish);
  const status = doc.createElement('p'); status.setAttribute('role', 'status'); status.className = 'small';
  const acknowledge = doc.createElement('button'); acknowledge.type = 'button'; acknowledge.className = 'secondary';
  acknowledge.textContent = 'J’ai consulté Twitch (ne débloque pas le FIXE)'; acknowledge.hidden = true;
  section.append(header, note, form, confirmation, status, acknowledge); root.append(section);

  let disposed = false, online = false, sourceKey = '', accountKey = '', revision = 0;
  let busy = false, sent = false, uncertain = false, hostReconciliationRequired = false, pending, approved;
  const fields = [title, outcomes, windowSeconds];
  const connected = () => !disposed && root.isConnected && online && !!sourceKey &&
    view?.navigator?.onLine !== false && doc.visibilityState !== 'hidden';
  const clear = () => {
    pending = undefined; approved = undefined; confirmation.hidden = true;
    checkbox.checked = false; summary.textContent = '';
  };
  const draw = () => {
    const enabled = connected() && !busy && !uncertain && !hostReconciliationRequired && typeof request === 'function';
    for (const field of fields) field.disabled = !enabled;
    preview.disabled = !enabled;
    checkbox.disabled = !enabled || !pending;
    publish.disabled = !enabled || !pending || !checkbox.checked || Date.now() >= pending.expiresAt;
    acknowledge.hidden = !uncertain;
    acknowledge.disabled = disposed || !connected() || busy;
  };
  const invalidate = reason => {
    revision++;
    if (sent) { uncertain = true; hostReconciliationRequired = true; } // Lost receipt: the FIXE journal still blocks.
    sent = false; busy = false; clear();
    title.value = ''; outcomes.value = ''; windowSeconds.value = '60';
    status.textContent = uncertain
      ? 'Résultat potentiellement public et incertain. Vérifiez Twitch ; le FIXE reste bloqué jusqu’à une réconciliation qualifiée. Aucun renvoi automatique.'
      : hostReconciliationRequired
        ? 'Journal de création réservé sur le FIXE. Aucune nouvelle prédiction avant réconciliation côté régie.'
        : reason;
    draw();
  };
  const readDraft = () => {
    const question = title.value.trim();
    const options = outcomes.value.split(/\r?\n/).map(x => x.trim());
    const seconds = Number(windowSeconds.value);
    if (!question || [...question].length > 45 || options.length < 2 || options.length > 10 ||
        options.some(x => !x || [...x].length > 25) ||
        new Set(options).size !== options.length || ![60,120,300,600,900].includes(seconds)) return null;
    return { title: question, outcomes: options, predictionWindow: seconds };
  };
  for (const field of fields) field.addEventListener('input', () => {
    if (disposed || busy || hostReconciliationRequired) return;
    clear(); status.textContent = 'Brouillon modifié. Une nouvelle prévisualisation est nécessaire.'; draw();
  });
  checkbox.addEventListener('change', draw);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!connected() || busy || uncertain || hostReconciliationRequired || typeof request !== 'function') return;
    const draft = readDraft();
    if (!draft) { clear();status.textContent = 'Question ou issues invalides : 2 à 10 issues distinctes, 25 caractères maximum.';draw();return; }
    clear(); busy = true; const current = ++revision, host = sourceKey;
    status.textContent = 'Prélecture Twitch sur le FIXE, aucune publication…'; draw();
    try {
      const data = await request(PREVIEW,{draft},'POST',host);
      if (!connected() || current !== revision || sourceKey !== host) return;
      if (data?.schemaVersion !== 1 || data.kind !== 'streamcockpit-prediction-preview' ||
          !uuid.test(data.confirmationId) || !Number.isFinite(data.expiresAt) ||
          data.expiresAt <= Date.now() || data.expiresAt > Date.now() + 45_000 ||
          JSON.stringify(data.draft) !== JSON.stringify(draft)) throw Error('INVALID_PREVIEW');
      pending = { id: data.confirmationId, expiresAt: data.expiresAt };
      approved = draft;
      summary.textContent = draft.title + ' — ' + draft.outcomes.join(' / ') +
        ' — ' + draft.predictionWindow + ' secondes. Expire dans 45 secondes maximum.';
      confirmation.hidden = false;
      status.textContent = 'Prévisualisation seulement. Aucune prédiction créée.';
    } catch (error) {
      if (!connected() || current !== revision) return;
      clear();
      status.textContent = error?.status === 403 ? 'Scope channel:manage:predictions ou permission manquante.' :
        error?.status === 409 ? 'Live FIXE indisponible, prédiction existante ou réservation conservée sur le FIXE : réconciliation côté régie nécessaire.' :
        'Prévisualisation impossible. Aucun envoi demandé.';
    } finally { if (!disposed && current === revision) { busy = false;draw(); } }
  });
  publish.addEventListener('click', async () => {
    if (!connected() || busy || uncertain || hostReconciliationRequired || !pending || !approved || !checkbox.checked ||
        Date.now() >= pending.expiresAt || typeof request !== 'function') return;
    if (JSON.stringify(readDraft()) !== JSON.stringify(approved)) { clear();draw();return; }
    const token = pending.id, current = ++revision, host = sourceKey;
    clear(); busy = true; sent = true; hostReconciliationRequired = true; draw();
    status.textContent = 'Confirmation envoyée : reçu Twitch attendu. Aucun renvoi automatique.';
    try {
      const data = await request(CONFIRM,{confirmed:true,confirmationId:token},'POST',host);
      if (!connected() || current !== revision || sourceKey !== host) return;
      if (data?.schemaVersion !== 1 || data.kind !== 'streamcockpit-prediction-confirmation' ||
          data.status !== 'confirmed' || !safeId.test(data.predictionId))
        throw Error('UNVERIFIED_RECEIPT');
      sent = false;
      title.value = ''; outcomes.value = ''; windowSeconds.value = '60';
      status.textContent = 'Création acceptée par Twitch. Vérifiez son affichage ; le journal FIXE interdit une nouvelle création avant réconciliation.';
    } catch {
      if (!connected() || current !== revision) return;
      uncertain = true; sent = false;
      title.value = ''; outcomes.value = '';
      status.textContent = 'Publication potentiellement effectuée, reçu incertain. Vérifiez Twitch ; le journal FIXE reste bloqué.';
    } finally {
      if (!disposed && current === revision) {
        // A detached root or an unobserved receipt is still a possible
        // public POST. Do not unlock a new creation on reconnect.
        if (sent) {
          sent = false; uncertain = true;
          status.textContent = 'Reçu inconnu après publication possible. Vérifiez Twitch ; le FIXE reste bloqué jusqu’à réconciliation.';
        }
        busy = false; draw();
      }
    }
  });
  acknowledge.addEventListener('click', () => {
    if (!connected() || busy || !uncertain) return;
    uncertain = false; invalidate('');
    status.textContent = 'Vérification manuelle déclarée. Le FIXE reste bloqué : aucune nouvelle création avant réconciliation qualifiée.';
    draw();
  });
  const visibility = () => invalidate('Vue suspendue : confirmations annulées.');
  const offline = () => invalidate('Hors ligne : aucune nouvelle prédiction.');
  const onlineChanged = () => invalidate('Connexion rétablie : vérification obligatoire.');
  doc.addEventListener('visibilitychange',visibility);
  view?.addEventListener('offline',offline); view?.addEventListener('online',onlineChanged);
  status.textContent = 'Appareil hors ligne : aucune création possible.'; draw();
  return {
    update(context = {}) {
      if (disposed) return;
      const nextSource = typeof context.sourceKey === 'string' ? context.sourceKey : '';
      const nextAccount = typeof context.accountKey === 'string' ? context.accountKey : '';
      const nextOnline = context.online === true;
      if (sourceKey !== nextSource || accountKey !== nextAccount || online !== nextOnline) {
        sourceKey = nextSource; accountKey = nextAccount; online = nextOnline;
        invalidate(nextOnline ? 'Prêt à prévisualiser volontairement.' : 'Source indisponible.');
      }
      draw();
    },
    destroy() {
      if (disposed) return;
      invalidate('Vue fermée.'); disposed = true;
      doc.removeEventListener('visibilitychange',visibility);
      view?.removeEventListener('offline',offline); view?.removeEventListener('online',onlineChanged);
      section.remove();
    },
  };
}
