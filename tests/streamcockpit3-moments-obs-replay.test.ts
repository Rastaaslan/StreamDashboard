import { expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MomentsPipeline } from '../apps/server/src/streamcockpit-moments.js';
import { MomentsSqliteStorage } from '../apps/server/src/streamcockpit-moments-sqlite.js';
import { ObsReplayMomentProducer } from '../apps/server/src/streamcockpit-moments-obs-replay.js';

const event = { sourceEventId: 'obs_replay_' + 'a'.repeat(64), observedAt: 1762050000000, connectionGeneration: 7, streamEpoch: 3 };
function fixture() {
  let raw: string | null = null;
  const pipeline = new MomentsPipeline({
    read: async () => raw,
    compareAndSwap: async (expected, replacement) => {
      if (expected !== raw) return false;
      raw = replacement; return true;
    },
  });
  const state = { connected: true, streamingKnown: true, streaming: true, connectionGeneration: 7, streamEpoch: 3 };
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

it('refuses noncanonical replay IDs before creating a durable OBS marker', async () => {
  for (const sourceEventId of [
    'obs_replay_not_a_digest',
    'obs_replay_' + 'G'.repeat(64),
    'obs_replay_' + 'a'.repeat(63),
    'obs_replay_' + 'a'.repeat(65),
  ]) {
    const f = fixture();
    expect(await f.producer.observe({ ...event, sourceEventId })).toBe('ignored');
    expect(f.record).not.toHaveBeenCalled();
  }
});

it('does not create OBS moments for unknown/stopped/disconnected outputs or foreign generations', async () => {
  for (const change of [
    { connected: false }, { streaming: false }, { streamingKnown: false }, { connectionGeneration: 8 }, { streamEpoch: 4 },
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

it('drops replay if OBS stops and restarts during an await, even with unchanged connection and session ID', async () => {
  const f = fixture();
  f.hostEligible.mockImplementation(async () => {
    // Another OBS live may resume before the await returns. A boolean
    // streaming snapshot and WebSocket generation alone cannot detect it.
    f.state.streaming = false;
    f.state.streamEpoch++;
    f.state.streaming = true;
    f.state.streamEpoch++;
    return true;
  });
  expect(await f.producer.observe(event)).toBe('ignored');
  expect(f.record).not.toHaveBeenCalled();
});

it('rejects a replay lacking a trustworthy stream-transition epoch', async () => {
  const f = fixture();
  expect(await f.producer.observe({ ...event, streamEpoch: NaN })).toBe('ignored');
  expect(await f.producer.observe({ ...event, streamEpoch: -1 })).toBe('ignored');
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

it('never retries an uncertain replay after dedup capacity and renews only on a new OBS stream epoch', async () => {
  const f = fixture();
  f.record.mockRejectedValueOnce(new Error('MOMENTS_WRITE_UNCERTAIN'));
  await expect(f.producer.observe(event)).rejects.toThrow('MOMENTS_WRITE_UNCERTAIN');
  for (let i = 0; i < 512; i++) {
    const unique = { ...event, sourceEventId: 'obs_replay_' + i.toString(16).padStart(64, '0') };
    expect(await f.producer.observe(unique)).toBe(i < 511 ? 'recorded' : 'ignored');
  }
  // Even if the first write was uncertain, an old notification may never be re-attempted.
  expect(await f.producer.observe(event)).toBe('ignored');
  expect(f.record).toHaveBeenCalledTimes(512);
  f.state.streamEpoch = 4;
  expect(await f.producer.observe({ ...event, streamEpoch: 4 })).toBe('recorded');
  expect(f.record).toHaveBeenCalledTimes(513);
});

it('does not retry an uncertain OBS replay when only the WebSocket connection generation changes', async () => {
  const f = fixture();
  f.record.mockRejectedValueOnce(new Error('MOMENTS_WRITE_UNCERTAIN'));
  await expect(f.producer.observe(event)).rejects.toThrow('MOMENTS_WRITE_UNCERTAIN');
  f.state.connectionGeneration = 8; // OBS WebSocket reconnect, no verified new stream transition.
  const reconnected = { ...event, connectionGeneration: 8 };
  expect(await f.producer.observe(reconnected)).toBe('ignored');
  expect(f.record).toHaveBeenCalledTimes(1);
  // Only an actual stream-epoch change may reopen replay admission.
  f.state.streamEpoch = 4;
  expect(await f.producer.observe({ ...reconnected, streamEpoch: 4 })).toBe('recorded');
  expect(f.record).toHaveBeenCalledTimes(2);
});

const onWindows = process.platform === 'win32' ? it : it.skip;
onWindows('reopens the automatically observed OBS marker from Windows SQLite EXTRA after process-level storage reopening', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sc3-obs-replay-'));
  try {
    const sqlite = join(directory, 'moments.sqlite'), legacy = join(directory, 'moments.json');
    const pipeline = new MomentsPipeline(new MomentsSqliteStorage(sqlite, legacy));
    const obs = { connected: true, streamingKnown: true, streaming: true, connectionGeneration: 7, streamEpoch: 3 };
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

it('deduplicates concurrent OBS replay notifications even while the first journal commit is pending', async () => {
  const f = fixture();
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  f.record.mockImplementationOnce(async input => {
    await blocked;
    return f.pipeline.record(input);
  });
  const first = f.producer.observe(event);
  await vi.waitFor(() => expect(f.record).toHaveBeenCalledTimes(1));
  expect(await f.producer.observe(event)).toBe('ignored');
  release();
  expect(await first).toBe('recorded');
  expect(f.record).toHaveBeenCalledTimes(1);
  expect((await f.pipeline.exportObserved('unplanned_1'))?.markers).toHaveLength(1);
});

it('fences an in-flight OBS save across an overlapping new stream epoch', async () => {
  const f = fixture();
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  f.hostEligible.mockImplementationOnce(async () => { await blocked; return true; });
  const old = f.producer.observe(event);
  await vi.waitFor(() => expect(f.hostEligible).toHaveBeenCalledTimes(1));
  f.state.streamEpoch = 4;
  const fresh = { ...event, streamEpoch: 4, sourceEventId: 'obs_replay_' + 'b'.repeat(64) };
  expect(await f.producer.observe(fresh)).toBe('recorded');
  release();
  expect(await old).toBe('ignored');
  expect(await f.producer.observe(event)).toBe('ignored');
  expect(await f.producer.observe(fresh)).toBe('ignored');
  expect(f.record).toHaveBeenCalledTimes(1);
  expect((await f.pipeline.exportObserved('unplanned_1'))?.markers[0]?.sourceEventId).toBe(fresh.sourceEventId);
});
