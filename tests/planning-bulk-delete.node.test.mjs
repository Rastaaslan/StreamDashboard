import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { startDashboardServer } from '../dist/apps/server/src/index.js';

test('Planning period deletion: preview, invalidation, cancel, explicit confirmation and protected series', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'bulk-delete-ui-'));
  let server, browser;
  try {
    server = await startDashboardServer({ port: 0, dataDir: folder, logger: { info() {}, warn() {}, error() {} } });
    const event = { id: 'inside', title: '<b>Live inside</b>', startAtUtc: '2030-10-01T18:00:00Z', endAtUtc: '2030-10-01T20:00:00Z' };
    for (const item of [event, { ...event, id: 'outside', title: 'Outside', startAtUtc: '2030-10-03T18:00:00Z', endAtUtc: '2030-10-03T20:00:00Z' }, { ...event, id: 'series', title: 'Weekly', recurrence: { frequency: 'weekly', interval: 1, timeZone: 'Europe/Paris' } }]) {
      const response = await fetch(server.url + '/api/v1/planning', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(item) });
      assert.equal(response.ok, true, await response.text());
    }
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage({ timezoneId: 'Europe/Paris' });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    let confirmations = 0;
    page.on('request', req => { if (req.url().endsWith('/bulk-delete/confirm')) confirmations++; });
    await page.goto(server.url + '/preview/?runtime=1');
    await expect(page.locator('#runtime-status')).toHaveText('Runtime PC');
    await page.locator('[data-view="planning"]').click();
    await page.getByRole('button', { name: 'Supprimer une période', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Supprimer une période', exact: true });
    await dialog.locator('[name=start]').fill('2030-10-01T00:00');
    await dialog.locator('[name=end]').fill('2030-10-02T00:00');
    await expect(dialog.locator('[name=twitch]')).not.toBeChecked();
    await expect(dialog.locator('[name=google]')).not.toBeChecked();
    const remove = dialog.locator('[data-delete]');
    await expect(remove).toBeDisabled();
    await dialog.getByRole('button', { name: 'Afficher l’aperçu' }).click();
    await expect(dialog.locator('[data-preview]')).toContainText('1 événement(s)');
    await expect(dialog.locator('[data-preview]')).toContainText('Weekly');
    await expect(dialog.locator('[data-preview] b')).toHaveCount(0);
    await expect(remove).toBeDisabled();
    await dialog.locator('[name=confirm]').check();
    await expect(remove).toBeEnabled();
    await dialog.locator('[name=google]').check();
    await expect(remove).toBeDisabled();
    await expect(dialog.locator('[name=confirm]')).not.toBeChecked();
    await dialog.getByRole('button', { name: 'Fermer', exact: true }).click();
    assert.equal(confirmations, 0);
    assert.equal((await (await fetch(server.url + '/api/v1/state')).json()).planning.length, 3);
    await page.getByRole('button', { name: 'Supprimer une période', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Supprimer une période', exact: true });
    await dialog.locator('[name=start]').fill('2030-10-01T00:00');
    await dialog.locator('[name=end]').fill('2030-10-02T00:00');
    await dialog.getByRole('button', { name: 'Afficher l’aperçu' }).click();
    await expect(dialog.locator('[data-preview]')).toContainText('1 événement(s)');
    await dialog.locator('[name=confirm]').check();
    await page.route('**/api/v1/planning/bulk-delete/confirm', route => route.fulfill({ json: { deleted: [], failed: [{ title: 'Live', error: 'Google indisponible. Événement local conservé.' }] } }), { times: 1 });
    await dialog.locator('[data-delete]').click();
    await expect(dialog.locator('[data-result]')).toContainText('Événement local conservé');
    await expect(dialog.locator('[data-delete]')).toBeDisabled();
    await dialog.getByRole('button', { name: 'Afficher l’aperçu' }).click();
    await expect(dialog.locator('[data-preview]')).toContainText('1 événement(s)');
    await dialog.locator('[name=confirm]').check();
    await dialog.locator('[data-delete]').click();
    await expect(dialog.locator('[data-result]')).toHaveText('1 événement(s) supprimé(s). 0 échec(s).');
    await expect(dialog.locator('[data-delete]')).toBeDisabled();
    assert.equal(confirmations, 2);
    assert.deepEqual((await (await fetch(server.url + '/api/v1/state')).json()).planning.map(item => item.title).sort(), ['Outside', 'Weekly']);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await server?.stop(); await rm(folder, { recursive: true, force: true }); }
});
