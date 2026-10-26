import { observeObsHealth, type ObsHealth, type ObsReadOnlyClient } from './read-only-observer.js';
import type { AgentObservation } from '../../../packages/contracts/src/agent-v2.js';
/** Prototype loop, no listener or controller channel. Explicitly started by future service harness only. */
export interface AgentReadOnlyRunnerOptions {
  client: ObsReadOnlyClient;
  deviceId: string;
  signal: AbortSignal;
  now(): number;
  sleep(milliseconds: number, signal: AbortSignal): Promise<void>;
  emit(snapshot: AgentObservation<ObsHealth>): void;
  reportUnreachable(reason: string): void;
}
export async function runReadOnlyAgent(options: AgentReadOnlyRunnerOptions): Promise<void> {
  let revision=0;
  while(!options.signal.aborted) {
    try {
      const next=await observeObsHealth(options.client,options.deviceId,++revision,options.now());
      if(options.signal.aborted) return;
      options.emit(next);
    } catch {
      if(options.signal.aborted) return;
      // Do not fabricate a connected snapshot: previously observed state expires.
      options.reportUnreachable('OBS_READ_UNAVAILABLE');
    }
    if(options.signal.aborted) return;
    await options.sleep(5000,options.signal);
  }
}

[executed on device: dam-server (ee881f3f-7909-4993-a915-04a1d994f366)]