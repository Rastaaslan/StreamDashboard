import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteUpgradeJournal } from '../apps/desktop/src/streamcockpit-upgrade-journal.js';
import { runtimeUpgradeDirectory } from '../apps/desktop/src/streamcockpit-runtime-ownership.js';

const f = vi.hoisted(() => ({
  paths: {} as Record<string, string>, ready: undefined as (() => void) | undefined,
  leases: [] as Array<{ stop(): Promise<void> }>, windows: [] as any[],
  recover: vi.fn(), start: vi.fn(), stop: vi.fn(), info: vi.fn(), error: vi.fn(), flush: vi.fn(),
  keys: vi.fn(), stopKeys: vi.fn(), nodeStart: vi.fn(), trust: vi.fn(), change: vi.fn(), primary: true,
}));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  const app = Object.assign(new EventEmitter(), {
    getPath: (name: string) => f.paths[name], setPath: (name: string, value: string) => { f.paths[name] = value; },
    setName: vi.fn(), setAppUserModelId: vi.fn(), requestSingleInstanceLock: () => f.primary,
    getVersion: () => '3.0.0-alpha.1', getAppPath: () => f.paths.image, isReady: () => true,
    whenReady: () => new Promise<void>(yes => { f.ready = yes; }), quit: vi.fn(), exit: vi.fn(), relaunch: vi.fn(),
  });
  return { app, protocol: { registerSchemesAsPrivileged: vi.fn() }, ipcMain: { handle: vi.fn(), on: vi.fn() },
    dialog: { showErrorBox: vi.fn() }, shell: {}, Menu: {}, Tray: class {}, nativeImage: {}, Notification: {} };
});
vi.mock('../apps/desktop/src/window.js', async () => {
  const { EventEmitter } = await import('node:events');
  return { isAllowedExternalAuthUrl: () => false, isAllowedTwitchUrl: () => false,
    createDashboardWindow: (_url: string) => {
      const window = Object.assign(new EventEmitter(), {
        isDestroyed: () => false, webContents: Object.assign(new EventEmitter(), { mainFrame: { url: '' } }),
        loadURL: vi.fn(async (url: string) => { window.webContents.mainFrame.url = url; }),
      });
      f.windows.push(window); return window;
    } };
});
vi.mock('../apps/desktop/src/presentation.js', () => ({ presentWindow: vi.fn() }));
vi.mock('../apps/desktop/src/installation-store.js', () => ({ InstallationStore: class {
  recover = f.recover; read = f.recover; change = f.change;
} }));
vi.mock('../apps/desktop/src/lifecycle.js', () => ({ startDesktopRuntime: f.start }));
vi.mock('../apps/desktop/src/logger.js', () => ({ DesktopLogger: class {
  file = 'synthetic-log'; info = f.info; error = f.error; flush = f.flush;
} }));
vi.mock('../apps/desktop/src/secrets.js', () => ({ ElectronSecretStore: class {} }));
vi.mock('../apps/desktop/src/peer-transport.js', () => ({ PeerTransport: class {
  trust = f.trust; fetch = vi.fn(); async close() {};
} }));
vi.mock('../apps/controller/src/agent-link.js', () => ({ ControllerAgentLink: class { start = f.nodeStart; async stop() {} } }));
vi.mock('../apps/desktop/src/autonomous-executor.js', () => ({ AutonomousExecutor: class { async dispose() {} } }));
vi.mock('../apps/desktop/src/dji-background-publisher.js', () => ({ DjiBackgroundPublisher: class { start() {} stop() {} } }));
vi.mock('../apps/desktop/src/dji-host-warning-watcher.js', () => ({ DjiHostWarningWatcher: class { start() {} stop() {} } }));
vi.mock('../apps/desktop/src/controller.js', () => ({ installControllerKeys: f.keys, startControllerAssets: vi.fn() }));
vi.mock('../apps/desktop/src/login-startup.js', () => ({ configureLoginStartup: vi.fn() }));
vi.mock('../apps/desktop/src/squirrel.js', () => ({ handleSquirrelStartup: () => false }));
vi.mock('../apps/desktop/src/streamcockpit-application-ownership.js', async original => {
  const actual = await original<typeof import('../apps/desktop/src/streamcockpit-application-ownership.js')>();
  return { ...actual, acquireDesktopApplicationOwnership: async (...args: Parameters<typeof actual.acquireDesktopApplicationOwnership>) => {
    const lease = await actual.acquireDesktopApplicationOwnership(...args); f.leases.push(lease); return lease;
  } };
});
const onWindows = process.platform === 'win32' ? it : it.skip;
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; };
let root = '', exits: NodeJS.UncaughtExceptionListener[] = [], rejections: NodeJS.UnhandledRejectionListener[] = [];
const model = () => ({ version: 2, revision: 0, localDeviceId: 'fixture', runtimeProfile: 'root', background: false,
  configured: true, devices: [{ id: 'fixture', name: 'Test', roles: ['controller', 'obs-executor'], enabled: true }] });
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); f.leases = []; f.windows = []; f.primary = true;
  root = await mkdtemp(join(tmpdir(), 'sc3-main-ownership-'));
  f.paths = { appData: join(root, 'app-data'), userData: join(root, 'old'), image: join(root, 'image') };
  await mkdir(f.paths.appData); await mkdir(f.paths.image);
  f.recover.mockReset().mockImplementation(async () => model());
  f.stop.mockReset().mockResolvedValue(undefined); f.start.mockReset().mockResolvedValue({
    dashboard: { url: 'http://127.0.0.1:48133', state: () => ({ obs: { streaming: false } }) }, stop: f.stop,
  });
  f.info.mockReset().mockResolvedValue(undefined); f.error.mockReset().mockResolvedValue(undefined); f.flush.mockReset().mockResolvedValue(undefined);
  f.keys.mockReturnValue(f.stopKeys); f.trust.mockReset().mockResolvedValue(undefined);
  exits = process.listeners('uncaughtException'); rejections = process.listeners('unhandledRejection');
});
const coordinator = () => runtimeUpgradeDirectory(f.paths.appData, join(f.paths.appData, 'StreamDashboard-Next'));
const busy = () => expect(new SqliteUpgradeJournal(coordinator()).exclusive(async () => true)).rejects.toThrow('BUSY');
async function boot() { await import('../apps/desktop/src/main.js'); f.ready!(); }
async function quit() {
  const { app } = await import('electron'); app.emit('before-quit', { preventDefault: vi.fn() });
  await vi.waitFor(() => expect(app.exit).toHaveBeenCalled());
}
afterEach(async () => {
  await quit();
  for (const lease of f.leases) await lease.stop(); // Only test-owned leases: real main exits instead.
  for (const listener of process.listeners('uncaughtException')) if (!exits.includes(listener)) process.removeListener('uncaughtException', listener);
  for (const listener of process.listeners('unhandledRejection')) if (!rejections.includes(listener)) process.removeListener('unhandledRejection', listener);
  await rm(root, { recursive: true, force: true });
});
onWindows('refuses early main profile migration, logging and macro acquisition while maintenance owns the profile', async () => {
  await mkdir(coordinator(), { recursive: true });
  await new SqliteUpgradeJournal(coordinator()).exclusive(async () => {
    await boot(); const { dialog } = await import('electron');
    await vi.waitFor(() => expect(dialog.showErrorBox).toHaveBeenCalled());
    expect(f.recover).not.toHaveBeenCalled(); expect(f.keys).not.toHaveBeenCalled();
    expect(f.nodeStart).not.toHaveBeenCalled(); expect(f.start).not.toHaveBeenCalled();
    expect(f.info).not.toHaveBeenCalled(); expect(f.error).not.toHaveBeenCalled();
    expect(f.windows).toHaveLength(0); await quit(); expect(f.info).not.toHaveBeenCalled();
  });
});
onWindows('owns the whole main lifecycle before InstallationStore and until process exit, including final logger flush', async () => {
  const runtimeDrain = deferred(), logDrain = deferred();
  f.recover.mockImplementation(async () => { await busy(); return model(); });
  f.stop.mockReturnValue(runtimeDrain.promise); f.flush.mockReturnValue(logDrain.promise);
  await boot(); await vi.waitFor(() => expect(f.start).toHaveBeenCalledTimes(1));
  const { app } = await import('electron');
  expect(f.start.mock.calls[0][5]).toBe(f.leases[0]);
  app.emit('before-quit', { preventDefault: vi.fn() });
  try {
    await vi.waitFor(() => expect(f.stop).toHaveBeenCalledTimes(1)); await busy();
    runtimeDrain.resolve(); await vi.waitFor(() => expect(f.flush).toHaveBeenCalledTimes(1));
    await busy(); expect(app.exit).not.toHaveBeenCalled();
    logDrain.resolve(); await vi.waitFor(() => expect(app.exit).toHaveBeenCalledWith(0));
    await busy(); // The mock does not exit: ownership must still be held.
  } finally { runtimeDrain.resolve(); logDrain.resolve(); }
});
onWindows('quit during early profile recovery cannot start a late runtime or release maintenance admission', async () => {
  const gate = deferred(); f.recover.mockImplementation(async () => { await gate.promise; return model(); });
  await boot(); await vi.waitFor(() => expect(f.recover).toHaveBeenCalledTimes(1));
  const { app } = await import('electron'); app.emit('before-quit', { preventDefault: vi.fn() });
  try {
    await busy(); expect(app.exit).not.toHaveBeenCalled(); gate.resolve();
    await vi.waitFor(() => expect(app.exit).toHaveBeenCalledWith(0));
    expect(f.start).not.toHaveBeenCalled(); expect(f.keys).not.toHaveBeenCalled(); await busy();
  } finally { gate.resolve(); }
});
onWindows('drains an accepted main-process write before runtime shutdown and refuses new IPC writes after quit', async () => {
  const gate = deferred(); f.trust.mockImplementation(async () => { await gate.promise; });
  await boot(); await vi.waitFor(() => expect(f.windows[0]?.webContents.mainFrame.url).toBe('http://127.0.0.1:48133/mobile/control/'));
  const { app, ipcMain } = await import('electron'), owner = f.windows[0];
  const handler = vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === 'peer:trust')![1];
  const event = { sender: owner.webContents, senderFrame: owner.webContents.mainFrame } as never;
  const accepted = handler(event, 'fixture', 'fixture', 'fixture');
  app.emit('before-quit', { preventDefault: vi.fn() });
  try {
    await new Promise<void>(yes => setImmediate(yes)); expect(f.stop).not.toHaveBeenCalled(); await busy();
    expect(() => handler(event, 'fixture', 'fixture', 'fixture')).toThrow();
    gate.resolve(); await accepted; await vi.waitFor(() => expect(app.exit).toHaveBeenCalledWith(0));
    expect(f.trust).toHaveBeenCalledTimes(1); expect(f.stop).toHaveBeenCalledTimes(1); await busy();
  } finally { gate.resolve(); await accepted; }
});
onWindows('denies unguarded sound imports before ownership without creating a profile', async () => {
  await import('../apps/desktop/src/main.js'); const { ipcMain } = await import('electron');
  const handler = vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === 'soundboard:import-file')![1];
  expect(() => handler({} as never, join(root, 'not-a-real-sound.wav'))).toThrow('APPLICATION_NOT_READY');
  expect(await readdir(f.paths.appData)).toEqual([]);
});

onWindows('restores native macros without blocking runtime acquisition and drains restoration on quit', async () => {
  const gate = deferred();
  const restore = vi.fn(() => gate.promise);
  f.keys.mockReturnValue(Object.assign(() => f.stopKeys(), { restore }));
  await boot();
  const { app } = await import('electron');
  try {
    await vi.waitFor(() => expect(f.start).toHaveBeenCalledTimes(1));
    expect(restore).toHaveBeenCalledTimes(1); await busy();
    app.emit('before-quit', { preventDefault: vi.fn() });
    await new Promise<void>(yes => setImmediate(yes));
    expect(app.exit).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
    gate.resolve(); await vi.waitFor(() => expect(app.exit).toHaveBeenCalledWith(0));
    expect(f.stop).toHaveBeenCalledTimes(1); await busy();
  } finally { gate.resolve(); }
});
onWindows('retains application ownership through a failed runtime drain instead of advertising idle maintenance', async () => {
  f.stop.mockRejectedValue(new Error('synthetic uncertain runtime write'));
  await boot(); await vi.waitFor(() => expect(f.start).toHaveBeenCalledTimes(1));
  await quit(); const { app } = await import('electron');
  expect(app.exit).toHaveBeenCalledWith(1); await busy();
  expect(f.info).not.toHaveBeenCalledWith('Shutdown complete');
});
