import { open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { MomentsStorage } from './streamcockpit-moments.js';

/** Local filesystem only. Parent directory must exist and be application-owned.
 * Stale lock after process death intentionally blocks writes until owner recovery.
 * Directory fsync is required; unsupported platforms fail, never claim durability. */
export class MomentsFileStorage implements MomentsStorage {
  private readonly file: string;
  constructor(file: string, private readonly checkpoint?: (stage: 'synced-temp' | 'renamed') => Promise<void>) {
    this.file = resolve(file);
  }
  async read(): Promise<string | null> {
    try { return await readFile(this.file, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new Error('MOMENTS_READ_FAILED'); }
  }
  async compareAndSwap(expected: string | null, replacement: string): Promise<boolean> {
    const lockPath = `${this.file}.writer.lock`;
    const lock = await open(lockPath, 'wx', 0o600).catch(() => { throw new Error('MOMENTS_WRITER_LOCKED'); });
    const temp = `${this.file}.${randomUUID()}.tmp`;
    try {
      if (await this.read() !== expected) return false;
      const handle = await open(temp, 'wx', 0o600);
      try { await handle.writeFile(replacement, 'utf8'); await handle.sync(); }
      finally { await handle.close(); }
      await this.checkpoint?.('synced-temp');
      await rename(temp, this.file);
      await this.checkpoint?.('renamed');
      const directory = await open(dirname(this.file), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
      return true;
    } catch { throw new Error('MOMENTS_WRITE_UNCERTAIN'); }
    finally {
      try {
        await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw new Error('MOMENTS_CLEANUP_FAILED'); });
      } finally {
        await lock.close();
        await unlink(lockPath);
      }
    }
  }
}
