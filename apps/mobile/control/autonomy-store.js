import { createBinaryHash, randomUuid as newId } from '../shared/planning-engine.js';
import { clone, equal, merge, overlay, resources, fields, pick } from '../shared/autonomy.js';
import { openReplicaDatabase, locateReplica } from './replica-identity.js';
import {transitionPlanningHandoff} from '../shared/planning-handoff.js';
export { randomUuid as newId } from '../shared/planning-engine.js';
const containsSecret=value=>Boolean(value&&typeof value==='object'&&Object.entries(value).some(([key,v])=>/(?:token|secret|password|credential|authorization)/i.test(key)||containsSecret(v)));
const empty = () => ({version:1,workspace:null,bundle:null,pending:[],lastSync:null,drafts:{}});
const recordView=record=>{if(!record.bundle)return null;let bundle=clone(record.bundle);for(const op of record.pending)bundle=overlay(bundle,{[op.key]:merge(op.base,op.value,resources(bundle)[op.key]??null).value});if(record.localPlanning)bundle.data.host.planning=clone(record.localPlanning);return bundle;};
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
  view(){return recordView(current);},
  async handoff(own,operation,ticket,proof,guard=()=>{}){
   let receipt;
   await change(record=>{
    guard();if(!record.workspace?.startsWith('local:'))throw new Error('Espace autonome requis.');
    const result=transitionPlanningHandoff({items:recordView(record).data.host.planning,journal:record.drafts.planningHandoffs||{}},own,operation,ticket,proof);
    record.localPlanning=result.state.items;record.drafts.planningHandoffs=result.state.journal;receipt=result.receipt;
   });return clone(receipt);
  },
  // Adopting a journal is data-only. The event and its receipt commit together;
  // a controller crash or a lost response cannot create a second publisher.
  async adoptPlanning(edit,signature,guard=()=>{}){
   let receipt;
   await change(record=>{
    guard();if(!record.workspace?.startsWith('local:'))throw new Error('Espace autonome requis.');
    const receipts=record.drafts.executorEdits||{},previous=receipts[edit.id];
    if(previous){if(previous.signature!==signature)throw new Error('Identifiant de modification réutilisé.');receipt=previous;return;}
    if(Object.keys(receipts).length>=4096)throw new Error('Journal Android plein. Exportez les données avant de poursuivre.');
    const items=recordView(record).data.host.planning,existing=items.find(item=>item.id===edit.value.id);
    if(existing)receipt={signature,status:'conflict',current:clone(existing),fields:['identity'],message:'Un événement de même identité existe déjà. Comparez les versions.'};
    else{
     const item=clone(edit.value);items.push(item);record.localPlanning=items;
     record.pending.push({id:newId(),key:'planning/'+item.id,base:null,value:pick(item,fields.planning),createdAt:new Date().toISOString()});
     receipt={signature,status:'applied',current:item};
    }
    record.drafts.executorEdits={...receipts,[edit.id]:clone(receipt)};
   });return clone(receipt);
  },
  // The native planner persists its journal before provider I/O, including
  // uncertain creates and pending deletions. Never reduce it to editable fields.
  async commitPlanning(items){await change(record=>{
   if(!record.workspace?.startsWith('local:'))throw new Error('Espace autonome requis.');
   const previous=record.localPlanning||this.view().data.host.planning;
   for(const old of previous)if((old.transferredTo||old.transferId)&&!equal(old,items.find(item=>item.id===old.id)))throw new Error('Événement transféré : gérez-le dans l’espace de destination.');
   for(const id of new Set([...previous,...items].map(x=>x.id))){
    const old=previous.find(x=>x.id===id),next=items.find(x=>x.id===id),base=old?pick(old,fields.planning):null,value=next?pick(next,fields.planning):null;
    if(!equal(base,value))record.pending.push({id:newId(),key:'planning/'+id,base,value,createdAt:new Date().toISOString()});
   }
   record.localPlanning=clone(items);
   for(const item of record.localPlanning){const link=item.providers?.twitch;if(link?.projections){const ids=[...new Set(Object.values(link.projections).map(x=>x.accountId).filter(Boolean))];if(ids.length===1)link.accountId=ids[0];}}
  });},
  // Strict configuration edits and receipts commit together. A retry after a
  // crash never needs to infer whether a native side effect was executed.
  async configurationEdit(edit,signature,guard=()=>{},statusOnly=false){
   let receipt;
   await change(record=>{
    guard();if(!record.workspace?.startsWith('local:'))throw new Error('Espace autonome requis.');
    const saved=record.drafts.executorEdits||{},previous=saved[edit.id];
    if(previous){if(previous.signature!==signature)throw new Error('Identifiant de modification réutilisé.');receipt=previous;return;}
    if(statusOnly){receipt={status:'absent'};return;}
    if(Object.keys(saved).length>=4096)throw new Error('Journal de configuration plein.');
    if(containsSecret(edit))throw new Error('Les secrets restent propres à chaque appareil.');
    const current=resources(recordView(record))[edit.key]??null;
    if(!equal(edit.base,current))receipt={signature,status:'conflict',current,fields:['élément'],message:'Modification concurrente. Relisez la destination.'};
    else{
     if(!equal(current,edit.value))record.pending.push({id:newId(),key:edit.key,base:clone(current),value:clone(edit.value),createdAt:new Date().toISOString()});
     receipt={signature,status:'applied',current:clone(edit.value)};
    }
    record.drafts.executorEdits={...saved,[edit.id]:clone(receipt)};
   });return clone(receipt);
  },
  async stage(changes,bases,requireUnchanged=false){await change(record=>{
   if(Object.values(changes).some(value=>containsSecret(value)))throw new Error('Les secrets nécessitent une connexion sécurisée à la régie ; ils ne sont pas conservés dans la copie locale.');
   if(!record.bundle)throw new Error('Une première connexion est nécessaire pour récupérer les données de cette régie.');
   let bundle=clone(record.bundle);for(const op of record.pending)bundle=overlay(bundle,{[op.key]:merge(op.base,op.value,resources(bundle)[op.key]??null).value});
   if(requireUnchanged)for(const key of Object.keys(changes))if(!equal(resources(bundle)[key]??null,bases?.[key]??null))throw new Error('Modification concurrente sur cet appareil.');
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
   const hash=createBinaryHash();for(let offset=0;offset<file.size;offset+=65536)hash.update(new Uint8Array(await file.slice(offset,offset+65536).arrayBuffer()));const sha256=hash.digest();
   const id=newId(),value={name:name.trim(),favorite:false,volume:1,enabled:true,cooldownMs:0,category:'Général',monitoringMode:'stream'};
   await new Promise((resolve,reject)=>{const tx=db.transaction(['replicas','assets'],'readwrite'),table=tx.objectStore('replicas'),r=table.get(scope);
    r.onsuccess=()=>{const record=r.result;record.pending.push({id:newId(),key:'sound/'+id,base:null,value,createdAt:new Date().toISOString()});record.localAssets||={};record.localAssets[id]={name:file.name,type:file.type,size:file.size,sha256};tx.objectStore('assets').put(file,scope+'/'+id);table.put(record,scope);};
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Import audio annulé.'));
   });current=await transact();return id;
  },
  // Old imports predate stored fingerprints. Their Blobs are immutable through
  // the public catalogue APIs (deleting an entry keeps the original Blob).
  // Index the retained bytes without replacing the file or restoring its entry.
  async indexSoundAsset(id,guard=()=>{}){
   await this.reload();guard();const metadata=current.localAssets?.[id],workspace=current.workspace;
   if(!metadata||metadata.sha256)return;
   if(!workspace?.startsWith('local:')||!recordView(current).sounds.sounds.some(sound=>sound.id===id))throw new Error('Restaurez le catalogue audio avant de vérifier son fichier.');
   const blob=await this.soundAsset(id);if(!blob?.size||blob.size!==metadata.size||blob.size>100*1024*1024)throw new Error('Fichier audio ancien absent ou incomplet.');
   const hash=createBinaryHash();for(let offset=0;offset<blob.size;offset+=65536){guard();hash.update(new Uint8Array(await blob.slice(offset,offset+65536).arrayBuffer()));}const sha256=hash.digest();
   await change(record=>{
    guard();if(record.workspace!==workspace||!equal(record.localAssets?.[id],metadata)||!recordView(record).sounds.sounds.some(sound=>sound.id===id))throw new Error('Le catalogue a changé pendant la vérification audio.');
    record.localAssets[id]={...metadata,sha256};
   });
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
