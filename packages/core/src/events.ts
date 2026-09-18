import { randomUUID } from 'node:crypto';
import type { EventEnvelope } from '../../contracts/src/index.js';

const TOKEN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;

export interface EventInput<T> {
  type: string;
  source: string;
  payload: T;
  occurredAt?: string;
  correlationId?: string;
}

export function createEventEnvelope<T>(input: EventInput<T>, now = () => new Date()): EventEnvelope<T> {
  if (!TOKEN.test(input.type) || input.type.length > 120) throw new Error('Event type invalide.');
  if (!TOKEN.test(input.source) || input.source.length > 80) throw new Error('Event source invalide.');
  const receivedAt = now().toISOString();
  const occurredAt = input.occurredAt ?? receivedAt;
  if (!Number.isFinite(Date.parse(occurredAt))) throw new Error('Event occurredAt invalide.');
  const correlationId = input.correlationId ?? randomUUID();
  if (!correlationId || correlationId.length > 128) throw new Error('Event correlationId invalide.');
  return { eventId: randomUUID(), schemaVersion: 1, type: input.type, source: input.source, occurredAt, receivedAt, correlationId, payload: input.payload };
}

/** In-process event core. Diagnostics are intentionally bounded and never a business history. */
export class EventCore {
  private readonly events: EventEnvelope[] = [];
  private readonly listeners = new Set<(event: EventEnvelope) => void>();

  constructor(private readonly capacity = 250) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10_000) throw new Error('Event capacity invalide.');
  }

  publish<T>(input: EventInput<T>): EventEnvelope<T> {
    const event = createEventEnvelope(input);
    this.events.push(event);
    if (this.events.length > this.capacity) this.events.splice(0, this.events.length - this.capacity);
    for (const listener of this.listeners) listener(event);
    return event;
  }

  recent(filter: { type?: string; source?: string; correlationId?: string; limit?: number } = {}) {
    const limit = Math.min(250, Math.max(1, filter.limit ?? 100));
    return this.events.filter(event => (!filter.type || event.type === filter.type)
      && (!filter.source || event.source === filter.source)
      && (!filter.correlationId || event.correlationId === filter.correlationId)).slice(-limit);
  }

  subscribe(listener: (event: EventEnvelope) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
