import {expect,it} from 'vitest';
import {withMixerFixture} from './helpers/streamcockpit-mixer-fixture.js';
import {validateAudioReceipt,validateAudioChange} from '../apps/server/src/streamcockpit-audio-receipts.js';
const changed={'1':true,'2':false,'3':false,'4':true,'5':false,'6':false};
const confirm=async(f:any,id:string)=>f.call('confirm',{confirmationId:id,confirmed:true});

it.each(['tracks','monitorType'] as const)('existing real HTTP/OBS bus persists %s and restores it with fresh consent after restart',async kind=>withMixerFixture(async f=>{
 const before=f.state(),change=kind==='tracks'?{sourceId:'Micro QA',tracks:changed}:{sourceId:'Micro QA',monitorType:'OBS_MONITORING_TYPE_MONITOR_ONLY'};
 const preview=await f.call('preview',{change});expect(preview.status).toBe(200);
 expect(f.state().writes).toBe(0);expect(preview.body.before.tracks).toEqual(before.tracks);
 const result=await confirm(f,preview.body.confirmationId);expect(result.status).toBe(200);
 expect(result.body).toMatchObject({status:'confirmed',change,rollbackAvailable:true});
 expect(()=>validateAudioReceipt(result.body)).not.toThrow();
 expect(f.state().writes).toBe(1);expect(f.state()[kind]).toEqual(kind==='tracks'?changed:'OBS_MONITORING_TYPE_MONITOR_ONLY');
 const native=f.rpc.filter((r:any)=>r.type.startsWith('SetInputAudio'));
 expect(native).toHaveLength(1);expect(native[0].args.inputUuid).toBe(before.uuid);expect(native[0].args).not.toHaveProperty('inputName');
 await f.restartRouter();
 const history=await f.call('history');expect(history.status).toBe(200);expect(history.body.entries[0].receipt).toEqual(result.body);
 expect((await confirm(f,preview.body.confirmationId)).body).toEqual(result.body);expect(f.state().writes).toBe(1);
 const rollback=await f.call('preview',{rollbackReceiptId:preview.body.confirmationId});expect(rollback.status).toBe(200);
 expect((await confirm(f,rollback.body.confirmationId)).body.status).toBe('confirmed');
 expect(f.state()[kind]).toEqual(before[kind]);expect(f.state().gain).toBe(before.gain);expect(f.state().mute).toBe(before.mute);expect(f.state().writes).toBe(2);
},true));

it('does not overwrite changed routing between preview and confirmation, or erase a later unrelated track through rollback',async()=>withMixerFixture(async f=>{
 const change={sourceId:'Micro QA',tracks:changed};
 let preview=await f.call('preview',{change});f.changeTracks({...f.state().tracks,'6':true});
 expect((await confirm(f,preview.body.confirmationId)).status).toBe(409);expect(f.state().writes).toBe(0);
 preview=await f.call('preview',{change});expect((await confirm(f,preview.body.confirmationId)).body.status).toBe('confirmed');
 f.changeTracks({...f.state().tracks,'6':true});await f.restartRouter();
 expect((await f.call('preview',{rollbackReceiptId:preview.body.confirmationId})).status).toBe(409);
 expect(f.state().tracks['6']).toBe(true);expect(f.state().writes).toBe(1);
},true));

it.each(['no-effect','reject','lost'])('routing result %s is never silently replayed or presented as confirmed',async mode=>withMixerFixture(async f=>{
 const preview=await f.call('preview',{change:{sourceId:'Micro QA',tracks:changed}});f.setMode(mode);
 const result=await confirm(f,preview.body.confirmationId);
 expect(result.body.status).toBe(mode==='reject'?'rejected':'uncertain');expect(result.body.rollbackAvailable).toBe(false);
 const count=f.state().writes;
 f.setMode('ok');
 if(mode==='lost')await f.obs.connect();
 await f.restartRouter();
 const recovered=await f.call('status/'+preview.body.confirmationId);
 expect(recovered.body.status).toBe(result.body.status);expect(f.state().writes).toBe(count);
 expect((await confirm(f,preview.body.confirmationId)).body.status).toBe(result.body.status);expect(f.state().writes).toBe(count);
},true),15000);

it('rejects malformed routing, combined changes and missing permission before OBS writes',async()=>withMixerFixture(async f=>{
 for(const change of [{sourceId:'Micro QA',tracks:{'1':true}}, {sourceId:'Micro QA',tracks:{...changed,'7':true}},
  {sourceId:'Micro QA',tracks:{...changed,'1':1}}, {sourceId:'Micro QA',monitorType:'automatic'},
  {sourceId:'Micro QA',tracks:changed,mute:true}]){
  expect(()=>validateAudioChange(change as never)).toThrow();expect((await f.call('preview',{change})).status).toBe(400);
 }
 const invitation=f.auth.createPairing(undefined,false,['observe']);const readOnly=f.auth.pair(invitation.id,invitation.code,'Read only');
 expect((await f.call('preview',{change:{sourceId:'Micro QA',tracks:changed}},readOnly.credential)).status).toBe(403);
 expect(f.state().writes).toBe(0);
},true));

it('observes identical routing without writing and refuses a substituted OBS UUID',async()=>withMixerFixture(async f=>{
 const before=f.state();let preview=await f.call('preview',{change:{sourceId:'Micro QA',tracks:before.tracks}});
 expect((await confirm(f,preview.body.confirmationId)).body).toMatchObject({status:'unchanged',rollbackAvailable:false});
 expect(f.state().writes).toBe(0);
 preview=await f.call('preview',{change:{sourceId:'Micro QA',tracks:changed}});f.changeSource();
 expect((await confirm(f,preview.body.confirmationId)).status).toBe(409);expect(f.state().writes).toBe(0);
},true));
