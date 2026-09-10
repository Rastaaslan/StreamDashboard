import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';

test('Electron démarre le backend, expose le pont Desktop, affiche le cockpit et l’arrête', async () => {
  const packagedExecutable = process.env.STREAMDASHBOARD_PACKAGED_EXE;
  const application = await electron.launch(packagedExecutable
    ? { executablePath: path.resolve(packagedExecutable), args: [], env: { ...process.env, NODE_ENV: 'test' } }
    : { args: [path.resolve('.')], env: { ...process.env, NODE_ENV: 'test' } });
  const window = await application.firstWindow();
  await expect(window).toHaveTitle(/StreamDashboard/);
  await expect(window.locator('h1')).toContainText('Vue d’ensemble');
  const health = await window.evaluate(() => fetch('/api/v1/health').then(response => response.json()));
  expect(health).toMatchObject({ ok: true, protocolVersion: 1 });
  for (const route of ['/api/v1/state', '/api/v1/capabilities']) {
    const response = await window.evaluate(route => fetch(route).then(async result => ({ ok: result.ok, body: await result.json() })), route);
    expect(response.ok).toBe(true); expect(response.body).toBeTruthy();
  }
  const desktopBridge = await window.evaluate(async () => {
    const bridge = (window as typeof window & { streamDashboardDesktop?: { getVersion(): Promise<string>; ensureObsRunning(): Promise<{ launched: boolean; detail: string }> } }).streamDashboardDesktop;
    if (!bridge) return { available: false, version: '' };
    return { available: true, version: await bridge.getVersion() };
  });
  expect(desktopBridge.available).toBe(true);
  expect(desktopBridge.version).toMatch(/^\d+\.\d+\.\d+/);
  const pid = application.process().pid;
  expect(pid).toBeGreaterThan(0);
  await application.close();
});
