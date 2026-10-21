import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import path from 'node:path';

const state = vi.hoisted(() => ({ info: vi.fn(), background: false, primary: true, ready: undefined as (() => void) | undefined, start: vi.fn(), stop: vi.fn(), installKeys: vi.fn(), stopKeys: vi.fn(), assets: vi.fn(), paths: { appData: '/unused', userData: '/unused/old-profile' } as Record<string,string>, windows: [] as any[], displays: [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }] }));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  const app = Object.assign(new EventEmitter(), {
    setName: vi.fn(), setPath: vi.fn((name:string,value:string)=>{state.paths[name]=value;}), setAppUserModelId: vi.fn(), requestSingleInstanceLock: () => state.primary,
    getPath: (name:string) => state.paths[name] || '/unused', getAppPath: () => '/unused/app', isReady: () => true, whenReady: () => new Promise<void>(resolve => { state.ready = resolve; }),
    quit: vi.fn(), exit: vi.fn(), getVersion: () => '1',
  });
  class Window extends EventEmitter {
    webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler: vi.fn(), setAudioMuted: vi.fn(), send: vi.fn(), session: {}, mainFrame: { url: 'about:blank' } });
    destroyed = false; minimized = true;
    bounds = { x: 4000, y: 0, width: 1440, height: 900 };
    constructor(public options: any) { super(); if(options.webPreferences?.session)this.webContents.session=options.webPreferences.session; state.windows.push(this); }
    removeMenu() {} isDestroyed() { return this.destroyed; } isMinimized() { return this.minimized; }
    restore = vi.fn(() => { this.minimized = false; });
    show = vi.fn(); focus = vi.fn(); loadURL = vi.fn(async(url:string)=>{this.webContents.mainFrame.url=url;});
    destroy = vi.fn(()=>{if(!this.destroyed){this.destroyed=true;this.emit('closed');}});
    close = vi.fn(()=>this.destroy());
    getBounds() { return this.bounds; } setBounds(value: any) { this.bounds = value; }
  }
  return { app, protocol:{registerSchemesAsPrivileged:vi.fn()}, BrowserWindow: Window, Tray: class extends EventEmitter {setToolTip(){} setContextMenu(){} destroy(){}}, Menu:{buildFromTemplate:(value:unknown)=>value},nativeImage:{createFromPath:()=>({})}, screen: { getAllDisplays: () => state.displays, getPrimaryDisplay: () => state.displays[0] },
    dialog: { showErrorBox: vi.fn() }, ipcMain: { handle: vi.fn(), on: vi.fn() }, shell: {} };
});
vi.mock('../apps/desktop/src/installation-store.js', () => ({ InstallationStore: class {
  async read() { return {version:2,revision:0,localDeviceId:'test-device',preset:'single-pc',runtimeProfile:'root',configured:false,background:state.background,routes:{obs:'test-device'},devices:[{id:'test-device',name:'Test',platform:'windows',enabled:true,roles:['controller','obs-executor','services'],capabilities:['obs','cloud']}]}; }
} }));
vi.mock('../apps/desktop/src/lifecycle.js', () => ({ startDesktopRuntime: state.start }));
vi.mock('../apps/desktop/src/controller.js', () => ({ installControllerKeys: state.installKeys, startControllerAssets: state.assets }));
vi.mock('../apps/desktop/src/squirrel.js', () => ({ handleSquirrelStartup: () => false }));
vi.mock('../apps/desktop/src/updater.js', () => ({ startUpdater: () => vi.fn() }));
vi.mock('../apps/desktop/src/logger.js', () => ({ DesktopLogger: class {
  file = 'logs/streamdashboard.log'; info = state.info; error = vi.fn().mockResolvedValue(undefined); flush = vi.fn().mockResolvedValue(undefined);
} }));

let exceptionListeners: NodeJS.UncaughtExceptionListener[];
let rejectionListeners: NodeJS.UnhandledRejectionListener[];
beforeEach(async () => {
  const { app } = await import('electron');
  app.removeAllListeners();
  vi.resetModules(); vi.clearAllMocks(); state.start.mockReset(); state.stop.mockReset(); state.primary = true; state.background = false; state.windows = [];
  state.paths = { appData: '/unused', userData: '/unused/old-profile' };
  state.installKeys.mockReturnValue(state.stopKeys);
  state.info.mockResolvedValue(undefined);
  exceptionListeners = process.listeners('uncaughtException');
  rejectionListeners = process.listeners('unhandledRejection');
});
afterEach(() => {
  for (const listener of process.listeners('uncaughtException')) if (!exceptionListeners.includes(listener)) process.removeListener('uncaughtException', listener);
  for (const listener of process.listeners('unhandledRejection')) if (!rejectionListeners.includes(listener)) process.removeListener('unhandledRejection', listener);
});

it.each(['crash', 'server', 'load', 'secondary'] as const)('presents during startup, restores 20 launches and exits cleanly on %s failure', async failure => {
  state.primary = failure !== 'secondary';
  const { app, dialog } = await import('electron');
  let rejectRuntime!: (error: Error) => void;
  let resolveRuntime!: (value: any) => void;
  state.start.mockImplementation(() => new Promise((resolve, reject) => { resolveRuntime = resolve; rejectRuntime = reject; }));
  const previousExceptions = process.listeners('uncaughtException');
  const previousRejections = process.listeners('unhandledRejection');
  try {
    await import('../apps/desktop/src/main.js');
    expect(app.setPath).toHaveBeenCalledExactlyOnceWith('userData',path.join('/unused','StreamDashboard-Next'));
    state.ready!();
    if (failure === 'secondary') {
      await vi.waitFor(() => expect(app.quit).toHaveBeenCalled());
      app.emit('activate');
      expect(state.start).not.toHaveBeenCalled();
      expect(state.installKeys).not.toHaveBeenCalled();
      expect(state.windows).toHaveLength(0);
      return;
    }
    await vi.waitFor(() => expect(state.start).toHaveBeenCalledTimes(1));
    expect(state.installKeys).toHaveBeenCalledExactlyOnceWith(expect.any(Function),path.join('/unused','StreamDashboard-Next'),'http://127.0.0.1:48133');
    expect(state.assets).not.toHaveBeenCalled();
    const window = state.windows[0];
    expect(window.options.show).toBe(true);
    expect(window.show).toHaveBeenCalled();
    expect(window.bounds.x).toBe(0);
    for (let i = 0; i < 20; i++) { window.minimized = true; app.emit('second-instance'); }
    expect(window.restore).toHaveBeenCalledTimes(21);
    expect(state.windows).toHaveLength(1);
    if (failure === 'server') rejectRuntime(new Error('listen EADDRINUSE 48132'));
    else {
      if (failure === 'load') window.loadURL.mockRejectedValueOnce(new Error('ERR_CONNECTION_REFUSED'));
      resolveRuntime({ dashboard: { url: 'http://127.0.0.1:48133' }, stop: state.stop });
      await vi.waitFor(() => expect(window.loadURL).toHaveBeenCalledTimes(2));
      app.emit('activate');
      expect(window.focus).toHaveBeenCalledTimes(22);
      if (failure === 'crash') {
        window.webContents.emit('did-fail-load', {}, -105, 'failed', '', false);
        expect(dialog.showErrorBox).not.toHaveBeenCalled();
        window.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
      }
    }
    await vi.waitFor(() => expect(dialog.showErrorBox).toHaveBeenCalledTimes(1));
    window.webContents.emit('did-fail-load', {}, -105, 'failed', '', true);
    expect(dialog.showErrorBox).toHaveBeenCalledTimes(1);
    app.emit('before-quit', { preventDefault: vi.fn() });
    await vi.waitFor(() => expect(app.exit).toHaveBeenCalledWith(1));
    expect(state.stop).toHaveBeenCalledTimes(failure === 'server' ? 0 : 1);
    expect(state.stopKeys).toHaveBeenCalledTimes(1);
  } finally {
    for (const listener of process.listeners('uncaughtException')) if (!previousExceptions.includes(listener)) process.removeListener('uncaughtException', listener);
    for (const listener of process.listeners('unhandledRejection')) if (!previousRejections.includes(listener)) process.removeListener('unhandledRejection', listener);
  }
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const drain = () => new Promise<void>(resolve => setImmediate(resolve));

it.each(['before-acquire', 'acquire-during-quit', 'normal', 'stop-fails', 'cancel-pending'] as const)(
  'coordinates startup and shutdown: %s', async scenario => {
    const acquisition = deferred<any>();
    const stopping = deferred<void>();
    let signal!: AbortSignal;
    state.start.mockImplementation((_logger, value: AbortSignal) => {
      signal = value;
      if (scenario === 'cancel-pending') value.addEventListener('abort', () => acquisition.reject(value.reason), { once: true });
      return acquisition.promise;
    });
    state.stop.mockReturnValue(stopping.promise);
    const { app } = await import('electron');
    await import('../apps/desktop/src/main.js');
    state.ready!();
    await vi.waitFor(() => expect(state.start).toHaveBeenCalledTimes(1));
    const handle = { dashboard: {}, stop: state.stop };
    if (scenario === 'normal' || scenario === 'stop-fails') {
      acquisition.resolve(handle);
      await vi.waitFor(() => expect(state.windows[0].loadURL).toHaveBeenCalledTimes(2));
    }
    // Resolve without draining microtasks to reproduce completion racing quit.
    if (scenario === 'acquire-during-quit') acquisition.resolve(handle);
    const preventDefault = vi.fn();
    app.emit('before-quit', { preventDefault });
    app.emit('before-quit', { preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(2);
    expect(signal.aborted).toBe(true);
    expect(state.stopKeys).toHaveBeenCalledTimes(1);
    if (scenario === 'cancel-pending') {
      await vi.waitFor(() => expect(app.exit).toHaveBeenCalledWith(0));
      expect(state.stop).not.toHaveBeenCalled();
      return;
    }
    await drain();
    expect(app.exit).not.toHaveBeenCalled();
    expect(state.info).not.toHaveBeenCalledWith('Shutdown complete');
    if (scenario === 'before-acquire') {
      expect(state.stop).not.toHaveBeenCalled();
      acquisition.resolve(handle);
    }
    await vi.waitFor(() => expect(state.stop).toHaveBeenCalledTimes(1));
    await drain();
    expect(app.exit).not.toHaveBeenCalled();
    expect(state.info).not.toHaveBeenCalledWith('Shutdown complete');
    if (scenario === 'stop-fails') stopping.reject(new Error('Persistence failed'));
    else stopping.resolve();
    await vi.waitFor(() => expect(app.exit).toHaveBeenCalledExactlyOnceWith(scenario === 'stop-fails' ? 1 : 0));
    if (scenario === 'stop-fails') expect(state.info).not.toHaveBeenCalledWith('Shutdown complete');
    else expect(state.info).toHaveBeenCalledWith('Shutdown complete');
  });

it('opens the Twitch viewer only for the current trusted main frame', async () => {
  const { app, ipcMain } = await import('electron');
  state.start.mockResolvedValue({ dashboard: { url: 'http://127.0.0.1:48133' }, stop: state.stop });
  await import('../apps/desktop/src/main.js');
  state.ready!();
  await vi.waitFor(() => expect(state.windows[0]?.loadURL).toHaveBeenCalledTimes(2));
  const dashboard=state.windows[0],frame=dashboard.webContents.mainFrame;
  const handler=vi.mocked(ipcMain.handle).mock.calls.find(([name])=>name==='viewer:open-twitch-session')![1];
  expect(frame.url).toBe('http://127.0.0.1:48133/mobile/control/');
  for(const event of [
    {sender:{},senderFrame:frame},
    {sender:dashboard.webContents,senderFrame:{url:frame.url}},
    {sender:dashboard.webContents,senderFrame:undefined},
  ])expect(()=>handler(event as any,{channel:'campfire'})).toThrow('Interface non autorisée');
  const trusted={sender:dashboard.webContents,senderFrame:frame};
  for(const url of ['https://www.twitch.tv/login','http://127.0.0.1:48134/mobile/control/']){
    frame.url=url;
    expect(()=>handler(trusted as any,{channel:'campfire'})).toThrow('Interface non autorisée');
  }
  frame.url='http://127.0.0.1:48133/mobile/control/';
  for(const value of [{channel:'../login'},{channel:'name with spaces'},{},null]){
    expect(()=>handler(trusted as any,value)).toThrow('Chaîne Twitch invalide');
  }
  expect(state.windows).toHaveLength(1);
  const result=handler(trusted as any,{channel:'campfire'});
  expect(state.windows).toHaveLength(2);
  const viewer=state.windows[1];
  expect(viewer.options.webPreferences.session).toBe(dashboard.webContents.session);
  viewer.close();
  await expect(result).resolves.toEqual({status:'closed'});
  dashboard.destroy();
  expect(()=>handler(trusted as any,{channel:'campfire'})).toThrow('Interface non autorisée');
  app.emit('before-quit',{preventDefault:vi.fn()});
  await vi.waitFor(()=>expect(app.exit).toHaveBeenCalledWith(0));
  expect(state.stop).toHaveBeenCalledTimes(1);
  expect(state.stopKeys).toHaveBeenCalledTimes(1);
});


it('keeps one runtime and native macros while closing and reopening the dashboard in background mode',async()=>{
 state.background=true;
 state.start.mockResolvedValue({dashboard:{url:'http://127.0.0.1:48133'},stop:state.stop});
 const {app}=await import('electron');
 await import('../apps/desktop/src/main.js');state.ready!();
 await vi.waitFor(()=>expect(state.windows[0]?.loadURL).toHaveBeenCalledTimes(2));
 state.windows[0].destroy();app.emit('window-all-closed');
 expect(app.quit).not.toHaveBeenCalled();expect(state.stopKeys).not.toHaveBeenCalled();
 app.emit('activate');
 await vi.waitFor(()=>expect(state.windows).toHaveLength(2));
 await vi.waitFor(()=>expect(state.windows[1].loadURL).toHaveBeenCalledTimes(1));
 expect(state.start).toHaveBeenCalledTimes(1);expect(state.installKeys).toHaveBeenCalledTimes(1);
 app.emit('before-quit',{preventDefault:vi.fn()});
 await vi.waitFor(()=>expect(state.stop).toHaveBeenCalledTimes(1));
});
