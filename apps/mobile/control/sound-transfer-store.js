import {openReplicaDatabase} from './replica-identity.js';
import {overlay,resources,merge} from '../shared/autonomy.js';
import {createBinaryHash,randomUuid} from '../shared/planning-engine.js';
import {soundIdentity,portableSound,sameSound} from '../shared/sound-library.js';

export const SOUND_TRANSFER={version:1,chunkBytes:65536,maxBytes:100*1024*1024};
const prefix='sound-transfer:',chunkKey=(id,index)=>'sound-transfer-chunk:'+id+':'+String(index).padStart(5,'0');
const fault=message=>{throw new Error(message);};
const request=value=>new Promise((resolve,reject)=>{value.onsuccess=()=>resolve(value.result);value.onerror=()=>reject(value.error);});
export async function hashSound(blob){const hash=createBinaryHash();for(let offset=0;offset<blob.size;offset+=SOUND_TRANSFER.chunkBytes)hash.update(new Uint8Array(await blob.slice(offset,offset+SOUND_TRANSFER.chunkBytes).arrayBuffer()));return hash.digest();}
function validate(spec){
 if(!spec||!/^[-\w]{8,100}$/.test(spec.id)||!soundIdentity(spec.soundId)||typeof spec.name!=='string'||!spec.name.trim()||spec.name.length>140||typeof spec.filename!=='string'||spec.filename.length>200||/[/\\\x00-\x1f]/.test(spec.filename)||!/\.(wav|mp3|ogg|aac|m4a|flac)$/i.test(spec.filename)||!Number.isSafeInteger(spec.size)||spec.size<1||spec.size>SOUND_TRANSFER.maxBytes||!/^[a-f0-9]{64}$/.test(spec.sha256))fault('Nom, fichier ou empreinte audio invalide (100 Mo maximum).');
 return {id:spec.id,soundId:spec.soundId,name:spec.name.trim(),filename:spec.filename,size:spec.size,sha256:spec.sha256,...(spec.settings?{settings:portableSound(spec.settings)}:{})};
}

/** Staging chunks and final files share one IndexedDB database. Publishing the
 * catalog entry, Blob and receipt is a single transaction; no half-sound exists. */
export async function openSoundTransferStore(scope,{factory=globalThis.indexedDB,now=Date.now}={}){
 const db=await openReplicaDatabase(factory);
 const run=(names,mode,work)=>new Promise((resolve,reject)=>{
  const tx=db.transaction(names,mode);let answer,error;
  Promise.resolve(work(tx)).then(value=>{answer=value;},failure=>{error=failure;try{tx.abort();}catch{}reject(failure);});
  tx.oncomplete=()=>resolve(answer);tx.onerror=()=>reject(error||tx.error);tx.onabort=()=>reject(error||tx.error||new Error('Transfert audio annulé.'));
 });
 const own=(record,owner)=>{if(!record||record.owner!==owner)fault('Transfert inconnu pour cet appareil.');if(record.expires<now())fault('Transfert expiré. Recommencez avec le même fichier.');return record;};
 const view=record=>{let bundle=structuredClone(record.bundle);for(const op of record.pending)bundle=overlay(bundle,{[op.key]:merge(op.base,op.value,resources(bundle)[op.key]??null).value});return bundle;};
 const result=record=>({id:record.spec.id,offset:record.offset,status:record.status,soundId:record.spec.soundId});
 return {
  async begin(spec,owner,guard=()=>{}){
   const expectedWorkspace=spec?.expectedWorkspace;
   spec=validate(spec);
   return run(['assets','replicas'],'readwrite',async tx=>{
    guard();const assets=tx.objectStore('assets'),replicas=tx.objectStore('replicas'),source=await request(replicas.get(scope));
    if(!source?.workspace?.startsWith('local:'))fault('Espace autonome indisponible.');
    if(typeof expectedWorkspace==='string'&&expectedWorkspace.startsWith('local:')&&expectedWorkspace!==source.workspace)fault('Identité de l’espace autonome différente.');
    const records=await request(assets.getAll(IDBKeyRange.bound(prefix,prefix+'\uffff')));
    guard();for(const record of records)if(record.expires<now()){
     assets.delete(prefix+record.spec.id);for(let n=0;n<Math.ceil(record.offset/SOUND_TRANSFER.chunkBytes);n++)assets.delete(chunkKey(record.spec.id,n));
    }
    const sound=view(source).sounds.sounds.find(sound=>sound.id===spec.soundId);
    if(spec.settings&&sound&&!sameSound(sound,spec.settings))fault('Les réglages de ce son existent déjà et diffèrent. Aucune donnée remplacée.');
    const asset=source.localAssets?.[spec.soundId];
    if(asset&&!sound)fault('Le fichier existe sans entrée active. Restaurez son catalogue avant de le copier.');
    if(asset&&(asset.sha256!==spec.sha256||asset.size!==spec.size))fault('Un autre fichier porte déjà cette identité. Aucune donnée remplacée.');
    const existing=records.find(record=>record.spec.id===spec.id&&record.expires>=now());
    if(existing){own(existing,owner);if(JSON.stringify(existing.spec)!==JSON.stringify(spec)||existing.workspace!==source.workspace)fault('Identifiant de transfert réutilisé pour un autre fichier.');
     if(existing.status==='complete'&&(!asset||!sound||!(await request(assets.get(scope+'/'+spec.soundId)))?.size))fault('Le son a été retiré après sa copie. Aucune restauration automatique.');
     return result(existing);
    }
    if(records.filter(record=>record.expires>=now()&&record.status==='receiving').length>=4)fault('Quatre fichiers sont déjà en transfert. Terminez-les ou annulez-les.');
    const record={spec,owner,workspace:source.workspace,status:asset?'complete':'receiving',offset:asset?spec.size:0,expires:now()+3600000};
    assets.put(record,prefix+spec.id);return result(record);
   });
  },
  async append(id,offset,encoded,owner,guard=()=>{}){
   if(!/^[-\w]{8,100}$/.test(id)||!Number.isSafeInteger(offset)||offset<0||offset%SOUND_TRANSFER.chunkBytes||typeof encoded!=='string'||encoded.length>87384||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))fault('Bloc audio invalide.');
   const bytes=Uint8Array.from(atob(encoded),character=>character.charCodeAt(0));if(!bytes.length||bytes.length>SOUND_TRANSFER.chunkBytes)fault('Taille de bloc invalide.');
   const signature=createBinaryHash().update(bytes).digest();
   return run(['assets'],'readwrite',async tx=>{
    guard();const assets=tx.objectStore('assets'),record=own(await request(assets.get(prefix+id)),owner);
    if(record.status==='complete')return result(record);
    if(bytes.length!==Math.min(SOUND_TRANSFER.chunkBytes,record.spec.size-offset)||offset>record.offset)fault('Ordre ou taille des blocs invalide.');
    const key=chunkKey(id,offset/SOUND_TRANSFER.chunkBytes);
    if(offset<record.offset){const old=await request(assets.get(key));if(old?.sha256!==signature)fault('Un bloc différent porte déjà cet index.');return result(record);}
    guard();assets.put({blob:new Blob([bytes]),sha256:signature},key);record.offset+=bytes.length;record.expires=now()+3600000;assets.put(record,prefix+id);return result(record);
   });
  },
  async finish(id,owner,guard=()=>{}){
   if(!/^[-\w]{8,100}$/.test(id))fault('Identifiant de transfert invalide.');
   const staged=await run(['assets'],'readonly',async tx=>{
    const assets=tx.objectStore('assets'),record=own(await request(assets.get(prefix+id)),owner);
    if(record.status==='complete')return {record};
    if(record.offset!==record.spec.size)fault('Le fichier est incomplet.');
    const parts=[];for(let index=0;index<Math.ceil(record.offset/SOUND_TRANSFER.chunkBytes);index++){const part=await request(assets.get(chunkKey(id,index)));if(!part?.blob)fault('Bloc audio manquant.');parts.push(part.blob);}
    return {record,blob:new Blob(parts)};
   });
   if(staged.record.status==='complete'){guard();return result(staged.record);}
   if(staged.blob.size!==staged.record.spec.size||await hashSound(staged.blob)!==staged.record.spec.sha256)fault('Le fichier reçu ne correspond pas à son empreinte. Aucune entrée publiée.');
   return run(['assets','replicas'],'readwrite',async tx=>{
    guard();const assets=tx.objectStore('assets'),table=tx.objectStore('replicas'),record=own(await request(assets.get(prefix+id)),owner),source=await request(table.get(scope));
    if(record.status==='complete')return result(record);
    if(source?.workspace!==record.workspace||record.workspace!==staged.record.workspace||JSON.stringify(record.spec)!==JSON.stringify(staged.record.spec))fault('Espace ou transfert modifié. Aucune donnée remplacée.');
    guard();const soundId=record.spec.soundId,current=view(source).sounds.sounds.find(sound=>sound.id===soundId),asset=source.localAssets?.[soundId];
    if(current||asset){if(asset?.sha256!==record.spec.sha256||record.spec.settings&&(!current||!sameSound(current,record.spec.settings)))fault('Cette identité audio existe déjà. Aucune donnée remplacée.');}
    else{
     const value={name:record.spec.name,favorite:false,volume:1,enabled:true,cooldownMs:0,category:'Général',monitoringMode:'stream',...record.spec.settings,outputId:'device-default'};
     source.pending.push({id:randomUuid(),key:'sound/'+soundId,base:null,value,createdAt:new Date(now()).toISOString()});
     source.localAssets||={};source.localAssets[soundId]={name:record.spec.filename,size:record.spec.size,type:'application/octet-stream',sha256:record.spec.sha256};
     assets.put(staged.blob,scope+'/'+soundId);table.put(source,scope);
    }
    record.status='complete';assets.put(record,prefix+id);
    for(let index=0;index<Math.ceil(record.offset/SOUND_TRANSFER.chunkBytes);index++)assets.delete(chunkKey(id,index));
    return result(record);
   });
  },
  async cancel(id,owner,guard=()=>{}){if(!/^[-\w]{8,100}$/.test(id))fault('Identifiant de transfert invalide.');return run(['assets'],'readwrite',async tx=>{guard();const assets=tx.objectStore('assets'),record=own(await request(assets.get(prefix+id)),owner);if(record.status==='complete')return result(record);guard();for(let n=0;n<Math.ceil(record.offset/SOUND_TRANSFER.chunkBytes);n++)assets.delete(chunkKey(id,n));assets.delete(prefix+id);return {id,status:'cancelled'};});},
  close(){db.close();},
 };
}
