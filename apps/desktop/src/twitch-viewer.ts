import { BrowserWindow } from 'electron';
import { isAllowedTwitchViewerUrl } from './security.js';

type ViewerResult = { status: 'closed' };
const sessions = new WeakMap<BrowserWindow, { window: BrowserWindow; result: Promise<ViewerResult> }>();

/** No API token or browser cookies are copied. Twitch performs its own web login. */
export function openTwitchViewerSession(owner: BrowserWindow, channel = '', initialUrl = 'https://www.twitch.tv/login'): Promise<ViewerResult> {
  if (owner.isDestroyed() || !isAllowedTwitchViewerUrl(initialUrl) || (channel && !/^[a-zA-Z0-9_]{1,25}$/.test(channel))) {
    return Promise.reject(new Error('Connexion de la visionneuse Twitch indisponible.'));
  }
  const existing = sessions.get(owner);
  if (existing && !existing.window.isDestroyed()) {
    existing.window.show(); existing.window.focus(); return existing.result;
  }
  const viewer = new BrowserWindow({
    parent: owner, width: 1000, height: 800, minWidth: 540, minHeight: 600,
    show: true, autoHideMenuBar: true, backgroundColor: '#18181b',
    title: 'Connexion Twitch — fermez cette fenêtre pour revenir à la visionneuse',
    webPreferences: {
      session: owner.webContents.session,
      nodeIntegration: false, nodeIntegrationInSubFrames: false,
      contextIsolation: true, sandbox: true, webSecurity: true,
      allowRunningInsecureContent: false, webviewTag: false,
      // In particular, this remote page never receives the app's preload bridge.
    },
  });
  viewer.removeMenu();
  viewer.webContents.setAudioMuted(true);
  const guard = (event: Electron.Event, target: string) => {
    if (!isAllowedTwitchViewerUrl(target)) event.preventDefault();
  };
  viewer.webContents.on('will-navigate', guard);
  viewer.webContents.on('will-redirect', (event, target, _inPlace, mainFrame) => {
    if (mainFrame) guard(event, target);
  });
  viewer.webContents.setWindowOpenHandler(({ url }) => {
    // Keep the login in the same unprivileged window and session. External app
    // OAuth remains in the system browser through the separate existing bridge.
    if (isAllowedTwitchViewerUrl(url)) load(url);
    return { action: 'deny' };
  });
  let completed = false;
  let finish!: (value: ViewerResult) => void;
  let fail!: (error: Error) => void;
  const result = new Promise<ViewerResult>((resolve, reject) => { finish = resolve; fail = reject; });
  // The owner is already closed: a remote beforeunload handler must not leave
  // an orphaned login window or an IPC promise waiting indefinitely.
  const closeWithOwner = () => { if (!viewer.isDestroyed()) viewer.destroy(); };
  const cleanup = () => {
    owner.removeListener('closed', closeWithOwner);
    if (sessions.get(owner)?.window === viewer) sessions.delete(owner);
  };
  viewer.once('closed', () => {
    cleanup();
    if (completed) return;
    completed = true;
    // Closing a login page is not proof of authentication: no "connected" flag.
    finish({ status: 'closed' });
  });
  owner.once('closed', closeWithOwner);
  sessions.set(owner, { window: viewer, result });
  const failLoad = () => {
    if (completed) return;
    completed = true; cleanup();
    fail(new Error('La page de connexion Twitch n’a pas pu être chargée. Vérifiez la connexion de ce PC puis réessayez.'));
    if (!viewer.isDestroyed()) viewer.destroy();
  };
  let loadGeneration = 0;
  function load(target: string) {
    const generation = ++loadGeneration;
    try {
      void viewer.loadURL(target).catch(() => { if (generation === loadGeneration) failLoad(); });
    } catch { if (generation === loadGeneration) failLoad(); }
  }
  viewer.webContents.once('render-process-gone', failLoad);
  load(initialUrl);
  return result;
}
