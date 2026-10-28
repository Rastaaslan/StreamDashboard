import {describe,it,expect} from 'vitest';
import {runReadOnlyAgent} from '../apps/agent/src/read-only-runner.js';
describe('Agent read-only runner',()=>{
 it('emits only confirmed observations, stops on abort',async()=>{
  const controller=new AbortController();const names:string[]=[];const records:unknown[]=[];
  await runReadOnlyAgent({
   client:{async call(type){names.push(type);return type==='GetStats'?{outputSkippedFrames:0}:{outputActive:false};}},
   deviceId:'pc-stream',signal:controller.signal,now:()=>1234,
   async sleep(){controller.abort();},
   emit(value){records.push(value);},
   reportUnreachable(){throw Error('unexpected unreachable');},
  });
  expect(names.sort()).toEqual(['GetStats','GetStreamStatus']);
  expect(records).toHaveLength(1);
 });
 it('does not publish false healthy state on failed OBS connection',async()=>{
  const controller=new AbortController(),records:unknown[]=[],errors:string[]=[];
  await runReadOnlyAgent({
   client:{async call(){throw new Error('secret: this must never be sent');}},
   deviceId:'pc-stream',signal:controller.signal,now:()=>1234,
   async sleep(){controller.abort();},
   emit(value){records.push(value);},reportUnreachable(code){errors.push(code)},
  });
  expect(records).toHaveLength(0);expect(errors).toEqual(['OBS_READ_UNAVAILABLE']);
 });
});

it('stops promptly if OBS never responds instead of blocking service shutdown',async()=>{
 const stop=new AbortController(),results:unknown[]=[];
 const task=runReadOnlyAgent({
  client:{call:async()=>new Promise<never>(()=>{})},
  deviceId:'pc-stream',signal:stop.signal,now:Date.now,
  sleep:async()=>{throw Error('should not reach sleep after abort')},
  emit:value=>results.push(value),
  reportUnreachable:()=>{throw Error('aborted read should not report healthy')},
  readTimeoutMs:10000,
 });
 setTimeout(()=>stop.abort(),20);
 await Promise.race([task,new Promise<never>((_,reject)=>
  setTimeout(()=>reject(Error('SHUTDOWN_STALLED')),700))]);
 expect(results).toHaveLength(0);
});
it('times out an unresponsive OBS read without creating connected snapshots',async()=>{
 const stop=new AbortController(),events:unknown[]=[],diagnostics:string[]=[];
 await runReadOnlyAgent({
  client:{call:async()=>new Promise<never>(()=>{})},
  deviceId:'pc-stream',signal:stop.signal,now:Date.now,
  sleep:async()=>{stop.abort()},
  emit:value=>events.push(value),reportUnreachable:code=>diagnostics.push(code),
  readTimeoutMs:100,
 });
 expect(events).toEqual([]);
 expect(diagnostics).toEqual(['OBS_READ_UNAVAILABLE']);
});
