import { lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Dedicated FIXE host journal. An accepted intent is a permanent block until
// a separate, explicitly qualified reconciliation procedure exists.
// SQLite EXTRA is a software barrier, not proof of physical power-loss safety.
const applicationId = 0x53435038; // SCP8
const validBroadcaster = (id: string) => /^[0-9]{1,30}$/.test(id);
const existsStrict = (file: string) => {
  try { return lstatSync(file); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw Error('PREDICTION_FENCE_UNAVAILABLE');
  }
};

export interface PredictionCreationFence {
  isBlocked(broadcasterId: string): boolean;
  reserve(broadcasterId: string): boolean;
  releaseBeforePost(broadcasterId: string): void;
  recordConfirmed(broadcasterId: string, predictionId: string): void;
  releaseConfirmedTerminal?(broadcasterId: string, predictionId: string): void;
}

/** No automatic release on successful/uncertain Twitch POST or process restart. */
export class PredictionIntentSqlite implements PredictionCreationFence {
  constructor(private readonly file: string) {
    if (!isAbsolute(file) || !file.toLowerCase().endsWith('.sqlite'))
      throw Error('PREDICTION_FENCE_UNAVAILABLE');
  }

  private open(writable: boolean): DatabaseSync | null {
    const parent = realpathSync(dirname(this.file));
    if (process.platform === 'win32' && parent.startsWith('\\\\'))
      throw Error('PREDICTION_FENCE_UNAVAILABLE');
    const file = join(parent, basename(this.file));
    const stat = existsStrict(file);
    if (stat && (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1))
      throw Error('PREDICTION_FENCE_UNAVAILABLE');
    if (!stat && !writable) return null;
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(file, { readOnly: !writable });
      db.exec('PRAGMA busy_timeout=0');
      // Inspect an existing DB BEFORE any mutable pragma: never normalize
      // an unknown/legacy file to our format, even briefly.
      if (stat) {
        const app = db.prepare('PRAGMA application_id').get() as { application_id?: number };
        const version = db.prepare('PRAGMA user_version').get() as { user_version?: number };
        const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='prediction_intents'").get();
        if (app.application_id !== applicationId || ![1, 2].includes(version.user_version ?? -1) || !table)
          throw Error('PREDICTION_FENCE_FORMAT_UNKNOWN');
        const columns = db.prepare('PRAGMA table_info(prediction_intents)').all() as { name: string }[];
        const expected = version.user_version === 1
          ? ['broadcaster_id'] : ['broadcaster_id', 'prediction_id'];
        if (columns.map(c => c.name).join(',') !== expected.join(','))
          throw Error('PREDICTION_FENCE_FORMAT_UNKNOWN');
      }
      const mode = db.prepare('PRAGMA journal_mode').get() as { journal_mode?: string };
      if (stat && mode.journal_mode?.toLowerCase() !== 'delete')
        throw Error('PREDICTION_FENCE_UNSAFE');
      if (writable) {
        db.exec('PRAGMA journal_mode=DELETE');
        db.exec('PRAGMA synchronous=EXTRA');
      }
      const activeMode = db.prepare('PRAGMA journal_mode').get() as { journal_mode?: string };
      const sync = db.prepare('PRAGMA synchronous').get() as { synchronous?: number };
      // Read-only SQLite connections expose their own synchronous level.
      if (activeMode.journal_mode?.toLowerCase() !== 'delete' ||
          (writable && sync.synchronous !== 3))
        throw Error('PREDICTION_FENCE_UNSAFE');
      if (!stat) {
        db.exec('BEGIN IMMEDIATE');
        db.exec('CREATE TABLE prediction_intents (broadcaster_id TEXT PRIMARY KEY NOT NULL, prediction_id TEXT)');
        db.exec('PRAGMA application_id=' + applicationId);
        db.exec('PRAGMA user_version=2');
        db.exec('COMMIT');
      } else if (writable) {
        // Never migrate a v1 journal whose pages are already inconsistent.
        const beforeUpgrade = db.prepare('PRAGMA quick_check').get() as { quick_check?: string };
        if (beforeUpgrade.quick_check !== 'ok') throw Error('PREDICTION_FENCE_CORRUPT');
        const version = db.prepare('PRAGMA user_version').get() as { user_version: number };
        if (version.user_version === 1) {
          // Upgrade old FIXE reservations atomically; their blocking rows remain intact.
          db.exec('BEGIN IMMEDIATE');
          try {
            db.exec('ALTER TABLE prediction_intents ADD COLUMN prediction_id TEXT');
            db.exec('PRAGMA user_version=2');
            db.exec('COMMIT');
          } catch (error) { db.exec('ROLLBACK'); throw error; }
        }
      }
      const integrity = db.prepare('PRAGMA quick_check').get() as { quick_check?: string };
      if (integrity.quick_check !== 'ok') throw Error('PREDICTION_FENCE_CORRUPT');
      return db;
    } catch (error) {
      db?.close();
      throw error;
    }
  }

  /** Read-only lookup: undefined=no reservation, null=unattributed/uncertain POST, string=confirmed provider ID. Never unlocks. */
  readConfirmedId(broadcasterId: string): string | null | undefined {
    if (!validBroadcaster(broadcasterId)) throw Error('PREDICTION_FENCE_UNAVAILABLE');
    const db = this.open(false);
    if (!db) return undefined;
    try {
      // A read of a legacy v1 journal must not migrate it or pretend it has a provider ID.
      const version = db.prepare('PRAGMA user_version').get() as { user_version: number };
      if (version.user_version === 1)
        return db.prepare('SELECT 1 FROM prediction_intents WHERE broadcaster_id=?').get(broadcasterId)
          ? null : undefined;
      const row = db.prepare('SELECT prediction_id FROM prediction_intents WHERE broadcaster_id=?')
        .get(broadcasterId) as { prediction_id: string | null } | undefined;
      if (!row) return undefined;
      if (row.prediction_id === null) return null;
      if (!/^[A-Za-z0-9-]{1,128}$/.test(row.prediction_id))
        throw Error('PREDICTION_FENCE_FORMAT_UNKNOWN');
      return row.prediction_id;
    } finally { db.close(); }
  }

  isBlocked(broadcasterId: string) {
    if (!validBroadcaster(broadcasterId)) throw Error('PREDICTION_FENCE_UNAVAILABLE');
    const db = this.open(false);
    if (!db) return false;
    try {
      return Boolean(db.prepare('SELECT 1 FROM prediction_intents WHERE broadcaster_id=?').get(broadcasterId));
    } finally { db.close(); }
  }

  reserve(broadcasterId: string) {
    if (!validBroadcaster(broadcasterId)) throw Error('PREDICTION_FENCE_UNAVAILABLE');
    const db = this.open(true)!;
    let inTransaction = false;
    try {
      db.exec('BEGIN IMMEDIATE'); inTransaction = true;
      if (db.prepare('SELECT 1 FROM prediction_intents WHERE broadcaster_id=?').get(broadcasterId)) {
        db.exec('ROLLBACK'); inTransaction = false;
        return false;
      }
      db.prepare('INSERT INTO prediction_intents (broadcaster_id) VALUES (?)').run(broadcasterId);
      db.exec('COMMIT'); inTransaction = false;
      return true;
    } catch {
      if (inTransaction) { try { db.exec('ROLLBACK'); } catch { /* uncertain reservation */ } }
      throw Error('PREDICTION_FENCE_WRITE_UNCERTAIN');
    } finally { db.close(); }
  }

  /** Bind a verified success receipt to its permanent reservation, never unlock it. */
  recordConfirmed(broadcasterId: string, predictionId: string) {
    if (!validBroadcaster(broadcasterId) || !/^[A-Za-z0-9-]{1,128}$/.test(predictionId))
      throw Error('PREDICTION_FENCE_UNAVAILABLE');
    const db = this.open(true)!;
    let inTransaction = false;
    try {
      db.exec('BEGIN IMMEDIATE'); inTransaction = true;
      const row = db.prepare('SELECT prediction_id FROM prediction_intents WHERE broadcaster_id=?')
        .get(broadcasterId) as { prediction_id: string | null } | undefined;
      if (!row || (row.prediction_id !== null && row.prediction_id !== predictionId))
        throw Error('PREDICTION_FENCE_RECEIPT_MISMATCH');
      if (row.prediction_id === null)
        db.prepare('UPDATE prediction_intents SET prediction_id=? WHERE broadcaster_id=?')
          .run(predictionId, broadcasterId);
      db.exec('COMMIT'); inTransaction = false;
    } catch {
      if (inTransaction) { try { db.exec('ROLLBACK'); } catch { /* retain uncertain block */ } }
      throw Error('PREDICTION_FENCE_RECEIPT_WRITE_UNCERTAIN');
    } finally { db.close(); }
  }

  /** Explicit operator-authorized terminal reconciliation only. CAS protects the exact
   * previously confirmed ID; unknown outcomes and legacy rows cannot be released. */
  releaseConfirmedTerminal(broadcasterId: string, predictionId: string) {
    if (!validBroadcaster(broadcasterId) || !/^[A-Za-z0-9-]{1,128}$/.test(predictionId))
      throw Error('PREDICTION_FENCE_UNAVAILABLE');
    const db = this.open(true)!;
    let inTransaction = false;
    try {
      db.exec('BEGIN IMMEDIATE'); inTransaction = true;
      const deleted = db.prepare('DELETE FROM prediction_intents WHERE broadcaster_id=? AND prediction_id=?')
        .run(broadcasterId, predictionId);
      if (deleted.changes !== 1) throw Error('PREDICTION_FENCE_RECEIPT_MISMATCH');
      db.exec('COMMIT'); inTransaction = false;
    } catch {
      if (inTransaction) { try { db.exec('ROLLBACK'); } catch { /* cannot infer commit state */ } }
      throw Error('PREDICTION_FENCE_RECONCILIATION_UNCERTAIN');
    } finally { db.close(); }
  }

  releaseBeforePost(broadcasterId: string) {
    if (!validBroadcaster(broadcasterId)) throw Error('PREDICTION_FENCE_UNAVAILABLE');
    const db = this.open(true)!;
    let inTransaction = false;
    try {
      db.exec('BEGIN IMMEDIATE'); inTransaction = true;
      // Never remove a reservation which already has a confirmed Twitch receipt.
      const deleted = db.prepare('DELETE FROM prediction_intents WHERE broadcaster_id=? AND prediction_id IS NULL').run(broadcasterId);
      if (deleted.changes !== 1) throw Error('PREDICTION_FENCE_MISSING_INTENT');
      db.exec('COMMIT'); inTransaction = false;
    } catch {
      if (inTransaction) { try { db.exec('ROLLBACK'); } catch { /* do not retry */ } }
      throw Error('PREDICTION_FENCE_RELEASE_UNCERTAIN');
    } finally { db.close(); }
  }
}
