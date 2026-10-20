import { randomUuid } from '../shared/planning-engine.js';
const pending=new Map();
globalThis.addEventListener?.('provider-result',event=>{
 const operation=pending.get(event.detail?.id);if(!operation)return;
 pending.delete(event.detail.id);clearTimeout(operation.timer);
 try{operation.resolve(JSON.parse(event.detail.result));}catch(e){operation.reject(e);}
});
export async function callDeviceBridge(bridge,method,payload={}){
 if(!bridge?.requestAsync){
  if(typeof bridge?.[method]!=='function')throw new Error('Mettez à jour cette application pour utiliser ce service.');
  return JSON.parse(await bridge[method](JSON.stringify(payload)));
 }
 const id=randomUuid();
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Réponse du service non reçue. Vérifiez son état avant de réessayer.'));},180000);
  pending.set(id,{resolve,reject,timer});
  try{const ack=JSON.parse(bridge.requestAsync(JSON.stringify({id,method,payload})));if(!ack.ok)throw new Error(ack.message||'Service occupé.');}
  catch(e){clearTimeout(timer);pending.delete(id);reject(e);}
 });
}
