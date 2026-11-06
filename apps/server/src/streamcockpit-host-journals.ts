import path from 'node:path';
import { HostDurableWriterQuiescence } from './streamcockpit-durable-writer-quiescence.js';
import { AutoModActionIntentSqlite } from './streamcockpit-automod-action-intent-sqlite.js';
import { PredictionIntentSqlite } from './streamcockpit-prediction-intent-sqlite.js';
import type { MomentsStorage } from './streamcockpit-moments.js';

/**
 * F10: the ACTUAL Windows FIXE server writes F02, F08 and F09 through one
 * owned in-process gate. The F09 adapter is lazily acquired; a failed optional
 * moments backend cannot prevent the existing main server from booting.
 *
 * A gated write is not a release/install authorization. Other server writers,
 * processes and native installers are NOT quiesced here. Do not call
 * withQuiesced() during a live, and never expose the gate over HTTP.
 */
export class HostWindowsDurableJournals {
  readonly gate = new HostDurableWriterQuiescence();
  readonly prediction: PredictionIntentSqlite;
  readonly automod: AutoModActionIntentSqlite;
  private momentsOnce?: Promise<MomentsStorage>;

  constructor(private readonly dataDir: string) {
    if (process.platform !== 'win32') throw new Error('SC3_HOST_JOURNALS_WINDOWS_REQUIRED');
    this.prediction = this.gate.protect('prediction',
      new PredictionIntentSqlite(path.join(dataDir, 'streamcockpit-prediction-intents.sqlite')));
    this.automod = this.gate.protect('automod',
      new AutoModActionIntentSqlite(path.join(dataDir, 'streamcockpit-automod-action-intents.sqlite')));
  }

  /** A shared storage instance, not a new raw writer on each HTTP request. */
  momentsStorage(): Promise<MomentsStorage> {
    this.momentsOnce ??= import('./streamcockpit-moments-sqlite.js').then(({ MomentsSqliteStorage }) => {
      const raw = new MomentsSqliteStorage(
        path.join(this.dataDir, 'streamcockpit-moments.sqlite'),
        path.join(this.dataDir, 'streamcockpit-moments.json'));
      return this.gate.protect('moments', raw);
    });
    return this.momentsOnce;
  }
}
