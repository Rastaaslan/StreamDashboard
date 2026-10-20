import { PlanningOrchestrator, parseGoogleRecurrence, generateTwitchTags } from '../shared/planning-engine.js';
import { fields, pick, equal } from '../shared/autonomy.js';
import { mergeOccurrencePatch, migrateRecurrence } from '../shared/recurrence.js';
import { newId } from './autonomy-store.js';

// Only explicit management requests enter this engine. Live commands are never
// journalled or replayed, and polling never blindly retries remote creations.
export function createLocalPlanning({store,providers,onChange=()=>{},locks=globalThis.navigator?.locks}) {
 let tail=Promise.resolve(),bulk;
 const serial=work=>{const run=()=>locks?locks.request('sd-planning:'+store.record.workspace,work):work();const result=tail.then(run);tail=result.catch(()=>{});return result;};
 const snapshot=()=>store.view().data.host.planning;
 const planner=()=>new PlanningOrchestrator(snapshot(),providers.adapters,async items=>{await store.commitPlanning(items);onChange();});
 function validate(item){
  if(!item.title?.trim()||item.title.length>140||!Number.isFinite(Date.parse(item.startAtUtc))||Date.parse(item.endAtUtc)<=Date.parse(item.startAtUtc)||!['live','production','personal'].includes(item.category||'live'))throw new Error('Titre, type et période valides requis.');
  if(item.desiredPublication?.twitch&&(item.category!=='live'||item.allDay))throw new Error('Twitch exige un événement Live avec des horaires précis.');
  if(item.recurrence){migrateRecurrence(item.recurrence);new Intl.DateTimeFormat('fr',{timeZone:item.recurrence.timeZone});}
 }
 const editable=item=>{if(!item)throw new Error('Événement introuvable.');if(item.editable===false||item.transferredTo)throw new Error('Cet événement appartient à un autre espace. Dupliquez-le pour créer un nouvel événement local.');};
 async function recover(item,provider){
  const link=item.providers?.[provider];
  if(provider==='twitch'&&link?.projections){
   const items=snapshot(),target=items.find(x=>x.id===item.id).providers.twitch;let recovered=false;
   for(const entry of Object.values(target.projections))if(entry.uncertainCreate&&!entry.remoteId){
    const result=await providers.adapters.twitch.recoverCreation({...entry.uncertainCreate.event,providers:{twitch:entry}});
    if(!result.id)throw new Error('Publication Twitch incertaine : aucun reçu confirmé.');
    Object.assign(entry,{remoteId:result.id,fingerprint:result.fingerprint,uncertainCreate:undefined,status:'pending'});recovered=true;await store.commitPlanning(items);
   }
   if(recovered)return planner();
  }
  if(!link?.uncertainCreate||link.remoteId)return;
  const result=await providers.adapters[provider].recoverCreation({...link.uncertainCreate.event,providers:{[provider]:link}});
  if(!result.id)throw new Error('Création incertaine : aucune identité distante confirmée.');
  const items=snapshot(),target=items.find(x=>x.id===item.id).providers[provider];
  Object.assign(target,{remoteId:result.id,remoteRevision:result.revision,fingerprint:result.fingerprint,calendarId:result.calendarId||target.calendarId,uncertainCreate:undefined,status:'pending'});
  await store.commitPlanning(items);return planner();
 }
 async function route(path,body={},method='GET',base){
  if(path==='/api/v1/planning/tags/regenerate')return {tags:{values:generateTwitchTags({title:body.title,description:body.description,game:body.twitchCategoryName,language:body.tagPreferences?.language||'fr'}),source:'generated',generatedAt:new Date().toISOString()},warning:'Suggestions calculées sur cet appareil.'};
  const match=path.match(/^\/api\/v2\/planning(?:\/([^/]+)(\/occurrence)?)?$/),retry=path.match(/^\/api\/v1\/planning\/([^/]+)\/(retry|conflict)\/(twitch|google)$/);
  if(method==='GET'&&path.startsWith('/api/v1/twitch/categories'))return providers.call('twitch','categories',{query:new URL(path,'http://device').searchParams.get('q')||''});
  if(method==='GET'&&path==='/api/v1/google/calendars')return providers.call('google','calendars');
  if(!match&&!retry&&!['/api/v1/google/sync','/api/v1/planning/refresh','/api/v1/planning/bulk-delete/preview','/api/v1/planning/bulk-delete/confirm'].includes(path))return undefined;
  return serial(async()=>{
   await store.reload();let engine=planner();
   if(match){
    const id=match[1]?decodeURIComponent(match[1]):newId(),old=snapshot().find(x=>x.id===id);
    if(old)editable(old);
    if(base&&old&&!equal(base['planning/'+id],pick(old,fields.planning)))throw new Error('Cet événement a changé depuis l’ouverture. Rouvrez-le pour conserver les modifications.');
    if(method==='DELETE'&&!match[2]){editable(old);await engine.remove(id,{local:true,twitch:true,google:true,confirmRecurring:true});return {savedLocally:true};}
    let value={...old,...pick(body,fields.planning)};
    if(match[2]){editable(old);if(!old.recurrence||!body.occurrenceKey?.startsWith(id+':'))throw new Error('Occurrence invalide.');value=structuredClone(old);value.recurrence.exceptions||={};const previous=value.recurrence.exceptions[body.occurrenceKey];value.recurrence.exceptions[body.occurrenceKey]=method==='DELETE'?{...previous,cancelled:true}:mergeOccurrencePatch(previous,body.patch);}
    validate(value);
    if(old)await engine.update(id,value,{desiredPublication:value.desiredPublication,confirmRecurring:true});
    else await engine.create({...value,id,category:value.category||'live'});
    return {savedLocally:true,createdItemId:id};
   }
   if(retry){const [,id,task,provider]=retry;const item=snapshot().find(x=>x.id===decodeURIComponent(id));editable(item);
    if(task==='conflict')await engine.resolveConflict(item.id,provider,body.strategy,body.occurrenceKey);
    else{engine=await recover(item,provider)||engine;await engine.retry(item.id,provider,{confirmRecurring:true});}
    return {savedLocally:true};
   }
   if(path==='/api/v1/planning/refresh'){await engine.refreshTwitch(Date.now(),snapshot().filter(item=>!item.transferredTo&&item.editable!==false&&item.recurrence).map(item=>item.id));return {savedLocally:true};}
   if(path==='/api/v1/google/sync'){
    const calendar=store.view().extras.google.calendarId||'primary',result=await providers.call('google','events',{calendarId:calendar});
    const previous=snapshot(),remoteIds=new Set(result.items.map(x=>x.remoteId));
    const items=previous.filter(x=>!(x.ownership==='EXTERNAL'&&x.providers?.google?.calendarId===result.calendarId&&!remoteIds.has(x.providers.google.remoteId)));
    for(const incoming of result.items){
     const linked=items.find(x=>x.providers?.google?.remoteId===incoming.remoteId&&x.providers.google.calendarId===result.calendarId);
     if(linked&&linked.ownership!=='EXTERNAL'){
      if(linked.providers.google.remoteRevision&&linked.providers.google.remoteRevision!==incoming.revision){linked.providers.google.status='conflict';linked.providers.google.lastError='Événement modifié dans Google. Choisissez la version à conserver.';}
      continue;
     }
     // Unsupported provider recurrences remain read-only with the original rule.
     let recurrence;try{recurrence=parseGoogleRecurrence(incoming);}catch{}
     const imported={...incoming,id:linked?.id||'google:'+newId(),ownership:'EXTERNAL',editable:false,recurrence,desiredPublication:{local:true,google:false,twitch:false},providers:{google:{status:'synced',remoteId:incoming.remoteId,calendarId:result.calendarId,remoteRevision:incoming.revision}}};
     if(linked)Object.assign(linked,imported);else items.push(imported);
    }
    await store.commitPlanning(items);onChange();return {count:result.items.length};
   }
   if(path.endsWith('/preview')){
    if(!Number.isFinite(Date.parse(body.start))||Date.parse(body.end)<=Date.parse(body.start))throw new Error('Période invalide.');
    const all=snapshot().filter(x=>Date.parse(x.startAtUtc)>=Date.parse(body.start)&&Date.parse(x.endAtUtc)<=Date.parse(body.end));
    const excluded=all.filter(x=>x.recurrence||x.editable===false||x.transferredTo||(!body.destinations?.twitch&&x.providers?.twitch?.remoteId)||(!body.destinations?.google&&x.providers?.google?.remoteId)).map(x=>({...x,reason:'Série, événement externe ou publication à conserver.'}));
    const items=all.filter(x=>!excluded.some(y=>y.id===x.id));bulk={token:newId(),items,excluded,count:items.length,destinations:body.destinations};return bulk;
   }
   if(!bulk||body.token!==bulk.token||body.confirm!==true)throw new Error('Aperçu périmé.');
   const preview=bulk;bulk=null;const deleted=[],failed=[];
   for(const item of preview.items){try{if(!equal(item,snapshot().find(x=>x.id===item.id)))throw new Error('Événement modifié depuis l’aperçu.');await engine.remove(item.id,{local:true,...preview.destinations});deleted.push(item.id);}catch(e){failed.push({id:item.id,title:item.title,error:e.message});}}
   return {deleted,failed,savedLocally:true};
  });
 }
 return {route,wait:()=>tail};
}
