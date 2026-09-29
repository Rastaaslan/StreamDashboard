import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

test('mobile connections explain Preview, provisioning, module off and stale PC state', async () => {
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    try {
      const file = `apps${pathname === '/mobile/' ? '/mobile/index.html' : pathname}`;
      let content = await readFile(file);
      if (pathname === '/mobile/mobile.js') content += `\nwindow.connectionTest = { refreshProviderAccounts, project(items, online) { connectionProjection=items; runtimeCapabilities={features:['mobile-provider-actions']}; productProfile={modules:{googleCalendar:false,discord:false}}; companionMode=online?CompanionMode.ONLINE_PC:CompanionMode.OFFLINE; renderManagedConnections(); }, navigation() { applyModuleProjection({obs:false,twitch:false,soundboard:false,planning:false}); } };`;
      res.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
      res.end(content);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.addInitScript(() => {
      window.StreamDashboardNative = { isAndroid: () => true, buildCapabilities: () => JSON.stringify({preview:true}) };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/mobile/`);
    await page.waitForFunction(() => window.connectionTest);
    await page.evaluate(() => {
      document.querySelector('#pairing').hidden = true;
      document.querySelector('[data-view="settings"]').classList.add('active');
      return window.connectionTest.refreshProviderAccounts();
    });
    for (const id of ['google', 'twitch']) {
      await expect(page.locator(`#${id}-assistant`)).toContainText('Preview');
      await expect(page.locator(`#${id}-standalone-auth`)).toBeDisabled();
      await expect(page.locator(`#${id}-assistant button`)).toBeDisabled();
    }
    await page.evaluate(async () => {
      window.StreamDashboardNative.buildCapabilities = () => JSON.stringify({preview:false,providers:{google:{code:'NOT_CONFIGURED'},twitch:{code:'NOT_CONFIGURED'}}});
      await window.connectionTest.refreshProviderAccounts();
    });
    await expect(page.locator('#google-assistant')).toContainText('Client ID absent');
    await expect(page.locator('#google-standalone-auth')).toBeDisabled();
    await page.evaluate(async () => {
      window.StreamDashboardNative.buildCapabilities = () => JSON.stringify({preview:false});
      window.StreamDashboardProviders = Object.fromEntries(['google','twitch'].map(id => [id+'Status', () => JSON.stringify({ok:true,configured:true,connected:false,capabilities:['connect']})]));
      await window.connectionTest.refreshProviderAccounts();
    });
    await expect(page.locator('#google-standalone-auth')).toBeEnabled();
    await expect(page.locator('#google-assistant button')).toBeDisabled();
    await page.evaluate(async () => {
      window.StreamDashboardNative.buildCapabilities = () => JSON.stringify({preview:false});
      window.StreamDashboardProviders = Object.fromEntries(['google','twitch'].map(id => [id+'Status', () => JSON.stringify({ok:true,configured:true,connected:true,capabilities:['connect','disconnect','test']})]));
      await window.connectionTest.refreshProviderAccounts();
    });
    await expect(page.locator('#google-standalone-logout')).toBeEnabled();
    await expect(page.locator('#google-assistant button')).toBeEnabled();
    await page.evaluate(() => window.connectionTest.project([{id:'google',label:'Google Calendar',status:'connected',capabilities:['disconnect']},{id:'discord',label:'Discord',status:'disconnected',capabilities:[]}], true));
    await expect(page.locator('#hub-integrations')).toContainText('Google Calendar');
    await expect(page.locator('#hub-integrations')).toContainText('Discord');
    await expect(page.locator('[data-connection-action="google-disconnect"]')).toBeEnabled();
    assert.equal(await page.locator('#hub-integrations .integration-card').count(), 7);
    assert.equal(await page.locator('#hub-integrations').getByText(/Module désactivé/).count(), 2);
    await page.evaluate(() => window.connectionTest.project([{id:'google',label:'Google Calendar',status:'connected',capabilities:['disconnect']}], false));
    await expect(page.locator('#hub-integrations')).toContainText('PC hors ligne · dernier état : Connecté');
    assert.equal(await page.locator('#hub-integrations button:not([disabled])').count(), 0);
    await page.evaluate(() => window.connectionTest.navigation());
    assert.deepEqual(await page.locator('nav [data-tab]:not([hidden]) small').allTextContents(), ['Accueil','Live','Sons','Planning','Plus']);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
});
