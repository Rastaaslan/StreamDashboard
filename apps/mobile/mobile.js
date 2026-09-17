import { isAndroidRuntime, nextRetry, normalizeServer, parsePairing } from './runtime.js';
import { credentialStorage, settingsStorage } from './storage.js';
import { createTransport, HttpError } from './transport.js';
import { DEFAULT_FILTERS, filterPlanning, filterPlanningTemporal, paginatePlanning, TEMPORAL_FILTERS } from './planning-model.js';
import { normalizeCategoryQuery, rankCategories, rememberCategory } from './twitch-category.js';
import { CompanionMode, createCompanionStore, resolveMode } from './companion-store.js';
import { createNativeProviderAdapter, createStandaloneProviderSync } from './provider-sync.js';
import { recurrenceSummary } from './shared/recurrence.js';
import { createMobileFixture, devFixtureName } from './dev-fixtures.js';

const $ = id => document.getElementById(id);

let credential = '';
let server = settingsStorage.getServer();
let state = null;
let busy = false;
let ws = null;
let retry = 500;
let reconnectTimer = null;
let companionMode = CompanionMode.OFFLINE;
const companion = createCompanionStore();
let companionSyncFlight = null;
const providerSync = createStandaloneProviderSync({ store: companion, adapter: createNativeProviderAdapter() });
let deviceId = localStorage.getItem('streamdashboard.deviceId') || '';
let planningFilters = { ...DEFAULT_FILTERS };
const planningTemporalKey = 'streamdashboard.planningTemporal';
const planningPageSize = 8;
let planningTemporal = localStorage.getItem(planningTemporalKey) || TEMPORAL_FILTERS.UPCOMING;
let planningPage = 1;
let mobileEditing = null;
const exportNoteKey = 'streamdashboard.exportNote';
try { planningFilters = { ...planningFilters, ...JSON.parse(localStorage.getItem('streamdashboard.planningFilters') || '{}') }; } catch { /* corrupted preferences reset safely */ }
if (!Object.values(TEMPORAL_FILTERS).includes(planningTemporal)) planningTemporal = TEMPORAL_FILTERS.UPCOMING;

const transport = createTransport(() => server, () => credential);
let noteTimer;
const note = value => { const message = $('message'); message.textContent = String(value || ''); clearTimeout(noteTimer); if (value) noteTimer = setTimeout(() => { message.textContent = ''; }, 4_000); };
const text = (tag, value, className) => {
  const node = document.createElement(tag);
  node.textContent = String(value ?? '');
  if (className) node.className = className;
  return node;
};
const formatDuration = seconds => {
  const value = Math.max(0, Math.floor(seconds || 0));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
};
const remaining = () => !state
  ? 0
  : state.timer.running && state.timer.deadline
    ? Math.max(0, Math.ceil((state.timer.deadline - Date.now()) / 1000))
    : state.timer.remaining;
const dbValue = input => Number.isFinite(input.volumeDb)
  ? input.volumeDb
  : input.volume > 0 ? 20 * Math.log10(input.volume) : -100;
const formatPlanningDate = item => item.allDay
  ? `${new Date(item.startAtUtc).toLocaleDateString('fr-FR', { dateStyle: 'medium', timeZone: 'UTC' })} · toute la journée`
  : new Date(item.startAtUtc).toLocaleString('fr-FR');

function remoteButtons(disabled) {
  document.querySelectorAll('button[data-command],button[data-mode],button[data-chatting],button[data-media],button[data-mute],#stream')
    .forEach(button => { button.disabled = disabled; });
}

function offlineState() {
  const cache = companion.snapshot();
  return { at: cache.lastServerSyncAt || new Date().toISOString(), mode: 'idle', timer: { running: false, remaining: 300, deadline: null }, planning: cache.planning, checklist: cache.checklist, nextLive: null, obs: { connected: false, streaming: false, scene: null, inputs: {}, activeAudioInputs: [], mediaInputs: [] }, settings: { confirmStop: true, streamerName: cache.streamerName, modeScenes: {} }, twitch: { connected: false }, google: { connected: false } };
}

function setConnectionMode(mode) {
  companionMode = mode;
  const online = mode === CompanionMode.ONLINE_PC;
  $('pc').textContent = online ? 'Connecté' : 'Hors ligne';
  $('connection').textContent = online ? 'PC connecté' : 'PC hors ligne';
  $('connection').className = online ? 'ok' : '';
  $('last-sync').textContent = companion.snapshot().lastServerSyncAt ? `Dernière synchro PC : ${new Date(companion.snapshot().lastServerSyncAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : 'Aucune synchronisation PC';
  remoteButtons(!online);
}

function showPairing(show) {
  $('pairing').hidden = !show;
  $('forget-device').hidden = show;
  if (show) remoteButtons(true);
}

async function command(value) {
  if (busy || !credential || !ws || ws.readyState !== WebSocket.OPEN) {
    note('Télécommande non connectée.');
    return false;
  }
  busy = true;
  try {
    const body = await transport.command(value);
    render(body.state);
    globalThis.StreamDashboardNative?.haptic?.(['session.start', 'session.stop'].includes(value.type) ? 'strong' : 'light');
    note('Commande confirmée par le PC.');
    return true;
  } catch (error) {
    note(error.message);
    return false;
  } finally {
    busy = false;
  }
}

function renderAudio(inputs, activeInputs = []) {
  const container = $('audio');
  container.replaceChildren();
  for (const [name, input] of Object.entries(inputs || {}).filter(([name]) => activeInputs.includes(name))) {
    const row = document.createElement('div');
    row.className = 'row';
    const wrap = document.createElement('div');
    wrap.className = 'audio-control';
    const mute = document.createElement('button');
    mute.type = 'button';
    mute.dataset.mute = name;
    mute.textContent = `${input.muted ? 'Activer' : 'Couper'} ${name}`;
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '-60';
    slider.max = '6';
    slider.step = '0.5';
    slider.value = String(Math.max(-60, Math.min(6, dbValue(input))));
    slider.dataset.volume = name;
    const db = text('span', `${Number(slider.value) <= -59.5 ? '-∞' : Number(slider.value).toFixed(1)} dB`, 'db');
    slider.addEventListener('input', () => {
      db.textContent = `${Number(slider.value) <= -59.5 ? '-∞' : Number(slider.value).toFixed(1)} dB`;
    });
    wrap.append(mute, slider, db);
    row.append(wrap);
    container.append(row);
  }
  if (!container.children.length) container.append(text('p', 'Aucune source audio détectée.', 'muted'));
}

function renderDeck(media) {
  const container = $('deck');
  container.replaceChildren();
  for (const name of media || []) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.media = name;
    button.textContent = name;
    container.append(button);
  }
  if (!container.children.length) container.append(text('p', 'Aucun média OBS détecté.', 'muted'));
}

function renderControlHub(hub) {
  const integrations = $('hub-integrations');
  const activity = $('hub-activity');
  integrations.replaceChildren();
  activity.replaceChildren();
  $('hub-title').textContent = hub?.live?.isLive ? (hub.live.title || 'Live en cours') : 'Prêt à streamer';
  $('hub-category').textContent = hub?.live?.category || (companionMode === CompanionMode.ONLINE_PC ? 'PC Runtime connecté' : 'Les contrôles PC reviendront à la reconnexion.');
  $('hub-viewers').textContent = Number.isInteger(hub?.audience?.viewerCount) ? String(hub.audience.viewerCount) : '—';
  $('hub-chatters').textContent = Array.isArray(hub?.audience?.chatters) ? String(hub.audience.chatters.length) : '—';
  const isLive = hub?.live?.isLive === true; const degraded = Object.values(hub?.integrations || {}).some(value => ['DEGRADED', 'ERROR'].includes(value.status)); const duration = Number.isFinite(hub?.live?.durationSeconds) ? formatClock(hub.live.durationSeconds) : '—';
  $('home-live-status').textContent = isLive ? `${degraded ? '!' : '●'} Live` : companionMode === CompanionMode.ONLINE_PC ? '○ Prêt' : '○ Hors ligne'; $('home-live-status').className = `live-line ${isLive ? degraded ? 'danger' : 'ok' : ''}`; $('home-duration').textContent = duration;
  $('live-workspace-status').textContent = $('home-live-status').textContent; $('live-workspace-status').className = $('home-live-status').className; $('live-duration').textContent = duration; $('live-viewers').textContent = $('hub-viewers').textContent; $('live-chatters').textContent = $('hub-chatters').textContent; $('live-scene').textContent = state?.obs?.scene || '—';
  const labels = { runtime: 'Runtime', obs: 'OBS', twitch: 'Twitch', discord: 'Discord', streamlabs: 'Streamlabs', wizebot: 'WizeBot' };
  for (const [key, label] of Object.entries(labels)) {
    const status = hub?.integrations?.[key]?.status || 'DISCONNECTED';
    const row = document.createElement('div');
    row.className = 'integration-card';
    const dot = text('i', '', `provider-dot status-${status.toLowerCase()}`);
    row.append(dot, text('span', label), text('small', humanProviderStatus(status), 'muted'));
    integrations.append(row);
  }
  for (const event of (hub?.activity || []).slice(-6).reverse()) {
    const row = document.createElement('div'); row.className = 'activity-row';
    const time = Number.isFinite(Date.parse(event.occurredAt)) ? new Date(event.occurredAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—';
    row.append(text('time', time), text('b', humanActivity(event))); activity.append(row);
  }
  if (!activity.children.length) activity.append(text('p', 'Aucune activité récente.', 'muted'));
  renderHubChat(hub?.chat?.messages || []);
  const preview = $('home-chat-preview'); preview.replaceChildren(...(hub?.chat?.messages || []).slice(-3).map(message => { const row = document.createElement('p'); row.className = 'home-chat-line'; row.append(text('b', message.chatter?.displayName || message.chatter?.login || 'Twitch'), document.createTextNode(`  ${message.text}`)); return row; })); if (!preview.children.length) preview.append(text('p', hub?.chat?.connected ? 'Aucun message pour le moment.' : 'Connecte Twitch pour afficher le chat.', 'empty-copy'));
  renderAudience(hub?.audience);
}

const formatClock = seconds => { const value = Math.max(0, Math.floor(seconds)); return `${String(Math.floor(value / 3600)).padStart(2, '0')}:${String(Math.floor(value / 60) % 60).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`; };
const humanProviderStatus = status => ({ CONNECTED: 'Connecté', CONNECTING: 'Connexion…', DEGRADED: 'Dégradé', ERROR: 'Erreur', NOT_CONFIGURED: 'Non configuré', DISCONNECTED: 'Déconnecté' })[status] || 'Indisponible';
const humanActivity = event => event.type === 'support.received' ? `Soutien · ${event.payload?.displayName || 'Anonyme'}` : event.type === 'stream.started' ? 'Le live a démarré' : event.type === 'stream.stopped' ? 'Le live est terminé' : event.type === 'chat.message.received' ? `Chat · ${event.payload?.chatter?.displayName || 'nouveau message'}` : event.type === 'soundboard.played' ? 'Son joué' : event.type === 'automation.triggered' ? 'Automatisation exécutée' : event.type.replaceAll('.', ' · ');

let moderationCapabilities = null;
async function loadModerationCapabilities() { if (companionMode !== CompanionMode.ONLINE_PC) return; try { moderationCapabilities = await transport.twitchModerationCapabilities(); const missing = Object.entries(moderationCapabilities.requiredScopes || {}).filter(([action]) => !moderationCapabilities[action]).map(([, scope]) => scope); $('moderation-state').textContent = missing.length ? `Modération partielle · autorisations manquantes : ${[...new Set(missing)].join(', ')}` : 'Modération Twitch autorisée'; renderHubChat(state?.controlHub?.chat?.messages || []); } catch (error) { $('moderation-state').textContent = error.message; } }
function renderHubChat(messages) {
  const container = $('hub-chat'); container.replaceChildren();
  for (const message of messages.slice(-100)) {
    const row = document.createElement('article'); row.className = 'chat-row';
    const header = document.createElement('header');
    for (const badge of message.chatter?.badges || []) header.append(text('span', badge.setId, 'badge'));
    const name = text('b', message.chatter?.displayName || message.chatter?.login || 'Twitch');
    if (/^#[0-9A-F]{6}$/i.test(message.chatter?.color || '')) name.style.color = message.chatter.color;
    header.append(name, text('time', new Date(message.receivedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })));
    row.append(header);
    if (message.reply) row.append(text('div', `↳ ${message.reply.parentUserName}: ${message.reply.parentMessageBody}`, 'chat-reply'));
    row.append(text('div', `${message.text}${message.bits ? ` · ${message.bits} bits` : ''}`));
    const menu = document.createElement('details'); menu.className = 'message-menu'; const summary = text('summary', 'Actions'); summary.setAttribute('aria-label', `Actions pour le message de ${message.chatter?.displayName || message.chatter?.login}`); const tools = document.createElement('div'); tools.className = 'inline-actions'; const reply = text('button', 'Répondre'); reply.type = 'button'; reply.onclick = () => { menu.open = false; $('chat-reply-context').hidden = false; $('chat-reply-context').textContent = `Réponse à ${message.chatter?.displayName || message.chatter?.login}`; $('chat-reply-context').dataset.messageId = message.id; $('chat-message').focus(); }; const moderation = (label, capability, run) => { const button = text('button', label); button.type = 'button'; button.disabled = !moderationCapabilities?.[capability]; button.title = button.disabled ? `NOT_AUTHORIZED · ${moderationCapabilities?.requiredScopes?.[capability] || 'scope Twitch requis'}` : ''; button.onclick = async () => { try { await run(); menu.open = false; note(`${label} confirmé par Twitch.`); } catch (error) { note(error.message); } }; return button; }; tools.append(reply, moderation('Supprimer', 'deleteMessage', () => transport.deleteTwitchMessage(message.id)), moderation('Timeout', 'timeout', () => transport.moderateTwitchUser({ userId: message.chatter.id, duration: 600, reason: 'Modération StreamDashboard' })), moderation('Ban', 'ban', () => transport.moderateTwitchUser({ userId: message.chatter.id, reason: 'Modération StreamDashboard' }))); menu.append(summary, tools); row.append(menu);
    container.append(row);
  }
  if (!container.children.length) container.append(text('p', 'Aucun message reçu pour le moment.', 'muted'));
  container.scrollTop = container.scrollHeight;
}

function renderAudience(audience) {
  $('audience-viewers').textContent = Number.isInteger(audience?.viewerCount) ? String(audience.viewerCount) : '—';
  $('audience-chatters').textContent = Array.isArray(audience?.chatters) ? String(audience.chatters.length) : '—';
  const query = $('audience-search').value.trim().toLocaleLowerCase();
  const container = $('audience-list'); container.replaceChildren();
  for (const chatter of (audience?.chatters || []).filter(value => value.displayName.toLocaleLowerCase().includes(query))) {
    const row = document.createElement('div'); row.className = 'row'; row.append(text('b', chatter.displayName), text('small', chatter.role, 'muted')); container.append(row);
  }
}
let chatterCursor = null;
async function loadMoreChatters(reset = false) { if (companionMode !== CompanionMode.ONLINE_PC) return; try { const result = await transport.twitchChatters(reset ? '' : chatterCursor); chatterCursor = result.cursor; const known = new Set(state.controlHub.audience.chatters.map(value => value.id)); for (const chatter of result.items || []) if (!known.has(chatter.id)) state.controlHub.audience.chatters.push({ id: chatter.id, displayName: chatter.displayName, role: 'viewer' }); $('more-chatters').hidden = !chatterCursor; renderAudience(state.controlHub.audience); } catch (error) { note(error.message); } }

let vodCursor = null, clipCursor = null;
let soundboardState = null;
const newCommandId = () => globalThis.crypto?.randomUUID?.() || `${deviceId || 'android'}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
async function loadSoundboard() {
  if (companionMode !== CompanionMode.ONLINE_PC) { soundboardState = null; $('sounds-pc-state').textContent = 'PC hors ligne'; $('soundboard-state').textContent = 'PC StreamDashboard hors ligne. Les sons redeviendront disponibles à la reconnexion.'; renderSoundboard(); return; }
  $('soundboard-state').textContent = 'Chargement des sons…';
  try { soundboardState = await transport.soundboard(); $('sounds-pc-state').textContent = 'PC connecté'; $('soundboard-state').textContent = soundboardState.available ? (soundboardState.currentPlayback ? 'Lecture en cours…' : `${soundboardState.sounds.length} sons · ${soundboardState.supportsExplicitOutputSelection ? 'sorties audio sélectionnables' : 'sortie système par défaut'}`) : 'Le moteur audio du PC est indisponible.'; renderSoundboard(); }
  catch (error) { $('soundboard-state').textContent = error.message; }
}
function renderSoundboard() {
  const sounds = soundboardState?.sounds || []; const categories = [...new Set(sounds.map(sound => sound.category))].sort();
  const select = $('sound-category'); const selected = select.value; select.replaceChildren(new Option('Toutes les catégories', ''), ...categories.map(value => new Option(value, value))); select.value = categories.includes(selected) ? selected : '';
  const query = $('sound-search').value.trim().toLocaleLowerCase(); const onlyFavorites = $('sound-favorites').checked; const container = $('sound-grid'); container.replaceChildren();
  for (const sound of sounds.filter(value => (!query || value.name.toLocaleLowerCase().includes(query)) && (!select.value || value.category === select.value) && (!onlyFavorites || value.favorite))) {
    const pad = document.createElement('button'); pad.type = 'button'; pad.className = `sound-pad${soundboardState.currentPlayback?.soundId === sound.id ? ' playing' : ''}${!sound.sourceAvailable ? ' sound-error' : ''}`; pad.disabled = !sound.enabled || !sound.sourceAvailable;
    pad.append(text('b', sound.name), text('small', `${sound.category} · ${Math.round(sound.volume * 100)}%`), text('span', sound.favorite ? '★' : '☆', 'sound-favorite'));
    pad.onclick = async event => { if (event.target.closest('.sound-favorite')) return; if (companionMode !== CompanionMode.ONLINE_PC) { note('PC hors ligne. Le son n’a pas été joué.'); return; } const commandId = newCommandId(); pad.disabled = true; try { const ack = await transport.playSound({ commandId, soundId: sound.id, issuedAt: new Date().toISOString() }); if (ack.status !== 'succeeded') throw new Error(ack.message || ack.errorCode || 'Lecture échouée.'); rememberCommand({ id: `sound:${sound.id}`, label: sound.name, action: 'sound', soundId: sound.id }); globalThis.StreamDashboardNative?.haptic?.('light'); note(`Lecture confirmée par le PC : ${sound.name}`); } catch (error) { note(error.message); } finally { pad.disabled = false; await loadSoundboard(); } };
    pad.querySelector('.sound-favorite').onclick = async event => { event.stopPropagation(); try { soundboardState = await transport.updateSound(sound.id, { favorite: !sound.favorite }); renderSoundboard(); } catch (error) { note(error.message); } };
    container.append(pad);
  }
  if (!container.children.length) { const empty = document.createElement('div'); empty.className = 'module-empty'; empty.append(text('small', sounds.length ? 'RECHERCHE' : 'AUCUN SON', 'console-label'), text('b', sounds.length ? 'Aucun pad ne correspond.' : 'Le catalogue Soundboard est vide.'), text('p', sounds.length ? 'Modifie la recherche ou affiche toutes les catégories.' : 'Ajoute des sons depuis le PC StreamDashboard. Ils seront disponibles ici immédiatement.', 'muted')); container.append(empty); }
  renderCommandSounds();
}
let automationState = [];
async function loadAutomations() { if (companionMode !== CompanionMode.ONLINE_PC) { $('automation-list').replaceChildren(text('p', 'PC hors ligne · automatisations en lecture locale indisponibles.', 'muted')); return; } try { const result = await transport.automations(); automationState = result.items || []; renderAutomations(); } catch (error) { note(error.message); } }
function automationPayload(value = {}) { const amount = Number($('automation-amount').value); return { name: $('automation-name').value.trim(), enabled: $('automation-enabled').checked, trigger: $('automation-trigger').value, conditions: Number.isSafeInteger(amount) && amount > 0 ? [{ path: 'amountMinor', operator: 'gte', value: amount }] : [], actions: [{ type: 'soundboard.play', payload: { soundId: $('automation-sound').value } }], cooldownMs: Math.round(Number($('automation-cooldown').value) * 1_000), ...value }; }
function resetAutomationForm() { $('automation-id').value = ''; $('automation-name').value = ''; $('automation-enabled').checked = true; $('automation-trigger').value = 'support.received'; $('automation-amount').value = '500'; $('automation-cooldown').value = '30'; }
function renderAutomations() {
  const sounds = soundboardState?.sounds || []; $('automation-sound').replaceChildren(...sounds.map(sound => new Option(sound.name, sound.id)));
  const container = $('automation-list'); container.replaceChildren();
  for (const automation of automationState) { const row = document.createElement('div'); row.className = 'automation-row'; row.append(text('b', `${automation.enabled ? '●' : '○'} ${automation.name}`), text('small', `${automation.trigger} · dernier résultat : ${automation.lastResult?.status || 'jamais'}`, automation.lastResult?.status === 'failed' ? 'danger' : 'muted')); const actions = document.createElement('div'); const edit = text('button', 'ÉDITER'); edit.type = 'button'; edit.onclick = () => { $('automation-id').value = automation.id; $('automation-name').value = automation.name; $('automation-enabled').checked = automation.enabled; $('automation-trigger').value = automation.trigger; $('automation-amount').value = String(automation.conditions.find(value => value.path === 'amountMinor')?.value ?? 0); $('automation-sound').value = automation.actions[0]?.payload?.soundId || ''; $('automation-cooldown').value = String(automation.cooldownMs / 1_000); }; const toggle = text('button', automation.enabled ? 'OFF' : 'ON'); toggle.type = 'button'; toggle.onclick = async () => { try { await transport.updateAutomation(automation.id, automationPayload({ name: automation.name, enabled: !automation.enabled, trigger: automation.trigger, conditions: automation.conditions, actions: automation.actions, cooldownMs: automation.cooldownMs })); await loadAutomations(); } catch (error) { note(error.message); } }; const remove = text('button', 'SUPPR.'); remove.type = 'button'; remove.onclick = async () => { if (!confirm(`Supprimer l’automatisation « ${automation.name} » ?`)) return; try { await transport.deleteAutomation(automation.id); await loadAutomations(); } catch (error) { note(error.message); } }; actions.append(edit, toggle, remove); row.append(actions); container.append(row); }
  if (!container.children.length) container.append(text('p', 'Aucune automatisation.', 'muted'));
}
let supportState = null;
const money = (amountMinor, currency) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(amountMinor / 100);
async function loadSupports() { if (companionMode !== CompanionMode.ONLINE_PC) { $('support-provider').textContent = 'PC hors ligne · historique conservé sur le PC Runtime.'; return; } try { supportState = await transport.supports(); $('support-provider').textContent = supportState.provider.status === 'NOT_CONFIGURED' ? 'Streamlabs n’est pas encore connecté.' : `Streamlabs · ${humanProviderStatus(supportState.provider.status)}`; renderSupports(); } catch (error) { note(error.message); } }
function renderSupports() {
  if (!supportState) return; const totals = $('support-totals'); totals.replaceChildren();
  for (const [key, label] of [['session', 'LIVE'], ['day', 'AUJOURD’HUI'], ['month', 'CE MOIS']]) { const values = supportState.totals[key] || {}; const card = document.createElement('div'); card.className = 'support-total'; card.append(text('small', label), ...Object.entries(values).map(([currency, amount]) => text('b', money(amount, currency)))); if (!Object.keys(values).length) card.append(text('b', '—')); totals.append(card); }
  const filter = $('support-filter').value; const now = new Date(); const start = filter === 'session' ? Date.parse(supportState.sessionStartedAt || '') : filter === 'day' ? new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() : filter === 'month' ? new Date(now.getFullYear(), now.getMonth(), 1).getTime() : 0; const container = $('support-history'); container.replaceChildren();
  for (const support of supportState.history.filter(value => filter === 'all' || (Number.isFinite(start) && Date.parse(value.receivedAt) >= start))) { const row = document.createElement('article'); row.className = 'support-row'; row.append(text('time', new Date(support.receivedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })), text('b', support.displayName), text('strong', money(support.amountMinor, support.currency))); if (support.message) row.append(text('p', `“${support.message}”`)); container.append(row); }
  if (!container.children.length) container.append(text('p', 'Aucun soutien pour cette période.', 'muted'));
}
function resourceLink(url, label = 'OUVRIR') { const link = document.createElement('a'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = label; return link; }
async function loadVods(append = false) {
  if (companionMode !== CompanionMode.ONLINE_PC) { note('PC hors ligne. Les VOD Twitch ne peuvent pas être chargées via le runtime.'); return; }
  try {
    const container = $('vod-list'); if (!append) container.replaceChildren(text('p', 'Chargement des VOD…', 'muted')); const result = await transport.twitchVideos(append ? vodCursor : ''); if (!append) container.replaceChildren();
    for (const vod of result.items || []) {
      const card = document.createElement('article'); card.className = 'resource-card'; card.append(text('b', vod.title), text('small', `${new Date(vod.createdAt).toLocaleDateString('fr-FR')} · ${vod.duration} · ${vod.viewCount} vues`, 'muted'));
      const actions = document.createElement('div'); actions.className = 'resource-actions'; actions.append(resourceLink(vod.url));
      const remove = text('button', 'SUPPRIMER', 'danger-button'); remove.type = 'button'; remove.onclick = async () => { if (prompt(`Suppression définitive. Saisissez DELETE ${vod.id}`) !== `DELETE ${vod.id}`) return; try { await transport.deleteTwitchVideo(vod.id); card.remove(); note('VOD supprimée après confirmation Twitch.'); } catch (error) { note(error.message); } }; actions.append(remove); card.append(actions); container.append(card);
    }
    vodCursor = result.cursor; $('more-vods').hidden = !vodCursor; if (!container.children.length) container.append(text('p', 'Aucune VOD disponible.', 'empty-copy'));
  } catch (error) { note(error.message); }
}
async function loadClips(append = false) {
  if (companionMode !== CompanionMode.ONLINE_PC) { note('PC hors ligne. Les clips Twitch ne peuvent pas être chargés via le runtime.'); return; }
  try { const container = $('clip-list'); if (!append) container.replaceChildren(text('p', 'Chargement des clips…', 'muted')); const result = await transport.twitchClips(append ? clipCursor : ''); if (!append) container.replaceChildren(); for (const clip of result.items || []) { const card = document.createElement('article'); card.className = 'resource-card'; card.append(text('b', clip.title), text('small', `${clip.creatorName} · ${clip.viewCount} vues · ${clip.duration}s`, 'muted'), resourceLink(clip.url)); container.append(card); } clipCursor = result.cursor; $('more-clips').hidden = !clipCursor; if (!container.children.length) container.append(text('p', 'Aucun clip disponible.', 'empty-copy')); } catch (error) { note(error.message); }
}

function renderPlanning(items) {
  const container = $('planning');
  container.replaceChildren();
  const filtered = filterPlanning(items, planningFilters);
  const temporal = filterPlanningTemporal(filtered, planningTemporal, new Date());
  const pagination = paginatePlanning(temporal, planningPage, planningPageSize);
  planningPage = pagination.page;
  for (const item of pagination.items) {
    const row = document.createElement('div');
    row.className = 'planning-row';
    row.append(text('b', item.title), text('span', formatPlanningDate(item)));
    if (item.recurrence) row.append(text('small', recurrenceSummary(item), 'muted'));
    if (item.occurrenceKey) {
      const editOne = text('button', 'Modifier cette occurrence'); editOne.type = 'button'; editOne.onclick = () => openMobileEditor(item, 'occurrence');
      const editSeries = text('button', 'Modifier toute la série'); editSeries.type = 'button'; editSeries.onclick = () => openMobileEditor(item, 'series');
      const deleteOne = text('button', 'Supprimer cette occurrence'); deleteOne.type = 'button'; deleteOne.onclick = () => void removeMobileOccurrence(item);
      const deleteSeries = text('button', 'Supprimer toute la série'); deleteSeries.type = 'button'; deleteSeries.onclick = () => void removeMobileSeries(item);
      row.append(editOne, editSeries, deleteOne, deleteSeries);
    }
    if (companionMode !== CompanionMode.ONLINE_PC && !item.occurrenceKey) {
      const statuses = Object.entries(item.desiredPublication || {}).filter(([provider, enabled]) => enabled && ['twitch','google'].includes(provider)).map(([provider]) => `${provider === 'twitch' ? 'Twitch' : 'Google'} · ${(item.providerLinks?.[provider]?.status || 'pending').toUpperCase()}`).join('  ');
      const status = text('small', statuses || '⏳ À synchroniser', 'pending');
      const retryButton = text('button', 'Retry'); retryButton.type='button'; retryButton.hidden=!Object.values(item.providerLinks||{}).some(link=>['error','conflict'].includes(link.status)); retryButton.onclick=()=>void syncEventProviders(item);
      const edit = text('button', 'Modifier'); edit.type = 'button'; edit.onclick = () => { const title = prompt('Titre du live', item.title); if (!title || title === item.title) return; const result = companion.updateEvent(item.id, { title }, item.revision); if (result.conflict) note('Ce live a été modifié sur un autre appareil.'); else { render(offlineState()); void syncEventProviders(result.item); } };
      const remove = text('button', 'Supprimer'); remove.type = 'button'; remove.onclick = () => { if (!confirm(`Supprimer « ${item.title} » ?`)) return; const result = companion.deleteEvent(item.id, item.revision); if (result.conflict) note('Ce live a été modifié sur un autre appareil.'); else { render(offlineState()); void syncEventProviders(item, 'delete'); } };
      row.append(status, retryButton, edit, remove);
    }
    container.append(row);
  }
  if (!pagination.total) container.append(text('p', 'Aucun rendez-vous.', 'muted'));
  if (pagination.totalPages > 1) {
    const nav = document.createElement('div');
    nav.className = 'companion-row planning-pagination';
    const previous = text('button', '←'); previous.type = 'button'; previous.disabled = pagination.page <= 1;
    const label = text('span', `Page ${pagination.page}/${pagination.totalPages} · ${pagination.total} événements`, 'muted');
    const next = text('button', '→'); next.type = 'button'; next.disabled = pagination.page >= pagination.totalPages;
    previous.onclick = () => { planningPage -= 1; renderPlanning(state?.planning); };
    next.onclick = () => { planningPage += 1; renderPlanning(state?.planning); };
    nav.append(previous, label, next);
    container.append(nav);
  }
}

function openMobileEditor(item, scope) {
  mobileEditing = { item, scope }; const form = $('slot-form'); const start = new Date(item.startAtUtc); const end = new Date(item.endAtUtc);
  form.elements.title.value = item.title; form.elements.date.value = start.toISOString().slice(0, 10); form.elements.start.value = start.toTimeString().slice(0, 5); form.elements.end.value = end.toTimeString().slice(0, 5); form.elements.category.value = item.category || 'live'; form.elements.description.value = item.description || '';
  form.elements.recurrence.value = item.recurrence ? `${item.recurrence.frequency}-${item.recurrence.interval}` : ''; form.elements.recurrenceUntil.value = item.recurrence?.until?.slice(0, 10) || ''; form.elements.recurrence.disabled = scope === 'occurrence'; form.elements.recurrenceUntil.disabled = scope === 'occurrence'; $('slot-dialog').showModal();
}
async function removeMobileOccurrence(item) {
  if (!confirm(`Supprimer uniquement cette occurrence de « ${item.title} » ?`)) return;
  try { if (companionMode === CompanionMode.ONLINE_PC) render(await transport.deleteOccurrence(item.seriesId, item.occurrenceKey)); else { const canonical = companion.snapshot().planning.find(value => value.id === item.seriesId); const recurrence = structuredClone(canonical.recurrence); recurrence.exceptions ||= {}; recurrence.exceptions[item.occurrenceKey] = { cancelled: true }; companion.updateEvent(canonical.id, { recurrence }, canonical.revision); render(offlineState()); } note('Occurrence supprimée.'); } catch (error) { note(error.message); }
}
async function removeMobileSeries(item) { if (!confirm(`Supprimer toute la série « ${item.title} » ?`)) return; try { if (companionMode === CompanionMode.ONLINE_PC) render(await transport.deletePlanning(item.seriesId)); else { const canonical = companion.snapshot().planning.find(value => value.id === item.seriesId); companion.deleteEvent(canonical.id, canonical.revision); render(offlineState()); } note('Série supprimée.'); } catch (error) { note(error.message); } }

async function syncEventProviders(event, action) {
  if (companionMode !== CompanionMode.ONLINE_STANDALONE || !globalThis.StreamDashboardProviders) return;
  await providerSync.apply(companionMode, event, action);
  render(offlineState());
}

function render(next) {
  if (!next) return;
  state = next;
  if (companionMode === CompanionMode.ONLINE_PC) $('pc').textContent = 'Connecté';
  $('obs').textContent = next.obs.connected ? 'Prêt' : 'Déconnecté';
  $('scene').textContent = next.obs.scene || '—';
  $('live').textContent = next.obs.streaming ? 'Live' : 'Hors ligne';
  $('live').className = next.obs.streaming ? 'ok' : '';
  $('next').textContent = next.nextLive ? `${next.nextLive.title} · ${formatPlanningDate(next.nextLive)}` : 'Aucun live planifié';
  $('stream').textContent = next.obs.streaming ? 'ARRÊTER LE LIVE' : 'DÉMARRER LE LIVE';
  renderAudio(next.obs.inputs, next.obs.activeAudioInputs);
  if (document.activeElement !== $('twitch-title')) $('twitch-title').value = next.twitch?.channelTitle || '';
  if (document.activeElement !== $('twitch-category')) $('twitch-category').value = next.twitch?.gameName || '';
  $('twitch-game-id').value = next.twitch?.gameId || '';
  $('twitch-editor').hidden = !next.twitch?.connected;
  renderDeck(next.obs.mediaInputs);
  renderControlHub(next.controlHub);
  renderPlanning(next.planning);
  $('discord-destination').textContent = companionMode === CompanionMode.ONLINE_PC ? `Discord · ${next.discord?.channelName ? `#${next.discord.channelName}` : 'à configurer'}` : 'Connexion PC requise pour publier sur Discord.';
  $('publish-discord').disabled = companionMode !== CompanionMode.ONLINE_PC || !next.discord?.configured;
  $('timer').textContent = formatDuration(remaining());
  if (companionMode === CompanionMode.ONLINE_PC) showPairing(false);
  remoteButtons(companionMode !== CompanionMode.ONLINE_PC);
  $('stream').disabled = !next.obs.connected;
  $('quick-clip').disabled = !next.twitch?.connected || !next.obs.streaming;
  const chattingActive = next.mode === 'live' && Boolean(next.settings.chattingScene) && next.obs.scene === next.settings.chattingScene;
  document.querySelectorAll('[data-mode]').forEach(button => {
    button.disabled = !next.obs.connected;
    button.classList.toggle('active', button.dataset.mode === next.mode && !(button.dataset.mode === 'live' && chattingActive));
  });
  document.querySelectorAll('[data-chatting]').forEach(button => { button.disabled = !next.obs.connected || !next.settings.chattingScene; button.classList.toggle('active', chattingActive); });
}

function tickTimer() {
  if (state) $('timer').textContent = formatDuration(remaining());
}

async function pair() {
  if (busy) return;
  busy = true;
  try {
    if (isAndroidRuntime()) {
      const parsed = $('pair-link').value.trim() ? parsePairing($('pair-link').value) : null;
      server = parsed?.server || normalizeServer($('pair-server').value);
      settingsStorage.setServer(server);
      if (parsed) { $('pair-id').value = parsed.id; $('pair-code').value = parsed.code; }
    }
    const id = $('pair-id').value.trim();
    const code = $('pair-code').value.trim();
    const name = $('pair-name').value.trim() || 'Android';
    if (!id || !code) throw new Error('ID et code de pairing requis.');
    const result = await transport.pair({ id, code, name });
    credential = result.credential;
    deviceId = result.deviceId;
    localStorage.setItem('streamdashboard.deviceId', deviceId);
    await credentialStorage.set(credential);
    $('pair-code').value = '';
    $('pair-link').value = '';
    note('Télécommande appairée. Connexion…');
    showPairing(false);
    connect();
  } catch (error) {
    note(error.message);
    return false;
  } finally {
    busy = false;
  }
}

async function getWsTicket() {
  const result = await transport.ticket();
  return result.ticket;
}

async function fetchState() {
  if (credential && deviceId) await syncCompanion();
  const next = await transport.state();
  if (!companion.snapshot().pending.length) companion.replaceServerSnapshot(next);
  companionMode = CompanionMode.ONLINE_PC;
  render(next);
}

async function syncCompanion() {
  if (companionSyncFlight) return companionSyncFlight;
  companionSyncFlight = (async () => {
    const cache = companion.snapshot();
    const response = await transport.syncCompanion({ schemaVersion: cache.schemaVersion, deviceId, lastKnownServerRevision: cache.serverRevision || 0, operations: cache.pending });
    companion.applySyncResponse(response);
    showSyncConflict();
    return response;
  })();
  try { return await companionSyncFlight; } finally { companionSyncFlight = null; }
}

function showSyncConflict() {
  const conflict = companion.conflicts()[0];
  if (!conflict) return;
  $('sync-conflict-fields').textContent = `${conflict.fields.join(', ')} · PC et Téléphone contiennent des valeurs différentes.`;
  $('sync-conflict').showModal();
}
async function resolveSyncConflict(strategy) {
  const conflict = companion.conflicts()[0]; if (!conflict) return;
  try { const response = await transport.resolveCompanionConflict(conflict.operationId, strategy); companion.applySyncResponse(response); $('sync-conflict').close(); render(offlineState()); showSyncConflict(); }
  catch (error) { note(error.message); }
}
$('keep-pc').onclick = () => void resolveSyncConflict('pc');
$('keep-phone').onclick = () => void resolveSyncConflict('android');

async function connect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (!credential) {
    $('connection').textContent = 'Appairage requis';
    showPairing(true);
    return;
  }
  try {
    $('connection').textContent = 'Connexion…';
    remoteButtons(true);
    await fetchState();
    remoteButtons(true);
    const ticket = await getWsTicket();
    ws = transport.websocket(ticket);
    ws.onopen = () => {
      retry = 500;
      $('connection').textContent = 'Connecté';
      $('connection').className = 'ok';
      render(state);
      setConnectionMode(CompanionMode.ONLINE_PC);
      note('Télécommande connectée au PC.');
    };
    ws.onmessage = event => {
      try {
        const value = JSON.parse(event.data);
        if (value.type === 'state.updated') render(value.data);
      } catch { note('Événement temps réel invalide.'); }
    };
    ws.onclose = () => {
      $('connection').textContent = 'Reconnexion…';
      $('connection').className = '';
      setConnectionMode(resolveMode({ pcAvailable: false, internetAvailable: navigator.onLine }));
      render(offlineState());
      reconnectTimer = setTimeout(connect, retry);
      retry = nextRetry(retry);
    };
    ws.onerror = () => ws.close();
  } catch (error) {
    setConnectionMode(resolveMode({ pcAvailable: false, internetAvailable: navigator.onLine }));
    render(offlineState());
    if (error instanceof HttpError && [401, 403].includes(error.status)) {
      credential = '';
      await credentialStorage.clear();
      note('Cette télécommande a été révoquée depuis le PC.');
      showPairing(true);
      return;
    }
    reconnectTimer = setTimeout(connect, retry);
    retry = nextRetry(retry);
  }
}

const params = new URLSearchParams(location.search);
if (params.get('pair')) $('pair-id').value = params.get('pair');
if (params.get('code')) $('pair-code').value = params.get('code');
if (params.has('pair') || params.has('code')) history.replaceState(null, '', location.pathname);

$('pair-button').onclick = pair;
$('export-planning').onclick = async () => {
  if (!state) return;
  try {
    const { exportPlanningImage } = await import('./planning-export.js');
    const resolveArtwork = async item => {
      const cached = recentCategories.find(category => category.id === item.twitchCategoryId)?.box_art_url;
      if (cached) return cached;
      const response = await providerSync.searchCategories(companionMode, item.twitchCategoryName || '', recentCategories, value => transport.searchTwitch(value));
      const found = response.items || response;
      return found.find(category => category.id === item.twitchCategoryId)?.box_art_url;
    };
    const count = await exportPlanningImage(state.planning, state.settings.streamerName, { filters: planningFilters, period: $('export-period').value, noteEnabled: $('export-note-enabled').checked, noteText: $('export-note-text').value, resolveArtwork });
    note(`Image du planning prête · ${count} live${count > 1 ? 's' : ''}.`);
  } catch (error) {
    if (error?.name !== 'AbortError') note(error.message);
  }
};
const blobBase64 = async blob => { const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = ''; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(binary); };
async function loadDiscordGuilds() {
  if (companionMode !== CompanionMode.ONLINE_PC) { note('Connexion PC requise pour publier sur Discord.'); return; }
  try { const guilds = await transport.discordGuilds(); $('discord-guild').replaceChildren(new Option('Choisir…', ''), ...guilds.map(value => new Option(value.name, value.id))); if (state.discord?.guildId) $('discord-guild').value = state.discord.guildId; $('discord-guild').dispatchEvent(new Event('change')); } catch (error) { note(error.message); }
}
$('discord-guild').onfocus = () => { if ($('discord-guild').options.length < 2) void loadDiscordGuilds(); };
$('discord-guild').onchange = async () => { const guildId = $('discord-guild').value; if (!guildId) return; try { const channels = await transport.discordChannels(guildId); $('discord-channel').replaceChildren(new Option('Choisir…', ''), ...channels.map(value => new Option(`#${value.name}`, value.id))); if (state.discord?.channelId) $('discord-channel').value = state.discord.channelId; } catch (error) { note(error.message); } };
$('discord-channel').onchange = async () => { try { await transport.discordSettings({ guildId: $('discord-guild').value, channelId: $('discord-channel').value, defaultMessage: $('discord-message').value }); note('Destination Discord enregistrée.'); } catch (error) { note(error.message); } };
$('publish-discord').onclick = async () => {
  if (companionMode !== CompanionMode.ONLINE_PC) { note('Connexion PC requise pour publier sur Discord.'); return; }
  try {
    note('Génération du planning…'); const { buildPlanningPng } = await import('./planning-export.js');
    const resolveArtwork = async item => { const cached = recentCategories.find(category => category.id === item.twitchCategoryId)?.box_art_url; if (cached) return cached; const response = await providerSync.searchCategories(companionMode, item.twitchCategoryName || '', recentCategories, value => transport.searchTwitch(value)); return (response.items || response).find(category => category.id === item.twitchCategoryId)?.box_art_url; };
    const result = await buildPlanningPng(state.planning, state.settings.streamerName, { filters: planningFilters, period: $('export-period').value, noteEnabled: $('export-note-enabled').checked, noteText: $('export-note-text').value, resolveArtwork });
    note('Publication Discord…'); const posted = await transport.publishDiscord({ imageBase64: await blobBase64(result.blob), filename: result.fileName, message: $('discord-message').value || undefined, channelId: $('discord-channel').value || undefined });
    note(`Planning publié dans #${posted.channelName || 'planning'}.`);
  } catch (error) { note(error.message); }
};
$('edit-server').onclick = () => { showPairing(true); $('pair-server').focus(); };
$('keep-awake').onchange = () => globalThis.StreamDashboardNative?.setKeepAwake?.($('keep-awake').checked);

function organizeMobileShell() {
  const home = document.querySelector('[data-view="home"]'); const live = document.querySelector('[data-view="live"]'); const sounds = $('primary-soundboard'); const moreAutomations = $('more-automations'); const tools = home.querySelector('.hub-tools');
  for (const selector of ['.modes', '.timer', '#stream']) { const node = home.querySelector(selector); if (node) live.append(node); }
  if (tools) live.append(tools);
  const soundPanel = document.querySelector('[data-hub-panel="soundboard"]'); if (soundPanel) { soundPanel.hidden = false; sounds.append(soundPanel); }
  document.querySelector('[data-hub-tool="soundboard"]')?.remove();
  const automationPanel = document.querySelector('[data-hub-panel="automations"]'); if (automationPanel) { automationPanel.hidden = false; moreAutomations.append(automationPanel); }
  document.querySelector('[data-hub-tool="automations"]')?.remove();
  const message = $('message'); document.body.append(message); message.className = 'app-toast';
}
organizeMobileShell();

const selectTab = tab => {
  document.querySelectorAll('[data-view]').forEach(view => view.classList.toggle('active', view.dataset.view === tab));
  const primary = ['prepare', 'settings'].includes(tab) ? 'more' : tab;
  document.querySelectorAll('[data-tab]').forEach(button => button.classList.toggle('active', button.dataset.tab === primary));
  localStorage.setItem('streamdashboard.mobileTab', tab);
  if (tab === 'sounds') void loadSoundboard();
};
document.querySelector('.bottom-nav').onclick = event => { const button = event.target.closest('[data-tab]'); if (button) selectTab(button.dataset.tab); };
document.addEventListener('click', event => { const open = event.target.closest('[data-open-tab]'); if (open) { selectTab(open.dataset.openTab); $('command-palette')?.close(); } const tool = event.target.closest('[data-open-live-tool]'); if (tool) { selectTab('live'); document.querySelector(`[data-hub-tool="${tool.dataset.openLiveTool}"]`)?.click(); $('command-palette')?.close(); } });
const recentCommandsKey = 'streamdashboard.mobileRecentCommands';
let recentCommands = []; try { recentCommands = JSON.parse(localStorage.getItem(recentCommandsKey) || '[]').slice(0, 6); } catch { recentCommands = []; }
function rememberCommand(entry) { recentCommands = [entry, ...recentCommands.filter(value => value.id !== entry.id)].slice(0, 6); localStorage.setItem(recentCommandsKey, JSON.stringify(recentCommands)); renderCommandRecents(); }
function renderCommandRecents() { const container = $('command-recents'); container.replaceChildren(...recentCommands.map(entry => { const button = text('button', entry.label); button.type = 'button'; button.dataset.recentCommand = entry.id; button.onclick = () => void runPaletteAction(entry.action, entry); return button; })); if (!container.children.length) container.append(text('span', 'Aucune commande récente.', 'empty-copy')); }
function renderCommandSounds() { const container = $('command-sounds'); if (!container) return; const favorites = (soundboardState?.sounds || []).filter(sound => sound.favorite && sound.enabled && sound.sourceAvailable).slice(0, 6); container.replaceChildren(...favorites.map(sound => { const button = text('button', sound.name); button.type = 'button'; button.onclick = () => void runPaletteAction('sound', { soundId: sound.id, label: sound.name }); return button; })); if (!container.children.length) container.append(text('span', 'Aucun son favori.', 'empty-copy')); }
async function createQuickClip() { if (companionMode !== CompanionMode.ONLINE_PC) throw new Error('PC hors ligne.'); const clip = await transport.createTwitchClip(); rememberCommand({ id: 'clip', label: 'Clip', action: 'clip' }); globalThis.StreamDashboardNative?.haptic?.('light'); note(`Clip créé ✓ · ${clip.id}`); }
async function togglePrimaryMic() { const input = state?.obs?.activeAudioInputs?.[0]; if (!input || !state?.obs?.inputs?.[input]) throw new Error('Aucun micro actif détecté.'); const confirmed = await command({ type: 'obs.mute', input, muted: !state.obs.inputs[input].muted }); if (!confirmed) throw new Error('Commande non confirmée par le PC.'); rememberCommand({ id: 'mute', label: 'Mute micro', action: 'mute' }); }
async function runPaletteAction(action, detail = {}) { try { if (action === 'clip') await createQuickClip(); else if (action === 'mute') await togglePrimaryMic(); else if (action === 'sound') { const sound = soundboardState?.sounds?.find(value => value.id === detail.soundId); if (!sound) throw new Error('Son indisponible.'); const ack = await transport.playSound({ commandId: newCommandId(), soundId: sound.id, issuedAt: new Date().toISOString() }); if (ack.status !== 'succeeded') throw new Error(ack.message || 'Lecture échouée.'); rememberCommand({ id: `sound:${sound.id}`, label: sound.name, action: 'sound', soundId: sound.id }); note(`Son joué ✓ · ${sound.name}`); } else { const mode = action === 'chatting' ? null : action; const confirmed = await command(action === 'chatting' ? { type: 'scene.chatting' } : { type: 'mode.set', mode }); if (!confirmed) throw new Error('Commande non confirmée par le PC.'); rememberCommand({ id: action, label: action === 'pause' ? 'Pause' : action === 'chatting' ? 'Chatting' : 'Intro', action }); } $('command-palette').close(); } catch (error) { note(`Commande impossible. ${error.message}`); } }
$('command-trigger').onclick = () => { renderCommandRecents(); renderCommandSounds(); $('command-palette').showModal(); $('command-search').focus(); };
$('close-commands').onclick = () => $('command-palette').close();
$('command-palette').onclick = event => { if (event.target === $('command-palette')) $('command-palette').close(); const action = event.target.closest('[data-palette-action]')?.dataset.paletteAction; if (action) void runPaletteAction(action); };
$('command-search').oninput = event => { const query = event.target.value.trim().toLocaleLowerCase(); document.querySelectorAll('#command-palette [data-palette-action]').forEach(button => { button.hidden = !button.textContent.toLocaleLowerCase().includes(query); }); };
renderCommandRecents();
$('open-automations').onclick = () => { $('more-automations').classList.toggle('expanded'); void loadSoundboard().then(loadAutomations); };
$('quick-clip').onclick = () => void createQuickClip().catch(error => note(`Impossible de créer le clip. ${error.message}`)); $('live-clip').onclick = $('quick-clip').onclick; $('quick-mic').onclick = () => void togglePrimaryMic().catch(error => note(error.message)); $('live-end').onclick = () => { if (confirm('Arrêter réellement le live ?')) void command({ type: 'session.stop' }); }; $('refresh-sounds').onclick = () => void loadSoundboard();
const savedTab = localStorage.getItem('streamdashboard.mobileTab'); selectTab(['home', 'live', 'sounds', 'planning', 'more', 'prepare', 'settings'].includes(savedTab) ? savedTab : 'home');
try { const saved = JSON.parse(localStorage.getItem(exportNoteKey) || '{}'); $('export-note-enabled').checked = saved.enabled === true; if (saved.text) $('export-note-text').value = saved.text; } catch { /* reset invalid preference */ }
const saveExportNote = () => localStorage.setItem(exportNoteKey, JSON.stringify({ enabled: $('export-note-enabled').checked, text: $('export-note-text').value }));
$('export-note-enabled').onchange = saveExportNote; $('export-note-text').onchange = saveExportNote;

const filterNames = { twitch: 'Twitch', google: 'Google', allDay: 'Journée entière', live: 'Live', personal: 'Personnel', production: 'Production' };
$('planning-filters').className = 'filters';
const temporalLabel = document.createElement('label');
const temporalSelect = document.createElement('select');
for (const [value, label] of [[TEMPORAL_FILTERS.UPCOMING, 'À venir'], [TEMPORAL_FILTERS.PAST, 'Passés'], [TEMPORAL_FILTERS.ALL, 'Tous']]) {
  const option = document.createElement('option'); option.value = value; option.textContent = label; temporalSelect.append(option);
}
temporalSelect.value = planningTemporal;
temporalSelect.onchange = () => { planningTemporal = temporalSelect.value; planningPage = 1; localStorage.setItem(planningTemporalKey, planningTemporal); renderPlanning(state?.planning); };
temporalLabel.append(text('span', 'Temporalité'), temporalSelect);
$('planning-filters').append(temporalLabel);
for (const [key, label] of Object.entries(filterNames)) {
  const input = document.createElement('input'); input.type = 'checkbox'; input.checked = planningFilters[key];
  input.onchange = () => { planningFilters[key] = input.checked; planningPage = 1; localStorage.setItem('streamdashboard.planningFilters', JSON.stringify(planningFilters)); renderPlanning(state?.planning); };
  const row = document.createElement('label'); row.append(input, text('span', label)); $('planning-filters').append(row);
}
$('add-slot').onclick = () => { mobileEditing = null; $('slot-form').elements.recurrence.disabled = false; $('slot-form').elements.recurrenceUntil.disabled = false; $('slot-form').reset(); $('slot-dialog').showModal(); };
$('close-slot').onclick = () => { mobileEditing = null; $('slot-form').elements.recurrence.disabled = false; $('slot-form').elements.recurrenceUntil.disabled = false; $('slot-dialog').close(); };
$('slot-form').onsubmit = async event => {
  event.preventDefault(); const form = new FormData(event.currentTarget);
  const date = form.get('date'); const startAtUtc = new Date(`${date}T${form.get('start')}`).toISOString(); const endAtUtc = new Date(`${date}T${form.get('end')}`).toISOString();
  try {
    if (form.get('twitch') === 'on' && !$('slot-twitch-game-id').value) throw new Error('Sélectionnez une catégorie Twitch officielle.');
    const recurrenceValue = String(form.get('recurrence') || ''); const [frequency, interval] = recurrenceValue.split('-'); const untilDate = String(form.get('recurrenceUntil') || '');
    const recurrence = recurrenceValue ? { frequency, interval: Number(interval), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris', until: untilDate ? new Date(`${untilDate}T23:59:59`).toISOString() : null, exceptions: {} } : undefined;
    const value = { title: form.get('title'), startAtUtc, endAtUtc, category: form.get('category'), description: form.get('description') || '', recurrence, desiredPublication: { local: false, twitch: form.get('twitch') === 'on', google: form.get('google') === 'on' }, twitchCategoryId: form.get('twitch') === 'on' ? $('slot-twitch-game-id').value : undefined, twitchCategoryName: form.get('twitch') === 'on' ? $('slot-twitch-category').value : undefined };
    planningPage = 1;
    if (mobileEditing?.scope === 'occurrence') {
      const patch = { title: value.title, startAtUtc, endAtUtc, category: value.category, twitchCategoryId: value.twitchCategoryId, twitchCategoryName: value.twitchCategoryName, desiredPublication: value.desiredPublication };
      if (companionMode === CompanionMode.ONLINE_PC) render(await transport.updateOccurrence(mobileEditing.item.seriesId, mobileEditing.item.occurrenceKey, patch));
      else { const canonical = companion.snapshot().planning.find(item => item.id === mobileEditing.item.seriesId); const nextRecurrence = structuredClone(canonical.recurrence); nextRecurrence.exceptions ||= {}; nextRecurrence.exceptions[mobileEditing.item.occurrenceKey] = { patch }; companion.updateEvent(canonical.id, { recurrence: nextRecurrence }, canonical.revision); render(offlineState()); }
    } else if (mobileEditing?.scope === 'series') {
      const seriesId = mobileEditing.item.seriesId; if (companionMode === CompanionMode.ONLINE_PC) render(await transport.updatePlanning(seriesId, value)); else { const canonical = companion.snapshot().planning.find(item => item.id === seriesId); companion.updateEvent(seriesId, value, canonical.revision); render(offlineState()); }
    } else if (companionMode === CompanionMode.ONLINE_PC) { const next = await transport.createPlanning(value); companion.replaceServerSnapshot(next); render(next); }
    else { const created=companion.createEvent(value).item; render(offlineState()); if(companionMode===CompanionMode.ONLINE_STANDALONE) void syncEventProviders(created,'create'); }
    mobileEditing = null; event.currentTarget.elements.recurrence.disabled = false; event.currentTarget.elements.recurrenceUntil.disabled = false; $('slot-dialog').close(); event.currentTarget.reset(); note(companionMode === CompanionMode.ONLINE_PC ? 'Planning enregistré.' : 'Créneau enregistré · À synchroniser.');
  } catch (error) { note(error.message); }
};

const recentKey = 'streamdashboard.recentTwitchCategories';
let recentCategories = [];
try { recentCategories = JSON.parse(localStorage.getItem(recentKey) || '[]').slice(0, 8); } catch { /* reset invalid history */ }
function attachCategoryPicker(inputId, gameIdId, resultsId) {
  const input = $(inputId), gameId = $(gameIdId), results = $(resultsId); let timer; let generation = 0;
  const show = items => { results.replaceChildren(...items.map(item => { const button = text('button', item.name); button.type='button'; button.dataset.gameId=item.id; button.dataset.gameName=item.name; button.dataset.boxArtUrl=item.box_art_url || ''; return button; })); };
  input.onfocus = () => { if (!input.value.trim()) show(recentCategories); };
  input.oninput = () => { gameId.value=''; clearTimeout(timer); const query=normalizeCategoryQuery(input.value); const request=++generation; if(query.length<2){show(query?[]:recentCategories);return;} results.replaceChildren(text('p','Recherche…','muted')); timer=setTimeout(async()=>{try{const response=await providerSync.searchCategories(companionMode,query,recentCategories,value=>transport.searchTwitch(value));const found=response.items||response;if(request!==generation)return;const ranked=rankCategories(found,recentCategories,query);show(ranked);if(!ranked.length)results.append(text('p','Aucune catégorie trouvée.','muted'));}catch(error){if(request===generation)results.replaceChildren(text('p',error.message,'danger'));}},300); };
  results.onclick = event => { const button=event.target.closest('[data-game-id]');if(!button)return;gameId.value=button.dataset.gameId;input.value=button.dataset.gameName;recentCategories=rememberCategory(recentCategories,{id:button.dataset.gameId,name:button.dataset.gameName,box_art_url:button.dataset.boxArtUrl || undefined});localStorage.setItem(recentKey,JSON.stringify(recentCategories));results.replaceChildren(); };
}
attachCategoryPicker('twitch-category','twitch-game-id','twitch-results');
attachCategoryPicker('slot-twitch-category','slot-twitch-game-id','slot-twitch-results');
$('save-twitch').onclick = async () => {
  try {
    const next = await transport.updateTwitch({ title: $('twitch-title').value, gameId: $('twitch-game-id').value, gameName: $('twitch-category').value });
    render(next); note('Informations Twitch enregistrées.');
  } catch (error) { note(error.message); }
};

$('forget-device').onclick = () => {
  if (!confirm('Oublier cette télécommande sur ce téléphone ?')) return;
  credential = '';
  void credentialStorage.clear();
  ws?.close();
  showPairing(true);
  note('Credential local supprimé. Révoque aussi l’appareil depuis le PC si nécessaire.');
};

document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  if (button.dataset.command) {
    const value = { type: button.dataset.command };
    if (button.dataset.seconds) value.seconds = Number(button.dataset.seconds);
    void command(value);
  } else if (button.dataset.mode) {
    void command({ type: 'mode.set', mode: button.dataset.mode });
  } else if (button.hasAttribute('data-chatting')) {
    void command({ type: 'scene.chatting' });
  } else if (button.dataset.media) {
    void command({ type: 'obs.media.restart', input: button.dataset.media });
  } else if (button.dataset.mute && state?.obs.inputs?.[button.dataset.mute]) {
    void command({ type: 'obs.mute', input: button.dataset.mute, muted: !state.obs.inputs[button.dataset.mute].muted });
  }
});

document.addEventListener('change', event => {
  const target = event.target;
  if (target?.dataset?.volume) {
    void command({ type: 'obs.volumeDb', input: target.dataset.volume, volumeDb: Number(target.value) });
  }
});

$('stream').onclick = () => {
  if (!state || busy || !state.obs.connected) return;
  const start = !state.obs.streaming;
  const question = start
    ? 'Démarrer réellement le live ?'
    : state.settings.confirmStop ? 'Arrêter réellement le live ?' : 'Arrêter le live ?';
  if (confirm(question)) void command({ type: start ? 'session.start' : 'session.stop', ...(start ? { force: false } : {}) });
};

document.querySelectorAll('[data-hub-tool]').forEach(button => button.onclick = () => {
  document.querySelectorAll('[data-hub-tool]').forEach(value => value.classList.toggle('active', value === button));
  document.querySelectorAll('[data-hub-panel]').forEach(panel => { panel.hidden = panel.dataset.hubPanel !== button.dataset.hubTool; });
  if (button.dataset.hubTool === 'vod') void loadVods();
  if (button.dataset.hubTool === 'clips') void loadClips();
  if (button.dataset.hubTool === 'soundboard') void loadSoundboard();
  if (button.dataset.hubTool === 'automations') void loadSoundboard().then(loadAutomations);
  if (button.dataset.hubTool === 'supports') void loadSupports();
  if (button.dataset.hubTool === 'audience') void loadMoreChatters(true);
  if (button.dataset.hubTool === 'chat') void loadModerationCapabilities();
});
document.querySelector('[data-hub-tool="chat"]').classList.add('active');
$('audience-search').oninput = () => renderAudience(state?.controlHub?.audience);
$('more-chatters').onclick = () => void loadMoreChatters();
$('sound-search').oninput = renderSoundboard; $('sound-category').onchange = renderSoundboard; $('sound-favorites').onchange = renderSoundboard;
$('stop-sound').onclick = async () => { if (companionMode !== CompanionMode.ONLINE_PC) { note('PC hors ligne.'); return; } try { await transport.stopSound(); note('Lecture arrêtée par le PC Runtime.'); await loadSoundboard(); } catch (error) { note(error.message); } };
$('automation-reset').onclick = resetAutomationForm;
$('automation-form').onsubmit = async event => { event.preventDefault(); try { const id = $('automation-id').value; if (id) await transport.updateAutomation(id, automationPayload()); else await transport.createAutomation(automationPayload()); resetAutomationForm(); await loadAutomations(); note('Automatisation enregistrée par le PC Runtime.'); } catch (error) { note(error.message); } };
$('automation-test').onclick = async () => { try { const accepted = await transport.testAutomation(500); note(`Événement test accepté · corrélation ${accepted.correlationId}`); } catch (error) { note(error.message); } };
$('support-filter').onchange = renderSupports;
async function loadDiagnosticEvents() { if (companionMode !== CompanionMode.ONLINE_PC) { $('diagnostic-events').replaceChildren(text('p', 'PC hors ligne · diagnostics Runtime indisponibles.', 'muted')); return; } try { const result = await transport.events({ type: $('event-filter-type').value.trim(), source: $('event-filter-source').value.trim(), correlationId: $('event-filter-correlation').value.trim(), limit: '100' }); const container = $('diagnostic-events'); container.replaceChildren(); for (const event of [...result.items].reverse()) { const row = document.createElement('div'); row.className = 'diagnostic-event'; row.append(text('time', new Date(event.occurredAt).toLocaleTimeString('fr-FR')), text('b', event.type), text('small', event.source), text('code', event.correlationId)); container.append(row); } if (!container.children.length) container.append(text('p', 'Aucun événement correspondant.', 'muted')); } catch (error) { note(error.message); } }
$('refresh-events').onclick = () => void loadDiagnosticEvents();
$('diagnostics').ontoggle = () => { if ($('diagnostics').open) void loadDiagnosticEvents(); };
$('refresh-vods').onclick = () => void loadVods();
$('more-vods').onclick = () => void loadVods(true);
$('more-clips').onclick = () => void loadClips(true);
$('create-clip').onclick = async () => { if (companionMode !== CompanionMode.ONLINE_PC) { note('PC hors ligne.'); return; } try { const clip = await transport.createTwitchClip(); note(`Clip accepté par Twitch (${clip.id}). Il sera disponible après traitement.`); await loadClips(); } catch (error) { note(error.message); } };
$('chat-form').onsubmit = async event => { event.preventDefault(); const message = $('chat-message').value.trim(); if (!message) return; if (companionMode !== CompanionMode.ONLINE_PC) { note('PC hors ligne. Le message n’a pas été envoyé.'); return; } try { const replyParentMessageId = $('chat-reply-context').dataset.messageId; await transport.sendTwitchChat({ message, ...(replyParentMessageId ? { replyParentMessageId } : {}) }); $('chat-message').value = ''; $('chat-reply-context').hidden = true; delete $('chat-reply-context').dataset.messageId; note('Message confirmé par Twitch.'); } catch (error) { note(error.message); } };
$('unban-user').onclick = async () => { const userId = $('unban-user-id').value.trim(); if (!moderationCapabilities?.unban) { note(`NOT_AUTHORIZED · ${moderationCapabilities?.requiredScopes?.unban || 'scope Twitch requis'}`); return; } try { await transport.unbanTwitchUser(userId); $('unban-user-id').value = ''; note('UNBAN confirmé par Twitch.'); } catch (error) { note(error.message); } };

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch(() => undefined);
} else if (!window.isSecureContext) {
  note('Mode LAN HTTP : télécommande web disponible, installation PWA désactivée sans HTTPS.');
}
setInterval(tickTimer, 1000);
window.addEventListener('native-pairing', event => {
  $('pair-link').value = String(event.detail || '');
  showPairing(true);
  void pair();
});
async function start() {
  credential = await credentialStorage.get();
  if (isAndroidRuntime()) {
    void refreshProviderAccounts();
    $('android-options').hidden = false;
    $('pair-server').value = server;
    if (!server) { showPairing(true); setConnectionMode(resolveMode({ pcAvailable: false, internetAvailable: navigator.onLine })); render(offlineState()); return; }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { ws?.close(); void connect(); } });
  } else {
    $('server-label').hidden = true;
    $('link-label').hidden = true;
  }
  await connect();
}
window.addEventListener('online', () => { if (companionMode !== CompanionMode.ONLINE_PC) setConnectionMode(CompanionMode.ONLINE_STANDALONE); void connect(); });
window.addEventListener('offline', () => setConnectionMode(CompanionMode.OFFLINE));

async function refreshProviderAccounts() {
  if (!isAndroidRuntime() || !globalThis.StreamDashboardProviders) return;
  $('provider-accounts').hidden = false;
  const adapter = createNativeProviderAdapter();
  for (const provider of ['twitch','google']) {
    try { const status=await adapter.status(provider); $(`${provider}-standalone-status`).textContent=status.configured?(status.connected?'Connecté':'Déconnecté'):'Non configuré'; $(`${provider}-standalone-auth`).disabled=!status.configured; $(`${provider}-standalone-logout`).hidden=!status.connected; }
    catch { $(`${provider}-standalone-status`).textContent='Indisponible'; }
  }
}
for (const provider of ['twitch','google']) {
  $(`${provider}-standalone-auth`).onclick=async()=>{try{await createNativeProviderAdapter().authorize(provider);note('Terminez l’autorisation dans le navigateur.');}catch(error){note(error.message);}};
  $(`${provider}-standalone-logout`).onclick=async()=>{await createNativeProviderAdapter().logout(provider);await refreshProviderAccounts();note(`${provider==='twitch'?'Twitch':'Google'} autonome déconnecté.`);};
}
window.addEventListener('provider-auth',()=>void refreshProviderAccounts());

function renderCompanion() {
  const cache = companion.snapshot();
  const draw = (id, values, label) => { const root = $(id); root.replaceChildren(...values.map(item => { const row = document.createElement('div'); row.className = 'companion-row'; row.append(text('span', label(item))); const remove = text('button', 'Supprimer'); remove.type = 'button'; remove.onclick = () => { companion.removeCollection(id, item.id); renderCompanion(); }; row.append(remove); return row; })); };
  draw('notes', cache.notes, item => item.text); draw('templates', cache.templates, item => item.title); draw('checklist', cache.checklist, item => `${item.done ? '✓' : '○'} ${item.label}`);
}
for (const [buttonId, kind, inputId, property] of [['add-note','notes','note-text','text'],['add-template','templates','template-title','title'],['add-check','checklist','check-label','label']]) $(buttonId).onclick = () => { const input = $(inputId); if (!input.value.trim()) return; companion.upsertCollection(kind, { [property]: input.value.trim(), ...(kind === 'checklist' ? { done: false } : {}) }); input.value = ''; renderCompanion(); note('Enregistré localement · À synchroniser.'); };
renderCompanion();
const fixtureName = devFixtureName(location);
if (fixtureName) { const fixture = createMobileFixture(fixtureName); setConnectionMode(CompanionMode.ONLINE_PC); soundboardState = fixture.soundboard; render(fixture.state); renderSoundboard(); showPairing(false); } else void start();
