import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const packagedExecutable = process.env.STREAMDASHBOARD_PACKAGED_EXE;

async function launch(profile: string): Promise<ElectronApplication> {
  const env = { ...process.env, NODE_ENV: 'test', APPDATA: profile, XDG_CONFIG_HOME: profile };
  return electron.launch(packagedExecutable
    ? { executablePath: path.resolve(packagedExecutable), args: [], env }
    : { args: [path.resolve('.')], env });
}

async function expectEndpointClosed(origin: string) {
  await expect.poll(async () => {
    try { await fetch(`${origin}/api/v1/health`, { signal: AbortSignal.timeout(300) }); return false; }
    catch { return true; }
  }, { timeout: 5_000 }).toBe(true);
}

test('Electron réel démarre, persiste, impose une instance et arrête son backend', async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'streamdashboard-electron-'));
  let application: ElectronApplication | undefined;
  try {
    application = await launch(profile);
    const window = await application.firstWindow();
    await expect(window).toHaveTitle(/StreamDashboard/);
    await expect(window.locator('h1')).toContainText('Vue d’ensemble');

    const health = await window.evaluate(() => fetch('/api/v1/health').then(response => response.json()));
    expect(health).toMatchObject({ ok: true, protocolVersion: 1 });
    for (const route of ['/api/v1/state', '/api/v1/capabilities', '/api/v1/diagnostics']) {
      const response = await window.evaluate(route => fetch(route).then(async result => ({ ok: result.ok, body: await result.json() })), route);
      expect(response.ok).toBe(true); expect(response.body).toBeTruthy();
    }

    const desktopBridge = await window.evaluate(async () => {
      const bridge = (window as typeof window & { streamDashboardDesktop?: { getVersion(): Promise<string> } }).streamDashboardDesktop;
      if (!bridge) return { available: false, version: '' };
      return { available: true, version: await bridge.getVersion() };
    });
    expect(desktopBridge.available).toBe(true);
    expect(desktopBridge.version).toMatch(/^\d+\.\d+\.\d+/);

    const before = await window.evaluate(() => fetch('/api/v1/state').then(response => response.json()));
    expect(before.runtime.logsPath).toBeTruthy();
    await access(before.runtime.logsPath);
    const marker = `Smoke-${Date.now()}`;
    const saved = await window.evaluate(marker => fetch('/api/v1/settings', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ streamerName: marker }),
    }).then(response => response.json()), marker);
    expect(saved.settings.streamerName).toBe(marker);

    if (packagedExecutable) {
      const second = spawn(path.resolve(packagedExecutable), [], { env: { ...process.env, NODE_ENV: 'test', APPDATA: profile, XDG_CONFIG_HOME: profile }, stdio: 'ignore', windowsHide: true });
      const code = await new Promise<number | null>((resolve, reject) => {
        const timeout = setTimeout(() => { second.kill(); reject(new Error('La seconde instance ne s’est pas arrêtée.')); }, 8_000);
        second.once('error', reject);
        second.once('exit', value => { clearTimeout(timeout); resolve(value); });
      });
      expect(code).toBe(0);
      await expect(window.locator('h1')).toBeVisible();
    }

    const origin = await window.evaluate(() => location.origin);
    expect(application.process().pid).toBeGreaterThan(0);
    await application.close(); application = undefined;
    await expectEndpointClosed(origin);

    application = await launch(profile);
    const reloaded = await application.firstWindow();
    const after = await reloaded.evaluate(() => fetch('/api/v1/state').then(response => response.json()));
    expect(after.settings.streamerName).toBe(marker);
    const secondOrigin = await reloaded.evaluate(() => location.origin);
    await application.close(); application = undefined;
    await expectEndpointClosed(secondOrigin);
  } finally {
    if (application) await application.close().catch(() => undefined);
    await rm(profile, { recursive: true, force: true });
  }
});
