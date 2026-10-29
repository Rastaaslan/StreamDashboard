import {describe,it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {AgentCommandGuard} from '../apps/agent/src/command-guard.js';
import {AgentCommandReservation} from '../apps/agent/src/command-reservation.js';
import {DurableReceiptJournal} from '../apps/agent/src/durable-receipts.js';
import type {AgentCommand,AgentCapability} from '../packages/contracts/src/agent-v2.js';

const command=():AgentCommand=>({protocol:2,commandId:'sim_only_1',actorDeviceId:'controller',
 targetDeviceId:'stream',capability:'obs.stream.stop',preconditionRevision:4,issuedAt:1000,payload:{}});
describe('existing writer preconditions wired only to a fake OBS simulator',()=>{
 it('requires identity/grant/revision/confirmation and durable uncertain receipt before a simulated effect',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'sd-simulated-writer-'));
  const file=path.join(directory,'journal.json'),grants=new Set<AgentCapability>(['obs.stream.stop']);
  let simulatedEffects=0;
  try{
   const journal=await DurableReceiptJournal.open(file),guard=new AgentCommandGuard();
   guard.acquireAuthority('simulated_authority_1',4);
   const reservation=new AgentCommandReservation(guard,journal,'stream');
   const execute=async(value:AgentCommand,actor='controller',allowed=grants,confirmed=false)=>{
    const permit=await reservation.reserve(value,actor,allowed,1001,confirmed);
    if(!permit.permitted)return permit.reason;
    const durable=await DurableReceiptJournal.open(file);
    expect(durable.find(value.commandId)).toMatchObject({result:'uncertain',reason:'PRE_EXECUTION_RESERVED'});
    // Deliberately fake: no websocket library, URL, credential or real executor.
    simulatedEffects++;
    return 'SIMULATED_EFFECT_WITHOUT_DURABLE_CONFIRMATION';
   };
   expect(await execute(command(),'stranger',grants,true)).toBe('ACTOR_IDENTITY_MISMATCH');
   expect(await execute(command(),'controller',new Set(),true)).toBe('NOT_AUTHORIZED');
   expect(await execute({...command(),preconditionRevision:3},'controller',grants,true)).toBe('STALE_REVISION');
   expect(await execute(command())).toBe('CONFIRMATION_REQUIRED');
   expect(simulatedEffects).toBe(0);
   expect(await execute(command(),'controller',grants,true)).toBe('SIMULATED_EFFECT_WITHOUT_DURABLE_CONFIRMATION');
   expect(simulatedEffects).toBe(1);
   // Crash/restart: the fake effect might have happened; never replay or claim success.
   const reopened=await DurableReceiptJournal.open(file),nextGuard=new AgentCommandGuard();
   nextGuard.acquireAuthority('simulated_authority_2',4);
   const restarted=new AgentCommandReservation(nextGuard,reopened,'stream');
   expect(await restarted.reserve(command(),'controller',grants,1002,true))
    .toEqual({permitted:false,reason:'DUPLICATE_PERSISTENT'});
   expect(reopened.find(command().commandId)?.result).toBe('uncertain');
   expect(simulatedEffects).toBe(1);
  }finally{await rm(directory,{recursive:true,force:true})}
 });
});
