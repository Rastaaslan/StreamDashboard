import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('le bootstrap mobile réel reste navigable lorsque REST est indisponible', async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'streamdashboard-mobile-bootstrap-'));
  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({
      args: [path.resolve('.')],
      env: { ...process.env, NODE_ENV: 'test', APPDATA: profile, XDG_CONFIG_HOME: profile },
    });
    const page = await application.firstWindow();
    const origin = await page.evaluate(() => location.origin);
    const runtimeErrors: string[] = [];
    page.on('pageerror', error => runtimeErrors.push(error.stack || error.message));

    await page.addInitScript(() => {
      const original = EventTarget.prototype.addEventListener;
      const counts = new Map<string, number>();
      EventTarget.prototype.addEventListener = function (type, listener, options) {
        if (this instanceof HTMLElement && this.id) {
          const key = `${this.id}:${type}`;
          counts.set(key, (counts.get(key) || 0) + 1);
        }
        return original.call(this, type, listener, options);
      };
      Object.defineProperty(window, '__listenerCounts', { value: counts });
    });
    await page.goto(`${origin}/mobile/`);
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('streamdashboard.device', 'unreachable-test-device');
    });
    await page.route('**/api/v1/**', route => route.abort('connectionrefused'));
    await page.reload();

    await expect(page.locator('#checklist')).toContainText('Checklist vide');
    await expect(page.locator('#templates')).toContainText('Aucun template');
    await expect(page.locator('#connection')).not.toHaveText('Connexion au PC…');
    expect(runtimeErrors).toEqual([]);
    expect(await page.evaluate(() => {
      const counts = (window as unknown as { __listenerCounts: Map<string, number> }).__listenerCounts;
      return counts.get('menu-trigger:click');
    })).toBe(1);

    const activeView = () => page.locator('[data-view].active').getAttribute('data-view');
    await page.locator('#menu-trigger').click();
    await expect.poll(activeView).toBe('more');

    for (const section of ['Checklist', 'Notes', 'Templates']) {
      await page.getByRole('button', { name: new RegExp(`^${section}`) }).click();
      await expect.poll(activeView).toBe('prepare');
      await expect(page.locator(`[data-prepare-panel="${section.toLowerCase()}"]`)).toBeVisible();
      await page.locator('#menu-trigger').click();
    }

    await page.getByRole('button', { name: /^Réglages/ }).click();
    await expect.poll(activeView).toBe('settings');
    await expect(page.locator('#ui-preferences')).toBeVisible();
    await page.locator('#menu-trigger').click();

    await page.getByRole('button', { name: /^Diagnostics/ }).click();
    await expect.poll(activeView).toBe('settings');
    await expect(page.locator('#diagnostics')).toHaveJSProperty('open', true);
    await page.locator('#menu-trigger').click();

    await page.getByRole('button', { name: 'Fermer le menu' }).click();
    await expect.poll(activeView).toBe('home');
    expect(runtimeErrors).toEqual([]);
  } finally {
    if (application) await application.close().catch(() => undefined);
    await rm(profile, { recursive: true, force: true });
  }
});
