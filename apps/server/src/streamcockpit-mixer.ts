import type { AudioOutput, ObsState } from '../../../packages/contracts/src/index.js';
import { mixerTelemetry, previewMixerPlan, type MixerInventory, type MixerPlanRequest } from '../../../packages/core/src/streamcockpit-mixer.js';

/** Existing ObsState does not establish device health, routing or measured levels.
 * Caller must supply actual observation time (never read time) and owner revision.
 * The outputs callback must enumerate only; never inject play/setVolume/stop. */
export async function readMixerInventory(input: {
  obs: Pick<ObsState, 'connected' | 'inputs' | 'error'>;
  owner: string; revision: string; observedAt: number;
  readOutputs: () => Promise<AudioOutput[]>;
}): Promise<MixerInventory> {
  const { owner, revision, observedAt } = input;
  const errors = input.obs.error ? ['OBS_TELEMETRY_ERROR'] : [];
  // Capture before awaiting outputs so later mutations cannot alter this observation.
  const connected = input.obs.connected;
  const sources = Object.entries(input.obs.inputs).map(([name, state]) => ({
    id: name, name,
    gain: { value: state.volume, observedAt, provenance: 'ObsState.inputs.volume' },
    mute: { value: state.muted, observedAt, provenance: 'ObsState.inputs.muted' },
  }));
  let outputs: AudioOutput[] = [];
  try { outputs = (await input.readOutputs()).map(o => ({ ...o })); }
  catch { errors.push('LOCAL_OUTPUTS_UNAVAILABLE'); }
  return { owner, revision, observedAt, connected, sources, outputs, errors };
}

/** Isolated facade, deliberately unmounted. No writer or automatic fallback. */
export function createMixerReader(read: () => Promise<MixerInventory>, now: () => number = Date.now) {
  return {
    telemetry: async () => mixerTelemetry(await read(), now()),
    preview: async (request: MixerPlanRequest) => previewMixerPlan(await read(), request, now()),
  };
}
