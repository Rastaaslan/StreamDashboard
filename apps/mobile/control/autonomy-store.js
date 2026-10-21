import { randomUuid as newId } from '../shared/planning-engine.js';
import { clone, equal, merge, overlay, resources, fields, pick } from '../shared/autonomy.js';
import { openReplicaDatabase, locateReplica } from './replica-identity.js';
export { randomUuid as newId } from '../shared/planning-engine.js';
const containsSecret=value=>Boolean(value&&typeof value==='object'&&Object.entries(value).some(([key,v])=>/(?:token|secret|password|credential|authorization)/i.test(key)||containsSecret(v)));
const empty = () => ({version:1,workspace:null,bundle:null,pending:[],lastSync:null,drafts:{}});
/** Each transaction reads the newest record: multiple windows cannot overwrite each other's outbox. */
export async function openReplica(scope, factory=globalThis.indexedDB){
 const db=await openReplicaDatabase(factory);let actualScope=scope;
 const transact=update=>new Promise((resolve,reject)=>{
  const tx=db.transaction('replicas',update?'readwrite':'readonly'),table=tx.objectStore('replicas');let value;
  locateReplica(table,scope,location=>{
   actualScope=location.scope;const request=table.get(actualScope);
   request.onsuccess=()=>{try{value=request.result||empty();if(location.workspace&&value.workspace!==location.workspace)throw new Error('Identité de copie locale incohérente. Les données sont conservées.');if(update){value=update(value)||value;table.put(value,actualScope);}}catch(e){tx.abort();reject(e);}};
  },error=>{tx.abort();reject(error);});
  tx.oncomplete=()=>resolve(clone(value));tx.onerror=()=>reject(tx.error||new Error('Sauvegarde locale impossible.'));tx.onabort=()=>reject(tx.error||new Error('Sauvegarde locale annulée.'));
 });
 let current;try{current=await transact();}catch(error){db.close();throw error;}
 const change=async update=>{current=await transact(update);return current;};
 return {
  get scope(){return actualScope;},
  get record(){return clone(current);},
  async seed(response){await change(record=>{if(!record.bundle){record.workspace=response.workspace;record.bundle=clone(response.bundle);}});},
  async reload(){current=await transact();return current;},
  view(){if(!current.bundle)return null;let bundle=clone(current.bundle);for(const op of current.pending){const remote=resources(bundle)[op.key]??null;bundle=overlay(bundle,{[op.key]:merge(op.base,op.value,remote).value});}if(current.localPlanning)bundle.data.host.planning=clone(current.localPlanning);return bundle;},
  // The native planner persists its journal before provider I/O, including
  // uncertain creates and pending deletions. Never reduce it to editable fields.
  async commitPlanning(items){await change(record=>{
   if(!record.workspace?.startsWith('local:'))throw new Error('Espace autonome requis.');
   const previous=record.localPlanning||this.view().data.host.planning;
   for(const item of items){const old=previous.find(x=>x.id===item.id);if(old?.transferredTo&&!equal(old,item))throw new Error('Événement transféré : gérez-le dans l’espace de destination.');}
   for(const id of new Set([...previous,...items].map(x=>x.id))){
    const old=previous.find(x=>x.id===id),next=items.find(x=>x.id===id),base=old?pick(old,fields.planning):null,value=next?pick(next,fields.planning):null;
    if(!equal(base,value))record.pending.push({id:newId(),key:'planning/'+id,base,value,createdAt:new Date().toISOString()});
   }
   record.localPlanning=clone(items);
   for(const item of record.localPlanning){const link=item.providers?.twitch;if(link?.projections){const ids=[...new Set(Object.values(link.projections).map(x=>x.accountId).filter(Boolean))];if(ids.length===1)link.accountId=ids[0];}}
  });},
  async stage(changes,bases){await change(record=>{
   if(Object.values(changes).some(value=>containsSecret(value)))throw new Error('Les secrets nécessitent une connexion sécurisée à la régie ; ils ne sont pas conservés dans la copie locale.');
   if(!record.bundle)throw new Error('Une première connexion est nécessaire pour récupérer les données de cette régie.');
   let bundle=clone(record.bundle);for(const op of record.pending)bundle=overlay(bundle,{[op.key]:merge(op.base,op.value,resources(bundle)[op.key]??null).value});
   for(const [key,value] of Object.entries(changes)){const base=(bases||resources(bundle))[key]??null;if(equal(base,value))continue;record.pending.push({id:newId(),key,base,value:clone(value),createdAt:new Date().toISOString()});bundle=overlay(bundle,{[key]:value});}
  });},
  async accept(response,opId){await change(record=>{
   if(record.workspace&&record.workspace!==response.workspace)throw new Error('Identité de régie différente. Les données locales sont conservées ; reconnectez la régie d’origine.');
   record.workspace=response.workspace;if(!record.bundle?.savedAt||!response.bundle.savedAt||response.bundle.savedAt>=record.bundle.savedAt)record.bundle=clone(response.bundle);record.lastSync=new Date().toISOString();
   if(opId){const op=record.pending.find(x=>x.id===opId);if(op&&response.receipt.status==='applied')record.pending=record.pending.filter(x=>x.id!==opId);else if(op)op.issue=clone(response.receipt);}
  });},
  async resolve(key,keep){await change(record=>{
   const ops=record.pending.filter(op=>op.key===key);if(!ops.length)return;
   const value=ops.at(-1).value;record.pending=record.pending.filter(op=>op.key!==key);
   const base=resources(record.bundle)[key]??null;
   if(keep&&!equal(base,value))record.pending.push({id:newId(),key,base,value,createdAt:new Date().toISOString()});
  });},
  async draft(key,value){await change(record=>{record.drafts[key]=clone(value);});},
  async updateDraft(key,update){await change(record=>{record.drafts[key]=clone(update(clone(record.drafts[key])));});},
  async addSound(file,name){
   if(!current.workspace?.startsWith('local:'))throw new Error('Espace autonome requis.');
   if(!name?.trim()||!file?.size||file.size>100*1024*1024||!/^.*\.(wav|mp3|ogg|aac|m4a|flac)$/i.test(file.name))throw new Error('Nom et fichier audio requis (100 Mo maximum).');
   const id=newId(),value={name:name.trim(),favorite:false,volume:1,enabled:true,cooldownMs:0,category:'Général',monitoringMode:'stream'};
   await new Promise((resolve,reject)=>{const tx=db.transaction(['replicas','assets'],'readwrite'),table=tx.objectStore('replicas'),r=table.get(scope);
    r.onsuccess=()=>{const record=r.result;record.pending.push({id:newId(),key:'sound/'+id,base:null,value,createdAt:new Date().toISOString()});record.localAssets||={};record.localAssets[id]={name:file.name,type:file.type,size:file.size};tx.objectStore('assets').put(file,scope+'/'+id);table.put(record,scope);};
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Import audio annulé.'));
   });current=await transact();return id;
  },
  async soundAsset(id){return new Promise((resolve,reject)=>{const r=db.transaction('assets').objectStore('assets').get(scope+'/'+id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});},
  // Move the outbox atomically; the original local workspace remains readable.
  // Stable operation IDs make repeated imports and lost responses harmless.
  async importLocal(sourceScope){
   if(sourceScope===scope)throw new Error('Choisissez une régie de destination.');
   const source=await openReplica(sourceScope,factory);const workspace=source.record.workspace;source.close();
   const transfer=()=>new Promise((resolve,reject)=>{
    const tx=db.transaction('replicas','readwrite'),table=tx.objectStore('replicas');
    const sourceRequest=table.get(sourceScope);let targetRequest,targetScope,ready=0;
    const apply=()=>{if(++ready!==2)return;try{
     const source=sourceRequest.result,target=targetRequest.result;
     if(!source?.workspace?.startsWith('local:')||!target?.bundle||target.workspace.startsWith('local:'))throw new Error('Connectez d’abord la régie de destination.');
     let bundle=clone(source.bundle);
     const owned=source.localPlanning;
     const transferIds=new Set();
     for(const op of source.pending){
      bundle=overlay(bundle,{[op.key]:merge(op.base,op.value,resources(bundle)[op.key]??null).value});
      if(owned&&op.key.startsWith('planning/')){transferIds.add(op.key.slice(9));continue;}
      if(!target.pending.some(x=>x.id===op.id))target.pending.push(clone(op));
     }
     if(owned)for(const id of transferIds){const item=owned.find(x=>x.id===id);if(!item||item.transferredTo)continue;
      if(Object.values(item.providers||{}).some(link=>link.uncertainCreate||Object.values(link.projections||{}).some(entry=>entry.uncertainCreate)))throw new Error('Réconciliez les publications incertaines avant de transférer : '+item.title);
      target.pending.push({id:newId(),key:'planningTransfer/'+id,base:null,value:clone(item),createdAt:new Date().toISOString()});
      item.transferredTo=target.workspace;item.editable=false;
     }
     source.bundle=bundle;source.pending=[];table.put(source,sourceScope);table.put(target,targetScope);
    }catch(e){tx.abort();reject(e);}};
    sourceRequest.onsuccess=apply;
    locateReplica(table,scope,location=>{targetScope=location.scope;targetRequest=table.get(targetScope);targetRequest.onsuccess=()=>{if(location.workspace&&targetRequest.result?.workspace!==location.workspace){tx.abort();reject(new Error('Identité de la destination modifiée. Le transfert est annulé.'));return;}apply();};},error=>{tx.abort();reject(error);});
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Import annulé.'));
   });if(globalThis.navigator?.locks)await navigator.locks.request('sd-planning:'+workspace,transfer);else await transfer();current=await transact();
  },
  close(){db.close();},
 };
}
