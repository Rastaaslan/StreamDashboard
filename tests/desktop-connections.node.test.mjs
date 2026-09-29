import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { WebSocketServer } from 'ws';
import { chromium, expect } from '@playwright/test';

test('Desktop connections: default modules, Google OAuth, bot setup and live form preservation', async () => {
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    const file = path.startsWith('/mobile/') ? `apps${path}` : `apps/web${path === '/preview/' ? '/preview/index.html' : path}`;
    try { res.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(await readFile(file)); }
    catch { res.writeHead(404).end(); }
  });
  const sockets = new WebSocketServer({ server, path: '/ws/v1' });
  let socket, browser;
  sockets.on('connection', client => { socket = client; });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => route.fulfill({ json: {} }));
    await page.goto(`http://127.0.0.1:${server.address().port}/preview/`);
    await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
    const profile = await page.evaluate(() => window.__preview.state.productProfile);
    assert.equal(profile.modules.googleCalendar, false);
    assert.equal(profile.modules.discord, false);
    for (const id of ['obs','twitch','streamlabs','wizebot']) profile.modules[id] = false;
    const dashboard = { obs: {}, settings: {}, twitch: {}, timer: { running: false, remaining: 60 },
      google: { configured: true, connected: false, calendars: [], targetCalendarId: null },
      discord: { configured: false, connected: false }, controlHub: { integrations: {} } };
    await page.route('**/api/v1/state', route => route.fulfill({ json: dashboard }));
    await page.route('**/api/v1/profile', route => route.fulfill({ json: { profile } }));
    await page.route('**/api/v1/connections', route => route.fulfill({ json: { items: [
      { id: 'google', status: 'disconnected', mode: 'official', capabilities: ['connect'] },
      { id: 'discord', status: 'disconnected', mode: 'custom', capabilities: ['configure', 'publish'] }
    ] } }));
    await page.locator('#mode').click();
    await expect(page.locator('#runtime-status')).toHaveText('Runtime PC');
    await page.locator('[data-view="camp"]').click();
    await page.locator('[data-camp="Connexions"]').click();
    for (const id of ['obs','twitch','google','discord','streamlabs','wizebot','remote']) await expect(page.locator(`[data-connection-id="${id}"]`)).toBeVisible();
    const google = page.locator('[data-connection-id="google"]');
    const discord = page.locator('[data-connection-id="discord"]');
    await expect(google).toBeVisible();
    await expect(page.locator('[data-connection-action="google-connect"]')).toBeEnabled();
    await expect(discord).toContainText('À configurer');
    await expect(discord).not.toContainText('Officiel');
    await expect(discord).not.toContainText('Service officiel non encore déployé');
    await expect(page.locator('[data-connection-action="discord-token-save"]')).toBeEnabled();
    await page.evaluate(() => { window.streamDashboardDesktop = { openExternalAuth: async url => { window.openedAuth = url; } }; });
    await page.route('**/api/v1/google/oauth/start', route => route.fulfill({ json: { authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?test=1' } }));
    await page.locator('[data-connection-action="google-connect"]').click();
    await page.waitForFunction(() => window.openedAuth?.startsWith('https://accounts.google.com/'));
    await page.route('**/api/v1/discord/token', async route => {
      assert.deepEqual(route.request().postDataJSON(), { token: 'test-bot-secret' });
      dashboard.discord = { configured: true, connected: true };
      await route.fulfill({ json: dashboard.discord });
    });
    await page.route('**/api/v1/discord/status', route => route.fulfill({ json: dashboard.discord }));
    await page.route('**/api/v1/discord/guilds', route => route.fulfill({ json: [{ id: '1', name: 'Serveur' }] }));
    await page.route('**/api/v1/discord/guilds/1/channels', route => route.fulfill({ json: [{ id: '2', name: 'planning' }] }));
    await page.locator('#preview-discord-token').fill('test-bot-secret');
    await page.locator('[data-connection-action="discord-token-save"]').click();
    await expect(page.locator('#preview-discord-token')).toHaveValue('');
    await expect(discord).toContainText('Connecté');
    await page.locator('#preview-discord-guild').selectOption('1');
    await page.locator('#preview-discord-channel').selectOption('2');
    let saved = false;
    await page.route('**/api/v1/discord/settings', async route => {
      assert.deepEqual(route.request().postDataJSON(), { guildId: '1', channelId: '2', defaultMessage: 'Mon planning' });
      Object.assign(dashboard.discord, { guildId: '1', channelId: '2', guildName: 'Serveur', channelName: 'planning' });
      saved = true;
      await route.fulfill({ json: dashboard.discord });
    });
    await page.locator('#preview-discord-message').fill('Mon planning');
    await page.locator('[data-connection-action="discord-settings-save"]').click();
    await expect(discord).toContainText('#planning');
    assert.ok(saved);
    // A restarted server has a stored token but has not verified it yet.
    dashboard.discord.connected = false;
    socket.send(JSON.stringify({ type: 'state.updated', data: dashboard }));
    await expect(discord).toContainText('non connecté');
    await expect(page.locator('[data-connection-action="discord-settings-save"]')).toBeDisabled();
    let tokenWrites = 0;
    await page.route('**/api/v1/discord/token', route => { tokenWrites++; return route.fulfill({ status: 400, json: {} }); });
    let releaseStatus;
    const statusGate = new Promise(resolve => { releaseStatus = resolve; });
    await page.route('**/api/v1/discord/status', async route => {
      await statusGate;
      dashboard.discord.connected = true;
      await route.fulfill({ json: dashboard.discord });
    });
    await page.locator('#preview-discord-message').fill('Mon planning');
    await page.locator('[data-connection-action="discord-load"]').click();
    await page.locator('#preview-discord-message').focus();
    releaseStatus();
    await expect(discord).toContainText('Connecté');
    await expect(page.locator('#preview-discord-message')).toBeFocused();
    await expect(page.locator('#preview-discord-message')).toHaveValue('Mon planning');
    await expect(page.locator('#preview-discord-token')).toHaveValue('');
    await expect(page.locator('#preview-discord-channel')).toHaveValue('2');
    await expect(page.locator('[data-connection-action="discord-settings-save"]')).toBeEnabled();
    saved = false;
    await page.locator('[data-connection-action="discord-settings-save"]').click();
    await expect(page.locator('#toast')).toContainText('Destination Discord enregistrée');
    assert.ok(saved);
    assert.equal(tokenWrites, 0, 'Stored credentials must not require token submission');
    const draft = page.locator('#preview-discord-message');
    await draft.fill('Brouillon conservé');
    await page.locator('#preview-discord-token').fill('autre-brouillon');
    await draft.focus();
    assert.ok(socket);
    for (const connected of [true, false, true]) {
      Object.assign(dashboard.google, { connected, targetCalendarId: connected ? 'primary' : null, calendars: connected ? [{ id: 'primary', summary: 'Principal', writable: true }] : [] });
      socket.send(JSON.stringify({ type: 'state.updated', data: dashboard }));
      await expect(page.locator('[data-connection-control="google-auth"]')).toHaveAttribute('data-connection-action', connected ? 'google-disconnect' : 'google-connect');
      await expect(page.locator('#preview-google-calendar')).toHaveValue(connected ? 'primary' : '');
      await expect(draft).toBeFocused();
      await expect(draft).toHaveValue('Brouillon conservé');
      await expect(page.locator('#preview-discord-token')).toHaveValue('autre-brouillon');
      await expect(page.locator('#preview-discord-channel')).toHaveValue('2');
    }
    dashboard.google.calendars.push({ id: 'other', summary: 'Autre calendrier', writable: true });
    socket.send(JSON.stringify({ type: 'state.updated', data: dashboard }));
    let targetSaved = false;
    await page.route('**/api/v1/google/target', async route => {
      assert.deepEqual(route.request().postDataJSON(), { calendarId: 'other' });
      dashboard.google.targetCalendarId = 'other';
      targetSaved = true;
      await route.fulfill({ json: dashboard });
    });
    await page.locator('#preview-google-calendar').selectOption('other');
    await expect(page.locator('#toast')).toContainText('Calendrier Google sélectionné');
    assert.ok(targetSaved);
    await expect(draft).toHaveValue('Brouillon conservé');
    dashboard.google.error = 'Autorisation expirée';
    socket.send(JSON.stringify({ type: 'state.updated', data: dashboard }));
    // A disconnected provider exposes its API error and remains reconnectable.
    dashboard.google.connected = false;
    socket.send(JSON.stringify({ type: 'state.updated', data: dashboard }));
    await expect(google).toContainText('Autorisation expirée');
    dashboard.google.configured = false;
    socket.send(JSON.stringify({ type: 'state.updated', data: dashboard }));
    await expect(page.locator('[data-connection-action="google-connect"]')).toBeDisabled();
    await expect(google).toContainText('configuration mainteneur requise');
    dashboard.google.configured = true;
    socket.send(JSON.stringify({ type: 'state.updated', data: dashboard }));
    await expect(page.locator('[data-connection-action="google-connect"]')).toBeEnabled();
    await page.route('**/api/v1/discord/status', route => route.fulfill({ json: { ...dashboard.discord, connected: false, error: 'Token Discord refusé' } }));
    await page.locator('[data-connection-action="discord-load"]').click();
    await expect(discord).toContainText('Token Discord refusé');
    await expect(page.locator('[data-connection-action="discord-settings-save"]')).toBeDisabled();
    await expect(page.locator('#preview-discord-message')).toHaveValue('Brouillon conservé');
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    for (const client of sockets.clients) client.terminate();
    await new Promise(resolve => sockets.close(resolve));
    await new Promise(resolve => server.close(resolve));
  }
});
