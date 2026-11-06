import { createHash } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { open, readFile, rename, unlink } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { MomentsPipeline } from './streamcockpit-moments.js';

/**
 * F09 explicit maintenance-only migration: legacy checksummed JSON -> SQLite.
 * Never invoked from startup, HTTP, updater, or an automatic retry.
 * Run only with the FIXE journal's sole writer stopped and a verified backup.
 * The original bytes are retained in a sidecar archive; no existing SQLite or
 * archive is replaced. Partial results fail closed for manual reconciliation.
 */
export async function migrateLegacyMomentsToSqlite(sqliteFile: string, legacyFile: string): Promise<{
  kind: 'SC3_MOMENTS_LEGACY_MIGRATED'; archive: string; sha256: string; bytes: number;
}> {
  if (!isAbsolute(sqliteFile) || !isAbsolute(legacyFile) ||
      /^[\\/]{2}/.test(sqliteFile) || /^[\\/]{2}/.test(legacyFile) ||
      (process.platform === 'win32' &&
        (!/^[A-Za-z]:[\\/]/.test(sqliteFile) || !/^[A-Za-z]:[\\/]/.test(legacyFile) ||
         sqliteFile.slice(2).includes(':') || legacyFile.slice(2).includes(':'))))
    throw new Error('MOMENTS_MIGRATION_UNSAFE_PATH');
  const target = resolve(sqliteFile), source = resolve(legacyFile);
  if (target.toLowerCase() === source.toLowerCase() ||
      dirname(target).toLowerCase() !== dirname(source).toLowerCase() ||
      basename(target).toLowerCase() !== 'streamcockpit-moments.sqlite' ||
      basename(source).toLowerCase() !== 'streamcockpit-moments.json')
    throw new Error('MOMENTS_MIGRATION_UNSAFE_PATH');
  const archive = source + '.pre-sqlite.json', lockPath = source + '.writer.lock';
  const missing = (path: string) => {
    try { lstatSync(path); return false; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
      throw new Error('MOMENTS_MIGRATION_PATH_UNVERIFIED');
    }
  };
  // Existence checks must reject symlinks and dangling symlinks too.
  if (!missing(target) || !missing(archive)) throw new Error('MOMENTS_MIGRATION_TARGET_EXISTS');
  const lock = await open(lockPath, 'wx', 0o600)
    .catch(() => { throw new Error('MOMENTS_MIGRATION_WRITER_LOCKED'); });
  let sqliteCreated = false, archiveCompleted = false;
  try {
    // Existing MomentsFileStorage writers honor this exact writer lock.
    if (!missing(target) || !missing(archive)) throw new Error('MOMENTS_MIGRATION_TARGET_EXISTS');
    const input = await open(source, 'r');
    let bytes: Buffer, sourceInode: number;
    try {
      const st = await input.stat();
      const pathStat = lstatSync(source);
      if (!st.isFile() || !pathStat.isFile() || st.nlink !== 1 ||
          st.size < 1 || st.size > 16 * 1024 * 1024 ||
          st.ino !== pathStat.ino || st.size !== pathStat.size)
        throw new Error('MOMENTS_MIGRATION_UNSAFE_SOURCE');
      sourceInode = st.ino;
      bytes = await input.readFile();
      if (bytes.length !== st.size) throw new Error('MOMENTS_MIGRATION_SOURCE_CHANGED');
    } finally { await input.close(); }
    const raw = bytes.toString('utf8');
    // FileStorage writes canonical JSON. Never silently discard a duplicate key,
    // extra bytes, malformed UTF-8, or an unknown schema during migration.
    try {
      if (!raw || Buffer.byteLength(raw, 'utf8') !== bytes.length ||
          JSON.stringify(JSON.parse(raw)) !== raw)
        throw new Error('INVALID');
      const validation = new MomentsPipeline({
        read: async () => raw,
        compareAndSwap: async () => { throw new Error('MIGRATION_READ_ONLY'); },
      });
      await validation.listObservedSessions();
    } catch { throw new Error('MOMENTS_MIGRATION_SOURCE_INVALID'); }

    // wx reserves a previously absent target. If any later step fails, leave
    // it as an explicit uncertain artifact, never delete/retry automatically.
    const reservation = await open(target, 'wx', 0o600);
    sqliteCreated = true;
    await reservation.close();
    let db: DatabaseSync | undefined, transaction = false;
    try {
      db = new DatabaseSync(target);
      db.exec('PRAGMA journal_mode = DELETE');
      const mode = db.prepare('PRAGMA journal_mode').get() as { journal_mode?: string };
      if (mode.journal_mode?.toLowerCase() !== 'delete') throw new Error('JOURNAL_MODE');
      db.exec('PRAGMA synchronous = EXTRA');
      db.exec('PRAGMA busy_timeout = 0');
      const sync = db.prepare('PRAGMA synchronous').get() as { synchronous?: number };
      if (sync.synchronous !== 3) throw new Error('SYNC_MODE');
      db.exec('BEGIN IMMEDIATE'); transaction = true;
      db.exec('CREATE TABLE moments_journal (id INTEGER PRIMARY KEY CHECK(id = 1), payload TEXT NOT NULL)');
      db.prepare('INSERT INTO moments_journal(id, payload) VALUES(1, ?)').run(raw);
      db.exec('COMMIT'); transaction = false;
    } catch {
      if (transaction) { try { db?.exec('ROLLBACK'); } catch { /* uncertain */ } }
      throw new Error('MOMENTS_MIGRATION_SQLITE_UNCERTAIN');
    } finally { db?.close(); }

    // Verify after closing and reopening the DB, not just with the same handle.
    let reopened: DatabaseSync | undefined;
    try {
      reopened = new DatabaseSync(target, { readOnly: true });
      const found = reopened.prepare('SELECT payload FROM moments_journal WHERE id = 1')
        .get() as { payload?: unknown } | undefined;
      if (found?.payload !== raw) throw new Error('NOT_EQUAL');
      const check = reopened.prepare('PRAGMA integrity_check').get() as { integrity_check?: string };
      if (check.integrity_check !== 'ok') throw new Error('CORRUPT');
    } catch { throw new Error('MOMENTS_MIGRATION_VERIFY_UNCERTAIN'); }
    finally { reopened?.close(); }

    // Refuse promotion if another (non-cooperating) writer changed the source.
    const current = await readFile(source), currentStat = lstatSync(source);
    if (!currentStat.isFile() || currentStat.nlink !== 1 ||
        currentStat.ino !== sourceInode || currentStat.size !== bytes.length ||
        !current.equals(bytes)) throw new Error('MOMENTS_MIGRATION_SOURCE_CHANGED');
    if (!missing(archive)) throw new Error('MOMENTS_MIGRATION_TARGET_EXISTS');
    await rename(source, archive);
    archiveCompleted = true;
    return {
      kind: 'SC3_MOMENTS_LEGACY_MIGRATED',
      archive, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length,
    };
  } finally {
    await lock.close();
    // Once a SQLite target exists, any crash/failure is uncertain: intentionally
    // keep the lock and source for supervised recovery instead of letting the
    // previous writer silently create divergent histories.
    if (!sqliteCreated || archiveCompleted) await unlink(lockPath).catch(() => undefined);
  }
}
