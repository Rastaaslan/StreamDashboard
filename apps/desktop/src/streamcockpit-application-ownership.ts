import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runtimeUpgradeDirectory, startWithRuntimeUpgradeOwnership } from './streamcockpit-runtime-ownership.js';

/** Main-process capability; never serialized, passed over IPC or inferred from a PID. */
export interface DesktopApplicationOwnership { stop(): Promise<void>; }
type Scope = { directory: string; version: string; active: boolean; claimed: boolean; drained: boolean };
const scopes = new WeakMap<DesktopApplicationOwnership, Scope>();
const same = (a: string, b: string) => resolve(a).toLowerCase() === resolve(b).toLowerCase();
const refused = () => new Error('SC3_APPLICATION_OWNERSHIP_REQUIRED');

/** Acquire before profile reads/migrations, logging, windows, peers or macros.
 * Electron main keeps this lease until process exit, including after runtime
 * stop and final log flushing. Native maintenance and legacy binaries must not
 * be assumed to participate. No process termination or installer is started.
 */
export async function acquireDesktopApplicationOwnership(
  applicationData: string, profileRoot: string, version: string,
): Promise<DesktopApplicationOwnership> {
  const directory = runtimeUpgradeDirectory(applicationData, profileRoot);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const scope: Scope = { directory, version, active: true, claimed: false, drained: false };
  const lease = await startWithRuntimeUpgradeOwnership(directory, version, async () => ({
    stop: async () => {
      // A caller cannot release ownership while a borrowed runtime is starting,
      // running, failed to acquire completely or failed to drain.
      if (scope.claimed && !scope.drained) throw new Error('SC3_APPLICATION_RUNTIME_NOT_DRAINED');
      scope.active = false;
    },
  }));
  scopes.set(lease, scope);
  return lease;
}

/** Reuse a genuine main-process lease instead of acquiring the same mutex twice.
 * Direct startDesktopRuntime callers still take their own runtime lease.
 * A capability covers one runtime only; changing profile/version or using a
 * forged/released capability is refused before the acquisition callback.
 */
export async function startUnderApplicationOwnership<T extends { stop(): Promise<void> }>(
  lease: DesktopApplicationOwnership, directory: string, version: string, start: () => Promise<T>,
): Promise<T> {
  const scope = scopes.get(lease);
  if (!scope?.active || scope.claimed || !same(directory, scope.directory) || version !== scope.version) throw refused();
  scope.claimed = true;
  const runtime = await start();
  let stopping: Promise<void> | undefined;
  return { ...runtime, stop: () => stopping ??= (async () => {
    await runtime.stop();
    scope.drained = true;
  })() };
}
