import { UpgradePlanner, type UpgradeAdapters } from '../../../packages/core/src/streamcockpit-upgrade.js';
import { requireDesktopRestartSafety, type RestartSafety } from './restart-safety.js';

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

// Read-only candidate-updater entry point. Does not instantiate or install a planner.
export { preflightDesktopUpgrade } from './streamcockpit-upgrade-preflight.js';
export type { DesktopUpgradePreflightDependencies, DesktopUpgradePreflightReport } from './streamcockpit-upgrade-preflight.js';
