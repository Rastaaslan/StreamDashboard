import { execFile, spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);

function installationCandidate(root: string | undefined) {
  return root ? path.join(root, 'obs-studio', 'bin', '64bit', 'obs64.exe') : undefined;
}

function normalizeCandidate(value: string | undefined) {
  if (!value?.trim()) return undefined;
  const candidate = value.trim();
  if (!path.isAbsolute(candidate)) return undefined;
  if (path.basename(candidate).toLowerCase() !== 'obs64.exe') return undefined;
  return path.normalize(candidate);
}

export async function launchObsIfRequested(enabled: boolean, configuredPath?: string) {
  if (!enabled || process.platform !== 'win32') {
    return { launched: false, detail: enabled ? 'Disponible uniquement sous Windows.' : 'Démarrage automatique désactivé.' };
  }

  try {
    const { stdout } = await execute('tasklist.exe', ['/FI', 'IMAGENAME eq obs64.exe', '/NH']);
    if (/obs64\.exe/i.test(stdout)) return { launched: false, detail: 'OBS est déjà lancé.' };
  } catch { /* Process discovery failure must not make the dashboard unavailable. */ }

  const candidates = [
    normalizeCandidate(configuredPath),
    normalizeCandidate(process.env.OBS_EXE_PATH),
    normalizeCandidate(installationCandidate(process.env.ProgramFiles)),
    normalizeCandidate(installationCandidate(process.env['ProgramFiles(x86)'])),
  ].filter((value): value is string => Boolean(value));
  const executable = (await Promise.all(candidates.map(async file => access(file).then(() => file).catch(() => null)))).find(Boolean);
  if (!executable) return { launched: false, detail: 'Installation OBS introuvable ; le cockpit continue sans OBS.' };

  try {
    const child = spawn(executable, [], {
      cwd: path.dirname(executable),
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
      shell: false,
    });
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    await new Promise(resolve => setTimeout(resolve, 300));
    if (child.exitCode !== null) return { launched: false, detail: `OBS Studio s’est fermé immédiatement (code ${child.exitCode}).` };
    child.unref();
    return { launched: true, detail: `OBS Studio démarré : ${executable}` };
  } catch (error) {
    return { launched: false, detail: `OBS Studio n’a pas pu démarrer : ${error instanceof Error ? error.message : String(error)}` };
  }
}
