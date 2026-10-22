import {callDeviceBridge} from './device-bridge.js';

/** Native cloud commands are explicit, journalled effects, never an offline outbox. */
export function createDevicePlatforms({store,bridge,enabled=()=>true}){
 const call=async(operation,value={})=>{
  if(!enabled('cloud'))throw new Error('Le rôle services cloud est désactivé sur cet appareil.');
  const response=await callDeviceBridge(bridge,'platformService',{operation,...value});
  if(response.ok===false)throw Object.assign(new Error(response.message||'Opération cloud non confirmée.'),{code:response.code});
  return response;
 };
 const validId=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{8,100}$/.test(id)&&!['__proto__','constructor','prototype'].includes(id);
 async function prepare(value){
  if(!validId(value?.id)||!value.metadata?.title?.trim()||!['private','unlisted','public'].includes(value.privacyStatus)||typeof value.madeForKids!=='boolean'||!Number.isFinite(Date.parse(value.scheduledStartTime)))throw new Error('Préparation YouTube invalide.');
  const fingerprint=JSON.stringify(value);
  const saved=await store.journalRead('youtubePreparations',value.id);
  if(saved){if(saved.fingerprint!==fingerprint)throw new Error('Identifiant utilisé avec d’autres paramètres.');return saved.receipt.status==='running'?{...saved.receipt,status:'uncertain',message:'Préparation interrompue. Vérifiez YouTube Studio ; aucun renvoi automatique.'}:saved.receipt;}
  if(value.expectedRevision!==store.view().data.configuration.revision)throw new Error('La configuration a changé. Rouvrez le formulaire.');
  if(Date.parse(value.scheduledStartTime)<Date.now()-60000)throw new Error('Choisissez une date actuelle ou future.');
  const receipt={id:value.id,status:'running',phase:'checking',channelId:value.channelId,title:value.metadata.title,createdAt:new Date().toISOString(),message:'Vérification du compte…'};
  const claim=await store.journalClaim('youtubePreparations',value.id,{fingerprint,receipt});
  if(!claim.created){if(claim.value.fingerprint!==fingerprint)throw new Error('Identifiant utilisé avec d’autres paramètres.');return {...claim.value.receipt,status:claim.value.receipt.status==='running'?'uncertain':claim.value.receipt.status};}
  const save=()=>store.journalSave('youtubePreparations',value.id,{fingerprint,receipt});
  try{
   const channels=await call('youtube.channels');if(channels.items?.length!==1||channels.items[0].id!==value.channelId)throw new Error('Le compte YouTube a changé.');
   const streams=await call('youtube.streams');if(!streams.items?.some(s=>s.id===value.streamId&&s.channelId===value.channelId))throw new Error('Flux réutilisable absent de la chaîne.');
   receipt.phase='creating';await save();
   const created=await call('youtube.create',value);receipt.broadcastId=created.broadcastId;receipt.phase='binding';await save();
   await call('youtube.bind',{broadcastId:receipt.broadcastId,channelId:value.channelId,streamId:value.streamId});receipt.phase='metadata';await save();
   await call('youtube.metadata',{broadcastId:receipt.broadcastId,channelId:value.channelId,metadata:value.metadata});receipt.phase='verified';receipt.status='succeeded';receipt.message='Diffusion créée, flux associé et informations vérifiées. Vous pouvez la sélectionner.';
  }catch(error){receipt.status=receipt.broadcastId?'partial':receipt.phase==='checking'?'failed':'uncertain';receipt.message=(error.message||'Résultat non confirmé.')+' Vérifiez la liste ou YouTube Studio avant toute nouvelle création. Aucun renvoi automatique.';}
  await save();return structuredClone(receipt);
 }
 async function metadata(body){
  if(!validId(body?.id)||!Number.isFinite(Date.parse(body.issuedAt))||Math.abs(Date.now()-Date.parse(body.issuedAt))>30000)throw new Error('Commande invalide ou expirée.');
  if(body.platform&&!['twitch','youtube'].includes(body.platform))throw new Error('Plateforme invalide.');
  const config=store.view().data.configuration,value=body.metadata||store.record.drafts.metadata;
  const fingerprint=JSON.stringify([body.action,body.platform||'',value]);
  const previous=await store.journalRead('cloudMetadataReceipts',body.id);
  if(previous){if(previous.fingerprint!==fingerprint)throw new Error('Identifiant de commande réutilisé.');return {...previous.receipt,...(previous.receipt.status==='running'?{status:'uncertain',message:'Publication interrompue. Vérifiez les plateformes avant de recommencer.'}:{})};}
  if(body.action==='metadata.apply'&&body.expectedRevision!==config.revision)throw new Error('Configuration modifiée. Rouvrez le formulaire.');
  if(!value?.title?.trim())throw new Error('Titre requis.');
  const receipt={id:body.id,action:body.action,status:'running',platforms:{},createdAt:new Date().toISOString(),message:'Publication en cours.'};
  const claim=await store.journalClaim('cloudMetadataReceipts',body.id,{fingerprint,receipt});
  if(!claim.created){if(claim.value.fingerprint!==fingerprint)throw new Error('Identifiant de commande réutilisé.');return {...claim.value.receipt,status:claim.value.receipt.status==='running'?'uncertain':claim.value.receipt.status};}
  const save=()=>store.journalSave('cloudMetadataReceipts',body.id,{fingerprint,receipt});
  await store.draft('metadata',value);
  for(const platform of body.platform?[body.platform]:['twitch','youtube']){
   try{await call(platform+'.metadata',{metadata:value,...(platform==='youtube'?{broadcastId:config.youtube.broadcastId,channelId:config.youtube.channelId}:{})});receipt.platforms[platform]={status:'succeeded',message:'Informations relues et confirmées',observedAt:new Date().toISOString()};}
   catch(error){receipt.platforms[platform]={status:'uncertain',message:error.message||'Résultat non confirmé. Vérifiez la plateforme.',observedAt:new Date().toISOString()};}
   await save();
  }
  const values=Object.values(receipt.platforms);receipt.status=values.every(v=>v.status==='succeeded')?'succeeded':values.some(v=>v.status==='succeeded')?'partial':'uncertain';receipt.message=receipt.status==='succeeded'?'Informations confirmées sur les plateformes choisies.':'Consultez le résultat par plateforme avant de réessayer.';receipt.finishedAt=new Date().toISOString();await save();
  await store.draft('metadataResults',receipt.platforms);await store.updateDraft('deviceReceipts',saved=>[...(saved||[]).filter(v=>v.id!==receipt.id),receipt].slice(-50));return receipt;
 }
 return {async route(path,body,method){
  const catalog=path.match(/^\/api\/v2\/youtube\/(channels|broadcasts|streams)$/);
  if(catalog&&(!method||method==='GET'))return call('youtube.'+catalog[1]);
  if(path==='/api/v2/youtube/prepare'&&method==='POST')return prepare(body);
  if(path==='/api/v2/actions'&&['metadata.apply','metadata.retry'].includes(body?.action))return metadata(body);
  if(path==='/api/v2/youtube/connect')throw new Error('Connectez YouTube depuis « Mes comptes sur cet appareil ».');
  return undefined;
 }};
}
