import { callDeviceBridge } from './device-bridge.js';
import { createDeviceStreamlabs } from './device-streamlabs.js';
import {parseWizeBotCatalog} from '../shared/planning-engine.js';

// Non-live integrations are addressed on this device. Credentials never enter
// the replica, transfer journal, exports or HTML.
export function createDeviceServices({store,autonomy,request,bridge=globalThis.StreamDashboardProviders}) {
 let tail=Promise.resolve();
 const serial=work=>{const task=()=>globalThis.navigator?.locks?navigator.locks.request('sd-services:'+store.record.workspace,work):work();const result=tail.then(task);tail=result.catch(()=>{});return result;};
 async function call(payload){
  if(typeof bridge?.deviceService!=='function')throw new Error('Mettez à jour cette application pour configurer ce service local.');
  const result=await callDeviceBridge(bridge,'deviceService',payload);
  if(result.ok===false)throw Object.assign(new Error(result.message||'Service indisponible.'),{code:result.code});return result;
 }
 const streamlabs=bridge?createDeviceStreamlabs({store,call}):null;
 const configPaths={'/api/v1/discord/token':'discord','/api/v1/supports/streamlabs/config':'streamlabs','/api/v1/wizebot/config':'wizebot'};
 async function catalog(refresh=false){
  if(!refresh)return store.record.drafts.wizebotCatalog||{channel:'',fetchedAt:'',items:[],edits:[]};
  const value=bridge?await call({provider:'wizebot',operation:'catalog'}):await request('/api/v2/wizebot/refresh',{});
  await store.reload();
  const result=bridge?{channel:value.channel,items:parseWizeBotCatalog(value.catalog),fetchedAt:new Date().toISOString(),edits:store.record.drafts.wizebotCatalog?.edits||[]}:value;
  if(bridge)await store.draft('deviceChat',{connected:true,canSend:value.canSend===true,channel:value.channel});
  else {const state=await request('/api/v2/state');await store.draft('deviceChat',state.host.chat);}
  for(const edit of result.edits){const item=result.items.find(x=>x.id===edit.commandId);if(edit.status==='running')edit.status='uncertain';if(edit.status==='uncertain'&&edit.channel===result.channel&&item?.kind==='SAY'&&item.publishedText===edit.response&&edit.previousPublishedText!==edit.response&&!/[\$<>]/.test(edit.response)){edit.status='succeeded';edit.message='Nouvelle réponse relue et confirmée chez WizeBot.';}}
  await store.draft('wizebotCatalog',result);return result;
 }
 async function route(path,body,method){
  if(streamlabs){const value=await streamlabs.route(path,body,method);if(value!==undefined)return value;}
  if(configPaths[path])return bridge?call({provider:configPaths[path],operation:'configure',value:body}):request(path,body,method);
  if(path==='/api/v1/google/oauth/config'&&!bridge)return request(path,body,method);
  if(path==='/api/v1/discord/status'){
   const state=bridge?await call({provider:'discord',operation:'status'}):await request(path);
   return {...state,...store.view().extras.discord};
  }
  if(path==='/api/v1/discord/planning'){
   const settings=store.view().extras.discord;
   // There is deliberately no outbox for messages; an uncertain send stays
   // uncertain and requires checking Discord before another explicit click.
   if(bridge)return call({provider:'discord',operation:'publish',...settings,...body});
   await request('/api/v1/discord/settings',settings,'PUT');return request(path,body,method);
  }
  if(path==='/api/v2/wizebot/context'&&(!method||method==='GET')){
   let context;
   if(bridge)context=await call({provider:'wizebot',operation:'context'});
   else{const state=await request('/api/v1/twitch/chat/state');context={connected:state.accountConnected===true,canSend:state.capabilities?.chatWrite===true,channel:state.identity?.userName||''};}
   await store.draft('deviceChat',{connected:context.connected===true,canSend:context.canSend===true,channel:context.channel});return context;
  }
  if(path==='/api/v2/wizebot/command'&&method==='POST'){
   const {commandId,channel,command}=body||{};
   if(!/^[a-zA-Z0-9_-]{8,100}$/.test(commandId||'')||!/^[a-z0-9_]{1,25}$/.test(channel||'')||typeof command!=='string'||command.length>500||!/^![\p{L}\p{N}_-]+(?: [^\r\n]*)?$/u.test(command)||/[\x00-\x1f\x7f]/.test(command))throw new Error('Commande WizeBot ou chaîne invalide.');
   const receipts=structuredClone(store.record.drafts.wizebotCommands||[]),previous=receipts.find(value=>value.commandId===commandId);
   if(previous){if(previous.channel!==channel||previous.command!==command)throw new Error('Identifiant de commande réutilisé.');return previous;}
   const receipt={commandId,channel,command,status:'uncertain',message:'Envoi Twitch non confirmé. Aucun renvoi automatique.'};
   receipts.push(receipt);await store.draft('wizebotCommands',receipts.slice(-200));
   try{
    let result;
    if(bridge)result=await callDeviceBridge(bridge,'wizebotSendCommand',{commandId,channel,command});
    else{
     const state=await request('/api/v1/twitch/chat/state');
     if(!state.accountConnected||!state.capabilities?.chatWrite||!state.identity?.broadcasterId||state.identity.userName!==channel)result={ok:false,code:'INVALID_LINK',message:'Le compte Twitch ou ses droits ont changé. Actualisez vos boutons WizeBot.'};
     else{const sent=await request('/api/v1/twitch/chat/messages',{message:command,expectedBroadcasterId:state.identity.broadcasterId},'POST');result={ok:true,status:'sent',messageId:sent.messageId,message:'Commande envoyée dans le chat Twitch. La réponse de WizeBot reste à vérifier.'};}
    }
    if(result.ok===false){receipt.status=['INVALID_PAYLOAD','INVALID_LINK','REAUTH_REQUIRED','NOT_CONFIGURED','HTTP_400','HTTP_401','HTTP_403','HTTP_429'].includes(result.code)?'failed':'uncertain';receipt.message=result.message||receipt.message;}
    else{receipt.status=result.status==='sent'?'succeeded':result.status==='failed'?'failed':'uncertain';receipt.message=result.message||receipt.message;if(result.messageId)receipt.messageId=result.messageId;}
   }catch(error){if(!bridge&&[400,401,403,409,429].includes(error?.status)){receipt.status='failed';receipt.message='La commande a été refusée par Twitch. Vérifiez le compte et les droits du tchat.';}}
   await store.draft('wizebotCommands',receipts.slice(-200));return receipt;
  }
  if(path==='/api/v2/wizebot/catalog')return catalog();
  if(path==='/api/v2/wizebot/refresh')return catalog(true);
  if(path==='/api/v2/wizebot/edit'){
   if(!bridge){const result=await request(path,body,method);await catalog(true);return result;}
   const c=await catalog(true),response=String(body.response||'').trim(),message=`!cmd edit ${body.commandId} ${response}`;
   if(!/^[\w-]{8,100}$/.test(body.id)||!/^\d{1,30}$/.test(body.commandId)||!response||message.length>500||/[\x00-\x1f\x7f]/.test(response)||/\$cmd\s*\(/i.test(response)||response.includes('###'))throw new Error('Réponse WizeBot invalide.');
   if(body.channel!==c.channel)throw new Error('La chaîne Twitch a changé.');
   const previous=c.edits.find(x=>x.id===body.id);if(previous){if(previous.response!==response||previous.commandId!==body.commandId)throw new Error('Identifiant réutilisé.');return previous;}
   const item=c.items.find(x=>x.id===body.commandId);if(!item||item.kind!=='SAY'||item.revision!==body.expectedRevision)throw new Error('Commande modifiée chez WizeBot : actualisez avant de la remplacer.');
   const pending=c.edits.find(x=>x.commandId===item.id&&x.response===response&&x.status==='uncertain');if(pending&&body.retryOf!==pending.id)return pending;
   const edit={id:body.id,channel:c.channel,commandId:item.id,response,previousPublishedText:item.publishedText,status:'uncertain',createdAt:new Date().toISOString(),message:'Envoi non confirmé. Aucun renvoi automatique.'};
   if(item.publishedText===response&&!/[\$<>]/.test(response)){edit.status='succeeded';edit.message='Cette réponse est déjà publiée. Aucun message envoyé.';c.edits.push(edit);await store.draft('wizebotCatalog',c);return edit;}
   c.edits.push(edit);await store.draft('wizebotCatalog',c);
   try{
    const sent=await callDeviceBridge(bridge,'wizebotSendEdit',{id:body.id,channel:c.channel,commandId:item.id,response});
    if(sent.ok===false){edit.status=sent.nonCreation?'failed':'uncertain';edit.message=sent.message||'Envoi non confirmé.';await store.draft('wizebotCatalog',c);return edit;}
    if(sent.status==='failed'){edit.status='failed';edit.message=sent.message;}
    else {edit.messageId=sent.messageId;edit.message='Commande envoyée ou en cours ; confirmation WizeBot attendue. Vérifiez le résultat avant de recommencer.';}
    await store.draft('wizebotCatalog',c);
    if(sent.status==='sent')for(const delay of [1000,2000,3000]){await new Promise(r=>setTimeout(r,delay));const current=await catalog(true);const result=current.edits.find(x=>x.id===body.id);if(result?.status==='succeeded')return result;}
   }catch(e){edit.message=e.message;await store.draft('wizebotCatalog',c);}
   return edit;
  }
  if(path==='/api/v2/wizebot/import'){
   const c=await catalog(),configuration=structuredClone(store.view().data.configuration);let added=0,updated=0,existing=0;
   if(body.channel!==c.channel||!Array.isArray(body.ids)||body.ids.length>100)throw new Error('Actualisez la liste et la sélection.');
   for(const id of new Set(body.ids)){
    const item=c.items.find(x=>x.id===id);if(!item?.aliases.length)throw new Error('Commande absente de la liste.');
    let action=configuration.actions.find(a=>a.wizebot?.channel===c.channel&&a.wizebot.id===id);
    if(action){if(!item.aliases.includes(action.value)){action.value=item.aliases[0];updated++;}else existing++;continue;}
    action=configuration.actions.find(a=>a.type==='wizebot.command'&&item.aliases.includes(a.value)&&!a.wizebot);
    if(action){action.wizebot={channel:c.channel,id};existing++;continue;}
    configuration.actions.push({id:`wiz_${c.channel}_${id}`,label:item.aliases[0],type:'wizebot.command',value:item.aliases[0],color:'purple',shortcut:'',wizebot:{channel:c.channel,id}});added++;
   }
   await autonomy.mutate('/api/v2/configuration',{configuration},'PUT');return {added,updated,existing,catalog:c};
  }
  return undefined;
 }
 return {wait:()=>tail,route:(path,body,method)=>serial(async()=>{await store.reload();return route(path,body,method);})};
}
