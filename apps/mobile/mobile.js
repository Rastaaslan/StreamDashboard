import { isAndroidRuntime, nextRetry, normalizeServer, parsePairing } from './runtime.js';
import { credentialStorage, settingsStorage } from './storage.js';
import { createTransport, HttpError } from './transport.js';
import { DEFAULT_FILTERS, filterPlanning } from './planning-model.js';
import { normalizeCategoryQuery, rankCategories, rememberCategory } from './twitch-category.js';

const $ = id => document.getElementById(id);

let credential = '';
let server = settingsStorage.getServer();
let state = null;
let busy = false;
let ws = null;
let retry = 500;
let reconnectTimer = null;
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
  document.querySelectorAll('button[data-command],button[data-mode],button[data-chatting],button[data-media],button[data-mute],#stream,#export-planning')
    .forEach(button => { button.disabled = disabled; });
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
    container.append(row);
  }
  if (!container.children.length) container.append(text('p', 'Aucun rendez-vous.', 'muted'));
}

function render(next) {
  if (!next) return;
  state = next;
  $('pc').textContent = 'Connecté';
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
  $('slot-form').elements.twitch.disabled = !next.twitch?.connected;
  $('slot-form').elements.google.disabled = !next.google?.connected;
  renderDeck(next.obs.mediaInputs);
  renderPlanning(next.planning);
  $('timer').textContent = formatDuration(remaining());
  showPairing(false);
  remoteButtons(false);
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
  const next = await transport.state();
  render(next);
}

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
      $('pc').textContent = 'Hors ligne';
      remoteButtons(true);
      reconnectTimer = setTimeout(connect, retry);
      retry = nextRetry(retry);
    };
    ws.onerror = () => ws.close();
  } catch (error) {
    $('connection').textContent = 'Connexion refusée';
    $('pc').textContent = 'Hors ligne';
    remoteButtons(true);
    note(isAndroidRuntime() ? 'StreamDashboard est introuvable sur le réseau. Vérifie que Remote LAN est activé sur le PC.' : error.message);
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
    const next = await transport.createPlanning({ title: form.get('title'), startAtUtc, endAtUtc, category: form.get('category'), desiredPublication: { local: true, twitch: form.get('twitch') === 'on', google: form.get('google') === 'on' }, twitchCategoryId: form.get('twitch') === 'on' ? $('slot-twitch-game-id').value : undefined, twitchCategoryName: form.get('twitch') === 'on' ? $('slot-twitch-category').value : undefined });
    render(next); $('slot-dialog').close(); event.currentTarget.reset(); note('Créneau créé.');
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
    if (!server) { showPairing(true); $('connection').textContent = 'Aucun PC configuré'; return; }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { ws?.close(); void connect(); } });
  } else {
    $('server-label').hidden = true;
    $('link-label').hidden = true;
  }
  await connect();
}
void start();
