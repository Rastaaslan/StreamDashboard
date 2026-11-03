import type { ObsState } from '../../../packages/contracts/src/index.js';
import type { MixerInventory } from '../../../packages/core/src/streamcockpit-mixer.js';

/** F05: a host-only snapshot of OBS notifications. No polling, level fabrication
 * or OBS command. Reading this cache NEVER advances the evidence timestamp.
 * Reconnect creates a new revision; old plans become invalid.
 */
export class ObsMixerObservation {
  #sample?: MixerInventory;
  #clockFault = false;
  #previousTime = -Infinity;
  #sequence = 0;

  constructor(private readonly wallClock: () => number = Date.now) {}

  observe(state: Pick<ObsState, 'connected' | 'connectionStatus' | 'inputs' | 'error'>, generation: number,
    meters: Readonly<Record<string,{value:number;observedAt:number}>> = {}): void {
    try {
      const now = this.wallClock();
      if (this.#clockFault || !Number.isFinite(now) || now < 0 || now < this.#previousTime ||
          !Number.isSafeInteger(generation) || generation < 0 || !state ||
          typeof state.connected !== 'boolean' || !state.inputs ||
          typeof state.inputs !== 'object' || Array.isArray(state.inputs)) {
        this.#clockFault = true;
        this.#sample = undefined;
        return;
      }
      this.#previousTime = now;
      const sources: MixerInventory['sources'] = Object.entries(state.inputs).map(([id, input]) => {
        if (!id || typeof input?.muted !== 'boolean' || typeof input?.volume !== 'number') {
          throw new Error('INVALID_OBS_INPUT');
        }
        const meter=meters[id];
        // Only a real, recent OBS meter frame proves a peak value. It is not
        // evidence that a source is audible on Twitch or routed to VOD.
        const measured=meter && state.connected===true && state.connectionStatus==='connected' &&
          Number.isFinite(meter.value) && meter.value>=0 && meter.value<=10 &&
          Number.isFinite(meter.observedAt) && meter.observedAt>=0 && meter.observedAt<=now &&
          now-meter.observedAt<=5000;
        return { id, name: id,
          gain: { value: input.volume, observedAt: now, provenance: 'host-obs-client:input-notification' },
          mute: { value: input.muted, observedAt: now, provenance: 'host-obs-client:input-notification' },
          ...(measured?{level:{value:meter.value,observedAt:meter.observedAt,
            provenance:'host-obs-client:InputVolumeMeters'}}:{}),
        };
      });
      this.#sequence++;
      this.#sample = {
        owner: 'FIXE',
        revision: `obs:${generation}:${this.#sequence}`,
        observedAt: now,
        connected: state.connected === true && state.connectionStatus === 'connected',
        sources,
        // OBS gain/mute and an optional measured peak do NOT prove VOD
        // isolation, stream routing, audibility or a local device's presence.
        outputs: [],
        errors: state.error ? ['OBS_TELEMETRY_ERROR'] : [],
      };
    } catch {
      // An invalid host notification must not preserve a previous positive state.
      this.#sample = undefined;
    }
  }

  read(now: number): MixerInventory | undefined {
    if (this.#clockFault || !Number.isFinite(now) || now < this.#previousTime || !this.#sample) return undefined;
    return structuredClone(this.#sample);
  }
}
