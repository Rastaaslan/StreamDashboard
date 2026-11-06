/** Read-only host gate for a native Android installation. The native UI owns
 * package selection, identity checks, consent and the system installer. */
export function installNativeUpdateGate({native=globalThis.StreamDashboardNative,events=globalThis,
 request,origin,now=Date.now}){
 if(typeof native?.updateSafety!=='function')return ()=>{};
 const listener=async event=>{
  const id=event.detail?.id;
  if(typeof id!=='string'||! /^[a-f0-9-]{36}$/.test(id))return;
  const selected=origin(),started=now();
  let safe=false;
  try{
   if(!selected)throw Error('Régie absente');
   const result=await request('/api/v1/maintenance/safety');
   safe=selected===origin()&&now()-started>=0&&now()-started<4000&&result?.authority==='fixe'&&
    result.safe===true&&Number.isSafeInteger(result.observedAt)&&
    now()-result.observedAt>=-1000&&now()-result.observedAt<4000;
  }catch{/* Unknown never authorizes installation, and no mutation or sync is retried. */}
  native.updateSafety(id,safe);
 };
 events.addEventListener('native-update-safety',listener);
 return ()=>events.removeEventListener('native-update-safety',listener);
}
