import { test, expect, type Page } from '@playwright/test';
import express from 'express';
import type { Server } from 'node:http';
import path from 'node:path';

const REGIE = 'https://regie.local:48136';
const DEVICE_CREDENTIAL = 'fake-mobile-activity-device-credential';
const FAVORITES = { version: 1, bank: 'favorites', soundCategory: 'Rires', favorites: ['action:scene-pause', 'action:micro'] };
const FAVORITES_KEY = 'sd2.performance-deck.v1:' + encodeURIComponent(REGIE);
const HISTORY_KEY = 'sd2.streamlabs.history:' + REGIE;
const FOLLOWER = 'Follower du compte de test';
const SUBSCRIBER = 'Abonnement du compte de test';

let server: Server, origin: string;
test.beforeAll(async () => {
  const app = express();
  app.use('/mobile', express.static(path.resolve('apps/mobile')));
  app.get('/activity-fixture', (_req, res) => res.send('<!doctype html><meta charset="utf-8"><title>Préparation du test mobile</title>'));
  server = await new Promise<Server>(resolve => { const running = app.listen(0, '127.0.0.1', () => resolve(running)); });
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

async function setupMobileActivity(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const backend = {
    offline: false,
    snapshot: null as any,
    calls: [] as { path: string; method: string; auth: string | undefined }[],
    unexpected: [] as string[],
    externalRequests: [] as string[],
    feed: {
      provider: { status: 'CONNECTED', lastError: null },
      retentionLimit: 100,
      history: { status: 'SYNCED', configured: true, count: 2, lastSyncAt: '2026-10-20T17:00:00.000Z', lastAttemptAt: '2026-10-20T17:00:00.000Z', lastError: null },
      items: [
        { id: 'cloud-follow-mobile', type: 'follow', platform: 'twitch', displayName: FOLLOWER, origin: 'cloud', occurredAt: '2026-10-18T16:12:00.000Z', receivedAt: '2026-10-20T17:00:00.000Z', message: 'merci'.repeat(24) },
        { id: 'cloud-sub-mobile', type: 'subscription', platform: 'twitch', displayName: SUBSCRIBER, subType: 'resub', months: 3, origin: 'cloud', occurredAt: '2026-10-19T18:20:00.000Z', receivedAt: '2026-10-20T17:00:00.000Z' },
      ],
    },
  };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install();
  await page.addInitScript(({ regie, credential, favoritesKey, favorites }) => {
    const win = window as any;
    if (!localStorage.getItem('test.mobile-activity-initialized')) {
      localStorage.setItem('test.mobile-activity-initialized', '1');
      localStorage.setItem('test.native-credential', credential);
      localStorage.setItem('sd2.device', JSON.stringify({ version: 1, name: 'Téléphone de test', role: 'mobile', configured: true }));
      localStorage.setItem('sd2.server', regie);
      localStorage.setItem('sd2.workspace-mode', 'paired');
      localStorage.setItem('sd2.page', 'deck');
      localStorage.setItem('sd2.performance-first', '1');
      localStorage.setItem('sd2.live-deck-intro', '1');
      localStorage.setItem(favoritesKey, JSON.stringify(favorites));
    }
    win.keepAwakeCalls = [];
    // Synthetic native replies exercise correlation and the real renderer;
    // the Java TLS integration test verifies certificates separately.
    win.StreamDashboardPeer={postMessage:async(raw:string)=>{
      const value=JSON.parse(raw);if(value.operation==='cancel')return;
      let result;
      try{const response=await fetch(value.url,{method:value.method,headers:{...(value.credential?{Authorization:'Device '+value.credential}:{}),...(value.body?{'Content-Type':'application/json'}:{})},body:value.body});result={ok:true,status:response.status,body:await response.text()};}
      catch{result={ok:false,error:{message:'synthetic transport unavailable'}};}
      win.dispatchEvent(new CustomEvent('peer-result',{detail:{id:value.id,result:JSON.stringify(result)}}));
    }};
    win.StreamDashboardNative = {
      isAndroid: () => true,
      getCredential: () => localStorage.getItem('test.native-credential') || '',
      setCredential: (value: string) => localStorage.setItem('test.native-credential', value),
      clearCredential: () => localStorage.removeItem('test.native-credential'),
      setKeepAwake: (value: boolean) => win.keepAwakeCalls.push(value),
      haptic: () => {},
    };
  }, { regie: REGIE, credential: DEVICE_CREDENTIAL, favoritesKey: FAVORITES_KEY, favorites: FAVORITES });
  // The only network that continues is the local asset server. The paired PC
  // is wholly synthetic, and an unexpected third-party request is blocked.
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === REGIE && url.pathname.startsWith('/api/')) {
      const method = request.method();
      backend.calls.push({ path: url.pathname, method, auth: request.headers().authorization });
      const headers = { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'Authorization, Content-Type', 'access-control-allow-methods': 'GET, OPTIONS' };
      if (method === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
      if (backend.offline) { await route.abort(); return; }
      let json: unknown;
      if (method === 'GET') {
        if (url.pathname === '/api/v2/autonomy') json = backend.snapshot;
        else if (url.pathname === '/api/v2/state') json = backend.snapshot.bundle.data;
        else if (url.pathname === '/api/v1/soundboard') json = backend.snapshot.bundle.sounds;
        else if (url.pathname === '/api/v2/replay') json = { active: true, available: true, enabled: true, seconds: 30 };
        else if (url.pathname === '/api/v1/streamlabs/events') json = backend.feed;
        else if (url.pathname === '/api/v1/supports/streamlabs/history/status') json = backend.feed.history;
      }
      if (json === undefined) {
        backend.unexpected.push(method + ' ' + url.pathname);
        await route.fulfill({ status: 501, headers, json: { error: { message: 'Appel inattendu dans le test mobile' } } });
      } else await route.fulfill({ headers, json });
      return;
    }
    if (url.origin === origin) { await route.continue(); return; }
    backend.externalRequests.push(request.url());
    await route.abort();
  });
  await page.goto(origin + '/activity-fixture');
  // Use the shipped workspace factory, including all resources needed by the
  // real autonomy store, planner imports and compact Deck bootstrap.
  backend.snapshot = await page.evaluate(async () => {
    const modulePath = '/mobile/control/device-workspace.js';
    const { newWorkspace } = await import(modulePath);
    const snapshot = newWorkspace({ version: 1, name: 'RÉGIE TEST', role: 'stream', configured: true });
    snapshot.workspace = 'mobile-activity-regie-fixture';
    const host = snapshot.bundle.data.host;
    host.standalone = false;
    host.settings.streamerName = 'Chaîne de test';
    host.settings.primaryMicInput = 'Mic';
    host.settings.modeScenes = { live: 'Jeu', pause: 'Pause', intro: 'Introduction' };
    host.state.mode = 'live';
    Object.assign(host.state.obs, { connected: true, streaming: true, scene: 'Jeu', inputs: { Mic: { muted: false } }, scenes: ['Jeu', 'Pause'] });
    snapshot.bundle.sounds.available = true;
    return snapshot;
  });
  await page.goto(origin + '/mobile/control/index.html');
  await expect(page.getByRole('heading', { name: 'Mon Deck', exact: true })).toBeVisible();
  await expect(page.locator('.deck-session-bar')).toHaveAttribute('data-online', 'true');
  await expect(page.locator('html')).toHaveClass(/compact-app/);
  expect(await page.evaluate(() => (window as any).keepAwakeCalls)).toEqual([true]);
  return { backend, errors };
}

async function openActivity(page: Page) {
  await page.locator('nav [data-page="activity"]').click();
  await expect(page.getByRole('heading', { name: 'Activité', exact: true })).toBeVisible();
  await expect(page.locator('.streamlabs-event')).toHaveCount(2);
  await expect(page.locator('[data-feed-summary-history]')).toHaveText('Historique à jour');
}

async function expectNoHorizontalOverflow(page: Page) {
  const size = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  expect(size.viewport).toBe(390);
  expect(size.document).toBeLessThanOrEqual(size.viewport + 1);
  expect(size.body).toBeLessThanOrEqual(size.viewport + 1);
}

test('the real native mobile page opens Activity from the bottom Deck navigation and preserves favorites', async ({ page }) => {
  const { backend, errors } = await setupMobileActivity(page);
  const activityEntry = page.locator('nav [data-page="activity"]');
  await expect(activityEntry).toBeInViewport();
  const entryBox = (await activityEntry.boundingBox())!;
  expect(entryBox.y).toBeGreaterThan(734);
  expect(entryBox.y + entryBox.height).toBeLessThanOrEqual(844);
  expect(await page.locator('.live-pad-grid [data-action]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-action')))).toEqual(['scene-pause', 'micro']);
  await openActivity(page);
  await expect(page.locator('.streamlabs-event').filter({ hasText: FOLLOWER })).toBeInViewport();
  await expect(page.locator('.streamlabs-event').filter({ hasText: SUBSCRIBER })).toBeInViewport();
  await expect(page.locator('.streamlabs-event').filter({ hasText: FOLLOWER }).locator('time')).toHaveAttribute('datetime', '2026-10-18T16:12:00.000Z');
  await expect(page.locator('[data-feed-summary-source]')).toHaveText('Régie · RÉGIE TEST');
  await expect(page.locator('[data-feed-summary-direct]')).toHaveText('Direct actif');
  expect(backend.calls.some(call => call.path === '/api/v1/streamlabs/events' && call.auth === 'Device ' + DEVICE_CREDENTIAL)).toBe(true);
  expect(backend.calls.filter(call => call.method === 'GET').every(call => call.auth === 'Device ' + DEVICE_CREDENTIAL)).toBe(true);
  const options = page.locator('[data-feed-options]');
  await expect(options).not.toHaveAttribute('open');
  await expect(page.getByLabel('Source Streamlabs')).not.toBeVisible();
  await expectNoHorizontalOverflow(page);
  await options.locator('summary').click();
  await expect(page.getByLabel('Source Streamlabs')).toHaveValue(REGIE);
  await page.getByLabel('Type d’événement Streamlabs').selectOption('follow');
  await expect(page.locator('.streamlabs-event')).toHaveCount(1);
  await expectNoHorizontalOverflow(page);
  await page.getByLabel('Type d’événement Streamlabs').selectOption('all');
  await options.locator('summary').click();
  await expect(page.locator('.streamlabs-event')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/mobile-activity-390.png', fullPage: true });
  await page.locator('nav [data-page="deck"]').click();
  await expect(page.getByRole('heading', { name: 'Mon Deck', exact: true })).toBeVisible();
  await expect(page.locator('[data-deck-bank="favorites"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.locator('.live-pad-grid [data-action]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-action')))).toEqual(['scene-pause', 'micro']);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), FAVORITES_KEY)).toEqual(FAVORITES);
  await expectNoHorizontalOverflow(page);
  expect(backend.unexpected).toEqual([]);
  expect(backend.externalRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('mobile Activity reloads its cloud history offline without claiming either connection is current', async ({ page }) => {
  const { backend, errors } = await setupMobileActivity(page);
  await openActivity(page);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).items.map((item: any) => item.id), HISTORY_KEY)).toEqual(['cloud-follow-mobile', 'cloud-sub-mobile']);
  backend.offline = true;
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Activité', exact: true })).toBeVisible();
  await expect(page.locator('.streamlabs-event')).toHaveCount(2);
  await expect(page.locator('[data-feed-events]')).toContainText(FOLLOWER);
  await expect(page.locator('[data-feed-events]')).toContainText(SUBSCRIBER);
  await expect(page.locator('[data-feed-summary-direct]')).toHaveText('Direct non confirmé');
  await expect(page.locator('[data-feed-summary-direct]')).toHaveAttribute('data-state', 'stale');
  await expect(page.locator('[data-feed-summary-history]')).toHaveText('Historique non confirmé');
  await expect(page.locator('[data-feed-summary-history]')).toHaveAttribute('data-state', 'stale');
  await expect(page.locator('[data-feed-options]')).not.toHaveAttribute('open');
  await page.clock.fastForward(5000);
  await expect(page.locator('.streamlabs-event')).toHaveCount(2);
  await expect(page.locator('[data-feed-summary-history]')).not.toHaveAttribute('data-state', 'ok');
  await expect(page.locator('[data-feed-history-status]')).not.toHaveClass(/succeeded/);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).history.count, HISTORY_KEY)).toBe(2);
  expect(await page.evaluate(() => localStorage.getItem('test.native-credential'))).toBe(DEVICE_CREDENTIAL);
  await expectNoHorizontalOverflow(page);
  expect(backend.unexpected).toEqual([]);
  expect(backend.externalRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('Mon espace isolates native mobile Activity from the previously paired Streamlabs account', async ({ page }) => {
  const { backend, errors } = await setupMobileActivity(page);
  await openActivity(page);
  // Activity deliberately hides the general header to maximize the live list.
  // Reach the workspace control through the shipped Gestion navigation.
  await page.locator('nav [data-page="manage"]').click();
  await expect(page.getByRole('heading', { name: 'Gestion', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mon espace', exact: true }).click();
  await expect(page.locator('#connection')).toContainText('Espace de cet appareil');
  await page.locator('nav [data-page="activity"]').click();
  await expect(page.getByRole('heading', { name: 'Activité', exact: true })).toBeVisible();
  await expect(page.locator('#activity-context')).toContainText('Historique Streamlabs de cet appareil');
  await expect(page.locator('[data-feed-summary-source]')).toHaveText('Cet appareil · historique Streamlabs');
  await expect(page.locator('.streamlabs-event')).toHaveCount(0);
  await expect(page.locator('#streamlabs-feed')).not.toContainText(FOLLOWER);
  await expect(page.locator('#streamlabs-feed')).not.toContainText(SUBSCRIBER);
  await expect(page.locator('[data-feed-summary-history]')).not.toHaveAttribute('data-state', 'ok');
  await expect(page.locator('[data-feed-history-status]')).not.toHaveClass(/succeeded/);
  await page.locator('[data-feed-options] > summary').click();
  await expect(page.locator('[data-feed-source] option')).toHaveCount(1);
  await expect(page.locator('[data-feed-status]')).toContainText('Mettez à jour cette application pour configurer l’historique Streamlabs sur cet appareil.');
  await expect(page.locator('[data-feed-summary-direct]')).not.toHaveAttribute('data-state', 'ok');
  await page.getByRole('button', { name: 'Configurer Streamlabs' }).click();
  // This old Android fixture deliberately has no provider bridge. Its local
  // configuration must report that fact, not promise a fictitious connection.
  await expect(page.locator('#streamlabs-feed-config')).toHaveCount(0);
  await expect(page.locator('[data-streamlabs-history-status]')).toContainText('Mettez à jour cette application');
  await expect(page.locator('[data-streamlabs-history-status]')).not.toHaveClass(/succeeded/);
  await page.getByLabel('URL d’un widget Streamlabs').fill('https://streamlabs.com/widgets/event-list?token=fake-unavailable-bridge');
  await page.locator('#streamlabs-history-config').getByRole('button', { name: 'Enregistrer et récupérer l’historique' }).click();
  await expect(page.locator('[data-streamlabs-history-status]')).toContainText('Mettez à jour cette application');
  await expect(page.locator('[data-streamlabs-history-clear]')).toBeDisabled();
  await page.locator('[data-task="close-dialog"]').click();
  await page.locator('[data-feed-options] > summary').click();
  const pairedReads = backend.calls.filter(call => call.path === '/api/v1/streamlabs/events').length;
  await page.clock.fastForward(5000);
  expect(backend.calls.filter(call => call.path === '/api/v1/streamlabs/events').length).toBe(pairedReads);
  await expect(page.locator('.streamlabs-event')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('sd2.workspace-mode'))).toBe('local');
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).history.count, HISTORY_KEY)).toBe(2);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), FAVORITES_KEY)).toEqual(FAVORITES);
  await expectNoHorizontalOverflow(page);
  expect(backend.unexpected).toEqual([]);
  expect(backend.externalRequests).toEqual([]);
  expect(errors).toEqual([]);
});
