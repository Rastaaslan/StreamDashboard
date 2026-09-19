import { createTransport, CRITICAL_COMMAND_TIMEOUT_MS, HttpError } from './transport.js';
import { createCommandController, acceptsSnapshot } from './command-controller.js';
import { isAndroidRuntime, nextRetry, normalizeServer } from './runtime.js';
import { credentialStorage, settingsStorage } from './storage.js';

const $ = selector => document.querySelector(selector);
const $ = selector => [...document.querySelectorAll(selector)];
const productionUi = new URLSearchParams(location.search).get('runtime') === '1';

let state = null;
let soundboard = null;
let credential = '';
let server = settingsStorage.getServer();
let ws = null;
let reconnectTimer = null;
let retry = 500;
let httpReady = false;
let pairing = false;
let activeStreamerPingId = null;
const notifiedStreamerPingIds = new Set();

const quickSoundStorageKey = 'streamdashboard.preview.quickSoundSelections';
let quickSoundSelections = [];
try {
  const saved = JSON.parse(localStorage.getItem(quickSoundStorageKey) || '[]');
  if (Array.isArray(saved)) quickSoundSelections = saved.filter(item => item && typeof item.soundId === 'string' && typeof item.category === 'string');
} catch {}
let quickSoundCategory = '';

const newCommandId = () => globalThis.crypto?.randomUUID?.() || `cmd_${Date.now()}_${Math.random().toString(36).slice(2)}`;
const transport = createTransport(() => server, () => credential);

const toast = message => {
  const node = $('#toast');
  node.textContent = String(message || '');
  node.classList.toggle('show', Boolean(message));
  clearTimeout(toast.timer);
  if (message) toast.timer = setTimeout(() => node.classList.remove('show'), 2300);
};

const commandController = createCommandController({
  send: (value, options) => transport.command(value, options),
  readState: () => transport.state(),
  applyState: next => applyState(next),
  onMessage: toast,
});

const go = target => {
  $$('.screen').forEach(screen => screen.classList.toggle('active', screen.dataset.screen === target));
  $$('[data-nav]').forEach(button => button.classList.toggle('active', button.dataset.nav === target));
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

const formatDuration = seconds => {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${String(Math.floor(value / 3600)).padStart(2, '0')}:${String(Math.floor(value / 60) % 60).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
};
const timerRemaining = () => {
  if (!state?.timer) return 0;
  if (state.timer.running && state.timer.deadline) {
    const raw = state.timer.deadline;
    const deadline = typeof raw === 'number' ? raw : Date.parse(raw);
    if (Number.isFinite(deadline)) return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  }
  return Math.max(0, Number(state.timer.remaining) || 0);
};
const formatTimer = seconds => {
  const value = Math.max(0, Math.floor(seconds || 0));
  return `${String(Math.floor(value / 60)).padStart(2,'0')}:${String(value % 60).padStart(2,'0')}`;
};
const providerCopy = status => ({
  CONNECTED: ['Connecté', 'good'],
  CONNECTING: ['Connexion…', 'warn'],
  DEGRADED: ['Instable', 'warn'],
  ERROR: ['Erreur', 'bad'],
  NOT_CONFIGURED: ['Non configuré', 'muted'],
  DISCONNECTED: ['Déconnecté', 'bad'],
})[status] || ['Indisponible', 'muted'];

const setProvider = (id, status) => {
  const node = $(id);
  if (!node) return;
  const [copy, cls] = providerCopy(status);
  node.textContent = copy;
  node.className = cls;
};

const logicalScene = next => {
  const actual = next?.obs?.scene;
  if (!actual) return '';
  if (next.settings?.chattingScene === actual) return 'Chatting';
  const modes = next.settings?.modeScenes || {};
  if (modes.intro === actual) return 'Intro';
  if (modes.live === actual) return 'Gameplay';
  if (modes.pause === actual) return 'Pause';
  if (modes.end === actual) return 'Fin';
  return actual;
};

const selectSceneVisual = scene => {
  $$('[data-scene]').forEach(item => item.classList.toggle('selected', item.dataset.scene === scene));
};

const renderChat = messages => {
  const host = $('#home-chat-preview');
  if (!host) return;
  const recent = Array.isArray(messages) ? messages.slice(-2) : [];
  host.replaceChildren();
  for (const message of recent) {
    const row = document.createElement('p');
    const name = document.createElement('b');
    const copy = document.createElement('span');
    name.textContent = message.chatter?.displayName || message.chatter?.login || 'Twitch';
    copy.textContent = message.text || '';
    row.append(name, copy);
    host.append(row);
  }
  if (!recent.length) {
    const row = document.createElement('p');
    const name = document.createElement('b');
    const copy = document.createElement('span');
    name.textContent = 'Chat';
    copy.textContent = httpReady ? 'Aucun message récent.' : 'Connexion PC requise.';
    row.append(name, copy);
    host.append(row);
  }
};

const renderAudio = next => {
  const rows = $$('[data-audio]');
  const inputs = next?.obs?.inputs || {};
  const active = Array.isArray(next?.obs?.activeAudioInputs) ? next.obs.activeAudioInputs : Object.keys(inputs);
  const ordered = [...active].filter(name => inputs[name]).slice(0, rows.length);
  rows.forEach((row, index) => {
    const name = ordered[index];
    row.hidden = !name;
    if (!name) return;
    const input = inputs[name];
    row.dataset.input = name;
    row.querySelector('b').textContent = name;
    const db = Number.isFinite(input.volumeDb) ? input.volumeDb : -100;
    row.querySelector('small').textContent = db <= -99 ? '-∞ dB' : `${db.toFixed(1)} dB`;
    row.classList.toggle('on', !input.muted);
    row.classList.toggle('muted', Boolean(input.muted));
    const meter = row.querySelector('.meter i');
    if (meter) meter.style.width = `${Math.max(4, Math.min(100, ((db + 60) / 66) * 100))}%`;
  });
};

const renderPlanning = items => {
  const agenda = $('#agenda');
  if (!agenda) return;
  const now = new Date();
  const future = (Array.isArray(items) ? items : [])
    .filter(item => Number.isFinite(Date.parse(item.startAtUtc)) && Date.parse(item.endAtUtc || item.startAtUtc) >= now.getTime())
    .sort((a,b) => Date.parse(a.startAtUtc) - Date.parse(b.startAtUtc))
    .slice(0, 8);
  agenda.replaceChildren();
  if (!future.length) {
    const label = document.createElement('div');
    label.className = 'agenda-label';
    label.innerHTML = '<span>À VENIR</span><i></i>';
    const empty = document.createElement('article');
    empty.className = 'event-card';
    empty.innerHTML = '<div class="event-time"><b>—</b></div><div><small>PLANNING</small><h2>Aucun événement à venir</h2><p>Ajoute ton prochain live.</p></div><span class="event-dot"></span>';
    agenda.append(label, empty);
    return;
  }
  let previousDay = '';
  for (const item of future) {
    const start = new Date(item.startAtUtc);
    const dayKey = start.toISOString().slice(0,10);
    if (dayKey !== previousDay) {
      previousDay = dayKey;
      const label = document.createElement('div');
      label.className = 'agenda-label';
      const sameDay = start.toDateString() === now.toDateString();
      const tomorrow = new Date(now); tomorrow.setDate(now.getDate()+1);
      const isTomorrow = start.toDateString() === tomorrow.toDateString();
      label.innerHTML = `<span></span><i></i>`;
      label.querySelector('span').textContent = sameDay ? 'AUJOURD’HUI' : isTomorrow ? 'DEMAIN' : start.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'short'}).toUpperCase();
      agenda.append(label);
    }
    const end = new Date(item.endAtUtc || item.startAtUtc);
    const card = document.createElement('article');
    card.className = `event-card${item.category === 'live' ? ' live-event' : item.category === 'personal' ? ' personal' : ''}`;
    const time = document.createElement('div'); time.className = 'event-time';
    const sb = document.createElement('b'); sb.textContent = start.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
    const ss = document.createElement('span'); ss.textContent = `→ ${end.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}`;
    time.append(sb,ss);
    const body = document.createElement('div');
    const kind = document.createElement('small'); kind.textContent = item.category === 'live' ? 'LIVE TWITCH' : item.category === 'personal' ? 'PERSO' : 'PRODUCTION';
    const title = document.createElement('h2'); title.textContent = item.title || 'Événement';
    const desc = document.createElement('p'); desc.textContent = item.twitchCategoryName || item.description || '';
    body.append(kind,title,desc);
    const dot = document.createElement('span'); dot.className='event-dot';
    card.append(time,body,dot);
    agenda.append(card);
  }
};

const applyState = next => {
  if (!next || (state && !acceptsSnapshot(state, next))) return;
  state = next;
  const hub = next.controlHub || {};
  const isLive = hub.live?.isLive === true || next.obs?.streaming === true;
  const duration = Number.isFinite(hub.live?.durationSeconds) ? hub.live.durationSeconds : 0;
  const title = hub.live?.title || next.twitch?.channelTitle || (isLive ? 'Live en cours' : 'Prêt à streamer');
  const category = hub.live?.category || next.twitch?.gameName || (isLive ? 'Twitch' : 'Aucun live en cours');
  const viewers = Number.isInteger(hub.audience?.viewerCount) ? hub.audience.viewerCount : '—';
  const chatters = Array.isArray(hub.audience?.chatters) ? hub.audience.chatters.length : '—';
  const actualScene = next.obs?.scene || '—';
  const logical = logicalScene(next);

  $('#home-live-copy').textContent = isLive ? 'En direct' : 'Prêt';
  $('#home-live-pill').classList.toggle('live', isLive);
  $('#home-live-pill').classList.toggle('offline', !isLive);
  $('#home-duration').textContent = isLive ? formatDuration(duration) : '—';
  $('#home-title').textContent = title;
  $('#home-category').textContent = category;
  $('#home-viewers').textContent = String(viewers);
  $('#home-chatters').textContent = String(chatters);
  $('#home-scene-name').textContent = actualScene;

  $('#live-status-copy').textContent = isLive ? formatDuration(duration) : 'Prêt';
  $('#live-status-pill').classList.toggle('live', isLive);
  $('#live-status-pill').classList.toggle('offline', !isLive);
  $('#scene-name').textContent = actualScene;
  $('#scene-state').textContent = next.obs?.connected ? 'OBS OK' : 'OBS HORS LIGNE';
  $('#scene-state').classList.toggle('offline', !next.obs?.connected);
  selectSceneVisual(logical);

  const integrations = hub.integrations || {};
  setProvider('#status-obs', integrations.obs?.status || (next.obs?.connected ? 'CONNECTED' : 'DISCONNECTED'));
  setProvider('#status-twitch', integrations.twitch?.status || (next.twitch?.connected ? 'CONNECTED' : 'DISCONNECTED'));
  setProvider('#status-streamlabs', integrations.streamlabs?.status || 'NOT_CONFIGURED');
  renderChat(hub.chat?.messages || []);
  renderAudio(next);
  renderPlanning(next.planning);
  $('#timer-value').textContent = formatTimer(timerRemaining());
  syncStreamerPings(next.streamerPings || []);

  const stop = $('#stop-live');
  stop.textContent = isLive ? '■ Arrêter le live' : '▶ Démarrer le live';
  stop.classList.toggle('danger-outline', isLive);
  stop.classList.toggle('live-command', !isLive);
  stop.classList.toggle('start', !isLive);
  stop.dataset.action = isLive ? 'stop' : 'start';
};

const notifyStreamerPing = (ping, pendingCount) => {
  if (!productionUi || !document.hidden || !ping || notifiedStreamerPingIds.has(ping.id)) return;
  notifiedStreamerPingIds.add(ping.id);
  const message = `${ping.userName || 'Viewer'} · ${ping.rewardCost || 0} points${pendingCount > 1 ? ` · ${pendingCount} pings en attente` : ''}`;
  globalThis.StreamDashboardNative?.notifyStreamerPing?.(ping.id, ping.rewardTitle || 'Streamer Ping', message);
};

const syncStreamerPings = pings => {
  const pending = (Array.isArray(pings) ? pings : []).filter(value => !value.acknowledgedAt);
  const ping = pending[0];
  const dialog = $('#streamer-ping-dialog');
  if (!dialog) return;
  if (!ping) {
    activeStreamerPingId = null;
    if (dialog.open) dialog.close();
    return;
  }
  notifyStreamerPing(pending.at(-1), pending.length);
  const content = $('#streamer-ping-content');
  if (activeStreamerPingId !== ping.id || !dialog.open) {
    activeStreamerPingId = ping.id;
    content.replaceChildren();
    const label = document.createElement('small'); label.className = 'eyebrow'; label.textContent = `STREAMER PING · 1/${pending.length}`;
    const title = document.createElement('h2'); title.textContent = ping.rewardTitle || 'Récompense Twitch';
    const copy = document.createElement('p'); copy.textContent = `${ping.userName || 'Viewer'} a utilisé cette récompense${ping.rewardCost ? ` · ${ping.rewardCost} points` : ''}.`;
    content.append(label, title, copy);
    if (ping.userInput) { const quote = document.createElement('blockquote'); quote.textContent = ping.userInput; content.append(quote); }
    globalThis.StreamDashboardNative?.haptic?.('strong');
    if (!dialog.open) dialog.showModal();
  } else {
    const label = content.querySelector('.eyebrow'); if (label) label.textContent = `STREAMER PING · 1/${pending.length}`;
  }
};

const openLegacyTools = button => {
  const tab = button.dataset.legacyTab || 'more';
  localStorage.setItem('streamdashboard.mobileTab', tab);
  if (button.dataset.legacyPrepare) localStorage.setItem('streamdashboard.mobilePreparationTab', button.dataset.legacyPrepare);
  localStorage.setItem('streamdashboard.legacyTarget', JSON.stringify({
    tab,
    prepare: button.dataset.legacyPrepare || '',
    settings: button.dataset.legacySettings || '',
    liveTool: button.dataset.legacyLiveTool || '',
    action: button.dataset.legacyAction || '',
  }));
  location.href = './index.html?legacy=1';
};

const renderConnection = (copy, mode='offline') => {
  $('#connection-copy').textContent = copy;
  $('#sounds-pc-copy').textContent = copy;
  const pill=$('#sounds-pc-pill');
  pill.classList.toggle('live', mode==='online');
  pill.classList.toggle('offline', mode==='offline');
  pill.classList.toggle('degraded', mode==='degraded');
};

const requireConnection = () => {
  if (httpReady && credential) return true;
  toast('Appairage PC requis.');
  $('#connection-dialog').showModal();
  return false;
};

const execute = async (payload,{resource=payload.type,reconcile,critical=false}={}) => {
  if(!requireConnection()) return false;
  const commandId=newCommandId();
  try{
    const result=await commandController.execute({...payload,commandId,correlationId:commandId},{
      resource,
      timeoutMs:critical?CRITICAL_COMMAND_TIMEOUT_MS:undefined,
      reconcile,
    });
    if(!result.accepted){toast('Commande déjà en cours.');return false;}
    globalThis.StreamDashboardNative?.haptic?.(critical?'strong':'light');
    if(!result.reconciled) toast('Commande confirmée.');
    return true;
  }catch(error){toast(error.message);return false;}
};

const scenePayload = scene => ({
  Intro:{type:'mode.set',mode:'intro'},
  Gameplay:{type:'mode.set',mode:'live'},
  Chatting:{type:'scene.chatting'},
  Pause:{type:'mode.set',mode:'pause'},
  Fin:{type:'mode.set',mode:'end'},
})[scene];

const selectScene = async scene => {
  const payload=scenePayload(scene);
  if(!payload) return;
  await execute(payload,{resource:'scene'});
};

const loadSoundboard = async () => {
  if(!httpReady || !credential) return;
  try{
    soundboard=await transport.soundboard();
    const available=(soundboard.sounds||[]).filter(sound=>sound.enabled&&sound.sourceAvailable);
    if(!quickSoundSelections.length&&available.length){
      const defaults=[...available.filter(sound=>sound.favorite),...available.filter(sound=>!sound.favorite)].slice(0,4);
      quickSoundSelections=defaults.map(sound=>({soundId:sound.id,category:sound.category||'Sans catégorie'}));
      localStorage.setItem(quickSoundStorageKey,JSON.stringify(quickSoundSelections));
    }
    renderQuickSounds();
    renderFullSoundboard();
    populateSoundChoice();
  }catch(error){toast(`Soundboard : ${error.message}`);}
};

const soundById=id=>(soundboard?.sounds||[]).find(sound=>sound.id===id);
const playSound=async sound=>{
  if(!requireConnection()) return;
  const commandId=newCommandId();
  try{
    const ack=await transport.playSound({commandId,correlationId:commandId,soundId:sound.id,issuedAt:new Date().toISOString()});
    if(ack.status!=='succeeded') throw new Error(ack.message||ack.errorCode||'Lecture échouée.');
    globalThis.StreamDashboardNative?.haptic?.('light');
    toast(`${sound.name} ✓`);
    await loadSoundboard();
  }catch(error){toast(error.message);}
};

const renderQuickSounds=()=>{
  const categoryHost=$('#quick-sound-categories'),soundHost=$('#quick-sound-grid');
  if(!categoryHost||!soundHost) return;
  const resolved=quickSoundSelections.map(item=>({...item,sound:soundById(item.soundId)})).filter(item=>item.sound);
  const categories=[...new Set(resolved.map(item=>item.category))];
  if(!categories.includes(quickSoundCategory)) quickSoundCategory=categories[0]||'';
  categoryHost.replaceChildren(...categories.map(category=>{
    const button=document.createElement('button');button.type='button';button.textContent=category;
    button.classList.toggle('active',category===quickSoundCategory);
    button.onclick=()=>{quickSoundCategory=category;renderQuickSounds();};
    return button;
  }));
  soundHost.replaceChildren();
  for(const item of resolved.filter(item=>item.category===quickSoundCategory)){
    const button=document.createElement('button');button.type='button';button.className='quick-sound-button';
    const name=document.createElement('b');name.textContent=item.sound.name;
    const cat=document.createElement('small');cat.textContent=item.category;
    const glyph=document.createElement('span');glyph.className='sound-glyph';glyph.textContent='♫';
    button.append(name,cat,glyph);button.onclick=()=>void playSound(item.sound);soundHost.append(button);
  }
  if(!soundHost.children.length){
    const empty=document.createElement('div');empty.className='quick-sound-empty';
    empty.textContent=httpReady?'Ajoute un son rapide depuis ta bibliothèque.':'Appaire le PC pour charger tes sons.';
    soundHost.append(empty);
  }
};

let fullSoundFilter='all';
const renderFullSoundboard=()=>{
  const host=$('#sound-grid');if(!host) return;
  const query=$('#sound-search').value.trim().toLowerCase();
  const sounds=(soundboard?.sounds||[]).filter(sound=>{
    if(query&&!sound.name.toLowerCase().includes(query)) return false;
    if(fullSoundFilter==='fav'&&!sound.favorite) return false;
    if(fullSoundFilter!=='all'&&fullSoundFilter!=='fav'&&String(sound.category||'').toLowerCase()!==fullSoundFilter) return false;
    return true;
  });
  host.replaceChildren();
  for(const sound of sounds){
    const pad=document.createElement('button');pad.type='button';pad.className=`sound-pad${sound.favorite?' favorite':''}`;
    pad.disabled=!sound.enabled||!sound.sourceAvailable;
    const star=document.createElement('span');star.textContent=sound.favorite?'★':'☆';
    const name=document.createElement('b');name.textContent=sound.name;
    const cat=document.createElement('small');cat.textContent=sound.category||'Sans catégorie';
    pad.append(star,name,cat);
    star.onclick=async event=>{
      event.stopPropagation();
      if(!requireConnection()) return;
      try{soundboard=await transport.updateSound(sound.id,{favorite:!sound.favorite});renderFullSoundboard();}catch(error){toast(error.message);}
    };
    pad.onclick=()=>void playSound(sound);host.append(pad);
  }
  if(!host.children.length){
    const empty=document.createElement('div');empty.className='quick-sound-empty';
    empty.textContent=httpReady?'Aucun son ne correspond.':'Appaire le PC pour charger le Soundboard.';
    host.append(empty);
  }
  renderSoundFilterChips();
};

const renderSoundFilterChips=()=>{
  const host=$('#sound-filters');if(!host) return;
  const categories=[...new Set((soundboard?.sounds||[]).map(sound=>sound.category).filter(Boolean))];
  const filters=[['all','Tout'],['fav','Favoris'],...categories.map(category=>[category.toLowerCase(),category])];
  host.replaceChildren(...filters.map(([value,label])=>{
    const button=document.createElement('button');button.type='button';button.dataset.filter=value;button.textContent=label;
    button.classList.toggle('active',fullSoundFilter===value);
    button.onclick=()=>{fullSoundFilter=value;renderFullSoundboard();};
    return button;
  }));
};

const populateSoundChoice=()=>{
  const select=$('#quick-sound-choice');if(!select) return;
  const sounds=(soundboard?.sounds||[]).filter(sound=>sound.enabled&&sound.sourceAvailable);
  select.replaceChildren(...sounds.map(sound=>new Option(`${sound.name} · ${sound.category||'Sans catégorie'}`,sound.id)));
  select.disabled=!sounds.length;
  if(sounds[0]) $('#quick-sound-category').value=sounds[0].category||'Sans catégorie';
};

const connectRealtime=async()=>{
  try{
    const {ticket}=await transport.ticket();
    ws?.close();
    ws=transport.websocket(ticket);
    ws.onopen=()=>{retry=500;renderConnection('PC connecté','online');};
    ws.onmessage=event=>{try{const value=JSON.parse(event.data);if(value.type==='state.updated')applyState(value.data);}catch{}};
    ws.onclose=()=>{
      if(httpReady) renderConnection('PC connecté · temps réel…','degraded');
      reconnectTimer=setTimeout(()=>void probeAndConnect(),retry);retry=nextRetry(retry);
    };
    ws.onerror=()=>ws.close();
  }catch(error){
    renderConnection('PC connecté · temps réel indisponible','degraded');
    reconnectTimer=setTimeout(()=>void probeAndConnect(),retry);retry=nextRetry(retry);
  }
};

const probeAndConnect=async()=>{
  clearTimeout(reconnectTimer);
  if(!credential){httpReady=false;renderConnection('PC non appairé','offline');return;}
  try{
    const next=await transport.state();
    httpReady=true;retry=500;applyState(next);renderConnection('PC connecté','online');
    await loadSoundboard();
    void connectRealtime();
  }catch(error){
    httpReady=false;renderConnection('PC hors ligne','offline');
    if(error instanceof HttpError&&[401,403].includes(error.status)){
      credential='';await credentialStorage.clear();toast('Télécommande révoquée. Nouvel appairage requis.');$('#connection-dialog').showModal();return;
    }
    reconnectTimer=setTimeout(()=>void probeAndConnect(),retry);retry=nextRetry(retry);
  }
};

const pair=async event=>{
  event.preventDefault();if(pairing)return;pairing=true;
  const hint=$('#connection-hint');hint.classList.remove('error');hint.textContent='Appairage en cours…';
  try{
    server=isAndroidRuntime()?normalizeServer($('#pair-server').value):settingsStorage.getServer();
    if(isAndroidRuntime()) settingsStorage.setServer(server);
    const id=$('#pair-id').value.trim(),code=$('#pair-code').value.trim(),name=$('#pair-name').value.trim()||'Android Preview';
    if(!id||!code) throw new Error('ID et code requis.');
    const result=await transport.pair({id,code,name});
    credential=result.credential;await credentialStorage.set(credential);
    if(result.deviceId)localStorage.setItem('streamdashboard.deviceId',result.deviceId);
    $('#pair-code').value='';hint.textContent='Appairage réussi.';$('#connection-dialog').close();
    await probeAndConnect();
  }catch(error){hint.classList.add('error');hint.textContent=error.message;}
  finally{pairing=false;}
};

$$('[data-nav]').forEach(button=>button.addEventListener('click',()=>go(button.dataset.nav)));
$$('[data-go]').forEach(button=>button.addEventListener('click',()=>go(button.dataset.go)));
$('#open-camp').onclick=()=>{$('#camp-sheet').hidden=false;};
$$('[data-close-camp]').forEach(button=>button.onclick=()=>{$('#camp-sheet').hidden=true;});
$$('[data-scene]').forEach(button=>button.onclick=()=>void selectScene(button.dataset.scene));

$$('[data-audio]').forEach(row=>row.onclick=()=>{
  const input=row.dataset.input;if(!input||!state?.obs?.inputs?.[input])return;
  void execute({type:'obs.mute',input,muted:!state.obs.inputs[input].muted},{resource:`audio:${input}`,reconcile:next=>next.obs?.inputs?.[input]?.muted===!state.obs.inputs[input].muted});
});

$$('[data-timer]').forEach(button=>button.onclick=()=>void execute({type:'timer.add',seconds:Number(button.dataset.timer)},{resource:'timer'}));
$('#timer-toggle').onclick=()=>void execute({type:state?.timer?.running?'timer.pause':'timer.start'},{resource:'timer'});
setInterval(()=>{if(state)$('#timer-value').textContent=formatTimer(timerRemaining());},1000);

$('#stop-live').onclick=async()=>{
  if(!requireConnection())return;
  const live=state?.controlHub?.live?.isLive===true||state?.obs?.streaming===true;
  if(live){
    if(!confirm('Arrêter réellement le live ?'))return;
    await execute({type:'session.stop'},{resource:'stream',critical:true,reconcile:next=>next.obs?.streaming===false});
    return;
  }
  if(!confirm('Démarrer réellement le live ?'))return;
  const prepared=await execute({type:'session.prepare'},{resource:'stream'});
  if(!prepared)return;
  const bypass=state?.preflight?.status==='action-required';
  if(bypass&&!confirm('La checklist demande une action. Démarrer quand même ?'))return;
  await execute({type:'session.start',force:bypass},{resource:'stream',critical:true,reconcile:next=>next.obs?.streaming===true});
};

$('#sound-search').oninput=renderFullSoundboard;
$('#add-quick-sound').onclick=()=>{if(!requireConnection())return;populateSoundChoice();$('#quick-sound-dialog').showModal();};
$('#close-quick-sound').onclick=()=>$('#quick-sound-dialog').close();
$('#cancel-quick-sound').onclick=()=>$('#quick-sound-dialog').close();
$('#quick-sound-choice').onchange=()=>{
  const sound=soundById($('#quick-sound-choice').value);
  if(sound)$('#quick-sound-category').value=sound.category||'Sans catégorie';
};
$('#quick-sound-form').onsubmit=event=>{
  event.preventDefault();
  const soundId=$('#quick-sound-choice').value,category=$('#quick-sound-category').value.trim()||'Sans catégorie';
  if(!soundId)return;
  quickSoundSelections=[...quickSoundSelections.filter(item=>item.soundId!==soundId),{soundId,category}];
  quickSoundCategory=category;localStorage.setItem(quickSoundStorageKey,JSON.stringify(quickSoundSelections));
  renderQuickSounds();$('#quick-sound-dialog').close();toast('Son rapide ajouté.');
};

$('[data-legacy-tab]').forEach(button => button.onclick = () => openLegacyTools(button));
$('#open-connection').onclick=()=>{$('#camp-sheet').hidden=true;$('#pair-server').value=server||'';$('#connection-dialog').showModal();};
$('#close-connection').onclick=()=>$('#connection-dialog').close();
$('#connection-form').onsubmit=pair;
$('#forget-connection').onclick=async()=>{
  credential='';httpReady=false;ws?.close();await credentialStorage.clear();settingsStorage.setServer('');server='';
  renderConnection('PC non appairé','offline');toast('Connexion locale oubliée.');
};

$('#streamer-ping-ack').onclick = async () => {
  const id = activeStreamerPingId;
  if (!id || !requireConnection()) return;
  try {
    const next = await transport.acknowledgeStreamerPing(id);
    activeStreamerPingId = null;
    if ($('#streamer-ping-dialog').open) $('#streamer-ping-dialog').close();
    applyState(next);
    toast('Streamer Ping acquitté.');
  } catch (error) { toast(error.message); }
};

$('#add-event').onclick=()=>{
  if(!requireConnection())return;
  const date=new Date();$('#event-date').value=date.toISOString().slice(0,10);$('#event-dialog').showModal();
};
$('#close-event').onclick=()=>$('#event-dialog').close();
$('#cancel-event').onclick=()=>$('#event-dialog').close();
$('#event-form').onsubmit=async event=>{
  event.preventDefault();if(!requireConnection())return;
  const date=$('#event-date').value,start=$('#event-start').value,end=$('#event-end').value;
  try{
    const startAtUtc=new Date(`${date}T${start}`).toISOString();
    let endDate=new Date(`${date}T${end}`);
    if(endDate.getTime()<=Date.parse(startAtUtc))endDate.setDate(endDate.getDate()+1);
    const next=await transport.createPlanning({
      title:$('#event-title').value.trim(),startAtUtc,endAtUtc:endDate.toISOString(),category:$('#event-category').value,
      description:'',desiredPublication:{local:false,twitch:$('#event-category').value==='live',google:false},
    });
    applyState(next);$('#event-dialog').close();event.currentTarget.reset();toast('Événement ajouté.');
  }catch(error){toast(error.message);}
};

$('#export-planning').onclick=async()=>{
  if(!state)return toast('Planning indisponible.');
  try{
    const {exportPlanningImage}=await import('./planning-export.js');
    const count=await exportPlanningImage(state.planning||[],state.settings?.streamerName||'Le Feu de Camp de Dam',{period:'this-week'});
    toast(`Image prête · ${count} live${count>1?'s':''}.`);
  }catch(error){if(error?.name!=='AbortError')toast(error.message);}
};

window.addEventListener('online',()=>void probeAndConnect());
window.addEventListener('offline',()=>{httpReady=false;renderConnection('PC hors ligne','offline');});
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden&&credential) void probeAndConnect();
  else if(document.hidden&&state?.streamerPings?.length){
    const pending=state.streamerPings.filter(value=>!value.acknowledgedAt);
    notifyStreamerPing(pending.at(-1),pending.length);
  }
});

const boot=async()=>{
  if (productionUi) {
    document.title='StreamDashboard';
    $('#preview-badge')?.remove();
    const name=$('#pair-name'); if(name) name.value='Android Remote';
  }
  renderQuickSounds();renderFullSoundboard();
  credential=await credentialStorage.get()||'';
  server=settingsStorage.getServer();
  $('#pair-server').value=server||'';
  if(!credential){
    renderConnection('PC non appairé','offline');
    if(isAndroidRuntime())$('#connection-dialog').showModal();
    return;
  }
  await probeAndConnect();
};
void boot();
