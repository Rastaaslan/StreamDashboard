import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startUpdater } from '../apps/desktop/src/updater.js';

const mocks = vi.hoisted(() => ({ check: vi.fn(), quitAndInstall: vi.fn(), show: vi.fn(), feed: vi.fn() }));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    app: { isPackaged: true, getVersion: () => 'test-version' },
    autoUpdater: Object.assign(new EventEmitter(), { setFeedURL: mocks.feed, checkForUpdates: mocks.check, quitAndInstall: mocks.quitAndInstall }),
    dialog: { showMessageBox: mocks.show },
  };
});

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
const logger = { info: vi.fn(), error: vi.fn() };
const assess = vi.fn();
const beforeInstall = vi.fn();
let stop: (() => void) | undefined;
const drain = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };
async function downloaded() {
  const { autoUpdater } = await import('electron');
  stop = startUpdater({} as any, { assessRestartSafety: assess } as any, logger, beforeInstall);
  autoUpdater.emit('update-downloaded');
  await drain();
}
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); vi.stubEnv('NODE_ENV', 'production');
  Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' });
  assess.mockReset().mockResolvedValue({ safe: true });
  mocks.show.mockReset().mockResolvedValue({ response: 0 });
  beforeInstall.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  stop?.(); stop = undefined;
  Object.defineProperty(process, 'platform', platformDescriptor);
  vi.useRealTimers(); vi.unstubAllEnvs();
});

describe('desktop updater uses current restart safety around its confirmation dialog', () => {
  it.each(['Diffusion YouTube active.', 'État Aitum inconnu.', 'Enregistrement en cours.'])('does not offer installation when %s', async reason => {
    assess.mockResolvedValue({ safe: false, reason });
    await downloaded();
    expect(mocks.show).not.toHaveBeenCalled();
    expect(beforeInstall).not.toHaveBeenCalled();
    expect(mocks.quitAndInstall).not.toHaveBeenCalled();
  });

  it('does not install if a live starts while the confirmation dialog is open', async () => {
    let choose!: (value: { response: number }) => void;
    mocks.show.mockImplementation(() => new Promise(resolve => { choose = resolve; }));
    await downloaded();
    expect(mocks.show).toHaveBeenCalledTimes(1);
    assess.mockResolvedValue({ safe: false, reason: 'YouTube est maintenant en direct.' });
    choose({ response: 1 }); await drain();
    expect(assess).toHaveBeenCalledTimes(2);
    expect(beforeInstall).not.toHaveBeenCalled();
    expect(mocks.quitAndInstall).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('différée'), expect.any(Error));
  });

  it('does not act on a confirmation after this updater has been disposed', async () => {
    let choose!: (value: { response: number }) => void;
    mocks.show.mockImplementation(() => new Promise(resolve => { choose = resolve; }));
    await downloaded();
    stop!(); choose({ response: 1 }); await drain();
    expect(assess).toHaveBeenCalledTimes(1);
    expect(beforeInstall).not.toHaveBeenCalled();
    expect(mocks.quitAndInstall).not.toHaveBeenCalled();
  });

  it('does not open a delayed dialog after teardown and never overlaps slow checks', async () => {
    let confirm!: (value: { safe: boolean }) => void;
    assess.mockImplementation(() => new Promise(resolve => { confirm = resolve; }));
    await downloaded();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(assess).toHaveBeenCalledTimes(1);
    stop!(); confirm({ safe: true }); await drain();
    expect(mocks.show).not.toHaveBeenCalled();
    expect(mocks.quitAndInstall).not.toHaveBeenCalled();
  });

  it('performs its last check before teardown, then installs only after cleanup succeeds', async () => {
    mocks.show.mockResolvedValue({ response: 1 });
    beforeInstall.mockImplementation(async () => { expect(assess).toHaveBeenCalledTimes(2); stop!(); });
    await downloaded();
    expect(beforeInstall).toHaveBeenCalledTimes(1);
    expect(mocks.quitAndInstall).toHaveBeenCalledTimes(1);
    expect(beforeInstall.mock.invocationCallOrder[0]).toBeLessThan(mocks.quitAndInstall.mock.invocationCallOrder[0]);
  });

  it('keeps installation pending if cleanup fails', async () => {
    mocks.show.mockResolvedValue({ response: 1 });
    beforeInstall.mockRejectedValue(new Error('Cannot flush profile'));
    await downloaded();
    expect(mocks.quitAndInstall).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith('Préparation de la mise à jour impossible', expect.any(Error));
  });
});
