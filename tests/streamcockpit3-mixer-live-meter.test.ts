import {describe,it,expect} from 'vitest';
import {MicHealthWatch} from '../integrations/obs/src/mic-health.js';
import {ObsMixerObservation} from '../apps/server/src/streamcockpit-mixer-observation.js';
import {mixerTelemetry} from '../packages/core/src/streamcockpit-mixer.js';

describe('F05 real OBS InputVolumeMeters reused for mixer read-only peak amplitude',()=>{
  it('measured zero is valid; unknown before the first OBS meter event',()=>{
    const w=new MicHealthWatch();
    expect(w.meterEvidence('Mic',10000)).toBeUndefined();
    w.updateStream(true,10000);
    expect(w.meterEvidence('Mic',10000)).toBeUndefined();
    expect(w.observe([{inputName:'Mic',inputLevelsMul:[[0,0]]}],10000)).toBe(true);
    expect(w.meterEvidence('Mic',10000)).toEqual({value:0,observedAt:10000});
  });
  it('uses the actual maximum channel peak without inferring sound, voice or battery',()=>{
    const w=new MicHealthWatch();w.updateStream(true,10000);
    w.observe([{inputName:'Mic',inputLevelsMul:[[0.01,0.3],[0.4,0.2]]}],10000);
    expect(w.meterEvidence('Mic',10001)).toEqual({value:0.4,observedAt:10000});
    expect(w.meterEvidence('Mic',15001)).toBeUndefined();
    expect(w.meterEvidence('Mic',9999)).toBeUndefined();
    expect(w.meterEvidence('Other',10000)).toBeUndefined();
  });
  it('invalid observations and every live transition discard meter proof',()=>{
    const w=new MicHealthWatch();w.updateStream(true,10000);
    expect(w.observe([{inputName:'Mic',inputLevelsMul:[[NaN,-1]]}],10000)).toBe(false);
    expect(w.meterEvidence('Mic',10000)).toBeUndefined();
    w.observe([{inputName:'Mic',inputLevelsMul:[[0.2]]}],10000);
    w.updateStream(false,10001);
    expect(w.meterEvidence('Mic',10001)).toBeUndefined();
    w.updateStream(true,10002);
    expect(w.meterEvidence('Mic',10002)).toBeUndefined();
  });
  it('projects only real recent OBS meter observations, with original timestamp',()=>{
    let now=10000;
    const cache=new ObsMixerObservation(()=>now);
    const state={connected:true,connectionStatus:'connected' as const,
      inputs:{Mic:{muted:false,volume:0.8}},error:null};
    cache.observe(state,2,{Mic:{value:0.31,observedAt:9999}});
    const row=mixerTelemetry(cache.read(now)!,now).sources[0];
    expect(row.level).toEqual({state:'known',value:0.31,observedAt:9999,provenance:'host-obs-client:InputVolumeMeters'});
    expect(row.gain).toMatchObject({state:'known',value:0.8});
    expect(row.vod.state).toBe('unknown');
    expect(row.stream.state).toBe('unknown');
    expect(row.device.state).toBe('unknown');
    now=10001;
    const reread=mixerTelemetry(cache.read(now)!,now).sources[0];
    expect(reread.level).toMatchObject({observedAt:9999});
  });
  it('rejects stale/invalid/foreign meter samples without synthesizing an amplitude',()=>{
    const now=20000,cache=new ObsMixerObservation(()=>now);
    const state={connected:true,connectionStatus:'connected' as const,
      inputs:{Mic:{muted:false,volume:1}},error:null};
    for(const sample of [{value:0.3,observedAt:10000},{value:0.3,observedAt:20001},
      {value:-1,observedAt:20000},{value:NaN,observedAt:20000}]){
      cache.observe(state,2,{Mic:sample,Other:{value:0.99,observedAt:now}});
      const observed=mixerTelemetry(cache.read(now)!,now);
      expect(observed.sources[0].level.state).toBe('unknown');
      expect(observed.sources).toHaveLength(1);
    }
  });
  it('disconnection cannot preserve or present a peak from a former OBS generation',()=>{
    let now=20000;const cache=new ObsMixerObservation(()=>now);
    const good={connected:true,connectionStatus:'connected' as const,inputs:{Mic:{muted:false,volume:1}},error:null};
    cache.observe(good,2,{Mic:{value:0.5,observedAt:20000}});
    expect(mixerTelemetry(cache.read(now)!,now).sources[0].level.state).toBe('known');
    now++;cache.observe({connected:false,connectionStatus:'offline' as const,
      inputs:{Mic:{muted:false,volume:1}},error:null},3,{Mic:{value:0.5,observedAt:20000}});
    const output=mixerTelemetry(cache.read(now)!,now);
    expect(output.sources[0].level.state).toBe('unknown');
    expect(output.errors).toContain('OBS_OFFLINE');
    now++;cache.observe(good,4);
    expect(mixerTelemetry(cache.read(now)!,now).sources[0].level.state).toBe('unknown');
  });
});
