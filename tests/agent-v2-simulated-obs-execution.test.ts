import {describe,it,expect} from 'vitest';
import {mkdtemp,rm,readFile,writeFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {WebSocketServer,WebSocket} from 'ws';
import {SimulatedObsWriter,type SimulatedWriterOptions} from '../apps/agent/src/simulated-obs-writer.js';
import {checkedFakeObsEndpoint,fakeObsWriterOptIn} from '../apps/agent/src/simulated-obs-transport.js';
import {DurableReceiptJournal} from '../apps/agent/src/durable-receipts.js';
import type {AgentCommand} from '../packages/contracts/src/agent-v2.js';

const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r});return {promise,resolve}};
async function fakeObs(){
  const token=randomBytes(32).toString('hex');
  const server=new WebSocketServer({host:'127.0.0.1',port:0,path:'/sd-fake-obs/'+token});
  await new Promise<void>((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject)});
  const state={active:false,attested:true,helloVersion:'SD_FAKE_OBS_SIMULATION_V1',ignoreEffect:false,
    invalidStatus:false,onWrite:async(_kind:string)=>{}};
  const calls:string[]=[],writes:string[]=[];
  server.on('connection',socket=>{
    socket.send(JSON.stringify({op:0,d:{obsWebSocketVersion:state.helloVersion,rpcVersion:1}}));
    socket.on('message',raw=>{void (async()=>{
      const message=JSON.parse(raw.toString()) as {op:number;d:Record<string,unknown>};
      if(message.op===1){socket.send(JSON.stringify({op:2,d:{negotiatedRpcVersion:1}}));return}
      if(message.op!==6)return;
      const kind=String(message.d.requestType);calls.push(kind);
      let data:unknown={};
      if(kind==='GetVersion')data={simulationToken:state.attested?token:'WRONG_FAKE_TOKEN'};
      else if(kind==='GetStreamStatus')data={outputActive:state.invalidStatus?'UNKNOWN':state.active};
      else if(kind==='StartStream'||kind==='StopStream'){
        writes.push(kind);await state.onWrite(kind);
        if(!state.ignoreEffect)state.active=kind==='StartStream';
      }else throw Error('UNEXPECTED_FAKE_REQUEST');
      if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({op:7,d:{
        requestType:kind,requestId:message.d.requestId,requestStatus:{result:true,code:100},responseData:data,
      }}));
    })().catch(()=>socket.terminate())});
  });
  const address=server.address();if(!address||typeof address==='string')throw Error('NO_FAKE_ADDRESS');
  return {state,calls,writes,token,url:'ws://127.0.0.1:'+address.port+'/sd-fake-obs/'+token,
    async close(){for(const client of server.clients)client.terminate();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
async function lab(run:(context:{
  peer:Awaited<ReturnType<typeof fakeObs>>;file:string;
  options:SimulatedWriterOptions;open:()=>Promise<SimulatedObsWriter>;
})=>Promise<void>){
  const directory=await mkdtemp(path.join(tmpdir(),'sd-fake-obs-writer-')),peer=await fakeObs();
  const file=path.join(directory,'receipts.json'),opened:SimulatedObsWriter[]=[];
  const options:SimulatedWriterOptions={optIn:fakeObsWriterOptIn,url:peer.url,simulationToken:peer.token,
    journalFile:file,localDeviceId:'simulated_stream_'+randomBytes(8).toString('hex'),controllerDeviceId:'controller',
    grants:new Set(['obs.stream.start','obs.stream.stop']),timeoutMs:100};
  const open=async()=>{const writer=await SimulatedObsWriter.open(options);opened.push(writer);return writer};
  try{await run({peer,file,options,open})}
  finally{
    for(const writer of opened)await writer.close().catch(()=>{});
    await peer.close();await rm(directory,{recursive:true,force:true});
    const epoch=path.join(await realpath(tmpdir()),'sd-fake-obs-authority-'+
      createHash('sha256').update(options.localDeviceId).digest('hex')+'.lock.epoch');
    await rm(epoch,{force:true});
  }
}
const command=(writer:SimulatedObsWriter,id:string,stop=false):AgentCommand=>({
  protocol:2,commandId:id,actorDeviceId:'controller',targetDeviceId:writer.observation()?.sourceDeviceId??'simulated_stream',
  capability:stop?'obs.stream.stop':'obs.stream.start',issuedAt:Date.now(),
  preconditionRevision:writer.observation()?.revision??1,payload:{},
});

describe('isolated writer over real OBS WebSocket protocol with a fake peer',()=>{
  it('requires exact opt-in, numeric loopback and fake attestation before any effect',async()=>lab(async({peer,options})=>{
    for(const bad of [{optIn:'yes'},{url:peer.url.replace('127.0.0.1','localhost')},
      {url:peer.url.replace('127.0.0.1','192.168.1.2')},{url:'ws://127.0.0.1:4455/sd-fake-obs/'+peer.token},
      {url:peer.url+'?fallback=yes'},{simulationToken:'real-password'}]){
      expect(()=>checkedFakeObsEndpoint({...options,...bad} as SimulatedWriterOptions)).toThrow('FAKE_OBS_ENDPOINT_REQUIRED');
    }
    peer.state.attested=false;
    await expect(SimulatedObsWriter.open(options)).rejects.toThrow('FAKE_OBS_CONNECTION_REFUSED');
    expect(peer.writes).toEqual([]);
    peer.state.attested=true;peer.state.helloVersion='5.6.3';
    await expect(SimulatedObsWriter.open(options)).rejects.toThrow('FAKE_OBS_CONNECTION_REFUSED');
    expect(peer.writes).toEqual([]);
  }));
  it('fences a second authority even with a different journal',async()=>lab(async({options,open,peer,file})=>{
    const writer=await open();
    await expect(SimulatedObsWriter.open({...options,journalFile:file.replace('receipts','other')}))
      .rejects.toThrow('SIMULATION_AUTHORITY_LOCKED');
    expect(peer.writes).toEqual([]);await writer.close();
    const next=await open();expect(next.observation()?.payload.active).toBe(false);
  }));
  it('never reuses an old observation revision across authority reopenings or another journal',async()=>lab(async({open,options,file,peer})=>{
    const first=await open(),old=command(first,'not_dispatched');
    await first.close();const reopened=await open();
    expect(reopened.observation()!.revision).toBeGreaterThan(old.preconditionRevision!);
    expect((await reopened.submit(old,'controller',true)).reason).toBe('STALE_REVISION');
    await reopened.close();
    const other=await SimulatedObsWriter.open({...options,journalFile:file.replace('receipts','other')});
    try{
      expect(other.observation()!.revision).toBeGreaterThan(old.preconditionRevision!);
      expect((await other.submit(old,'controller',true)).reason).toBe('STALE_REVISION');
      expect(peer.writes).toEqual([]);
    }finally{await other.close()}
  }));
  it('rejects identity, grants, revision, confirmation and payload before dispatch',async()=>lab(async({open,options,peer})=>{
    options.grants=new Set(['obs.stream.stop']);
    const writer=await open();
    const stop=command(writer,'denied',true);
    expect((await writer.submit(stop,'stranger',true)).reason).toBe('ACTOR_IDENTITY_MISMATCH');
    expect((await writer.submit({...stop,targetDeviceId:'another'},'controller',true)).reason).toBe('WRONG_TARGET');
    expect((await writer.submit(command(writer,'no_grant'),'controller',true)).reason).toBe('NOT_AUTHORIZED');
    expect((await writer.submit({...stop,preconditionRevision:0},'controller',true)).reason).toBe('STALE_REVISION');
    expect((await writer.submit(stop,'controller')).reason).toBe('CONFIRMATION_REQUIRED');
    expect((await writer.submit({...stop,payload:{force:true}},'controller',true)).reason).toBe('INVALID_PAYLOAD');
    expect(peer.writes).toEqual([]);
  }));
  it('persists uncertain before dispatch and confirms only from observed state, then refuses replay',async()=>lab(async({open,peer,file})=>{
    const writer=await open();
    peer.state.onWrite=async()=>{
      expect((await DurableReceiptJournal.open(file)).find('start_1')).toMatchObject({
        result:'uncertain',reason:'PRE_EXECUTION_RESERVED',
      });
    };
    const firstRevision=writer.observation()!.revision;
    const start=command(writer,'start_1');
    const receipt=await writer.submit(start,'controller',true);
    expect(receipt).toMatchObject({result:'confirmed',reason:'SIMULATION_STATE_OBSERVED'});
    expect(writer.observation()).toMatchObject({revision:firstRevision+1,payload:{active:true}});
    expect((await DurableReceiptJournal.open(file)).find('start_1')).toMatchObject({result:'confirmed'});
    await writer.close();const reopened=await open();
    const duplicate={...start,preconditionRevision:reopened.observation()!.revision};
    expect((await reopened.submit(duplicate,'controller',true)).reason).toBe('DUPLICATE_PERSISTENT');
    expect(peer.writes).toEqual(['StartStream']);
    expect(reopened.receipt('start_1')?.result).toBe('confirmed');
  }));
  it('cancels queued starts for an authorised stop and snapshots caller envelopes',async()=>lab(async({open,peer})=>{
    peer.state.active=true;const writer=await open();
    const start=writer.submit(command(writer,'queued_start'),'controller',true);
    const stopEnvelope=command(writer,'priority_stop',true);
    const stop=writer.submit(stopEnvelope,'controller',true);
    stopEnvelope.capability='obs.stream.start';
    expect((await writer.submit(command(writer,'later_start'),'controller',true)).reason).toBe('STOP_PENDING');
    expect((await start).reason).toBe('SUPERSEDED_BY_STOP');
    expect((await stop).result).toBe('confirmed');
    expect(peer.writes).toEqual(['StopStream']);
    // A new explicit command uses the freshly observed revision, with no stranded queue.
    expect((await writer.submit(command(writer,'fresh_start'),'controller',true)).result).toBe('confirmed');
    expect(peer.writes).toEqual(['StopStream','StartStream']);
  }));
  it('does not let an unconfirmed stop supersede an authorised start',async()=>lab(async({open,peer})=>{
    const writer=await open();
    const start=writer.submit(command(writer,'start_allowed'),'controller',true);
    expect((await writer.submit(command(writer,'bad_stop',true),'controller')).reason).toBe('CONFIRMATION_REQUIRED');
    expect((await start).result).toBe('confirmed');expect(peer.writes).toEqual(['StartStream']);
  }));
  it('refuses a changed precondition without effect and exposes a new revision',async()=>lab(async({open,peer})=>{
    const writer=await open(),stale=command(writer,'changed');
    const firstRevision=writer.observation()!.revision;
    peer.state.active=true;
    expect((await writer.submit(stale,'controller',true)).reason).toBe('STALE_REVISION');
    expect(peer.writes).toEqual([]);expect(writer.observation()?.revision).toBe(firstRevision+1);
    expect((await writer.submit(command(writer,'stop_after_refresh',true),'controller',true)).result).toBe('confirmed');
  }));
  it('treats a successful RPC with mismatched state as uncertain and never repeats it',async()=>lab(async({open,peer,file})=>{
    const writer=await open();peer.state.ignoreEffect=true;
    expect((await writer.submit(command(writer,'ignored'),'controller',true)).result).toBe('uncertain');
    expect(writer.observation()).toBeNull();
    expect(writer.receipt('ignored')).toMatchObject({result:'uncertain',reason:'PRE_EXECUTION_RESERVED'});
    expect((await writer.submit(command(writer,'no_retry'),'controller',true)).reason).toBe('RECONCILIATION_REQUIRED');
    await writer.close();
    await expect(open()).rejects.toThrow('RECONCILIATION_REQUIRED');
    expect((await DurableReceiptJournal.open(file)).find('ignored')?.result).toBe('uncertain');
    expect(peer.writes).toEqual(['StartStream']);
  }));
  it('keeps a lost reply uncertain even after a late fake effect and blocks queued commands',async()=>lab(async({open,peer,file})=>{
    const writer=await open(),gate=deferred(),entered=deferred();
    peer.state.onWrite=async()=>{entered.resolve();await gate.promise};
    const start=writer.submit(command(writer,'lost_result'),'controller',true);
    await entered.promise;
    const duplicate=await writer.submit(command(writer,'lost_result'),'controller',true);
    expect(duplicate.reason).toBe('DUPLICATE_PERSISTENT');
    const stop=writer.submit(command(writer,'stop_waiting',true),'controller',true);
    expect((await start).result).toBe('uncertain');
    expect((await stop).reason).toBe('RECONCILIATION_REQUIRED');
    gate.resolve();await new Promise(resolve=>setTimeout(resolve,20));
    expect(peer.state.active).toBe(true);
    expect((await readFile(file,'utf8'))).toContain('PRE_EXECUTION_RESERVED');
    expect(writer.receipt('lost_result')?.result).toBe('uncertain');
    expect(peer.writes).toEqual(['StartStream']);
  }));
  it('does not dispatch when the durable journal cannot reserve the command',async()=>lab(async({open,peer,file})=>{
    const writer=await open();await writeFile(file+'.writer.lock','TEST_FOREIGN_WRITER');
    expect((await writer.submit(command(writer,'locked'),'controller',true)).reason).toBe('JOURNAL_UNAVAILABLE');
    expect(peer.writes).toEqual([]);await rm(file+'.writer.lock');
  }));
  it('keeps the reservation uncertain if durable confirmation fails after the fake effect',async()=>lab(async({open,peer,file})=>{
    const writer=await open();
    peer.state.onWrite=async()=>{await writeFile(file+'.writer.lock','TEST_CONFIRMATION_STORAGE_FAILURE')};
    try{
      expect((await writer.submit(command(writer,'confirm_failed'),'controller',true)).result).toBe('uncertain');
      expect(peer.state.active).toBe(true);
      expect(writer.receipt('confirm_failed')?.result).toBe('uncertain');
      expect(writer.observation()).toBeNull();
    }finally{await rm(file+'.writer.lock',{force:true})}
  }));
  it('requires fresh, well-formed observations before any write',async()=>lab(async({open,peer,options})=>{
    let now=Date.now();options.now=()=>now;
    const writer=await open(),original=command(writer,'expired');now+=6000;
    expect((await writer.submit(original,'controller',true)).reason).toBe('OBSERVATION_STALE');
    peer.state.invalidStatus=true;
    await expect(writer.refresh()).rejects.toThrow('FAKE_OBS_STATUS_INVALID');
    expect(peer.writes).toEqual([]);
    peer.state.invalidStatus=false;await writer.refresh();
    const fresh={...command(writer,'fresh'),issuedAt:now};
    expect((await writer.submit(fresh,'controller',true)).result).toBe('confirmed');
  }));
  it('closes an in-flight command conservatively and releases its authority without replay',async()=>lab(async({open,peer})=>{
    const writer=await open(),gate=deferred(),entered=deferred();
    peer.state.onWrite=async()=>{entered.resolve();await gate.promise};
    const pending=writer.submit(command(writer,'closing'),'controller',true);await entered.promise;
    await writer.close();expect((await pending).result).toBe('uncertain');
    gate.resolve();
    expect((await writer.submit(command(writer,'closed'),'controller',true)).reason).toBe('WRITER_CLOSED');
    await expect(open()).rejects.toThrow('RECONCILIATION_REQUIRED');
  }));
});
