import { describe, expect, it } from 'vitest';
import { mixerTelemetry, previewMixerPlan, type MixerInventory, type Evidence } from '../packages/core/src/streamcockpit-mixer.js';
import { createMixerReader, readMixerInventory } from '../apps/server/src/streamcockpit-mixer.js';
const now = 10000;
const e = <T>(value: T): Evidence<T> => ({ value, observedAt: now, provenance: 'fixture-only' });
const inventory = (): MixerInventory => ({ owner: 'FIXE', revision: 'epoch-1:1', observedAt: now, connected: true, errors: [], outputs: [{ id: 'device:usb', name: 'USB', selectable: false, isDefault: true }], sources: [{ id: 'spotify', name: 'Spotify', gain: e(1), mute: e(false), stream: e(true), monitor: e(false), vod: e(false), device: e('present'), policy: 'spotify-excluded-from-vod' }] });
const request = () => ({ expectedRevision: 'epoch-1:1', changes: [{ sourceId: 'spotify', gain: 0.5, mute: true }] });
describe('F05 read-only telemetry and previews', () => {
  it('keeps Spotify stream and VOD separate, with conditional inverse values and no execution', () => {
    const input = inventory(), before = structuredClone(input);
    const telemetry = mixerTelemetry(input, now);
    expect(telemetry.sources[0].stream).toMatchObject({ state: 'known', value: true });
    expect(telemetry.sources[0].vod).toMatchObject({ state: 'known', value: false });
    const plan = previewMixerPlan(input, request(), now);
    expect(plan).toMatchObject({ status: 'preview', executable: false, rollback: [{ sourceId: 'spotify', gain: 1, mute: false }] });
    expect(plan.requirements).toContain('explicit-confirmation-of-exact-plan');
    expect(input).toEqual(before);
  });
  it('does not confuse gain with measured level or silence with missing evidence', () => {
    const input = inventory();
    expect(mixerTelemetry(input, now).sources[0].level.state).toBe('unknown');
    input.sources[0].level = e(0);
    expect(mixerTelemetry(input, now).sources[0].level).toMatchObject({ state: 'known', value: 0 });
  });
  it.each(['LAPTOP', 'Android', ''])('never falls back to owner %s', owner => {
    const input = inventory(); input.owner = owner;
    expect(previewMixerPlan(input, request(), now).blockers).toContain('OBS_OWNER_MUST_BE_FIXE');
    expect(mixerTelemetry(input, now).sources[0].gain.state).toBe('unknown');
  });
  it('blocks missing USB even when a default output exists', () => {
    const input = inventory(); input.sources[0].device = e('missing');
    expect(previewMixerPlan(input, request(), now)).toMatchObject({ status: 'blocked', rollback: [] });
    expect(mixerTelemetry(input, now).errors).toContain('DEVICE_MISSING:spotify');
  });
  it('blocks a disappeared source and changed revision', () => {
    const input = inventory(); input.sources = []; input.revision = 'epoch-2:1';
    expect(previewMixerPlan(input, request(), now).blockers).toEqual(expect.arrayContaining(['SOURCE_DISAPPEARED:spotify', 'REVISION_CONFLICT']));
  });
  it.each([true, undefined])('blocks leaked or unobserved Spotify VOD (%s)', vod => {
    const input = inventory(); input.sources[0].vod = vod === undefined ? undefined : e(vod);
    expect(previewMixerPlan(input, request(), now).blockers).toContain('VOD_SEPARATION_UNVERIFIED:spotify');
  });
  it('rejects inconsistent identities and invalid gain', () => {
    const input = inventory(); input.sources.push({ ...input.sources[0] });
    expect(previewMixerPlan(input, request(), now).blockers).toContain('INVALID_SOURCE_IDENTITY');
    const req = request(); req.changes[0].gain = NaN;
    expect(previewMixerPlan(inventory(), req, now).blockers).toContain('INVALID_CHANGE:spotify');
  });
  it.each([-1, now + 1, now - 5001])('invalidates stale or impossible timestamps %s', at => {
    const input = inventory(); input.observedAt = at;
    expect(previewMixerPlan(input, request(), now).status).toBe('blocked');
  });
  it('invalidates individual stale evidence and missing rollback information', () => {
    const input = inventory(); input.sources[0].gain!.observedAt = 0;
    expect(previewMixerPlan(input, request(), now)).toMatchObject({ status: 'blocked', rollback: [] });
  });
  it('blocks disconnected OBS, duplicate changes and forbidden route edits', () => {
    const input = inventory(); input.connected = false;
    expect(previewMixerPlan(input, request(), now).blockers).toContain('OBS_OFFLINE');
    const req = request(); req.changes.push(req.changes[0]);
    expect(previewMixerPlan(inventory(), req, now).status).toBe('blocked');
    expect(previewMixerPlan(inventory(), { ...request(), changes: [{ sourceId: 'spotify', vod: true } as never] }, now).status).toBe('blocked');
  });
  it('reads existing interfaces without inventing routing, meter or USB health', async () => {
    let reads = 0;
    const input = await readMixerInventory({ owner: 'FIXE', revision: 'r1', observedAt: now, obs: { connected: true, error: null, inputs: { Voicemeeter: { volume: 1, muted: false } } }, readOutputs: async () => { reads++; return []; } });
    const reader = createMixerReader(async () => input, () => now);
    expect((await reader.telemetry()).sources[0]).toMatchObject({ gain: { state: 'known', value: 1 }, level: { state: 'unknown' }, vod: { state: 'unknown' }, device: { state: 'unknown' } });
    expect((await reader.preview({ expectedRevision: 'r1', changes: [{ sourceId: 'Voicemeeter', mute: true }] })).status).toBe('blocked');
    expect(reads).toBe(1);
  });
  it('surfaces output enumeration failure', async () => {
    const input = await readMixerInventory({ owner: 'FIXE', revision: 'r', observedAt: now, obs: { connected: true, error: null, inputs: {} }, readOutputs: async () => { throw new Error('USB'); } });
    expect(mixerTelemetry(input, now).errors).toContain('LOCAL_OUTPUTS_UNAVAILABLE');
  });
});
