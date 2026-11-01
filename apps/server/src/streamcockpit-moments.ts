import { createHash } from 'node:crypto';
import { exportMarkers, validateMoment, type Moment, type MomentInput } from '../../../packages/core/src/streamcockpit-moments.js';

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
  async export(sessionId: string) {
    return exportMarkers(sessionId, project(decode(await this.storage.read()).requests));
  }
}
