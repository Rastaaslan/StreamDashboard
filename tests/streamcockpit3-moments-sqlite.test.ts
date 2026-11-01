import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { MomentsPipeline } from '../apps/server/src/streamcockpit-moments.js';
import { MomentsSqliteStorage } from '../apps/server/src/streamcockpit-moments-sqlite.js';

const winIt = process.platform === 'win32' ? it : it.skip;
const marker = {
  sessionId: 'win_1', correlationId: 'request_1', sourceEventId: 'event_1',
  source: 'obs' as const, instant: 1000, title: 'Fixture Windows',
  status: 'observed' as const,
};
async function sandbox(run: (db: string, legacy: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'sc3-moments-sqlite-'));
  try { await run(join(dir, 'moments.sqlite'), join(dir, 'moments.json')); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

winIt('does not invent or create a journal during a read', () => sandbox(async (file, old) => {
  const store = new MomentsSqliteStorage(file, old);
  expect(await store.read()).toBeNull();
  expect(existsSync(file)).toBe(false);
  expect(await new MomentsPipeline(store).exportObserved('win_1')).toBeUndefined();
  expect(existsSync(file)).toBe(false);
}));

winIt('commits synchronously, reopens, replays safely and checks expected CAS revision', () => sandbox(async (file, old) => {
  const first = new MomentsSqliteStorage(file, old);
  const pipeline = new MomentsPipeline(first);
  expect((await pipeline.record(marker)).outcome).toBe('created');
  const reopened = new MomentsPipeline(new MomentsSqliteStorage(file, old));
  expect((await reopened.record(marker)).outcome).toBe('replayed');
  expect((await reopened.exportObserved('win_1'))?.markers).toHaveLength(1);
  expect(await first.compareAndSwap(null, 'unsafe')).toBe(false);
  expect((await reopened.exportObserved('win_1'))?.markers[0]?.title).toBe('Fixture Windows');
}));

winIt('makes two competing records durable without losing the first', () => sandbox(async (file, old) => {
  const a = new MomentsPipeline(new MomentsSqliteStorage(file, old));
  const b = new MomentsPipeline(new MomentsSqliteStorage(file, old));
  const next = { ...marker, correlationId: 'request_2', sourceEventId: 'event_2', instant: 2000 };
  await Promise.all([a.record(marker), b.record(next)]);
  const output = await new MomentsPipeline(new MomentsSqliteStorage(file, old)).export('win_1');
  expect(output.markers.map(m => m.correlationId).sort()).toEqual(['request_1', 'request_2']);
}));

winIt('refuses an older JSON journal instead of silently migrating or overwriting it', () => sandbox(async (file, old) => {
  const original = JSON.stringify({ legacy: true, token: 'PRIVATE_SENTINEL' });
  await writeFile(old, original);
  const store = new MomentsSqliteStorage(file, old);
  await expect(store.read()).rejects.toThrow('MOMENTS_LEGACY_MIGRATION_REQUIRED');
  await expect(store.compareAndSwap(null, 'unsafe')).rejects.toThrow('MOMENTS_LEGACY_MIGRATION_REQUIRED');
  expect(await readFile(old, 'utf8')).toBe(original);
  expect(existsSync(file)).toBe(false);
}));

winIt('rejects corrupt SQLite without recreating an empty timeline', () => sandbox(async (file, old) => {
  await writeFile(file, 'not an SQLite database');
  const store = new MomentsSqliteStorage(file, old);
  await expect(store.read()).rejects.toThrow('MOMENTS_READ_FAILED');
  await expect(store.compareAndSwap(null, 'unsafe')).rejects.toThrow('MOMENTS_WRITE_UNCERTAIN');
  expect(await readFile(file, 'utf8')).toBe('not an SQLite database');
}));

winIt('recovers the committed journal after an actual Windows child process exit', () => sandbox(async (file, old) => {
  const script = `import { MomentsPipeline } from './apps/server/src/streamcockpit-moments.ts';
    import { MomentsSqliteStorage } from './apps/server/src/streamcockpit-moments-sqlite.ts';
    await new MomentsPipeline(new MomentsSqliteStorage(${JSON.stringify(file)}, ${JSON.stringify(old)}))
      .record(${JSON.stringify(marker)});
    process.exit(73);`;
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 12000,
  });
  expect(child.error).toBeUndefined();
  expect(child.status).toBe(73);
  const recovered = new MomentsPipeline(new MomentsSqliteStorage(file, old));
  expect((await recovered.record(marker)).outcome).toBe('replayed');
  expect((await recovered.exportObserved('win_1'))?.markers).toHaveLength(1);
}), 20_000);

winIt('fails closed when checksummed journal payload is invalid', () => sandbox(async (file, old) => {
  const store = new MomentsSqliteStorage(file, old);
  const payload = JSON.stringify({ schemaVersion: 1, requests: [{ ...marker, token: 'PRIVATE_SENTINEL' }] });
  const envelope = JSON.stringify({ payload, sha256: createHash('sha256').update(payload).digest('hex') });
  expect(await store.compareAndSwap(null, envelope)).toBe(true);
  await expect(new MomentsPipeline(store).exportObserved('win_1')).rejects.toThrow('CORRUPT_MOMENTS');
  expect(await store.read()).toBe(envelope);
}));

winIt('rolls back an interrupted uncommitted transaction after actual child exit', () => sandbox(async (file, old) => {
  const store = new MomentsSqliteStorage(file, old);
  expect((await new MomentsPipeline(store).record(marker)).outcome).toBe('created');
  const before = await store.read();
  const script = `import { DatabaseSync } from 'node:sqlite';
    const db = new DatabaseSync(${JSON.stringify(file)});
    db.exec('PRAGMA journal_mode = DELETE');
    db.exec('PRAGMA synchronous = EXTRA');
    db.exec('BEGIN IMMEDIATE');
    db.prepare('UPDATE moments_journal SET payload = ? WHERE id = 1').run('PRIVATE_ABORT_SENTINEL');
    process.exit(73);`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 12000,
  });
  expect(child.error).toBeUndefined();
  expect(child.status).toBe(73);
  const reopened = new MomentsSqliteStorage(file, old);
  expect(await reopened.read()).toBe(before);
  expect((await new MomentsPipeline(reopened).record(marker)).outcome).toBe('replayed');
  expect((await reopened.read())).not.toContain('PRIVATE_ABORT_SENTINEL');
}), 20_000);
