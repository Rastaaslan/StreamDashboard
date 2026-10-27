/**
 * Spotify controls only the Windows app on the selected trusted dashboard host.
 * It does not fetch tracks, transmit audio or use Spotify's web API.
 */
export function createSpotifyPanel(root, { request, notify = () => {} }) {
  const html = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
  let online = false, host = '', status = null, lastCheck = 0, busy = false, disposed = false, pending = null;
  root.className = 'spotify-panel panel';
  root.innerHTML = '<div class="spotify-heading"><div><h2>♫ Spotify</h2><p class="small muted" data-spotify-status>État à vérifier</p></div><button type="button" class="secondary" data-spotify-refresh>↻</button></div>'
    + '<div class="spotify-controls"><button type="button" class="secondary" data-spotify-action="previous" aria-label="Titre précédent">⏮</button>'
    + '<button type="button" data-spotify-action="play-pause">⏯ Lecture / pause</button>'
    + '<button type="button" class="secondary" data-spotify-action="next" aria-label="Titre suivant">⏭</button></div>'
    + '<p class="small muted" data-spotify-note>Contrôle du lecteur Windows local sur la régie. Aucun son Spotify n’est envoyé à OBS ou au public.</p>';
  const get = selector => root.querySelector(selector);
  function draw() {
    if (disposed) return;
    const text = !online ? 'Régie déconnectée : commande désactivée.'
      : !status ? 'Vérification du lecteur sur ' + host + '…'
      : status.available ? 'Spotify ouvert sur ' + host
      : status.supported ? 'Spotify fermé sur ' + host
      : 'Spotify disponible uniquement sur une régie Windows.';
    get('[data-spotify-status]').textContent = text;
    for (const button of root.querySelectorAll('[data-spotify-action]'))
      button.disabled = busy || !online || status?.available !== true;
    get('[data-spotify-refresh]').disabled = busy || !online;
  }
  async function refresh(force = false) {
    if (disposed || pending || !online || (!force && Date.now() - lastCheck < 20_000)) return;
    lastCheck = Date.now();
    const requestHost = host;
    pending = Promise.resolve().then(() => request('/api/v1/spotify/status', undefined, 'GET'));
    try {
      const current = await pending;
      if (disposed || !online || requestHost !== host) return;
      status = current;
    } catch {
      if (!disposed && requestHost === host) status = { available: false, supported: true };
    } finally {
      pending = null;
      draw();
    }
  }
  root.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || !root.contains(button)) return;
    event.stopPropagation();
    if (button.hasAttribute('data-spotify-refresh')) { void refresh(true); return; }
    const action = button.dataset.spotifyAction;
    if (!action || button.disabled || busy) return;
    busy = true; draw();
    void Promise.resolve().then(() => request('/api/v1/spotify/control', { action }, 'POST'))
      .then(receipt => notify(receipt.message || 'Commande Spotify envoyée (résultat à vérifier).'))
      .catch(error => notify('Spotify : ' + error.message))
      .finally(() => { busy = false; draw(); void refresh(true); });
  });
  draw();
  return {
    root,
    update(next) {
      if (disposed) return;
      if (host !== next.host) { status = null; lastCheck = 0; }
      host = html(next.host || 'ce PC');
      online = next.online === true;
      draw(); void refresh();
    },
    destroy() { disposed = true; },
  };
}
