import test from 'node:test';
import assert from 'node:assert/strict';
import {configurationTransferSupport,planConfigurationCopy,runConfigurationCopy} from '../../apps/mobile/shared/configuration-transfer.js';
import {resources,overlay,equal} from '../../apps/mobile/shared/autonomy.js';
const bundle=()=>({data:{configuration:{actions:[],outputs:{twitch:{kind:'unconfigured'},youtube:{kind:'unconfigured'}},youtube:{clientId:''},replayAutoStart:true},host:{settings:{streamerName:'Source',accent:'violet',confirmStop:true,obsUrl:'ws://source',obsExecutablePath:'C:/source',remoteEnabled:true},planning:[],planningRevisions:{}}},sounds:{sounds:[]},extras:{templates:[],automations:[]}});
const action={id:'button',type:'sound.stop',value:'',label:'Arrêt',shortcut:'Control+Alt+Shift+F10',color:'red'};
function fixture(){
 const source={workspace:'source',bundle:bundle()},target={workspace:'target',bundle:bundle(),configurationTransfer:configurationTransferSupport('windows')};
 source.bundle.data.configuration.actions.push(action);source.bundle.extras.templates.push({id:'model',title:'Bonjour'});
 target.bundle.data.host.settings={...target.bundle.data.host.settings,streamerName:'Target',obsUrl:'ws://target',obsExecutablePath:'C:/target',remoteEnabled:false};
 const receipts=new Map();let job={id:'configuration_test',source:{id:'source'},target:{id:'target'},...planConfigurationCopy(source,target)},writes=0,drop=false;
 const options={save:async value=>{job=structuredClone(value);},snapshot:async device=>structuredClone(device.id==='source'?source:target),apply:async(_device,body)=>{
  let receipt=receipts.get(body.edit.id);if(!receipt&&!body.statusOnly){const current=resources(target.bundle)[body.edit.key]??null;receipt=equal(body.edit.base,current)?{status:'applied',current:body.edit.value}:{status:'conflict',current};receipts.set(body.edit.id,receipt);if(receipt.status==='applied'){writes++;target.bundle=overlay(target.bundle,{[body.edit.key]:body.edit.value});}}
  if(drop){drop=false;throw Error('lost reply');}return {workspace:target.workspace,receipt:receipt||{status:'absent'}};
 }};
 return {source,target,options,get job(){return job;},get writes(){return writes;},lose(){drop=true;}};
}
test('preview preserves physical paths, identities and target-only data; unsupported kinds are explicit',()=>{
 const f=fixture();f.source.bundle.extras.automations=[{id:'auto',name:'Automation',enabled:true,trigger:{type:'x'}}];f.target.configurationTransfer=configurationTransferSupport('android');
 const plan=planConfigurationCopy(f.source,f.target);assert.deepEqual(plan.skipped,['output/twitch','output/youtube','youtube/root','automation/auto']);
 const settings=plan.items.find(i=>i.key==='settings/root').value;assert.equal(settings.obsUrl,'ws://target');assert.equal(settings.obsExecutablePath,'C:/target');assert.equal(settings.remoteEnabled,false);
 assert.deepEqual(plan.items.find(i=>i.key==='actionSet/root').value.items,[action]);
 f.target.configurationTransfer=configurationTransferSupport('windows');assert.equal(planConfigurationCopy(f.source,f.target).items.find(i=>i.key==='automation/auto').value.enabled,false);
 assert.throws(()=>planConfigurationCopy(f.source,{...f.target,configurationTransfer:undefined}),/jour/);
});
test('secrets, reused workspace and a stale preview never write',async()=>{
 const f=fixture();f.source.bundle.extras.profile={token:'private'};assert.throws(()=>planConfigurationCopy(f.source,f.target),/privées/);delete f.source.bundle.extras.profile;
 assert.throws(()=>planConfigurationCopy(f.source,{...f.target,workspace:'source'}),/distincts/);
 f.target.bundle.data.host.settings.streamerName='Concurrent';await assert.rejects(runConfigurationCopy(f.job,f.options),/périmée/);assert.equal(f.writes,0);
});
test('lost acknowledgement resumes once; reversing the completed batch restores the exact originals',async()=>{
 const f=fixture(),original=structuredClone(f.target.bundle);f.lose();await assert.rejects(runConfigurationCopy(f.job,f.options),/lost/);assert.equal(f.writes,1);
 await runConfigurationCopy(f.job,f.options);assert.equal(f.job.status,'completed');assert.equal(f.writes,3);
 await runConfigurationCopy(f.job,f.options,true);assert.equal(f.job.status,'rolled-back');assert.deepEqual(f.target.bundle,original);
 const count=f.writes;await runConfigurationCopy(f.job,f.options,true);assert.equal(f.writes,count);
});
test('cancel queries unknown receipts without applying an unattempted edit',async()=>{
 const f=fixture();let saved;await assert.rejects(runConfigurationCopy(f.job,{...f.options,save:async j=>{saved=structuredClone(j);await f.options.save(j);},apply:async()=>{throw Error('offline before delivery');}}),/offline/);
 assert.equal(saved.items[0].attempted,true);await runConfigurationCopy(f.job,f.options,true);assert.equal(f.writes,0);assert.equal(f.job.status,'rolled-back');
});
test('rollback after a lost reply discovers the write and protects subsequent destination edits',async()=>{
 const f=fixture();f.lose();await assert.rejects(runConfigurationCopy(f.job,f.options),/lost/);
 f.target.bundle.data.host.settings.streamerName='Later';await assert.rejects(runConfigurationCopy(f.job,f.options,true),/Retour arrière/);
 assert.equal(f.target.bundle.data.host.settings.streamerName,'Later');assert.equal(f.job.rollingBack,true);
 await assert.rejects(runConfigurationCopy(f.job,f.options),/retour arrière/);
});
test('wrong destination identity and oversized jobs are refused before application',async()=>{
 const f=fixture();await assert.rejects(runConfigurationCopy({...f.job,targetWorkspace:'different'},f.options),/Identité/);
 await assert.rejects(runConfigurationCopy({...f.job,id:'x'},f.options),/invalide/);assert.equal(f.writes,0);
});
