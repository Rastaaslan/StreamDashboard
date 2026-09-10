const pages = [
  ['overview', 'Vue d’ensemble', '⌂'], ['prepare', 'Préparer', '✓'], ['live', 'Live', '●'], ['planning', 'Planning', '▣'],
  ['deck', 'Control Deck', '⌘'], ['fun', 'Fun Deck', '✦'], ['diagnostics', 'Diagnostics', '◫'], ['settings', 'Réglages', '⚙'],
];
let page = 'overview', state;
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
  'checklist.toggle': 'Checklist mise à jour', 'checklist.reset': 'Checklist réinitialisée', 'timer.start': 'Timer démarré',
  'timer.pause': 'Timer en pause', 'timer.reset': 'Timer réinitialisé', 'timer.add': 'Temps ajouté', 'session.start': 'Diffusion démarrée',
  'session.stop': 'Diffusion arrêtée', 'obs.scene': 'Scène OBS activée', 'obs.mute': 'Audio OBS mis à jour', 'obs.volume': 'Volume OBS mis à jour',
  'mode.set': 'Mode et scène OBS activés',
};
async function command(type, details = {}) {
  const key = type + JSON.stringify(details);
  if (pending.has(key)) return;
  pending.add(key);
  try {
    const result = await request('/api/v1/commands', 'POST', { type, ...details });
    applyStateUpdate(result.state);
    toast(messages[type] || 'Commande exécutée');
    return result.state;
  } catch (error) {
    if (error.message.includes('Certaines vérifications') && type === 'session.start' && confirm(`${error.message}\n\nLancer quand même ?`)) return command(type, { ...details, force: true });
    toast(error.message, true);
    return undefined;
  } finally { pending.delete(key); }
}
async function refresh(force = false) { applyStateUpdate(await request('/api/v1/state'), force); }
function toast(text, bad = false) { const element = $('#toast'); if (!element) return; element.textContent = text; element.className = bad ? 'show bad' : 'show'; setTimeout(() => { element.className = ''; }, 2200); }
function duration(seconds) { const value = Math.max(0, seconds || 0); return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`; }
function date(value) { return new Date(value).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }); }
function card(label, value, sub = '', wide = '') { return `<article class="card ${esc(wide)}"><span class="label">${esc(label)}</span><strong class="metric">${value}</strong><small>${esc(sub)}</small></article>`; }
function timerRemaining() { return state?.timer.running && state.timer.deadline ? Math.max(0, Math.ceil((state.timer.deadline - Date.now()) / 1000)) : state?.timer.remaining || 0; }

function nav() {
  $('nav').innerHTML = pages.map(([id, label, icon]) => `<button data-page="${id}" class="${id === page ? 'active' : ''}"><span>${icon}</span>${label}</button>`).join('');
  document.querySelectorAll('[data-page]').forEach(button => { button.onclick = () => window.go(button.dataset.page); });
}
function overview() {
  const next = state.nextLive, done = state.checklist.filter(item => item.done).length;
  return `<div class="hero"><div><span class="kicker">BONJOUR, ${esc(state.settings.streamerName).toUpperCase()}</span><h2>${state.obs.streaming ? 'Le direct est en cours.' : 'Prêt à lancer votre prochain live ?'}</h2><p>${next ? `${esc(next.title)} · ${date(next.startAtUtc)}` : 'Ajoutez votre prochain live au planning.'}</p></div><button class="primary big" data-action="go" data-value="prepare">Préparer le live <b>→</b></button></div><div class="grid stats">${card('OBS', state.obs.connected ? 'Connecté' : 'Hors ligne', state.obs.scene || state.obs.error || 'Mode autonome')}${card('Diffusion', state.obs.streaming ? 'EN DIRECT' : 'HORS LIGNE', state.obs.recording ? 'Enregistrement actif' : 'Aucun enregistrement')}${card('Préparation', `${done}/${state.checklist.length}`, done === state.checklist.length ? 'Tout est prêt' : 'Éléments validés')}${card('Timer', duration(timerRemaining()), state.timer.running ? 'Compte à rebours actif' : 'En attente')}</div><div class="section-head"><div><span class="label">ACCÈS RAPIDE</span><h3>Piloter sans quitter le cockpit</h3></div></div><div class="quick"><button data-action="go" data-value="live"><i>●</i><b>Console Live</b><small>Diffusion, timer et séquences</small></button><button data-action="go" data-value="deck"><i>⌘</i><b>Control Deck</b><small>Scènes et audio OBS</small></button><button data-action="go" data-value="planning"><i>▣</i><b>Planning</b><small>Organiser les prochains lives</small></button></div>`;
}
function prepare() {
  const done = state.checklist.filter(item => item.done).length;
  const percent = state.checklist.length ? done / state.checklist.length * 100 : 0;
  return `<div class="panel"><div class="section-head"><div><span class="label">CHECKLIST AVANT LIVE</span><h3 id="check-count">${done}/${state.checklist.length} vérifications terminées</h3></div><button class="ghost compact" data-command="checklist.reset">Réinitialiser</button></div><div class="progress"><i id="check-progress" style="width:${percent}%"></i></div><div class="checklist">${state.checklist.map(item => `<button class="check ${item.done ? 'done' : ''}" data-check-id="${esc(item.id)}" data-command="checklist.toggle" data-value="${encodeURIComponent(item.id)}"><i>${item.done ? '✓' : ''}</i><span><b>${esc(item.label)}</b><small>${item.done ? 'Validé' : 'À vérifier'}</small></span></button>`).join('')}</div><div class="launch"><div><b id="prepare-status">${done === state.checklist.length ? 'Tout est prêt' : 'Préparation incomplète'}</b><small id="prepare-obs">${state.obs.connected ? 'OBS répond correctement.' : esc(state.obs.error || 'OBS est hors ligne : connectez-le avant de diffuser.')}</small></div><button class="primary" ${!state.obs.connected || state.obs.streaming ? 'disabled' : ''} data-command="session.start">${state.obs.streaming ? 'Live déjà actif' : 'Démarrer le live'}</button></div></div>`;
}
function live() {
  const offline = !state.obs.connected;
  return `<div class="live-console"><div class="timer-block"><span class="label">TIMER DE SESSION</span><strong id="timer-value">${duration(timerRemaining())}</strong><div class="button-row"><button class="primary" data-command="${state.timer.running ? 'timer.pause' : 'timer.start'}">${state.timer.running ? 'Pause' : 'Démarrer'}</button><button class="ghost" data-command="timer.add" data-seconds="300">+ 5 min</button><button class="ghost" data-command="timer.reset">Reset</button></div></div><div class="panel"><span class="label">ÉTAT DU DIRECT</span><h3>${offline ? 'OBS est hors ligne' : state.obs.streaming ? 'Vous êtes en direct' : 'Diffusion arrêtée'}</h3><p class="muted">Scène active : <b>${esc(state.obs.scene || 'Aucune')}</b></p><div class="mode-row">${['intro', 'live', 'pause', 'end'].map(mode => `<button class="mode ${state.mode === mode ? 'active' : ''}" ${offline ? 'disabled' : ''} data-command="mode.set" data-value="${mode}">${mode}</button>`).join('')}</div><button class="${state.obs.streaming ? 'danger' : 'primary'} full-button" ${offline ? 'disabled' : ''} data-command="${state.obs.streaming ? 'session.stop' : 'session.start'}">${offline ? 'OBS indisponible' : state.obs.streaming ? 'Arrêter la diffusion' : 'Démarrer le live'}</button></div></div>`;
}
function planning() {
  const rows = [...state.planning].sort((a, b) => Date.parse(a.startAtUtc) - Date.parse(b.startAtUtc));
  return `<div class="section-head"><div><span class="label">PLANNING SYNCHRONISÉ</span><h3>Prochains rendez-vous</h3><small class="muted">${state.twitch.connected ? `Twitch · ${esc(state.twitch.displayName)}${state.twitch.lastSyncedAt ? ` · synchro ${date(state.twitch.lastSyncedAt)}` : ''}` : 'Connectez Twitch dans les réglages pour synchroniser.'}</small></div><div class="button-row">${state.twitch.connected ? `<button class="ghost compact" ${state.twitch.syncing ? 'disabled' : ''} data-action="sync-twitch">${state.twitch.syncing ? 'Synchronisation…' : '↻ Synchroniser Twitch'}</button>` : ''}<button class="primary compact" data-action="open-event">+ Ajouter</button></div></div><div class="schedule">${rows.map(item => `<article><time><b>${new Date(item.startAtUtc).toLocaleDateString('fr-FR', { day: '2-digit' })}</b>${new Date(item.startAtUtc).toLocaleDateString('fr-FR', { month: 'short' })}</time><div><span class="tag">${item.source === 'TWITCH' ? 'TWITCH · ' : ''}${esc(item.category || 'live')}</span><h3>${esc(item.title)}</h3><p>${date(item.startAtUtc)} — ${date(item.endAtUtc)}</p>${item.syncError ? `<p class="muted">⚠ ${esc(item.syncError)}</p>` : ''}</div><button class="icon-btn" data-action="remove-event" data-value="${encodeURIComponent(item.id)}">×</button></article>`).join('') || '<div class="empty"><b>Aucun événement planifié</b><p>Votre planning autonome est prêt à accueillir un premier live.</p></div>'}</div><dialog id="event-dialog"><form id="event-form"><div class="section-head"><h3>Nouveau rendez-vous</h3><button type="button" class="icon-btn" data-action="close-dialog">×</button></div><label>Titre<input name="title" maxlength="140" required></label><div class="form-grid"><label>Début<input name="start" type="datetime-local" required></label><label>Fin<input name="end" type="datetime-local" required></label></div><label>Type<select name="category"><option value="live">Live</option><option value="production">Production</option><option value="personal">Personnel</option></select></label><button class="primary" type="submit">Enregistrer</button></form></dialog>`;
}
function deck() {
  const obs = state.obs;
  if (!obs.connected) return `<div class="section-head"><div><span class="label">OBS WEBSOCKET</span><h3>Scènes</h3></div><span class="status">Indisponible</span></div><div class="empty">${esc(obs.error || 'Lancez OBS pour charger vos scènes et votre mixeur.')}</div>`;
  const inputs = Object.entries(obs.inputs).filter(([name]) => obs.activeAudioInputs.includes(name));
  return `<div class="section-head"><div><span class="label">OBS WEBSOCKET</span><h3>Scènes</h3></div><span class="status ok">Connecté</span></div><div class="deck">${obs.scenes.map(scene => `<button class="pad ${obs.scene === scene ? 'active' : ''}" data-command="obs.scene" data-value="${encodeURIComponent(scene)}"><i>▣</i><b>${esc(scene)}</b></button>`).join('') || '<div class="empty">Aucune scène OBS détectée.</div>'}</div><div class="section-head space"><div><h3>Mixeur audio contextuel</h3><small class="muted">Sources actives dans « ${esc(obs.scene || 'aucune scène')} » et périphériques audio globaux.</small></div><span class="status ${inputs.length ? 'ok' : ''}">${inputs.length}/${Object.keys(obs.inputs).length} actives</span></div><div class="mixer">${inputs.map(([name, input]) => `<article><button class="mute ${input.muted ? 'muted' : ''}" data-command="obs.mute" data-value="${encodeURIComponent(name)}" data-muted="${!input.muted}">◉</button><div><b>${esc(name)}</b><input type="range" min="0" max="1.5" step=".05" value="${input.volume}" data-command="obs.volume" data-value="${encodeURIComponent(name)}"></div><span>${Math.round(input.volume * 100)}%</span></article>`).join('') || '<p class="muted">Aucune source audio active dans cette scène.</p>'}</div>`;
}
function fun() {
  const media = state.obs.connected ? state.obs.mediaInputs || [] : [];
  return `<div class="section-head"><div><span class="label">FUN DECK · OBS</span><h3>Médias instantanés</h3><small class="muted">Relance réellement vos sources Média, VLC et Diaporama configurées dans OBS.</small></div><span class="status ${state.obs.connected ? 'ok' : ''}">${state.obs.connected ? 'OBS connecté' : 'OBS indisponible'}</span></div><div class="deck fun">${media.map(name => `<button class="pad" data-command="obs.media.restart" data-value="${encodeURIComponent(name)}"><i>▶</i><b>${esc(name)}</b><small>Relancer la source OBS</small></button>`).join('') || `<div class="empty"><b>${state.obs.connected ? 'Aucun média OBS détecté' : 'OBS est hors ligne'}</b><p>${state.obs.connected ? 'Ajoutez une source Média, VLC ou Diaporama dans OBS pour créer automatiquement un bouton utilisable.' : 'Relancez OBS pour retrouver vos médias.'}</p></div>`}</div>`;
}
function diagnostics() {
  const runtime = state.runtime;
  return `<div class="grid">${Object.entries(state.health).map(([name, health]) => card(name, `<span class="${health.ok ? 'green' : 'red'}">${health.ok ? 'Opérationnel' : 'Attention'}</span>`, health.detail)).join('')}</div><div class="panel space"><div class="section-head"><span class="label">INFORMATIONS TECHNIQUES</span>${window.streamDashboardDesktop ? '<button class="ghost compact" data-action="open-logs">Ouvrir les logs</button>' : ''}</div><div class="details"><span>StreamDashboard <b>${esc(runtime.serverVersion)}</b></span><span>Electron <b>${esc(runtime.electronVersion || 'mode serveur')}</b></span><span>Node embarqué <b>${esc(runtime.nodeVersion)}</b></span><span>Système <b>${esc(runtime.platform)}</b></span><span>Port local <b>${runtime.port}</b></span><span>Dernière mise à jour <b>${date(state.at)}</b></span><span>Reconnexions OBS <b>${state.health.obs.reconnects}</b></span><span>Dossier logs <b>${esc(runtime.logsPath || 'console de développement')}</b></span></div></div>`;
}
function obsRuntime() { return state.obs.connected ? `<div class="status ok">OBS connecté${state.obs.obsVersion ? ` · v${esc(state.obs.obsVersion)}` : ''}${state.obs.websocketVersion ? ` · WebSocket ${esc(state.obs.websocketVersion)}` : ''}</div>` : `<div class="status">${esc(state.obs.error || 'OBS non connecté')}</div>`; }
function twitchRuntime() {
  return `<div class="status ${state.twitch.connected ? 'ok' : ''}">${state.twitch.connected ? `Connecté en tant que ${esc(state.twitch.displayName)}` : esc(state.twitch.error || 'Twitch non connecté')}</div>${state.twitch.deviceAuthorization ? `<div class="device-code"><small>CODE TWITCH</small><strong>${esc(state.twitch.deviceAuthorization.userCode)}</strong><a class="ghost" target="_blank" rel="noopener" href="${esc(state.twitch.deviceAuthorization.verificationUri)}">Ouvrir Twitch</a><small>Validez ce code avant ${date(state.twitch.deviceAuthorization.expiresAt)}. La connexion sera détectée automatiquement.</small></div>` : ''}<div class="button-row">${state.twitch.connected ? '<button class="ghost" type="button" data-action="disconnect-twitch">Déconnecter Twitch</button>' : '<button class="ghost" type="button" data-action="connect-twitch">Connecter Twitch</button>'}</div>`;
}
function settings() {
  return `<form class="panel settings" id="settings-form"><span class="label">PRÉFÉRENCES DU COCKPIT</span><label>Nom affiché<input name="streamerName" maxlength="80" value="${esc(state.settings.streamerName)}"></label><label>Couleur d’accent<select name="accent"><option value="violet">Violet</option><option value="cyan">Cyan</option><option value="rose">Rose</option></select></label><label class="switch"><span><b>Confirmer l’arrêt du live</b><small>Évite les arrêts accidentels</small></span><input name="confirmStop" type="checkbox" ${state.settings.confirmStop ? 'checked' : ''}></label><span class="label section-label">CONNEXION OBS</span><label class="switch"><span><b>Lancer OBS avec StreamDashboard</b><small>Effectif au prochain démarrage de l’application Windows</small></span><input name="launchObs" type="checkbox" ${state.settings.launchObs ? 'checked' : ''}></label><label>Chemin OBS Studio (facultatif)<input name="obsExecutablePath" maxlength="500" value="${esc(state.settings.obsExecutablePath || '')}" placeholder="C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe"><small>Chemin local utilisé uniquement par l’application Desktop.</small></label><label>Adresse OBS WebSocket<input name="obsUrl" value="${esc(state.settings.obsUrl)}"><small>Exemple : ws://127.0.0.1:4455</small></label><label>Mot de passe OBS<input name="obsPassword" type="password" maxlength="500" autocomplete="new-password" placeholder="${state.settings.obsPasswordSet ? 'Mot de passe enregistré — laisser vide pour conserver' : 'Mot de passe WebSocket OBS'}"><small>Le mot de passe n’est jamais renvoyé à l’interface après sauvegarde.</small></label>${state.settings.obsPasswordSet ? '<label class="switch"><span><b>Effacer le mot de passe OBS enregistré</b><small>À utiliser si vous désactivez l’authentification WebSocket dans OBS.</small></span><input name="clearObsPassword" type="checkbox"></label>' : ''}<div id="obs-runtime">${obsRuntime()}</div><span class="label section-label">SCÈNES PAR MODE</span><div class="form-grid">${['intro', 'live', 'pause', 'end'].map(mode => `<label>Scène ${mode}<select name="scene-${mode}"><option value="">Non configurée</option>${state.obs.scenes.map(scene => `<option value="${esc(scene)}" ${state.settings.modeScenes?.[mode] === scene ? 'selected' : ''}>${esc(scene)}</option>`).join('')}</select></label>`).join('')}</div><span class="label section-label">CONNEXION TWITCH</span><div id="twitch-runtime">${twitchRuntime()}</div><div class="button-row"><button class="ghost" type="button" data-action="test-obs">Tester OBS</button><button class="primary" type="submit">Enregistrer</button></div></form>`;
}

function render() {
  if (!state) return;
  document.documentElement.dataset.accent = state.settings.accent;
  $('#title').textContent = pages.find(item => item[0] === page)[1];
  updateHeader();
  const views = { overview, prepare, live, planning, deck, fun, diagnostics, settings };
  $('#view').innerHTML = views[page]();
  bindForms();
}
function updateHeader() {
  $('#obs-pill').textContent = `OBS ${state.obs.connected ? 'CONNECTÉ' : 'HORS LIGNE'}`;
  $('#obs-pill').className = `obs-pill ${state.obs.connected ? 'ok' : ''}`;
  $('#live-pill').textContent = state.obs.streaming ? '● EN DIRECT' : 'HORS LIGNE';
  $('#live-pill').className = `live-pill ${state.obs.streaming ? 'on' : ''}`;
}
function dirtyForm() { return document.querySelector('#view form[data-dirty="true"]'); }
function updateSettingsRuntime() { const obs = $('#obs-runtime'), twitch = $('#twitch-runtime'); if (obs) obs.innerHTML = obsRuntime(); if (twitch) twitch.innerHTML = twitchRuntime(); }
function applyStateUpdate(next, force = false) {
  const previous = state;
  state = next;
  if (!previous || force) { render(); return; }
  document.documentElement.dataset.accent = state.settings.accent;
  updateHeader();
  updateTimer();
  if (page === 'prepare') updateChecklist();
  const structural = page === 'overview'
    || page === 'prepare' && (previous.obs.connected !== state.obs.connected || previous.obs.streaming !== state.obs.streaming)
    || page === 'deck' && JSON.stringify([previous.obs.connected, previous.obs.scenes, previous.obs.activeAudioInputs, previous.obs.inputs, previous.obs.scene]) !== JSON.stringify([state.obs.connected, state.obs.scenes, state.obs.activeAudioInputs, state.obs.inputs, state.obs.scene])
    || page === 'planning' && JSON.stringify([previous.planning, previous.twitch.connected, previous.twitch.syncing]) !== JSON.stringify([state.planning, state.twitch.connected, state.twitch.syncing])
    || page === 'live' && (previous.obs.connected !== state.obs.connected || previous.obs.streaming !== state.obs.streaming || previous.mode !== state.mode || previous.obs.scene !== state.obs.scene || previous.timer.running !== state.timer.running)
    || page === 'fun' && (previous.obs.connected !== state.obs.connected || JSON.stringify(previous.obs.mediaInputs) !== JSON.stringify(state.obs.mediaInputs))
    || page === 'settings' && JSON.stringify([previous.obs.connected, previous.obs.error, previous.obs.scenes, previous.twitch, previous.settings.obsPasswordSet, previous.settings.obsExecutablePath]) !== JSON.stringify([state.obs.connected, state.obs.error, state.obs.scenes, state.twitch, state.settings.obsPasswordSet, state.settings.obsExecutablePath]);
  if (!structural) return;
  if (dirtyForm()) { if (page === 'settings') updateSettingsRuntime(); return; }
  render();
}
function updateTimer() {
  const element = $('#timer-value'); if (element) element.textContent = duration(timerRemaining());
  if (page === 'overview') { const metric = document.querySelector('.stats .card:nth-child(4) .metric'); if (metric) metric.textContent = duration(timerRemaining()); }
}
function updateChecklist() {
  const done = state.checklist.filter(item => item.done).length;
  const count = $('#check-count'), bar = $('#check-progress'), status = $('#prepare-status'), obs = $('#prepare-obs'), start = document.querySelector('.launch [data-command="session.start"]');
  if (count) count.textContent = `${done}/${state.checklist.length} vérifications terminées`;
  if (bar) bar.style.width = `${state.checklist.length ? done / state.checklist.length * 100 : 0}%`;
  if (status) status.textContent = done === state.checklist.length ? 'Tout est prêt' : 'Préparation incomplète';
  if (obs) obs.textContent = state.obs.connected ? 'OBS répond correctement.' : state.obs.error || 'OBS est hors ligne : connectez-le avant de diffuser.';
  if (start) { start.disabled = !state.obs.connected || state.obs.streaming; start.textContent = state.obs.streaming ? 'Live déjà actif' : 'Démarrer le live'; }
  for (const item of state.checklist) {
    const element = document.querySelector(`[data-check-id="${CSS.escape(item.id)}"]`); if (!element) continue;
    element.classList.toggle('done', item.done); element.querySelector('i').textContent = item.done ? '✓' : ''; element.querySelector('small').textContent = item.done ? 'Validé' : 'À vérifier';
  }
}

async function prepareLive() {
  page = 'prepare'; nav(); render();
  if (state.obs.connected) { await command('session.prepare'); return; }
  if (!window.streamDashboardDesktop?.ensureObsRunning) { toast('OBS n’est pas lancé. Le lancement automatique est disponible dans l’application Desktop.', true); return; }
  try {
    toast('Lancement OBS…');
    const result = await window.streamDashboardDesktop.ensureObsRunning();
    const alreadyRunning = /déjà lancé/i.test(result.detail);
    if (!result.launched && !alreadyRunning) { toast(result.detail, true); return; }
    toast(result.detail);
    const deadline = Date.now() + 45_000; let wait = 400;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, wait));
      const next = await request('/api/v1/state'); applyStateUpdate(next);
      if (next.obs.connected) { await command('session.prepare'); toast('OBS connecté · scènes chargées'); return; }
      wait = Math.min(2_000, Math.round(wait * 1.5));
    }
    toast('OBS est lancé mais le WebSocket ne répond toujours pas. Vérifiez le mot de passe dans Réglages.', true);
  } catch (error) { toast(`Impossible de lancer OBS : ${error.message}`, true); }
}

function bindForms() {
  const eventForm = $('#event-form');
  if (eventForm) eventForm.onsubmit = async event => {
    event.preventDefault();
    const form = new FormData(eventForm);
    try {
      const result = await request('/api/v1/planning', 'POST', { title: form.get('title'), startAtUtc: new Date(form.get('start')).toISOString(), endAtUtc: new Date(form.get('end')).toISOString(), category: form.get('category') });
      eventForm.dataset.dirty = 'false'; applyStateUpdate(result, true);
    } catch (error) { toast(error.message, true); }
  };
  const settingsForm = $('#settings-form');
  if (settingsForm) {
    settingsForm.elements.accent.value = state.settings.accent;
    settingsForm.onsubmit = async event => {
      event.preventDefault();
      const form = new FormData(settingsForm);
      const payload = {
        streamerName: form.get('streamerName'), obsExecutablePath: form.get('obsExecutablePath'), accent: form.get('accent'),
        confirmStop: form.get('confirmStop') === 'on', launchObs: form.get('launchObs') === 'on', obsUrl: form.get('obsUrl'),
        modeScenes: Object.fromEntries(['intro', 'live', 'pause', 'end'].map(mode => [mode, form.get(`scene-${mode}`)]).filter(([, scene]) => scene)),
      };
      const clearPassword = form.get('clearObsPassword') === 'on', password = form.get('obsPassword');
      if (clearPassword) payload.clearObsPassword = true; else if (password) payload.obsPassword = password;
      try {
        const result = await request('/api/v1/settings', 'PUT', payload);
        settingsForm.dataset.dirty = 'false'; applyStateUpdate(result, true); toast('Réglages enregistrés');
      } catch (error) { toast(error.message, true); }
    };
  }
}

window.command = command;
window.go = id => { if (id === 'prepare') return prepareLive(); page = id; nav(); render(); };
window.openEvent = () => $('#event-dialog')?.showModal();
window.removeEvent = async id => {
  const item = state.planning.find(value => value.id === id);
  if (item?.twitchSegmentId && !state.twitch.connected) { toast('Reconnectez Twitch avant de supprimer cet événement lié à Twitch.', true); return; }
  const warning = item?.twitchRecurring ? 'Ce live fait partie d’une série récurrente Twitch. La suppression peut retirer toute la série. Continuer ?' : item?.twitchSegmentId ? 'Supprimer aussi ce segment du planning Twitch ?' : 'Supprimer cet événement ?';
  if (!confirm(warning)) return;
  try { applyStateUpdate(await request(`/api/v1/planning/${encodeURIComponent(id)}${item?.twitchRecurring ? '?confirmRecurring=true' : ''}`, 'DELETE'), true); }
  catch (error) { toast(error.message, true); }
};
window.stopStream = () => { if (state.obs.streaming && (!state.settings.confirmStop || confirm('Arrêter réellement la diffusion ?'))) void command('session.stop'); };
window.testObs = async () => {
  const formElement = $('#settings-form'); if (!formElement) return;
  const form = new FormData(formElement), payload = { obsUrl: form.get('obsUrl') };
  const password = form.get('obsPassword'), clearPassword = form.get('clearObsPassword') === 'on';
  if (clearPassword) payload.obsPassword = ''; else if (password) payload.obsPassword = password;
  try { const result = await request('/api/v1/obs/test', 'POST', payload); toast(`OBS connecté · v${result.obsVersion || '?'} · WebSocket ${result.websocketVersion || '?'}`); }
  catch (error) { toast(error.message, true); }
};
window.connectTwitch = async () => {
  try {
    const result = await request('/api/v1/twitch/device', 'POST');
    if (window.streamDashboardDesktop) await window.streamDashboardDesktop.openTwitchActivation(result.verificationUri); else window.open(result.verificationUri, '_blank', 'noopener');
    toast(`Code Twitch : ${result.userCode}`);
    applyStateUpdate(await request('/api/v1/state'));
  } catch (error) { toast(error.message, true); }
};
window.disconnectTwitch = async () => { try { applyStateUpdate(await request('/api/v1/twitch/disconnect', 'POST')); toast('Twitch déconnecté'); } catch (error) { toast(error.message, true); } };
window.syncTwitch = async () => { try { toast('Synchronisation Twitch…'); applyStateUpdate(await request('/api/v1/twitch/sync', 'POST'), true); toast('Planning Twitch synchronisé'); } catch (error) { toast(error.message, true); } };

document.addEventListener('input', event => { const form = event.target instanceof Element ? event.target.closest('#view form') : null; if (form) form.dataset.dirty = 'true'; }, true);
document.addEventListener('change', event => {
  const form = event.target instanceof Element ? event.target.closest('#view form') : null; if (form) form.dataset.dirty = 'true';
  const element = event.target;
  if (element?.dataset?.command === 'obs.volume') void command('obs.volume', { input: decodeURIComponent(element.dataset.value), volume: +element.value });
}, true);
document.addEventListener('click', event => {
  const element = event.target.closest('[data-action],[data-command]'); if (!element || element.disabled) return;
  const value = element.dataset.value ? decodeURIComponent(element.dataset.value) : undefined;
  if (element.dataset.command) {
    const type = element.dataset.command, details = {};
    if (type === 'session.stop' && state.settings.confirmStop && !confirm('Arrêter réellement la diffusion ?')) return;
    if (type === 'checklist.toggle') details.id = value;
    if (type === 'mode.set') details.mode = value;
    if (type === 'timer.add') details.seconds = +element.dataset.seconds;
    if (type === 'obs.scene') details.scene = value;
    if (type === 'obs.mute') { details.input = value; details.muted = element.dataset.muted === 'true'; }
    if (type === 'obs.media.restart') details.input = value;
    element.disabled = true; element.dataset.status = 'loading';
    void command(type, details).finally(() => { if (element.isConnected) { element.disabled = false; element.dataset.status = 'idle'; } });
    return;
  }
  const actions = {
    go: () => window.go(value), 'stop-stream': window.stopStream, 'sync-twitch': window.syncTwitch, 'open-event': window.openEvent,
    'remove-event': () => window.removeEvent(value), 'close-dialog': () => element.closest('dialog')?.close(),
    'open-logs': () => window.streamDashboardDesktop?.openLogs(), 'test-obs': window.testObs,
    'disconnect-twitch': window.disconnectTwitch, 'connect-twitch': window.connectTwitch,
  };
  const action = actions[element.dataset.action];
  if (action) { element.disabled = true; Promise.resolve(action()).catch(error => toast(error.message, true)).finally(() => { if (element.isConnected) element.disabled = false; }); }
});

function socket() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/v1`);
  ws.onopen = () => { $('#socket').innerHTML = '<i></i> Temps réel'; $('#socket').classList.add('online'); };
  ws.onmessage = event => { try { const message = JSON.parse(event.data); if (message.type === 'state.updated') applyStateUpdate(message.data); } catch { toast('Événement temps réel invalide.', true); } };
  ws.onclose = () => { $('#socket').textContent = 'Reconnexion…'; $('#socket').classList.remove('online'); setTimeout(socket, 1500); };
  ws.onerror = () => ws.close();
}

nav(); await refresh(true); socket(); setInterval(updateTimer, 250);
