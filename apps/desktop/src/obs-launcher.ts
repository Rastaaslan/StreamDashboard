import { execFile, spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
const execute = promisify(execFile);

export async function launchObsIfRequested(enabled: boolean, configuredPath?: string) {
  if (!enabled || process.platform !== 'win32') return { launched: false, detail: enabled ? 'Disponible uniquement sous Windows.' : 'Démarrage automatique désactivé.' };
  try {
    const { stdout } = await execute('tasklist.exe', ['/FI', 'IMAGENAME eq obs64.exe', '/NH']);
    if (/obs64\.exe/i.test(stdout)) return { launched: false, detail: 'OBS est déjà lancé.' };
  } catch { /* Process discovery failure must not make the dashboard unavailable. */ }

  const candidates = [
    configuredPath,
    process.env.OBS_EXE_PATH,
    path.join(process.env.ProgramFiles ?? '', 'obs-studio', 'bin', '64bit', 'obs64.exe'),
    path.join(process.env['ProgramFiles(x86)'] ?? '', 'obs-studio', 'bin', '64bit', 'obs64.exe'),
  ].filter(Boolean) as string[];
  const executable = (await Promise.all(candidates.map(async file => access(file).then(() => file).catch(() => null)))).find(Boolean);
  if (!executable) return { launched: false, detail: 'Installation OBS introuvable ; le cockpit continue sans OBS.' };
  if (path.basename(executable).toLowerCase() !== 'obs64.exe') return { launched: false, detail: 'Le chemin configuré doit désigner OBS Studio (obs64.exe).' };

  try {
    const child = spawn(executable, [], { cwd: path.dirname(executable), detached: true, stdio: 'ignore', windowsHide: false });
    await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    await new Promise(resolve => setTimeout(resolve, 300));
    if (child.exitCode !== null) return { launched: false, detail: `OBS Studio s’est fermé immédiatement (code ${child.exitCode}).` };
    child.unref();
    return { launched: true, detail: `OBS Studio démarré : ${executable}` };
  } catch (error) {
    return { launched: false, detail: `OBS Studio n’a pas pu démarrer : ${error instanceof Error ? error.message : String(error)}` };
  }
}
