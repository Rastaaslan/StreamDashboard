import {fields,resources,merge,equal,safeJSON} from '../shared/autonomy.js';
import {actionDefinition} from '../shared/action-definition.js';
import {validateProductProfile,createIdentityHash} from '../shared/planning-engine.js';

const fail=message=>{throw new Error(message);};
const secrets=value=>value&&typeof value==='object'&&Object.entries(value).some(([key,item])=>/(?:token|secret|password|credential|authorization)/i.test(key)||secrets(item));
const editable=new Set(['action','template','sound','profile','preferences','planning']);
export function validateExecutorEdit(edit){
 if(!edit||!/^[-\w]{8,100}$/.test(edit.id)||!/^\w+\/[A-Za-z0-9._:-]{1,160}$/.test(edit.key)||!safeJSON(edit.base)||!safeJSON(edit.value)||JSON.stringify(edit).length>256000||secrets(edit))fail('Modification invalide ou contenant un secret.');
 const [kind,id]=edit.key.split('/');
 if(!editable.has(kind)||(['profile','preferences'].includes(kind)&&id!=='root'))fail('Configurez ce réglage directement sur Android.');
 const value=edit.value;
 if(value===null){if(!['action','template','sound','planning'].includes(kind))fail('Cette configuration ne peut pas être supprimée.');return;}
 if(!value||typeof value!=='object'||Array.isArray(value))fail('Objet attendu.');
 if(fields[kind]&&Object.keys(value).some(key=>!fields[kind].includes(key)))fail('Champ non synchronisable.');
 if(kind==='action'){
  if(!actionDefinition(value)||value.id!==id||typeof value.label!=='string'||!value.label.trim()||value.label.length>100||typeof value.shortcut!=='string'||value.shortcut.length>100||Object.keys(value).some(key=>!['id','type','value','label','color','shortcut','wizebot'].includes(key)))fail('Bouton invalide.');
 }
 if(kind==='sound'){
  if(typeof value.name!=='string'||!value.name.trim()||value.name.length>140||typeof value.enabled!=='boolean'||typeof value.favorite!=='boolean'||!Number.isFinite(value.volume)||value.volume<0||value.volume>1||!Number.isFinite(value.cooldownMs)||value.cooldownMs<0||value.cooldownMs>3600000||value.playbackMode!==undefined&&!['replace','mix'].includes(value.playbackMode)||value.outputId&&!['device-default'].includes(value.outputId))fail('Réglages audio Android invalides.');
 }
 if(kind==='template'&&(typeof value.title!=='string'||!value.title.trim()||value.title.length>140))fail('Titre de modèle invalide.');
 if(kind==='profile')validateProductProfile(value);
 if(kind==='preferences'&&(Object.keys(value).some(key=>key!=='replayAutoStart')||typeof value.replayAutoStart!=='boolean'))fail('Préférences invalides.');
}

/** Durable receipts precede native planning I/O. Other resource edits compare
 * their base again inside the IndexedDB write transaction. No command or secret
 * is accepted through the configuration outbox. */
export function createExecutorSync({runtime,workspace,authorize,requireRole}){
 let tail=Promise.resolve(),executing=false;
 async function apply(request,body){
  authorize(request,'configuration');
  if(body.workspace!==workspace())fail('Identité d’appareil différente. Vos modifications sont conservées.');
  validateExecutorEdit(body.edit);
  const edit=body.edit,[kind,id]=edit.key.split('/'),owner=await runtime(),store=owner.owner.store;
  await store.reload();
  const signature=createIdentityHash('sha256').update(JSON.stringify(edit)).digest('hex');
  const read=()=>resources(store.view())[edit.key]??null;
  let previous;
  await store.updateDraft('executorEdits',saved=>{
   previous=saved?.[edit.id];
   if(previous){if(previous.signature!==signature)fail('Identifiant de modification réutilisé.');return saved;}
   if(Object.keys(saved||{}).length>=4096)fail('Journal Android plein. Exportez les données avant de poursuivre.');
   return {...saved,[edit.id]:{signature,status:'running'}};
  });
  if(previous){
   // An interrupted native publication cannot be inferred from editable fields.
   return previous.status==='running'?{...previous,status:'uncertain',current:read(),message:'Écriture interrompue. Vérifiez son résultat sur Android.'}:previous;
  }
  const current=read(),result=merge(edit.base,edit.value,current);
  let receipt;
  if(result.conflicts.length)receipt={signature,status:'conflict',current,fields:result.conflicts,message:'Modifications concurrentes.'};
  else if(equal(result.value,current))receipt={signature,status:'applied',current};
  else try{
   authorize(request,'configuration');validateExecutorEdit({...edit,value:result.value});
   if(kind==='planning'){
    requireRole('planning');
    await owner.planning.route('/api/v2/planning/'+encodeURIComponent(id),result.value||{},result.value===null?'DELETE':'PUT',{[edit.key]:current});
   }else{
    if(kind==='sound'&&result.value!==null&&!store.record.localAssets?.[id])fail('Le fichier audio doit d’abord être importé sur Android.');
    await store.stage({[edit.key]:result.value},{[edit.key]:current},true);
   }
   await store.reload();receipt={signature,status:'applied',current:read()};
  }catch(error){await store.reload();const after=read();receipt={signature,status:equal(after,current)?'rejected':'uncertain',current:after,message:error.message};}
  await store.updateDraft('executorEdits',saved=>({...saved,[edit.id]:receipt}));
  return receipt;
 }
 return (request,body)=>{if(executing)throw Object.assign(new Error('Une synchronisation est en cours. Aucune modification supplémentaire acceptée.'),{status:429,code:'EXECUTOR_BUSY'});executing=true;const result=tail.then(()=>apply(request,body)).finally(()=>{executing=false;});tail=result.catch(()=>{});return result;};
}
