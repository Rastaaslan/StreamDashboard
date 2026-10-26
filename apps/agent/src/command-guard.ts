import type {AgentCapability,AgentCommand,AgentReceipt} from '../../../packages/contracts/src/agent-v2.js';
import {validateAgentCommand} from '../../../packages/contracts/src/agent-v2.js';
/** In-memory *prototype* rejection/dedup guard. Not a durable journal or an authentication layer.
 * It never executes a command; caller must supply a separately authenticated actor and executor.
 */
export class AgentCommandGuard {
  private observed = new Map<string,AgentReceipt>();
  private authorityEpoch: string | null=null;
  private revision=0;
  acquireAuthority(epoch:string,revision:number) {
    if(!/^[A-Za-z0-9_-]{1,96}$/.test(epoch)||!Number.isSafeInteger(revision)||revision<0)
      throw new Error('INVALID_AUTHORITY_EPOCH');
    if(this.authorityEpoch!==epoch){this.observed.clear();this.authorityEpoch=epoch;}
    this.revision=revision;
  }
  inspect(command:AgentCommand,grants:ReadonlySet<AgentCapability>,now:number,confirmation=false):
    {accepted:boolean;reason:string;previous?:AgentReceipt} {
    if(!this.authorityEpoch)return {accepted:false,reason:'NO_AUTHORITY'};
    const previous=this.observed.get(command.commandId);
    if(previous)return {accepted:false,reason:'DUPLICATE',previous};
    const error=validateAgentCommand(command,grants,now,{confirmedCriticalAction:confirmation});
    if(error)return {accepted:false,reason:error};
    if(command.preconditionRevision!==null && command.preconditionRevision!==this.revision)
      return {accepted:false,reason:'STALE_REVISION'};
    return {accepted:true,reason:'PRECHECK_ONLY'};
  }
  /** Never treat a result as successful unless externally confirmed. */
  record(receipt:AgentReceipt) {
    if(!/^[A-Za-z0-9_-]{1,96}$/.test(receipt.commandId))throw new Error('INVALID_ID');
    if(this.observed.has(receipt.commandId))throw new Error('DUPLICATE');
    this.observed.set(receipt.commandId,receipt);
  }
}

[executed on device: dam-server (ee881f3f-7909-4993-a915-04a1d994f366)]