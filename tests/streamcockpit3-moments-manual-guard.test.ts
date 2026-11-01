import { expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MomentsPipeline, type MomentsStorage } from '../apps/server/src/streamcockpit-moments.js';
import { MomentsSqliteStorage } from '../apps/server/src/streamcockpit-moments-sqlite.js';

const input = { sessionId: 'session_1', correlationId: 'actor_request_digest',
  title: 'Passage important', instant: 1000 };

class MemoryStorage implements MomentsStorage {
  raw: string | null = null;
  writes = 0;
  async read() { return this.raw; }
  async compareAndSwap(expected: string | null, next: string) {
    this.writes++;
    if (expected !== this.raw) return false;
    this.raw = next; return true;
  }
}

it('F09 manual replay uses the original host instant and a fresh durable barrier', async () => {
  const store = new MemoryStorage(), pipeline = new MomentsPipeline(store);
  const first = await pipeline.recordHostManual(input);
  expect(first).toMatchObject({ outcome: 'created', moment: { instant: 1000, sequence: 1 } });
  const priorWrites = store.writes;
  const replay = await new MomentsPipeline(store).recordHostManual({ ...input, instant: 999999 });
  expect(replay).toMatchObject({ outcome: 'replayed', moment: { instant: 1000, sequence: 1 } });
  expect(store.writes).toBe(priorWrites + 1);
  expect((await pipeline.export('session_1')).markers).toHaveLength(1);
});

it('F09 manual correlation conflicts across sessions or titles, not silently another marker', async () => {
  const store = new MemoryStorage(), pipeline = new MomentsPipeline(store);
  await pipeline.recordHostManual(input);
  await expect(pipeline.recordHostManual({ ...input, title: 'Autre passage' }))
    .rejects.toThrow('MOMENT_IDEMPOTENCY_CONFLICT');
  await expect(pipeline.recordHostManual({ ...input, sessionId: 'session_2' }))
    .rejects.toThrow('MOMENT_IDEMPOTENCY_CONFLICT');
  await expect(pipeline.recordHostManual({ ...input, title: 'Bearer TOKEN' }))
    .rejects.toThrow('INVALID_MOMENT');
  expect((await pipeline.export('session_1')).markers).toHaveLength(1);
  expect((await pipeline.export('session_2')).markers).toHaveLength(0);
});

it('F09 manual failed CAS does not fabricate a durable receipt', async () => {
  const pipeline = new MomentsPipeline({ read: async () => null,
    compareAndSwap: async () => { throw new Error('MOMENTS_WRITE_UNCERTAIN'); } });
  await expect(pipeline.recordHostManual(input)).rejects.toThrow('MOMENTS_WRITE_UNCERTAIN');
});

it.skipIf(process.platform !== 'win32')('F09 manual SQLite Windows reopen restores exactly the committed marker', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'sc3-manual-reopen-'));
  try {
    const db = join(folder, 'markers.sqlite');
    const storage = new MomentsSqliteStorage(db, join(folder, 'legacy.json'));
    await new MomentsPipeline(storage).recordHostManual(input);
    const reopened = new MomentsPipeline(new MomentsSqliteStorage(db, join(folder, 'legacy.json')));
    const replay = await reopened.recordHostManual({ ...input, instant: 2000 });
    expect(replay).toMatchObject({ outcome: 'replayed', moment: { instant: 1000 } });
    expect((await reopened.exportObserved('session_1'))?.markers).toHaveLength(1);
  } finally {
    await rm(folder, {recursive: true, force: true});
  }
});
