import { test, expect, type Page } from '@playwright/test';
import express from 'express';
import { type Server } from 'node:http';
import path from 'node:path';
import { createMobileFixture } from '../apps/mobile/dev-fixtures.js';

let server: Server;
let origin: string;
test.beforeAll(async () => {
  const app = express();
  app.use('/mobile', express.static(path.resolve('apps/mobile')));
  server = await new Promise<Server>(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

async function setup(page: Page, obs = { connected: true, streamingKnown: true }, holdSocket = false) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const backend = { state: { ...createMobileFixture('live').state, serverInstanceId: 'desktop-first', stateRevision: 100 }, unavailable: false, status: 200, ticketStatus: 201, stateCalls: 0, calls: [] as { url: string; auth: string | undefined }[] };
  Object.assign(backend.state.obs, { ...obs, connectionStatus: obs.connected ? 'connected' : 'offline' });
  await page.clock.install();
  await page.addInitScript(holdSocket => {
    const win = window as any;
    if (!localStorage.getItem('test-initialized')) {
      localStorage.setItem('test-initialized', 'yes');
      localStorage.setItem('native-credential', 'persistent-device-credential');
      localStorage.setItem('streamdashboard.server', 'http://192.168.1.10:47832');
    }
    win.StreamDashboardNative = {
      isAndroid: () => true,
      getCredential: () => localStorage.getItem('native-credential'),
      setCredential: (value: string) => localStorage.setItem('native-credential', value),
      clearCredential: () => localStorage.removeItem('native-credential'),
    };
    win.sockets = [];
    win.WebSocket = class {
      readyState = 0;
      onopen: any; onmessage: any; onclose: any; onerror: any;
      constructor(public url: string) {
        win.sockets.push(this);
        queueMicrotask(() => { if (!holdSocket && this.readyState !== 3) { this.readyState = 1; this.onopen?.(); } });
      }
      close() { this.readyState = 3; this.onclose?.(); }
    };
  }, holdSocket);
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    backend.calls.push({ url: request.url(), auth: request.headers().authorization });
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith('/state')) {
      backend.stateCalls++;
      if (backend.unavailable) { await route.abort(); return; }
      await route.fulfill({ status: backend.status, json: backend.status === 200 ? backend.state : { error: { message: 'Non autorisé' } } });
    } else if (pathname.endsWith('/ws-ticket')) {
      await route.fulfill({ status: backend.ticketStatus, json: { ticket: 'single-use-ticket' } });
    } else if (pathname.endsWith('/capabilities')) {
      await route.fulfill({ json: { serverVersion: 'test', features: [] } });
    } else { await route.fulfill({ json: {} }); }
  });
  await page.goto(`${origin}/mobile/index.html`);
  await expect(page.locator('#pc')).toHaveText('Connecté');
  await expect.poll(() => page.evaluate(() => (window as any).sockets.length)).toBe(1);
  return { backend, errors };
}
const nativeCredential = (page: Page) => page.evaluate(() => localStorage.getItem('native-credential'));

test('shipped Android address recovery uses no pairing code and persists the existing credential', async ({ page }) => {
  const { backend, errors } = await setup(page);
  await page.locator('[data-tab="more"]').click();
  // Use the shipped connection navigation, not preview.html or an internal function.
  await page.getByRole('button', { name: 'Comptes connectés' }).click();
  await expect(page.getByRole('button', { name: 'Oublier cette télécommande' })).toBeVisible();
  await page.getByRole('button', { name: 'Modifier l’adresse du PC' }).click();
  await page.locator('#pair-server').fill('192.168.2.20:47832');
  // A heartbeat/telemetry update must leave the recovery form and typed address intact.
  await page.clock.fastForward(10_000);
  await expect(page.locator('#pair-server')).toHaveValue('192.168.2.20:47832');
  await expect(page.locator('#pair-id')).toHaveValue('');
  await expect(page.locator('#pair-code')).toHaveValue('');
  await page.getByRole('button', { name: 'Reconnexion à cette adresse' }).click();
  await expect(page.locator('#pc')).toHaveText('Connecté');
  await expect.poll(() => backend.calls.some(call => call.url === 'http://192.168.2.20:47832/api/v1/state' && call.auth === 'Device persistent-device-credential')).toBe(true);
  expect(backend.calls.some(call => call.url.endsWith('/remote/pair'))).toBe(false);
  expect(await nativeCredential(page)).toBe('persistent-device-credential');
  await page.reload();
  await expect(page.locator('#pc')).toHaveText('Connecté');
  expect(await page.evaluate(() => localStorage.getItem('streamdashboard.server'))).toBe('http://192.168.2.20:47832');
  expect(await nativeCredential(page)).toBe('persistent-device-credential');
  expect(errors).toEqual([]);
});

test('silent network loss is detected by HTTP and automatically recovers after Desktop restart', async ({ page }) => {
  const { backend, errors } = await setup(page);
  backend.unavailable = true;
  await page.clock.fastForward(10_000);
  await expect(page.locator('#pc')).toHaveText('Hors ligne');
  await expect(page.locator('#obs')).toHaveText('Déconnecté');
  await expect(page.locator('#stream')).toBeDisabled();
  expect(await nativeCredential(page)).toBe('persistent-device-credential');
  expect(await page.evaluate(() => (window as any).sockets[0].readyState)).toBe(3);
  backend.unavailable = false;
  backend.state = { ...backend.state, serverInstanceId: 'desktop-restarted', stateRevision: 0, obs: { ...backend.state.obs, connected: true, streaming: false } };
  await page.clock.fastForward(1000);
  await expect(page.locator('#pc')).toHaveText('Connecté');
  await expect(page.locator('#obs')).toHaveText('Connecté');
  await expect(page.locator('#stream')).toHaveText('DÉMARRER LE LIVE');
  expect(await nativeCredential(page)).toBe('persistent-device-credential');
  expect(errors).toEqual([]);
});

test('concurrent reconnect events close old sockets and ignore delayed responses and callbacks', async ({ page }) => {
  const { backend, errors } = await setup(page);
  await page.evaluate(() => { const w = window as any; const old = w.sockets[0]; w.stale = { message: old.onmessage, close: old.onclose, error: old.onerror }; });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let held = false;
  await page.route('**/api/v1/state', async route => {
    if (!held) { held = true; await gate; await route.fulfill({ status: 401, json: {} }); }
    else await route.fulfill({ json: backend.state });
  });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => held).toBe(true);
  await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('online')); });
  await expect.poll(() => page.evaluate(() => (window as any).sockets.length)).toBe(2);
  release();
  await page.evaluate(() => {
    const w = window as any;
    w.stale.message({ data: JSON.stringify({ type: 'state.updated', data: { obs: { connected: false } } }) });
    w.stale.close(); w.stale.error();
  });
  await page.clock.fastForward(1000);
  await expect(page.locator('#pc')).toHaveText('Connecté');
  expect(await nativeCredential(page)).toBe('persistent-device-credential');
  expect(await page.evaluate(() => (window as any).sockets.filter((socket: any) => socket.readyState === 1).length)).toBe(1);
  expect(errors).toEqual([]);
});

test('HTTP fallback stays usable, 403 preserves credentials, and revocation clears native storage', async ({ page }) => {
  const { backend, errors } = await setup(page);
  backend.ticketStatus = 503;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('#connection')).toContainText('temps réel indisponible');
  await expect(page.locator('#stream')).toBeEnabled();
  backend.status = 403;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('#pc')).toHaveText('Hors ligne');
  expect(await nativeCredential(page)).toBe('persistent-device-credential');
  backend.status = 401;
  await page.clock.fastForward(2000);
  await expect(page.locator('#pairing')).toBeVisible();
  await expect.poll(() => nativeCredential(page)).toBeNull();
  const calls = backend.stateCalls;
  await page.clock.fastForward(30_000);
  expect(backend.stateCalls).toBe(calls);
  expect(errors).toEqual([]);
});

for (const restart of ['online event', 'HTTP heartbeat']) {
  test(`late command response cannot restore the old Desktop state after ${restart}`, async ({ page }) => {
    const { backend, errors } = await setup(page);
    const oldState = structuredClone(backend.state);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let commandHeld = false;
    let responseSent = false;
    await page.route('**/api/v1/commands', async route => {
      commandHeld = true;
      await gate;
      await route.fulfill({ json: { state: oldState } });
      responseSent = true;
    });
    page.on('dialog', dialog => dialog.accept());
    await page.locator('#stream').click();
    await expect.poll(() => commandHeld).toBe(true);
    backend.state = { ...backend.state, serverInstanceId: 'new-desktop', stateRevision: 0, obs: { ...backend.state.obs, streaming: false } };
    if (restart === 'online event') await page.evaluate(() => window.dispatchEvent(new Event('online')));
    else await page.clock.fastForward(10_000);
    await expect(page.locator('#stream')).toHaveText('DÉMARRER LE LIVE');
    await expect(page.locator('#pc')).toHaveText('Connecté');
    release();
    await expect.poll(() => responseSent).toBe(true);
    // Drain the released fetch and its UI continuations before checking state.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.locator('#stream')).toHaveText('DÉMARRER LE LIVE');
    await expect(page.locator('#stream')).toBeEnabled();
    await expect(page.locator('#obs')).toHaveText('Connecté');
    expect(await nativeCredential(page)).toBe('persistent-device-credential');
    expect(errors).toEqual([]);
  });
}

for (const connected of [false, true]) {
  test(`stream guards survive HTTP, WebSocket and heartbeat with OBS connected=${connected} but unknown`, async ({ page }) => {
    const { backend, errors } = await setup(page, { connected, streamingKnown: false }, true);
    const guarded = async (disabled: boolean) => {
      for (const id of ['stream', 'live-stream']) {
        if (disabled) await expect(page.locator('#' + id)).toBeDisabled();
        else await expect(page.locator('#' + id)).toBeEnabled();
      }
    };
    // The real HTTP bootstrap has rendered and applied connection-mode guards.
    await guarded(true);
    await page.evaluate(() => { const socket = (window as any).sockets[0]; socket.readyState = 1; socket.onopen(); });
    await guarded(true);
    await page.evaluate(() => {
      const win = window as any;
      win.renderCount = 0;
      window.addEventListener('mobile-state-updated', () => { win.renderCount++; });
    });
    const calls = backend.stateCalls;
    await page.clock.fastForward(10_000);
    await expect.poll(() => backend.stateCalls).toBeGreaterThan(calls);
    await expect.poll(() => page.evaluate(() => (window as any).renderCount)).toBeGreaterThan(0);
    await guarded(true);
    Object.assign(backend.state.obs, { connected: true, streamingKnown: true, streaming: false });
    await page.clock.fastForward(10_000);
    await guarded(false);
    // Telemetry loss must close both controls again even while the PC stays online.
    Object.assign(backend.state.obs, { streamingKnown: false });
    await page.evaluate(state => (window as any).sockets[0].onmessage({ data: JSON.stringify({ type: 'state.updated', data: state }) }), backend.state);
    await guarded(true);
    // Confirmed cached OBS state cannot override an unavailable PC channel.
    Object.assign(backend.state.obs, { streamingKnown: true });
    await page.clock.fastForward(10_000);
    await guarded(false);
    backend.unavailable = true;
    await page.clock.fastForward(10_000);
    await expect(page.locator('#pc')).toHaveText('Hors ligne');
    await guarded(true);
    expect(backend.calls.filter(call => call.url.endsWith('/commands'))).toEqual([]);
    expect(errors).toEqual([]);
  });
}
