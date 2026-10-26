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

[executed on device: dam-server (ee881f3f-7909-4993-a915-04a1d994f366)]