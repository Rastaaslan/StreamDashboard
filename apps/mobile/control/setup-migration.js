import {clone,equal,resources} from '../shared/autonomy.js';
import {planConfigurationCopy,runConfigurationCopy,portableConfiguration} from '../shared/configuration-transfer.js';
import {planningOwned,validateHandoffTicket} from '../shared/planning-handoff.js';
import {planInstallationChange,deviceRoleAvailable} from '../shared/installation.js';
import {actionCapability,actionDefinition} from '../shared/action-definition.js';
import {runPlanningHandoff} from './planning-handoff.js';
import {runSoundLibraryCopy} from './sound-library-copy.js';
import {portableSound,soundIdentity} from '../shared/sound-library.js';

const fail=message=>{throw new Error(message);};
const permitted=(descriptor,capability)=>descriptor?.device?.enabled!==false&&descriptor?.device?.capabilities?.includes(capability)&&deviceRoleAvailable(descriptor.device,capability)&&(!descriptor.observed?.permissions||descriptor.observed.permissions.includes(capability));
const routingFields=value=>({preset:value.preset,routes:clone(value.routes),actionRoutes:clone(value.actionRoutes||[])});

/** One controller owns this journal. Other controllers retain their own choices.
 * The commit moves destinations only after their contents have been confirmed.
 * No physical agent, account, source content or audio file is deleted. */
export function planSetupMigration({id,source,target,from,to,installation,descriptor,sounds=[],planningIds=[],configuration=true,routeActions=true,preset=installation.preset}){
 if(!/^[-\w]{8,40}$/.test(id)||from.workspace===to.workspace)fail('Deux espaces distincts et une identité de changement sont requis.');
 if(descriptor?.device?.id!==target.deviceId)fail('Identité de destination différente.');
 const copy=planConfigurationCopy(from,to),prefix={source:clone(source),target:clone(target),sourceWorkspace:from.workspace,targetWorkspace:to.workspace};
 const configurationJob={...prefix,id:id+'_config',...copy,items:configuration?copy.items:[],status:'pending'};
 const planning=planningIds.map((eventId,index)=>{
  const item=from.bundle.data.host.planning.find(value=>value.id===eventId&&planningOwned(value));
  const ticket={id:id+'_plan_'+index,from:from.workspace,to:to.workspace,item:clone(item)};validateHandoffTicket(ticket);
  if(!permitted(descriptor,'planning'))fail('Activez le rôle Services et planning et sa permission sur la destination.');
  const existing=to.bundle.data.host.planning.find(value=>value.id===eventId);
  if(existing&&!(existing.editable===false&&existing.transferredTo===from.workspace))fail('Un événement de même identité existe déjà sur la destination : '+item.title+'.');
  return {ticket,source:clone(source),target:clone(target),status:'pending'};
 });
 if(new Set(planningIds).size!==planningIds.length||planning.length>1000||sounds.length>1000)fail('Sélection du changement invalide ou trop volumineuse.');
 if(sounds.length&&!permitted(descriptor,'audio'))fail('Activez le rôle Audio et sa permission sur la destination.');
 const actions=configuration?from.bundle.data.configuration.actions:to.bundle.data.configuration.actions;
 const available=new Map(actions.map(action=>[action.id,action])),changes=routingFields(installation),retained=[];
 // An autonomous Windows store and its agent are separate spaces on one device.
 // A local autonomous store has no remote action address: it is opened locally.
 const canRoute=routeActions&&!target.local&&source.deviceId!==target.deviceId;
 if(canRoute){
  const known=installation.devices.find(value=>value.id===target.deviceId&&value.enabled);
  if(!known)fail('Associez et activez la destination dans cette installation.');
  for(const capability of ['obs','clips'])if(changes.routes[capability]===source.deviceId){
   if(permitted(descriptor,capability)&&known.capabilities.includes(capability))changes.routes[capability]=target.deviceId;
   else retained.push('Destination '+capability+' conservée sur la source');
  }
  const candidates=[...(installation.actionRoutes||[])];
  if(source.scope)for(const action of from.bundle.data.configuration.actions)if(!candidates.some(value=>value.workspace===source.scope&&value.actionId===action.id))candidates.push({workspace:source.scope,actionId:action.id,deviceId:source.deviceId,definition:action});
  changes.actionRoutes=[];
  for(const route of candidates){
   if(route.deviceId!==source.deviceId){changes.actionRoutes.push(clone(route));continue;}
   const definition=available.get(route.definition.id),capability=definition&&actionCapability(definition.type);
   const compatible=definition&&actionDefinition(definition)===actionDefinition(route.definition)&&permitted(descriptor,capability)&&known.capabilities.includes(capability);
   if(compatible)changes.actionRoutes.push({...clone(route),deviceId:target.deviceId,definition:clone(definition)});
   else {retained.push(route.definition.label||route.actionId);const old=(installation.actionRoutes||[]).find(value=>value.workspace===route.workspace&&value.actionId===route.actionId);if(old)changes.actionRoutes.push(clone(old));}
  }
 }
 changes.preset=preset;
 const routeChange=!equal(changes,routingFields(installation));
 const next=routeChange?planInstallationChange(installation,changes,installation.revision).next:clone(installation);
 const audio=sounds.map(item=>{if(!soundIdentity(item.id))fail('Identité audio invalide.');return {id:item.id,...portableSound(item)};});
 if(new Set(audio.map(item=>item.id)).size!==audio.length)fail('Identité audio dupliquée.');
 const job={version:1,id,...prefix,status:'pending',configuration:configurationJob,audio:{...prefix,id:id+'_audio',items:audio,status:'pending'},planning,retained,routing:{before:clone(installation),after:next,changes,changed:routeChange}};
 if(JSON.stringify(job).length>8*1024*1024)fail('Changement trop volumineux. Transférez les contenus en plusieurs opérations.');
 return job;
}

/** Durable compensation: recover unknown receipts before deciding to undo.
 * Active planning moves back with its current journal, never with the stale
 * original. Audio is additive and intentionally retained on both devices. */
export async function runSetupMigration(initial,adapter,rollback=false){
 const job=clone(initial),save=()=>adapter.save(clone(job));
 if(job.version!==1||!/^[-\w]{8,40}$/.test(job.id))fail('Changement d’installation invalide.');
 if(job.status==='rolled-back'||job.status==='completed'&&!rollback)return job;
 if(job.rollingBack&&!rollback)fail('Terminez le retour arrière avant un nouveau changement.');
 const child=(field,index)=>async value=>{if(index===undefined)job[field]=clone(value);else job[field][index]=clone(value);await save();};
 const configurationAdapter={snapshot:adapter.snapshot,apply:adapter.apply,save:child('configuration')};
 const routing=async undo=>{
  const phase=job.routing;if(!phase.changed||undo&&!phase.attempted||undo&&phase.undone||!undo&&phase.complete)return;
  let current=await adapter.installation();
  const before=undo?phase.after:phase.before;
  const changes=undo?routingFields(phase.before):phase.changes;
  const after=undo?planInstallationChange(before,changes,before.revision).next:phase.after;
  if(equal(current,after)){if(undo)phase.undone=true;else phase.complete=true;await save();return;}
  if(undo&&equal(current,phase.before)){phase.undone=true;await save();return;}
  if(!equal(current,before))fail('Installation modifiée depuis la prévisualisation. Les destinations actuelles sont conservées.');
  phase.attempted=true;await save();
  const result=await adapter.changeInstallation(changes,before.revision);
  if(!equal(result.next,after))fail('Changement des destinations non confirmé. Reprenez pour vérifier son résultat.');
  if(undo)phase.undone=true;else phase.complete=true;await save();
 };
 if(rollback){
  job.rollingBack=true;job.status='rolling-back';await save();await routing(true);
  for(let index=job.planning.length-1;index>=0;index--){
   const item=job.planning[index];if(item.undone||!item.attempted)continue;
   if(item.reverse){await runPlanningHandoff(item.reverse,adapter.handoff,async value=>{item.reverse=value;await save();});}
   else {
    const status=await adapter.handoff(job.target,{workspace:job.targetWorkspace,operation:'status',ticket:item.ticket});
    if(!equal(status.receipt?.ticket,item.ticket))fail('Reçu de planning différent.');
    if(status.receipt.status==='active'){
     const snapshot=await adapter.snapshot(job.target);if(snapshot.workspace!==job.targetWorkspace)fail('Identité de destination différente.');
     const current=snapshot.bundle.data.host.planning.find(value=>value.id===item.ticket.item.id&&planningOwned(value));
     if(!current)fail('Le planning a été déplacé ou retiré depuis le changement. Restauration manuelle nécessaire.');
     item.reverse={source:clone(job.target),target:clone(job.source),ticket:{id:item.ticket.id+'_back',from:job.targetWorkspace,to:job.sourceWorkspace,item:clone(current)},status:'pending'};
     validateHandoffTicket(item.reverse.ticket);await save();
     await runPlanningHandoff(item.reverse,adapter.handoff,async value=>{item.reverse=value;await save();});
    }else if(['absent','staged','aborted'].includes(status.receipt.status))await runPlanningHandoff(item,adapter.handoff,async value=>{Object.assign(item,value);await save();},true);
    else fail('Responsabilité du planning incertaine. Reprenez après reconnexion.');
   }
   item.undone=true;await save();
  }
  await runConfigurationCopy(job.configuration,configurationAdapter,true);
  job.status='rolled-back';delete job.error;await save();return job;
 }
 if(!job.started){
  if(!equal(await adapter.installation(),job.routing.before))fail('Installation modifiée depuis la prévisualisation.');
  const [from,to]=await Promise.all([adapter.snapshot(job.source),adapter.snapshot(job.target)]);
  if(from.workspace!==job.sourceWorkspace||to.workspace!==job.targetWorkspace)fail('Identité d’espace différente.');
  const fromResources=resources(from.bundle),toResources=resources(to.bundle);
  for(const item of job.configuration.items)if(!equal(toResources[item.key]??null,item.base)||!equal(portableConfiguration(item.key,fromResources[item.key]),item.source))fail('Configuration de destination modifiée depuis la prévisualisation.');
  for(const item of job.planning)if(!equal(from.bundle.data.host.planning.find(value=>value.id===item.ticket.item.id),item.ticket.item))fail('Planning modifié depuis la prévisualisation.');
  await adapter.preflight(job);job.started=true;await save();
 }
 job.status='running';delete job.error;await save();
 // Sound IDs must exist before their buttons become available on the target.
 await runSoundLibraryCopy(job.audio,{read:adapter.read,upload:adapter.upload,save:child('audio')});
 await runConfigurationCopy(job.configuration,configurationAdapter);
 for(let index=0;index<job.planning.length;index++){
  if(job.planning[index].status==='completed')continue;
  job.planning[index].attempted=true;await save();
  await runPlanningHandoff(job.planning[index],adapter.handoff,child('planning',index));
 }
 if(!job.routing.complete){
  await adapter.preflight(job);
  const target=await adapter.snapshot(job.target);if(target.workspace!==job.targetWorkspace)fail('Identité de destination différente.');
  for(const route of job.routing.changes.actionRoutes||[])if(route.deviceId===job.target.deviceId){
   const definition=target.bundle.data.configuration.actions.find(value=>value.id===route.definition.id);
   if(actionDefinition(definition)!==actionDefinition(route.definition))fail('Un bouton a changé sur la destination. Basculement suspendu.');
  }
  await routing(false);
 }
 job.status='completed';delete job.error;await save();return job;
}
