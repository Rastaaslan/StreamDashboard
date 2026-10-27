const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export function youtubeBroadcastStatus(status) {
  return ({ created: 'Créée', ready: 'Prête', testing: 'En test', testStarting: 'Test en cours de démarrage', liveStarting: 'Démarrage en cours', live: 'En direct', complete: 'Terminée', revoked: 'Révoquée' })[status] || status || 'État inconnu';
}

export function renderYouTubePicker({ items = [], channels = [], channelError = '', listError = '', selectedId = '' } = {}) {
  const names = new Map(channels.map(channel => [channel.id, channel.title || channel.id]));
  const identity = channels.length
    ? `<p class="youtube-identity"><b>Chaîne${channels.length > 1 ? 's' : ''} connectée${channels.length > 1 ? 's' : ''}</b><br>${channels.map(channel => `${esc(channel.title || channel.id)} <small>(${esc(channel.customUrl || channel.id)})</small>`).join('<br>')}</p>`
    : `<p class="warn">${esc(channelError || 'Aucune chaîne YouTube accessible avec le compte connecté.')}</p>`;
  const content = listError
    ? `<p class="warn">${esc(listError)}</p>`
    : items.length
      ? `<div class="youtube-broadcast-list">${items.map(item => {
        const date = item.scheduledStartTime ? new Date(item.scheduledStartTime) : null;
        const schedule = date && Number.isFinite(date.getTime()) ? date.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) : '';
        return `<section class="youtube-broadcast"><h3>${esc(item.title || item.id)}</h3><p class="small">${esc(youtubeBroadcastStatus(item.status))}${schedule ? ` · ${esc(schedule)}` : ''}</p><p class="small muted">${esc(names.get(item.channelId) || item.channelId)} · ${item.bound ? 'Flux de diffusion associé' : 'Flux à associer dans YouTube Studio'}</p><p class="small muted">ID : ${esc(item.id)}${item.id === selectedId ? ' · Choix enregistré' : ''}</p><button type="button" class="secondary" data-broadcast="${esc(item.id)}" data-channel="${esc(item.channelId)}">Choisir et enregistrer</button></section>`;
      }).join('')}</div>`
      : '<p>Aucune diffusion à venir ou en cours trouvée pour ce compte. Vérifiez la chaîne affichée ci-dessus et le live dans YouTube Studio. Un événement du planning ou de Google Calendar ne crée pas à lui seul une diffusion YouTube.</p>';
  return `<h2>Choisir une diffusion YouTube</h2>${identity}<p class="small muted">Cette liste retrouve les diffusions préparées sur votre chaîne. Le bouton enregistre la diffusion à utiliser pour la préparation et le prochain lancement.</p>${content}<div class="form-actions"><button type="button" data-task="youtube-create">Nouvelle diffusion YouTube…</button><button type="button" class="secondary" data-task="youtube-broadcasts">Actualiser la liste</button><button type="button" class="secondary" data-task="close-dialog">Fermer</button></div>`;
}
