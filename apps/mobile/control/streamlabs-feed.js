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
 else if(Number.isFinite(event.amount)&&event.currency){try{values.push(new Intl.NumberFormat('fr-FR',{style:'currency',currency:event.currency}).format(event.amount));}catch{values.push(`${event.amount} ${event.currency}`);}}
 if(Number.isFinite(event.count))values.push(event.count+({bits:' bits',raid:' personnes',host:' spectateurs',subscription:' abonnements'}[event.type]||''));
 if(event.months)values.push(`${event.months} mois`);
 if(event.recipient)values.push(`pour ${event.recipient}`);
 return values.join(' · ');
}
export function streamlabsRows(items){return items.map(e=>`<article class="streamlabs-event"><div class="streamlabs-event-head"><strong>${esc(e.displayName)}</strong><span class="pill">${esc(providers[e.platform]||e.platform)}</span><span>${esc(streamlabsEventLabel(e))}</span>${e.test?'<span class="pill">TEST</span>':''}<time datetime="${esc(e.receivedAt)}" title="Reçu sur cet appareil">${esc(new Date(e.receivedAt).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}))}</time></div>${streamlabsEventDetail(e)?`<p class="streamlabs-detail">${esc(streamlabsEventDetail(e))}</p>`:''}${e.message?`<p class="streamlabs-message">${esc(e.message)}</p>`:''}</article>`).join('');}

// Each selected source has its own history and credentials. Late replies cannot
// replace another source, and loss of the host never triggers a silent takeover.
export function createStreamlabsFeed(root,{request,configure,storage=localStorage}){
 let sources=[],source='',items=[],provider={},lastRead='',error='',stale=true,flight,checked=0,generation=0;
 let platform='all',type='all';
 const cacheKey=()=>`sd2.streamlabs.history:${source}`;
 function readCache(){
  items=[];provider={};lastRead='';stale=true;error='';
  try{const cached=JSON.parse(storage.getItem(cacheKey())||'null');if(cached){items=Array.isArray(cached.items)?cached.items.slice(0,100):[];provider=cached.provider||{};lastRead=cached.at||'';}}catch{}
 }
 root.innerHTML=`<section class="panel spacer streamlabs-feed"><div class="section-heading"><div><span class="eyebrow">ACTIVITÉ DU LIVE</span><h2>Événements Streamlabs</h2></div><button class="secondary" data-feed-refresh>Actualiser</button></div><div class="streamlabs-filters"><label>Source<select data-feed-source aria-label="Source Streamlabs"></select></label><label>Plateforme<select data-feed-platform aria-label="Plateforme Streamlabs"><option value="all">Toutes</option><option value="twitch">Twitch</option><option value="youtube">YouTube</option><option value="streamlabs">Streamlabs</option></select></label><label>Événements<select data-feed-type aria-label="Type d’événement Streamlabs"><option value="all">Tous</option><option value="follow">Follows / abonnés YouTube</option><option value="subscription">Abonnements / membres</option><option value="donation">Dons</option><option value="bits">Bits</option><option value="raid">Raids</option><option value="superchat">Super Chats</option></select></label><button class="secondary" data-feed-config>Configurer Streamlabs</button></div><p data-feed-status role="status"></p><div class="streamlabs-events" data-feed-events></div><p class="small muted">Historique des événements reçus pendant la connexion de la source choisie. Les périodes sans connexion ne sont pas reconstituées.</p></section>`;
 function draw(){
  if(!root.isConnected)return;
  const status=root.querySelector('[data-feed-status]');
  status.className='small '+(!stale&&provider.status==='CONNECTED'?'succeeded':'muted');
  status.textContent=stale?`Historique conservé · réception non confirmée${error?' · '+error:''}`:`${statuses[provider.status]||'État inconnu'}${provider.lastError?.message?' · '+provider.lastError.message:''}`;
  if(lastRead)status.textContent+=` · Actualisé à ${new Date(lastRead).toLocaleTimeString('fr-FR')}`;
  const shown=items.filter(e=>(platform==='all'||e.platform===platform)&&(type==='all'||e.type===type));
  const list=root.querySelector('[data-feed-events]'),scroll=list.scrollTop;
  list.innerHTML=streamlabsRows(shown)||`<p class="empty">${items.length?'Aucun événement pour ces filtres.':provider.status==='NOT_CONFIGURED'?'Connectez Streamlabs pour recevoir les événements ici.':'Aucun événement reçu pour cette source.'}</p>`;
  list.scrollTop=scroll;
  root.querySelector('[data-feed-config]').disabled=!source;
 }
 async function refresh(force=false){
  if(!source||!root.isConnected||flight||(!force&&Date.now()-checked<2500))return;
  checked=Date.now();const target=source,attempt=generation;
  const operation=(async()=>{
   try{
    const value=await request(target);
    if(attempt!==generation||target!==source||!root.isConnected)return;
    if(!Array.isArray(value.items)||!value.provider)throw new Error('Format de suivi indisponible : mettez à jour cette source.');
    items=value.items;provider=value.provider;lastRead=new Date().toISOString();stale=false;error='';
    try{storage.setItem(cacheKey(),JSON.stringify({items:items.slice(0,100),provider,at:lastRead}));}catch{}
   }catch(e){if(attempt!==generation||target!==source)return;stale=true;error=e.message;}
   draw();
  })();
  flight=operation;try{await operation;}finally{if(flight===operation)flight=undefined;}
 }
 function choose(value){generation++;flight=undefined;source=value;checked=0;try{storage.setItem('sd2.streamlabs.source',source);}catch{}readCache();root.querySelector('[data-feed-source]').value=source;draw();void refresh(true);}
 root.addEventListener('change',event=>{
  if(event.target.matches('[data-feed-source]'))choose(event.target.value);
  if(event.target.matches('[data-feed-platform]')){platform=event.target.value;draw();}
  if(event.target.matches('[data-feed-type]')){type=event.target.value;draw();}
 });
 root.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.hasAttribute('data-feed-refresh'))void refresh(true);
  if(button.hasAttribute('data-feed-config')&&source)configure(sources.find(s=>s.id===source));
 });
 return {refresh,update(next){
  if(JSON.stringify(next)!==JSON.stringify(sources)){
   sources=next;root.querySelector('[data-feed-source]').innerHTML=sources.map(s=>`<option value="${esc(s.id)}">${esc(s.label)}</option>`).join('');
   let preferred='';try{preferred=storage.getItem('sd2.streamlabs.source')||'';}catch{}
   const selected=sources.find(s=>s.id===source)?.id||sources.find(s=>s.id===preferred)?.id||sources[0]?.id||'';
   if(selected!==source)choose(selected);else root.querySelector('[data-feed-source]').value=source;
  }
  void refresh();
 }};
}
