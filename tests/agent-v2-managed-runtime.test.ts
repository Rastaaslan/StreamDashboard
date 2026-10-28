import {describe,it,expect} from 'vitest';
import {tmpdir} from 'node:os';
import path from 'node:path';
const fakeDirectory=path.join(tmpdir(),'sd-agent-network-fake');
import {runManagedReadOnlyAgent,type ReadOnlyConnection} from '../apps/agent/src/managed-readonly-runtime.js';
import {parseReadOnlyStartup} from '../apps/agent/src/windows-readonly-service.js';
import {ControllerAgentLink} from '../apps/controller/src/agent-link.js';
import {loadManagedAgentNetwork,loadManagedControllerPeer,type ManagedControllerPeer}
  from '../apps/agent/src/readonly-network-config.js';
import type {AgentObservation} from '../packages/contracts/src/agent-v2.js';
import type {ObsHealth} from '../apps/agent/src/read-only-observer.js';

const health=(revision=1,now=Date.now()):AgentObservation<ObsHealth>=>({
  sourceDeviceId:'FIXE',revision,observedAt:now,staleAt:now+8000,
  payload:{connected:true,active:false,outputBytes:1,skippedFrames:0,renderedFrames:100},
});
const deferred=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r});return {promise,resolve}};
const connection=(closed?:AbortSignal):ReadOnlyConnection=>({
  disconnected:closed,call:async(kind:'GetStats'|'GetStreamStatus')=>
    kind==='GetStats'?{renderTotalFrames:100}:{outputActive:false},close:async()=>{},
});
const peer=():ManagedControllerPeer=>({
  url:'https://127.0.0.1:48190/v2/obs/health',expectedDeviceId:'FIXE',
  serverCertificate:'FAKE_CERT',serverFingerprint:'a'.repeat(64),
  clientCertificate:'FAKE_CLIENT',clientKey:'FAKE_KEY',dispose(){},
});

describe('managed read-only Agent and Controller link',()=>{
  it('invalidates on disconnect and resumes with monotone observation revisions',async()=>{
    const stop=new AbortController(),disconnect=new AbortController();
    const revisions:number[]=[],availability:boolean[]=[],calls:string[]=[];
    let connected=0,closed=0,available=false;
    await runManagedReadOnlyAgent({
      deviceId:'FIXE',signal:stop.signal,pollMs:10,sleep:async()=>{},
      connect:async()=>{
        expect(available).toBe(false);connected++;
        const current=connection(connected===1?disconnect.signal:undefined);
        return {...current,call:async(kind:'GetStats'|'GetStreamStatus')=>{
          calls.push(kind);return current.call(kind as 'GetStats');
        },close:async()=>{closed++}};
      },
      emit:value=>{
        available=true;availability.push(true);revisions.push(value.revision);
        if(revisions.length===1)disconnect.abort();else stop.abort();
      },
      unavailable:()=>{available=false;availability.push(false)},
    });
    expect(connected).toBe(2);expect(closed).toBe(2);
    expect(revisions).toEqual([1,2]);expect(available).toBe(false);
    expect(new Set(calls)).toEqual(new Set(['GetStats','GetStreamStatus']));
    expect(availability).toContain(false);
  });
  it('stops promptly during a hung connection and closes its abandoned late result',async()=>{
    const stop=new AbortController(),pending=deferred<ReadOnlyConnection>();
    let closed=0,emitted=0;
    const job=runManagedReadOnlyAgent({deviceId:'FIXE',signal:stop.signal,
      connect:()=>pending.promise,emit:()=>{emitted++},unavailable:()=>{}});
    await Promise.resolve();stop.abort();await job;
    pending.resolve({...connection(),close:async()=>{closed++}});
    await new Promise(resolve=>setTimeout(resolve,5));
    expect(closed).toBe(1);expect(emitted).toBe(0);
  });
  it('abandons a stalled OBS read and reconnects without publishing its late response',async()=>{
    const stop=new AbortController(),slow=deferred<unknown>(),revisions:number[]=[];
    let attempts=0;
    await runManagedReadOnlyAgent({deviceId:'FIXE',signal:stop.signal,pollMs:10,readTimeoutMs:10,
      sleep:async()=>{},unavailable:()=>{},
      connect:async()=>{
        attempts++;
        return attempts===1?{call:()=>slow.promise,close:async()=>{}}:connection();
      },emit:value=>{revisions.push(value.revision);stop.abort()},
    });
    slow.resolve({outputActive:true,renderTotalFrames:999});
    await Promise.resolve();
    expect(attempts).toBe(2);expect(revisions).toEqual([2]);
  });
  it('Controller rejects stale health, exposes outage, and reconnects to the same pinned peer',async()=>{
    let now=1000,requests=0,disposed=0;
    const done=deferred<void>(),states:string[]=[];
    let link:ControllerAgentLink;
    link=new ControllerAgentLink(async()=>({...peer(),dispose(){disposed++}}),
      async()=>{requests++;if(requests===2)throw Error('PRIVATE_TLS_ERROR');return health(requests,now)},
      async milliseconds=>{
        states.push(link.snapshot().status);
        if(milliseconds===2500&&requests===1){
          now=10000;expect(link.snapshot().status).toBe('unavailable');
        }
        if(requests>=3)done.resolve();
      },()=>now);
    link.start();await done.promise;
    expect(link.snapshot().status).toBe('connected');
    await link.stop();
    expect(states).toContain('unavailable');expect(disposed).toBe(2);
    expect(link.snapshot()).toEqual({status:'stopped',observation:null});
  });
  it('Controller shutdown cancels a nonresponsive fetch and ignores its late result',async()=>{
    const pending=deferred<AgentObservation<ObsHealth>>(),entered=deferred<void>();
    let disposed=false;
    const link=new ControllerAgentLink(async()=>({...peer(),dispose(){disposed=true}}),
      ()=>{entered.resolve();return pending.promise});
    link.start();await entered.promise;await link.stop();
    pending.resolve(health());await Promise.resolve();
    expect(disposed).toBe(true);expect(link.snapshot().status).toBe('stopped');
  });
});
describe('explicit protected network configuration',()=>{
  it('does not open a store or listener with no opt-in and rejects incomplete/public peers',async()=>{
    let opened=0;
    const open=async()=>{opened++;return {get:async()=>null}};
    expect(await loadManagedAgentNetwork({},open)).toBeUndefined();
    expect(await loadManagedControllerPeer({},open)).toBeUndefined();
    await expect(loadManagedAgentNetwork({SD_AGENT_MTLS_HOST:'127.0.0.1'},open))
      .rejects.toThrow('AGENT_MTLS_CONFIGURATION_REQUIRED');
    await expect(loadManagedControllerPeer({
      SD_CONTROLLER_AGENT_OPT_IN:'I_ACCEPT_PRIVATE_MTLS_READ_ONLY',
      SD_CONTROLLER_AGENT_URL:'https://8.8.8.8/v2/obs/health',
      SD_CONTROLLER_AGENT_DEVICE_ID:'FIXE',SD_CONTROLLER_AGENT_DPAPI_DIR:fakeDirectory,
    },open)).rejects.toThrow('INVALID_AGENT_ENDPOINT');
    await expect(loadManagedControllerPeer({
      SD_CONTROLLER_AGENT_OPT_IN:'I_ACCEPT_PRIVATE_MTLS_READ_ONLY',
      SD_CONTROLLER_AGENT_URL:'https://127.0.0.1:48190/v2/obs/health',
      SD_CONTROLLER_AGENT_DEVICE_ID:'FIXE',SD_CONTROLLER_AGENT_DPAPI_DIR:'//untrusted/share',
    },open)).rejects.toThrow('CONTROLLER_AGENT_CONFIGURATION_REQUIRED');
    expect(opened).toBe(0);
    const startup=parseReadOnlyStartup(['--monitor','--use-local-obs-config'],{
      APPDATA:'/FAKE_APPDATA',STREAMDASHBOARD_AGENT_READONLY_OPT_IN:'I_ACCEPT_READ_ONLY',
      SD_AGENT_MTLS_OPT_IN:'I_ACCEPT_PRIVATE_MTLS_READ_ONLY',SD_AGENT_MTLS_DPAPI_DIR:fakeDirectory,
    });
    expect(startup.protectedCredentials).toBeUndefined();
  });
  it('keeps TLS credentials in native buffers and clears them at teardown/failure',async()=>{
    const buffers:Buffer[]=[];
    const open=async()=>({get:async(id:string)=>{
      const result=Buffer.from(id.includes('fingerprint')?'a'.repeat(64):'FAKE_'+id);
      buffers.push(result);return result;
    }});
    const network=await loadManagedAgentNetwork({
      SD_AGENT_MTLS_OPT_IN:'I_ACCEPT_PRIVATE_MTLS_READ_ONLY',SD_AGENT_MTLS_HOST:'127.0.0.1',
      SD_AGENT_MTLS_PORT:'48190',SD_AGENT_MTLS_DPAPI_DIR:fakeDirectory,
    },open);
    expect(network?.binding.port).toBe(48190);network!.dispose();
    expect(buffers.every(value=>value.equals(Buffer.alloc(value.length)))).toBe(true);
    const first=Buffer.from('FAKE_TLS_KEY');
    let index=0;
    await expect(loadManagedAgentNetwork({
      SD_AGENT_MTLS_OPT_IN:'I_ACCEPT_PRIVATE_MTLS_READ_ONLY',SD_AGENT_MTLS_HOST:'127.0.0.1',
      SD_AGENT_MTLS_PORT:'48190',SD_AGENT_MTLS_DPAPI_DIR:fakeDirectory,
    },async()=>({get:async()=>++index===1?first:null})))
      .rejects.toThrow('AGENT_MTLS_CREDENTIAL_UNAVAILABLE');
    expect(first.equals(Buffer.alloc(first.length))).toBe(true);
  });
});
