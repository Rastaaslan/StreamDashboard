/** F05: data and previews only. No transport or command executor. */
export type Evidence<T> = { value: T; observedAt: number; provenance: string };
export type Reading<T> = { state: 'known'; value: T; observedAt: number; provenance: string } | { state: 'unknown'; reason: string };
export interface MixerSource {
  id: string;
  name: string;
  gain?: Evidence<number>; // OBS multiplier, NOT a signal meter
  mute?: Evidence<boolean>;
  level?: Evidence<number>; // measured peak amplitude; 0 means measured silence
  stream?: Evidence<boolean>; // configured route, not proof of audibility
  monitor?: Evidence<boolean>;
  vod?: Evidence<boolean>;
  device?: Evidence<'present' | 'missing'>;
  policy?: 'spotify-excluded-from-vod';
}
export interface MixerInventory {
  revision: string; // host-owned, changes on reconnect, inventory and control changes
  owner: string;
  connected: boolean;
  observedAt: number;
  sources: MixerSource[];
  outputs: { id: string; name: string; selectable: boolean; isDefault: boolean }[];
  errors: string[];
}
export interface MixerRow {
  id: string; name: string;
  gain: Reading<number>; mute: Reading<boolean>; level: Reading<number>;
  stream: Reading<boolean>; monitor: Reading<boolean>; vod: Reading<boolean>;
  device: Reading<'present' | 'missing'>;
  policy?: MixerSource['policy'];
}
const fresh = (at: number, now: number) => Number.isFinite(at) && at >= 0 && at <= now && now - at <= 5000;
function reading<T>(e: Evidence<T> | undefined, now: number, valid: (v: T) => boolean, usable: boolean): Reading<T> {
  if (!usable) return { state: 'unknown', reason: 'inventory-unavailable' };
  if (!e) return { state: 'unknown', reason: 'not-observed' };
  if (!fresh(e.observedAt, now) || !e.provenance?.trim() || !valid(e.value)) return { state: 'unknown', reason: 'invalid-or-stale-evidence' };
  return { state: 'known', ...e };
}
export function mixerTelemetry(inventory: MixerInventory, now: number) {
  const errors = [...inventory.errors];
  if (inventory.owner !== 'FIXE') errors.push('OBS_OWNER_MUST_BE_FIXE');
  if (!inventory.connected) errors.push('OBS_OFFLINE');
  if (!inventory.revision.trim() || !fresh(inventory.observedAt, now)) errors.push('INVALID_OR_STALE_INVENTORY');
  if (new Set(inventory.sources.map(s => s.id)).size !== inventory.sources.length || inventory.sources.some(s => !s.id.trim() || !s.name.trim())) errors.push('INVALID_SOURCE_IDENTITY');
  if (new Set(inventory.outputs.map(o => o.id)).size !== inventory.outputs.length) errors.push('DUPLICATE_OUTPUT');
  const usable = errors.length === 0;
  const bool = (v: boolean) => typeof v === 'boolean';
  const sources: MixerRow[] = inventory.sources.map(s => ({
    id: s.id, name: s.name, policy: s.policy,
    gain: reading(s.gain, now, v => Number.isFinite(v) && v >= 0 && v <= 20, usable),
    mute: reading(s.mute, now, bool, usable),
    level: reading(s.level, now, v => Number.isFinite(v) && v >= 0, usable),
    stream: reading(s.stream, now, bool, usable), monitor: reading(s.monitor, now, bool, usable), vod: reading(s.vod, now, bool, usable),
    device: reading(s.device, now, v => v === 'present' || v === 'missing', usable),
  }));
  for (const s of sources) {
    if (s.device.state === 'known' && s.device.value === 'missing') errors.push(`DEVICE_MISSING:${s.id}`);
    if (s.policy === 'spotify-excluded-from-vod' && (s.vod.state !== 'known' || s.vod.value)) errors.push(`VOD_SEPARATION_UNVERIFIED:${s.id}`);
  }
  return { schemaVersion: 1 as const, revision: inventory.revision, owner: inventory.owner, observedAt: inventory.observedAt, readOnly: true as const, sources, outputs: inventory.outputs.map(o => ({ ...o })), errors };
}
export type MixerTelemetry = ReturnType<typeof mixerTelemetry>;
export interface MixerChange { sourceId: string; gain?: number; mute?: boolean }
export interface MixerPlanRequest { expectedRevision: string; changes: MixerChange[] }
/** A preview is never authorization, execution success, or a hardware qualification. */
export function previewMixerPlan(inventory: MixerInventory, request: MixerPlanRequest, now: number) {
  const telemetry = mixerTelemetry(inventory, now);
  const blockers = [...telemetry.errors];
  if (request.expectedRevision !== inventory.revision) blockers.push('REVISION_CONFLICT');
  if (!request.changes.length || new Set(request.changes.map(c => c.sourceId)).size !== request.changes.length) blockers.push('EMPTY_OR_DUPLICATE_CHANGES');
  const rollback: MixerChange[] = [];
  for (const c of request.changes) {
    const source = telemetry.sources.find(s => s.id === c.sourceId);
    if (!source) { blockers.push(`SOURCE_DISAPPEARED:${c.sourceId}`); continue; }
    if (Object.keys(c).some(k => !['sourceId', 'gain', 'mute'].includes(k)) ||
      (c.gain === undefined && c.mute === undefined) ||
      (c.gain !== undefined && (!Number.isFinite(c.gain) || c.gain < 0 || c.gain > 20)) ||
      (c.mute !== undefined && typeof c.mute !== 'boolean')) blockers.push(`INVALID_CHANGE:${c.sourceId}`);
    if (source.gain.state !== 'known' || source.mute.state !== 'known' || source.device.state !== 'known' || source.device.value !== 'present' ||
        source.stream.state !== 'known' || source.monitor.state !== 'known' || source.vod.state !== 'known') {
      blockers.push(`PRECONDITIONS_UNKNOWN:${c.sourceId}`); continue;
    }
    rollback.push({ sourceId: c.sourceId, ...(c.gain !== undefined ? { gain: source.gain.value } : {}), ...(c.mute !== undefined ? { mute: source.mute.value } : {}) });
  }
  return { status: blockers.length ? 'blocked' as const : 'preview' as const, executable: false as const,
    expectedRevision: request.expectedRevision, changes: request.changes.map(c => ({ ...c })),
    rollback: blockers.length ? [] : rollback, blockers,
    requirements: ['authenticated-authorized-FIXE-owner', 'explicit-confirmation-of-exact-plan', 'fresh-revision-and-source-identity-recheck', 'readback-after-each-change', 'rollback-only-if-post-change-revision-and-values-still-match', 'no-blind-retry'] };
}
