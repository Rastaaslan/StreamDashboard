import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { WebSocketServer } from 'ws';
import { chromium, expect } from '@playwright/test';

test('Planning Desktop preserves the editable draft across telemetry, reconnect and save', async () => {
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    const file = path.startsWith('/mobile/') ? `apps${path}` : `apps/web${path === '/preview/' ? '/preview/index.html' : path}`;
    try {
      res.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
      res.end(await readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  const sockets = new WebSocketServer({ server, path: '/ws/v1' });
  let socket;
  let connections = 0;
  sockets.on('connection', client => { socket = client; connections++; });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, timezoneId: 'Europe/Paris' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const dashboard = { obs: { connected: false }, twitch: { connected: false }, settings: {}, timer: { running: true, remaining: 60 }, planning: [] };
    let submitted;
    let failSave = false;
    await page.route('**/api/**', route => route.fulfill({ json: {} }));
    await page.route('**/api/v1/state', route => route.fulfill({ json: dashboard }));
    await page.route('**/api/v1/soundboard', route => route.fulfill({ json: { sounds: [] } }));
    await page.route('**/api/v1/twitch/categories?*', route => route.fulfill({ json: [{ id: '509658', name: 'Just Chatting' }] }));
    await page.route('**/api/v1/planning/tags/regenerate', route => route.fulfill({ json: { tags: { values: ['Français', 'Gaming'], source: 'generated', generatedAt: '2026-10-04T10:00:00Z' } } }));
    await page.route('**/api/v1/planning', async route => {
      assert.equal(route.request().method(), 'POST');
      submitted = route.request().postDataJSON();
      if (failSave) return route.fulfill({ status: 503, json: { message: 'Sauvegarde indisponible' } });
      dashboard.planning = [{ ...submitted, id: 'saved' }];
      await route.fulfill({ json: dashboard });
    });
    await page.route('**/api/v1/planning/saved', async route => {
      submitted = route.request().postDataJSON();
      assert.equal(route.request().method(), 'PUT');
      dashboard.planning = [{ ...submitted, id: 'saved' }];
      await route.fulfill({ json: dashboard });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/preview/?runtime=1`);
    await expect.poll(() => connections).toBe(1);
    await expect(page.locator('#runtime-status')).toHaveText('Runtime PC');
    await page.locator('[data-view="planning"]').click();
    // A double click while templates are loading must open just one editor.
    // Otherwise the second response resets fields after the user starts typing.
    const pendingCompanion = [];
    await page.route('**/api/v1/companion/snapshot', route => { pendingCompanion.push(route); });
    await page.locator('[data-add-event]').dblclick();
    await expect.poll(() => pendingCompanion.length).toBeGreaterThan(0);
    await pendingCompanion[0].fulfill({ json: { templates: [], revision: 1 } });
    const openingTitle = page.locator('#event-title');
    await openingTitle.click();
    await page.keyboard.type('Saisie pendant le chargement');
    for (const [index, route] of pendingCompanion.slice(1).entries()) {
      await route.fulfill({ json: { templates: [], revision: index + 2 } });
      await page.waitForFunction(revision => window.__preview.state.companion.revision === revision, index + 2);
    }
    await expect(openingTitle).toHaveValue('Saisie pendant le chargement');
    await expect(openingTitle).toBeFocused();
    assert.equal(pendingCompanion.length, 1);
    await page.keyboard.press('End');
    await page.keyboard.type(' !');
    await expect(openingTitle).toHaveValue('Saisie pendant le chargement !');
    await page.keyboard.press('Escape');
    await expect(page.locator('#event-dialog')).not.toBeVisible();
    await page.unroute('**/api/v1/companion/snapshot');
    await page.locator('[data-view="planning"]').click();
    dashboard.planning=Array.from({length:45},(_,i)=>({id:`bulk-${i}`,title:`Event ${i}`,startAtUtc:'2027-06-02T22:30:00Z',endAtUtc:'2027-06-05T23:30:00Z'}));
    socket.send(JSON.stringify({type:'state.updated',data:dashboard}));
    await expect(page.locator('[data-event-index]')).toHaveCount(45);
    await page.locator('[data-event-index="44"]').click();
    await expect(page.locator('#event-date')).toHaveValue('2027-06-03');
    await expect(page.locator('#event-end-date')).toHaveValue('2027-06-06');
    await page.locator('#event-dialog').evaluate(dialog=>dialog.close());
    dashboard.planning=[];
    await page.locator('[data-add-event]').click();
    const dialog = page.locator('#event-dialog');
    const title = page.locator('#event-title');
    const description = page.locator('#event-description');
    const emit = async n => {
      dashboard.timer.remaining = n;
      dashboard.obs.connected = n % 2 === 0;
      dashboard.twitch.channelTitle = `Titre serveur ${n}`;
      socket.send(JSON.stringify({ type: 'state.updated', data: dashboard }));
      await page.waitForFunction(n => window.__preview.state.dashboard.timer.remaining === n, n);
    };
    // Publication guards update inside the open editor, without replacing its draft DOM.
    await page.evaluate(() => { window.__preview.state.productProfile.modules.googleCalendar = true; });
    dashboard.twitch.connected = true;
    dashboard.twitch.capabilities = { schedule: false };
    dashboard.google = { configured: true, connected: true, targetCalendarId: 'primary', calendars: [{ id: 'primary', writable: false }] };
    await title.fill('Brouillon permissions'); await title.focus();
    const original = await title.elementHandle();
    await emit(90);
    await expect(page.locator('#event-publish-twitch')).toBeDisabled();
    await expect(page.locator('#event-twitch-reason')).toContainText('channel:manage:schedule');
    await expect(page.locator('#event-publish-google')).toBeDisabled();
    await expect(page.locator('#event-google-reason')).toContainText('écriture');
    for (const connected of [true, false, true]) {
      dashboard.twitch.connected = connected; dashboard.twitch.capabilities.schedule = true;
      dashboard.google.connected = connected; dashboard.google.calendars[0].writable = true;
      await emit(connected ? 92 : 91);
      for (const provider of ['twitch','google']) {
        await expect(page.locator(`#event-publish-${provider}`)).toBeVisible();
        if (connected) await expect(page.locator(`#event-publish-${provider}`)).toBeEnabled();
        else {
          await expect(page.locator(`#event-publish-${provider}`)).toBeDisabled();
          await expect(page.locator(`#event-${provider}-reason`)).toContainText('Connecter');
        }
      }
      await expect(title).toHaveValue('Brouillon permissions'); await expect(title).toBeFocused();
      assert.equal(await original.evaluate(el => el === document.querySelector('#event-title')), true);
    }
    // Permission can also be revoked while the account remains connected.
    dashboard.twitch.capabilities.schedule = false; await emit(93);
    await expect(page.locator('#event-publish-twitch')).toBeDisabled();
    await expect(page.locator('#event-twitch-reason')).toContainText('channel:manage:schedule');
    await expect(title).toBeFocused(); await title.fill('');
    await title.click();
    for (const [n, chunk] of ['Mon ', 'live ', 'saisi'].entries()) {
      await page.keyboard.type(chunk);
      await emit(100 + n);
      await expect(title).toBeFocused();
    }
    await description.click();
    await page.keyboard.type('Description personnelle');
    await page.keyboard.press('Enter');
    await emit(110);
    await page.keyboard.type('Deuxième ligne');
    await expect(description).toBeFocused();
    await page.locator('#event-date').fill('2027-04-15');
    await page.locator('#event-start').fill('18:45');
    await page.locator('#event-end').fill('21:15');
    await page.locator('#event-category').selectOption('production');
    await page.locator('#event-twitch-category').fill('Just');
    await page.locator('#event-twitch-results').getByRole('button', { name: 'Just Chatting' }).click();
    await page.locator('#event-tags-regenerate').click();
    await expect(page.locator('#event-tags')).toHaveValue('Français, Gaming');
    await page.locator('#event-tags').fill('Français, Communauté');
    await title.click();
    await title.press('End');
    const draft = await dialog.locator('input,textarea,select').evaluateAll(fields => fields.map(field => ({ id: field.id, value: field.value, checked: field.checked })));
    await page.evaluate(() => { window.originalPlanningTitle = document.querySelector('#event-title'); window.originalPlanningView = document.querySelector('#view').firstElementChild; });
    await emit(120);
    socket.close();
    await expect.poll(() => connections).toBe(2);
    await expect(page.locator('#runtime-status')).toHaveText('Runtime PC');
    await expect(title).toBeFocused();
    assert.equal(await page.evaluate(() => window.originalPlanningTitle === document.querySelector('#event-title')), true);
    assert.equal(await page.evaluate(() => window.originalPlanningView === document.querySelector('#view').firstElementChild), true);
    assert.deepEqual(await dialog.locator('input,textarea,select').evaluateAll(fields => fields.map(field => ({ id: field.id, value: field.value, checked: field.checked }))), draft);
    await page.keyboard.press('Alt+1');
    await expect(page.locator('#title')).toHaveText('Planning');
    await expect(title).toBeFocused();
    await page.keyboard.type(' !');
    // Native required validation and failed requests must leave the editor usable.
    await title.fill('');
    await page.locator('#event-submit').click();
    assert.equal(submitted, undefined);
    await expect(dialog).toBeVisible();
    await title.fill('Mon live saisi !');
    failSave = true;
    await page.locator('#event-submit').click();
    await expect(page.locator('#toast')).toHaveText('Sauvegarde indisponible');
    await expect(dialog).toBeVisible();
    await expect(title).toHaveValue('Mon live saisi !');
    failSave = false;
    await page.locator('#event-submit').click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('#toast')).toHaveText('Événement enregistré');
    assert.deepEqual(submitted, {
      tags: { values: ['Français', 'Communauté'], source: 'manual' }, tagPreferences: { automatic: true, language: '' },
      title: 'Mon live saisi !', description: 'Description personnelle\nDeuxième ligne',
      startAtUtc: '2027-04-15T16:45:00.000Z', endAtUtc: '2027-04-15T19:15:00.000Z', category: 'production',
      twitchCategoryId: '509658', twitchCategoryName: 'Just Chatting', desiredPublication: { local: true, twitch: false, google: false },
    });
    await expect(page.locator('#view')).toContainText('Mon live saisi !');
    await page.locator('[data-event-index]').first().click();
    await expect(title).toHaveValue('Mon live saisi !');
    await expect(page.locator('#event-tags')).toHaveValue('Français, Communauté');
    await page.locator('#event-duplicate').click();
    await expect(page.locator('#event-tags')).toHaveValue('Français, Communauté');
    await expect(page.locator('#event-id')).toHaveValue('');
    await title.fill('Brouillon annulé');
    await emit(130);
    await page.locator('[data-close-dialog="event-dialog"]').click();
    await expect(dialog).not.toBeVisible();
    await page.locator('[data-event-index]').first().click();
    await expect(title).toHaveValue('Mon live saisi !');
    await title.fill('Titre modifié');
    await description.fill('Description modifiée');
    dashboard.planning[0].title = 'Mise à jour serveur concurrente';
    await title.click();
    await emit(140);
    await expect(title).toBeFocused();
    await expect(title).toHaveValue('Titre modifié');
    await expect(description).toHaveValue('Description modifiée');
    await page.locator('#event-submit').click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('#toast')).toHaveText('Événement enregistré');
    assert.equal(submitted.title, 'Titre modifié');
    assert.equal(submitted.description, 'Description modifiée');
    assert.equal(submitted.confirmRecurring, false);
    await page.locator('[data-event-index]').first().click();
    await expect(title).toHaveValue('Titre modifié');
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    // Save a real duplicate, keeping tags and allowing recurrence edits.
    dashboard.planning[0].recurrence = { frequency: 'weekly', interval: 1, timeZone: 'Europe/Paris', until: null };
    await page.locator('[data-view="planning"]').click();
    await emit(145);
    await page.locator('[data-event-index]').first().click();
    await page.locator('#event-duplicate').click();
    await expect(page.locator('#event-recurrence')).toHaveValue('weekly-1');
    await expect(page.locator('#event-tags')).toHaveValue('Français, Communauté');
    await title.click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('Copie récurrente');
    await page.locator('#event-recurrence').selectOption('weekly-2');
    await page.locator('#event-submit').click();
    await expect(dialog).not.toBeVisible();
    assert.equal(submitted.title, 'Copie récurrente');
    assert.equal(submitted.id, undefined);
    assert.deepEqual(submitted.tags.values, ['Français', 'Communauté']);
    assert.deepEqual(submitted.recurrence, { frequency: 'weekly', interval: 2, timeZone: 'Europe/Paris', until: null });
    await expect(page.locator('#toast')).toHaveText('Événement enregistré');
    delete dashboard.planning[0].recurrence;
    await emit(146);
    // A local save with a failed provider must never report full success.
    await page.route('**/api/v1/planning/saved', async route => {
      submitted=route.request().postDataJSON();
      dashboard.planning=[{...submitted,id:'saved',providerLinks:{twitch:{status:'error'}}}];
      await route.fulfill({json:dashboard});
    });
    await page.locator('[data-event-index]').first().click();
    await title.fill('Publication partielle');
    await page.locator('#event-submit').click();
    await expect(page.locator('#toast')).toContainText('publication fournisseur à vérifier');
    dashboard.planning[0].twitchRecurring=true;
    await emit(150);
    await page.locator('[data-event-index]').first().click();
    let deletions=0;
    await page.route('**/api/v1/planning/saved', async route => {
      assert.equal(route.request().method(),'DELETE');
      assert.deepEqual(route.request().postDataJSON(),{confirmRecurring:true});
      deletions++;dashboard.planning=[];await route.fulfill({json:dashboard});
    });
    page.once('dialog',dialog=>{assert.match(dialog.message(),/toute la série Twitch/);return dialog.dismiss();});
    await page.locator('#event-delete').click();
    assert.equal(deletions,0);
    await expect(dialog).toBeVisible();
    page.once('dialog',dialog=>dialog.accept());
    await page.locator('#event-delete').click();
    await expect(dialog).not.toBeVisible();
    assert.equal(deletions,1);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    for (const client of sockets.clients) client.terminate();
    await new Promise(resolve => sockets.close(resolve));
    await new Promise(resolve => server.close(resolve));
  }
});
