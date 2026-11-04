import {mountAgentStatus} from './agent-v2-status.js';
import {callDeviceBridge} from './device-bridge.js';
import {randomUuid} from '../shared/uuid.js';
import {createTwitchChat} from './twitch-chat.js';
import {mountTwitchAdvanced} from './streamcockpit-twitch-advanced.js';
import {mountTwitchModeration} from './streamcockpit-twitch-moderation.js';
import {mountTwitchMoments} from './streamcockpit-twitch-moments.js';
import {mountTwitchPoll} from './streamcockpit-twitch-poll.js';
import {mountTwitchShoutout} from './streamcockpit-twitch-shoutout.js';
import {mountTwitchRaid} from './streamcockpit-twitch-raid.js';
import {mountTwitchPrediction} from './streamcockpit-twitch-prediction.js';
import {mountTwitchPredictionCreate} from './streamcockpit-twitch-prediction-create.js';
import {mountTwitchPredictionRelease} from './streamcockpit-twitch-prediction-release.js';
import {mountTwitchPredictionLock} from './streamcockpit-twitch-prediction-lock.js';
import {mountTwitchPredictionEnd} from './streamcockpit-twitch-prediction-end.js';
export function createLiveMonitor(root,{native=false,configure=()=>{},request,controlRequest=request,activityRoot}={}){
 let enabled=localStorage.getItem('sd2.monitor-enabled')===null?matchMedia('(min-width:701px)').matches:localStorage.getItem('sd2.monitor-enabled')==='true';
 let state,context={},disposed=false,viewerFlight,viewerRevision=0,viewerMessage='';
 let chatSource=localStorage.getItem('sd2.twitch-chat-source')==='device'?'device':'host';
 const deviceChatKey='android:twitch-local-account';
 root.className='live-monitor spacer';
 root.innerHTML='<div class="section-heading"><div><h2>Retour Twitch & chat</h2><p class="small muted">Retour vidéo spectateur, son coupé.</p></div><button type="button" class="secondary" data-monitor-toggle></button></div>'
 +'<div class="monitor-grid" data-monitor-body><section class="panel monitor-video"><div class="monitor-heading"><h3>Retour Twitch</h3></div><div class="monitor-slot video-slot" data-monitor-slot="video"></div><div class="monitor-footer"><a data-monitor-link="video" target="_blank" rel="noopener noreferrer">Ouvrir Twitch ↗</a><button type="button" class="secondary" data-monitor-connect="twitch">Connexion visionneuse</button><button type="button" class="secondary" data-monitor-reload="video">Recharger</button></div></section>'
 +'<section class="panel monitor-chat monitor-native-twitch"><div class="monitor-heading"><h3><span class="chat-dot twitch-dot"></span>Chat Twitch</h3></div><div data-twitch-source></div><div data-twitch-native></div><div class="monitor-footer monitor-creator-links"><a data-monitor-link="twitch" target="_blank" rel="noopener noreferrer">Chat dans le navigateur ↗</a><a data-monitor-link="twitch-creator" target="_blank" rel="noopener noreferrer">Régie Twitch ↗</a></div></section></div>'
 +'<p class="small muted" data-monitor-note><span data-monitor-viewer-status role="status"></span> Le chat Twitch utilise le compte connecté.</p><details class="monitor-targets"><summary>Choisir la chaîne Twitch</summary><form data-monitor-targets><label>Chaîne Twitch<input name="channel" maxlength="25"></label><button>Enregistrer</button><p data-monitor-targets-status role="status"></p></form></details>';
 const agentStatus=mountAgentStatus(root);
 const get=selector=>root.querySelector(selector),slot=get('[data-monitor-slot="video"]');
 get('[name="channel"]').value=localStorage.getItem('sd2.monitor-channel')||'';
 if(activityRoot){activityRoot.classList.add('monitor-activity');get('[data-monitor-body]').classList.add('monitor-grid-with-activity');get('[data-monitor-body]').append(activityRoot);}
 const sourcePicker=get('[data-twitch-source]');
 if(native)sourcePicker.innerHTML='<label>Source du chat Twitch<select data-chat-source aria-label="Source du chat Twitch"><option value="host">Régie sélectionnée</option><option value="device">Compte Twitch Android</option></select></label><p class="small muted" data-chat-source-note></p>';
 const nativeRequest=async(path,body,method)=>{
  const operation=path==='/api/v1/twitch/chat/state'?'twitchChatState':path==='/api/v1/twitch/chat/messages'?'twitchChatSend':'';
  // Local chat never borrows the paired host's moderation identity.
  if(!operation)throw new Error('Modération disponible avec le chat de la régie sélectionnée.');
  const response=await callDeviceBridge(globalThis.StreamDashboardProviders,operation,body?{...body,id:randomUuid()}:{});
  if(response.ok===false)throw new Error(response.message||'Reconnectez Twitch.');return response;
 };
 // Advanced reads always use the paired/local host transport, never the native account bridge.
 const twitchAdvanced=mountTwitchAdvanced(get('.monitor-chat'),{request:controlRequest});
 const twitchModeration=mountTwitchModeration(get('.monitor-chat'),{request:controlRequest});
 const twitchMoments=mountTwitchMoments(get('.monitor-chat'),{request:controlRequest});
 const twitchPoll=mountTwitchPoll(get('.monitor-chat'),{request:controlRequest});
 const twitchShoutout=mountTwitchShoutout(get('.monitor-chat'),{request:controlRequest});
 const twitchRaid=mountTwitchRaid(get('.monitor-chat'),{request:controlRequest});
 const twitchPrediction=mountTwitchPrediction(get('.monitor-chat'),{request:controlRequest});
 const twitchPredictionCreate=mountTwitchPredictionCreate(get('.monitor-chat'),{request:controlRequest});
 const twitchPredictionRelease=mountTwitchPredictionRelease(get('.monitor-chat'),{request:controlRequest});
 const twitchPredictionLock=mountTwitchPredictionLock(get('.monitor-chat'),{request:controlRequest});
 const twitchPredictionEnd=mountTwitchPredictionEnd(get('.monitor-chat'),{request:controlRequest});
 const chatRequest=(path,body,method,sourceKey)=>{
  if(!native)return request?.(path,body,method,sourceKey);
  if(chatSource==='device'){
   if(sourceKey!==deviceChatKey)throw new Error('La source du chat a changé.');
   return nativeRequest(path,body,method);
  }
  const host=context.authorityKey??context.sourceKey;
  const available=context.authorityOnline??context.online;
  if(!host||sourceKey!==host||available!==true||typeof request!=='function')throw new Error('Régie du chat déconnectée. Aucun envoi effectué.');
  return request(path,body,method,host);
 };
 const twitchChat=createTwitchChat(get('[data-twitch-native]'),{request:chatRequest,configure});
 if(native)get('[data-chat-source]').addEventListener('change',event=>{
  const choice=event.target.value;
  if(choice!=='host'&&choice!=='device')return;
  chatSource=choice;localStorage.setItem('sd2.twitch-chat-source',choice);draw();
 });
 function twitchLogin(){const login=localStorage.getItem('sd2.monitor-channel')||state?.host?.monitor?.twitchLogin||'';return /^[a-zA-Z0-9_]{1,25}$/.test(login)?login.toLowerCase():'';}
 function link(key,url){const a=get('[data-monitor-link="'+key+'"]');a.hidden=!url;if(url)a.href=url;else a.removeAttribute('href');}
 function mount(url){
  const identity=url||'missing';if(slot.dataset.identity===identity)return;slot.dataset.identity=identity;slot.replaceChildren();
  if(!url){const m=document.createElement('p');m.textContent='Connectez Twitch sur la régie pour voir sa chaîne.';slot.append(m);return;}
  if(native){const m=document.createElement('p');m.textContent='Ouvrez la visionneuse Twitch sur cet Android.';const b=document.createElement('button');b.className='secondary';b.textContent='Ouvrir la visionneuse';b.addEventListener('click',openNativeViewers);slot.append(m,b);return;}
  const f=document.createElement('iframe');f.title='Retour Twitch';f.referrerPolicy='strict-origin-when-cross-origin';f.allow='autoplay; encrypted-media; picture-in-picture; fullscreen';f.allowFullscreen=true;f.src=url;slot.append(f);
 }
 function openNativeViewers(){const opened=globalThis.StreamDashboardNative?.openViewers?.(JSON.stringify({twitch:twitchLogin(),youtube:'',source:'twitch'}));viewerMessage=opened?'Visionneuse Twitch ouverte.':'Visionneuse indisponible. Ouvrez Twitch dans le navigateur.';draw();}
 async function connectViewer(){
  if(native){openNativeViewers();return;}
  const channel=twitchLogin();if(disposed||viewerFlight||!enabled||!channel)return;
  const open=globalThis.streamDashboardDesktop?.openTwitchViewerSession;
  if(typeof open!=='function'){window.open('https://www.twitch.tv/login','_blank','noopener,noreferrer');viewerMessage='Connectez-vous dans votre navigateur Twitch.';draw();return;}
  const revision=viewerRevision,op=Promise.resolve().then(()=>open({channel}));viewerFlight=op;viewerMessage='Terminez la connexion Twitch dans la fenêtre ouverte.';draw();
  try{const result=await op;if(disposed||revision!==viewerRevision)return;if(result?.status!=='closed')throw new Error('Fenêtre non confirmée');delete slot.dataset.identity;viewerMessage='Visionneuse Twitch rechargée.';}catch{viewerMessage='Connexion visionneuse non confirmée.';}finally{if(viewerFlight===op)viewerFlight=undefined;if(!disposed)draw();}
 }
 function draw(){
  if(disposed)return;
  const chatOnly=context.chatOnly===true;
  get('[data-monitor-toggle]').textContent=enabled?'Masquer les écrans':'Afficher les écrans';
  get('[data-monitor-toggle]').setAttribute('aria-expanded',String(enabled));
  get('[data-monitor-body]').hidden=!enabled&&!chatOnly&&!activityRoot;get('[data-monitor-body]').dataset.screensEnabled=String(enabled||chatOnly);
  root.querySelectorAll('.monitor-video').forEach(card=>card.hidden=!enabled||chatOnly);
  root.querySelectorAll('.monitor-chat').forEach(card=>card.hidden=!enabled&&!chatOnly);
  get('[data-monitor-note]').hidden=!enabled&&!chatOnly;
  get('[data-monitor-viewer-status]').textContent=viewerMessage||'Session visionneuse Twitch et API distinctes.';
  const connect=get('[data-monitor-connect="twitch"]');connect.disabled=Boolean(viewerFlight)||!twitchLogin();connect.textContent=viewerFlight?'Connexion ouverte…':'Connexion visionneuse';
  const authorityKey=typeof context.authorityKey==='string'?context.authorityKey:context.sourceKey;
  const authorityOnline=context.authorityOnline===undefined?context.online===true:context.authorityOnline===true;
  twitchAdvanced.update({sourceKey:authorityKey,accountKey:state?.host?.monitor?.twitchLogin,online:authorityOnline&&(enabled||chatOnly)});
  twitchPoll.update({sourceKey:authorityKey,accountKey:state?.host?.monitor?.twitchLogin,online:authorityOnline&&(enabled||chatOnly)});
  twitchShoutout.update({sourceKey:authorityKey,accountKey:state?.host?.monitor?.twitchLogin,online:authorityOnline&&(enabled||chatOnly)});
  twitchModeration.update({sourceKey:authorityKey,accountKey:state?.host?.monitor?.twitchLogin,online:authorityOnline&&(enabled||chatOnly)});
  twitchMoments.update({sourceKey:authorityKey,accountKey:state?.host?.monitor?.twitchLogin,online:authorityOnline&&(enabled||chatOnly)});
  twitchRaid.update({sourceKey:authorityKey,accountKey:state?.host?.monitor?.twitchLogin,online:authorityOnline&&(enabled||chatOnly)});
  twitchPrediction.update({sourceKey:authorityKey,accountKey:state?.host?.monitor?.twitchLogin,online:authorityOnline&&(enabled||chatOnly)});
  twitchPredictionCreate.update({sourceKey:authorityKey,accountKey:state?.host?.monitor?.twitchLogin,online:authorityOnline&&(enabled||chatOnly)});
  twitchPredictionRelease.update({sourceKey:authorityKey,accountKey:state?.host?.monitor?.twitchLogin,online:authorityOnline&&(enabled||chatOnly)});
  twitchPredictionLock.update({sourceKey:authorityKey,accountKey:state?.host?.monitor?.twitchLogin,online:authorityOnline&&(enabled||chatOnly)});
  twitchPredictionEnd.update({sourceKey:authorityKey,accountKey:state?.host?.monitor?.twitchLogin,online:authorityOnline&&(enabled||chatOnly)});
  const localChat=native&&chatSource==='device';
  const chatKey=native?(localChat?deviceChatKey:authorityKey):context.sourceKey;
  if(native){
   get('[data-chat-source]').value=chatSource;
   get('[data-chat-source-note]').textContent=localChat?'Messages avec le compte Android. Les outils ci-dessous utilisent le compte de la régie.':'Compte de la régie sélectionnée · aucune connexion Twitch Android nécessaire.';
  }
  twitchChat.update({...context,sourceKey:chatKey,online:(native?(localChat||authorityOnline):context.online===true)&&(enabled||chatOnly),
   sourceLabel:localChat?'Compte Twitch Android':state?.host?.hostname||''});
  if(!enabled||chatOnly){slot.replaceChildren();delete slot.dataset.identity;return;}
  const login=twitchLogin(),parent=encodeURIComponent(location.hostname);
  mount(login&&'https://player.twitch.tv/?channel='+login+'&parent='+parent+'&muted=true&autoplay=true');
  link('video',login&&'https://www.twitch.tv/'+login);link('twitch',login&&'https://www.twitch.tv/popout/'+login+'/chat?popout=');
  link('twitch-creator',login&&'https://dashboard.twitch.tv/u/'+login+'/stream-manager');
 }
 get('[data-monitor-targets]').addEventListener('submit',event=>{event.preventDefault();event.stopPropagation();const channel=get('[name="channel"]').value.trim();if(channel&&!/^[a-zA-Z0-9_]{1,25}$/.test(channel)){get('[data-monitor-targets-status]').textContent='Nom Twitch invalide.';return;}localStorage.setItem('sd2.monitor-channel',channel);viewerRevision++;viewerMessage='';delete slot.dataset.identity;draw();get('[data-monitor-targets-status]').textContent='Chaîne Twitch enregistrée.';});
 root.addEventListener('click',event=>{if(disposed)return;const b=event.target.closest('button');if(!b)return;if(b.hasAttribute('data-monitor-toggle')){enabled=!enabled;viewerRevision++;localStorage.setItem('sd2.monitor-enabled',String(enabled));draw();}if(b.dataset.monitorConnect==='twitch')void connectViewer();if(b.dataset.monitorReload==='video'){delete slot.dataset.identity;draw();}});
 const stop=globalThis.streamDashboardDesktop?.onTwitchViewerSessionClosed?.(()=>{if(disposed||!enabled||!twitchLogin())return;delete slot.dataset.identity;viewerMessage='Visionneuse Twitch rechargée.';draw();});
 return {update(value,options={}){if(disposed)return;if(context.sourceKey!==options.sourceKey||state?.host?.monitor?.twitchLogin!==value?.host?.monitor?.twitchLogin){viewerRevision++;viewerMessage='';}state=value;context=options;draw();},destroy(){disposed=true;agentStatus.destroy();viewerRevision++;if(typeof stop==='function')stop();twitchChat.destroy();twitchAdvanced.destroy();twitchModeration.destroy();twitchMoments.destroy();twitchPoll.destroy();twitchShoutout.destroy();twitchRaid.destroy();twitchPrediction.destroy();twitchPredictionCreate.destroy();twitchPredictionRelease.destroy();twitchPredictionLock.destroy();twitchPredictionEnd.destroy();slot.replaceChildren();}};
}
