import {openReplicaDatabase,locateReplica} from './replica-identity.js';
import {randomUuid} from '../shared/uuid.js';
import {overlay,merge,resources} from '../shared/autonomy.js';

function catalog(record) {
  let bundle=record.bundle;
  for(const edit of record.pending||[])bundle=overlay(bundle,{[edit.key]:merge(edit.base,edit.value,resources(bundle)[edit.key]??null).value});
  return bundle.sounds.sounds;
}
/** A preview is advisory: every candidate is checked again in the deletion
 * transaction. Files referenced by a live transfer are never reclaimed. */
export async function audioStorage(scope, selections, factory=globalThis.indexedDB, operation='purge') {
  const db=await openReplicaDatabase(factory);
  try { return await new Promise((resolve,reject)=>{
    const tx=db.transaction(['replicas','assets'],selections?'readwrite':'readonly');
    const replicas=tx.objectStore('replicas'),assets=tx.objectStore('assets');let result;
    const fail=error=>{try{tx.abort();}catch{}reject(error);};
    locateReplica(replicas,scope,location=>{
      const request=replicas.get(location.scope);
      request.onsuccess=()=>{
        const record=request.result;
        if(!record?.workspace?.startsWith('local:')){fail(new Error('Nettoyage disponible dans votre espace local.'));return;}
        const used=new Set(catalog(record).map(sound=>sound.id)),transfers=new Set();
        const protect=job=>{if(job&&!['completed','abandoned','rolled-back'].includes(job.status))for(const item of job.items||[])transfers.add(item.id);};
        Object.values(record.drafts?.soundLibraryJobs||{}).forEach(protect);
        Object.values(record.drafts?.setupMigrations||{}).forEach(job=>protect(job.audio));
        const cursor=assets.openCursor(IDBKeyRange.bound('sound-transfer:','sound-transfer:\uffff'));
        cursor.onsuccess=()=>{
          const item=cursor.result;
          if(item){const transfer=item.value;if(transfer.workspace===record.workspace&&transfer.expires>Date.now())transfers.add(transfer.spec?.soundId);item.continue();return;}
          const retained=Object.entries(record.localAssets||{}).filter(([id])=>!used.has(id)).map(([id,value])=>({id,...value,protected:transfers.has(id)}));
          if(!selections){result={workspace:record.workspace,totalBytes:Object.values(record.localAssets||{}).reduce((n,v)=>n+v.size,0),retained};return;}
          let bytes=0,count=0;
          for(const selected of selections){
            const current=retained.find(value=>value.id===selected.id);
            if(!current||current.protected||JSON.stringify([current.sha256,current.size,current.name])!==JSON.stringify([selected.sha256,selected.size,selected.name])){fail(new Error('Le catalogue ou un transfert a changé. Actualisez le stockage.'));return;}
          }
          if(operation==='restore'){
            let remaining=selections.length;
            for(const selected of selections){
              const read=assets.get(location.scope+'/'+selected.id);
              read.onsuccess=()=>{
                if(!read.result?.size||read.result.size!==selected.size){fail(new Error('Fichier audio absent ou incomplet.'));return;}
                const key='sound/'+selected.id;
                const previous=[...(record.pending||[])].reverse().find(edit=>edit.key===key&&edit.value)?.value||resources(record.bundle)[key];
                const value=previous||{name:selected.name.replace(/\.[^.]+$/,''),favorite:false,volume:1,enabled:true,cooldownMs:0,category:'Général',monitoringMode:'stream'};
                record.pending.push({id:randomUuid(),key,base:null,value,createdAt:new Date().toISOString()});
                if(--remaining===0){replicas.put(record,location.scope);result={count:selections.length,bytes:0};}
              };
            }
            if(!remaining)result={count:0,bytes:0};
          }else{
            for(const selected of selections){assets.delete(location.scope+'/'+selected.id);bytes+=selected.size;count++;delete record.localAssets[selected.id];}
            replicas.put(record,location.scope);result={count,bytes};
          }
        };
      };
    },fail);
    tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Nettoyage annulé.'));
  }); } finally { db.close(); }
}

export function createStorageUI({getStore,isLocal,modal,esc,toast}) {
  let preview;
  const size=bytes=>(bytes/1048576).toFixed(1)+' Mio';
  async function open(){
    if(!isLocal())throw new Error('Ouvrez votre espace local pour gérer les fichiers de cet appareil.');
    const store=getStore();await store.reload();preview={store,value:await audioStorage(store.scope)};
    const files=preview.value.retained;
    modal(`<h2>Stockage de cet appareil</h2><p>${size(preview.value.totalBytes)} de fichiers audio. Retirer un son du catalogue conserve son fichier jusqu’à une suppression définitive.</p>${files.length?`<form id="audio-storage-form">${files.map(file=>`<label class="check"><input type="checkbox" name="asset" value="${esc(file.id)}" ${file.protected?'disabled':''}>${esc(file.name)} · ${size(file.size)}${file.protected?' · transfert en cours':''}</label>`).join('')}<button type="button" class="secondary" data-task="storage-restore">Restaurer dans le catalogue</button><p>Les fichiers sélectionnés seront supprimés définitivement. Les comptes et preuves d’opération sont conservés.</p><button type="button" class="danger" data-task="storage-purge">Supprimer les fichiers sélectionnés</button></form>`:'<p>Aucun fichier audio retiré du catalogue à nettoyer.</p>'}`);
  }
  async function change(operation){
    if(!preview||preview.store!==getStore()||!isLocal())throw new Error('Espace modifié. Rouvrez le stockage.');
    const ids=[...document.querySelectorAll('#audio-storage-form [name=asset]:checked')].map(input=>input.value);
    if(!ids.length)throw new Error('Choisissez les fichiers.');
    const selections=preview.value.retained.filter(file=>ids.includes(file.id)&&!file.protected);
    if(operation==='purge'&&!confirm('Supprimer définitivement '+selections.length+' fichier(s) audio ?'))return;
    const result=await audioStorage(preview.store.scope,selections,globalThis.indexedDB,operation);await preview.store.reload();await open();toast(operation==='restore'?result.count+' son(s) restauré(s).':size(result.bytes)+' libérés.');
  }
  return {open,purge:()=>change('purge'),restore:()=>change('restore')};
}
