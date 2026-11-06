/** Gain/mute control follows only the selected authority. Pending IDs survive a remount. */
export function mountMixerControl(root,{request,authorityKey,storage=globalThis.localStorage}){
 const doc=root.ownerDocument,section=doc.createElement('section');
 section.className='panel';section.style.minWidth='0';section.setAttribute('aria-label','Commander le mixeur OBS');
 section.innerHTML='<h2>Réglage d’une source OBS</h2><p>Gain, muet, pistes et monitoring de la source OBS, y compris la capture du PC jeu. La piste VOD Twitch doit être vérifiée dans OBS ; aucun numéro n’est supposé.</p><form><label>Source OBS<select name="source" aria-label="Source OBS du mixeur" style="max-width:100%;min-width:0;width:100%"></select></label><label>Réglage<select name="property" aria-label="Réglage audio"><option value="gain">Gain (multiplicateur)</option><option value="mute">Muet</option><option value="tracks">Pistes OBS 1 à 6</option><option value="monitorType">Retour monitoring</option></select></label><label data-gain>Gain (0 à 20)<input name="gain" aria-label="Gain OBS" type="number" min="0" max="20" step="0.01" value="1"></label><label data-mute hidden>Muet<select name="mute" aria-label="Muet OBS"><option value="true">Oui</option><option value="false">Non</option></select></label><fieldset data-routing hidden style="min-width:0;max-width:100%;box-sizing:border-box"><legend>Routage observé de cette source</legend><button type="button" data-load-routing>Charger le routage actuel</button><p data-routing-state>Chargez le routage avant de le modifier.</p><div data-tracks><label style="display:inline-block;margin-right:1em"><input type="checkbox" data-track="1" aria-label="Piste OBS 1"> Piste 1</label><label style="display:inline-block;margin-right:1em"><input type="checkbox" data-track="2" aria-label="Piste OBS 2"> Piste 2</label><label style="display:inline-block;margin-right:1em"><input type="checkbox" data-track="3" aria-label="Piste OBS 3"> Piste 3</label><label style="display:inline-block;margin-right:1em"><input type="checkbox" data-track="4" aria-label="Piste OBS 4"> Piste 4</label><label style="display:inline-block;margin-right:1em"><input type="checkbox" data-track="5" aria-label="Piste OBS 5"> Piste 5</label><label style="display:inline-block;margin-right:1em"><input type="checkbox" data-track="6" aria-label="Piste OBS 6"> Piste 6</label></div><label data-monitor>Retour monitoring<select name="monitorType" aria-label="Retour monitoring OBS" style="width:100%;max-width:100%;min-width:0"><option value="OBS_MONITORING_TYPE_NONE">Sans retour</option><option value="OBS_MONITORING_TYPE_MONITOR_ONLY">Retour uniquement (pas dans la sortie)</option><option value="OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT">Retour et sortie</option></select></label><p>Vérifiez la piste de diffusion et la piste VOD avant de retirer une source. Ce réglage ne change pas le périphérique audio Windows.</p></fieldset><button type="submit">Prévisualiser le réglage audio</button></form><p role="status"></p><div data-consent hidden><p data-preview></p><label><input type="checkbox" aria-label="Confirmer le réglage audio"> J’ai vérifié cette source et ce réglage.</label><button type="button" data-confirm disabled>Appliquer le réglage audio</button></div><button type="button" data-status hidden>Relire le reçu audio</button><button type="button" data-ack hidden>J’ai vérifié ce réglage dans OBS</button><button type="button" data-rollback hidden>Préparer le retour au réglage précédent</button>';
 const history=doc.createElement('details');history.setAttribute('data-audio-history','');
 history.innerHTML='<summary>Historique des réglages audio</summary><p>Résultats enregistrés sur FIXE pour ce contrôleur, pas une mesure de l’état courant. Un retour exige un nouvel aperçu et une confirmation.</p><button type="button" data-history-refresh>Lire l’historique audio</button><p data-history-state aria-live="polite"></p><ol data-history-rows style="overflow-wrap:anywhere;padding-left:1.4em"></ol><button type="button" data-history-more hidden>Réglages plus anciens</button>';
 section.append(history);root.append(section);
 const get=s=>section.querySelector(s),form=get('form'),status=get('[role=status]'),select=get('[name=source]');
 const key='sc3.mixer.pending:'+authorityKey;
 const monitors=['OBS_MONITORING_TYPE_NONE','OBS_MONITORING_TYPE_MONITOR_ONLY','OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT'];
 const tracksValid=t=>Boolean(t&&typeof t==='object'&&!Array.isArray(t)&&Object.keys(t).sort().join(',')==='1,2,3,4,5,6'&&Object.values(t).every(v=>typeof v==='boolean'));
 const tracksEqual=(a,b)=>a===undefined||b===undefined?a===b:tracksValid(a)&&tracksValid(b)&&[1,2,3,4,5,6].every(n=>a[n]===b[n]);
 const changedField=c=>'gain'in c?'gain':'mute'in c?'mute':'tracks'in c?'tracks':'monitorType';
 const describe=c=>'gain'in c?'gain '+c.gain:'mute'in c?'muet '+(c.mute?'oui':'non'):'tracks'in c?'pistes '+([1,2,3,4,5,6].filter(n=>c.tracks[n]).join(', ')||'aucune'):'monitoring '+({OBS_MONITORING_TYPE_NONE:'sans retour',OBS_MONITORING_TYPE_MONITOR_ONLY:'retour uniquement',OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT:'retour et sortie'}[c.monitorType]||'inconnu');
 let disposed=false,online=true,busy=false,plan,lastReceipt,pending,version=0;
 let routingLoaded,historyVersion=0,historyBusy=false,historyCursor=null;
 const clearPlan=()=>{plan=undefined;get('[data-consent]').hidden=true;get('[aria-label="Confirmer le réglage audio"]').checked=false};
 const clearPending=()=>{storage.removeItem(key);pending=undefined};
 const paint=()=>{
  for(const e of form.elements)e.disabled=!online||busy||Boolean(pending);
  get('[data-confirm]').disabled=!online||busy||!plan||!get('[aria-label="Confirmer le réglage audio"]').checked;
  get('[data-status]').hidden=!pending;get('[data-status]').disabled=!online||busy;
  get('[data-ack]').hidden=!pending||busy;get('[data-ack]').disabled=!online;
  get('[data-rollback]').hidden=!lastReceipt?.rollbackAvailable;get('[data-rollback]').disabled=!online||busy||Boolean(pending);
  for(const button of history.querySelectorAll('button'))button.disabled=!online||busy||historyBusy||Boolean(pending);
  get('[data-history-more]').hidden=historyCursor===null;
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
    ('gain'in pending.change?Math.abs(after.gain-pending.change.gain)>0.000001:after.gain!==before.gain)||
    after.mute!==('mute'in pending.change?pending.change.mute:before.mute)||
    after.monitorType!==('monitorType'in pending.change?pending.change.monitorType:before.monitorType)||
    !tracksEqual(after.tracks,'tracks'in pending.change?pending.change.tracks:before.tracks))throw Error('INVALID_READBACK');
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
   plan=value;get('[data-preview]').textContent=value.change.sourceId+' · '+describe({[changedField(value.change)]:value.before[changedField(value.change)]})+' → '+describe(value.change);
   get('[data-consent]').hidden=false;status.textContent='Aperçu obtenu sans écriture ; confirmation valable 45 secondes.';
  }catch{if(!disposed&&current===version){clearPlan();status.textContent='Aperçu indisponible ou réglage modifié. Aucune commande audio envoyée.'}}
  finally{if(!disposed&&current===version){busy=false;paint()}}
 };
 const loadRouting=async()=>{
  if(disposed||!online||busy||pending||!select.value)return;
  busy=true;clearPlan();const current=++version,sourceId=select.value;paint();
  try{
   const route=await request('/api/v1/streamcockpit-mixer/routing?sourceId='+encodeURIComponent(sourceId),undefined,'GET');
   if(disposed||current!==version||select.value!==sourceId)return;
   if(route?.schemaVersion!==1||route.kind!=='streamcockpit-obs-audio-routing'||route.sourceId!==sourceId||
     !Array.isArray(route.tracks)||route.tracks.length!==6||route.tracks.some((t,i)=>t.number!==i+1||typeof t.enabled!=='boolean')||!monitors.includes(route.monitorType))throw Error('INVALID_ROUTING');
   for(const track of route.tracks)get('[data-track="'+track.number+'"]').checked=track.enabled;
   get('[name=monitorType]').value=route.monitorType;routingLoaded=sourceId;
   get('[data-routing-state]').textContent='Pistes et monitoring relus. Vérifiez les changements puis prévisualisez.';
  }catch{if(!disposed&&current===version){routingLoaded=undefined;get('[data-routing-state]').textContent='Routage indisponible ; aucun changement autorisé.'}}
  finally{if(!disposed&&current===version){busy=false;paint()}}
 };
 get('[data-load-routing]').addEventListener('click',()=>void loadRouting());
 form.addEventListener('submit',event=>{
  event.preventDefault();const sourceId=select.value,property=get('[name=property]').value;if(!sourceId)return;
  if(['tracks','monitorType'].includes(property)&&routingLoaded!==sourceId){status.textContent='Chargez d’abord le routage actuel de cette source.';return}
  const change=property==='gain'?{sourceId,gain:Number(get('[name=gain]').value)}:property==='mute'?{sourceId,mute:get('[name=mute]').value==='true'}:
   property==='tracks'?{sourceId,tracks:Object.fromEntries([1,2,3,4,5,6].map(n=>[String(n),get('[data-track="'+n+'"]').checked]))}:{sourceId,monitorType:get('[name=monitorType]').value};
  void preview({change});
 });
 form.addEventListener('input',()=>{clearPlan();paint()});
 form.addEventListener('change',event=>{
  const property=get('[name=property]').value;
  get('[data-gain]').hidden=property!=='gain';get('[data-mute]').hidden=property!=='mute';get('[data-routing]').hidden=!['tracks','monitorType'].includes(property);
  get('[data-tracks]').hidden=property!=='tracks';get('[data-monitor]').hidden=property!=='monitorType';
  if(event.target===select){routingLoaded=undefined;get('[data-routing-state]').textContent='Chargez le routage de cette source.'}
  clearPlan();paint();
 });
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
 const readHistory=async(reset)=>{
  if(disposed||!online||busy||historyBusy||pending)return;
  historyBusy=true;const current=++historyVersion,cursor=reset?null:historyCursor;paint();
  if(reset)get('[data-history-rows]').replaceChildren();
  get('[data-history-state]').textContent='Lecture du journal FIXE…';
  try{
   const data=await request('/api/v1/streamcockpit-mixer/control/history'+(cursor===null?'':'?before='+cursor),undefined,'GET');
   if(disposed||current!==historyVersion||!online)return;
   if(data?.schemaVersion!==1||data.kind!=='streamcockpit-mixer-history'||data.readOnly!==true||!Array.isArray(data.entries)||data.entries.length>100||
    data.nextBefore!==null&&(!Number.isSafeInteger(data.nextBefore)||data.nextBefore<1||cursor!==null&&data.nextBefore>=cursor))throw Error('INVALID_HISTORY');
   let previous=cursor??Number.MAX_SAFE_INTEGER;
   for(const row of data.entries){const value=row?.receipt;
    if(!Number.isSafeInteger(row.sequence)||row.sequence<1||row.sequence>=previous||!Number.isSafeInteger(row.recordedAt)||
      value?.kind!=='streamcockpit-mixer-receipt'||value.schemaVersion!==1||!/^[-0-9a-f]{36}$/i.test(value.confirmationId)||
      !['confirmed','unchanged','uncertain','rejected'].includes(value.status)||typeof value.change?.sourceId!=='string'||
      'tracks'in value.change&&!tracksValid(value.change.tracks))throw Error('INVALID_HISTORY');
    previous=row.sequence;
   }
   for(const row of data.entries){const value=row.receipt,li=doc.createElement('li'),text=doc.createElement('p');
    text.textContent=new Date(row.recordedAt).toLocaleString('fr-FR')+' · '+value.change.sourceId+' · '+describe(value.change)+' · '+({confirmed:'Confirmé',unchanged:'Déjà observé',rejected:'Refusé',uncertain:'Incertain — ne pas répéter'}[value.status]);li.append(text);
    if(value.status==='confirmed'&&value.rollbackAvailable===true){const button=doc.createElement('button');button.type='button';button.textContent='Préparer le retour pour ce réglage';
     button.addEventListener('click',()=>{if(online&&!busy&&!pending)void preview({rollbackReceiptId:value.confirmationId})});li.append(button)}
    get('[data-history-rows]').append(li);
   }
   historyCursor=data.nextBefore;get('[data-history-state]').textContent=get('[data-history-rows]').children.length+' résultat(s) affiché(s). Aucun réglage renvoyé.';
  }catch{if(!disposed&&current===historyVersion){get('[data-history-rows]').replaceChildren();historyCursor=null;get('[data-history-state]').textContent='Historique indisponible ; aucune action rejouée.'}}
  finally{if(!disposed&&current===historyVersion){historyBusy=false;paint()}}
 };
 get('[data-history-refresh]').addEventListener('click',()=>void readHistory(true));
 get('[data-history-more]').addEventListener('click',()=>{if(historyCursor!==null)void readHistory(false)});
 const offline=()=>{online=false;version++;historyVersion++;historyBusy=false;historyCursor=null;routingLoaded=undefined;get('[data-history-rows]').replaceChildren();get('[data-history-state]').textContent='Régie déconnectée : relisez l’historique.';busy=false;lastReceipt=undefined;clearPlan();status.textContent=pending?'Commande non résolue ; régie déconnectée. Aucun renvoi.':'Régie déconnectée ; commande audio suspendue.';paint()};
 // Only an authenticated, current read from the pinned FIXE host may re-enable writes.
 const verifiedOnline=data=>{
  if(disposed||online||data?.schemaVersion!==1||data.readOnly!==true||data.owner!=='FIXE'||
    typeof data.revision!=='string'||!data.revision||!Array.isArray(data.sources)||
    !Array.isArray(data.errors)||!Array.isArray(data.outputs))return;
  online=true;version++;busy=false;clearPlan();
  status.textContent=pending?'Régie reconnectée ; commande toujours incertaine. Relisez son reçu avant toute nouvelle action.':'Régie reconnectée et relue ; prévisualisez un nouveau réglage avant toute commande.';
  paint();
 };
 globalThis.addEventListener?.('offline',offline);
 try{const saved=storage.getItem(key);if(saved){const value=JSON.parse(saved);if(!value||!/^[0-9a-f-]{36}$/i.test(value.id)||!value.change)throw Error('INVALID_PENDING');pending=value;uncertain();void readStatus()}}
 catch{pending={id:'unavailable',change:{}};uncertain()}
 paint();
 return {sources(values){if(disposed||busy||pending)return;const normalized=(values??[]).filter(s=>typeof s.id==='string'&&typeof s.name==='string');if(JSON.stringify([...select.options].map(o=>[o.value,o.textContent]))===JSON.stringify(normalized.map(s=>[s.id,s.name])))return;const previous=select.value;select.replaceChildren();for(const source of values??[]){if(typeof source.id!=='string'||typeof source.name!=='string')continue;const o=doc.createElement('option');o.value=source.id;o.textContent=source.name;select.append(o)}if([...select.options].some(o=>o.value===previous))select.value=previous;paint()},verifiedOnline,unavailable:offline,destroy(){disposed=true;version++;historyVersion++;globalThis.removeEventListener?.('offline',offline);section.remove()}};
}
