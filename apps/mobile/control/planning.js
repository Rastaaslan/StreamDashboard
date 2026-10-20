import { expandEditableRecurringItems, recurrenceSummary } from '../shared/recurrence.js';
import { filterPlanningTemporal, paginatePlanning, periodBounds } from '../planning-model.js';
import { localDate } from '../shared/planning-editor.js';
import { buildPlanningPng, sharePlanningPng } from '../planning-export.js';

const dateTime = value => { const d=new Date(value);return new Date(+d-d.getTimezoneOffset()*60000).toISOString().slice(0,16); };
const list = value => value.split(',').map(x=>x.trim()).filter(Boolean);
const providerNames={twitch:'Twitch',google:'Google Calendar'};
const statusNames={synced:'Synchronisé',error:'Échec',conflict:'Conflit',pending:'En attente',disabled:'Non publié','not-published':'Non publié'};

export function createPlanning({getData,api,esc,input,select,check,modal,close,toast,refresh,render,prepare}) {
 let temporal='upcoming',period='',category='',query='',number=1,visible=[],draft,master,revision,scope,exportPreview,bulkPreview,templates=[];
 const find=id=>getData().host.planning.find(x=>x.id===id);
 const button=(label,task,extra='',style='secondary')=>`<button type="button" class="${style}" data-planning="${task}" ${extra}>${label}</button>`;
 const canonicalId=item=>item.seriesId||item.id;
 function rows(){
  const items=getData().host.planning,now=Date.now();
  const first=Math.min(now-366*86400000,...items.map(x=>Date.parse(x.startAtUtc)).filter(Number.isFinite));
  const bounds=period?periodBounds(period):{start:first,end:now+730*86400000};
  const expanded=expandEditableRecurringItems(items,{from:bounds.start,to:bounds.end});
  return filterPlanningTemporal(expanded,temporal).filter(item=>(!category||(item.category||'live')===category)&&(!query||(item.title+' '+(item.twitchCategoryName||'')).toLocaleLowerCase().includes(query.toLocaleLowerCase())));
 }
 function providerStatus(item){return Object.entries(item.providers||{}).map(([name,v])=>`<span class="provider-status ${v.status==='error'?'failed':v.status==='conflict'?'partial':''}">${esc(providerNames[name]||name)} · ${esc(statusNames[v.status]||v.status)}${v.lastError?' · '+esc(v.lastError):''}</span>`).join('')||'<span>Conservé dans votre espace</span>';}
 function page(){
  const all=rows(),p=paginatePlanning(all,number,15);number=p.page;visible=p.items;
  return `<div class="section-heading"><div><h1>Planning & événements</h1><p class="subtitle">Votre agenda partagé, ses récurrences et ses publications.</p></div>${button('+ Créer','new','','')}</div><div class="planning-filters panel"><div class="form-grid">${select('Afficher','planning-temporal',[['upcoming','À venir'],['past','Passés'],['all','Tous']],temporal)}${select('Période','planning-period',[['','Toutes les dates'],['today','Aujourd’hui'],['this-week','Cette semaine'],['next-week','Semaine prochaine']],period)}${select('Type','planning-category',[['','Tous les événements'],['live','Lives'],['production','Production'],['personal','Personnel']],category)}${input('Rechercher','planning-query',query,'search')}</div><div class="toolbar">${button('Image & Discord','export')}${button('Modèles','templates')}${button('Synchroniser Google','sync')}${button('Supprimer une période','bulk')}</div></div><section class="panel spacer"><p class="small muted">${all.length} événement(s) · les séries affichent leurs occurrences${!period?' sur les deux prochaines années':''}.</p>${visible.map((item,i)=>`<article class="event" data-event-row="${i}"><div class="event-date">${item.allDay?Number(item.startAtUtc.slice(8,10)):new Date(item.startAtUtc).getDate()}<small>${new Date(item.startAtUtc).toLocaleDateString('fr-FR',{month:'short',...(item.allDay?{timeZone:'UTC'}:{})})}</small></div><div class="event-content"><h3>${esc(item.title)}</h3><p>${esc(item.allDay?'Journée entière':new Date(item.startAtUtc).toLocaleString('fr-FR',{weekday:'long',hour:'2-digit',minute:'2-digit'}))} · ${esc(item.twitchCategoryName||item.category||'Live')}</p>${item.recurrence?`<p>${esc(recurrenceSummary(item))}</p>`:''}<p>${providerStatus(item)}</p></div><div class="row-actions">${button('Modifier','edit',`data-index="${i}"`)}${button('Dupliquer','duplicate',`data-index="${i}"`)}${item.category==='live'?button('Préparer','prepare',`data-index="${i}"`):''}</div></article>`).join('')||'<p class="empty">Aucun événement pour ces filtres.</p>'}<div class="pagination">${button('← Précédents','previous',number===1?'disabled':'')}<span>${number} / ${p.totalPages}</span>${button('Suivants →','next',number===p.totalPages?'disabled':'')}</div></section>`;
 }
 function providers(item){
  if(!item)return '';
  return `<section class="provider-details">${providerStatus(item)}${Object.entries(item.providers||{}).map(([provider,v])=>`${['error','conflict'].includes(v.status)?button('Réessayer '+providerNames[provider],'retry',`data-provider="${provider}"`):''}${v.status==='conflict'&&!item.deletionPending?['local','remote'].map(strategy=>button(strategy==='local'?'Garder StreamDashboard':'Garder '+providerNames[provider],'conflict',`data-provider="${provider}" data-strategy="${strategy}"`)).join(''):''}${Object.entries(v.projections||{}).filter(([,p])=>p.status==='conflict').map(([key,p])=>`<p>${esc(key)} · ${esc(p.lastError||'Conflit sur cette occurrence')}</p>${['local','remote'].map(strategy=>button(strategy==='local'?'Garder StreamDashboard':'Garder la version distante','conflict',`data-provider="${provider}" data-strategy="${strategy}" data-key="${esc(key)}"`)).join('')}`).join('')}`).join('')}</section>`;
 }
 function open(item,requestedScope,duplicate=false){
  master=item?find(canonicalId(item)):undefined;
  scope=requestedScope||(item?.occurrenceKey?'occurrence':'series');
  draft=structuredClone(scope==='series'&&master?master:item||{});
  revision=master?getData().host.planningRevisions[master.id]:undefined;
  if(duplicate){draft={...draft,title:draft.title+' (copie)',desiredPublication:{local:true,twitch:false,google:false}};if(scope==='occurrence')delete draft.recurrence;delete draft.id;delete draft.seriesId;delete draft.occurrenceKey;master=undefined;scope='series';revision=undefined;}
  const start=draft.startAtUtc||new Date(Date.now()+3600000).toISOString(),end=draft.endAtUtc||new Date(Date.now()+7200000).toISOString();
  modal(`<h2>${master?(scope==='occurrence'?'Modifier cette occurrence':draft.recurrence?'Modifier la série':'Modifier l’événement'):'Créer un événement'}</h2>${master?.recurrence&&scope==='occurrence'?`<p class="small">Les autres dates restent inchangées. ${button('Modifier toute la série','series')}</p>`:''}<form id="planning-event-form">${input('Titre','title',draft.title||'','text','required maxlength="140"')}<div class="form-grid">${input('Début (heure de cet appareil)','start',dateTime(start),'datetime-local','required')}${input('Fin (heure de cet appareil)','end',dateTime(end),'datetime-local','required')}</div>${check('Journée entière','allDay',draft.allDay)}<div class="form-grid" id="planning-day-fields" ${draft.allDay?'':'hidden'}>${input('Premier jour','dayStart',draft.allDay?start.slice(0,10):localDate(start),'date')}${input('Dernier jour inclus','dayEnd',draft.allDay?new Date(Date.parse(end)-86400000).toISOString().slice(0,10):localDate(end),'date')}</div>${select('Type','category',[['live','Live'],['production','Production'],['personal','Personnel']],draft.category||'live')}<label>Description<textarea name="description" maxlength="4000">${esc(draft.description||'')}</textarea></label><fieldset><legend>Jeu & tags</legend>${input('Catégorie Twitch','twitchCategoryName',draft.twitchCategoryName||'')}${button('Rechercher la catégorie','category')}<div id="planning-category-results"></div>${input('ID catégorie Twitch','twitchCategoryId',draft.twitchCategoryId||'')}${input('Tags, séparés par une virgule','tags',(draft.tags?.values||[]).join(', '))}${check('Suggestions automatiques','automatic',draft.tagPreferences?.automatic??getData().host.settings.tagPreferences?.automatic??true)}${input('Langue des tags','language',draft.tagPreferences?.language||getData().host.settings.tagPreferences?.language||'fr')}${button('Suggérer les tags','tags')}</fieldset>${scope==='series'?`<fieldset><legend>Récurrence</legend><div class="form-grid">${select('Répéter','frequency',[['','Jamais'],['daily','Chaque jour'],['weekly','Chaque semaine'],['monthly','Chaque mois']],draft.recurrence?.frequency||'')}${input('Intervalle','interval',draft.recurrence?.interval||1,'number','min="1" max="365"')}</div>${input('Dernière date (facultatif)','until',draft.recurrence?.until?localDate(draft.recurrence.until):'','date')}${input('Fuseau de la série','timeZone',draft.recurrence?.timeZone||Intl.DateTimeFormat().resolvedOptions().timeZone||'Europe/Paris')}<p class="small muted">Les exceptions existantes sont conservées.</p></fieldset>`:''}<fieldset><legend>Publications</legend>${check('Twitch','twitch',draft.desiredPublication?.twitch)}${check('Google Calendar','google',draft.desiredPublication?.google)}<p class="small muted">${getData().host.standalone?'Données sauvegardées sur cet appareil. Pour publier ces événements, transférez-les vers une régie connectée.':'L’enregistrement local est immédiat ; la régie reçoit les modifications à la reconnexion. Chaque destination affiche son propre résultat.'}</p></fieldset>${providers(master)}<div class="form-actions">${master?button(scope==='occurrence'?'Supprimer cette occurrence':master.recurrence?'Supprimer la série':'Supprimer','delete','','danger'):''}${button('Enregistrer comme modèle','save-template')}<button>Enregistrer</button></div></form>`);
 }
 function read(form){
  const v=Object.fromEntries(new FormData(form));
  let start=new Date(v.start),end=new Date(v.end);
  if(v.allDay){start=new Date(v.dayStart+'T00:00:00Z');end=new Date(v.dayEnd+'T00:00:00Z');end.setUTCDate(end.getUTCDate()+1);}
  if(!Number.isFinite(+start)||!Number.isFinite(+end)||end<=start)throw new Error('La fin doit suivre le début.');
  const tagValues=list(v.tags),same=JSON.stringify(tagValues)===JSON.stringify(draft.tags?.values||[]);
  const value={title:v.title.trim(),description:v.description,startAtUtc:start.toISOString(),endAtUtc:end.toISOString(),category:v.category,allDay:!!v.allDay,twitchCategoryId:v.twitchCategoryId,twitchCategoryName:v.twitchCategoryName,tags:same?draft.tags:{...draft.tags,values:tagValues,source:'manual',validated:true},tagPreferences:{...draft.tagPreferences,automatic:!!v.automatic,language:v.language},desiredPublication:{local:true,twitch:!!v.twitch,google:!!v.google}};
  if(scope==='series')value.recurrence=v.frequency?{...draft.recurrence,version:2,frequency:v.frequency,interval:Number(v.interval),timeZone:v.timeZone,until:v.until?(draft.recurrence?.until&&localDate(draft.recurrence.until)===v.until?draft.recurrence.until:new Date(v.until+'T23:59:59').toISOString()):null}:null;
  return value;
 }
 async function submit(form){
  if(!['planning-event-form','planning-export-form','planning-bulk-form'].includes(form.id))return false;
  if(form.dataset.busy)return true;
  form.dataset.busy='true';const submit=form.querySelector('button:not([type])');if(submit)submit.disabled=true;
  try{
   if(form.id==='planning-event-form'){
    const value=read(form);let result;
    if(scope==='occurrence'){
     const patch=Object.fromEntries(Object.entries(value).filter(([k,v])=>JSON.stringify(v)!==JSON.stringify(draft[k]??(k==='description'?'':k==='allDay'?false:undefined))));
     result=await api(`/api/v2/planning/${encodeURIComponent(master.id)}/occurrence`,{expectedRevision:revision,occurrenceKey:draft.occurrenceKey,patch},'PUT');
    }else result=await api('/api/v2/planning'+(master?'/'+encodeURIComponent(master.id):''),{...value,confirmRecurring:!!master?.recurrence||!!value.recurrence,...(master?{expectedRevision:revision}:{})},master?'PUT':'POST');
    await refresh(true);close();
    const saved=find(master?.id||result.createdItemId),failed=Object.values(saved?.providers||{}).some(x=>['error','conflict'].includes(x.status));
    toast(failed?'Enregistré sur la régie ; une publication nécessite votre attention.':'Événement sauvegardé sur cet appareil. Consultez Synchronisation pour son transfert.');
   }else if(form.id==='planning-export-form'){
    const v=Object.fromEntries(new FormData(form));exportPreview=await buildPlanningPng(getData().host.planning,getData().host.settings.streamerName,{period:v.period,noteEnabled:!!v.note,noteText:v.note,filters:{twitch:true,google:true,allDay:true,live:true,personal:false,production:false}});
    const output=document.querySelector('#planning-export-result');output.replaceChildren();const image=document.createElement('img');image.alt='Aperçu du planning à partager';image.src=URL.createObjectURL(exportPreview.blob);image.onload=()=>URL.revokeObjectURL(image.src);output.append(image);
    output.insertAdjacentHTML('beforeend',`<p>${exportPreview.count} live(s).</p>${button('Enregistrer / partager le PNG','share')}${button('Publier dans Discord','discord')}`);
   }else{
    const v=Object.fromEntries(new FormData(form));bulkPreview=await api('/api/v1/planning/bulk-delete/preview',{start:new Date(v.start).toISOString(),end:new Date(v.end).toISOString(),destinations:{twitch:!!v.twitch,google:!!v.google}});
    document.querySelector('#planning-bulk-result').innerHTML=`<h3>${bulkPreview.count} événement(s) à supprimer</h3><p>Destinations : régie${bulkPreview.destinations.twitch?', Twitch':''}${bulkPreview.destinations.google?', Google Calendar':''}.</p><ul>${bulkPreview.items.map(x=>`<li>${esc(x.title)} · ${new Date(x.startAtUtc).toLocaleString('fr-FR')}</li>`).join('')}</ul>${bulkPreview.excluded.map(x=>`<p>Exclu : ${esc(x.title)} · ${esc(x.reason)}</p>`).join('')}${button('Confirmer ces suppressions','bulk-confirm',bulkPreview.count?'':'disabled','danger')}`;
   }
  }finally{delete form.dataset.busy;if(submit)submit.disabled=false;}
  return true;
 }
 async function click(b){
  const task=b.dataset.planning;if(!task)return false;
  const item=visible[Number(b.dataset.index)];
  if(task==='new')open();
  if(task==='edit')open(item);
  if(task==='duplicate')open(item,undefined,true);
  if(task==='prepare')prepare(item);
  if(task==='series')open(master,'series');
  if(task==='previous'||task==='next'){number+=task==='next'?1:-1;render();}
  if(task==='sync'){await api('/api/v1/google/sync',{});await refresh(true);toast('Calendrier synchronisé.');}
  if(task==='category'){
   const f=document.querySelector('#planning-event-form'),query=f.elements.twitchCategoryName.value;
   const result=await api('/api/v1/twitch/categories?q='+encodeURIComponent(query));
   if(!f.isConnected)return true;
   document.querySelector('#planning-category-results').innerHTML=(Array.isArray(result)?result:result.items||[]).slice(0,10).map(x=>button(esc(x.name),'category-select',`data-id="${esc(x.id)}" data-name="${esc(x.name)}"`)).join('');
  }
  if(task==='category-select'){const f=document.querySelector('#planning-event-form');f.elements.twitchCategoryId.value=b.dataset.id;f.elements.twitchCategoryName.value=b.dataset.name;document.querySelector('#planning-category-results').replaceChildren();}
  if(task==='tags'){
   const f=document.querySelector('#planning-event-form'),value=read(f);b.disabled=true;
   try{const result=await api('/api/v1/planning/tags/regenerate',{...value,id:master?.id,seriesId:master?.recurrence?master.id:undefined,occurrenceKey:draft.occurrenceKey,refreshTwitch:true});if(f.isConnected){if(result.tags){draft.tags=result.tags;f.elements.tags.value=result.tags.values.join(', ');}toast(result.warning||'Suggestions chargées. Ajustez les tags avant d’enregistrer.');}}finally{b.disabled=false;}
  }
  if(task==='delete'){
   if(!confirm(scope==='occurrence'?'Supprimer uniquement cette occurrence ?':master.recurrence?'Supprimer toute la série et ses publications ?':'Supprimer cet événement et ses publications ?'))return true;
   await api(`/api/v2/planning/${encodeURIComponent(master.id)}${scope==='occurrence'?'/occurrence':''}`,{expectedRevision:revision,confirmRecurring:true,...(scope==='occurrence'?{occurrenceKey:draft.occurrenceKey}:{})},'DELETE');close();await refresh(true);
  }
  if(task==='retry'||task==='conflict'){
   if(!confirm(task==='retry'?(master.deletionPending?'Reprendre la suppression sur cette destination ?':master.recurrence?'Republier la série sur cette destination ?':'Réessayer cette publication ?'):'Appliquer la version choisie à ce conflit ?'))return true;
   const id=master.id;await api(`/api/v1/planning/${encodeURIComponent(id)}/${task}/${b.dataset.provider}`,task==='retry'?{confirmRecurring:true}:{strategy:b.dataset.strategy,...(b.dataset.key?{occurrenceKey:b.dataset.key}:{})});await refresh(true);close();toast('Résultat mis à jour. Rouvrez l’événement pour vérifier chaque destination.');
  }
  if(task==='export'){
   exportPreview=null;modal(`<h2>Partager le planning des lives</h2><form id="planning-export-form">${select('Période','period',[['today','Aujourd’hui'],['this-week','Cette semaine'],['next-week','Semaine prochaine']],period||'next-week')}${input('Note (facultatif)','note')}<button>Préparer l’aperçu</button></form><div id="planning-export-result"></div>`);
  }
  if(task==='share'&&exportPreview)await sharePlanningPng(exportPreview.blob,exportPreview.fileName);
  if(task==='discord'&&exportPreview){
   const status=await api('/api/v1/discord/status');if(!status.connected||!status.channelId)throw new Error('Connectez Discord et choisissez le salon dans Configuration → Intégrations.');
   if(!confirm(`Publier cet aperçu dans ${status.channelName?'#'+status.channelName:'le salon configuré'} ?`))return true;
   b.disabled=true;try{const bytes=new Uint8Array(await exportPreview.blob.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));const r=await api('/api/v1/discord/planning',{imageBase64:btoa(binary),filename:exportPreview.fileName});toast('Planning publié dans #'+(r.channelName||'Discord'));}finally{b.disabled=false;}
  }
  if(task==='bulk'){bulkPreview=null;modal(`<h2>Supprimer une période</h2><p class="small">Les séries récurrentes sont exclues. Seuls les événements entièrement compris dans cette période sont concernés.</p><form id="planning-bulk-form">${input('Début','start','','datetime-local','required')}${input('Fin','end','','datetime-local','required')}${check('Supprimer aussi sur Twitch','twitch',false)}${check('Supprimer aussi sur Google Calendar','google',false)}<button>Afficher l’aperçu</button></form><div id="planning-bulk-result"></div>`);}
  if(task==='bulk-confirm'&&bulkPreview){if(!confirm('Supprimer uniquement les événements et destinations affichés ?'))return true;b.disabled=true;try{const r=await api('/api/v1/planning/bulk-delete/confirm',{token:bulkPreview.token,confirm:true});bulkPreview=null;document.querySelector('#planning-bulk-result').textContent=`${r.deleted.length} supprimé(s), ${r.failed.length} échec(s). `+r.failed.map(x=>x.title+' : '+x.error).join(' / ');await refresh(true);}finally{b.disabled=false;}}
  if(task==='templates'){const r=await api('/api/v1/companion/snapshot');templates=r.templates||[];modal(`<h2>Modèles d’événements</h2><p class="small">Créez un modèle depuis le formulaire d’un événement.</p>${templates.map((t,i)=>`<div class="template-row"><b>${esc(t.title)}</b>${button('Utiliser','template-use',`data-index="${i}"`)}${button('Supprimer','template-delete',`data-index="${i}"`)}</div>`).join('')||'<p>Aucun modèle.</p>'}`);}
  if(task==='template-use'){const t=structuredClone(templates[Number(b.dataset.index)]);delete t.id;open(t);}
  if(task==='template-delete'){const t=templates[Number(b.dataset.index)];if(confirm('Supprimer ce modèle ?')){await api('/api/v1/companion/templates/'+encodeURIComponent(t.id),{},'DELETE');await click({dataset:{planning:'templates'}});}}
  if(task==='save-template'){const v=read(document.querySelector('#planning-event-form'));await api('/api/v1/companion/templates',{title:v.title,description:v.description,twitchCategoryId:v.twitchCategoryId,twitchCategoryName:v.twitchCategoryName,desiredPublication:v.desiredPublication});toast('Modèle enregistré.');}
  return true;
 }
 function change(target){
  const keys={'planning-temporal':v=>temporal=v,'planning-period':v=>period=v,'planning-category':v=>category=v,'planning-query':v=>query=v};
  if(keys[target.name]){keys[target.name](target.value);number=1;render();return true;}
  if(target.form?.id==='planning-event-form'&&target.name==='allDay'){document.querySelector('#planning-day-fields').hidden=!target.checked;return true;}
  if(target.form?.id==='planning-bulk-form'){bulkPreview=null;document.querySelector('#planning-bulk-result').replaceChildren();return true;}
  if(target.form?.id==='planning-export-form'){exportPreview=null;document.querySelector('#planning-export-result').replaceChildren();return true;}
  return false;
 }
 return {page,open,click,change,submit};
}
