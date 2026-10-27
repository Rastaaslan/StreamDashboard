import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserWindow } from 'electron';
import { openTwitchViewerSession } from '../apps/desktop/src/twitch-viewer.js';
import { createDashboardWindow } from '../apps/desktop/src/window.js';

const state = vi.hoisted(() => ({
  windows: [] as any[],
  loads: [] as Array<(url: string) => Promise<void>>,
  external: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class Window extends EventEmitter {
    destroyed = false;
    closePrevented = false;
    webContents: any;
    constructor(public options: any) {
      super();
      this.webContents = Object.assign(new EventEmitter(), {
        session: options.webPreferences?.session ?? { name: 'owner-session-' + state.windows.length },
        setAudioMuted: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        send: vi.fn(),
      });
      state.windows.push(this);
    }
    removeMenu = vi.fn();
    isDestroyed() { return this.destroyed; }
    show = vi.fn();
    focus = vi.fn();
    loadURL = vi.fn((url: string) => state.loads.shift()?.(url) ?? Promise.resolve());
    close = vi.fn(() => { if (!this.closePrevented) this.destroy(); });
    destroy = vi.fn(() => {
      if (this.destroyed) return;
      this.destroyed = true;
      this.emit('closed');
    });
  }
  return { BrowserWindow: Window, shell: { openExternal: state.external } };
});

const owner = () => new BrowserWindow({ webPreferences: { session: { name: 'persisted-owner-session' } as any } });
const lastWindow = () => state.windows.at(-1)!;
const popup = (window: any, url: string) => {
  const handler = window.webContents.setWindowOpenHandler.mock.calls.at(-1)[0];
  return handler({ url });
};
const drain = () => new Promise<void>(resolve => setImmediate(resolve));

beforeEach(() => {
  state.windows = [];
  state.loads = [];
  vi.clearAllMocks();
});
afterEach(async () => {
  for (const window of state.windows) if (!window.isDestroyed()) window.destroy();
  await drain();
});

describe('Twitch web session window', () => {
  it('uses the owner session without an app bridge or Node, and closing is never authentication proof', async () => {
    const dashboard = owner(), result = openTwitchViewerSession(dashboard, 'campfire');
    const viewer = lastWindow(), preferences = viewer.options.webPreferences;
    expect(viewer.options.parent).toBe(dashboard);
    expect(preferences.session).toBe(dashboard.webContents.session);
    expect(preferences).toMatchObject({ nodeIntegration: false, nodeIntegrationInSubFrames: false, contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false });
    expect(preferences).not.toHaveProperty('preload');
    expect(preferences).not.toHaveProperty('partition');
    expect(viewer.webContents.setAudioMuted).toHaveBeenCalledWith(true);
    expect(viewer.loadURL).toHaveBeenCalledExactlyOnceWith('https://www.twitch.tv/login');
    viewer.close();
    await expect(result).resolves.toEqual({ status: 'closed' });
    expect(dashboard.listenerCount('closed')).toBe(0);
    expect(state.external).not.toHaveBeenCalled();
  });

  it('shares one pending window and one result per owner, then permits a new session after close', async () => {
    const dashboard = owner(), first = openTwitchViewerSession(dashboard, 'campfire');
    const viewer = lastWindow(), second = openTwitchViewerSession(dashboard, 'campfire');
    expect(first).toBe(second);
    expect(state.windows).toHaveLength(2);
    expect(viewer.show).toHaveBeenCalledTimes(1);
    expect(viewer.focus).toHaveBeenCalledTimes(1);
    expect(dashboard.listenerCount('closed')).toBe(1);
    viewer.close();
    await expect(first).resolves.toEqual({ status: 'closed' });
    const next = openTwitchViewerSession(dashboard, 'campfire');
    expect(lastWindow()).not.toBe(viewer);
    expect(state.windows).toHaveLength(3);
    lastWindow().close();
    await expect(next).resolves.toEqual({ status: 'closed' });
  });

  it.each([
    'http://www.twitch.tv/login',
    'https://www.twitch.tv.attacker.test/login',
    'https://www.twitch.tv:444/login',
    'https://attacker@www.twitch.tv/login',
    'https://dashboard.twitch.tv/u/campfire/stream-manager',
    'file:///C:/Windows/System32',
    'javascript:alert(1)',
    'data:text/html,untrusted',
    'not-a-url',
  ])('refuses an untrusted initial destination without creating a window: %s', async url => {
    const dashboard = owner();
    await expect(openTwitchViewerSession(dashboard, 'campfire', url)).rejects.toThrow('indisponible');
    expect(state.windows).toHaveLength(1);
    expect(dashboard.listenerCount('closed')).toBe(0);
  });

  it.each(['../login', 'name with spaces', 'name\nother', 'a'.repeat(26)])('rejects a malformed channel: %s', async channel => {
    await expect(openTwitchViewerSession(owner(), channel)).rejects.toThrow('indisponible');
    expect(state.windows).toHaveLength(1);
  });

  it('blocks untrusted navigation, redirects and popups without opening them externally', async () => {
    const result = openTwitchViewerSession(owner(), 'campfire'), viewer = lastWindow();
    for (const target of ['https://attacker.test/', 'https://www.twitch.tv.attacker.test/', 'http://www.twitch.tv/login', 'https://user:password@www.twitch.tv/login', 'https://www.twitch.tv:444/login', 'file:///tmp/private', 'javascript:alert(1)']) {
      const navigation = { preventDefault: vi.fn() };
      viewer.webContents.emit('will-navigate', navigation, target);
      expect(navigation.preventDefault).toHaveBeenCalledTimes(1);
      const redirect = { preventDefault: vi.fn() };
      viewer.webContents.emit('will-redirect', redirect, target, false, true);
      expect(redirect.preventDefault).toHaveBeenCalledTimes(1);
      expect(popup(viewer, target)).toEqual({ action: 'deny' });
    }
    expect(viewer.loadURL).toHaveBeenCalledTimes(1);
    expect(state.external).not.toHaveBeenCalled();
    viewer.close();
    await expect(result).resolves.toEqual({ status: 'closed' });
  });

  it('keeps official Twitch login popups and redirects in the same unprivileged session', async () => {
    const dashboard = owner(), result = openTwitchViewerSession(dashboard, 'campfire'), viewer = lastWindow();
    for (const target of ['https://www.twitch.tv/login?next=%2Fcampfire', 'https://passport.twitch.tv/login', 'https://id.twitch.tv/oauth2/authorize?client_id=synthetic']) {
      const navigation = { preventDefault: vi.fn() };
      viewer.webContents.emit('will-navigate', navigation, target);
      expect(navigation.preventDefault).not.toHaveBeenCalled();
      const redirect = { preventDefault: vi.fn() };
      viewer.webContents.emit('will-redirect', redirect, target, false, true);
      expect(redirect.preventDefault).not.toHaveBeenCalled();
      expect(popup(viewer, target)).toEqual({ action: 'deny' });
      expect(viewer.loadURL).toHaveBeenLastCalledWith(target);
    }
    expect(state.windows).toHaveLength(2);
    expect(viewer.options.webPreferences.session).toBe(dashboard.webContents.session);
    expect(state.external).not.toHaveBeenCalled();
    viewer.close();
    await expect(result).resolves.toEqual({ status: 'closed' });
  });

  it.each(['rejected', 'throws'] as const)('cleans a failed initial load (%s) and allows another attempt', async failure => {
    state.loads.push(() => { if (failure === 'throws') throw new Error('synthetic failure'); return Promise.reject(new Error('synthetic failure')); });
    const dashboard = owner(), result = openTwitchViewerSession(dashboard, 'campfire'), viewer = lastWindow();
    await expect(result).rejects.toThrow('n’a pas pu être chargée');
    expect(viewer.isDestroyed()).toBe(true);
    expect(dashboard.listenerCount('closed')).toBe(0);
    const retry = openTwitchViewerSession(dashboard, 'campfire');
    expect(lastWindow()).not.toBe(viewer);
    lastWindow().close();
    await expect(retry).resolves.toEqual({ status: 'closed' });
  });

  it('cleans an allowed popup load failure instead of leaving the login request pending', async () => {
    const dashboard = owner(), result = openTwitchViewerSession(dashboard, 'campfire'), viewer = lastWindow();
    await drain();
    state.loads.push(() => Promise.reject(new Error('synthetic popup failure')));
    expect(popup(viewer, 'https://passport.twitch.tv/login')).toEqual({ action: 'deny' });
    await expect(result).rejects.toThrow('n’a pas pu être chargée');
    expect(viewer.isDestroyed()).toBe(true);
    expect(dashboard.listenerCount('closed')).toBe(0);
  });

  it('ignores an aborted obsolete load when a newer allowed popup has replaced it', async () => {
    let rejectInitial!: (error: Error) => void;
    state.loads.push(() => new Promise<void>((_resolve, reject) => { rejectInitial = reject; }));
    const result = openTwitchViewerSession(owner(), 'campfire'), viewer = lastWindow();
    let settled = false;
    void result.then(() => { settled = true; }, () => { settled = true; });
    popup(viewer, 'https://passport.twitch.tv/login');
    rejectInitial(new Error('ERR_ABORTED'));
    await drain();
    expect(viewer.isDestroyed()).toBe(false);
    expect(settled).toBe(false);
    viewer.close();
    await expect(result).resolves.toEqual({ status: 'closed' });
  });

  it('destroys the child when its owner closes even if the page would veto an ordinary close', async () => {
    const dashboard = owner(), result = openTwitchViewerSession(dashboard, 'campfire'), viewer = lastWindow();
    viewer.closePrevented = true;
    dashboard.destroy();
    expect(viewer.destroy).toHaveBeenCalledTimes(1);
    expect(viewer.isDestroyed()).toBe(true);
    await expect(result).resolves.toEqual({ status: 'closed' });
    expect(dashboard.listenerCount('closed')).toBe(0);
    await expect(openTwitchViewerSession(dashboard, 'campfire')).rejects.toThrow('indisponible');
  });

  it('rejects a crashed renderer and cleans the pending session', async () => {
    const dashboard = owner(), result = openTwitchViewerSession(dashboard, 'campfire'), viewer = lastWindow();
    viewer.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    await expect(result).rejects.toThrow('n’a pas pu être chargée');
    expect(viewer.isDestroyed()).toBe(true);
    expect(dashboard.listenerCount('closed')).toBe(0);
  });
});

describe('dashboard popup integration', () => {
  it('routes the embedded login to the shared session and notifies only closure', async () => {
    const dashboard = createDashboardWindow('http://127.0.0.1:48133/control/', '/synthetic/preload.cjs');
    expect(popup(dashboard, 'https://www.twitch.tv/login?embedded=true')).toEqual({ action: 'deny' });
    const viewer = lastWindow();
    expect(viewer).not.toBe(dashboard);
    expect(viewer.options.webPreferences.session).toBe(dashboard.webContents.session);
    expect(viewer.options.webPreferences).not.toHaveProperty('preload');
    expect(state.external).not.toHaveBeenCalled();
    viewer.close();
    await drain();
    expect(dashboard.webContents.send).toHaveBeenCalledExactlyOnceWith('viewer:twitch-session-closed');
  });
});
