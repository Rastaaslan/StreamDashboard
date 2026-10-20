import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUuid} from '../../apps/mobile/shared/planning-engine.js';

test('UUID generation supports native and getRandomValues-only browser contexts',()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto');
 try{
  let calls=0;
  Object.defineProperty(globalThis,'crypto',{configurable:true,value:{randomUUID(){calls++;assert.equal(this,globalThis.crypto);return 'native-id';}}});
  assert.equal(randomUuid(),'native-id');assert.equal(calls,1);
  Object.defineProperty(globalThis,'crypto',{configurable:true,value:{getRandomValues(bytes){assert.equal(this,globalThis.crypto);bytes.fill(255);return bytes;}}});
  assert.equal(randomUuid(),'ffffffff-ffff-4fff-bfff-ffffffffffff');
  Object.defineProperty(globalThis,'crypto',{configurable:true,value:undefined});
  assert.throws(()=>randomUuid(),/Génération sécurisée/);
 }finally{Object.defineProperty(globalThis,'crypto',descriptor);}
});

test('native async results retain request correlation when randomUUID is absent',async()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto');
 const add=Object.getOwnPropertyDescriptor(globalThis,'addEventListener');
 const source=globalThis.crypto,bus=new EventTarget(),received=[];
 try{
  Object.defineProperty(globalThis,'crypto',{configurable:true,value:{getRandomValues:source.getRandomValues.bind(source)}});
  Object.defineProperty(globalThis,'addEventListener',{configurable:true,value:bus.addEventListener.bind(bus)});
  const {callDeviceBridge}=await import('../../apps/mobile/control/device-bridge.js');
  const bridge={requestAsync(raw){received.push(JSON.parse(raw));return '{"ok":true}';}};
  const first=callDeviceBridge(bridge,'googleTest'),second=callDeviceBridge(bridge,'twitchTest');
  assert.notEqual(received[0].id,received[1].id);
  for(const r of received.toReversed()){
   assert.match(r.id,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
   bus.dispatchEvent(new CustomEvent('provider-result',{detail:{id:r.id,result:JSON.stringify({ok:true,method:r.method})}}));
  }
  assert.deepEqual(await Promise.all([first,second]),[{ok:true,method:'googleTest'},{ok:true,method:'twitchTest'}]);
 }finally{
  Object.defineProperty(globalThis,'crypto',descriptor);
  if(add)Object.defineProperty(globalThis,'addEventListener',add);else delete globalThis.addEventListener;
 }
});
