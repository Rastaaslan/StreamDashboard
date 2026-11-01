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
