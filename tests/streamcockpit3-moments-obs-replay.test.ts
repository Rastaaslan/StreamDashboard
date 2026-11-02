import { expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MomentsPipeline } from '../apps/server/src/streamcockpit-moments.js';
import { MomentsSqliteStorage } from '../apps/server/src/streamcockpit-moments-sqlite.js';
import { ObsReplayMomentProducer } from '../apps/server/src/streamcockpit-moments-obs-replay.js';

const event = { sourceEventId: 'obs_replay_' + 'a'.repeat(64), observedAt: 1762050000000, connectionGeneration: 7 };
function fixture() {
  let raw: string | null = null;
  const pipeline = new MomentsPipeline({
    read: async () => raw,
    compareAndSwap: async (expected, replacement) => {
      if (expected !== raw) return false;
      raw = replacement; return true;
    },
  });
  const state = { connected: true, streamingKnown: true, streaming: true, connectionGeneration: 7 };
  let session: string | undefined = 'unplanned_1';
  let host = true;
  const record = vi.fn(input => pipeline.record(input));
  const activeSessionId = vi.fn(async () => session);
  const hostEligible = vi.fn(async () => host);
  const producer = new ObsReplayMomentProducer({ snapshot: () => ({ ...state }), activeSessionId, hostEligible, record });
  return { pipeline, producer, state, record, activeSessionId, hostEligible,
    session: (value: string | undefined) => { session = value; },
    host: (value: boolean) => { host = value; } };
}

it('writes only a host-witnessed OBS save into the single journal, without path or provider action', async () => {
  const f = fixture();
  expect(await f.producer.observe(event)).toBe('recorded');
  const output = await f.pipeline.exportObserved('unplanned_1');
  expect(output?.markers).toHaveLength(1);
  expect(output?.markers[0]).toMatchObject({
    source: 'obs', status: 'observed', instant: event.observedAt,
    sourceEventId: event.sourceEventId, title: 'Replay OBS sauvegardé',
  });
  expect(JSON.stringify(output)).not.toContain('C:\\Users');
  expect(await f.producer.observe(event)).toBe('ignored');
  expect(f.record).toHaveBeenCalledTimes(1);
});

it('does not create OBS moments for unknown/stopped/disconnected outputs or foreign generations', async () => {
  for (const change of [
    { connected: false }, { streaming: false }, { streamingKnown: false }, { connectionGeneration: 8 },
  ]) {
    const f = fixture();
    Object.assign(f.state, change);
    expect(await f.producer.observe(event)).toBe('ignored');
    expect(f.record).not.toHaveBeenCalled();
  }
});

it('denies missing FIXE role and unknown or unbound scheduled session without a write', async () => {
  const f = fixture(); f.host(false);
  expect(await f.producer.observe(event)).toBe('ignored');
  expect(f.record).not.toHaveBeenCalled();
  const q = fixture(); q.session(undefined);
  expect(await q.producer.observe(event)).toBe('ignored');
  expect(q.record).not.toHaveBeenCalled();
});

it('drops the event if OBS stops during an awaited host check', async () => {
  const f = fixture();
  f.hostEligible.mockImplementation(async () => { f.state.streaming = false; return true; });
  expect(await f.producer.observe(event)).toBe('ignored');
  expect(f.record).not.toHaveBeenCalled();
});

it('drops the event if the authoritative FIXE session changed during checks', async () => {
  const f = fixture();
  f.activeSessionId.mockResolvedValueOnce('unplanned_1').mockResolvedValueOnce('unplanned_2');
  expect(await f.producer.observe(event)).toBe('ignored');
  expect(f.record).not.toHaveBeenCalled();
});

it('never silently retries an uncertain SQLite write, even after a duplicate notification', async () => {
  const f = fixture();
  f.record.mockRejectedValueOnce(new Error('MOMENTS_WRITE_UNCERTAIN'));
  await expect(f.producer.observe(event)).rejects.toThrow('MOMENTS_WRITE_UNCERTAIN');
  expect(await f.producer.observe(event)).toBe('ignored');
  expect(f.record).toHaveBeenCalledTimes(1);
});

const onWindows = process.platform === 'win32' ? it : it.skip;
onWindows('reopens the automatically observed OBS marker from Windows SQLite EXTRA after process-level storage reopening', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sc3-obs-replay-'));
  try {
    const sqlite = join(directory, 'moments.sqlite'), legacy = join(directory, 'moments.json');
    const pipeline = new MomentsPipeline(new MomentsSqliteStorage(sqlite, legacy));
    const obs = { connected: true, streamingKnown: true, streaming: true, connectionGeneration: 7 };
    const producer = new ObsReplayMomentProducer({
      snapshot: () => obs,
      hostEligible: async () => true,
      activeSessionId: async () => 'planned_verified',
      record: input => pipeline.record(input),
    });
    expect(await producer.observe(event)).toBe('recorded');
    const recovered = await new MomentsPipeline(new MomentsSqliteStorage(sqlite, legacy)).exportObserved('planned_verified');
    expect(recovered?.markers).toHaveLength(1);
    expect(recovered?.markers[0]?.sourceEventId).toBe(event.sourceEventId);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
