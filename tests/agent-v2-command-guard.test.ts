import {it,expect} from 'vitest';
import {AgentCommandGuard} from '../apps/agent/src/command-guard.js';
import type {AgentCommand,AgentCapability} from '../packages/contracts/src/agent-v2.js';
const command:AgentCommand={protocol:2,commandId:'action1',actorDeviceId:'pcjeu',targetDeviceId:'stream',capability:'obs.stream.stop',issuedAt:1000,preconditionRevision:5,payload:{}};
it('fences stale revisions, blocks unconfirmed stop and duplicates',()=>{
 const guard=new AgentCommandGuard(),grants=new Set<AgentCapability>(['obs.stream.stop']);
 expect(guard.inspect(command,grants,1000,true).reason).toBe('NO_AUTHORITY');
 guard.acquireAuthority('epochA',6);
 expect(guard.inspect(command,grants,1000,true).reason).toBe('STALE_REVISION');
 guard.acquireAuthority('epochA',5);
 expect(guard.inspect(command,grants,1000).reason).toBe('CONFIRMATION_REQUIRED');
 expect(guard.inspect(command,grants,1000,true).accepted).toBe(true);
 guard.record({commandId:'action1',result:'uncertain',observedAt:1001});
 expect(guard.inspect(command,grants,1000,true).reason).toBe('DUPLICATE');
});
it('does not pretend to offer durable deduplication',()=>{
 const guard=new AgentCommandGuard();
 guard.acquireAuthority('epochA',5);
 guard.record({commandId:'action1',result:'uncertain',observedAt:1001});
 guard.acquireAuthority('epochB',5);
 expect(guard.inspect(command,new Set(['obs.stream.stop']),1000,true).accepted).toBe(true);
});

[executed on device: dam-server (ee881f3f-7909-4993-a915-04a1d994f366)]