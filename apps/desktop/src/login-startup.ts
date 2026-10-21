import path from 'node:path';
import { existsSync } from 'node:fs';

/** A named per-user entry. Squirrel's stable launcher survives version changes. */
export function loginStartupOptions(executable: string, enabled: boolean) {
  const parent = path.dirname(path.dirname(executable));
  const squirrel = path.basename(path.dirname(executable)).startsWith('app-') && existsSync(path.join(parent, 'Update.exe'));
  return { name: 'StreamDashboardNextAgent', path: squirrel ? path.join(parent, path.basename(executable)) : executable,
    args: ['--agent'], openAtLogin: enabled };
}

export function configureLoginStartup(app: Pick<Electron.App, 'isPackaged'|'setLoginItemSettings'|'getLoginItemSettings'>, enabled: boolean, executable = process.execPath, platform = process.platform) {
  if (platform !== 'win32' || !app.isPackaged) {
    if (enabled) throw new Error('Le démarrage automatique nécessite l’application Windows installée.');
    return;
  }
  const options = loginStartupOptions(executable, enabled);
  app.setLoginItemSettings(options);
  if (app.getLoginItemSettings({path: options.path, args: options.args}).openAtLogin !== enabled)
    throw new Error('Windows n’a pas confirmé le démarrage automatique. Vérifiez les applications de démarrage de votre session.');
}
