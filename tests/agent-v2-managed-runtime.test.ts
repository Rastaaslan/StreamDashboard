import {describe,it,expect} from 'vitest';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runManagedReadOnlyAgent,type ReadOnlyConnection} from '../apps/agent/src/managed-readonly-runtime.js';
import {parseReadOnlyStartup} from '../apps/agent/src/windows-readonly-service.js';
import {loadManagedAgentNetwork} from '../apps/agent/src/readonly-network-config.js';

const fakeDirectory=path.join(tmpdir(),'sd-agent-network-fake');
const deferred=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r});return {promise,resolve}};
const connection=(closed?:AbortSignal):ReadOnlyConnection=>({
  disconnected:closed,call:async(kind:'GetStats'|'GetStreamStatus')=>
    kind==='GetStats'?{renderTotalFrames:100}:{outputActive:false},close:async()=>{},
});

describe('managed read-only Agent monitor',()=>{
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
});
describe('explicit protected Agent network configuration',()=>{
  it('keeps the listener disabled without opt-in and refuses incomplete/invalid configuration before opening a store',async()=>{
    let opened=0;
    const open=async()=>{opened++;return {get:async()=>null}};
    expect(await loadManagedAgentNetwork({},open)).toBeUndefined();
    await expect(loadManagedAgentNetwork({SD_AGENT_MTLS_HOST:'127.0.0.1'},open))
      .rejects.toThrow('AGENT_MTLS_CONFIGURATION_REQUIRED');
    for(const values of [{SD_AGENT_MTLS_PORT:'1023'},{SD_AGENT_MTLS_PORT:'65536'},
      {SD_AGENT_MTLS_PORT:'1.5'},{SD_AGENT_MTLS_DPAPI_DIR:'//untrusted/share'},
      {SD_AGENT_MTLS_DPAPI_DIR:'relative-store'},{SD_AGENT_MTLS_OPT_IN:'yes'}]){
      await expect(loadManagedAgentNetwork({
        SD_AGENT_MTLS_OPT_IN:'I_ACCEPT_PRIVATE_MTLS_READ_ONLY',SD_AGENT_MTLS_HOST:'127.0.0.1',
        SD_AGENT_MTLS_PORT:'48190',SD_AGENT_MTLS_DPAPI_DIR:fakeDirectory,...values,
      },open)).rejects.toThrow('AGENT_MTLS_CONFIGURATION_REQUIRED');
    }
    expect(opened).toBe(0);
  });
  it('does not couple the TLS store to the OBS password and rejects network options in once mode',()=>{
    const network={SD_AGENT_MTLS_OPT_IN:'I_ACCEPT_PRIVATE_MTLS_READ_ONLY',SD_AGENT_MTLS_DPAPI_DIR:fakeDirectory};
    const startup=parseReadOnlyStartup(['--monitor','--use-local-obs-config'],{
      APPDATA:'/FAKE_APPDATA',STREAMDASHBOARD_AGENT_READONLY_OPT_IN:'I_ACCEPT_READ_ONLY',...network,
    });
    expect(startup.protectedCredentials).toBeUndefined();
    expect(()=>parseReadOnlyStartup(['--once','--use-local-obs-config'],{
      APPDATA:'/FAKE_APPDATA',STREAMDASHBOARD_AGENT_READONLY_OPT_IN:'I_ACCEPT_READ_ONLY',...network,
    })).toThrow('MANAGED_AGENT_REQUIRES_MONITOR');
  });
  it('clears native credential buffers at teardown and failure',async()=>{
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
    const first=Buffer.from('FAKE_TLS_KEY');let index=0;
    await expect(loadManagedAgentNetwork({
      SD_AGENT_MTLS_OPT_IN:'I_ACCEPT_PRIVATE_MTLS_READ_ONLY',SD_AGENT_MTLS_HOST:'127.0.0.1',
      SD_AGENT_MTLS_PORT:'48190',SD_AGENT_MTLS_DPAPI_DIR:fakeDirectory,
    },async()=>({get:async()=>++index===1?first:null})))
      .rejects.toThrow('AGENT_MTLS_CREDENTIAL_UNAVAILABLE');
    expect(first.equals(Buffer.alloc(first.length))).toBe(true);
  });
});
