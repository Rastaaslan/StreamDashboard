import { test, expect, type Page } from '@playwright/test';
import express from 'express';
import type { Server } from 'node:http';
import path from 'node:path';

let server: Server, origin: string;
test.beforeAll(async () => {
  const app = express();
  app.use('/mobile', express.static(path.resolve('apps/mobile')));
  app.get('/api/v1/twitch/categories', (req, res) => {
    // The shipped route originally accepted q only: ?query= silently returned [].
    if (req.query.id === '460637') { res.json([{ id: '460637', name: 'Dead Island 2' }]); return; }
    res.json(req.query.q === 'Minecraft' ? [{ id: '27471', name: 'Minecraft' }] : []);
  });
  app.get('/', (_req, res) => res.send('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/mobile/control/control.css"><main style="padding:24px"><div id="monitor"></div><div id="chat" style="max-width:480px"></div><div id="feed"></div></main>'));
  server = await new Promise<Server>(resolve => { const running = app.listen(0, '127.0.0.1', () => resolve(running)); });
  origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
});
test.afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await page.goto(origin);
});

async function setupChat(page: Page) {
  await page.evaluate(async () => {
    const win = window as any;
    const modulePath = '/mobile/control/twitch-chat.js';
    const module = await import(modulePath);
    win.snapshot = {
      identity: { broadcasterId: '123', userName: 'creator_test', displayName: 'Créateur test' },
      accountConnected: true, capabilities: { chatRead: true, chatWrite: true },
      chat: { connected: true, messages: [
        { id: 'one', broadcasterId: '123', chatter: { id: '123', login: 'creator_test', displayName: 'Créateur test', color: '#9146ff', badges: [{ setId: 'broadcaster' }] }, text: 'Bonjour', receivedAt: '2026-10-20T10:00:00Z' },
        { id: 'two', broadcasterId: '123', chatter: { id: '456', login: 'viewer_test', displayName: '<img src=x onerror=alert(1)>', color: 'url(javascript:alert(1))', badges: [{ setId: 'broadcaster' }] }, text: '<script>alert(1)</script>', receivedAt: '2026-10-20T10:01:00Z' },
        { id: 'foreign', broadcasterId: '999', chatter: { id: '999' }, text: 'Autre chaîne', receivedAt: '2026-10-20T10:01:00Z' },
      ] },
    };
    win.calls = []; win.documentSubmits = 0;
    document.addEventListener('submit', () => { win.documentSubmits++; });
    win.chat = module.createTwitchChat(document.querySelector('#chat'), {
      request: async (url: string, body: unknown, method: string, source: string) => {
        win.calls.push({ url, body, method, source });
        if (method === 'POST') {
          if (win.failSend) throw Error('ACTION_UNCERTAIN');
          return { messageId: 'sent-by-fake-api' };
        }
        if (win.deferReads) return new Promise(resolve => { (win.pendingReads ||= []).push(resolve); });
        return structuredClone(win.snapshot);
      },
    });
    win.chat.update({ online: true, sourceKey: 'regie', sourceLabel: 'Régie test' });
  });
  await expect(page.locator('[data-twitch-identity]')).toContainText('Créateur test (@creator_test)');
}

test('native Twitch chat uses the confirmed identity, escapes messages and isolates its submit', async ({ page }) => {
  await setupChat(page);
  await expect(page.locator('.twitch-chat-message')).toHaveCount(2);
  await expect(page.locator('[data-chat-badges]').first()).toHaveText('Diffuseur');
  await expect(page.locator('[data-chat-badges]').nth(1)).toHaveText('');
  await expect(page.locator('[data-twitch-messages] img, [data-twitch-messages] script')).toHaveCount(0);
  await page.getByLabel('Message Twitch', { exact: true }).fill('Message utilisateur simulé');
  await page.evaluate(async () => { await (window as any).chat.refresh(true); });
  await expect(page.getByLabel('Message Twitch', { exact: true })).toHaveValue('Message utilisateur simulé');
  await page.getByRole('button', { name: 'Envoyer', exact: true }).click();
  await expect(page.locator('[data-twitch-result]')).toHaveText('Message envoyé par Twitch.');
  expect(await page.evaluate(() => (window as any).calls.filter((call: any) => call.method === 'POST'))).toEqual([
    { url: '/api/v1/twitch/chat/messages', body: { message: 'Message utilisateur simulé', expectedBroadcasterId: '123' }, method: 'POST', source: 'regie' },
  ]);
  expect(await page.evaluate(() => (window as any).documentSubmits)).toBe(0);
  await expect(page.locator('.twitch-chat-message')).toHaveCount(2);
  await expect(page.getByLabel('Message Twitch', { exact: true })).toHaveValue('');
});

test('an uncertain send preserves the draft and never retries; offline and missing permission disable send', async ({ page }) => {
  await setupChat(page);
  await page.evaluate(() => { (window as any).failSend = true; });
  const draft = page.getByLabel('Message Twitch', { exact: true });
  await draft.fill('À vérifier avant de réessayer');
  await draft.press('Enter');
  await expect(page.locator('[data-twitch-result]')).toContainText('Envoi non confirmé');
  await expect(draft).toHaveValue('À vérifier avant de réessayer');
  await page.evaluate(async () => {
    const win = window as any;
    await win.chat.refresh(true); await win.chat.refresh(true);
    win.chat.update({ online: false, sourceKey: 'regie' });
  });
  await expect(draft).toBeDisabled();
  await expect(page.locator('[data-twitch-status]')).toContainText('envoi désactivé');
  expect(await page.evaluate(() => (window as any).calls.filter((call: any) => call.method === 'POST').length)).toBe(1);
  await page.evaluate(async () => {
    const win = window as any;
    win.snapshot.capabilities.chatWrite = false;
    win.chat.update({ online: true, sourceKey: 'regie' });
    await win.chat.refresh(true);
  });
  await expect(page.locator('[data-twitch-status]')).toContainText('Envoi non autorisé');
  await expect(draft).toBeDisabled();
});

test('account changes clear the draft and late responses cannot cross sources or survive destruction', async ({ page }) => {
  await setupChat(page);
  const draft = page.getByLabel('Message Twitch', { exact: true });
  await draft.fill('Brouillon du premier compte');
  await page.evaluate(async () => {
    const win = window as any;
    win.snapshot.identity = { broadcasterId: '456', userName: 'second_test', displayName: 'Second compte' };
    win.snapshot.chat.messages = [];
    await win.chat.refresh(true);
  });
  await expect(draft).toHaveValue('');
  await expect(page.locator('[data-twitch-result]')).toContainText('Compte Twitch changé');
  await page.evaluate(() => {
    const win = window as any;
    win.deferReads = true; void win.chat.refresh(true);
  });
  await expect.poll(() => page.evaluate(() => (window as any).pendingReads?.length)).toBe(1);
  await page.evaluate(() => {
    const win = window as any;
    win.deferReads = false;
    win.snapshot.identity = { broadcasterId: '789', userName: 'local_test', displayName: 'Compte local' };
    win.chat.update({ online: true, sourceKey: 'local' });
  });
  await expect(page.locator('[data-twitch-identity]')).toContainText('Compte local');
  await page.evaluate(() => {
    const win = window as any;
    win.pendingReads.shift()({ ...win.snapshot, identity: { broadcasterId: '999', userName: 'stale_test', displayName: 'Réponse périmée' } });
  });
  await expect(page.locator('[data-twitch-identity]')).toContainText('Compte local');
  await page.evaluate(() => { const win = window as any; win.deferReads = true; void win.chat.refresh(true); });
  await expect.poll(() => page.evaluate(() => (window as any).pendingReads?.length)).toBe(1);
  await page.evaluate(() => {
    const win = window as any;
    win.chat.destroy();
    win.pendingReads.shift()({ ...win.snapshot, identity: { broadcasterId: '999', userName: 'after_test', displayName: 'Après destruction' } });
  });
  await expect(page.locator('[data-twitch-identity]')).toContainText('Compte local');
});

test('Twitch chat keeps receiving while the main dashboard is not refreshing and stops on destruction', async ({ page }) => {
  await page.clock.install();
  await setupChat(page);
  const draft = page.getByLabel('Message Twitch', { exact: true });
  await draft.fill('Brouillon conservé pendant une lecture OBS lente');
  await draft.focus();
  await page.evaluate(() => {
    const win = window as any;
    win.snapshot.chat.messages.push({ id: 'next', broadcasterId: '123', chatter: { id: '456', login: 'viewer_test' }, text: 'Message reçu sans rafraîchir la régie', receivedAt: new Date().toISOString() });
  });
  await page.clock.fastForward(2_600);
  await expect(page.locator('[data-twitch-messages]')).toContainText('Message reçu sans rafraîchir la régie');
  await expect(draft).toHaveValue('Brouillon conservé pendant une lecture OBS lente');
  await expect(draft).toBeFocused();
  const calls = await page.evaluate(() => { const win = window as any; win.chat.destroy(); return win.calls.length; });
  await page.clock.fastForward(12_000);
  expect(await page.evaluate(() => (window as any).calls.length)).toBe(calls);
});

test('a pending chat read expires the visible confirmation and cannot leave sending enabled', async ({ page }) => {
  await page.clock.install();
  await setupChat(page);
  const draft = page.getByLabel('Message Twitch', { exact: true });
  await draft.fill('Attendre une identité confirmée');
  await page.evaluate(() => { const win = window as any; win.deferReads = true; void win.chat.refresh(true); });
  await expect.poll(() => page.evaluate(() => (window as any).pendingReads?.length)).toBe(1);
  await page.clock.fastForward(11_000);
  await expect(draft).toBeDisabled();
  await expect(page.locator('[data-twitch-status]')).toContainText('État actuel non confirmé');
  await expect(page.getByRole('button', { name: 'Envoyer', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as any).pendingReads.length)).toBe(1);
  await page.evaluate(() => { const win = window as any; win.deferReads = false; win.pendingReads.shift()(structuredClone(win.snapshot)); });
  await expect(draft).toBeEnabled();
  await expect(draft).toHaveValue('Attendre une identité confirmée');
  await page.evaluate(() => (window as any).chat.destroy());
});

test('reconnecting the dashboard waits for a new chat identity before enabling an old draft', async ({ page }) => {
  await page.clock.install();
  await setupChat(page);
  const draft = page.getByLabel('Message Twitch', { exact: true });
  await draft.fill('Brouillon après reconnexion');
  await page.evaluate(() => {
    const win = window as any;
    win.chat.update({ online: false, sourceKey: 'regie' });
    win.deferReads = true;
    win.chat.update({ online: true, sourceKey: 'regie' });
  });
  await expect(draft).toBeDisabled();
  await expect(draft).toHaveValue('Brouillon après reconnexion');
  await expect.poll(() => page.evaluate(() => (window as any).pendingReads?.length)).toBe(1);
  await page.evaluate(() => { const win = window as any; win.deferReads = false; win.pendingReads.shift()(structuredClone(win.snapshot)); });
  await expect(draft).toBeEnabled();
  expect(await page.evaluate(() => (window as any).calls.filter((call: any) => call.method === 'POST'))).toEqual([]);
  await page.evaluate(() => (window as any).chat.destroy());
});

test('monitor keeps public video frames stable and exposes creator tools alongside native Twitch chat', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.evaluate(async () => {
    const win = window as any;
    const modulePath = '/mobile/control/live-monitor.js';
    const module = await import(modulePath);
    win.data = { host: { hostname: 'PC de test', monitor: { twitchLogin: 'creator_test' } }, configuration: { youtube: { broadcastId: 'Abc_1234-XY' } } };
    win.monitor = module.createLiveMonitor(document.querySelector('#monitor'), { request: async () => ({
      identity: { broadcasterId: '123', userName: 'creator_test', displayName: 'Créateur test' }, accountConnected: true,
      capabilities: { chatRead: true, chatWrite: true }, chat: { connected: true, messages: [] },
    }) });
    win.monitor.update(win.data, { online: true, sourceKey: 'regie' });
    win.videoFrame = document.querySelector('[data-monitor-slot="video"] iframe');
  });
  await expect(page.getByRole('heading', { name: 'Retour plateforme & chats' })).toBeVisible();
  await expect(page.locator('#monitor')).toContainText('publicités éventuelles');
  await expect(page.locator('[data-monitor-link="twitch-creator"]')).toHaveAttribute('href', 'https://dashboard.twitch.tv/u/creator_test/stream-manager');
  await expect(page.locator('[data-monitor-link="youtube-creator"]')).toHaveAttribute('href', 'https://studio.youtube.com/video/Abc_1234-XY/livestreaming');
  await expect(page.locator('iframe[src*="twitch.tv/embed"], iframe[src*="twitch.tv/popout"]')).toHaveCount(0);
  const draft = page.getByLabel('Message Twitch', { exact: true });
  await expect(draft).toBeEnabled();
  await draft.fill('Brouillon préservé');
  await page.evaluate(() => { const win = window as any; win.monitor.update(win.data, { online: true, sourceKey: 'regie' }); });
  expect(await page.evaluate(() => (window as any).videoFrame === document.querySelector('[data-monitor-slot="video"] iframe'))).toBe(true);
  await expect(draft).toHaveValue('Brouillon préservé');
  await page.screenshot({ path: 'test-results/live-monitor-native-chat.png', fullPage: true });
  await page.getByRole('button', { name: 'Masquer les écrans' }).click();
  await expect(page.locator('#monitor iframe')).toHaveCount(0);
  await page.evaluate(() => { (window as any).monitor.destroy(); });
});

async function setupViewerSession(page: Page) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.evaluate(async () => {
    const win = window as any;
    win.viewerCalls = [];
    win.streamDashboardDesktop = {
      openTwitchViewerSession: (value: unknown) => {
        win.viewerCalls.push(value);
        return new Promise(resolve => { win.closeViewer = () => resolve({ status: 'closed' }); });
      },
      onTwitchViewerSessionClosed: (listener: () => void) => { win.viewerClosed = listener; return () => { win.viewerUnsubscribed = true; }; },
    };
    const modulePath = '/mobile/control/live-monitor.js';
    const module = await import(modulePath);
    win.data = { host: { monitor: { twitchLogin: 'creator_test' } }, configuration: { youtube: { broadcastId: 'Abc_1234-XY' } } };
    win.monitor = module.createLiveMonitor(document.querySelector('#monitor'), { request: async () => ({
      identity: { broadcasterId: '123', userName: 'creator_test', displayName: 'Créateur test' }, accountConnected: true,
      capabilities: { chatRead: true, chatWrite: true }, chat: { connected: true, messages: [] },
    }) });
    win.monitor.update(win.data, { online: true, sourceKey: 'regie' });
    win.videoFrame = document.querySelector('[data-monitor-slot="video"] iframe');
    win.youtubeFrame = document.querySelector('[data-monitor-slot="youtube"] iframe');
  });
}

test('viewer login is local and closing it reloads only Twitch without claiming login success', async ({ page }) => {
  await setupViewerSession(page);
  const draft = page.getByLabel('Message Twitch', { exact: true });
  await expect(draft).toBeEnabled();
  await draft.fill('Brouillon conservé pendant la connexion');
  await page.getByRole('button', { name: 'Connexion visionneuse', exact: true }).click();
  await expect(page.locator('[data-monitor-viewer-status]')).toContainText('fenêtre de cet appareil');
  await expect(page.locator('[data-monitor-connect]')).toBeDisabled();
  expect(await page.evaluate(() => (window as any).viewerCalls)).toEqual([{ channel: 'creator_test' }]);
  expect(await page.evaluate(() => (window as any).videoFrame === document.querySelector('[data-monitor-slot="video"] iframe'))).toBe(true);
  await page.evaluate(() => (window as any).closeViewer());
  await expect(page.locator('[data-monitor-viewer-status]')).toContainText('Visionneuse rechargée');
  expect(await page.evaluate(() => (window as any).videoFrame === document.querySelector('[data-monitor-slot="video"] iframe'))).toBe(false);
  expect(await page.evaluate(() => (window as any).youtubeFrame === document.querySelector('[data-monitor-slot="youtube"] iframe'))).toBe(true);
  await expect(draft).toHaveValue('Brouillon conservé pendant la connexion');
  await expect(page.locator('[data-monitor-connect]')).toBeEnabled();
  await expect(page.locator('[data-monitor-viewer-status]')).not.toContainText('connectée');
});

test('a late viewer close cannot reload a newly selected source or the YouTube player', async ({ page }) => {
  await setupViewerSession(page);
  await page.getByRole('button', { name: 'Connexion visionneuse', exact: true }).click();
  await page.getByRole('button', { name: 'YouTube', exact: true }).click();
  await page.evaluate(() => { (window as any).currentFrame = document.querySelector('[data-monitor-slot="video"] iframe'); });
  await page.evaluate(() => (window as any).closeViewer());
  await expect(page.locator('[data-monitor-connect]')).toContainText('YouTube');
  expect(await page.evaluate(() => (window as any).currentFrame === document.querySelector('[data-monitor-slot="video"] iframe'))).toBe(true);
  await page.getByRole('button', { name: 'Twitch', exact: true }).click();
  await page.getByRole('button', { name: 'Connexion visionneuse', exact: true }).click();
  await page.evaluate(() => {
    const win = window as any;
    win.data.host.monitor.twitchLogin = 'another_test';
    win.monitor.update(win.data, { online: true, sourceKey: 'other-regie' });
    win.currentFrame = document.querySelector('[data-monitor-slot="video"] iframe');
    win.closeViewer();
  });
  await expect(page.locator('[data-monitor-connect]')).toBeEnabled();
  expect(await page.evaluate(() => (window as any).currentFrame === document.querySelector('[data-monitor-slot="video"] iframe'))).toBe(true);
  await expect(page.locator('[data-monitor-viewer-status]')).not.toContainText('Visionneuse rechargée');
});

test('native Twitch popup completion refreshes only an active Twitch frame and unsubscribes on destroy', async ({ page }) => {
  await setupViewerSession(page);
  await page.evaluate(() => (window as any).viewerClosed());
  expect(await page.evaluate(() => (window as any).videoFrame === document.querySelector('[data-monitor-slot="video"] iframe'))).toBe(false);
  expect(await page.evaluate(() => (window as any).youtubeFrame === document.querySelector('[data-monitor-slot="youtube"] iframe'))).toBe(true);
  await page.getByRole('button', { name: 'YouTube', exact: true }).click();
  await page.evaluate(() => { const win = window as any; win.currentFrame = document.querySelector('[data-monitor-slot="video"] iframe'); win.viewerClosed(); });
  expect(await page.evaluate(() => (window as any).currentFrame === document.querySelector('[data-monitor-slot="video"] iframe'))).toBe(true);
  await page.evaluate(() => { const win = window as any; win.monitor.destroy(); win.viewerClosed(); });
  expect(await page.evaluate(() => (window as any).viewerUnsubscribed)).toBe(true);
  await expect(page.locator('#monitor iframe')).toHaveCount(0);
});

async function setupCategoryPicker(page: Page, defer = false) {
  await page.evaluate(async deferred => {
    const win = window as any;
    document.querySelector('#chat')!.innerHTML = '<form id="category-form"><label>Rechercher un jeu ou une catégorie Twitch<input type="search" id="twitch-game-query"></label><input type="hidden" name="twitchGameId" value="460637"><p id="twitch-game-selected"></p><button type="button" data-twitch-category-search>Rechercher sur Twitch</button><div id="category-results"></div></form>';
    const form = document.querySelector<HTMLFormElement>('#category-form')!;
    const modulePath = '/mobile/control/twitch-category-picker.js';
    const module = await import(modulePath);
    win.categoryCalls = []; win.remembered = []; win.categoryCurrent = true; win.categoryPending = [];
    form.addEventListener('submit', event => { event.preventDefault(); win.unexpectedSubmit = true; });
    win.picker = module.createTwitchCategoryPicker(form, {
      initialName: deferred ? 'Dead Island 2' : '',
      isCurrent: () => win.categoryCurrent,
      remember: (game: unknown) => win.remembered.push(game),
      request: async (url: string) => {
        win.categoryCalls.push(url);
        if (deferred) return new Promise(resolve => win.categoryPending.push(resolve));
        return (await fetch(url)).json();
      },
    });
  }, defer);
}

test('category search uses q and resolves a saved game name after a fresh start', async ({ page }) => {
  await setupCategoryPicker(page);
  await expect(page.locator('#twitch-game-selected')).toHaveText('Jeu sélectionné : Dead Island 2');
  const query = page.getByLabel('Rechercher un jeu ou une catégorie Twitch');
  await query.fill('Minecraft'); await query.press('Enter');
  await page.getByRole('button', { name: 'Minecraft', exact: true }).click();
  await expect(page.locator('#twitch-game-selected')).toHaveText('Jeu sélectionné : Minecraft');
  await expect(page.locator('input[name="twitchGameId"]')).toHaveValue('27471');
  expect(await page.evaluate(() => (window as any).categoryCalls)).toEqual([
    '/api/v1/twitch/categories?id=460637', '/api/v1/twitch/categories?q=Minecraft',
  ]);
  expect(await page.evaluate(() => (window as any).unexpectedSubmit)).toBeUndefined();
});

test('late category results cannot replace a newer search or cross sources', async ({ page }) => {
  await setupCategoryPicker(page, true);
  const query = page.getByLabel('Rechercher un jeu ou une catégorie Twitch');
  await query.fill('Minecraft'); await query.press('Enter');
  await query.fill('Another'); await query.press('Enter');
  await page.evaluate(() => (window as any).categoryPending[0]([{ id: '27471', name: 'Minecraft' }]));
  await expect(page.locator('#category-results')).not.toContainText('Minecraft');
  await page.evaluate(() => { const win = window as any; win.categoryCurrent = false; win.categoryPending[1]([{ id: '123', name: 'Autre source' }]); });
  await expect(page.locator('#category-results')).not.toContainText('Autre source');
  await expect(page.locator('input[name="twitchGameId"]')).toHaveValue('460637');
});

test('invalid category responses are reported instead of pretending Twitch found no games', async ({ page }) => {
  await setupCategoryPicker(page, true);
  const query = page.getByLabel('Rechercher un jeu ou une catégorie Twitch');
  await query.fill('Minecraft'); await query.press('Enter');
  await page.evaluate(() => (window as any).categoryPending[0]({ unexpected: true }));
  await expect(page.locator('#category-results')).toContainText('Réponse Twitch illisible');
  await expect(page.locator('#twitch-game-selected')).toHaveText('Jeu sélectionné : Dead Island 2');
  await expect(page.getByRole('button', { name: 'Rechercher sur Twitch' })).toBeEnabled();
});

async function setupFeed(page: Page) {
  await page.clock.install();
  await page.evaluate(async () => {
    const win = window as any;
    const modulePath = '/mobile/control/streamlabs-feed.js';
    const module = await import(modulePath);
    win.calls = []; win.count = 0; win.pendingReads = [];
    win.feed = module.createStreamlabsFeed(document.querySelector('#feed'), {
      request: async (source: string) => {
        win.calls.push(source);
        if (win.defer === source) return new Promise(resolve => { win.pendingReads.push(resolve); });
        return { provider: { status: 'CONNECTED' }, items: [{ id: 'event', type: 'follow', platform: 'twitch', displayName: source + ' événement ' + win.count, receivedAt: new Date().toISOString() }] };
      }, configure: () => {},
    });
    win.sources = [{ id: 'regie', label: 'Régie · FIXE' }, { id: 'local', label: 'Cet appareil · Laptop' }];
    win.feed.update(win.sources, { workspaceKey: 'paired', preferredSource: 'regie' });
  });
  await expect(page.locator('.streamlabs-event')).toContainText('regie événement 0');
}

test('Streamlabs polls independently of renders or focus and stops after leaving the view', async ({ page }) => {
  await setupFeed(page);
  await page.getByLabel('Filtres et connexion Streamlabs', { exact: true }).click();
  await page.getByLabel('Plateforme Streamlabs').focus();
  await page.evaluate(() => { (window as any).count = 1; });
  await page.clock.fastForward(2600);
  await expect(page.locator('.streamlabs-event')).toContainText('regie événement 1');
  await expect(page.getByLabel('Plateforme Streamlabs')).toBeFocused();
  const before = await page.evaluate(() => { const win = window as any; win.feed.destroy(); return win.calls.length; });
  await page.clock.fastForward(7500);
  expect(await page.evaluate(() => (window as any).calls.length)).toBe(before);
});

test('Streamlabs defaults to the workspace source and remembers explicit choices only in that workspace', async ({ page }) => {
  await setupFeed(page);
  await page.evaluate(() => {
    const win = window as any;
    localStorage.setItem('sd2.streamlabs.source', 'local');
    win.feed.update([win.sources[1]], { workspaceKey: 'local-space', preferredSource: 'local' });
  });
  await expect(page.getByLabel('Source Streamlabs')).toHaveValue('local');
  await page.evaluate(() => { const win = window as any; win.feed.update(win.sources, { workspaceKey: 'paired', preferredSource: 'regie' }); });
  await expect(page.getByLabel('Source Streamlabs')).toHaveValue('regie');
  await expect(page.locator('[data-feed-source-info]')).toContainText('Source : Régie · FIXE');
  await page.getByLabel('Filtres et connexion Streamlabs', { exact: true }).click();
  await page.getByLabel('Source Streamlabs').selectOption('local');
  await page.evaluate(() => {
    const win = window as any;
    win.feed.update([win.sources[1]], { workspaceKey: 'local-space', preferredSource: 'local' });
    win.feed.update(win.sources, { workspaceKey: 'paired', preferredSource: 'regie' });
  });
  await expect(page.getByLabel('Source Streamlabs')).toHaveValue('local');
  await expect(page.locator('.streamlabs-event')).toContainText('local événement 0');
  expect(await page.evaluate(() => localStorage.getItem('sd2.streamlabs.source:paired'))).toBe('local');
});

test('late Streamlabs replies never overwrite the selected source or its history', async ({ page }) => {
  await setupFeed(page);
  await page.evaluate(() => { const win = window as any; win.defer = 'regie'; void win.feed.refresh(true); });
  await expect.poll(() => page.evaluate(() => (window as any).pendingReads.length)).toBe(1);
  await page.getByLabel('Filtres et connexion Streamlabs', { exact: true }).click();
  await page.getByLabel('Source Streamlabs').selectOption('local');
  await expect(page.locator('.streamlabs-event')).toContainText('local événement 0');
  await page.evaluate(() => {
    const win = window as any;
    win.pendingReads.shift()({ provider: { status: 'CONNECTED' }, items: [{ id: 'late', type: 'follow', platform: 'twitch', displayName: 'Réponse ancienne régie', receivedAt: new Date().toISOString() }] });
  });
  await expect(page.locator('.streamlabs-event')).toContainText('local événement 0');
  expect(await page.evaluate(() => localStorage.getItem('sd2.streamlabs.history:local'))).not.toContain('Réponse ancienne régie');
});

test('Android opens both chats and video in isolated native viewers without exposing controller bridges to frames',async({page})=>{
 await page.setViewportSize({width:900,height:1000});
 await page.evaluate(async()=>{
  const win=window as any;win.viewerRequests=[];
  win.StreamDashboardNative={openViewers:(value:string)=>{win.viewerRequests.push(JSON.parse(value));return true;}};
  const modulePath='/mobile/control/live-monitor.js',module=await import(modulePath);
  win.monitor=module.createLiveMonitor(document.querySelector('#monitor'),{native:true});
  win.monitor.update({host:{monitor:{twitchLogin:'creator_test'}},configuration:{youtube:{broadcastId:'Abc_1234-XY'}}},{online:false,sourceKey:'device-local'});
 });
 await expect(page.locator('#monitor iframe')).toHaveCount(0);
 await page.getByRole('button',{name:'Ouvrir vidéo et chats'}).first().click();
 expect(await page.evaluate(()=>(window as any).viewerRequests)).toEqual([{twitch:'creator_test',youtube:'Abc_1234-XY',source:'twitch'}]);
 await expect(page.locator('[data-monitor-viewer-status]')).toContainText('sessions web propres');
 await page.evaluate(()=>(window as any).monitor.destroy());
});
