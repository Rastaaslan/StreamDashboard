import { isAndroidRuntime, nextRetry, normalizeServer, parsePairing } from './runtime.js';
import { credentialStorage, settingsStorage } from './storage.js';
import { createTransport, HttpError } from './transport.js';
import { DEFAULT_FILTERS, filterPlanning } from './planning-model.js';
import { normalizeCategoryQuery, rankCategories, rememberCategory } from './twitch-category.js';
import { CompanionMode, createCompanionStore, resolveMode } from './companion-store.js';

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
let deviceId = localStorage.getItem('streamdashboard.deviceId') || '';
let planningFilters = { ...DEFAULT_FILTERS };
const exportNoteKey = 'streamdashboard.exportNote';
try { planningFilters = { ...planningFilters, ...JSON.parse(localStorage.getItem('streamdashboard.planningFilters') || '{}') }; } catch { /* corrupted preferences reset safely */ }

const transport = createTransport(() => server, () => credential);
const note = value => { $('message').textContent = String(value || ''); };
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
    return;
  }
  busy = true;
  try {
    const body = await transport.command(value);
    render(body.state);
    globalThis.StreamDashboardNative?.haptic?.(['session.start', 'session.stop'].includes(value.type) ? 'strong' : 'light');
    note('Commande confirmée par le PC.');
  } catch (error) {
    note(error.message);
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

function renderPlanning(items) {
  const container = $('planning');
  container.replaceChildren();
  const sorted = filterPlanning(items, planningFilters);
  for (const item of sorted.slice(0, 8)) {
    const row = document.createElement('div');
    row.className = 'planning-row';
    row.append(text('b', item.title), text('span', formatPlanningDate(item)));
    if (companionMode !== CompanionMode.ONLINE_PC) {
      const status = text('small', '⏳ À synchroniser', 'pending');
      const edit = text('button', 'Modifier'); edit.type = 'button'; edit.onclick = () => { const title = prompt('Titre du live', item.title); if (!title || title === item.title) return; const result = companion.updateEvent(item.id, { title }, item.revision); if (result.conflict) note('Ce live a été modifié sur un autre appareil.'); else { render(offlineState()); note('Modification enregistrée · À synchroniser.'); } };
      const remove = text('button', 'Supprimer'); remove.type = 'button'; remove.onclick = () => { if (!confirm(`Supprimer « ${item.title} » ?`)) return; const result = companion.deleteEvent(item.id, item.revision); if (result.conflict) note('Ce live a été modifié sur un autre appareil.'); else { render(offlineState()); note('Suppression enregistrée · À synchroniser.'); } };
      row.append(status, edit, remove);
    }
    container.append(row);
  }
  if (!container.children.length) container.append(text('p', 'Aucun rendez-vous.', 'muted'));
}

function render(next) {
  if (!next) return;
  state = next;
  if (companionMode === CompanionMode.ONLINE_PC) $('pc').textContent = 'Connecté';
  $('obs').textContent = next.obs.connected ? 'Prêt' : 'Déconnecté';
  $('scene').textContent = next.obs.scene || '—';
  $('live').textContent = next.obs.streaming ? 'LIVE' : 'OFFLINE';
  $('live').className = next.obs.streaming ? 'ok' : '';
  $('next').textContent = next.nextLive ? `${next.nextLive.title} · ${formatPlanningDate(next.nextLive)}` : 'Aucun live planifié';
  $('stream').textContent = next.obs.streaming ? 'ARRÊTER LE LIVE' : 'DÉMARRER LE LIVE';
  renderAudio(next.obs.inputs, next.obs.activeAudioInputs);
  if (document.activeElement !== $('twitch-title')) $('twitch-title').value = next.twitch?.channelTitle || '';
  if (document.activeElement !== $('twitch-category')) $('twitch-category').value = next.twitch?.gameName || '';
  $('twitch-game-id').value = next.twitch?.gameId || '';
  $('twitch-editor').hidden = !next.twitch?.connected;
  renderDeck(next.obs.mediaInputs);
  renderPlanning(next.planning);
  $('timer').textContent = formatDuration(remaining());
  if (companionMode === CompanionMode.ONLINE_PC) showPairing(false);
  remoteButtons(companionMode !== CompanionMode.ONLINE_PC);
  $('stream').disabled = !next.obs.connected;
  const chattingActive = next.mode === 'live' && Boolean(next.settings.chattingScene) && next.obs.scene === next.settings.chattingScene;
  document.querySelectorAll('[data-mode]').forEach(button => {
    button.disabled = !next.obs.connected;
    button.classList.toggle('active', button.dataset.mode === next.mode && !(button.dataset.mode === 'live' && chattingActive));
  });
  document.querySelector('[data-chatting]').disabled = !next.obs.connected || !next.settings.chattingScene;
  document.querySelector('[data-chatting]').classList.toggle('active', chattingActive);
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
    const count = await exportPlanningImage(state.planning, state.settings.streamerName, { filters: planningFilters, period: $('export-period').value, noteEnabled: $('export-note-enabled').checked, noteText: $('export-note-text').value });
    note(`Image du planning prête · ${count} live${count > 1 ? 's' : ''}.`);
  } catch (error) {
    if (error?.name !== 'AbortError') note(error.message);
  }
};
$('edit-server').onclick = () => { showPairing(true); $('pair-server').focus(); };
$('keep-awake').onchange = () => globalThis.StreamDashboardNative?.setKeepAwake?.($('keep-awake').checked);

const selectTab = tab => {
  document.querySelectorAll('[data-view]').forEach(view => view.classList.toggle('active', view.dataset.view === tab));
  document.querySelectorAll('[data-tab]').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
  localStorage.setItem('streamdashboard.mobileTab', tab);
};
document.querySelector('.bottom-nav').onclick = event => { const button = event.target.closest('[data-tab]'); if (button) selectTab(button.dataset.tab); };
selectTab(localStorage.getItem('streamdashboard.mobileTab') || 'live');
try { const saved = JSON.parse(localStorage.getItem(exportNoteKey) || '{}'); $('export-note-enabled').checked = saved.enabled === true; if (saved.text) $('export-note-text').value = saved.text; } catch { /* reset invalid preference */ }
const saveExportNote = () => localStorage.setItem(exportNoteKey, JSON.stringify({ enabled: $('export-note-enabled').checked, text: $('export-note-text').value }));
$('export-note-enabled').onchange = saveExportNote; $('export-note-text').onchange = saveExportNote;

const filterNames = { twitch: 'Twitch', google: 'Google', allDay: 'Journée entière', live: 'Live', personal: 'Personnel', production: 'Production' };
$('planning-filters').className = 'filters';
for (const [key, label] of Object.entries(filterNames)) {
  const input = document.createElement('input'); input.type = 'checkbox'; input.checked = planningFilters[key];
  input.onchange = () => { planningFilters[key] = input.checked; localStorage.setItem('streamdashboard.planningFilters', JSON.stringify(planningFilters)); renderPlanning(state?.planning); };
  const row = document.createElement('label'); row.append(input, text('span', label)); $('planning-filters').append(row);
}
$('add-slot').onclick = () => $('slot-dialog').showModal();
$('close-slot').onclick = () => $('slot-dialog').close();
$('slot-form').onsubmit = async event => {
  event.preventDefault(); const form = new FormData(event.currentTarget);
  const date = form.get('date'); const startAtUtc = new Date(`${date}T${form.get('start')}`).toISOString(); const endAtUtc = new Date(`${date}T${form.get('end')}`).toISOString();
  try {
    if (form.get('twitch') === 'on' && !$('slot-twitch-game-id').value) throw new Error('Sélectionnez une catégorie Twitch officielle.');
    const value = { title: form.get('title'), startAtUtc, endAtUtc, category: form.get('category'), description: form.get('description') || '', desiredPublication: { local: false, twitch: form.get('twitch') === 'on', google: form.get('google') === 'on' }, twitchCategoryId: form.get('twitch') === 'on' ? $('slot-twitch-game-id').value : undefined, twitchCategoryName: form.get('twitch') === 'on' ? $('slot-twitch-category').value : undefined };
    if (companionMode === CompanionMode.ONLINE_PC) { const next = await transport.createPlanning(value); companion.replaceServerSnapshot(next); render(next); }
    else { companion.createEvent(value); render(offlineState()); }
    $('slot-dialog').close(); event.currentTarget.reset(); note(companionMode === CompanionMode.ONLINE_PC ? 'Créneau créé.' : 'Créneau enregistré · À synchroniser.');
  } catch (error) { note(error.message); }
};

const recentKey = 'streamdashboard.recentTwitchCategories';
let recentCategories = [];
try { recentCategories = JSON.parse(localStorage.getItem(recentKey) || '[]').slice(0, 8); } catch { /* reset invalid history */ }
function attachCategoryPicker(inputId, gameIdId, resultsId) {
  const input = $(inputId), gameId = $(gameIdId), results = $(resultsId); let timer; let generation = 0;
  const show = items => { results.replaceChildren(...items.map(item => { const button = text('button', item.name); button.type='button'; button.dataset.gameId=item.id; button.dataset.gameName=item.name; return button; })); };
  input.onfocus = () => { if (!input.value.trim()) show(recentCategories); };
  input.oninput = () => { gameId.value=''; clearTimeout(timer); const query=normalizeCategoryQuery(input.value); const request=++generation; if(query.length<2){show(query?[]:recentCategories);return;} results.replaceChildren(text('p','Recherche…','muted')); timer=setTimeout(async()=>{try{const found=await transport.searchTwitch(query);if(request!==generation)return;const ranked=rankCategories(found,recentCategories,query);show(ranked);if(!ranked.length)results.append(text('p','Aucune catégorie trouvée.','muted'));}catch(error){if(request===generation)results.replaceChildren(text('p',error.message,'danger'));}},300); };
  results.onclick = event => { const button=event.target.closest('[data-game-id]');if(!button)return;gameId.value=button.dataset.gameId;input.value=button.dataset.gameName;recentCategories=rememberCategory(recentCategories,{id:button.dataset.gameId,name:button.dataset.gameName});localStorage.setItem(recentKey,JSON.stringify(recentCategories));results.replaceChildren(); };
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

function renderCompanion() {
  const cache = companion.snapshot();
  const draw = (id, values, label) => { const root = $(id); root.replaceChildren(...values.map(item => { const row = document.createElement('div'); row.className = 'companion-row'; row.append(text('span', label(item))); const remove = text('button', 'Supprimer'); remove.type = 'button'; remove.onclick = () => { companion.removeCollection(id, item.id); renderCompanion(); }; row.append(remove); return row; })); };
  draw('notes', cache.notes, item => item.text); draw('templates', cache.templates, item => item.title); draw('checklist', cache.checklist, item => `${item.done ? '✓' : '○'} ${item.label}`);
}
for (const [buttonId, kind, inputId, property] of [['add-note','notes','note-text','text'],['add-template','templates','template-title','title'],['add-check','checklist','check-label','label']]) $(buttonId).onclick = () => { const input = $(inputId); if (!input.value.trim()) return; companion.upsertCollection(kind, { [property]: input.value.trim(), ...(kind === 'checklist' ? { done: false } : {}) }); input.value = ''; renderCompanion(); note('Enregistré localement · À synchroniser.'); };
renderCompanion();
void start();
