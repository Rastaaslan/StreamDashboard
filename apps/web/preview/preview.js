import { fixture } from './fixtures.js';
import { expandRecurringItems } from '/mobile/shared/recurrence.js';
import { buildPlanningPng } from '/mobile/planning-export.js';

const officialRuntime=new URLSearchParams(location.search).get('runtime')==='1';
const demoProductProfile={
  version:1,
  profile:{displayName:'Streamer',channelName:'',language:'fr'},
  modules:{obs:true,twitch:true,planning:true,notes:true,checklist:true,templates:true,automations:true,soundboard:true,streamerPings:true,googleCalendar:false,discord:false,streamlabs:false,wizebot:false},
  appearance:{theme:'system',preset:'minimal',accent:'#2474e5',density:'normal',radius:'medium',textScale:'normal'},
  mobile:{notifications:true,haptics:true},
  providers:{twitch:{mode:'official'},google:{mode:'official'},discord:{mode:'official'},streamlabs:{mode:'custom'},wizebot:{mode:'custom'}},
  onboarding:{completed:false},
  obs:{scenes:[],quickActions:[]}
};
const demoModuleStates=[
  ['obs','OBS'],['twitch','Twitch'],['planning','Planning'],['notes','Notes'],['checklist','Avant le live'],['templates','Modèles de live'],['automations','Automatisations'],['soundboard','Sons'],['streamerPings','Alertes viewers'],['googleCalendar','Google Calendar'],['discord','Discord'],['streamlabs','Streamlabs'],['wizebot','WizeBot']
].map(([id,label])=>({id,label,enabled:demoProductProfile.modules[id],availability:'available',dependencies:[],capabilities:[],blockedBy:[]}));
const state={
  view:'home',runtime:officialRuntime,scene:fixture.live.scene,timerRunning:true,seconds:36,
  sounds:structuredClone(fixture.sounds),audio:structuredClone(fixture.audio),live:structuredClone(fixture.live),
  planning:structuredClone(fixture.planning),dashboard:null,soundboard:null,obsSetup:null,search:'',soundCategory:'',soundFavorites:false,
  soundMasterVolume:Math.max(0,Math.min(1,Number(localStorage.getItem('streamdashboard.desktopSoundboardVolume')??1)||1)),
  productProfile:structuredClone(demoProductProfile),moduleStates:structuredClone(demoModuleStates),connections:[],
  campItem:'Préparation',remotePairing:null,twitchRewards:null,companion:null,supports:null,automations:null,automationCapabilities:null,streamlabsOAuth:null,
  diagnostics:null,pingHistory:null,planningFilter:'upcoming',planningPeriod:'this-week',eventEdit:null,
  automationEditor:{id:'',name:'',trigger:'support.received',conditions:[],actions:[{type:'soundboard.play',payload:{}}],cooldownMs:30000,enabled:true},templateEditor:null
};
if(localStorage.getItem('streamdashboard.desktopSoundboardVolume')==='0')state.soundMasterVolume=0;
const view=document.querySelector('#view'),title=document.querySelector('#title'),eyebrow=document.querySelector('#eyebrow');
const commandLog=[]; window.__preview={state,commandLog};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>globalThis.crypto?.randomUUID?.()||`cmd_${Date.now()}_${Math.random().toString(36).slice(2)}`;
const viewModules={live:['obs'],sounds:['soundboard'],planning:['planning']};
const campRequirements={
  'Préparation':['checklist'],'Notes':['notes'],'Templates':['templates'],'Soutiens':['streamlabs'],
  'Automatisations':['automations'],'Médias OBS':['obs'],'Connexions':[],'Personnalisation':[],'Réglages':[],'Diagnostics':[]
};
const moduleEnabled=id=>state.productProfile?.modules?.[id]!==false;
const viewEnabled=id=>!viewModules[id]||viewModules[id].some(moduleEnabled);
const campItemEnabled=item=>!campRequirements[item]||campRequirements[item].length===0||campRequirements[item].some(moduleEnabled);
function applyProductAppearance(){
  const appearance=state.productProfile?.appearance||demoProductProfile.appearance;
  for(const key of ['theme','preset','density','radius'])document.documentElement.dataset[key]=appearance[key]||demoProductProfile.appearance[key];
  document.documentElement.style.setProperty('--product-accent',appearance.accent||demoProductProfile.appearance.accent);
  document.documentElement.style.setProperty('--product-font-scale',appearance.textScale==='large'?'1.15':appearance.textScale==='small'?'.9':'1');
}
function projectProductShell(){
  document.querySelectorAll('[data-view]').forEach(button=>{
    if(button.dataset.view==='camp'||button.dataset.view==='home')button.hidden=false;
    else button.hidden=!viewEnabled(button.dataset.view);
  });
  if(!viewEnabled(state.view))state.view='home';
  const context=state.productProfile?.profile?.channelName||state.productProfile?.profile?.displayName||'Desktop';
  const brand=document.querySelector('#brand-context');if(brand)brand.textContent=state.runtime?context:`${context} · Aperçu`;
  const preview=document.querySelector('#preview-mode');if(preview)preview.hidden=state.runtime;
  const twitchPublish=document.querySelector('#event-publish-twitch')?.closest('label');if(twitchPublish)twitchPublish.hidden=!moduleEnabled('twitch');
  const googlePublish=document.querySelector('#event-publish-google')?.closest('label');if(googlePublish)googlePublish.hidden=!moduleEnabled('googleCalendar');
  const twitchCategory=document.querySelector('#event-twitch-category')?.closest('label');if(twitchCategory)twitchCategory.hidden=!moduleEnabled('twitch');
  document.title=state.runtime?'StreamDashboard':'StreamDashboard Desktop Preview';
}
function applyProduct(product,connections=[]){
  if(product?.profile)state.productProfile=structuredClone(product.profile);
  if(Array.isArray(product?.modules))state.moduleStates=structuredClone(product.modules);
  state.connections=Array.isArray(connections)?structuredClone(connections):structuredClone(connections?.items||[]);
  applyProductAppearance();projectProductShell();
}
function toast(message,bad=false){const el=document.querySelector('#toast');el.textContent=message;el.classList.toggle('bad',bad);el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),1800)}
async function request(path,options={}){const response=await fetch(path,{headers:{'content-type':'application/json',...(options.headers||{})},...options});const body=response.status===204?null:await response.json().catch(()=>({}));if(!response.ok)throw new Error(body?.error?.message||body?.message||body?.errorCode||body?.error||`HTTP ${response.status}`);return body}
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
    const [dashboard,soundboard,setup,product,connections]=await Promise.all([
      request('/api/v1/state'),
      request('/api/v1/soundboard'),
      request('/api/v1/soundboard/obs/status').catch(()=>null),
      request('/api/v1/profile'),
      request('/api/v1/connections')
    ]);
    applyProduct(product,connections);
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
  const from=Date.now()-366*86_400_000,to=Date.now()+730*86_400_000;
  state.planning=expandRecurringItems(d.planning||[],{from,to}).sort((a,b)=>Date.parse(a.startAtUtc)-Date.parse(b.startAtUtc)).map(item=>{const start=new Date(item.startAtUtc);return{raw:item,day:start.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric'}),date:start.toLocaleDateString('fr-FR'),time:start.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}),title:item.title,kind:item.category==='live'?'Twitch':item.category==='personal'?'Personnel':'Production'}});
  syncStreamerPing();
}
function formatDuration(seconds){const n=Math.max(0,Math.floor(Number(seconds)||0));return`${String(Math.floor(n/3600)).padStart(2,'0')}:${String(Math.floor(n/60)%60).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`}
const primaryScenes=['Intro','Gameplay','Chatting','Pause','Fin'];
const OBS_SOUNDBOARD_INPUT='StreamDashboard • Soundboard';
const publicObsMediaInputs=values=>(values||[]).filter(input=>input!==OBS_SOUNDBOARD_INPUT);
const scenes=()=>`<div class="scene-grid">${primaryScenes.map(name=>`<button class="scene ${logicalScene(state.scene)===name?'active':''}" data-scene="${name}" aria-pressed="${logicalScene(state.scene)===name}">${name}</button>`).join('')}</div>`;
function filteredSounds(){const query=state.search.trim().toLowerCase();return(state.sounds||[]).filter(sound=>(!query||String(sound.name).toLowerCase().includes(query)||String(sound.category).toLowerCase().includes(query))&&(!state.soundCategory||sound.category===state.soundCategory)&&(!state.soundFavorites||sound.favorite===true))}
const sounds=(editable=false)=>Object.entries(filteredSounds().reduce((groups,s)=>{(groups[s.category||'Sans catégorie']??=[]).push(s);return groups},{})).map(([category,items])=>`<div class="group"><h3>${esc(category)}</h3><div class="pads">${items.map(s=>`<div class="sound-item"><button class="pad ${s.sourceAvailable===false?'missing':''}" data-sound="${esc(s.id)}" ${s.enabled===false?'disabled':''}>${esc(s.name)}${s.sourceAvailable===false?' · absent':''}</button>${editable?`<button class="edit-sound" data-edit-sound="${esc(s.id)}" aria-label="Modifier ${esc(s.name)}">•••</button>`:''}</div>`).join('')}</div></div>`).join('');
function onboardingCard(){
  if(state.productProfile?.onboarding?.completed!==false)return'';
  return `<section class="section onboarding-card"><div><span class="eyebrow">PREMIER DÉMARRAGE</span><h2>Configure StreamDashboard à ton image</h2><p class="help">Choisis les modules, l’apparence et les modes de connexion. Rien ne bloque l’utilisation du cockpit.</p></div><button class="action" data-open-personalization>Configurer</button></section>`;
}
const nextLiveCopy=()=>{
  const item=state.dashboard?.nextLive;if(!item)return{title:'Aucun live planifié',when:'Ajoute ton prochain live depuis Planning'};
  const start=new Date(item.startAtUtc);return{title:item.title||'Live',when:start.toLocaleString('fr-FR',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})};
};
const checklistCopy=()=>{
  const items=state.dashboard?.checklist||[];const done=items.filter(item=>item.done).length;
  return items.length?`${done}/${items.length} prêts`:'Aucune checklist';
};
function home(){
  const next=nextLiveCopy(),obsConnected=state.dashboard?.obs?.connected===true,twitchConnected=state.dashboard?.twitch?.connected===true;
  const canStream=moduleEnabled('obs');
  const health=[
    moduleEnabled('obs')?`<div><span class="label">OBS</span><b class="${obsConnected?'ok-copy':'warning-copy'}">${obsConnected?'Connecté':'À connecter'}</b></div>`:'',
    moduleEnabled('twitch')?`<div><span class="label">Twitch</span><b class="${twitchConnected?'ok-copy':'warning-copy'}">${twitchConnected?'Connecté':'À connecter'}</b></div>`:'',
    moduleEnabled('checklist')?`<div><span class="label">Préparation</span><b>${esc(checklistCopy())}</b></div>`:'',
    `<div><span class="label">Prochain live</span><b>${esc(next.when)}</b></div>`
  ].join('');
  return`<div class="stack">
    ${onboardingCard()}
    <section class="home-hero">
      <div class="home-live-copy"><span class="live-pill">${state.live.active?'● EN DIRECT':'○ PRÊT'}</span><h2>${esc(state.live.title||'Prêt à streamer')}</h2><p>${esc(state.live.category||'—')}${state.live.active?` · ${esc(state.live.duration)}`:''}</p></div>
      ${canStream?`<button class="${state.live.active?'critical':'action'} home-primary" data-live-toggle>${state.live.active?'Arrêter le live':'Démarrer le live'}</button>`:''}
    </section>
    <section class="section home-next"><div><span class="eyebrow">À VENIR</span><h2>${esc(next.title)}</h2><p class="help">${esc(next.when)}</p></div>${moduleEnabled('planning')?'<button class="secondary" data-go-view="planning">Ouvrir le planning</button>':''}</section>
    <section class="section"><div class="section-head"><h2>État de préparation</h2>${moduleEnabled('checklist')?'<button class="secondary" data-open-camp="Préparation">Préparer</button>':''}</div><div class="readiness-grid">${health}</div></section>
  </div>`
}
function chatMessages(){
  const messages=state.dashboard?.controlHub?.chat?.messages||[];
  if(!messages.length)return'<div class="empty-chat"><b>Le chat est calme</b><span>Les nouveaux messages apparaîtront ici.</span></div>';
  return messages.slice(-80).map(message=>`<article class="desktop-chat-row"><div><b>${esc(message.chatter?.displayName||'Viewer')}</b><time>${esc(new Date(message.receivedAt||Date.now()).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}))}</time></div><p>${esc(message.text||'')}</p></article>`).join('');
}
function live(){
  const audience=state.dashboard?.controlHub?.audience||{},chat=state.dashboard?.controlHub?.chat||{};
  const twitchPanel=moduleEnabled('twitch')?`<aside class="section live-chat-panel">
    <div class="section-head"><div><h2>Chat</h2><span class="label">${chat.connected?'Connecté':'Hors ligne'} · ${Number.isInteger(audience.viewerCount)?audience.viewerCount:'—'} viewers</span></div><button class="secondary compact-button" data-live-clip>Créer un clip</button></div>
    <div class="desktop-chat-list">${chatMessages()}</div>
    <form id="desktop-chat-form" class="desktop-chat-compose"><input name="message" maxlength="500" placeholder="Écrire dans le chat…" autocomplete="off" ${chat.connected?'':'disabled'}><button class="action" ${chat.connected?'':'disabled'}>Envoyer</button></form>
    <details class="audience-details"><summary>Audience · ${(audience.chatters||[]).length} présents</summary><div class="audience-list">${(audience.chatters||[]).slice(0,100).map(person=>`<span><b>${esc(person.displayName)}</b><small>${esc(person.role||'viewer')}</small></span>`).join('')||'<span class="help">Aucun chatter chargé.</span>'}</div></details>
  </aside>`:'';
  return`<div class="live-desktop-grid">
    <div class="live-main stack">
      <section class="live-hero-desktop">
        <div><span class="live-pill">${state.live.active?'● EN DIRECT':'○ PRÊT'}</span><h2>${esc(state.live.title||'Prêt à streamer')}</h2><p>${esc(state.live.category||'—')} · ${esc(state.live.duration)}</p></div>
        <div class="live-hero-actions">${moduleEnabled('twitch')?`<span><b>${esc(state.live.viewers??'—')}</b><small>viewers</small></span>`:''}<button class="${state.live.active?'critical':'action'}" data-live-toggle>${state.live.active?'Arrêter':'Démarrer'}</button></div>
      </section>
      <section class="section"><div class="section-head"><div><h2>Scènes</h2><span class="label">Active · ${esc(state.scene)}</span></div></div>${scenes()}</section>
      <div class="cockpit-secondary">
        <section class="section"><div class="section-head"><h2>Audio</h2><span class="label">Sources actives</span></div>${state.audio.map((a,i)=>`<div class="audio-row"><b>${esc(a.name)}${a.primary?' · principal':''}</b><button data-mute="${i}" aria-label="${a.muted?'Réactiver':'Couper'} ${esc(a.name)}">${a.muted?'OFF':'ON'}</button><div class="meter"><i style="width:${a.level}%"></i></div><span>${a.volume}%</span></div>`).join('')||'<p class="label">Aucune source audio active.</p>'}</section>
        <section class="section timer"><div class="section-head"><h2>Timer</h2></div><b class="timer-value">${formatDuration(state.seconds)}</b><div class="timer-actions"><button class="action" data-timer="minus">−1 min</button><button class="action" data-timer="toggle">${state.timerRunning?'Pause':'Play'}</button><button class="action" data-timer="plus">+1 min</button><button class="action" data-timer="reset">Reset</button></div></section>
      </div>
    </div>
    ${twitchPanel}
  </div>`
}
function soundboard(){
  const setup=state.obsSetup,soundsList=state.sounds||[],categories=[...new Set(soundsList.map(sound=>sound.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'fr'));
  const playback=state.soundboard?.currentPlayback,current=soundsList.find(sound=>sound.id===playback?.soundId);
  const label=state.runtime?(setup?.ready?'Mix OBS prêt':setup?.connected?'Configuration OBS à terminer':'OBS hors ligne'):'Mode Démo';
  return`<div class="stack soundboard-workspace">
    <section class="soundboard-hero">
      <div><span class="eyebrow">BIBLIOTHÈQUE</span><h2>Soundboard</h2><p>${esc(label)} · ${soundsList.length} ${soundsList.length===1?'son':'sons'}</p></div>
      <div class="soundboard-playback"><span class="label">Lecture</span><b>${esc(current?.name||'Aucune')}</b><button class="critical" data-stop ${playback||!state.runtime?'':'disabled'}>Stop</button></div>
    </section>
    <section class="section soundboard-library">
      <div class="soundboard-filters">
        <input type="search" value="${esc(state.search)}" placeholder="Rechercher un son" aria-label="Rechercher un son" data-sound-search>
        <select data-sound-category aria-label="Catégorie"><option value="">Toutes les catégories</option>${categories.map(category=>`<option value="${esc(category)}" ${state.soundCategory===category?'selected':''}>${esc(category)}</option>`).join('')}</select>
        <label class="favorite-filter"><input type="checkbox" data-sound-favorites ${state.soundFavorites?'checked':''}> Favoris</label>
        <button class="action" data-add-sound>+ Ajouter un son</button>
      </div>
      <div class="sound-master"><label><span>Volume général</span><input type="range" min="0" max="100" value="${Math.round(state.soundMasterVolume*100)}" data-sound-master aria-label="Volume général de la Soundboard"></label><b>${Math.round(state.soundMasterVolume*100)}%</b></div>
      <div class="sound-groups">${sounds(true)||'<div class="empty-library"><b>Aucun son</b><span>Modifie les filtres ou ajoute un son à la bibliothèque.</span></div>'}</div>
      <details class="soundboard-advanced"><summary>Configuration OBS</summary><div><p class="help">StreamDashboard utilise une Media Source interne dédiée dans OBS. Elle reste masquée des médias utilisateur.</p><button class="secondary" data-obs-setup>Vérifier / réparer la Soundboard OBS</button></div></details>
    </section>
  </div>`
}
function planningItems(){
  const now=Date.now();
  return (state.planning||[]).filter(entry=>state.planningFilter==='all'||(state.planningFilter==='past'?Date.parse(entry.raw.endAtUtc)<now:Date.parse(entry.raw.endAtUtc)>=now));
}
function providerCopy(item){
  if(item.conflict)return '⚠ Conflit';
  const values=[];
  for(const provider of ['twitch','google']){const link=item.providers?.[provider];if(link?.status)values.push(`${provider==='twitch'?'Twitch':'Google'} ${link.status}`)}
  return values.join(' · ');
}
function planning(){
  const items=planningItems();state.visiblePlanning=items;
  return `<section class="section planning-surface">
    <div class="section-head planning-head">
      <div><h2>Planning</h2><span class="label">${state.planningFilter==='past'?'Historique':state.planningFilter==='all'?'Tous les événements':'Planning à venir'}</span></div>
      <button class="action" data-add-event>+ Nouvel événement</button>
    </div>
    <div class="planning-primary-tools"><select data-planning-filter aria-label="Filtrer le planning"><option value="upcoming" ${state.planningFilter==='upcoming'?'selected':''}>À venir</option><option value="past" ${state.planningFilter==='past'?'selected':''}>Passés</option><option value="all" ${state.planningFilter==='all'?'selected':''}>Tous</option></select><details class="planning-more"><summary>Partager & exporter</summary><div><select data-planning-period aria-label="Période d’export"><option value="today" ${state.planningPeriod==='today'?'selected':''}>Aujourd’hui</option><option value="this-week" ${state.planningPeriod==='this-week'?'selected':''}>Cette semaine</option><option value="next-week" ${state.planningPeriod==='next-week'?'selected':''}>Semaine prochaine</option></select><button class="secondary" data-planning-export>Exporter l’image</button>${moduleEnabled('discord')?`<button class="secondary" data-planning-discord ${state.dashboard?.discord?.configured?'':'disabled'}>Publier sur Discord</button>`:''}</div></details></div>
    <div class="agenda">${items.slice(0,40).map((e,index)=>`<button class="event" data-event-index="${index}"><span class="event-when"><b>${esc(e.day)}</b><small>${esc(e.time)}</small></span><strong>${esc(e.title)}</strong><span class="kind">${esc([e.kind,providerCopy(e.raw)].filter(Boolean).join(' · '))}</span><i>›</i></button>`).join('')||'<p class="label">Aucun événement pour ce filtre.</p>'}</div>
  </section>`;
}
const campGroups=[
  {label:'PRÉPARER',items:['Préparation','Notes','Templates']},
  {label:'COMMUNAUTÉ',items:['Soutiens']},
  {label:'AUTOMATISER',items:['Automatisations','Médias OBS']},
  {label:'APPLICATION',items:['Connexions','Personnalisation','Réglages','Diagnostics']}
];
const campItems=campGroups.flatMap(group=>group.items);
const connectionLabel=status=>({CONNECTED:'Connecté',CONNECTING:'Connexion…',DISCONNECTED:'Déconnecté',NOT_CONFIGURED:'À configurer',NOT_SUPPORTED:'Non disponible',DEGRADED:'Connexion instable',ERROR:'Erreur'})[status]||'À configurer';
const runtimeDisabled=()=>state.runtime?'':' disabled';
const connectionModuleByName={OBS:'obs',Twitch:'twitch','Google Calendar':'googleCalendar',Discord:'discord',Streamlabs:'streamlabs',WizeBot:'wizebot'};
function connectionCard(name,status,content=''){const module=connectionModuleByName[name];if(module&&!moduleEnabled(module))return'';return`<article class="setup-status connection-card"><div class="section-head"><b>${esc(name)}</b><span class="label">${esc(status)}</span></div>${content}</article>`}
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
    ${connectionCard('Streamlabs',connectionLabel(streamlabs.status),`<form id="preview-streamlabs-oauth-form" class="connection-form"><div class="toolbar"><input name="clientId" maxlength="500" autocomplete="off" placeholder="${state.streamlabsOAuth?.configured?'Client ID enregistré · saisir les deux pour remplacer':'Client ID Streamlabs'}"${runtimeDisabled()}><input name="clientSecret" type="password" maxlength="1000" autocomplete="new-password" placeholder="${state.streamlabsOAuth?.configured?'Client Secret enregistré · saisir les deux pour remplacer':'Client Secret Streamlabs'}"${runtimeDisabled()}></div><div class="connection-actions"><button class="secondary" type="submit"${runtimeDisabled()}>Enregistrer les identifiants</button><button class="action" type="button" data-connection-action="streamlabs-oauth-connect" ${state.streamlabsOAuth?.configured?'':'disabled'}> ${streamlabs.status==='CONNECTED'?'Réautoriser Streamlabs':'Connecter Streamlabs'}</button><button class="secondary" type="button" data-connection-action="streamlabs-test"${runtimeDisabled()}>Test interne</button><button class="action" type="button" data-connection-action="streamlabs-test-real" ${state.streamlabsOAuth?.authorized&&streamlabs.status==='CONNECTED'?'':'disabled'}>Test réel Streamlabs</button><button class="critical" type="button" data-connection-action="streamlabs-disconnect"${runtimeDisabled()}>Déconnecter</button></div><p class="help">OAuth Streamlabs · scopes socket.token + donations.create · le test réel déclenche l’Alert Box et vérifie le retour Socket.</p></form><details class="more-details"><summary>Configuration avancée · Socket Token manuel</summary><form id="preview-streamlabs-form" class="toolbar"><input name="token" type="password" maxlength="1000" autocomplete="new-password" placeholder="Token Socket API"${runtimeDisabled()}><button class="secondary" type="submit"${runtimeDisabled()}>Configurer manuellement</button></form></details>`)}
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

const euro=(amountMinor,currency='EUR')=>{try{return new Intl.NumberFormat('fr-FR',{style:'currency',currency}).format((Number(amountMinor)||0)/100)}catch{return `${(Number(amountMinor)||0)/100} ${currency}`}};
const triggerLabels={
  'support.received':'Soutien reçu','test.support':'Test soutien','twitch.reward.redeemed':'Récompense Twitch',
  'streamer.ping.received':'Streamer Ping','stream.started':'Début du live','stream.stopped':'Fin du live',
  'obs.state.changed':'État OBS','chat.message.received':'Message chat'
};
const actionLabels={'soundboard.play':'Jouer un son','obs.scene':'Changer de scène','obs.media.restart':'Relancer un média OBS','timer.add':'Ajouter au timer','timer.start':'Démarrer le timer','timer.pause':'Mettre le timer en pause'};
async function loadCompanion(){
  if(!state.runtime)return;
  state.companion=await request('/api/v1/companion/snapshot');
}
async function loadSupports(){
  if(!state.runtime)return;
  state.supports=await request('/api/v1/supports');
}
async function loadAutomations(){
  if(!state.runtime)return;
  const [values,capabilities]=await Promise.all([request('/api/v1/automations'),request('/api/v1/automations/capabilities')]);
  state.automations=values;state.automationCapabilities=capabilities;
}
async function loadDiagnostics(){
  if(!state.runtime)return;
  const [diagnostics,events]=await Promise.all([request('/api/v1/diagnostics'),request('/api/v1/events?limit=100')]);
  state.diagnostics={diagnostics,events:events.items||[]};
}
async function loadPingHistory(){
  if(!state.runtime)return;
  const history=await request('/api/v1/streamer-pings?all=1');state.pingHistory=history.items||[];
}
async function loadCampData(item=state.campItem){
  if(!state.runtime)return;
  try{
    if(['Préparation','Notes','Templates'].includes(item))await loadCompanion();
    else if(item==='Soutiens')await loadSupports();
    else if(item==='Automatisations')await loadAutomations();
    else if(item==='Connexions')state.streamlabsOAuth=await request('/api/v1/supports/streamlabs/oauth/status');
    else if(item==='Diagnostics')await loadDiagnostics();
    else if(item==='Réglages'){
      await Promise.all([loadPingHistory(),state.dashboard?.twitch?.redemptionsAvailable===true?request('/api/v1/twitch/rewards').then(result=>{state.twitchRewards=result.items||[]}):Promise.resolve()]);
    }
    if(state.view==='camp'&&state.campItem===item&&!editableFocus())render();
  }catch(error){toast(error.message,true)}
}
function preparationContent(){
  const items=state.companion?.checklist||state.dashboard?.checklist||[];
  const done=items.filter(item=>item.done===true).length;
  return `<div class="connection-stack"><div class="setup-status"><div class="section-head"><div><b>Checklist avant direct</b><span class="label">${done} / ${items.length} terminés</span></div><div class="connection-actions"><button class="secondary" data-camp-action="prepare">Préparer le direct</button><button class="secondary" data-camp-action="check-reset">Tout décocher</button></div></div><div class="camp-list">${items.map(item=>`<div class="camp-row"><button class="check-button ${item.done?'active':''}" data-check-toggle="${esc(item.id)}">${item.done?'✓':'○'} ${esc(item.label)}</button><button class="critical" data-check-delete="${esc(item.id)}">Suppr.</button></div>`).join('')||'<p class="help">Checklist vide.</p>'}</div><form id="camp-check-add" class="toolbar"><input name="label" maxlength="500" placeholder="Nouvel élément" required><button class="action">Ajouter</button></form></div></div>`;
}
function notesContent(){
  const notes=state.companion?.notes||[];
  return `<div class="connection-stack"><div class="setup-status"><div class="section-head"><b>Notes</b><span class="label">${notes.length} note${notes.length>1?'s':''}</span></div><div class="camp-list">${notes.map(note=>`<div class="camp-note"><textarea data-note-value="${esc(note.id)}" maxlength="500">${esc(note.text||'')}</textarea><div class="connection-actions"><button class="secondary" data-note-save="${esc(note.id)}">Enregistrer</button><button class="critical" data-note-delete="${esc(note.id)}">Supprimer</button></div></div>`).join('')||'<p class="help">Aucune note pour le moment.</p>'}</div><form id="camp-note-add"><label class="label">Nouvelle note<textarea name="text" maxlength="500" required></textarea></label><button class="action">Ajouter la note</button></form></div></div>`;
}
function templateEditorContent(){
  const t=state.templateEditor||{};
  return `<form id="camp-template-form" class="setup-status"><input type="hidden" name="id" value="${esc(t.id||'')}"><div class="section-head"><b>${t.id?'Modifier le template':'Nouveau template'}</b>${t.id?'<button type="button" class="secondary" data-template-new>Nouveau</button>':''}</div><label class="label">Nom<input name="title" maxlength="140" value="${esc(t.title||'')}" required></label><label class="label">Description<textarea name="description" maxlength="4000">${esc(t.description||'')}</textarea></label><div class="toolbar"><input id="camp-template-category" name="categoryName" maxlength="80" value="${esc(t.twitchCategoryName||'')}" placeholder="Catégorie Twitch"><input id="camp-template-category-id" name="categoryId" type="hidden" value="${esc(t.twitchCategoryId||'')}"><button type="button" class="secondary" data-template-category-search>Rechercher</button></div><select id="camp-template-category-results" hidden></select><div class="checks"><label><input name="publishTwitch" type="checkbox" ${t.desiredPublication?.twitch?'checked':''}> Twitch</label><label><input name="publishGoogle" type="checkbox" ${t.desiredPublication?.google?'checked':''}> Google</label></div><button class="action">Enregistrer le template</button></form>`;
}
function templatesContent(){
  const templates=state.companion?.templates||[];
  return `<div class="connection-stack"><div class="camp-list">${templates.map(template=>`<article class="setup-status"><div class="section-head"><div><b>${esc(template.title||'Template')}</b><span class="label">${esc([template.twitchCategoryName,template.desiredPublication?.twitch?'Twitch':'',template.desiredPublication?.google?'Google':''].filter(Boolean).join(' · ')||'Local')}</span></div><div class="connection-actions"><button class="action" data-template-use="${esc(template.id)}">Créer un événement</button><button class="secondary" data-template-edit="${esc(template.id)}">Modifier</button><button class="critical" data-template-delete="${esc(template.id)}">Supprimer</button></div></div>${template.description?`<p class="help">${esc(template.description)}</p>`:''}</article>`).join('')||'<p class="help">Aucun template.</p>'}</div>${templateEditorContent()}</div>`;
}
function supportsContent(){
  const values=state.supports;
  if(!values)return '<p class="help">Chargement des soutiens…</p>';
  const totals=values.totals||{};
  const totalBlock=key=>Object.entries(totals[key]||{}).map(([currency,amount])=>euro(amount,currency)).join(' · ')||'—';
  return `<div class="connection-stack"><div class="support-summary"><article class="setup-status"><span class="label">Session</span><b>${esc(totalBlock('session'))}</b></article><article class="setup-status"><span class="label">Aujourd’hui</span><b>${esc(totalBlock('day'))}</b></article><article class="setup-status"><span class="label">Ce mois</span><b>${esc(totalBlock('month'))}</b></article></div><div class="connection-actions"><button class="secondary" data-camp-action="supports-refresh">Rafraîchir</button><button class="secondary" data-camp-action="supports-test">Test interne 1 €</button><button class="action" data-camp-action="supports-test-real">Test réel Streamlabs 1 €</button></div><div class="camp-list">${(values.history||[]).slice().reverse().slice(0,50).map(support=>`<div class="camp-row"><span><b>${esc(support.displayName||'Anonyme')}</b><small>${esc(support.message||'')}</small></span><strong>${esc(euro(support.amountMinor,support.currency))}</strong></div>`).join('')||'<p class="help">Aucun soutien enregistré.</p>'}</div></div>`;
}
function conditionRow(condition={},index=0){
  return `<div class="automation-row-fields" data-condition-row="${index}"><input data-condition-path value="${esc(condition.path||'')}" placeholder="Chemin, ex. reward.id"><select data-condition-operator><option value="eq" ${condition.operator==='eq'?'selected':''}>=</option><option value="gte" ${condition.operator==='gte'?'selected':''}>≥</option></select><input data-condition-value value="${esc(condition.value??'')}" placeholder="Valeur"><button type="button" class="critical" data-condition-remove="${index}">×</button></div>`;
}
function actionFields(action,index){
  const type=action.type||'soundboard.play',payload=action.payload||{};
  if(type==='soundboard.play')return `<select data-action-param="soundId">${(state.sounds||[]).map(sound=>`<option value="${esc(sound.id)}" ${payload.soundId===sound.id?'selected':''}>${esc(sound.name)}</option>`).join('')}</select><input data-action-param="volume" type="number" min="0" max="1.5" step=".05" value="${esc(payload.volume??1)}" aria-label="Volume">`;
  if(type==='obs.scene')return `<select data-action-param="scene">${(state.dashboard?.obs?.scenes||[]).map(scene=>`<option value="${esc(scene)}" ${payload.scene===scene?'selected':''}>${esc(scene)}</option>`).join('')}</select>`;
  if(type==='obs.media.restart')return `<select data-action-param="input">${publicObsMediaInputs(state.dashboard?.obs?.mediaInputs).map(input=>`<option value="${esc(input)}" ${payload.input===input?'selected':''}>${esc(input)}</option>`).join('')}</select>`;
  if(type==='timer.add')return `<input data-action-param="seconds" type="number" min="-86400" max="86400" value="${esc(payload.seconds??60)}" aria-label="Secondes">`;
  if(type==='timer.start')return `<input data-action-param="seconds" type="number" min="1" max="86400" value="${esc(payload.seconds??300)}" aria-label="Durée en secondes">`;
  return '<span class="help">Aucun paramètre.</span>';
}
function actionRow(action={},index=0){
  const types=state.automationCapabilities?.actions||Object.keys(actionLabels);const current=action.type||'soundboard.play';
  return `<div class="automation-row-fields" data-action-row="${index}"><select data-action-type>${types.map(type=>`<option value="${esc(type)}" ${type===current?'selected':''}>${esc(actionLabels[type]||type)}</option>`).join('')}</select>${actionFields(action,index)}<button type="button" class="critical" data-action-remove="${index}">×</button></div>`;
}
function automationsContent(){
  if(!state.automations)return '<p class="help">Chargement des automatisations…</p>';
  const editor=state.automationEditor;
  const triggers=state.automationCapabilities?.triggers||Object.keys(triggerLabels);
  return `<div class="connection-stack"><div class="camp-list">${(state.automations.items||[]).map(auto=>`<article class="setup-status"><div class="section-head"><div><b>${auto.enabled?'●':'○'} ${esc(auto.name)}</b><span class="label">${esc(triggerLabels[auto.trigger]||auto.trigger)} · ${auto.lastResult?.status||'jamais exécutée'}</span></div><div class="connection-actions"><button class="secondary" data-auto-edit="${esc(auto.id)}">Modifier</button><button class="secondary" data-auto-toggle="${esc(auto.id)}">${auto.enabled?'Désactiver':'Activer'}</button><button class="critical" data-auto-delete="${esc(auto.id)}">Supprimer</button></div></div></article>`).join('')||'<p class="help">Aucune automatisation.</p>'}</div><form id="camp-automation-form" class="setup-status"><div class="section-head"><b>${editor.id?'Modifier l’automatisation':'Nouvelle automatisation'}</b><button type="button" class="secondary" data-auto-new>Nouvelle</button></div><label class="label">Nom<input name="name" maxlength="120" value="${esc(editor.name||'')}" required></label><label class="label">Quand<select name="trigger">${triggers.map(trigger=>`<option value="${esc(trigger)}" ${editor.trigger===trigger?'selected':''}>${esc(triggerLabels[trigger]||trigger)}</option>`).join('')}</select></label><div class="section-head"><b>Conditions</b><button type="button" class="secondary" data-condition-add>+ Condition</button></div><div id="automation-conditions">${(editor.conditions||[]).map(conditionRow).join('')||'<p class="help">Aucune condition : chaque événement correspondant déclenchera la règle.</p>'}</div><div class="section-head"><b>Actions</b><button type="button" class="secondary" data-action-add>+ Action</button></div><div id="automation-actions">${(editor.actions||[]).map(actionRow).join('')}</div><div class="form-grid"><label class="label">Cooldown (s)<input name="cooldown" type="number" min="0" max="86400" value="${Math.round((editor.cooldownMs||0)/1000)}"></label><label class="checks"><input name="enabled" type="checkbox" ${editor.enabled?'checked':''}> Activée</label></div><button class="action">Enregistrer l’automatisation</button></form></div>`;
}
function mediaContent(){
  const obs=state.dashboard?.obs||{};const media=publicObsMediaInputs(obs.mediaInputs),browsers=obs.browserInputs||[];
  return `<div class="connection-stack"><div class="setup-status"><div class="section-head"><b>Sources média OBS</b><span class="label">${media.length}</span></div><div class="pads">${media.map(input=>`<button class="pad" data-media-restart="${esc(input)}">${esc(input)}</button>`).join('')||'<p class="help">Aucune Media Source active.</p>'}</div></div><div class="setup-status"><div class="section-head"><b>Browser Sources</b><span class="label">${browsers.length}</span></div><div class="pads">${browsers.map(input=>`<button class="pad" data-browser-refresh="${esc(input)}">${esc(input)}</button>`).join('')||'<p class="help">Aucune Browser Source détectée.</p>'}</div></div></div>`;
}
function diagnosticsContent(){
  const d=state.diagnostics?.diagnostics;if(!d)return '<p class="help">Chargement des diagnostics…</p>';
  const runtime=d.runtime||{};const events=state.diagnostics?.events||[];
  return `<div class="connection-stack"><div class="support-summary"><article class="setup-status"><span class="label">Version</span><b>${esc(runtime.version||state.dashboard?.runtime?.serverVersion||'—')}</b></article><article class="setup-status"><span class="label">Uptime</span><b>${Math.round(Number(runtime.uptime)||0)} s</b></article><article class="setup-status"><span class="label">State revision</span><b>${state.dashboard?.stateRevision??'—'}</b></article></div><div class="connection-actions"><button class="secondary" data-camp-action="diagnostics-refresh">Rafraîchir</button></div>${(d.errors||[]).length?`<div class="setup-status"><b>Erreurs Runtime</b>${d.errors.slice(-10).reverse().map(error=>`<p class="warning">${esc(error.message||error)}</p>`).join('')}</div>`:''}<div class="camp-list">${events.slice().reverse().slice(0,50).map(event=>`<div class="diagnostic-line"><time>${esc(new Date(event.occurredAt).toLocaleTimeString('fr-FR'))}</time><b>${esc(event.type)}</b><span>${esc(event.source)}</span></div>`).join('')||'<p class="help">Aucun événement récent.</p>'}</div></div>`;
}
function generalSettingsContent(){
  const settings=state.dashboard?.settings||{},obs=state.dashboard?.obs||{},twitch=state.dashboard?.twitch||{};
  const sceneOptions=value=>`<option value="">—</option>${(obs.scenes||[]).map(scene=>`<option value="${esc(scene)}" ${value===scene?'selected':''}>${esc(scene)}</option>`).join('')}`;
  return `<div class="connection-stack"><form id="camp-general-settings" class="setup-status"><div class="section-head"><b>Application & OBS</b><span class="label">Réglages fonctionnels</span></div><label class="label">Nom affiché<input name="streamerName" maxlength="80" value="${esc(settings.streamerName||'')}"></label><div class="form-grid"><label class="label">Mode de démarrage<select name="startMode"><option value="intro" ${settings.startMode!=='live'?'selected':''}>Intro</option><option value="live" ${settings.startMode==='live'?'selected':''}>Live</option></select></label><label class="label">Micro principal<select name="primaryMicInput"><option value="">—</option>${Object.keys(obs.inputs||{}).map(input=>`<option value="${esc(input)}" ${settings.primaryMicInput===input?'selected':''}>${esc(input)}</option>`).join('')}</select></label></div><div class="form-grid"><label class="label">Scène Intro<select name="sceneIntro">${sceneOptions(settings.modeScenes?.intro)}</select></label><label class="label">Scène Gameplay<select name="sceneLive">${sceneOptions(settings.modeScenes?.live)}</select></label><label class="label">Scène Chatting<select name="chattingScene">${sceneOptions(settings.chattingScene)}</select></label><label class="label">Scène Pause<select name="scenePause">${sceneOptions(settings.modeScenes?.pause)}</select></label><label class="label">Scène Fin<select name="sceneEnd">${sceneOptions(settings.modeScenes?.end)}</select></label><label class="label">Timer Browser Source<select name="timerBrowserSource"><option value="">—</option>${(obs.browserInputs||[]).map(input=>`<option value="${esc(input)}" ${settings.timerBrowserSource===input?'selected':''}>${esc(input)}</option>`).join('')}</select></label></div><div class="checks"><label><input name="confirmStop" type="checkbox" ${settings.confirmStop?'checked':''}> Confirmation avant arrêt</label><label><input name="launchObs" type="checkbox" ${settings.launchObs?'checked':''}> Lancer OBS avec StreamDashboard</label><label><input name="requireTimerOverlayOnStart" type="checkbox" ${settings.requireTimerOverlayOnStart?'checked':''}> Exiger le timer au démarrage</label></div><button class="action">Enregistrer les réglages</button></form><form id="camp-twitch-live-settings" class="setup-status"><div class="section-head"><b>Informations Twitch</b><span class="label">${twitch.connected?'Connecté':'Déconnecté'}</span></div><label class="label">Titre<input name="title" maxlength="140" value="${esc(twitch.channelTitle||'')}" ${twitch.connected?'':'disabled'}></label><div class="toolbar"><input id="camp-twitch-category" name="gameName" maxlength="80" value="${esc(twitch.gameName||'')}" placeholder="Catégorie Twitch" ${twitch.connected?'':'disabled'}><input id="camp-twitch-game-id" name="gameId" type="hidden" value="${esc(twitch.gameId||'')}"><button type="button" class="secondary" data-twitch-category-search ${twitch.connected?'':'disabled'}>Rechercher</button></div><select id="camp-twitch-category-results" hidden></select><button class="action" ${twitch.connected?'':'disabled'}>Mettre à jour Twitch</button></form></div>`;
}
function pingHistoryContent(){
  const history=state.pingHistory||[];const pending=history.filter(ping=>!ping.acknowledgedAt).length;
  return `<div class="setup-status"><div class="section-head"><div><b>Historique Streamer Pings</b><span class="label">${pending} en attente · ${history.length} conservés</span></div><div class="connection-actions"><button class="secondary" data-ping-action="ack-all" ${pending?'':'disabled'}>Tout marquer vu</button><button class="critical" data-ping-action="clear-history">Effacer les acquittés</button></div></div><div class="camp-list">${history.slice(0,20).map(ping=>`<div class="camp-row"><span><b>${esc(ping.rewardTitle)}</b><small>${esc(ping.userName)} · ${esc(new Date(ping.createdAt).toLocaleString('fr-FR'))}</small></span><span class="${ping.acknowledgedAt?'label':'kind'}">${ping.acknowledgedAt?'Vu':'En attente'}</span></div>`).join('')||'<p class="help">Aucun Streamer Ping enregistré.</p>'}</div></div>`;
}
const profileModuleDependencies={soundboard:['obs'],streamerPings:['twitch'],googleCalendar:['planning']};
function normalizedProfileModules(modules){
  const next={...modules};
  for(const [id,dependencies] of Object.entries(profileModuleDependencies))if(next[id])for(const dependency of dependencies)next[dependency]=true;
  return next;
}
function profileModuleStates(profile){
  const source=state.moduleStates?.length?state.moduleStates:demoModuleStates;
  return source.map(module=>({...module,enabled:profile.modules?.[module.id]!==false}));
}
function personalizationContent(){
  const profile=state.productProfile||demoProductProfile,appearance=profile.appearance||demoProductProfile.appearance;
  const modules=profileModuleStates(profile);
  const providerOptions=id=>`<option value="official" ${profile.providers?.[id]?.mode!=='custom'?'selected':''}>Officiel</option><option value="custom" ${profile.providers?.[id]?.mode==='custom'?'selected':''}>Personnalisé / auto-hébergé</option>`;
  return `<div class="connection-stack product-settings">
    <form id="product-profile-form" class="setup-status">
      <div class="section-head"><div><b>Profil StreamDashboard</b><span class="label">Partagé entre les interfaces</span></div></div>
      <div class="form-grid">
        <label class="label">Nom affiché<input name="displayName" maxlength="80" value="${esc(profile.profile?.displayName||'')}"></label>
        <label class="label">Chaîne / espace<input name="channelName" maxlength="120" value="${esc(profile.profile?.channelName||'')}"></label>
      </div>
      <label class="label">Langue<input name="language" maxlength="12" value="${esc(profile.profile?.language||'fr')}"></label>

      <div class="section-head product-section-head"><div><b>Apparence</b><span class="label">Neutre par défaut, personnalisable</span></div></div>
      <div class="appearance-grid">
        <label class="label">Thème<select name="theme"><option value="system" ${appearance.theme==='system'?'selected':''}>Système</option><option value="light" ${appearance.theme==='light'?'selected':''}>Clair</option><option value="dark" ${appearance.theme==='dark'?'selected':''}>Sombre</option><option value="oled" ${appearance.theme==='oled'?'selected':''}>OLED</option></select></label>
        <label class="label">Preset<select name="preset"><option value="minimal" ${appearance.preset==='minimal'?'selected':''}>Minimal</option><option value="soft" ${appearance.preset==='soft'?'selected':''}>Doux</option><option value="compact" ${appearance.preset==='compact'?'selected':''}>Compact</option><option value="contrast" ${appearance.preset==='contrast'?'selected':''}>Contraste</option></select></label>
        <label class="label">Couleur principale<input name="accent" type="color" value="${esc(appearance.accent||'#2474e5')}"></label>
        <label class="label">Densité<select name="density"><option value="compact" ${appearance.density==='compact'?'selected':''}>Compacte</option><option value="normal" ${appearance.density==='normal'?'selected':''}>Normale</option><option value="comfort" ${appearance.density==='comfort'?'selected':''}>Confort</option></select></label>
        <label class="label">Arrondis<select name="radius"><option value="square" ${appearance.radius==='square'?'selected':''}>Carrés</option><option value="medium" ${appearance.radius==='medium'?'selected':''}>Moyens</option><option value="round" ${appearance.radius==='round'?'selected':''}>Arrondis</option></select></label>
        <label class="label">Taille du texte<select name="textScale"><option value="small" ${appearance.textScale==='small'?'selected':''}>Petite</option><option value="normal" ${appearance.textScale==='normal'?'selected':''}>Normale</option><option value="large" ${appearance.textScale==='large'?'selected':''}>Grande</option></select></label>
      </div>

      <div class="section-head product-section-head"><div><b>Modules</b><span class="label">Les modules désactivés disparaissent de l’interface</span></div></div>
      <div class="module-grid">
        ${modules.map(module=>`<label class="module-toggle"><input type="checkbox" data-profile-module="${esc(module.id)}" ${profile.modules?.[module.id]!==false?'checked':''}><span><b>${esc(module.label)}</b>${module.blockedBy?.length?`<small>Dépend de ${esc(module.blockedBy.join(', '))}</small>`:''}</span></label>`).join('')}
      </div>

      <details class="more-details provider-modes">
        <summary>Modes de connexion avancés</summary>
        <p class="help">Le mode officiel vise les utilisateurs standards. Le mode personnalisé reste disponible pour les installations avancées.</p>
        <div class="form-grid">
          <label class="label">Twitch<select name="provider-twitch">${providerOptions('twitch')}</select></label>
          <label class="label">Google<select name="provider-google">${providerOptions('google')}</select></label>
          <label class="label">Discord<select name="provider-discord">${providerOptions('discord')}</select></label>
          <label class="label">Streamlabs<select name="provider-streamlabs">${providerOptions('streamlabs')}</select></label>
          <label class="label">WizeBot<select name="provider-wizebot">${providerOptions('wizebot')}</select></label>
        </div>
      </details>

      <div class="profile-actions">
        <button type="button" class="secondary" data-profile-export>Exporter YAML</button>
        <label class="profile-import secondary">Importer YAML<input type="file" accept=".yaml,.yml,.streamdashboard.yaml,text/yaml,application/yaml" data-profile-import></label>
        <span></span>
        <button class="action">Enregistrer</button>
      </div>
    </form>
  </div>`;
}
async function exportProductProfileYaml(){
  if(!state.runtime){toast('Export disponible en mode Runtime.');return}
  const response=await fetch('/api/v1/profile/export');
  if(!response.ok)throw new Error('Export du profil impossible.');
  const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download='streamdashboard.streamdashboard.yaml';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  toast('Profil YAML exporté');
}
async function importProductProfileYaml(file){
  if(!file)return;
  if(!state.runtime){toast('Import disponible en mode Runtime.',true);return}
  const product=await request('/api/v1/profile/import',{method:'POST',body:JSON.stringify({content:await file.text()})});
  const connections=await request('/api/v1/connections');
  applyProduct(product,connections);render();toast(product.backup?'Profil importé · sauvegarde créée':'Profil importé');
}
function bindProductPersonalization(){
  if(state.view!=='camp'||state.campItem!=='Personnalisation')return;
  const form=document.querySelector('#product-profile-form');if(!form)return;
  form.querySelectorAll('[data-profile-module]').forEach(input=>input.addEventListener('change',()=>{
    const id=input.dataset.profileModule;
    if(input.checked)for(const dependency of profileModuleDependencies[id]||[]){const required=form.querySelector(`[data-profile-module="${dependency}"]`);if(required)required.checked=true}
    else for(const [dependent,requirements] of Object.entries(profileModuleDependencies))if(requirements.includes(id)){const child=form.querySelector(`[data-profile-module="${dependent}"]`);if(child)child.checked=false}
  }));
  form.querySelector('[data-profile-export]')?.addEventListener('click',()=>void exportProductProfileYaml().catch(error=>toast(error.message,true)));
  form.querySelector('[data-profile-import]')?.addEventListener('change',event=>void importProductProfileYaml(event.currentTarget.files?.[0]).catch(error=>toast(error.message,true)));
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    const data=new FormData(form),next=structuredClone(state.productProfile||demoProductProfile);
    next.profile={displayName:String(data.get('displayName')||'').trim()||'Streamer',channelName:String(data.get('channelName')||'').trim(),language:String(data.get('language')||'fr').trim()||'fr'};
    const modules={...next.modules};form.querySelectorAll('[data-profile-module]').forEach(input=>{modules[input.dataset.profileModule]=input.checked});next.modules=normalizedProfileModules(modules);
    next.appearance={theme:String(data.get('theme')),preset:String(data.get('preset')),accent:String(data.get('accent')),density:String(data.get('density')),radius:String(data.get('radius')),textScale:String(data.get('textScale'))};
    for(const provider of ['twitch','google','discord','streamlabs','wizebot'])next.providers[provider]={mode:String(data.get(`provider-${provider}`))};
    next.onboarding={completed:true};
    try{
      if(state.runtime){const product=await request('/api/v1/profile',{method:'PUT',body:JSON.stringify(next)});const connections=await request('/api/v1/connections');applyProduct(product,connections)}
      else applyProduct({profile:next,modules:profileModuleStates(next)},[]);
      render();toast('Personnalisation enregistrée');
    }catch(error){toast(error.message,true)}
  });
}
function settingsContent(){
  return `${generalSettingsContent()}${moduleEnabled('streamerPings')?`<div class="connection-stack">${streamerPingSettings()}${pingHistoryContent()}</div>`:''}`;
}
function campContent(item){
  if(item==='Personnalisation')return personalizationContent();
  if(!state.runtime&&item!=='Connexions')return '<p class="help">Passe en mode Runtime pour utiliser les données réelles de cette section.</p>';
  if(item==='Préparation')return preparationContent();
  if(item==='Notes')return notesContent();
  if(item==='Templates')return templatesContent();
  if(item==='Soutiens')return supportsContent();
  if(item==='Automatisations')return automationsContent();
  if(item==='Médias OBS')return mediaContent();
  if(item==='Connexions')return connectionsContent();
  if(item==='Diagnostics')return diagnosticsContent();
  if(item==='Réglages')return settingsContent();
  return '';
}
function visibleCampItems(){return campItems.filter(campItemEnabled)}
function ensureCampItem(){const visible=visibleCampItems();if(!visible.includes(state.campItem))state.campItem=visible[0]||'Personnalisation'}
function camp(){
  ensureCampItem();
  const navigation=campGroups.map(group=>{const items=group.items.filter(campItemEnabled);return items.length?`<div class="camp-nav-group"><span class="camp-nav-label">${group.label}</span>${items.map(item=>`<button class="${state.campItem===item?'active':''}" data-camp="${item}">${item}</button>`).join('')}</div>`:''}).join('');
  return`<div class="camp-grid"><section class="section camp-nav">${navigation}</section><section class="section empty-detail"><p class="eyebrow">APPLICATION</p><h2 id="camp-title">${esc(state.campItem)}</h2><div id="camp-copy">${campContent(state.campItem)}</div></section></div>`
}
function render(){projectProductShell();if(state.view==='camp')ensureCampItem();const names={home:['Accueil','COCKPIT'],live:['Live','EN DIRECT'],sounds:['Sons','BIBLIOTHÈQUE'],planning:['Planning','PLANNING'],camp:['Application','CONFIGURATION']};[title.textContent,eyebrow.textContent]=names[state.view];view.innerHTML=({home,live,sounds:soundboard,planning,camp}[state.view])();document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-current',b.dataset.view===state.view?'page':'false'));bind()}
async function ensureObsSoundboardForPlayback(){
  const currentScene=state.dashboard?.obs?.scene||'';
  let setup=await request('/api/v1/soundboard/obs/status');
  if(!setup.connected)throw new Error('OBS est déconnecté. Ouvre OBS puis vérifie la connexion WebSocket.');
  if(setup.wrongInputKind)throw new Error('La source « StreamDashboard • Soundboard » existe dans OBS mais n’est pas une Media Source.');
  if(!setup.inputExists||(currentScene&&!setup.attachedScenes?.includes(currentScene))){
    setup=await request('/api/v1/soundboard/obs/setup',{method:'POST',body:'{}'});
  }
  state.obsSetup=setup;
  if(setup.wrongInputKind)throw new Error('La source « StreamDashboard • Soundboard » existe dans OBS mais n’est pas une Media Source.');
  if(!setup.inputExists)throw new Error('La Media Source Soundboard OBS n’a pas pu être créée.');
  if(currentScene&&!setup.attachedScenes?.includes(currentScene))throw new Error(`La Soundboard OBS n’est pas présente dans la scène actuelle « ${currentScene} ». Configure cette scène dans Application → Réglages.`);
  return setup;
}
async function playSound(soundId){record('soundboard.play',{soundId});const sound=(state.sounds||[]).find(value=>value.id===soundId),volume=Math.max(0,Math.min(1,(sound?.volume??1)*state.soundMasterVolume));if(!state.runtime){toast('Lecture simulée');return}try{await ensureObsSoundboardForPlayback();const commandId=uid();const ack=await request('/api/v1/soundboard/play',{method:'POST',body:JSON.stringify({commandId,correlationId:commandId,soundId,volume,issuedAt:new Date().toISOString()})});if(ack.status!=='succeeded')throw new Error(ack.message||'Lecture refusée.');toast('Son envoyé à OBS');await refreshRuntime()}catch(error){toast(error.message,true)}}
async function toggleLive(){if(!state.runtime){record(state.live.active?'session.stop':'session.start');state.live.active=!state.live.active;render();return}try{if(state.live.active){if(!confirm('Arrêter réellement le live ?'))return;await dashboardCommand({type:'session.stop'},'session.stop');}else{if(!confirm('Démarrer réellement le live ?'))return;await dashboardCommand({type:'session.prepare'},'session.prepare');try{await dashboardCommand({type:'session.start'},'session.start')}catch(error){if(confirm(`${error.message}\n\nDémarrer quand même ?`))await dashboardCommand({type:'session.start',force:true},'session.start');else throw error}}await refreshRuntime()}catch(error){toast(error.message,true)}}

async function mutateCompanion(kind,method,id,payload){
  if(!requireRuntime())return null;
  const path=id?`/api/v1/companion/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`:`/api/v1/companion/${encodeURIComponent(kind)}`;
  state.companion=await request(path,{method,body:method==='DELETE'?undefined:JSON.stringify(payload||{})});
  await refreshRuntime();return state.companion;
}
async function searchCategory(inputId,hiddenId,resultsId){
  const input=document.querySelector(inputId),hidden=document.querySelector(hiddenId),results=document.querySelector(resultsId);
  const query=input?.value.trim();if(!query||query.length<2)return toast('Saisis au moins 2 caractères.',true);
  const values=await request(`/api/v1/twitch/categories?q=${encodeURIComponent(query)}`);
  results.replaceChildren(...values.map(value=>new Option(value.name,value.id)));results.hidden=false;results.size=Math.min(8,Math.max(2,values.length));
  results.onchange=()=>{const option=results.selectedOptions[0];if(!option)return;hidden.value=option.value;input.value=option.textContent;results.hidden=true};
  if(!values.length)toast('Aucune catégorie Twitch trouvée.',true);
}
function resetAutomationEditor(){
  state.automationEditor={id:'',name:'',trigger:'support.received',conditions:[],actions:[{type:'soundboard.play',payload:{soundId:state.sounds?.[0]?.id||''}}],cooldownMs:30000,enabled:true};
}
function readAutomationEditor(){
  const form=document.querySelector('#camp-automation-form');if(!form)return state.automationEditor;
  const conditions=[...form.querySelectorAll('[data-condition-row]')].map(row=>{
    const operator=row.querySelector('[data-condition-operator]').value;const raw=row.querySelector('[data-condition-value]').value;
    const value=operator==='gte'?Number(raw):raw==='true'?true:raw==='false'?false:raw;
    return{path:row.querySelector('[data-condition-path]').value.trim(),operator,value};
  }).filter(value=>value.path);
  const actions=[...form.querySelectorAll('[data-action-row]')].map(row=>{
    const type=row.querySelector('[data-action-type]').value;const payload={};
    row.querySelectorAll('[data-action-param]').forEach(input=>{const key=input.dataset.actionParam;payload[key]=['seconds','volume'].includes(key)?Number(input.value):input.value});
    return{type,payload};
  });
  return{id:state.automationEditor.id,name:String(new FormData(form).get('name')||'').trim(),trigger:String(new FormData(form).get('trigger')||'support.received'),conditions,actions,cooldownMs:Math.round(Number(new FormData(form).get('cooldown')||0)*1000),enabled:new FormData(form).get('enabled')==='on'};
}
function bindCampSections(){
  if(state.view!=='camp')return;
  if(state.campItem==='Personnalisation'){bindProductPersonalization();return}
  if(!state.runtime)return;
  if(state.campItem==='Préparation'){
    document.querySelector('#camp-check-add')?.addEventListener('submit',async event=>{event.preventDefault();const label=String(new FormData(event.currentTarget).get('label')||'').trim();if(!label)return;try{await mutateCompanion('checklist','POST',null,{label,done:false});await loadCompanion();render();toast('Élément ajouté')}catch(error){toast(error.message,true)}});
    document.querySelectorAll('[data-check-toggle]').forEach(button=>button.onclick=async()=>{const item=(state.companion?.checklist||[]).find(value=>value.id===button.dataset.checkToggle);if(!item)return;try{await mutateCompanion('checklist','PUT',item.id,{label:item.label,done:!item.done});await loadCompanion();render()}catch(error){toast(error.message,true)}});
    document.querySelectorAll('[data-check-delete]').forEach(button=>button.onclick=async()=>{if(!confirm('Supprimer cet élément de checklist ?'))return;try{await mutateCompanion('checklist','DELETE',button.dataset.checkDelete);await loadCompanion();render()}catch(error){toast(error.message,true)}});
    document.querySelector('[data-camp-action="prepare"]')?.addEventListener('click',async()=>{try{await dashboardCommand({type:'session.prepare'});await refreshRuntime();toast('Préparation exécutée')}catch(error){toast(error.message,true)}});
    document.querySelector('[data-camp-action="check-reset"]')?.addEventListener('click',async()=>{try{for(const item of state.companion?.checklist||[])if(item.done)await mutateCompanion('checklist','PUT',item.id,{label:item.label,done:false});await loadCompanion();render();toast('Checklist réinitialisée')}catch(error){toast(error.message,true)}});
  }
  if(state.campItem==='Notes'){
    document.querySelector('#camp-note-add')?.addEventListener('submit',async event=>{event.preventDefault();const text=String(new FormData(event.currentTarget).get('text')||'').trim();if(!text)return;try{await mutateCompanion('notes','POST',null,{text});await loadCompanion();render();toast('Note ajoutée')}catch(error){toast(error.message,true)}});
    document.querySelectorAll('[data-note-save]').forEach(button=>button.onclick=async()=>{const text=document.querySelector(`[data-note-value="${CSS.escape(button.dataset.noteSave)}"]`)?.value.trim();if(!text)return;try{await mutateCompanion('notes','PUT',button.dataset.noteSave,{text});await loadCompanion();render();toast('Note enregistrée')}catch(error){toast(error.message,true)}});
    document.querySelectorAll('[data-note-delete]').forEach(button=>button.onclick=async()=>{if(!confirm('Supprimer cette note ?'))return;try{await mutateCompanion('notes','DELETE',button.dataset.noteDelete);await loadCompanion();render()}catch(error){toast(error.message,true)}});
  }
  if(state.campItem==='Templates'){
    document.querySelector('[data-template-category-search]')?.addEventListener('click',()=>void searchCategory('#camp-template-category','#camp-template-category-id','#camp-template-category-results').catch(error=>toast(error.message,true)));
    document.querySelectorAll('[data-template-edit]').forEach(button=>button.onclick=()=>{state.templateEditor=structuredClone((state.companion?.templates||[]).find(value=>value.id===button.dataset.templateEdit)||null);render()});
    document.querySelector('[data-template-new]')?.addEventListener('click',()=>{state.templateEditor=null;render()});
    document.querySelectorAll('[data-template-use]').forEach(button=>button.onclick=()=>{const template=(state.companion?.templates||[]).find(value=>value.id===button.dataset.templateUse);state.view='planning';render();openEventDialog(null,template)});
    document.querySelectorAll('[data-template-delete]').forEach(button=>button.onclick=async()=>{if(!confirm('Supprimer ce template ?'))return;try{await mutateCompanion('templates','DELETE',button.dataset.templateDelete);state.templateEditor=null;await loadCompanion();render()}catch(error){toast(error.message,true)}});
    document.querySelector('#camp-template-form')?.addEventListener('submit',async event=>{event.preventDefault();const form=new FormData(event.currentTarget);const id=String(form.get('id')||'');const twitch=form.get('publishTwitch')==='on';const google=form.get('publishGoogle')==='on';const categoryId=String(form.get('categoryId')||'');if(twitch&&!categoryId)return toast('Choisis une catégorie Twitch officielle.',true);const payload={title:String(form.get('title')||'').trim(),description:String(form.get('description')||'').trim(),twitchCategoryId:twitch?categoryId:'',twitchCategoryName:twitch?String(form.get('categoryName')||'').trim():'',desiredPublication:{local:false,twitch,google}};try{await mutateCompanion('templates',id?'PUT':'POST',id||null,payload);state.templateEditor=null;await loadCompanion();render();toast('Template enregistré')}catch(error){toast(error.message,true)}});
  }
  if(state.campItem==='Soutiens'){
    document.querySelector('[data-camp-action="supports-refresh"]')?.addEventListener('click',()=>void loadSupports().then(render).catch(error=>toast(error.message,true)));
    document.querySelector('[data-camp-action="supports-test"]')?.addEventListener('click',async()=>{try{await request('/api/v1/supports/streamlabs/test',{method:'POST',body:'{}'});await loadSupports();render();toast('Test interne ajouté')}catch(error){toast(error.message,true)}});
    document.querySelector('[data-camp-action="supports-test-real"]')?.addEventListener('click',async()=>{try{toast('Test réel envoyé à Streamlabs · attente du Socket…');await request('/api/v1/supports/streamlabs/test-real',{method:'POST',body:'{}'});await loadSupports();render();toast('Test réel OK · Alert Box + Socket Streamlabs validés')}catch(error){toast(error.message,true)}});
  }
  if(state.campItem==='Automatisations'){
    document.querySelectorAll('[data-auto-edit]').forEach(button=>button.onclick=()=>{const value=(state.automations?.items||[]).find(item=>item.id===button.dataset.autoEdit);if(value){state.automationEditor=structuredClone(value);render()}});
    document.querySelectorAll('[data-auto-delete]').forEach(button=>button.onclick=async()=>{if(!confirm('Supprimer cette automatisation ?'))return;try{await request(`/api/v1/automations/${encodeURIComponent(button.dataset.autoDelete)}`,{method:'DELETE'});resetAutomationEditor();await loadAutomations();render()}catch(error){toast(error.message,true)}});
    document.querySelectorAll('[data-auto-toggle]').forEach(button=>button.onclick=async()=>{const value=(state.automations?.items||[]).find(item=>item.id===button.dataset.autoToggle);if(!value)return;try{await request(`/api/v1/automations/${encodeURIComponent(value.id)}`,{method:'PUT',body:JSON.stringify({...value,enabled:!value.enabled})});await loadAutomations();render()}catch(error){toast(error.message,true)}});
    document.querySelector('[data-auto-new]')?.addEventListener('click',()=>{resetAutomationEditor();render()});
    document.querySelector('[data-condition-add]')?.addEventListener('click',()=>{state.automationEditor=readAutomationEditor();state.automationEditor.conditions.push({path:'',operator:'eq',value:''});render()});
    document.querySelectorAll('[data-condition-remove]').forEach(button=>button.onclick=()=>{state.automationEditor=readAutomationEditor();state.automationEditor.conditions.splice(Number(button.dataset.conditionRemove),1);render()});
    document.querySelector('[data-action-add]')?.addEventListener('click',()=>{state.automationEditor=readAutomationEditor();state.automationEditor.actions.push({type:'soundboard.play',payload:{soundId:state.sounds?.[0]?.id||''}});render()});
    document.querySelectorAll('[data-action-remove]').forEach(button=>button.onclick=()=>{state.automationEditor=readAutomationEditor();state.automationEditor.actions.splice(Number(button.dataset.actionRemove),1);if(!state.automationEditor.actions.length)state.automationEditor.actions.push({type:'soundboard.play',payload:{}});render()});
    document.querySelectorAll('[data-action-type]').forEach((select,index)=>select.onchange=()=>{state.automationEditor=readAutomationEditor();state.automationEditor.actions[index]={type:select.value,payload:{}};render()});
    document.querySelector('#camp-automation-form')?.addEventListener('submit',async event=>{event.preventDefault();const value=readAutomationEditor();if(!value.name)return toast('Donne un nom à la règle.',true);try{await request(value.id?`/api/v1/automations/${encodeURIComponent(value.id)}`:'/api/v1/automations',{method:value.id?'PUT':'POST',body:JSON.stringify(value)});resetAutomationEditor();await loadAutomations();render();toast('Automatisation enregistrée')}catch(error){toast(error.message,true)}});
  }
  if(state.campItem==='Médias OBS'){
    document.querySelectorAll('[data-media-restart]').forEach(button=>button.onclick=()=>void dashboardCommand({type:'obs.media.restart',input:button.dataset.mediaRestart}).then(()=>toast('Média relancé')).catch(error=>toast(error.message,true)));
    document.querySelectorAll('[data-browser-refresh]').forEach(button=>button.onclick=()=>void dashboardCommand({type:'obs.browser.refresh',input:button.dataset.browserRefresh}).then(()=>toast('Browser Source rafraîchie')).catch(error=>toast(error.message,true)));
  }
  if(state.campItem==='Diagnostics')document.querySelector('[data-camp-action="diagnostics-refresh"]')?.addEventListener('click',()=>void loadDiagnostics().then(render).catch(error=>toast(error.message,true)));
  if(state.campItem==='Réglages'){
    document.querySelector('#camp-general-settings')?.addEventListener('submit',async event=>{event.preventDefault();const form=new FormData(event.currentTarget);const payload={streamerName:String(form.get('streamerName')||'').trim(),startMode:String(form.get('startMode')||'intro'),primaryMicInput:String(form.get('primaryMicInput')||''),chattingScene:String(form.get('chattingScene')||''),timerBrowserSource:String(form.get('timerBrowserSource')||''),confirmStop:form.get('confirmStop')==='on',launchObs:form.get('launchObs')==='on',requireTimerOverlayOnStart:form.get('requireTimerOverlayOnStart')==='on',modeScenes:{intro:String(form.get('sceneIntro')||''),live:String(form.get('sceneLive')||''),pause:String(form.get('scenePause')||''),end:String(form.get('sceneEnd')||'')}};try{const next=await request('/api/v1/settings',{method:'PUT',body:JSON.stringify(payload)});applyDashboard(next);render();toast('Réglages enregistrés')}catch(error){toast(error.message,true)}});
    document.querySelector('[data-twitch-category-search]')?.addEventListener('click',()=>void searchCategory('#camp-twitch-category','#camp-twitch-game-id','#camp-twitch-category-results').catch(error=>toast(error.message,true)));
    document.querySelector('#camp-twitch-live-settings')?.addEventListener('submit',async event=>{event.preventDefault();const form=new FormData(event.currentTarget);try{const next=await request('/api/v1/twitch/channel',{method:'POST',body:JSON.stringify({title:String(form.get('title')||'').trim(),gameId:String(form.get('gameId')||''),gameName:String(form.get('gameName')||'').trim()})});applyDashboard(next);render();toast('Informations Twitch mises à jour')}catch(error){toast(error.message,true)}});
  }
}
async function blobBase64(blob){const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(let offset=0;offset<bytes.length;offset+=0x8000)binary+=String.fromCharCode(...bytes.subarray(offset,offset+0x8000));return btoa(binary)}
async function exportPlanning(publishDiscord=false){
  if(!state.dashboard)return;
  try{
    const result=await buildPlanningPng(state.dashboard.planning||[],state.dashboard.settings?.streamerName||'StreamDashboard',{period:state.planningPeriod,noteEnabled:false});
    if(publishDiscord){
      const posted=await request('/api/v1/discord/planning',{method:'POST',body:JSON.stringify({imageBase64:await blobBase64(result.blob),filename:result.fileName})});toast(`Planning publié dans #${posted.channelName||'Discord'}`);
    }else{
      const url=URL.createObjectURL(result.blob),link=document.createElement('a');link.href=url;link.download=result.fileName;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Planning exporté');
    }
  }catch(error){toast(error.message,true)}
}
function bindPlanning(){
  if(state.view!=='planning')return;
  document.querySelector('[data-planning-filter]')?.addEventListener('change',event=>{state.planningFilter=event.currentTarget.value;render()});
  document.querySelector('[data-planning-period]')?.addEventListener('change',event=>{state.planningPeriod=event.currentTarget.value});
  document.querySelector('[data-planning-export]')?.addEventListener('click',()=>void exportPlanning(false));
  document.querySelector('[data-planning-discord]')?.addEventListener('click',()=>void exportPlanning(true));
  document.querySelectorAll('[data-event-index]').forEach(button=>button.onclick=()=>openEventDialog(state.visiblePlanning?.[Number(button.dataset.eventIndex)]?.raw));
}
function bind(){
  document.querySelectorAll('[data-scene]').forEach(b=>b.onclick=async()=>{const label=b.dataset.scene;record('obs.scene.set',{sceneName:label});if(!state.runtime){state.scene=label;toast(`Scène ${label}`);render();return}try{await dashboardCommand(sceneCommand(label));await refreshRuntime();toast(`Scène ${label}`)}catch(error){toast(error.message,true)}});
  document.querySelectorAll('[data-sound]').forEach(b=>b.onclick=()=>void playSound(b.dataset.sound));
  document.querySelectorAll('[data-edit-sound]').forEach(b=>b.onclick=event=>{event.stopPropagation();openSoundDialog(b.dataset.editSound)});
  document.querySelectorAll('[data-mute]').forEach(b=>b.onclick=async()=>{const a=state.audio[+b.dataset.mute];if(!a)return;record('obs.audio.mute',{inputName:a.name,muted:!a.muted});if(!state.runtime){a.muted=!a.muted;render();return}try{await dashboardCommand({type:'obs.mute',input:a.name,muted:!a.muted});await refreshRuntime()}catch(error){toast(error.message,true)}});
  document.querySelectorAll('[data-timer]').forEach(b=>b.onclick=async()=>{const action=b.dataset.timer;record(`timer.${action}`);if(!state.runtime){if(action==='toggle')state.timerRunning=!state.timerRunning;if(action==='plus')state.seconds+=60;if(action==='minus')state.seconds=Math.max(0,state.seconds-60);if(action==='reset'){state.seconds=0;state.timerRunning=false}render();return}const command=action==='toggle'?{type:state.timerRunning?'timer.pause':'timer.start'}:action==='plus'?{type:'timer.add',seconds:60}:action==='minus'?{type:'timer.add',seconds:-60}:{type:'timer.reset'};try{await dashboardCommand(command);await refreshRuntime()}catch(error){toast(error.message,true)}});
  document.querySelector('[data-stop]')?.addEventListener('click',async()=>{record('soundboard.stop');if(!state.runtime){toast('Lecture arrêtée');return}try{state.soundboard=await request('/api/v1/soundboard/stop',{method:'POST',body:'{}'});state.sounds=state.soundboard?.sounds||state.sounds;toast('Lecture arrêtée');render()}catch(error){toast(error.message,true)}});
  document.querySelectorAll('[data-add-sound]').forEach(b=>b.onclick=()=>openSoundDialog());
  document.querySelector('[data-obs-setup]')?.addEventListener('click',()=>void openObsSetup());
  document.querySelector('[data-sound-category]')?.addEventListener('change',event=>{state.soundCategory=event.currentTarget.value;render()});
  document.querySelector('[data-sound-favorites]')?.addEventListener('change',event=>{state.soundFavorites=event.currentTarget.checked;render()});
  document.querySelector('[data-sound-master]')?.addEventListener('input',event=>{state.soundMasterVolume=Math.max(0,Math.min(1,Number(event.currentTarget.value)/100));localStorage.setItem('streamdashboard.desktopSoundboardVolume',String(state.soundMasterVolume));event.currentTarget.closest('.sound-master')?.querySelector('b')?.replaceChildren(`${Math.round(state.soundMasterVolume*100)}%`)});
  document.querySelector('[data-sound-master]')?.addEventListener('change',async()=>{if(!state.runtime||!state.soundboard?.currentPlayback)return;const current=(state.sounds||[]).find(sound=>sound.id===state.soundboard.currentPlayback.soundId);try{state.soundboard=await request('/api/v1/soundboard/volume',{method:'POST',body:JSON.stringify({volume:Math.max(0,Math.min(1,(current?.volume??1)*state.soundMasterVolume))})})}catch(error){toast(error.message,true)}});
  document.querySelector('[data-live-toggle]')?.addEventListener('click',()=>void toggleLive());
  document.querySelector('[data-open-personalization]')?.addEventListener('click',()=>{state.view='camp';state.campItem='Personnalisation';render()});
  document.querySelectorAll('[data-go-view]').forEach(button=>button.addEventListener('click',()=>{state.view=button.dataset.goView;render()}));
  document.querySelectorAll('[data-open-camp]').forEach(button=>button.addEventListener('click',()=>{state.view='camp';state.campItem=button.dataset.openCamp;render();void loadCampData(state.campItem)}));
  document.querySelector('[data-live-clip]')?.addEventListener('click',async()=>{if(!state.runtime)return toast('Clip simulé');try{await request('/api/v1/twitch/clips',{method:'POST',body:'{}'});toast('Clip Twitch demandé')}catch(error){toast(error.message,true)}});
  document.querySelector('#desktop-chat-form')?.addEventListener('submit',async event=>{event.preventDefault();const input=event.currentTarget.elements.namedItem('message'),message=String(input?.value||'').trim();if(!message)return;if(!state.runtime)return toast('Message simulé');try{await request('/api/v1/twitch/chat/messages',{method:'POST',body:JSON.stringify({message})});input.value='';toast('Message envoyé')}catch(error){toast(error.message,true)}});
  document.querySelector('[data-add-event]')?.addEventListener('click',()=>openEventDialog());
  document.querySelector('[data-sound-search]')?.addEventListener('input',e=>{state.search=e.currentTarget.value;render()});
  document.querySelectorAll('[data-camp]').forEach(b=>b.onclick=()=>{state.campItem=b.dataset.camp;render();void loadCampData(state.campItem)});
  bindPlanning();
  bindConnections();
  bindCampSections();
  bindStreamerPingSettings();
}
let activeStreamerPingId=null;
function ensureStreamerPingHost(){
  let host=document.querySelector('#streamer-ping');
  if(host)return host;
  host=document.createElement('section');host.id='streamer-ping';host.className='streamer-ping';host.hidden=true;document.body.append(host);return host;
}
function syncStreamerPing(){
  const host=ensureStreamerPingHost();const pending=(state.dashboard?.streamerPings||[]).filter(value=>!value.acknowledgedAt),ping=pending[0];
  if(!state.runtime||!ping){host.hidden=true;host.replaceChildren();activeStreamerPingId=null;return}
  if(activeStreamerPingId===ping.id&&!host.hidden)return;
  activeStreamerPingId=ping.id;host.hidden=false;
  host.innerHTML=`<div><span class="eyebrow">STREAMER PING · 1/${pending.length}</span><h2>${esc(ping.rewardTitle)}</h2><p><b>${esc(ping.userName)}</b> a utilisé cette récompense${ping.rewardCost?` · ${ping.rewardCost} points`:''}.</p>${ping.userInput?`<p class="ping-input">“${esc(ping.userInput)}”</p>`:''}</div><button class="action" data-ping-ack="${esc(ping.id)}">Vu</button>`;
  host.querySelector('[data-ping-ack]').onclick=()=>void acknowledgeStreamerPing(ping.id);
}
async function acknowledgeStreamerPing(id){
  try{const next=await request(`/api/v1/streamer-pings/${encodeURIComponent(id)}/ack`,{method:'POST',body:'{}'});applyDashboard(next);if(state.campItem==='Réglages')await loadPingHistory();render();toast('Streamer Ping acquitté')}catch(error){toast(error.message,true)}
}
async function loadStreamerPingRewards(){
  if(!state.runtime||state.campItem!=='Réglages'||state.dashboard?.twitch?.redemptionsAvailable!==true)return;
  try{const result=await request('/api/v1/twitch/rewards');state.twitchRewards=result.items||[];render()}catch(error){state.twitchRewards=[];toast(error.message,true);render()}
}
function bindStreamerPingSettings(){
  if(state.view!=='camp'||state.campItem!=='Réglages')return;
  document.querySelector('[data-ping-action="reauthorize"]')?.addEventListener('click',async()=>{try{const result=await request('/api/v1/twitch/device',{method:'POST',body:'{}'});if(window.streamDashboardDesktop?.openTwitchActivation)await window.streamDashboardDesktop.openTwitchActivation(result.verificationUri);toast(`Code Twitch : ${result.userCode}`)}catch(error){toast(error.message,true)}});
  document.querySelector('[data-ping-action="save"]')?.addEventListener('click',async()=>{const ids=[...document.querySelectorAll('[data-ping-reward]:checked')].map(input=>input.dataset.pingReward);try{const next=await request('/api/v1/settings',{method:'PUT',body:JSON.stringify({streamerPingRewardIds:ids})});applyDashboard(next);toast('Récompenses Streamer Ping enregistrées');render()}catch(error){toast(error.message,true)}});
  document.querySelector('[data-ping-action="ack-all"]')?.addEventListener('click',async()=>{try{const next=await request('/api/v1/streamer-pings/ack-all',{method:'POST',body:'{}'});applyDashboard(next);await loadPingHistory();render();toast('Tous les Streamer Pings sont vus')}catch(error){toast(error.message,true)}});
  document.querySelector('[data-ping-action="clear-history"]')?.addEventListener('click',async()=>{if(!confirm('Effacer les Streamer Pings déjà acquittés ?'))return;try{await request('/api/v1/streamer-pings/history',{method:'DELETE'});await loadPingHistory();render();toast('Historique nettoyé')}catch(error){toast(error.message,true)}});
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
  const streamlabsOAuthForm=document.querySelector('#preview-streamlabs-oauth-form');if(streamlabsOAuthForm)streamlabsOAuthForm.onsubmit=async event=>{event.preventDefault();if(!requireRuntime())return;const form=new FormData(streamlabsOAuthForm);const clientId=String(form.get('clientId')||'').trim(),clientSecret=String(form.get('clientSecret')||'').trim();if(!clientId||!clientSecret)return toast('Saisis le Client ID et le Client Secret Streamlabs.',true);try{state.streamlabsOAuth=await request('/api/v1/supports/streamlabs/oauth/config',{method:'PUT',body:JSON.stringify({clientId,clientSecret})});streamlabsOAuthForm.reset();render();toast('Identifiants Streamlabs enregistrés dans le stockage sécurisé')}catch(error){toast(error.message,true)}};
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
      if(action==='streamlabs-oauth-connect'){const result=await request('/api/v1/supports/streamlabs/oauth/start',{method:'POST',body:'{}'});if(window.streamDashboardDesktop?.openExternalAuth)await window.streamDashboardDesktop.openExternalAuth(result.authorizationUrl);toast('Autorisation Streamlabs ouverte dans le navigateur');return}
      if(action==='streamlabs-test'){await request('/api/v1/supports/streamlabs/test',{method:'POST',body:'{}'});toast('Test interne StreamDashboard OK');return}
      if(action==='streamlabs-test-real'){toast('Test réel envoyé à Streamlabs · attente du Socket…');await request('/api/v1/supports/streamlabs/test-real',{method:'POST',body:'{}'});await refreshAfterConnection('Test réel OK · Alert Box + Socket Streamlabs validés');return}
      if(action==='streamlabs-disconnect'){await request('/api/v1/supports/streamlabs/config',{method:'DELETE'});state.streamlabsOAuth=await request('/api/v1/supports/streamlabs/oauth/status');await refreshAfterConnection('Streamlabs déconnecté');return}
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
const localDate=value=>{const date=new Date(value);return Number.isFinite(+date)?`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`:''};
const localTime=value=>{const date=new Date(value);return Number.isFinite(+date)?`${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`:''};
const recurrenceValue=rule=>!rule?'':rule.frequency==='monthly'?'monthly-1':`weekly-${rule.interval||1}`;
function eventCanonical(item){const id=item?.seriesId||item?.id;return (state.dashboard?.planning||[]).find(value=>value.id===id)||item}
function populateEventTemplates(selected=''){
  const select=document.querySelector('#event-template');const templates=state.companion?.templates||[];
  select.replaceChildren(new Option('Aucun',''),...templates.map(template=>new Option(template.title||'Template',template.id)));select.value=selected;
}
function populateEventForm(item,scope='item'){
  const form=document.querySelector('#event-form'),source=item||{};form.reset();
  document.querySelector('#event-id').value=source.id||'';
  document.querySelector('#event-series-id').value=source.seriesId||'';
  document.querySelector('#event-occurrence-key').value=source.occurrenceKey||'';
  document.querySelector('#event-title').value=source.title||'';
  document.querySelector('#event-description').value=source.description||'';
  document.querySelector('#event-category').value=source.category||'live';
  document.querySelector('#event-date').value=source.startAtUtc?localDate(source.startAtUtc):localDate(new Date());
  document.querySelector('#event-start').value=source.startAtUtc?localTime(source.startAtUtc):'20:30';
  document.querySelector('#event-end').value=source.endAtUtc?localTime(source.endAtUtc):'23:30';
  document.querySelector('#event-twitch-category').value=source.twitchCategoryName||'';
  document.querySelector('#event-twitch-game-id').value=source.twitchCategoryId||'';
  document.querySelector('#event-twitch-results').replaceChildren();
  document.querySelector('#event-recurrence').value=recurrenceValue(source.recurrence);
  document.querySelector('#event-recurrence-until').value=source.recurrence?.until?localDate(source.recurrence.until):'';
  document.querySelector('#event-publish-twitch').checked=source.desiredPublication?.twitch===true;
  document.querySelector('#event-publish-google').checked=source.desiredPublication?.google===true;
  const occurrence=Boolean(state.eventEdit?.occurrence?.seriesId);
  document.querySelector('#event-scope-wrap').hidden=!occurrence;
  document.querySelector('#event-scope').value=scope==='series'?'series':'occurrence';
  document.querySelector('#event-recurrence').disabled=occurrence&&scope!=='series';
  document.querySelector('#event-recurrence-until').disabled=occurrence&&scope!=='series';
  document.querySelector('#event-dialog-title').textContent=source.id?'Modifier l’événement':'Nouvel événement';
  document.querySelector('#event-delete').hidden=!source.id;
  document.querySelector('#event-submit').textContent=source.id?'Enregistrer':'Ajouter';
  renderEventProviderStatus(eventCanonical(source));
}
function renderEventProviderStatus(item){
  const host=document.querySelector('#event-provider-status');if(!item?.id){host.hidden=true;host.replaceChildren();return}
  const providers=['twitch','google'].flatMap(provider=>{const link=item.providers?.[provider];if(!link)return[];return[{provider,link}]});
  const conflict=item.conflict;
  if(!providers.length&&!conflict){host.hidden=true;host.replaceChildren();return}
  host.hidden=false;host.innerHTML=`${providers.map(({provider,link})=>`<div class="provider-line"><b>${provider==='twitch'?'Twitch':'Google'}</b><span>${esc(link.status||'—')}${link.lastError?` · ${esc(link.lastError)}`:''}</span>${['error','conflict'].includes(link.status)?`<button type="button" class="secondary" data-provider-retry="${provider}">Réessayer</button>`:''}</div>`).join('')}${conflict?`<div class="provider-line warning"><b>Conflit ${esc(conflict.provider)}</b><span>Choisis la version à conserver.</span><button type="button" class="secondary" data-provider-conflict="${esc(conflict.provider)}" data-strategy="local">Garder StreamDashboard</button><button type="button" class="secondary" data-provider-conflict="${esc(conflict.provider)}" data-strategy="remote">Garder distant</button></div>`:''}`;
  host.querySelectorAll('[data-provider-retry]').forEach(button=>button.onclick=async()=>{try{const id=eventCanonical(state.eventEdit?.scope==='series'?state.eventEdit?.series:state.eventEdit?.occurrence)?.id||item.id;const next=await request(`/api/v1/planning/${encodeURIComponent(id)}/retry/${encodeURIComponent(button.dataset.providerRetry)}`,{method:'POST',body:JSON.stringify({confirmRecurring:true})});applyDashboard(next);toast('Synchronisation relancée');document.querySelector('#event-dialog').close();render()}catch(error){toast(error.message,true)}});
  host.querySelectorAll('[data-provider-conflict]').forEach(button=>button.onclick=async()=>{try{const id=item.id;const next=await request(`/api/v1/planning/${encodeURIComponent(id)}/conflict/${encodeURIComponent(button.dataset.providerConflict)}`,{method:'POST',body:JSON.stringify({strategy:button.dataset.strategy})});applyDashboard(next);toast('Conflit résolu');document.querySelector('#event-dialog').close();render()}catch(error){toast(error.message,true)}});
}
async function searchEventCategory(){
  const input=document.querySelector('#event-twitch-category'),hidden=document.querySelector('#event-twitch-game-id'),host=document.querySelector('#event-twitch-results');const query=input.value.trim();
  hidden.value='';if(query.length<2){host.replaceChildren();return}
  try{const values=await request(`/api/v1/twitch/categories?q=${encodeURIComponent(query)}`);host.replaceChildren(...values.slice(0,8).map(value=>{const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=value.name;button.onclick=()=>{input.value=value.name;hidden.value=value.id;host.replaceChildren()};return button}))}catch(error){toast(error.message,true)}
}
async function openEventDialog(item=null,template=null){
  if(state.runtime&&!state.companion)await loadCompanion().catch(()=>undefined);
  populateEventTemplates(template?.id||'');
  state.eventEdit=item?{occurrence:item,series:item.seriesId?eventCanonical(item):item,scope:item.seriesId?'occurrence':'item'}:null;
  const seed=item||template||{category:'live',desiredPublication:{local:true,twitch:false,google:false}};
  populateEventForm(seed,state.eventEdit?.scope||'item');
  if(template){document.querySelector('#event-title').value=template.title||'';document.querySelector('#event-description').value=template.description||'';document.querySelector('#event-twitch-category').value=template.twitchCategoryName||'';document.querySelector('#event-twitch-game-id').value=template.twitchCategoryId||'';document.querySelector('#event-publish-twitch').checked=template.desiredPublication?.twitch===true;document.querySelector('#event-publish-google').checked=template.desiredPublication?.google===true}
  document.querySelector('#event-dialog').showModal();
}
let eventCategoryTimer;
document.querySelector('#event-twitch-category').oninput=()=>{clearTimeout(eventCategoryTimer);eventCategoryTimer=setTimeout(()=>void searchEventCategory(),300)};
document.querySelector('#event-template').onchange=()=>{const template=(state.companion?.templates||[]).find(value=>value.id===document.querySelector('#event-template').value);if(!template)return;document.querySelector('#event-title').value=template.title||'';document.querySelector('#event-description').value=template.description||'';document.querySelector('#event-twitch-category').value=template.twitchCategoryName||'';document.querySelector('#event-twitch-game-id').value=template.twitchCategoryId||'';document.querySelector('#event-publish-twitch').checked=template.desiredPublication?.twitch===true;document.querySelector('#event-publish-google').checked=template.desiredPublication?.google===true};
document.querySelector('#event-scope').onchange=()=>{if(!state.eventEdit)return;const scope=document.querySelector('#event-scope').value;state.eventEdit.scope=scope;populateEventForm(scope==='series'?state.eventEdit.series:state.eventEdit.occurrence,scope);document.querySelector('#event-scope').value=scope};
function recurrenceFromEventForm(){
  const value=document.querySelector('#event-recurrence').value;if(!value)return undefined;
  const [frequency,interval]=value.split('-');const until=document.querySelector('#event-recurrence-until').value;
  return{frequency,interval:Number(interval),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone||'Europe/Paris',...(until?{until:new Date(`${until}T23:59:59`).toISOString()}:{})};
}
document.querySelector('#event-form').onsubmit=async event=>{
  event.preventDefault();const date=document.querySelector('#event-date').value,start=document.querySelector('#event-start').value,end=document.querySelector('#event-end').value;
  const startDate=new Date(`${date}T${start}`),endDate=new Date(`${date}T${end}`);if(endDate<=startDate)endDate.setDate(endDate.getDate()+1);
  const category=document.querySelector('#event-category').value,publishTwitch=document.querySelector('#event-publish-twitch').checked,publishGoogle=document.querySelector('#event-publish-google').checked,gameId=document.querySelector('#event-twitch-game-id').value,gameName=document.querySelector('#event-twitch-category').value.trim();
  if(publishTwitch&&!gameId)return toast('Choisis une catégorie Twitch officielle.',true);
  const item={title:document.querySelector('#event-title').value.trim(),description:document.querySelector('#event-description').value.trim(),startAtUtc:startDate.toISOString(),endAtUtc:endDate.toISOString(),category,twitchCategoryId:gameId||undefined,twitchCategoryName:gameName||undefined,desiredPublication:{local:true,twitch:publishTwitch,google:publishGoogle}};
  if(!state.runtime){state.planning.unshift({raw:{...item,id:`demo-${Date.now()}`},day:'Démo',time:start,title:item.title,kind:category==='live'?'Twitch':category});document.querySelector('#event-dialog').close();render();return}
  try{
    if(!state.eventEdit){
      item.recurrence=recurrenceFromEventForm();await request('/api/v1/planning',{method:'POST',body:JSON.stringify(item)});
    }else if(state.eventEdit.scope==='occurrence'&&state.eventEdit.occurrence?.seriesId){
      await request(`/api/v1/planning/${encodeURIComponent(state.eventEdit.occurrence.seriesId)}/occurrence`,{method:'PUT',body:JSON.stringify({occurrenceKey:state.eventEdit.occurrence.occurrenceKey,patch:item})});
    }else{
      const source=state.eventEdit.scope==='series'?state.eventEdit.series:state.eventEdit.occurrence;item.recurrence=recurrenceFromEventForm()||null;await request(`/api/v1/planning/${encodeURIComponent(source.id)}`,{method:'PUT',body:JSON.stringify({...item,confirmRecurring:true})});
    }
    document.querySelector('#event-dialog').close();state.eventEdit=null;event.currentTarget.reset();await refreshRuntime();toast('Événement enregistré');
  }catch(error){toast(error.message,true)}
};
document.querySelector('#event-delete').onclick=async()=>{
  if(!state.eventEdit||!confirm('Supprimer cet événement ?'))return;
  try{
    if(state.eventEdit.scope==='occurrence'&&state.eventEdit.occurrence?.seriesId)await request(`/api/v1/planning/${encodeURIComponent(state.eventEdit.occurrence.seriesId)}/occurrence`,{method:'DELETE',body:JSON.stringify({occurrenceKey:state.eventEdit.occurrence.occurrenceKey})});
    else{const source=state.eventEdit.scope==='series'?state.eventEdit.series:state.eventEdit.occurrence;await request(`/api/v1/planning/${encodeURIComponent(source.id)}?confirmRecurring=true`,{method:'DELETE',body:'{}'})}
    document.querySelector('#event-dialog').close();state.eventEdit=null;await refreshRuntime();toast('Événement supprimé');
  }catch(error){toast(error.message,true)}
};
document.querySelectorAll('[data-close-dialog]').forEach(button=>button.onclick=()=>document.querySelector(`#${button.dataset.closeDialog}`).close());
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{state.view=b.dataset.view;render()});
document.querySelector('#mode').onclick=async e=>{state.runtime=!state.runtime;e.currentTarget.textContent=state.runtime?'Runtime':'Démo';document.querySelector('.preview-mode span').textContent=state.runtime?'APERÇU · RUNTIME PC':'APERÇU · AUCUNE COMMANDE RÉELLE';runtimeUi(state.runtime,state.runtime?'Connexion au Runtime…':'Aucune commande réelle');if(state.runtime){await refreshRuntime();if(state.campItem==='Réglages')await loadStreamerPingRewards()}else{closeRuntimeSocket();state.scene=fixture.live.scene;state.sounds=structuredClone(fixture.sounds);state.audio=structuredClone(fixture.audio);state.live=structuredClone(fixture.live);state.planning=structuredClone(fixture.planning);state.dashboard=null;state.remotePairing=null;state.twitchRewards=null;applyProduct({profile:structuredClone(demoProductProfile),modules:structuredClone(demoModuleStates)},[]);syncStreamerPing();render()}toast(state.runtime?'Mode Runtime activé':'Mode Démo activé')};
window.addEventListener('keydown',e=>{if(e.altKey&&['1','2','3','4'].includes(e.key)){e.preventDefault();state.view=['home','live','sounds','planning'][+e.key-1];render()}});
setInterval(()=>{if(state.runtime&&state.timerRunning){state.seconds=Math.max(0,state.seconds-1);if(state.view==='live')render()}},1000);
window.addEventListener('beforeunload',closeRuntimeSocket);
document.documentElement.dataset.appReady='true';
applyProductAppearance();projectProductShell();render();
if(officialRuntime){
  runtimeUi(true,'Connexion au Runtime…');
  void refreshRuntime().then(()=>{if(state.view==='camp')void loadCampData(state.campItem)});
}else runtimeUi(false,'Aucune commande réelle');
