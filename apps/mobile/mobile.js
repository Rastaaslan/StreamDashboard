import { isAndroidRuntime, nextRetry, normalizeServer, parsePairing } from './runtime.js';
import { credentialStorage, settingsStorage } from './storage.js';
import { createTransport, HttpError } from './transport.js';

const $ = id => document.getElementById(id);

let credential = '';
let server = settingsStorage.getServer();
let state = null;
let busy = false;
let ws = null;
let retry = 500;
let reconnectTimer = null;

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
  document.querySelectorAll('button[data-command],button[data-mode],button[data-media],button[data-mute],#stream,#export-planning')
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

function renderAudio(inputs) {
  const container = $('audio');
  container.replaceChildren();
  for (const [name, input] of Object.entries(inputs || {})) {
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
  const sorted = [...(items || [])].sort((left, right) => Date.parse(left.startAtUtc) - Date.parse(right.startAtUtc));
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
  renderAudio(next.obs.inputs);
  renderDeck(next.obs.mediaInputs);
  renderPlanning(next.planning);
  $('timer').textContent = formatDuration(remaining());
  showPairing(false);
  remoteButtons(false);
  $('stream').disabled = !next.obs.connected;
  document.querySelectorAll('[data-mode]').forEach(button => {
    button.disabled = !next.obs.connected;
    button.classList.toggle('active', button.dataset.mode === next.mode);
  });
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
    const count = await exportPlanningImage(state.planning, state.settings.streamerName);
    note(`Image du planning prête · ${count} live${count > 1 ? 's' : ''}.`);
  } catch (error) {
    if (error?.name !== 'AbortError') note(error.message);
  }
};
$('edit-server').onclick = () => { showPairing(true); $('pair-server').focus(); };
$('keep-awake').onchange = () => globalThis.StreamDashboardNative?.setKeepAwake?.($('keep-awake').checked);

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
