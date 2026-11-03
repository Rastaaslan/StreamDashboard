import {it,expect} from 'vitest';
import {withMixerFixture} from './helpers/streamcockpit-mixer-fixture.js';
import {isRemoteApiAllowed,requiredDevicePermissions} from '../apps/server/src/remote-api-policy.js';
const sourceId='Micro QA';
it.each([{sourceId,gain:.5},{sourceId,mute:true}])('F05 actual OBS WS + HTTP: preview, one write, readback and guarded manual rollback %j',async change=>withMixerFixture(async f=>{
 const p=await f.call('preview',{change});expect(p.status).toBe(200);expect(f.state().writes).toBe(0);
 const body={confirmationId:p.body.confirmationId,confirmed:true};
 const results=await Promise.all([f.call('confirm',body),f.call('confirm',body)]);
 expect(results.map(r=>r.status)).toEqual([200,200]);expect(f.state().writes).toBe(1);
 const receipt=results[0].body;expect(receipt.status).toBe('confirmed');expect(receipt.rollbackAvailable).toBe(true);
 expect(f.rpc.filter((r:any)=>r.type.startsWith('SetInput'))).toHaveLength(1);
 expect(f.rpc.find((r:any)=>r.type.startsWith('SetInput')).args).not.toHaveProperty('inputName');
 expect((await f.call('status/'+receipt.confirmationId)).body).toEqual(receipt);
 const rollback=await f.call('preview',{rollbackReceiptId:receipt.confirmationId});expect(rollback.status).toBe(200);expect(f.state().writes).toBe(1);
 expect((await f.call('confirm',{confirmationId:rollback.body.confirmationId,confirmed:true})).body.status).toBe('confirmed');
 expect(f.state()).toMatchObject({gain:.75,mute:false,writes:2});expect(f.domain.timer.running).toBe(false);
}));
it('F05 does not restore an obsolete audio state after another operator change',async()=>withMixerFixture(async f=>{
 const p=await f.call('preview',{change:{sourceId,gain:.5}}),r=await f.call('confirm',{confirmationId:p.body.confirmationId,confirmed:true});
 f.changeGain(.9);
 expect((await f.call('preview',{rollbackReceiptId:r.body.confirmationId})).status).toBe(409);
 expect(f.state().writes).toBe(1);expect(f.state().gain).toBe(.9);
}));
it.each(['replaced','changed','no-uuid','changed-during-save','disk-failure','host','permission','revoke-during-final-read'])('F05 %s refuses writes before dispatch',async mode=>withMixerFixture(async f=>{
 const p=await f.call('preview',{change:{sourceId,gain:.5}});expect(p.status).toBe(200);
 if(mode==='replaced')f.changeSource();else if(mode==='changed')f.changeGain(.8);else if(mode==='host')f.setHost('OTHER');
 else if(mode==='permission')f.auth.setPermissions(f.paired.deviceId,['observe']);else f.setMode(mode);
 const r=await f.call('confirm',{confirmationId:p.body.confirmationId,confirmed:true});expect(r.status).toBeGreaterThanOrEqual(400);expect(f.state().writes).toBe(0);
}));
it.each(['lost','no-effect','reject','revoke-after'])('F05 %s never reports confirmed and never replays a consumed intent',async mode=>withMixerFixture(async f=>{
 const p=await f.call('preview',{change:{sourceId,mute:true}});f.setMode(mode);
 const started=Date.now(),body={confirmationId:p.body.confirmationId,confirmed:true},r=await f.call('confirm',body);
 expect(Date.now()-started).toBeLessThan(7000);
 if(mode==='revoke-after')expect(r.status).toBe(403);
 else expect(r.body.status).toBe(mode==='reject'?'rejected':'uncertain');
 const writes=f.state().writes;await f.call('confirm',body);expect(f.state().writes).toBe(writes);
 expect(JSON.stringify(r)).not.toContain('PRIVATE');
}),10_000);
it('F05 persisted intent survives router restart, with no invented success or rollback',async()=>withMixerFixture(async f=>{
 const p=await f.call('preview',{change:{sourceId,gain:.5}});
 await f.call('confirm',{confirmationId:p.body.confirmationId,confirmed:true});
 await f.restartRouter();
 expect((await f.call('status/'+p.body.confirmationId)).body).toMatchObject({status:'uncertain',rollbackAvailable:false});
 expect((await f.call('confirm',{confirmationId:p.body.confirmationId,confirmed:true})).status).toBe(409);expect(f.state().writes).toBe(1);
}));
it('F05 unchanged settings send no mutation; unsupported routing and unpaired actors are rejected',async()=>withMixerFixture(async f=>{
 const p=await f.call('preview',{change:{sourceId,gain:.75}});
 expect((await f.call('confirm',{confirmationId:p.body.confirmationId,confirmed:true})).body).toMatchObject({status:'unchanged',rollbackAvailable:false});
 expect((await f.call('preview',{change:{sourceId,vod:false}})).status).toBe(400);
 expect((await f.call('preview',{change:{sourceId,gain:.5}},'wrong')).status).toBe(403);expect(f.state().writes).toBe(0);
 for(const op of ['preview','confirm']){
  const path='/v1/streamcockpit-mixer/control/'+op;expect(isRemoteApiAllowed('POST',path)).toBe(true);
  expect(requiredDevicePermissions('POST',path,{})).toEqual(['observe','obs','audio']);
 }
}));
it('F05 and legacy OBS operations share the same serialized authority and shutdown guard',async()=>withMixerFixture(async f=>{
 let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(resolve=>{enter=resolve});
 const blocked=f.bus.observedObs(async(assert:()=>void)=>{assert();enter();await new Promise<void>(resolve=>{release=resolve});assert()});
 await entered;const timer=f.bus.execute({type:'timer.add',seconds:15});
 expect(f.domain.timer.duration).toBe(300);expect(f.bus.hasPendingCommands).toBe(true);
 release();await Promise.all([blocked,timer]);expect(f.domain.timer.remaining).toBe(315);expect(f.domain.timer.duration).toBe(300);expect(f.bus.hasPendingCommands).toBe(false);
 await f.bus.stop();await expect(f.bus.observedObs(async()=>{})).rejects.toThrow();
}));
