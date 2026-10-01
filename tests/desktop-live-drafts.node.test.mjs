import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { chromium, expect } from '@playwright/test';
import { WebSocketServer } from 'ws';
import { createMobileFixture } from '../apps/mobile/dev-fixtures.js';

const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
async function fixture(t) {
  const app = express(); app.use('/mobile', express.static('apps/mobile')); app.use(express.static('apps/web'));
  const server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
  const sockets = new WebSocketServer({ server, path: '/ws/v1' });
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  t.after(async () => { await browser.close(); for (const socket of sockets.clients) socket.terminate(); await new Promise(resolve => sockets.close(resolve)); await new Promise(resolve => server.close(resolve)); });
  const page = await browser.newPage(); page.setDefaultTimeout(5000);
  const data = createMobileFixture('live'), state = data.state;
  state.twitch.capabilities = { chatWrite: true, updateChannel: true };
  state.twitch.gameId = 'old-id'; state.twitch.gameName = 'Old category';
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.goto(`http://127.0.0.1:${server.address().port}/preview/`);
  await page.waitForFunction(() => window.__preview);
  const profile = await page.evaluate(() => window.__preview.state.productProfile);
  await page.route('**/api/v1/state', route => route.fulfill({ json: state }));
  await page.route('**/api/v1/profile', route => route.fulfill({ json: { profile } }));
  await page.route('**/api/v1/soundboard', route => route.fulfill({ json: data.soundboard }));
  await page.route('**/api/v1/commands', route => route.fulfill({ json: { ok: true, state } }));
  await page.route('**/api/v1/twitch/categories?*', route => route.fulfill({ json: [{ id: '42', name: 'Chosen category' }] }));
  await page.locator('#mode').click();
  await expect.poll(() => sockets.clients.size).toBe(1);
  await page.locator('[data-view="live"]').click();
  await page.locator('.live-twitch-settings summary').click();
  const title = page.locator('#live-twitch-settings [name="title"]');
  const chat = page.locator('#desktop-chat-form input');
  const category = page.locator('#live-twitch-category');
  const categoryId = page.locator('#live-twitch-game-id');
  const submit = page.locator('#live-twitch-settings button.action');
  const blur = () => page.evaluate(() => document.activeElement?.blur());
  const broadcast = async () => {
    state.controlHub.audience.viewerCount++;
    for (const socket of sockets.clients) socket.send(JSON.stringify({ type: 'state.updated', data: state }));
    await expect(page.locator('.live-chat-panel .section-head .label')).toContainText(`${state.controlHub.audience.viewerCount} viewers`);
  };
  return { page, state, sockets, title, chat, category, categoryId, submit, blur, broadcast };
}

test('category name and hidden ID survive blur, WS and delayed HTTP before submission', async t => {
  const { page, state, category, categoryId, submit, blur, broadcast } = await fixture(t);
  await category.fill('Chosen');
  await page.locator('[data-live-twitch-category-search]').click();
  await page.locator('#live-twitch-category-results').selectOption('42');
  await blur(); await broadcast();
  await expect(category).toHaveValue('Chosen category');
  await expect(categoryId).toHaveValue('42');
  const started = gate(), response = gate();
  await page.route('**/api/v1/state', async route => { started.release(); await response.promise; await route.fulfill({ json: state }); });
  await page.locator('[data-timer="plus"]').click(); await started.promise; await blur();
  state.timer.remaining = 123; response.release();
  await page.waitForFunction(() => window.__preview.state.seconds === 123);
  await expect(category).toHaveValue('Chosen category'); await expect(categoryId).toHaveValue('42');
  let body;
  await page.route('**/api/v1/twitch/channel', route => { body = route.request().postDataJSON(); return route.fulfill({ json: state }); });
  await submit.click();
  await expect.poll(() => body).toMatchObject({ gameName: 'Chosen category', gameId: '42' });
});

for (const failure of ['ws-close', 'refresh-error']) test(`Live title/chat survive ${failure} and reconnect`, async t => {
  const { page, state, sockets, title, chat, blur, broadcast } = await fixture(t);
  await title.fill('Title draft'); await chat.fill('Unsent chat'); await blur();
  if (failure === 'refresh-error') {
    await page.route('**/api/v1/state', route => route.fulfill({ status: 503, json: { message: 'Unavailable' } }), { times: 1 });
    await page.locator('[data-timer="plus"]').click();
  } else for (const socket of sockets.clients) socket.close();
  await expect(page.locator('#runtime-status')).toHaveText('Runtime hors ligne');
  await expect(title).toHaveValue('Title draft'); await expect(chat).toHaveValue('Unsent chat');
  if (failure === 'refresh-error') for (const socket of sockets.clients) socket.close();
  await expect(page.locator('#runtime-status')).toHaveText('Runtime PC');
  await blur(); await broadcast();
  await expect(title).toHaveValue('Title draft'); await expect(chat).toHaveValue('Unsent chat');
});

for (const edit of ['new text', 'original value']) test(`delayed Twitch save preserves ${edit}, category and chat, then accepts the next save`, async t => {
  const { page, state, title, chat, category, categoryId, submit, blur, broadcast } = await fixture(t);
  const newerTitle = edit === 'original value' ? await title.inputValue() : 'Newer title';
  await title.fill('Submitted title'); await chat.fill('Unsent chat');
  const started = gate(), response = gate();
  await page.route('**/api/v1/twitch/channel', async route => {
    const body = route.request().postDataJSON(); started.release(); await response.promise;
    Object.assign(state.twitch, { channelTitle: body.title, gameId: body.gameId, gameName: body.gameName });
    state.controlHub.live.title = body.title;
    await route.fulfill({ json: state });
  });
  await submit.click(); await started.promise;
  await category.fill('Chosen'); await page.locator('[data-live-twitch-category-search]').click();
  await page.locator('#live-twitch-category-results').selectOption('42');
  await title.fill(newerTitle); await title.focus(); response.release();
  await expect(page.locator('.live-hero-desktop h2')).toHaveText('Submitted title');
  await expect(title).toHaveValue(newerTitle); await expect(title).toBeFocused();
  await expect(category).toHaveValue('Chosen category'); await expect(categoryId).toHaveValue('42');
  await expect(chat).toHaveValue('Unsent chat');
  await blur(); await broadcast();
  await expect(title).toHaveValue(newerTitle); await expect(chat).toHaveValue('Unsent chat');
  await submit.click();
  await expect(page.locator('.live-hero-desktop h2')).toHaveText(newerTitle);
  await blur(); state.twitch.channelTitle = 'Subsequent remote title'; await broadcast();
  await expect(title).toHaveValue('Subsequent remote title');
  await expect(chat).toHaveValue('Unsent chat');
});

test('delayed chat acknowledgement does not erase the next message', async t => {
  const { page, chat } = await fixture(t);
  const started = gate(), response = gate();
  await page.route('**/api/v1/twitch/chat/messages', async route => { started.release(); await response.promise; await route.fulfill({ json: {} }); });
  await chat.fill('First message'); await page.locator('#desktop-chat-form button').click(); await started.promise;
  await chat.fill('Next message'); response.release();
  await expect(page.locator('#toast')).toContainText('Message envoyé');
  await expect(chat).toHaveValue('Next message');
});
