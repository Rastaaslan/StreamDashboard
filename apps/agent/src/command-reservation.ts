import type {AgentCapability,AgentCommand} from '../../../packages/contracts/src/agent-v2.js';
import {AgentCommandGuard} from './command-guard.js';
import {DurableReceiptJournal} from './durable-receipts.js';

/** PRE-EXECUTION RESERVATION ONLY: this module NEVER dispatches OBS commands.
 * The caller must first establish an authenticated and authorised device session.
 * A crash after the reservation must require operator reconciliation, never an auto-retry.
 */
export class AgentCommandReservation {
  constructor(
    private readonly guard:AgentCommandGuard,
    private readonly journal:DurableReceiptJournal,
    private readonly localDeviceId:string,
  ) {
    if(!/^[A-Za-z0-9_-]{1,96}$/.test(localDeviceId))throw new Error('INVALID_LOCAL_DEVICE');
  }

  async reserve(
    command:AgentCommand,
    authenticatedDeviceId:string,
    grants:ReadonlySet<AgentCapability>,
    now:number,
    confirmedCriticalAction=false,
  ):Promise<{permitted:boolean;reason:string}> {
    if(command.actorDeviceId!==authenticatedDeviceId) return {permitted:false,reason:'ACTOR_IDENTITY_MISMATCH'};
    if(command.targetDeviceId!==this.localDeviceId) return {permitted:false,reason:'WRONG_TARGET'};
    const inspected=this.guard.inspect(command,grants,now,confirmedCriticalAction);
    if(!inspected.accepted) return {permitted:false,reason:inspected.reason};
    // Fail closed across restarts: write an ambiguous reservation BEFORE any caller
    // is allowed to initiate a non-idempotent action.
    try {
      await this.journal.record({
        commandId:command.commandId,
        observedAt:now,
        result:'uncertain',
        reason:'PRE_EXECUTION_RESERVED',
      });
    } catch(error) {
      if(error instanceof Error && error.message==='DUPLICATE')
        return {permitted:false,reason:'DUPLICATE_PERSISTENT'};
      return {permitted:false,reason:'JOURNAL_UNAVAILABLE'};
    }
    return {permitted:true,reason:'RESERVED_REQUIRES_EXTERNAL_EXECUTOR'};
  }
}
