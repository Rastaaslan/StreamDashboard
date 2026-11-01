import {describe,expect,it} from 'vitest';
// @ts-expect-error The runtime module is native browser JS.
import {sampleMasterClock,estimateMasterNow,masterTimerSeconds} from '../apps/mobile/control/streamcockpit-master-clock.js';

const master='https://192.168.1.15:48136';
const other='https://192.168.1.16:48136';
const timer={running:true,deadline:1_020_000,remaining:20,duration:60};

describe('F00 master timer is a read-only projection of FIXE time',()=>{
 it('ignores a wildly skewed laptop or Android wall clock',()=>{
  const sample=sampleMasterClock(1_000_000,5_000,master);
  expect(estimateMasterNow(sample,10_000,master)).toBe(1_005_000);
  expect(masterTimerSeconds(timer,sample,10_000,master,true)).toBe(15);
  // This calculation never depends on Date.now() or an arbitrary client epoch.
 });
 it('refuses to advance a running timer without a fresh matched host clock',()=>{
  const sample=sampleMasterClock(1_000_000,5_000,master);
  expect(masterTimerSeconds(timer,null,5_100,master,true)).toBeNull();
  expect(masterTimerSeconds(timer,sample,10_000,other,true)).toBeNull();
  expect(masterTimerSeconds(timer,sample,20_001,master,true)).toBeNull();
  expect(masterTimerSeconds(timer,sample,4_999,master,true)).toBeNull();
  expect(masterTimerSeconds({...timer,deadline:NaN},sample,5_010,master,true)).toBeNull();
  expect(masterTimerSeconds({...timer,deadline:null},sample,5_010,master,true)).toBeNull();
 });
 it('leaves paused and disconnected state frozen; it never starts a second timer',()=>{
  const sample=sampleMasterClock(1_000_000,5_000,master);
  expect(masterTimerSeconds({...timer,running:false,remaining:37,deadline:null},sample,6_000,master,true)).toBe(37);
  expect(masterTimerSeconds(timer,sample,80_000,master,false)).toBe(20);
  expect(masterTimerSeconds({...timer,remaining:undefined},sample,80_000,master,false)).toBeNull();
 });
 it('rejects invalid host observations and expired monotonic samples',()=>{
  expect(sampleMasterClock(Number.NaN,100,master)).toBeNull();
  expect(sampleMasterClock(0,100,master)).toBeNull();
  expect(sampleMasterClock(1_000_000,Number.POSITIVE_INFINITY,master)).toBeNull();
  expect(sampleMasterClock(1_000_000,0,'')).toBeNull();
  const sample=sampleMasterClock(1_000_000,0,master);
  expect(estimateMasterNow(sample,15_000,master)).toBe(1_015_000);
  expect(estimateMasterNow(sample,15_001,master)).toBeNull();
 });
});
