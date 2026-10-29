/** Experimental Controller ↔ Stream Agent V2 contract.
 * Pure policy: NOT wired to production transport or any running OBS process.
 * The receiver must still authenticate device credentials and enforce role grants.
 */
export const agentProtocolVersion = 2 as const;
export type AgentRole = 'controller' | 'stream-agent' | 'android-fallback';
export type AgentCapability =
  | 'health.read' | 'obs.read' | 'obs.scene.set' | 'obs.volume.set'
  | 'obs.stream.start' | 'obs.stream.stop' | 'overlay.timer.read'
  | 'overlay.timer.set' | 'audio.play' | 'audio.stop' | 'dji.telemetry.read';
export type AgentCommandResult = 'accepted' | 'executed' | 'confirmed' | 'uncertain' | 'refused';
export interface AgentHello {
  protocol: typeof agentProtocolVersion;
  deviceId: string;
  role: AgentRole;
  nonce: string;
  capabilities: AgentCapability[];
}
export interface AgentObservation<T = unknown> {
  sourceDeviceId: string;
  revision: number;
  observedAt: number;
  staleAt: number;
  payload: T;
}
export interface AgentCommand<T = unknown> {
  protocol: typeof agentProtocolVersion;
  commandId: string;
  actorDeviceId: string;
  targetDeviceId: string;
  capability: AgentCapability;
  issuedAt: number;
  preconditionRevision: number | null;
  payload: T;
}
export interface AgentReceipt {
  commandId: string;
  result: AgentCommandResult;
  observedAt: number;
  reason?: string;
}
const privileged = new Set<AgentCapability>(['obs.scene.set','obs.volume.set','obs.stream.start',
  'obs.stream.stop','overlay.timer.set','audio.play','audio.stop']);
const critical = new Set<AgentCapability>(['obs.stream.start','obs.stream.stop']);
const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,96}$/.test(value);
export function observationFreshness(observation: AgentObservation, now: number): 'fresh'|'stale'|'invalid' {
  if(!Number.isFinite(now) || !validId(observation.sourceDeviceId) ||
     !Number.isSafeInteger(observation.revision) || observation.revision < 0 ||
     !Number.isFinite(observation.observedAt) || !Number.isFinite(observation.staleAt) ||
     observation.staleAt <= observation.observedAt || observation.observedAt > now + 5000) return 'invalid';
  return now >= observation.staleAt ? 'stale' : 'fresh';
}
export function validateAgentCommand(
  command: AgentCommand, authorized: ReadonlySet<AgentCapability>, now: number,
  options: {confirmedCriticalAction?: boolean} = {},
): string | null {
  if(command.protocol !== agentProtocolVersion) return 'UNSUPPORTED_PROTOCOL';
  if(!validId(command.commandId) || !validId(command.actorDeviceId) ||
     !validId(command.targetDeviceId)) return 'INVALID_ID';
  if(!Number.isFinite(command.issuedAt) || !Number.isFinite(now) ||
     command.issuedAt > now + 5000 || now - command.issuedAt > 30000) return 'STALE_COMMAND';
  if(!authorized.has(command.capability)) return 'NOT_AUTHORIZED';
  if(privileged.has(command.capability) &&
     (!Number.isSafeInteger(command.preconditionRevision) ||
      (command.preconditionRevision ?? -1) < 0)) return 'PRECONDITION_REQUIRED';
  if(critical.has(command.capability) && options.confirmedCriticalAction !== true)
    return 'CONFIRMATION_REQUIRED';
  if(!command.payload || typeof command.payload !== 'object' || Array.isArray(command.payload))
    return 'INVALID_PAYLOAD';
  return null;
}
/** Never automatically repeat an OBS write whose result might have occurred. */
export function canAutomaticallyRetry(receipt: AgentReceipt): boolean {
  if (receipt.result === 'uncertain') return false;
  return false; // No automatic retries: require fresh state and explicit command.
}
