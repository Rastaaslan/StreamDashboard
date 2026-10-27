import {randomUuid} from '../shared/uuid.js';
import {SETUPS} from '../shared/installation.js';
import {planningOwned} from '../shared/planning-handoff.js';
import {planSetupMigration,runSetupMigration} from './setup-migration.js';

export function createSetupMigrationUI({devices,snapshot,descriptor,installation,changeInstallation,preflight,apply,handoff,read,upload,store,modal,esc,changed}){
 let choices=[],selection,pending,busy=false;
 const owner=async()=>{const value=await store();await value.reload();return value;};
 const labels={pending:'Prêt',running:'En cours',completed:'Terminé',error:'À reprendre', 'rolling-back':'Retour arrière en cours','rolled-back':'Retour arrière terminé'};
 async function open(){
  if(busy)throw new Error('Un changement est en cours.');
  choices=await devices();selection=undefined;pending=undefined;
  const saved=await owner(),jobs=Object.values(saved.record.drafts.setupMigrations||{}).reverse();
  modal(`<h2>Changer d’installation</h2><p>Réunissez configurations, sons, planning et destinations des boutons dans un changement reprenable. Les appareils doivent être associés et leurs rôles nécessaires activés dans Mon installation.</p><form id="setup-migration-source"><label>Source<select name="source">${choices.map(d=>`<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('')}</select></label><label>Destination<select name="target">${choices.map((d,i)=>`<option value="${esc(d.id)}" ${i===1?'selected':''}>${esc(d.name)}</option>`).join('')}</select></label><button ${choices.length<2?'disabled':''}>Préparer le changement</button></form><h3>Changements conservés</h3>${jobs.map(job=>`<section><b>${esc(job.source.name)} → ${esc(job.target.name)}</b><p>${esc(labels[job.status]||'À reprendre')}</p><p>${job.configuration.items.filter(i=>i.complete&&!i.undone).length} configurations · ${job.audio.items.filter(i=>i.complete).length} sons · ${job.planning.filter(i=>i.status==='completed'&&!i.undone).length} événements</p>${job.error?`<p role="status">${esc(job.error)}</p>`:''}${job.status!=='rolled-back'?`${!job.rollingBack&&job.status!=='completed'?`<button data-task="setup-migration-resume" data-job="${esc(job.id)}">Reprendre le changement</button>`:''}<button class="secondary" data-task="setup-migration-undo-preview" data-job="${esc(job.id)}">${job.rollingBack?'Poursuivre le retour arrière':'Préparer le retour arrière'}</button>`:''}</section>`).join('')||'<p>Aucun changement enregistré.</p>'}`);
 }
 async function submit(form){
  if(!['setup-migration-source','setup-migration-selection'].includes(form.id))return false;
  if(busy)throw new Error('Un changement est en cours.');const values=new FormData(form);
  if(form.id==='setup-migration-source'){
   const source=choices.find(d=>d.id===values.get('source')),target=choices.find(d=>d.id===values.get('target'));
   if(!source||!target||source.id===target.id)throw new Error('Choisissez deux espaces différents.');
   const [from,to,model,observed]=await Promise.all([snapshot(source),snapshot(target),installation(),descriptor(target)]);
   if(from.workspace===to.workspace)throw new Error('Ces entrées désignent le même espace.');
   // Snapshot metadata is enough to preview files; export permissions are
   // checked before the first mutation, including the actual source role.
   const sounds=from.bundle.sounds?.sounds||[],events=from.bundle.data.host.planning.filter(planningOwned);
   selection={source,target,from,to,installation:model,descriptor:observed,sounds};
   const android=model.devices.find(d=>d.id===model.localDeviceId).platform==='android';
   modal(`<h2>Choisir le contenu du changement</h2><p>${esc(source.name)} → ${esc(target.name)}</p><form id="setup-migration-selection"><label>Installation après le changement<select name="preset">${Object.entries(SETUPS).filter(([id])=>android||id!=='android-only').map(([id,label])=>`<option value="${id}" ${id===model.preset?'selected':''}>${esc(label)}</option>`).join('')}</select></label><label><input type="checkbox" name="configuration" checked> Configurations, boutons, macros et modèles compatibles</label><label><input type="checkbox" name="routing" ${!target.local&&source.deviceId!==target.deviceId?'checked':'disabled'}> Déplacer les destinations compatibles de ce contrôleur</label><fieldset><legend>Fichiers audio</legend>${sounds.map((item,i)=>`<label><input type="checkbox" name="sound" value="${i}" checked> ${esc(item.name)}</label>`).join('')||'<p>Aucun fichier.</p>'}</fieldset><fieldset><legend>Responsabilité des événements</legend>${events.map(item=>`<label><input type="checkbox" name="event" value="${esc(item.id)}" checked> ${esc(item.title)}</label>`).join('')||'<p>Aucun événement transférable.</p>'}</fieldset><p>Les sessions et comptes restent propres à chaque appareil. Les automatismes copiés seront désactivés. Les autres contrôleurs conservent leurs destinations.</p><button>Vérifier le basculement</button></form><button class="secondary" data-task="setup-migration">Annuler</button>`);return true;
  }
  if(!selection)throw new Error('Préparez à nouveau le changement.');
  pending=planSetupMigration({...selection,id:randomUuid(),configuration:values.has('configuration'),routeActions:values.has('routing'),preset:values.get('preset'),sounds:selection.sounds.filter((_,i)=>values.getAll('sound').includes(String(i))),planningIds:values.getAll('event')});
  await preflight(pending);
  const routes=pending.routing.changes.actionRoutes.filter(r=>r.deviceId===pending.target.deviceId);
  modal(`<h2>Confirmer le changement d’installation</h2><p>${esc(pending.source.name)} → ${esc(pending.target.name)}</p><ul><li>${pending.configuration.items.length} configurations copiées ; les réglages physiques de la destination sont conservés.</li><li>${pending.audio.items.length} fichiers copiés avec vérification de leur contenu.</li><li>${pending.planning.length} événements confiés à la destination avec leurs identifiants de publication.</li><li>${routes.length} destinations de boutons sur ce contrôleur ; basculement après confirmation des contenus.</li></ul><details><summary>Configurations à remplacer ou ajouter</summary>${pending.configuration.items.map(item=>`<p>${esc(item.label)}</p><pre>Avant : ${esc(JSON.stringify(item.base,null,2))}</pre><pre>Après : ${esc(JSON.stringify(item.value,null,2))}</pre>`).join('')||'<p>Aucune différence.</p>'}</details>${pending.retained.length||pending.configuration.skipped.length?`<p>Conservés sur la source : ${[...pending.retained,...pending.configuration.skipped].map(esc).join(', ')}.</p>`:''}<p>Les originaux, appareils et associations sont conservés. Aucune commande ni publication n’est déclenchée par le transfert. En cas de coupure, reprenez ici. Les sons copiés resteront disponibles même après un retour arrière.</p><button data-task="setup-migration-apply">Appliquer ce changement</button><button class="secondary" data-task="setup-migration">Annuler</button>`);return true;
 }
 async function run(initial,rollback=false){
  if(busy)throw new Error('Un changement est en cours.');busy=true;let job=initial;
  try{
   const saved=await owner(),save=async value=>{
    await saved.updateDraft('setupMigrations',jobs=>{
     if(!jobs?.[value.id]&&Object.keys(jobs||{}).length>=50)throw new Error('Cinquante changements sont conservés. Exportez vos données avant de poursuivre.');
     return {...jobs,[value.id]:structuredClone(value)};
    });job=structuredClone(value);
   };
   const execute=async()=>{
    await saved.reload();job=saved.record.drafts.setupMigrations?.[job.id]||job;
    await save({...job,error:undefined});modal('<h2>Changement en cours</h2><p>Les confirmations sont enregistrées après chaque étape. Gardez cette fenêtre ouverte ; après une interruption, reprenez depuis Changer d’installation.</p>');
    try{await runSetupMigration(job,{snapshot,installation,changeInstallation,preflight,apply,handoff,read,upload,save},rollback);await changed();}
    catch(error){await save({...job,status:'error',error:error.message});throw error;}
   };
   // Serialize the whole wizard, including different jobs in other windows.
   if(globalThis.navigator?.locks)await navigator.locks.request('sd-setup-migration',execute);else await execute();
  }finally{busy=false;await open();}
 }
 async function task(name,button){
  if(name==='setup-migration'){await open();return true;}
  if(name==='setup-migration-apply'){if(!pending)throw new Error('Prévisualisez le changement.');const job=pending;pending=undefined;await run(job);return true;}
  if(!['setup-migration-resume','setup-migration-undo-preview','setup-migration-undo'].includes(name))return false;
  if(busy)throw new Error('Un changement est en cours.');const saved=await owner(),job=saved.record.drafts.setupMigrations?.[button?.dataset.job];if(!job)throw new Error('Changement introuvable.');
  if(name.endsWith('undo-preview'))modal(`<h2>Confirmer le retour arrière</h2><p>Les destinations de ce contrôleur puis les responsabilités du planning reviendront à leur emplacement précédent. Les modifications récentes des événements seront conservées. Les configurations seront restaurées uniquement si elles n’ont pas changé depuis la copie.</p><p>Les fichiers audio copiés resteront disponibles sur les deux appareils. Les comptes et associations sont conservés. Les deux appareils doivent être accessibles.</p><button data-task="setup-migration-undo" data-job="${esc(job.id)}">Confirmer le retour arrière</button><button class="secondary" data-task="setup-migration">Annuler</button>`);
  else await run(job,name.endsWith('undo'));return true;
 }
 return {task,submit};
}
