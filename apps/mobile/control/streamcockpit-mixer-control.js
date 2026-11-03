/** Gain/mute control follows only the selected authority. Pending IDs survive a remount. */
export function mountMixerControl(root,{request,authorityKey,storage=globalThis.localStorage}){
 const doc=root.ownerDocument,section=doc.createElement('section');
 section.className='panel';section.style.minWidth='0';section.setAttribute('aria-label','Commander le mixeur OBS');
 section.innerHTML='<h2>Réglage d’une source OBS</h2><p>Gain et muet uniquement. Les valeurs observées ne prouvent ni le niveau du signal ni le routage.</p><form><label>Source OBS<select name="source" aria-label="Source OBS du mixeur" style="max-width:100%;min-width:0;width:100%"></select></label><label>Réglage<select name="property" aria-label="Réglage audio"><option value="gain">Gain (multiplicateur)</option><option value="mute">Muet</option></select></label><label data-gain>Gain (0 à 20)<input name="gain" aria-label="Gain OBS" type="number" min="0" max="20" step="0.01" value="1"></label><label data-mute hidden>Muet<select name="mute" aria-label="Muet OBS"><option value="true">Oui</option><option value="false">Non</option></select></label><button type="submit">Prévisualiser le réglage audio</button></form><p role="status"></p><div data-consent hidden><p data-preview></p><label><input type="checkbox" aria-label="Confirmer le réglage audio"> J’ai vérifié cette source et ce réglage.</label><button type="button" data-confirm disabled>Appliquer le réglage audio</button></div><button type="button" data-status hidden>Relire le reçu audio</button><button type="button" data-ack hidden>J’ai vérifié ce réglage dans OBS</button><button type="button" data-rollback hidden>Préparer le retour au réglage précédent</button>';
 root.append(section);
 const get=s=>section.querySelector(s),form=get('form'),status=get('[role=status]'),select=get('[name=source]');
 const key='sc3.mixer.pending:'+authorityKey;
 let disposed=false,online=true,busy=false,plan,lastReceipt,pending,version=0;
 const clearPlan=()=>{plan=undefined;get('[data-consent]').hidden=true;get('[aria-label="Confirmer le réglage audio"]').checked=false};
 const clearPending=()=>{storage.removeItem(key);pending=undefined};
 const paint=()=>{
  for(const e of form.elements)e.disabled=!online||busy||Boolean(pending);
  get('[data-confirm]').disabled=!online||busy||!plan||!get('[aria-label="Confirmer le réglage audio"]').checked;
  get('[data-status]').hidden=!pending;get('[data-status]').disabled=!online||busy;
  get('[data-ack]').hidden=!pending||busy;get('[data-ack]').disabled=!online;
  get('[data-rollback]').hidden=!lastReceipt?.rollbackAvailable;get('[data-rollback]').disabled=!online||busy||Boolean(pending);
 };
 const uncertain=()=>{clearPlan();status.textContent='Résultat incertain : aucune répétition automatique. Relisez le reçu ou vérifiez OBS avant une nouvelle action.';paint()};
 const result=value=>{
  if(!pending||value?.confirmationId!==pending.id||value.schemaVersion!==1||!['streamcockpit-mixer-receipt','streamcockpit-mixer-status'].includes(value.kind))throw Error('INVALID_RECEIPT');
  if(value.status==='running'){status.textContent='Commande encore en cours sur la régie ; aucune répétition.';paint();return}
  if(value.status==='uncertain'){uncertain();return}
  if(value.kind!=='streamcockpit-mixer-receipt'||JSON.stringify(value.change)!==JSON.stringify(pending.change)||!['confirmed','unchanged','rejected'].includes(value.status))throw Error('INVALID_RECEIPT');
  if(value.status!=='rejected'){
   const after=value.after,before=pending.before;
   if(!after||!before||after.sourceId!==pending.change.sourceId||after.inputUuid!==before.inputUuid||after.generation!==before.generation||typeof after.mute!=='boolean'||!Number.isFinite(after.gain)||!Number.isFinite(after.observedAt)||
    ('gain'in pending.change?(Math.abs(after.gain-pending.change.gain)>0.000001||after.mute!==before.mute):(after.mute!==pending.change.mute||after.gain!==before.gain)))throw Error('INVALID_READBACK');
  }
  clearPending();clearPlan();lastReceipt=value;
  status.textContent=value.status==='confirmed'?'Réglage confirmé par relecture OBS.':value.status==='unchanged'?'Réglage déjà observé, aucune écriture.':'OBS a refusé le réglage ; aucune répétition.';paint();
 };
 const readStatus=async()=>{
  if(!online||busy||!pending)return;busy=true;const current=++version;paint();
  try{const value=await request('/api/v1/streamcockpit-mixer/control/status/'+pending.id,undefined,'GET');if(disposed||current!==version)return;result(value)}
  catch{if(!disposed&&current===version)uncertain()}
  finally{if(!disposed&&current===version){busy=false;paint()}}
 };
 const preview=async body=>{
  if(!online||busy||pending)return;clearPlan();lastReceipt=body.rollbackReceiptId?lastReceipt:undefined;busy=true;const current=++version;paint();
  try{
   const value=await request('/api/v1/streamcockpit-mixer/control/preview',body,'POST');
   if(disposed||current!==version)return;
   if(value?.schemaVersion!==1||value.kind!=='streamcockpit-mixer-preview'||typeof value.confirmationId!=='string'||!/^[0-9a-f-]{36}$/i.test(value.confirmationId)||!value.before||!value.change||value.expiresAt<=Date.now())throw Error('INVALID_PREVIEW');
   plan=value;get('[data-preview]').textContent=value.change.sourceId+' · '+('gain'in value.change?'gain '+value.before.gain+' → '+value.change.gain:'muet '+value.before.mute+' → '+value.change.mute);
   get('[data-consent]').hidden=false;status.textContent='Aperçu obtenu sans écriture ; confirmation valable 45 secondes.';
  }catch{if(!disposed&&current===version){clearPlan();status.textContent='Aperçu indisponible ou réglage modifié. Aucune commande audio envoyée.'}}
  finally{if(!disposed&&current===version){busy=false;paint()}}
 };
 form.addEventListener('submit',event=>{event.preventDefault();const sourceId=select.value;if(!sourceId)return;const change=get('[name=property]').value==='gain'?{sourceId,gain:Number(get('[name=gain]').value)}:{sourceId,mute:get('[name=mute]').value==='true'};void preview({change})});
 form.addEventListener('input',()=>{clearPlan();paint()});
 form.addEventListener('change',()=>{get('[data-gain]').hidden=get('[name=property]').value!=='gain';get('[data-mute]').hidden=get('[name=property]').value!=='mute';clearPlan();paint()});
 get('[aria-label="Confirmer le réglage audio"]').addEventListener('change',paint);
 get('[data-confirm]').addEventListener('click',async()=>{
  if(!online||busy||!plan||!get('[aria-label="Confirmer le réglage audio"]').checked)return;
  if(plan.expiresAt<=Date.now()){clearPlan();status.textContent='Confirmation expirée : prévisualisez à nouveau.';paint();return}
  const current=++version,selected=plan;busy=true;lastReceipt=undefined;
  try{
   pending={id:selected.confirmationId,change:selected.change,before:selected.before};storage.setItem(key,JSON.stringify(pending));clearPlan();status.textContent='Envoi du réglage audio ; confirmation attendue de la régie.';paint();
   const value=await request('/api/v1/streamcockpit-mixer/control/confirm',{confirmationId:pending.id,confirmed:true},'POST');
   if(disposed||current!==version)return;result(value);
  }catch{if(!disposed&&current===version)uncertain()}
  finally{if(!disposed&&current===version){busy=false;paint()}}
 });
 get('[data-status]').addEventListener('click',()=>void readStatus());
 get('[data-ack]').addEventListener('click',()=>{if(!online||busy)return;try{clearPending();status.textContent='Vérification OBS déclarée par l’opérateur. Une nouvelle action exige un nouvel aperçu.'}catch{status.textContent='Mémoire locale indisponible : commande suspendue.'}paint()});
 get('[data-rollback]').addEventListener('click',()=>{if(lastReceipt?.rollbackAvailable)void preview({rollbackReceiptId:lastReceipt.confirmationId})});
 const offline=()=>{online=false;version++;busy=false;clearPlan();status.textContent=pending?'Commande non résolue ; régie déconnectée. Aucun renvoi.':'Régie déconnectée ; commande audio suspendue.';paint()};
 globalThis.addEventListener?.('offline',offline);
 try{const saved=storage.getItem(key);if(saved){const value=JSON.parse(saved);if(!value||!/^[0-9a-f-]{36}$/i.test(value.id)||!value.change)throw Error('INVALID_PENDING');pending=value;uncertain();void readStatus()}}
 catch{pending={id:'unavailable',change:{}};uncertain()}
 paint();
 return {sources(values){if(disposed||busy||pending)return;const normalized=(values??[]).filter(s=>typeof s.id==='string'&&typeof s.name==='string');if(JSON.stringify([...select.options].map(o=>[o.value,o.textContent]))===JSON.stringify(normalized.map(s=>[s.id,s.name])))return;const previous=select.value;select.replaceChildren();for(const source of values??[]){if(typeof source.id!=='string'||typeof source.name!=='string')continue;const o=doc.createElement('option');o.value=source.id;o.textContent=source.name;select.append(o)}if([...select.options].some(o=>o.value===previous))select.value=previous;paint()},unavailable:offline,destroy(){disposed=true;version++;globalThis.removeEventListener?.('offline',offline);section.remove()}};
}
