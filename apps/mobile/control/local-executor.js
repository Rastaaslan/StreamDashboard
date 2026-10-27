import {actionDefinition} from '../shared/action-definition.js';

const supported=new Set(['sound.play','sound.stop','wizebot.command']);
const fault=(code,message)=>Object.assign(new Error(message),{code});
/** Device-owned commands use the existing replica, including edits made while
 * offline. A durable receipt precedes the effect; restarting never replays it. */
export function createLocalExecutor({store,audio,services,enabled=()=>true,now=Date.now}){
 let busy=false,disposed=false,stopping=0,stopGeneration=0;
 const read=async()=>{await store.reload();if(!store.record.workspace?.startsWith('local:'))throw fault('WORKSPACE_UNAVAILABLE','Espace autonome indisponible.');};
 const actions=()=>store.view().data.configuration.actions;
 const requireRole=type=>{if(type!=='sound.stop'&&!enabled(type==='wizebot.command'?'chat':'audio'))throw fault('DEVICE_ROLE_STOPPED','Le rôle requis est arrêté sur cet appareil.');};
 async function state(){await read();return {workspace:store.record.workspace,actions:actions().filter(action=>supported.has(action.type)),sounds:audio.snapshot()};}
 async function command(body){
  if(disposed)throw fault('DEVICE_UNAVAILABLE','L’agent local est arrêté.');
  if(!body||!/^[-\w]{8,100}$/.test(body.id)||!Number.isFinite(Date.parse(body.issuedAt))||Math.abs(now()-Date.parse(body.issuedAt))>120000)throw fault('INVALID_COMMAND','Commande invalide ou périmée.');
  await read();
  if(body.workspace!==store.record.workspace)throw fault('WORKSPACE_CHANGED','L’identité de l’espace autonome a changé. Actualisez les macros.');
  const configured=structuredClone(actions().find(action=>action.id===body.action)),type=configured?.type||body.action;
  if(!supported.has(type))throw fault('CAPABILITY_UNSUPPORTED','Cette action nécessite un autre appareil compatible.');
  if(body.expectedAction&&(!configured||actionDefinition(configured)!==actionDefinition(body.expectedAction)))throw fault('REVISION_CONFLICT','La définition du bouton a changé.');
  requireRole(type);
  if((busy||stopping)&&type!=='sound.stop')throw fault('EXECUTOR_BUSY','Une commande est en cours. Cet appui ne sera pas exécuté plus tard.');
  if(type==='sound.stop'){stopping++;stopGeneration++;}else busy=true;
  const generation=stopGeneration;
  try{
   const signature=JSON.stringify([type,configured?.value||body.soundId||'',configured?.wizebot||null]);
   const receipt={id:body.id,action:body.action,status:'uncertain',message:'Commande enregistrée ; résultat à vérifier.',createdAt:new Date(now()).toISOString()};
   let previous;
   await store.updateDraft('nativeExecutorReceipts',saved=>{
    previous=saved?.[body.id];if(previous){if(previous.signature!==signature)throw fault('COMMAND_ID_REUSED','Identifiant déjà utilisé pour une autre commande.');return saved;}
    const next=Object.fromEntries(Object.entries(saved||{}).filter(([,entry])=>now()-entry.at<180000));
    if(Object.keys(next).length>=512)throw fault('EXECUTOR_BUSY','Trop de commandes récentes. Patientez.');
    return {...next,[body.id]:{signature,at:now(),receipt}};
   });
   if(previous)return previous.receipt;
   try{
    await read();requireRole(type);
    if(disposed||now()-Date.parse(body.issuedAt)>120000)throw fault('COMMAND_EXPIRED','Commande expirée ou agent arrêté.');
    if(type==='sound.play'&&generation!==stopGeneration)throw fault('CANCELED','Lecture annulée par l’arrêt des sons.');
    if(configured&&actionDefinition(actions().find(action=>action.id===configured.id))!==actionDefinition(configured))throw fault('REVISION_CONFLICT','Le bouton a changé pendant la préparation.');
    let result;
    if(type==='sound.play')result=await audio.play(configured?.value||body.soundId);
    else if(type==='sound.stop')result=await audio.stop();
    else{
     const context=await services.route('/api/v2/wizebot/context',undefined,'GET');
     await read();requireRole(type);
     if(disposed||now()-Date.parse(body.issuedAt)>120000)throw fault('COMMAND_EXPIRED','Commande expirée ou agent arrêté.');
     if(!context.connected||!context.canSend||!context.channel)throw fault('CHAT_UNAVAILABLE','Connectez le chat Twitch sur cet appareil.');
     if(configured?.wizebot?.channel&&configured.wizebot.channel!==context.channel)throw fault('CHAT_ACCOUNT_CHANGED','Le compte du bouton ne correspond plus.');
     if(!configured||actionDefinition(actions().find(action=>action.id===configured.id))!==actionDefinition(configured))throw fault('REVISION_CONFLICT','Le bouton a changé pendant la préparation.');
     result=await services.route('/api/v2/wizebot/command',{commandId:body.id,channel:context.channel,command:configured.value},'POST');
    }
    receipt.status=result.status==='sent'?'succeeded':result.status||'uncertain';receipt.message=result.message||'Résultat à vérifier.';
   }catch(error){receipt.status=['CANCELED','REVISION_CONFLICT','DEVICE_ROLE_STOPPED','COMMAND_EXPIRED','CHAT_UNAVAILABLE','CHAT_ACCOUNT_CHANGED'].includes(error.code)?'failed':'uncertain';receipt.message=error.message||'Résultat non confirmé.';}
   await store.updateDraft('nativeExecutorReceipts',saved=>({...saved,[body.id]:{signature,at:now(),receipt}}));
   await store.updateDraft('deviceReceipts',saved=>[...(saved||[]).filter(item=>item.id!==body.id),receipt].slice(-50));
   return receipt;
  }finally{if(type==='sound.stop')stopping--;else busy=false;}
 }
 return {state,command,dispose(){disposed=true;audio.dispose();store.close();}};
}
