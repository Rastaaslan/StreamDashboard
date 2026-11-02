import {describe,it,expect,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ProductionObsWriter} from '../apps/agent/src/production-obs-writer.js';
import {realObsWriterOptIn} from '../apps/agent/src/real-obs-transport.js';
import {runObsAuthorityMonitor} from '../apps/agent/src/authority-monitor.js';
import type {AgentCommand} from '../packages/contracts/src/agent-v2.js';

const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r});return {promise,resolve}};
async function lab(run:(ctx:{writer:ProductionObsWriter;peer:ReturnType<typeof fakePeer>;
  setTime:(time:number)=>void;command:(id?:string)=>AgentCommand})=>Promise<void>){
  const directory=await mkdtemp(path.join(tmpdir(),'sc3-authority-refresh-'));
  let now=1000;
  const peer=fakePeer();
  const writer=await ProductionObsWriter.open({optIn:realObsWriterOptIn,
    url:'ws://127.0.0.1:4555',password:'SYNTHETIC_ONLY',localDeviceId:'FIXE',
    controllerDeviceId:'controller',grants:new Set(['obs.stream.start','obs.scene.set']),
    journalFile:path.join(directory,'receipts.json'),now:()=>now},async()=>peer);
  const command=(id='request_1'):AgentCommand=>({protocol:2,commandId:id,
    actorDeviceId:'controller',targetDeviceId:'FIXE',capability:'obs.stream.start',
    issuedAt:now,preconditionRevision:writer.observation()!.revision,payload:{}});
  try{await run({writer,peer,setTime:time=>{now=time},command})}
  finally{await writer.close();await rm(directory,{recursive:true,force:true})}
}
function fakePeer(){
  const state={active:false,scene:'MAIN'};
  return {state,disconnected:new AbortController(),read:vi.fn(async()=>state.active),
    readScene:vi.fn(async()=>state.scene),sceneNames:vi.fn(async()=>['MAIN','PAUSE']),
    writeScene:vi.fn(async(scene:string)=>{state.scene=scene}),
    write:vi.fn(async(kind:'StartStream'|'StopStream')=>{state.active=kind==='StartStream'}),
    close:vi.fn(async()=>{})};
}

describe('autonomous Agent observation refresh and command exclusion',()=>{
  it('renews a genuine read beyond five seconds without expiring an unchanged confirmation revision',()=>lab(async({writer,peer,setTime,command})=>{
    const revision=writer.observation()!.revision;
    setTime(7000);expect(writer.observation()).toBeNull();
    expect(await writer.refresh()).toMatchObject({revision,observedAt:7000,staleAt:12000});
    expect(peer.write).not.toHaveBeenCalled();
    expect((await writer.submit(command(),'controller',true)).result).toBe('confirmed');
    expect(peer.write).toHaveBeenCalledOnce();
  }));
  it('changes the revision on a newly observed scene and refuses the previous preview',()=>lab(async({writer,peer,command,setTime})=>{
    const old=command();peer.state.scene='PAUSE';setTime(2000);
    expect((await writer.refresh()).revision).toBeGreaterThan(old.preconditionRevision!);
    expect((await writer.submit(old,'controller',true)).reason).toBe('STALE_REVISION');
    expect(peer.write).not.toHaveBeenCalled();expect(writer.receipt(old.commandId)).toBeUndefined();
  }));
  it('coalesces concurrent reads and refuses a mutation throughout the pending refresh',()=>lab(async({writer,peer,command})=>{
    const old=command(),entered=deferred(),release=deferred();
    peer.read.mockImplementation(async()=>{entered.resolve();await release.promise;return false});
    const first=writer.refresh(),second=writer.refresh();
    expect(first).toBe(second);await entered.promise;
    expect((await writer.submit(old,'controller',true)).reason).toBe('WRITER_BUSY');
    expect(writer.receipt(old.commandId)).toBeUndefined();
    release.resolve();await first;
    expect(peer.read).toHaveBeenCalledTimes(2); // initial open plus one coalesced refresh
    expect(peer.write).not.toHaveBeenCalled();
  }));
  it('never interleaves a refresh with a command or faults the authority because it is busy',()=>lab(async({writer,peer,command})=>{
    const entered=deferred(),release=deferred();
    peer.write.mockImplementation(async()=>{entered.resolve();await release.promise;peer.state.active=true});
    const pending=writer.submit(command(),'controller',true);await entered.promise;
    await expect(writer.refresh()).rejects.toThrow('REAL_OBS_WRITER_BUSY');
    release.resolve();expect((await pending).result).toBe('confirmed');
    expect((await writer.refresh()).payload.active).toBe(true);
    expect(peer.write).toHaveBeenCalledOnce();
  }));
  it('never re-arms on a late response after disconnect',()=>lab(async({writer,peer,command})=>{
    const old=command(),entered=deferred(),release=deferred();
    peer.read.mockImplementation(async()=>{entered.resolve();await release.promise;return false});
    const checked=expect(writer.refresh()).rejects.toThrow('REAL_OBS_UNAVAILABLE');
    await entered.promise;peer.disconnected.abort();release.resolve();await checked;
    expect(writer.observation()).toBeNull();
    expect((await writer.submit(old,'controller',true)).reason).toBe('RECONCILIATION_REQUIRED');
    expect(peer.write).not.toHaveBeenCalled();
  }));
  it('waits for an abandoned read before releasing ownership on close',()=>lab(async({writer,peer})=>{
    const entered=deferred(),release=deferred();
    peer.read.mockImplementation(async()=>{entered.resolve();await release.promise;return false});
    const checked=expect(writer.refresh()).rejects.toThrow('REAL_OBS_UNAVAILABLE');
    await entered.promise;const closing=writer.close();
    expect(writer.observation()).toBeNull();expect(peer.close).not.toHaveBeenCalled();
    release.resolve();await checked;await closing;expect(peer.close).toHaveBeenCalledOnce();
  }));
  it('fences failed or backwards-clock observations without reconnection or command replay',async()=>{
    for(const cause of ['read','clock'])await lab(async({writer,peer,setTime,command})=>{
      const old=command();
      if(cause==='read')peer.read.mockRejectedValue(Error('SIMULATED_READ_FAILURE'));
      else setTime(500);
      await expect(writer.refresh()).rejects.toThrow('REAL_OBS_UNAVAILABLE');
      expect(writer.observation()).toBeNull();
      await expect(writer.refresh()).rejects.toThrow('REAL_OBS_UNAVAILABLE');
      expect((await writer.submit(old,'controller',true)).reason).toBe('RECONCILIATION_REQUIRED');
      expect(peer.write).not.toHaveBeenCalled();
    });
  });
});

describe('headless authority monitor',()=>{
  it('refreshes with read-only polling while a busy executor retains ownership',async()=>{
    const stop=new AbortController(),unavailable=vi.fn();let sleeps=0;
    const writer={refresh:vi.fn().mockRejectedValueOnce(Error('REAL_OBS_WRITER_BUSY')).mockResolvedValue({})};
    await runObsAuthorityMonitor({writer,signal:stop.signal,unavailable,
      sleep:async()=>{if(++sleeps===2)stop.abort()}});
    expect(writer.refresh).toHaveBeenCalledTimes(2);expect(unavailable).not.toHaveBeenCalled();
  });
  it('stops after one failed observation and reports reconciliation instead of reconnecting',async()=>{
    const unavailable=vi.fn(),sleep=vi.fn(async()=>{}),writer={refresh:vi.fn().mockRejectedValue(Error('REAL_OBS_UNAVAILABLE'))};
    await runObsAuthorityMonitor({writer,signal:new AbortController().signal,unavailable,sleep});
    expect(writer.refresh).toHaveBeenCalledOnce();expect(unavailable).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });
  it('has no read after an already aborted startup or an abort during sleep',async()=>{
    const stop=new AbortController(),writer={refresh:vi.fn(async()=>({}))},unavailable=vi.fn();
    stop.abort();await runObsAuthorityMonitor({writer,signal:stop.signal,unavailable});
    expect(writer.refresh).not.toHaveBeenCalled();
    const next=new AbortController();
    await runObsAuthorityMonitor({writer,signal:next.signal,unavailable,sleep:async()=>next.abort()});
    expect(writer.refresh).toHaveBeenCalledOnce();expect(unavailable).not.toHaveBeenCalled();
  });
});
