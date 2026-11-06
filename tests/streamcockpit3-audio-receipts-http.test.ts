import {expect,it,vi} from 'vitest';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {withMixerFixture} from './helpers/streamcockpit-mixer-fixture.js';
import {isRemoteApiAllowed,requiredDevicePermissions} from '../apps/server/src/remote-api-policy.js';
const sourceId='Micro QA';
const durable=(run:(f:any)=>Promise<void>)=>withMixerFixture(run,true);
async function change(f:any,value:{gain?:number;mute?:boolean}={gain:.5}){
 const preview=await f.call('preview',{change:{sourceId,...value}});expect(preview.status).toBe(200);
 const body={confirmationId:preview.body.confirmationId,confirmed:true};
 return {body,result:await f.call('confirm',body)};
}
it.each([{gain:.5},{mute:true}])('F05 durably recovers confirmed %j after router restart without resending OBS',async value=>durable(async f=>{
 const {body,result}=await change(f,value);expect(result.status).toBe(200);expect(result.body.status).toBe('confirmed');
 await f.restartRouter();
 expect((await f.call('status/'+body.confirmationId)).body).toEqual(result.body);
 expect((await f.call('confirm',body)).body).toEqual(result.body);expect(f.state().writes).toBe(1);
 const history=await f.call('history');expect(history.status).toBe(200);
 expect(history.body).toMatchObject({readOnly:true,entries:[{receipt:result.body}],nextBefore:null});
 expect(JSON.stringify(history.body)).not.toContain('runtime');
 expect(JSON.stringify(history.body)).not.toContain(f.paired.credential);
}));
it('F05 manual rollback after restart gets a new consent and revalidates observed UUID and current values',async()=>durable(async f=>{
 const {result}=await change(f);await f.restartRouter();
 const preview=await f.call('preview',{rollbackReceiptId:result.body.confirmationId});
 expect(preview.status).toBe(200);expect(preview.body.confirmationId).not.toBe(result.body.confirmationId);
 expect(f.state().writes).toBe(1);
 expect((await f.call('confirm',{confirmationId:preview.body.confirmationId,confirmed:true})).body.status).toBe('confirmed');
 expect(f.state()).toMatchObject({gain:.75,mute:false,writes:2});await f.restartRouter();
 const history=await f.call('history');expect(history.body.entries).toHaveLength(2);
 expect(history.body.entries.every((x:any)=>x.receipt.status==='confirmed')).toBe(true);
}));
it.each(['changed','replaced','other-host','revoked'])('F05 recovered rollback refuses %s instead of restoring obsolete state',async mode=>durable(async f=>{
 const {result}=await change(f);await f.restartRouter();
 if(mode==='changed')f.changeGain(.9);if(mode==='replaced')f.changeSource();if(mode==='other-host')f.setHost('OTHER');
 if(mode==='revoked')f.auth.setPermissions(f.paired.deviceId,['observe']);
 expect((await f.call('preview',{rollbackReceiptId:result.body.confirmationId})).status).toBeGreaterThanOrEqual(400);
 expect(f.state().writes).toBe(1);
}));
it.each(['no-effect','reject'])('F05 %s remains durable and cannot become a confirmed receipt after restart',async mode=>durable(async f=>{
 f.setMode(mode);const {body,result}=await change(f);
 expect(result.body.status).toBe(mode==='reject'?'rejected':'uncertain');await f.restartRouter();
 const writes=f.state().writes;
 expect((await f.call('status/'+body.confirmationId)).body).toEqual(result.body);
 expect((await f.call('confirm',body)).body).toEqual(result.body);
 expect((await f.call('preview',{rollbackReceiptId:body.confirmationId})).status).toBe(409);
 expect(f.state().writes).toBe(writes);
}));
it('F05 failed final receipt persistence does not publish a success or repeat a possibly executed write',async()=>durable(async f=>{
 const fail=vi.spyOn(f.journal(),'complete').mockImplementation(()=>{throw Error('PRIVATE_STORAGE_FAILURE')});
 const {body,result}=await change(f);fail.mockRestore();
 expect(result.body.status).toBe('uncertain');expect(result.body.rollbackAvailable).toBe(false);
 await f.restartRouter();
 expect((await f.call('status/'+body.confirmationId)).body.status).toBe('uncertain');
 expect((await f.call('confirm',body)).body.status).toBe('uncertain');expect(f.state().writes).toBe(1);
}));
it('F05 unavailable durable admission prevents the OBS write and preserves the corrupt journal',async()=>durable(async f=>{
 await writeFile(join(f.directory,'streamcockpit-mixer-receipts.sqlite'),'foreign journal evidence');
 const {result}=await change(f);expect(result.status).toBe(503);expect(f.state().writes).toBe(0);
 expect(JSON.stringify(result.body)).not.toContain('foreign journal evidence');
}));
it('F05 history is read-only, permission-scoped and does not expose another controller',async()=>durable(async f=>{
 await change(f);
 const path='/v1/streamcockpit-mixer/control/history';expect(isRemoteApiAllowed('GET',path)).toBe(true);
 expect(isRemoteApiAllowed('POST',path)).toBe(false);expect(requiredDevicePermissions('GET',path,{})).toEqual(['observe','obs','audio']);
 const invitation=f.auth.createPairing(undefined,false,['observe','obs','audio']);
 const other=f.auth.pair(invitation.id,invitation.code,'Other QA');
 expect((await f.call('history',undefined,other.credential)).body.entries).toEqual([]);
 expect((await f.call('history',undefined,'invalid')).status).toBe(403);
 for(const query of ['0','NaN','-1','9999999999999999','1&before=2'])
  expect((await f.call('history?before='+query)).status).toBe(400);
}));
it('F05 unchanged audio is persisted without an OBS command or rollback entitlement',async()=>durable(async f=>{
 const {body,result}=await change(f,{gain:.75});expect(result.body).toMatchObject({status:'unchanged',rollbackAvailable:false});
 await f.restartRouter();expect((await f.call('status/'+body.confirmationId)).body).toEqual(result.body);
 expect(f.state().writes).toBe(0);
}));

it('F05 reconciles a lost durable completion ACK by reading the stored outcome, without another OBS request',async()=>durable(async f=>{
 const store=f.journal(),complete=store.complete.bind(store);
 const ack=vi.spyOn(store,'complete').mockImplementation((...args:any[])=>{complete(...args);throw Error('TEST_LOST_COMMIT_ACK')});
 const {body,result}=await change(f);ack.mockRestore();expect(result.body.status).toBe('uncertain');
 const read=await f.call('status/'+body.confirmationId);expect(read.body.status).toBe('confirmed');
 expect((await f.call('confirm',body)).body).toEqual(read.body);expect(f.state().writes).toBe(1);
}));
