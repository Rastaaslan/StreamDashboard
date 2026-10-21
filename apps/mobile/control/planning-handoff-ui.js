import {planningOwned} from '../shared/planning-handoff.js';
import {randomUuid} from '../shared/planning-engine.js';
import {runPlanningHandoff} from './planning-handoff.js';

export function createPlanningHandoffUI({devices,snapshot,call,store,modal,esc,changed}){
 let choices=[],loaded,pending,busy=false;
 const labels={completed:'Terminé',cancelled:'Annulé, responsabilité restaurée',pending:'À poursuivre',error:'À vérifier'};
 async function open(){
  choices=await devices();loaded=undefined;pending=undefined;
  const owner=await store();await owner.reload();const jobs=Object.values(owner.record.drafts.planningHandoffJobs||{}).reverse();
  modal(`<h2>Déplacer le planning</h2><p>Choisissez l’appareil qui reprendra un événement et ses publications existantes. Les comptes restent propres à chaque appareil.</p><form id="planning-handoff-source"><label>Source<select name="source">${choices.map(d=>`<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('')}</select></label><button>Lire les événements</button></form><h3>Transferts conservés</h3>${jobs.map(job=>`<section><b>${esc(job.ticket.item.title)}</b><p>${esc(job.source.name)} → ${esc(job.target.name)} · ${esc(labels[job.status]||'À poursuivre')}</p>${job.error?`<p role="status">${esc(job.error)}</p>`:''}${!['completed','cancelled'].includes(job.status)?`<button data-task="planning-handoff-resume" data-job="${esc(job.ticket.id)}">Reprendre</button><button class="secondary" data-task="planning-handoff-cancel" data-job="${esc(job.ticket.id)}">Annuler et restaurer la source</button>`:''}</section>`).join('')||'<p>Aucun transfert.</p>'}`);
 }
 async function submit(form){
  if(!['planning-handoff-source','planning-handoff-preview'].includes(form.id))return false;
  if(busy)throw new Error('Un transfert est en cours.');
  const value=Object.fromEntries(new FormData(form));
  if(form.id==='planning-handoff-source'){
   const source=choices.find(d=>d.id===value.source);if(!source)throw new Error('Appareil introuvable.');
   const response=await snapshot(source);loaded={source,response};const items=response.bundle.data.host.planning.filter(planningOwned);
   modal(`<h2>Choisir l’événement et sa destination</h2><p>Source : ${esc(source.name)}</p><form id="planning-handoff-preview"><label>Événement<select name="event">${items.map(item=>`<option value="${esc(item.id)}">${esc(item.title)}</option>`).join('')}</select></label><label>Destination<select name="target">${choices.filter(d=>d.id!==source.id).map(d=>`<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('')}</select></label><button ${items.length&&choices.length>1?'':'disabled'}>Prévisualiser le transfert</button></form><button class="secondary" data-task="planning-handoff">Revenir aux transferts</button>`);return true;
  }
  if(!loaded)throw new Error('Relisez les événements.');
  const item=loaded.response.bundle.data.host.planning.find(item=>item.id===value.event&&planningOwned(item)),target=choices.find(d=>d.id===value.target);
  if(!item||!target||target.id===loaded.source.id)throw new Error('Événement et destination différents requis.');
  const destination=await snapshot(target);if(destination.workspace===loaded.response.workspace)throw new Error('Ces deux entrées désignent le même espace.');
  pending={ticket:{id:randomUuid(),from:loaded.response.workspace,to:destination.workspace,item:JSON.parse(JSON.stringify(item))},source:loaded.source,target,status:'pending'};
  modal(`<h2>Confirmer le déplacement</h2><p><b>${esc(item.title)}</b></p><p>${esc(pending.source.name)} → ${esc(target.name)}</p><p>La copie source restera consultable. L’événement sera modifiable sur la destination après confirmation des deux appareils. Ses identifiants Twitch et Google seront conservés. Connectez les comptes correspondants sur la destination avant de publier une modification.</p><p>En cas de coupure, retrouvez ce transfert ici pour le poursuivre ou restaurer la source. Après validation, le retour s’effectue avec un nouveau transfert en sens inverse.</p><button data-task="planning-handoff-apply">Déplacer cet événement</button><button class="secondary" data-task="planning-handoff">Annuler</button>`);return true;
 }
 async function run(job,cancel){
  if(busy)throw new Error('Un transfert est déjà en cours.');busy=true;
  const owner=await store(),save=async next=>{job=next;await owner.updateDraft('planningHandoffJobs',jobs=>{
   if(!jobs?.[next.ticket.id]&&Object.keys(jobs||{}).length>=100)throw new Error('Cent transferts sont conservés. Exportez vos données avant de poursuivre.');
   return {...jobs,[next.ticket.id]:structuredClone(next)};
  });};
  try{await save({...job,error:undefined});await runPlanningHandoff(job,call,save,cancel);await changed();}
  catch(error){await save({...job,status:'error',error:error.message});throw error;}
  finally{busy=false;await open();}
 }
 async function task(name,button){
  if(name==='planning-handoff'){await open();return true;}
  if(name==='planning-handoff-apply'){if(!pending)throw new Error('Prévisualisez le transfert.');const job=pending;pending=undefined;await run(job,false);return true;}
  if(['planning-handoff-resume','planning-handoff-cancel'].includes(name)){
   const owner=await store();await owner.reload();const job=owner.record.drafts.planningHandoffJobs?.[button?.dataset.job];if(!job)throw new Error('Transfert introuvable.');
   await run(job,name.endsWith('cancel'));return true;
  }return false;
 }
 return {task,submit};
}
