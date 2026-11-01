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
  mocks.check.mockRejectedValueOnce(externalError);
  mocks.show.mockRejectedValueOnce(externalError);
  stop = startUpdater({} as never, { assessRestartSafety: assess } as never, logger, cleanup);
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
it('contains a synchronous Electron check failure without exposing its details', async () => {
  mocks.check.mockImplementationOnce(() => { throw new Error('Authorization: Bearer LEAK_SECRET_SYNC'); });
  stop = startUpdater({} as never, { assessRestartSafety: assess } as never, logger, cleanup);
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
