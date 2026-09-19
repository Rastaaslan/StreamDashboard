import { fixture } from './fixtures.js';

const state={
  view:'home',runtime:false,scene:fixture.live.scene,timerRunning:true,seconds:36,
  sounds:structuredClone(fixture.sounds),audio:structuredClone(fixture.audio),live:structuredClone(fixture.live),
  planning:structuredClone(fixture.planning),dashboard:null,soundboard:null,obsSetup:null,search:'',
  campItem:'Préparation',remotePairing:null,twitchRewards:null
};
const view=document.querySelector('#view'),title=document.querySelector('#title'),eyebrow=document.querySelector('#eyebrow');
const commandLog=[]; window.__preview={state,commandLog};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>globalThis.crypto?.randomUUID?.()||`cmd_${Date.now()}_${Math.random().toString(36).slice(2)}`;
function toast(message,bad=false){const el=document.querySelector('#toast');el.textContent=message;el.classList.toggle('bad',bad);el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),1800)}
async function request(path,options={}){const response=await fetch(path,{headers:{'content-type':'application/json',...(options.headers||{})},...options});const body=response.status===204?null:await response.json().catch(()=>({}));if(!response.ok)throw new Error(body?.error?.message||body?.error||`HTTP ${response.status}`);return body}
function record(type,payload={}){commandLog.push({type,payload})}
let runtimeSocket=null,socketRetry=null;
const editableFocus=()=>document.activeElement?.matches?.('input,select,textarea');
function closeRuntimeSocket(){if(socketRetry){clearTimeout(socketRetry);socketRetry=null}const socket=runtimeSocket;runtimeSocket=null;if(socket&&socket.readyState<2)socket.close()}
function connectRuntimeSocket(){
  if(!state.runtime||runtimeSocket&&runtimeSocket.readyState<2)return;
  const socket=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws/v1`);runtimeSocket=socket;
  socket.onopen=()=>runtimeUi(true,state.dashboard?.obs?.connected?'OBS connecté · temps réel':'Runtime connecté · temps réel');
  socket.onmessage=event=>{try{const message=JSON.parse(event.data);if(message.type==='state.updated'&&message.data){applyDashboard(message.data);if(!editableFocus()){render();if(state.campItem==='Réglages'&&state.twitchRewards===null&&state.dashboard?.twitch?.redemptionsAvailable===true)void loadStreamerPingRewards()}}}catch{/* événement invalide ignoré */}};
  socket.onclose=()=>{if(runtimeSocket===socket)runtimeSocket=null;if(!state.runtime)return;runtimeUi(true,'Runtime connecté · reconnexion temps réel…');socketRetry=setTimeout(connectRuntimeSocket,1500)};
  socket.onerror=()=>socket.close();
}
function runtimeUi(online,copy){document.querySelector('#runtime-status').textContent=online?'Runtime PC':'Mode Démo';document.querySelector('#runtime-copy').textContent=copy;document.querySelector('#runtime-dot').classList.toggle('offline',!online)}
const logicalScene=name=>{
  const settings=state.dashboard?.settings||{};
  if(settings.modeScenes?.intro===name)return'Intro';
  if(settings.modeScenes?.live===name)return'Gameplay';
  if(settings.chattingScene===name)return'Chatting';
  if(settings.modeScenes?.pause===name)return'Pause';
  if(settings.modeScenes?.end===name)return'Fin';
  return name;
};
const sceneCommand=label=>({
  Intro:{type:'mode.set',mode:'intro'},Gameplay:{type:'mode.set',mode:'live'},Chatting:{type:'scene.chatting'},
  Pause:{type:'mode.set',mode:'pause'},Fin:{type:'mode.set',mode:'end'}
})[label];
async function dashboardCommand(command,logType='dashboard.command',logPayload=command){
  record(logType,logPayload); if(!state.runtime)return null;
  const commandId=uid();const body=await request('/api/v1/commands',{method:'POST',body:JSON.stringify({...command,commandId,correlationId:commandId})});
  if(body?.state)applyDashboard(body.state);return body;
}
async function refreshRuntime(){
  if(!state.runtime)return;
  try{
    const [dashboard,soundboard,setup]=await Promise.all([
      request('/api/v1/state'),request('/api/v1/soundboard'),request('/api/v1/soundboard/obs/status').catch(()=>null)
    ]);
    applyDashboard(dashboard);state.soundboard=soundboard;state.sounds=soundboard.sounds||[];state.obsSetup=setup;
    runtimeUi(true,dashboard.obs?.connected?'OBS connecté':'Runtime connecté · OBS hors ligne');connectRuntimeSocket();render();
  }catch(error){runtimeUi(true,'Runtime indisponible');toast(error.message,true)}
}
function applyDashboard(d){
  state.dashboard=d;state.scene=d.obs?.scene||'—';state.timerRunning=d.timer?.running===true;state.seconds=Math.max(0,Math.ceil(Number(d.timer?.remaining)||0));
  const hub=d.controlHub||{};state.live={
    active:hub.live?.isLive===true||d.obs?.streaming===true,
    duration:formatDuration(hub.live?.durationSeconds??0),title:hub.live?.title||d.twitch?.channelTitle||'Prêt à streamer',
    category:hub.live?.category||d.twitch?.gameName||'—',viewers:hub.audience?.viewerCount??'—',chatters:Array.isArray(hub.audience?.chatters)?hub.audience.chatters.length:'—',
    scene:d.obs?.scene||'—'
  };
  const inputs=d.obs?.inputs||{};const active=Array.isArray(d.obs?.activeAudioInputs)?d.obs.activeAudioInputs:Object.keys(inputs);
  state.audio=active.filter(name=>inputs[name]).slice(0,6).map(name=>{const input=inputs[name];const db=Number.isFinite(input.volumeDb)?input.volumeDb:-100;return{name,muted:input.muted,volume:Math.round(Math.max(0,Math.min(1,input.volume??0))*100),level:Math.round(Math.max(0,Math.min(100,((db+60)/66)*100))),primary:d.settings?.primaryMicInput===name}});
  state.planning=(d.planning||[]).filter(item=>Date.parse(item.endAtUtc||item.startAtUtc)>Date.now()).sort((a,b)=>Date.parse(a.startAtUtc)-Date.parse(b.startAtUtc)).slice(0,12).map(item=>{const start=new Date(item.startAtUtc);return{raw:item,day:start.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric'}),time:start.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}),title:item.title,kind:item.category==='live'?'Twitch':item.category==='personal'?'Personnel':'Production'}});
  syncStreamerPing();
}
function formatDuration(seconds){const n=Math.max(0,Math.floor(Number(seconds)||0));return`${String(Math.floor(n/3600)).padStart(2,'0')}:${String(Math.floor(n/60)%60).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`}
const primaryScenes=['Intro','Gameplay','Chatting','Pause','Fin'];
const scenes=()=>`<div class="scene-grid">${primaryScenes.map(name=>`<button class="scene ${logicalScene(state.scene)===name?'active':''}" data-scene="${name}" aria-pressed="${logicalScene(state.scene)===name}">${name}</button>`).join('')}</div>`;
function filteredSounds(){const query=state.search.trim().toLowerCase();return(state.sounds||[]).filter(s=>!query||String(s.name).toLowerCase().includes(query)||String(s.category).toLowerCase().includes(query))}
const sounds=(editable=false)=>Object.entries(filteredSounds().reduce((groups,s)=>{(groups[s.category||'Sans catégorie']??=[]).push(s);return groups},{})).map(([category,items])=>`<div class="group"><h3>${esc(category)}</h3><div class="pads">${items.map(s=>`<div class="sound-item"><button class="pad ${s.sourceAvailable===false?'missing':''}" data-sound="${esc(s.id)}" ${s.enabled===false?'disabled':''}>${esc(s.name)}${s.sourceAvailable===false?' · absent':''}</button>${editable?`<button class="edit-sound" data-edit-sound="${esc(s.id)}" aria-label="Modifier ${esc(s.name)}">•••</button>`:''}</div>`).join('')}</div></div>`).join('');
function home(){return`<div class="stack"><section class="status-strip"><div><span class="live-pill">${state.live.active?'● LIVE':'○ PRÊT'}</span><strong class="value">${esc(state.live.duration)}</strong><span class="label">${esc(state.live.title)} · ${esc(state.live.category)}</span></div><div><span class="label">Viewers</span><b class="value">${esc(state.live.viewers??17)}</b></div><div><span class="label">Chat</span><b class="value">${esc(state.live.chatters??6)}</b></div><div><span class="label">OBS</span><b>${state.runtime?(state.dashboard?.obs?.connected?'Connecté':'Hors ligne'):'Démo'}</b></div><div><span class="label">Twitch</span><b>${state.runtime?(state.dashboard?.twitch?.connected?'Connecté':'Déconnecté'):'Démo'}</b></div></section><section class="section"><div class="section-head"><h2>Scènes principales</h2><span class="label">Active · ${esc(state.scene)}</span></div>${scenes()}</section><section class="section"><div class="section-head"><h2>Sons rapides</h2><button class="secondary" data-add-sound>+ Ajouter un son rapide</button></div><div class="sound-groups">${sounds(false)||'<p class="label">Aucun son.</p>'}</div></section></div>`}
function live(){return`<div class="cockpit"><section class="status-strip wide"><div><span class="live-pill">${state.live.active?'● LIVE':'○ PRÊT'}</span><b class="value">${esc(state.live.duration)}</b></div><div><span class="label">Viewers</span><b class="value">${esc(state.live.viewers??17)}</b></div><div><span class="label">Chat</span><b class="value">${esc(state.live.chatters??6)}</b></div><div><span class="label">Scène</span><b>${esc(state.scene)}</b></div><div><button class="critical" data-live-toggle>${state.live.active?'Arrêter le live':'Démarrer le live'}</button></div></section><section class="section wide"><div class="section-head"><h2>Scènes</h2></div>${scenes()}</section><section class="section"><div class="section-head"><h2>Audio</h2><span class="label">Sources actives</span></div>${state.audio.map((a,i)=>`<div class="audio-row"><b>${esc(a.name)}${a.primary?' · principal':''}</b><button data-mute="${i}" aria-label="${a.muted?'Réactiver':'Couper'} ${esc(a.name)}">${a.muted?'OFF':'ON'}</button><div class="meter"><i style="width:${a.level}%"></i></div><span>${a.volume}%</span></div>`).join('')||'<p class="label">Aucune source audio active.</p>'}</section><section class="section timer"><div class="section-head"><h2>Timer</h2></div><b class="timer-value">${formatDuration(state.seconds)}</b><div class="timer-actions"><button class="action" data-timer="minus">−1 min</button><button class="action" data-timer="toggle">${state.timerRunning?'Pause':'Play'}</button><button class="action" data-timer="plus">+1 min</button><button class="action" data-timer="reset">Reset</button></div></section></div>`}
function soundboard(){const setup=state.obsSetup;const label=state.runtime?(setup?.ready?'OBS Soundboard · prête':setup?.connected?'OBS Soundboard · à configurer':'OBS Soundboard · OBS hors ligne'):'OBS Soundboard · Démo';return`<section class="section"><div class="section-head"><div><h2>Soundboard</h2><span class="label">${label} · une lecture à la fois</span></div><div><button class="secondary" data-obs-setup>Configurer dans OBS</button> <button class="critical" data-stop>Stop</button></div></div><div class="toolbar"><input type="search" value="${esc(state.search)}" placeholder="Rechercher un son" aria-label="Rechercher un son" data-sound-search><button class="action" data-add-sound>+ Ajouter un son</button></div><div class="sound-groups">${sounds(true)||'<p class="label">Bibliothèque vide.</p>'}</div></section>`}
function planning(){return`<section class="section"><div class="section-head"><div><h2>Semaine</h2><span class="label">Planning à venir</span></div><button class="action" data-add-event>+ Nouvel événement</button></div><div class="agenda">${state.planning.map(e=>`<button class="event"><b>${esc(e.day)}</b><span>${esc(e.time)}</span><strong>${esc(e.title)}</strong><span class="kind">${esc(e.kind)}</span></button>`).join('')||'<p class="label">Aucun événement à venir.</p>'}</div></section>`}
const campItems=['Préparation','Notes','Templates','Soutiens','Automatisations','Médias OBS','Connexions','Diagnostics','Réglages'];
const connectionLabel=status=>({CONNECTED:'Connecté',CONNECTING:'Connexion…',DISCONNECTED:'Déconnecté',NOT_CONFIGURED:'À configurer',NOT_SUPPORTED:'Non disponible',DEGRADED:'Connexion instable',ERROR:'Erreur'})[status]||'À configurer';
const runtimeDisabled=()=>state.runtime?'':' disabled';
function connectionCard(name,status,content=''){return`<article class="setup-status connection-card"><div class="section-head"><b>${esc(name)}</b><span class="label">${esc(status)}</span></div>${content}</article>`}
function connectionsContent(){
  const d=state.dashboard||{};const integrations=d.controlHub?.integrations||{};const streamlabs=integrations.streamlabs||{status:'NOT_CONFIGURED'};const wizebot=integrations.wizebot||{status:'NOT_CONFIGURED'};
  const twitch=d.twitch||{};const google=d.google||{};const discord=d.discord||{};const remote=d.remote||{};const settings=d.settings||{};
  const deviceCode=twitch.deviceAuthorization? `<div class="device-code"><span class="label">Code Twitch</span><b>${esc(twitch.deviceAuthorization.userCode)}</b></div>`:'';
  const calendars=Array.isArray(google.calendars)?google.calendars:[];const target=google.targetCalendarId||'';
  const googleControls=!google.configured?'<p class="help">Google Calendar n’est pas configuré dans cette distribution.</p>':google.connected?
    `<div class="toolbar"><select id="preview-google-calendar"${runtimeDisabled()}><option value="">Choisir le calendrier…</option>${calendars.map(item=>`<option value="${esc(item.id)}" ${target===item.id?'selected':''} ${item.writable?'':'disabled'}>${esc(item.summary)}${item.writable?'':' · lecture seule'}</option>`).join('')}</select><button class="secondary" data-connection-action="google-sync"${runtimeDisabled()}>Synchroniser</button><button class="critical" data-connection-action="google-disconnect"${runtimeDisabled()}>Déconnecter</button></div>`:
    `<button class="action" data-connection-action="google-connect"${runtimeDisabled()}>Connecter Google Calendar</button>`;
  const devices=Array.isArray(remote.devices)?remote.devices.filter(item=>!item.revokedAt):[];
  const pairing=state.remotePairing?`<div class="device-code"><span class="label">ID de pairing</span><b>${esc(state.remotePairing.id)}</b><span class="label">Code</span><b>${esc(state.remotePairing.code)}</b></div>`:'';
  return `<div class="connection-stack">
    ${!state.runtime?'<p class="help">Passe en mode Runtime pour modifier les connexions réelles.</p>':''}
    ${connectionCard('OBS',d.obs?.connected?`Connecté${d.obs?.obsVersion?` · v${d.obs.obsVersion}`:''}`:d.obs?.error||'Déconnecté',`
      <form id="preview-obs-form" class="connection-form">
        <div class="toolbar"><input name="obsUrl" value="${esc(settings.obsUrl||'ws://127.0.0.1:4455')}" aria-label="Adresse OBS WebSocket"${runtimeDisabled()}><input name="obsPassword" type="password" maxlength="500" autocomplete="new-password" placeholder="${settings.obsPasswordSet?'Mot de passe enregistré · vide = conserver':'Mot de passe OBS'}"${runtimeDisabled()}></div>
        <div class="connection-actions"><button class="secondary" type="button" data-connection-action="obs-launch"${runtimeDisabled()}>Lancer OBS</button><button class="secondary" type="button" data-connection-action="obs-test"${runtimeDisabled()}>Tester</button><button class="action" type="submit"${runtimeDisabled()}>Enregistrer</button></div>
      </form>`)}
    ${connectionCard('Twitch',twitch.connected?`Connecté · ${twitch.displayName||twitch.userName||''}`:twitch.error||'Déconnecté',`${deviceCode}<div class="connection-actions"><button class="${twitch.connected?'critical':'action'}" data-connection-action="${twitch.connected?'twitch-disconnect':'twitch-connect'}"${runtimeDisabled()}>${twitch.connected?'Déconnecter':'Connecter Twitch'}</button>${twitch.connected?'<button class="secondary" data-connection-action="twitch-sync">Synchroniser</button>':''}</div>`)}
    ${connectionCard('Google Calendar',google.connected?'Connecté':google.error||'Déconnecté',googleControls)}
    ${connectionCard('Discord',discord.connected?`Connecté${discord.guildName?` · ${discord.guildName}`:''}`:discord.configured?discord.error||'Configuré · non connecté':'À configurer',`
      <div class="toolbar"><input id="preview-discord-token" type="password" maxlength="300" autocomplete="new-password" placeholder="Token du bot"${runtimeDisabled()}><button class="action" data-connection-action="discord-token-save"${runtimeDisabled()}>Enregistrer token</button><button class="critical" data-connection-action="discord-token-delete"${runtimeDisabled()}>Déconnecter</button></div>
      <div class="toolbar"><select id="preview-discord-guild"${runtimeDisabled()}><option value="">Serveur Discord…</option></select><select id="preview-discord-channel"${runtimeDisabled()}><option value="">Salon…</option></select><button class="secondary" data-connection-action="discord-load"${runtimeDisabled()}>Charger</button></div>
      <div class="toolbar"><input id="preview-discord-message" maxlength="2000" value="${esc(d.discordDefaultMessage||'')}" placeholder="Message par défaut"${runtimeDisabled()}><button class="action" data-connection-action="discord-settings-save"${runtimeDisabled()}>Enregistrer destination</button></div>`)}
    ${connectionCard('Streamlabs',connectionLabel(streamlabs.status),`<form id="preview-streamlabs-form" class="toolbar"><input name="token" type="password" maxlength="1000" autocomplete="new-password" placeholder="Token Socket API"${runtimeDisabled()}><button class="action" type="submit"${runtimeDisabled()}>Configurer</button><button class="secondary" type="button" data-connection-action="streamlabs-test"${runtimeDisabled()}>Tester</button><button class="critical" type="button" data-connection-action="streamlabs-disconnect"${runtimeDisabled()}>Déconnecter</button></form>`)}
    ${connectionCard('WizeBot',`${connectionLabel(wizebot.status)}${wizebot.profile?.name?` · ${wizebot.profile.name}`:''}`,`<form id="preview-wizebot-form" class="connection-form"><div class="toolbar"><input name="apiBaseUrl" type="url" placeholder="Adresse API WizeBot" required${runtimeDisabled()}><input name="token" type="password" maxlength="1000" autocomplete="new-password" placeholder="Token API" required${runtimeDisabled()}></div><div class="connection-actions"><button class="action" type="submit"${runtimeDisabled()}>Configurer</button><button class="secondary" type="button" data-connection-action="wizebot-refresh"${runtimeDisabled()}>Rafraîchir</button><button class="critical" type="button" data-connection-action="wizebot-disconnect"${runtimeDisabled()}>Déconnecter</button></div></form>`)}
    ${connectionCard('Android',remote.enabled?'Télécommande LAN active':settings.remoteEnabled?'Activation configurée · redémarrage requis':'Télécommande LAN désactivée',`<div class="connection-actions"><button class="secondary" data-connection-action="remote-toggle"${runtimeDisabled()}>${settings.remoteEnabled?'Désactiver au prochain démarrage':'Activer la télécommande'}</button>${remote.enabled?'<button class="action" data-connection-action="remote-pair">Ajouter une télécommande</button>':''}</div>${pairing}<div class="connection-devices">${devices.map(device=>`<span>${esc(device.name||'Android')}<button class="critical" data-revoke-device="${esc(device.id)}">Révoquer</button></span>`).join('')||'<span class="help">Aucune télécommande appairée.</span>'}</div>`)}
  </div>`;
}
function streamerPingSettings(){
  if(!state.runtime)return '<p class="help">Passe en mode Runtime pour choisir les récompenses qui créent un Streamer Ping.</p>';
  if(!state.dashboard?.twitch?.connected)return '<p class="help">Connecte Twitch pour configurer les Streamer Pings.</p>';
  if(state.dashboard?.twitch?.redemptionsAvailable!==true)return '<div class="setup-status"><b>Autorisation Twitch manquante</b><p class="help">Reconnecte Twitch une fois pour accorder channel:read:redemptions.</p><button class="action" data-ping-action="reauthorize">Réautoriser Twitch</button></div>';
  if(state.twitchRewards===null)return '<p class="help">Chargement des récompenses Twitch…</p>';
  const selected=new Set(state.dashboard?.settings?.streamerPingRewardIds||[]);
  return `<div class="setup-status"><div class="section-head"><div><b>Streamer Pings</b><span class="label">Choisis les récompenses qui doivent te demander une action.</span></div></div><div class="ping-reward-list">${state.twitchRewards.map(reward=>`<label><input type="checkbox" data-ping-reward="${esc(reward.id)}" ${selected.has(reward.id)?'checked':''}><span><b>${esc(reward.title)}</b><small>${reward.cost} points${reward.prompt?` · ${esc(reward.prompt)}`:''}</small></span></label>`).join('')||'<p class="help">Aucune récompense personnalisée Twitch.</p>'}</div><div class="connection-actions"><button class="action" data-ping-action="save">Enregistrer les Streamer Pings</button></div></div>`;
}
function campContent(item){
  if(item==='Connexions')return connectionsContent();
  if(item==='Réglages')return streamerPingSettings();
  const copies={Préparation:'Checklist avant direct · les outils secondaires restent hors du cockpit principal.',Notes:'Les notes restent disponibles depuis le Runtime.',Templates:'Les templates restent disponibles depuis le Runtime.',Soutiens:'Suivi des soutiens et providers.',Automatisations:'Règles automatiques du stream.', 'Médias OBS':'Contrôle des sources média OBS.',Diagnostics:`Build ${state.dashboard?.runtime?.serverVersion||'Preview'} · stateRevision ${state.dashboard?.stateRevision??'—'}`};
  return `<p>${esc(copies[item]||'')}</p>`;
}
function camp(){return`<div class="camp-grid"><section class="section camp-nav">${campItems.map(x=>`<button class="${state.campItem===x?'active':''}" data-camp="${x}">${x}</button>`).join('')}</section><section class="section empty-detail"><p class="eyebrow">LE CAMP</p><h2 id="camp-title">${esc(state.campItem)}</h2><div id="camp-copy">${campContent(state.campItem)}</div></section></div>`}
function render(){const names={home:['Accueil','COCKPIT'],live:['Live','EN DIRECT'],sounds:['Sons','BIBLIOTHÈQUE'],planning:['Planning','SEMAINE'],camp:['Le Camp','SECONDAIRE']};[title.textContent,eyebrow.textContent]=names[state.view];view.innerHTML=({home,live,sounds:soundboard,planning,camp}[state.view])();document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-current',b.dataset.view===state.view?'page':'false'));bind()}
async function playSound(soundId){record('soundboard.play',{soundId});if(!state.runtime){toast('Lecture simulée');return}try{const commandId=uid();const ack=await request('/api/v1/soundboard/play',{method:'POST',body:JSON.stringify({commandId,correlationId:commandId,soundId,issuedAt:new Date().toISOString()})});if(ack.status!=='succeeded')throw new Error(ack.message||'Lecture refusée.');toast('Son envoyé à OBS');await refreshRuntime()}catch(error){toast(error.message,true)}}
async function toggleLive(){if(!state.runtime){record(state.live.active?'session.stop':'session.start');state.live.active=!state.live.active;render();return}try{if(state.live.active){if(!confirm('Arrêter réellement le live ?'))return;await dashboardCommand({type:'session.stop'},'session.stop');}else{if(!confirm('Démarrer réellement le live ?'))return;await dashboardCommand({type:'session.prepare'},'session.prepare');try{await dashboardCommand({type:'session.start'},'session.start')}catch(error){if(confirm(`${error.message}\n\nDémarrer quand même ?`))await dashboardCommand({type:'session.start',force:true},'session.start');else throw error}}await refreshRuntime()}catch(error){toast(error.message,true)}}
function bind(){
  document.querySelectorAll('[data-scene]').forEach(b=>b.onclick=async()=>{const label=b.dataset.scene;record('obs.scene.set',{sceneName:label});if(!state.runtime){state.scene=label;toast(`Scène ${label}`);render();return}try{await dashboardCommand(sceneCommand(label));await refreshRuntime();toast(`Scène ${label}`)}catch(error){toast(error.message,true)}});
  document.querySelectorAll('[data-sound]').forEach(b=>b.onclick=()=>void playSound(b.dataset.sound));
  document.querySelectorAll('[data-edit-sound]').forEach(b=>b.onclick=event=>{event.stopPropagation();openSoundDialog(b.dataset.editSound)});
  document.querySelectorAll('[data-mute]').forEach(b=>b.onclick=async()=>{const a=state.audio[+b.dataset.mute];if(!a)return;record('obs.audio.mute',{inputName:a.name,muted:!a.muted});if(!state.runtime){a.muted=!a.muted;render();return}try{await dashboardCommand({type:'obs.mute',input:a.name,muted:!a.muted});await refreshRuntime()}catch(error){toast(error.message,true)}});
  document.querySelectorAll('[data-timer]').forEach(b=>b.onclick=async()=>{const action=b.dataset.timer;record(`timer.${action}`);if(!state.runtime){if(action==='toggle')state.timerRunning=!state.timerRunning;if(action==='plus')state.seconds+=60;if(action==='minus')state.seconds=Math.max(0,state.seconds-60);if(action==='reset'){state.seconds=0;state.timerRunning=false}render();return}const command=action==='toggle'?{type:state.timerRunning?'timer.pause':'timer.start'}:action==='plus'?{type:'timer.add',seconds:60}:action==='minus'?{type:'timer.add',seconds:-60}:{type:'timer.reset'};try{await dashboardCommand(command);await refreshRuntime()}catch(error){toast(error.message,true)}});
  document.querySelector('[data-stop]')?.addEventListener('click',async()=>{record('soundboard.stop');if(!state.runtime){toast('Lecture arrêtée');return}try{await request('/api/v1/soundboard/stop',{method:'POST',body:'{}'});toast('Lecture arrêtée');await refreshRuntime()}catch(error){toast(error.message,true)}});
  document.querySelectorAll('[data-add-sound]').forEach(b=>b.onclick=()=>openSoundDialog());
  document.querySelector('[data-obs-setup]')?.addEventListener('click',()=>void openObsSetup());
  document.querySelector('[data-live-toggle]')?.addEventListener('click',()=>void toggleLive());
  document.querySelector('[data-add-event]')?.addEventListener('click',openEventDialog);
  document.querySelector('[data-sound-search]')?.addEventListener('input',e=>{state.search=e.currentTarget.value;render()});
  document.querySelectorAll('[data-camp]').forEach(b=>b.onclick=()=>{state.campItem=b.dataset.camp;render();if(state.campItem==='Réglages')void loadStreamerPingRewards()});
  bindConnections();
  bindStreamerPingSettings();
}
let activeStreamerPingId=null;
function ensureStreamerPingHost(){
  let host=document.querySelector('#streamer-ping');
  if(host)return host;
  host=document.createElement('section');host.id='streamer-ping';host.className='streamer-ping';host.hidden=true;document.body.append(host);return host;
}
function syncStreamerPing(){
  const host=ensureStreamerPingHost();const ping=(state.dashboard?.streamerPings||[]).find(value=>!value.acknowledgedAt);
  if(!state.runtime||!ping){host.hidden=true;host.replaceChildren();activeStreamerPingId=null;return}
  if(activeStreamerPingId===ping.id&&!host.hidden)return;
  activeStreamerPingId=ping.id;host.hidden=false;
  host.innerHTML=`<div><span class="eyebrow">STREAMER PING</span><h2>${esc(ping.rewardTitle)}</h2><p><b>${esc(ping.userName)}</b> a utilisé cette récompense${ping.rewardCost?` · ${ping.rewardCost} points`:''}.</p>${ping.userInput?`<p class="ping-input">“${esc(ping.userInput)}”</p>`:''}</div><button class="action" data-ping-ack="${esc(ping.id)}">Vu</button>`;
  host.querySelector('[data-ping-ack]').onclick=()=>void acknowledgeStreamerPing(ping.id);
}
async function acknowledgeStreamerPing(id){
  try{const next=await request(`/api/v1/streamer-pings/${encodeURIComponent(id)}/ack`,{method:'POST',body:'{}'});applyDashboard(next);render();toast('Streamer Ping acquitté')}catch(error){toast(error.message,true)}
}
async function loadStreamerPingRewards(){
  if(!state.runtime||state.campItem!=='Réglages'||state.dashboard?.twitch?.redemptionsAvailable!==true)return;
  try{const result=await request('/api/v1/twitch/rewards');state.twitchRewards=result.items||[];render()}catch(error){state.twitchRewards=[];toast(error.message,true);render()}
}
function bindStreamerPingSettings(){
  if(state.view!=='camp'||state.campItem!=='Réglages')return;
  document.querySelector('[data-ping-action="reauthorize"]')?.addEventListener('click',async()=>{try{const result=await request('/api/v1/twitch/device',{method:'POST',body:'{}'});if(window.streamDashboardDesktop?.openTwitchActivation)await window.streamDashboardDesktop.openTwitchActivation(result.verificationUri);toast(`Code Twitch : ${result.userCode}`)}catch(error){toast(error.message,true)}});
  document.querySelector('[data-ping-action="save"]')?.addEventListener('click',async()=>{const ids=[...document.querySelectorAll('[data-ping-reward]:checked')].map(input=>input.dataset.pingReward);try{const next=await request('/api/v1/settings',{method:'PUT',body:JSON.stringify({streamerPingRewardIds:ids})});applyDashboard(next);toast('Récompenses Streamer Ping enregistrées');render()}catch(error){toast(error.message,true)}});
}
function requireRuntime(){if(state.runtime)return true;toast('Passe en mode Runtime pour utiliser cette connexion.',true);return false}
async function refreshAfterConnection(message){await refreshRuntime();if(message)toast(message)}
async function loadDiscordChannels(){
  if(!requireRuntime())return;const guild=document.querySelector('#preview-discord-guild'),channel=document.querySelector('#preview-discord-channel');if(!guild||!channel||!guild.value)return;
  const channels=await request(`/api/v1/discord/guilds/${encodeURIComponent(guild.value)}/channels`);channel.replaceChildren(new Option('Salon…',''),...channels.map(value=>new Option(`#${value.name}`,value.id)));if(state.dashboard?.discord?.channelId)channel.value=state.dashboard.discord.channelId;
}
async function loadDiscord(){
  if(!requireRuntime())return;const guild=document.querySelector('#preview-discord-guild');if(!guild)return;const guilds=await request('/api/v1/discord/guilds');guild.replaceChildren(new Option('Serveur Discord…',''),...guilds.map(value=>new Option(value.name,value.id)));if(state.dashboard?.discord?.guildId)guild.value=state.dashboard.discord.guildId;await loadDiscordChannels();toast('Discord chargé');
}
function bindConnections(){
  if(state.view!=='camp'||state.campItem!=='Connexions')return;
  const obsForm=document.querySelector('#preview-obs-form');if(obsForm)obsForm.onsubmit=async event=>{event.preventDefault();if(!requireRuntime())return;const form=new FormData(obsForm);const password=String(form.get('obsPassword')||'');const payload={obsUrl:String(form.get('obsUrl')||'').trim(),...(password?{obsPassword:password}:{})};try{const next=await request('/api/v1/settings',{method:'PUT',body:JSON.stringify(payload)});applyDashboard(next);toast('Connexion OBS enregistrée');render()}catch(error){toast(error.message,true)}};
  const streamlabsForm=document.querySelector('#preview-streamlabs-form');if(streamlabsForm)streamlabsForm.onsubmit=async event=>{event.preventDefault();if(!requireRuntime())return;const token=String(new FormData(streamlabsForm).get('token')||'').trim();if(!token)return toast('Saisis le token Socket Streamlabs.',true);try{await request('/api/v1/supports/streamlabs/config',{method:'PUT',body:JSON.stringify({token})});streamlabsForm.reset();await refreshAfterConnection('Streamlabs configuré')}catch(error){toast(error.message,true)}};
  const wizebotForm=document.querySelector('#preview-wizebot-form');if(wizebotForm)wizebotForm.onsubmit=async event=>{event.preventDefault();if(!requireRuntime())return;const form=new FormData(wizebotForm);try{await request('/api/v1/wizebot/config',{method:'PUT',body:JSON.stringify({apiBaseUrl:form.get('apiBaseUrl'),token:form.get('token')})});wizebotForm.reset();await refreshAfterConnection('WizeBot configuré')}catch(error){toast(error.message,true)}};
  const guild=document.querySelector('#preview-discord-guild');if(guild)guild.onchange=()=>void loadDiscordChannels().catch(error=>toast(error.message,true));
  document.querySelectorAll('[data-revoke-device]').forEach(button=>button.onclick=async()=>{if(!requireRuntime()||!confirm('Révoquer immédiatement cette télécommande ?'))return;try{await request(`/api/v1/remote/devices/${encodeURIComponent(button.dataset.revokeDevice)}`,{method:'DELETE'});await refreshAfterConnection('Télécommande révoquée')}catch(error){toast(error.message,true)}});
  document.querySelectorAll('[data-connection-action]').forEach(button=>button.onclick=async event=>{
    if(button.closest('form')&&button.type==='submit')return;event.preventDefault();if(!requireRuntime())return;
    try{
      const action=button.dataset.connectionAction;
      if(action==='obs-launch'){const result=await window.streamDashboardDesktop?.ensureObsRunning?.();toast(result?.detail||'Demande de lancement OBS envoyée');return}
      if(action==='obs-test'){const form=document.querySelector('#preview-obs-form');const data=new FormData(form);const password=String(data.get('obsPassword')||'');const result=await request('/api/v1/obs/test',{method:'POST',body:JSON.stringify({obsUrl:String(data.get('obsUrl')||'').trim(),...(password?{obsPassword:password}:{})})});toast(`OBS connecté · v${result.obsVersion||'?'}`);return}
      if(action==='twitch-connect'){const result=await request('/api/v1/twitch/device',{method:'POST',body:'{}'});if(window.streamDashboardDesktop?.openTwitchActivation)await window.streamDashboardDesktop.openTwitchActivation(result.verificationUri);toast(`Code Twitch : ${result.userCode}`);await refreshRuntime();return}
      if(action==='twitch-disconnect'){const next=await request('/api/v1/twitch/disconnect',{method:'POST',body:'{}'});applyDashboard(next);toast('Twitch déconnecté');render();return}
      if(action==='twitch-sync'){const next=await request('/api/v1/twitch/sync',{method:'POST',body:'{}'});applyDashboard(next);toast('Planning Twitch synchronisé');render();return}
      if(action==='google-connect'){const result=await request('/api/v1/google/oauth/start',{method:'POST',body:'{}'});if(window.streamDashboardDesktop?.openExternalAuth)await window.streamDashboardDesktop.openExternalAuth(result.authorizationUrl);toast('Connexion Google ouverte dans le navigateur');return}
      if(action==='google-disconnect'){const next=await request('/api/v1/google/disconnect',{method:'POST',body:'{}'});applyDashboard(next);toast('Google Calendar déconnecté');render();return}
      if(action==='google-sync'){const next=await request('/api/v1/google/sync',{method:'POST',body:'{}'});applyDashboard(next);toast('Google Calendar synchronisé');render();return}
      if(action==='discord-token-save'){const input=document.querySelector('#preview-discord-token');const token=input?.value.trim();if(!token)throw new Error('Saisis le token Discord.');await request('/api/v1/discord/token',{method:'PUT',body:JSON.stringify({token})});input.value='';await refreshAfterConnection('Token Discord configuré');return}
      if(action==='discord-token-delete'){await request('/api/v1/discord/token',{method:'DELETE'});await refreshAfterConnection('Discord déconnecté');return}
      if(action==='discord-load'){await loadDiscord();return}
      if(action==='discord-settings-save'){const g=document.querySelector('#preview-discord-guild'),ch=document.querySelector('#preview-discord-channel'),msg=document.querySelector('#preview-discord-message');await request('/api/v1/discord/settings',{method:'PUT',body:JSON.stringify({guildId:g?.value||null,channelId:ch?.value||null,defaultMessage:msg?.value||''})});await refreshAfterConnection('Destination Discord enregistrée');return}
      if(action==='streamlabs-test'){await request('/api/v1/supports/streamlabs/test',{method:'POST',body:'{}'});toast('Soutien Streamlabs de test reçu');return}
      if(action==='streamlabs-disconnect'){await request('/api/v1/supports/streamlabs/config',{method:'DELETE'});await refreshAfterConnection('Streamlabs déconnecté');return}
      if(action==='wizebot-refresh'){await request('/api/v1/wizebot/refresh',{method:'POST',body:'{}'});await refreshAfterConnection('WizeBot rafraîchi');return}
      if(action==='wizebot-disconnect'){await request('/api/v1/wizebot/config',{method:'DELETE'});await refreshAfterConnection('WizeBot déconnecté');return}
      if(action==='remote-toggle'){const enabled=state.dashboard?.settings?.remoteEnabled===true;const next=await request('/api/v1/settings',{method:'PUT',body:JSON.stringify({remoteEnabled:!enabled})});applyDashboard(next);toast(`Télécommande ${!enabled?'activée':'désactivée'} dans la configuration · redémarrage requis`);render();return}
      if(action==='remote-pair'){state.remotePairing=await request('/api/v1/remote/pairing',{method:'POST',body:'{}'});toast('Code de pairing créé');render();return}
    }catch(error){toast(error.message,true)}
  });
  const calendar=document.querySelector('#preview-google-calendar');if(calendar)calendar.onchange=async()=>{if(!calendar.value||!requireRuntime())return;try{const next=await request('/api/v1/google/target',{method:'PUT',body:JSON.stringify({calendarId:calendar.value})});applyDashboard(next);toast('Calendrier Google sélectionné');render()}catch(error){toast(error.message,true)}};
}
let selectedSoundFile='';
function openSoundDialog(id=''){const sound=(state.sounds||[]).find(s=>s.id===id);selectedSoundFile='';document.querySelector('#sound-id').value=id;document.querySelector('#sound-dialog-title').textContent=sound?'Modifier le son':'Ajouter un son';document.querySelector('#sound-name').value=sound?.name||'';document.querySelector('#sound-category').value=sound?.category||'';document.querySelector('#sound-volume').value=String(Math.round((sound?.volume??1)*100));document.querySelector('#sound-cooldown').value=String(Math.round((sound?.cooldownMs??0)/1000));document.querySelector('#sound-monitoring').value=sound?.monitoringMode||'stream';document.querySelector('#sound-favorite').checked=sound?.favorite===true;document.querySelector('#sound-enabled').checked=sound?.enabled!==false;document.querySelector('#sound-file-copy').textContent=sound?'Conserver le fichier actuel':'Aucun fichier choisi';document.querySelector('#sound-delete').hidden=!sound;document.querySelector('#sound-dialog').showModal()}
document.querySelector('#sound-file-button').onclick=async()=>{if(!window.streamDashboardDesktop?.selectSoundFile)return toast('Sélecteur de fichier indisponible.',true);const file=await window.streamDashboardDesktop.selectSoundFile();if(file){selectedSoundFile=file;document.querySelector('#sound-file-copy').textContent=file.split(/[\\/]/).pop()}};
document.querySelector('#sound-form').onsubmit=async event=>{event.preventDefault();const id=document.querySelector('#sound-id').value;const metadata={name:document.querySelector('#sound-name').value.trim(),category:document.querySelector('#sound-category').value.trim(),volume:Number(document.querySelector('#sound-volume').value)/100,cooldownMs:Math.round(Number(document.querySelector('#sound-cooldown').value)*1000),monitoringMode:document.querySelector('#sound-monitoring').value,favorite:document.querySelector('#sound-favorite').checked,enabled:document.querySelector('#sound-enabled').checked};if(!state.runtime){const existing=state.sounds.find(s=>s.id===id);if(existing)Object.assign(existing,metadata);else state.sounds.push({id:`demo-${Date.now()}`,...metadata,sourceAvailable:true});document.querySelector('#sound-dialog').close();render();return}try{let libraryId;if(selectedSoundFile){const imported=await window.streamDashboardDesktop.importSoundFile(selectedSoundFile);libraryId=imported.libraryId}if(!id&&!libraryId)throw new Error('Choisissez un fichier audio.');const body={...metadata,...(libraryId?{libraryId}:{})};state.soundboard=await request(id?`/api/v1/soundboard/sounds/${encodeURIComponent(id)}`:'/api/v1/soundboard/sounds',{method:id?'PUT':'POST',body:JSON.stringify(body)});state.sounds=state.soundboard.sounds||[];document.querySelector('#sound-dialog').close();toast('Soundboard enregistrée');render()}catch(error){toast(error.message,true)}};
document.querySelector('#sound-delete').onclick=async()=>{const id=document.querySelector('#sound-id').value;if(!id)return;if(!confirm('Supprimer ce son de la Soundboard ?'))return;if(!state.runtime){state.sounds=state.sounds.filter(s=>s.id!==id);document.querySelector('#sound-dialog').close();render();return}try{await request(`/api/v1/soundboard/sounds/${encodeURIComponent(id)}`,{method:'DELETE'});document.querySelector('#sound-dialog').close();await refreshRuntime();toast('Son supprimé')}catch(error){toast(error.message,true)}};
async function openObsSetup(){document.querySelector('#obs-setup-dialog').showModal();const host=document.querySelector('#obs-setup-status');if(!state.runtime){host.innerHTML='<p><b>Démo</b></p><p>Créera ou réparera la Media Source « StreamDashboard • Soundboard » dans Intro, Gameplay, Chatting, Pause et Fin.</p>';return}host.textContent='Vérification OBS…';try{state.obsSetup=await request('/api/v1/soundboard/obs/status');renderObsSetupStatus()}catch(error){host.textContent=error.message}}
function renderObsSetupStatus(){const s=state.obsSetup,host=document.querySelector('#obs-setup-status');if(!s){host.textContent='État indisponible.';return}host.innerHTML=`<p><b>${s.ready?'Prêt':'Configuration requise'}</b></p><p>Source : ${esc(s.inputExists?s.inputName:'à créer')}</p><p>Scènes cibles : ${esc(s.targetScenes.join(', ')||'aucune')}</p><p>Déjà raccordées : ${esc(s.attachedScenes.join(', ')||'aucune')}</p>${s.missingScenes.length?`<p class="warning">Scènes configurées absentes d’OBS : ${esc(s.missingScenes.join(', '))}</p>`:''}${s.wrongInputKind?'<p class="warning">Une source du même nom existe avec un type incompatible.</p>':''}`}
document.querySelector('#obs-setup-form').onsubmit=async event=>{event.preventDefault();if(!state.runtime)return toast('Passe en mode Runtime pour modifier OBS.');try{state.obsSetup=await request('/api/v1/soundboard/obs/setup',{method:'POST',body:'{}'});renderObsSetupStatus();toast(state.obsSetup.ready?'Soundboard OBS prête':'Réparation partielle terminée')}catch(error){toast(error.message,true);await openObsSetup()}};
function openEventDialog(){const date=new Date();document.querySelector('#event-date').value=date.toISOString().slice(0,10);document.querySelector('#event-dialog').showModal()}
document.querySelector('#event-form').onsubmit=async event=>{event.preventDefault();const date=document.querySelector('#event-date').value,start=document.querySelector('#event-start').value,end=document.querySelector('#event-end').value;const startAtUtc=new Date(`${date}T${start}`).toISOString();let endDate=new Date(`${date}T${end}`);if(endDate.getTime()<=Date.parse(startAtUtc))endDate.setDate(endDate.getDate()+1);const item={title:document.querySelector('#event-title').value.trim(),description:document.querySelector('#event-description').value.trim(),startAtUtc,endAtUtc:endDate.toISOString(),category:document.querySelector('#event-category').value,desiredPublication:{local:true,twitch:document.querySelector('#event-category').value==='live',google:false}};if(!state.runtime){state.planning.unshift({day:'Démo',time:start,title:item.title,kind:item.category==='live'?'Twitch':item.category});document.querySelector('#event-dialog').close();render();return}try{await request('/api/v1/planning',{method:'POST',body:JSON.stringify(item)});document.querySelector('#event-dialog').close();event.currentTarget.reset();await refreshRuntime();toast('Événement ajouté')}catch(error){toast(error.message,true)}};
document.querySelectorAll('[data-close-dialog]').forEach(button=>button.onclick=()=>document.querySelector(`#${button.dataset.closeDialog}`).close());
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{state.view=b.dataset.view;render()});
document.querySelector('#mode').onclick=async e=>{state.runtime=!state.runtime;e.currentTarget.textContent=state.runtime?'Runtime':'Démo';document.querySelector('.preview-mode span').textContent=state.runtime?'APERÇU · RUNTIME PC':'APERÇU · AUCUNE COMMANDE RÉELLE';runtimeUi(state.runtime,state.runtime?'Connexion au Runtime…':'Aucune commande réelle');if(state.runtime){await refreshRuntime();if(state.campItem==='Réglages')await loadStreamerPingRewards()}else{closeRuntimeSocket();state.scene=fixture.live.scene;state.sounds=structuredClone(fixture.sounds);state.audio=structuredClone(fixture.audio);state.live=structuredClone(fixture.live);state.planning=structuredClone(fixture.planning);state.dashboard=null;state.remotePairing=null;state.twitchRewards=null;syncStreamerPing();render()}toast(state.runtime?'Mode Runtime activé':'Mode Démo activé')};
window.addEventListener('keydown',e=>{if(e.altKey&&['1','2','3','4'].includes(e.key)){e.preventDefault();state.view=['home','live','sounds','planning'][+e.key-1];render()}});
setInterval(()=>{if(state.runtime&&state.timerRunning){state.seconds=Math.max(0,state.seconds-1);if(state.view==='live')render()}},1000);
window.addEventListener('beforeunload',closeRuntimeSocket);
render();runtimeUi(false,'Aucune commande réelle');
