import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeviceExecutor} from '../../apps/mobile/control/device-executor.js';
import {migrateInstallation} from '../../apps/mobile/shared/installation.js';
import {DEVICE_PERMISSIONS} from '../../apps/mobile/shared/device-permissions.js';
import {createActionRouter} from '../../apps/mobile/control/action-routing.js';

async function fixture(){
 const model=migrateInstallation({id:'phone',platform:'android'}),record={drafts:{}},sounds=[{id:'jingle',name:'Jingle',enabled:true}];
 const bundle={data:{configuration:{actions:[]},host:{state:{obs:{connected:false}}}},sounds:{sounds}};
 let saved,enabled=false,fail=false,playCount=0,stopCount=0,viewerCount=0,gate,release;
 const bridge={call:async(operation,value)=>{
  if(operation==='load')return structuredClone(saved);
  if(operation==='save'){saved=structuredClone(value.value);return true;}
  if(operation==='start')enabled=true;if(operation==='stop')enabled=false;
  return {enabled,urls:['https://phone.local:48136'],fingerprint:'a'.repeat(64)};
 },listen(){}};
 const store={record,reload:async()=>{},view:()=>structuredClone(bundle),updateDraft:async(key,update)=>{if(fail)throw new Error('Disk full');record.drafts[key]=structuredClone(update(record.drafts[key]));}};
 const runtime={owner:{store},audio:{play:async()=>{playCount++;if(gate)await gate;return {status:'succeeded'};},stop:()=>{stopCount++;release?.();return {status:'succeeded'};},snapshot:()=>({sounds,activePlaybacks:[]})}};
 const open=()=>createDeviceExecutor({bridge,installation:()=>model,runtime:async()=>runtime,openViewers:()=>{viewerCount++;return true;}});
 let executor=await open();await executor.localRequest('/api/v2/settings',{expectedRevision:'0',remoteEnabled:true},'PUT');
 const pair=await executor.localRequest('/api/v1/remote/pairing',{permissions:['observe','audio']},'POST');
 const raw=(path,body,token='',method=body?'POST':'GET')=>executor.handle({path,method,body:body?JSON.stringify(body):'',authorization:token?'Device '+token:'',remote:'test-peer'});
 const associated=await raw('/api/v1/remote/pair',{id:pair.id,code:pair.code,name:'PC'});assert.equal(associated.status,200);
 const credential=associated.body.credential;
 const request=(path,body,method)=>raw(path,body,credential,method);
 const command=(id='command_0001',extra={})=>request('/api/v2/actions',{id,issuedAt:new Date().toISOString(),action:'sound_jingle',...extra});
 return {model,record,executor,raw,request,command,pair,credential,get viewers(){return viewerCount;},get plays(){return playCount;},get stops(){return stopCount;},resume:()=>release?.(),failStore:()=>{fail=true;},hold:()=>{gate=new Promise(resolve=>{release=resolve;});},restart:async()=>{executor=await open();}};
}
test('Android pairing is single-use, credentials stay private and permissions precede effects',async()=>{
 const f=await fixture();assert.equal((await f.raw('/api/v1/remote/pair',{id:f.pair.id,code:f.pair.code})).status,401);
 assert.equal((await f.raw('/api/v2/actions',{id:'command_fake',action:'sound_jingle'})).status,401);
 const state=await f.request('/api/v2/autonomy');assert.equal(state.body.workspace,'device:phone');assert.ok(!JSON.stringify(state).includes(f.credential));
 const devices=await f.executor.localRequest('/api/v1/remote/devices');assert.ok(!JSON.stringify(devices).includes(f.credential));assert.equal(f.plays,0);
});
test('a Windows-style routed action executes on the physical Android identity and records one receipt',async()=>{
 const f=await fixture(),pc=migrateInstallation({id:'pc',platform:'windows'}),definition={id:'sound_jingle',label:'Jingle',type:'sound.play',value:'jingle',color:'green',shortcut:''};
 pc.devices.push({...f.model.devices[0],endpoint:'https://phone.local:48136'});pc.actionRoutes=[{workspace:'pc-space',actionId:'local-trigger',deviceId:'phone',definition}];
 const router=createActionRouter({installation:()=>pc,workspace:()=> 'pc-space',localEndpoint:'',credential:async()=>f.credential,request:async(path,body,method)=>{const r=await f.request(path,body,method);if(r.status>=400)throw Error(r.body.error.message);return r.body;}});
 const result=await router.execute({id:'local-trigger'},{id:'command_router',issuedAt:new Date().toISOString()});assert.equal(result.status,'succeeded');assert.equal(result.deviceId,'phone');assert.equal(f.plays,1);
});
test('replaying a receipt after Android restart never plays twice; another payload cannot reuse its ID',async()=>{
 const f=await fixture();assert.equal((await f.command()).body.status,'succeeded');await f.restart();assert.equal((await f.command()).body.status,'succeeded');assert.equal(f.plays,1);
 assert.equal((await f.command('command_0001',{action:'sound.stop'})).body.error.code,'COMMAND_ID_REUSED');assert.equal(f.stops,0);
});
test('a stopped role and failed durable storage prevent audio effects',async()=>{
 const f=await fixture();f.model.devices[0].roles=[];assert.equal((await f.command()).body.error.code,'DEVICE_ROLE_STOPPED');f.model.devices[0].roles=['audio'];f.failStore();assert.equal((await f.command()).status,400);assert.equal(f.plays,0);
});
test('Stop bypasses a pending decoder and both durable receipts survive',async()=>{
 const f=await fixture();f.hold();const play=f.command();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.plays,1);
 assert.equal((await f.command('command_stop',{action:'sound.stop'})).body.status,'succeeded');await play;assert.equal(f.stops,1);assert.deepEqual(Object.keys(f.record.drafts.executorReceipts).sort(),['command_0001','command_stop']);
});
test('revoking an Android caller or removing audio permission refuses future effects',async()=>{
 const f=await fixture(),device=(await f.executor.localRequest('/api/v1/remote/devices'))[0];
 await f.executor.localRequest('/api/v1/remote/devices/'+device.id+'/permissions',{expectedPermissions:device.permissions,permissions:['observe']},'PUT');
 assert.equal((await f.command()).status,403);assert.equal(f.plays,0);
 await f.executor.localRequest('/api/v1/remote/devices/'+device.id+'/revoke',{},'POST');assert.equal((await f.request('/api/v2/device')).status,401);
});
test('permission revocation is not blocked by pending audio and repeated requests leave Stop available',async()=>{
 const f=await fixture();f.hold();const play=f.command();await new Promise(resolve=>setImmediate(resolve));
 assert.equal((await f.command('command_busy')).status,429);
 const device=(await f.executor.localRequest('/api/v1/remote/devices'))[0];
 await f.executor.localRequest('/api/v1/remote/devices/'+device.id,undefined,'DELETE');
 assert.equal((await f.command('command_revoked')).status,401);
 // Local Stop is always available even after the remote controller is revoked.
 f.model.devices[0].roles=[];const snapshot=await f.raw('/api/v2/autonomy');assert.equal(snapshot.status,401);
 // Finish the simulated decoder without needing the revoked caller.
 f.resume();await play; // finish the existing operation, without sending another command
 assert.equal(f.plays,1);
});

test('remote viewer opening requires chat permission, rejects arbitrary URLs and never repeats a receipt',async()=>{
 const f=await fixture(),viewer={twitch:'some_channel',youtube:'Abc_1234-XY',source:'twitch'};
 assert.equal((await f.command('command_view',{action:'viewer.open',viewer})).status,403);
 const device=(await f.executor.localRequest('/api/v1/remote/devices'))[0];
 await f.executor.localRequest('/api/v1/remote/devices/'+device.id+'/permissions',{expectedPermissions:device.permissions,permissions:Object.keys(DEVICE_PERMISSIONS)},'PUT');
 assert.equal((await f.command('command_bad_view',{action:'viewer.open',viewer:{...viewer,url:'https://untrusted.invalid'}})).status,400);
 assert.equal((await f.command('command_view',{action:'viewer.open',viewer})).body.status,'succeeded');
 await f.restart();assert.equal((await f.command('command_view',{action:'viewer.open',viewer})).body.status,'succeeded');assert.equal(f.viewers,1);
 f.model.devices[0].roles=[];assert.equal((await f.command('command_view_stopped',{action:'viewer.open',viewer})).body.error.code,'DEVICE_ROLE_STOPPED');
});
