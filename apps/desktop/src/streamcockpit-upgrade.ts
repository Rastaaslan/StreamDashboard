import { UpgradePlanner, type UpgradeAdapters } from '../../../packages/core/src/streamcockpit-upgrade.js';
import { requireDesktopRestartSafety, type RestartSafety } from './restart-safety.js';
import { SqliteUpgradeJournal } from './streamcockpit-upgrade-journal.js';

/** Reuses the exact safety guard used by startUpdater, without starting Electron or downloads. */
export function createDesktopUpgradePlanner(
  adapters: Omit<UpgradeAdapters, 'requireSafe'>,
  fixeDashboard: { assessRestartSafety(): Promise<RestartSafety> },
): UpgradePlanner {
  return new UpgradePlanner({
    ...adapters,
    requireSafe: () => requireDesktopRestartSafety(() => fixeDashboard.assessRestartSafety()),
  });
}

/** Connect the existing planner to real committed SQLite intents and an OS-backed
 * inter-process mutex. The caller supplies one provisioned private directory and
 * the independently qualified effect adapters. Construction performs no I/O.
 * Not enabled in startUpdater: no implicit installer, user path or restart.
 */
export function createDurableDesktopUpgradePlanner(
  journalDirectory: string,
  effects: Omit<UpgradeAdapters, 'requireSafe' | 'exclusive' | 'read' | 'write'>,
  fixeDashboard: { assessRestartSafety(): Promise<RestartSafety> },
): UpgradePlanner {
  const store = new SqliteUpgradeJournal(journalDirectory);
  // Provider exceptions can contain signed URLs or credentials. Only a fixed
  // uncertainty reason may enter the now-persistent planner event history.
  const guarded = <Args extends unknown[], Result>(action: (...args: Args) => Promise<Result>) =>
    async (...args: Args): Promise<Result> => {
      try { return await action(...args); }
      catch { throw new Error('Adaptateur de mise à jour : résultat non confirmé'); }
    };
  return createDesktopUpgradePlanner({
    verify: guarded(effects.verify.bind(effects)),
    stage: guarded(effects.stage.bind(effects)),
    backup: guarded(effects.backup.bind(effects)),
    migrate: guarded(effects.migrate.bind(effects)),
    install: guarded(effects.install.bind(effects)),
    rollback: guarded(effects.rollback.bind(effects)),
    reconcile: guarded(effects.reconcile.bind(effects)),
    exclusive: work => store.exclusive(work),
    read: () => store.read(),
    write: journal => store.write(journal),
  }, fixeDashboard);
}

// Read-only candidate-updater entry point. Does not instantiate or install a planner.
export { preflightDesktopUpgrade } from './streamcockpit-upgrade-preflight.js';
export type { DesktopUpgradePreflightDependencies, DesktopUpgradePreflightReport } from './streamcockpit-upgrade-preflight.js';
