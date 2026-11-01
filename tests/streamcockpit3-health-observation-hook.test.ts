import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {afterEach,expect,it,vi} from 'vitest';
const {sockets}=vi.hoisted(()=>({sockets:[] as any[]}));
vi.mock('obs-websocket-js',()=>({default:class extends EventEmitter {
  constructor(){super();sockets.push(this);}
  connect=vi.fn(async()=>{});disconnect=vi.fn(async()=>{});
  call=vi.fn(async(type:string)=>{
    switch(type){
      case 'GetVersion':return {obsVersion:'fixture',obsWebSocketVersion:'5'};
      case 'GetCurrentProgramScene':return {currentProgramSceneName:'fixture'};
      case 'GetSceneList':return {scenes:[]};
      case 'GetStreamStatus':return {outputActive:false};
      case 'GetInputList':return {inputs:[]};
      case 'GetSceneItemList':return {sceneItems:[]};
      default:return {};
    }
  });
}}));
import {ObsClient} from '../integrations/obs/src/client.js';
import {ObsHealthObservation} from '../apps/server/src/streamcockpit-health/obs-observation.js';
afterEach(()=>{vi.useRealTimers();sockets.length=0;});
it('real ObsClient hook records confirmed refresh/events and disconnect, ignoring late old results',async()=>{
  vi.useFakeTimers();
  let now=1700000000000;const proof=new ObsHealthObservation(()=>now,()=>now-1700000000000);
  const client=new ObsClient('ws://fixture.invalid','');
  const off=client.onStateChanged(()=>proof.observe(client.state));
  try {
    expect(proof.read(now)).toBeUndefined();await client.connect();
    const socket=sockets.at(-1);expect(proof.read(now)?.data.connected).toBe(true);
    const count=socket.call.mock.calls.length, timers=vi.getTimerCount();
    now+=100;for(let n=0;n<10;n++)proof.read(now);
    expect(socket.call.mock.calls).toHaveLength(count);expect(vi.getTimerCount()).toBe(timers);
    now+=100;await client.refresh();expect(proof.read(now)?.observedAt).toBe(now);
    now+=100;socket.emit('RecordStateChanged',{outputActive:true});expect(proof.read(now)?.observedAt).toBe(now);
    let finish!:(value:unknown)=>void;const original=socket.call.getMockImplementation()!;
    socket.call.mockImplementation((type:string)=>type==='GetStreamStatus'?new Promise(resolve=>{finish=resolve;}):original(type));
    const refresh=client.refresh().catch(()=>undefined);
    now+=100;socket.emit('ConnectionClosed',{code:1006});
    expect(proof.read(now)?.data.connected).toBe(false);const lostAt=now;
    now+=100;finish({outputActive:true});await refresh;
    socket.emit('StreamStateChanged',{outputActive:true});
    expect(proof.read(now)).toMatchObject({observedAt:lostAt,data:{connected:false}});
    await client.connect();expect(proof.read(now)?.data.connected).toBe(true);
    for(const s of sockets)for(const [method] of s.call.mock.calls)expect(method).toMatch(/^Get/);
  }finally{off();await client.close();expect(vi.getTimerCount()).toBe(0);}
});
it('production binds exactly one recorder to existing subscription before legacy consumers',()=>{
  const entry=readFileSync('apps/server/src/index.ts','utf8');
  expect(entry.match(/new ObsHealthObservation\(/g)).toHaveLength(1);
  expect(entry).toContain('obs: obsHealthObservation,');
  expect(entry).toContain('const unsubscribeObs = obs.onStateChanged(() => {\n    obsHealthObservation.observe(obs.state);\n    autoStartReplay();');
  expect(entry).toContain('unsubscribeObs();');
  const module=readFileSync('apps/server/src/streamcockpit-health/obs-observation.ts','utf8');
  expect(module).not.toMatch(/setInterval|setTimeout|fetch\(|WebSocket/);
});
