import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDeviceCredentials } from '../../apps/mobile/control/device-credentials.js';

test('RC11.7 migration binds its credential only to the previously selected origin',async()=>{
 const map=new Map(),legacy={value:'old-secret'},storage={getItem:()=> 'https://one.test'};
 const desktop={getControllerCredential:async()=>legacy.value,setControllerCredential:async value=>{legacy.value=value;},getDeviceCredential:async server=>map.get(server)||'',setDeviceCredential:async(server,value)=>{map.set(server,value);}};
 const credentials=createDeviceCredentials({desktop,storage});
 assert.equal(await credentials.initialize(),'old-secret');
 assert.equal(await credentials.get('https://one.test'),'old-secret');
 assert.equal(await credentials.get('https://two.test'),'');
 await credentials.set('new-secret','https://two.test');
 assert.equal(await credentials.get('https://one.test'),'old-secret');assert.equal(await credentials.get('https://two.test'),'new-secret');
 await assert.rejects(credentials.get('https://user:password@three.test'));
});
test('a failed secure write cannot replace the previous active credential',async()=>{
 let active='original';
 const desktop={getControllerCredential:async()=>active,setControllerCredential:async value=>{active=value;},getDeviceCredential:async()=>'',setDeviceCredential:async()=>{throw Error('locked');}};
 const credentials=createDeviceCredentials({desktop,storage:{getItem:()=>null}});
 await assert.rejects(credentials.set('replacement','https://two.test'),/locked/);assert.equal(active,'original');
});
