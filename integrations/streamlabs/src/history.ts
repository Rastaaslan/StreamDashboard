import { createHash } from 'node:crypto';
import { isStreamlabsActivityType, type StreamlabsEvent } from './events.js';

// Only activity collections are inspected. In particular, the same response can
// contain platform credentials; neither those nor raw row objects are retained.
const COLLECTION_TYPES: Readonly<Record<string, readonly string[]>> = {
  donations: ['donation'],
  subscriptions: ['subscription'],
  follows: ['follow'],
  raids: ['raid'],
  bits: ['bits'],
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
    ? String(value).slice(0, max) : '';
}

function name(...values: unknown[]): string {
  for (const value of values) {
    const candidate = text(value, 100).trim();
    if (candidate) return candidate;
  }
  return '';
}

function nonnegative(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  if (typeof value === 'string' && !value.trim()) return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function count(value: unknown): number | undefined {
  const number = nonnegative(value);
  return number !== undefined && Number.isSafeInteger(number) ? number : undefined;
}

function identity(value: unknown): string | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  return typeof value === 'string' && value.length > 0 && value.length <= 6_000 && value.trim()
    ? value : null;
}

/** The recent-events API defines its timezone-less SQL dates as UTC. Validate
 * calendar components before parsing so an impossible date cannot roll over.
 * This rule intentionally does not change the Socket API's timestamp handling. */
function cloudDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, fraction, zone] = match;
  const milliseconds = (fraction ?? '').padEnd(3, '0');
  const local = `${year}-${month}-${day}T${hour}:${minute}:${second}.${milliseconds}Z`;
  const localTime = Date.parse(local);
  if (!Number.isFinite(localTime) || new Date(localTime).toISOString() !== local) return null;
  if (zone && zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59)) return null;
  const instant = Date.parse(`${local.slice(0, -1)}${zone ?? 'Z'}`);
  return Number.isFinite(instant) ? new Date(instant).toISOString() : null;
}

/** Normalize read-only cloud history into public display fields. An import is
 * never a socket notification and must not be sent through alert automations. */
export function normalizeStreamlabsHistory(payload: unknown, now = new Date()): StreamlabsEvent[] {
  const data = record(record(payload)?.data);
  if (!data) return [];
  const events: StreamlabsEvent[] = [];
  const receivedAt = now.toISOString();
  for (const [collection, types] of Object.entries(COLLECTION_TYPES)) {
    const rows = data[collection];
    if (!Array.isArray(rows)) continue;
    for (const value of rows) {
      const row = record(value);
      if (!row || typeof row.type !== 'string' || !types.includes(row.type) || !isStreamlabsActivityType(row.type)) continue;
      const type = row.type;
      const platform = row.platform === 'twitch_account' ? 'twitch'
        : row.platform === 'youtube_account' ? 'youtube'
          : row.platform === 'streamlabs' ? 'streamlabs' : null;
      if (!platform) continue;
      const occurredAt = cloudDate(row.created_at);
      const eventIdentity = identity(row._id);
      const providerId = identity(row.id);
      // Some numeric ids identify users rather than events. Without an event
      // _id, a real date is necessary to distinguish two activities by one user.
      if (!eventIdentity && (!providerId || !occurredAt)) continue;
      const cloudIdentity = eventIdentity ?? `cloud:${JSON.stringify([row.platform, type, row.created_at, providerId])}`;
      const subType = text(row.sub_type ?? row.subType, 40);
      const gift = type === 'subscription' && /gift/i.test(subType);
      const event: StreamlabsEvent = {
        // Match the Socket API's exact _id hash when an actual event _id exists.
        // Otherwise this namespaced composite is stable across repeated imports.
        id: createHash('sha256').update(JSON.stringify([platform, type, cloudIdentity])).digest('hex'),
        platform, type,
        displayName: (gift
          ? name(row.gifter_display_name, row.gifter, row.from_display_name, row.from)
          : name(row.display_name, row.name, row.from_display_name, row.from)) || 'Anonyme',
        message: text(row.message ?? row.comment, 2_000),
        receivedAt, occurredAt, origin: 'cloud',
        test: row.isTest === true || row.is_test === true,
      };
      if (type === 'donation') {
        const amount = nonnegative(row.amount);
        const currency = typeof row.currency === 'string' ? row.currency.trim().toUpperCase() : '';
        const amountLabel = text(row.formatted_amount ?? row.formattedAmount ?? row.displayString, 80);
        if (amount !== undefined) event.amount = amount;
        if (/^[A-Z]{3}$/.test(currency)) event.currency = currency;
        // Recent donations can have a formatted label but no currency field.
        if (amountLabel) event.amountLabel = amountLabel;
      }
      if (type === 'bits') {
        const amount = count(row.amount);
        if (amount !== undefined) event.count = amount;
      }
      if (type === 'raid') {
        const viewers = count(row.raiders ?? row.viewers);
        if (viewers !== undefined) event.count = viewers;
      }
      if (type === 'subscription') {
        const months = count(row.months);
        const gifts = count(row.gifted ?? row.count);
        const recipient = gift
          ? name(row.recipient, row.recipient_name, row.display_name, row.name)
          : name(row.recipient, row.recipient_name);
        if (months !== undefined) event.months = months;
        if (gifts !== undefined) event.count = gifts;
        if (subType) event.subType = subType;
        if (recipient) event.recipient = recipient;
      }
      events.push(event);
    }
  }
  return mergeStreamlabsHistory([], events, events.length);
}

function eventTime(event: StreamlabsEvent): number {
  const occurred = typeof event.occurredAt === 'string' ? Date.parse(event.occurredAt) : NaN;
  if (Number.isFinite(occurred)) return occurred;
  // Import time says nothing about when an undated cloud activity happened.
  if (event.origin === 'cloud') return Number.NEGATIVE_INFINITY;
  const received = Date.parse(event.receivedAt);
  return Number.isFinite(received) ? received : Number.NEGATIVE_INFINITY;
}

function key(event: StreamlabsEvent): string {
  return JSON.stringify([event.platform, event.type, event.id]);
}

function combine(first: StreamlabsEvent, second: StreamlabsEvent): StreamlabsEvent {
  const preferred = first.origin === 'cloud' && second.origin !== 'cloud' ? second : first;
  const fallback = preferred === first ? second : first;
  const combined: StreamlabsEvent = { ...structuredClone(fallback), ...structuredClone(preferred) };
  if (!Number.isFinite(Date.parse(preferred.occurredAt ?? '')) && Number.isFinite(Date.parse(fallback.occurredAt ?? ''))) {
    combined.occurredAt = fallback.occurredAt;
  }
  // A matching cloud row can enrich a local row without relabeling it as cloud.
  if (preferred.origin !== 'cloud') delete combined.origin;
  return combined;
}

/** Merge by exact event identity only, newest known activity first. Legacy
 * local ids cannot always be related to cloud numeric ids safely; retain both
 * when no shared _id exists, even if viewer names and amounts happen to match.
 * The first array may itself contain older cloud history (a cache refresh).
 */
export function mergeStreamlabsHistory(
  localItems: readonly StreamlabsEvent[], cloudItems: readonly StreamlabsEvent[], limit = 1_000,
): StreamlabsEvent[] {
  const items = new Map<string, StreamlabsEvent>();
  for (const source of [localItems, cloudItems]) {
    for (const event of source) {
      if (!event || typeof event.id !== 'string' || !event.id || !isStreamlabsActivityType(event.type)) continue;
      const eventKey = key(event);
      const existing = items.get(eventKey);
      items.set(eventKey, existing ? combine(existing, event) : structuredClone(event));
    }
  }
  const boundedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 1_000;
  return [...items.values()].sort((a, b) => {
    const aTime = eventTime(a), bTime = eventTime(b);
    if (aTime !== bTime) return aTime > bTime ? -1 : 1;
    const aKey = key(a), bKey = key(b);
    return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
  }).slice(0, boundedLimit);
}
