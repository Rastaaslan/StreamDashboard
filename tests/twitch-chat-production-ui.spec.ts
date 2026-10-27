import { test, expect } from '@playwright/test';
import express from 'express';
import type { Server } from 'node:http';
import path from 'node:path';

let server: Server, origin: string;
// Exercise the files users receive, not the source tree served by development tests.
// SD_UI_ASSET_ROOT may also point at the mobile directory extracted from app.asar.
const assetRoot = path.resolve(process.env.SD_UI_ASSET_ROOT || '.build/public/mobile');

test.beforeAll(async () => {
  const app = express();
  app.use('/mobile', express.static(assetRoot));
  app.get('/', (_req, res) => res.send('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/mobile/control/control.css"><main><div id="chat" style="max-width:480px"></div></main>'));
  server = await new Promise<Server>(resolve => {
    const running = app.listen(0, '127.0.0.1', () => resolve(running));
  });
  origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
});
test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

test('production Twitch chat ships its CSS and scrolls inside a bounded log', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  await page.goto(origin);
  const cssResponse = page.waitForResponse(response => response.url() === origin + '/mobile/control/twitch-chat.css');
  await page.evaluate(async () => {
    const win = window as any;
    const modulePath = '/mobile/control/twitch-chat.js';
    const { createTwitchChat } = await import(modulePath);
    const sample = { broadcasterId: '123', chatter: { id: '456', login: 'viewer_test', displayName: 'Viewer test' }, receivedAt: new Date().toISOString() };
    win.fixtureSnapshot = {
      identity: { broadcasterId: '123', userName: 'creator_test', displayName: 'Créateur test' },
      accountConnected: true,
      capabilities: { chatRead: true, chatWrite: true },
      chat: { connected: true, messages: Array.from({ length: 60 }, (_, i) => ({ ...sample, id: 'fixture-' + i, text: 'Message simulé numéro ' + i })) },
    };
    win.fixtureChat = createTwitchChat(document.querySelector('#chat'), {
      request: async (_url: string, _body: unknown, method: string) => {
        if (method !== 'GET') throw new Error('This fixture forbids writes');
        return structuredClone(win.fixtureSnapshot);
      },
    });
    win.fixtureChat.update({ sourceKey: 'fixture', online: true });
  });
  expect((await cssResponse).status()).toBe(200);
  const log = page.locator('[data-twitch-messages]');
  await expect(page.locator('#chat')).toHaveCSS('display', 'flex');
  await expect(log).toHaveCSS('overflow-y', 'auto');
  await expect(page.locator('.twitch-chat-message')).toHaveCount(60);
  const geometry = () => log.evaluate(element => ({ height: element.clientHeight, extent: element.scrollHeight, top: element.scrollTop, gap: element.scrollHeight - element.clientHeight - element.scrollTop }));
  // gap === 0 alone also passes for an unstyled log that expands with its content.
  await expect.poll(async () => {
    const g = await geometry();
    return g.height > 0 && g.height < 440 && g.extent > g.height && g.top > 0 && g.gap <= 1;
  }).toBe(true);
  const before = await geometry();
  await page.evaluate(async () => {
    const win = window as any;
    const sample = win.fixtureSnapshot.chat.messages[0];
    win.fixtureSnapshot.chat.messages.push({ ...sample, id: 'fixture-60', text: 'Le soixante et unième message arrive après le rendu' });
    await win.fixtureChat.refresh(true);
  });
  await expect(page.locator('.twitch-chat-message')).toHaveCount(61);
  await expect.poll(async () => {
    const g = await geometry();
    return g.extent > before.extent && g.top > before.top && g.gap <= 1;
  }).toBe(true);
  await page.evaluate(() => (window as any).fixtureChat.destroy());
});
