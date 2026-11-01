import { existsSync, lstatSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { MomentsStorage } from './streamcockpit-moments.js';

/**
 * Windows moments store: SQLite's rollback-journal transaction with EXTRA
 * synchronous mode, rather than pretending that fsync(directory) is supported.
 * This adapter never reads or overwrites the legacy JSON journal implicitly.
 *
 * It does NOT establish power-loss safety on a particular storage controller:
 * that requires a later hardware gate. A failed commit is always uncertain.
 */
export class MomentsSqliteStorage implements MomentsStorage {
  private readonly file: string;
  private readonly legacyFile: string;
  constructor(file: string, legacyFile?: string) {
    this.file = resolve(file);
    this.legacyFile = resolve(legacyFile ?? join(dirname(this.file), 'streamcockpit-moments.json'));
  }

  private guardLegacy() {
    try {
      // lstat also detects dangling symlinks. Access denied is not 'missing'.
      lstatSync(this.legacyFile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw new Error('MOMENTS_LEGACY_CHECK_FAILED');
    }
    throw new Error('MOMENTS_LEGACY_MIGRATION_REQUIRED');
  }

  async read(): Promise<string | null> {
    this.guardLegacy();
    if (!existsSync(this.file)) return null;
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(this.file, { readOnly: true });
      const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'moments_journal'").get();
      if (!table) throw new Error('MOMENTS_INVALID_DATABASE');
      const row = db.prepare('SELECT payload FROM moments_journal WHERE id = 1').get() as { payload?: unknown } | undefined;
      if (!row) return null;
      if (typeof row.payload !== 'string') throw new Error('MOMENTS_INVALID_PAYLOAD');
      return row.payload;
    } catch {
      throw new Error('MOMENTS_READ_FAILED');
    } finally {
      db?.close();
    }
  }

  async compareAndSwap(expected: string | null, replacement: string): Promise<boolean> {
    this.guardLegacy();
    let db: DatabaseSync | undefined;
    let pending = false;
    try {
      db = new DatabaseSync(this.file);
      // The SQLite Windows VFS calls the OS flush primitive at each transaction
      // barrier. Never relax this to NORMAL/OFF to make a benchmark pass.
      db.exec('PRAGMA journal_mode = DELETE');
      const mode = db.prepare('PRAGMA journal_mode').get() as { journal_mode?: string };
      if (mode.journal_mode?.toLowerCase() !== 'delete') throw new Error('MOMENTS_JOURNAL_MODE_UNSUPPORTED');
      db.exec('PRAGMA synchronous = EXTRA');
      db.exec('PRAGMA busy_timeout = 0');
      const level = db.prepare('PRAGMA synchronous').get() as { synchronous?: number };
      if (level.synchronous !== 3) throw new Error('MOMENTS_SYNC_UNSUPPORTED');

      db.exec('BEGIN IMMEDIATE');
      pending = true;
      db.exec('CREATE TABLE IF NOT EXISTS moments_journal (id INTEGER PRIMARY KEY CHECK(id = 1), payload TEXT NOT NULL)');
      const row = db.prepare('SELECT payload FROM moments_journal WHERE id = 1').get() as { payload?: unknown } | undefined;
      const actual = row?.payload ?? null;
      if (typeof actual !== 'string' && actual !== null) throw new Error('MOMENTS_INVALID_PAYLOAD');
      if (actual !== expected) {
        db.exec('ROLLBACK');
        pending = false;
        return false;
      }
      db.prepare('INSERT INTO moments_journal(id, payload) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload').run(replacement);
      db.exec('COMMIT');
      pending = false;
      return true;
    } catch {
      if (pending) {
        try { db?.exec('ROLLBACK'); } catch { /* preserve uncertain result */ }
      }
      throw new Error('MOMENTS_WRITE_UNCERTAIN');
    } finally {
      db?.close();
    }
  }
}
