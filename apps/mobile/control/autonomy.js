import { validateProductProfile } from '../shared/device-utils.js';
import { openReplica, newId } from './autonomy-store.js';
import { fields, pick, resources, equal, clone } from '../shared/autonomy.js';
import { mergeOccurrencePatch } from '../shared/recurrence.js';

export async function createAutonomy(scope,network,onChange=()=>{}){
 const store=await openReplica(scope);let flight,lastError='',bulk;
 const changed=()=>onChange(store.view());
 const cached=path=>{const b=store.view();if(!b)return undefined;
  const map={'/api/v2/state':b.data,'/api/v1/soundboard':b.sounds,'/api/v1/profile':{profile:b.extras.profile},'/api/v1/automations':{items:b.extras.automations},'/api/v1/companion/snapshot':{templates:b.extras.templates},'/api/v1/discord/status':{...b.extras.discord,connected:false},'/api/v2/wizebot/catalog':b.extras.wizebot};return map[path];};
 let bases;
 async function stage(changes){await store.stage(changes,bases);changed();return {savedLocally:true};}
 function resource(kind,id){return (bases||resources(store.view()))[kind+'/'+id]??null;}
 async function mutate(path,body,method,base){
  bases=base;
  const b=store.view();if(!b)return undefined;
  if(path==='/api/v2/configuration'&&method==='PUT'){
   const changes={},c=body.configuration;
   // Compare against the form's original configuration, not newly arrived remote data.
   const original=bases?{actions:Object.entries(bases).filter(([k])=>k.startsWith('action/')).map(([,v])=>v),outputs:{twitch:bases['output/twitch'],youtube:bases['output/youtube']},youtube:bases['youtube/root'],replayAutoStart:bases['preferences/root'].replayAutoStart}:b.data.configuration;
   const baseActions=new Map(original.actions.map(a=>[a.id,a]));
   for(const a of c.actions)if(!equal(baseActions.get(a.id),a))changes['action/'+a.id]=a;
   for(const a of original.actions)if(!c.actions.some(x=>x.id===a.id))changes['action/'+a.id]=null;
   for(const p of ['twitch','youtube'])if(!equal(original.outputs[p],c.outputs[p]))changes['output/'+p]=c.outputs[p];
   if(!equal(original.youtube,c.youtube))changes['youtube/root']=c.youtube;
   if(original.replayAutoStart!==c.replayAutoStart)changes['preferences/root']={replayAutoStart:c.replayAutoStart!==false};
   return stage(changes);
  }
  if(path==='/api/v2/settings'&&method==='PUT'){
   if(body.obsPassword||body.clearObsPassword)throw new Error('Le mot de passe OBS nécessite une connexion directe à la régie. Enregistrez les autres réglages sans mot de passe.');
   return stage({'settings/root':{...resource('settings','root'),...pick(body,fields.settings)}});
  }
  const event=path.match(/^\/api\/v2\/planning(?:\/([^/]+)(\/occurrence)?)?$/);
  if(event&&['POST','PUT','DELETE'].includes(method)){
   const id=event[1]?decodeURIComponent(event[1]):newId(),old=resource('planning',id);
   const item=b.data.host.planning.find(item=>item.id===id);if(item?.editable===false)throw new Error('Événement en lecture seule.');
   let value;
   if(event[2]){
    if(!old?.recurrence||!body.occurrenceKey)throw new Error('Série ou occurrence introuvable.');
    value=clone(old);value.recurrence.exceptions||={};const previous=value.recurrence.exceptions[body.occurrenceKey];
    value.recurrence.exceptions[body.occurrenceKey]=method==='DELETE'?{...previous,cancelled:true}:mergeOccurrencePatch(previous,body.patch);
   }else value=method==='DELETE'?null:{...old,...pick(body,fields.planning)};
   if(value!==null){if(!value.title?.trim()||value.title.length>140||!Number.isFinite(Date.parse(value.startAtUtc))||!Number.isFinite(Date.parse(value.endAtUtc))||Date.parse(value.endAtUtc)<=Date.parse(value.startAtUtc))throw new Error('Titre et période valides requis.');}
   await stage({['planning/'+id]:value});return {savedLocally:true,createdItemId:id};
  }
  for(const [prefix,kind] of [['/api/v1/companion/templates','template'],['/api/v1/automations','automation'],['/api/v1/soundboard/sounds','sound']]){
   if((path===prefix||path.startsWith(prefix+'/'))&&['POST','PUT','DELETE'].includes(method)){
    if(kind==='sound'&&method==='POST')return undefined;
    const id=path===prefix?newId():decodeURIComponent(path.slice(prefix.length+1));
    return stage({[kind+'/'+id]:method==='DELETE'?null:{...resource(kind,id),...pick(body,fields[kind])}});
   }
  }
  if(path==='/api/v1/profile'&&method==='PUT')return stage({'profile/root':validateProductProfile(body)});
  if(path==='/api/v1/discord/settings'&&method==='PUT')return stage({'discord/root':body});
  if(path==='/api/v1/google/target'&&method==='PUT')return stage({'google/root':body});
  if(path==='/api/v1/planning/bulk-delete/preview'){
   const {start,end,destinations}=body;if(!Number.isFinite(Date.parse(start))||!Number.isFinite(Date.parse(end))||Date.parse(end)<=Date.parse(start))throw new Error('Période invalide.');
   const all=b.data.host.planning.filter(x=>Date.parse(x.startAtUtc)>=Date.parse(start)&&Date.parse(x.endAtUtc)<=Date.parse(end));
   const excluded=all.filter(x=>x.recurrence||x.editable===false||(!destinations.twitch&&(x.providers?.twitch?.remoteId||x.twitchSegmentId))||(!destinations.google&&x.providers?.google?.remoteId)).map(x=>({...x,reason:'Série, lecture seule ou publication à conserver. Utilisez la suppression individuelle.'}));
   const items=all.filter(x=>!excluded.some(v=>v.id===x.id));bulk={token:newId(),items,excluded,count:items.length,destinations};return bulk;
  }
  if(path==='/api/v1/planning/bulk-delete/confirm'){
   if(!bulk||body.token!==bulk.token||body.confirm!==true)throw new Error('Aperçu périmé.');
   for(const item of bulk.items)if(!equal(pick(item,fields.planning),resource('planning',item.id)))throw new Error('La période a changé. Recommencez l’aperçu.');
   await stage(Object.fromEntries(bulk.items.map(x=>['planning/'+x.id,null])));const deleted=bulk.items.map(x=>x.id);bulk=null;return {deleted,failed:[],savedLocally:true};
  }
  return undefined;
 }
 return {
  store,cached,mutate,get lastError(){return lastError;},
  async sync(){if(flight)return flight;
   flight=(async()=>{
    try{await store.reload();await store.accept(await network('/api/v2/autonomy'));
     // Keep per-resource order; a conflict must not hold back unrelated entities.
     for(let count=0;count<100;count++){
      if(count)await store.reload();const record=store.record,blocked=new Set(record.pending.filter(x=>x.issue).map(x=>x.key));
      const op=record.pending.find(x=>!x.issue&&!blocked.has(x.key));if(!op)break;
      const response=await network('/api/v2/autonomy/sync',{workspace:store.record.workspace,edit:pick(op,['id','key','base','value'])});await store.accept(response,op.id);
     }
     lastError='';changed();return true;
    }catch(e){lastError=e.message;changed();throw e;}
   })().finally(()=>{flight=undefined;});return flight;
  },
  async resolve(key,keep){await store.resolve(key,keep);changed();},
 };
}
