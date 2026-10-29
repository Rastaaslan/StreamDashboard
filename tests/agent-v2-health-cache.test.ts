import {describe,it,expect} from 'vitest';
import {AgentHealthSnapshotCache} from '../apps/agent/src/health-snapshot-cache.js';
import type {AgentObservation} from '../packages/contracts/src/agent-v2.js';
import type {ObsHealth} from '../apps/agent/src/read-only-observer.js';
const make=(revision:number,t=1000):AgentObservation<ObsHealth>=>({
  sourceDeviceId:'stream',revision,observedAt:t-100,staleAt:t+500,
  payload:{connected:true,active:false,outputBytes:1,skippedFrames:0,renderedFrames:5},
});
describe('read-only OBS snapshot cache never turns unknown into healthy',()=>{
  it('copies and expires a real observation without mutating inputs',()=>{
    const cache=new AgentHealthSnapshotCache('stream');
    const incoming=make(1);
    cache.accept(incoming,1000);
    incoming.payload.active=true;
    expect(cache.read(1000)?.payload.active).toBe(false);
    const returned=cache.read(1001)!;returned.payload.renderedFrames=900;
    expect(cache.read(1001)?.payload.renderedFrames).toBe(5);
    expect(cache.read(1500)).toBeNull();
  });
  it('requires source identity, bounded freshness, explicit metrics and increasing revision',()=>{
    const cache=new AgentHealthSnapshotCache('stream');
    expect(()=>cache.accept({...make(1),sourceDeviceId:'spoof'},1000)).toThrow('INVALID_AGENT_HEALTH');
    expect(()=>cache.accept({...make(1),payload:{...make(1).payload,outputBytes:-1}},1000))
      .toThrow('INVALID_AGENT_HEALTH');
    expect(()=>cache.accept({...make(1),staleAt:100000},1000)).toThrow('INVALID_AGENT_HEALTH');
    cache.accept(make(2),1000);
    expect(()=>cache.accept(make(2),1000)).toThrow('OUT_OF_ORDER_AGENT_HEALTH');
    cache.invalidate();
    expect(cache.read(1000)).toBeNull();
    expect(()=>cache.accept(make(1),1000)).toThrow('OUT_OF_ORDER_AGENT_HEALTH');
    cache.accept(make(3),1000);
    expect(cache.read(1000)?.revision).toBe(3);
  });
  it('does not invent an observation after disconnect',()=>{
    const cache=new AgentHealthSnapshotCache('stream');
    expect(cache.read(Date.now())).toBeNull();
    cache.accept(make(1),1000);
    cache.invalidate();
    expect(cache.read(1000)).toBeNull();
  });
});
