// Read-only consumer of the injected, authenticated Live Monitor transport.
// The server route supplies Cache-Control: no-store. Never persist snapshots.
const PATH = '/api/v1/twitch/advanced/capabilities';
const labels = {
  available: 'Lecture autorisée et vérifiée',
  'missing-scope': 'Autorisation OAuth manquante',
  forbidden: 'Permission refusée',
  'rate-limited': 'Limite Twitch atteinte',
  unknown: 'État inconnu — permissions à revérifier',
};
export function normalizeAdvancedCapabilities(value, now = Date.now()) {
  const fresh = value && Number.isFinite(value.checkedAt) && Number.isFinite(value.validUntil)
    && value.checkedAt <= now && value.validUntil > now
    && value.validUntil > value.checkedAt && value.validUntil - value.checkedAt <= 60_000
    && now - value.checkedAt < 60_000 && typeof value.broadcasterId === 'string'
    && /^[0-9]{1,30}$/.test(value.broadcasterId);
  const status = cap => {
    if (!fresh || !cap || cap.mutationAvailable !== false) return 'unknown';
    if (cap.status === 'verified') return 'available';
    return ['missing-scope', 'forbidden', 'rate-limited'].includes(cap.status) ? cap.status : 'unknown';
  };
  return {shield: status(value?.shield), automod: status(value?.automod), expiresAt: fresh ? value.validUntil : 0};
}
export function mountTwitchAdvanced(root, {request} = {}) {
  const doc = root.ownerDocument, view = doc.defaultView;
  const section = doc.createElement('section');
  section.className = 'spacer'; section.setAttribute('aria-label', 'Permissions Twitch avancées');
  section.dataset.twitchAdvanced = '';
  const heading = doc.createElement('h3'); heading.textContent = 'Permissions Twitch';
  const note = doc.createElement('p'); note.className = 'small muted';
  note.textContent = 'Lecture seule sur la source du chat. Aucun état de diffusion publique ni commande de modération.';
  const status = doc.createElement('p'); status.className = 'small muted'; status.setAttribute('role', 'status');
  const rows = {};
  for (const key of ['shield', 'automod']) {
    const row = doc.createElement('p'); row.className = 'small'; row.dataset.twitchCapability = key; rows[key] = row;
  }
  const button = doc.createElement('button'); button.type = 'button'; button.className = 'secondary';
  button.textContent = 'Vérifier les permissions';
  section.append(heading, note, ...Object.values(rows), status, button); root.append(section);
  let disposed = false, online = false, sourceKey = '', accountKey = '', generation = 0, flight;
  let result, expiry, message = 'Source inaccessible.';
  const connected = () => !disposed && root.isConnected && online && view?.navigator.onLine !== false && doc.visibilityState !== 'hidden';
  function draw() {
    const current = connected() && result && result.expiresAt > Date.now() ? result : null;
    for (const key of ['shield', 'automod']) {
      const state = current?.[key] || 'unknown';
      rows[key].dataset.status = state;
      rows[key].textContent = (key === 'shield' ? 'Shield Mode' : 'AutoMod') + ' : ' + labels[state];
    }
    status.textContent = message;
    button.disabled = !connected() || !sourceKey || typeof request !== 'function' || Boolean(flight);
  }
  function invalidate(text) {
    generation++; flight = undefined; result = undefined; clearTimeout(expiry); message = text; draw();
  }
  async function refresh() {
    if (!connected() || !sourceKey || typeof request !== 'function' || flight) return;
    invalidate('Vérification en cours…');
    const revision = generation, target = sourceKey;
    const operation = Promise.resolve().then(async () => {
      if (!connected() || revision !== generation) return;
      try {
        const value = await request(PATH, undefined, 'GET', target);
        if (!connected() || revision !== generation || target !== sourceKey) return;
        result = normalizeAdvancedCapabilities(value);
        message = result.expiresAt ? 'Observation temporaire ; les modifications restent indisponibles.' : 'Réponse absente, périmée ou non vérifiable.';
        if (result.expiresAt) expiry = setTimeout(() => invalidate('Observation périmée. Vérifiez à nouveau les permissions.'), result.expiresAt - Date.now());
      } catch (error) {
        if (!connected() || revision !== generation || target !== sourceKey) return;
        const state = error?.status === 403 ? 'forbidden' : error?.status === 429 ? 'rate-limited' : 'unknown';
        result = {shield: state, automod: state, expiresAt: Date.now() + 60_000};
        message = error?.status === 401 ? 'Session expirée ou révoquée. Reconnectez la source.' : 'Lecture non confirmée. Aucune nouvelle tentative automatique.';
        expiry = setTimeout(() => invalidate('Permissions à revérifier.'), 60_000);
      } finally {
        if (flight === operation) flight = undefined;
        if (!disposed && revision === generation) draw();
      }
    });
    flight = operation; draw(); await operation;
  }
  const offline = () => invalidate('Hors ligne. Permissions non confirmées.');
  const visibility = () => invalidate(doc.visibilityState === 'hidden' ? 'Vue suspendue.' : 'Permissions à revérifier.');
  const onOnline = () => invalidate('Connexion rétablie. Vérifiez les permissions.');
  const click = () => { void refresh(); };
  button.addEventListener('click', click);
  view?.addEventListener('offline', offline); view?.addEventListener('online', onOnline);
  doc.addEventListener('visibilitychange', visibility);
  draw();
  return {
    update(context = {}) {
      if (disposed) return;
      const nextKey = typeof context.sourceKey === 'string' ? context.sourceKey : '';
      const nextOnline = context.online === true;
      const nextAccount = typeof context.accountKey === 'string' ? context.accountKey : '';
      const changed = sourceKey !== nextKey || online !== nextOnline || accountKey !== nextAccount;
      sourceKey = nextKey; online = nextOnline; accountKey = nextAccount;
      if (changed) {
        invalidate(!online ? 'Source inaccessible.' : typeof request !== 'function' ? 'Transport authentifié indisponible.' : 'Permissions à vérifier.');
        if (connected()) void refresh();
      }
      draw();
    },
    refresh,
    destroy() {
      disposed = true; invalidate('Vue fermée.');
      button.removeEventListener('click', click);
      view?.removeEventListener('offline', offline); view?.removeEventListener('online', onOnline);
      doc.removeEventListener('visibilitychange', visibility); section.remove();
    },
  };
}
