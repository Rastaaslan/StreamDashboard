import { describe, expect, it } from 'vitest';
import { ObsMixerObservation } from '../apps/server/src/streamcockpit-mixer-observation.js';
import { mixerTelemetry } from '../packages/core/src/streamcockpit-mixer.js';

describe('F05 host OBS mixer notifications', () => {
  it('keeps real volume and mute, never invents meter, VOD or hardware routing', () => {
    let now = 50_000;
    const cache = new ObsMixerObservation(() => now);
    expect(cache.read(now)).toBeUndefined();
    const state = { connected: true, connectionStatus: 'connected' as const,
      inputs: { 'DJI Mic': { muted: false, volume: 0.42 } }, error: null };
    cache.observe(state, 2);
    const observed = cache.read(now)!;
    const report = mixerTelemetry(observed, now);
    expect(observed).toMatchObject({ owner: 'FIXE', connected: true, revision: 'obs:2:1', observedAt: now });
    expect(report.sources[0]).toMatchObject({
      gain: { state: 'known', value: 0.42 },
      mute: { state: 'known', value: false },
      level: { state: 'unknown' }, vod: { state: 'unknown' },
      stream: { state: 'unknown' }, device: { state: 'unknown' },
    });
    expect(report.outputs).toEqual([]);
    state.inputs['DJI Mic'].volume = 3;
    expect(cache.read(now)?.sources[0].gain?.value).toBe(0.42);
    observed.sources[0].gain!.value = 100;
    expect(cache.read(now)?.sources[0].gain?.value).toBe(0.42);
    now += 5001;
    expect(mixerTelemetry(cache.read(now)!, now).sources[0].gain.state).toBe('unknown');
  });
  it('fences disconnections and epoch changes; never carries old gain as live data', () => {
    let now = 10_000; const cache = new ObsMixerObservation(() => now);
    cache.observe({connected:true, connectionStatus:'connected', inputs:{'OBS Mic':{muted:false,volume:0.7}},error:null},1);
    now++; cache.observe({connected:false,connectionStatus:'offline', inputs:{},error:'private OBS error'},2);
    const report=mixerTelemetry(cache.read(now)!,now);
    expect(report.errors).toEqual(expect.arrayContaining(['OBS_OFFLINE','OBS_TELEMETRY_ERROR']));
    expect(report.sources).toEqual([]);
    expect(cache.read(now)?.revision).toBe('obs:2:2');
    expect(JSON.stringify(report)).not.toContain('private OBS error');
    now++; cache.observe({connected:true,connectionStatus:'connected',inputs:{'OBS Mic':{muted:true,volume:0.3}},error:null},3);
    expect(cache.read(now)?.revision).toBe('obs:3:3');
    expect(cache.read(now)?.sources[0].mute?.value).toBe(true);
  });
  it('invalidates on backwards clock and does not restamp stale data on HTTP reads', () => {
    let now=8000;const cache=new ObsMixerObservation(()=>now);
    cache.observe({connected:true,connectionStatus:'connected',inputs:{A:{muted:true,volume:1}},error:null},5);
    expect(cache.read(now+1000)?.observedAt).toBe(8000);
    now=7999;cache.observe({connected:true,connectionStatus:'connected',inputs:{},error:null},5);
    expect(cache.read(8000)).toBeUndefined();
    now=9000;cache.observe({connected:true,connectionStatus:'connected',inputs:{},error:null},5);
    expect(cache.read(now)).toBeUndefined();
  });
  it('rejects malformed input without returning the previous positive observation', () => {
    const cache=new ObsMixerObservation(()=>100);
    cache.observe({connected:true,connectionStatus:'connected',inputs:{A:{muted:false,volume:1}},error:null},1);
    cache.observe({connected:true,connectionStatus:'connected',inputs:{A:{muted:false,volume:'invalid' as never}},error:null},1);
    expect(cache.read(100)).toBeUndefined();
  });
});
