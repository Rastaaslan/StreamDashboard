import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {DurableReceiptJournal} from '../apps/agent/src/durable-receipts.js';
import {RealObsConnection,realObsWriterOptIn,type RealObsClient} from '../apps/agent/src/real-obs-transport.js';
import {ProductionObsWriter,type ProductionWriterOptions} from '../apps/agent/src/production-obs-writer.js';
import {parseReadOnlyStartup} from '../apps/agent/src/windows-readonly-service.js';
import type {AgentCommand} from '../packages/contracts/src/agent-v2.js';

const endpoint={optIn:realObsWriterOptIn,url:'ws://127.0.0.1:4555',password:'SYNTHETIC_ONLY',timeoutMs:100};
const deferred=<T>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve}};
afterEach(()=>vi.useRealTimers());
function clientLab(){
  let lost=()=>{};
  const client={connect:vi.fn(async()=>({})),disconnect:vi.fn(async()=>{}),
    call:vi.fn(async(_kind:string,_args?:unknown):Promise<unknown>=>({outputActive:false})),
    once:vi.fn((_event:string,listener:()=>void)=>{lost=listener}),off:vi.fn()};
  return {client,lose:()=>lost(),factory:()=>client as unknown as RealObsClient};
}
describe('Agent transport fences before dispatch',()=>{
  it.each(['disconnect','abort','close'] as const)('makes zero RPCs after %s, including reads and scene writes',async cause=>{
    const lab=clientLab(),stop=new AbortController();
    const peer=await RealObsConnection.open(endpoint,stop.signal,lab.factory);
    lab.client.call.mockClear();
    if(cause==='disconnect')lab.lose();else if(cause==='abort')stop.abort();else await peer.close();
    for(const work of [()=>peer.write('StartStream'),()=>peer.write('StopStream'),
      ()=>peer.writeScene('PAUSE'),()=>peer.read(),()=>peer.readScene(),()=>peer.sceneNames()])
      await expect(work()).rejects.toThrow('OBS_CONNECTION_LOST');
    expect(lab.client.call).not.toHaveBeenCalled();await peer.close();
  });
  it('fences a timed out RPC permanently even when its response arrives later',async()=>{
    vi.useFakeTimers();
    const lab=clientLab(),pending=deferred<unknown>();
    const peer=await RealObsConnection.open(endpoint,new AbortController().signal,lab.factory);
    lab.client.call.mockImplementation(()=>pending.promise);
    const result=expect(peer.write('StartStream')).rejects.toThrow('READ_ONLY_TIMEOUT');
    await vi.advanceTimersByTimeAsync(101);await result;
    pending.resolve({});await Promise.resolve();
    await expect(peer.write('StartStream')).rejects.toThrow('OBS_CONNECTION_LOST');
    expect(lab.client.call.mock.calls.filter(([kind])=>kind==='StartStream')).toHaveLength(1);
    await peer.close();
  });
  it('rejects an ack resolving in the same turn as connection loss',async()=>{
    const lab=clientLab();
    const peer=await RealObsConnection.open(endpoint,new AbortController().signal,lab.factory);
    lab.client.call.mockImplementation(async()=>{lab.lose();return {}});
    await expect(peer.write('StartStream')).rejects.toThrow();
    expect(peer.disconnected.signal.aborted).toBe(true);await peer.close();
  });
});
async function writerLab(run:(lab:{writer:ProductionObsWriter;options:ProductionWriterOptions;
  peer:ReturnType<typeof fakePeer>;reopen:()=>Promise<ProductionObsWriter>;setTime:(time:number)=>void})=>Promise<void>){
  const folder=await mkdtemp(path.join(tmpdir(),'sc3-agent-'));
  let now=1000;
  const options:ProductionWriterOptions={...endpoint,journalFile:path.join(folder,'receipts.json'),
    localDeviceId:'FIXE',controllerDeviceId:'controller',grants:new Set(['obs.stream.start','obs.scene.set']),now:()=>now};
  const peer=fakePeer(),opened:ProductionObsWriter[]=[];
  const reopen=async()=>{const writer=await ProductionObsWriter.open(options,async()=>peer);opened.push(writer);return writer};
  try{await run({writer:await reopen(),options,peer,reopen,setTime:time=>{now=time}})}
  finally{for(const writer of opened)await writer.close();await rm(folder,{recursive:true,force:true})}
}
function fakePeer(){
  let active=false;
  return {disconnected:new AbortController(),read:vi.fn(async()=>active),readScene:vi.fn(async()=> 'MAIN'),
    sceneNames:vi.fn(async()=>['MAIN','PAUSE']),writeScene:vi.fn(async(_scene:string)=>{}),
    write:vi.fn(async(kind:'StartStream'|'StopStream')=>{active=kind==='StartStream'}),close:vi.fn(async()=>{})};
}
function command(writer:ProductionObsWriter,id='first'):AgentCommand{
  return {protocol:2,commandId:id,actorDeviceId:'controller',targetDeviceId:'FIXE',
    capability:'obs.stream.start',issuedAt:1000,preconditionRevision:writer.observation()!.revision,payload:{}};
}
describe('Agent production writer startup and durable non replay',()=>{
  it('refuses missing identity, untrusted laptop/android, missing capability and stale observation',()=>writerLab(async({writer,peer,setTime})=>{
    const c=command(writer);
    for(const actor of ['', 'laptop','android'])
      expect((await writer.submit({...c,actorDeviceId:actor},actor,true)).reason).toBe('ACTOR_IDENTITY_MISMATCH');
    expect((await writer.submit({...c,capability:'obs.stream.stop'},'controller',true)).reason).toBe('NOT_AUTHORIZED');
    setTime(6000);expect(writer.observation()).toBeNull();
    expect((await writer.submit(c,'controller',true)).reason).toBe('OBSERVATION_STALE');
    expect(peer.write).not.toHaveBeenCalled();
  }));
  it('rejects a second authority before opening a peer; old revisions stay invalid after restart',()=>writerLab(async({writer,options,peer,reopen})=>{
    const factory=vi.fn(async()=>peer),old=command(writer);
    await expect(ProductionObsWriter.open(options,factory)).rejects.toThrow('REAL_OBS_AUTHORITY_LOCKED');
    expect(factory).not.toHaveBeenCalled();await writer.close();
    const next=await reopen();
    expect((await next.submit(old,'controller',true)).reason).toBe('STALE_REVISION');
    expect(peer.write).not.toHaveBeenCalled();
  }));
  it('refuses startup with a peer already disconnected or lost during initial reads',()=>writerLab(async({writer,options})=>{
    await writer.close();
    for(const duringRead of [false,true]){
      const peer=fakePeer();
      if(duringRead)peer.readScene.mockImplementation(async()=>{peer.disconnected.abort();return 'MAIN'});
      else peer.disconnected.abort();
      await expect(ProductionObsWriter.open(options,async()=>peer)).rejects.toThrow();
      expect(peer.close).toHaveBeenCalledOnce();expect(peer.write).not.toHaveBeenCalled();
    }
  }));
  it('does not dispatch after a disconnect during preflight',()=>writerLab(async({writer,peer,options})=>{
    const c=command(writer);
    peer.read.mockImplementation(async()=>{peer.disconnected.abort();return false});
    expect((await writer.submit(c,'controller',true)).result).toBe('refused');
    expect(peer.write).not.toHaveBeenCalled();expect(writer.observation()).toBeNull();
    expect(JSON.parse(await readFile(options.journalFile,'utf8'))).toEqual([]);
  }));
  it('does not dispatch if connection is lost while the reservation is persisted',()=>writerLab(async({writer,peer})=>{
    const original=DurableReceiptJournal.prototype.record;
    const record=vi.spyOn(DurableReceiptJournal.prototype,'record').mockImplementation(async function(this:DurableReceiptJournal,receipt){
      await original.call(this,receipt);peer.disconnected.abort();
    });
    try{
      expect((await writer.submit(command(writer),'controller',true)).result).toBe('uncertain');
      expect(peer.write).not.toHaveBeenCalled();
      expect(writer.receipt('first')?.result).toBe('uncertain');
    }finally{record.mockRestore()}
  }));
  it('blocks restart after a real process exits between durable reservation and effect',()=>writerLab(async({writer,options,peer})=>{
    await writer.close();
    const child=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',`
      import {ProductionObsWriter} from './apps/agent/src/production-obs-writer.ts';
      const options=JSON.parse(process.env.SC3_CRASH_OPTIONS);
      options.grants=new Set(['obs.stream.start']);options.now=()=>1000;
      const writer=await ProductionObsWriter.open(options,async()=>({
        disconnected:new AbortController(),read:async()=>false,readScene:async()=>'MAIN',
        sceneNames:async()=>['MAIN'],writeScene:async()=>{},close:async()=>{},
        write:async()=>process.exit(73),
      }));
      await writer.submit({protocol:2,commandId:'crash',actorDeviceId:'controller',
        targetDeviceId:'FIXE',capability:'obs.stream.start',issuedAt:1000,
        preconditionRevision:writer.observation().revision,payload:{}},'controller',true);
    `],{cwd:process.cwd(),env:{...process.env,SC3_CRASH_OPTIONS:JSON.stringify(options)},
      stdio:'ignore',timeout:10000});
    expect(child.error).toBeUndefined();expect(child.status).toBe(73);
    expect(JSON.parse(await readFile(options.journalFile,'utf8'))).toMatchObject([
      {commandId:'crash',result:'uncertain',reason:'PRE_EXECUTION_RESERVED'}]);
    const factory=vi.fn(async()=>peer);
    await expect(ProductionObsWriter.open(options,factory)).rejects.toThrow('REAL_OBS_AUTHORITY_LOCKED');
    // Explicit fixture-only operator recovery of the dead process lock.
    await rm(options.journalFile+'.authority.lock');
    await expect(ProductionObsWriter.open(options,factory)).rejects.toThrow('RECONCILIATION_REQUIRED');
    expect(factory).not.toHaveBeenCalled();
  }), 15_000); // Child has an independent 10s limit; avoid Vitest's 5s test cutoff under NVMe contention.
  it('keeps a lost ack uncertain, refuses concurrent commands, replay and restart',()=>writerLab(async({writer,peer,options})=>{
    const c=command(writer),entered=deferred<void>(),finish=deferred<void>();
    peer.write.mockImplementation(async()=>{entered.resolve();await finish.promise;peer.disconnected.abort()});
    const pending=writer.submit(c,'controller',true);await entered.promise;
    expect(JSON.parse(await readFile(options.journalFile,'utf8'))[0].result).toBe('uncertain');
    expect((await writer.submit({...c,commandId:'second'},'controller',true)).reason).toBe('WRITER_BUSY');
    finish.resolve();expect((await pending).result).toBe('uncertain');
    expect(writer.observation()).toBeNull();
    expect((await writer.submit(c,'controller',true)).reason).toBe('RECONCILIATION_REQUIRED');
    await writer.close();const factory=vi.fn(async()=>fakePeer());
    await expect(ProductionObsWriter.open(options,factory)).rejects.toThrow('RECONCILIATION_REQUIRED');
    expect(factory).not.toHaveBeenCalled();expect(peer.write).toHaveBeenCalledOnce();
  }));
  it('refuses a successful RPC ack without matching observed state',()=>writerLab(async({writer,peer})=>{
    peer.write.mockImplementation(async()=>{});
    expect((await writer.submit(command(writer),'controller',true)).result).toBe('uncertain');
  }));
  it('preserves crash locks and corrupt receipts instead of silently recovering',()=>writerLab(async({writer,options,peer})=>{
    await writer.close();const factory=vi.fn(async()=>peer);
    const lock=options.journalFile+'.authority.lock';
    await writeFile(lock,'crashed-process-fixture');
    await expect(ProductionObsWriter.open(options,factory)).rejects.toThrow('REAL_OBS_AUTHORITY_LOCKED');
    expect(await readFile(lock,'utf8')).toBe('crashed-process-fixture');
    await rm(lock);await writeFile(options.journalFile,'[{');
    await expect(ProductionObsWriter.open(options,factory)).rejects.toThrow();
    expect(await readFile(options.journalFile,'utf8')).toBe('[{');expect(factory).not.toHaveBeenCalled();
  }));
  it('rejects persistent command IDs after successful restart even with a fresh revision',()=>writerLab(async({writer,reopen,peer})=>{
    expect((await writer.submit(command(writer),'controller',true)).result).toBe('confirmed');
    await writer.close();const next=await reopen();
    expect((await next.submit(command(next),'controller',true)).reason).toBe('DUPLICATE_PERSISTENT');
    expect(peer.write).toHaveBeenCalledOnce();
  }));
  it('keeps autonomous startup read only without explicit writer opt in',()=>{
    const env={APPDATA:'/tmp/synthetic-agent-appdata',STREAMDASHBOARD_AGENT_READONLY_OPT_IN:'I_ACCEPT_READ_ONLY'};
    expect(parseReadOnlyStartup(['--monitor','--use-local-obs-config'],env).productionWriter).toBeUndefined();
    expect(()=>parseReadOnlyStartup(['--monitor','--use-local-obs-config'],{...env,
      SD_AGENT_OBS_WRITER_CONTROLLER_ID:'android'})).toThrow('REAL_OBS_WRITE_OPT_IN_REQUIRED');
  });
});
