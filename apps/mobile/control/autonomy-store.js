import { clone, equal, merge, overlay, resources } from '../shared/autonomy.js';
export const newId=()=>globalThis.crypto?.randomUUID?.()||'edit_'+Date.now()+'_'+Math.random().toString(36).slice(2);
const containsSecret=value=>Boolean(value&&typeof value==='object'&&Object.entries(value).some(([key,v])=>/(?:token|secret|password|credential|authorization)/i.test(key)||containsSecret(v)));
const empty = () => ({version:1,workspace:null,bundle:null,pending:[],lastSync:null,drafts:{}});
/** Each transaction reads the newest record: multiple windows cannot overwrite each other's outbox. */
export async function openReplica(scope, factory=globalThis.indexedDB){
 if(!factory)throw new Error('Le stockage local est indisponible. Aucun enregistrement hors ligne ne sera annoncé.');
 const db=await new Promise((resolve,reject)=>{const request=factory.open('streamdashboard-autonomy-v1',1);request.onupgradeneeded=()=>request.result.createObjectStore('replicas');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
 const transact=update=>new Promise((resolve,reject)=>{
  const tx=db.transaction('replicas',update?'readwrite':'readonly'),table=tx.objectStore('replicas'),request=table.get(scope);let value;
  request.onsuccess=()=>{try{value=request.result||empty();if(update){value=update(value)||value;table.put(value,scope);}}catch(e){tx.abort();reject(e);}};
  tx.oncomplete=()=>resolve(clone(value));tx.onerror=()=>reject(tx.error||new Error('Sauvegarde locale impossible.'));tx.onabort=()=>reject(tx.error||new Error('Sauvegarde locale annulée.'));
 });
 let current=await transact();
 const change=async update=>{current=await transact(update);return current;};
 return {
  get record(){return clone(current);},
  async reload(){current=await transact();return current;},
  view(){if(!current.bundle)return null;let bundle=clone(current.bundle);for(const op of current.pending){const remote=resources(bundle)[op.key]??null;bundle=overlay(bundle,{[op.key]:merge(op.base,op.value,remote).value});}return bundle;},
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
  close(){db.close();},
 };
}
