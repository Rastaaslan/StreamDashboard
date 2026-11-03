/** F08: explicit operator-only reconciliation of a persisted FIXE prediction.
 * Read exact-ID evidence, request preview, and separately consent to local release.
 * No automatic requests, Twitch mutations, stored tokens or retry of uncertain commits.
 */
const BASE = '/api/v1/twitch/advanced/prediction/reconcile';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const terminal = status => status === 'resolved' || status === 'canceled';

export function mountTwitchPredictionRelease(root, { request } = {}) {
  const doc = root.ownerDocument, view = doc.defaultView;
  const section = doc.createElement('section');
  section.className = 'cockpit-twitch-prediction-release panel';
  section.setAttribute('aria-label', 'Réconcilier une prédiction Twitch');
  const header = doc.createElement('h3');
  header.textContent = 'Réconcilier une prédiction terminée';
  const explanation = doc.createElement('p');
  explanation.className = 'small muted';
  explanation.textContent = 'Contrôle manuel sur le FIXE : seule une prédiction enregistrée avec son identifiant Twitch et confirmée terminée peut libérer la réservation. Ne publie rien sur Twitch.';
  const inspect = doc.createElement('button');
  inspect.type = 'button'; inspect.textContent = 'Vérifier la réservation sur FIXE';
  const prepare = doc.createElement('button');
  prepare.type = 'button'; prepare.textContent = 'Préparer la libération locale';
  const confirmation = doc.createElement('div'); confirmation.hidden = true;
  const summary = doc.createElement('p');
  const label = doc.createElement('label');
  const checkbox = doc.createElement('input');
  checkbox.type = 'checkbox';
  const consent = doc.createElement('span');
  consent.textContent = 'Je confirme la fin vérifiée sur Twitch et la libération de la réservation locale FIXE.';
  label.append(checkbox, consent);
  const approve = doc.createElement('button');
  approve.type = 'button'; approve.textContent = 'Confirmer la libération sur FIXE';
  confirmation.append(summary, label, approve);
  const status = doc.createElement('p');
  status.className = 'small'; status.setAttribute('role', 'status');
  section.append(header, explanation, inspect, prepare, confirmation, status);
  root.append(section);

  let disposed = false, online = false, sourceKey = '', accountKey = '';
  let revision = 0, busy = false, released = false, uncertain = false;
  let eligible = false, pending, inFlightConfirm = false;
  const connected = () => !disposed && root.isConnected && online && !!sourceKey &&
    view?.navigator?.onLine !== false && doc.visibilityState !== 'hidden';
  const resetApproval = () => {
    pending = undefined; confirmation.hidden = true; checkbox.checked = false;
    summary.textContent = '';
  };
  const draw = () => {
    const ready = connected() && !busy && typeof request === 'function';
    inspect.disabled = !ready;
    prepare.disabled = !ready || !eligible || released || uncertain;
    checkbox.disabled = !ready || !pending;
    approve.disabled = !ready || !pending || !checkbox.checked || Date.now() >= pending.expiresAt;
  };
  const invalidate = reason => {
    revision++;
    if (inFlightConfirm) uncertain = true; // SQLite commit may have happened; NEVER replay.
    inFlightConfirm = false;
    busy = false; eligible = false; resetApproval();
    status.textContent = uncertain
      ? 'Résultat de libération incertain. Vérifiez manuellement le journal FIXE ; aucune nouvelle confirmation automatique.'
      : reason;
    draw();
  };
  const run = async (path, body, method, onResult, onError) => {
    if (!connected() || busy || typeof request !== 'function') return;
    const host = sourceKey, account = accountKey, current = ++revision;
    busy = true; draw();
    try {
      const data = await request(path, body, method, host);
      if (current === revision && connected() && sourceKey === host && accountKey === account) onResult(data);
    } catch (error) {
      if (current === revision && connected() && sourceKey === host && accountKey === account) onError(error);
    } finally {
      if (current === revision && !disposed) {
        // A detached UI may lose the receipt after the host committed the CAS.
        // Never turn the missing acknowledgement into a safe-to-retry claim.
        if (inFlightConfirm) {
          inFlightConfirm = false; uncertain = true; eligible = false;
          status.textContent = 'Reçu perdu après confirmation possible. Vérifiez le FIXE ; aucun renvoi automatique.';
        }
        busy = false; draw();
      }
    }
  };
  inspect.addEventListener('click', () => {
    if (!connected() || busy) return;
    eligible = false; resetApproval();
    status.textContent = 'Lecture explicite du journal FIXE et de Twitch…';
    void run(BASE, undefined, 'GET', data => {
      if (data?.schemaVersion !== 1 || data.kind !== 'streamcockpit-prediction-reconciliation' ||
          !['absent', 'unattributed', 'confirmed'].includes(data.reservation) ||
          !['unchecked', 'active', 'locked', 'resolved', 'canceled', 'not_found'].includes(data.providerStatus) ||
          data.unlockAvailable !== false || typeof data.manualReleasePreviewPossible !== 'boolean')
        throw Error('INVALID_RECONCILIATION');
      // A GET observation cannot prove whether a prior local DELETE committed.
      // Keep the uncertainty latch until a separately qualified host recovery.
      eligible = !uncertain && data.reservation === 'confirmed' && terminal(data.providerStatus) &&
        data.manualReleasePreviewPossible;
      status.textContent = uncertain
        ? 'Résultat de libération précédent incertain : lecture seule, aucune nouvelle confirmation autorisée. Vérifiez le journal FIXE.'
        : data.reservation === 'absent'
        ? 'Aucune réservation enregistrée sur cette chaîne. Aucune libération nécessaire.'
        : data.reservation === 'unattributed'
          ? 'Réservation sans identifiant Twitch vérifié : libération refusée.'
          : eligible
            ? 'Twitch confirme un état terminal (' + data.providerStatus + '). Préparation volontaire possible, aucune suppression encore effectuée.'
            : 'Réservation conservée : état Twitch ' + data.providerStatus + '. Aucune libération autorisée.';
    }, () => {
      eligible = false;
      status.textContent = 'Observation indisponible ou refusée par FIXE. La réservation reste inchangée.';
    });
  });
  prepare.addEventListener('click', () => {
    if (!connected() || busy || !eligible || uncertain || released) return;
    eligible = false; resetApproval();
    status.textContent = 'Nouvelle vérification Twitch avant consentement…';
    void run(BASE + '/preview', {}, 'POST', data => {
      if (data?.schemaVersion !== 1 || data.kind !== 'streamcockpit-prediction-release-preview' ||
          !UUID.test(data.confirmationId) || !terminal(data.providerStatus) ||
          !Number.isFinite(data.expiresAt) || data.expiresAt <= Date.now() ||
          data.expiresAt > Date.now() + 45_000) {
        status.textContent = 'Prévisualisation invalide, aucune confirmation possible.';
        return;
      }
      pending = { id: data.confirmationId, expiresAt: data.expiresAt };
      summary.textContent = 'État terminal revérifié : ' + data.providerStatus +
        '. Consentement à usage unique (45 secondes maximum). Seul le journal FIXE sera modifié.';
      confirmation.hidden = false;
      status.textContent = 'Prévisualisation reçue. Aucune réservation libérée.';
    }, () => {status.textContent = 'Prévisualisation refusée. Réservation FIXE inchangée.';});
  });
  checkbox.addEventListener('change', draw);
  approve.addEventListener('click', () => {
    if (!connected() || busy || !pending || !checkbox.checked || Date.now() >= pending.expiresAt) return;
    const id = pending.id;
    resetApproval();
    inFlightConfirm = true;
    status.textContent = 'Confirmation unique envoyée au FIXE ; aucune répétition automatique.';
    void run(BASE + '/confirm', { confirmationId: id, confirmed: true }, 'POST', data => {
      inFlightConfirm = false;
      if (data?.schemaVersion === 1 && data.kind === 'streamcockpit-prediction-release-confirmed' &&
          data.released === true && terminal(data.providerStatus)) {
        released = true; eligible = false; uncertain = false;
        status.textContent = 'Libération locale confirmée par le FIXE. Rechargez volontairement la vue avant une nouvelle création.';
      } else {
        uncertain = true; eligible = false;
        status.textContent = 'Reçu non vérifiable. État du journal FIXE incertain : contrôlez-le manuellement.';
      }
    }, () => {
      inFlightConfirm = false; uncertain = true; eligible = false;
      status.textContent = 'Résultat de la libération incertain. Contrôlez le FIXE ; aucun renvoi automatique.';
    });
  });
  const visibility = () => invalidate('Vue suspendue : vérification et consentement annulés.');
  const offline = () => invalidate('Hors ligne : aucune libération possible.');
  const onlineChanged = () => invalidate('Connexion retrouvée : nouvelle vérification volontaire nécessaire.');
  doc.addEventListener('visibilitychange', visibility);
  view?.addEventListener('offline', offline); view?.addEventListener('online', onlineChanged);
  status.textContent = 'Appareil hors ligne : aucune libération possible.'; draw();
  return {
    update(context = {}) {
      if (disposed) return;
      const source = typeof context.sourceKey === 'string' ? context.sourceKey : '';
      const account = typeof context.accountKey === 'string' ? context.accountKey : '';
      const available = context.online === true;
      if (sourceKey !== source || accountKey !== account || online !== available) {
        sourceKey = source; accountKey = account; online = available;
        invalidate(available ? 'Vérification volontaire requise.' : 'Source inaccessible.');
      }
      draw();
    },
    destroy() {
      if (disposed) return;
      invalidate('Vue fermée.'); disposed = true;
      doc.removeEventListener('visibilitychange', visibility);
      view?.removeEventListener('offline', offline); view?.removeEventListener('online', onlineChanged);
      section.remove();
    },
  };
}
