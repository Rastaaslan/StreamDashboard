import {describe,it,expect} from 'vitest';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ProductionObsWriter,type ProductionWriterOptions} from '../apps/agent/src/production-obs-writer.js';
import {checkedRealObsEndpoint,realObsWriterOptIn} from '../apps/agent/src/real-obs-transport.js';
import type {AgentCommand} from '../packages/contracts/src/agent-v2.js';

const options=(folder:string):ProductionWriterOptions=>({
  optIn:realObsWriterOptIn,url:'ws://127.0.0.1:4555',password:'LOCAL_TEST_ONLY',
  journalFile:path.join(folder,'receipts.json'),localDeviceId:'stream_'+randomUUID().replaceAll('-',''),
  controllerDeviceId:'controller',grants:new Set(['obs.stream.start','obs.stream.stop','obs.scene.set']),
});
const command=(writer:ProductionObsWriter,id:string,stop=false):AgentCommand=>({
  protocol:2,commandId:id,actorDeviceId:'controller',targetDeviceId:writer.observation()!.sourceDeviceId,
  capability:stop?'obs.stream.stop':'obs.stream.start',issuedAt:Date.now(),
  preconditionRevision:writer.observation()!.revision,payload:{},
});
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve}};
async function lab(run:(ctx:{writer:ProductionObsWriter;open:()=>Promise<ProductionObsWriter>;
  state:{active:boolean;scene:string;writes:string[];block?:Promise<void>;fail?:boolean;noEffect?:boolean};file:string;opts:ProductionWriterOptions})=>Promise<void>){
 const folder=await mkdtemp(path.join(tmpdir(),'sd-real-obs-test-')),opts=options(folder);
 const state:{active:boolean;scene:string;writes:string[];block?:Promise<void>;fail?:boolean;noEffect?:boolean}={active:false,scene:'FIN',writes:[]};
 const opened:ProductionObsWriter[]=[];
 const open=async()=>{
  const writer=await ProductionObsWriter.open(opts,async()=>({
   disconnected:new AbortController(),
   async read(){return state.active},
   async readScene(){return state.scene},
   async sceneNames(){return ['FIN','PAUSE']},
   async writeScene(scene){state.writes.push('SetScene:'+scene);await state.block;if(state.fail)throw Error('FAKE_RPC_LOST');if(!state.noEffect)state.scene=scene},
   async write(kind){state.writes.push(kind);await state.block;if(state.fail)throw Error('FAKE_RPC_LOST');if(!state.noEffect)state.active=kind==='StartStream'},
   async close(){},
  }));opened.push(writer);return writer;
 };
 try{await run({writer:await open(),open,state,file:opts.journalFile,opts})}
 finally{for(const item of opened)await item.close().catch(()=>{});await rm(folder,{recursive:true,force:true})}
}
describe('StreamCockpit Agent V2 real OBS writer fences',()=>{
 it('requires explicit auth, numeric loopback, no URL tricks and nonempty password',()=>{
  const o=options('/tmp');
  expect(checkedRealObsEndpoint(o)).toBe('ws://127.0.0.1:4555');
  for(const diff of [{optIn:'no'},{url:'ws://192.168.1.15:4555'},
    {url:'ws://localhost:4555'},{url:'ws://127.0.0.1:4555/sd-fake-obs/'},
    {url:'wss://127.0.0.1:4555'},{url:'ws://127.0.0.1:4555/?x=1'},
    {password:''},{timeoutMs:60000}])
   expect(()=>checkedRealObsEndpoint({...o,...diff} as ProductionWriterOptions)).toThrow('REAL_OBS_ENDPOINT_REFUSED');
 });
 it('requires trusted actor, explicit confirmation, fresh revision and scoped grant',async()=>lab(async({writer,state})=>{
  const c=command(writer,'c1');
  expect((await writer.submit(c,'other',true)).reason).toBe('ACTOR_IDENTITY_MISMATCH');
  expect((await writer.submit(c,'controller')).reason).toBe('CONFIRMATION_REQUIRED');
  expect((await writer.submit({...c,preconditionRevision:0},'controller',true)).reason).toBe('STALE_REVISION');
  expect((await writer.submit({...c,payload:{force:true}},'controller',true)).reason).toBe('INVALID_PAYLOAD');
  expect((await writer.submit({...c,capability:'obs.scene.set'},'controller',true)).reason).toBe('INVALID_PAYLOAD');
  expect(state.writes).toEqual([]);
 }));
 it('reserves before a real write, confirms observed state and never replays same command after restart',async()=>lab(async({writer,open,state,file})=>{
  const first=command(writer,'first');
  const receipt=await writer.submit(first,'controller',true);
  expect(receipt).toMatchObject({result:'confirmed',reason:'OBS_STATE_VERIFIED'});
  expect(state.writes).toEqual(['StartStream']);
  expect(JSON.parse(await readFile(file,'utf8'))).toMatchObject([{commandId:'first',result:'confirmed'}]);
  await writer.close();const other=await open();
  expect(other.observation()!.revision).toBeGreaterThan(first.preconditionRevision!);
  const repeated={...first,preconditionRevision:other.observation()!.revision};
  expect((await other.submit(repeated,'controller',true)).reason).toBe('DUPLICATE_PERSISTENT');
  expect(state.writes).toEqual(['StartStream']);
 }));
 it('changes a known OBS scene, verifies it and refuses unknown scenes before reservation',async()=>lab(async({writer,state,file})=>{
  const c={...command(writer,'scene_1'),capability:'obs.scene.set' as const,payload:{scene:'PAUSE'}};
  expect((await writer.submit({...c,commandId:'unknown',payload:{scene:'MISSING'}},'controller')).reason).toBe('UNKNOWN_SCENE');
  expect((await writer.submit(c,'controller')).result).toBe('confirmed');
  expect(state.scene).toBe('PAUSE');
  expect(state.writes).toEqual(['SetScene:PAUSE']);
  expect(JSON.parse(await readFile(file,'utf8'))).toMatchObject([{commandId:'scene_1',result:'confirmed'}]);
  const revert={...command(writer,'scene_2'),capability:'obs.scene.set' as const,payload:{scene:'FIN'}};
  expect((await writer.submit(revert,'controller')).result).toBe('confirmed');
  expect(state.scene).toBe('FIN');
 }));
 it('does not reserve a write when external OBS state changed',async()=>lab(async({writer,state})=>{
  const stale=command(writer,'stale');state.active=true;
  expect((await writer.submit(stale,'controller',true)).reason).toBe('STALE_REVISION');
  expect(state.writes).toEqual([]);
 }));
 it('rejects another write while one is in flight; never queues stream starts',async()=>lab(async({writer,state})=>{
  const gate=deferred();state.block=gate.promise;
  const pending=writer.submit(command(writer,'first'),'controller',true);
  expect((await writer.submit(command(writer,'second'),'controller',true)).reason).toBe('WRITER_BUSY');
  gate.resolve();expect((await pending).result).toBe('confirmed');
  expect(state.writes).toEqual(['StartStream']);
 }));
 it('persists uncertainty after lost response and blocks restart and further writes',async()=>lab(async({writer,open,state,file})=>{
  const later=command(writer,'later');state.fail=true;
  expect((await writer.submit(command(writer,'lost'),'controller',true)).result).toBe('uncertain');
  expect((await writer.submit(later,'controller',true)).reason).toBe('RECONCILIATION_REQUIRED');
  expect(JSON.parse(await readFile(file,'utf8'))).toMatchObject([{commandId:'lost',result:'uncertain',reason:'PRE_EXECUTION_RESERVED'}]);
  await writer.close();await expect(open()).rejects.toThrow('RECONCILIATION_REQUIRED');
  expect(state.writes).toEqual(['StartStream']);
 }));
 it('does not fabricate confirmation when OBS reports a different state',async()=>lab(async({writer,state})=>{
  state.noEffect=true;
  expect((await writer.submit(command(writer,'unconfirmed'),'controller',true)).result).toBe('uncertain');
 }));
});
