import {clone,equal,resources,pick,safeJSON} from './autonomy.js';

const common=['actionSet','action','template','profile','preferences','settings'];
export function configurationTransferSupport(platform){return {version:1,strict:true,kinds:platform==='windows'?[...common,'output','youtube','automation','discord','google']:common};}
const settings=['streamerName','accent','confirmStop','modeScenes','chattingScene','startMode','timerBrowserSource','primaryMicInput','requireTimerOverlayOnStart','streamerPingRewardIds','tagPreferences'];
const privateData=value=>value&&typeof value==='object'&&Object.entries(value).some(([key,item])=>/(?:token|secret|password|credential|authorization|cookie)/i.test(key)||privateData(item));
const fail=message=>{throw new Error(message);};
export function portableConfiguration(key,value){
 const kind=key.split('/')[0];
 if(![...common,'output','youtube','automation','discord','google'].includes(kind))return undefined;
 if(!safeJSON(value)||privateData(value))fail('Configuration contenant des données privées ou invalides.');
 if(kind==='settings')return pick(value,settings);
 // Copying an automation cannot itself arm another event consumer.
 return kind==='automation'?{...clone(value),enabled:false}:clone(value);
}
/** Destination-specific fields stay there. Only reviewed resource identities
 * are changed; absent source entries never delete destination data. */
export function planConfigurationCopy(source,target){
 if(!source?.workspace||!target?.workspace||source.workspace===target.workspace)fail('Deux espaces distincts sont requis.');
 const support=target.configurationTransfer;
 if(support?.version!==1||support.strict!==true||!Array.isArray(support.kinds))fail('Mettez à jour la destination avant de copier les configurations.');
 const before=resources(target.bundle),items=[],skipped=[];
 for(const [key,original] of Object.entries(resources(source.bundle))){
  if(key.startsWith('action/'))continue;
  const portable=portableConfiguration(key,original);if(portable===undefined)continue;
  if(!support.kinds.includes(key.split('/')[0])){skipped.push(key);continue;}
  const base=before[key]??null,value=key==='settings/root'?{...base,...portable}:key==='actionSet/root'?{items:[...portable.items,...(base?.items||[]).filter(item=>!portable.items.some(source=>source.id===item.id))]}:portable;
  if(equal(base,value))continue;
  items.push({key,base:clone(base),value,source:portable,label:key==='actionSet/root'?'Boutons et macros ('+value.items.length+')':original.label||original.name||original.title||key});
 }
 if(items.length>1000||JSON.stringify(items).length>4*1024*1024||items.some(item=>JSON.stringify(item).length>240000))fail('Configuration trop volumineuse. Réduisez la sélection sur la source.');
 return {sourceWorkspace:source.workspace,targetWorkspace:target.workspace,items,skipped};
}

/** A durable, reversible saga over strict per-resource commits. It does not
 * promise cross-device atomicity. Unknown writes are queried, never replayed
 * during cancellation. Rollback compares the exact acknowledged post-image. */
export async function runConfigurationCopy(initial,{snapshot,apply,save},rollback=false){
 const job=clone(initial),persist=()=>save(clone(job));
 if(!/^[-\w]{8,60}$/.test(job.id)||!Array.isArray(job.items)||job.items.length>1000)fail('Transfert de configuration invalide.');
 if(job.status==='rolled-back')return job;
 if(job.rollingBack&&!rollback)fail('Le retour arrière doit être terminé avant une nouvelle copie.');
 const target=await snapshot(job.target);
 if(target.workspace!==job.targetWorkspace||target.configurationTransfer?.strict!==true||target.configurationTransfer?.version!==1)fail('Identité ou version de destination différente.');
 const edit=(item,index,undo=false)=>({id:job.id+(undo?'_undo_':'_copy_')+index,key:item.key,base:undo?item.after:item.base,value:undo?item.base:item.value,strict:true});
 const write=async(item,index,undo=false,statusOnly=false)=>{
  const response=await apply(job.target,{workspace:job.targetWorkspace,edit:edit(item,index,undo),...(statusOnly?{statusOnly:true}:{})});
  if(response.workspace!==job.targetWorkspace)fail('Réponse d’un autre espace.');
  return response.receipt;
 };
 if(rollback){
  job.rollingBack=true;job.status='rolling-back';await persist();
  for(let index=job.items.length-1;index>=0;index--){
   const item=job.items[index];if(item.undone||!item.attempted)continue;
   if(!item.complete){
    const receipt=await write(item,index,false,true);
    if(['absent','conflict','rejected'].includes(receipt?.status)){item.undone=true;await persist();continue;}
    if(receipt?.status!=='applied')fail('Résultat de copie incertain : vérifiez '+item.label+'.');
    item.complete=true;item.after=clone(receipt.current);await persist();
   }
   const receipt=await write(item,index,true);
   if(receipt?.status!=='applied')fail('Retour arrière interrompu pour '+item.label+' : '+(receipt?.message||'configuration modifiée depuis la copie.'));
   item.undone=true;await persist();
  }
  job.status='rolled-back';delete job.error;await persist();return job;
 }
 if(job.status==='completed')return job;
 // A first attempt checks the entire reviewed snapshot before any write.
 if(!job.items.some(item=>item.attempted)){
  const source=await snapshot(job.source);
  if(source.workspace!==job.sourceWorkspace)fail('Identité de source différente.');
  const from=resources(source.bundle),to=resources(target.bundle);
  for(const item of job.items){
   if(!equal(portableConfiguration(item.key,from[item.key]),item.source)||!equal(to[item.key]??null,item.base))fail('Prévisualisation périmée : '+item.label+'. Recréez la copie.');
  }
 }
 job.status='pending';await persist();
 for(let index=0;index<job.items.length;index++){
  const item=job.items[index];if(item.complete)continue;
  item.attempted=true;await persist();
  const receipt=await write(item,index);
  if(receipt?.status!=='applied')fail('Copie interrompue pour '+item.label+' : '+(receipt?.message||'résultat non confirmé.'));
  item.complete=true;item.after=clone(receipt.current);await persist();
 }
 job.status='completed';delete job.error;await persist();return job;
}
