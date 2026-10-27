import {randomUuid} from '../shared/uuid.js';
import {runSoundLibraryCopy} from './sound-library-copy.js';

export function createSoundLibraryUI({devices,snapshot,read,upload,store,modal,esc,changed}) {
 let choices=[],pending,busy=false;
 const owner=async()=>{const value=await store();await value.reload();return value;};
 async function open(){
  if(busy)throw new Error('Une copie est en cours.');choices=await devices();pending=undefined;
  const saved=await owner(),jobs=Object.values(saved.record.drafts.soundLibraryJobs||{}).reverse();
  modal(`<h2>Copier une bibliothèque audio</h2><p>Les fichiers et leurs réglages seront copiés. Les originaux restent disponibles. Les raccourcis et les responsabilités se configurent séparément.</p><form id="sound-library-preview"><label>Source<select name="source">${choices.map(d=>`<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('')}</select></label><label>Destination<select name="target">${choices.map((d,i)=>`<option value="${esc(d.id)}" ${i===1?'selected':''}>${esc(d.name)}</option>`).join('')}</select></label><button ${choices.length<2?'disabled':''}>Prévisualiser la copie</button></form><h3>Copies conservées</h3>${jobs.map(job=>`<section><b>${esc(job.source.name)} → ${esc(job.target.name)}</b><p>${job.items.filter(item=>item.complete).length} / ${job.items.length} fichiers confirmés · ${job.status==='completed'?'Terminé':job.status==='abandoned'?'Interrompu, copies conservées':'À poursuivre'}</p>${job.error?`<p role="status">${esc(job.error)}</p>`:''}${!['completed','abandoned'].includes(job.status)?`<button data-task="sound-library-resume" data-job="${esc(job.id)}">Reprendre</button><button class="secondary" data-task="sound-library-abandon" data-job="${esc(job.id)}">Arrêter cette copie</button>`:''}</section>`).join('')||'<p>Aucune copie.</p>'}`);
 }
 async function submit(form){
  if(form.id!=='sound-library-preview')return false;if(busy)throw new Error('Une copie est en cours.');
  const values=Object.fromEntries(new FormData(form)),source=choices.find(d=>d.id===values.source),target=choices.find(d=>d.id===values.target);
  if(!source||!target||source.id===target.id)throw new Error('Choisissez deux espaces différents.');
  const [a,b]=await Promise.all([snapshot(source),snapshot(target)]);if(a.workspace===b.workspace)throw new Error('Ces entrées désignent le même espace.');
  const {items}=await read(source,{operation:'list',workspace:a.workspace});
  pending={id:randomUuid(),source,target,sourceWorkspace:a.workspace,targetWorkspace:b.workspace,items,status:'pending'};
  modal(`<h2>Confirmer la copie audio</h2><p>${esc(source.name)} → ${esc(target.name)}</p><p>${items.length} fichier(s). Les catégories, favoris, volumes et modes de lecture seront conservés. Les nouveaux sons utiliseront la sortie système de la destination, que vous pourrez ensuite modifier.</p><p>Un son de même identité et de contenu différent arrêtera la copie sans remplacement. En cas de coupure, les fichiers déjà confirmés resteront disponibles et vous pourrez reprendre ici.</p><ul>${items.map(item=>`<li>${esc(item.name)} · ${esc(item.category)}</li>`).join('')}</ul><button data-task="sound-library-apply" ${items.length?'':'disabled'}>Copier la bibliothèque</button><button class="secondary" data-task="sound-library">Annuler</button>`);return true;
 }
 async function run(initial){
  if(busy)throw new Error('Une copie est en cours.');busy=true;let job=initial;
  try {
   const saved=await owner(),save=async next=>{await saved.updateDraft('soundLibraryJobs',jobs=>{
    if(!jobs?.[next.id]&&Object.keys(jobs||{}).length>=100)throw new Error('Cent copies sont conservées. Exportez vos données avant de poursuivre.');return {...jobs,[next.id]:structuredClone(next)};
   });job=next;};
   await save({...job,status:'pending',error:undefined});modal('<h2>Copie audio en cours</h2><p>Gardez cette fenêtre ouverte. Si elle se ferme, reprenez la copie depuis Appareils et comptes.</p>');
   try{await runSoundLibraryCopy(job,{read,upload,save});await changed();}
   catch(error){await save({...job,status:'error',error:error.message});throw error;}
  }finally{busy=false;await open();}
 }
 async function task(name,button){
  if(name==='sound-library'){await open();return true;}
  if(name==='sound-library-apply'){if(!pending)throw new Error('Prévisualisez la copie.');const job=pending;pending=undefined;await run(job);return true;}
  if(['sound-library-resume','sound-library-abandon'].includes(name)){
   if(busy)throw new Error('Une copie est en cours.');const saved=await owner(),job=saved.record.drafts.soundLibraryJobs?.[button?.dataset.job];if(!job)throw new Error('Copie introuvable.');
   if(name.endsWith('resume'))await run(job);else{await saved.updateDraft('soundLibraryJobs',jobs=>({...jobs,[job.id]:{...job,status:'abandoned'}}));await open();}return true;
  }return false;
 }
 return {task,submit};
}
