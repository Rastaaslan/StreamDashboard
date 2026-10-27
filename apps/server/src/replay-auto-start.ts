interface ReplayObsState {
  connected: boolean;
  streaming: boolean;
  streamingKnown?: boolean;
  connectionGeneration: number;
}
interface ReplayOutputTarget { kind: string; name: string }
interface ReplayOutputObservation extends ReplayOutputTarget {
  active: boolean | null;
  observedAt: string;
}
interface ReplayAutoStartInput {
  obs: ReplayObsState;
  outputs: Record<string, ReplayOutputTarget>;
  observations: Record<string, ReplayOutputObservation>;
  observationGeneration: number;
  enabled: boolean;
  attempted: boolean;
  now?: number;
}

/** A configured OBS output is sufficient to prepare clips, including an Aitum
 * live without the main output. Platform live flags cannot prove local emission.
 * Unknown observations preserve the attempt latch, so a connection gap cannot
 * repeatedly restart a buffer that the user stopped during the same live. */
export function replayAutoStartDecision(input: ReplayAutoStartInput): { start: boolean; attempted: boolean } {
  const { obs, outputs, observations } = input;
  if (!obs.connected) return { start: false, attempted: input.attempted };
  const now = input.now ?? Date.now();
  let active = obs.streamingKnown !== false && obs.streaming === true;
  let unknown = obs.streamingKnown === false;
  for (const [platform, target] of Object.entries(outputs)) {
    if (target.kind === 'main' || target.kind === 'unconfigured') continue;
    const observed = observations[platform];
    const observedAt = Date.parse(observed?.observedAt);
    const current = input.observationGeneration === obs.connectionGeneration
      && observed?.kind === target.kind && observed.name === target.name
      && Number.isFinite(observedAt) && now - observedAt >= -5_000 && now - observedAt < 45_000;
    if (!current || typeof observed.active !== 'boolean') unknown = true;
    else if (observed.active) active = true;
  }
  if (!active) return { start: false, attempted: unknown ? input.attempted : false };
  if (!input.enabled || input.attempted) return { start: false, attempted: input.attempted };
  return { start: true, attempted: true };
}
