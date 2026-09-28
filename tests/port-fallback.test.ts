import { afterEach, expect, it, vi } from 'vitest';
import { Server } from 'node:net';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startDashboardServer, type DashboardServerHandle } from '../apps/server/src/index.js';
import { startDesktopRuntime, type DesktopRuntime } from '../apps/desktop/src/lifecycle.js';

const desktop = vi.hoisted(() => ({ userData: '' }));
vi.mock('electron', () => ({ app: { getPath: () => desktop.userData, getAppPath: () => process.cwd(), getVersion: () => '1.1.0' } }));
vi.mock('../apps/desktop/src/secrets.js', async () => {
  const { MemorySecretStore } = await import('../apps/server/src/storage.js');
  return { ElectronSecretStore: MemorySecretStore };
});

let directory = '';
let dashboard: DashboardServerHandle | undefined;
let runtime: DesktopRuntime | undefined;
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const realListen = Server.prototype.listen;
function failListen(code: string, everyPort = false) {
  const error = Object.assign(new Error(`listen ${code}: permission denied 0.0.0.0:47832`), { code });
  const spy = vi.spyOn(Server.prototype, 'listen').mockImplementation(function (this: Server, ...args: Parameters<typeof realListen>) {
    if (everyPort || Number(args[0]) !== 0) { process.nextTick(() => this.emit('error', error)); return this; }
    return realListen.apply(this, args);
  });
  return { error, spy };
}
afterEach(async () => {
  await runtime?.stop();
  await dashboard?.stop();
  runtime = undefined; dashboard = undefined;
  vi.restoreAllMocks(); vi.clearAllMocks();
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function options(port = 47832) {
  directory = await mkdtemp(path.resolve('.port-fallback-'));
  return { port, host: '0.0.0.0', remoteEnabled: true, dataDir: directory, logger };
}

it.each(['EACCES', 'EADDRINUSE'])('falls back on %s and reports the actual LAN port', async code => {
  const config = await options();
  const { spy } = failListen(code);
  dashboard = await startDashboardServer(config);
  expect(spy.mock.calls.map(args => args.slice(0, 2))).toEqual([[47832, '0.0.0.0'], [0, '0.0.0.0']]);
  expect(dashboard.port).toBeGreaterThan(0);
  expect(dashboard.server.address()).toMatchObject({ address: '0.0.0.0', port: dashboard.port });
  expect(dashboard.url).toBe(`http://127.0.0.1:${dashboard.port}`);
  expect(dashboard.state().runtime.port).toBe(dashboard.port);
  const info = await fetch(`${dashboard.url}/api/v1/remote/info`).then(r => r.json());
  expect(info.urls.length).toBeGreaterThan(0);
  for (const url of info.urls) expect(new URL(url).port).toBe(String(dashboard.port));
  expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(`listen ${code} on 0.0.0.0:47832`));
  expect(dashboard.server.listeners('listening').some(listener => listener.name === 'onListening')).toBe(false);
});

it('keeps unexpected listen errors fatal without retry', async () => {
  const config = await options();
  const { error, spy } = failListen('EIO');
  await expect(startDashboardServer(config)).rejects.toBe(error);
  expect(spy).toHaveBeenCalledTimes(1);
  expect(logger.warn).not.toHaveBeenCalled();
});
it.each([47832, 0])('does not retry indefinitely when port 0 also fails (requested %s)', async port => {
  const config = await options(port);
  const { error, spy } = failListen('EACCES', true);
  await expect(startDashboardServer(config)).rejects.toBe(error);
  expect(spy).toHaveBeenCalledTimes(port ? 2 : 1);
});

it('starts Desktop after EACCES and preserves pairing and credentials across fallback restarts', async () => {
  await options(); desktop.userData = directory;
  await mkdir(path.join(directory, 'config'));
  await writeFile(path.join(directory, 'config', 'dashboard.json'), JSON.stringify({ settings: { remoteEnabled: true } }));
  failListen('EACCES');
  runtime = await startDesktopRuntime();
  const pairing = await fetch(`${runtime.dashboard.url}/api/v1/remote/pairing`, { method: 'POST' }).then(r => r.json());
  for (const url of pairing.urls) expect(new URL(url).port).toBe(String(runtime.dashboard.port));
  await runtime.stop(); runtime = await startDesktopRuntime();
  const response = await fetch(`${runtime.dashboard.url}/api/v1/remote/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(pairing) });
  expect(response.status).toBe(201);
  const device = await response.json();
  await runtime.stop(); runtime = await startDesktopRuntime();
  const ticket = await fetch(`${runtime.dashboard.url}/api/v1/remote/ws-ticket`, { method: 'POST', headers: { authorization: `Device ${device.credential}` } });
  expect(ticket.status).toBe(201);
  expect(await ticket.json()).toHaveProperty('ticket');
  expect(runtime.dashboard.state().runtime.port).toBe(runtime.dashboard.port);
});
