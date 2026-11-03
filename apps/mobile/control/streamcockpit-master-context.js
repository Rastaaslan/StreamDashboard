/** A short-lived master observation gates explicit actions; reads never execute a macro. */
export function mountMasterContext(root,{online,request,execute,canExecute=()=>true}){
 const doc=root.ownerDocument;let disposed=false,connected=online,view,deadline=0,flight=false,sequence=0,busy=false;
 const clear=message=>{view=undefined;deadline=0;root.dataset.status='unknown';root.replaceChildren();const h=doc.createElement('h2');h.textContent='Deck contextuel';const p=doc.createElement('p');p.setAttribute('role','status');p.textContent=message;root.append(h,p)};
 const draw=()=>{
  if(disposed)return;
  if(!connected||!view||performance.now()>=deadline){clear(connected?'Contexte du maître expiré ou indisponible ; actualisation nécessaire.':'Régie déconnectée ; commandes contextuelles suspendues.');return}
  root.replaceChildren();root.dataset.status='known';const h=doc.createElement('h2');h.textContent=view.presentation.bank.label;
  const status=doc.createElement('p');status.setAttribute('role','status');status.textContent='Scène : '+view.scene+' · Jeu Twitch : '+(view.game||'inconnu')+' · '+(view.role==='stream-pc'?'régie FIXE':'télécommande appairée');
  const note=doc.createElement('p');note.textContent='Actions autorisées par la régie ; leurs préconditions et le contexte sont revérifiés à l’envoi.';
  const cards=doc.createElement('div');cards.className='deck performance-deck';
  for(const action of view.presentation.actions){
   if(typeof action.id!=='string'||typeof action.label!=='string')continue;
   const b=doc.createElement('button');b.type='button';b.className='secondary';b.textContent=action.label;b.style.whiteSpace='normal';b.style.minWidth='0';b.setAttribute('data-context-action',action.id);
   b.disabled=busy||!canExecute()||action.available!==true;b.title=action.available===true?'Disponibilité vérifiée à l’envoi':'Permission nécessaire absente';
   b.addEventListener('click',async event=>{
    event.stopPropagation();if(disposed||busy||!connected||!view||performance.now()>=deadline||!canExecute()||action.available!==true){draw();return}
    const proof=view.proof;busy=true;draw();
    try{await execute(action.id,proof)}catch{if(!disposed)clear('Résultat non reçu : consultez le journal avant de recommencer.')}
    finally{if(!disposed){busy=false;await refresh()}}
   });cards.append(b);
  }
  if(!cards.children.length){const p=doc.createElement('p');p.textContent='Aucune action configurée pour ce contexte.';cards.append(p)}
  root.append(h,status,note,cards);
 };
 const refresh=async()=>{
  if(disposed||!connected||flight||busy)return;flight=true;const current=++sequence,started=performance.now();
  try{
   const value=await request();if(disposed||current!==sequence)return;
   if(value?.schemaVersion!==1||value.kind!=='streamcockpit-master-context'||value.status!=='known'||typeof value.proof!=='string'||!/^[0-9a-f-]{36}$/i.test(value.proof)||!Number.isFinite(value.validForMs)||value.validForMs<=0||value.validForMs>12_000||!value.presentation||!Array.isArray(value.presentation.actions)||!['stream-pc','paired-controller'].includes(value.role)||typeof value.scene!=='string')throw Error('UNAVAILABLE');
   view=value;deadline=started+value.validForMs;draw();
  }catch{if(!disposed&&current===sequence)clear('Contexte maître inconnu ou non autorisé ; banques manuelles disponibles.')}
  finally{if(!disposed&&current===sequence)flight=false}
 };
 const offline=()=>{connected=false;sequence++;flight=false;clear('Régie déconnectée ; commandes contextuelles suspendues.')};
 const resume=()=>{if(!disposed&&online){connected=true;clear('Relecture du contexte maître…');void refresh()}};
 const visibility=()=>{if(!doc.hidden)resume()};
 globalThis.addEventListener?.('offline',offline);globalThis.addEventListener?.('online',resume);doc.addEventListener('visibilitychange',visibility);
 const polling=setInterval(()=>{if(!disposed){draw();void refresh()}},5000),expiry=setInterval(()=>{if(view&&performance.now()>=deadline)draw()},250);
 clear(online?'Lecture du contexte maître…':'Régie déconnectée ; commandes contextuelles suspendues.');void refresh();
 return {refresh,unavailable:offline,destroy(){disposed=true;sequence++;clearInterval(polling);clearInterval(expiry);globalThis.removeEventListener?.('offline',offline);globalThis.removeEventListener?.('online',resume);doc.removeEventListener('visibilitychange',visibility)}};
}
