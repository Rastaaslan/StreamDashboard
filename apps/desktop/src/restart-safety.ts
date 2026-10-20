import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export type RestartSafety = { safe: boolean; reason?: string };

export async function requireDesktopRestartSafety(assess?: () => Promise<RestartSafety>): Promise<void> {
  let result: RestartSafety | undefined;
  try { result = await assess?.(); }
  catch { throw new Error('L’état des diffusions ne peut pas être vérifié. Réessayez avant de redémarrer StreamDashboard.'); }
  if (result?.safe !== true) throw new Error(result?.reason || 'L’état des diffusions ne permet pas de redémarrer StreamDashboard.');
}

/** Prepare off to the side; an unsafe restart must not change the next boot role. */
export async function persistDeviceRole(
  file: string,
  profile: { version: number; role: 'stream' | 'control'; name: string },
  requireSafe?: () => Promise<void>,
): Promise<void> {
  await requireSafe?.();
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(profile), { flag: 'wx', mode: 0o600 });
    // The user may have started a live while the first observation or disk write
    // was pending. This last observation precedes the atomic switch and relaunch.
    await requireSafe?.();
    await rename(temporary, file);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}
