const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const providers={twitch:'Twitch',youtube:'YouTube',streamlabs:'Streamlabs'};
const statuses={CONNECTED:'Connecté · réception active',CONNECTING:'Connexion en cours',DISCONNECTED:'Déconnecté',NOT_CONFIGURED:'À connecter',NOT_SUPPORTED:'Indisponible',DEGRADED:'Connexion dégradée',ERROR:'Erreur de connexion'};
const validDate=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const dateLabel=value=>validDate(value)?new Date(value).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'';
const publicHistory=value=>value&&typeof value==='object'&&!Array.isArray(value)?{
 status:['NOT_CONFIGURED','SYNCING','SYNCED','ERROR'].includes(value.status)?value.status:'ERROR',configured:value.configured===true,
 lastSyncAt:validDate(value.lastSyncAt)?value.lastSyncAt:null,lastAttemptAt:validDate(value.lastAttemptAt)?value.lastAttemptAt:null,
 count:Number.isSafeInteger(value.count)&&value.count>=0?value.count:0,lastError:typeof value.lastError==='string'?value.lastError.slice(0,500):null,
}:null;
function historyStatusText(history,stale=false){
 if(!history)return 'Historique enregistré par cette source.';
 const previous=history.lastSyncAt?' · Dernière synchronisation le '+dateLabel(history.lastSyncAt):'';
 if(stale)return (history.configured?'Historique du compte conservé · synchronisation non confirmée':'Historique du compte · configuration non confirmée')+previous;
 if(!history.configured&&history.status!=='ERROR')return 'Historique du compte à connecter · utilisez l’URL d’un widget Streamlabs.';
 if(history.status==='SYNCING')return 'Historique du compte · synchronisation en cours…'+previous;
 if(history.status==='SYNCED')return 'Historique du compte synchronisé · '+history.count+' événement'+(history.count===1?'':'s')+previous;
 return 'Historique du compte · synchronisation indisponible'+(history.lastError?' · '+history.lastError:'')+previous;
}
// Older sources and offline caches can still contain widget control packets.
// Keep unknown activity types; only these identified controls are excluded.
const streamlabsControlTypes=new Set(['rollendcredits','sessionreset','userstatesessionreset']);
const activityItems=items=>Array.isArray(items)?items.filter(event=>event&&typeof event.type==='string'&&/^[a-z][a-z0-9_-]{0,39}$/i.test(event.type)&&!streamlabsControlTypes.has(event.type.toLowerCase().replace(/[-_]/g,''))):[];
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
export function streamlabsRows(items){return activityItems(items).map(e=>{
 const cloud=e.origin==='cloud',original=cloud&&validDate(e.occurredAt),at=cloud?(original?e.occurredAt:null):e.receivedAt;
 const title=original?'Date de l’événement chez Streamlabs':cloud?'Date d’origine inconnue'+(validDate(e.receivedAt)?' · Récupéré le '+dateLabel(e.receivedAt):''):'Reçu par la source sélectionnée';
 const visibleDate=cloud&&!original?'Date d’origine inconnue':dateLabel(at)||'Date inconnue';
 return '<article class="streamlabs-event"><div class="streamlabs-event-head"><strong>'+esc(e.displayName)+'</strong><span class="pill">'+esc(providers[e.platform]||e.platform)+'</span><span>'+esc(streamlabsEventLabel(e))+'</span>'+(e.test?'<span class="pill">TEST</span>':'')+'<time'+(validDate(at)?' datetime="'+esc(at)+'"':'')+' title="'+esc(title)+'">'+esc(visibleDate)+'</time></div>'+(streamlabsEventDetail(e)?'<p class="streamlabs-detail">'+esc(streamlabsEventDetail(e))+'</p>':'')+(e.message?'<p class="streamlabs-message">'+esc(e.message)+'</p>':'')+'</article>';
}).join('');}

/** Credentials stay in the password fields until sent to the selected source;
 * status responses never prefill them or enter browser storage. */
export function createStreamlabsConfiguration(root,{label,request,changed=()=>{},notify=()=>{}}){
 let history=null,busy=false,generation=0;
 root.innerHTML='<h2>Streamlabs · '+esc(label)+'</h2><section><h3>Réception des nouveaux événements</h3><p class="small muted">Le Socket Token connecte le suivi en direct sur cette source.</p><form id="streamlabs-feed-config"><label>Socket Token Streamlabs<input name="token" type="password" required autocomplete="off" maxlength="1000"></label><button>Connecter et enregistrer</button></form><p class="small" data-streamlabs-direct-status role="status"></p></section><section class="spacer"><h3>Historique du compte Streamlabs</h3><p class="small muted">Retrouvez les follows, abonnements, dons et autres événements encore disponibles chez Streamlabs, même si l’application était fermée. Collez l’URL d’un de vos widgets Streamlabs, comme la liste d’événements ou les alertes.</p><p class="small muted" data-streamlabs-history-status role="status">Vérification de l’historique du compte…</p><form id="streamlabs-history-config"><label>URL d’un widget Streamlabs<input name="widgetUrl" type="password" required autocomplete="off" maxlength="4096" placeholder="Collez l’URL du widget"></label><div class="form-actions"><button>Enregistrer et récupérer l’historique</button><button type="button" class="secondary" data-streamlabs-history-clear disabled>Déconnecter l’historique</button></div></form></section>';
 const current=()=>root.isConnected;
 const historyStatus=root.querySelector('[data-streamlabs-history-status]');
 function controls(){
  if(!current())return;
  root.querySelectorAll('button').forEach(button=>{button.disabled=busy||(button.hasAttribute('data-streamlabs-history-clear')&&!history?.configured);});
 }
 function showHistory(value){
  if(!current())return;
  history=publicHistory(value);
  historyStatus.textContent=historyStatusText(history);
  historyStatus.className='small '+(history?.status==='SYNCED'?'succeeded':'muted');
  controls();
 }
 function historyFailure(error){
  if(!current())return;
  historyStatus.className='small muted';historyStatus.textContent='Historique du compte · '+(error instanceof Error?error.message:'Configuration indisponible.');
 }
 const initial=generation;
 void Promise.resolve().then(()=>request('/api/v1/supports/streamlabs/history/status',undefined,'GET')).then(value=>{if(initial===generation)showHistory(value);}).catch(error=>{if(initial===generation)historyFailure(error);});
 root.addEventListener('submit',async event=>{
  const form=event.target;
  if(!['streamlabs-feed-config','streamlabs-history-config'].includes(form.id))return;
  event.preventDefault();event.stopPropagation();
  if(busy||!current())return;
  busy=true;controls();
  const cloud=form.id==='streamlabs-history-config';
  if(cloud){generation++;historyStatus.textContent='Historique du compte · récupération en cours…';}
  try{
   const body=cloud?{widgetUrl:form.elements.widgetUrl.value.trim()}:{token:form.elements.token.value.trim()};
   const value=await request(cloud?'/api/v1/supports/streamlabs/history/config':'/api/v1/supports/streamlabs/config',body,'PUT');
   form.reset();
   if(!current())return;
   if(cloud){showHistory(value);notify(value.status==='SYNCED'?'Historique Streamlabs récupéré.':value.lastError||'Accès à l’historique enregistré ; synchronisation en attente.');}
   else{root.querySelector('[data-streamlabs-direct-status]').textContent=statuses[value.status]||'Configuration enregistrée.';notify(value.status==='CONNECTED'?'Streamlabs connecté.':value.lastError?.message||'Configuration enregistrée ; connexion non confirmée.');}
   changed(cloud?'history':'direct',value);
  }catch(error){if(cloud)historyFailure(error);else if(current())root.querySelector('[data-streamlabs-direct-status]').textContent=error instanceof Error?error.message:'Connexion impossible.';if(current())notify(error instanceof Error?error.message:'Configuration impossible.');}
  finally{busy=false;controls();}
 });
 root.addEventListener('click',async event=>{
  const button=event.target.closest('[data-streamlabs-history-clear]');
  if(!button)return;
  event.preventDefault();event.stopPropagation();
  if(busy||!history?.configured||!current())return;
  busy=true;generation++;controls();
  try{
   const value=await request('/api/v1/supports/streamlabs/history/config',undefined,'DELETE');
   root.querySelector('#streamlabs-history-config')?.reset();
   if(!current())return;
   showHistory(value);notify('Historique du compte déconnecté.');changed('history',value);
  }catch(error){historyFailure(error);if(current())notify(error instanceof Error?error.message:'Déconnexion impossible.');}
  finally{busy=false;controls();}
 });
}

// Each source owns its credentials and history. Polling survives focus in another
// control; changing workspace never carries an unrelated source selection across.
export function createStreamlabsFeed(root,{request,configure,storage=localStorage}){
 let sources=[],source='',workspaceKey='',items=[],provider={},history=null,lastRead='',error='',stale=true,flight,checked=0,generation=0,disposed=false;
 let platform='all',type='all',renderedEvents;
 const cacheKey=()=>'sd2.streamlabs.history:'+source;
 const preferenceKey=()=>'sd2.streamlabs.source:'+workspaceKey;
 function readCache(){
  items=[];provider={};history=null;lastRead='';stale=true;error='';
  try{const cached=JSON.parse(storage.getItem(cacheKey())||'null');if(cached){items=activityItems(cached.items).slice(0,100);provider=cached.provider||{};history=publicHistory(cached.history);lastRead=cached.at||'';if(Array.isArray(cached.items)&&items.length!==cached.items.length)storage.setItem(cacheKey(),JSON.stringify({items,provider,history,at:lastRead}));}}catch{}
 }
 root.innerHTML='<section class="panel streamlabs-feed streamlabs-feed-compact"><div class="section-heading streamlabs-heading"><h2>Streamlabs</h2><div class="streamlabs-tools"><button type="button" class="secondary" data-feed-refresh>Actualiser</button><details class="streamlabs-options" data-feed-options><summary aria-label="Filtres et connexion Streamlabs">Filtres<span data-feed-filter-count></span></summary><div class="streamlabs-options-body"><div class="streamlabs-filters"><label>Source<select data-feed-source aria-label="Source Streamlabs"></select></label><label>Plateforme<select data-feed-platform aria-label="Plateforme Streamlabs"><option value="all">Toutes</option><option value="twitch">Twitch</option><option value="youtube">YouTube</option><option value="streamlabs">Streamlabs</option></select></label><label>Événements<select data-feed-type aria-label="Type d’événement Streamlabs"><option value="all">Tous</option><option value="follow">Follows / abonnés YouTube</option><option value="subscription">Abonnements / membres</option><option value="donation">Dons</option><option value="bits">Bits</option><option value="raid">Raids</option><option value="superchat">Super Chats</option></select></label></div><button type="button" class="secondary" data-feed-config>Configurer Streamlabs</button><p class="small muted" data-feed-source-info></p><p data-feed-status role="status"></p><p data-feed-history-status role="status"></p><p class="small muted" data-feed-history-note></p></div></details></div></div><p class="small streamlabs-summary" data-feed-summary role="status"><span class="streamlabs-summary-context"><span data-feed-summary-source></span><span data-feed-summary-count></span></span><span data-feed-summary-direct></span><span data-feed-summary-history></span></p><div class="streamlabs-events" data-feed-events tabindex="0" aria-label="Événements Streamlabs"></div></section>';
 function summaryPart(selector,text,state){
  const node=root.querySelector(selector);
  if(node.textContent!==text)node.textContent=text;
  if(state)node.dataset.state=state;
 }
 function draw(){
  if(disposed||!root.isConnected)return;
  const status=root.querySelector('[data-feed-status]');
  status.className='small '+(!stale&&provider.status==='CONNECTED'?'succeeded':'muted');
  status.textContent=stale?'Historique conservé · réception non confirmée'+(error?' · '+error:''):(statuses[provider.status]||'État inconnu')+(provider.lastError?.message?' · '+provider.lastError.message:'');
  if(lastRead)status.textContent+=' · Actualisé à '+new Date(lastRead).toLocaleTimeString('fr-FR');
  const historyLine=root.querySelector('[data-feed-history-status]');
  historyLine.textContent=historyStatusText(history,stale);
  historyLine.className='small '+(!stale&&history?.status==='SYNCED'?'succeeded':'muted');
  root.querySelector('[data-feed-history-note]').textContent=history?.configured?'Les événements encore disponibles chez Streamlabs sont récupérés même si cette source était fermée. La liste est complétée par les événements reçus en direct.':'Connectez l’historique du compte pour retrouver aussi les événements disponibles chez Streamlabs. Le suivi en direct conserve les événements reçus pendant la connexion de cette source.';
  const label=sources.find(value=>value.id===source)?.label;
  root.querySelector('[data-feed-source-info]').textContent=label?'Source : '+label+'. L’historique du compte utilise la connexion Streamlabs de cette source.':'Aucune source Streamlabs disponible.';
  const shown=items.filter(e=>(platform==='all'||e.platform===platform)&&(type==='all'||e.type===type));
  const filterCount=Number(platform!=='all')+Number(type!=='all');
  summaryPart('[data-feed-summary-source]',label||'Aucune source');
  summaryPart('[data-feed-summary-count]',(filterCount?shown.length+' / '+items.length:items.length)+' événement'+(items.length===1?'':'s'));
  summaryPart('[data-feed-filter-count]',filterCount?' ('+filterCount+')':'');
  root.querySelector('[data-feed-options] > summary').setAttribute('aria-label','Filtres et connexion Streamlabs'+(filterCount?' · '+filterCount+' filtre'+(filterCount===1?' actif':'s actifs'):''));
  const directText=stale?'Direct non confirmé':({CONNECTED:'Direct actif',CONNECTING:'Direct en connexion',DISCONNECTED:'Direct déconnecté',NOT_CONFIGURED:'Direct à connecter',NOT_SUPPORTED:'Direct indisponible',DEGRADED:'Direct dégradé',ERROR:'Direct en erreur'}[provider.status]||'Direct non confirmé');
  const directState=stale?'stale':provider.status==='CONNECTED'?'ok':provider.status==='CONNECTING'?'pending':['DISCONNECTED','DEGRADED','ERROR'].includes(provider.status)?'error':'idle';
  const historyText=!history?'Historique local':stale?'Historique non confirmé':history.status==='ERROR'?'Historique en erreur':!history.configured?'Historique à connecter':history.status==='SYNCING'?'Historique en cours':history.status==='SYNCED'?'Historique à jour':'Historique non confirmé';
  const historyState=!history?'idle':stale?'stale':history.status==='ERROR'?'error':!history.configured?'idle':history.status==='SYNCING'?'pending':history.status==='SYNCED'?'ok':'stale';
  summaryPart('[data-feed-summary-direct]',directText,directState);
  summaryPart('[data-feed-summary-history]',historyText,historyState);
  const list=root.querySelector('[data-feed-events]'),scroll=list.scrollTop;
  const eventMarkup=streamlabsRows(shown)||'<p class="empty">'+(items.length?'Aucun événement pour ces filtres.':history?.status==='SYNCING'?'Récupération de l’historique Streamlabs…':history?.status==='SYNCED'?'Aucun événement disponible pour ce compte Streamlabs.':history?.configured?'L’historique du compte n’a pas encore pu être récupéré.':provider.status==='NOT_CONFIGURED'?'Connectez Streamlabs pour recevoir les événements ici.':'Aucun événement enregistré pour cette source.')+'</p>';
  if(eventMarkup!==renderedEvents){list.innerHTML=eventMarkup;renderedEvents=eventMarkup;}
  list.scrollTop=scroll;
  root.querySelector('[data-feed-config]').disabled=!source;
 }
 async function refresh(force=false){
  if(disposed||!source||!root.isConnected||flight||(!force&&Date.now()-checked<2000))return;
  checked=Date.now();const target=source,attempt=generation;
  const operation=Promise.resolve().then(async()=>{
   try{
    if(disposed||attempt!==generation)return;
    const value=await request(target,{refresh:force});
    if(disposed||attempt!==generation||target!==source||!root.isConnected)return;
    if(!value||!Array.isArray(value.items)||!value.provider)throw new Error('Format de suivi indisponible : mettez à jour cette source.');
    items=activityItems(value.items);provider=value.provider;history=publicHistory(value.history);lastRead=new Date().toISOString();stale=false;error='';
    try{storage.setItem(cacheKey(),JSON.stringify({items:items.slice(0,100),provider,history,at:lastRead}));}catch{}
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
