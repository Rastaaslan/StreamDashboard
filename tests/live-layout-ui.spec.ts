import { test, expect, type Locator, type Page } from '@playwright/test';
import express from 'express';
import { readFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import path from 'node:path';

let server: Server, origin: string;
const overview = `<div id="live-overview"><h1>Le live</h1><p class="subtitle">Votre live, vos scènes et vos interactions. Une régie pour tous vos appareils.</p><div class="grid statuses">${['OBS Studio', 'Twitch', 'YouTube'].map(label => `<div class="panel status-card"><span class="platform-icon">●</span><div><b>${label}</b><small>Connecté · état confirmé</small></div></div>`).join('')}</div></div>`;
const controls = `<div id="live-controls"><div class="grid columns"><section class="panel live-hero"><h2>Commandes du live</h2><p class="hero-title">Un live de test</p><p class="scene-label">Scène actuelle · Jeu</p><div class="live-tools"><button type="button">Diffusion en cours</button><button type="button" class="danger">Arrêter les deux</button></div></section><section class="panel"><h2>Minuteur du stream</h2><div class="timer">05:00</div><p class="small muted">Votre minuteur reste disponible sous les écrans.</p></section></div><section class="spacer"><h2>À portée de main</h2><div class="deck">${['Micro', 'Scène Jeu', 'Pause', 'Clip', 'Applaudissements', 'Fin'].map(label => `<button type="button"><span>◇</span>${label}<small>Commande de test</small></button>`).join('')}</div></section></div>`;

test.beforeAll(async () => {
  // Keep the shipped navigation, header and both stylesheets. Only control.js
  // orchestration is replaced by synthetic inputs to the real display modules.
  const shell = await readFile(path.resolve('apps/mobile/control/index.html'), 'utf8');
  const contentSlot = '<main id="content" tabindex="-1"></main>';
  if (!shell.includes(contentSlot)) throw new Error('Update the layout fixture for the changed main shell.');
  const documentFor = (activity: boolean) => {
    const content = activity
      ? '<h1>Activité</h1><p class="subtitle">Follows, abonnements et soutien de votre communauté.</p><div id="streamlabs-feed"></div>'
      : `${overview}<div id="live-monitor"></div><div id="streamlabs-feed"></div>${controls}`;
    return shell
      .replace(/<script\b[^>]*\bsrc=["']control\.js["'][^>]*><\/script>/g, '')
      .replace('<head>', '<head><base href="/mobile/control/">')
      .replace('<body>', `<body class="${activity ? 'activity' : 'live'}-page">`)
      .replace(contentSlot, `<main id="content" tabindex="-1">${content}</main>`);
  };
  const app = express();
  app.use('/mobile', express.static(path.resolve('apps/mobile')));
  app.get('/', (_req, res) => res.send(documentFor(false)));
  app.get('/activity', (_req, res) => res.send(documentFor(true)));
  server = await new Promise<Server>(resolve => { const running = app.listen(0, '127.0.0.1', () => resolve(running)); });
  origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
});
test.afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});
test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => {
    if (route.request().url().startsWith(origin + '/')) return route.continue();
    // Exercise real iframe mounting without contacting Twitch or YouTube.
    if (route.request().resourceType() === 'document') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Plateforme simulée</title><p>Retour de test</p>' });
    return route.abort();
  });
});
test.afterEach(async ({ page }) => {
  await page.evaluate(() => {
    (window as any).layoutFeed?.destroy();
    (window as any).layoutMonitor?.destroy();
  });
});

async function setup(page: Page, activity = false) {
  await page.goto(origin + (activity ? '/activity' : '/'));
  await page.evaluate(async standalone => {
    const win = window as any;
    localStorage.clear();
    document.documentElement.classList.toggle('compact-app', standalone);
    document.querySelectorAll<HTMLButtonElement>('nav [data-page]').forEach(button => button.classList.toggle('active', button.dataset.page === (standalone ? 'activity' : 'live')));
    document.querySelector('#connection')!.textContent = 'Régie connectée · copie locale à jour';
    const feedModulePath = '/mobile/control/streamlabs-feed.js';
    const feedModule = await import(feedModulePath);
    const now = Date.now();
    const kinds = ['follow', 'subscription', 'donation', 'bits', 'raid'];
    win.layoutItems = Array.from({ length: 40 }, (_, index) => ({
      id: 'activity-' + index, platform: 'twitch', type: kinds[index % kinds.length],
      displayName: index === 4 ? 'ViewerAvecUnPseudoTresLong'.repeat(4) : ['Ada', 'Luna', 'Sam', 'Alex'][index % 4] + ' ' + (index + 1),
      message: index === 4 ? 'https://example.invalid/' + 'message-sans-espace'.repeat(10) : index < 2 ? '' : 'Merci pour le live !',
      ...(index % 5 === 1 ? { subType: 'subgift', recipient: 'Dam', months: 1 } : {}),
      ...(index % 5 === 2 ? { amountLabel: '5,00 €' } : {}),
      ...(index % 5 === 3 ? { count: 100 } : {}),
      ...(index % 5 === 4 ? { count: 12 } : {}),
      origin: 'cloud', occurredAt: new Date(now - index * 60_000).toISOString(), receivedAt: new Date(now).toISOString(),
    }));
    win.layoutFeedReads = 0;
    win.layoutFeed = feedModule.createStreamlabsFeed(document.querySelector('#streamlabs-feed'), {
      request: async () => {
        win.layoutFeedReads++;
        return {
          provider: { status: 'CONNECTED' },
          history: { status: 'SYNCED', configured: true, count: win.layoutItems.length, lastSyncAt: new Date(now).toISOString(), lastAttemptAt: new Date(now).toISOString(), lastError: null },
          items: structuredClone(win.layoutItems),
        };
      }, configure: () => {},
    });
    win.layoutSources = [{ id: 'regie', label: 'Régie · PC de stream' }];
    if (!standalone) {
      const monitorModulePath = '/mobile/control/live-monitor.js';
      const monitorModule = await import(monitorModulePath);
      win.layoutState = { host: { hostname: 'PC de stream', monitor: { twitchLogin: 'creator_test' } }, configuration: { youtube: { broadcastId: 'Abc_1234-XY' } } };
      win.layoutContext = { online: true, sourceKey: 'regie' };
      win.layoutMonitor = monitorModule.createLiveMonitor(document.querySelector('#live-monitor'), {
        activityRoot: document.querySelector('#streamlabs-feed'),
        request: async () => ({
          identity: { broadcasterId: '123', userName: 'creator_test', displayName: 'Créateur test' },
          accountConnected: true, capabilities: { chatRead: true, chatWrite: true },
          chat: { connected: true, messages: Array.from({ length: 60 }, (_, index) => ({
            id: 'chat-' + index, broadcasterId: '123',
            chatter: { id: '456', login: 'viewer_test', displayName: 'Viewer', badges: [] },
            text: 'Message Twitch de test ' + (index + 1), receivedAt: new Date(now - (60 - index) * 1_000).toISOString(),
          })) },
        }),
      });
      win.layoutMonitor.update(win.layoutState, win.layoutContext);
    }
    win.layoutFeed.update(win.layoutSources, { workspaceKey: 'paired', preferredSource: 'regie' });
  }, activity);
  await expect(page.locator('.streamlabs-event')).toHaveCount(40);
  if (!activity) await expect(page.getByLabel('Message Twitch', { exact: true })).toBeEnabled();
  await page.waitForFunction(() => Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).every(link => link.sheet));
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

async function scrollToMonitor(page: Page) {
  await page.locator('#live-monitor').evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }));
}

async function noHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    listWidth: document.querySelector('[data-feed-events]')!.clientWidth,
    listScrollWidth: document.querySelector('[data-feed-events]')!.scrollWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport + 1);
  expect(widths.listScrollWidth).toBeLessThanOrEqual(widths.listWidth + 1);
}

async function documentBox(locator: Locator) {
  return locator.evaluate(element => {
    const box = element.getBoundingClientRect();
    return { x: box.left + scrollX, y: box.top + scrollY, width: box.width, height: box.height };
  });
}

for (const viewport of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
  test(`live activity and both chats fit together at ${viewport.width}px without options shifting the chats`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await setup(page);
    await expect(page.locator('.monitor-grid-with-activity > #streamlabs-feed')).toHaveCount(1);
    await scrollToMonitor(page);
    const chats = page.locator('#live-monitor .monitor-chat');
    await expect(chats).toHaveCount(2);
    const video = await documentBox(page.locator('.monitor-video'));
    const activity = await documentBox(page.locator('#streamlabs-feed'));
    const firstChat = await documentBox(chats.nth(0));
    const secondChat = await documentBox(chats.nth(1));
    expect(Math.abs(activity.x - video.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(activity.width - video.width)).toBeLessThanOrEqual(1);
    expect(activity.y).toBeGreaterThanOrEqual(video.y + video.height - 1);
    expect(firstChat.x).toBeGreaterThanOrEqual(video.x + video.width);
    expect(secondChat.x).toBeGreaterThanOrEqual(firstChat.x + firstChat.width);
    expect(Math.abs(firstChat.y - video.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(secondChat.y - firstChat.y)).toBeLessThanOrEqual(1);
    for (let index = 0; index < 2; index++) {
      await expect(page.locator('.streamlabs-event').nth(index)).toBeInViewport({ ratio: 0.9 });
      await expect(chats.nth(index)).toBeInViewport({ ratio: 0.75 });
    }
    await expect(page.getByLabel('Message Twitch', { exact: true })).toBeInViewport({ ratio: 1 });
    for (const selector of ['[data-feed-events]', '[data-twitch-messages]']) {
      const list = await page.locator(selector).evaluate(element => ({ height: element.clientHeight, content: element.scrollHeight, overflow: getComputedStyle(element).overflowY }));
      expect(list.content).toBeGreaterThan(list.height);
      expect(['auto', 'scroll']).toContain(list.overflow);
    }
    await noHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`live-layout-${viewport.width}.png`) });

    await page.locator('[data-feed-options] > summary').click();
    await expect(page.locator('[data-feed-options]')).toHaveJSProperty('open', true);
    for (const [index, before] of [firstChat, secondChat].entries()) {
      const after = await documentBox(chats.nth(index));
      for (const dimension of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(after[dimension] - before[dimension])).toBeLessThanOrEqual(1);
    }
    await noHorizontalOverflow(page);
  });
}

test('refresh preserves both platform frames and the Twitch draft inside the combined layout', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await setup(page);
  const draft = page.getByLabel('Message Twitch', { exact: true });
  await draft.fill('Brouillon à garder pendant les actualisations');
  const reads = await page.evaluate(() => {
    const win = window as any;
    win.savedVideo = document.querySelector('[data-monitor-slot="video"] iframe');
    win.savedYouTubeChat = document.querySelector('[data-monitor-slot="youtube"] iframe');
    win.savedDraft = document.querySelector('[aria-label="Message Twitch"]');
    win.layoutItems[0].displayName = 'Nouveau follow reçu';
    return win.layoutFeedReads;
  });
  await page.locator('#streamlabs-feed').getByRole('button', { name: 'Actualiser', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).layoutFeedReads)).toBeGreaterThan(reads);
  await expect(page.locator('.streamlabs-event').first()).toContainText('Nouveau follow reçu');
  await page.evaluate(() => {
    const win = window as any;
    win.layoutMonitor.update(win.layoutState, win.layoutContext);
    win.layoutFeed.update(win.layoutSources, { workspaceKey: 'paired', preferredSource: 'regie' });
  });
  expect(await page.evaluate(() => {
    const win = window as any;
    return Boolean(win.savedVideo && win.savedYouTubeChat && win.savedDraft)
      && win.savedVideo === document.querySelector('[data-monitor-slot="video"] iframe')
      && win.savedYouTubeChat === document.querySelector('[data-monitor-slot="youtube"] iframe')
      && win.savedDraft === document.querySelector('[aria-label="Message Twitch"]');
  })).toBe(true);
  await expect(draft).toHaveValue('Brouillon à garder pendant les actualisations');
});

test('hiding the screens leaves the same activity feed visible and refreshable', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await setup(page);
  await page.evaluate(() => { (window as any).savedFeed = document.querySelector('#streamlabs-feed'); });
  await page.getByRole('button', { name: 'Masquer les écrans', exact: true }).click();
  await expect(page.locator('#live-monitor iframe')).toHaveCount(0);
  await expect(page.locator('#streamlabs-feed')).toBeVisible();
  await expect(page.locator('.streamlabs-event')).toHaveCount(40);
  await page.locator('#streamlabs-feed').scrollIntoViewIfNeeded();
  await expect(page.locator('.streamlabs-event').first()).toBeInViewport({ ratio: 0.9 });
  const reads = await page.evaluate(() => (window as any).layoutFeedReads);
  await page.locator('#streamlabs-feed').getByRole('button', { name: 'Actualiser', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).layoutFeedReads)).toBeGreaterThan(reads);
  expect(await page.evaluate(() => (window as any).savedFeed === document.querySelector('#streamlabs-feed'))).toBe(true);
  await noHorizontalOverflow(page);
});

test('the mobile activity page keeps the feed and Deck navigation available at 390px', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, true);
  await expect(page.getByRole('heading', { name: 'Activité', exact: true })).toBeVisible();
  await expect(page.locator('nav [data-page="activity"]')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('nav [data-page="deck"]')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('#streamlabs-feed')).toBeVisible();
  await expect(page.locator('.streamlabs-event').first()).toBeInViewport({ ratio: 0.9 });
  await expect(page.locator('iframe')).toHaveCount(0);
  await noHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('activity-mobile-390.png') });
  await page.locator('[data-feed-options] > summary').click();
  await expect(page.getByLabel('Source Streamlabs')).toBeVisible();
  await expect(page.getByLabel('Source Streamlabs')).toHaveValue('regie');
  await noHorizontalOverflow(page);
});
