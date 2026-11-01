import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { MomentsPipeline, type MomentsStorage } from '../apps/server/src/streamcockpit-moments.js';
import { MomentsFileStorage } from '../apps/server/src/streamcockpit-moments-file.js';
import { validateMoment, type MomentInput } from '../packages/core/src/streamcockpit-moments.js';

const moment = (patch: Partial<MomentInput> = {}): MomentInput => ({
  sessionId: 'session-1', instant: 1000, source: 'twitch', correlationId: 'request-1',
  sourceEventId: 'event-1', title: 'Premier moment', status: 'confirmed', ...patch,
});
class Memory implements MomentsStorage {
  raw: string | null = null;
  async read() { return this.raw; }
  async compareAndSwap(expected: string | null, replacement: string) {
    if (expected !== this.raw) return false;
    this.raw = replacement; return true;
  }
}
async function withFile(run: (file: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'sc3-moments-'));
  try { await run(join(directory, 'moments.json')); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
describe('moments contract and replay', () => {
  it('validates all four sources, statuses and optional opaque clip', () => {
    for (const source of ['obs', 'twitch', 'manual', 'streamlabs'] as const)
      for (const status of ['observed', 'confirmed', 'failed', 'uncertain'] as const)
        expect(validateMoment(moment({ source, status, clip: { provider: 'obs', reference: 'replay-1' } })).source).toBe(source);
  });
  it.each([
    { source: 'youtube' }, { instant: -1 }, { instant: 1.1 }, { instant: Infinity }, { title: '' },
    { title: ' token\n' }, { status: 'success' }, { sessionId: '../session' }, { correlationId: '' },
    { sourceEventId: undefined }, { clip: { provider: 'youtube', reference: 'clip' } },
    { clip: { provider: 'twitch', reference: 'https://example.invalid/?token=secret' } },
    { token: 'SECRET_SENTINEL' }, { title: 'Bearer SECRET_SENTINEL' }, { title: 'oauth:SECRET_SENTINEL' },
    { clip: { provider: 'obs', reference: 'a', secret: 'SECRET_SENTINEL' } },
  ])('rejects invalid or credential-bearing input without persisting or echoing it: %j', async patch => {
    const storage = new Memory(), pipeline = new MomentsPipeline(storage);
    await expect(pipeline.record({ ...moment(), ...patch })).rejects.toThrow(/^INVALID_MOMENT$/);
    expect(storage.raw).toBe(null);
  });
  it('persists replay aliases, rejects conflicting correlations and provider events', async () => {
    const storage = new Memory(), first = new MomentsPipeline(storage);
    expect((await first.record(moment())).outcome).toBe('created');
    expect((await first.record(moment())).outcome).toBe('replayed');
    expect((await first.record(moment({ correlationId: 'alias' }))).outcome).toBe('deduplicated');
    const reopened = new MomentsPipeline(storage);
    expect((await reopened.record(moment({ correlationId: 'alias' }))).outcome).toBe('replayed');
    await expect(reopened.record(moment({ title: 'Changed' }))).rejects.toThrow('IDEMPOTENCY_CONFLICT');
    await expect(reopened.record(moment({ correlationId: 'other', title: 'Changed' }))).rejects.toThrow('EVENT_CONFLICT');
    expect((await reopened.export('session-1')).markers).toHaveLength(1);
  });
  it('does not merge different sources, sessions or manual events sharing a timestamp/title', async () => {
    const pipeline = new MomentsPipeline(new Memory());
    await pipeline.record(moment());
    await pipeline.record(moment({ source: 'obs', correlationId: 'obs' }));
    await pipeline.record(moment({ sessionId: 'session-2' }));
    const manual = moment({ source: 'manual', correlationId: 'manual-1' }); delete manual.sourceEventId;
    await pipeline.record(manual);
    await pipeline.record({ ...manual, correlationId: 'manual-2' });
    expect((await pipeline.export('session-1')).markers).toHaveLength(4);
    expect((await pipeline.export('session-2')).markers).toHaveLength(1);
  });
  it('handles competing CAS writes and exports late events chronologically with stable ties', async () => {
    const storage = new Memory(), pipeline = new MomentsPipeline(storage);
    await Promise.all([pipeline.record(moment()), new MomentsPipeline(storage).record(moment({ correlationId: 'r2', sourceEventId: 'e2' }))]);
    await pipeline.record(moment({ instant: 500, correlationId: 'r3', sourceEventId: 'e3' }));
    const exported = await pipeline.export('session-1');
    expect(exported).toMatchObject({ schemaVersion: 1, kind: 'streamcockpit-markers', timebase: 'unix-ms' });
    expect(exported.markers.map(m => m.sequence)).toEqual([3, 1, 2]);
    exported.markers[0].title = 'local mutation';
    expect((await pipeline.export('session-1')).markers[0].title).toBe('Premier moment');
  });
  it('requires a durable barrier even for an exact replay', async () => {
    const storage = new Memory();
    await new MomentsPipeline(storage).record(moment());
    const uncertain = new MomentsPipeline({ read: () => storage.read(), compareAndSwap: async () => { throw new Error('SYNC_FAILED'); } });
    await expect(uncertain.record(moment())).rejects.toThrow('SYNC_FAILED');
    expect((await new MomentsPipeline(storage).record(moment())).outcome).toBe('replayed');
  });
  it('bounds storage contention', async () => {
    let calls = 0;
    const pipeline = new MomentsPipeline({ read: async () => null, compareAndSwap: async () => { calls++; return false; } });
    await expect(pipeline.record(moment())).rejects.toThrow('MOMENTS_BUSY');
    expect(calls).toBe(16);
  });
});
describe('durable file adapter and corruption', () => {
  it('survives reopening and leaves no temp or lock after success', () => withFile(async file => {
    await new MomentsPipeline(new MomentsFileStorage(file)).record(moment());
    const reopened = new MomentsPipeline(new MomentsFileStorage(file));
    expect((await reopened.record(moment())).outcome).toBe('replayed');
    expect((await reopened.export('session-1')).markers).toHaveLength(1);
    expect(await readdir(join(file, '..'))).toEqual(['moments.json']);
  }));
  it.each(['not json', '', '{"payload":"{}","sha256":"wrong"}'])('fails closed without replacing corrupt data: %j', raw => withFile(async file => {
    await writeFile(file, raw);
    const pipeline = new MomentsPipeline(new MomentsFileStorage(file));
    await expect(pipeline.record(moment())).rejects.toThrow('CORRUPT_MOMENTS');
    await expect(pipeline.export('session-1')).rejects.toThrow('CORRUPT_MOMENTS');
    expect(await readFile(file, 'utf8')).toBe(raw);
  }));
  it('validates checksummed schema and event consistency, not only bytes', async () => {
    for (const state of [
      { schemaVersion: 2, requests: [] }, { schemaVersion: 1, requests: [moment(), moment()] },
      { schemaVersion: 1, requests: [moment(), moment({ correlationId: 'alias', title: 'conflicting' })] },
      { schemaVersion: 1, requests: [{ ...moment(), secret: 'SECRET_SENTINEL' }] },
    ]) {
      const storage = new Memory(), payload = JSON.stringify(state);
      storage.raw = JSON.stringify({ payload, sha256: createHash('sha256').update(payload).digest('hex') });
      await expect(new MomentsPipeline(storage).record(moment())).rejects.toThrow(/^CORRUPT_MOMENTS$/);
    }
  });
  it.each(['synced-temp', 'renamed'] as const)('reconciles an injected failure at %s', stage => withFile(async file => {
    const pipeline = new MomentsPipeline(new MomentsFileStorage(file, async point => { if (point === stage) throw new Error('SECRET_SENTINEL'); }));
    await expect(pipeline.record(moment())).rejects.toThrow(/^MOMENTS_WRITE_UNCERTAIN$/);
    const resumed = new MomentsPipeline(new MomentsFileStorage(file));
    expect((await resumed.record(moment())).outcome).toBe(stage === 'renamed' ? 'replayed' : 'created');
    expect((await resumed.export('session-1')).markers).toHaveLength(1);
  }));
  it.each(['synced-temp', 'renamed'])('recovers after actual process exit at %s only after explicit stale-lock recovery', stage => withFile(async file => {
    // This child touches only the temporary fixture. Exit skips finally blocks.
    const script = `import { MomentsPipeline } from './apps/server/src/streamcockpit-moments.ts';
      import { MomentsFileStorage } from './apps/server/src/streamcockpit-moments-file.ts';
      await new MomentsPipeline(new MomentsFileStorage(${JSON.stringify(file)}, async stage => {
        if (stage === ${JSON.stringify(stage)}) process.exit(73);
      })).record(${JSON.stringify(moment())});`;
    const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { encoding: 'utf8', timeout: 10000 });
    expect(child.stderr).toBe(''); expect(child.status).toBe(73);
    const resumed = new MomentsPipeline(new MomentsFileStorage(file));
    await expect(resumed.record(moment({ correlationId: 'new', sourceEventId: 'new' }))).rejects.toThrow('MOMENTS_WRITER_LOCKED');
    // Child termination is established above; a real owner must establish this too.
    await unlink(`${file}.writer.lock`);
    expect((await resumed.record(moment())).outcome).toBe(stage === 'renamed' ? 'replayed' : 'created');
    expect((await resumed.export('session-1')).markers).toHaveLength(1);
  }));
  it('does not overwrite a changed revision or bypass a foreign lock', () => withFile(async file => {
    const storage = new MomentsFileStorage(file);
    await new MomentsPipeline(storage).record(moment());
    expect(await storage.compareAndSwap(null, 'bad')).toBe(false);
    await writeFile(`${file}.writer.lock`, 'foreign-owner');
    await expect(storage.compareAndSwap(await storage.read(), 'bad')).rejects.toThrow('MOMENTS_WRITER_LOCKED');
    expect(await readFile(`${file}.writer.lock`, 'utf8')).toBe('foreign-owner');
  }));
  it('never treats IO errors as an empty journal', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sc3-moments-'));
    try { await expect(new MomentsFileStorage(directory).read()).rejects.toThrow('MOMENTS_READ_FAILED'); }
    finally { await rm(directory, { recursive: true, force: true }); }
  });
});
