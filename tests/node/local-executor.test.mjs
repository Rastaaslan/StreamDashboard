import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createLocalExecutor} from '../../apps/mobile/control/local-executor.js';
import {createNativeDeviceAudio} from '../../apps/mobile/control/native-device-audio.js';

function fixture(){
 const actions=[{id:'sound-button',type:'sound.play',value:'clip',shortcut:'Control+Alt+Shift+F1'},{id:'chat-button',type:'wizebot.command',value:'!uptime',wizebot:{channel:'test_channel'}}];
 const drafts={},calls=[];let failure=false,allowed=true;
 const store={record:{workspace:'local:fixture',drafts,localAssets:{clip:{}}},reload:async()=>{},view:()=>({data:{configuration:{actions}},sounds:{sounds:[{id:'clip',enabled:true}]}}),close(){},
  async updateDraft(key,update){if(failure)throw new Error('disk');drafts[key]=structuredClone(update(structuredClone(drafts[key])));}};
 const audio={snapshot:()=>({sounds:[],activePlaybacks:[]}),play:async id=>{calls.push(['play',id]);return {status:'succeeded'};},stop:()=>{calls.push(['stop']);return {status:'succeeded'};},dispose(){calls.push(['dispose']);}};
 const services={route:async(path,body)=>{calls.push([path,body]);return path.endsWith('/context')?{connected:true,canSend:true,channel:'test_channel'}:{status:'succeeded'};}};
 const make=()=>createLocalExecutor({store,audio,services,enabled:()=>allowed});
 const body=(id='first-command',action='sound-button')=>({id,action,issuedAt:new Date().toISOString(),workspace:store.record.workspace,expectedAction:actions.find(a=>a.id===action)});
 return {store,drafts,actions,audio,services,calls,make,body,fail:()=>{failure=true;},disable:()=>{allowed=false;}};
}
test('a command is durable before its effect and is not replayed after an agent restart',async()=>{
 const f=fixture();f.audio.play=async()=>{assert.equal(f.drafts.nativeExecutorReceipts['first-command'].receipt.status,'uncertain');f.calls.push('play');return {status:'succeeded'};};
 const first=await f.make().command(f.body());assert.equal(first.status,'succeeded');
 assert.deepEqual(await f.make().command(f.body()),first);assert.deepEqual(f.calls,['play']);
 assert.equal(f.drafts.deviceReceipts.length,1);
 await assert.rejects(f.make().command({...f.body(),action:'chat-button',expectedAction:f.actions[1]}),/Identifiant/);
});
test('a lost receipt, disk failure, wrong workspace and stale definition cannot trigger another effect',async()=>{
 const f=fixture(),executor=f.make();
 f.drafts.nativeExecutorReceipts={'first-command':{signature:JSON.stringify(['sound.play','clip',null]),at:Date.now(),receipt:{status:'uncertain'}}};
 assert.equal((await executor.command(f.body())).status,'uncertain');assert.deepEqual(f.calls,[]);
 await assert.rejects(executor.command({...f.body(),workspace:'local:replacement'}),/identité/);
 await assert.rejects(executor.command({...f.body(),expectedAction:{...f.actions[0],value:'changed'}}),/définition/);
 f.fail();await assert.rejects(executor.command(f.body('second-command')),/disk/);assert.deepEqual(f.calls,[]);
});
test('stop bypasses a pending playback and concurrent receipts survive',async()=>{
 const f=fixture();let resolve;f.audio.play=()=>new Promise(r=>{resolve=r;});
 const executor=f.make(),pending=executor.command(f.body());while(!resolve)await Promise.resolve();
 await assert.rejects(executor.command(f.body('second-command')),/en cours/);
 assert.equal((await executor.command(f.body('stop-command','sound.stop'))).status,'succeeded');
 resolve({status:'succeeded'});await pending;
 assert.equal(Object.keys(f.drafts.nativeExecutorReceipts).length,2);assert.equal(f.drafts.deviceReceipts.length,2);
});
test('role withdrawal and definition changes during account lookup prevent a chat send',async()=>{
 for(const change of ['role','definition']){
  const f=fixture();f.services.route=async path=>{assert.ok(path.endsWith('/context'));if(change==='role')f.disable();else f.actions[1].value='!other';return {connected:true,canSend:true,channel:'test_channel'};};
  const result=await f.make().command(f.body('chat-command','chat-button'));assert.equal(result.status,'failed');assert.deepEqual(f.calls,[]);
 }
});
test('unsupported OBS commands and expired presses remain unavailable in the autonomous workspace',async()=>{
 const f=fixture(),executor=f.make();
 await assert.rejects(executor.command(f.body('other-command','live.start')),/autre appareil/);
 await assert.rejects(executor.command({...f.body(),issuedAt:new Date(Date.now()-121000).toISOString()}),/périmée/);
 f.disable();await assert.rejects(executor.command(f.body()),/rôle/);
 await executor.command(f.body('stop-command','sound.stop'));assert.deepEqual(f.calls,[['stop']]);
});
test('closing a view detaches audio without stopping the agent and a replaced workspace is refused',async()=>{
 const f=fixture(),calls=[],bridge={autonomousRequest:async(operation,body)=>{calls.push([operation,body]);return {workspace:f.store.record.workspace,sounds:{activePlaybacks:[{soundId:'clip'}]}};}};
 const view=createNativeDeviceAudio({bridge,store:f.store});await view.refresh();assert.equal(view.snapshot().activePlaybacks.length,1);view.dispose();assert.equal(calls.length,1);
 bridge.autonomousRequest=async()=>({workspace:'other'});const other=createNativeDeviceAudio({bridge,store:f.store});await assert.rejects(other.refresh(),/Identité/);assert.equal(other.snapshot().available,false);
});

test('Stop received during the durable preparation cancels a playback that has not started yet',async()=>{
 const f=fixture(),write=f.store.updateDraft;let unblock,entered=false;
 f.store.updateDraft=async(key,update)=>{await write(key,update);if(!entered&&key==='nativeExecutorReceipts'){entered=true;await new Promise(resolve=>{unblock=resolve;});}};
 const executor=f.make(),play=executor.command(f.body());while(!unblock)await Promise.resolve();
 await executor.command(f.body('stop-command','sound.stop'));unblock();
 assert.equal((await play).status,'failed');assert.deepEqual(f.calls,[['stop']]);
});
