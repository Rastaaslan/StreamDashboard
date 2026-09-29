import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium, expect } from '@playwright/test';
import { startDashboardServer } from '../dist/apps/server/src/index.js';
import { MemorySecretStore } from '../dist/apps/server/src/storage.js';

// Real renderer, HTTP routes, PKCE, callback, storage and websocket. Only Google is mocked.
for (const googleClientSecret of ['', 'mock-desktop-credential']) {
test(`Desktop Google (${googleClientSecret ? 'with secret' : 'public PKCE'}): shipped ID, occupied port, OAuth callback, persistence and Planning`, async () => {
  const distribution = JSON.parse(await readFile('resources/distribution.json', 'utf8'));
  assert.equal(distribution.googleClientId, '206682842774-lu1efnct6o2cjn3jrtgo2a33r2amontq.apps.googleusercontent.com');
  const dataDir = await mkdtemp('.google-e2e-');
  const occupied = createServer();
  await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve));
  const secrets = new MemorySecretStore();
  let tokenBody, browser, dashboard;
  const options = { port: occupied.address().port, dataDir, googleClientId: distribution.googleClientId, googleClientSecret: '', secretStore: secrets,
    logger: { info() {}, warn() {}, error() {} },
    googleFetch: async (url, init) => {
      if (url === 'https://oauth2.googleapis.com/token') {
        tokenBody = new URLSearchParams(init.body);
        if (googleClientSecret && !tokenBody.has('client_secret')) return Response.json({ error: 'invalid_request', error_description: 'client_secret is missing.' }, { status: 400 });
        assert.equal(tokenBody.get('client_secret'), googleClientSecret || null);
        return Response.json({ access_token: 'mock-access', refresh_token: 'mock-refresh', expires_in: 3600 });
      }
      if (url.includes('/users/me/calendarList')) return Response.json({ items: [{ id: 'primary', summary: 'Agenda test', accessRole: 'owner' }] });
      if (url.includes('/calendars/primary/events')) return Response.json({ items: [] });
      throw new Error(`Unexpected Google request: ${url}`);
    } };
  try {
    dashboard = await startDashboardServer(options);
    assert.notEqual(new URL(dashboard.url).port, String(occupied.address().port));
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => { window.streamDashboardDesktop = { openExternalAuth: async url => { window.openedAuth = url; } }; });
    await page.goto(dashboard.url + '/preview/?runtime=1');
    await expect(page.locator('#runtime-status')).toHaveText('Runtime PC');
    await page.locator('[data-view="camp"]').click();
    await page.locator('[data-camp="Connexions"]').click();
    await page.locator('[data-connection-action="google-connect"]').click();
    await page.waitForFunction(() => window.openedAuth);
    let auth = new URL(await page.evaluate(() => window.openedAuth));
    assert.equal(auth.origin, 'https://accounts.google.com');
    assert.equal(auth.searchParams.get('client_id'), distribution.googleClientId);
    const redirect = auth.searchParams.get('redirect_uri');
    assert.equal(redirect, dashboard.url + '/api/v1/google/oauth/callback');
    assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
    if (googleClientSecret) {
      const failed = await fetch(redirect + '?code=mock-code&state=' + auth.searchParams.get('state'));
      assert.equal(failed.status, 400);
      await expect(page.locator('[data-google-diagnostic]')).toContainText('client_secret is missing');
      await expect(page.locator('[data-google-diagnostic]')).toContainText('Enregistrer');
      await expect(page.locator('[data-connection-action="google-connect"]')).toBeVisible();
      await expect(page.locator('[data-connection-id="discord"]')).toBeVisible();
      await page.getByLabel('Client Secret Google', { exact: true }).fill(googleClientSecret);
      await page.locator('#preview-google-secret-form button[type="submit"]').click();
      await expect(page.getByLabel('Client Secret Google', { exact: true })).toHaveValue('');
      await expect(page.locator('[data-google-secret-status]')).toContainText('Secret configuré');
      assert.equal((await page.content()).includes(googleClientSecret), false);
      assert.equal(await secrets.getGoogleClientSecret(), googleClientSecret);
      await page.evaluate(() => { window.openedAuth = null; });
      await page.locator('[data-connection-action="google-connect"]').click();
      await page.waitForFunction(() => window.openedAuth);
      auth = new URL(await page.evaluate(() => window.openedAuth));
    }
    const response = await fetch(redirect + '?code=mock-code&state=' + auth.searchParams.get('state'));
    assert.equal(response.status, 200, await response.text());
    assert.equal(tokenBody.get('redirect_uri'), redirect);
    assert.equal(tokenBody.get('code'), 'mock-code');
    assert.ok(tokenBody.get('code_verifier'));
    await expect(page.locator('[data-connection-action="google-disconnect"]')).toBeVisible();
    const connections = await fetch(dashboard.url + '/api/v1/connections').then(r => r.json());
    assert.equal(connections.items.find(item => item.id === 'google').status, 'connected');
    assert.equal((await secrets.getGoogleTokens()).refreshToken, 'mock-refresh');
    await page.locator('#preview-google-calendar').selectOption('primary');
    await expect.poll(() => dashboard.state().google.targetCalendarId).toBe('primary');
    await page.locator('[data-view="planning"]').click();
    assert.deepEqual(errors, []);
    await dashboard.stop();
    dashboard = await startDashboardServer({ ...options, port: 0 });
    assert.equal(dashboard.state().google.connected, true);
    assert.equal(dashboard.state().google.targetCalendarId, 'primary');
    if (googleClientSecret) {
      assert.equal(dashboard.state().google.clientSecretConfigured, true);
      await page.goto(dashboard.url + '/preview/?runtime=1');
      await page.locator('[data-view="camp"]').click();
      await page.locator('[data-camp="Connexions"]').click();
      await page.locator('[data-connection-action="google-secret-clear"]').click();
      await expect(page.locator('[data-google-secret-status]')).toContainText('Aucun secret configuré');
      assert.equal(await secrets.getGoogleClientSecret(), '');
    }
  } finally {
    await browser?.close();
    await dashboard?.stop();
    await new Promise(resolve => occupied.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});
}
