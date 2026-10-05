import { expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Server } from 'node:net';
import { startDashboardServer, type DashboardServerHandle } from '../apps/server/src/index.js';
import { MemorySecretStore } from '../apps/server/src/storage.js';

it('returns before provider startup and stops stalled work before releasing the acquired port', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'startup-cancel-'));
  const controller = new AbortController();
  const secretStore = new MemorySecretStore();
  await secretStore.setGoogleTokens({ accessToken: 'test', refreshToken: 'test', expiresAt: String(Date.now() + 3600_000) });
  let requested!: () => void;
  const requestStarted = new Promise<void>(resolve => { requested = resolve; });
  const googleFetch: typeof fetch = (_input, init) => new Promise((_resolve, reject) => {
    init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
    requested();
  });
  let port = 0;
  const listen = Server.prototype.listen;
  const spy = vi.spyOn(Server.prototype, 'listen').mockImplementation(function (this: Server, ...args: Parameters<typeof listen>) {
    this.once('listening', () => { port = (this.address() as { port: number }).port; });
    return listen.apply(this, args);
  });
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  let restarted: DashboardServerHandle | undefined;
  const starting = startDashboardServer({ dataDir: directory, port: 0, googleClientId: 'test', secretStore, googleFetch, startupSignal: controller.signal, logger });
  const reason = new Error('User closed startup window');
  const running = await starting;
  try {
    await requestStarted;
    expect(port).toBeGreaterThan(0);
    controller.abort(reason);
    await running.stop();
    await running.providersReady;
    // stop() is the cleanup boundary after deferred acquisition, no polling/delay.
    expect(JSON.parse(await readFile(path.join(directory, 'dashboard.json'), 'utf8'))).toHaveProperty('settings');
    spy.mockRestore();
    restarted = await startDashboardServer({ dataDir: directory, port, logger });
    expect(restarted.port).toBe(port);
  } finally {
    controller.abort(reason);
    await running.stop();
    await restarted?.stop();
    spy.mockRestore();
    await rm(directory, { recursive: true, force: true });
  }
});

it('defers Streamlabs OAuth recovery and cancels its network request on stop', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'startup-streamlabs-'));
  const secretStore = new MemorySecretStore();
  await secretStore.setStreamlabsOAuth({ clientId: 'test', clientSecret: 'test', accessToken: 'test' });
  let requested!: () => void;
  const requestStarted = new Promise<void>(resolve => { requested = resolve; });
  let cancelled = false;
  const streamlabsFetch: typeof fetch = (_input, init) => new Promise((_resolve, reject) => {
    init!.signal!.addEventListener('abort', () => { cancelled = true; reject(init!.signal!.reason); }, { once: true });
    requested();
  });
  const server = await startDashboardServer({ dataDir: directory, port: 0, secretStore, streamlabsFetch,
    logger: { info() {}, warn() {}, error() {} } });
  try {
    await requestStarted;
    expect((await fetch(server.url + '/')).ok).toBe(true);
    await server.stop();
    await server.providersReady;
    expect(cancelled).toBe(true);
    expect((await secretStore.getStreamlabsOAuth())?.accessToken).toBe('test');
  } finally { await server.stop(); await rm(directory, { recursive: true, force: true }); }
});
