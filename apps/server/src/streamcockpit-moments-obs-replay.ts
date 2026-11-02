import type { MomentInput } from '../../../packages/core/src/streamcockpit-moments.js';
import { momentIdentifier } from '../../../packages/core/src/streamcockpit-moments.js';

/** A saved-replay notification witnessed by FIXE OBS. Its filename/path never
 * leaves the OBS adapter: sourceEventId is a one-way digest, not a file link. */
export interface ObsSavedReplayEvent {
  sourceEventId: string;
  connectionGeneration: number;
  streamEpoch: number;
  observedAt: number;
}

interface ObsSnapshot {
  connected: boolean;
  streamingKnown: boolean;
  streaming: boolean;
  connectionGeneration: number;
  streamEpoch: number;
}

export class ObsReplayMomentProducer {
  private readonly attempted = new Set<string>();
  constructor(private readonly options: {
    snapshot(): ObsSnapshot;
    hostEligible(): Promise<boolean>;
    activeSessionId(): Promise<string | undefined>;
    record(input: MomentInput): Promise<unknown>;
  }) {}

  /** At most one journal attempt per event in this runtime. Never retry an
   * uncertain SQLite commit, and NEVER call SaveReplayBuffer or another OBS
   * action. Both the live identity and host ownership are rechecked after awaits.
   * This is not an atomic transaction with OBS during the final journal commit. */
  async observe(event: ObsSavedReplayEvent): Promise<'ignored' | 'recorded'> {
    if (!event || !Number.isSafeInteger(event.observedAt) || event.observedAt < 0 ||
        !Number.isSafeInteger(event.connectionGeneration) || event.connectionGeneration < 0 ||
        !Number.isSafeInteger(event.streamEpoch) || event.streamEpoch < 0)
      return 'ignored';
    try { momentIdentifier(event.sourceEventId); } catch { return 'ignored'; }
    if (!event.sourceEventId.startsWith('obs_replay_')) return 'ignored';
    const key = event.connectionGeneration + ':' + event.streamEpoch + ':' + event.sourceEventId;
    if (this.attempted.has(key)) return 'ignored';
    this.attempted.add(key);
    if (this.attempted.size > 512) this.attempted.delete(this.attempted.values().next().value!);

    const valid = () => {
      const state = this.options.snapshot();
      return state.connected && state.streamingKnown && state.streaming &&
        state.connectionGeneration === event.connectionGeneration && state.streamEpoch === event.streamEpoch;
    };
    if (!valid()) return 'ignored';
    const first = await this.options.activeSessionId();
    if (!first || !valid()) return 'ignored';
    if (!await this.options.hostEligible() || !valid()) return 'ignored';
    const second = await this.options.activeSessionId();
    if (first !== second || !valid()) return 'ignored';
    try { momentIdentifier(second); } catch { return 'ignored'; }
    await this.options.record({
      sessionId: second,
      source: 'obs', status: 'observed', instant: event.observedAt,
      sourceEventId: event.sourceEventId,
      correlationId: event.sourceEventId,
      title: 'Replay OBS sauvegardé',
    });
    return 'recorded';
  }
}
