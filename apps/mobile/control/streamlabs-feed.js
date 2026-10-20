const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const providers={twitch:'Twitch',youtube:'YouTube',streamlabs:'Streamlabs'};
const statuses={CONNECTED:'Connecté · réception active',CONNECTING:'Connexion en cours',DISCONNECTED:'Déconnecté',NOT_CONFIGURED:'À connecter',NOT_SUPPORTED:'Indisponible',DEGRADED:'Connexion dégradée',ERROR:'Erreur de connexion'};
export function streamlabsEventLabel(event){
 if(event.type==='follow')return event.platform==='youtube'?'Abonné YouTube':'Follow';
 if(event.type==='subscription')return event.recipient||/gift/i.test(event.subType||'')?'Abonnement offert':event.platform==='youtube'?'Membre YouTube':event.subType==='resub'?'Réabonnement':'Abonnement';
 return {donation:'Don',bits:'Bits',raid:'Raid',host:'Host',superchat:'Super Chat'}[event.type]||event.type;
}
export function streamlabsEventDetail(event){
 const values=[];
 if(event.amountLabel)values.push(event.amountLabel);
 else if(Number.isFinite(event.amount)&&event.currency){try{values.push(new Intl.NumberFormat('fr-FR',{style:'currency',currency:event.currency}).format(event.amount));}catch{values.push(event.amount+' '+event.currency);}}
 if(Number.isFinite(event.count))values.push(event.count+({bits:' bits',raid:' personnes',host:' spectateurs',subscription:' abonnements'}[event.type]||''));
 if(event.months)values.push(event.months+' mois');
 if(event.recipient)values.push('pour '+event.recipient);
 return values.join(' · ');
}
export function streamlabsRows(items){return items.map(e=>'<article class="streamlabs-event"><div class="streamlabs-event-head"><strong>'+esc(e.displayName)+'</strong><span class="pill">'+esc(providers[e.platform]||e.platform)+'</span><span>'+esc(streamlabsEventLabel(e))+'</span>'+(e.test?'<span class="pill">TEST</span>':'')+'<time datetime="'+esc(e.receivedAt)+'" title="Reçu par la source sélectionnée">'+esc(new Date(e.receivedAt).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}))+'</time></div>'+(streamlabsEventDetail(e)?'<p class="streamlabs-detail">'+esc(streamlabsEventDetail(e))+'</p>':'')+(e.message?'<p class="streamlabs-message">'+esc(e.message)+'</p>':'')+'</article>').join('');}

// Each source owns its credentials and history. Polling survives focus in another
// control; changing workspace never carries an unrelated source selection across.
export function createStreamlabsFeed(root,{request,configure,storage=localStorage}){
 let sources=[],source='',workspaceKey='',items=[],provider={},lastRead='',error='',stale=true,flight,checked=0,generation=0,disposed=false;
 let platform='all',type='all';
 const cacheKey=()=>'sd2.streamlabs.history:'+source;
 const preferenceKey=()=>'sd2.streamlabs.source:'+workspaceKey;
 function readCache(){
  items=[];provider={};lastRead='';stale=true;error='';
  try{const cached=JSON.parse(storage.getItem(cacheKey())||'null');if(cached){items=Array.isArray(cached.items)?cached.items.slice(0,100):[];provider=cached.provider||{};lastRead=cached.at||'';}}catch{}
 }
 root.innerHTML='<section class="panel spacer streamlabs-feed"><div class="section-heading"><div><span class="eyebrow">ACTIVITÉ DU LIVE</span><h2>Événements Streamlabs</h2></div><button type="button" class="secondary" data-feed-refresh>Actualiser</button></div><div class="streamlabs-filters"><label>Source<select data-feed-source aria-label="Source Streamlabs"></select></label><label>Plateforme<select data-feed-platform aria-label="Plateforme Streamlabs"><option value="all">Toutes</option><option value="twitch">Twitch</option><option value="youtube">YouTube</option><option value="streamlabs">Streamlabs</option></select></label><label>Événements<select data-feed-type aria-label="Type d’événement Streamlabs"><option value="all">Tous</option><option value="follow">Follows / abonnés YouTube</option><option value="subscription">Abonnements / membres</option><option value="donation">Dons</option><option value="bits">Bits</option><option value="raid">Raids</option><option value="superchat">Super Chats</option></select></label><button type="button" class="secondary" data-feed-config>Configurer Streamlabs</button></div><p class="small muted" data-feed-source-info></p><p data-feed-status role="status"></p><div class="streamlabs-events" data-feed-events></div><p class="small muted">Historique des événements reçus pendant la connexion de la source choisie. Les périodes sans connexion ne sont pas reconstituées.</p></section>';
 function draw(){
  if(disposed||!root.isConnected)return;
  const status=root.querySelector('[data-feed-status]');
  status.className='small '+(!stale&&provider.status==='CONNECTED'?'succeeded':'muted');
  status.textContent=stale?'Historique conservé · réception non confirmée'+(error?' · '+error:''):(statuses[provider.status]||'État inconnu')+(provider.lastError?.message?' · '+provider.lastError.message:'');
  if(lastRead)status.textContent+=' · Actualisé à '+new Date(lastRead).toLocaleTimeString('fr-FR');
  const label=sources.find(value=>value.id===source)?.label;
  root.querySelector('[data-feed-source-info]').textContent=label?'Historique de '+label+'. Chaque source conserve ses propres événements.':'Aucune source Streamlabs disponible.';
  const shown=items.filter(e=>(platform==='all'||e.platform===platform)&&(type==='all'||e.type===type));
  const list=root.querySelector('[data-feed-events]'),scroll=list.scrollTop;
  list.innerHTML=streamlabsRows(shown)||'<p class="empty">'+(items.length?'Aucun événement pour ces filtres.':provider.status==='NOT_CONFIGURED'?'Connectez Streamlabs pour recevoir les événements ici.':'Aucun événement reçu pour cette source.')+'</p>';
  list.scrollTop=scroll;
  root.querySelector('[data-feed-config]').disabled=!source;
 }
 async function refresh(force=false){
  if(disposed||!source||!root.isConnected||flight||(!force&&Date.now()-checked<2000))return;
  checked=Date.now();const target=source,attempt=generation;
  const operation=Promise.resolve().then(async()=>{
   try{
    if(disposed||attempt!==generation)return;
    const value=await request(target);
    if(disposed||attempt!==generation||target!==source||!root.isConnected)return;
    if(!value||!Array.isArray(value.items)||!value.provider)throw new Error('Format de suivi indisponible : mettez à jour cette source.');
    items=value.items;provider=value.provider;lastRead=new Date().toISOString();stale=false;error='';
    try{storage.setItem(cacheKey(),JSON.stringify({items:items.slice(0,100),provider,at:lastRead}));}catch{}
   }catch(e){if(disposed||attempt!==generation||target!==source)return;stale=true;error=e instanceof Error?e.message:'Source inaccessible.';}
   draw();
  });
  flight=operation;try{await operation;}finally{if(flight===operation)flight=undefined;}
 }
 function choose(value,remember=true){
  generation++;flight=undefined;source=sources.some(item=>item.id===value)?value:'';checked=0;
  if(remember)try{storage.setItem(preferenceKey(),source);}catch{}
  readCache();root.querySelector('[data-feed-source]').value=source;draw();void refresh(true);
 }
 root.addEventListener('change',event=>{
  if(disposed)return;
  if(event.target.matches('[data-feed-source]'))choose(event.target.value);
  if(event.target.matches('[data-feed-platform]')){platform=event.target.value;draw();}
  if(event.target.matches('[data-feed-type]')){type=event.target.value;draw();}
 });
 root.addEventListener('click',event=>{
  if(disposed)return;
  const button=event.target.closest('button');if(!button)return;
  if(button.hasAttribute('data-feed-refresh'))void refresh(true);
  if(button.hasAttribute('data-feed-config')&&source)configure(sources.find(s=>s.id===source));
 });
 function destroy(){disposed=true;generation++;flight=undefined;clearInterval(timer);}
 const timer=setInterval(()=>{if(!root.isConnected){destroy();return;}void refresh();},2500);
 return {refresh,destroy,update(next,options={}){
  if(disposed)return;
  const nextSources=Array.isArray(next)?next.filter(item=>item&&typeof item.id==='string'&&item.id):[];
  const nextWorkspace=typeof options.workspaceKey==='string'&&options.workspaceKey?options.workspaceKey:nextSources[0]?.id||'local';
  const workspaceChanged=nextWorkspace!==workspaceKey;
  if(workspaceChanged||JSON.stringify(nextSources)!==JSON.stringify(sources)){
   workspaceKey=nextWorkspace;sources=nextSources;
   root.querySelector('[data-feed-source]').innerHTML=sources.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.label)+'</option>').join('');
   let saved='';try{saved=storage.getItem(preferenceKey())||'';}catch{}
   const known=value=>sources.find(s=>s.id===value)?.id||'';
   const selected=(!workspaceChanged&&known(source))||known(saved)||known(options.preferredSource)||sources[0]?.id||'';
   if(workspaceChanged||selected!==source)choose(selected,false);
   else{root.querySelector('[data-feed-source]').value=source;draw();}
  }
  void refresh();
 }};
}
