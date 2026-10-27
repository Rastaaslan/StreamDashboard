import test from 'node:test';
import assert from 'node:assert/strict';
import {planSetupMigration,runSetupMigration} from '../../apps/mobile/control/setup-migration.js';
import {migrateInstallation,planInstallationChange,SETUPS} from '../../apps/mobile/shared/installation.js';
import {configurationTransferSupport} from '../../apps/mobile/shared/configuration-transfer.js';
import {transitionPlanningHandoff,planningOwned} from '../../apps/mobile/shared/planning-handoff.js';
import {resources,overlay,equal} from '../../apps/mobile/shared/autonomy.js';
import {createSoundLibraryExport} from '../../apps/mobile/shared/sound-library.js';
import {createHash} from 'node:crypto';

const button={id:'stop_sound',type:'sound.stop',value:'',label:'Arrêter',shortcut:'',color:'red'};
const obs={id:'obs_scene',type:'scene.set',value:'Live',label:'Scène',shortcut:'',color:'blue'};
const event={id:'event_1',title:'Événement à conserver',startAtUtc:'2027-01-01T10:00:00Z',endAtUtc:'2027-01-01T11:00:00Z',editable:true,providers:{google:{remoteId:'calendar-1'},twitch:{remoteId:'segment-1'}}};
const sound={id:'sound_1',name:'Son',category:'Test',enabled:true,favorite:false,volume:1,cooldownMs:0,monitoringMode:'stream',playbackMode:'replace'};
const bundle=name=>({data:{configuration:{actions:[],outputs:{twitch:{kind:"unconfigured"},youtube:{kind:"unconfigured"}},youtube:{},replayAutoStart:true},host:{settings:{streamerName:name,accent:'violet',confirmStop:true},planning:[],planningRevisions:{}}},sounds:{sounds:[]},extras:{templates:[],automations:[]}});

function fixture(preset='dual-pc',platform='windows'){
 let installation=migrateInstallation({id:'source_device',platform:preset==='android-only'?'android':'windows',legacy:{configured:true}});
 const targetDevice={...migrateInstallation({id:'target_device',platform}).devices[0],endpoint:'https://target.test'};
 installation=planInstallationChange(installation,{preset,device:targetDevice},installation.revision).next;
 const initialInstallation=structuredClone(installation),source={id:'source',deviceId:'source_device',scope:'https://source.test',name:'Source'},target={id:'target',deviceId:'target_device',scope:'https://target.test',name:'Cible'};
 const snapshots={source:{workspace:'device:source_device',bundle:bundle('Source'),configurationTransfer:configurationTransferSupport('windows')},target:{workspace:'device:target_device',bundle:bundle('Cible'),configurationTransfer:configurationTransferSupport(platform)}};
 snapshots.source.bundle.data.configuration.actions=[button,obs];snapshots.source.bundle.data.host.planning=[structuredClone(event)];snapshots.source.bundle.sounds.sounds=[sound];
 const original=structuredClone(snapshots.target.bundle),receipts=new Map(),journals={source:{},target:{}};
 const descriptor={device:targetDevice,observed:{permissions:['observe','configuration','audio','planning','obs','clips','chat']}};
 let job=planSetupMigration({id:'setup_fixture_test',source,target,from:snapshots.source,to:snapshots.target,installation,descriptor,sounds:[sound],planningIds:[event.id]}),writeCount=0,dropAt=-1,offline=false,roleStopped=false;
 const bytes=new Blob([Uint8Array.from([82,73,70,70,1,2,3])]),uploads=new Map();
 const exportAudio=createSoundLibraryExport({list:async()=>[sound],load:async()=>({blob:bytes,filename:'test.wav'}),hash:async blob=>createHash('sha256').update(Buffer.from(await blob.arrayBuffer())).digest('hex'),uuid:()=> 'export_fixture'});
 const written=()=>{writeCount++;if(writeCount===dropAt)throw Error('lost acknowledgement '+dropAt);};
 const connected=()=>{if(offline)throw Error('offline');};
 const adapter={
  snapshot:async device=>{connected();return structuredClone(snapshots[device.id]);},
  installation:async()=>structuredClone(installation),
  changeInstallation:async(changes,revision)=>{const result=planInstallationChange(installation,changes,revision);installation=result.next;written();return result;},
  preflight:async()=>{connected();if(roleStopped)throw Error('role stopped');},
  apply:async(_device,body)=>{
   connected();let receipt=receipts.get(body.edit.id);
   if(!receipt&&!body.statusOnly){const current=resources(snapshots.target.bundle)[body.edit.key]??null;receipt=equal(current,body.edit.base)?{status:'applied',current:body.edit.value}:{status:'conflict',current};receipts.set(body.edit.id,receipt);if(receipt.status==='applied')snapshots.target.bundle=overlay(snapshots.target.bundle,{[body.edit.key]:body.edit.value});written();}
   return {workspace:snapshots.target.workspace,receipt:receipt||{status:'absent'}};
  },
  handoff:async(device,body)=>{
   connected();const state={items:snapshots[device.id].bundle.data.host.planning,journal:journals[device.id]};
   const result=transitionPlanningHandoff(state,body.workspace,body.operation,body.ticket,body.proof);
   snapshots[device.id].bundle.data.host.planning=result.state.items;journals[device.id]=result.state.journal;if(body.operation!=='status')written();return {receipt:result.receipt};
  },
  read:async(_device,body)=>{connected();return exportAudio(body,'fixture');},
  upload:async(_device,input)=>{connected();if(!uploads.has(input.transferId)){uploads.set(input.transferId,input);snapshots.target.bundle.sounds.sounds=[sound];written();}return {id:input.soundId};},
  save:async next=>{job=structuredClone(next);},
 };
 return {adapter,snapshots,source,target,descriptor,original,initialInstallation,get job(){return job;},get installation(){return installation;},get writes(){return writeCount;},get uploads(){return uploads;},drop:n=>{dropAt=n;},offline:value=>{offline=value;},role:value=>{roleStopped=value;},editInstallation:()=>{installation=planInstallationChange(installation,{name:'Changed elsewhere'},installation.revision).next;}};
}

for(const preset of Object.keys(SETUPS))test(preset+': coordinated data, planning ownership and controller destinations; current planning returns intact',async()=>{
 const f=fixture(preset,preset.includes('deck')||preset==='android-only'?'android':'windows');
 await runSetupMigration(f.job,f.adapter);assert.equal(f.job.status,'completed');assert.equal(f.uploads.size,1);
 assert.equal(planningOwned(f.snapshots.source.bundle.data.host.planning[0]),false);assert.equal(planningOwned(f.snapshots.target.bundle.data.host.planning[0]),true);
 assert.equal(f.installation.actionRoutes.find(r=>r.actionId===button.id).deviceId,'target_device');
 if(f.descriptor.device.platform==='android'){assert(f.job.retained.includes('Scène'));assert(!f.installation.actionRoutes.some(r=>r.actionId===obs.id));}
 f.snapshots.target.bundle.data.host.planning[0].title='Updated after move';
 await runSetupMigration(f.job,f.adapter,true);assert.equal(f.job.status,'rolled-back');assert.equal(f.snapshots.source.bundle.data.host.planning[0].title,'Updated after move');
 assert.equal(planningOwned(f.snapshots.source.bundle.data.host.planning[0]),true);assert.equal(planningOwned(f.snapshots.target.bundle.data.host.planning[0]),false);
 assert.deepEqual(f.snapshots.target.bundle.data.configuration,f.original.data.configuration);assert.deepEqual(f.snapshots.target.bundle.data.host.settings,f.original.data.host.settings);assert.equal(f.snapshots.target.bundle.sounds.sounds.length,1);
 assert.deepEqual(f.installation.routes,f.initialInstallation.routes);assert.deepEqual(f.installation.actionRoutes,[]);
});

test('every lost acknowledgement resumes without duplicating audio or giving two devices planning ownership',async()=>{
 const baseline=fixture();await runSetupMigration(baseline.job,baseline.adapter);
 for(let boundary=1;boundary<=baseline.writes;boundary++){
  const f=fixture();f.drop(boundary);await assert.rejects(runSetupMigration(f.job,f.adapter),/lost acknowledgement/);
  assert([f.snapshots.source,f.snapshots.target].filter(x=>x.bundle.data.host.planning.some(planningOwned)).length<=1);
  await runSetupMigration(f.job,f.adapter);assert.equal(f.job.status,'completed','boundary '+boundary);assert.equal(f.uploads.size,1);
 }
});

test('rollback resolves every possible unknown forward receipt, including activation and final installation commit',async()=>{
 const baseline=fixture();await runSetupMigration(baseline.job,baseline.adapter);
 for(let boundary=1;boundary<=baseline.writes;boundary++){
  const f=fixture();f.drop(boundary);await assert.rejects(runSetupMigration(f.job,f.adapter));
  await runSetupMigration(f.job,f.adapter,true);assert.equal(f.job.status,'rolled-back','boundary '+boundary);
  assert.equal(planningOwned(f.snapshots.source.bundle.data.host.planning[0]),true);assert(!f.snapshots.target.bundle.data.host.planning.some(planningOwned));
  assert.deepEqual(f.installation.routes,f.initialInstallation.routes);
 }
});

test('rollback itself survives each lost acknowledgement and cannot resume forward',async()=>{
 const baseline=fixture();await runSetupMigration(baseline.job,baseline.adapter);const forward=baseline.writes;await runSetupMigration(baseline.job,baseline.adapter,true);
 for(let boundary=forward+1;boundary<=baseline.writes;boundary++){
  const f=fixture();await runSetupMigration(f.job,f.adapter);f.drop(boundary);await assert.rejects(runSetupMigration(f.job,f.adapter,true));
  await assert.rejects(runSetupMigration(f.job,f.adapter),/retour arrière/);await runSetupMigration(f.job,f.adapter,true);assert.equal(f.job.status,'rolled-back','boundary '+boundary);
 }
});

test('stale installation, offline devices, changed identity and stopped roles do not start migration',async()=>{
 let f=fixture();f.editInstallation();await assert.rejects(runSetupMigration(f.job,f.adapter),/modifiée/);assert.equal(f.writes,0);
 f=fixture();f.offline(true);await assert.rejects(runSetupMigration(f.job,f.adapter),/offline/);assert.equal(f.writes,0);f.offline(false);await runSetupMigration(f.job,f.adapter);
 f=fixture();f.snapshots.target.workspace='another-device';await assert.rejects(runSetupMigration(f.job,f.adapter),/Identité/);assert.equal(f.writes,0);
 f=fixture();f.role(true);await assert.rejects(runSetupMigration(f.job,f.adapter),/role stopped/);assert.equal(f.writes,0);
});

test('concurrent destination or controller changes block compensation without overwriting new values',async()=>{
 let f=fixture();await runSetupMigration(f.job,f.adapter);f.editInstallation();await assert.rejects(runSetupMigration(f.job,f.adapter,true),/Installation modifiée/);assert.equal(f.installation.devices[0].name,'Changed elsewhere');
 f=fixture();await runSetupMigration(f.job,f.adapter);f.snapshots.target.bundle.data.host.settings.streamerName='Later';await assert.rejects(runSetupMigration(f.job,f.adapter,true),/Retour arrière/);assert.equal(f.snapshots.target.bundle.data.host.settings.streamerName,'Later');
});

test('other controller bindings and incompatible commands are preserved; no account or sound path is copied',()=>{
 const f=fixture('dual-pc-deck','android'),model=f.initialInstallation;model.actionRoutes=[{workspace:'other',actionId:'button_other',deviceId:'target_device',definition:button}];
 const plan=planSetupMigration({id:'setup_selective_test',source:f.source,target:f.target,from:f.snapshots.source,to:f.snapshots.target,installation:model,descriptor:f.descriptor,sounds:[{...sound,path:'C:/private.wav',token:'not-copied'}],planningIds:[]});
 assert.deepEqual(plan.routing.after.actionRoutes[0],model.actionRoutes[0]);assert.equal(JSON.stringify(plan).includes('private.wav'),false);assert.equal(JSON.stringify(plan).includes('not-copied'),false);
 const stopped={...f.descriptor,device:{...f.descriptor.device,roles:['controller']}};
 assert.throws(()=>planSetupMigration({id:'setup_stopped_test',source:f.source,target:f.target,from:f.snapshots.source,to:f.snapshots.target,installation:model,descriptor:stopped,planningIds:[event.id]}),/Activez/);
});
