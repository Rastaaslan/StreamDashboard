import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { startDashboardServer } from '../dist/apps/server/src/index.js';

for (const lifecycle of ['same-session', 'reopen-during-read', 'reopen-during-setup']) {
  test(`OBS dialog ignores stale responses: ${lifecycle}`, async () => {
    const folder = await mkdtemp(join(tmpdir(), 'obs-dialog-ordering-'));
    let server, browser;
    try {
      server = await startDashboardServer({ port: 0, dataDir: folder, logger: { info() {}, warn() {}, error() {} } });
      browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
      const page = await browser.newPage();
      const errors = [], reads = [], writes = [];
      let captureReads = false;
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/v1/soundboard/obs/status', route => { if (captureReads) reads.push(route); else return route.fulfill({ json: status(false) }); });
      await page.route('**/api/v1/soundboard/obs/setup', route => { writes.push(route); });
      const status = ready => ({ ready, inputExists: ready, inputName: 'Test source', targetScenes: ['Gameplay'], attachedScenes: ready ? ['Gameplay'] : [], missingScenes: [], wrongInputKind: false });
      const release = async (route, ready) => {
        const received = page.waitForResponse(response => response.request().url() === route.request().url());
        await route.fulfill({ json: status(ready) });
        await (await received).finished();
        // Let the renderer consume the response before asserting absence of a stale write.
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      };
      await page.goto(server.url + '/preview/?runtime=1');
      await expect(page.locator('#runtime-status')).toHaveText('Runtime PC');
      await page.locator('[data-view=sounds]').click();
      await page.locator('.soundboard-advanced summary').click();
      captureReads = true;
      const open = async count => {
        await page.locator('[data-obs-setup]').click();
        await expect(page.locator('#obs-setup-dialog')).toBeVisible();
        await expect.poll(() => reads.length).toBe(count);
      };
      const submit = page.locator('#obs-setup-form [type=submit]');
      const host = page.locator('#obs-setup-status');
      await open(1);
      if (lifecycle === 'reopen-during-setup') {
        await submit.click();
        await expect.poll(() => writes.length).toBe(1);
      }
      if (lifecycle !== 'same-session') {
        await page.keyboard.press('Escape');
        await expect(page.locator('#obs-setup-dialog')).not.toBeVisible();
        await open(2);
      }
      await submit.click();
      const expectedWrites = lifecycle === 'reopen-during-setup' ? 2 : 1;
      await expect.poll(() => writes.length).toBe(expectedWrites);
      if (lifecycle === 'reopen-during-setup') {
        await release(writes[0], false);
        await expect(host).toHaveText('Vérification OBS…');
        // Finishing an old operation must not release the new session's lock.
        await submit.dblclick();
        assert.equal(writes.length, expectedWrites);
      }
      await release(writes.at(-1), true);
      await expect(host.locator('b')).toHaveText('Prêt');
      await expect(page.locator('#toast')).toHaveText('Soundboard OBS prête');
      for (const read of reads) {
        await release(read, false);
        await expect(host.locator('b')).toHaveText('Prêt');
        assert.equal(await page.evaluate(() => window.__preview.state.obsSetup.ready), true);
      }
      assert.equal(writes.length, expectedWrites);
      await page.keyboard.press('Escape');
      await expect(page.locator('dialog[open]')).toHaveCount(0);
      await page.locator('[data-view=planning]').click();
      assert.deepEqual(errors, []);
    } finally { await browser?.close(); await server?.stop(); await rm(folder, { recursive: true, force: true }); }
  });
}
