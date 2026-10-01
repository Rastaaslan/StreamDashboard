import { spawn } from 'node:child_process';
import path from 'node:path';
import { app } from 'electron';

const SQUIRREL_COMMANDS = new Set(['--squirrel-install', '--squirrel-updated', '--squirrel-uninstall', '--squirrel-obsolete']);

/**
 * Squirrel.Windows starts the application with maintenance arguments while
 * installing/updating/removing it. Handle those before the normal dashboard
 * lifecycle or single-instance lock starts.
 */
export function handleSquirrelStartup(argv = process.argv): boolean {
  if (process.platform !== 'win32') return false;
  const command = argv[1];
  if (!command || !SQUIRREL_COMMANDS.has(command)) return false;
  if (command === '--squirrel-obsolete') { app.quit(); return true; }

  const updateExe = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
  const target = path.basename(process.execPath);
  const args = command === '--squirrel-uninstall' ? ['--removeShortcut', target] : ['--createShortcut', target];
  try {
    const child = spawn(updateExe, args, { detached: true, stdio: 'ignore', windowsHide: true });
    let finished = false;
    const finish = () => { if (finished) return; finished = true; app.quit(); };
    child.once('error', finish);
    child.once('close', finish);
  } catch { app.quit(); }
  return true;
}
