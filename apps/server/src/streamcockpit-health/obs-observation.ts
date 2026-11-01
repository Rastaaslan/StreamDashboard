import {performance} from 'node:perf_hooks';
import {healthPolicy, type Observation} from '../../../../packages/core/src/streamcockpit-health/index.js';

/** Server-local receipt of the existing ObsClient notification only. Never seed
 * from a snapshot, HTTP payload or a cache read. No transport or timer owned here.
 * The host clock is checked against monotonic elapsed time; a detected fault
 * fences this recorder until runtime restart rather than re-dating old evidence.
 */
export class ObsHealthObservation {
  #sample?: Observation;
  #anchor?: {wall: number; monotonic: number};
  #lastWall = -Infinity;
  #lastMonotonic = -Infinity;
  #clockFault = false;

  constructor(private readonly wallClock = Date.now, private readonly monotonicClock = () => performance.now()) {}

  #checkClock(wall: number): boolean {
    try {
      const monotonic = this.monotonicClock();
      if (!Number.isFinite(wall) || wall < 0 || !Number.isFinite(monotonic) || monotonic < 0
        || wall < this.#lastWall || monotonic < this.#lastMonotonic
        || (this.#anchor && Math.abs((wall - this.#anchor.wall) - (monotonic - this.#anchor.monotonic)) > healthPolicy.clockToleranceMs)) {
        this.#clockFault = true;
      }
      this.#anchor ??= {wall, monotonic};
      this.#lastWall = wall;
      this.#lastMonotonic = monotonic;
    } catch { this.#clockFault = true; }
    if (this.#clockFault) this.#sample = undefined;
    return !this.#clockFault;
  }

  /** Synchronous hook before other consumers can mutate state. Only fields
   * emitted by the local client are accepted; no live state or errors retained. */
  observe(state: {connected: boolean; connectionStatus?: string}): void {
    try {
      const now = this.wallClock();
      if (!this.#checkClock(now)) return;
      const connected = state.connected === true && state.connectionStatus === 'connected';
      const disconnected = state.connected === false && ['offline', 'error'].includes(state.connectionStatus ?? '');
      this.#sample = connected || disconnected ? {
        provenance: 'host-obs-client:state-notification (connection only)',
        observedAt: now, receivedAt: now, data: {connected},
      } : undefined;
    } catch { this.#clockFault = true; this.#sample = undefined; }
  }

  read(now: number): Observation | undefined {
    if (!this.#checkClock(now) || !this.#sample) return undefined;
    return {...this.#sample, data: {...this.#sample.data}};
  }
}
