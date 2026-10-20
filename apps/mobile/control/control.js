import { LOCAL_SCOPE, readDevice, saveDevice, newWorkspace } from './device-workspace.js';
import { openReplica } from './autonomy-store.js';
import { createDeviceServices } from './device-services.js';
import { createDeviceProviders } from './device-providers.js';
import { createLocalPlanning } from './local-planning.js';
import { createDeviceAccounts } from './device-accounts.js';
import { createAutonomy } from './autonomy.js';
import { resources } from '../shared/autonomy.js';
import { createWizebotManagement } from './wizebot.js';
import { credentialStorage } from '../storage.js';
import { createLiveMonitor } from './live-monitor.js';
import { renderYouTubePicker, youtubeBroadcastStatus } from './youtube-picker.js';
import { liveControlState } from './live-controls.js';
import { createStreamlabsFeed, createStreamlabsConfiguration } from './streamlabs-feed.js';
import { createPlanning } from './planning.js';
import { readDeckPreferences, saveDeckPreferences, defaultDeckFavorites, renderPerformancePage } from './performance-ui.js';
let streamlabsFeed, streamlabsFeedRoot, liveMonitor, autonomy, localPlanning, deviceProviders, deviceServices, dialogBase, submittingBase, storageError='';
const formBases=new WeakMap();
let youtubePicker;
const twitchGameNames=new Map();
let twitchGameSearch=0;

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const uuid = () => globalThis.crypto?.randomUUID?.() ?? `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;
const labels = {running:'En cours',succeeded:'Réussi',failed:'Échec',partial:'Partiel',uncertain:'À vérifier'};
const icons = {'mic.toggle':'♩','mode.set':'▣','scene.set':'▣','timer.add':'+','sound.play':'♫','sound.stop':'■','alert.play':'✦','chat.send':'↗','wizebot.command':'✉','replay.save':'✂','replay.start':'▶','replay.stop':'■','live.start':'◉','live.stop':'■'};
const native=Boolean(globalThis.StreamDashboardNative);
const compactViewport=matchMedia('(max-width:700px), (pointer:coarse) and (max-width:1100px)');
let compact=native||compactViewport.matches;
document.documentElement.classList.toggle('compact-app',compact);
if(compact&&!localStorage.getItem('sd2.performance-first')){localStorage.setItem('sd2.page','deck');localStorage.setItem('sd2.performance-first','1');}
if(compact&&!localStorage.getItem('sd2.live-deck-intro')){localStorage.setItem('sd2.page','deck');localStorage.setItem('sd2.live-deck-intro','1');}
let data, sounds, replay, soundError='', soundCategory='', deckCategory='all', online=false, page=localStorage.getItem('sd2.page') || (compact?'deck':'live'), tab='obs', busy=false, refreshFlight, pointerHeld=false, configurationDraft, profileDraft, noticeTimer;
let deckScope, deckPreferences, deckEditing=false, deckEditBank='all', activeCommands=0;
const clientRole=new URL(location.href).searchParams.get('role')==='client';
let device=readDevice(localStorage,native);
const desktopProfile=await globalThis.streamDashboardDesktop?.getDeviceProfile?.();
if(desktopProfile){device={...device,...desktopProfile,name:desktopProfile.name||device.name};if(device.configured)device=saveDevice(device);}
const localEndpoint=globalThis.streamDashboardDesktop?`http://127.0.0.1:${clientRole?48135:48133}`:'';
const workspaceEndpoint=clientRole?'':localEndpoint;
const firstUse=!device.configured&&!localStorage.getItem('sd2.server');
if(firstUse&&(native||clientRole))page='manage';
let server=localStorage.getItem('sd2.workspace-mode')==='local'?(workspaceEndpoint||''):(localStorage.getItem('sd2.server') || workspaceEndpoint || (native || clientRole ? '' : location.origin));
const credentials={ get:()=>globalThis.streamDashboardDesktop?.getControllerCredential?.() ?? credentialStorage.get(), set:value=>globalThis.streamDashboardDesktop?.setControllerCredential?.(value) ?? credentialStorage.set(value), clear:()=>globalThis.streamDashboardDesktop?.setControllerCredential?.('') ?? credentialStorage.clear() };
let credential=await credentials.get();
const dialog=$('#dialog');
function toast(message) { $('#notice').textContent=message; $('#notice').style.display='block'; clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{$('#notice').style.display='none';},7000); }
function normalizeServer(value) { const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Adresse HTTP du PC de stream attendue.'); return url.origin; }
async function network(path, body, method=body===undefined?'GET':'POST',target=server,token=target===localEndpoint?'':credential) {
  if(!target)throw new Error('Renseignez l’adresse du PC de stream.');
  const response=await fetch(target+path,{method,headers:{...(token?{Authorization:`Device ${token}`} : {}),...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(path==='/api/v2/actions'||path.startsWith('/api/v2/wizebot/')||path.startsWith('/api/v2/youtube/')||path==='/api/v2/autonomy/sync'?65_000:path.startsWith('/api/v1/streamlabs/events')||path.startsWith('/api/v1/supports/streamlabs/history/')?20_000:8_000)});
  if(response.status===204)return {};
  const value=await response.json();
  if(!response.ok) { const error=new Error(value.error?.message || value.error || `Erreur ${response.status}`); error.status=response.status;error.body=value;throw error; }
  return value;
}
async function openLocal(){
 const target=server,token=target===localEndpoint?'':credential;
 await Promise.all([localPlanning?.wait(),deviceServices?.wait()]);localPlanning=undefined;deviceServices=undefined;autonomy?.store.close();
 try{autonomy=await createAutonomy(target||LOCAL_SCOPE,(p,b,m)=>network(p,b,m,target,token),bundle=>{if(autonomy?.store.view()&&bundle){data=bundle.data;sounds=bundle.sounds;}});if(!target){await autonomy.store.seed(newWorkspace(device));deviceServices=createDeviceServices({store:autonomy.store,autonomy,request:(p,b,m)=>network(p,b,m,localEndpoint,'')});deviceProviders=createDeviceProviders({request:(p,b,m)=>network(p,b,m,localEndpoint,''),getCalendar:()=>autonomy.store.view().extras.google.calendarId});localPlanning=createLocalPlanning({store:autonomy.store,providers:deviceProviders,onChange:()=>{const b=autonomy.store.view();data=b.data;sounds=b.sounds;shell();}});}const bundle=autonomy.store.view();data=bundle?.data;sounds=bundle?.sounds;storageError='';}
 catch(e){storageError=e.message;autonomy=undefined;}
}
function commandsBlocked(){return Boolean(server&&autonomy?.store.record.pending.some(op=>/^(action|settings|output|youtube|sound)\//.test(op.key)));}
function configureMacros(){return globalThis.streamDashboardDesktop?.configureController?.({server,credential,actions:online&&!commandsBlocked()?(autonomy?.store.record.bundle?.data.configuration.actions||[]):[]}).catch(()=>{});}
async function api(path,body,method=body===undefined?'GET':'POST'){
 if(commandsBlocked()&&['/api/v2/actions','/api/v1/commands'].includes(path))throw new Error('Synchronisez ou résolvez les réglages en attente avant de déclencher une commande.');
 if(path==='/api/v2/settings'&&(body?.obsPassword||body?.clearObsPassword)&&online){if(autonomy?.store.record.pending.length)throw new Error('Synchronisez les modifications en attente avant de changer le mot de passe OBS.');return network(path,body,method);}
 if(deviceServices){const result=await deviceServices.route(path,body,method);if(result!==undefined)return result;}
 if(localPlanning){const result=await localPlanning.route(path,body,method,submittingBase||(dialog.open?dialogBase:undefined));if(result!==undefined)return result;}
 if(autonomy){
  if(method==='GET'){const cached=autonomy.cached(path);if(cached!==undefined&&(!online||['/api/v1/profile','/api/v1/automations','/api/v1/companion/snapshot'].includes(path)))return cached;}
  else {const result=await autonomy.mutate(path,body,method,submittingBase||(dialog.open?dialogBase:undefined));if(result!==undefined){void configureMacros();shell();return result;}}
 }
 if(!online&&!path.startsWith('/api/v1/remote/pair'))throw new Error('Régie déconnectée : cette opération nécessite une connexion. Aucune commande ne sera envoyée plus tard.');
 return network(path,body,method);
}
function localSaveMessage(){if(!server)return 'Sauvegardé sur cet appareil. Les publications utilisent ses propres comptes ; aucune régie nécessaire.';const count=autonomy?.store.record.pending.length||0;return count?`Sauvegardé sur cet appareil · ${count} modification(s) à synchroniser.`:'Enregistré et synchronisé.';}
function syncDialog(){
 const record=autonomy?.store.record;
 modal(`<h2>Synchronisation de cet appareil</h2><p>${esc(storageError||autonomy?.lastError||localSaveMessage())}</p><p class="small">Dernière connexion : ${record?.lastSync?new Date(record.lastSync).toLocaleString('fr-FR'):'aucune'}. Les données restent disponibles après fermeture de l’application.</p>${server?'<button data-task="sync-now">Synchroniser maintenant</button>':'<button data-task="connection">Associer une régie</button>'}<button class="secondary" data-task="sync-export">Exporter ma copie locale</button>${(record?.pending||[]).filter((x,i,all)=>all.findIndex(v=>v.key===x.key)===i).map(op=>{const last=record.pending.filter(x=>x.key===op.key).at(-1);return `<section class="panel spacer"><b>${esc(op.key)}</b><p>${esc(op.issue?.message||'En attente de connexion')}</p>${op.issue?`<p>Champs : ${esc(op.issue.fields?.join(', ')||'élément complet')}</p><div class="form-grid"><label>Ma version<textarea readonly rows="6">${esc(JSON.stringify(last.value,null,2))}</textarea></label><label>Version de la régie<textarea readonly rows="6">${esc(JSON.stringify(resources(record.bundle)[op.key]??null,null,2))}</textarea></label></div><button data-sync-keep="${esc(op.key)}">Conserver ma version</button><button class="secondary" data-sync-remote="${esc(op.key)}">Utiliser la version de la régie</button>`:''}</section>`;}).join('')}`);
}
function shell() {
  document.body.classList.toggle('performance-mode',Boolean(compact&&data&&['deck','sounds'].includes(page)));
  const toggle=$('#workspace-toggle');toggle.textContent=server?'Mon espace':localStorage.getItem('sd2.server')?'Ma régie':'Appareil autonome';toggle.dataset.task=server?'use-local':localStorage.getItem('sd2.server')?'use-paired':'device-setup';
  $('.aside-foot small').textContent=server?'Exécution sur le PC de stream':'Comptes et données sur cet appareil';
  $('nav').querySelectorAll('button').forEach(button=>button.classList.toggle('active',button.dataset.page===page||(button.dataset.page==='manage'&&['planning','settings','actions'].includes(page))));
  $('#host-dot').classList.toggle('online',online);$('#host-name').textContent=data?.host.hostname || 'PC de stream';
  $('#role').textContent=({stream:'RÉGIE DE STREAM',control:'PILOTAGE',mobile:'STREAM DECK'})[device.role]+' · '+device.name;
  $('.brand small').textContent=data?.host.settings.streamerName||'VOTRE ESPACE';
  const count=autonomy?.store.record.pending.length||0,issues=autonomy?.store.record.pending.filter(x=>x.issue).length||0;
  $('#connection').textContent=storageError||`${!server?'Espace de cet appareil':online?'Régie connectée':'Mode local · commandes suspendues'} · ${issues?issues+' modification(s) à résoudre':count?(server?count+' modification(s) en attente':'données sauvegardées localement'):'copie locale à jour'}`;
  $('#sync-status').textContent=issues?'Résoudre les conflits':count?'Synchronisation ('+count+')':'Synchronisation';
}
function actionState(action) {
 if(!online)return 'Régie déconnectée';
 const obs=data.host.state.obs;
 if(action.type==='replay.save')return replay?.active?`Dernières ${replay.seconds} s`:'Tampon à préparer';
 if(action.type==='wizebot.command')return action.value+(data.host.chat?.connected&&data.host.chat?.canSend?'':' · Twitch à reconnecter');
 if(action.type==='mic.toggle'){const mic=action.value||data.host.settings.primaryMicInput;return obs.connected&&obs.inputs[mic]?(obs.inputs[mic].muted?'Micro coupé':'Micro ouvert'):'Micro non confirmé';}
 if(action.type==='sound.stop')return sounds?.currentPlayback?'Lecture en cours':'Aucun son en cours';
 if(action.type==='sound.play')return sounds?.currentPlayback?.soundId===action.value?'Lecture en cours':'Jouer sur OBS';
 if(action.type==='scene.set'||action.type==='mode.set'){const target=action.type==='scene.set'?action.value:action.value==='chatting'?data.host.settings.chattingScene:data.host.settings.modeScenes[action.value];return obs.connected&&obs.scene===target?'À l’écran':target||'Scène à configurer';}
 return 'PC de stream';
}
function actionButton(action) {return `<button data-action="${esc(action.id)}" class="${esc(action.color)} ${actionState(action)==='À l’écran'||actionState(action)==='Lecture en cours'?'pad-active':''}" ${!online||busy||(action.type==='live.start'&&!liveControlState(data,online).canStartBoth)||(action.type==='wizebot.command'&&(!data.host.chat?.connected||!data.host.chat?.canSend))?'disabled':''}><span>${icons[action.type]||'◇'}</span>${esc(action.label)}<small>${esc(actionState(action))}${action.shortcut?' · '+esc(action.shortcut.replace('Control+Alt+Shift+','M / ')):''}</small></button>`;}
function resultRows() {const receipts=(data?.receipts||[]).slice(-5).reverse();return receipts.length?receipts.map(r=>`<div class="receipt"><div><b>${esc(data.configuration.actions.find(a=>a.id===r.action)?.label || ({'live.start':'Lancer le live','live.stop':'Arrêter le live','metadata.apply':'Informations du live','metadata.retry':'Reprise des informations','sound.play':'Lecture audio','sound.stop':'Arrêter le son','replay.save':'Sauvegarder un clip','replay.start':'Préparer les clips','replay.stop':'Arrêter le tampon'}[r.action]??r.action))}</b><p>${esc(r.message)}</p>${Object.entries(r.platforms||{}).map(([p,v])=>`<p><b>${esc(p)}</b> · ${esc(v.message)} ${v.status!=='succeeded'&&canRetryPlatform(r,p)?`<button class="secondary" data-retry="${esc(r.action)}" data-platform="${p}">Reprendre ${p}</button>`:''}</p>`).join('')}</div><span class="result ${r.status}">${labels[r.status]}<p>${new Date(r.createdAt).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</p></span></div>`).join(''):'<p class="empty">Les résultats de vos actions apparaîtront ici.</p>';}
function platformCard(name,label,icon) {const live=liveControlState(data,online),p=live.destinations[name],s=data.host.state;const text=!online?'État inconnu · régie déconnectée':name==='obs'?(!s.obs.connected?'OBS indisponible':s.obs.streamingKnown===false?'État de sortie inconnu':s.obs.streaming?'Sortie principale en émission':'OBS connecté · principale arrêtée'):p.live===true?'En direct confirmé':p.active===true?'OBS émet · confirmation du live attendue':p.live===false?'Hors ligne confirmé':p.error || 'État non vérifié';return `<div class="panel status-card"><span class="platform-icon ${name==='youtube'?'yt':name}">${icon}</span><div><b>${label}</b><small class="${p?.live?'succeeded':''}">${esc(text)}</small></div></div>`;}
function livePage() {
 const state=data.host.state, remaining=state.timer.remaining??0, live=liveControlState(data,online);
 return `<div id="live-overview"><h1>${esc(live.heading)}</h1><p class="subtitle">Votre live, vos scènes et vos interactions. Une régie pour tous vos appareils.</p><div class="grid statuses">${platformCard('obs','OBS Studio','◉')}${platformCard('twitch','Twitch','T')}${platformCard('youtube','YouTube','▶')}</div></div><div id="live-monitor"></div>${!native?'<div id="streamlabs-feed"></div>':''}<div id="live-controls"><div class="grid columns"><section class="panel live-hero"><div class="hero-top"><span class="eyebrow">TWITCH + YOUTUBE</span><span class="pill">${!online?'RÉGIE DÉCONNECTÉE':live.running?'COMMANDE EN COURS':live.anyActive?'DIFFUSION EN COURS':'PRÉPARATION'}</span></div><div class="hero-title">${esc(data.configuration.metadata.title||'Votre prochain live commence ici')}</div><p class="scene-label">${online?'Scène actuelle':'Dernière scène connue'} · <b>${esc(state.obs.scene||'OBS non connecté')}</b></p><div class="row-actions"><button class="secondary" data-task="metadata">Modifier les informations du live</button><button class="secondary" data-task="replay-config">✂ Clips OBS</button></div><div class="live-tools"><button data-action="live.start" ${!live.canStartBoth||busy?'disabled':''}>◉ ${live.running?'Commande en cours':live.bothLive?'Live déjà lancé':live.anyActive?'Diffusion en cours':'Lancer Twitch et YouTube'}</button><button class="danger" data-action="live.stop" ${!online||busy||live.running?'disabled':''}>■ Arrêter les deux</button></div>${liveDestinationControls(live)}<p class="small muted">Le signal OBS et la confirmation de chaque plateforme sont suivis séparément.</p></section><section class="panel"><span class="eyebrow">MINUTEUR DU STREAM</span><div class="timer" data-timer-clock>${timerClock(remaining)}</div><p data-timer-status class="small ${state.timer.running?'succeeded':'muted'}">${timerStatus(state.timer)}</p><div class="timer-buttons"><button class="secondary" data-command="timer.start" ${!online||busy||state.timer.running?'disabled':''}>${remaining>0&&remaining<state.timer.duration?'Reprendre':'Démarrer'}</button><button class="secondary" data-command="timer.pause" ${!online||busy||!state.timer.running?'disabled':''}>Pause</button><button class="secondary" data-command="timer.reset" ${!online||busy?'disabled':''}>Remettre à 5 min</button><button class="secondary" data-task="timer-duration">Choisir la durée</button></div><p class="small muted">L’overlay affiche le compteur en mode Introduction ou Pause.</p><button class="secondary" data-task="timer-overlay">Vérifier le minuteur dans OBS</button><div class="checklist">${state.checklist.map(c=>`<label class="check"><input type="checkbox" data-check="${esc(c.id)}" ${c.done?'checked':''}>${esc(c.label)}</label>`).join('')}</div></section></div><section class="spacer"><div class="section-heading"><h2>À portée de main</h2><button class="secondary" data-page="deck">Ouvrir mon Deck ↗</button></div><div class="deck">${data.configuration.actions.slice(0,6).map(actionButton).join('')}</div></section><section class="panel spacer"><div class="section-heading"><h2>Dernières actions</h2><span class="small muted">Exécution sur ${esc(data.host.hostname)}</span></div>${resultRows()}</section></div>`;
}
function canRetryPlatform(receipt,platform){
 if(!receipt.action.startsWith('live.'))return true;
 const state=liveControlState(data,online);
 return !state.running&&(receipt.action==='live.start'?state.destinations[platform].canStart:state.destinations[platform].live!==false||state.destinations[platform].active===true);
}
function liveDestinationControls(state){
 return `<div class="live-destinations">${['twitch','youtube'].map(platform=>{
  const value=state.destinations[platform],label=platform==='twitch'?'Twitch':'YouTube',output=data.configuration.outputs[platform];
  const signal=!online?'État inconnu':value.active===true?'Signal OBS actif':value.active===false?'Signal OBS arrêté':'Signal OBS à vérifier';
  const status=value.live===true?'En direct confirmé':platform==='youtube'&&value.ingestionStatus==='active'?'YouTube reçoit le flux · '+youtubeBroadcastStatus(value.broadcastState):platform==='youtube'&&value.ingestionStatus?'YouTube : '+(value.ingestionStatus==='error'?'erreur du flux':'flux sélectionné pas encore reçu'):value.live===false?'Diffusion hors ligne':value.error||'Confirmation en attente';
  const button=!value.configured?'<button type="button" class="secondary" data-task="configure-platforms">Configurer '+label+'</button>':value.live===true?'<span class="succeeded">En direct</span>':value.transitioning?'<span class="muted">Démarrage en cours</span>':value.canStart&&(platform==='youtube'||value.active!==true)?`<button type="button" class="secondary" data-action="live.start" data-live-platform="${platform}" ${busy?'disabled':''}>${value.active===true?'Finaliser':'Lancer'} ${label}</button>`:'<button type="button" class="secondary" data-task="refresh-live">Vérifier l’état</button>';
  return `<div class="live-destination"><div><b>${label}</b><p class="small">${esc(signal)} · ${esc(status)}</p><small class="muted">Sortie : ${esc(output.kind==='main'?'principale OBS':output.name||'à configurer')}</small></div>${button}</div>`;
 }).join('')}</div>`;
}
function ensureDeckPreferences(){
 const scope=server||LOCAL_SCOPE;
 if(deckScope!==scope){deckScope=scope;deckPreferences=readDeckPreferences(localStorage,scope);deckEditing=false;}
 if(!deckPreferences&&data){const initial={version:1,bank:'favorites',soundCategory:'',favorites:defaultDeckFavorites(data,sounds)};if(online||initial.favorites.length){deckPreferences=initial;saveDeckPreferences(localStorage,scope,initial);}return initial;}
 return deckPreferences;
}
function updateDeckPreferences(patch){const current=ensureDeckPreferences();if(!current)return;const next={...current,...patch};deckPreferences=saveDeckPreferences(localStorage,deckScope,next)||next;}
function mobilePerformancePage(mode){
 const prefs=ensureDeckPreferences();
 return renderPerformancePage({data,sounds,replay,online,busy,blocked:commandsBlocked(),mode,bank:deckEditing&&mode==='deck'?deckEditBank:prefs.bank,soundCategory:prefs.soundCategory,editing:deckEditing,favorites:prefs.favorites,actionState,esc});
}
function resetPerformanceView(){const content=$('#content');if(content)content.dataset.renderedPage='';render();window.scrollTo(0,0);}
function deckPage(){
 if(compact)return mobilePerformancePage('deck');
 const groups=[['all','Tout'],['scenes','Scènes'],['alerts','Alertes'],['messages','Messages'],['wizebot','WizeBot']];
 const actions=data.configuration.actions.filter(a=>deckCategory==='all'||(deckCategory==='scenes'&&['mode.set','scene.set'].includes(a.type))||(deckCategory==='alerts'&&a.type==='alert.play')||(deckCategory==='messages'&&a.type==='chat.send')||(deckCategory==='wizebot'&&a.type==='wizebot.command'));
 return `<div class="performance-head"><div><span class="eyebrow">À VOUS DE JOUER</span><h1>Mon Deck</h1></div><span class="pill">${esc(data.host.state.obs.scene||'OBS indisponible')}</span></div><div class="tabs pad-tabs">${groups.map(([id,label])=>`<button class="${id===deckCategory?'':'secondary'}" data-deck-category="${id}">${label}</button>`).join('')}</div>${deckCategory==='wizebot'?wizebotToolbar():replayPanel()}<div class="deck performance-deck">${actions.map(actionButton).join('')||'<p class="empty">Ajoutez vos boutons depuis Gestion → Boutons & macros.</p>'}</div><div class="sound-transport">${stopAudioButton()}<button class="secondary" data-page="sounds">♫ Ouvrir la soundboard</button></div><section class="last-feedback" aria-live="polite">${resultRows()}</section>`;
}
function replayPanel(){
 const active=online&&replay?.active===true,ready=online&&replay?.enabled===true&&replay?.available!==false;
 const status=!online?'Régie déconnectée : état du tampon inconnu.':active?'Tampon actif : le bouton Clip sauvegarde les dernières secondes.':replay?.error||'Tampon arrêté. Démarrez-le avant le moment à conserver.';
 const guide=replay?.mode==='Advanced'?'OBS → Paramètres → Sortie → onglet Tampon de relecture. Cochez « Activer le tampon de relecture », choisissez sa durée, puis Appliquer. Le type d’enregistrement doit être Standard.':'OBS → Paramètres → Sortie → Enregistrement. Cochez « Activer le tampon de relecture », choisissez sa durée, puis Appliquer.';
 return `<section class="panel replay-panel"><div class="section-heading"><div><b>✂ Clips OBS · ${replay?.seconds||'—'} secondes</b><p class="small ${active?'succeeded':'muted'}">${esc(status)}</p></div><div class="row-actions">${active?'<button data-action="replay.save" '+(busy?'disabled':'')+'>Sauvegarder un clip</button><button class="secondary" data-action="replay.stop" '+(busy?'disabled':'')+'>Arrêter le tampon</button>':ready?'<button data-action="replay.start" '+(busy?'disabled':'')+'>Démarrer le tampon</button>':'<button class="secondary" data-task="refresh-replay" '+(!online?'disabled':'')+'>Vérifier les réglages OBS</button>'}</div></div><label class="check"><input type="checkbox" data-replay-auto ${data.configuration.replayAutoStart?'checked':''}>Démarrer le tampon automatiquement avec le live</label><p class="small muted">Le tampon conserve les moments à partir de son démarrage. Les clips sont enregistrés sur ${esc(data.host.hostname)}${replay?.directory?' · '+esc(replay.directory):''}.</p>${!ready&&!active?`<details open><summary>Où activer le tampon dans OBS ?</summary><p class="small">${esc(guide)}</p><p class="small">Revenez ici, vérifiez les réglages, puis cliquez sur Démarrer le tampon.</p></details>`:''}${data.host.replayAutoStartError&&!active?`<p class="warn">Démarrage automatique non confirmé : ${esc(data.host.replayAutoStartError)}</p>`:''}</section>`;
}
function replayDialog(){modal(`<div id="replay-dialog-root"><h2>Préparer et sauvegarder des clips</h2>${replayPanel()}</div>`);}

function wizebotToolbar(){return `<section class="panel replay-panel"><div class="section-heading"><div><h2>Commandes WizeBot</h2><p class="small">${data.host.chat?.connected&&data.host.chat?.canSend?'Envoi dans le chat Twitch de '+esc(data.host.chat.channel):'Connectez Twitch sur la régie sélectionnée pour autoriser l’envoi.'}</p></div><button data-task="new-wizebot">+ Ajouter</button></div><p class="small muted">Un appui envoie la commande affichée. WizeBot doit être actif et la commande autorisée sur ta chaîne. Le résultat confirme l’envoi, pas la réponse du bot.</p><button data-task="wizebot-catalog">Importer / gérer mes commandes WizeBot</button><button class="secondary" data-page="actions">Modifier mes boutons</button>${!data.host.chat?.connected||!data.host.chat?.canSend?'<button class="secondary" data-task="connect-twitch">Connecter Twitch</button>':''}</section>`;}
function editWizebot(id){configurationDraft=structuredClone(data.configuration);const a=configurationDraft.actions.find(x=>x.id===id)||{id:'wizebot_'+uuid().slice(0,8),label:'',type:'wizebot.command',value:'!',color:'purple',shortcut:''};modal(`<h2>${id?'Modifier':'Ajouter'} une commande WizeBot</h2><form id="wizebot-form" data-id="${esc(a.id)}">${input('Nom du bouton','label',a.label,'text','required maxlength="80"')}${input('Commande à envoyer dans Twitch','value',a.value,'text','required maxlength="500" placeholder="!discord"')}<p class="small muted">Saisis exactement la commande de ta chaîne, avec ses paramètres éventuels. Exemple : !uptime. Aucune clé API WizeBot nécessaire.</p>${select('Couleur','color',[['purple','Violet'],['green','Vert'],['amber','Ambre'],['red','Rouge']],a.color)}<div class="form-actions">${id?`<button type="button" class="danger" data-remove-action="${esc(a.id)}">Supprimer</button>`:''}<button>Enregistrer le bouton</button></div></form>`);}
function stopAudioButton(){return `<button class="danger" data-action="sound.stop" ${!online?'disabled':''}>■ Arrêter le son</button>`;}
function soundsPage(){
 if(compact)return mobilePerformancePage('sounds');
 const catalog=sounds?.sounds||[],categories=[...new Set(catalog.map(s=>s.category))];
 const shown=catalog.filter(s=>soundCategory==='favorites'?s.favorite:!soundCategory||s.category===soundCategory);
 return `<div class="performance-head"><div><span class="eyebrow">SONS SUR LE PC DE STREAM</span><h1>Soundboard</h1></div><span class="pill">${catalog.length} sons</span></div><div class="tabs pad-tabs">${[['','Tous'],['favorites','★ Favoris'],...categories.map(c=>[c,c])].map(([id,label])=>`<button class="${soundCategory===id?'':'secondary'}" data-sound-category="${esc(id)}">${esc(label)}</button>`).join('')}</div>${soundError?`<p class="warn">${esc(soundError)}</p>`:''}<div class="sound-transport"><p aria-live="polite">${!online?'État audio inconnu · régie déconnectée':sounds?.currentPlayback?'♫ '+esc(catalog.find(s=>s.id===sounds.currentPlayback.soundId)?.name||'Lecture en cours'):'Prêt · aucun son en cours'}</p>${stopAudioButton()}</div><div class="deck performance-deck sound-pads">${shown.map(s=>`<div class="sound-pad"><button class="green ${sounds?.currentPlayback?.soundId===s.id?'pad-active':''}" data-play-sound="${esc(s.id)}" ${!online||busy||!s.enabled||!s.sourceAvailable?'disabled':''}><span>♫</span><b>${esc(s.name)}</b><small>${!online?'Régie déconnectée':!s.enabled?'Désactivé':!s.sourceAvailable?'Fichier indisponible':sounds?.currentPlayback?.soundId===s.id?'Lecture en cours':esc(s.category)}</small></button><button class="favorite secondary" data-favorite-sound="${esc(s.id)}" aria-label="${s.favorite?'Retirer des':'Ajouter aux'} favoris" aria-pressed="${!!s.favorite}">${s.favorite?'★':'☆'}</button></div>`).join('')||'<p class="empty">Aucun son ici. Importez vos fichiers depuis Gestion → Bibliothèque audio.</p>'}</div><section class="last-feedback">${resultRows()}</section>`;
}
function actionsPage(){return `<div class="section-heading"><div><h1>Boutons & macros</h1><p class="subtitle">Les associations sont partagées par le Deck et le clavier.</p></div><button data-task="new-action">+ Ajouter</button></div><section class="panel"><div class="table-wrap"><table><thead><tr><th>Bouton</th><th>Raccourci clavier</th><th></th></tr></thead><tbody>${data.configuration.actions.map(a=>`<tr><td>${esc(a.label)}</td><td>${esc(a.shortcut||'—')}</td><td><button class="secondary" data-edit-action="${esc(a.id)}">Modifier</button></td></tr>`).join('')}</tbody></table></div></section>`;}
function managePage(){return `<h1>Gestion</h1><p class="subtitle">Votre planning, vos contenus et tous les réglages de la régie.</p><div class="management-grid"><button class="secondary" data-page="planning"><span>▤</span>Planning & événements<small>Agenda, séries, publications, export</small></button><button class="secondary" data-page="actions"><span>▦</span>Boutons & macros<small>Clavier, scènes, alertes et messages</small></button><button class="secondary" data-task="sounds"><span>♫</span>Bibliothèque audio<small>Importer, renommer, volume et destinations</small></button><button class="secondary" data-page="settings"><span>⚙</span>Configuration<small>OBS, comptes, appareils et intégrations</small></button></div>`;}
function timerClock(value){const r=Math.max(0,Math.ceil(value));return [Math.floor(r/3600),Math.floor(r/60)%60,r%60].map(x=>String(x).padStart(2,'0')).join(':');}
function timerStatus(t){return !online?'Hôte indisponible · dernier état reçu':t.running?'En cours sur la régie':t.remaining<=0?'Terminé':t.remaining<t.duration?'En pause':'Prêt à démarrer';}
const input=(label,name,value='',type='text',extra='')=>`<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
const select=(label,name,items,value)=>`<label>${label}<select name="${name}">${items.map(([id,text])=>`<option value="${esc(id)}" ${id===value?'selected':''}>${esc(text)}</option>`).join('')}</select></label>`;
const check=(label,name,value)=>`<label class="check"><input type="checkbox" name="${name}" ${value?'checked':''}>${label}</label>`;
const wizebotManagement=createWizebotManagement({api,esc,modal,getData:()=>!server?{...data,host:{...data.host,chat:autonomy?.store.record.drafts.deviceChat}}:data,refresh,toast,uuid,isOnline:()=>!server||online,getDraft:(channel,id)=>autonomy?.store.record.drafts['wizebot/'+channel+'/'+id],saveDraft:(channel,id,value)=>autonomy.store.draft('wizebot/'+channel+'/'+id,value)});
const planning=createPlanning({getData:()=>data,api,esc,input,select,check,modal,close:()=>dialog.close(),toast,refresh,render,prepare:metadataDialog});
function settingsPage(){
 const settings=data.host.settings,c=data.configuration;
 let content='';
 if(tab==='obs')content=`<h2>OBS sur ${esc(data.host.hostname)}</h2><form id="settings-form" data-revision="${esc(data.host.settingsRevision)}"><div class="form-grid">${input('Adresse WebSocket OBS','obsUrl',settings.obsUrl)}${input('Mot de passe OBS (laisser vide pour conserver)','obsPassword','','password')}${select('Micro principal','primaryMicInput',[['','Choisir une source'],...Object.keys(data.host.state.obs.inputs).map(x=>[x,x])],settings.primaryMicInput)}${input('Source navigateur du minuteur','timerBrowserSource',settings.timerBrowserSource)}</div><h3>Scènes et préparation</h3><div class="form-grid">${['intro','live','pause','end'].map(mode=>select({intro:'Introduction',live:'Jeu',pause:'Pause',end:'Fin'}[mode],`scene-${mode}`,[['','Non associée'],...data.host.state.obs.scenes.map(x=>[x,x])],settings.modeScenes?.[mode])).join('')}${select('Discussion','chattingScene',[['','Non associée'],...data.host.state.obs.scenes.map(x=>[x,x])],settings.chattingScene)}${select('Scène au lancement','startMode',[['intro','Introduction'],['live','Jeu']],settings.startMode)}</div>${check('Vérifier la source minuteur avant le live','requireTimerOverlayOnStart',settings.requireTimerOverlayOnStart)}${check('Lancer OBS au démarrage de la régie','launchObs',settings.launchObs)}${input('Chemin OBS sur le PC de stream','obsExecutablePath',settings.obsExecutablePath)}${check('Autoriser les appareils du réseau local (redémarrage de la régie requis)','remoteEnabled',settings.remoteEnabled)}<div class="form-actions"><button>Enregistrer les réglages</button></div></form>`;
 if(tab==='platforms')content=`<h2>Twitch et YouTube</h2><p class="small muted">Twitch : ${!online?'état actuel inconnu':data.host.state.twitch.connected?'connecté':'à connecter'}. Les comptes et clés de diffusion restent sur le PC de stream.</p><div class="inline"><button class="secondary" data-task="connect-twitch">Connecter Twitch</button><button class="secondary" data-task="connect-youtube">Connecter YouTube</button></div><form id="platform-form" data-revision="${c.revision}" class="spacer">${input('Client ID Google Desktop pour YouTube','clientId',c.youtube.clientId)}<p class="small muted">La connexion Google s’ouvre sur le PC de stream. Utilisez le même projet que celui du Client Secret Google enregistré.</p><div class="form-grid">${input('Diffusion YouTube sélectionnée','broadcastId',c.youtube.broadcastId)}${input('Chaîne YouTube sélectionnée','channelId',c.youtube.channelId)}</div><p id="youtube-selection-state" class="small ${c.youtube.broadcastId?'succeeded':'warn'}" role="status">${c.youtube.broadcastId?'Choix enregistré : '+esc(c.youtube.broadcastId):'Aucune diffusion YouTube sélectionnée. Choisissez celle que vous avez créée dans YouTube Studio.'}</p><button type="button" class="secondary" data-task="youtube-broadcasts">Choisir une diffusion YouTube</button><h3 class="spacer">Sorties de multidiffusion OBS</h3><p class="small muted">Choisissez les sorties réellement utilisées. Une sortie principale partagée arrête les deux destinations lorsqu’elle est arrêtée.</p>${['twitch','youtube'].map(p=>`<div class="form-grid">${select(`Sortie ${p}`,`${p}-kind`,[['unconfigured','À configurer'],['main','Sortie principale OBS'],['output','Sortie nommée OBS'],['aitum-suite','Aitum Stream Suite']],c.outputs[p].kind)}${input(`Nom exact de la sortie ${p}`,`${p}-name`,c.outputs[p].name)}</div>`).join('')}<button type="button" class="secondary" data-task="outputs">Détecter les sorties OBS</button><div id="output-list" class="small muted"></div><div class="form-actions"><button>Enregistrer les réglages de diffusion</button></div></form>`;
 if(tab==='profile')content=`<h2>Profil et préférences</h2><form id="profile-settings" data-revision="${esc(data.host.settingsRevision)}">${input('Nom affiché','streamerName',settings.streamerName)}${select('Accent','accent',['violet','cyan','rose'].map(x=>[x,x]),settings.accent)}${check('Confirmer l’arrêt du live','confirmStop',settings.confirmStop)}${input('Récompenses Twitch Streamer Ping (IDs séparés par une virgule)','streamerPingRewardIds',(settings.streamerPingRewardIds||[]).join(','))}<label>Préférences de tags (JSON)<textarea name="tagPreferences">${esc(JSON.stringify(settings.tagPreferences||{},null,2))}</textarea></label><div class="form-actions"><button>Enregistrer</button></div></form><details><summary>Profil complet, modules, apparence et paramètres avancés</summary><button class="secondary" data-task="profile-json">Ouvrir l’éditeur du profil</button></details>`;
 if(tab==='integrations')content=`<h2>Connexions et interactions</h2><p class="small muted">${server?'Les réglages s’appliquent à la régie sélectionnée.':'Vos données et comptes restent sur cet appareil. Google et Twitch fonctionnent directement par Internet.'}</p><div class="grid form-grid"><section><h3>Google Calendar</h3><button class="secondary" data-task="google-connect">Connecter Google</button><button class="secondary spacer" data-task="google-calendars">Choisir le calendrier</button><button class="secondary spacer" data-task="google-secret">Configurer le Client Secret Google</button></section><section><h3>Bibliothèque de sons</h3><button class="secondary" data-task="sounds">Gérer les sons OBS</button><button class="secondary spacer" data-task="sound-setup">Préparer les sources audio OBS</button></section><section><h3>Discord</h3><button class="secondary" data-task="discord">Configurer le bot et le salon</button></section><section><h3>Streamlabs et WizeBot</h3><button class="secondary" data-task="streamlabs">Configurer Streamlabs</button><button class="secondary spacer" data-task="wizebot-catalog">Commandes WizeBot</button></section><section><h3>Automatisations</h3><button class="secondary" data-task="automations">Gérer les règles</button></section></div>`;
 if(tab==='devices')content=`<h2>Appareils et comptes</h2><div class="table-wrap"><table><tr><th>Appareil</th><th>Usage</th></tr><tr><td>${esc(device.name)}</td><td>${esc({stream:'Régie de stream',control:'Pilotage',mobile:'Stream Deck'}[device.role])}</td></tr><tr><td>${esc(server||'Aucune régie associée')}</td><td>${!server?'Espace autonome':online?'Régie connectée':'Copie locale disponible'}</td></tr></table></div><div class="form-actions"><button data-task="device-setup">Configurer cet appareil</button><button data-task="device-accounts">Mes comptes sur cet appareil</button><button class="secondary" data-task="connection">Associer une régie</button>${data.host.local?'<button data-task="pairing">Créer un code de gestion complète</button>':''}</div><div class="form-actions"><button class="secondary" data-task="use-local">Ouvrir mon espace local</button>${localStorage.getItem('sd2.server')?'<button class="secondary" data-task="use-paired">Retrouver ma régie</button>':''}${server?'<button class="secondary" data-task="import-local">Transférer mes créations locales</button>':''}</div><h3 class="spacer">Macros clavier</h3><p class="small muted">Affectez les touches de votre clavier aux raccourcis affichés dans Boutons & macros. Gardez StreamDashboard ouvert sur l’appareil qui reçoit ces touches. Pour un BlackWidow V4 X : utilisez Synapse pour associer M1 à M6 à Ctrl + Alt + Maj + F1 à F6, une pression simple.</p><button class="secondary" data-task="shortcut-status">Vérifier les raccourcis sur ce PC</button><p id="shortcut-status" class="small muted"></p>`;
 return `<h1>Configuration</h1><p class="subtitle">Vos réglages sont sauvegardés sur cet appareil, puis synchronisés avec la régie.</p><div class="tabs">${[['obs','OBS et scènes'],['platforms','Diffusion'],['profile','Profil'],['integrations','Intégrations'],['devices','Appareils & macros']].map(([id,label])=>`<button class="${id===tab?'':'secondary'}" data-tab="${id}">${label}</button>`).join('')}</div><section class="panel config-panel">${content}</section>`;
}
function render(){
 const samePerformance=compact&&['deck','sounds'].includes(page)&&$('#content').dataset.renderedPage===page;
 const scroll=samePerformance?window.scrollY:0;
 const bankScroll=samePerformance?$('.deck-banks')?.scrollLeft||0:0;
 shell();
 if(!data){liveMonitor?.destroy();streamlabsFeed?.destroy();streamlabsFeed=undefined;streamlabsFeedRoot=undefined;$('#content').innerHTML='<section class="panel"><h1>Retrouver votre régie</h1><p class="subtitle">Connectez-vous au PC de stream pour retrouver les scènes, le Deck et votre planning.</p><button data-task="connection">Configurer la connexion</button></section>';liveMonitor=undefined;return;}
 if(page==='live'){
  if(!$('#live-monitor')){
   $('#content').innerHTML=livePage();
   liveMonitor?.destroy();
   liveMonitor=createLiveMonitor($('#live-monitor'),{native,request:liveChatRequest,configure:()=>{page='settings';tab='platforms';localStorage.setItem('sd2.page',page);render();}});
  }else{
   const template=document.createElement('template');template.innerHTML=livePage();
   // Update changing state without detaching the video or either chat iframe.
   for(const id of ['live-overview','live-controls'])$('#'+id).innerHTML=template.content.querySelector('#'+id).innerHTML;
  }
  updateLiveMonitor();
  if(!native){
   if(!streamlabsFeed||!streamlabsFeedRoot?.isConnected){
    streamlabsFeedRoot=$('#streamlabs-feed');
    streamlabsFeed=createStreamlabsFeed(streamlabsFeedRoot,{request:streamlabsRequest,configure:streamlabsConfiguration});
   }
   const sources=[];
   if(server)sources.push({id:server,label:server===localEndpoint?'Cet appareil':`Régie · ${data.host.hostname||server}`});
   if(localEndpoint&&localEndpoint!==server)sources.push({id:localEndpoint,label:'Cet appareil · connexion indépendante'});
   streamlabsFeed.update(sources,{workspaceKey:server||LOCAL_SCOPE,preferredSource:server||localEndpoint});
  }
 }else{
  liveMonitor?.destroy();liveMonitor=undefined;streamlabsFeed?.destroy();streamlabsFeed=undefined;streamlabsFeedRoot=undefined;
  $('#content').innerHTML=page==='deck'?deckPage():page==='sounds'?soundsPage():page==='planning'?planning.page():page==='actions'?actionsPage():page==='manage'?managePage():settingsPage();
 }
 if(commandsBlocked())document.querySelectorAll('[data-action], [data-play-sound], [data-command]').forEach(button=>{button.disabled=true;button.title='Synchronisez les réglages en attente avant de déclencher une commande.';});
 $('#content').dataset.renderedPage=page;
 if(samePerformance){const banks=$('.deck-banks');if(banks)banks.scrollLeft=bankScroll;window.scrollTo(0,scroll);}
 rememberForms();
}
function streamlabsRequest(target,options={}){
 if(!target||(target!==server&&target!==localEndpoint))throw new Error('La source Streamlabs a changé. Actualisez avant de réessayer.');
 return network('/api/v1/streamlabs/events'+(options.refresh?'?refresh=1':''),undefined,'GET',target,target===localEndpoint?'':credential);
}
function streamlabsConfiguration(target){
 if(!target?.id||(target.id!==server&&target.id!==localEndpoint))throw new Error('La source Streamlabs a changé. Actualisez avant de réessayer.');
 modal('<div id="streamlabs-configuration"></div>');
 createStreamlabsConfiguration($('#streamlabs-configuration'),{label:target.label,request:(path,body,method)=>{
  if(target.id!==server&&target.id!==localEndpoint)throw new Error('La source Streamlabs a changé. Rouvrez sa configuration avant de réessayer.');
  return network(path,body,method,target.id,target.id===localEndpoint?'':credential);
 },changed:()=>{void streamlabsFeed?.refresh(true);},notify:toast});
}
function liveChatRequest(path,body,method,sourceKey){
 const target=server||localEndpoint;
 if(!sourceKey||sourceKey!==target)throw new Error('La source du tchat a changé. Actualisez avant de réessayer.');
 if(server&&!online)throw new Error('Régie déconnectée : le tchat est suspendu.');
 // A chat message is never put in the configuration's offline queue.
 return network(path,body,method,target,target===localEndpoint?'':credential);
}
function updateLiveMonitor(){
 liveMonitor?.update(data,{online:server?online:Boolean(localEndpoint),sourceKey:server||localEndpoint});
}
function rememberForms(){if(autonomy?.store.view()){const base=resources(autonomy.store.view());document.querySelectorAll('form').forEach(f=>{if(!formBases.has(f))formBases.set(f,base);});}}
function modal(content){dialogBase=autonomy?.store.view()?resources(autonomy.store.view()):undefined;$('#dialog-content').innerHTML=content;if(!dialog.open)dialog.showModal();rememberForms();}
function deviceSetup(){modal(`<h2>Bienvenue dans StreamDashboard</h2><p>Un ordinateur suffit. Ajoutez un téléphone ou un autre PC quand vous le souhaitez.</p><form id="device-setup-form">${input('Nom de cet appareil','name',device.name,'text','required maxlength="80"')}${select('Rôle de cet appareil','role',native?[['mobile','Téléphone · Stream Deck et gestion']]:[['stream','PC de stream · OBS et gestion'],['control','PC de jeu · pilotage et gestion']],native?'mobile':device.configured?device.role:clientRole?'control':'stream')}<p class="small muted">Vous pouvez connecter vos comptes et préparer vos données avant d’associer les appareils. Un serveur supplémentaire reste facultatif.</p><button>Enregistrer et continuer</button></form>`);}
const deviceAccounts=createDeviceAccounts({modal,esc,toast,request:(p,b,m)=>{if(!localEndpoint)throw new Error('Les comptes propres à cet appareil nécessitent l’application Android ou Windows.');return network(p,b,m,localEndpoint,'');},openExternal:url=>globalThis.streamDashboardDesktop?.openExternalAuth?.(url)});
function connectionDialog(){modal(`<h2>Associer une régie</h2><p>La régie exécute les commandes OBS et les sons. Vos comptes locaux restent accessibles indépendamment.</p><form id="connection-form">${input('Adresse de la régie','server',server||'','url','placeholder="http://nom-du-pc:48133"')}<p class="small muted">Sur la régie : Configuration → Appareils → Créer un code de gestion complète. Collez le lien obtenu ici.</p>${input('Lien d’association (ou laisser vide si déjà associé)','link')}<div class="form-grid">${input('Identifiant d’association','pair')}${input('Code temporaire','code')}</div>${input('Nom de cet appareil','name',device.name)}<div class="form-actions"><button>Se connecter</button><button type="button" class="secondary" data-task="device-accounts">Mes comptes sur cet appareil</button></div></form>`);}
async function switchWorkspace(local){if(local&&['deck','live','sounds'].includes(page))page='manage';if(refreshFlight)await refreshFlight;server=local?(workspaceEndpoint||''):(localStorage.getItem('sd2.server')||'');localStorage.setItem('sd2.workspace-mode',local?'local':'paired');online=false;await configureMacros();await openLocal();dialog.close();render();await refresh();}
function metadataDialog(planned){const m=planned?{...data.configuration.metadata,title:planned.title,description:planned.description||'',twitchGameId:planned.twitchCategoryId||'',tags:planned.tags?.values||data.configuration.metadata.tags}:(autonomy?.store.record.drafts.metadata||data.configuration.metadata);modal(`<h2>Informations communes du live</h2><p class="small muted">Le titre et les tags s’appliquent aux deux plateformes. Le jeu Twitch et la catégorie YouTube ont une correspondance explicite ; la description est propre à YouTube.</p><form id="metadata-form" data-revision="${data.configuration.revision}">${input('Titre Twitch + YouTube','title',m.title,'text','required maxlength="100"')}<label>Description YouTube<textarea name="description" maxlength="5000">${esc(m.description)}</textarea></label><div class="form-grid"><div><label>Rechercher un jeu ou une catégorie Twitch<input type="search" id="twitch-game-query" placeholder="Ex. Minecraft, Just Chatting…" autocomplete="off"></label><input type="hidden" name="twitchGameId" value="${esc(m.twitchGameId)}"><p id="twitch-game-selected" class="small ${m.twitchGameId?'succeeded':'muted'}">${esc(m.twitchGameId?(twitchGameNames.get(m.twitchGameId)||((data.host.state.controlHub?.live?.categoryId===m.twitchGameId&&data.host.state.controlHub?.live?.category)||'Catégorie déjà enregistrée · '+m.twitchGameId)):'Aucune catégorie sélectionnée')}</p></div>${input('Catégorie YouTube (20 = Jeux vidéo)','youtubeCategoryId',m.youtubeCategoryId,'text','required')}</div>${input('Tags communs, séparés par une virgule','tags',m.tags.join(', '))}<button type="button" class="secondary" data-task="search-category">Rechercher sur Twitch</button><div id="category-results" aria-live="polite"></div><div class="form-actions"><button name="intent" value="draft" class="secondary">Conserver le brouillon</button><button name="intent" value="apply" ${!online?'disabled':''}>Appliquer à Twitch et YouTube</button></div></form>`);}
function editAction(id){if(data.configuration.actions.find(a=>a.id===id)?.type==='wizebot.command'){editWizebot(id);return;}configurationDraft=structuredClone(data.configuration);const a=configurationDraft.actions.find(x=>x.id===id)||{id:'action_'+uuid().slice(0,8),label:'',type:'sound.play',value:'',color:'purple',shortcut:''};modal(`<h2>${id?'Modifier':'Ajouter'} un bouton</h2><form id="action-form" data-id="${esc(a.id)}">${input('Libellé','label',a.label,'text','required maxlength="80"')}${select('Action sur le PC de stream','type',Object.keys(icons).map(x=>[x,{'mic.toggle':'Micro · basculer muet','scene.set':'Choisir une scène','mode.set':'Scène associée à un mode','timer.add':'Ajouter des secondes','sound.play':'Jouer un son du catalogue','sound.stop':'Arrêter le son en cours','alert.play':'Relancer une source média OBS','chat.send':'Envoyer un message dans le chat','wizebot.command':'Commande WizeBot dans Twitch','replay.save':'Sauvegarder un clip OBS','replay.start':'Préparer le tampon de replay','replay.stop':'Arrêter le tampon de replay','live.start':'Lancer Twitch ET YouTube','live.stop':'Arrêter les deux diffusions'}[x]]),a.type)}${input('Paramètre (source, scène, ID son, secondes ou twitch:message / youtube:message)','value',a.value)}<p class="small muted">Micro : vide pour utiliser le micro principal. Modes : intro, live, pause, end, chatting. Les sons sont joués par OBS.</p>${select('Couleur','color',[['purple','Violet'],['green','Vert'],['amber','Ambre'],['red','Rouge']],a.color)}${select('Macro clavier','shortcut',[['','Aucun'],...Array.from({length:24},(_,i)=>[`Control+Alt+Shift+F${i+1}`,`Ctrl + Alt + Maj + F${i+1}`])],a.shortcut)}<div class="form-actions">${id?`<button type="button" class="danger" data-remove-action="${esc(a.id)}">Supprimer</button>`:''}<button>Enregistrer</button></div></form>`);}
async function refresh(force=false){
 if(force&&server&&!online&&data){render();if(!refreshFlight)void refresh().catch(()=>{});return;}
 if(!server){await autonomy?.store.reload();const bundle=autonomy?.store.view();if(bundle){data=bundle.data;sounds=bundle.sounds;}render();return;}
 if(refreshFlight){await refreshFlight;if(force)return refresh(true);return;}
 refreshFlight=(async()=>{
  try{
   if(!autonomy)throw new Error(storageError||'Stockage local indisponible.');
   await autonomy.sync();
   const [audio,clips]=await Promise.all([network('/api/v1/soundboard').catch(()=>null),network('/api/v2/replay').catch(error=>({active:null,error:error.message}))]);
   replay=clips;data=autonomy.store.view().data;sounds=autonomy.store.view().sounds;
   if(audio){sounds={...audio,sounds:sounds.sounds.map(s=>({...s,sourceAvailable:audio.sounds.find(x=>x.id===s.id)?.sourceAvailable===true}))};}soundError='';const reconnect=!online;online=true;shell();updateLiveMonitor();
   if(force||reconnect||(!dialog.open&&['live','deck','sounds','planning'].includes(page)&&!pointerHeld&&!document.activeElement?.matches('input, textarea, select, [contenteditable]')))render();
   void configureMacros();
  }catch(e){online=false;void configureMacros();replay={active:null,error:'Régie déconnectée'};if(sounds)sounds.currentPlayback=null;shell();updateLiveMonitor();if(!dialog.open)render();if(force)toast(e.message);}
 })().finally(()=>{refreshFlight=undefined;});
 return refreshFlight;
}
async function runAction(action,platform,soundId){
 if(!online||(busy&&action!=='sound.stop'))return;
 if(commandsBlocked()){toast('Synchronisez les réglages en attente avant de déclencher une commande.');return;}
 const configured=data.configuration.actions.find(value=>value.id===action),type=configured?.type||action;
 if(type==='replay.save'&&replay?.active!==true){replayDialog();return;}
 if(type==='live.start'){
  const current=liveControlState(data,online);
  if(platform?current.destinations[platform].live===true:current.anyActive){toast(platform?`${platform==='youtube'?'YouTube':'Twitch'} est déjà en direct.`:'Une diffusion est déjà en cours. Utilisez le contrôle de la destination à compléter.');return;}
  if(current.running||!(platform?current.destinations[platform].canStart:current.canStartBoth)){toast('Vérifiez la configuration et l’état des destinations avant de lancer le live.');return;}
 }
 if(type==='live.stop'&&!confirm(`Arrêter la diffusion ${platform?(platform==='youtube'?'YouTube':'Twitch'):'Twitch ET YouTube'} ?`))return;
 activeCommands++;busy=true;
 try{
  render();
  const result=await api('/api/v2/actions',{id:uuid(),issuedAt:new Date().toISOString(),action:['live.start','live.stop'].includes(configured?.type)?configured.type:action,...(platform?{platform}:{}),...(soundId?{soundId}:{})});
  toast(`${labels[result.status]} · ${result.message}`);globalThis.StreamDashboardNative?.haptic(result.status==='succeeded'?'light':'heavy');
 }catch(error){toast(`Résultat non reçu : ${error.message}. Vérifiez le journal avant de recommencer.`);}
 finally{busy=--activeCommands>0;await refresh(true);if(dialog.open&&$('#replay-dialog-root'))replayDialog();}
}

async function openAuthorization(value){const url=value.url||value.authorizationUrl||value.verification_uri||value.verificationUri; if(!url){toast(JSON.stringify(value));return;}if(data.host.local&&globalThis.streamDashboardDesktop?.openExternalAuth)await globalThis.streamDashboardDesktop.openExternalAuth(url);modal(`<h2>Autorisation du service</h2><p class="small">${value.user_code||value.userCode?'Code : <b>'+esc(value.user_code||value.userCode)+'</b>':'Terminez cette autorisation dans le navigateur du PC de stream.'}</p><p><a href="${esc(url)}" target="_blank" rel="noopener">Ouvrir l’autorisation</a></p><label>Lien à ouvrir sur le PC de stream<textarea readonly>${esc(url)}</textarea></label>`);}
async function jsonEditor(title,path,key,method='PUT'){const response=await api(path);profileDraft=response;modal(`<h2>${esc(title)}</h2><form id="json-form" data-path="${esc(path)}" data-key="${esc(key||'')}" data-method="${method}"><label>Configuration JSON<textarea name="value" rows="16">${esc(JSON.stringify(key?response[key]:response,null,2))}</textarea></label><div class="form-actions"><button>Enregistrer</button></div></form>`);}
async function openYouTubePicker(){
 if(youtubePicker?.loading&&dialog.open&&$('#youtube-picker')===youtubePicker.root)return;
 const form=$('#platform-form'),sourceKey=server||localEndpoint;
 if(!form)throw new Error('Ouvrez Configuration → Twitch et YouTube.');
 if(!sourceKey)throw new Error('Le choix des diffusions nécessite une régie connectée ou l’application Windows.');
 if(server&&!online)throw new Error('Reconnectez la régie pour actualiser les diffusions YouTube.');
 if(form.elements.clientId.value.trim()!==data.configuration.youtube.clientId)throw new Error('Enregistrez le Client ID modifié, puis connectez YouTube avant de choisir une diffusion.');
 const picker={sourceKey,form,loading:true,clientId:data.configuration.youtube.clientId};
 youtubePicker=picker;
 modal('<div id="youtube-picker" aria-live="polite"><h2>Diffusions YouTube</h2><p>Recherche des diffusions et de la chaîne connectée…</p></div>');
 picker.root=$('#youtube-picker');
 const token=sourceKey===localEndpoint?'':credential;
 const [broadcasts,channels]=await Promise.allSettled([
  network('/api/v2/youtube/broadcasts',undefined,'GET',sourceKey,token),
  network('/api/v2/youtube/channels',undefined,'GET',sourceKey,token),
 ]);
 picker.loading=false;
 if(youtubePicker!==picker||!dialog.open||$('#youtube-picker')!==picker.root||sourceKey!==(server||localEndpoint)||!form.isConnected)return;
 if(picker.clientId!==data.configuration.youtube.clientId)throw new Error('La connexion YouTube a changé. Actualisez la liste.');
 picker.items=broadcasts.status==='fulfilled'?(broadcasts.value.items||[]):[];
 picker.configuration=structuredClone(data.configuration);
 modal(`<div id="youtube-picker">${renderYouTubePicker({items:picker.items,channels:channels.status==='fulfilled'?(channels.value.items||[]):[],channelError:channels.status==='rejected'?'Chaîne connectée non vérifiée : '+channels.reason.message:'',listError:broadcasts.status==='rejected'?broadcasts.reason.message:'',selectedId:picker.configuration.youtube.broadcastId})}</div>`);
 picker.root=$('#youtube-picker');
}
async function chooseYouTubeBroadcast(button){
 const picker=youtubePicker,form=$('#platform-form');
 if(!picker||picker.saving)return;
 if(picker.sourceKey!==(server||localEndpoint)||picker.root!==$('#youtube-picker')||picker.form!==form)throw new Error('L’espace de travail a changé. Actualisez les diffusions.');
 if(form.elements.clientId.value.trim()!==picker.clientId||data.configuration.youtube.clientId!==picker.clientId)throw new Error('La connexion YouTube a changé. Actualisez la liste.');
 const selected=picker.items.find(item=>item.id===button.dataset.broadcast&&item.channelId===button.dataset.channel);
 if(!selected)throw new Error('Actualisez la liste avant de choisir cette diffusion.');
 picker.saving=true;
 picker.root.querySelectorAll('button').forEach(value=>{value.disabled=true;});
 try{
  const configuration=structuredClone(picker.configuration);
  configuration.youtube={...configuration.youtube,broadcastId:selected.id,channelId:selected.channelId};
  await api('/api/v2/configuration',{configuration,expectedRevision:configuration.revision},'PUT');
  if(picker.sourceKey!==(server||localEndpoint)||!form.isConnected)return;
  const bundle=autonomy?.store.view();
  if(bundle){data=bundle.data;sounds=bundle.sounds;const previousBase=formBases.get(form)||resources(bundle);formBases.set(form,{...previousBase,'youtube/root':resources(bundle)['youtube/root']});}
  form.dataset.revision=data.configuration.revision;
  form.elements.broadcastId.value=selected.id;form.elements.channelId.value=selected.channelId;
  const state=$('#youtube-selection-state');
  state.textContent=`${selected.title||selected.id} · ${localSaveMessage()}`;state.className='small succeeded';
  dialog.close();youtubePicker=undefined;
  toast(`Diffusion YouTube choisie : ${selected.title||selected.id}. ${localSaveMessage()}`);
 }finally{picker.saving=false;if(picker.root.isConnected)picker.root.querySelectorAll('button').forEach(value=>{value.disabled=false;});}
}
async function task(name){
 if(name==='close-dialog'){dialog.close();return;}
 if(name==='connection'){connectionDialog();return;}
 if(name==='device-setup'){deviceSetup();return;}
 if(name==='device-accounts'){await deviceAccounts.open();return;}
 if(name==='use-local'||name==='use-paired'){await switchWorkspace(name==='use-local');return;}
 if(name==='import-local'){const source=await openReplica(LOCAL_SCOPE);const pending=source.record.pending;source.close();modal(`<h2>Transférer mes créations locales</h2><p>Destination : ${esc(server)}. La destination reprend les événements et leurs identifiants de publication. Ils restent consultables ici ; leurs prochaines modifications se feront dans la destination. Les comptes et secrets restent sur cet appareil.</p><p>${pending.length} modification(s) à transférer.</p><ul>${pending.map(op=>`<li>${esc(op.value?.title||op.value?.label||op.key)}</li>`).join('')}</ul><button data-task="import-local-apply" ${pending.length?'':'disabled'}>Transférer ces modifications</button>`);return;}
 if(name==='import-local-apply'){
  if(!online)throw new Error('Connectez la régie de destination.');
  const source=await openReplica(LOCAL_SCOPE);
  try{for(const [id,asset] of Object.entries(source.record.localAssets||{})){
   const initial=source.record.pending.find(op=>op.key==='sound/'+id&&op.base===null&&op.value);
   if(!initial||!source.view().sounds.sounds.some(x=>x.id===id))continue;
   const file=await source.soundAsset(id);if(!file)throw new Error('Fichier audio local manquant : '+asset.name);
   const response=await fetch(server+'/api/v2/sounds/upload?id='+encodeURIComponent(id)+'&name='+encodeURIComponent(initial.value.name)+'&extension='+encodeURIComponent(asset.name.split('.').pop()),{method:'POST',headers:{...(server===localEndpoint?{}:{Authorization:`Device ${credential}`}), 'Content-Type':'application/octet-stream'},body:file,signal:AbortSignal.timeout(120000)});
   if(!response.ok){const failure=await response.json().catch(()=>({}));throw new Error('Transfert audio refusé : '+asset.name+' · '+(failure.error?.message||failure.error||response.status)+'. Les données locales sont conservées.');}
  }}finally{source.close();}
  await autonomy.store.importLocal(LOCAL_SCOPE);dialog.close();await refresh(true);return;
 }

 if(name==='sync-status'){syncDialog();return;}
 if(name==='sync-now'){await refresh();syncDialog();return;}
 if(name==='sync-export'){const blob=new Blob([JSON.stringify(autonomy?.store.record,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='StreamDashboard-copie-locale.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return;}
 if(!data)throw new Error('Connectez la régie.');
 if(name==='metadata'){metadataDialog();return;}
 if(name==='refresh-live'){await refresh(true);return;}
 if(name==='replay-config'){replayDialog();return;}
 if(name==='refresh-replay'){replay=await api('/api/v2/replay');if(dialog.open&&$('#replay-dialog-root'))replayDialog();else render();return;}
 if(name==='configure-platforms'){page='settings';tab='platforms';localStorage.setItem('sd2.page',page);render();return;}
 if(name==='new-action'){editAction();return;}
 if(name==='wizebot-catalog'){await wizebotManagement.open();return;}
 if(name==='new-wizebot'){editWizebot();return;}
 if(name==='new-event'){planning.open();return;}
 if(name==='timer-overlay'||name==='timer-reconnect'){
  const r=await api('/api/v2/timer/overlay',name==='timer-reconnect'?{}:undefined);
  modal(`<h2>Minuteur dans OBS</h2><p class="${r.ready?'succeeded':'warn'}">${r.ready?'Source confirmée dans la scène courante.':esc(r.error)}</p><p class="small">Source : ${esc(r.source||'À configurer')}</p><label>URL StreamDashboard Next sur le PC de stream<input readonly value="${esc(r.expectedUrl)}"></label><p class="small muted">Le compteur est visible en Introduction ou Pause. Si OBS utilise encore le port 48132, reconnectez sa source à Next.</p>${r.source?'<button data-task="timer-reconnect">Reconnecter la source à Next</button>':''}`);return;
 }
 if(name==='timer-duration'){modal(`<h2>Démarrer le minuteur</h2><form id="timer-form">${input('Durée en minutes','minutes',Math.max(1,data.host.state.timer.duration/60),'number','required min="0.016667" max="1440" step="any"')}<p class="small muted">Remplace la durée et démarre immédiatement sur la régie.</p><button>Démarrer cette durée</button></form>`);return;}
 if(name==='pairing'){const p=await api('/api/v1/remote/pairing',{management:true});modal(`<h2>Associer un appareil de confiance</h2><p class="small">Ce code donne accès au pilotage et à toute la configuration. Valable cinq minutes, une utilisation.</p><label>Lien à coller sur l’autre appareil<textarea readonly>${esc(`${p.urls[0]?.replace(/\/mobile\/?$/,'')}/mobile/control/?pair=${p.id}&code=${p.code}`)}</textarea></label><p>Code : <b>${esc(p.code)}</b></p><p class="small muted">Créez un code distinct pour chaque appareil.</p>`);return;}
 if(!server&&(['connect-twitch','connect-youtube','google-connect'].includes(name)||(native&&name==='google-secret'))){await deviceAccounts.open();return;}
 if(name==='connect-twitch'){await openAuthorization(await api('/api/v1/twitch/device',{}));return;}
 if(name==='connect-youtube'){await openAuthorization(await api('/api/v2/youtube/connect',{}));return;}
 if(name==='google-connect'){await openAuthorization(await api('/api/v1/google/oauth/start',{}));return;}
 if(name==='outputs'){
  const r=await api('/api/v2/outputs'),suite=r.streamSuite;
  $('#output-list').innerHTML=`<h3>Sorties OBS</h3><p>${esc(r.outputs.map(v=>`${v.outputName} (${v.outputActive?'active':'inactive'})`).join(' · ')||'Aucune sortie nommée exposée par OBS.')}</p><h3>Aitum Stream Suite ${esc(suite.version||'')}</h3>${suite.error?`<p>${esc(suite.error)}</p>`:suite.outputs.map(v=>`<p><b>${esc(v.name)}</b> · ${esc(v.type)} · ${v.active?'active':'inactive'} ${v.type==='stream'&&suite.outputs.filter(o=>o.name===v.name).length===1?['twitch','youtube'].map(p=>`<button type="button" class="secondary" data-suite-output="${esc(v.name)}" data-platform="${p}">Associer à ${p}</button>`).join(' '):''}</p>`).join('')||'<p>Aucune sortie Stream Suite configurée.</p>'}<p>Vérifiez chaque destination, puis enregistrez la diffusion.</p>`;return;
 }
 if(name==='youtube-broadcasts'){await openYouTubePicker();return;}
 if(name==='search-category'){
  const field=$('#twitch-game-query'),results=$('#category-results'),form=$('#metadata-form');
  const query=field?.value.trim();if(!query){field?.focus();throw new Error('Saisissez le nom du jeu ou de la catégorie Twitch.');}
  const sequence=++twitchGameSearch,source=server||localEndpoint;results.textContent='Recherche sur Twitch…';
  try{
   const r=await api('/api/v1/twitch/categories?query='+encodeURIComponent(query));
   if(sequence!==twitchGameSearch||!form.isConnected||source!==(server||localEndpoint))return;
   const items=Array.isArray(r)?r:r.items||r.data||[];
   results.innerHTML=items.map(value=>`<button type="button" class="secondary" data-category="${esc(value.id)}" data-category-name="${esc(value.name)}">${esc(value.name)}</button>`).join('')||'<p class="small muted">Aucun jeu trouvé. Essayez un autre nom.</p>';
  }catch(error){if(sequence===twitchGameSearch&&results.isConnected)results.textContent=error.message;}
  return;
 }
 if(name==='profile-json'){await jsonEditor('Profil complet','/api/v1/profile','profile');return;}
 if(name==='automations'){const r=await api('/api/v1/automations');modal(`<h2>Automatisations</h2><p class="small muted">Déclencheurs et actions sont exécutés par le PC de stream.</p>${(r.items||r.automations||r).map?.(a=>`<p><button class="secondary" data-automation="${esc(a.id)}">${esc(a.name||a.id)}</button></p>`).join('')||''}<button data-task="new-automation">Créer une règle</button>`);profileDraft=r;return;}
 if(name==='new-automation'){modal(`<h2>Nouvelle automatisation</h2><form id="automation-form"><label>Règle JSON<textarea name="value" rows="14">${esc(JSON.stringify({name:'Nouvelle règle',enabled:false,trigger:{type:'stream.started'},actions:[{type:'timer.start',payload:{}}]},null,2))}</textarea></label><button>Créer</button></form>`);return;}
 if(name==='sound-setup'){await api('/api/v1/soundboard/obs/setup',{});toast('Sources audio OBS préparées.');return;}
 if(name==='sounds'){const r=await api('/api/v1/soundboard');profileDraft=r;modal(`<h2>Bibliothèque audio de cet espace</h2>${r.sounds.map(s=>`<p><button class="secondary" data-sound="${esc(s.id)}">${esc(s.name)}</button> <code>${esc(s.id)}</code></p>`).join('')||'<p>Aucun son importé.</p>'}<button data-task="import-sound">Importer un son</button>`);return;}
 if(name==='import-sound'){modal(`<h2>Importer un son dans cet espace</h2><form id="sound-import"><label>Fichier audio<input type="file" name="file" accept=".wav,.mp3,.ogg,.aac,.m4a,.flac" required></label>${input('Nom du son','name','','text','required')}<button>Importer</button></form>`);return;}
 if(name==='google-calendars'){const r=await api('/api/v1/google/calendars');modal(`<h2>Calendrier de destination</h2>${(Array.isArray(r)?r:r.items||[]).filter(c=>c.writable||['owner','writer'].includes(c.accessRole)).map(c=>`<p><button class="secondary" data-calendar="${esc(c.id)}">${esc(c.summary)}</button></p>`).join('')||'<p>Connectez Google pour afficher les calendriers accessibles.</p>'}`);return;}
 if(name==='google-secret'){modal(`<h2>Client Secret Google sur la régie</h2><form id="secret-form" data-path="/api/v1/google/oauth/config" data-method="POST" data-key="clientSecret">${input('Client Secret Google Desktop','secret','','password','required')}<button>Enregistrer dans le stockage sécurisé</button></form>`);return;}
 if(name==='streamlabs'&&!native){const target=server||localEndpoint;streamlabsConfiguration({id:target,label:target===localEndpoint?'Cet appareil':`Régie · ${data.host.hostname||target}`});return;}
 if(name==='streamlabs'||name==='wizebot'){modal(`<h2>${name==='streamlabs'?'Streamlabs':'WizeBot'}</h2><form id="integration-form" data-provider="${name}">${name==='wizebot'?input('URL API WizeBot','apiBaseUrl','','url','required'):''}${input(name==='streamlabs'?'Socket Token Streamlabs':'Jeton WizeBot','token','','password','required')}<button>Connecter</button></form>`);return;}
 if(name==='discord'){const r=await api('/api/v1/discord/status');modal(`<h2>Discord</h2><form id="discord-form">${input('Jeton du bot (vide pour conserver)','token','','password')}${input('ID du serveur','guildId',r.guildId)}${input('ID du salon','channelId',r.channelId)}${input('Message par défaut','defaultMessage',r.defaultMessage)}<button>Enregistrer</button></form>`);return;}
 if(name==='shortcut-status'){const r=await globalThis.streamDashboardDesktop?.controllerStatus?.();$('#shortcut-status').textContent=r?JSON.stringify(r):'Les raccourcis globaux nécessitent l’application Windows ouverte sur cet ordinateur.';return;}

}
document.addEventListener('click',async event=>{const b=event.target.closest('button');if(!b)return;try{
 if(b.disabled)return;
 if(b.dataset.deckBank!==undefined){if(deckEditing)deckEditBank=b.dataset.deckBank;else updateDeckPreferences({bank:b.dataset.deckBank});resetPerformanceView();return;}
 if(b.dataset.deckEdit!==undefined){ensureDeckPreferences();deckEditing=!deckEditing;if(deckEditing)deckEditBank='all';resetPerformanceView();return;}
 if(b.dataset.deckFavorite!==undefined){const prefs=ensureDeckPreferences(),key=b.dataset.deckFavorite;updateDeckPreferences({favorites:prefs.favorites.includes(key)?prefs.favorites.filter(id=>id!==key):[...prefs.favorites,key]});render();return;}
 if(b.dataset.deckClips!==undefined){replayDialog();return;}
 if(b.dataset.deckLog!==undefined){modal(`<h2>Dernières actions</h2>${resultRows()}`);return;}
 if(b.dataset.planning){b.disabled=true;try{await planning.click(b);}finally{b.disabled=false;}return;}
 if(b.dataset.syncKeep||b.dataset.syncRemote){const key=b.dataset.syncKeep||b.dataset.syncRemote;if(b.dataset.syncKeep&&!confirm('Appliquer votre version à cette entité ? La version de la régie sera remplacée après comparaison.'))return;await autonomy.resolve(key,!!b.dataset.syncKeep);await refresh(true);syncDialog();return;}
 if(b.dataset.deckCategory!==undefined){deckCategory=b.dataset.deckCategory;render();return;}
 if(b.dataset.soundCategory!==undefined){if(compact){updateDeckPreferences({soundCategory:b.dataset.soundCategory});resetPerformanceView();}else{soundCategory=b.dataset.soundCategory;render();}return;}
 if(await deviceAccounts.click(b))return;
 if(await wizebotManagement.click(b))return;
 if(b.dataset.playSound){await runAction('sound.play',undefined,b.dataset.playSound);return;}
 if(b.dataset.favoriteSound){const sound=sounds.sounds.find(s=>s.id===b.dataset.favoriteSound);await api('/api/v1/soundboard/sounds/'+encodeURIComponent(sound.id),{favorite:!sound.favorite},'PUT');await refresh(true);return;}
 if(b.dataset.page){deckEditing=false;page=b.dataset.page;localStorage.setItem('sd2.page',page);resetPerformanceView();return;}
 if(b.dataset.tab){tab=b.dataset.tab;render();return;}
 if(b.dataset.suiteOutput!==undefined){const f=$('#platform-form'),p=b.dataset.platform;f.elements[p+'-kind'].value='aitum-suite';f.elements[p+'-name'].value=b.dataset.suiteOutput;toast('Association préparée. Enregistrez la diffusion pour la conserver.');return;}
 if(b.dataset.task){await task(b.dataset.task);return;}
 if(b.dataset.action){await runAction(b.dataset.action,b.dataset.livePlatform);return;}
 if(b.dataset.retry){await runAction(b.dataset.retry.startsWith('metadata.')?'metadata.retry':b.dataset.retry,b.dataset.platform);return;}
 if(b.dataset.command){if(busy||!online)return;activeCommands++;busy=true;try{await api('/api/v1/commands',{type:b.dataset.command,commandId:uuid()});await refresh(true);toast(timerStatus(data.host.state.timer));}finally{busy=--activeCommands>0;render();}return;}
 if(b.dataset.editAction){editAction(b.dataset.editAction);return;}
 if(b.dataset.removeAction){if(!confirm('Supprimer ce bouton et son association macro ?'))return;configurationDraft.actions=configurationDraft.actions.filter(a=>a.id!==b.dataset.removeAction);await api('/api/v2/configuration',{configuration:configurationDraft,expectedRevision:configurationDraft.revision},'PUT');dialog.close();await refresh(true);return;}
 if(b.dataset.broadcast){await chooseYouTubeBroadcast(b);return;}
 if(b.dataset.category){const form=$('#metadata-form'),name=b.dataset.categoryName||b.textContent.trim();form.elements.twitchGameId.value=b.dataset.category;twitchGameNames.set(b.dataset.category,name);$('#twitch-game-selected').textContent='Jeu sélectionné : '+name;$('#twitch-game-selected').className='small succeeded';$('#twitch-game-query').value=name;$('#category-results').innerHTML='';return;}
 if(b.dataset.calendar){await api('/api/v1/google/target',{calendarId:b.dataset.calendar},'PUT');dialog.close();toast('Calendrier enregistré.');return;}
 if(b.dataset.sound){const s=profileDraft.sounds.find(s=>s.id===b.dataset.sound);modal(`<h2>${esc(s.name)}</h2><form id="sound-form" data-id="${esc(s.id)}">${input('Nom','name',s.name)}${input('Catégorie','category',s.category)}${input('Volume (0 à 1)','volume',s.volume,'number','min="0" max="1" step="0.05"')}${input('Délai entre lectures (ms)','cooldownMs',s.cooldownMs,'number','min="0"')}${check('Activé','enabled',s.enabled)}${check('Favori','favorite',s.favorite)}${select('Destination','monitoringMode',[['stream','Diffusion OBS'],['monitor','Diffusion et écoute OBS']],s.monitoringMode)}<div class="form-actions"><button type="button" class="danger" data-delete-sound="${esc(s.id)}">Supprimer</button><button>Enregistrer</button></div></form>`);return;}
 if(b.dataset.deleteSound){if(!confirm('Supprimer ce son de la bibliothèque ?'))return;await api('/api/v1/soundboard/sounds/'+encodeURIComponent(b.dataset.deleteSound),{},'DELETE');dialog.close();await refresh(true);return;}
 if(b.dataset.automation){const all=profileDraft.items||profileDraft.automations||profileDraft;const a=all.find(a=>a.id===b.dataset.automation);modal(`<h2>Modifier la règle</h2><form id="automation-form" data-id="${esc(a.id)}"><label>Règle JSON<textarea name="value" rows="16">${esc(JSON.stringify(a,null,2))}</textarea></label><div class="form-actions"><button type="button" class="danger" data-delete-automation="${esc(a.id)}">Supprimer</button><button>Enregistrer</button></div></form>`);return;}
 if(b.dataset.deleteAutomation){if(!confirm('Supprimer cette automatisation ?'))return;await api('/api/v1/automations/'+encodeURIComponent(b.dataset.deleteAutomation),{},'DELETE');dialog.close();return;}
}catch(e){toast(e.message);}});
document.addEventListener('change',async event=>{if(planning.change(event.target))return;if(event.target.matches('[data-replay-auto]')){try{const c=structuredClone(data.configuration);c.replayAutoStart=event.target.checked;await api('/api/v2/configuration',{configuration:c,expectedRevision:c.revision},'PUT');await refresh(true);}catch(e){toast(e.message);await refresh(true);}return;}if(event.target.dataset.check){try{await api('/api/v1/commands',{type:'checklist.toggle',id:event.target.dataset.check,commandId:uuid()});await refresh(true);}catch(e){toast(e.message);}}});
document.addEventListener('submit',async event=>{const f=event.target;submittingBase=formBases.get(f);event.preventDefault();const v=Object.fromEntries(new FormData(f));const submit=f.querySelector('button:not([type=button])');if(submit)submit.disabled=true;try{
 if(f.id==='device-setup-form'){const previous=device;device=saveDevice(v);try{await globalThis.streamDashboardDesktop?.setDeviceRole?.(v.role,v.name);}catch(e){device=previous;localStorage.setItem('sd2.device',JSON.stringify(previous));throw e;}dialog.close();render();toast('Appareil configuré.');return;}
 if(await planning.submit(f))return;
 if(await wizebotManagement.submit(f))return;
 if(f.id==='timer-form'){await api('/api/v1/commands',{type:'timer.start',seconds:Math.round(Number(v.minutes)*60),commandId:uuid()});dialog.close();await refresh(true);toast(timerStatus(data.host.state.timer));return;}
 if(f.id==='connection-form'){
  let target=v.server;
  if(v.link){const link=new URL(v.link);target=link.searchParams.get('server')||link.origin;v.pair=link.searchParams.get('pair')||link.searchParams.get('id');v.code=link.searchParams.get('code');}
  const nextServer=normalizeServer(target);if(refreshFlight)await refreshFlight;
  // Validate pairing before replacing the working address or its credential.
  let nextCredential=nextServer===localStorage.getItem('sd2.server')?credential:'';
  if(v.pair&&v.code){const paired=await network('/api/v1/remote/pair',{id:v.pair,code:v.code,name:v.name},'POST',nextServer,'');nextCredential=paired.credential;}
  await network('/api/v2/autonomy',undefined,'GET',nextServer,nextCredential);
  await credentials.set(nextCredential);credential=nextCredential;server=nextServer;online=false;
  localStorage.setItem('sd2.server',server);localStorage.setItem('sd2.workspace-mode','paired');
  await openLocal();await refresh();if(online)dialog.close();render();return;
 }
 if(f.id==='metadata-form'){const metadata={title:v.title,description:v.description,twitchGameId:v.twitchGameId,youtubeCategoryId:v.youtubeCategoryId,tags:v.tags.split(',').map(x=>x.trim()).filter(Boolean)};await autonomy.store.draft('metadata',metadata);if(event.submitter?.value==='draft'){dialog.close();toast('Brouillon conservé sur cet appareil. Aucune plateforme modifiée.');return;}const result=await api('/api/v2/actions',{id:uuid(),issuedAt:new Date().toISOString(),action:'metadata.apply',expectedRevision:Number(f.dataset.revision),metadata});toast(`${labels[result.status]} · ${result.message}`);dialog.close();await refresh(true);return;}
 if(f.id==='wizebot-form'){const previous=configurationDraft.actions.find(a=>a.id===f.dataset.id);const a={id:f.dataset.id,label:v.label,type:'wizebot.command',value:v.value.trim(),color:v.color,shortcut:previous?.shortcut||'',...(previous?.wizebot&&v.value.trim()===previous.value?{wizebot:previous.wizebot}:{})};const index=configurationDraft.actions.findIndex(x=>x.id===a.id);if(index>=0)configurationDraft.actions[index]=a;else configurationDraft.actions.push(a);await api('/api/v2/configuration',{configuration:configurationDraft,expectedRevision:configurationDraft.revision},'PUT');}
 if(f.id==='action-form'){const a={id:f.dataset.id,...v};const index=configurationDraft.actions.findIndex(x=>x.id===a.id);if(index>=0)configurationDraft.actions[index]=a;else configurationDraft.actions.push(a);await api('/api/v2/configuration',{configuration:configurationDraft,expectedRevision:configurationDraft.revision},'PUT');}
 if(f.id==='settings-form'){const value={expectedRevision:f.dataset.revision,obsUrl:v.obsUrl,...(v.obsPassword?{obsPassword:v.obsPassword}:{}),primaryMicInput:v.primaryMicInput,timerBrowserSource:v.timerBrowserSource,chattingScene:v.chattingScene,startMode:v.startMode,requireTimerOverlayOnStart:!!v.requireTimerOverlayOnStart,launchObs:!!v.launchObs,obsExecutablePath:v.obsExecutablePath,remoteEnabled:!!v.remoteEnabled,modeScenes:Object.fromEntries(['intro','live','pause','end'].map(x=>[x,v['scene-'+x]]))};await api('/api/v2/settings',value,'PUT');}
 if(f.id==='profile-settings'){await api('/api/v2/settings',{expectedRevision:f.dataset.revision,streamerName:v.streamerName,accent:v.accent,confirmStop:!!v.confirmStop,streamerPingRewardIds:v.streamerPingRewardIds.split(',').map(x=>x.trim()).filter(Boolean),tagPreferences:JSON.parse(v.tagPreferences)},'PUT');}
 if(f.id==='platform-form'){const c=structuredClone(data.configuration);c.youtube={clientId:v.clientId,broadcastId:v.broadcastId,channelId:v.channelId};for(const p of ['twitch','youtube'])c.outputs[p]={kind:v[p+'-kind'],name:v[p+'-name']};await api('/api/v2/configuration',{configuration:c,expectedRevision:Number(f.dataset.revision)},'PUT');}
 if(f.id==='json-form'){const value=JSON.parse(v.value);await api(f.dataset.path,value,f.dataset.method);}
 if(f.id==='secret-form'){await api(f.dataset.path,{[f.dataset.key]:v.secret},f.dataset.method);}
 if(f.id==='integration-form'){await api((f.dataset.provider==='wizebot'?'/api/v1/wizebot/config':'/api/v1/supports/streamlabs/config'),v,'PUT');}
 if(f.id==='discord-form'){if(v.token)await api('/api/v1/discord/token',{token:v.token},'PUT');await api('/api/v1/discord/settings',{guildId:v.guildId,channelId:v.channelId,defaultMessage:v.defaultMessage},'PUT');}
 if(f.id==='sound-form'){await api('/api/v1/soundboard/sounds/'+encodeURIComponent(f.dataset.id),{...v,volume:Number(v.volume),cooldownMs:Number(v.cooldownMs),enabled:!!v.enabled,favorite:!!v.favorite},'PUT');}
 if(f.id==='sound-import'){const file=f.elements.file.files[0];if(!file||file.size>100*1024*1024)throw new Error('Fichier audio requis, maximum 100 Mo.');if(!server){await autonomy.store.addSound(file,v.name);}else{const result=await fetch(server+'/api/v2/sounds/upload?name='+encodeURIComponent(v.name)+'&extension='+encodeURIComponent(file.name.split('.').pop()),{method:'POST',headers:{Authorization:`Device ${credential}`,'Content-Type':'application/octet-stream'},body:file,signal:AbortSignal.timeout(120_000)});if(!result.ok){const r=await result.json();throw new Error(r.error?.message||'Import impossible.');}}}
 if(f.id==='automation-form'){await api('/api/v1/automations'+(f.dataset.id?'/'+encodeURIComponent(f.dataset.id):''),JSON.parse(v.value),f.dataset.id?'PUT':'POST');}
 if(dialog.open)dialog.close();await refresh(true);toast(localSaveMessage());
}catch(e){toast(e.message);}finally{submittingBase=undefined;if(submit)submit.disabled=f.dataset.completed==='true';}});
document.addEventListener('keydown',event=>{if(event.target.id==='twitch-game-query'&&event.key==='Enter'){event.preventDefault();void task('search-category').catch(error=>toast(error.message));return;}if(globalThis.streamDashboardDesktop)return;if(event.ctrlKey&&event.altKey&&event.shiftKey&&!event.repeat&&online){const a=data?.configuration.actions.find(a=>a.shortcut===`Control+Alt+Shift+${event.key}`);if(a){event.preventDefault();void runAction(a.id);}}});
const initial=new URL(location.href);if(initial.searchParams.has('pair')){connectionDialog();$('#connection-form').elements.link.value=location.href;history.replaceState(null,'',location.pathname);}
globalThis.streamDashboardDesktop?.onControllerReceipt?.(receipt=>{toast(`${labels[receipt.status]||'Macro'} · ${receipt.message}`);void refresh(true);});
globalThis.StreamDashboardNative?.setKeepAwake(true);
globalThis.StreamDashboardHandleBack=()=>{if(dialog.open){dialog.close();return true;}if(deckEditing){deckEditing=false;resetPerformanceView();return true;}if(page!=='deck'){page='deck';localStorage.setItem('sd2.page',page);resetPerformanceView();return true;}return false;};
compactViewport.addEventListener('change',()=>{compact=native||compactViewport.matches;document.documentElement.classList.toggle('compact-app',compact);render();});
globalThis.addEventListener('native-pairing',event=>{const u=new URL(event.detail);connectionDialog();$('#connection-form').elements.server.value=u.searchParams.get('server')||'';$('#connection-form').elements.pair.value=u.searchParams.get('id')||'';$('#connection-form').elements.code.value=u.searchParams.get('code')||'';});
await openLocal();void navigator.storage?.persist?.().catch(()=>{});render();await refresh(true);if(firstUse&&!dialog.open&&(!data?.host.planning.length)&&(!data?.host.settings.streamerName||data.host.settings.streamerName==='Streamer'))deviceSetup();setInterval(()=>{void refresh();},2500);setInterval(()=>{void deviceAccounts.poll();},5000);

// Do not replace a pressed control between pointerdown and click during a poll.
document.addEventListener('pointerdown',()=>{pointerHeld=true;});
for(const name of ['pointerup','pointercancel'])document.addEventListener(name,()=>{setTimeout(()=>{pointerHeld=false;},0);});
setInterval(()=>{const t=data?.host.state.timer;if(!t)return;const clock=$('[data-timer-clock]');if(clock)clock.textContent=timerClock(online&&t.running&&t.deadline?Math.max(0,(t.deadline-Date.now())/1000):t.remaining);const status=$('[data-timer-status]');if(status)status.textContent=timerStatus(t);},250);
