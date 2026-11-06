import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { startUpdater } from '../apps/desktop/src/updater.js';
import { autoUpdater } from 'electron';
const mocks = vi.hoisted(() => ({ check: vi.fn(), quit: vi.fn(), show: vi.fn(), feed: vi.fn() }));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  return { app: { isPackaged: true, getVersion: () => '3.0.0' },
    autoUpdater: Object.assign(new EventEmitter(), { setFeedURL: mocks.feed, checkForUpdates: mocks.check, quitAndInstall: mocks.quit }),
    dialog: { showMessageBox: mocks.show } };
});
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
let stop: ReturnType<typeof startUpdater> | undefined;
const assess = vi.fn();
const cleanup = vi.fn();
const logger = { info: vi.fn(), error: vi.fn() };
const drain = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); vi.stubEnv('NODE_ENV', 'production');
  Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' });
  assess.mockReset().mockResolvedValue({ safe: true });
  mocks.show.mockReset().mockResolvedValue({ response: 1 });
});
afterEach(() => { stop?.(); stop = undefined; Object.defineProperty(process, 'platform', platform); vi.useRealTimers(); vi.unstubAllEnvs(); });
it('connects candidate updater to a blocked report without cleanup, install or automatic replay', async () => {
  stop = startUpdater({} as never, { assessRestartSafety: assess } as never, logger, cleanup);
  autoUpdater.emit('update-downloaded'); await drain();
  expect(mocks.show).toHaveBeenCalledTimes(2);
  expect(mocks.show.mock.calls[1][1]).toMatchObject({ title: 'Mise à jour bloquée' });
  expect(logger.error).toHaveBeenCalledWith('Installation bloquée par le préflight', expect.objectContaining({ launchAllowed: false, state: 'blocked' }));
  await vi.advanceTimersByTimeAsync(20_000);
  expect(mocks.show).toHaveBeenCalledTimes(2);
  expect(cleanup).not.toHaveBeenCalled(); expect(mocks.quit).not.toHaveBeenCalled();
  expect((await stop.preflight()).launchAllowed).toBe(false);
});
it('redacts credentials from updater, check and dialog provider errors', async () => {
  const externalError = new Error('Authorization: Bearer LEAK_SECRET_123');
  const availability=vi.fn(async()=>{throw externalError});
  mocks.show.mockRejectedValueOnce(externalError);
  stop = startUpdater({} as never, { assessRestartSafety: assess } as never, logger, cleanup, undefined, undefined, availability);
  autoUpdater.emit('error', externalError);
  autoUpdater.emit('update-downloaded');
  await vi.advanceTimersByTimeAsync(1);
  await drain();
  expect(JSON.stringify(logger.error.mock.calls)).not.toContain('LEAK_SECRET_123');
  expect(JSON.stringify(logger.error.mock.calls)).not.toContain('Bearer');
  expect(logger.error).toHaveBeenCalledWith('Erreur updater (détails masqués)');
  expect(logger.error).toHaveBeenCalledWith('Vérification updater impossible (détails masqués)');
  expect(logger.error).toHaveBeenCalledWith('Erreur dialogue updater (détails masqués)');
  expect(cleanup).not.toHaveBeenCalled();
  expect(mocks.quit).not.toHaveBeenCalled();
});
it('contains a synchronous availability-reader failure without exposing its details', async () => {
  const availability=()=>{throw new Error('Authorization: Bearer LEAK_SECRET_SYNC')};
  stop = startUpdater({} as never, { assessRestartSafety: assess } as never, logger, cleanup, undefined, undefined, availability);
  await vi.advanceTimersByTimeAsync(1);
  expect(logger.error).toHaveBeenCalledWith('Vérification updater impossible (détails masqués)');
  expect(JSON.stringify(logger.error.mock.calls)).not.toContain('LEAK_SECRET_SYNC');
  expect(cleanup).not.toHaveBeenCalled();
  expect(mocks.quit).not.toHaveBeenCalled();
});
it('retains live guard before showing any dialog', async () => {
  assess.mockResolvedValue({ safe: false });
  stop = startUpdater({} as never, { assessRestartSafety: assess } as never, logger, cleanup);
  autoUpdater.emit('update-downloaded'); await drain();
  expect(mocks.show).not.toHaveBeenCalled(); expect(cleanup).not.toHaveBeenCalled(); expect(mocks.quit).not.toHaveBeenCalled();
});
it('exposes diagnostic preflight without starting Electron update checks in development', async () => {
  vi.stubEnv('NODE_ENV', 'test');
  stop = startUpdater({} as never, { assessRestartSafety: assess } as never, logger, cleanup);
  expect((await stop.preflight()).state).toBe('blocked');
  expect(mocks.feed).not.toHaveBeenCalled(); expect(mocks.check).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0); expect(mocks.quit).not.toHaveBeenCalled();
});


it('routes an explicit updater choice to the native prepared transaction, never to Squirrel quitAndInstall', async () => {
  const native = vi.fn(async (isCurrent: () => boolean) => { expect(isCurrent()).toBe(true); });
  stop = startUpdater({} as never, { assessRestartSafety: assess } as never, logger, cleanup, undefined, native);
  await vi.advanceTimersByTimeAsync(1);
  expect(native).not.toHaveBeenCalled();
  autoUpdater.emit('update-downloaded'); await drain();
  expect(mocks.show).toHaveBeenCalledTimes(1);
  expect(mocks.show.mock.calls[0][1].buttons).toEqual(['Plus tard', 'Choisir le contrat signé']);
  expect(assess).toHaveBeenCalledTimes(2); expect(native).toHaveBeenCalledOnce();
  expect(cleanup).not.toHaveBeenCalled(); expect(mocks.quit).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(60_000); expect(native).toHaveBeenCalledOnce();
});
it('invalidates native updater authority when disposed during the existing native dialog', async () => {
  let finish!: () => void, current!: () => boolean;
  const native = vi.fn((isCurrent: () => boolean) => { current = isCurrent; return new Promise<void>(r => { finish = r; }); });
  stop = startUpdater({} as never, { assessRestartSafety: assess } as never, logger, cleanup, undefined, native);
  autoUpdater.emit('update-downloaded'); await drain(); expect(native).toHaveBeenCalledOnce();
  expect(current()).toBe(true); stop(); expect(current()).toBe(false); finish(); await drain();
  expect(cleanup).not.toHaveBeenCalled(); expect(mocks.quit).not.toHaveBeenCalled();
});
it.each(['operator-deferred', 'live-after-dialog'] as const)('does not open native maintenance for %s', async reason => {
  const native = vi.fn(async () => undefined);
  mocks.show.mockImplementation(async () => {
    if (reason === 'live-after-dialog') assess.mockResolvedValue({safe:false});
    return {response:reason === 'operator-deferred' ? 0 : 1};
  });
  stop = startUpdater({} as never, { assessRestartSafety: assess } as never, logger, cleanup, undefined, native);
  autoUpdater.emit('update-downloaded'); await drain();
  expect(native).not.toHaveBeenCalled(); expect(cleanup).not.toHaveBeenCalled(); expect(mocks.quit).not.toHaveBeenCalled();
});
it('does not replay or expose provider details after a native maintenance failure', async () => {
  const native = vi.fn(async () => { throw Error('Bearer TEST_ONLY_NATIVE_SECRET'); });
  stop = startUpdater({} as never, { assessRestartSafety: assess } as never, logger, cleanup, undefined, native);
  autoUpdater.emit('update-downloaded'); await drain(); await vi.advanceTimersByTimeAsync(60_000);
  expect(native).toHaveBeenCalledOnce(); expect(mocks.quit).not.toHaveBeenCalled(); expect(cleanup).not.toHaveBeenCalled();
  expect(JSON.stringify(logger.error.mock.calls)).not.toContain('TEST_ONLY_NATIVE_SECRET');
});

vi.mock('../apps/desktop/src/streamcockpit-release-availability.js',()=>({readAvailableWindowsRelease:vi.fn(async()=>undefined)}));
