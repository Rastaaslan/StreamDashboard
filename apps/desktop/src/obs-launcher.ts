import { execFile, spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
const execute = promisify(execFile);
export async function launchObsIfRequested(enabled: boolean, configuredPath?: string) {
  if (!enabled || process.platform !== 'win32') return { launched: false, detail: enabled ? 'Disponible uniquement sous Windows.' : 'Démarrage automatique désactivé.' };
  try { const { stdout } = await execute('tasklist.exe', ['/FI', 'IMAGENAME eq obs64.exe', '/NH']); if (/obs64\.exe/i.test(stdout)) return { launched: false, detail: 'OBS est déjà lancé.' }; } catch { /* continue discovery */ }
  const candidates = [configuredPath, process.env.OBS_EXE_PATH, path.join(process.env.ProgramFiles ?? '', 'obs-studio', 'bin', '64bit', 'obs64.exe'), path.join(process.env['ProgramFiles(x86)'] ?? '', 'obs-studio', 'bin', '64bit', 'obs64.exe')].filter(Boolean) as string[];
  const executable = (await Promise.all(candidates.map(async file => access(file).then(() => file).catch(() => null)))).find(Boolean);
  if (!executable) return { launched: false, detail: 'Installation OBS introuvable ; le cockpit continue sans OBS.' };
  const child = spawn(executable, [], { cwd: path.dirname(executable), detached: true, stdio: 'ignore', windowsHide: true }); child.unref();
  return { launched: true, detail: 'OBS démarré.' };
}
