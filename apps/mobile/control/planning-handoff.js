import {equal} from '../shared/autonomy.js';
import {validateHandoffTicket} from '../shared/planning-handoff.js';

/** The durable job contains public identities and content only. Requests resolve
 * the current pairing at execution time; credentials never enter its journal. */
export async function runPlanningHandoff(job,call,persist,cancel=false){
 validateHandoffTicket(job.ticket);
 const ask=async(side,operation,proof)=>{
  const value=await call(job[side],{workspace:job.ticket[side==='source'?'from':'to'],operation,ticket:job.ticket,...(proof?{proof}:{})});
  const receipt=value.receipt;
  if(!receipt||!equal(receipt.ticket,job.ticket))throw new Error('Le reçu de transfert ne correspond pas. Vos données sont conservées.');
  job={...job,[side+'Receipt']:receipt};await persist(job);return receipt;
 };
 if(cancel){
  const aborted=await ask('target','abort');
  if(aborted.status!=='aborted')throw new Error('La destination ne confirme pas l’annulation.');
  const restored=await ask('source','restore',aborted);
  if(restored.status!=='restored')throw new Error('La reprise par la source reste à confirmer.');
  job={...job,status:'cancelled'};await persist(job);return job;
 }
 const prepared=await ask('source','prepare');
 if(prepared.status==='restored')throw new Error('Ce transfert a été annulé. Créez un nouveau transfert.');
 if(!['prepared','released'].includes(prepared.status))throw new Error('Préparation de la source non confirmée.');
 // A lost release response is resumed only if the target retained its stage.
 const staged=await ask('target','stage',prepared);
 if(!['staged','active'].includes(staged.status))throw new Error('Transfert annulé sur la destination. Annulez ici pour restaurer la source.');
 const released=await ask('source','release',staged);
 if(released.status!=='released')throw new Error('Le départ de la source n’est pas confirmé.');
 const active=await ask('target','activate',released);
 if(active.status!=='active')throw new Error('La destination n’a pas confirmé sa responsabilité.');
 job={...job,status:'completed'};await persist(job);return job;
}
