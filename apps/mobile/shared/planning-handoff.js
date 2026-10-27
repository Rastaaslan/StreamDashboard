import {clone,equal,safeJSON} from './autonomy.js';

const fail=message=>{throw new Error(message);};
const secrets=value=>value&&typeof value==='object'&&Object.entries(value).some(([key,item])=>/(?:token|secret|password|credential|authorization)/i.test(key)||secrets(item));
const workspace=value=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,160}$/.test(value);
export const planningOwned=item=>Boolean(item&&item.editable!==false&&!item.transferredTo&&!item.transferId&&item.ownership!=='EXTERNAL');
export function validateHandoffTicket(ticket){
 if(!ticket||!safeJSON(ticket)||secrets(ticket)||new TextEncoder().encode(JSON.stringify(ticket)).byteLength>240000||Object.keys(ticket).some(key=>!['id','from','to','item'].includes(key))||!/^[-\w]{8,100}$/.test(ticket.id)||!workspace(ticket.from)||!workspace(ticket.to)||ticket.from===ticket.to)fail('Identité de transfert invalide.');
 const item=ticket.item;
 if(!planningOwned(item)||!/^[-\w.:]{1,160}$/.test(item.id)||typeof item.title!=='string'||!item.title.trim()||item.title.length>140||!Number.isFinite(Date.parse(item.startAtUtc))||!Number.isFinite(Date.parse(item.endAtUtc))||Date.parse(item.endAtUtc)<=Date.parse(item.startAtUtc))fail('Événement non transférable.');
 if(Object.values(item.providers||{}).some(link=>link.uncertainCreate||Object.values(link.projections||{}).some(entry=>entry.uncertainCreate)))fail('Réconciliez les publications incertaines avant le transfert.');
 return ticket;
}

/** Data-only, durable state transitions. The caller commits both collections in
 * one transaction under the same lock used by the publication engine. No phase
 * expires automatically: an unreachable device cannot prove relinquishment.
 * Receipts travel only through authenticated configuration channels. */
export function transitionPlanningHandoff(state,own,operation,ticket,proof){
 validateHandoffTicket(ticket);
 if(!['prepare','stage','release','activate','abort','restore','status'].includes(operation))fail('Étape de transfert inconnue.');
 const source=['prepare','release','restore'].includes(operation),target=['stage','activate','abort'].includes(operation);
 if((source&&own!==ticket.from)||(target&&own!==ticket.to)||!source&&!target&&![ticket.from,ticket.to].includes(own))fail('Identité de l’espace modifiée.');
 const next=clone(state),previous=next.journal[ticket.id];
 if(previous&&!equal(previous.ticket,ticket))fail('Identifiant de transfert réutilisé.');
 if(operation==='status')return {state:next,receipt:clone(previous||{ticket,status:'absent'})};
 if(!previous&&Object.keys(next.journal).length>=4096)fail('Journal de transfert plein. Les données sont conservées.');
 const item=next.items.find(value=>value.id===ticket.item.id);
 const returning=()=>item?.editable===false&&item.transferredTo===ticket.from&&(!item.transferId||next.journal[item.transferId]?.status==='released');
 const ownedByThisTransfer=()=>item?.transferId===ticket.id&&item.transferredTo===ticket.to;
 const requireProof=status=>{if(!proof||proof.status!==status||!equal(proof.ticket,ticket))fail('Reçu de l’autre appareil manquant ou différent.');};
 const save=status=>{const receipt={ticket:clone(ticket),status};next.journal[ticket.id]=receipt;return {state:next,receipt:clone(receipt)};};
 const duplicate=statuses=>previous&&statuses.includes(previous.status);
 if(operation==='prepare'){
  if(duplicate(['prepared','released','restored']))return {state:next,receipt:clone(previous)};
  if(previous||!planningOwned(item)||!equal(JSON.parse(JSON.stringify(item)),ticket.item))fail('Événement modifié ou déjà confié à un autre appareil.');
  Object.assign(item,{editable:false,transferredTo:ticket.to,transferId:ticket.id});return save('prepared');
 }
 if(operation==='stage'){
  if(duplicate(['staged','active','aborted']))return {state:next,receipt:clone(previous)};
  requireProof('prepared');
  // Returning to an earlier owner is allowed only for a retained, relinquished
  // copy pointing to this source. An independent same-ID event is a conflict.
  if(previous||item&&!returning())fail('Un événement de même identité existe déjà sur la destination.');
  return save('staged');
 }
 if(operation==='release'){
  if(duplicate(['released']))return {state:next,receipt:clone(previous)};
  requireProof('staged');
  if(previous?.status!=='prepared'||!ownedByThisTransfer())fail('Le départ du transfert ne peut pas être confirmé.');
  return save('released');
 }
 if(operation==='activate'){
  if(duplicate(['active']))return {state:next,receipt:clone(previous)};
  requireProof('released');
  if(previous?.status!=='staged')fail('La destination n’a pas réservé ce transfert ou l’a annulé.');
  if(item&&!returning())fail('La destination a changé depuis la préparation.');
  next.items=next.items.filter(value=>value.id!==ticket.item.id);next.items.push(clone(ticket.item));return save('active');
 }
 if(operation==='abort'){
  if(duplicate(['aborted']))return {state:next,receipt:clone(previous)};
  if(previous&&!['staged'].includes(previous.status))fail('La destination a déjà repris cet événement. Effectuez un nouveau transfert en sens inverse.');
  // An absent reservation also needs a tombstone: a delayed stage/activate
  // must never run after the source has restored ownership.
  return save('aborted');
 }
 if(operation==='restore'){
  if(duplicate(['restored']))return {state:next,receipt:clone(previous)};
  requireProof('aborted');
  if(!previous)return save('restored');
  if(!duplicate(['prepared','released'])||!ownedByThisTransfer())fail('La source ne peut pas reprendre cet événement.');
  next.items=next.items.map(value=>value.id===ticket.item.id?clone(ticket.item):value);return save('restored');
 }
}
