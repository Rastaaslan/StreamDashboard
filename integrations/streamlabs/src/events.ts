import { createHash, randomUUID } from 'node:crypto';

export interface StreamlabsEvent {
  id: string; platform: 'twitch' | 'youtube' | 'streamlabs'; type: string;
  displayName: string; message: string; receivedAt: string; occurredAt: string | null;
  amount?: number; currency?: string; amountLabel?: string;
  count?: number; months?: number; subType?: string; recipient?: string; test: boolean;
}
const text = (value: unknown, max: number) => typeof value === 'string' || typeof value === 'number' ? String(value).slice(0, max) : '';
const count = (value: unknown) => value !== undefined && value !== null && value !== '' && Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : undefined;

const STREAMLABS_CONTROL_TYPES = new Set(['rollendcredits', 'sessionreset', 'userstatesessionreset']);

/** Socket control commands are not viewer activity. Keep unknown activity types
 * so new provider events are not silently discarded. */
export function isStreamlabsActivityType(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9_-]{0,39}$/i.test(value)
    && !STREAMLABS_CONTROL_TYPES.has(value.toLowerCase().replace(/[-_]/g, ''));
}

/** Whitelist public display fields; never persist a raw provider packet. */
export function normalizeStreamlabsEvents(value: unknown, now = new Date()): StreamlabsEvent[] {
  if (!value || typeof value !== 'object') return [];
  const packet = value as Record<string, unknown>;
  const type = text(packet.type, 40).toLowerCase().replace(/^raids$/, 'raid');
  if (!isStreamlabsActivityType(type)) return [];
  const platform = packet.for === 'twitch_account' ? 'twitch' : packet.for === 'youtube_account' ? 'youtube' : !packet.for || packet.for === 'streamlabs' ? 'streamlabs' : null;
  if (!platform) return [];
  const rows = Array.isArray(packet.message) ? packet.message : [packet.message];
  return rows.slice(0, 500).flatMap((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    const rawDate = row.created_at ?? row.createdAt ?? row.publishedAt;
    // Undated/ambiguous provider timestamps stay unknown; receipt time is explicit.
    const occurredAt = typeof rawDate === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(rawDate) && Number.isFinite(Date.parse(rawDate)) ? new Date(rawDate).toISOString() : null;
    const displayName = text(row.name ?? row.from, 100) || 'Anonyme';
    const message = text(row.message ?? row.comment, 2_000);
    const amount = Number(row.amount);
    const currency = text(row.currency, 3).toUpperCase();
    const event: StreamlabsEvent = {
      id: '', platform, type, displayName, message, receivedAt: now.toISOString(), occurredAt,
      test: packet.isTest === true || packet.is_test === true || row.isTest === true || row.is_test === true,
    };
    if (['donation', 'superchat'].includes(type) && row.amount !== undefined && Number.isFinite(amount) && amount >= 0 && /^[A-Z]{3}$/.test(currency)) {
      event.amount = type === 'superchat' ? amount / 1_000_000 : amount;
      event.currency = currency;
      event.amountLabel = text(row.formatted_amount ?? row.formattedAmount ?? row.displayString, 80);
    }
    if (type === 'bits') event.count = count(row.amount);
    if (type === 'raid' || type === 'host') event.count = count(row.raiders ?? row.viewers);
    if (type === 'subscription') {
      event.months = count(row.months); event.count = count(row.gifted ?? row.count);
      event.subType = text(row.sub_type ?? row.subType, 40);
      event.recipient = text(row.recipient ?? row.recipient_name, 100);
    }
    // _id is the row event identity; a channel/user id alone is not an event id.
    const identity = row._id ?? (['donation','bits','superchat'].includes(type) && row.id ? row.id : undefined) ?? (packet.event_id ? `${text(packet.event_id, 300)}:${index}` : rawDate ? JSON.stringify([row.id, rawDate, displayName, message, event.amount, event.count, event.months, event.subType, event.recipient, event.test]) : randomUUID());
    event.id = createHash('sha256').update(JSON.stringify([platform, type, text(identity, 6_000)])).digest('hex');
    return [event];
  });
}
