import {mountAgentStatus} from './agent-v2-status.js';
import {callDeviceBridge} from './device-bridge.js';
import {randomUuid} from '../shared/uuid.js';
import {createTwitchChat} from './twitch-chat.js';
import {mountTwitchAdvanced} from './streamcockpit-twitch-advanced.js';
export function createLiveMonitor(root,{native=false,configure=()=>{},request,activityRoot}={}){
 let enabled=localStorage.getItem('sd2.monitor-enabled')===null?matchMedia('(min-width:701px)').matches:localStorage.getItem('sd2.monitor-enabled')==='true';
 let state,context={},disposed=false,viewerFlight,viewerRevision=0,viewerMessage='';
 root.className='live-monitor spacer';
 root.innerHTML='<div class="section-heading"><div><h2>Retour Twitch & chat</h2><p class="small muted">Retour vidéo spectateur, son coupé.</p></div><button type="button" class="secondary" data-monitor-toggle></button></div>'
 +'<div class="monitor-grid" data-monitor-body><section class="panel monitor-video"><div class="monitor-heading"><h3>Retour Twitch</h3></div><div class="monitor-slot video-slot" data-monitor-slot="video"></div><div class="monitor-footer"><a data-monitor-link="video" target="_blank" rel="noopener noreferrer">Ouvrir Twitch ↗</a><button type="button" class="secondary" data-monitor-connect="twitch">Connexion visionneuse</button><button type="button" class="secondary" data-monitor-reload="video">Recharger</button></div></section>'
 +'<section class="panel monitor-chat monitor-native-twitch"><div class="monitor-heading"><h3><span class="chat-dot twitch-dot"></span>Chat Twitch</h3></div><div data-twitch-native></div><div class="monitor-footer monitor-creator-links"><a data-monitor-link="twitch" target="_blank" rel="noopener noreferrer">Chat dans le navigateur ↗</a><a data-monitor-link="twitch-creator" target="_blank" rel="noopener noreferrer">Régie Twitch ↗</a></div></section></div>'
 +'<p class="small muted" data-monitor-note><span data-monitor-viewer-status role="status"></span> Le chat Twitch utilise le compte connecté.</p><details class="monitor-targets"><summary>Choisir la chaîne Twitch</summary><form data-monitor-targets><label>Chaîne Twitch<input name="channel" maxlength="25"></label><button>Enregistrer</button><p data-monitor-targets-status role="status"></p></form></details>';
 const agentStatus=mountAgentStatus(root);
 const get=selector=>root.querySelector(selector),slot=get('[data-monitor-slot="video"]');
 get('[name="channel"]').value=localStorage.getItem('sd2.monitor-channel')||'';
 if(activityRoot){activityRoot.classList.add('monitor-activity');get('[data-monitor-body]').classList.add('monitor-grid-with-activity');get('[data-monitor-body]').append(activityRoot);}
 const nativeRequest=async(path,body,method)=>{
  const operation=path==='/api/v1/twitch/chat/state'?'twitchChatState':path==='/api/v1/twitch/chat/messages'?'twitchChatSend':'';
  // Moderation belongs to the paired host: the native account bridge only implements read/send.
  // Never treat unsupported native commands as missing Twitch permissions.
  if(!operation){
    if(/^\/api\/v1\/twitch\/moderation\/(?:capabilities|messages\/[A-Za-z0-9_-]+|bans(?:\/[0-9]+)?)$/.test(path)
      && typeof request==='function') return request(path,body,method,context.sourceKey);
    throw new Error('Opération chat inconnue.');
  }
  const response=await callDeviceBridge(globalThis.StreamDashboardProviders,operation,body?{...body,id:randomUuid()}:{});
  if(response.ok===false)throw new Error(response.message||'Reconnectez Twitch.');return response;
 };
 // Advanced reads always use the paired/local host transport, never the native account bridge.
 const twitchAdvanced=mountTwitchAdvanced(get('.monitor-chat'),{request});
 const twitchChat=createTwitchChat(get('[data-twitch-native]'),{request:native?nativeRequest:request,configure});
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
  twitchAdvanced.update({sourceKey:context.sourceKey,accountKey:state?.host?.monitor?.twitchLogin,online:context.online===true&&(enabled||chatOnly)});
  twitchChat.update({...context,online:(native||context.online===true)&&(enabled||chatOnly),sourceLabel:state?.host?.hostname||''});
  if(!enabled||chatOnly){slot.replaceChildren();delete slot.dataset.identity;return;}
  const login=twitchLogin(),parent=encodeURIComponent(location.hostname);
  mount(login&&'https://player.twitch.tv/?channel='+login+'&parent='+parent+'&muted=true&autoplay=true');
  link('video',login&&'https://www.twitch.tv/'+login);link('twitch',login&&'https://www.twitch.tv/popout/'+login+'/chat?popout=');
  link('twitch-creator',login&&'https://dashboard.twitch.tv/u/'+login+'/stream-manager');
 }
 get('[data-monitor-targets]').addEventListener('submit',event=>{event.preventDefault();event.stopPropagation();const channel=get('[name="channel"]').value.trim();if(channel&&!/^[a-zA-Z0-9_]{1,25}$/.test(channel)){get('[data-monitor-targets-status]').textContent='Nom Twitch invalide.';return;}localStorage.setItem('sd2.monitor-channel',channel);viewerRevision++;viewerMessage='';delete slot.dataset.identity;draw();get('[data-monitor-targets-status]').textContent='Chaîne Twitch enregistrée.';});
 root.addEventListener('click',event=>{if(disposed)return;const b=event.target.closest('button');if(!b)return;if(b.hasAttribute('data-monitor-toggle')){enabled=!enabled;viewerRevision++;localStorage.setItem('sd2.monitor-enabled',String(enabled));draw();}if(b.dataset.monitorConnect==='twitch')void connectViewer();if(b.dataset.monitorReload==='video'){delete slot.dataset.identity;draw();}});
 const stop=globalThis.streamDashboardDesktop?.onTwitchViewerSessionClosed?.(()=>{if(disposed||!enabled||!twitchLogin())return;delete slot.dataset.identity;viewerMessage='Visionneuse Twitch rechargée.';draw();});
 return {update(value,options={}){if(disposed)return;if(context.sourceKey!==options.sourceKey||state?.host?.monitor?.twitchLogin!==value?.host?.monitor?.twitchLogin){viewerRevision++;viewerMessage='';}state=value;context=options;draw();},destroy(){disposed=true;agentStatus.destroy();viewerRevision++;if(typeof stop==='function')stop();twitchChat.destroy();twitchAdvanced.destroy();slot.replaceChildren();}};
}
