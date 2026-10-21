import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPeerRequest,fingerprint,secureOrigin} from '../../apps/mobile/control/peer-request.js';
const pin='ab'.repeat(32);
test('agent identity accepts only full fingerprints and local HTTPS origins',()=>{
 assert.equal(fingerprint(pin.toUpperCase().match(/../g).join(':')),pin);
 for(const value of ['',pin.slice(1),'gg'.repeat(32)])assert.throws(()=>fingerprint(value));
 for(const value of ['http://pc:48136','https://user:pass@pc','https://pc/?x','https://public.example','https://100.128.1.1'])assert.throws(()=>secureOrigin(value));
 assert.equal(secureOrigin('https://100.100.1.1:48136'),'https://100.100.1.1:48136');
});
test('cleartext remote origins never receive credentials, while local services remain independent',async()=>{
 const calls=[],peers=createPeerRequest({fetcher:async(...args)=>{calls.push(args);return new Response('{}');}});
 await assert.rejects(peers.request('http://pc:48133/api/v2/state',{token:'secret'}),/HTTP/);assert.equal(calls.length,0);
 await peers.request('http://127.0.0.1:48133/api/v2/state');assert.equal(calls.length,1);
});
test('Windows carries credentials through the native pinned session and never retries failure',async()=>{
 const calls=[],peers=createPeerRequest({desktop:{requestPeer:async value=>{calls.push(value);return {ok:false,error:{message:'wrong pin'}};}},fetcher:()=>{throw Error('browser transport forbidden');}});
 await assert.rejects(peers.request('https://pc:48136/api/v2/actions',{body:{id:'once'},token:'secret'}),/wrong pin/);
 assert.equal(calls.length,1);assert.equal(calls[0].credential,'secret');assert.equal(calls[0].body,'{"id":"once"}');
});
function android(handler){const events=new EventTarget(),calls=[];const native={postMessage(raw){const value=JSON.parse(raw);calls.push(value);queueMicrotask(()=>{const result=handler(value);if(result!==undefined)events.dispatchEvent(new CustomEvent('peer-result',{detail:{id:value.id,result:JSON.stringify(result)}}));});}};return {calls,peers:createPeerRequest({native,events,fetcher:()=>{throw Error('no web TLS override');}})};}
test('Android uploads audio in bounded ordered chunks and discards its staging file',async()=>{
 const data=new Uint8Array(180000).fill(41),chunks=[];
 const {peers,calls}=android(value=>{
  if(value.operation==='uploadBegin')return {ok:true,value:'upload-1'};
  if(value.operation==='uploadAppend'){assert.equal(value.offset,chunks.reduce((n,x)=>n+x.length,0));chunks.push(Buffer.from(value.chunk,'base64'));return {ok:true,value:true};}
  if(value.operation==='request')return {ok:true,status:201,body:'{"id":"sound-1"}'};
  return {ok:true,value:true};
 });
 const response=await peers.request('https://pc:48136/api/v2/sounds/upload',{method:'POST',body:new Blob([data]),token:'secret'});
 assert.equal(response.status,201);assert.deepEqual(Buffer.concat(chunks),Buffer.from(data));assert.ok(chunks.every(c=>c.length<=65536));
 assert.equal(calls.at(-1).operation,'uploadDiscard');assert.equal(calls.filter(c=>c.operation==='request').length,1);
});
test('Android correlates concurrent replies and reports trust CAS errors',async()=>{
 const {peers}=android(value=>value.operation==='fingerprint'?{ok:true,value:pin}:{ok:false,error:{message:'changed elsewhere'}});
 assert.deepEqual(await Promise.all([peers.getFingerprint('https://one:48136'),peers.getFingerprint('https://two:48136')]),[pin,pin]);
 await assert.rejects(peers.trust('https://one:48136','cd'.repeat(32),pin),/changed elsewhere/);
});
