import { createHash, randomUUID } from 'node:crypto';
import type { CalendarItem } from '../../../packages/contracts/src/index.js';
import { DEFAULT_UNPLANNED_START_WINDOW_MS } from '../../../packages/core/src/live-planning.js';

export interface ScheduledMomentCandidate {
  id: string;
  title: string;
  startAtUtc: string;
}
interface ObservedStart {
  token: string;
  candidates: ScheduledMomentCandidate[];
  selected?: { id: string; sessionId: string };
}

/** F09 read-only OBS lifecycle observer, not a second stream controller.
 * A schedule is NEVER promoted to a live by its clock alone: there must first
 * be an OBS known-idle -> known-streaming transition witnessed on this FIXE.
 * A paired user must then explicitly choose one of the frozen local candidates.
 * Reconnect, unknown streaming state and stop discard the ephemeral binding.
 */
export class ScheduledMomentBinding {
  private generation: number | undefined;
  private previousStreaming: boolean | undefined;
  private start: ObservedStart | undefined;

  observe(value: { connected: boolean; streamingKnown: boolean; streaming: boolean;
    connectionGeneration: number; observedAt: number; planning: () => CalendarItem[] }) {
    if (!value.connected || !value.streamingKnown || !Number.isSafeInteger(value.observedAt) ||
        !Number.isSafeInteger(value.connectionGeneration)) {
      this.generation = undefined;
      this.previousStreaming = undefined;
      this.start = undefined;
      return;
    }
    if (this.generation !== value.connectionGeneration) {
      this.generation = value.connectionGeneration;
      this.previousStreaming = value.streaming;
      this.start = undefined; // Already live at initial observation is NOT a witnessed start.
      return;
    }
    if (this.previousStreaming === false && value.streaming === true) {
      let planned: CalendarItem[];
      try {
        planned = value.planning();
        if (!Array.isArray(planned) || planned.some(item => !item || typeof item !== 'object'))
          throw new Error('INVALID_SCHEDULES');
      } catch {
        // A corrupt calendar must not break the OBS notification pipeline or
        // turn a failed expansion into a trusted live identity.
        this.start = undefined;
        this.previousStreaming = value.streaming;
        return;
      }
      const matching = planned.filter(item => {
        const start = Date.parse(item.startAtUtc), end = Date.parse(item.endAtUtc);
        return !item.allDay && (item.category === 'live' || item.kind === 'LIVE') &&
          item.draft !== true && !item.deletionPending && !item.transferredTo && !item.transferId &&
          Number.isFinite(start) && Number.isFinite(end) &&
          start <= value.observedAt + DEFAULT_UNPLANNED_START_WINDOW_MS &&
          end > value.observedAt && typeof item.id === 'string' && item.id.length > 0 &&
          item.id.length <= 256 && typeof item.title === 'string' && item.title.length > 0;
      });
      const unique = new Set(matching.map(item => item.id));
      // If the planning is excessive or identities collide, fail closed.
      const candidates = matching.length <= 20 && matching.length === unique.size
        ? matching.map(item => ({ id: item.id, title: item.title.slice(0, 140), startAtUtc: item.startAtUtc }))
        : [];
      this.start = { token: randomUUID(), candidates };
    } else if (!value.streaming) {
      this.start = undefined;
    }
    this.previousStreaming = value.streaming;
  }

  snapshot() {
    return { available: Boolean(this.start), candidates: this.start?.candidates.map(item => ({ ...item })) ?? [],
      sessionId: this.start?.selected?.sessionId };
  }

  select(candidateId: string): string {
    if (!this.start || typeof candidateId !== 'string' || candidateId.length > 256 ||
        !this.start.candidates.some(item => item.id === candidateId))
      throw new Error('MOMENTS_SCHEDULE_NOT_VERIFIED');
    if (this.start.selected) {
      if (this.start.selected.id !== candidateId) throw new Error('MOMENTS_SCHEDULE_ALREADY_BOUND');
      return this.start.selected.sessionId;
    }
    // Opaque per-observed-OBS-run identity, not a calendar ID or client clock.
    const digest = createHash('sha256').update(JSON.stringify([this.start.token, candidateId])).digest('hex');
    const sessionId = 'scheduled_' + digest;
    this.start.selected = { id: candidateId, sessionId };
    return sessionId;
  }

  activeSessionId() { return this.start?.selected?.sessionId; }
}
