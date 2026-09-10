const pages = [
  ['overview', 'Vue d’ensemble', '⌂'], ['prepare', 'Préparer', '✓'], ['live', 'Live', '●'], ['planning', 'Planning', '▣'],
  ['deck', 'Control Deck', '⌘'], ['fun', 'Fun Deck', '✦'], ['diagnostics', 'Diagnostics', '◫'], ['settings', 'Réglages', '⚙'],
];
let page = 'overview', state, remotePairing = null, editingEventId = null;
const pending = new Set();
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

async function request(url, method = 'GET', body) {
  const response = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  let value;
  try { value = await response.json(); } catch { throw Error(`HTTP ${response.status}`); }
  if (!response.ok) throw Error(value.error?.message || value.error || `HTTP ${response.status}`);
  return value;
}
const messages = {
  'checklist.toggle': 'Checklist mise à jour', 'checklist.reset': 'Checklist réinitialisée', 'timer.start': 'Timer démarré', 'timer.pause': 'Timer en pause',
  'timer.reset': 'Timer réinitialisé', 'timer.add': 'Temps ajouté', 'session.start': 'Diffusion démarrée', 'session.stop': 'Diffusion arrêtée',
  'obs.scene': 'Scène OBS activée', 'obs.mute': 'Audio OBS mis à jour', 'obs.volume': 'Volume OBS mis à jour', 'obs.volumeDb': 'Volume OBS mis à jour',
  'obs.browser.refresh': 'Source timer OBS rafraîchie', 'mode.set': 'Mode et scène OBS activés',
};
async function command(type, details = {}) {
  const key = type + JSON.stringify(details); if (pending.has(key)) return;
  pending.add(key);
  try {
    const result = await request('/api/v1/commands', 'POST', { type, ...details });
    applyStateUpdate(result.state);
    if (type === 'session.start' && result.state.obs.streaming) { page = 'live'; nav(); render(); }
    toast(messages[type] || 'Commande exécutée');
    return result.state;
  } catch (error) {
    if (error.message.includes('Certaines vérifications') && type === 'session.start' && confirm(`${error.message}\n\nLancer quand même ?`)) return command(type, { ...details, force: true });
    toast(error.message, true); return undefined;
  } finally { pending.delete(key); }
}
async function refresh(force = false) { applyStateUpdate(await request('/api/v1/state'), force); }
function toast(text, bad = false) { const element = $('#toast'); if (!element) return; element.textContent = text; element.className = bad ? 'show bad' : 'show'; setTimeout(() => { element.className = ''; }, 2800); }
function duration(seconds) { const value = Math.max(0, seconds || 0); return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`; }
function date(value) { return new Date(value).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }); }
function datetimeLocal(value) { const date = new Date(value); const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000); return local.toISOString().slice(0, 16); }
function card(label, value, sub = '', wide = '') { return `<article class="card ${esc(wide)}"><span class="label">${esc(label)}</span><strong class="metric">${value}</strong><small>${esc(sub)}</small></article>`; }
function timerRemaining() { return state?.timer.running && state.timer.deadline ? Math.max(0, Math.ceil((state.timer.deadline - Date.now()) / 1000)) : state?.timer.remaining || 0; }
function inputDb(input) { if (Number.isFinite(input.volumeDb)) return input.volumeDb; return input.volume > 0 ? 20 * Math.log10(input.volume) : -100; }
function providerBadge(item, provider) { const link = item.providers?.[provider]; const status = link?.status ?? 'not-published'; const labels = { synced: 'OK', pending: 'SYNC…', error: 'ERREUR', conflict: 'CONFLIT', 'not-published': 'NON PUBLIÉ' }; return `<span class="tag">${provider.toUpperCase()} · ${labels[status] || status}</span>`; }

function nav() {
  $('nav').innerHTML = pages.map(([id, label, icon]) => `<button data-page="${id}" class="${id === page ? 'active' : ''}"><span>${icon}</span>${label}</button>`).join('');
  document.querySelectorAll('[data-page]').forEach(button => { button.onclick = () => window.go(button.dataset.page); });
}
function overview() {
  const next = state.nextLive, done = state.checklist.filter(item => item.done).length;
  return `<div class="hero"><div><span class="kicker">BONJOUR, ${esc(state.settings.streamerName).toUpperCase()}</span><h2>${state.obs.streaming ? 'Le direct est en cours.' : 'Prêt à lancer votre prochain live ?'}</h2><p>${next ? `${esc(next.title)} · ${date(next.startAtUtc)}` : 'Ajoutez votre prochain live au planning.'}</p></div><button class="primary big" data-action="go" data-value="prepare">Préparer le live <b>→</b></button></div><div class="grid stats">${card('OBS', state.obs.connected ? 'Connecté' : 'Hors ligne', state.obs.scene || state.obs.error || 'Mode autonome')}${card('Diffusion', state.obs.streaming ? 'EN DIRECT' : 'HORS LIGNE', state.obs.recording ? 'Enregistrement actif' : 'Aucun enregistrement')}${card('Préparation', `${done}/${state.checklist.length}`, state.preflight?.status === 'ready' ? 'Infos Twitch prêtes' : 'Éléments validés')}${card('Timer', duration(timerRemaining()), state.timer.running ? 'Compte à rebours actif' : 'En attente')}</div><div class="section-head"><div><span class="label">ACCÈS RAPIDE</span><h3>Piloter sans quitter le cockpit</h3></div></div><div class="quick"><button data-action="go" data-value="live"><i>●</i><b>Console Live</b><small>Diffusion, timer et séquences</small></button><button data-action="go" data-value="deck"><i>⌘</i><b>Control Deck</b><small>Scènes et audio OBS</small></button><button data-action="go" data-value="planning"><i>▣</i><b>Planning</b><small>Organiser les prochains lives</small></button></div>`;
}
function preflightBlock() {
  const value = state.preflight;
  if (!value || value.status === 'idle') return '<div class="panel space"><span class="label">INFOS TWITCH</span><p class="muted">Le prochain live sera analysé pendant Préparer.</p></div>';
  const label = { preparing: 'Préparation…', ready: 'Prêt', 'action-required': 'Action requise', error: 'Erreur' }[value.status] || value.status;
  return `<div class="panel space"><span class="label">INFOS TWITCH · ${esc(label)}</span><h3>${esc(value.title || 'Prochain live')}</h3><p>${esc(value.category || 'Catégorie non définie')}${value.gameId ? ` · ID ${esc(value.gameId)}` : ''}</p>${value.error ? `<p class="muted">⚠ ${esc(value.error)}</p>` : ''}</div>`;
}
function prepare() {
  const done = state.checklist.filter(item => item.done).length, percent = state.checklist.length ? done / state.checklist.length * 100 : 0;
  const timerSource = state.settings.timerBrowserSource;
  return `${preflightBlock()}<div class="panel"><div class="section-head"><div><span class="label">CHECKLIST AVANT LIVE</span><h3 id="check-count">${done}/${state.checklist.length} vérifications terminées</h3></div><div class="button-row"><button class="ghost compact" data-command="checklist.reset">Réinitialiser</button>${timerSource ? `<button class="ghost compact" data-command="obs.browser.refresh" data-value="${encodeURIComponent(timerSource)}">Rafraîchir timer OBS</button>` : ''}</div></div><div class="progress"><i id="check-progress" style="width:${percent}%"></i></div><div class="checklist">${state.checklist.map(item => `<button class="check ${item.done ? 'done' : ''}" data-check-id="${esc(item.id)}" data-command="checklist.toggle" data-value="${encodeURIComponent(item.id)}"><i>${item.done ? '✓' : ''}</i><span><b>${esc(item.label)}</b><small>${item.done ? 'Validé' : 'À vérifier'}</small></span></button>`).join('')}</div><div class="launch"><div><b id="prepare-status">${done === state.checklist.length ? 'Tout est prêt' : 'Préparation incomplète'}</b><small id="prepare-obs">${state.obs.connected ? `OBS répond correctement. Démarrage prévu sur ${esc(state.settings.startMode === 'live' ? 'Live' : 'Intro')}.` : esc(state.obs.error || 'OBS est hors ligne : connectez-le avant de diffuser.')}</small></div><button class="primary" ${!state.obs.connected || state.obs.streaming ? 'disabled' : ''} data-command="session.start">${state.obs.streaming ? 'Live déjà actif' : 'Démarrer le live'}</button></div></div>`;
}
function live() {
  const offline = !state.obs.connected, timerSource = state.settings.timerBrowserSource;
  return `<div class="live-console"><div class="timer-block"><span class="label">TIMER DE SESSION</span><strong id="timer-value">${duration(timerRemaining())}</strong><div class="button-row"><button class="primary" data-command="${state.timer.running ? 'timer.pause' : 'timer.start'}">${state.timer.running ? 'Pause' : 'Démarrer'}</button><button class="ghost" data-command="timer.add" data-seconds="300">+ 5 min</button><button class="ghost" data-command="timer.reset">Reset</button>${timerSource ? `<button class="ghost" data-command="obs.browser.refresh" data-value="${encodeURIComponent(timerSource)}">Refresh OBS</button>` : ''}</div></div><div class="panel"><span class="label">ÉTAT DU DIRECT</span><h3>${offline ? 'OBS est hors ligne' : state.obs.streaming ? 'Vous êtes en direct' : 'Diffusion arrêtée'}</h3><p class="muted">Scène active : <b>${esc(state.obs.scene || 'Aucune')}</b></p><div class="mode-row">${['intro', 'live', 'pause', 'end'].map(mode => `<button class="mode ${state.mode === mode ? 'active' : ''}" ${offline ? 'disabled' : ''} data-command="mode.set" data-value="${mode}">${mode}</button>`).join('')}</div><button class="${state.obs.streaming ? 'danger' : 'primary'} full-button" ${offline ? 'disabled' : ''} data-command="${state.obs.streaming ? 'session.stop' : 'session.start'}">${offline ? 'OBS indisponible' : state.obs.streaming ? 'Arrêter la diffusion' : 'Démarrer le live'}</button></div></div>`;
}
function planningActions(item) {
  const actions = [`<button class="ghost compact" data-action="edit-event" data-value="${encodeURIComponent(item.id)}">Modifier</button>`];
  for (const provider of ['twitch', 'google']) {
    const link = item.providers?.[provider];
    if (link?.status === 'error' && !item.conflict) actions.push(`<button class="ghost compact" data-action="retry-provider" data-provider="${provider}" data-value="${encodeURIComponent(item.id)}">Retry ${provider}</button>`);
  }
  if (item.conflict) {
    const provider = item.conflict.provider;
    actions.push(`<button class="ghost compact" data-action="resolve-conflict" data-provider="${provider}" data-strategy="remote" data-value="${encodeURIComponent(item.id)}">Garder ${provider}</button>`);
    actions.push(`<button class="ghost compact" data-action="resolve-conflict" data-provider="${provider}" data-strategy="local" data-value="${encodeURIComponent(item.id)}">Garder local</button>`);
  }
  actions.push(`<button class="icon-btn" data-action="remove-event" data-value="${encodeURIComponent(item.id)}">×</button>`);
  return actions.join('');
}
function planning() {
  const rows = [...state.planning].sort((a, b) => Date.parse(a.startAtUtc) - Date.parse(b.startAtUtc));
  const googleText = !state.google?.configured ? 'Google non configuré' : state.google.connected ? `Google connecté${state.google.lastSyncedAt ? ` · synchro ${date(state.google.lastSyncedAt)}` : ''}` : 'Google non connecté';
  return `<div class="section-head"><div><span class="label">PLANNING SYNCHRONISÉ</span><h3>Prochains rendez-vous</h3><small class="muted">${state.twitch.connected ? `Twitch · ${esc(state.twitch.displayName)}` : 'Twitch non connecté'} · ${esc(googleText)}</small></div><div class="button-row">${state.twitch.connected ? `<button class="ghost compact" ${state.twitch.syncing ? 'disabled' : ''} data-action="sync-twitch">↻ Twitch</button>` : ''}${state.google?.connected && state.google.targetCalendarId ? '<button class="ghost compact" data-action="sync-google">↻ Google</button>' : ''}<button class="primary compact" data-action="open-event">+ Ajouter</button></div></div><div class="schedule">${rows.map(item => `<article><time><b>${new Date(item.startAtUtc).toLocaleDateString('fr-FR', { day: '2-digit' })}</b>${new Date(item.startAtUtc).toLocaleDateString('fr-FR', { month: 'short' })}</time><div><div>${providerBadge(item, 'twitch')} ${providerBadge(item, 'google')}</div><h3>${esc(item.title)}</h3><p>${date(item.startAtUtc)} — ${date(item.endAtUtc)}</p>${item.twitchCategoryName ? `<p class="muted">Twitch : ${esc(item.twitchCategoryName)}</p>` : ''}${item.conflict ? `<p class="muted">⚠ Conflit ${esc(item.conflict.provider)} : choisis explicitement la version à garder.</p>` : ''}${item.syncError ? `<p class="muted">⚠ ${esc(item.syncError)}</p>` : ''}${item.providers?.twitch?.lastError ? `<p class="muted">Twitch : ${esc(item.providers.twitch.lastError)}</p>` : ''}${item.providers?.google?.lastError ? `<p class="muted">Google : ${esc(item.providers.google.lastError)}</p>` : ''}</div><div class="button-row">${planningActions(item)}</div></article>`).join('') || '<div class="empty"><b>Aucun événement planifié</b><p>Votre planning est prêt à accueillir un premier live.</p></div>'}</div><dialog id="event-dialog"><form id="event-form"><div class="section-head"><h3 id="event-dialog-title">Nouveau rendez-vous</h3><button type="button" class="icon-btn" data-action="close-dialog">×</button></div><label>Titre<input name="title" maxlength="140" required></label><div class="form-grid"><label>Début<input name="start" type="datetime-local" required></label><label>Fin<input name="end" type="datetime-local" required></label></div><label>Type<select name="category"><option value="live">Live</option><option value="production">Production</option><option value="personal">Personnel</option></select></label><label>Catégorie/jeu Twitch<input name="twitchCategoryName" maxlength="140" placeholder="Ex. Counter-Strike 2"></label><div id="publication-options" class="form-grid"><label class="switch"><span><b>Publier sur Twitch</b></span><input name="publishTwitch" type="checkbox"></label><label class="switch"><span><b>Publier sur Google</b></span><input name="publishGoogle" type="checkbox"></label></div><button class="primary" type="submit">Enregistrer</button></form></dialog>`;
}
function deck() {
  const obs = state.obs;
  if (!obs.connected) return `<div class="section-head"><div><span class="label">OBS WEBSOCKET</span><h3>Scènes</h3></div><span class="status">Indisponible</span></div><div class="empty">${esc(obs.error || 'Lancez OBS pour charger vos scènes et votre mixeur.')}</div>`;
  const inputs = Object.entries(obs.inputs).filter(([name]) => obs.activeAudioInputs.includes(name));
  return `<div class="section-head"><div><span class="label">OBS WEBSOCKET</span><h3>Scènes</h3></div><span class="status ok">Connecté</span></div><div class="deck">${obs.scenes.map(scene => `<button class="pad ${obs.scene === scene ? 'active' : ''}" data-command="obs.scene" data-value="${encodeURIComponent(scene)}"><i>▣</i><b>${esc(scene)}</b></button>`).join('') || '<div class="empty">Aucune scène OBS détectée.</div>'}</div><div class="section-head space"><div><h3>Mixeur audio contextuel</h3><small class="muted">Échelle dB cohérente avec OBS.</small></div><span class="status ${inputs.length ? 'ok' : ''}">${inputs.length}/${Object.keys(obs.inputs).length} actives</span></div><div class="mixer">${inputs.map(([name, input]) => { const db = Math.max(-60, Math.min(6, inputDb(input))); return `<article><button class="mute ${input.muted ? 'muted' : ''}" data-command="obs.mute" data-value="${encodeURIComponent(name)}" data-muted="${!input.muted}">◉</button><div><b>${esc(name)}</b><input type="range" min="-60" max="6" step="1" value="${db}" data-command="obs.volumeDb" data-value="${encodeURIComponent(name)}"></div><span>${db <= -59.5 ? '-∞' : db.toFixed(1)} dB</span></article>`; }).join('') || '<p class="muted">Aucune source audio active dans cette scène.</p>'}</div>`;
}
function fun() {
  const media = state.obs.connected ? state.obs.mediaInputs || [] : [];
  return `<div class="section-head"><div><span class="label">FUN DECK · OBS</span><h3>Médias instantanés</h3></div><span class="status ${state.obs.connected ? 'ok' : ''}">${state.obs.connected ? 'OBS connecté' : 'OBS indisponible'}</span></div><div class="deck fun">${media.map(name => `<button class="pad" data-command="obs.media.restart" data-value="${encodeURIComponent(name)}"><i>▶</i><b>${esc(name)}</b><small>Relancer la source OBS</small></button>`).join('') || '<div class="empty"><b>Aucun média OBS détecté</b></div>'}</div>`;
}
function diagnostics() {
  const runtime = state.runtime;
  return `<div class="grid">${Object.entries(state.health).map(([name, health]) => card(name, `<span class="${health.ok ? 'green' : 'red'}">${health.ok ? 'Opérationnel' : 'Attention'}</span>`, health.detail)).join('')}</div><div class="panel space"><div class="section-head"><span class="label">INFORMATIONS TECHNIQUES</span>${window.streamDashboardDesktop ? '<button class="ghost compact" data-action="open-logs">Ouvrir les logs</button>' : ''}</div><div class="details"><span>StreamDashboard <b>${esc(runtime.serverVersion)}</b></span><span>Electron <b>${esc(runtime.electronVersion || 'mode serveur')}</b></span><span>Node <b>${esc(runtime.nodeVersion)}</b></span><span>Système <b>${esc(runtime.platform)}</b></span><span>Port <b>${runtime.port}</b></span><span>Dernière mise à jour <b>${date(state.at)}</b></span></div></div>`;
}
function obsRuntime() { return state.obs.connected ? `<div class="status ok">OBS connecté${state.obs.obsVersion ? ` · v${esc(state.obs.obsVersion)}` : ''}</div>` : `<div class="status">${esc(state.obs.error || 'OBS non connecté')}</div>`; }
function twitchRuntime() { return `<div class="status ${state.twitch.connected ? 'ok' : ''}">${state.twitch.connected ? `Connecté en tant que ${esc(state.twitch.displayName)}` : esc(state.twitch.error || 'Twitch non connecté')}</div>${state.twitch.deviceAuthorization ? `<div class="device-code"><small>CODE TWITCH</small><strong>${esc(state.twitch.deviceAuthorization.userCode)}</strong><small>Validez ce code avant ${date(state.twitch.deviceAuthorization.expiresAt)}.</small></div>` : ''}<div class="button-row">${state.twitch.connected ? '<button class="ghost" type="button" data-action="disconnect-twitch">Déconnecter Twitch</button>' : '<button class="ghost" type="button" data-action="connect-twitch">Connecter Twitch</button>'}</div>`; }
function googleRuntime() {
  if (!state.google?.configured) return '<div class="status">Google Calendar non configuré dans cette distribution (GOOGLE_CLIENT_ID manquant).</div>';
  const calendar = state.google.targetCalendarId ?? '';
  return `<div class="status ${state.google.connected ? 'ok' : ''}">${state.google.connected ? 'Google Calendar connecté' : esc(state.google.error || 'Google Calendar non connecté')}</div>${state.google.connected ? `<label>Calendrier cible<select id="google-calendar-target"><option value="">Choisir…</option>${state.google.calendars.map(x => `<option value="${esc(x.id)}" ${calendar === x.id ? 'selected' : ''} ${!x.writable ? 'disabled' : ''}>${esc(x.summary)}${x.writable ? '' : ' (lecture seule)'}</option>`).join('')}</select></label><div class="button-row"><button class="ghost" type="button" data-action="sync-google">Synchroniser Google</button><button class="ghost" type="button" data-action="disconnect-google">Déconnecter Google</button></div>` : '<button class="ghost" type="button" data-action="connect-google">Connecter Google Calendar</button>'}`;
}
function remoteRuntime() {
  const enabled = state.remote?.enabled === true, configured = state.settings.remoteEnabled === true, devices = state.remote?.devices ?? [];
  return `<label class="switch"><span><b>Télécommande LAN</b><small>${enabled ? 'Active sur ce démarrage' : configured ? 'Redémarrage requis pour l’activer' : 'Désactivée par défaut'}</small></span><input name="remoteEnabled" type="checkbox" ${configured ? 'checked' : ''}></label>${enabled ? `<div class="button-row"><button class="ghost" type="button" data-action="create-pairing">Ajouter une télécommande</button></div>${remotePairing ? `<div class="device-code"><small>ID DE PAIRING</small><strong>${esc(remotePairing.id)}</strong><small>CODE</small><strong>${esc(remotePairing.code)}</strong>${remotePairing.urls?.map(x => `<small>${esc(x)}</small>`).join('') || ''}<small>Expire : ${date(remotePairing.expiresAt)}</small></div>` : ''}<div class="details">${devices.filter(x => !x.revokedAt).map(x => `<span>${esc(x.name)} · ${esc(x.lastSeenAt || 'jamais')} <button class="ghost compact" type="button" data-action="revoke-device" data-value="${encodeURIComponent(x.id)}">Révoquer</button></span>`).join('') || '<span>Aucune télécommande appairée.</span>'}</div>` : ''}`;
}
function settings() {
  const browsers = state.obs.browserInputs || [];
  return `<form class="panel settings" id="settings-form"><span class="label">PRÉFÉRENCES DU COCKPIT</span><label>Nom affiché<input name="streamerName" maxlength="80" value="${esc(state.settings.streamerName)}"></label><label>Couleur d’accent<select name="accent"><option value="violet">Violet</option><option value="cyan">Cyan</option><option value="rose">Rose</option></select></label><label class="switch"><span><b>Confirmer l’arrêt du live</b><small>Évite les arrêts accidentels</small></span><input name="confirmStop" type="checkbox" ${state.settings.confirmStop ? 'checked' : ''}></label><span class="label section-label">CONNEXION OBS</span><label class="switch"><span><b>Lancer OBS avec StreamDashboard</b></span><input name="launchObs" type="checkbox" ${state.settings.launchObs ? 'checked' : ''}></label><label>Chemin OBS Studio<input name="obsExecutablePath" maxlength="500" value="${esc(state.settings.obsExecutablePath || '')}"></label><label>Adresse OBS WebSocket<input name="obsUrl" value="${esc(state.settings.obsUrl)}"></label><label>Mot de passe OBS<input name="obsPassword" type="password" maxlength="500" autocomplete="new-password" placeholder="${state.settings.obsPasswordSet ? 'Mot de passe enregistré — laisser vide pour conserver' : 'Mot de passe WebSocket OBS'}"></label>${state.settings.obsPasswordSet ? '<label class="switch"><span><b>Effacer le mot de passe OBS enregistré</b></span><input name="clearObsPassword" type="checkbox"></label>' : ''}<div id="obs-runtime">${obsRuntime()}</div><label>Scène au clic « Démarrer le live »<select name="startMode"><option value="intro" ${state.settings.startMode !== 'live' ? 'selected' : ''}>Intro (recommandé)</option><option value="live" ${state.settings.startMode === 'live' ? 'selected' : ''}>Live / Gameplay</option></select><small>La scène choisie est envoyée à OBS puis confirmée avant StartStream.</small></label><label>Browser Source du timer<select name="timerBrowserSource"><option value="">Non configurée</option>${browsers.map(name => `<option value="${esc(name)}" ${state.settings.timerBrowserSource === name ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select><small>Cette source sera rafraîchie sans cache à Préparer et juste avant Start.</small></label><span class="label section-label">SCÈNES PAR MODE</span><div class="form-grid">${['intro', 'live', 'pause', 'end'].map(mode => `<label>Scène ${mode}<select name="scene-${mode}"><option value="">Non configurée</option>${state.obs.scenes.map(scene => `<option value="${esc(scene)}" ${state.settings.modeScenes?.[mode] === scene ? 'selected' : ''}>${esc(scene)}</option>`).join('')}</select></label>`).join('')}</div><span class="label section-label">TWITCH</span><div id="twitch-runtime">${twitchRuntime()}</div><span class="label section-label">GOOGLE CALENDAR</span><div id="google-runtime">${googleRuntime()}</div><span class="label section-label">TÉLÉCOMMANDE</span><div id="remote-runtime">${remoteRuntime()}</div><div class="button-row"><button class="ghost" type="button" data-action="test-obs">Tester OBS</button><button class="primary" type="submit">Enregistrer</button></div></form>`;
}

function render() {
  if (!state) return;
  document.documentElement.dataset.accent = state.settings.accent;
  $('#title').textContent = pages.find(item => item[0] === page)[1]; updateHeader();
  const views = { overview, prepare, live, planning, deck, fun, diagnostics, settings }; $('#view').innerHTML = views[page](); bindForms();
}
function updateHeader() { $('#obs-pill').textContent = `OBS ${state.obs.connected ? 'CONNECTÉ' : 'HORS LIGNE'}`; $('#obs-pill').className = `obs-pill ${state.obs.connected ? 'ok' : ''}`; $('#live-pill').textContent = state.obs.streaming ? '● EN DIRECT' : 'HORS LIGNE'; $('#live-pill').className = `live-pill ${state.obs.streaming ? 'on' : ''}`; }
function dirtyForm() { return document.querySelector('#view form[data-dirty="true"]'); }
function updateSettingsRuntime() { const obs = $('#obs-runtime'), twitch = $('#twitch-runtime'), google = $('#google-runtime'), remote = $('#remote-runtime'); if (obs) obs.innerHTML = obsRuntime(); if (twitch) twitch.innerHTML = twitchRuntime(); if (google) google.innerHTML = googleRuntime(); if (remote) remote.innerHTML = remoteRuntime(); }
function applyStateUpdate(next, force = false) {
  const previous = state; state = next;
  if (!previous || force) { render(); return; }
  document.documentElement.dataset.accent = state.settings.accent; updateHeader(); updateTimer(); if (page === 'prepare') updateChecklist();
  const structural = page === 'overview' || page === 'prepare' || page === 'planning'
    || page === 'deck' && JSON.stringify([previous.obs.connected, previous.obs.scenes, previous.obs.activeAudioInputs, previous.obs.inputs, previous.obs.scene]) !== JSON.stringify([state.obs.connected, state.obs.scenes, state.obs.activeAudioInputs, state.obs.inputs, state.obs.scene])
    || page === 'live' && JSON.stringify([previous.obs.connected, previous.obs.streaming, previous.mode, previous.obs.scene, previous.timer.running, previous.settings.timerBrowserSource]) !== JSON.stringify([state.obs.connected, state.obs.streaming, state.mode, state.obs.scene, state.timer.running, state.settings.timerBrowserSource])
    || page === 'fun' && JSON.stringify([previous.obs.connected, previous.obs.mediaInputs]) !== JSON.stringify([state.obs.connected, state.obs.mediaInputs])
    || page === 'settings' && JSON.stringify([previous.obs.connected, previous.obs.error, previous.obs.scenes, previous.obs.browserInputs, previous.twitch, previous.google, previous.remote, previous.settings]) !== JSON.stringify([state.obs.connected, state.obs.error, state.obs.scenes, state.obs.browserInputs, state.twitch, state.google, state.remote, state.settings]);
  if (!structural) return; if (dirtyForm()) { if (page === 'settings') updateSettingsRuntime(); return; } render();
}
function updateTimer() { const element = $('#timer-value'); if (element) element.textContent = duration(timerRemaining()); if (page === 'overview') { const metric = document.querySelector('.stats .card:nth-child(4) .metric'); if (metric) metric.textContent = duration(timerRemaining()); } }
function updateChecklist() { const done = state.checklist.filter(item => item.done).length, count = $('#check-count'), bar = $('#check-progress'), status = $('#prepare-status'), obs = $('#prepare-obs'), start = document.querySelector('.launch [data-command="session.start"]'); if (count) count.textContent = `${done}/${state.checklist.length} vérifications terminées`; if (bar) bar.style.width = `${state.checklist.length ? done / state.checklist.length * 100 : 0}%`; if (status) status.textContent = done === state.checklist.length ? 'Tout est prêt' : 'Préparation incomplète'; if (obs) obs.textContent = state.obs.connected ? `OBS répond correctement. Démarrage prévu sur ${state.settings.startMode === 'live' ? 'Live' : 'Intro'}.` : state.obs.error || 'OBS est hors ligne.'; if (start) { start.disabled = !state.obs.connected || state.obs.streaming; start.textContent = state.obs.streaming ? 'Live déjà actif' : 'Démarrer le live'; } }

async function prepareLive() {
  page = 'prepare'; nav(); render();
  if (state.obs.connected) { await command('session.prepare'); return; }
  if (!window.streamDashboardDesktop?.ensureObsRunning) { toast('OBS n’est pas lancé. Le lancement automatique est disponible dans l’application Desktop.', true); return; }
  try {
    toast('Lancement OBS…'); const result = await window.streamDashboardDesktop.ensureObsRunning(); const alreadyRunning = /déjà lancé/i.test(result.detail);
    if (!result.launched && !alreadyRunning) { toast(result.detail, true); return; } toast(result.detail);
    const deadline = Date.now() + 45_000; let wait = 400;
    while (Date.now() < deadline) { await new Promise(resolve => setTimeout(resolve, wait)); const next = await request('/api/v1/state'); applyStateUpdate(next); if (next.obs.connected) { await command('session.prepare'); toast('OBS connecté · préparation terminée'); return; } wait = Math.min(2_000, Math.round(wait * 1.5)); }
    toast('OBS est lancé mais le WebSocket ne répond toujours pas.', true);
  } catch (error) { toast(`Impossible de lancer OBS : ${error.message}`, true); }
}
function bindForms() {
  const eventForm = $('#event-form');
  if (eventForm) eventForm.onsubmit = async event => {
    event.preventDefault(); const form = new FormData(eventForm);
    try {
      const payload = { title: form.get('title'), startAtUtc: new Date(form.get('start')).toISOString(), endAtUtc: new Date(form.get('end')).toISOString(), category: form.get('category'), twitchCategoryName: form.get('twitchCategoryName') || undefined };
      const result = editingEventId
        ? await request(`/api/v1/planning/${encodeURIComponent(editingEventId)}`, 'PUT', payload)
        : await request('/api/v1/planning', 'POST', { ...payload, desiredPublication: { local: true, twitch: form.get('publishTwitch') === 'on', google: form.get('publishGoogle') === 'on' } });
      editingEventId = null; eventForm.dataset.dirty = 'false'; applyStateUpdate(result, true); $('#event-dialog')?.close();
    } catch (error) { toast(error.message, true); }
  };
  const settingsForm = $('#settings-form');
  if (settingsForm) {
    settingsForm.elements.accent.value = state.settings.accent;
    settingsForm.onsubmit = async event => { event.preventDefault(); const form = new FormData(settingsForm); const beforeRemote = state.remote?.enabled === true; const payload = { streamerName: form.get('streamerName'), obsExecutablePath: form.get('obsExecutablePath'), accent: form.get('accent'), confirmStop: form.get('confirmStop') === 'on', launchObs: form.get('launchObs') === 'on', remoteEnabled: form.get('remoteEnabled') === 'on', startMode: form.get('startMode'), timerBrowserSource: form.get('timerBrowserSource'), obsUrl: form.get('obsUrl'), modeScenes: Object.fromEntries(['intro', 'live', 'pause', 'end'].map(mode => [mode, form.get(`scene-${mode}`)]).filter(([, scene]) => scene)) }; const clearPassword = form.get('clearObsPassword') === 'on', password = form.get('obsPassword'); if (clearPassword) payload.clearObsPassword = true; else if (password) payload.obsPassword = password; try { const result = await request('/api/v1/settings', 'PUT', payload); settingsForm.dataset.dirty = 'false'; applyStateUpdate(result, true); toast(payload.remoteEnabled !== beforeRemote ? 'Réglages enregistrés · redémarrage requis pour le LAN' : 'Réglages enregistrés'); } catch (error) { toast(error.message, true); } };
  }
}

window.command = command;
window.go = id => { if (id === 'prepare') return prepareLive(); page = id; nav(); render(); };
window.openEvent = () => { editingEventId = null; const dialog = $('#event-dialog'); if (!dialog) return; dialog.querySelector('form')?.reset(); $('#event-dialog-title').textContent = 'Nouveau rendez-vous'; $('#publication-options').hidden = false; dialog.showModal(); };
window.editEvent = id => { const item = state.planning.find(value => value.id === id), dialog = $('#event-dialog'); if (!item || !dialog) return; editingEventId = id; $('#event-dialog-title').textContent = 'Modifier le rendez-vous'; const form = $('#event-form'); form.elements.title.value = item.title; form.elements.start.value = datetimeLocal(item.startAtUtc); form.elements.end.value = datetimeLocal(item.endAtUtc); form.elements.category.value = item.category || 'live'; form.elements.twitchCategoryName.value = item.twitchCategoryName || ''; $('#publication-options').hidden = true; dialog.showModal(); };
window.removeEvent = async id => { const item = state.planning.find(value => value.id === id); if (!item || !confirm(`Supprimer « ${item.title} » de StreamDashboard ?`)) return; const twitch = Boolean(item.twitchSegmentId || item.providers?.twitch?.remoteId) && confirm('Supprimer aussi la publication Twitch liée ?'); const google = Boolean(item.providers?.google?.remoteId) && confirm('Supprimer aussi l’événement Google lié ?'); const confirmRecurring = !item.twitchRecurring || !twitch || confirm('Ce live appartient à une série Twitch récurrente. Confirmer la suppression distante ?'); if (!confirmRecurring) return; try { applyStateUpdate(await request(`/api/v1/planning/${encodeURIComponent(id)}`, 'DELETE', { destinations: { local: true, twitch, google }, confirmRecurring }), true); } catch (error) { toast(error.message, true); } };
window.retryProvider = async (id, provider) => { try { applyStateUpdate(await request(`/api/v1/planning/${encodeURIComponent(id)}/retry/${encodeURIComponent(provider)}`, 'POST'), true); toast(`Retry ${provider} terminé`); } catch (error) { toast(error.message, true); } };
window.resolveConflict = async (id, provider, strategy) => { const wording = strategy === 'local' ? 'écraser la version distante avec ta version locale' : `remplacer ta version locale par la version ${provider}`; if (!confirm(`Confirmer : ${wording} ?`)) return; try { applyStateUpdate(await request(`/api/v1/planning/${encodeURIComponent(id)}/conflict/${encodeURIComponent(provider)}`, 'POST', { strategy }), true); toast('Conflit résolu'); } catch (error) { toast(error.message, true); } };
window.stopStream = () => { if (state.obs.streaming && (!state.settings.confirmStop || confirm('Arrêter réellement la diffusion ?'))) void command('session.stop'); };
window.testObs = async () => { const formElement = $('#settings-form'); if (!formElement) return; const form = new FormData(formElement), payload = { obsUrl: form.get('obsUrl') }; const password = form.get('obsPassword'), clearPassword = form.get('clearObsPassword') === 'on'; if (clearPassword) payload.obsPassword = ''; else if (password) payload.obsPassword = password; try { const result = await request('/api/v1/obs/test', 'POST', payload); toast(`OBS connecté · v${result.obsVersion || '?'}`); } catch (error) { toast(error.message, true); } };
window.connectTwitch = async () => { try { const result = await request('/api/v1/twitch/device', 'POST'); if (window.streamDashboardDesktop) await window.streamDashboardDesktop.openTwitchActivation(result.verificationUri); else window.open(result.verificationUri, '_blank', 'noopener'); toast(`Code Twitch : ${result.userCode}`); applyStateUpdate(await request('/api/v1/state')); } catch (error) { toast(error.message, true); } };
window.disconnectTwitch = async () => { try { applyStateUpdate(await request('/api/v1/twitch/disconnect', 'POST')); toast('Twitch déconnecté'); } catch (error) { toast(error.message, true); } };
window.syncTwitch = async () => { try { toast('Synchronisation Twitch…'); applyStateUpdate(await request('/api/v1/twitch/sync', 'POST'), true); toast('Planning Twitch synchronisé'); } catch (error) { toast(error.message, true); } };
window.connectGoogle = async () => { try { const result = await request('/api/v1/google/oauth/start', 'POST'); if (window.streamDashboardDesktop?.openExternalAuth) await window.streamDashboardDesktop.openExternalAuth(result.authorizationUrl); else window.open(result.authorizationUrl, '_blank', 'noopener'); toast('Connexion Google ouverte dans le navigateur'); } catch (error) { toast(error.message, true); } };
window.disconnectGoogle = async () => { try { applyStateUpdate(await request('/api/v1/google/disconnect', 'POST'), true); toast('Google Calendar déconnecté'); } catch (error) { toast(error.message, true); } };
window.syncGoogle = async () => { try { toast('Synchronisation Google…'); applyStateUpdate(await request('/api/v1/google/sync', 'POST'), true); toast('Google Calendar synchronisé'); } catch (error) { toast(error.message, true); } };
window.createPairing = async () => { try { remotePairing = await request('/api/v1/remote/pairing', 'POST'); render(); toast('Code de pairing créé'); } catch (error) { toast(error.message, true); } };
window.revokeDevice = async id => { if (!confirm('Révoquer immédiatement cette télécommande ?')) return; try { await request(`/api/v1/remote/devices/${encodeURIComponent(id)}`, 'DELETE'); await refresh(true); toast('Télécommande révoquée'); } catch (error) { toast(error.message, true); } };

document.addEventListener('input', event => { const form = event.target instanceof Element ? event.target.closest('#view form') : null; if (form) form.dataset.dirty = 'true'; }, true);
document.addEventListener('change', event => {
  const form = event.target instanceof Element ? event.target.closest('#view form') : null; if (form) form.dataset.dirty = 'true'; const element = event.target;
  if (element?.dataset?.command === 'obs.volumeDb') void command('obs.volumeDb', { input: decodeURIComponent(element.dataset.value), volumeDb: +element.value });
  if (element?.id === 'google-calendar-target' && element.value) void request('/api/v1/google/target', 'PUT', { calendarId: element.value }).then(value => { applyStateUpdate(value, true); toast('Calendrier Google sélectionné'); }).catch(error => toast(error.message, true));
}, true);
document.addEventListener('click', event => {
  const element = event.target.closest('[data-action],[data-command]'); if (!element || element.disabled) return; const value = element.dataset.value ? decodeURIComponent(element.dataset.value) : undefined;
  if (element.dataset.command) {
    const type = element.dataset.command, details = {};
    if (type === 'session.stop' && state.settings.confirmStop && !confirm('Arrêter réellement la diffusion ?')) return;
    if (type === 'checklist.toggle') details.id = value; if (type === 'mode.set') details.mode = value; if (type === 'timer.add') details.seconds = +element.dataset.seconds;
    if (type === 'obs.scene') details.scene = value; if (type === 'obs.mute') { details.input = value; details.muted = element.dataset.muted === 'true'; }
    if (type === 'obs.media.restart' || type === 'obs.browser.refresh') details.input = value;
    element.disabled = true; element.dataset.status = 'loading'; void command(type, details).finally(() => { if (element.isConnected) { element.disabled = false; element.dataset.status = 'idle'; } }); return;
  }
  const actions = { go: () => window.go(value), 'stop-stream': window.stopStream, 'sync-twitch': window.syncTwitch, 'sync-google': window.syncGoogle, 'open-event': window.openEvent, 'edit-event': () => window.editEvent(value), 'retry-provider': () => window.retryProvider(value, element.dataset.provider), 'resolve-conflict': () => window.resolveConflict(value, element.dataset.provider, element.dataset.strategy), 'remove-event': () => window.removeEvent(value), 'close-dialog': () => { editingEventId = null; element.closest('dialog')?.close(); }, 'open-logs': () => window.streamDashboardDesktop?.openLogs(), 'test-obs': window.testObs, 'disconnect-twitch': window.disconnectTwitch, 'connect-twitch': window.connectTwitch, 'connect-google': window.connectGoogle, 'disconnect-google': window.disconnectGoogle, 'create-pairing': window.createPairing, 'revoke-device': () => window.revokeDevice(value) };
  const action = actions[element.dataset.action]; if (action) { element.disabled = true; Promise.resolve(action()).catch(error => toast(error.message, true)).finally(() => { if (element.isConnected) element.disabled = false; }); }
});

function socket() { const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/v1`); ws.onopen = () => { $('#socket').innerHTML = '<i></i> Temps réel'; $('#socket').classList.add('online'); }; ws.onmessage = event => { try { const message = JSON.parse(event.data); if (message.type === 'state.updated') applyStateUpdate(message.data); } catch { toast('Événement temps réel invalide.', true); } }; ws.onclose = () => { $('#socket').textContent = 'Reconnexion…'; $('#socket').classList.remove('online'); setTimeout(socket, 1500); }; ws.onerror = () => ws.close(); }

nav(); await refresh(true); socket(); setInterval(updateTimer, 250);
