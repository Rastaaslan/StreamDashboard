import {describe,it,expect} from 'vitest';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {AgentCommandGuard} from '../apps/agent/src/command-guard.js';
import {AgentCommandReservation} from '../apps/agent/src/command-reservation.js';
import {DurableReceiptJournal} from '../apps/agent/src/durable-receipts.js';
import type {AgentCommand,AgentCapability} from '../packages/contracts/src/agent-v2.js';

const base=():AgentCommand=>({
  protocol:2,commandId:'cmd999',actorDeviceId:'controller',targetDeviceId:'stream',
  capability:'obs.stream.stop',preconditionRevision:4,issuedAt:1000,payload:{},
});
const grants=new Set<AgentCapability>(['obs.stream.stop']);
async function lab<T>(testFn:(file:string)=>Promise<T>) {
  const dir=await mkdtemp(path.join(tmpdir(),'sd-agent-reservation-'));
  try{return await testFn(path.join(dir,'commands.json'))}
  finally{await rm(dir,{recursive:true,force:true})}
}
describe('at-most-once dispatch reservation prototype',()=>{
  it('durably reserves before returning a permit and blocks replay after restart',async()=>lab(async file=>{
    const journal=await DurableReceiptJournal.open(file);
    const guard=new AgentCommandGuard();guard.acquireAuthority('session1',4);
    const service=new AgentCommandReservation(guard,journal,'stream');
    expect(await service.reserve(base(),'controller',grants,1001)).toMatchObject({
      permitted:false,reason:'CONFIRMATION_REQUIRED',
    });
    const permit=await service.reserve(base(),'controller',grants,1001,true);
    expect(permit.permitted).toBe(true);
    expect((await DurableReceiptJournal.open(file)).find('cmd999')).toMatchObject({
      result:'uncertain',reason:'PRE_EXECUTION_RESERVED',
    });
    const newGuard=new AgentCommandGuard();newGuard.acquireAuthority('session2',4);
    const newService=new AgentCommandReservation(newGuard,await DurableReceiptJournal.open(file),'stream');
    expect(await newService.reserve(base(),'controller',grants,1002,true)).toMatchObject({
      permitted:false,reason:'DUPLICATE_PERSISTENT',
    });
  }));
  it('refuses forged caller and wrong destination without changing the journal',async()=>lab(async file=>{
    const journal=await DurableReceiptJournal.open(file);
    const guard=new AgentCommandGuard();guard.acquireAuthority('session1',4);
    const service=new AgentCommandReservation(guard,journal,'stream');
    expect((await service.reserve(base(),'attacker',grants,1001,true)).reason).toBe('ACTOR_IDENTITY_MISMATCH');
    expect((await service.reserve({...base(),targetDeviceId:'laptop'},'controller',grants,1001,true)).reason).toBe('WRONG_TARGET');
    expect((await DurableReceiptJournal.open(file)).find('cmd999')).toBeUndefined();
  }));
  it('refuses to permit execution when journal is corrupt or locked',async()=>lab(async file=>{
    const journal=await DurableReceiptJournal.open(file);
    const guard=new AgentCommandGuard();guard.acquireAuthority('session1',4);
    const service=new AgentCommandReservation(guard,journal,'stream');
    await writeFile(file+'.writer.lock','other-writer');
    expect((await service.reserve(base(),'controller',grants,1001,true)).reason).toBe('JOURNAL_UNAVAILABLE');
  }));
});
