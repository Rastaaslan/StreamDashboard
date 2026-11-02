// F08 prediction OBS-live read-only. No auto-poll, second Twitch authority or local cache.
const PATH = '/api/v1/twitch/advanced/prediction';
export function mountTwitchPrediction(root, {request} = {}) {
  const doc = root.ownerDocument, view = doc.defaultView;
  const section = doc.createElement('section');
  section.className = 'spacer cockpit-twitch-prediction';
  section.setAttribute('aria-label', 'Prédiction Twitch — lecture seule');
  const title = doc.createElement('h3'); title.textContent = 'Prédiction Twitch';
  const explanation = doc.createElement('p'); explanation.className = 'small muted';
  explanation.textContent = 'Lecture volontaire sur la régie FIXE. Création séparée ci-dessous ; verrouillage et résolution indisponibles.';
  const status = doc.createElement('p'); status.setAttribute('role', 'status'); status.className = 'small';
  const button = doc.createElement('button'); button.type = 'button';
  button.className = 'secondary'; button.textContent = 'Lire la prédiction en cours';
  section.append(title, explanation, status, button); root.append(section);
  let destroyed = false, online = false, sourceKey = '', accountKey = '';
  let generation = 0, flight, snapshot, expiryTimer, message = 'Source inaccessible.';
  const connected = () => !destroyed && root.isConnected && online &&
    view?.navigator.onLine !== false && doc.visibilityState !== 'hidden';
  function render() {
    button.disabled = !connected() || !sourceKey || typeof request !== 'function' || !!flight;
    if (!connected()) { status.textContent = message; return; }
    if (snapshot) {
      status.textContent = snapshot.status === 'none'
        ? 'Aucune prédiction active vérifiée sur Twitch.'
        : (snapshot.status === 'locked' ? 'Prédiction verrouillée : ' : 'Prédiction en cours : ') +
          snapshot.title + ' — ' + snapshot.outcomes.join(' / ');
    } else status.textContent = message;
  }
  function invalidate(reason) {
    generation++; snapshot = undefined; flight = undefined; clearTimeout(expiryTimer);
    message = reason; render();
  }
  async function refresh() {
    if (!connected() || !sourceKey || typeof request !== 'function' || flight) return;
    invalidate('Lecture Twitch en cours…');
    const revision = generation, source = sourceKey;
    const operation = Promise.resolve().then(async () => {
      if (!connected() || revision !== generation) return;
      try {
        const response = await request(PATH, undefined, 'GET', source);
        if (!connected() || revision !== generation || source !== sourceKey) return;
        if (response?.schemaVersion !== 1 || response.kind !== 'streamcockpit-prediction-snapshot' ||
            response.mutationAvailable !== false ||
            !Number.isFinite(response.checkedAt) || response.checkedAt > Date.now() + 5000 ||
            Date.now() - response.checkedAt > 30000 ||
            !['none', 'active', 'locked'].includes(response.status) ||
            (response.status !== 'none' && (typeof response.title !== 'string' ||
              !Array.isArray(response.outcomes) || response.outcomes.length < 2 ||
              response.outcomes.length > 10 || !response.outcomes.every(v => typeof v === 'string'))))
          throw new Error('INVALID_PREDICTION_SNAPSHOT');
        snapshot = response;
        message = '';
        // No unattended provider re-read. The last observation expires visibly.
        const remaining = Math.max(1, 30_000 - (Date.now() - response.checkedAt));
        expiryTimer = setTimeout(() => invalidate('Observation périmée : relire volontairement.'), remaining);
      } catch (error) {
        if (!connected() || revision !== generation || source !== sourceKey) return;
        message = error?.status === 403 ? 'Scope de prédictions Twitch manquant ou permissions refusées.' :
          error?.status === 409 ? 'Diffusion FIXE non confirmée. Aucune prédiction déduite.' :
          'Lecture non confirmée. Réessayez volontairement après vérification.';
      } finally {
        if (flight === operation) flight = undefined;
        if (!destroyed && revision === generation) render();
      }
    });
    flight = operation; render(); await operation;
  }
  const visibility = () => invalidate(doc.visibilityState === 'hidden' ? 'Vue suspendue.' : 'Source à revérifier.');
  const offline = () => invalidate('Hors ligne : aucune prédiction confirmée.');
  const onlineChanged = () => invalidate('Connexion rétablie : relire volontairement.');
  button.addEventListener('click', () => { void refresh(); });
  doc.addEventListener('visibilitychange', visibility);
  view?.addEventListener('offline', offline); view?.addEventListener('online', onlineChanged);
  render();
  return {
    refresh,
    update(context = {}) {
      if (destroyed) return;
      const nextSource = typeof context.sourceKey === 'string' ? context.sourceKey : '';
      const nextAccount = typeof context.accountKey === 'string' ? context.accountKey : '';
      const nextOnline = context.online === true;
      if (sourceKey !== nextSource || accountKey !== nextAccount || online !== nextOnline) {
        sourceKey = nextSource; accountKey = nextAccount; online = nextOnline;
        invalidate(!online ? 'Source inaccessible.' : 'Cliquer pour consulter sur Twitch.');
      }
      render();
    },
    destroy() {
      destroyed = true; invalidate('Vue fermée.');
      doc.removeEventListener('visibilitychange', visibility);
      view?.removeEventListener('offline', offline); view?.removeEventListener('online', onlineChanged);
      section.remove();
    },
  };
}
