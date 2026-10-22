import {randomUuid} from '../shared/uuid.js';
import {planConfigurationCopy,runConfigurationCopy} from '../shared/configuration-transfer.js';

export function createConfigurationTransferUI({devices,snapshot,apply,store,modal,esc,changed}){
 let choices=[],preview,busy=false;
 const owner=async()=>{const value=await store();await value.reload();return value;};
 async function open(){
  if(busy)throw new Error('Une copie de configuration est en cours.');
  choices=await devices();preview=undefined;
  const saved=await owner(),jobs=Object.values(saved.record.drafts.configurationCopies||{}).reverse();
  modal(`<h2>Copier les configurations et macros</h2><p>Prévisualisez les différences entre deux espaces. Les identités des boutons, raccourcis et modèles sont conservées. Les comptes et sessions restent propres à chaque appareil.</p><form id="configuration-copy-preview"><label>Source<select name="source">${choices.map(d=>`<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('')}</select></label><label>Destination<select name="target">${choices.map((d,i)=>`<option value="${esc(d.id)}" ${i===1?'selected':''}>${esc(d.name)}</option>`).join('')}</select></label><button ${choices.length<2?'disabled':''}>Comparer les configurations</button></form><h3>Copies conservées</h3>${jobs.map(job=>`<section><b>${esc(job.source.name)} → ${esc(job.target.name)}</b><p>${job.items.filter(item=>item.complete&&!item.undone).length} / ${job.items.length} réglages copiés · ${job.status==='completed'?'Terminé':job.status==='rolled-back'?'Ancienne configuration restaurée':job.rollingBack?'Retour arrière à poursuivre':'À poursuivre'}</p>${job.error?`<p role="status">${esc(job.error)}</p>`:''}${job.status!=='rolled-back'?`${!job.rollingBack&&job.status!=='completed'?`<button data-task="configuration-copy-resume" data-job="${esc(job.id)}">Reprendre la copie</button>`:''}<button class="secondary" data-task="configuration-copy-rollback-preview" data-job="${esc(job.id)}">${job.rollingBack?'Poursuivre le retour arrière':'Revenir à la configuration précédente'}</button>`:''}</section>`).join('')||'<p>Aucune copie.</p>'}`);
 }
 async function submit(form){
  if(!['configuration-copy-preview','configuration-copy-selection'].includes(form.id))return false;
  if(busy)throw new Error('Une copie est en cours.');
  if(form.id==='configuration-copy-selection'){
   if(!preview)throw new Error('Comparez à nouveau les configurations.');
   const selected=new Set(new FormData(form).getAll('item'));const job={...preview,items:preview.items.filter((_,i)=>selected.has(String(i)))};
   if(!job.items.length)throw new Error('Sélectionnez au moins un réglage.');preview=undefined;await run(job);return true;
  }
  const values=Object.fromEntries(new FormData(form)),source=choices.find(d=>d.id===values.source),target=choices.find(d=>d.id===values.target);
  if(!source||!target||source.id===target.id)throw new Error('Choisissez deux espaces différents.');
  const [a,b]=await Promise.all([snapshot(source),snapshot(target)]);
  preview={id:randomUuid(),source,target,...planConfigurationCopy(a,b),status:'pending'};
  modal(`<h2>Choisir les configurations à copier</h2><p>${esc(source.name)} → ${esc(target.name)}</p><p>Les réglages cochés remplaceront leur version de destination. Les éléments supplémentaires de la destination seront conservés. Les automatismes copiés seront désactivés ; vérifiez leurs actions avant de les réactiver.</p><p>Les raccourcis seront utilisables sur le contrôleur concerné après actualisation. Le planning, les fichiers audio et les responsabilités disposent de leurs propres commandes dans Appareils et comptes.</p><form id="configuration-copy-selection">${preview.items.map((item,i)=>`<section><label><input type="checkbox" name="item" value="${i}" checked> ${esc(item.label)} · ${item.base===null?'Ajouter':'Remplacer'}</label><details><summary>Comparer les valeurs</summary><pre>Avant : ${esc(JSON.stringify(item.base,null,2))}</pre><pre>Après : ${esc(JSON.stringify(item.value,null,2))}</pre></details></section>`).join('')||'<p>Les configurations compatibles sont identiques.</p>'}<button ${preview.items.length?'':'disabled'}>Copier les réglages sélectionnés</button></form>${preview.skipped.length?`<p>Conservés uniquement sur la source, car cette destination ne les prend pas en charge : ${preview.skipped.map(esc).join(', ')}.</p>`:''}<p>En cas de coupure, reprenez ici ou restaurez les valeurs précédentes. Une modification ultérieure sur la destination bloque sa restauration automatique.</p><button class="secondary" data-task="configuration-copy">Annuler</button>`);return true;
 }
 async function run(initial,rollback=false){
  if(busy)throw new Error('Une copie est en cours.');busy=true;let job=initial;
  try{
   const saved=await owner(),save=async next=>{await saved.updateDraft('configurationCopies',jobs=>{
    if(!jobs?.[next.id]&&Object.keys(jobs||{}).length>=100)throw new Error('Cent copies sont conservées. Exportez vos données avant de poursuivre.');
    return {...jobs,[next.id]:structuredClone(next)};
   });job=next;};
   const execute=async()=>{
    await saved.reload();job=saved.record.drafts.configurationCopies?.[job.id]||job;
    await save({...job,error:undefined});modal('<h2>Configuration en cours</h2><p>Les confirmations sont conservées au fur et à mesure. Gardez cette fenêtre ouverte.</p>');
    try{await runConfigurationCopy(job,{snapshot,apply,save},rollback);await changed();}
    catch(error){await save({...job,status:'error',error:error.message});throw error;}
   };
   if(globalThis.navigator?.locks)await navigator.locks.request('sd-configuration-copy-'+job.id,execute);else await execute();
  }finally{busy=false;await open();}
 }
 async function task(name,button){
  if(name==='configuration-copy'){await open();return true;}
  if(!['configuration-copy-resume','configuration-copy-rollback-preview','configuration-copy-rollback'].includes(name))return false;
  if(busy)throw new Error('Une copie est en cours.');const saved=await owner(),job=saved.record.drafts.configurationCopies?.[button?.dataset.job];if(!job)throw new Error('Copie introuvable.');
  if(name.endsWith('rollback-preview'))modal(`<h2>Restaurer les réglages précédents</h2><p>${esc(job.target.name)} : les réglages copiés seront remis dans leur état d’origine. Les nouveaux boutons et modèles ajoutés par cette copie seront retirés. Toute modification intervenue depuis sera conservée et bloquera le retour arrière de l’élément concerné.</p><button data-task="configuration-copy-rollback" data-job="${esc(job.id)}">Confirmer le retour arrière</button><button class="secondary" data-task="configuration-copy">Annuler</button>`);
  else await run(job,name.endsWith('rollback'));
  return true;
 }
 return {task,submit};
}
