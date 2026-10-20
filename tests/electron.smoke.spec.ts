import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import packageJson from '../package.json' with { type: 'json' };

const packagedExecutable = process.env.STREAMDASHBOARD_PACKAGED_EXE;
const RUNTIME_ORIGIN = 'http://127.0.0.1:48133';

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

async function expectRuntimeReady(page: Page) {
  await expect(page).toHaveURL(RUNTIME_ORIGIN + '/mobile/control/', { timeout: 30_000 });
  await expect(page.locator('#connection')).toContainText('Régie connectée');
  await expect(page.locator('#content')).not.toBeEmpty();
}

test('Electron réel démarre, persiste, impose une instance et arrête son backend', async () => {
  test.setTimeout(180_000);
  const profile = await mkdtemp(path.join(os.tmpdir(), 'streamdashboard-electron-'));
  let application: ElectronApplication | undefined;
  try {
    await expectEndpointClosed(RUNTIME_ORIGIN);
    application = await launch(profile);
    const window = await application.firstWindow();
    await expect(window).toHaveTitle(/StreamDashboard/);
    await expectRuntimeReady(window);

    // A new profile uses the same welcome form and controller shell as the
    // installed application. Keep its current host role, without a restart.
    await expect(window.locator('#device-setup-form')).toBeVisible();
    await window.locator('#device-setup-form [name="name"]').fill('PC du test Electron');
    await window.locator('#device-setup-form [name="role"]').selectOption('stream');
    await window.locator('#device-setup-form').getByRole('button', { name: 'Enregistrer et continuer' }).click();
    await expect(window.locator('#dialog')).not.toBeVisible();
    await expect(window.locator('#role')).toContainText('PC du test Electron');

    for (const [route, title] of [
      ['live', null], ['deck', 'Mon Deck'], ['planning', 'Planning & événements'],
      ['settings', 'Configuration'], ['sounds', 'Soundboard'], ['activity', 'Activité'], ['manage', 'Gestion'],
    ] as const) {
      await window.locator(`nav [data-page="${route}"]`).click();
      await expect(window.locator('#content')).toHaveAttribute('data-rendered-page', route);
      await expect(window.locator(`nav [data-page="${route}"]`)).toHaveClass(/active/);
      if (title) await expect(window.getByRole('heading', { name: title, exact: true })).toBeVisible();
      else await expect(window.locator('#live-overview h1')).toBeVisible();
      await expect(window.locator('#content')).not.toBeEmpty();
    }
    await window.locator('#content [data-page="actions"]').click();
    await expect(window.getByRole('heading', { name: 'Boutons & macros', exact: true })).toBeVisible();
    await window.locator('nav [data-page="settings"]').click();
    for (const [tab, selector] of [
      ['obs', '#settings-form'], ['platforms', '#platform-form'], ['profile', '#profile-settings'],
      ['integrations', '[data-task="streamlabs"]'], ['devices', '#shortcut-status'],
    ] as const) {
      await window.locator(`[data-tab="${tab}"]`).click();
      await expect(window.locator(selector)).toBeAttached();
      await expect(window.locator('.config-panel')).not.toBeEmpty();
    }
    await window.locator('nav [data-page="live"]').click();
    const electronVersion = await application.evaluate(() => process.versions.electron);
    expect(electronVersion).toBe(packageJson.devDependencies.electron);

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
      for (let attempt = 0; attempt < 20; attempt++) {
      await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].minimize(); });
      const second = spawn(path.resolve(packagedExecutable), process.platform === 'linux' ? ['--no-sandbox'] : [], { env: { ...process.env, NODE_ENV: 'test', APPDATA: profile, XDG_CONFIG_HOME: profile }, stdio: 'ignore', windowsHide: true });
      const code = await new Promise<number | null>((resolve, reject) => {
        const timeout = setTimeout(() => { second.kill(); reject(new Error('La seconde instance ne s’est pas arrêtée.')); }, 8_000);
        second.once('error', reject);
        second.once('exit', value => { clearTimeout(timeout); resolve(value); });
      });
      expect(code).toBe(0);
      await expect.poll(() => application!.evaluate(({ BrowserWindow }) => {
        const main = BrowserWindow.getAllWindows()[0];
        return { count: BrowserWindow.getAllWindows().length, visible: main.isVisible(), minimized: main.isMinimized(), focused: main.isFocused() };
      })).toEqual({ count: 1, visible: true, minimized: false, focused: true });
      }
    }

    const origin = await window.evaluate(() => location.origin);
    expect(application.process().pid).toBeGreaterThan(0);
    await application.close(); application = undefined;
    await expectEndpointClosed(origin);

    application = await launch(profile);
    const reloaded = await application.firstWindow();
    await expectRuntimeReady(reloaded);
    await expect(reloaded.locator('#device-setup-form')).toHaveCount(0);
    await expect(reloaded.locator('#role')).toContainText('PC du test Electron');
    await expect(reloaded.locator('.brand small')).toHaveText(marker);
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


test('20 démarrages réels, fermeture précoce et libération du port', async () => {
  test.setTimeout(180_000);
  const profile = await mkdtemp(path.join(os.tmpdir(), 'streamdashboard-launch-stress-'));
  let application: ElectronApplication | undefined;
  try {
    await expectEndpointClosed(RUNTIME_ORIGIN);
    for (let attempt = 0; attempt < 20; attempt++) {
      application = await launch(profile);
      const page = await application.firstWindow();
      const logs = await application.evaluate(({ app, BrowserWindow }) => {
        const main = BrowserWindow.getAllWindows()[0];
        if (!main.isVisible()) throw new Error('Startup window is hidden');
        return app.getPath('userData');
      });
      // Alternate a fully loaded launch and a close as soon as a window exists.
      // Deferred unit tests cover the precise startup/stop interleaving.
      if (attempt % 2 === 0) await expectRuntimeReady(page);
      await application.close(); application = undefined;
      await expectEndpointClosed(RUNTIME_ORIGIN);
      const lines = (await readFile(path.join(logs, 'logs', 'streamdashboard.log'), 'utf8')).trim().split('\n');
      expect(lines.at(-1)).toContain('Shutdown complete');
    }
  } finally {
    if (application) await application.close().catch(() => undefined);
    await rm(profile, { recursive: true, force: true });
  }
});
