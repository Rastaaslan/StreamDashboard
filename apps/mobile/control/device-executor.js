import {createExecutorSync} from './executor-sync.js';
import {openSoundTransferStore,SOUND_TRANSFER} from './sound-transfer-store.js';
import {actionDefinition,actionCapability} from '../shared/action-definition.js';
import {deviceRoleAvailable,publicInstallationDevice} from '../shared/installation.js';
import {validateDevicePermissions} from '../shared/device-permissions.js';

const fault=(code,message,status=409)=>Object.assign(new Error(message),{code,status});
const id=()=>crypto.randomUUID?.()||Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
const secret=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
const equalToken=(left,right)=>{if(typeof left!=='string'||left.length!==right.length)return false;let different=0;for(let i=0;i<left.length;i++)different|=left.charCodeAt(i)^right.charCodeAt(i);return different===0;};

export function createExecutorBridge(bridge=globalThis.StreamDashboardExecutor,events=globalThis){
 if(!bridge)return null;
 const pending=new Map();
 events.addEventListener('executor-result',event=>{const entry=pending.get(event.detail?.id);if(!entry)return;pending.delete(event.detail.id);clearTimeout(entry.timer);try{const value=JSON.parse(event.detail.result);if(!value.ok)throw new Error(value.message);entry.resolve(value.value);}catch(error){entry.reject(error);}});
 return {
  call(operation,value={}){const request=id();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(request);reject(new Error('Réponse de l’agent Android non reçue.'));},15000);pending.set(request,{resolve,reject,timer});bridge.postMessage(JSON.stringify({id:request,operation,...value}));});},
  listen(handle){events.addEventListener('executor-request',async event=>{const request=event.detail;let response;try{response=await handle(request);}catch{response={status:500,body:{error:{code:'EXECUTOR_FAILED',message:'Résultat non confirmé.'}}};}bridge.postMessage(JSON.stringify({id:request.id,operation:'reply',...response}));});},
 };
}

/** Same action/receipt contract as Windows, with a device-owned workspace.
 * Permission grants are encrypted by the native bridge; credentials never enter
 * the replica, public snapshots, transfers or exports. */
export async function createDeviceExecutor({bridge,installation,runtime,now=Date.now,openViewers}){
 if(!bridge)return null;
 let config=await bridge.call('load')||{version:1,revision:0,enabled:false,devices:[]};
 if(config.version!==1||!Array.isArray(config.devices))throw new Error('Configuration de partage Android incompatible.');
 let info={enabled:false,urls:[],fingerprint:''},tail=Promise.resolve();
 const pairs=new Map(),attempts=new Map();
 const serial=work=>{const result=tail.then(work);tail=result.catch(()=>{});return result;};
 let commands=Promise.resolve(),executing=false;
 const executeSerial=work=>{if(executing)throw fault('EXECUTOR_BUSY','Une commande est déjà en préparation. L’arrêt reste disponible.',429);executing=true;const result=commands.then(work).finally(()=>{executing=false;});commands=result.catch(()=>{});return result;};
 const own=()=>{const value=installation();return value.devices.find(d=>d.id===value.localDeviceId);};
 const persist=async next=>{await bridge.call('save',{value:next});config=next;};
 const currentDevice=request=>{const token=String(request.authorization||'').replace(/^Device /,'');return config.devices.find(device=>!device.revokedAt&&equalToken(token,device.credential));};
 const authorize=(request,permission)=>{
  if(!config.enabled||!info.enabled)throw fault('DEVICE_UNAVAILABLE','Le partage Android est arrêté.',503);
  const device=currentDevice(request);if(!device)throw fault('UNAUTHORIZED','Appareil non associé ou révoqué.',401);
  if(!device.permissions.includes(permission))throw fault('REMOTE_SCOPE_DENIED','Permission manquante sur cet Android.',403);
  return device;
 };
 const requireRole=capability=>{if(!deviceRoleAvailable(own(),capability))throw fault('DEVICE_ROLE_STOPPED','Le rôle requis est arrêté sur cet Android.');};
 const publicDevices=()=>config.devices.map(({credential,...device})=>device);
 const actions=owner=>{
  const bundle=owner.owner.store.view(),configured=bundle.data.configuration.actions;
  const generated=bundle.sounds.sounds.map(sound=>({id:'sound_'+sound.id,label:sound.name,type:'sound.play',value:sound.id,color:'green',shortcut:''}));
  return [...configured,...generated.filter(sound=>!configured.some(action=>action.id===sound.id)),{id:'device-sound-stop',label:'Arrêter tous les sons',type:'sound.stop',value:'',color:'red',shortcut:''}];
 };
 async function state(synthetic=true){const owner=await runtime();await owner.owner.store.reload();const value=structuredClone(owner.owner.store.view().data);if(synthetic)value.configuration.actions=actions(owner);value.receipts=[...(owner.owner.store.record.drafts.deviceReceipts||[]),...Object.values(owner.owner.store.record.drafts.executorReceipts||{}).map(entry=>entry.receipt)].sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt)).slice(-50);value.host.chat=owner.owner.store.record.drafts.deviceChat||value.host.chat;value.host.hostname=own().name;value.host.device=publicInstallationDevice(own());return value;}
 async function command(request,body){
  const owner=await runtime(),store=owner.owner.store;
  // Stop bypasses the command queue so a pending decoder cannot prevent it.
  const configured=actions(owner).find(action=>action.id===body.action),type=configured?.type||body.action;
  const permission=type==='viewer.open'?'chat':actionCapability(type||'');authorize(request,permission);
  if(!['sound.play','sound.stop','wizebot.command','viewer.open'].includes(type))throw fault('CAPABILITY_UNSUPPORTED','Cette action nécessite un autre exécuteur.');
  if(type!=='sound.stop')requireRole(type==='viewer.open'?'viewer':permission);
  if(type==='viewer.open'&&(!body.viewer||Object.keys(body.viewer).some(key=>!['twitch','youtube','source'].includes(key))||!['twitch','youtube'].includes(body.viewer.source)||!/^[a-zA-Z0-9_]{0,25}$/.test(body.viewer.twitch||'')||body.viewer.youtube&&!/^[a-zA-Z0-9_-]{11}$/.test(body.viewer.youtube)))throw fault('INVALID_VIEWER','Chaîne Twitch ou diffusion YouTube invalide.',400);
  if(!/^[A-Za-z0-9_-]{8,100}$/.test(body.id||'')||!Number.isFinite(Date.parse(body.issuedAt))||Math.abs(now()-Date.parse(body.issuedAt))>120000)throw fault('INVALID_COMMAND','Commande invalide ou périmée.',400);
  if(body.expectedAction&&(!configured||actionDefinition(configured)!==actionDefinition(body.expectedAction)))throw fault('REVISION_CONFLICT','La définition du bouton a changé.');
  const execute=async()=>{
   await store.reload();authorize(request,permission);if(type!=='sound.stop')requireRole(type==='viewer.open'?'viewer':permission);
   const current=configured&&actions(owner).find(action=>action.id===configured.id);
   if(configured&&actionDefinition(configured)!==actionDefinition(current))throw fault('REVISION_CONFLICT','Le bouton a changé pendant l’attente.');
   const signature=JSON.stringify([currentDevice(request).id,type,configured?.value||body.soundId||'',body.viewer||null]);
   const receipt={id:body.id,action:body.action,status:'uncertain',message:'Commande enregistrée ; résultat à vérifier.',createdAt:new Date(now()).toISOString(),deviceId:own().id,deviceName:own().name};
   let duplicate;
   await store.updateDraft('executorReceipts',saved=>{
    const existing=saved?.[body.id];if(existing){if(existing.signature!==signature)throw fault('COMMAND_ID_REUSED','Identifiant déjà utilisé pour une autre action.');duplicate=existing.receipt;return saved;}
    const fresh=Object.fromEntries(Object.entries(saved||{}).filter(([,value])=>now()-value.at<180000));
    if(Object.keys(fresh).length>=512)throw fault('EXECUTOR_BUSY','Trop de commandes récentes. Patientez.',429);
    fresh[body.id]={signature,at:now(),receipt};return fresh;
   });
   if(duplicate)return duplicate;
   // Persistence must succeed before any sound, message or viewer effect.
   try{
    let result;
    if(type==='sound.play')result=await owner.audio.play(configured?.value||body.soundId);
    else if(type==='sound.stop')result=owner.audio.stop();
    else if(type==='viewer.open'){if(!openViewers?.(body.viewer||{}))throw new Error('Écrans Android indisponibles.');result={status:'succeeded',message:'Écrans ouverts sur '+own().name};}
    else{
     const context=await owner.services.route('/api/v2/wizebot/context',undefined,'GET');
     if(!context.connected||!context.canSend||!context.channel)throw fault('CHAT_UNAVAILABLE','Connectez le chat Twitch sur cet Android.');
     if(configured?.wizebot?.channel&&configured.wizebot.channel!==context.channel)throw fault('CHAT_ACCOUNT_CHANGED','Le compte du bouton ne correspond plus.');
     result=await owner.services.route('/api/v2/wizebot/command',{commandId:body.id,channel:context.channel,command:configured?.value||''},'POST');
    }
    receipt.status=result.status==='sent'?'succeeded':result.status||'uncertain';receipt.message=result.message||'Résultat à vérifier.';
   }catch(error){receipt.status=error.code==='CANCELED'?'failed':'uncertain';receipt.message=error.message||'Résultat non confirmé.';}
   // Re-read: Stop may have written its receipt during a pending play.
   await store.updateDraft('executorReceipts',saved=>({...saved,[body.id]:{signature,at:now(),receipt}}));return receipt;
  };
  return type==='sound.stop'?execute():executeSerial(execute);
 }
 async function localRequest(path,body,method=body===undefined?'GET':'POST'){
  if(path==='/api/v1/remote/info'){info=await bridge.call('info');return {...info,configured:config.enabled,error:info.enabled?'':'Partage désactivé. Gardez l’application ouverte pour recevoir les commandes.'};}
  if(path==='/api/v2/state')return {host:{settingsRevision:String(config.revision)}};
  if(path==='/api/v2/settings'&&method==='PUT')return serial(async()=>{
   if(String(config.revision)!==String(body.expectedRevision))throw fault('REVISION_CONFLICT','Réglages modifiés ailleurs.');
   await persist({...config,revision:config.revision+1,enabled:body.remoteEnabled===true});
   pairs.clear();info=await bridge.call(config.enabled?'start':'stop');return {saved:true};
  });
  if(path==='/api/v1/remote/devices')return publicDevices();
  if(path==='/api/v1/remote/pairing'&&method==='POST'){
   if(!config.enabled||!info.enabled)throw fault('DEVICE_UNAVAILABLE','Activez le partage Android avant de créer un code.');
   for(const [key,value] of pairs)if(value.expires<=now())pairs.delete(key);
   if(pairs.size>=8)throw fault('PAIRING_LIMIT','Huit codes sont déjà en attente.');
   const pair={id:id(),code:String(crypto.getRandomValues(new Uint32Array(1))[0]%1000000).padStart(6,'0'),expires:now()+300000,permissions:validateDevicePermissions(body.permissions)};pairs.set(pair.id,pair);
   return {...pair,urls:info.urls,fingerprint:info.fingerprint};
  }
  const match=path.match(/^\/api\/v1\/remote\/devices\/([A-Za-z0-9_-]+)(?:\/(permissions|revoke))?$/);
  if(match&&!(match[2]==='permissions'&&method==='PUT'||match[2]==='revoke'&&method==='POST'||!match[2]&&method==='DELETE'))throw fault('INVALID_METHOD','Méthode invalide.',405);
  if(match)return serial(async()=>{const previous=config.devices.find(device=>device.id===match[1]);if(!previous)throw fault('NOT_FOUND','Appareil inconnu.',404);
   if(match[2]==='permissions'&&JSON.stringify(previous.permissions)!==JSON.stringify(body.expectedPermissions))throw fault('REVISION_CONFLICT','Permissions modifiées ailleurs.');
   const next=structuredClone(config),device=next.devices.find(value=>value.id===previous.id);
   if(match[2]==='permissions')device.permissions=validateDevicePermissions(body.permissions);else device.revokedAt=new Date(now()).toISOString();
   await persist({...next,revision:next.revision+1});return {saved:true};
  });
  throw fault('NOT_FOUND','Fonction de partage inconnue.',404);
 }
 const synchronize=createExecutorSync({runtime,workspace:()=> 'device:'+own().id,authorize,requireRole});
 const audioSnapshot=owner=>{const value=owner.audio.snapshot();return {...value,available:value.available!==false&&deviceRoleAvailable(own(),'audio'),executorDeviceId:own().id,outputs:[{id:'device-default',name:'Cet Android · sortie système'}],sounds:value.sounds.map(sound=>({...sound,outputId:'device-default'}))};};
 async function snapshot(){const owner=await runtime();const data=await state(false);const bundle=structuredClone(owner.owner.store.view());bundle.data=data;bundle.sounds=audioSnapshot(owner);bundle.savedAt=now();return {workspace:'device:'+own().id,bundle};}
 async function handle(request){
  try{
   const body=request.body?JSON.parse(request.body):{},path=request.path.split('?')[0];
   if(path==='/api/v1/remote/pair'&&request.method==='POST')return {status:200,body:await serial(async()=>{
    if(!config.enabled||!info.enabled)throw fault('DEVICE_UNAVAILABLE','Partage arrêté.',503);
    const attempt=attempts.get(request.remote)||{at:now(),count:0};if(now()-attempt.at>300000){attempt.at=now();attempt.count=0;}attempts.set(request.remote,attempt);if(++attempt.count>10)throw fault('PAIRING_LIMIT','Trop de tentatives.',429);
    if(attempts.size>128)attempts.delete(attempts.keys().next().value);
    const pair=pairs.get(body.pairingId||body.id);if(!pair||pair.expires<now()||!equalToken(String(body.code||''),pair.code))throw fault('PAIRING_INVALID','Code incorrect ou expiré.',401);
    if(config.devices.filter(device=>!device.revokedAt).length>=64)throw fault('DEVICE_LIMIT','Limite d’appareils atteinte.');
    const device={id:id(),name:String(body.name||'Contrôleur').trim().slice(0,80),permissions:pair.permissions,credential:secret(),createdAt:new Date(now()).toISOString()};
    // Consume before durable enrollment: a disk error cannot make a code reusable.
    pairs.delete(pair.id);await persist({...config,revision:config.revision+1,devices:[...config.devices.filter(d=>!d.revokedAt),device]});return {credential:device.credential,deviceId:device.id};
   })};
   if(path==='/api/v2/actions'&&request.method==='POST')return {status:200,body:await command(request,body)};
   if(path==='/api/v2/autonomy/sync'&&request.method==='POST'){const receipt=await synchronize(request,body);return {status:200,body:{...await snapshot(),receipt}};}
   if(path.startsWith('/api/v2/sounds/transfer/')&&request.method==='POST'){
    const caller=authorize(request,'configuration'),owner=await runtime(),store=await openSoundTransferStore(owner.owner.store.scope);
    const guard=()=>{if(authorize(request,'configuration').id!==caller.id)throw fault('UNAUTHORIZED','Association modifiée.',401);};
    try{
     const operation=path.slice('/api/v2/sounds/transfer/'.length);let receipt;
     if(operation==='begin')receipt=await store.begin(body,caller.id,guard);
     else if(operation==='chunk')receipt=await store.append(body.id,body.offset,body.chunk,caller.id,guard);
     else if(operation==='finish')receipt=await store.finish(body.id,caller.id,guard);
     else if(operation==='cancel')receipt=await store.cancel(body.id,caller.id,guard);
     else throw fault('NOT_FOUND','Opération audio inconnue.',404);
     return {status:200,body:receipt};
    }finally{store.close();}
   }
   const caller=authorize(request,'observe');
   if(request.method!=='GET')throw fault('REMOTE_SCOPE_DENIED','Cette fonction doit être configurée sur l’appareil.',403);
   if(path==='/api/v2/device')return {status:200,body:{version:1,device:publicInstallationDevice(own()),observed:{permissions:caller.permissions,soundTransfer:SOUND_TRANSFER}}};
   if(path==='/api/v2/state')return {status:200,body:await state()};
   if(path==='/api/v2/autonomy')return {status:200,body:await snapshot()};
   if(path==='/api/v2/replay')return {status:200,body:{active:false,available:false,enabled:false,seconds:0,error:'OBS nécessite un ordinateur associé.'}};
   if(path==='/api/v1/soundboard'){const owner=await runtime();return {status:200,body:audioSnapshot(owner)};}
   throw fault('NOT_FOUND','Fonction distante indisponible sur cet appareil.',404);
  }catch(error){return {status:error.status||400,body:{error:{code:error.code||'INVALID_REQUEST',message:error.message||'Requête invalide.',retryable:false}}};}
 }
 bridge.listen(handle);
 if(config.enabled)try{info=await bridge.call('start');}catch(error){info.error=error.message;}
 return {localRequest,handle,command,info:()=>({...info,configured:config.enabled})};
}
