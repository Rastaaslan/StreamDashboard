import { createHash } from 'node:crypto';
import { exportMarkers, momentIdentifier, validateMoment, type Moment, type MomentInput } from '../../../packages/core/src/streamcockpit-moments.js';

/** CAS must be exclusive across all writers, atomic and durable before success.
 * null means absent, never unreadable/corrupt. A rejected write may have committed:
 * retry the SAME input to reconcile. Never blindly repeat an external action. */
export interface MomentsStorage {
  read(): Promise<string | null>;
  compareAndSwap(expected: string | null, replacement: string): Promise<boolean>;
}
interface State { schemaVersion: 1; requests: MomentInput[] }
const fingerprint = (input: MomentInput) => JSON.stringify(input);
const hash = (payload: string) => createHash('sha256').update(payload).digest('hex');
const sameEvent = (a: MomentInput, b: MomentInput) => a.sessionId === b.sessionId && a.source === b.source &&
  a.sourceEventId !== undefined && a.sourceEventId === b.sourceEventId;
const sameRequest = (a: MomentInput, b: MomentInput) => a.sessionId === b.sessionId && a.correlationId === b.correlationId;
const content = ({ correlationId: _correlationId, ...rest }: MomentInput) => JSON.stringify(rest);
function project(requests: MomentInput[]): Moment[] {
  const accepted: MomentInput[] = [], moments: Moment[] = [];
  for (const request of requests) {
    if (accepted.some(a => sameRequest(a, request))) throw new Error('CORRUPT_MOMENTS');
    const event = moments.find(a => sameEvent(a, request));
    if (event) {
      const { sequence: _sequence, ...original } = event;
      if (content(original) !== content(request)) throw new Error('CORRUPT_MOMENTS');
    } else moments.push({ ...request, sequence: moments.length + 1 });
    accepted.push(request);
  }
  return moments;
}
function decode(raw: string | null): State {
  if (raw === null) return { schemaVersion: 1, requests: [] };
  try {
    const envelope = JSON.parse(raw);
    if (Object.keys(envelope).sort().join() !== 'payload,sha256' || typeof envelope.payload !== 'string' || hash(envelope.payload) !== envelope.sha256) throw 0;
    const state = JSON.parse(envelope.payload);
    if (Object.keys(state).sort().join() !== 'requests,schemaVersion' || state.schemaVersion !== 1 || !Array.isArray(state.requests)) throw 0;
    const requests = state.requests.map(validateMoment);
    project(requests);
    return { schemaVersion: 1, requests };
  } catch { throw new Error('CORRUPT_MOMENTS'); }
}
function encode(state: State): string {
  const payload = JSON.stringify(state);
  return JSON.stringify({ payload, sha256: hash(payload) });
}
export interface ObservedMomentSession {
  sessionId: string;
  markerCount: number;
  /** Timestamp of the latest marker, NOT a stream end time. */
  lastMarkerAt: number;
}

export class MomentsPipeline {
  constructor(private readonly storage: MomentsStorage) {}
  async record(value: unknown): Promise<{ moment: Moment; outcome: 'created' | 'replayed' | 'deduplicated' }> {
    const input = validateMoment(value);
    for (let attempt = 0; attempt < 16; attempt++) {
      const raw = await this.storage.read(), state = decode(raw), moments = project(state.requests);
      const previous = state.requests.find(a => sameRequest(a, input));
      if (previous && fingerprint(previous) !== fingerprint(input)) throw new Error('MOMENT_IDEMPOTENCY_CONFLICT');
      const event = moments.find(a => sameRequest(a, input) || sameEvent(a, input));
      if (previous) {
        // Re-establish durability even after a rename whose directory sync failed.
        if (await this.storage.compareAndSwap(raw, raw!)) return { moment: event!, outcome: 'replayed' };
        continue;
      }
      if (event) {
        const { sequence: _sequence, ...original } = event;
        if (content(original) !== content(input)) throw new Error('MOMENT_EVENT_CONFLICT');
      }
      state.requests.push(input);
      if (await this.storage.compareAndSwap(raw, encode(state))) return {
        moment: event ?? { ...input, sequence: moments.length + 1 }, outcome: event ? 'deduplicated' : 'created',
      };
    }
    throw new Error('MOMENTS_BUSY');
  }
  /** A manual observation comes from the authoritative FIXE clock, not the
   * phone clock. Retry with the SAME device-scoped correlation ID and title
   * reconciles the original durable instant; a changed session is a conflict.
   * Neither this method nor its callers issue external provider commands. */
  async recordHostManual(value: { sessionId: string; correlationId: string; title: string; instant: number }):
      Promise<{ moment: Moment; outcome: 'created' | 'replayed' }> {
    const input = validateMoment({ ...value, source: 'manual', status: 'observed' });
    for (let attempt = 0; attempt < 16; attempt++) {
      const raw = await this.storage.read(), state = decode(raw), moments = project(state.requests);
      const previous = state.requests.find(a => a.correlationId === input.correlationId);
      if (previous) {
        if (previous.sessionId !== input.sessionId || previous.source !== 'manual' ||
            previous.status !== 'observed' || previous.title !== input.title ||
            previous.sourceEventId !== undefined || previous.clip !== undefined)
          throw new Error('MOMENT_IDEMPOTENCY_CONFLICT');
        const moment = moments.find(a => sameRequest(a, previous));
        if (!moment) throw new Error('CORRUPT_MOMENTS');
        // Even a replay requires the backend's durable barrier.
        if (await this.storage.compareAndSwap(raw, raw!)) return { moment, outcome: 'replayed' };
        continue;
      }
      if (moments.length >= 10000) throw new Error('MOMENTS_TOO_MANY');
      state.requests.push(input);
      if (await this.storage.compareAndSwap(raw, encode(state)))
        return { moment: { ...input, sequence: moments.length + 1 }, outcome: 'created' };
    }
    throw new Error('MOMENTS_BUSY');
  }
  /** Reconcile a lost manual-write response by reading only the host journal.
   * A missing row is NOT proof that an in-flight transaction cannot commit;
   * callers must never turn it into permission to retry a write automatically.
   */
  async lookupHostManual(correlationId: string): Promise<{ journalObserved: boolean; moment?: Moment }> {
    const raw = await this.storage.read();
    if (raw === null) return { journalObserved: false };
    const moments = project(decode(raw).requests);
    return { journalObserved: true,
      moment: moments.find(moment => moment.source === 'manual' && moment.correlationId === correlationId) };
  }
  async export(sessionId: string) {
    return exportMarkers(sessionId, project(decode(await this.storage.read()).requests));
  }
  /** Discover ONLY sessions present in the FIXE durable marker journal.
   * Never infer a live, a start/end time, or a session from client history.
   * Absence of a journal is unknown; corrupt or excessive data fails closed.
   */
  async listObservedSessions(): Promise<ObservedMomentSession[] | undefined> {
    const raw = await this.storage.read();
    if (raw === null) return undefined;
    const moments = project(decode(raw).requests);
    if (moments.length > 10000) throw new Error('MOMENTS_TOO_MANY');
    const sessions = new Map<string, ObservedMomentSession>();
    for (const moment of moments) {
      const entry = sessions.get(moment.sessionId);
      if (entry) {
        entry.markerCount++;
        entry.lastMarkerAt = Math.max(entry.lastMarkerAt, moment.instant);
      } else {
        sessions.set(moment.sessionId, { sessionId: moment.sessionId, markerCount: 1, lastMarkerAt: moment.instant });
        if (sessions.size > 1000) throw new Error('MOMENTS_TOO_MANY_SESSIONS');
      }
    }
    return [...sessions.values()].sort((a, b) => b.lastMarkerAt - a.lastMarkerAt || a.sessionId.localeCompare(b.sessionId));
  }
  /** A missing durable journal is UNKNOWN, not evidence of an empty session.
   * Read once so deletion/replacement cannot turn a missing file into a false zero.
   * This has no writer side effects and never creates a local fallback.
   */
  async exportObserved(sessionId: string) {
    momentIdentifier(sessionId);
    const raw = await this.storage.read();
    if (raw === null) return undefined;
    const moments = project(decode(raw).requests);
    // A global journal says nothing about sessions it has never observed.
    // Don't turn an unknown session into an authoritative zero-marker result.
    if (!moments.some(moment => moment.sessionId === sessionId)) return undefined;
    return exportMarkers(sessionId, moments);
  }
}
