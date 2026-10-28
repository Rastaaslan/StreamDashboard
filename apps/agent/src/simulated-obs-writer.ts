import {open,realpath,lstat,readFile,rename,rm,type FileHandle} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {AgentCommandGuard} from './command-guard.js';
import {AgentCommandReservation} from './command-reservation.js';
import {DurableReceiptJournal} from './durable-receipts.js';
import {FakeObsConnection,checkedFakeObsEndpoint,type FakeObsEndpoint} from './simulated-obs-transport.js';
import {observationFreshness,type AgentCommand,type AgentCapability,type AgentReceipt,
  type AgentObservation} from '../../../packages/contracts/src/agent-v2.js';

export interface SimulatedWriterOptions extends FakeObsEndpoint {
  journalFile:string;
  localDeviceId:string;
  controllerDeviceId:string;
  grants:ReadonlySet<AgentCapability>;
  now?:()=>number;
}
type Pending={command:AgentCommand;confirmed:boolean;resolve:(receipt:AgentReceipt)=>void};
const validId=(value:unknown):value is string=>
  typeof value==='string'&&/^[A-Za-z0-9_-]{1,96}$/.test(value);

const revisionBlock=1_000_000;
/** Called under the lifetime authority lock. Epoch blocks cannot overlap across
 * reopenings or a changed journal path for the same simulated target. */
async function claimRevisionBlock(file:string):Promise<number>{
  let previous=0;
  try{
    if((await lstat(file)).isSymbolicLink())throw Error('SIMULATION_EPOCH_CORRUPT');
    const raw=await readFile(file,'utf8');
    if(!/^[0-9]{1,10}$/.test(raw))throw Error('SIMULATION_EPOCH_CORRUPT');
    previous=Number(raw);
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
  const next=previous+1;
  if(!Number.isSafeInteger(next)||next*revisionBlock>Number.MAX_SAFE_INTEGER-revisionBlock)
    throw Error('SIMULATION_EPOCH_EXHAUSTED');
  const temp=file+'.tmp-'+randomUUID(),handle=await open(temp,'wx',0o600);
  try{await handle.writeFile(String(next));await handle.sync()}
  catch(error){await handle.close();await rm(temp,{force:true});throw error}
  await handle.close();
  try{await rename(temp,file)}catch(error){await rm(temp,{force:true});throw error}
  if(process.platform!=='win32'){
    const directory=await open(path.dirname(file),'r');
    try{await directory.sync()}finally{await directory.close()}
  }
  return next*revisionBlock;
}

/** Isolated simulator, never imported by the read-only Windows service.
 * One lifetime lock fences writers for the same target on this host.
 * No automatic connection recovery, command replay or uncertain reconciliation.
 */
export class SimulatedObsWriter {
  private readonly guard=new AgentCommandGuard();
  private readonly reservation:AgentCommandReservation;
  private readonly queue:Pending[]=[];
  private readonly pendingIds=new Set<string>();
  private readonly epoch=randomUUID();
  private readonly now:()=>number;
  private snapshot:AgentObservation<{active:boolean}>|null=null;
  private faulted=false;
  private refreshing=false;
  private closing=false;
  private pumping:Promise<void>|null=null;
  private scheduled=false;
  private stopPending=0;
  private closeTask:Promise<void>|null=null;

  private constructor(
    private readonly options:SimulatedWriterOptions,
    private readonly journal:DurableReceiptJournal,
    private readonly peer:FakeObsConnection,
    private readonly signal:AbortController,
    private readonly authority:FileHandle,
    private readonly lockFile:string,
    private readonly revisionBase:number,
  ){
    this.now=options.now??Date.now;
    this.reservation=new AgentCommandReservation(this.guard,journal,options.localDeviceId);
  }
  static async open(input:SimulatedWriterOptions):Promise<SimulatedObsWriter>{
    checkedFakeObsEndpoint(input);
    if(!validId(input.localDeviceId)||!validId(input.controllerDeviceId)||
      !path.isAbsolute(input.journalFile))throw Error('SIMULATION_CONFIG_REQUIRED');
    const root=await realpath(tmpdir()),directory=await realpath(path.dirname(input.journalFile));
    if(!directory.startsWith(root+path.sep)||
      !/^[A-Za-z0-9_-]{1,80}\.json$/.test(path.basename(input.journalFile)))
      throw Error('SIMULATION_TEMP_JOURNAL_REQUIRED');
    const file=path.join(directory,path.basename(input.journalFile));
    try{if((await lstat(file)).isSymbolicLink())throw Error('SIMULATION_TEMP_JOURNAL_REQUIRED')}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
    const options={...input,journalFile:file,grants:new Set(input.grants)};
    const lockFile=path.join(root,'sd-fake-obs-authority-'+
      createHash('sha256').update(input.localDeviceId).digest('hex')+'.lock');
    let authority:FileHandle;
    try{authority=await open(lockFile,'wx',0o600)}catch{throw Error('SIMULATION_AUTHORITY_LOCKED')}
    const signal=new AbortController();let peer:FakeObsConnection|undefined;
    try{
      await authority.writeFile(String(process.pid));await authority.sync();
      const revisionBase=await claimRevisionBlock(lockFile+'.epoch');
      const journal=await DurableReceiptJournal.open(file);
      if(journal.hasUncertain())throw Error('RECONCILIATION_REQUIRED');
      peer=await FakeObsConnection.open(options,signal.signal);
      const writer=new SimulatedObsWriter(options,journal,peer,signal,authority,lockFile,revisionBase);
      writer.publish(await peer.read());
      return writer;
    }catch(error){
      signal.abort();await peer?.close().catch(()=>{});
      await authority.close();await rm(lockFile,{force:true});throw error;
    }
  }
  private publish(active:boolean):void{
    const now=this.now();
    if(!Number.isFinite(now))throw Error('INVALID_SIMULATION_TIME');
    const revision=(this.snapshot?.revision??this.revisionBase)+1;
    if(revision>=this.revisionBase+revisionBlock)throw Error('SIMULATION_EPOCH_EXHAUSTED');
    this.snapshot={sourceDeviceId:this.options.localDeviceId,revision,
      observedAt:now,staleAt:now+5000,payload:{active}};
    this.guard.acquireAuthority(this.epoch,this.snapshot.revision);
  }
  observation():AgentObservation<{active:boolean}>|null{
    if(this.closing||this.faulted||!this.snapshot||
      observationFreshness(this.snapshot,this.now())!=='fresh')return null;
    return {...this.snapshot,payload:{...this.snapshot.payload}};
  }
  receipt(id:string):AgentReceipt|undefined{return this.journal.find(id)}
  async refresh():Promise<AgentObservation<{active:boolean}>>{
    if(this.closing||this.faulted)throw Error('RECONCILIATION_REQUIRED');
    if(this.pumping||this.queue.length||this.refreshing)throw Error('SIMULATION_BUSY');
    this.refreshing=true;
    try{
      const active=await this.peer.read();
      if(this.closing)throw Error('WRITER_CLOSED');
      this.publish(active);return this.observation()!;
    }finally{this.refreshing=false}
  }
  private result(commandId:string,result:AgentReceipt['result'],reason:string):AgentReceipt{
    return {commandId,result,reason,observedAt:this.now()};
  }
  private precheck(command:AgentCommand,actor:string,confirmed:boolean,checkPending=true):string|null{
    if(this.closing)return 'WRITER_CLOSED';
    if(this.faulted)return 'RECONCILIATION_REQUIRED';
    if(this.refreshing)return 'SIMULATION_BUSY';
    if((this.snapshot?.revision??0)>=this.revisionBase+revisionBlock-1)return 'SIMULATION_EPOCH_EXHAUSTED';
    if(!command||typeof command!=='object'||!validId(command.commandId))return 'INVALID_COMMAND';
    if(actor!==this.options.controllerDeviceId||command.actorDeviceId!==actor)
      return 'ACTOR_IDENTITY_MISMATCH';
    if(command.targetDeviceId!==this.options.localDeviceId)return 'WRONG_TARGET';
    if(command.capability!=='obs.stream.start'&&command.capability!=='obs.stream.stop')
      return 'SIMULATION_CAPABILITY_UNSUPPORTED';
    if(!command.payload||typeof command.payload!=='object'||Array.isArray(command.payload)||
      Object.keys(command.payload).length!==0)return 'INVALID_PAYLOAD';
    if(!this.observation())return 'OBSERVATION_STALE';
    const inspected=this.guard.inspect(command,this.options.grants,this.now(),confirmed);
    if(!inspected.accepted)return inspected.reason;
    if((checkPending&&this.pendingIds.has(command.commandId))||this.journal.find(command.commandId))
      return 'DUPLICATE_PERSISTENT';
    return null;
  }
  submit(command:AgentCommand,authenticatedDeviceId:string,confirmedCriticalAction=false):Promise<AgentReceipt>{
    const error=this.precheck(command,authenticatedDeviceId,confirmedCriticalAction);
    if(error)return Promise.resolve(this.result(command?.commandId??'invalid','refused',error));
    // Snapshot the envelope: caller mutation while queued cannot change the effect.
    const copy:AgentCommand={...command,payload:{}};
    if(copy.capability==='obs.stream.start'&&this.stopPending)
      return Promise.resolve(this.result(copy.commandId,'refused','STOP_PENDING'));
    if(copy.capability==='obs.stream.stop'){
      for(let i=this.queue.length-1;i>=0;i--){
        const item=this.queue[i];
        if(item.command.capability==='obs.stream.start'){
          this.queue.splice(i,1);this.pendingIds.delete(item.command.commandId);
          item.resolve(this.result(item.command.commandId,'refused','SUPERSEDED_BY_STOP'));
        }
      }
    }
    if(this.queue.length>=16)return Promise.resolve(this.result(copy.commandId,'refused','QUEUE_FULL'));
    const promise=new Promise<AgentReceipt>(resolve=>{
      const item={command:copy,confirmed:confirmedCriticalAction,resolve};
      if(copy.capability==='obs.stream.stop'){this.queue.unshift(item);this.stopPending++}
      else this.queue.push(item);
      this.pendingIds.add(copy.commandId);
    });
    this.schedule();
    return promise;
  }
  private schedule():void{
    if(!this.pumping&&!this.scheduled){
      this.scheduled=true;queueMicrotask(()=>{
        this.scheduled=false;
        this.pumping=this.drain().finally(()=>{this.pumping=null;if(this.queue.length)this.schedule()});
      });
    }
  }
  private async drain():Promise<void>{
    while(this.queue.length){
      const item=this.queue.shift()!,command=item.command;
      let receipt:AgentReceipt;
      try{receipt=await this.execute(command,item.confirmed)}
      catch{this.faulted=true;receipt=this.result(command.commandId,'uncertain','SIMULATION_INTERNAL_FAILURE')}
      this.pendingIds.delete(command.commandId);
      if(command.capability==='obs.stream.stop')this.stopPending--;
      item.resolve(receipt);
    }
  }
  private async execute(command:AgentCommand,confirmed:boolean):Promise<AgentReceipt>{
    const error=this.precheck(command,this.options.controllerDeviceId,confirmed,false);
    if(error)return this.result(command.commandId,'refused',error);
    let active:boolean;
    try{active=await this.peer.read()}
    catch{this.faulted=true;return this.result(command.commandId,'refused','SIMULATION_UNAVAILABLE')}
    if(this.closing)return this.result(command.commandId,'refused','WRITER_CLOSED');
    if(active!==this.snapshot!.payload.active){
      this.publish(active);return this.result(command.commandId,'refused','STALE_REVISION');
    }
    const rechecked=this.precheck(command,this.options.controllerDeviceId,confirmed,false);
    if(rechecked)return this.result(command.commandId,'refused',rechecked);
    const permit=await this.reservation.reserve(command,this.options.controllerDeviceId,
      this.options.grants,this.now(),confirmed);
    if(!permit.permitted)return this.result(command.commandId,'refused',permit.reason);
    const desired=command.capability==='obs.stream.start';
    try{
      this.signal.signal.throwIfAborted();
      if(active!==desired)await this.peer.write(desired?'StartStream':'StopStream');
      const observed=await this.peer.read();
      if(observed!==desired)throw Error('SIMULATED_STATE_NOT_CONFIRMED');
      this.signal.signal.throwIfAborted();
      const receipt=this.result(command.commandId,'confirmed','SIMULATION_STATE_OBSERVED');
      await this.journal.confirmReservation(receipt);
      this.publish(observed);this.guard.record(receipt);
      return receipt;
    }catch{
      // The reservation stays uncertain even when a late RPC later resolves.
      // No subsequent command, including queued stop, bypasses this fence.
      this.faulted=true;
      return this.result(command.commandId,'uncertain','SIMULATION_OUTCOME_UNCERTAIN');
    }
  }
  close():Promise<void>{
    if(this.closeTask)return this.closeTask;
    this.closing=true;this.signal.abort();
    this.closeTask=(async()=>{
      if(this.scheduled)await new Promise<void>(resolve=>queueMicrotask(resolve));
      await this.pumping;
      await this.peer.close();
      await this.authority.close();await rm(this.lockFile,{force:true});
    })();
    return this.closeTask;
  }
}
