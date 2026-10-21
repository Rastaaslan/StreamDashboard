import {describe,it,expect} from 'vitest';
import {discoveryRequest,discoveryResponse,discoveryHint,listenForPeers,discoverPeers} from '../apps/server/src/peer-discovery.js';
const nonce='ab'.repeat(16),device={id:'physical-phone',name:'Téléphone',platform:'android' as const,port:48136};
describe('LAN discovery hints',()=>{
 it('binds replies to the nonce and source address without trusting advertised URLs or credentials',()=>{
  const query=discoveryRequest(nonce),reply=discoveryResponse(query,device)!;
  expect(reply.length).toBeLessThan(query.length);expect(discoveryHint(reply,'192.168.1.4',nonce)).toEqual({...device,endpoint:'https://192.168.1.4:48136'});
  expect(discoveryHint(reply,'8.8.8.8',nonce)).toBeUndefined();expect(discoveryHint(reply,'192.168.1.4','cd'.repeat(16))).toBeUndefined();
  expect(discoveryResponse(Buffer.from('SDNEXT21-DISCOVER:'+nonce),device)).toBeUndefined();
  expect(discoveryHint(Buffer.from(JSON.stringify({...JSON.parse(reply.toString()),port:999999})),'192.168.1.4',nonce)).toBeUndefined();
 });
 it('discovers a real UDP responder and stops advertising immediately when sharing is disabled',async()=>{
  let active=true;const listener=await listenForPeers(()=>active?device:undefined,{port:0,host:'127.0.0.1',allowLoopback:true});
  try{const settings={port:listener.port,targets:['127.0.0.1'],allowLoopback:true,durationMs:70};
   const found=await discoverPeers(settings);expect(found).toEqual([{...device,endpoint:'https://127.0.0.1:48136'}]);
   active=false;expect(await discoverPeers(settings)).toEqual([]);
  }finally{listener.close();}
 });
});
