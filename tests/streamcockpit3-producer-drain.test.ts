import {expect,it,vi} from 'vitest';
import {ObsReplayMomentProducer} from '../apps/server/src/streamcockpit-moments-obs-replay.js';
import {StreamlabsMomentProducer} from '../apps/server/src/streamcockpit-moments-streamlabs.js';
import {AutomationRuntime} from '../apps/server/src/automation-runtime.js';
import {normalizeStreamlabsEvents} from '../integrations/streamlabs/src/events.js';

const now=Date.parse('2026-11-06T14:00:00Z');
const replayEvent={sourceEventId:'obs_replay_'+'a'.repeat(64),observedAt:now,connectionGeneration:1,streamEpoch:2};
const snapshot=()=>({connected:true,streamingKnown:true,streaming:true,connectionGeneration:1,streamEpoch:2,
  providerConnected:true,providerGeneration:3});
const stopOf=(value:object)=>{
  const stop=(value as {stop?:()=>Promise<void>}).stop;
  expect(typeof stop).toBe('function');
  return ()=>stop!.call(value);
};
const deferred=<T=void>()=>{
  let resolve!:(value:T)=>void,reject!:(error:Error)=>void;
  const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no});
  return {promise,resolve,reject};
};
const events=()=>normalizeStreamlabsEvents({for:'twitch_account',type:'subscription',message:[{_id:'synthetic',name:'Test'}]},new Date(now));

it('F10 shutdown waits for an accepted OBS replay write and admits no next replay',async()=>{
  const disk=deferred(),record=vi.fn(async()=>disk.promise);
  const producer=new ObsReplayMomentProducer({snapshot,hostEligible:async()=>true,activeSessionId:async()=>'live_1',record});
  const stop=stopOf(producer);
  const work=producer.observe(replayEvent);
  try{
    await vi.waitFor(()=>expect(record).toHaveBeenCalledTimes(1));
    let done=false;const stopping=stop().then(()=>{done=true});
    await Promise.resolve();expect(done).toBe(false);
    expect(await producer.observe({...replayEvent,sourceEventId:'obs_replay_'+'b'.repeat(64)})).toBe('ignored');
    disk.resolve();await work;await stopping;expect(done).toBe(true);expect(record).toHaveBeenCalledTimes(1);
  }finally{disk.resolve();await work.catch(()=>undefined)}
});
it('F10 automation runtime provides an explicit asynchronous drain',async()=>{
  const runtime=new AutomationRuntime([],async()=>undefined,async()=>undefined);
  await stopOf(runtime)();
});
it('F10 does not certify shutdown after an uncertain Streamlabs journal commit',async()=>{
  const record=vi.fn(async()=>{throw Error('Authorization: Bearer PRIVATE_SYNTHETIC')});
  const producer=new StreamlabsMomentProducer({snapshot,host:async()=>'FIXE',activeSessionId:async()=>'live_1',record,now:()=>now});
  producer.observeState();await expect(producer.observe(events())).rejects.toThrow('PRIVATE_SYNTHETIC');
  await expect(producer.stop()).rejects.toThrow('STREAMLABS_MOMENT_WRITE_UNCERTAIN');
  expect(record).toHaveBeenCalledTimes(1);
});

const event=()=>({eventId:'fixture',schemaVersion:1 as const,type:'support.received',source:'test',
  occurredAt:new Date(now).toISOString(),receivedAt:new Date(now).toISOString(),correlationId:'fixture',payload:{}});
const rule=()=>({id:'one',name:'Fixture',enabled:true,trigger:'support.received',conditions:[],
  actions:[{type:'soundboard.play',payload:{soundId:'first'}},{type:'soundboard.play',payload:{soundId:'second'}}],
  cooldownMs:0,lastExecutionAt:null});

it('F10 cancels pre-write replay observations on stop, without claiming a storage failure',async()=>{
  const session=deferred<string>(),record=vi.fn(async()=>undefined);
  const producer=new ObsReplayMomentProducer({snapshot,hostEligible:async()=>true,activeSessionId:()=>session.promise,record});
  const work=producer.observe(replayEvent),stop=producer.stop();
  expect(producer.stop()).toBe(stop);
  session.resolve('live_1');
  expect(await work).toBe('ignored');await stop;expect(record).not.toHaveBeenCalled();
});
it('F10 remembers an uncertain replay write even after its promise left the pending set',async()=>{
  const record=vi.fn(async()=>{throw Error('PRIVATE_SYNTHETIC_WRITE')});
  const producer=new ObsReplayMomentProducer({snapshot,hostEligible:async()=>true,activeSessionId:async()=>'live_1',record});
  await expect(producer.observe(replayEvent)).rejects.toThrow('PRIVATE_SYNTHETIC_WRITE');
  expect(await producer.observe(replayEvent)).toBe('ignored');
  const stopping=producer.stop();expect(producer.stop()).toBe(stopping);
  await expect(stopping).rejects.toThrow('OBS_REPLAY_MOMENT_WRITE_UNCERTAIN');
  expect(await producer.observe({...replayEvent,sourceEventId:'obs_replay_'+'b'.repeat(64)})).toBe('ignored');
  expect(record).toHaveBeenCalledTimes(1);
});
it('F10 a failed host lookup before persistence is not a false disk uncertainty',async()=>{
  const record=vi.fn(async()=>undefined);
  const producer=new ObsReplayMomentProducer({snapshot,hostEligible:async()=>true,
    activeSessionId:async()=>{throw Error('host unavailable')},record});
  await expect(producer.observe(replayEvent)).rejects.toThrow('host unavailable');
  await expect(producer.stop()).resolves.toBeUndefined();expect(record).not.toHaveBeenCalled();
});
it('F10 cancels unstarted macro steps and queued events while awaiting final accepted persistence',async()=>{
  const actionGate=deferred(),disk=deferred(),execute=vi.fn(async()=>actionGate.promise),persist=vi.fn(async()=>disk.promise);
  const runtime=new AutomationRuntime([rule()],execute,persist);
  const first=runtime.consume(event());
  await vi.waitFor(()=>expect(execute).toHaveBeenCalledTimes(1));
  const queued=runtime.consume({...event(),eventId:'second',correlationId:'second'});
  const stop=runtime.stop();expect(runtime.stop()).toBe(stop);
  let done=false;void stop.then(()=>{done=true});
  try{
    expect(await runtime.consume(event())).toEqual([]);
    await expect(runtime.create({...rule(),id:'late'})).rejects.toThrow('RUNTIME_PRODUCER_STOPPED');
    await expect(runtime.update('one',{name:'late'})).rejects.toThrow('RUNTIME_PRODUCER_STOPPED');
    await expect(runtime.remove('one')).rejects.toThrow('RUNTIME_PRODUCER_STOPPED');
    actionGate.resolve();await vi.waitFor(()=>expect(persist).toHaveBeenCalledTimes(2));
    expect(done).toBe(false);expect(execute).toHaveBeenCalledTimes(1);
    disk.resolve();const results=await Promise.all([first,queued]);await stop;
    expect(results.flat().map(row=>row.status)).toEqual(['failed','failed']);
    expect(done).toBe(true);expect(execute).toHaveBeenCalledTimes(1);
  }finally{actionGate.resolve();disk.resolve();await Promise.allSettled([first,queued,stop])}
});
it('F10 drains an already accepted automation edit before releasing shutdown',async()=>{
  const disk=deferred(),persist=vi.fn(async()=>disk.promise),runtime=new AutomationRuntime([],async()=>undefined,persist);
  const creating=runtime.create(rule());await vi.waitFor(()=>expect(persist).toHaveBeenCalledTimes(1));
  let done=false;const stop=runtime.stop().then(()=>{done=true});
  await Promise.resolve();expect(done).toBe(false);
  disk.resolve();await creating;await stop;expect(done).toBe(true);expect(persist).toHaveBeenCalledTimes(1);
});
it('F10 cannot report clean macro shutdown after failed final persistence',async()=>{
  const execute=vi.fn(async()=>undefined),persist=vi.fn(async()=>{throw Error('PRIVATE_SYNTHETIC_DISK')});
  const runtime=new AutomationRuntime([rule()],execute,persist);
  await expect(runtime.consume(event())).rejects.toThrow('PRIVATE_SYNTHETIC_DISK');
  await expect(runtime.stop()).rejects.toThrow('AUTOMATION_PERSISTENCE_UNCERTAIN');
  expect(await runtime.consume(event())).toEqual([]);expect(execute).toHaveBeenCalledTimes(2);
  expect(persist).toHaveBeenCalledTimes(1);
});
it('F10 rejected automation validation does not poison a clean drain',async()=>{
  const persist=vi.fn(async()=>undefined),runtime=new AutomationRuntime([],async()=>undefined,persist);
  await expect(runtime.remove('missing')).rejects.toThrow('introuvable');
  await expect(runtime.stop()).resolves.toBeUndefined();expect(persist).not.toHaveBeenCalled();
});
it('F10 Streamlabs closes admission before an in-flight host lookup can write',async()=>{
  const host=deferred<string>(),record=vi.fn(async()=>undefined);
  const producer=new StreamlabsMomentProducer({snapshot,host:()=>host.promise,activeSessionId:async()=>'live_1',record,now:()=>now});
  producer.observeState();const work=producer.observe(events()),stop=producer.stop();
  expect(producer.stop()).toBe(stop);host.resolve('FIXE');await work;await stop;
  await producer.observe(events());expect(record).not.toHaveBeenCalled();
});
it('F10 registers an accepted operation before reentrant shutdown and rejects further admission',async()=>{
  const {RuntimeProducerDrain}=await import('../apps/server/src/runtime-producer-drain.js');
  const drain=new RuntimeProducerDrain('SYNTHETIC_WRITE_UNCERTAIN'),disk=deferred();
  let stopping:Promise<void>|undefined,done=false;
  const work=drain.run(()=>{stopping=drain.stop();void stopping.then(()=>{done=true});return drain.persist(()=>disk.promise)});
  await Promise.resolve();expect(done).toBe(false);
  await expect(drain.run(async()=>undefined)).rejects.toThrow('RUNTIME_PRODUCER_STOPPED');
  disk.resolve();await work;await stopping;expect(done).toBe(true);
});
