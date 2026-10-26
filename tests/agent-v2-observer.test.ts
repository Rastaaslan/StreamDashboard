import {describe,it,expect} from 'vitest';
import {requireLoopbackObsUrl,observeObsHealth} from '../apps/agent/src/read-only-observer.js';
describe('read-only OBS observer',()=>{
 it('accepts only local OBS websocket endpoints',()=>{
  expect(requireLoopbackObsUrl('ws://127.0.0.1:4455/')).toBe('ws://127.0.0.1:4455/');
  expect(()=>requireLoopbackObsUrl('ws://192.168.1.10:4455')).toThrow('loopback');
  expect(()=>requireLoopbackObsUrl('wss://twitch.example:443')).toThrow('loopback');
  expect(()=>requireLoopbackObsUrl('ws://user:pass@localhost:4455')).toThrow('loopback');
 });
 it('makes a short-lived snapshot using ONLY read operations',async()=>{
  const calls:string[]=[];const client={async call(kind:'GetStats'|'GetStreamStatus'){
    calls.push(kind);return kind==='GetStats'?{outputSkippedFrames:2,renderTotalFrames:5000}:{outputActive:true,outputBytes:400};
  }};
  const obs=await observeObsHealth(client,'pc-stream',9,1000);
  expect(calls.sort()).toEqual(['GetStats','GetStreamStatus']);
  expect(obs).toMatchObject({sourceDeviceId:'pc-stream',revision:9,observedAt:1000,staleAt:9000,
    payload:{active:true,outputBytes:400,skippedFrames:2,renderedFrames:5000}});
 });
 it('rejects malformed OBS status without fabricating health',async()=>{
  const client={async call(kind:'GetStats'|'GetStreamStatus'){return kind==='GetStats'?{}:{outputActive:'maybe'};}};
  await expect(observeObsHealth(client,'pc-stream',0,1000)).rejects.toThrow('Invalid OBS status');
 });
});

[executed on device: dam-server (ee881f3f-7909-4993-a915-04a1d994f366)]