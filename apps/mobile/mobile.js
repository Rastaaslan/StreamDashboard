import { isAndroidRuntime, nextRetry, normalizeServer, parsePairing } from './runtime.js';
import { credentialStorage, settingsStorage } from './storage.js';
import { createTransport, CRITICAL_COMMAND_TIMEOUT_MS, HttpError } from './transport.js';
import { DEFAULT_FILTERS, filterPlanning, filterPlanningTemporal, paginatePlanning, TEMPORAL_FILTERS } from './planning-model.js';
import { normalizeCategoryQuery, rankCategories, rememberCategory } from './twitch-category.js';
import { CompanionMode, createCompanionStore, resolveMode } from './companion-store.js';
import { createNativeProviderAdapter, createStandaloneProviderSync } from './provider-sync.js';
import { recurrenceSummary } from './shared/recurrence.js';
import { createMobileFixture, devFixtureName } from './dev-fixtures.js';
import { acceptsSnapshot, createCommandController, primaryMicCommand } from './command-controller.js';
import { setMobileContext } from './mobile-context.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const fixtureName = devFixtureName(location);
const previewMode = fixtureName && params.get('preview') === '1';
const legacyMode = params.get('legacy') === '1';

if (previewMode) {
  const nativeFetch = globalThis.fetch?.bind(globalThis);
  if (nativeFetch) {
    globalThis.fetch = (input, init) => {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const url = new URL(raw, location.href);
      if (url.origin === location.origin) return nativeFetch(input, init);
      return Promise.reject(new Error('Mode aperçu : accès réseau désactivé.'));
    };
  }
  document.documentElement.dataset.preview = 'true';
}

const activateView = tab => {
  document.querySelectorAll('[data-view]').forEach(view => view.classList.toggle('active', view.dataset.view === tab));
  const primary = ['prepare', 'settings', 'sounds', 'more'].includes(tab) ? 'more' : tab;
  document.querySelectorAll('[data-tab]').forEach(button => button.classList.toggle('active', button.dataset.tab === primary));
  try { localStorage.setItem('streamdashboard.mobileTab', tab); } catch { /* navigation must remain usable */ }
};
window.StreamDashboardHandleBack = () => {
  const dialog = [...document.querySelectorAll('dialog[open]')].at(-1);
  if (dialog) { dialog.close(); return true; }
  const active = document.querySelector('[data-view].active')?.dataset.view;
  if (active && active !== 'home') { activateView('home'); return true; }
  return false;
};
$('status-trigger').onclick = () => $('status-sheet').showModal();
$('close-status').onclick = () => $('status-sheet').close();
$('status-sheet').onclick = event => { if (event.target === $('status-sheet')) $('status-sheet').close(); };
$('menu-trigger')?.addEventListener('click', event => {
  event.preventDefault();
  event.stopPropagation();
  activateView('more');
});


let credential = '';
let server = settingsStorage.getServer();
let state = null;
let productProfile = null;
let connectionProjection = [];
let runtimeCapabilities = null;
const runtimeFeatureLabels = {
  'mobile-profile-presentation': 'profil et apparence',
  'mobile-live-control-config': 'configuration Micro / scènes',
  'mobile-provider-actions': 'gestion des connexions',
  'soundboard-live-volume': 'volume Soundboard en cours de lecture',
};
const runtimeSupports = feature => runtimeCapabilities?.features?.includes(feature) === true;
function requireRuntimeFeature(feature) {
  if (runtimeSupports(feature)) return true;
  const label = runtimeFeatureLabels[feature] || feature;
  note(`Mets à jour StreamDashboard sur le PC pour utiliser : ${label}.`);
  return false;
}
function updateRuntimeCompatibility() {
  const banner = $('runtime-compatibility');
  if (!runtimeCapabilities) { banner.hidden = true; return; }
  const missing = Object.keys(runtimeFeatureLabels).filter(feature => !runtimeSupports(feature));
  banner.hidden = missing.length === 0;
  if (missing.length) banner.textContent = `Runtime PC ${runtimeCapabilities.serverVersion || 'ancien'} · mise à jour recommandée pour : ${missing.map(feature => runtimeFeatureLabels[feature]).join(', ')}.`;
}
let profileLoaded = false;
let lastProfileSyncAt = 0;
let pairingInFlight = false;
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
const commandController = createCommandController({
  send: (value, options) => transport.command(value, options),
  readState: () => transport.state(),
  applyState: next => render(next),
  onMessage: value => note(value),
});
let noteTimer;
const note = value => { const message = $('message'); message.textContent = String(value || ''); clearTimeout(noteTimer); if (value) noteTimer = setTimeout(() => { message.textContent = ''; }, 2_500); };
let activeMobileStreamerPingId = null;
const notifiedMobileStreamerPingIds = new Set();
function ensureMobileStreamerPingDialog() {
  return $('streamer-ping-dialog');
}
$('streamer-ping-ack').onclick = async () => {
  const id = activeMobileStreamerPingId;
  if (!id) return;
  try {
    const next = await transport.acknowledgeStreamerPing(id);
    activeMobileStreamerPingId = null;
    $('streamer-ping-dialog').close();
    render(next);
    note('Streamer Ping acquitté.');
  } catch (error) { note(error.message); }
};
function notifyMobileStreamerPing(ping, pendingCount) {
  if (!ping || !document.hidden || notifiedMobileStreamerPingIds.has(ping.id)) return;
  notifiedMobileStreamerPingIds.add(ping.id);
  const message = `${ping.userName || 'Viewer'} · ${ping.rewardCost || 0} points${pendingCount > 1 ? ` · ${pendingCount} pings en attente` : ''}`;
  globalThis.StreamDashboardNative?.notifyStreamerPing?.(ping.id, ping.rewardTitle || 'Streamer Ping', message);
}
function syncMobileStreamerPing(pings = []) {
  const pending = pings.filter(value => !value.acknowledgedAt);
  const ping = pending[0];
  const dialog = ensureMobileStreamerPingDialog();
  if (!ping) {
    activeMobileStreamerPingId = null;
    if (dialog.open) dialog.close();
    return;
  }
  notifyMobileStreamerPing(pending.at(-1), pending.length);
  if (activeMobileStreamerPingId === ping.id && dialog.open) {
    const label = dialog.querySelector('.console-label'); if (label) label.textContent = `STREAMER PING · 1/${pending.length}`;
    return;
  }
  activeMobileStreamerPingId = ping.id;
  const content = dialog.querySelector('.streamer-ping-content');
  content.replaceChildren(
    text('small', `STREAMER PING · 1/${pending.length}`, 'console-label'),
    text('h2', ping.rewardTitle || 'Récompense Twitch'),
    text('p', `${ping.userName || 'Viewer'} a utilisé cette récompense${ping.rewardCost ? ` · ${ping.rewardCost} points` : ''}.`),
    ...(ping.userInput ? [text('blockquote', ping.userInput)] : []),
  );
  globalThis.StreamDashboardNative?.haptic?.('strong');
  if (!dialog.open) dialog.showModal();
}
async function ensureCredentialOwner() { if (!credential) credential = await credentialStorage.get() || ''; if (!credential) throw new Error('Télécommande non appairée.'); return credential; }
setMobileContext({ companion, transport, providerSync, getCredential: () => credential, ensureCredential: ensureCredentialOwner, getMode: () => companionMode, getState: () => state, applyState: next => render(next), executeCommand: command, syncCompanion, note });
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
const planningWhenParts = item => {
  const value = new Date(item.startAtUtc);
  return item.allDay
    ? { date: value.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', timeZone: 'UTC' }), time: 'Toute la journée' }
    : { date: value.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }), time: value.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) };
};
const formatPlanningDate = item => { const when = planningWhenParts(item); return `${when.date} · ${when.time}`; };

function remoteButtons(disabled) {
  document.querySelectorAll('button[data-command],button[data-mode],button[data-chatting],button[data-media],button[data-mute],#stream')
    .forEach(button => { button.disabled = disabled; });
}

function offlineState() {
  const cache = companion.snapshot();
  return { at: cache.lastServerSyncAt || new Date().toISOString(), mode: 'idle', timer: { running: false, remaining: 300, deadline: null }, planning: cache.planning, checklist: cache.checklist, nextLive: null, obs: { connected: false, streaming: false, scene: null, scenes: [], inputs: {}, activeAudioInputs: [], mediaInputs: [] }, settings: { confirmStop: true, streamerName: cache.streamerName, modeScenes: {} }, twitch: { connected: false }, google: { connected: false } };
}

function setConnectionMode(mode) {
  companionMode = mode;
  const online = mode === CompanionMode.ONLINE_PC;
  $('pc').textContent = online ? 'Connecté' : 'Hors ligne';
  $('connection').textContent = online ? 'Connecté' : 'Hors ligne'; $('status-dot').classList.toggle('online', online);
  $('connection').className = online ? 'ok' : '';
  $('last-sync').textContent = companion.snapshot().lastServerSyncAt ? `À jour · ${new Date(companion.snapshot().lastServerSyncAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : 'Jamais synchronisé';
  remoteButtons(!online);
}

function openCanonicalPairing(pendingLink = '') {
  if (pendingLink) localStorage.setItem('streamdashboard.pendingPairing', pendingLink);
  showPairing(true);
}

function showPairing(show) {
  if (legacyMode && show) {
    openCanonicalPairing();
    return;
  }
  $('pairing').hidden = !show;
  $('forget-device').hidden = show || legacyMode;
  if (show) remoteButtons(true);
}

const commandResource = value => value.type.startsWith('session.') ? 'stream'
  : value.type === 'mode.set' || value.type === 'scene.chatting' ? 'scene'
    : value.type.startsWith('obs.mute') || value.type.startsWith('obs.volume') ? `audio:${value.input}`
      : value.type.startsWith('timer.') ? 'timer' : value.type;

async function command(value, { reconcile } = {}) {
  if (previewMode) {
    note('Mode aperçu : aucune commande réelle envoyée.');
    return true;
  }
  if (!credential) {
    note('Télécommande non connectée.');
    return false;
  }
  const resource = commandResource(value);
  const commandId = globalThis.crypto?.randomUUID?.() || `cmd_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  try {
    const critical = value.type === 'session.start' || value.type === 'session.stop';
    const result = await commandController.execute({ ...value, commandId, correlationId: commandId }, {
      resource,
      timeoutMs: critical ? CRITICAL_COMMAND_TIMEOUT_MS : undefined,
      reconcile,
    });
    if (!result.accepted) return false;
    globalThis.StreamDashboardNative?.haptic?.(['session.start', 'session.stop'].includes(value.type) ? 'strong' : 'light');
    if (!result.reconciled) note('Commande confirmée par le PC.');
    return true;
  } catch (error) {
    note(error.message);
    return false;
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
  for (const name of publicObsMediaInputs(media)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.media = name;
    button.textContent = name;
    container.append(button);
  }
  if (!container.children.length) container.append(text('p', 'Aucun média OBS détecté.', 'muted'));
}

function connectionButton(label, action, className = 'secondary') {
  const button = text('button', label, className);
  button.type = 'button';
  button.dataset.connectionAction = action;
  return button;
}
function renderManagedConnections(hub) {
  const integrations = $('hub-integrations');
  integrations.replaceChildren();
  const fallback = Object.entries({ obs: 'OBS', twitch: 'Twitch', discord: 'Discord', streamlabs: 'Streamlabs', wizebot: 'WizeBot' }).map(([id, label]) => ({ id, label, status: (hub?.integrations?.[id]?.status || 'DISCONNECTED').toLowerCase(), capabilities: [] }));
  const projected = connectionProjection.length ? connectionProjection : fallback;
  for (const provider of projected) {
    const moduleId = provider.id === 'google' ? 'googleCalendar' : provider.id;
    if (productProfile?.modules?.[moduleId] === false) continue;
    const status = String(provider.status || 'unavailable').toUpperCase().replace('REAUTH-REQUIRED', 'REAUTH_REQUIRED');
    const row = document.createElement('article');
    row.className = 'integration-card connection-manage-card';
    const dot = text('i', '', `provider-dot status-${status.toLowerCase()}`);
    const copy = document.createElement('div'); copy.className = 'connection-copy';
    copy.append(text('b', provider.label), text('small', `${humanProviderStatus(status)}${provider.mode ? ` · ${provider.mode === 'official' ? 'Officiel' : 'Personnalisé'}` : ''}`, 'muted'));
    if (provider.message) copy.append(text('small', provider.message, 'muted'));
    const actions = document.createElement('div'); actions.className = 'connection-actions';
    const capabilities = new Set(provider.capabilities || []);
    const canManageConnections = runtimeSupports('mobile-provider-actions');
    if (canManageConnections && provider.id === 'obs' && capabilities.has('test')) actions.append(connectionButton('Tester', 'obs-test'));
    if (canManageConnections && provider.id === 'twitch') {
      if (status === 'CONNECTED') {
        if (capabilities.has('disconnect')) actions.append(connectionButton('Déconnecter', 'twitch-disconnect', 'secondary danger-button'));
      } else if (capabilities.has('connect')) actions.append(connectionButton('Connecter', 'twitch-connect'));
    }
    if (provider.id === 'google') {
      if (canManageConnections && status === 'CONNECTED') {
        if (capabilities.has('disconnect')) actions.append(connectionButton('Déconnecter', 'google-disconnect', 'secondary danger-button'));
      } else if (status !== 'CONNECTED') {
        copy.append(text('small', 'La connexion initiale Google du PC doit être autorisée depuis le PC.', 'muted'));
      }
    }
    if (!canManageConnections && ['obs','twitch','google'].includes(provider.id)) {
      copy.append(text('small', 'Mets à jour StreamDashboard sur le PC pour gérer cette connexion depuis le téléphone.', 'muted'));
    } else if (!actions.children.length && ['discord','streamlabs','wizebot'].includes(provider.id) && provider.mode === 'custom') {
      copy.append(text('small', 'Configuration locale à effectuer sur le PC.', 'muted'));
    }
    row.append(dot, copy, actions);
    integrations.append(row);
  }
  if (!integrations.children.length) integrations.append(text('p', 'Aucune connexion active pour les modules actuels.', 'muted'));
}
async function openExternalUrl(url) {
  if (!/^https:\/\//i.test(String(url || ''))) throw new Error('Lien externe invalide.');
  if (globalThis.StreamDashboardNative?.openExternal) { globalThis.StreamDashboardNative.openExternal(url); return; }
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (!opened) throw new Error('Impossible d’ouvrir le navigateur.');
}
$('hub-integrations').addEventListener('click', async event => {
  const action = event.target.closest('[data-connection-action]')?.dataset.connectionAction;
  if (!action) return;
  if (!requireRuntimeFeature('mobile-provider-actions')) return;
  if (companionMode !== CompanionMode.ONLINE_PC) { note('PC requis pour gérer cette connexion.'); return; }
  try {
    if (action === 'obs-test') {
      const result = await transport.testObs();
      note(`OBS connecté · v${result.obsVersion || '?'}`);
    } else if (action === 'twitch-connect') {
      const result = await transport.twitchDevice();
      globalThis.StreamDashboardNative?.copyText?.('Code Twitch', result.userCode);
      await openExternalUrl(result.verificationUri);
      note(`Twitch · code ${result.userCode} copié`);
    } else if (action === 'twitch-disconnect') {
      render(await transport.twitchDisconnect()); note('Twitch déconnecté.');
    } else if (action === 'google-disconnect') {
      render(await transport.googleDisconnect()); note('Google Calendar déconnecté.');
    }
    await loadProductProfile();
  } catch (error) { note(error.message); }
});
function renderControlHub(hub) {
  const integrations = $('hub-integrations');
  integrations.replaceChildren();
  $('hub-title').textContent = hub?.live?.isLive ? (hub.live.title || 'Live en cours') : 'Prêt à streamer';
  $('hub-category').textContent = hub?.live?.category || (companionMode === CompanionMode.ONLINE_PC ? 'PC Runtime connecté' : 'Les contrôles PC reviendront à la reconnexion.');
  $('hub-viewers').textContent = Number.isInteger(hub?.audience?.viewerCount) ? String(hub.audience.viewerCount) : '—';
  $('hub-chatters').textContent = Array.isArray(hub?.audience?.chatters) ? String(hub.audience.chatters.length) : '—';
  const isLive = hub?.live?.isLive === true; document.querySelector('[data-view="home"]')?.classList.toggle('is-live', isLive); const degraded = Object.values(hub?.integrations || {}).some(value => ['DEGRADED', 'ERROR'].includes(value.status)); const duration = Number.isFinite(hub?.live?.durationSeconds) ? formatClock(hub.live.durationSeconds) : '—';
  $('home-live-status').textContent = isLive ? `${degraded ? '!' : '●'} En direct` : companionMode === CompanionMode.ONLINE_PC ? '○ Prêt' : '○ Hors ligne'; $('home-live-status').className = `live-line ${isLive ? degraded ? 'danger' : 'ok' : ''}`; $('home-duration').textContent = duration;
  $('direct-scene').textContent = state?.obs?.scene || 'Aucune scène'; $('direct-twitch-state').textContent = humanProviderStatus(hub?.integrations?.twitch?.status || 'DISCONNECTED'); $('obs-status-detail').textContent = state?.obs?.connected ? 'Connecté' : 'Indisponible'; $('twitch-status-detail').textContent = $('direct-twitch-state').textContent;
  $('live-workspace-status').textContent = $('home-live-status').textContent; $('live-workspace-status').className = $('home-live-status').className; $('live-duration').textContent = duration; $('live-viewers').textContent = $('hub-viewers').textContent; $('live-chatters').textContent = $('hub-chatters').textContent; $('live-scene').textContent = state?.obs?.scene || '—';
  renderManagedConnections(hub);
  renderHubChat(hub?.chat?.messages || []);
  renderAudience(hub?.audience);
}

const formatClock = seconds => { const value = Math.max(0, Math.floor(seconds)); return `${String(Math.floor(value / 3600)).padStart(2, '0')}:${String(Math.floor(value / 60) % 60).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`; };
const humanProviderStatus = status => ({ CONNECTED: 'Connecté', CONNECTING: 'Connexion…', DEGRADED: 'Connexion instable', ERROR: 'Erreur', REAUTH_REQUIRED: 'Autorisation nécessaire', UNAVAILABLE: 'Indisponible', NOT_CONFIGURED: 'À configurer', DISCONNECTED: 'Déconnecté' })[status] || 'Indisponible';
const humanActivity = event => event.type === 'support.received' ? `Soutien · ${event.payload?.displayName || 'Anonyme'}` : event.type === 'stream.started' ? 'Le live a démarré' : event.type === 'stream.stopped' ? 'Le live est terminé' : event.type === 'chat.message.received' ? `Chat · ${event.payload?.chatter?.displayName || 'nouveau message'}` : event.type === 'streamer.ping.received' ? `Ping · ${event.payload?.rewardTitle || 'récompense Twitch'}` : event.type === 'streamer.ping.acknowledged' ? 'Streamer Ping acquitté' : event.type === 'soundboard.played' ? 'Son joué' : event.type === 'automation.triggered' ? 'Automatisation exécutée' : event.type.replaceAll('.', ' · ');

let moderationCapabilities = null;
let twitchCapabilitiesFlight = null;
const twitchCapability = name => moderationCapabilities?.[name] !== false;
function applyTwitchActionCapabilities() {
  const connected = state?.twitch?.connected === true;
  const chatWritable = connected && twitchCapability('chatWrite');
  $('chat-message').disabled = !chatWritable;
  $('chat-form').querySelector('button').disabled = !chatWritable;
  $('live-clip').disabled = !connected || !state?.obs?.streaming || !twitchCapability('createClip');
  $('create-clip').disabled = !connected || !twitchCapability('createClip');
  $('more-chatters').disabled = !connected || !twitchCapability('chatters');
  $('save-twitch').disabled = !connected || !twitchCapability('updateChannel');
  const twitchPublish = $('slot-form').elements.namedItem('twitch');
  if (twitchPublish) twitchPublish.title = twitchCapability('schedule') ? '' : 'Reconnecte Twitch pour autoriser la publication du planning.';
  if ($('template-publish-twitch')) $('template-publish-twitch').title = twitchCapability('schedule') ? '' : 'Reconnecte Twitch pour autoriser la publication du planning.';
}
async function loadModerationCapabilities() {
  if (companionMode !== CompanionMode.ONLINE_PC || state?.twitch?.connected !== true) return moderationCapabilities;
  if (twitchCapabilitiesFlight) return twitchCapabilitiesFlight;
  twitchCapabilitiesFlight = (async () => {
    try {
      moderationCapabilities = await transport.twitchModerationCapabilities();
      const missing = Object.entries(moderationCapabilities.requiredScopes || {}).filter(([action]) => moderationCapabilities[action] === false).map(([, scope]) => scope);
      $('moderation-state').textContent = missing.length ? `Fonctions Twitch partielles · reconnecte Twitch pour : ${[...new Set(missing)].join(', ')}` : 'Autorisations Twitch à jour';
      applyTwitchActionCapabilities();
      updatePlanningProviderReadiness();
      renderHubChat(state?.controlHub?.chat?.messages || []);
      return moderationCapabilities;
    } catch (error) {
      $('moderation-state').textContent = error.message;
      return null;
    }
  })().finally(() => { twitchCapabilitiesFlight = null; });
  return twitchCapabilitiesFlight;
}
async function ensureTwitchCapabilities() {
  if (state?.twitch?.connected !== true) return null;
  return moderationCapabilities || await loadModerationCapabilities();
}
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
    const menu = document.createElement('details'); menu.className = 'message-menu'; const summary = text('summary', 'Actions'); summary.setAttribute('aria-label', `Actions pour le message de ${message.chatter?.displayName || message.chatter?.login}`); const tools = document.createElement('div'); tools.className = 'inline-actions'; const reply = text('button', 'Répondre'); reply.type = 'button'; reply.disabled = moderationCapabilities?.chatWrite === false; reply.title = reply.disabled ? `Reconnecte Twitch pour accorder ${moderationCapabilities.requiredScopes?.chatWrite || 'user:write:chat'}.` : ''; reply.onclick = () => { menu.open = false; $('chat-reply-context').hidden = false; $('chat-reply-context').textContent = `Réponse à ${message.chatter?.displayName || message.chatter?.login}`; $('chat-reply-context').dataset.messageId = message.id; $('chat-message').focus(); }; const moderation = (label, capability, run) => { const button = text('button', label); button.type = 'button'; button.disabled = !moderationCapabilities?.[capability]; button.title = button.disabled ? `NOT_AUTHORIZED · ${moderationCapabilities?.requiredScopes?.[capability] || 'scope Twitch requis'}` : ''; button.onclick = async () => { try { await run(); menu.open = false; note(`${label} confirmé par Twitch.`); } catch (error) { note(error.message); } }; return button; }; tools.append(reply, moderation('Supprimer', 'deleteMessage', () => transport.deleteTwitchMessage(message.id)), moderation('Timeout', 'timeout', () => transport.moderateTwitchUser({ userId: message.chatter.id, duration: 600, reason: 'Modération StreamDashboard' })), moderation('Ban', 'ban', () => transport.moderateTwitchUser({ userId: message.chatter.id, reason: 'Modération StreamDashboard' }))); menu.append(summary, tools); row.append(menu);
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
async function loadMoreChatters(reset = false) { if (companionMode !== CompanionMode.ONLINE_PC) return; if (moderationCapabilities?.chatters === false) { note(`Reconnecte Twitch pour accorder ${moderationCapabilities.requiredScopes?.chatters || 'moderator:read:chatters'}.`); return; } try { const result = await transport.twitchChatters(reset ? '' : chatterCursor); chatterCursor = result.cursor; const known = new Set(state.controlHub.audience.chatters.map(value => value.id)); for (const chatter of result.items || []) if (!known.has(chatter.id)) state.controlHub.audience.chatters.push({ id: chatter.id, displayName: chatter.displayName, role: 'viewer' }); $('more-chatters').hidden = !chatterCursor; renderAudience(state.controlHub.audience); } catch (error) { note(error.message); } }

let vodCursor = null, clipCursor = null;
let soundboardState = null;
const OBS_SOUNDBOARD_INPUT = 'StreamDashboard • Soundboard';
const soundboardVolumeKey = 'streamdashboard.soundboardMasterVolume';
const storedSoundboardVolume = Number(localStorage.getItem(soundboardVolumeKey));
let soundboardMasterVolume = Number.isFinite(storedSoundboardVolume) ? Math.max(0, Math.min(1, storedSoundboardVolume)) : 1;
let soundboardVolumeTimer = null;
const publicObsMediaInputs = values => (values || []).filter(name => name !== OBS_SOUNDBOARD_INPUT);
const newCommandId = () => globalThis.crypto?.randomUUID?.() || `${deviceId || 'android'}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
async function loadSoundboard() {
  if (companionMode !== CompanionMode.ONLINE_PC) { soundboardState = null; $('sounds-pc-state').textContent = 'PC hors ligne'; $('soundboard-state').textContent = 'PC StreamDashboard hors ligne. Les sons redeviendront disponibles à la reconnexion.'; renderSoundboard(); return; }
  $('soundboard-state').textContent = 'Chargement des sons…';
  try {
    soundboardState = await transport.soundboard();
    $('sounds-pc-state').textContent = 'PC connecté';
    const count = soundboardState.sounds.length;
    const output = soundboardState.outputs?.find(value => value.isDefault)?.name || soundboardState.outputs?.[0]?.name || 'Mix audio';
    $('soundboard-state').textContent = soundboardState.available ? (soundboardState.currentPlayback ? 'Lecture en cours…' : `${count} ${count === 1 ? 'son' : 'sons'} · ${output}`) : 'Le moteur audio du PC est indisponible.';
    renderSoundboard();
  }
  catch (error) { $('soundboard-state').textContent = error.message; }
}
function renderSoundboard() {
  const sounds = soundboardState?.sounds || []; const categories = [...new Set(sounds.map(sound => sound.category))].sort();
  const volume = $('sound-volume'); volume.value = String(Math.round(soundboardMasterVolume * 100)); volume.disabled = companionMode !== CompanionMode.ONLINE_PC || soundboardState?.supportsVolume !== true;
  $('stop-sound').disabled = companionMode !== CompanionMode.ONLINE_PC || soundboardState?.supportsStop !== true || !soundboardState?.currentPlayback;
  const select = $('sound-category'); const selected = select.value; select.replaceChildren(new Option('Toutes les catégories', ''), ...categories.map(value => new Option(value, value))); select.value = categories.includes(selected) ? selected : '';
  const query = $('sound-search').value.trim().toLocaleLowerCase(); const onlyFavorites = $('sound-favorites').checked; const container = $('sound-grid'); container.replaceChildren();
  for (const sound of sounds.filter(value => (!query || value.name.toLocaleLowerCase().includes(query)) && (!select.value || value.category === select.value) && (!onlyFavorites || value.favorite))) {
    const pad = document.createElement('button'); pad.type = 'button'; pad.className = `sound-pad${soundboardState.currentPlayback?.soundId === sound.id ? ' playing' : ''}${!sound.sourceAvailable ? ' sound-error' : ''}`; pad.disabled = !sound.enabled || !sound.sourceAvailable;
    pad.append(text('b', sound.name), text('small', `${sound.category} · ${Math.round(sound.volume * 100)}%`), text('span', sound.favorite ? '★' : '☆', 'sound-favorite'));
    pad.onclick = async event => { if (event.target.closest('.sound-favorite')) return; if (companionMode !== CompanionMode.ONLINE_PC) { note('PC hors ligne. Le son n’a pas été joué.'); return; } const commandId = newCommandId(); pad.disabled = true; try { const effectiveVolume = Math.max(0, Math.min(1, sound.volume * soundboardMasterVolume)); const ack = await transport.playSound({ commandId, soundId: sound.id, volume: effectiveVolume, issuedAt: new Date().toISOString() }); if (ack.status !== 'succeeded') throw new Error(ack.message || ack.errorCode || 'Lecture échouée.'); globalThis.StreamDashboardNative?.haptic?.('light'); note(`Lecture confirmée par le PC : ${sound.name}`); } catch (error) { note(error.message); } finally { pad.disabled = false; await loadSoundboard(); } };
    pad.querySelector('.sound-favorite').onclick = async event => { event.stopPropagation(); try { soundboardState = await transport.updateSound(sound.id, { favorite: !sound.favorite }); renderSoundboard(); } catch (error) { note(error.message); } };
    container.append(pad);
  }
  if (!container.children.length) { const empty = document.createElement('div'); empty.className = 'module-empty'; empty.append(text('small', sounds.length ? 'RECHERCHE' : 'AUCUN SON', 'console-label'), text('b', sounds.length ? 'Aucun pad ne correspond.' : 'Le catalogue Soundboard est vide.'), text('p', sounds.length ? 'Modifie la recherche ou affiche toutes les catégories.' : 'Ajoute des sons depuis le PC StreamDashboard. Ils seront disponibles ici immédiatement.', 'muted')); container.append(empty); }
}
let automationState = [];
let automationCapabilities = { triggers: ['support.received','test.support','twitch.reward.redeemed','streamer.ping.received','stream.started','stream.stopped','obs.state.changed','chat.message.received'], actions: ['soundboard.play','obs.scene','obs.media.restart','timer.add','timer.start','timer.pause'] };
const automationTriggerLabels = { 'support.received':'Soutien reçu','test.support':'Test soutien','twitch.reward.redeemed':'Récompense Twitch','streamer.ping.received':'Streamer Ping','stream.started':'Début du live','stream.stopped':'Fin du live','obs.state.changed':'État OBS','chat.message.received':'Message chat' };
const automationActionLabels = { 'soundboard.play':'Jouer un son','obs.scene':'Changer de scène','obs.media.restart':'Relancer un média OBS','timer.add':'Ajouter au timer','timer.start':'Démarrer le timer','timer.pause':'Mettre le timer en pause' };
const defaultAutomationDraft = () => ({ id:'', name:'', enabled:true, trigger:'support.received', conditions:[], actions:[{ type:'soundboard.play', payload:{ soundId:soundboardState?.sounds?.[0]?.id || '' } }], cooldownMs:30000 });
let automationDraft = defaultAutomationDraft();
async function loadAutomations() {
  if (companionMode !== CompanionMode.ONLINE_PC) { $('automation-list').replaceChildren(text('p', 'PC hors ligne · automatisations en lecture locale indisponibles.', 'muted')); return; }
  try {
    const [result, capabilities] = await Promise.all([transport.automations(), transport.automationCapabilities()]);
    automationState = result.items || []; automationCapabilities = capabilities || automationCapabilities;
    renderAutomations(); renderAutomationEditor();
  } catch (error) { note(error.message); }
}
function automationConditionRow(condition = {}, index = 0) {
  const row = document.createElement('div'); row.className = 'automation-editor-row'; row.dataset.conditionIndex = String(index);
  const path = document.createElement('input'); path.placeholder = 'Chemin, ex. reward.id'; path.value = condition.path || ''; path.dataset.conditionPath = '';
  const operator = document.createElement('select'); operator.dataset.conditionOperator = ''; operator.append(new Option('=', 'eq'), new Option('≥', 'gte')); operator.value = condition.operator || 'eq';
  const value = document.createElement('input'); value.placeholder = 'Valeur'; value.value = String(condition.value ?? ''); value.dataset.conditionValue = '';
  const remove = text('button','×','danger-button'); remove.type='button'; remove.onclick=()=>{ automationDraft=readAutomationEditor(); automationDraft.conditions.splice(index,1); renderAutomationEditor(); };
  row.append(path,operator,value,remove); return row;
}
function automationActionParameters(action, row) {
  const payload=action.payload||{}, type=action.type;
  const addParam=(key,node)=>{node.dataset.actionParam=key;row.append(node);};
  if(type==='soundboard.play'){const select=document.createElement('select'); for(const sound of soundboardState?.sounds||[])select.append(new Option(sound.name,sound.id));select.value=payload.soundId||'';addParam('soundId',select);const volume=document.createElement('input');volume.type='number';volume.min='0';volume.max='1.5';volume.step='.05';volume.value=String(payload.volume??1);addParam('volume',volume);}
  else if(type==='obs.scene'){const select=document.createElement('select');for(const scene of state?.obs?.scenes||[])select.append(new Option(scene,scene));select.value=payload.scene||'';addParam('scene',select);}
  else if(type==='obs.media.restart'){const select=document.createElement('select');for(const input of publicObsMediaInputs(state?.obs?.mediaInputs))select.append(new Option(input,input));select.value=payload.input||'';addParam('input',select);}
  else if(type==='timer.add'||type==='timer.start'){const seconds=document.createElement('input');seconds.type='number';seconds.min=type==='timer.start'?'1':'-86400';seconds.max='86400';seconds.value=String(payload.seconds??(type==='timer.start'?300:60));addParam('seconds',seconds);}
}
function automationActionRow(action = {}, index = 0) {
  const row=document.createElement('div');row.className='automation-editor-row';row.dataset.actionIndex=String(index);
  const type=document.createElement('select');type.dataset.actionType='';for(const value of automationCapabilities.actions||[])type.append(new Option(automationActionLabels[value]||value,value));type.value=action.type||'soundboard.play';
  type.onchange=()=>{automationDraft=readAutomationEditor();automationDraft.actions[index]={type:type.value,payload:{}};renderAutomationEditor();};
  row.append(type);automationActionParameters({type:type.value,payload:action.payload||{}},row);
  const remove=text('button','×','danger-button');remove.type='button';remove.onclick=()=>{automationDraft=readAutomationEditor();automationDraft.actions.splice(index,1);if(!automationDraft.actions.length)automationDraft.actions.push({type:'soundboard.play',payload:{}});renderAutomationEditor();};row.append(remove);return row;
}
function readAutomationEditor() {
  const conditions=[...$('automation-conditions').querySelectorAll('[data-condition-index]')].map(row=>{const operator=row.querySelector('[data-condition-operator]').value,raw=row.querySelector('[data-condition-value]').value;return{path:row.querySelector('[data-condition-path]').value.trim(),operator,value:operator==='gte'?Number(raw):raw==='true'?true:raw==='false'?false:raw};}).filter(value=>value.path);
  const actions=[...$('automation-actions').querySelectorAll('[data-action-index]')].map(row=>{const type=row.querySelector('[data-action-type]').value,payload={};row.querySelectorAll('[data-action-param]').forEach(input=>{payload[input.dataset.actionParam]=['seconds','volume'].includes(input.dataset.actionParam)?Number(input.value):input.value;});return{type,payload};});
  return { id:$('automation-id').value, name:$('automation-name').value.trim(), enabled:$('automation-enabled').checked, trigger:$('automation-trigger').value, conditions, actions, cooldownMs:Math.round(Number($('automation-cooldown').value||0)*1000) };
}
function setAutomationDraft(value) { automationDraft={...defaultAutomationDraft(),...structuredClone(value),conditions:structuredClone(value?.conditions||[]),actions:structuredClone(value?.actions?.length?value.actions:[{type:'soundboard.play',payload:{}}])};renderAutomationEditor(); }
function resetAutomationForm() { setAutomationDraft(defaultAutomationDraft()); }
function renderAutomationEditor() {
  $('automation-id').value=automationDraft.id||'';$('automation-name').value=automationDraft.name||'';$('automation-enabled').checked=automationDraft.enabled!==false;$('automation-trigger').value=automationDraft.trigger||'support.received';$('automation-cooldown').value=String((automationDraft.cooldownMs||0)/1000);
  $('automation-conditions').replaceChildren(...(automationDraft.conditions||[]).map(automationConditionRow));
  if(!$('automation-conditions').children.length)$('automation-conditions').append(text('p','Aucune condition · chaque événement correspondant déclenche la règle.','muted'));
  $('automation-actions').replaceChildren(...(automationDraft.actions||[]).map(automationActionRow));
}
function automationPayload(value = null) { const payload=readAutomationEditor(); return value ? {...payload,...value} : payload; }
function renderAutomations() {
  const container=$('automation-list');container.replaceChildren();
  for(const automation of automationState){
    const row=document.createElement('div');row.className='automation-row';row.append(text('b',`${automation.enabled?'●':'○'} ${automation.name}`),text('small',`${automationTriggerLabels[automation.trigger]||automation.trigger} · ${automation.actions.length} action${automation.actions.length>1?'s':''} · ${automation.lastResult?.status||'jamais'}`,automation.lastResult?.status==='failed'?'danger':'muted'));
    const actions=document.createElement('div');const edit=text('button','ÉDITER');edit.type='button';edit.onclick=()=>setAutomationDraft(automation);
    const toggle=text('button',automation.enabled?'OFF':'ON');toggle.type='button';toggle.onclick=async()=>{try{await transport.updateAutomation(automation.id,{name:automation.name,enabled:!automation.enabled,trigger:automation.trigger,conditions:automation.conditions,actions:automation.actions,cooldownMs:automation.cooldownMs});await loadAutomations();}catch(error){note(error.message);}};
    const remove=text('button','SUPPR.');remove.type='button';remove.onclick=async()=>{if(!confirm(`Supprimer l’automatisation « ${automation.name} » ?`))return;try{await transport.deleteAutomation(automation.id);if(automationDraft.id===automation.id)resetAutomationForm();await loadAutomations();}catch(error){note(error.message);}};actions.append(edit,toggle,remove);row.append(actions);container.append(row);
  }
  if(!container.children.length)container.append(text('p','Aucune automatisation.','muted'));
}
let supportState = null;
const money = (amountMinor, currency) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(amountMinor / 100);
async function loadSupports() { if (companionMode !== CompanionMode.ONLINE_PC) { $('support-provider').textContent = 'PC hors ligne · historique conservé sur le PC.'; return; } try { supportState = await transport.supports(); $('support-provider').textContent = supportState.provider.status === 'NOT_CONFIGURED' ? 'Streamlabs non configuré · configure-le sur le PC.' : `Streamlabs · ${humanProviderStatus(supportState.provider.status)}`; renderSupports(); } catch (error) { note(error.message); } }
function renderSupports() {
  if (!supportState) return; const totals = $('support-totals'); totals.replaceChildren();
  for (const [key, label] of [['session', 'LIVE'], ['day', 'AUJOURD’HUI'], ['month', 'CE MOIS']]) { const values = supportState.totals[key] || {}; const card = document.createElement('div'); card.className = 'support-total'; card.append(text('small', label), ...Object.entries(values).map(([currency, amount]) => text('b', money(amount, currency)))); if (!Object.keys(values).length) card.append(text('b', '—')); totals.append(card); }
  const filter = $('support-filter').value; const now = new Date(); const start = filter === 'session' ? Date.parse(supportState.sessionStartedAt || '') : filter === 'day' ? new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() : filter === 'month' ? new Date(now.getFullYear(), now.getMonth(), 1).getTime() : 0; const container = $('support-history'); container.replaceChildren();
  for (const support of supportState.history.filter(value => filter === 'all' || (Number.isFinite(start) && Date.parse(value.receivedAt) >= start))) { const row = document.createElement('article'); row.className = 'support-row'; row.append(text('time', new Date(support.receivedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })), text('b', support.displayName), text('strong', money(support.amountMinor, support.currency))); if (support.message) row.append(text('p', `“${support.message}”`)); container.append(row); }
  if (!container.children.length) container.append(text('p', 'Aucun soutien pour cette période.', 'muted'));
}
function resourceLink(url, label = 'OUVRIR') { const link = document.createElement('a'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = label; return link; }
async function loadVods(append = false) {
  if (companionMode !== CompanionMode.ONLINE_PC) { note('PC hors ligne. Les VOD Twitch ne peuvent pas être chargées via le PC.'); return; }
  try {
    const container = $('vod-list'); if (!append) container.replaceChildren(text('p', 'Chargement des VOD…', 'muted')); const result = await transport.twitchVideos(append ? vodCursor : ''); if (!append) container.replaceChildren();
    for (const vod of result.items || []) {
      const card = document.createElement('article'); card.className = 'resource-card'; card.append(text('b', vod.title), text('small', `${new Date(vod.createdAt).toLocaleDateString('fr-FR')} · ${vod.duration} · ${vod.viewCount} vues`, 'muted'));
      const actions = document.createElement('div'); actions.className = 'resource-actions'; actions.append(resourceLink(vod.url));
      const remove = text('button', 'SUPPRIMER', 'danger-button'); remove.type = 'button'; remove.disabled = moderationCapabilities?.deleteVideo === false; remove.title = remove.disabled ? `Reconnecte Twitch pour accorder ${moderationCapabilities.requiredScopes?.deleteVideo || 'channel:manage:videos'}.` : ''; remove.onclick = async () => { if (prompt(`Suppression définitive. Saisissez DELETE ${vod.id}`) !== `DELETE ${vod.id}`) return; try { await transport.deleteTwitchVideo(vod.id); card.remove(); note('VOD supprimée après confirmation Twitch.'); } catch (error) { note(error.message); } }; actions.append(remove); card.append(actions); container.append(card);
    }
    vodCursor = result.cursor; $('more-vods').hidden = !vodCursor; if (!container.children.length) container.append(text('p', 'Aucune VOD disponible.', 'empty-copy'));
  } catch (error) { note(error.message); }
}
async function loadClips(append = false) {
  if (companionMode !== CompanionMode.ONLINE_PC) { note('PC hors ligne. Les clips Twitch ne peuvent pas être chargés via le PC.'); return; }
  try { const container = $('clip-list'); if (!append) container.replaceChildren(text('p', 'Chargement des clips…', 'muted')); const result = await transport.twitchClips(append ? clipCursor : ''); if (!append) container.replaceChildren(); for (const clip of result.items || []) { const card = document.createElement('article'); card.className = 'resource-card'; card.append(text('b', clip.title), text('small', `${clip.creatorName} · ${clip.viewCount} vues · ${clip.duration}s`, 'muted'), resourceLink(clip.url)); container.append(card); } clipCursor = result.cursor; $('more-clips').hidden = !clipCursor; if (!container.children.length) container.append(text('p', 'Aucun clip disponible.', 'empty-copy')); } catch (error) { note(error.message); }
}

const planningProviderNames = { twitch: 'Twitch', google: 'Google' };
const planningProviderStatusNames = { synced: 'Synchronisé', pending: 'En attente', error: 'Erreur', 'not-published': 'Non publié', conflict: 'Conflit' };
async function retryPlanningProvider(item, provider) {
  if (companionMode !== CompanionMode.ONLINE_PC) return;
  try {
    const id = item.seriesId || item.id;
    const next = await transport.retryPlanningProvider(id, provider);
    render(next);
    note(`${planningProviderNames[provider] || provider} · nouvelle tentative effectuée.`);
  } catch (error) { note(error.message); }
}
function renderOnlinePlanningProviders(item, row) {
  if (companionMode !== CompanionMode.ONLINE_PC || item.occurrenceKey) return;
  for (const provider of ['twitch','google']) {
    if (item.desiredPublication?.[provider] !== true) continue;
    const link = item.providers?.[provider];
    const status = link?.status || 'pending';
    const block = document.createElement('div');
    block.className = `planning-provider-state provider-${status}`;
    const head = document.createElement('div');
    head.append(text('b', planningProviderNames[provider]), text('span', planningProviderStatusNames[status] || status, 'muted'));
    block.append(head);
    if (link?.lastError) block.append(text('small', link.lastError, 'danger'));
    if (status === 'error') {
      const retry = text('button', 'Réessayer', 'secondary');
      retry.type = 'button';
      retry.onclick = () => void retryPlanningProvider(item, provider);
      block.append(retry);
    } else if (status === 'conflict' || item.conflict?.provider === provider) {
      block.append(text('small', 'Conflit distant · résolution à effectuer sur le PC.', 'muted'));
    }
    row.append(block);
  }
  if (item.syncError) row.append(text('small', item.syncError, 'danger planning-sync-error'));
}
function updatePlanningProviderReadiness() {
  const copy = $('planning-provider-readiness');
  if (!copy) return;
  if (companionMode === CompanionMode.ONLINE_STANDALONE) {
    copy.textContent = 'Publication autonome selon les comptes connectés sur ce téléphone.';
    return;
  }
  if (companionMode !== CompanionMode.ONLINE_PC || !state) {
    copy.textContent = 'Connecte le PC pour vérifier la disponibilité des publications.';
    return;
  }
  const issues = [];
  if (!state.twitch?.connected) issues.push('Twitch non connecté');
  else if (moderationCapabilities?.schedule === false) issues.push('Twitch à reconnecter pour le planning');
  const google = state.google;
  if (google?.configured === false) issues.push('Google non provisionné sur ce PC');
  else if (!google?.connected) issues.push('Google à connecter sur le PC');
  else if (!google?.targetConfigured) issues.push('Calendrier Google cible à choisir sur le PC');
  copy.textContent = issues.length ? issues.join(' · ') : 'Twitch et Google sont prêts.';
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
    const when = planningWhenParts(item);
    const whenBlock = document.createElement('div'); whenBlock.className = 'planning-when'; whenBlock.append(text('strong', when.date), text('small', when.time));
    row.append(whenBlock, text('b', item.title));
    if (item.recurrence) row.append(text('small', recurrenceSummary(item), 'muted planning-recurrence'));
    if (item.occurrenceKey) {
      const actions = document.createElement('details'); actions.className = 'planning-actions';
      const summary = text('summary', 'Actions'); summary.setAttribute('aria-label', `Actions pour ${item.title}`);
      const editOne = text('button', 'Modifier cette occurrence'); editOne.type = 'button'; editOne.onclick = () => openMobileEditor(item, 'occurrence');
      const editSeries = text('button', 'Modifier toute la série'); editSeries.type = 'button'; editSeries.onclick = () => openMobileEditor(item, 'series');
      const deleteOne = text('button', 'Supprimer cette occurrence', 'danger-button'); deleteOne.type = 'button'; deleteOne.onclick = () => void removeMobileOccurrence(item);
      const deleteSeries = text('button', 'Supprimer toute la série', 'danger-button'); deleteSeries.type = 'button'; deleteSeries.onclick = () => void removeMobileSeries(item);
      actions.append(summary, editOne, editSeries, deleteOne, deleteSeries);
      row.append(actions);
    }
    if (companionMode !== CompanionMode.ONLINE_PC && !item.occurrenceKey) {
      const statuses = Object.entries(item.desiredPublication || {}).filter(([provider, enabled]) => enabled && ['twitch','google'].includes(provider)).map(([provider]) => `${provider === 'twitch' ? 'Twitch' : 'Google'} · ${(item.providerLinks?.[provider]?.status || 'pending').toUpperCase()}`).join('  ');
      const status = text('small', statuses || '⏳ À synchroniser', 'pending');
      const retryButton = text('button', 'Retry'); retryButton.type='button'; retryButton.hidden=!Object.values(item.providerLinks||{}).some(link=>['error','conflict'].includes(link.status)); retryButton.onclick=()=>void syncEventProviders(item);
      const edit = text('button', 'Modifier'); edit.type = 'button'; edit.onclick = () => { const title = prompt('Titre du live', item.title); if (!title || title === item.title) return; const result = companion.updateEvent(item.id, { title }, item.revision); if (result.conflict) note('Ce live a été modifié sur un autre appareil.'); else { render(offlineState()); void syncEventProviders(result.item); } };
      const remove = text('button', 'Supprimer'); remove.type = 'button'; remove.onclick = () => { if (!confirm(`Supprimer « ${item.title} » ?`)) return; const result = companion.deleteEvent(item.id, item.revision); if (result.conflict) note('Ce live a été modifié sur un autre appareil.'); else { render(offlineState()); void syncEventProviders(item, 'delete'); } };
      row.append(status, retryButton, edit, remove);
    }
    renderOnlinePlanningProviders(item, row);
    container.append(row);
  }
  if (!pagination.total) container.append(text('p', 'Aucun événement.', 'muted'));
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
  mobileEditing = { item, scope }; if ($('slot-dialog-title')) $('slot-dialog-title').textContent = scope === 'occurrence' ? 'Modifier cette occurrence' : 'Modifier l’événement'; const form = $('slot-form'); const start = new Date(item.startAtUtc); const end = new Date(item.endAtUtc);
  form.elements.title.value = item.title; form.elements.date.value = start.toISOString().slice(0, 10); form.elements.start.value = start.toTimeString().slice(0, 5); form.elements.end.value = end.toTimeString().slice(0, 5); form.elements.category.value = item.category || 'live'; form.elements.description.value = item.description || '';
  form.elements.recurrence.value = item.recurrence ? `${item.recurrence.frequency}-${item.recurrence.interval}` : ''; form.elements.recurrenceUntil.value = item.recurrence?.until?.slice(0, 10) || ''; form.elements.recurrence.disabled = scope === 'occurrence'; form.elements.recurrenceUntil.disabled = scope === 'occurrence'; selectPlanningPage('main'); $('slot-dialog').showModal();
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
  if (!acceptsSnapshot(state, next)) return;
  state = next;
  if (companionMode === CompanionMode.ONLINE_PC && Date.now() - lastProfileSyncAt > 5_000) void loadProductProfile().catch(() => undefined);
  syncMobileStreamerPing(next.streamerPings || []);
  if (companionMode === CompanionMode.ONLINE_PC) $('pc').textContent = 'Connecté';
  $('obs').textContent = next.obs.connected ? 'Prêt' : 'Déconnecté';
  const primaryMic = next.settings.primaryMicInput; const micMuted = primaryMic ? next.obs.inputs?.[primaryMic]?.muted : null; const micMissing = !primaryMic || micMuted === null || micMuted === undefined; $('direct-mic-state').textContent = primaryMic ? (micMissing ? 'Introuvable · toucher pour configurer' : micMuted ? 'Coupé' : 'Ouvert') : 'Non configuré · toucher pour configurer'; $('direct-mic-dot').textContent = primaryMic && micMuted === false ? '●' : '○'; $('direct-mic-dot').className = primaryMic && micMuted === false ? 'ok' : 'muted'; $('quick-mic').classList.toggle('configuration-needed', micMissing); $('quick-mic').setAttribute('aria-label', micMissing ? 'Configurer le micro principal' : `${micMuted ? 'Réactiver' : 'Couper'} le micro principal`);
  $('live').textContent = next.obs.streaming ? 'Live' : 'Hors ligne';
  $('live').className = next.obs.streaming ? 'ok' : '';
  $('next').textContent = next.nextLive ? `${next.nextLive.title} · ${formatPlanningDate(next.nextLive)}` : 'Aucun live planifié';
  $('stream').textContent = next.obs.streaming ? 'ARRÊTER LE LIVE' : 'DÉMARRER LE LIVE'; $('live-stream').textContent = $('stream').textContent;
  renderAudio(next.obs.inputs, next.obs.activeAudioInputs);
  if (document.activeElement !== $('twitch-title')) $('twitch-title').value = next.twitch?.channelTitle || '';
  if (document.activeElement !== $('twitch-category')) $('twitch-category').value = next.twitch?.gameName || '';
  $('twitch-game-id').value = next.twitch?.gameId || '';
  $('twitch-editor').hidden = !next.twitch?.connected;
  renderDeck(next.obs.mediaInputs);
  renderControlHub(next.controlHub);
  renderPlanning(next.planning);
  updatePlanningProviderReadiness();
  const discordConfigured = companionMode === CompanionMode.ONLINE_PC && next.discord?.configured === true;
  $('discord-destination').textContent = companionMode !== CompanionMode.ONLINE_PC
    ? 'Connexion PC requise pour publier sur Discord.'
    : discordConfigured
      ? `Discord · ${next.discord?.channelName ? `#${next.discord.channelName}` : 'destination à choisir'}`
      : 'Discord · configuration initiale à faire sur le PC';
  $('publish-discord').disabled = !discordConfigured;
  for (const id of ['discord-guild','discord-channel','discord-message']) $(id).disabled = !discordConfigured;
  $('timer').textContent = formatDuration(remaining());
  if (companionMode === CompanionMode.ONLINE_PC) showPairing(false);
  remoteButtons(companionMode !== CompanionMode.ONLINE_PC);
  $('stream').disabled = !next.obs.connected; $('live-stream').disabled = $('stream').disabled;
  if (!next.twitch?.connected) moderationCapabilities = null;
  else if (!moderationCapabilities && !twitchCapabilitiesFlight) void loadModerationCapabilities();
  applyTwitchActionCapabilities();
  const chattingActive = next.mode === 'live' && Boolean(next.settings.chattingScene) && next.obs.scene === next.settings.chattingScene;
  const availableScenes = next.obs.scenes || [];
  document.querySelectorAll('[data-mode]').forEach(button => {
    const mode = button.dataset.mode;
    const mapped = next.settings.modeScenes?.[mode] || '';
    const missing = !mapped || !availableScenes.includes(mapped);
    button.disabled = !next.obs.connected;
    button.classList.toggle('active', button.dataset.mode === next.mode && !(button.dataset.mode === 'live' && chattingActive));
    button.classList.toggle('configuration-needed', missing);
    const status = document.querySelector(`[data-mode-status="${mode}"]`);
    if (status) status.textContent = !mapped ? 'Non configuré · toucher pour choisir' : missing ? `${mapped} · introuvable` : mapped;
  });
  document.querySelectorAll('[data-chatting]').forEach(button => {
    const mapped = next.settings.chattingScene || '';
    const missing = !mapped || !availableScenes.includes(mapped);
    button.disabled = !next.obs.connected;
    button.classList.toggle('active', chattingActive);
    button.classList.toggle('configuration-needed', missing);
    const status = document.querySelector('[data-mode-status="chatting"]');
    if (status) status.textContent = !mapped ? 'Non configuré · toucher pour choisir' : missing ? `${mapped} · introuvable` : mapped;
  });
}

function tickTimer() {
  if (!state) return;
  const value = formatDuration(remaining());
  $('timer').textContent = value;
  $('timer-preview').textContent = `${value} · ${state.timer.running ? 'en cours' : 'prêt'}`;
}

async function pair() {
  if (pairingInFlight) return;
  pairingInFlight = true;
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
    pairingInFlight = false;
  }
}

async function getWsTicket() {
  const result = await transport.ticket();
  return result.ticket;
}

async function fetchState() {
  // REST state is the authority for whether the PC command channel is reachable.
  // Companion sync must never gate remote-control availability.
  const previousCapabilityKey = runtimeCapabilities ? `${runtimeCapabilities.serverVersion || ''}|${(runtimeCapabilities.features || []).join(',')}` : '';
  runtimeCapabilities = await transport.capabilities().catch(() => ({ protocolVersion: 0, serverVersion: '', features: [] }));
  const nextCapabilityKey = `${runtimeCapabilities.serverVersion || ''}|${(runtimeCapabilities.features || []).join(',')}`;
  if (previousCapabilityKey !== nextCapabilityKey) profileLoaded = false;
  updateRuntimeCompatibility();
  const next = await transport.state();
  if (!profileLoaded) { profileLoaded = true; await loadProductProfile().catch(() => { profileLoaded = false; }); }
  if (!companion.snapshot().pending.length) companion.replaceServerSnapshot(next);
  companionMode = CompanionMode.ONLINE_PC;
  render(next);
  setConnectionMode(CompanionMode.ONLINE_PC);
  remoteButtons(false);
  if (credential && deviceId) {
    void syncCompanion().catch(error => note(`PC connecté · synchro compagnon différée : ${error.message}`));
  }
  return next;
}

async function syncCompanion() {
  if (companionSyncFlight) return companionSyncFlight;
  companionSyncFlight = (async () => {
    const cache = companion.snapshot();
    const response = await transport.syncCompanion({ schemaVersion: cache.schemaVersion, deviceId, lastKnownServerRevision: cache.serverRevision ?? 0, operations: cache.pending });
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

  // Phase 1: establish the HTTP command channel. This alone is enough to make
  // the remote usable; realtime is an optional telemetry enhancement.
  try {
    $('connection').textContent = 'Connexion au PC…';
    remoteButtons(true);
    await fetchState();
    $('connection').textContent = 'PC connecté';
    $('connection').className = 'ok';
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
    note(`Connexion PC impossible : ${error.message}`);
    reconnectTimer = setTimeout(connect, retry);
    retry = nextRetry(retry);
    return;
  }

  // Phase 2: realtime must never disable a healthy HTTP command channel.
  try {
    const ticket = await getWsTicket();
    ws = transport.websocket(ticket);
    ws.onopen = () => {
      retry = 500;
      setConnectionMode(CompanionMode.ONLINE_PC);
      $('connection').textContent = 'PC connecté · temps réel';
      $('connection').className = 'ok';
      render(state);
      remoteButtons(false);
      note('Télécommande connectée au PC.');
    };
    ws.onmessage = event => {
      try {
        const value = JSON.parse(event.data);
        if (value.type === 'state.updated') render(value.data);
      } catch { note('Événement temps réel invalide.'); }
    };
    ws.onclose = () => {
      $('connection').textContent = 'PC connecté · temps réel en reconnexion…';
      $('connection').className = '';
      void transport.state().then(next => {
        companionMode = CompanionMode.ONLINE_PC;
        render(next);
        setConnectionMode(CompanionMode.ONLINE_PC);
        $('connection').textContent = 'PC connecté · temps réel en reconnexion…';
        remoteButtons(false);
      }).catch(async error => {
        if (error instanceof HttpError && [401, 403].includes(error.status)) {
          credential = '';
          await credentialStorage.clear();
          showPairing(true);
          note('Cette télécommande a été révoquée depuis le PC.');
          return;
        }
        setConnectionMode(resolveMode({ pcAvailable: false, internetAvailable: navigator.onLine }));
      });
      reconnectTimer = setTimeout(connect, retry);
      retry = nextRetry(retry);
    };
    ws.onerror = () => ws.close();
  } catch (error) {
    // Ticket/WebSocket failure is telemetry-only. Keep HTTP controls enabled.
    companionMode = CompanionMode.ONLINE_PC;
    setConnectionMode(CompanionMode.ONLINE_PC);
    remoteButtons(false);
    $('connection').textContent = 'PC connecté · temps réel indisponible';
    $('connection').className = 'ok';
    note(`Contrôle disponible · temps réel indisponible : ${error.message}`);
    reconnectTimer = setTimeout(connect, retry);
    retry = nextRetry(retry);
  }
}

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
  if (state?.discord?.configured !== true) { note('Configure d’abord Discord sur le PC.'); return; }
  try { const guilds = await transport.discordGuilds(); $('discord-guild').replaceChildren(new Option('Choisir…', ''), ...guilds.map(value => new Option(value.name, value.id))); if (state.discord?.guildId) $('discord-guild').value = state.discord.guildId; $('discord-guild').dispatchEvent(new Event('change')); } catch (error) { note(error.message); }
}
$('discord-guild').onfocus = () => { if ($('discord-guild').options.length < 2) void loadDiscordGuilds(); };
$('discord-guild').onchange = async () => { const guildId = $('discord-guild').value; if (!guildId || state?.discord?.configured !== true) return; try { const channels = await transport.discordChannels(guildId); $('discord-channel').replaceChildren(new Option('Choisir…', ''), ...channels.map(value => new Option(`#${value.name}`, value.id))); if (state.discord?.channelId) $('discord-channel').value = state.discord.channelId; } catch (error) { note(error.message); } };
$('discord-channel').onchange = async () => { if (state?.discord?.configured !== true) { note('Configure d’abord Discord sur le PC.'); return; } try { await transport.discordSettings({ guildId: $('discord-guild').value, channelId: $('discord-channel').value, defaultMessage: $('discord-message').value }); note('Destination Discord enregistrée.'); } catch (error) { note(error.message); } };
$('publish-discord').onclick = async () => {
  if (companionMode !== CompanionMode.ONLINE_PC) { note('Connexion PC requise pour publier sur Discord.'); return; }
  if (state?.discord?.configured !== true) { note('Configure d’abord Discord sur le PC.'); return; }
  try {
    note('Génération du planning…'); const { buildPlanningPng } = await import('./planning-export.js');
    const resolveArtwork = async item => { const cached = recentCategories.find(category => category.id === item.twitchCategoryId)?.box_art_url; if (cached) return cached; const response = await providerSync.searchCategories(companionMode, item.twitchCategoryName || '', recentCategories, value => transport.searchTwitch(value)); return (response.items || response).find(category => category.id === item.twitchCategoryId)?.box_art_url; };
    const result = await buildPlanningPng(state.planning, state.settings.streamerName, { filters: planningFilters, period: $('export-period').value, noteEnabled: $('export-note-enabled').checked, noteText: $('export-note-text').value, resolveArtwork });
    note('Publication Discord…'); const posted = await transport.publishDiscord({ imageBase64: await blobBase64(result.blob), filename: result.fileName, message: $('discord-message').value || undefined, channelId: $('discord-channel').value || undefined });
    note(`Planning publié dans #${posted.channelName || 'planning'}.`);
  } catch (error) { note(error.message); }
};
if ($('edit-server')) $('edit-server').onclick = () => { if (legacyMode) openCanonicalPairing(); else { showPairing(true); $('pair-server').focus(); } };
$('keep-awake').onchange = () => globalThis.StreamDashboardNative?.setKeepAwake?.($('keep-awake').checked);

function organizeMobileShell() {
  const message = $('message'); document.body.append(message); message.className = 'app-toast';
}
organizeMobileShell();

const selectTab = tab => {
  activateView(tab);
  if (tab === 'sounds') void loadSoundboard();
};
document.querySelector('.bottom-nav').onclick = event => { const button = event.target.closest('[data-tab]'); if (button) selectTab(button.dataset.tab); };
document.addEventListener('click', event => { const open = event.target.closest('[data-open-tab]'); if (open) selectTab(open.dataset.openTab); const tool = event.target.closest('[data-open-live-tool]'); if (tool) openLiveTool(tool.dataset.openLiveTool); });
document.addEventListener('click', event => {
  const target = event.target.closest('[data-settings-target]')?.dataset.settingsTarget;
  if (!target) return;
  const diagnostics = $('diagnostics');
  diagnostics.open = target === 'diagnostics';
  if (target === 'pairing') showPairing(true);
  const destination = target === 'diagnostics' ? diagnostics
    : target === 'profile' ? $('profile-appearance')
      : target === 'preferences' ? $('ui-preferences')
        : target === 'connections' ? $('mobile-connections')
          : $('pairing');
  requestAnimationFrame(() => destination.scrollIntoView({ block: 'start' }));
});
async function createQuickClip() { if (companionMode !== CompanionMode.ONLINE_PC) throw new Error('PC requis.'); await ensureTwitchCapabilities(); if (moderationCapabilities?.createClip === false) throw new Error(`Reconnecte Twitch pour accorder ${moderationCapabilities.requiredScopes?.createClip || 'clips:edit'}.`); const clip = await transport.createTwitchClip(); globalThis.StreamDashboardNative?.haptic?.('light'); note(`Clip créé · ${clip.id}`); }
async function togglePrimaryMic() { const value = primaryMicCommand(state); const confirmed = await command(value, { reconcile: next => next.obs?.inputs?.[value.input]?.muted === value.muted }); if (!confirmed) throw new Error('Commande non confirmée par le PC.'); }
const configuredScene = mode => mode === 'chatting' ? state?.settings?.chattingScene : state?.settings?.modeScenes?.[mode];
const availableAudioInputs = () => {
  const active = state?.obs?.activeAudioInputs || [];
  const all = Object.keys(state?.obs?.inputs || {});
  return [...new Set([...active, ...all])];
};
function openPrimaryMicConfig() {
  if (!requireRuntimeFeature('mobile-live-control-config')) return;
  if (companionMode !== CompanionMode.ONLINE_PC || !state?.obs?.connected) { note('Connecte OBS pour choisir le micro principal.'); return; }
  const select = $('primary-mic-select');
  const inputs = availableAudioInputs();
  select.replaceChildren(new Option('Aucun micro principal', ''), ...inputs.map(name => new Option(name, name)));
  select.value = inputs.includes(state.settings.primaryMicInput) ? state.settings.primaryMicInput : '';
  $('primary-mic-empty').hidden = inputs.length > 0;
  $('save-primary-mic').disabled = inputs.length === 0 && !state.settings.primaryMicInput;
  $('mic-config-dialog').showModal();
}
function openSceneConfig(mode) {
  if (!requireRuntimeFeature('mobile-live-control-config')) return;
  if (companionMode !== CompanionMode.ONLINE_PC || !state?.obs?.connected) { note('Connecte OBS pour choisir une scène.'); return; }
  const scenes = state.obs.scenes || [];
  const select = $('scene-config-select');
  const labels = { intro: 'Intro', live: 'Live · Gameplay', chatting: 'Chatting', pause: 'Pause', end: 'Fin' };
  $('scene-config-mode').value = mode;
  $('scene-config-title').textContent = `Configurer · ${labels[mode] || mode}`;
  select.replaceChildren(new Option('Aucune scène', ''), ...scenes.map(name => new Option(name, name)));
  const current = configuredScene(mode) || '';
  select.value = scenes.includes(current) ? current : '';
  $('scene-config-empty').hidden = scenes.length > 0;
  $('save-scene-config').disabled = scenes.length === 0 && !current;
  if ($('live-tools-sheet').open) $('live-tools-sheet').close();
  $('scene-config-dialog').showModal();
}
async function handlePrimaryMic() {
  const configured = state?.settings?.primaryMicInput;
  if (!configured || !state?.obs?.inputs?.[configured]) { openPrimaryMicConfig(); return; }
  await togglePrimaryMic();
}
async function handleModeAction(mode) {
  const scene = configuredScene(mode);
  if (!scene || !(state?.obs?.scenes || []).includes(scene)) { openSceneConfig(mode); return; }
  if (mode === 'chatting') await command({ type: 'scene.chatting' });
  else await command({ type: 'mode.set', mode });
}
$('mic-config-form').onsubmit = async event => {
  event.preventDefault();
  if (!requireRuntimeFeature('mobile-live-control-config')) return;
  try {
    const next = await transport.updateLiveControl({ primaryMicInput: $('primary-mic-select').value });
    $('mic-config-dialog').close();
    render(next);
    note($('primary-mic-select').value ? 'Micro principal configuré.' : 'Micro principal désactivé.');
  } catch (error) { note(error.message); }
};
$('close-mic-config').onclick = () => $('mic-config-dialog').close();
$('configure-primary-mic').onclick = openPrimaryMicConfig;
$('scene-config-form').onsubmit = async event => {
  event.preventDefault();
  if (!requireRuntimeFeature('mobile-live-control-config')) return;
  try {
    const mode = $('scene-config-mode').value;
    const next = await transport.updateLiveControl({ mode, scene: $('scene-config-select').value });
    $('scene-config-dialog').close();
    render(next);
    note($('scene-config-select').value ? 'Scène associée.' : 'Association supprimée.');
  } catch (error) { note(error.message); }
};
$('close-scene-config').onclick = () => $('scene-config-dialog').close();
$('open-automations').onclick = () => openLiveTool('automations');
$('live-stream').onclick = () => $('stream').click();
$('live-clip').onclick = () => void createQuickClip().catch(error => note(`Impossible de créer le clip. ${error.message}`)); $('quick-mic').onclick = () => void handlePrimaryMic().catch(error => note(error.message)); $('open-scenes-live').onclick = () => openLiveTool('scenes'); $('refresh-sounds').onclick = () => void loadSoundboard();
const savedTab = localStorage.getItem('streamdashboard.mobileTab'); selectTab(['home', 'live', 'sounds', 'planning', 'more', 'prepare', 'settings'].includes(savedTab) ? savedTab : 'home');


const preferenceKey = 'streamdashboard.mobileUx';
const appearanceDefaults = { theme: 'system', preset: 'minimal', accent: '#2474e5', density: 'normal', radius: 'medium', textScale: 'normal' };
let uxPreferences = { focus: false, reducedMotion: false, ...appearanceDefaults };
try { const local = JSON.parse(localStorage.getItem(preferenceKey) || '{}'); uxPreferences.focus = local.focus === true; uxPreferences.reducedMotion = local.reducedMotion === true; } catch { /* use accessible device defaults */ }
function applyUxPreferences() {
  document.body.classList.toggle('focus-mode', uxPreferences.focus); document.body.classList.toggle('reduce-motion', uxPreferences.reducedMotion);
  for (const key of ['theme', 'preset', 'density', 'radius']) document.body.dataset[key] = uxPreferences[key];
  document.documentElement.style.setProperty('--accent', uxPreferences.accent); document.documentElement.style.setProperty('--font-scale', uxPreferences.textScale === 'large' ? '1.16' : uxPreferences.textScale === 'small' ? '.9' : '1');
  $('focus-mode').checked = uxPreferences.focus; $('reduce-motion').checked = uxPreferences.reducedMotion;
  const themeLabels = { system: 'Système', light: 'Clair', dark: 'Sombre', oled: 'OLED' }; const presetLabels = { minimal: 'Minimal', soft: 'Doux', compact: 'Compact', contrast: 'Contrasté' };
  $('appearance-theme').textContent = `${themeLabels[uxPreferences.theme] || uxPreferences.theme} · ${presetLabels[uxPreferences.preset] || uxPreferences.preset}`;
  $('appearance-details').textContent = `Densité ${uxPreferences.density} · Texte ${uxPreferences.textScale}`;
  localStorage.setItem(preferenceKey, JSON.stringify({ focus: uxPreferences.focus, reducedMotion: uxPreferences.reducedMotion }));
}
function setFocusPreference(value) { uxPreferences.focus = value; applyUxPreferences(); }
$('focus-mode').onchange = event => setFocusPreference(event.target.checked); $('reduce-motion').onchange = event => { uxPreferences.reducedMotion = event.target.checked; applyUxPreferences(); };
function populateProfileAppearanceForm() {
  if (!productProfile) return;
  $('profile-display-name').value = productProfile.profile?.displayName || '';
  $('profile-channel-name').value = productProfile.profile?.channelName || '';
  $('appearance-theme-input').value = productProfile.appearance?.theme || appearanceDefaults.theme;
  $('appearance-preset-input').value = productProfile.appearance?.preset || appearanceDefaults.preset;
  $('appearance-accent-input').value = productProfile.appearance?.accent || appearanceDefaults.accent;
  $('appearance-density-input').value = productProfile.appearance?.density || appearanceDefaults.density;
  $('appearance-radius-input').value = productProfile.appearance?.radius || appearanceDefaults.radius;
  $('appearance-text-scale-input').value = productProfile.appearance?.textScale || appearanceDefaults.textScale;
}
function previewProfileAppearance() {
  uxPreferences = {
    ...uxPreferences,
    theme: $('appearance-theme-input').value,
    preset: $('appearance-preset-input').value,
    accent: $('appearance-accent-input').value,
    density: $('appearance-density-input').value,
    radius: $('appearance-radius-input').value,
    textScale: $('appearance-text-scale-input').value,
  };
  applyUxPreferences();
}
for (const id of ['appearance-theme-input','appearance-preset-input','appearance-accent-input','appearance-density-input','appearance-radius-input','appearance-text-scale-input']) {
  $(id).addEventListener('input', previewProfileAppearance);
  $(id).addEventListener('change', previewProfileAppearance);
}
$('profile-appearance-form').onsubmit = async event => {
  event.preventDefault();
  if (companionMode !== CompanionMode.ONLINE_PC) { note('Connecte le téléphone au PC pour enregistrer le profil partagé.'); return; }
  if (!requireRuntimeFeature('mobile-profile-presentation')) return;
  if (!productProfile) { note('Le profil partagé n’a pas pu être chargé depuis le PC.'); return; }
  try {
    const value = {
      profile: {
        displayName: $('profile-display-name').value.trim() || 'Streamer',
        channelName: $('profile-channel-name').value.trim(),
        language: productProfile.profile?.language || 'fr',
      },
      appearance: {
        theme: $('appearance-theme-input').value,
        preset: $('appearance-preset-input').value,
        accent: $('appearance-accent-input').value,
        density: $('appearance-density-input').value,
        radius: $('appearance-radius-input').value,
        textScale: $('appearance-text-scale-input').value,
      },
    };
    const result = await transport.updateProfilePresentation(value);
    productProfile = result.profile;
    uxPreferences = { ...uxPreferences, ...productProfile.appearance };
    applyUxPreferences();
    populateProfileAppearanceForm();
    applyModuleProjection(productProfile.modules || {});
    note('Profil et apparence enregistrés.');
  } catch (error) { note(error.message); }
};
async function loadProductProfile() {
  const [result, connections] = await Promise.all([
    transport.profile().catch(() => null),
    transport.connections().catch(() => ({ items: [] })),
  ]);
  if (result?.profile) {
    productProfile = result.profile;
    uxPreferences = { ...uxPreferences, ...productProfile.appearance }; applyUxPreferences();
    populateProfileAppearanceForm();
    applyModuleProjection(productProfile.modules || {});
  }
  connectionProjection = connections.items || [];
  lastProfileSyncAt = Date.now();
  renderManagedConnections(state?.controlHub);
}
function applyModuleProjection(enabled) {
  document.querySelectorAll('[data-module]').forEach(node => { const unavailable = !node.dataset.module.split(',').some(id => enabled[id] !== false); node.dataset.moduleUnavailable = String(unavailable); if (node.matches('[data-live-panel]')) { if (unavailable) node.hidden = true; } else node.hidden = unavailable; });
  const active = document.querySelector('[data-view].active'); if (active?.hidden) activateView('home');
}
applyUxPreferences(); setFocusPreference(uxPreferences.focus);
const preparationKey = 'streamdashboard.mobilePreparationTab';
function selectPreparationTab(tab, remember = true) { const selected = ['checklist', 'notes', 'templates'].includes(tab) ? tab : 'checklist'; document.querySelectorAll('[data-prepare-tab]').forEach(button => { const active = button.dataset.prepareTab === selected; button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); }); document.querySelectorAll('[data-prepare-panel]').forEach(panel => { panel.hidden = panel.dataset.preparePanel !== selected; }); if (remember) localStorage.setItem(preparationKey, selected); }
document.querySelector('.prepare-tabs').onclick = event => { const tab = event.target.closest('[data-prepare-tab]')?.dataset.prepareTab; if (tab) selectPreparationTab(tab); };
document.addEventListener('click', event => { const target = event.target.closest('[data-prepare-target]')?.dataset.prepareTarget; if (target) selectPreparationTab(target); });
selectPreparationTab(localStorage.getItem(preparationKey) || 'checklist', false);
try {
  const legacyTarget = JSON.parse(localStorage.getItem('streamdashboard.legacyTarget') || 'null');
  if (legacyTarget) {
    localStorage.removeItem('streamdashboard.legacyTarget');
    if (legacyTarget.prepare) {
      selectTab('prepare');
      selectPreparationTab(legacyTarget.prepare);
    } else if (legacyTarget.settings) {
      selectTab('settings');
      queueMicrotask(() => document.querySelector(`[data-settings-target="${legacyTarget.settings}"]`)?.click());
    } else if (legacyTarget.liveTool) {
      selectTab('live');
      queueMicrotask(() => openLiveTool(legacyTarget.liveTool));
    } else if (legacyTarget.action === 'automations') {
      selectTab('more');
      queueMicrotask(() => $('open-automations')?.click());
    }
  }
} catch { localStorage.removeItem('streamdashboard.legacyTarget'); }
$('new-note').onclick = () => $('note-dialog').showModal(); $('cancel-note').onclick = () => $('note-dialog').close();
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
function selectPlanningPage(page) { document.querySelectorAll('[data-planning-page]').forEach(value => { value.hidden = value.dataset.planningPage !== page; }); }
document.querySelectorAll('[data-open-planning-page]').forEach(button => button.onclick = () => selectPlanningPage(button.dataset.openPlanningPage));
$('open-planning-filters').onclick = () => $('planning-filters-sheet').showModal();
$('close-planning-filters').onclick = () => $('planning-filters-sheet').close();
$('open-planning-publish').onclick = () => $('planning-publish-sheet').showModal();
$('close-planning-publish').onclick = () => $('planning-publish-sheet').close();
$('add-slot').onclick = () => { mobileEditing = null; if ($('slot-dialog-title')) $('slot-dialog-title').textContent = 'Nouvel événement'; $('slot-form').elements.recurrence.disabled = false; $('slot-form').elements.recurrenceUntil.disabled = false; $('slot-form').reset(); selectPlanningPage('main'); $('slot-dialog').showModal(); };
$('close-slot').onclick = () => { mobileEditing = null; if ($('slot-dialog-title')) $('slot-dialog-title').textContent = 'Nouvel événement'; $('slot-form').elements.recurrence.disabled = false; $('slot-form').elements.recurrenceUntil.disabled = false; $('slot-dialog').close(); };
$('slot-form').onsubmit = async event => {
  event.preventDefault(); const form = new FormData(event.currentTarget);
  const date = form.get('date'); const startAtUtc = new Date(`${date}T${form.get('start')}`).toISOString(); const endAtUtc = new Date(`${date}T${form.get('end')}`).toISOString();
  try {
    if (form.get('twitch') === 'on') await ensureTwitchCapabilities();
    if (form.get('twitch') === 'on' && moderationCapabilities?.schedule === false) throw new Error(`Reconnecte Twitch pour accorder ${moderationCapabilities.requiredScopes?.schedule || 'channel:manage:schedule'}.`);
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
  await ensureTwitchCapabilities();
  if (moderationCapabilities?.updateChannel === false) { note(`Reconnecte Twitch pour accorder ${moderationCapabilities.requiredScopes?.updateChannel || 'channel:manage:broadcast'}.`); return; }
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
    void handleModeAction(button.dataset.mode);
  } else if (button.hasAttribute('data-chatting')) {
    void handleModeAction('chatting');
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
  if (!state || !state.obs.connected || commandController.isLocked('stream')) return;
  const start = !state.obs.streaming;
  const question = start
    ? 'Démarrer réellement le live ?'
    : state.settings.confirmStop ? 'Arrêter réellement le live ?' : 'Arrêter le live ?';
  if (!confirm(question)) return;
  void (async () => {
    if (!start) {
      await command({ type: 'session.stop' }, { reconcile: next => next.obs?.streaming === false });
      return;
    }
    const prepared = await command({ type: 'session.prepare' });
    if (!prepared) return;
    const requiresBypass = state?.preflight?.status === 'action-required';
    if (requiresBypass && !confirm('La checklist demande une action. Démarrer quand même ?')) return;
    await command({ type: 'session.start', force: requiresBypass }, { reconcile: next => next.obs?.streaming === true });
  })();
};

const liveToolTitles = { timer: 'Timer', audio: 'Audio', twitch: 'Informations Twitch', audience: 'Audience et modération', scenes: 'Modes et scènes', vod: 'VOD et clips', supports: 'Dons et soutiens', automations: 'Automatisations', media: 'Médias OBS' };
function openLiveTool(tool) {
  const panel = document.querySelector(`[data-live-panel="${tool}"]`);
  if (!panel || panel.dataset.moduleUnavailable === 'true') return;
  selectTab('live');
  document.querySelectorAll('[data-live-panel]').forEach(value => { value.hidden = value !== panel; });
  $('live-tool-title').textContent = liveToolTitles[tool] || 'Outil live';
  const sheet = $('live-tools-sheet'); if (!sheet.open) sheet.showModal();
  if (tool === 'vod') { void loadVods(); void loadClips(); }
  if (tool === 'automations') void loadSoundboard().then(loadAutomations);
  if (tool === 'supports') void loadSupports();
  if (tool === 'audience') { void ensureTwitchCapabilities().then(() => loadMoreChatters(true)); }
}
$('close-live-tool').onclick = () => $('live-tools-sheet').close();
$('live-tools-sheet').onclick = event => { if (event.target === $('live-tools-sheet')) $('live-tools-sheet').close(); };
$('live-tools-sheet').querySelectorAll('[data-mode],[data-chatting]').forEach(button => button.addEventListener('click', () => { const mode = button.dataset.mode || 'chatting'; const scene = configuredScene(mode); if (scene && (state?.obs?.scenes || []).includes(scene) && $('live-tools-sheet').open) $('live-tools-sheet').close(); }));
$('audience-search').oninput = () => renderAudience(state?.controlHub?.audience);
$('more-chatters').onclick = () => void loadMoreChatters();
$('sound-search').oninput = renderSoundboard; $('sound-category').onchange = renderSoundboard; $('sound-favorites').onchange = renderSoundboard;
$('sound-volume').oninput = event => {
  soundboardMasterVolume = Math.max(0, Math.min(1, Number(event.target.value) / 100));
  localStorage.setItem(soundboardVolumeKey, String(soundboardMasterVolume));
  clearTimeout(soundboardVolumeTimer);
  if (companionMode !== CompanionMode.ONLINE_PC || soundboardState?.supportsVolume !== true || !soundboardState?.currentPlayback || !runtimeSupports('soundboard-live-volume')) return;
  const current = soundboardState.sounds?.find(sound => sound.id === soundboardState.currentPlayback.soundId);
  const effectiveVolume = Math.max(0, Math.min(1, (current?.volume ?? 1) * soundboardMasterVolume));
  soundboardVolumeTimer = setTimeout(async () => {
    try { soundboardState = await transport.setSoundVolume(effectiveVolume); renderSoundboard(); }
    catch (error) { note(error.message); }
  }, 80);
};
$('stop-sound').onclick = async () => {
  if (companionMode !== CompanionMode.ONLINE_PC) { note('PC hors ligne.'); return; }
  try { soundboardState = await transport.stopSound(); renderSoundboard(); note('Lecture arrêtée.'); }
  catch (error) { note(error.message); }
};
$('automation-reset').onclick = resetAutomationForm;
$('automation-condition-add').onclick = () => { automationDraft = readAutomationEditor(); automationDraft.conditions.push({ path: '', operator: 'eq', value: '' }); renderAutomationEditor(); };
$('automation-action-add').onclick = () => { automationDraft = readAutomationEditor(); automationDraft.actions.push({ type: 'soundboard.play', payload: { soundId: soundboardState?.sounds?.[0]?.id || '' } }); renderAutomationEditor(); };
$('automation-form').onsubmit = async event => { event.preventDefault(); try { const payload = automationPayload(); if (!payload.name) throw new Error('Donne un nom à l’automatisation.'); if (!payload.actions.length) throw new Error('Ajoute au moins une action.'); const id = $('automation-id').value; if (id) await transport.updateAutomation(id, payload); else await transport.createAutomation(payload); resetAutomationForm(); await loadAutomations(); note('Automatisation enregistrée par le PC Runtime.'); } catch (error) { note(error.message); } };
$('automation-test').onclick = async () => { try { const accepted = await transport.testAutomation(500); note(`Événement test accepté · corrélation ${accepted.correlationId}`); } catch (error) { note(error.message); } };
$('support-filter').onchange = renderSupports;
async function loadDiagnosticEvents() { if (companionMode !== CompanionMode.ONLINE_PC) { $('diagnostic-events').replaceChildren(text('p', 'PC hors ligne · diagnostics Runtime indisponibles.', 'muted')); return; } try { const result = await transport.events({ type: $('event-filter-type').value.trim(), source: $('event-filter-source').value.trim(), correlationId: $('event-filter-correlation').value.trim(), limit: '100' }); const container = $('diagnostic-events'); container.replaceChildren(); for (const event of [...result.items].reverse()) { const row = document.createElement('div'); row.className = 'diagnostic-event'; row.append(text('time', new Date(event.occurredAt).toLocaleTimeString('fr-FR')), text('b', event.type), text('small', event.source), text('code', event.correlationId)); container.append(row); } if (!container.children.length) container.append(text('p', 'Aucun événement correspondant.', 'muted')); } catch (error) { note(error.message); } }
$('refresh-events').onclick = () => void loadDiagnosticEvents();
$('diagnostics').ontoggle = () => { if ($('diagnostics').open) void loadDiagnosticEvents(); };
$('refresh-vods').onclick = () => void loadVods();
$('more-vods').onclick = () => void loadVods(true);
$('more-clips').onclick = () => void loadClips(true);
$('create-clip').onclick = async () => { if (companionMode !== CompanionMode.ONLINE_PC) { note('PC hors ligne.'); return; } await ensureTwitchCapabilities(); if (moderationCapabilities?.createClip === false) { note(`Reconnecte Twitch pour accorder ${moderationCapabilities.requiredScopes?.createClip || 'clips:edit'}.`); return; } try { const clip = await transport.createTwitchClip(); note(`Clip accepté par Twitch (${clip.id}). Il sera disponible après traitement.`); await loadClips(); } catch (error) { note(error.message); } };
$('chat-form').onsubmit = async event => { event.preventDefault(); const message = $('chat-message').value.trim(); if (!message) return; if (companionMode !== CompanionMode.ONLINE_PC) { note('PC hors ligne. Le message n’a pas été envoyé.'); return; } await ensureTwitchCapabilities(); if (moderationCapabilities?.chatWrite === false) { note(`Reconnecte Twitch pour accorder ${moderationCapabilities.requiredScopes?.chatWrite || 'user:write:chat'}.`); return; } try { const replyParentMessageId = $('chat-reply-context').dataset.messageId; await transport.sendTwitchChat({ message, ...(replyParentMessageId ? { replyParentMessageId } : {}) }); $('chat-message').value = ''; $('chat-reply-context').hidden = true; delete $('chat-reply-context').dataset.messageId; note('Message confirmé par Twitch.'); } catch (error) { note(error.message); } };
$('unban-user').onclick = async () => { const userId = $('unban-user-id').value.trim(); if (!moderationCapabilities?.unban) { note(`NOT_AUTHORIZED · ${moderationCapabilities?.requiredScopes?.unban || 'scope Twitch requis'}`); return; } try { await transport.unbanTwitchUser(userId); $('unban-user-id').value = ''; note('UNBAN confirmé par Twitch.'); } catch (error) { note(error.message); } };

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch(() => undefined);
} else if (!window.isSecureContext) {
  note('Mode LAN HTTP : télécommande web disponible, installation PWA désactivée sans HTTPS.');
}
setInterval(tickTimer, 1000);
window.addEventListener('native-pairing', event => {
  const link = String(event.detail || '');
  if (legacyMode) {
    openCanonicalPairing(link);
    return;
  }
  $('pair-link').value = link;
  showPairing(true);
  void pair();
});
async function start() {
  credential = await credentialStorage.get();
  if (legacyMode) {
    $('pairing').hidden = true;
    $('forget-device').hidden = true;
    document.querySelector('[data-settings-target="pairing"]')?.remove();
    $('edit-server')?.remove();
  }
  if (isAndroidRuntime()) {
    void refreshProviderAccounts();
    $('android-options').hidden = false;
    $('pair-server').value = server;
    if (!server) { showPairing(true); setConnectionMode(resolveMode({ pcAvailable: false, internetAvailable: navigator.onLine })); render(offlineState()); return; }
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { ws?.close(); void connect(); }
      else if (state?.streamerPings?.length) {
        const pending = state.streamerPings.filter(value => !value.acknowledgedAt);
        notifyMobileStreamerPing(pending.at(-1), pending.length);
      }
    });
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
    try {
      const status = await adapter.status(provider);
      const auth = $(`${provider}-standalone-auth`);
      const logout = $(`${provider}-standalone-logout`);
      $(`${provider}-standalone-status`).textContent = status.configured ? (status.connected ? 'Connecté' : 'Déconnecté') : 'Indisponible dans cette version';
      auth.hidden = !status.configured;
      auth.disabled = !status.configured;
      logout.hidden = !status.connected;
    } catch {
      $(`${provider}-standalone-status`).textContent = 'Indisponible';
      $(`${provider}-standalone-auth`).hidden = true;
      $(`${provider}-standalone-logout`).hidden = true;
    }
  }
}
for (const provider of ['twitch','google']) {
  $(`${provider}-standalone-auth`).onclick=async()=>{try{await createNativeProviderAdapter().authorize(provider);note('Terminez l’autorisation dans le navigateur.');}catch(error){note(error.message);}};
  $(`${provider}-standalone-logout`).onclick=async()=>{await createNativeProviderAdapter().logout(provider);await refreshProviderAccounts();note(`${provider==='twitch'?'Twitch':'Google'} autonome déconnecté.`);};
}
window.addEventListener('provider-auth',()=>void refreshProviderAccounts());

if (fixtureName) {
  const fixture = createMobileFixture(fixtureName);
  setConnectionMode(CompanionMode.ONLINE_PC);
  soundboardState = fixture.soundboard;
  render(fixture.state);
  renderSoundboard();
  showPairing(false);
  if (previewMode) {
    const banner = document.createElement('div');
    banner.textContent = 'APERÇU · aucune commande réelle';
    Object.assign(banner.style, {
      position: 'fixed', top: '8px', left: '50%', transform: 'translateX(-50%)',
      zIndex: '9999', padding: '7px 12px', borderRadius: '999px',
      background: '#17111f', border: '1px solid #7c4dff', color: '#f2ecff',
      fontSize: '11px', fontWeight: '800', letterSpacing: '.08em',
      pointerEvents: 'none', boxShadow: '0 6px 24px rgba(0,0,0,.35)'
    });
    document.body.append(banner);
  }
} else void start();

// This is the only HTML bootstrap. Feature modules are loaded in a deterministic
// order after the canonical store/transport/controller have installed their owners.
void import('./features/templates.js')
  .then(() => import('./features/preparation.js'))
  .catch(error => note(`Initialisation mobile incomplète : ${error.message}`));
