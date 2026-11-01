/** F04/F09 v1: observations only; this contract never issues provider commands. */
export type MomentSource = 'obs' | 'twitch' | 'manual' | 'streamlabs';
export interface MomentInput {
  sessionId: string;
  /** UTC Unix milliseconds supplied by the authoritative producer. */
  instant: number;
  source: MomentSource;
  correlationId: string;
  sourceEventId?: string;
  title: string;
  status: 'observed' | 'confirmed' | 'failed' | 'uncertain';
  /** Opaque reference resolved by a trusted adapter, never a URL/path/token. */
  clip?: { provider: 'obs' | 'twitch'; reference: string };
}
export interface Moment extends MomentInput { sequence: number }
export interface MarkerExport {
  schemaVersion: 1;
  kind: 'streamcockpit-markers';
  sessionId: string;
  timebase: 'unix-ms';
  markers: Moment[];
}
function invalid(): never { throw new Error('INVALID_MOMENT'); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) invalid();
}
export function momentIdentifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) return invalid();
  return value;
}
export function validateMoment(value: unknown): MomentInput {
  const v = object(value);
  keys(v, ['sessionId', 'instant', 'source', 'correlationId', 'sourceEventId', 'title', 'status', 'clip']);
  if (!Number.isSafeInteger(v.instant) || (v.instant as number) < 0 || (v.instant as number) > 8640000000000000) invalid();
  if (!['obs', 'twitch', 'manual', 'streamlabs'].includes(v.source as string)) invalid();
  if (!['observed', 'confirmed', 'failed', 'uncertain'].includes(v.status as string)) invalid();
  // Do not accept raw provider payloads or common credential/URL forms in display text.
  if (typeof v.title !== 'string' || v.title.trim() !== v.title || !v.title.length || v.title.length > 240 ||
      /[\x00-\x1f\x7f]|(?:https?:\/\/|oauth:|bearer\s|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|stream[_ -]?key)/i.test(v.title)) invalid();
  const result: MomentInput = {
    sessionId: momentIdentifier(v.sessionId), instant: v.instant as number,
    source: v.source as MomentSource, correlationId: momentIdentifier(v.correlationId),
    title: v.title, status: v.status as MomentInput['status'],
  };
  if ('sourceEventId' in v) result.sourceEventId = momentIdentifier(v.sourceEventId);
  if ('clip' in v) {
    const clip = object(v.clip); keys(clip, ['provider', 'reference']);
    if (clip.provider !== 'obs' && clip.provider !== 'twitch') invalid();
    result.clip = { provider: clip.provider, reference: momentIdentifier(clip.reference) };
  }
  return result;
}
/** Stable chronological order, including late events and ties. */
export function orderMoments(moments: readonly Moment[]): Moment[] {
  return [...moments].sort((a, b) => a.instant - b.instant || a.sequence - b.sequence);
}
export function exportMarkers(sessionId: string, moments: readonly Moment[]): MarkerExport {
  momentIdentifier(sessionId);
  return { schemaVersion: 1, kind: 'streamcockpit-markers', sessionId, timebase: 'unix-ms',
    markers: orderMoments(moments.filter(m => m.sessionId === sessionId)).map(m => ({
      ...validateMoment(Object.fromEntries(Object.entries(m).filter(([key]) => key !== 'sequence'))), sequence: m.sequence,
    })) };
}
