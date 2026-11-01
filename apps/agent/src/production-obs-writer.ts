import {open,realpath,lstat,readFile,rename,rm,type FileHandle} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {AgentCommandGuard} from './command-guard.js';
import {AgentCommandReservation} from './command-reservation.js';
import {DurableReceiptJournal} from './durable-receipts.js';
import {RealObsConnection,checkedRealObsEndpoint,type RealObsEndpoint} from './real-obs-transport.js';
import {observationFreshness,type AgentCommand,type AgentReceipt,type AgentObservation,
  type AgentCapability} from '../../../packages/contracts/src/agent-v2.js';

export interface ProductionWriterOptions extends RealObsEndpoint {
  journalFile:string;
  localDeviceId:string;
  controllerDeviceId:string;
  grants:ReadonlySet<AgentCapability>;
  now?:()=>number;
}
const validId=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,96}$/.test(v);
const revisionBlock=1_000_000;
/** File remains across process restarts; old revision tokens never become valid again. */
async function claimEpoch(file:string):Promise<number>{
  let count=0;
  try{
    if((await lstat(file)).isSymbolicLink())throw Error('AUTHORITY_EPOCH_CORRUPT');
    const raw=await readFile(file,'utf8');
    if(!/^[0-9]{1,10}$/.test(raw))throw Error('AUTHORITY_EPOCH_CORRUPT');
    count=Number(raw);
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
  const next=count+1;
  if(!Number.isSafeInteger(next)||next*revisionBlock>Number.MAX_SAFE_INTEGER-revisionBlock)
    throw Error('AUTHORITY_EPOCH_EXHAUSTED');
  const temp=file+'.tmp-'+randomUUID(),handle=await open(temp,'wx',0o600);
  try{await handle.writeFile(String(next));await handle.sync()}
  finally{await handle.close()}
  try{await rename(temp,file)}catch(error){await rm(temp,{force:true});throw error}
  if(process.platform!=='win32'){
    const folder=await open(path.dirname(file),'r');try{await folder.sync()}finally{await folder.close()}
  }
  return next*revisionBlock;
}

/** Authenticated OBS executor, never reachable without a separately pinned
 * Controller identity. No automatic retry or crash recovery of uncertain writes.
 * The caller must authenticate the actor before invoking submit(). */
export class ProductionObsWriter {
  private readonly guard=new AgentCommandGuard();
  private readonly reservation:AgentCommandReservation;
  private readonly now:()=>number;
  private readonly epoch=randomUUID();
  private snapshot:AgentObservation<{active:boolean;scene?:string}>|null=null;
  private inFlight:Promise<AgentReceipt>|null=null;
  private closing=false;
  private faulted=false;
  private closeTask:Promise<void>|null=null;
  private constructor(private readonly options:Omit<ProductionWriterOptions,'password'|'url'|'optIn'>,
    private readonly journal:DurableReceiptJournal,
    private readonly peer:Pick<RealObsConnection,'read'|'write'|'readScene'|'sceneNames'|'writeScene'|'close'|'disconnected'>,
    private readonly signal:AbortController,private readonly authority:FileHandle,
    private readonly lockFile:string,private readonly revisionBase:number){
    this.now=options.now??Date.now;
    this.reservation=new AgentCommandReservation(this.guard,journal,options.localDeviceId);
    const lost=()=>{this.faulted=true;this.signal.abort()};
    peer.disconnected.signal.addEventListener('abort',lost,{once:true});
    if(peer.disconnected.signal.aborted)lost();
  }
  static async open(input:ProductionWriterOptions,
    openPeer:(options:RealObsEndpoint,signal:AbortSignal)=>Promise<Pick<RealObsConnection,'read'|'write'|'readScene'|'sceneNames'|'writeScene'|'close'|'disconnected'>>=RealObsConnection.open):Promise<ProductionObsWriter>{
    checkedRealObsEndpoint(input);
    if(!validId(input.localDeviceId)||!validId(input.controllerDeviceId)||
      !path.isAbsolute(input.journalFile)||input.journalFile.startsWith('\\\\')||
      !/^[A-Za-z0-9_-]{1,80}\.json$/.test(path.basename(input.journalFile)))
      throw Error('REAL_OBS_CONFIG_REFUSED');
    const folder=await realpath(path.dirname(input.journalFile)),file=path.join(folder,path.basename(input.journalFile));
    try{if((await lstat(file)).isSymbolicLink())throw Error('REAL_OBS_JOURNAL_REFUSED')}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
    const lockFile=file+'.authority.lock';
    let authority:FileHandle;
    try{authority=await open(lockFile,'wx',0o600)}catch{throw Error('REAL_OBS_AUTHORITY_LOCKED')}
    const signal=new AbortController();let peer:Awaited<ReturnType<typeof openPeer>>|undefined;
    try{
      await authority.writeFile(String(process.pid));await authority.sync();
      const revisionBase=await claimEpoch(file+'.epoch');
      const journal=await DurableReceiptJournal.open(file);
      if(journal.hasUncertain())throw Error('RECONCILIATION_REQUIRED');
      peer=await openPeer(input,signal.signal);
      const safe={journalFile:file,localDeviceId:input.localDeviceId,
        controllerDeviceId:input.controllerDeviceId,grants:new Set(input.grants),now:input.now};
      const writer=new ProductionObsWriter(safe,journal,peer,signal,authority,lockFile,revisionBase);
      writer.publish(await peer.read(),await peer.readScene());
      return writer;
    }catch(error){signal.abort();await peer?.close().catch(()=>{});
      await authority.close();await rm(lockFile,{force:true});throw error}
  }
  private publish(active:boolean,scene:string):void{
    this.signal.signal.throwIfAborted();
    if(typeof active!=='boolean'||typeof scene!=='string'||!scene.trim())
      throw Error('REAL_OBS_STATE_INVALID');
    const now=this.now(),revision=(this.snapshot?.revision??this.revisionBase)+1;
    if(!Number.isFinite(now)||revision>=this.revisionBase+revisionBlock)
      throw Error('REAL_OBS_REVISION_EXHAUSTED');
    this.snapshot={sourceDeviceId:this.options.localDeviceId,revision,
      observedAt:now,staleAt:now+5000,payload:{active,scene}};
    this.guard.acquireAuthority(this.epoch,revision);
  }
  observation():AgentObservation<{active:boolean;scene?:string}>|null{
    if(this.closing||this.faulted||!this.snapshot||
       observationFreshness(this.snapshot,this.now())!=='fresh')return null;
    return {...this.snapshot,payload:{...this.snapshot.payload}};
  }
  receipt(id:string):AgentReceipt|undefined{return this.journal.find(id)}
  private result(id:string,result:AgentReceipt['result'],reason:string):AgentReceipt{
    return {commandId:id,result,observedAt:this.now(),reason};
  }
  private precheck(command:AgentCommand,actor:string,confirmed:boolean):string|null{
    if(this.closing)return 'WRITER_CLOSED';
    if(this.faulted)return 'RECONCILIATION_REQUIRED';
    if(this.inFlight)return 'WRITER_BUSY';
    if(!command||!validId(command.commandId))return 'INVALID_COMMAND';
    if(actor!==this.options.controllerDeviceId||command.actorDeviceId!==actor)
      return 'ACTOR_IDENTITY_MISMATCH';
    if(command.targetDeviceId!==this.options.localDeviceId)return 'WRONG_TARGET';
    if(command.capability!=='obs.stream.start'&&command.capability!=='obs.stream.stop'&&command.capability!=='obs.scene.set')
      return 'UNSUPPORTED_PRODUCTION_CAPABILITY';
    if(!command.payload||typeof command.payload!=='object'||Array.isArray(command.payload))return 'INVALID_PAYLOAD';
    const payload=command.payload as Record<string,unknown>;
    if(command.capability==='obs.scene.set'){
      if(Object.keys(payload).length!==1||typeof payload.scene!=='string'||
         !payload.scene.trim()||payload.scene.length>256||/[\x00-\x1f\x7f]/.test(payload.scene))
        return 'INVALID_PAYLOAD';
    }else if(Object.keys(payload).length!==0)return 'INVALID_PAYLOAD';
    if(!this.observation())return 'OBSERVATION_STALE';
    const policy=this.guard.inspect(command,this.options.grants,this.now(),confirmed);
    if(!policy.accepted)return policy.reason;
    if(this.journal.find(command.commandId))return 'DUPLICATE_PERSISTENT';
    return null;
  }
  async refresh():Promise<AgentObservation<{active:boolean}>>{
    if(this.closing||this.faulted||this.inFlight)throw Error('REAL_OBS_UNAVAILABLE');
    try{this.publish(await this.peer.read(),await this.peer.readScene());return this.observation()!}
    catch{this.faulted=true;throw Error('REAL_OBS_UNAVAILABLE')}
  }
  submit(command:AgentCommand,authenticatedActorId:string,confirmedCriticalAction=false):Promise<AgentReceipt>{
    const reason=this.precheck(command,authenticatedActorId,confirmedCriticalAction);
    if(reason)return Promise.resolve(this.result(command?.commandId??'invalid','refused',reason));
    const copy:AgentCommand={...command,payload:command.capability==='obs.scene.set'?
      {scene:(command.payload as {scene:string}).scene}:{}};
    const job=this.execute(copy,authenticatedActorId,confirmedCriticalAction);
    this.inFlight=job;
    void job.finally(()=>{if(this.inFlight===job)this.inFlight=null}).catch(()=>{});
    return job;
  }
  private async execute(command:AgentCommand,actor:string,confirmed:boolean):Promise<AgentReceipt>{
    let active:boolean,scene:string;
    try{[active,scene]=await Promise.all([this.peer.read(),this.peer.readScene()])}
    catch{this.faulted=true;return this.result(command.commandId,'refused','REAL_OBS_UNAVAILABLE')}
    if(this.closing)return this.result(command.commandId,'refused','WRITER_CLOSED');
    if(this.faulted)return this.result(command.commandId,'refused','RECONCILIATION_REQUIRED');
    if(active!==this.snapshot!.payload.active||scene!==this.snapshot!.payload.scene){
      this.publish(active,scene);return this.result(command.commandId,'refused','STALE_REVISION');
    }
    if(command.capability==='obs.scene.set'){
      try{
        if(!(await this.peer.sceneNames()).includes((command.payload as {scene:string}).scene))
          return this.result(command.commandId,'refused','UNKNOWN_SCENE');
      }catch{return this.result(command.commandId,'refused','REAL_OBS_UNAVAILABLE')}
    }
    if(this.closing||this.faulted)return this.result(command.commandId,'refused','REAL_OBS_UNAVAILABLE');
    const guard=this.guard.inspect(command,this.options.grants,this.now(),confirmed);
    if(!guard.accepted)return this.result(command.commandId,'refused',guard.reason);
    const reserved=await this.reservation.reserve(command,actor,this.options.grants,this.now(),confirmed);
    if(!reserved.permitted)return this.result(command.commandId,'refused',reserved.reason);
    try{
      this.signal.signal.throwIfAborted();
      if(command.capability==='obs.scene.set'){
        const target=(command.payload as {scene:string}).scene;
        if(scene!==target)await this.peer.writeScene(target);
      }else{
        const desired=command.capability==='obs.stream.start';
        if(desired!==active)await this.peer.write(desired?'StartStream':'StopStream');
      }
      const [observed,observedScene]=await Promise.all([this.peer.read(),this.peer.readScene()]);
      const desiredActive=command.capability==='obs.scene.set'?active:command.capability==='obs.stream.start';
      const desiredScene=command.capability==='obs.scene.set'?
        (command.payload as {scene:string}).scene:scene;
      if(observed!==desiredActive||observedScene!==desiredScene)
        throw Error('REAL_OBS_STATE_UNCONFIRMED');
      this.signal.signal.throwIfAborted();
      const receipt=this.result(command.commandId,'confirmed','OBS_STATE_VERIFIED');
      await this.journal.confirmReservation(receipt);
      this.publish(observed,observedScene);this.guard.record(receipt);
      return receipt;
    }catch{
      this.faulted=true;
      return this.result(command.commandId,'uncertain','OBS_RESULT_UNCERTAIN');
    }
  }
  close():Promise<void>{
    if(this.closeTask)return this.closeTask;
    this.closing=true;this.signal.abort();
    this.closeTask=(async()=>{
      await this.inFlight?.catch(()=>{});await this.peer.close();
      await this.authority.close();await rm(this.lockFile,{force:true});
    })();
    return this.closeTask;
  }
}
