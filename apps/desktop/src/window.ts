import { BrowserWindow, shell } from 'electron';
import path from 'node:path';

export { isAllowedExternalAuthUrl, isAllowedGoogleOAuthUrl, isAllowedTwitchUrl } from './security.js';
import { isAllowedExternalAuthUrl, isAllowedLiveViewUrl, isSameOrigin, isTwitchViewerLoginUrl } from './security.js';
import { openTwitchViewerSession } from './twitch-viewer.js';

export function createDashboardWindow(url: string, preload: string, title = 'StreamDashboard') {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1050,
    minHeight: 700,
    show: true,
    backgroundColor: '#080a10',
    title,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.resolve(preload),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });
  window.removeMenu();
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (isTwitchViewerLoginUrl(target)) {
      void openTwitchViewerSession(window, '', target).then(() => {
        if (!window.isDestroyed()) window.webContents.send('viewer:twitch-session-closed');
      }).catch(() => undefined);
      return { action: 'deny' };
    }
    if (isAllowedExternalAuthUrl(target) || isAllowedLiveViewUrl(target)) void shell.openExternal(target).catch(() => undefined);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, target) => {
    if (!isSameOrigin(target, url)) event.preventDefault();
  });
  return window;
}
