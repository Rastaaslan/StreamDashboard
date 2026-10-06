import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { startDashboardServer } from '../dist/apps/server/src/index.js';

for (const reopen of [false, true]) test(`series deletion: shared lock, pending retry and ${reopen ? 'new draft preservation' : 'managed close'}`, async () => {
  const folder = await mkdtemp(join(tmpdir(), 'cb133-dialog-'));
  let server, browser;
  try {
    server = await startDashboardServer({ port: 0, dataDir: folder, logger: { info() {}, warn() {}, error() {} } });
    const response = await fetch(server.url + '/api/v1/planning', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Series to delete', startAtUtc: new Date(Date.now()+86400000).toISOString(), endAtUtc: new Date(Date.now()+90000000).toISOString(), recurrence: { frequency: 'daily', interval: 1, timeZone: 'UTC' }, desiredPublication: { local: true, twitch: false, google: false } }),
    });
    assert.equal(response.ok, true);
    const { planning: [series] } = await response.json();
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    page.setDefaultTimeout(8000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    // Simulate the provider's pending response; core/HTTP CB-131 tests cover
    // durable provider ownership and recovery. All successful deletes go to the real server.
    // Keep the simulated provider state authoritative: real server telemetry
    // must not supersede this HTTP-only fixture with its unmodified snapshot.
    await page.routeWebSocket('**/ws/v1', () => {});
    let pending = false, heldDelete, heldRetry, deletes = 0, retries = 0;
    await page.route('**/api/v1/state', async route => {
      const response = await route.fetch(); const state = await response.json();
      if (pending) state.planning = state.planning.map(item => item.id === series.id ? {
        ...item, deletionPending: true, desiredPublication: { local: true, twitch: false, google: false },
        providers: { google: { status: 'error', lastError: 'Deletion offline', remoteId: 'owned-test', projectionOwned: true } },
      } : item);
      await route.fulfill({ json: state });
    });
    await page.route(`**/api/v1/planning/${series.id}`, route => {
      if (route.request().method() !== 'DELETE') return route.continue();
      deletes++; heldDelete = route;
    });
    await page.route(`**/api/v1/planning/${series.id}/retry/google`, route => { retries++; heldRetry = route; });
    await page.goto(server.url + '/preview/?runtime=1');
    await expect(page.locator('#runtime-status')).toHaveText('Runtime PC');
    await page.locator('[data-view=planning]').click();
    await page.locator('[data-event-index]').filter({ hasText: 'Series to delete' }).first().click();
    await page.locator('#event-scope').selectOption('series');
    await page.locator('#event-delete').dblclick();
    await expect.poll(() => deletes).toBe(1);
    assert.equal(heldDelete.request().postDataJSON().scope, 'series');
    pending = true;
    await heldDelete.fulfill({ status: 503, json: { error: { message: 'Suppression incomplète' } } });
    const retry = page.locator('[data-provider-retry=google]');
    await expect(retry).toBeVisible();
    await retry.dblclick();
    await expect.poll(() => retries).toBe(1);
    await heldRetry.fulfill({ status: 503, json: { error: { message: 'Retry offline' } } });
    await expect(page.locator('#toast')).toContainText('Retry offline');
    await retry.dblclick();
    await expect.poll(() => retries).toBe(2);
    const title = page.locator('#event-title');
    if (reopen) {
      await page.keyboard.press('Escape');
      await page.locator('[data-add-event]').first().click();
      await title.fill('New draft'); await title.focus();
      await title.evaluate(el => el.setSelectionRange(4, 4));
    }
    pending = false;
    const deleted = await fetch(server.url + `/api/v1/planning/${series.id}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope: 'series' }) });
    assert.equal(deleted.ok, true);
    await heldRetry.fulfill({ json: await deleted.json() });
    await expect(page.locator('#toast')).toContainText('Série supprimée');
    if (reopen) {
      await expect(page.locator('#event-dialog')).toBeVisible();
      await expect(title).toHaveValue('New draft'); await expect(title).toBeFocused();
      assert.deepEqual(await title.evaluate(el => [el.selectionStart, el.selectionEnd]), [4, 4]);
      await page.keyboard.press('Escape');
    }
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    assert.deepEqual(await page.evaluate(async () => (await import('/dialog-drafts.js')).dialogDiagnostics()), { openCount: 0, modalCount: 0, orphanModal: false, lostFocus: false, staleSession: false });
    assert.deepEqual((await (await fetch(server.url + '/api/v1/state')).json()).planning, []);
    const repeat = await fetch(server.url + `/api/v1/planning/${series.id}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope: 'series' }) });
    assert.equal(repeat.ok, true);
    assert.equal(deletes, 1); assert.equal(retries, 2); assert.deepEqual(errors, []);
  } finally { await browser?.close(); await server?.stop(); await rm(folder, { recursive: true, force: true }); }
});
