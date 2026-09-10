import { BrowserWindow, shell } from 'electron';
import path from 'node:path';

export { isAllowedExternalAuthUrl, isAllowedGoogleOAuthUrl, isAllowedTwitchUrl } from './security.js';
import { isAllowedExternalAuthUrl, isSameOrigin } from './security.js';

export function createDashboardWindow(url: string, preload: string) {
  const window = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1050, minHeight: 700, show: false, backgroundColor: '#080a10', title: 'StreamDashboard',
    webPreferences: { preload: path.resolve(preload), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  });
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (isAllowedExternalAuthUrl(target)) void shell.openExternal(target).catch(() => undefined);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, target) => { if (!isSameOrigin(target, url)) event.preventDefault(); });
  window.once('ready-to-show', () => window.show());
  void window.loadURL(url);
  return window;
}
