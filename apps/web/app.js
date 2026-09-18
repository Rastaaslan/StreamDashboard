import { normalizeCategoryQuery, rankCategories, rememberCategory } from '../mobile/twitch-category.js';
import { expandRecurringItems, recurrenceSummary } from '../mobile/shared/recurrence.js';

const pages = [
  ['overview', 'Accueil', '⌂'],
  ['planning', 'Planning', '▣'],
  ['prepare', 'Préparation', '✓'],
  ['settings', 'Réglages', '⚙'],
];

let page = 'overview';
let state;
let remotePairing = null;
let editingEventId = null;
let editingOccurrence = null;
let preparationView = localStorage.getItem('streamdashboard.desktopPreparationView') || 'checklist';
let desktopFocus = localStorage.getItem('streamdashboard.desktopFocus') === 'true';
const planningPreferencesKey = 'streamdashboard.desktopPlanningExport';
const recentCategoriesKey = 'streamdashboard.recentTwitchCategories';
let planningExportPreferences = { period: 'today', filters: { twitch: true, google: true, allDay: true, live: true, personal: true, production: true }, noteEnabled: false, noteText: 'Et potentiellement d’autres lives à l’improviste 🔥' };
let recentCategories = [];
try { planningExportPreferences = { ...planningExportPreferences, ...JSON.parse(localStorage.getItem(planningPreferencesKey) || '{}') }; } catch { /* reset invalid preference */ }
try { recentCategories = JSON.parse(localStorage.getItem(recentCategoriesKey) || '[]').slice(0, 8); } catch { /* reset invalid history */ }
const pending = new Set();
const REQUEST_TIMEOUT_MS = 30_000;
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

async function request(url, method = 'GET', body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    let value;
    try { value = await response.json(); }
    catch { throw Error(`HTTP ${response.status}`); }
    if (!response.ok) throw Error(value.error?.message || value.error || `HTTP ${response.status}`);
    return value;
  } catch (error) {
    if (error?.name === 'AbortError') throw Error('StreamDashboard ne répond pas dans le délai attendu.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

const messages = {
  'checklist.toggle': 'Checklist mise à jour',
  'checklist.reset': 'Checklist réinitialisée',
  'timer.start': 'Timer démarré',
  'timer.pause': 'Timer en pause',
  'timer.reset': 'Timer réinitialisé',
  'timer.add': 'Temps ajouté',
  'session.start': 'Diffusion démarrée',
  'session.stop': 'Diffusion arrêtée',
  'obs.scene': 'Scène OBS activée',
  'obs.mute': 'Audio OBS mis à jour',
  'obs.volume': 'Volume OBS mis à jour',
  'obs.volumeDb': 'Volume OBS mis à jour',
  'obs.browser.refresh': 'Source timer OBS rafraîchie',
  'mode.set': 'Mode et scène OBS activés',
};

async function command(type, details = {}) {
  const key = type + JSON.stringify(details);
  if (pending.has(key)) return undefined;
  pending.add(key);
  try {
    const result = await request('/api/v1/commands', 'POST', { type, ...details });
    applyStateUpdate(result.state);
    if (type === 'session.start' && result.state.obs.streaming) {
      page = 'live';
      nav();
      render();
    }
    toast(messages[type] || 'Commande exécutée');
    return result.state;
  } catch (error) {
    if (error.message.includes('Certaines vérifications')
      && type === 'session.start'
      && confirm(`${error.message}\n\nLancer quand même ?`)) {
      return command(type, { ...details, force: true });
    }
    toast(error.message, true);
    return undefined;
  } finally {
    pending.delete(key);
  }
}

async function refresh(force = false) { applyStateUpdate(await request('/api/v1/state'), force); }
function toast(text, bad = false) {
  const element = $('#toast');
  if (!element) return;
  element.textContent = text;
  element.className = bad ? 'show bad' : 'show';
  setTimeout(() => { element.className = ''; }, 2800);
}
function duration(seconds) {
  const value = Math.max(0, seconds || 0);
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}
function date(value, allDay = false) {
  if (allDay) return new Date(value).toLocaleDateString('fr-FR', { dateStyle: 'medium', timeZone: 'UTC' });
  return new Date(value).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}
function datetimeLocal(value) {
  const parsed = new Date(value);
  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
function dateOnly(value) { return new Date(value).toISOString().slice(0, 10); }
function allDayUtc(value) { return `${String(value).slice(0, 10)}T00:00:00.000Z`; }
function card(label, value, sub = '', wide = '') {
  return `<article class="card ${esc(wide)}"><span class="label">${esc(label)}</span><strong class="metric">${value}</strong><small>${esc(sub)}</small></article>`;
}
function timerRemaining() {
  return state?.timer.running && state.timer.deadline
    ? Math.max(0, Math.ceil((state.timer.deadline - Date.now()) / 1000))
    : state?.timer.remaining || 0;
}
function inputDb(input) {
  if (Number.isFinite(input.volumeDb)) return input.volumeDb;
  return input.volume > 0 ? 20 * Math.log10(input.volume) : -100;
}
function providerBadge(item, provider) {
  const link = item.providers?.[provider];
  const status = link?.status ?? 'not-published';
  const labels = { synced: 'OK', pending: 'SYNC…', error: 'ERREUR', conflict: 'CONFLIT', 'not-published': 'NON PUBLIÉ' };
  return `<span class="tag">${provider.toUpperCase()} · ${labels[status] || status}</span>`;
}
function configuredOptions(current, discovered) {
  return [...new Set([current, ...(discovered || [])].filter(Boolean))];
}
function eventRange(item) {
  if (!item.allDay) return `${date(item.startAtUtc)} — ${date(item.endAtUtc)}`;
  const endExclusive = new Date(Date.parse(item.endAtUtc) - 1);
  const startLabel = date(item.startAtUtc, true);
  const endLabel = date(endExclusive.toISOString(), true);
  return startLabel === endLabel ? `${startLabel} · toute la journée` : `${startLabel} — ${endLabel} · journées entières`;
}

function nav() {
  $('nav').innerHTML = pages.map(([id, label, icon]) => `<button data-page="${id}" class="${id === page ? 'active' : ''}"><span>${icon}</span>${label}</button>`).join('');
  document.querySelectorAll('[data-page]').forEach(button => {
    button.onclick = () => window.go(button.dataset.page);
  });
}

function overview() {
  const next = state.nextLive;
  const done = state.checklist.filter(item => item.done).length;
  const ready = Boolean(state.runtime && state.obs.connected && state.twitch.connected);
  return `<div class="hero minimal-hero"><div><span class="kicker">${ready ? 'TOUT EST PRÊT' : 'À VÉRIFIER'}</span><h2>${state.obs.streaming ? 'Le direct est en cours.' : 'Prêt pour le prochain live.'}</h2><p>${next ? `${esc(next.title)} · ${eventRange(next)}` : 'Aucun live planifié.'}</p></div><button class="primary big" data-action="go" data-value="prepare">Préparer <b>→</b></button></div><div class="status-strip overview-status"><span>OBS <b>${state.obs.connected ? 'Prêt' : 'Hors ligne'}</b></span><span>Live <b>${state.obs.streaming ? 'En direct' : 'Arrêté'}</b></span><span>Prépa <b>${done}/${state.checklist.length}</b></span><span>Timer <b>${duration(timerRemaining())}</b></span></div><div class="section-head minimal-section-head"><div><span class="label">ACCÈS RAPIDE</span></div></div><div class="quick minimal-quick"><button data-action="go" data-value="live"><i>●</i><b>Live</b><small>Diffusion et timer</small></button><button data-action="go" data-value="deck"><i>⌘</i><b>Scènes & audio</b><small>Contrôle OBS</small></button><button data-action="go" data-value="planning"><i>▣</i><b>Planning</b><small>Prochains lives</small></button></div>`;
}

function preflightBlock() {
  const value = state.preflight;
  if (!value || value.status === 'idle') {
    return '<div class="panel space"><span class="label">INFOS TWITCH</span><p class="muted">Le prochain live sera analysé pendant Préparer.</p></div>';
  }
  const label = { preparing: 'Préparation…', ready: 'Prêt', 'action-required': 'Action requise', error: 'Erreur' }[value.status] || value.status;
  return `<div class="panel space"><span class="label">INFOS TWITCH · ${esc(label)}</span><h3>${esc(value.title || 'Prochain live')}</h3><p>${esc(value.category || 'Catégorie non définie')}${value.gameId ? ` · ID ${esc(value.gameId)}` : ''}</p>${value.error ? `<p class="muted">⚠ ${esc(value.error)}</p>` : ''}</div>`;
}

function prepare() {
  const done = state.checklist.filter(item => item.done).length;
  const percent = state.checklist.length ? done / state.checklist.length * 100 : 0;
  const timerSource = state.settings.timerBrowserSource;
  return `${preflightBlock()}<div class="panel"><div class="section-head"><div><span class="label">CHECKLIST AVANT LIVE</span><h3 id="check-count">${done}/${state.checklist.length} vérifications terminées</h3></div><div class="button-row"><button class="ghost compact" data-command="checklist.reset">Réinitialiser</button>${timerSource ? `<button class="ghost compact" data-command="obs.browser.refresh" data-value="${encodeURIComponent(timerSource)}">Rafraîchir timer OBS</button>` : ''}</div></div><div class="progress"><i id="check-progress" style="width:${percent}%"></i></div><div class="checklist">${state.checklist.map(item => `<button class="check ${item.done ? 'done' : ''}" data-check-id="${esc(item.id)}" data-command="checklist.toggle" data-value="${encodeURIComponent(item.id)}"><i>${item.done ? '✓' : ''}</i><span><b>${esc(item.label)}</b><small>${item.done ? 'Validé' : 'À vérifier'}</small></span></button>`).join('')}</div><div class="launch"><div><b id="prepare-status">${done === state.checklist.length ? 'Tout est prêt' : 'Préparation incomplète'}</b><small id="prepare-obs">${state.obs.connected ? `OBS répond correctement. Démarrage prévu sur ${esc(state.settings.startMode === 'live' ? 'Live' : 'Intro')}.` : esc(state.obs.error || 'OBS est hors ligne : connectez-le avant de diffuser.')}</small></div><button class="primary" ${!state.obs.connected || state.obs.streaming ? 'disabled' : ''} data-command="session.start">${state.obs.streaming ? 'Live déjà actif' : 'Démarrer le live'}</button></div></div>`;
}

function preparation() {
  const tabs = `<div class="workspace-tabs" role="tablist" aria-label="Préparation"><button data-preparation-view="checklist" class="${preparationView === 'checklist' ? 'active' : ''}">Checklist</button><button data-preparation-view="notes" class="${preparationView === 'notes' ? 'active' : ''}">Notes</button><button data-preparation-view="templates" class="${preparationView === 'templates' ? 'active' : ''}">Templates</button></div>`;
  if (preparationView === 'checklist') return tabs + prepare();
  if (preparationView === 'notes') { const notes = state.notes || []; return `${tabs}<div class="intent-panel"><div class="section-head"><div><span class="label">NOTES</span><h3>Idées à retrouver</h3></div></div><div class="quiet-list">${notes.map(note => `<article><div><b>${esc(note.text)}</b></div><details><summary aria-label="Actions">⋮</summary><span>Gestion disponible sur mobile</span></details></article>`).join('') || '<div class="empty"><b>Aucune note</b><p>Garde ici les idées à retrouver avant un live.</p></div>'}</div></div>`; }
  const templates = state.templates || []; return `${tabs}<div class="intent-panel"><div class="section-head"><div><span class="label">TEMPLATES</span><h3>Préréglages de live</h3></div></div><div class="quiet-list">${templates.map(template => `<article><div class="semantic-stack"><b>${esc(template.title)}</b><small>${template.desiredPublication?.twitch ? 'Twitch' : 'Sans publication automatique'}${template.desiredPublication?.google ? ' · Google' : ''}</small>${template.description ? `<p>${esc(template.description)}</p>` : ''}</div><button class="ghost compact" data-action="go" data-value="planning">Créer un événement</button><details><summary aria-label="Actions">⋮</summary><span>Gestion disponible sur mobile</span></details></article>`).join('') || '<div class="empty"><b>Aucun template</b><p>Crée un modèle depuis la préparation mobile.</p></div>'}</div></div>`;
}

function supports() { const values = state.controlHub?.support?.totals || {}; return `<div class="intent-panel"><span class="label">SOUTIENS</span><h3>Vue d’ensemble</h3><div class="status-strip"><span>Session <b>${esc(values.session || '—')}</b></span><span>Aujourd’hui <b>${esc(values.day || '—')}</b></span><span>Mois <b>${esc(values.month || '—')}</b></span></div><div class="empty"><b>${state.controlHub?.integrations?.streamlabs?.status === 'CONNECTED' ? 'Aucun soutien récent' : 'Streamlabs non configuré'}</b><p>L’historique apparaîtra ici lorsque le provider sera disponible.</p></div></div>`; }
function automations() { return '<div class="intent-panel"><span class="label">AUTOMATISATIONS</span><h3>Règles du stream</h3><div class="empty"><b>Gestion depuis le Control Hub</b><p>Les règles existantes restent exécutées par le PC Runtime.</p></div></div>'; }
const connectionLabel = status => ({ CONNECTED: 'Connecté', CONNECTING: 'Connexion…', DISCONNECTED: 'Déconnecté', NOT_CONFIGURED: 'À configurer', NOT_SUPPORTED: 'Non disponible', DEGRADED: 'Connexion instable', ERROR: 'Erreur' })[status] || 'À configurer';
function connections() {
  const integrations = state.controlHub?.integrations || {};
  const streamlabs = integrations.streamlabs || { status: 'NOT_CONFIGURED' };
  const wizebot = integrations.wizebot || { status: 'NOT_CONFIGURED' };
  return `<div class="intent-panel"><span class="label">CONNEXIONS</span><h3>Services connectés</h3><div class="connection-cards">
    <article><div><b>OBS</b><span>${state.obs.connected ? '● Connecté' : '○ Déconnecté'}</span></div><button class="secondary compact" data-action="go" data-value="settings">CONFIGURER</button></article>
    <article><div><b>Twitch</b><span>${state.twitch.connected ? '● Connecté' : '○ Déconnecté'}</span></div><button class="secondary compact" data-action="${state.twitch.connected ? 'disconnect-twitch' : 'connect-twitch'}">${state.twitch.connected ? 'DÉCONNECTER' : 'CONNECTER'}</button></article>
    <article><div><b>Discord</b><span>${state.discord?.connected ? '● Connecté' : state.discord?.configured ? '○ Erreur' : '○ À configurer'}</span></div><button class="secondary compact" data-action="go" data-value="settings">CONFIGURER</button></article>
    <article><div><b>Streamlabs</b><span>${streamlabs.status === 'CONNECTED' ? '●' : '○'} ${connectionLabel(streamlabs.status)}</span></div><form id="streamlabs-form"><input name="token" type="password" maxlength="1000" autocomplete="new-password" aria-label="Token Socket Streamlabs" placeholder="Token Socket API"><div class="button-row"><button class="primary compact" type="submit">CONFIGURER</button><button class="secondary compact" type="button" data-action="test-streamlabs">TESTER</button><button class="danger compact" type="button" data-action="disconnect-streamlabs">DÉCONNECTER</button></div></form></article>
    <article><div><b>WizeBot</b><span>${wizebot.status === 'CONNECTED' ? '●' : '○'} ${connectionLabel(wizebot.status)}${wizebot.profile?.name ? ` · ${esc(wizebot.profile.name)}` : ''}</span></div><form id="wizebot-form"><input name="apiBaseUrl" type="url" required aria-label="Adresse API fournie par WizeBot" placeholder="Adresse API fournie par WizeBot"><input name="token" type="password" maxlength="1000" required autocomplete="new-password" aria-label="Token WizeBot" placeholder="Token API"><div class="button-row"><button class="primary compact" type="submit">CONFIGURER</button><button class="secondary compact" type="button" data-action="refresh-wizebot">RAFRAÎCHIR</button><button class="danger compact" type="button" data-action="disconnect-wizebot">DÉCONNECTER</button></div></form></article>
    <article><div><b>Android</b><span>${state.remote?.devices?.some(item => !item.revokedAt) ? '● Appairé' : '○ À appairer'}</span></div><button class="secondary compact" data-action="go" data-value="settings">APPAIRAGE</button></article>
  </div></div>`;
}

function live() {
  const offline = !state.obs.connected;
  const timerSource = state.settings.timerBrowserSource;
  return `<div class="live-console"><div class="timer-block"><span class="label">TIMER DE SESSION</span><strong id="timer-value">${duration(timerRemaining())}</strong><div class="button-row"><button class="primary" data-command="${state.timer.running ? 'timer.pause' : 'timer.start'}">${state.timer.running ? 'Pause' : 'Démarrer'}</button><button class="ghost" data-command="timer.add" data-seconds="60">+ 1 min</button><button class="ghost" data-command="timer.add" data-seconds="120">+ 2 min</button><button class="ghost" data-command="timer.add" data-seconds="300">+ 5 min</button><button class="ghost" data-command="timer.add" data-seconds="600">+ 10 min</button><button class="ghost" data-command="timer.reset">Reset</button>${timerSource ? `<button class="ghost" data-command="obs.browser.refresh" data-value="${encodeURIComponent(timerSource)}">Refresh OBS</button>` : ''}</div></div><div class="panel"><span class="label">ÉTAT DU DIRECT</span><h3>${offline ? 'OBS est hors ligne' : state.obs.streaming ? 'Vous êtes en direct' : 'Diffusion arrêtée'}</h3><p class="muted">Scène active : <b>${esc(state.obs.scene || 'Aucune')}</b></p><div class="mode-row">${['intro', 'live', 'pause', 'end'].map(mode => `<button class="mode ${state.mode === mode ? 'active' : ''}" ${offline ? 'disabled' : ''} data-command="mode.set" data-value="${mode}">${mode}</button>`).join('')}</div><button class="${state.obs.streaming ? 'danger' : 'primary'} full-button" ${offline ? 'disabled' : ''} data-command="${state.obs.streaming ? 'session.stop' : 'session.start'}">${offline ? 'OBS indisponible' : state.obs.streaming ? 'Arrêter la diffusion' : 'Démarrer le live'}</button></div></div>`;
}

function planningActions(item) {
  const actions = [];
  if (item.editable !== false) {
    if (item.occurrenceKey) actions.push(`<button class="ghost compact" data-action="edit-occurrence" data-value="${encodeURIComponent(item.id)}">Modifier cette occurrence</button><button class="ghost compact" data-action="edit-event" data-value="${encodeURIComponent(item.seriesId)}">Modifier toute la série</button>`);
    else actions.push(`<button class="ghost compact" data-action="edit-event" data-value="${encodeURIComponent(item.id)}">Modifier</button>`);
  }
  for (const provider of ['twitch', 'google']) {
    const link = item.providers?.[provider];
    if (link?.status === 'error' && !item.conflict) {
      const desired = item.desiredPublication?.[provider] === true;
      actions.push(`<button class="ghost compact" data-action="retry-provider" data-provider="${provider}" data-value="${encodeURIComponent(item.id)}">${desired ? `Retry ${provider}` : `Retirer ${provider}`}</button>`);
    }
  }
  if (item.conflict) {
    const provider = item.conflict.provider;
    actions.push(`<button class="ghost compact" data-action="resolve-conflict" data-provider="${provider}" data-strategy="remote" data-value="${encodeURIComponent(item.id)}">Garder ${provider}</button>`);
    actions.push(`<button class="ghost compact" data-action="resolve-conflict" data-provider="${provider}" data-strategy="local" data-value="${encodeURIComponent(item.id)}">Garder local</button>`);
  }
  if (item.occurrenceKey) actions.push(`<button class="ghost compact" data-action="remove-occurrence" data-value="${encodeURIComponent(item.id)}">Supprimer cette occurrence</button><button class="icon-btn" data-action="remove-event" data-value="${encodeURIComponent(item.seriesId)}" aria-label="Supprimer toute la série">×</button>`);
  else actions.push(`<button class="icon-btn" data-action="remove-event" data-value="${encodeURIComponent(item.id)}" aria-label="Supprimer">×</button>`);
  return actions.join('');
}

function planning() {
  const rows = expandRecurringItems(state.planning, { from: Date.now() - 366 * 86400000, to: Date.now() + 730 * 86400000 });
  const googleText = !state.google?.configured
    ? 'Google non configuré'
    : state.google.connected
      ? `Google connecté${state.google.lastSyncedAt ? ` · synchro ${date(state.google.lastSyncedAt)}` : ''}`
      : 'Google non connecté';
  return `<div class="section-head"><div><span class="label">PLANNING SYNCHRONISÉ</span><h3>Prochains rendez-vous</h3><small class="muted">${state.twitch.connected ? `Twitch · ${esc(state.twitch.displayName)}` : 'Twitch non connecté'} · ${esc(googleText)}</small></div><div class="button-row">${state.twitch.connected ? `<button class="ghost compact" ${state.twitch.syncing ? 'disabled' : ''} data-action="sync-twitch">↻ Twitch</button>` : ''}${state.google?.connected && state.google.targetCalendarId ? '<button class="ghost compact" data-action="sync-google">↻ Google</button>' : ''}<button class="primary compact" data-action="open-event">+ Ajouter</button></div></div><div class="schedule">${rows.map(item => `<article><time><b>${new Date(item.startAtUtc).toLocaleDateString('fr-FR', { day: '2-digit', timeZone: item.allDay ? 'UTC' : undefined })}</b>${new Date(item.startAtUtc).toLocaleDateString('fr-FR', { month: 'short', timeZone: item.allDay ? 'UTC' : undefined })}</time><div><div>${providerBadge(item, 'twitch')} ${providerBadge(item, 'google')}</div><h3>${esc(item.title)}</h3><p>${eventRange(item)}</p>${item.recurrence ? `<p class="muted">${esc(recurrenceSummary(item))}</p>` : ''}${item.draft ? '<p class="muted">● Live non programmé en cours · fin provisoire jusqu’à l’arrêt OBS.</p>' : ''}${item.editable === false ? '<p class="muted">Lecture seule</p>' : ''}${item.twitchCategoryName ? `<p class="muted">Twitch : ${esc(item.twitchCategoryName)}</p>` : ''}${item.conflict ? `<p class="muted">⚠ Conflit ${esc(item.conflict.provider)} : choisis explicitement la version à garder.</p>` : ''}${item.syncError ? `<p class="muted">⚠ ${esc(item.syncError)}</p>` : ''}${item.providers?.twitch?.lastError ? `<p class="muted">Twitch : ${esc(item.providers.twitch.lastError)}</p>` : ''}${item.providers?.google?.lastError ? `<p class="muted">Google : ${esc(item.providers.google.lastError)}</p>` : ''}</div><div class="button-row">${planningActions(item)}</div></article>`).join('') || '<div class="empty"><b>Aucun événement planifié</b><p>Votre planning est prêt à accueillir un premier live.</p></div>'}</div><details class="panel space planning-tools" id="planning-export-options"><summary>Outils du planning</summary><h3>Image réseaux</h3><label>Période export<select name="exportPeriod"><option value="today">Aujourd’hui</option><option value="this-week">Cette semaine</option><option value="next-week">Semaine prochaine</option></select></label><div class="form-grid">${Object.entries({twitch:'Twitch',google:'Google',allDay:'Journée entière',live:'Live',personal:'Personnel',production:'Production'}).map(([key,label])=>`<label class="switch"><span>${label}</span><input type="checkbox" name="filter-${key}"></label>`).join('')}</div><label class="switch"><span>Afficher une note « lives improvisés »</span><input type="checkbox" name="exportNoteEnabled"></label><label>Texte de la note<input name="exportNoteText" maxlength="120"></label><button class="ghost" data-action="export-planning">IMAGE DU PLANNING</button><button class="primary" data-action="publish-planning-discord">PUBLIER SUR DISCORD</button></details><dialog id="event-dialog"><form id="event-form" data-dirty="false"><div class="section-head"><h3 id="event-dialog-title">Nouveau rendez-vous</h3><button type="button" class="icon-btn" data-action="close-dialog">×</button></div><label>Titre<input name="title" maxlength="140" required></label><label class="switch"><span><b>Toute la journée</b><small>Google conserve alors un vrai événement journée entière.</small></span><input name="allDay" type="checkbox"></label><div class="form-grid"><label>Début<input name="start" type="datetime-local" required></label><label>Fin<input name="end" type="datetime-local" required></label></div><label>Type<select name="category"><option value="live">Live</option><option value="production">Production</option><option value="personal">Personnel</option></select></label><div class="form-grid"><label>Répéter<select name="recurrence"><option value="">Non</option><option value="weekly-1">Chaque semaine</option><option value="weekly-2">Toutes les 2 semaines</option><option value="monthly-1">Chaque mois</option></select></label><label>Fin de répétition<input name="recurrenceUntil" type="date"><small>Vide = sans fin.</small></label></div><label>Catégorie Twitch<input name="twitchCategoryName" maxlength="140" autocomplete="off"><input name="twitchCategoryId" type="hidden"></label><div id="desktop-twitch-results" class="category-results"></div><div id="publication-options" class="form-grid"><label class="switch"><span><b>Publier sur Twitch</b></span><input name="publishTwitch" type="checkbox"></label><label class="switch"><span><b>Publier sur Google</b></span><input name="publishGoogle" type="checkbox"></label></div><small class="muted">Les destinations sont modifiables ensuite. Désactiver une destination retire la publication distante sans perdre l’événement local.</small><button class="primary" type="submit">Enregistrer</button></form></dialog>`;
}

function deck() {
  const obs = state.obs;
  if (!obs.connected) return `<div class="section-head"><div><span class="label">OBS WEBSOCKET</span><h3>Scènes</h3></div><span class="status">Indisponible</span></div><div class="empty">${esc(obs.error || 'Lancez OBS pour charger vos scènes et votre mixeur.')}</div>`;
  const inputs = Object.entries(obs.inputs).filter(([name]) => obs.activeAudioInputs.includes(name));
  return `<div class="section-head"><div><span class="label">OBS WEBSOCKET</span><h3>Scènes</h3></div><span class="status ok">Connecté</span></div><div class="deck">${obs.scenes.map(scene => `<button class="pad ${obs.scene === scene ? 'active' : ''}" data-command="obs.scene" data-value="${encodeURIComponent(scene)}"><i>▣</i><b>${esc(scene)}</b></button>`).join('') || '<div class="empty">Aucune scène OBS détectée.</div>'}</div><div class="section-head space"><div><h3>Mixeur audio contextuel</h3><small class="muted">Échelle dB cohérente avec OBS.</small></div><span class="status ${inputs.length ? 'ok' : ''}">${inputs.length}/${Object.keys(obs.inputs).length} actives</span></div><div class="mixer">${inputs.map(([name, input]) => { const db = Math.max(-60, Math.min(6, inputDb(input))); return `<article><button class="mute ${input.muted ? 'muted' : ''}" data-command="obs.mute" data-value="${encodeURIComponent(name)}" data-muted="${!input.muted}">◉</button><div><b>${esc(name)}</b><input type="range" min="-60" max="6" step="0.5" value="${db}" data-command="obs.volumeDb" data-value="${encodeURIComponent(name)}"></div><span>${db <= -59.5 ? '-∞' : db.toFixed(1)} dB</span></article>`; }).join('') || '<p class="muted">Aucune source audio active dans cette scène.</p>'}</div>`;
}

function fun() {
  const media = state.obs.connected ? state.obs.mediaInputs || [] : [];
  return `<div class="section-head"><div><span class="label">FUN DECK · OBS</span><h3>Médias instantanés</h3></div><span class="status ${state.obs.connected ? 'ok' : ''}">${state.obs.connected ? 'OBS connecté' : 'OBS indisponible'}</span></div><div class="deck fun">${media.map(name => `<button class="pad" data-command="obs.media.restart" data-value="${encodeURIComponent(name)}"><i>▶</i><b>${esc(name)}</b><small>Relancer la source OBS</small></button>`).join('') || '<div class="empty"><b>Aucun média OBS détecté</b></div>'}</div>`;
}

function diagnostics() {
  const runtime = state.runtime;
  return `<div class="grid">${Object.entries(state.health).map(([name, health]) => card(name, `<span class="${health.ok ? 'green' : 'red'}">${health.ok ? 'Opérationnel' : 'Attention'}</span>`, health.detail)).join('')}</div><div class="panel space"><div class="section-head"><span class="label">INFORMATIONS TECHNIQUES</span>${window.streamDashboardDesktop ? '<button class="ghost compact" data-action="open-logs">Ouvrir les logs</button>' : ''}</div><div class="details"><span>StreamDashboard <b>${esc(runtime.serverVersion)}</b></span><span>Electron <b>${esc(runtime.electronVersion || 'mode serveur')}</b></span><span>Node <b>${esc(runtime.nodeVersion)}</b></span><span>Système <b>${esc(runtime.platform)}</b></span><span>Port <b>${runtime.port}</b></span><span>Dernière mise à jour <b>${date(state.at)}</b></span></div></div>`;
}

function obsRuntime() {
  return state.obs.connected
    ? `<div class="status ok">OBS connecté${state.obs.obsVersion ? ` · v${esc(state.obs.obsVersion)}` : ''}</div>`
    : `<div class="status">${esc(state.obs.error || 'OBS non connecté')}</div>`;
}
function twitchRuntime() {
  return `<div class="status ${state.twitch.connected ? 'ok' : ''}">${state.twitch.connected ? `Connecté en tant que ${esc(state.twitch.displayName)}` : esc(state.twitch.error || 'Twitch non connecté')}</div>${state.twitch.deviceAuthorization ? `<div class="device-code"><small>CODE TWITCH</small><strong>${esc(state.twitch.deviceAuthorization.userCode)}</strong><small>Validez ce code avant ${date(state.twitch.deviceAuthorization.expiresAt)}.</small></div>` : ''}<div class="button-row">${state.twitch.connected ? '<button class="ghost" type="button" data-action="disconnect-twitch">Déconnecter Twitch</button>' : '<button class="ghost" type="button" data-action="connect-twitch">Connecter Twitch</button>'}</div>`;
}
function googleRuntime() {
  if (!state.google?.configured) return '<div class="status">Google Calendar non configuré dans cette distribution (GOOGLE_CLIENT_ID manquant).</div>';
  const calendar = state.google.targetCalendarId ?? '';
  return `<div class="status ${state.google.connected ? 'ok' : ''}">${state.google.connected ? 'Google Calendar connecté' : esc(state.google.error || 'Google Calendar non connecté')}</div>${state.google.connected ? `<label>Calendrier cible<select id="google-calendar-target"><option value="">Choisir…</option>${state.google.calendars.map(item => `<option value="${esc(item.id)}" ${calendar === item.id ? 'selected' : ''} ${!item.writable ? 'disabled' : ''}>${esc(item.summary)}${item.writable ? '' : ' (lecture seule)'}</option>`).join('')}</select></label><div class="button-row"><button class="ghost" type="button" data-action="sync-google">Synchroniser Google</button><button class="ghost" type="button" data-action="disconnect-google">Déconnecter Google</button></div>` : '<button class="ghost" type="button" data-action="connect-google">Connecter Google Calendar</button>'}`;
}
function remoteRuntime() {
  const enabled = state.remote?.enabled === true;
  const configured = state.settings.remoteEnabled === true;
  const devices = state.remote?.devices ?? [];
  return `<label class="switch"><span><b>Télécommande LAN</b><small>${enabled ? 'Active sur ce démarrage' : configured ? 'Redémarrage requis pour l’activer' : 'Désactivée par défaut'}</small></span><input name="remoteEnabled" type="checkbox" ${configured ? 'checked' : ''}></label>${enabled ? `<div class="button-row"><button class="ghost" type="button" data-action="create-pairing">Ajouter une télécommande</button></div>${remotePairing ? `<div class="device-code"><small>ID DE PAIRING</small><strong>${esc(remotePairing.id)}</strong><small>CODE</small><strong>${esc(remotePairing.code)}</strong>${remotePairing.urls?.map(url => `<small>${esc(url)}</small>`).join('') || ''}${remotePairing.androidLinks?.map(url => `<small>Lien Android : ${esc(url)}</small>`).join('') || ''}<small>Expire : ${date(remotePairing.expiresAt)}</small></div>` : ''}<div class="details">${devices.filter(device => !device.revokedAt).map(device => `<span>${esc(device.name)} · ${esc(device.lastSeenAt || 'jamais')} <button class="ghost compact" type="button" data-action="revoke-device" data-value="${encodeURIComponent(device.id)}">Révoquer</button></span>`).join('') || '<span>Aucune télécommande appairée.</span>'}</div>` : ''}`;
}

function settings() {
  const browsers = configuredOptions(state.settings.timerBrowserSource, state.obs.browserInputs || []);
  const sceneOptions = mode => configuredOptions(state.settings.modeScenes?.[mode], state.obs.scenes || []);
  return `${connections()}<form class="panel settings" id="settings-form"><span class="label">PRÉFÉRENCES DU COCKPIT</span><label>Nom affiché<input name="streamerName" maxlength="80" value="${esc(state.settings.streamerName)}"></label><label>Couleur d’accent<select name="accent"><option value="violet">Violet</option><option value="cyan">Cyan</option><option value="rose">Rose</option></select></label><label class="switch"><span><b>Confirmer l’arrêt du live</b><small>Évite les arrêts accidentels</small></span><input name="confirmStop" type="checkbox" ${state.settings.confirmStop ? 'checked' : ''}></label><span class="label section-label">CONNEXION OBS</span><label class="switch"><span><b>Lancer OBS avec StreamDashboard</b></span><input name="launchObs" type="checkbox" ${state.settings.launchObs ? 'checked' : ''}></label><label>Chemin OBS Studio<input name="obsExecutablePath" maxlength="500" value="${esc(state.settings.obsExecutablePath || '')}"></label><label>Adresse OBS WebSocket<input name="obsUrl" value="${esc(state.settings.obsUrl)}"></label><label>Mot de passe OBS<input name="obsPassword" type="password" maxlength="500" autocomplete="new-password" placeholder="${state.settings.obsPasswordSet ? 'Mot de passe enregistré — laisser vide pour conserver' : 'Mot de passe WebSocket OBS'}"></label>${state.settings.obsPasswordSet ? '<label class="switch"><span><b>Effacer le mot de passe OBS enregistré</b></span><input name="clearObsPassword" type="checkbox"></label>' : ''}<div id="obs-runtime">${obsRuntime()}</div><label>Scène au clic « Démarrer le live »<select name="startMode"><option value="intro" ${state.settings.startMode !== 'live' ? 'selected' : ''}>Intro (recommandé)</option><option value="live" ${state.settings.startMode === 'live' ? 'selected' : ''}>Live / Gameplay</option></select><small>La scène choisie est envoyée à OBS puis confirmée avant StartStream.</small></label><label>Browser Source du timer<select name="timerBrowserSource"><option value="">Non configurée</option>${browsers.map(name => `<option value="${esc(name)}" ${state.settings.timerBrowserSource === name ? 'selected' : ''}>${esc(name)}${state.obs.browserInputs?.includes(name) ? '' : ' (configurée, OBS hors ligne/absente)'}</option>`).join('')}</select><small>Cette source sera rafraîchie sans cache à Préparer et juste avant Start.</small></label><label class="switch"><span><b>Exiger le timer avant Start</b><small>Bloque le démarrage si la Browser Source du timer n’est pas prête.</small></span><input name="requireTimerOverlayOnStart" type="checkbox" ${state.settings.requireTimerOverlayOnStart ? 'checked' : ''}></label><label>Micro principal<select name="primaryMicInput"><option value="">Non configuré</option>${configuredOptions(state.settings.primaryMicInput, state.obs.activeAudioInputs || []).map(name => `<option value="${esc(name)}" ${state.settings.primaryMicInput === name ? 'selected' : ''}>${esc(name)}${state.obs.activeAudioInputs?.includes(name) ? '' : ' (configuré, source absente)'}</option>`).join('')}</select><small>Seule cette source est pilotée par l’action Micro du téléphone.</small></label><span class="label section-label">SCÈNES PAR MODE</span><div class="form-grid">${['intro', 'live', 'pause', 'end'].map(mode => `<label>Scène ${mode}<select name="scene-${mode}"><option value="">Non configurée</option>${sceneOptions(mode).map(scene => `<option value="${esc(scene)}" ${state.settings.modeScenes?.[mode] === scene ? 'selected' : ''}>${esc(scene)}${state.obs.scenes?.includes(scene) ? '' : ' (configurée, OBS hors ligne/absente)'}</option>`).join('')}</select></label>`).join('')}</div><label>Scène Chatting<select name="chattingScene"><option value="">Non configurée</option>${configuredOptions(state.settings.chattingScene, state.obs.scenes || []).map(scene => `<option value="${esc(scene)}" ${state.settings.chattingScene === scene ? 'selected' : ''}>${esc(scene)}</option>`).join('')}</select><small>Variante de contenu du mode Live, sans changer le timer ni l’état Twitch.</small></label><span class="label section-label">TWITCH</span><div id="twitch-runtime">${twitchRuntime()}</div><span class="label section-label">GOOGLE CALENDAR</span><div id="google-runtime">${googleRuntime()}</div><span class="label section-label">DISCORD</span><div id="discord-runtime"><p>${state.discord?.configured ? `Token configuré · ${state.discord.connected ? 'Connecté' : esc(state.discord.error || 'À tester')}` : 'Bot non configuré'}</p><label>Token du bot<input id="discord-token" type="password" maxlength="300" autocomplete="new-password" placeholder="Le token ne sera jamais réaffiché"></label><div class="button-row"><button type="button" class="ghost" data-action="save-discord-token">Enregistrer/remplacer</button><button type="button" class="ghost" data-action="delete-discord-token">Supprimer/déconnecter</button><button type="button" class="ghost" data-action="load-discord">Tester/charger Discord</button></div><label>Serveur<select id="discord-guild"><option value="">Choisir…</option></select></label><label>Salon texte<select id="discord-channel"><option value="">Choisir…</option></select></label><label>Message par défaut<textarea id="discord-default-message" maxlength="2000">${esc(state.discordDefaultMessage || '')}</textarea></label></div><span class="label section-label">TÉLÉCOMMANDE</span><div id="remote-runtime">${remoteRuntime()}</div><div class="button-row"><button class="ghost" type="button" data-action="test-obs">Tester OBS</button><button class="primary" type="submit">Enregistrer</button></div></form>`;
}

function render() {
  if (!state) return;
  document.body.classList.toggle('desktop-focus', desktopFocus);
  document.documentElement.dataset.accent = state.settings.accent;
  $('#title').textContent = pages.find(item => item[0] === page)?.[1] ?? 'StreamDashboard';
  updateHeader();
  const views = { overview, prepare: preparation, live, planning, sounds: deck, supports, automations, connections, settings };
  $('#view').innerHTML = views[page]();
  bindForms();
  document.querySelectorAll('[data-preparation-view]').forEach(button => { button.onclick = () => { preparationView = button.dataset.preparationView; localStorage.setItem('streamdashboard.desktopPreparationView', preparationView); render(); }; });
}

function updateHeader() {
  const healthy = Boolean(state.runtime && state.obs.connected && state.twitch.connected);
  $('#pc-pill').textContent = healthy ? '✓ TOUT EST PRÊT' : `PC ${state.runtime ? 'CONNECTÉ' : 'HORS LIGNE'}`;
  $('#pc-pill').className = `status-pill ${healthy ? 'ready-summary' : ''}`;
  $('#obs-pill').hidden = healthy;
  $('#twitch-pill').hidden = healthy;
  $('#obs-pill').textContent = `OBS ${state.obs.connected ? 'CONNECTÉ' : 'HORS LIGNE'}`;
  $('#obs-pill').className = `obs-pill ${state.obs.connected ? 'ok' : ''}`;
  $('#live-pill').textContent = state.obs.streaming ? '● EN DIRECT' : 'HORS LIGNE';
  $('#live-pill').className = `live-pill ${state.obs.streaming ? 'on' : ''}`;
  $('#twitch-pill').textContent = `TWITCH ${state.twitch.connected ? 'CONNECTÉ' : 'DÉCONNECTÉ'}`;
}
function dirtyForm() { return document.querySelector('#view form[data-dirty="true"]'); }
function updateSettingsRuntime() {
  const obs = $('#obs-runtime');
  const twitch = $('#twitch-runtime');
  const google = $('#google-runtime');
  const remote = $('#remote-runtime');
  if (obs) obs.innerHTML = obsRuntime();
  if (twitch) twitch.innerHTML = twitchRuntime();
  if (google) google.innerHTML = googleRuntime();
  if (remote) remote.innerHTML = remoteRuntime();
}
function applyStateUpdate(next, force = false) {
  const previous = state;
  state = next;
  if (!previous || force) { render(); return; }
  document.documentElement.dataset.accent = state.settings.accent;
  updateHeader();
  updateTimer();
  if (page === 'prepare') updateChecklist();

  const structural = page === 'overview'
    || page === 'prepare'
    || page === 'planning'
    || page === 'deck' && JSON.stringify([previous.obs.connected, previous.obs.scenes, previous.obs.activeAudioInputs, previous.obs.inputs, previous.obs.scene]) !== JSON.stringify([state.obs.connected, state.obs.scenes, state.obs.activeAudioInputs, state.obs.inputs, state.obs.scene])
    || page === 'live' && JSON.stringify([previous.obs.connected, previous.obs.streaming, previous.mode, previous.obs.scene, previous.timer.running, previous.settings.timerBrowserSource]) !== JSON.stringify([state.obs.connected, state.obs.streaming, state.mode, state.obs.scene, state.timer.running, state.settings.timerBrowserSource])
    || page === 'fun' && JSON.stringify([previous.obs.connected, previous.obs.mediaInputs]) !== JSON.stringify([state.obs.connected, state.obs.mediaInputs])
    || page === 'settings' && JSON.stringify([previous.obs.connected, previous.obs.error, previous.obs.scenes, previous.obs.browserInputs, previous.twitch, previous.google, previous.remote, previous.settings]) !== JSON.stringify([state.obs.connected, state.obs.error, state.obs.scenes, state.obs.browserInputs, state.twitch, state.google, state.remote, state.settings]);
  if (!structural) return;
  if (dirtyForm()) {
    if (page === 'settings') updateSettingsRuntime();
    return;
  }
  render();
}
function updateTimer() {
  const element = $('#timer-value');
  if (element) element.textContent = duration(timerRemaining());
  if (page === 'overview') {
    const metric = document.querySelector('.stats .card:nth-child(4) .metric');
    if (metric) metric.textContent = duration(timerRemaining());
  }
}
function updateChecklist() {
  const done = state.checklist.filter(item => item.done).length;
  const count = $('#check-count');
  const bar = $('#check-progress');
  const status = $('#prepare-status');
  const obs = $('#prepare-obs');
  const start = document.querySelector('.launch [data-command="session.start"]');
  if (count) count.textContent = `${done}/${state.checklist.length} vérifications terminées`;
  if (bar) bar.style.width = `${state.checklist.length ? done / state.checklist.length * 100 : 0}%`;
  if (status) status.textContent = done === state.checklist.length ? 'Tout est prêt' : 'Préparation incomplète';
  if (obs) obs.textContent = state.obs.connected ? `OBS répond correctement. Démarrage prévu sur ${state.settings.startMode === 'live' ? 'Live' : 'Intro'}.` : state.obs.error || 'OBS est hors ligne.';
  if (start) {
    start.disabled = !state.obs.connected || state.obs.streaming;
    start.textContent = state.obs.streaming ? 'Live déjà actif' : 'Démarrer le live';
  }
}

async function prepareLive() {
  page = 'prepare';
  nav();
  render();
  if (state.obs.connected) { await command('session.prepare'); return; }
  if (!window.streamDashboardDesktop?.ensureObsRunning) {
    toast('OBS n’est pas lancé. Le lancement automatique est disponible dans l’application Desktop.', true);
    return;
  }
  try {
    toast('Lancement OBS…');
    const result = await window.streamDashboardDesktop.ensureObsRunning();
    const alreadyRunning = /déjà lancé/i.test(result.detail);
    if (!result.launched && !alreadyRunning) { toast(result.detail, true); return; }
    toast(result.detail);
    const deadline = Date.now() + 45_000;
    let wait = 400;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, wait));
      const next = await request('/api/v1/state');
      applyStateUpdate(next);
      if (next.obs.connected) {
        await command('session.prepare');
        toast('OBS connecté · préparation terminée');
        return;
      }
      wait = Math.min(2_000, Math.round(wait * 1.5));
    }
    toast('OBS est lancé mais le WebSocket ne répond toujours pas.', true);
  } catch (error) {
    toast(`Impossible de lancer OBS : ${error.message}`, true);
  }
}

function configureEventDateInputs(allDay, preserve = true) {
  const form = $('#event-form');
  if (!form) return;
  for (const name of ['start', 'end']) {
    const input = form.elements[name];
    const previous = input.value;
    input.type = allDay ? 'date' : 'datetime-local';
    if (!preserve || !previous) continue;
    if (allDay) input.value = previous.slice(0, 10);
    else input.value = `${previous.slice(0, 10)}T${name === 'start' ? '09:00' : '10:00'}`;
  }
}

function resetEventDialogState() {
  editingEventId = null;
  editingOccurrence = null;
  const form = $('#event-form');
  if (form) { form.dataset.dirty = 'false'; form.elements.recurrence.disabled = false; form.elements.recurrenceUntil.disabled = false; }
}

function bindForms() {
  const streamlabsForm = $('#streamlabs-form');
  if (streamlabsForm) streamlabsForm.onsubmit = async event => {
    event.preventDefault();
    const token = new FormData(streamlabsForm).get('token');
    if (!String(token || '').trim()) { toast('Saisissez le token Socket Streamlabs.', true); return; }
    try { await request('/api/v1/supports/streamlabs/config', 'PUT', { token }); streamlabsForm.reset(); toast('Streamlabs configuré'); await refresh(true); }
    catch (error) { toast(error.message, true); }
  };
  const wizebotForm = $('#wizebot-form');
  if (wizebotForm) wizebotForm.onsubmit = async event => {
    event.preventDefault();
    const form = new FormData(wizebotForm);
    try { await request('/api/v1/wizebot/config', 'PUT', { apiBaseUrl: form.get('apiBaseUrl'), token: form.get('token') }); wizebotForm.reset(); toast('WizeBot configuré'); await refresh(true); }
    catch (error) { toast(error.message, true); }
  };
  const eventDialog = $('#event-dialog');
  const eventForm = $('#event-form');
  if (eventDialog) eventDialog.addEventListener('close', resetEventDialogState, { once: true });
  if (eventForm) {
    const categoryInput = eventForm.elements.twitchCategoryName;
    const categoryId = eventForm.elements.twitchCategoryId;
    const results = $('#desktop-twitch-results');
    let categoryTimer; let categoryGeneration = 0;
    const showCategories = items => { results.replaceChildren(...items.map(item => { const button = document.createElement('button'); button.type = 'button'; button.className = 'ghost'; button.textContent = item.name; button.dataset.gameId = item.id; button.dataset.gameName = item.name; button.dataset.boxArtUrl = item.box_art_url || ''; return button; })); };
    categoryInput.onfocus = () => { if (!categoryInput.value.trim()) showCategories(recentCategories); };
    categoryInput.oninput = () => { categoryId.value = ''; clearTimeout(categoryTimer); const query = normalizeCategoryQuery(categoryInput.value); const generation = ++categoryGeneration; if (query.length < 2) { showCategories(query ? [] : recentCategories); return; } results.textContent = 'Recherche…'; categoryTimer = setTimeout(async () => { try { const found = await request(`/api/v1/twitch/categories?q=${encodeURIComponent(query)}`); if (generation !== categoryGeneration) return; const ranked = rankCategories(found, recentCategories, query); showCategories(ranked); if (!ranked.length) results.textContent = 'Aucune catégorie trouvée.'; } catch (error) { if (generation === categoryGeneration) results.textContent = error.message; } }, 300); };
    results.onclick = event => { const button = event.target.closest('[data-game-id]'); if (!button) return; categoryId.value = button.dataset.gameId; categoryInput.value = button.dataset.gameName; recentCategories = rememberCategory(recentCategories, { id: button.dataset.gameId, name: button.dataset.gameName, box_art_url: button.dataset.boxArtUrl || undefined }); localStorage.setItem(recentCategoriesKey, JSON.stringify(recentCategories)); results.replaceChildren(); };
    eventForm.dataset.dirty ||= 'false';
    eventForm.onsubmit = async event => {
      event.preventDefault();
      const form = new FormData(eventForm);
      const allDay = form.get('allDay') === 'on';
      const startValue = String(form.get('start') || '');
      const endValue = String(form.get('end') || '');
      try {
        const current = editingEventId ? state.planning.find(item => item.id === editingEventId) : null;
        const payload = {
          title: form.get('title'),
          startAtUtc: allDay ? allDayUtc(startValue) : new Date(startValue).toISOString(),
          endAtUtc: allDay ? allDayUtc(endValue) : new Date(endValue).toISOString(),
          allDay,
          category: form.get('category'),
          twitchCategoryId: form.get('twitchCategoryId') || undefined,
          twitchCategoryName: form.get('twitchCategoryName') || undefined,
          desiredPublication: {
            local: true,
            twitch: form.get('publishTwitch') === 'on',
            google: form.get('publishGoogle') === 'on',
          },
        };
        const recurrenceValue = String(form.get('recurrence') || ''); const [frequency, interval] = recurrenceValue.split('-'); const untilDate = String(form.get('recurrenceUntil') || '');
        payload.recurrence = recurrenceValue ? { frequency, interval: Number(interval), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris', until: untilDate ? new Date(`${untilDate}T23:59:59`).toISOString() : null, exceptions: editingOccurrence?.recurrence?.exceptions || current?.recurrence?.exceptions || {} } : null;
        if (payload.desiredPublication.twitch && !payload.twitchCategoryId) throw new Error('Sélectionnez une catégorie Twitch officielle.');
        if (current?.twitchRecurring
          && current.desiredPublication?.twitch
          && !payload.desiredPublication.twitch
          && !confirm('Ce live appartient à une série Twitch récurrente. Confirmer son retrait du planning Twitch ?')) return;
        if (current?.twitchRecurring && current.desiredPublication?.twitch && !payload.desiredPublication.twitch) payload.confirmRecurring = true;

        const occurrencePatch = { title: payload.title, startAtUtc: payload.startAtUtc, endAtUtc: payload.endAtUtc, category: payload.category, twitchCategoryId: payload.twitchCategoryId, twitchCategoryName: payload.twitchCategoryName, desiredPublication: payload.desiredPublication };
        const result = editingOccurrence
          ? await request(`/api/v1/planning/${encodeURIComponent(editingOccurrence.seriesId)}/occurrence`, 'PUT', { occurrenceKey: editingOccurrence.occurrenceKey, patch: occurrencePatch })
          : editingEventId
          ? await request(`/api/v1/planning/${encodeURIComponent(editingEventId)}`, 'PUT', payload)
          : await request('/api/v1/planning', 'POST', payload);
        eventForm.dataset.dirty = 'false';
        editingEventId = null;
        editingOccurrence = null;
        eventDialog?.close();
        applyStateUpdate(result, true);
        toast('Planning enregistré');
      } catch (error) {
        toast(error.message, true);
      }
    };
  }

  const exportOptions = $('#planning-export-options');
  if (exportOptions) {
    exportOptions.querySelector('[name="exportPeriod"]').value = planningExportPreferences.period;
    for (const [key, enabled] of Object.entries(planningExportPreferences.filters)) exportOptions.querySelector(`[name="filter-${key}"]`).checked = enabled;
    exportOptions.querySelector('[name="exportNoteEnabled"]').checked = planningExportPreferences.noteEnabled;
    exportOptions.querySelector('[name="exportNoteText"]').value = planningExportPreferences.noteText;
  }

  const settingsForm = $('#settings-form');
  if (settingsForm) {
    settingsForm.elements.accent.value = state.settings.accent;
    settingsForm.onsubmit = async event => {
      event.preventDefault();
      const form = new FormData(settingsForm);
      const beforeRemote = state.remote?.enabled === true;
      const payload = {
        streamerName: form.get('streamerName'),
        obsExecutablePath: form.get('obsExecutablePath'),
        accent: form.get('accent'),
        confirmStop: form.get('confirmStop') === 'on',
        launchObs: form.get('launchObs') === 'on',
        remoteEnabled: form.get('remoteEnabled') === 'on',
        startMode: form.get('startMode'),
        timerBrowserSource: form.get('timerBrowserSource'),
        primaryMicInput: form.get('primaryMicInput'),
        requireTimerOverlayOnStart: form.get('requireTimerOverlayOnStart') === 'on',
        chattingScene: form.get('chattingScene'),
        obsUrl: form.get('obsUrl'),
        modeScenes: Object.fromEntries(['intro', 'live', 'pause', 'end']
          .map(mode => [mode, form.get(`scene-${mode}`)])
          .filter(([, scene]) => scene)),
      };
      const clearPassword = form.get('clearObsPassword') === 'on';
      const password = form.get('obsPassword');
      if (clearPassword) payload.clearObsPassword = true;
      else if (password) payload.obsPassword = password;
      try {
        const result = await request('/api/v1/settings', 'PUT', payload);
        settingsForm.dataset.dirty = 'false';
        applyStateUpdate(result, true);
        toast(payload.remoteEnabled !== beforeRemote ? 'Réglages enregistrés · redémarrage requis pour le LAN' : 'Réglages enregistrés');
      } catch (error) {
        toast(error.message, true);
      }
    };
    const discordGuild = $('#discord-guild'); const discordChannel = $('#discord-channel'); const discordMessage = $('#discord-default-message');
    if (discordGuild) discordGuild.onchange = () => void window.loadDiscordChannels();
    if (discordChannel) discordChannel.onchange = () => void window.saveDiscordSettings();
    if (discordMessage) discordMessage.onchange = () => void window.saveDiscordSettings();
  }
}

window.command = command;
window.go = id => {
  if (id === 'prepare') return prepareLive();
  page = id;
  nav();
  render();
};
window.openEvent = () => {
  editingEventId = null;
  const dialog = $('#event-dialog');
  const form = $('#event-form');
  if (!dialog || !form) return;
  form.reset();
  form.dataset.dirty = 'false';
  $('#event-dialog-title').textContent = 'Nouveau rendez-vous';
  form.elements.allDay.checked = false;
  form.elements.publishTwitch.checked = false;
  form.elements.publishGoogle.checked = false;
  form.elements.twitchCategoryId.value = '';
  form.elements.twitchCategoryName.value = '';
  configureEventDateInputs(false, false);
  dialog.showModal();
};
window.editEvent = id => {
  const item = state.planning.find(value => value.id === id);
  const dialog = $('#event-dialog');
  const form = $('#event-form');
  if (!item || !dialog || !form) return;
  if (item.editable === false) { toast('Cet événement est en lecture seule.', true); return; }
  editingEventId = id;
  $('#event-dialog-title').textContent = 'Modifier le rendez-vous';
  form.dataset.dirty = 'false';
  form.elements.title.value = item.title;
  form.elements.allDay.checked = Boolean(item.allDay);
  configureEventDateInputs(Boolean(item.allDay), false);
  form.elements.start.value = item.allDay ? dateOnly(item.startAtUtc) : datetimeLocal(item.startAtUtc);
  form.elements.end.value = item.allDay ? dateOnly(item.endAtUtc) : datetimeLocal(item.endAtUtc);
  form.elements.category.value = item.category || 'live';
  form.elements.twitchCategoryName.value = item.twitchCategoryName || '';
  form.elements.twitchCategoryId.value = item.twitchCategoryId || '';
  form.elements.publishTwitch.checked = item.desiredPublication?.twitch === true;
  form.elements.publishGoogle.checked = item.desiredPublication?.google === true;
  form.elements.recurrence.value = item.recurrence ? `${item.recurrence.frequency}-${item.recurrence.interval}` : '';
  form.elements.recurrenceUntil.value = item.recurrence?.until ? item.recurrence.until.slice(0, 10) : '';
  dialog.showModal();
};
window.editOccurrence = id => {
  const rows = expandRecurringItems(state.planning, { from: Date.now() - 366 * 86400000, to: Date.now() + 730 * 86400000 });
  const item = rows.find(value => value.id === id); if (!item) return;
  window.editEvent(item.seriesId); editingOccurrence = item; editingEventId = null;
  const form = $('#event-form'); $('#event-dialog-title').textContent = 'Modifier cette occurrence'; form.elements.title.value = item.title; form.elements.start.value = datetimeLocal(item.startAtUtc); form.elements.end.value = datetimeLocal(item.endAtUtc); form.elements.recurrence.disabled = true; form.elements.recurrenceUntil.disabled = true;
};
window.removeOccurrence = async id => {
  const item = expandRecurringItems(state.planning, { from: Date.now() - 366 * 86400000, to: Date.now() + 730 * 86400000 }).find(value => value.id === id);
  if (!item || !confirm(`Supprimer uniquement l’occurrence « ${item.title} » ?`)) return;
  try { applyStateUpdate(await request(`/api/v1/planning/${encodeURIComponent(item.seriesId)}/occurrence`, 'DELETE', { occurrenceKey: item.occurrenceKey }), true); toast('Occurrence supprimée'); } catch (error) { toast(error.message, true); }
};
window.removeEvent = async id => {
  const item = state.planning.find(value => value.id === id);
  if (!item || !confirm(`Supprimer « ${item.title} » de StreamDashboard ?`)) return;
  const twitch = Boolean(item.twitchSegmentId || item.providers?.twitch?.remoteId) && confirm('Supprimer aussi la publication Twitch liée ?');
  const google = Boolean(item.providers?.google?.remoteId) && confirm('Supprimer aussi l’événement Google lié ?');
  const confirmRecurring = !item.twitchRecurring || !twitch || confirm('Ce live appartient à une série Twitch récurrente. Confirmer la suppression distante ?');
  if (!confirmRecurring) return;
  try {
    applyStateUpdate(await request(`/api/v1/planning/${encodeURIComponent(id)}`, 'DELETE', {
      destinations: { local: true, twitch, google }, confirmRecurring,
    }), true);
    toast('Événement supprimé');
  } catch (error) {
    toast(error.message, true);
  }
};
window.retryProvider = async (id, provider) => {
  const item = state.planning.find(value => value.id === id);
  const removingRecurringTwitch = provider === 'twitch'
    && item?.twitchRecurring
    && item.desiredPublication?.twitch !== true
    && Boolean(item.twitchSegmentId || item.providers?.twitch?.remoteId);
  if (removingRecurringTwitch && !confirm('Ce retry retirera une série Twitch récurrente. Confirmer ?')) return;
  try {
    applyStateUpdate(await request(`/api/v1/planning/${encodeURIComponent(id)}/retry/${encodeURIComponent(provider)}`, 'POST', {
      confirmRecurring: removingRecurringTwitch,
    }), true);
    toast(`Retry ${provider} terminé`);
  } catch (error) {
    toast(error.message, true);
  }
};
window.resolveConflict = async (id, provider, strategy) => {
  const wording = strategy === 'local' ? 'écraser la version distante avec ta version locale' : `remplacer ta version locale par la version ${provider}`;
  if (!confirm(`Confirmer : ${wording} ?`)) return;
  try {
    applyStateUpdate(await request(`/api/v1/planning/${encodeURIComponent(id)}/conflict/${encodeURIComponent(provider)}`, 'POST', { strategy }), true);
    toast('Conflit résolu');
  } catch (error) {
    toast(error.message, true);
  }
};
window.exportPlanning = async () => {
  try {
    const options = $('#planning-export-options');
    planningExportPreferences = { period: options.querySelector('[name="exportPeriod"]').value, filters: Object.fromEntries(['twitch','google','allDay','live','personal','production'].map(key => [key, options.querySelector(`[name="filter-${key}"]`).checked])), noteEnabled: options.querySelector('[name="exportNoteEnabled"]').checked, noteText: options.querySelector('[name="exportNoteText"]').value };
    localStorage.setItem(planningPreferencesKey, JSON.stringify(planningExportPreferences));
    const { exportPlanningImage } = await import('../mobile/planning-export.js');
    const resolveArtwork = async item => {
      const cached = recentCategories.find(category => category.id === item.twitchCategoryId)?.box_art_url;
      if (cached) return cached;
      const found = await request(`/api/v1/twitch/categories?q=${encodeURIComponent(item.twitchCategoryName || '')}`);
      return found.find(category => category.id === item.twitchCategoryId)?.box_art_url;
    };
    const count = await exportPlanningImage(state.planning, state.settings.streamerName, { ...planningExportPreferences, resolveArtwork });
    toast(`Image du planning générée · ${count} live${count > 1 ? 's' : ''}`);
  } catch (error) {
    toast(error.message, true);
  }
};
window.saveDiscordToken = async () => { try { const input = $('#discord-token'); if (!input.value.trim()) throw new Error('Saisissez le token du bot.'); await request('/api/v1/discord/token', 'PUT', { token: input.value }); input.value = ''; toast('Token configuré'); await refresh(true); } catch (error) { toast(error.message, true); } };
window.deleteDiscordToken = async () => { try { await request('/api/v1/discord/token', 'DELETE'); toast('Bot Discord déconnecté'); await refresh(true); } catch (error) { toast(error.message, true); } };
window.testStreamlabs = async () => { try { await request('/api/v1/supports/streamlabs/test', 'POST'); toast('Soutien de test reçu'); } catch (error) { toast(error.message, true); } };
window.disconnectStreamlabs = async () => { try { await request('/api/v1/supports/streamlabs/config', 'DELETE'); toast('Streamlabs déconnecté'); await refresh(true); } catch (error) { toast(error.message, true); } };
window.refreshWizebot = async () => { try { await request('/api/v1/wizebot/refresh', 'POST'); toast('WizeBot rafraîchi'); await refresh(true); } catch (error) { toast(error.message, true); } };
window.disconnectWizebot = async () => { try { await request('/api/v1/wizebot/config', 'DELETE'); toast('WizeBot déconnecté'); await refresh(true); } catch (error) { toast(error.message, true); } };
window.loadDiscord = async () => { try { const guilds = await request('/api/v1/discord/guilds'); const select = $('#discord-guild'); select.replaceChildren(new Option('Choisir…', ''), ...guilds.map(value => new Option(value.name, value.id))); if (state.discord?.guildId) select.value = state.discord.guildId; await window.loadDiscordChannels(); toast('Discord chargé'); } catch (error) { toast(error.message, true); } };
window.loadDiscordChannels = async () => { const guildId = $('#discord-guild')?.value; if (!guildId) return; const channels = await request(`/api/v1/discord/guilds/${encodeURIComponent(guildId)}/channels`); const select = $('#discord-channel'); select.replaceChildren(new Option('Choisir…', ''), ...channels.map(value => new Option(`#${value.name}`, value.id))); if (state.discord?.channelId) select.value = state.discord.channelId; };
window.saveDiscordSettings = async () => { try { await request('/api/v1/discord/settings', 'PUT', { guildId: $('#discord-guild').value || null, channelId: $('#discord-channel').value || null, defaultMessage: $('#discord-default-message').value }); toast('Destination Discord enregistrée'); await refresh(true); } catch (error) { toast(error.message, true); } };
window.publishPlanningDiscord = async () => {
  try { const options = $('#planning-export-options'); const resolveArtwork = async item => { const cached = recentCategories.find(category => category.id === item.twitchCategoryId)?.box_art_url; if (cached) return cached; const found = await request(`/api/v1/twitch/categories?q=${encodeURIComponent(item.twitchCategoryName || '')}`); return found.find(category => category.id === item.twitchCategoryId)?.box_art_url; }; const preferences = { period: options.querySelector('[name="exportPeriod"]').value, filters: Object.fromEntries(['twitch','google','allDay','live','personal','production'].map(key => [key, options.querySelector(`[name="filter-${key}"]`).checked])), noteEnabled: options.querySelector('[name="exportNoteEnabled"]').checked, noteText: options.querySelector('[name="exportNoteText"]').value, resolveArtwork }; const { buildPlanningPng } = await import('../mobile/planning-export.js'); toast('Génération du planning…'); const result = await buildPlanningPng(state.planning, state.settings.streamerName, preferences); const buffer = new Uint8Array(await result.blob.arrayBuffer()); let binary = ''; for (let i = 0; i < buffer.length; i += 0x8000) binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000)); toast('Publication Discord…'); const posted = await request('/api/v1/discord/planning', 'POST', { imageBase64: btoa(binary), filename: result.fileName }); toast(`Planning publié dans #${posted.channelName || 'planning'}.`); } catch (error) { toast(error.message, true); }
};
window.stopStream = () => {
  if (state.obs.streaming && (!state.settings.confirmStop || confirm('Arrêter réellement la diffusion ?'))) void command('session.stop');
};
window.testObs = async () => {
  const formElement = $('#settings-form');
  if (!formElement) return;
  const form = new FormData(formElement);
  const payload = { obsUrl: form.get('obsUrl') };
  const password = form.get('obsPassword');
  const clearPassword = form.get('clearObsPassword') === 'on';
  if (clearPassword) payload.obsPassword = '';
  else if (password) payload.obsPassword = password;
  try {
    const result = await request('/api/v1/obs/test', 'POST', payload);
    toast(`OBS connecté · v${result.obsVersion || '?'}`);
  } catch (error) { toast(error.message, true); }
};
window.connectTwitch = async () => {
  try {
    const result = await request('/api/v1/twitch/device', 'POST');
    if (window.streamDashboardDesktop) await window.streamDashboardDesktop.openTwitchActivation(result.verificationUri);
    else window.open(result.verificationUri, '_blank', 'noopener');
    toast(`Code Twitch : ${result.userCode}`);
    applyStateUpdate(await request('/api/v1/state'));
  } catch (error) { toast(error.message, true); }
};
window.disconnectTwitch = async () => {
  try { applyStateUpdate(await request('/api/v1/twitch/disconnect', 'POST')); toast('Twitch déconnecté'); }
  catch (error) { toast(error.message, true); }
};
window.syncTwitch = async () => {
  try { toast('Synchronisation Twitch…'); applyStateUpdate(await request('/api/v1/twitch/sync', 'POST'), true); toast('Planning Twitch synchronisé'); }
  catch (error) { toast(error.message, true); }
};
window.connectGoogle = async () => {
  try {
    const result = await request('/api/v1/google/oauth/start', 'POST');
    if (window.streamDashboardDesktop?.openExternalAuth) await window.streamDashboardDesktop.openExternalAuth(result.authorizationUrl);
    else window.open(result.authorizationUrl, '_blank', 'noopener');
    toast('Connexion Google ouverte dans le navigateur');
  } catch (error) { toast(error.message, true); }
};
window.disconnectGoogle = async () => {
  try { applyStateUpdate(await request('/api/v1/google/disconnect', 'POST'), true); toast('Google Calendar déconnecté'); }
  catch (error) { toast(error.message, true); }
};
window.syncGoogle = async () => {
  try { toast('Synchronisation Google…'); applyStateUpdate(await request('/api/v1/google/sync', 'POST'), true); toast('Google Calendar synchronisé'); }
  catch (error) { toast(error.message, true); }
};
window.createPairing = async () => {
  try { remotePairing = await request('/api/v1/remote/pairing', 'POST'); render(); toast('Code de pairing créé'); }
  catch (error) { toast(error.message, true); }
};
window.revokeDevice = async id => {
  if (!confirm('Révoquer immédiatement cette télécommande ?')) return;
  try { await request(`/api/v1/remote/devices/${encodeURIComponent(id)}`, 'DELETE'); await refresh(true); toast('Télécommande révoquée'); }
  catch (error) { toast(error.message, true); }
};

document.addEventListener('input', event => {
  const form = event.target instanceof Element ? event.target.closest('#view form') : null;
  if (form) form.dataset.dirty = 'true';
}, true);

document.addEventListener('change', event => {
  const form = event.target instanceof Element ? event.target.closest('#view form') : null;
  if (form) form.dataset.dirty = 'true';
  const element = event.target;
  if (element?.dataset?.command === 'obs.volumeDb') {
    void command('obs.volumeDb', { input: decodeURIComponent(element.dataset.value), volumeDb: +element.value });
  }
  if (element?.name === 'allDay') configureEventDateInputs(element.checked);
  if (element?.id === 'google-calendar-target' && element.value) {
    void request('/api/v1/google/target', 'PUT', { calendarId: element.value })
      .then(value => { applyStateUpdate(value, true); toast('Calendrier Google sélectionné'); })
      .catch(error => toast(error.message, true));
  }
}, true);

document.addEventListener('click', event => {
  const element = event.target.closest('[data-action],[data-command]');
  if (!element || element.disabled) return;
  const value = element.dataset.value ? decodeURIComponent(element.dataset.value) : undefined;
  if (element.dataset.command) {
    const type = element.dataset.command;
    const details = {};
    if (type === 'session.stop' && state.settings.confirmStop && !confirm('Arrêter réellement la diffusion ?')) return;
    if (type === 'checklist.toggle') details.id = value;
    if (type === 'mode.set') details.mode = value;
    if (type === 'timer.add') details.seconds = +element.dataset.seconds;
    if (type === 'obs.scene') details.scene = value;
    if (type === 'obs.mute') { details.input = value; details.muted = element.dataset.muted === 'true'; }
    if (type === 'obs.media.restart' || type === 'obs.browser.refresh') details.input = value;
    element.disabled = true;
    element.dataset.status = 'loading';
    void command(type, details).finally(() => {
      if (element.isConnected) { element.disabled = false; element.dataset.status = 'idle'; }
    });
    return;
  }

  const actions = {
    go: () => window.go(value),
    'stop-stream': window.stopStream,
    'sync-twitch': window.syncTwitch,
    'sync-google': window.syncGoogle,
    'export-planning': window.exportPlanning,
    'publish-planning-discord': window.publishPlanningDiscord,
    'open-event': window.openEvent,
    'edit-event': () => window.editEvent(value),
    'edit-occurrence': () => window.editOccurrence(value),
    'retry-provider': () => window.retryProvider(value, element.dataset.provider),
    'resolve-conflict': () => window.resolveConflict(value, element.dataset.provider, element.dataset.strategy),
    'remove-event': () => window.removeEvent(value),
    'remove-occurrence': () => window.removeOccurrence(value),
    'close-dialog': () => { resetEventDialogState(); element.closest('dialog')?.close(); },
    'open-logs': () => window.streamDashboardDesktop?.openLogs(),
    'test-obs': window.testObs,
    'save-discord-token': window.saveDiscordToken,
    'delete-discord-token': window.deleteDiscordToken,
    'load-discord': window.loadDiscord,
    'test-streamlabs': window.testStreamlabs,
    'disconnect-streamlabs': window.disconnectStreamlabs,
    'refresh-wizebot': window.refreshWizebot,
    'disconnect-wizebot': window.disconnectWizebot,
    'disconnect-twitch': window.disconnectTwitch,
    'connect-twitch': window.connectTwitch,
    'connect-google': window.connectGoogle,
    'disconnect-google': window.disconnectGoogle,
    'create-pairing': window.createPairing,
    'revoke-device': () => window.revokeDevice(value),
  };
  const action = actions[element.dataset.action];
  if (action) {
    element.disabled = true;
    Promise.resolve(action())
      .catch(error => toast(error.message, true))
      .finally(() => { if (element.isConnected) element.disabled = false; });
  }
});

function socket() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/v1`);
  ws.onopen = () => {
    $('#socket').innerHTML = '<i></i> Temps réel';
    $('#socket').classList.add('online');
  };
  ws.onmessage = event => {
    try {
      const message = JSON.parse(event.data);
      if (message.type === 'state.updated') applyStateUpdate(message.data);
    } catch { toast('Événement temps réel invalide.', true); }
  };
  ws.onclose = () => {
    $('#socket').textContent = 'Reconnexion…';
    $('#socket').classList.remove('online');
    setTimeout(socket, 1500);
  };
  ws.onerror = () => ws.close();
}

nav();
$('#desktop-focus').onclick = () => { desktopFocus = !desktopFocus; localStorage.setItem('streamdashboard.desktopFocus', String(desktopFocus)); $('#desktop-focus').setAttribute('aria-pressed', String(desktopFocus)); $('#desktop-focus').textContent = desktopFocus ? 'Focus actif' : 'Focus'; document.body.classList.toggle('desktop-focus', desktopFocus); };
$('#desktop-focus').setAttribute('aria-pressed', String(desktopFocus)); $('#desktop-focus').textContent = desktopFocus ? 'Focus actif' : 'Focus';
await refresh(true);
socket();
setInterval(updateTimer, 1000);
