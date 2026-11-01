import {expect, it} from 'vitest';
import {ObsHealthObservation} from '../apps/server/src/streamcockpit-health/obs-observation.js';
import {mapHostHealth} from '../apps/server/src/streamcockpit-health/host-adapter.js';
import {diagnoseHealth} from '../packages/core/src/streamcockpit-health/index.js';

const device = {id:'fixe', platform:'windows', enabled:true, roles:['obs-executor']};
const connected = {connected:true, connectionStatus:'connected'};
function fixture() {
  let wall = 1700000000000, mono = 0;
  const obs = new ObsHealthObservation(()=>wall, ()=>mono);
  return {obs, time:()=>wall, advance:(ms:number)=>{wall+=ms;mono+=ms;}, jump:(ms:number)=>{wall+=ms;},
    report:()=>diagnoseHealth(mapHostHealth({device,obs},wall),wall).diagnostics[1]};
}
it('only receipts produce evidence; reads preserve timestamps, expire and never infer live',()=>{
  const f=fixture(); expect(f.report().status).toBe('unknown');
  f.obs.observe(connected);
  expect(f.report()).toMatchObject({status:'healthy',code:'connected',observedAt:f.time(),receivedAt:f.time()});
  const at=f.time(); f.advance(15000);
  expect(f.report()).toMatchObject({status:'healthy',observedAt:at,ageMs:15000});
  f.advance(1); expect(f.report()).toMatchObject({status:'unknown',freshness:'stale',observedAt:at});
  f.obs.observe({...connected,connected:false,connectionStatus:'error'});
  expect(f.report()).toMatchObject({status:'critical',code:'disconnected'});
  f.advance(15001);expect(f.report()).toMatchObject({status:'unknown',freshness:'stale'});
  f.obs.observe({connected:false,connectionStatus:'connecting'});expect(f.report().status).toBe('unknown');
  f.obs.observe(connected);expect(f.report().status).toBe('healthy');
  const sample=f.obs.read(f.time())!;sample.data.connected=false;
  expect(f.report().status).toBe('healthy');
  expect(Object.keys(sample.data)).toEqual(['connected']);
});
it.each([undefined,{...device,platform:'android'},{...device,platform:'linux'},{...device,enabled:false},{...device,roles:['controller']}])('rejects a non executor identity %j',candidate=>{
  const f=fixture();f.obs.observe(connected);
  expect(diagnoseHealth(mapHostHealth({device:candidate,obs:f.obs},f.time()),f.time()).diagnostics.every(d=>d.status==='unknown')).toBe(true);
});
it('rejects client snapshots, even with forged provenance/timestamps; a new recorder is empty',()=>{
  const f=fixture();f.obs.observe(connected);
  for(const obs of [connected,{...f.obs.read(f.time())},JSON.parse(JSON.stringify(f.obs))]) {
    expect(mapHostHealth({device,obs:obs as ObsHealthObservation},f.time()).observations.obs).toBeUndefined();
  }
  expect(new ObsHealthObservation().read(Date.now())).toBeUndefined();
});
it.each([-1,3000])('fences clock jumps %s until restart, even after another event',jump=>{
  const f=fixture();f.obs.observe(connected);f.advance(100);f.report();f.jump(jump);
  expect(f.report().status).toBe('unknown');f.obs.observe(connected);expect(f.report().status).toBe('unknown');
});
it.each([NaN,Infinity,-1])('refuses invalid clock %s without disturbing the caller',time=>{
  const obs=new ObsHealthObservation(()=>time,()=>0);expect(()=>obs.observe(connected)).not.toThrow();expect(obs.read(100)).toBeUndefined();
});
it('clock exceptions are contained; invalid connection combinations remain unknown',()=>{
  const obs=new ObsHealthObservation(()=>{throw Error('private');});expect(()=>obs.observe(connected)).not.toThrow();expect(obs.read(100)).toBeUndefined();
  const f=fixture();for(const state of [{connected:true},{connected:true,connectionStatus:'error'},{connected:false,connectionStatus:'connected'}]) {
    f.obs.observe(state);expect(f.report().status).toBe('unknown');
  }
});
