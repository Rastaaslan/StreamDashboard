import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SETUPS, migrateInstallation, validateInstallation, planInstallationChange, resolveCapability, createInstallationStore } from '../../apps/mobile/shared/installation.js';

const create = (platform='windows',role='stream',pairedEndpoint='') => migrateInstallation({id:'device-1',platform,legacy:{name:'Test',role,configured:true},pairedEndpoint});
const memory = () => { const map = new Map(); return {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),map}; };
for (const preset of Object.keys(SETUPS)) {
  test(`${preset}: common model, services, OBS absence and reconnect`, () => {
    const android=preset==='android-only', base=create(android?'android':'windows',android?'mobile':'stream');
    const {next}=planInstallationChange(base,{preset},base.revision);
    assert.equal(next.preset,preset);
    for(const capability of ['cloud','planning','chat','viewer','audio','storage']) {
      assert.equal(resolveCapability(next,capability,{'device-1':{connected:true}}).status,'available');
      assert.equal(resolveCapability(next,capability,{'device-1':{connected:false}}).reason,'offline');
      assert.equal(resolveCapability(next,capability,{'device-1':{connected:true}}).status,'available');
    }
    assert.equal(resolveCapability(next,'obs',{'device-1':{connected:true,obsConnected:true}}).status,android?'unavailable':'available');
    if(!android)assert.equal(resolveCapability(next,'obs',{'device-1':{connected:true,obsConnected:false}}).reason,'obs-disconnected');
    assert.equal(resolveCapability(next,'cloud',{'device-1':{connected:true,obsConnected:false}}).status,'available');
  });
}
test('RC11.7 control profile and unknown compatible fields survive every Windows setup transition',()=>{
  let value=create('windows','control','https://example.test:48133');
  value.extension={future:true};const original=structuredClone(value);
  for(const preset of ['single-pc','single-pc-deck','dual-pc','dual-pc-deck','custom','single-pc']) {
    value=planInstallationChange(value,{preset},value.revision).next;
    assert.deepEqual(value.extension,original.extension);assert.deepEqual(value.devices,original.devices);
    assert.equal(value.runtimeProfile,'device-runtime');assert.equal(value.localDeviceId,'device-1');
  }
});
test('several controllers never choose another executor silently, including disabled and permission failures',()=>{
  let value=create();
  value=planInstallationChange(value,{device:{id:'second',name:'Second',platform:'windows',roles:['controller','obs-executor'],capabilities:['obs','clips'],enabled:true,endpoint:'https://example.test'}},0).next;
  value=planInstallationChange(value,{routes:{...value.routes,obs:'second'}},1).next;
  assert.equal(resolveCapability(value,'obs',{'device-1':{connected:true,obsConnected:true}}).reason,'not-observed');
  assert.equal(resolveCapability(value,'obs',{second:{connected:true,obsConnected:true,permissions:[]}}).reason,'permission');
  value=planInstallationChange(value,{disableDeviceId:'second'},2).next;
  assert.equal(resolveCapability(value,'obs',{second:{connected:true,obsConnected:true}}).reason,'disabled');
  assert.equal(value.devices.find(d=>d.id==='second').endpoint,'https://example.test');
});
test('agent stopped leaves autonomous services available; unsupported Android roles fail',()=>{
  const base=create();const {next,restart}=planInstallationChange(base,{roles:['services','controller','display','audio']},0);
  assert.equal(restart,true);assert.equal(resolveCapability(next,'obs').reason,'no-target');
  assert.equal(resolveCapability(next,'chat',{'device-1':{connected:true}}).status,'available');
  assert.throws(()=>planInstallationChange(create('android','mobile'),{roles:['obs-executor']},0),/OBS/);
});
test('transaction, stale writer, restore and storage failure preserve current configuration',async()=>{
  const storage=memory(),base=create();const store=createInstallationStore(storage,()=>base,work=>work());
  await store.change({preset:'dual-pc',name:'After'},0);
  await assert.rejects(store.change({name:'Stale'},0),/modifiée ailleurs/);
  const restored=await store.restore(1);assert.equal(restored.revision,2);assert.equal(restored.devices[0].name,'Test');
  const saved=storage.setItem;storage.setItem=(key,value)=>{if(key==='sd2.installation.v2')throw Error('full');saved(key,value);};
  await assert.rejects(store.change({name:'Never committed'},2),/full/);
  assert.equal(store.read().devices[0].name,'Test');
});
test('invalid and future schemas are diagnosed without silently resetting data',()=>{
  const base=create();assert.throws(()=>validateInstallation({...base,version:3}));
  assert.throws(()=>validateInstallation({...base,devices:[...base.devices,base.devices[0]]}));
  assert.throws(()=>planInstallationChange(base,{device:{id:'other',name:'Invalid',platform:'windows',roles:[],capabilities:[],enabled:true,endpoint:'https://user:secret@example.test'}},0));
  const storage=memory();storage.setItem('sd2.installation.v2','broken');
  assert.throws(()=>createInstallationStore(storage,()=>base).read());assert.equal(storage.getItem('sd2.installation.v2'),'broken');
});


test('authenticated device identity survives address changes without copying private descriptor fields',async()=>{
 const {associateInstallationDevice,publicInstallationDevice}=await import('../../apps/mobile/shared/installation.js');
 let state=create();
 const peer={id:'physical-peer',name:'OBS peer',platform:'windows',roles:['obs-executor'],capabilities:['obs','clips'],enabled:true,privateNote:'secret'};
 assert.equal(publicInstallationDevice(peer).privateNote,undefined);
 state=planInstallationChange(state,associateInstallationDevice(state,'https://first.test',peer),state.revision).next;
 state=planInstallationChange(state,associateInstallationDevice(state,'https://second.test',peer),state.revision).next;
 assert.equal(state.devices.length,2);assert.equal(state.routes.obs,'physical-peer');
 assert.equal(state.devices[1].endpoint,'https://second.test');assert.equal(state.devices[1].privateNote,undefined);
 assert.throws(()=>associateInstallationDevice(state,'https://second.test',{...peer,id:state.localDeviceId}),/local/);
});

test('Android recovery preserves the prior backup after an interrupted change and checks restored identity',async()=>{
 const storage=memory(),base=create('android','mobile'),store=createInstallationStore(storage,()=>base,work=>work());
 await store.change({name:'Before crash'},0);
 const saved=storage.setItem;let failOnce=true;
 storage.setItem=(key,value)=>{if(key==='sd2.installation.v2'&&failOnce){failOnce=false;throw Error('disk full');}saved(key,value);};
 await assert.rejects(store.change({name:'Never committed'},1),/disk full/);
 assert.equal(store.read().devices[0].name,'Before crash');
 assert.deepEqual(JSON.parse(storage.getItem('sd2.installation.v2.backup')),base);
 assert.equal((await store.restore(1)).devices[0].name,base.devices[0].name);
 const other=create('android','mobile');other.localDeviceId='other';other.devices[0].id='other';other.routes={};
 saved('sd2.installation.v2.backup',JSON.stringify(other));
 await assert.rejects(store.restore(2),/autre appareil/);
});
for(const platform of ['windows','android'])test(platform+': removed roles disable only their capabilities and a fresh peer observation wins',()=>{
 const base=create(platform,platform==='android'?'mobile':'stream');
 const {next}=planInstallationChange(base,{roles:['controller','services']},0);
 const observed={[base.localDeviceId]:{connected:true}};
 for(const capability of ['audio','viewer','chat'])assert.equal(resolveCapability(next,capability,observed).reason,'role-stopped');
 assert.equal(resolveCapability(next,'planning',observed).status,'available');
 assert.equal(resolveCapability(base,'audio',{[base.localDeviceId]:{connected:true,roles:['services']}}).reason,'role-stopped');
});
