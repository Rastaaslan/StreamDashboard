import {describe,expect,it} from 'vitest';
import {createDjiBatteryWarningTracker} from '../apps/mobile/control/dji-battery-warnings.js';
interface MockTx { slot?:number;connected?:boolean;rawGauge?:number|null;charging?:boolean|null }
interface MockRx { rawGauge?:number|null }
function payload(now:number,opts:{tx1?:MockTx;tx2?:MockTx;rx?:MockRx}={}) {
 const tx1={slot:1,connected:false,rawGauge:null,charging:null};
 const tx2={slot:2,connected:true,rawGauge:3,charging:false};
 return {status:'ok',receivedAt:new Date(now).toISOString(),observation:{
   status:'ok',source:'dji-mic3-rx-winusb',observedAt:new Date(now).toISOString(),
   validFrames:31,tx:[{...tx1,...opts.tx1},{...tx2,...opts.tx2}],rx:{rawGauge:1,...opts.rx},
 }};
}
describe('Mic 3 live battery alerts',()=>{
 it('does not alert without an actual active stream',()=>{
  let at=10_000;const tracker=createDjiBatteryWarningTracker({now:()=>at});
  expect(tracker.check({streaming:false,relay:payload(at,{tx2:{rawGauge:7}})})).toEqual([]);
 });
 it('alerts on actual TX2 linked-to-disconnected transition, not on initial absence',()=>{
  let at=200_000;const tracker=createDjiBatteryWarningTracker({now:()=>at});
  expect(tracker.check({streaming:true,relay:payload(at,{tx2:{connected:false,rawGauge:null}})})).toEqual([]);
  at+=2_000;expect(tracker.check({streaming:true,relay:payload(at)})).toEqual([]);
  at+=2_000;const alerts=tracker.check({streaming:true,relay:payload(at,{tx2:{connected:false,rawGauge:null}})});
  expect(alerts).toMatchObject([{code:'tx2-disconnected',severity:'critical'}]);
  expect(alerts[0].message).toContain('pendant le live');
  at+=1_000;expect(tracker.check({streaming:true,relay:payload(at,{tx2:{connected:false,rawGauge:null}})})).toEqual([]);
 });
 it('never produces invented percentage wording for 6/7 and 7/7 levels',()=>{
  let at=200_000;const tracker=createDjiBatteryWarningTracker({now:()=>at});
  const alerts=tracker.check({streaming:true,relay:payload(at,{tx2:{rawGauge:6},rx:{rawGauge:7}})});
  expect(alerts.map(x=>x.code)).toEqual(['tx2-gauge-6','rx-gauge-7']);
  expect(alerts.every(x=>/non calibré/.test(x.message))).toBe(true);
  expect(alerts.map(x=>x.message).join(' ')).not.toContain('10 %');
  at+=10_000;expect(tracker.check({streaming:true,relay:payload(at,{tx2:{rawGauge:6},rx:{rawGauge:7}})})).toEqual([]);
 });
 it('alerts when previously valid USB telemetry expires during live, once',()=>{
  let at=500_000;const tracker=createDjiBatteryWarningTracker({now:()=>at});
  tracker.check({streaming:true,relay:payload(at)});
  at+=94_000;expect(tracker.check({streaming:true,relay:null})).toEqual([]);
  at+=2_000;expect(tracker.check({streaming:true,relay:null})).toMatchObject([{code:'telemetry-lost'}]);
  at+=2_000;expect(tracker.check({streaming:true,relay:null})).toEqual([]);
 });
 it('reset on stop and never treats stale samples as fresh wireless status',()=>{
  let at=800_000;const tracker=createDjiBatteryWarningTracker({now:()=>at});
  tracker.check({streaming:true,relay:payload(at)});
  at+=100_000;tracker.check({streaming:false,relay:null});
  at+=100_000;expect(tracker.check({streaming:true,relay:null})).toEqual([]);
  const delayed=payload(at-100_000,{tx2:{rawGauge:7}});
  expect(tracker.check({streaming:true,relay:delayed})).toEqual([]);
 });
 it('does not spam once per UI render, and warns again after cooldown',()=>{
  let at=100_000;const tracker=createDjiBatteryWarningTracker({now:()=>at,cooldownMs:300_000});
  expect(tracker.check({streaming:true,relay:payload(at,{tx2:{rawGauge:7}})})).toHaveLength(1);
  at+=1000;expect(tracker.check({streaming:true,relay:payload(at,{tx2:{rawGauge:7}})})).toHaveLength(0);
  at+=310_000;expect(tracker.check({streaming:true,relay:payload(at,{tx2:{rawGauge:7}})})).toHaveLength(1);
 });
});
