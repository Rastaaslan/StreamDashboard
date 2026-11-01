/** Standalone read-only Android panel. No network, token, command or event handler. */
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const labels = { verified: 'Lecture autorisée et vérifiée', 'missing-scope': 'Autorisation OAuth manquante', unauthorized: 'Session expirée ou révoquée', forbidden: 'Permission Twitch refusée', 'rate-limited': 'Limite Twitch atteinte', unavailable: 'Twitch indisponible' };
export function twitchCapabilitiesMarkup(snapshot, now = Date.now()) {
  const fresh = snapshot && Number.isFinite(snapshot.checkedAt) && Number.isFinite(snapshot.validUntil) && snapshot.checkedAt <= now && snapshot.validUntil > now && now - snapshot.checkedAt < 60000;
  return `<section aria-label="Capacités Twitch"><h2>Permissions Twitch</h2><p>Lecture seule</p>${['shield', 'automod'].map(key => {
    const cap = fresh ? snapshot[key] : null;
    const label = cap ? labels[cap.status] || 'État inconnu' : 'Permissions à revérifier — données absentes ou périmées';
    return `<article><h3>${key === 'shield' ? 'Shield Mode' : 'AutoMod'}</h3><p>${escape(label)}</p><p>${cap?.manageScopeGranted === true ? 'Scope de modification présent ; commande non branchée.' : 'Modification indisponible.'}</p><small>${escape(Array.isArray(cap?.requiredAny) ? cap.requiredAny.join(' ou ') : '')}</small></article>`;
  }).join('')}</section>`;
}
export function renderTwitchCapabilities(container, snapshot, now = Date.now()) {
  container.innerHTML = twitchCapabilitiesMarkup(snapshot, now);
}
