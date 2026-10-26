import {describe,it,expect} from 'vitest';
import {agentProtocolVersion,observationFreshness,validateAgentCommand,canAutomaticallyRetry,
  type AgentCommand, type AgentCapability} from '../packages/contracts/src/agent-v2.js';
const base = (): AgentCommand => ({
 protocol:agentProtocolVersion,commandId:'cmd1',actorDeviceId:'pc-jeu',
 targetDeviceId:'pc-stream',capability:'obs.stream.stop',issuedAt:100_000,
 preconditionRevision:7,payload:{output:'main'},
});
describe('Agent V2 transport-independent invariants',()=>{
 it('rejects stale or forged observations',()=>{
  const obs={sourceDeviceId:'pc-stream',revision:7,observedAt:99_000,staleAt:101_000,payload:{}};
  expect(observationFreshness(obs,100_000)).toBe('fresh');
  expect(observationFreshness(obs,102_000)).toBe('stale');
  expect(observationFreshness({...obs,observedAt:120_000},100_000)).toBe('invalid');
 });
 it('enforces explicit grants, fresh revision and confirmation for OBS actions',()=>{
  const grants=new Set<AgentCapability>(['obs.stream.stop']);
  expect(validateAgentCommand(base(),grants,100_100)).toBe('CONFIRMATION_REQUIRED');
  expect(validateAgentCommand(base(),grants,100_100,{confirmedCriticalAction:true})).toBeNull();
  expect(validateAgentCommand({...base(),preconditionRevision:null},grants,100_100,{confirmedCriticalAction:true})).toBe('PRECONDITION_REQUIRED');
  expect(validateAgentCommand({...base(),capability:'audio.play'},grants,100_100)).toBe('NOT_AUTHORIZED');
  expect(validateAgentCommand({...base(),issuedAt:1},grants,100_100)).toBe('STALE_COMMAND');
 });
 it('never retries an uncertain or failed mutation blindly',()=>{
  expect(canAutomaticallyRetry({commandId:'cmd1',result:'uncertain',observedAt:100_000})).toBe(false);
  expect(canAutomaticallyRetry({commandId:'cmd1',result:'refused',observedAt:100_000})).toBe(false);
 });
});

[executed on device: dam-server (ee881f3f-7909-4993-a915-04a1d994f366)]