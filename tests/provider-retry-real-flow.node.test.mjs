import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { startDashboardServer } from '../dist/apps/server/src/index.js';
import { MemorySecretStore } from '../dist/apps/server/src/storage.js';

// Real button -> HTTP -> orchestrator -> adapters. Only provider HTTP is simulated.
for (const provider of ['google', 'twitch']) for (const recurring of [false, true]) for (const identity of (provider === 'google' ? ['new', 'linked', 'deleted', 'cancelled'] : ['new', 'linked', 'deleted'])) {
  const linked = identity !== 'new';
  const updateExisting = identity === 'linked';
  test(`retry ${provider}, recurrence=${recurring ? 'weekly-1' : 'none'}, identity=${identity}: retry desired publication without duplicates`, async () => {
    const dataDir = await mkdtemp('.retry-flow-');
    const nativeFetch = globalThis.fetch;
    let server, browser;
    let denied = true;
    let missingFailure = updateExisting;
    let exists = updateExisting;
    const writes = [];
    // Hold the exact Windows failure scenario in flight: reaching provider HTTP
    // must not leave the obsolete recurrence rejection as the current error.
    let releaseMutation;
    const mutationGate = provider === 'twitch' && recurring && identity === 'new'
      ? new Promise(resolve => { releaseMutation = resolve; }) : Promise.resolve();
    const start = new Date(Date.now() + 86400000).toISOString(), end = new Date(Date.now() + 90000000).toISOString();
    const recurrence = recurring ? { frequency: 'weekly', interval: 1, timeZone: 'UTC' } : undefined;
    let remote = provider === 'google'
      ? { id: 'remote', etag: 'etag-1', summary: 'Old title', start: { dateTime: start, timeZone: 'UTC' }, end: { dateTime: end, timeZone: 'UTC' },
        recurrence: recurring ? ['RRULE:FREQ=WEEKLY;INTERVAL=1'] : [], extendedProperties: { private: { streamDashboardManaged: 'true', streamDashboardId: 'local' } } }
      : { id: 'remote', title: 'Old title', start_time: start, end_time: end, is_recurring: recurring, category: { id: '1', name: 'Game' } };
    try {
      await writeFile(`${dataDir}/dashboard.json`, JSON.stringify({ twitch: { broadcasterId: '42', userName: 'tester', displayName: 'Tester' },
        google: { targetCalendarId: 'calendar' }, planning: [{ id: 'local', localId: 'local', title: 'Desired title', category: 'live', startAtUtc: start, endAtUtc: end,
          twitchCategoryId: '1', recurrence, twitchRecurring: provider === 'twitch' && recurring,
          desiredPublication: { local: true, google: provider === 'google', twitch: provider === 'twitch' },
          providers: { [provider]: { status: 'error', remoteId: linked ? 'remote' : undefined, calendarId: 'calendar', remoteRevision: linked && provider === 'google' ? 'etag-1' : undefined,
            deletedRemotely: ['deleted', 'cancelled'].includes(identity), lastError: provider === 'twitch' && recurring ? 'La récurrence locale ne peut pas encore être représentée fidèlement sur twitch' : 'Previous publication failed' } } }] }));
      const secrets = new MemorySecretStore();
      await secrets.setGoogleTokens({ accessToken: 'google-token', refreshToken: 'refresh', expiresAt: String(Date.now() + 3600000) });
      await secrets.setTwitchTokens({ accessToken: 'twitch-token' });
      globalThis.fetch = async (input, init = {}) => {
        const url = String(input);
        if (!url.startsWith('https://')) return nativeFetch(input, init);
        if (url.includes('/validate')) return Response.json({ client_id: 'client', user_id: '42', scopes: ['channel:manage:schedule'] });
        if (url.includes('/calendarList')) return Response.json({ items: [{ id: 'calendar', summary: 'Calendar', accessRole: 'owner' }] });
        if (url.includes('/events') || url.includes('/schedule')) {
          if (url.includes('/events/remote') && !init.method && !exists) return identity === 'cancelled'
            ? Response.json({ id: 'remote', status: 'cancelled' })
            : Response.json({ error: { message: 'Gone' } }, { status: 410 });
          if (['POST', 'PATCH'].includes(init.method)) {
            const body = JSON.parse(init.body);
            writes.push({ method: init.method, url, body, etag: new Headers(init.headers).get('If-Match') });
            await mutationGate;
            if (denied) return Response.json({ message: 'Permission denied', error: { message: 'Permission denied' } }, { status: missingFailure ? 404 : 403 });
            remote = { ...remote, ...body, id: identity === 'cancelled' ? 'replacement' : 'remote', etag: 'etag-2' };
            exists = true;
          }
          if (url.includes('/schedule')) return Response.json({ data: { segments: exists ? [remote] : [] } });
          return Response.json(url.includes('/events/' + remote.id) || init.method === 'POST' ? remote : { items: exists ? [remote] : [] });
        }
        return Response.json({ data: [] });
      };
      server = await startDashboardServer({ port: 0, dataDir, secretStore: secrets, googleClientId: 'client', twitchClientId: 'client', logger: { info() {}, warn() {}, error() {} } });
      if (updateExisting) {
        // Reproduce the stale marker through the real error path, while the
        // provider still returns the linked object on subsequent reads.
        const failed = await nativeFetch(server.url + '/api/v1/planning/local/retry/' + provider, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        assert.equal(failed.ok, false);
        assert.equal(server.state().planning[0].providers[provider].deletedRemotely, true);
        assert.equal(server.state().planning[0].providers[provider].remoteId, 'remote');
        missingFailure = false;
        writes.length = 0;
      }
      browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
      const page = await browser.newPage();
      page.setDefaultTimeout(5000);
      await page.goto(server.url + '/preview/?runtime=1');
      await expect(page.locator('#runtime-status')).toHaveText('Runtime PC');
      await page.locator('[data-view="planning"]').click();
      await page.locator('[data-event-index]').first().click();
      page.on('dialog', dialog => dialog.accept());
      const retry = page.locator(`[data-provider-retry="${provider}"]`);
      await retry.click();
      await expect(page.locator('#event-dialog')).toBeVisible();
      await expect.poll(() => writes.length).toBe(1);
      assert.doesNotMatch(server.state().planning[0].providers[provider].lastError ?? '', /La récurrence locale ne peut pas encore/);
      if (releaseMutation) {
        const pending = JSON.parse(await readFile(`${dataDir}/dashboard.json`, 'utf8')).planning[0].providers.twitch;
        assert.equal(pending.status, 'pending');
        assert.equal(pending.lastError, undefined);
        const response = page.waitForResponse(value => value.url().endsWith('/retry/twitch') && value.request().method() === 'POST');
        releaseMutation();
        assert.equal((await response).ok(), false);
      }
      await expect(page.locator('#toast')).not.toContainText('La récurrence locale ne peut pas encore');
      if (provider === 'twitch' && recurring && !updateExisting) assert.equal(writes[0].body.is_recurring, true);
      assert.equal(writes[0].method, updateExisting ? 'PATCH' : 'POST');
      await expect(page.locator('body')).toContainText(/Permission|compte Twitch/);
      let item = server.state().planning[0];
      assert.equal(item.providers[provider].remoteId, updateExisting ? 'remote' : undefined);
      assert.equal(item.providers[provider].uncertainCreate, undefined);
      if (provider === 'google') assert.equal(item.providers.google.remoteRevision, updateExisting ? 'etag-1' : undefined);
      denied = false;
      await page.locator('#event-title').fill('Brouillon pendant retry');
      await retry.click();
      await expect(page.locator('#toast')).toContainText('Synchronisation relancée');
      await expect(page.locator('#event-dialog')).toBeVisible();
      await expect(page.locator('#event-title')).toHaveValue('Brouillon pendant retry');
      await page.keyboard.press('Escape');
      await expect(page.locator('#event-dialog')).not.toBeVisible();
      item = server.state().planning[0];
      assert.equal(item.providers[provider].status, 'synced');
      assert.equal(item.providers[provider].remoteId, identity === 'cancelled' ? 'replacement' : 'remote');
      assert.equal(item.desiredPublication[provider], true);
      assert.equal(item.providers[provider].deletedRemotely, false);
      assert.equal(item.providers[provider].lastError, undefined);
      if (provider === 'twitch') {
        assert.ok(item.providers.twitch.fingerprint);
        const persisted = JSON.parse(await readFile(`${dataDir}/dashboard.json`, 'utf8')).planning[0];
        assert.equal(persisted.providers.twitch.remoteId, item.providers.twitch.remoteId);
        assert.equal(persisted.providers.twitch.fingerprint, item.providers.twitch.fingerprint);
      }
      assert.equal(writes.filter(write => write.method === 'POST').length, updateExisting ? 0 : 2);
      assert.equal(writes[1].body[provider === 'google' ? 'summary' : 'title'], 'Desired title');
      if (provider === 'google') {
        assert.deepEqual(writes.map(write => write.etag), updateExisting ? ['etag-1', 'etag-1'] : [null, null]);
        assert.equal(item.providers.google.remoteRevision, 'etag-2');
      }
      const posts = writes.filter(write => write.method === 'POST').length;
      const repeated = await nativeFetch(server.url + '/api/v1/planning/local/retry/' + provider, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      assert.equal(repeated.status, 200, await repeated.text());
      assert.equal(writes.filter(write => write.method === 'POST').length, posts);
      if (identity === 'cancelled') {
        assert.equal(writes.at(-1).url.endsWith('/events/replacement'), true);
        assert.equal(writes.at(-1).etag, 'etag-2');
        assert.equal(server.state().planning[0].providers.google.remoteId, 'replacement');
        assert.equal(server.state().planning[0].providers.google.remoteRevision, 'etag-2');
      }
      // Android can hand over a conflict on the link without item.conflict.
      const conflictState = structuredClone(server.state());
      conflictState.planning[0].providers[provider].status = 'conflict';
      delete conflictState.planning[0].conflict;
      await page.route('**/api/v1/state', route => route.fulfill({ json: conflictState }));
      await page.routeWebSocket('**/ws/v1', () => {});
      await page.reload();
      await expect(page.locator('#runtime-status')).toHaveText('Runtime PC');
      await page.locator('[data-view="planning"]').click();
      await page.locator('[data-event-index]').first().click();
      await expect(page.locator(`[data-provider-conflict="${provider}"]`)).toHaveCount(2);
    } finally {
      releaseMutation?.();
      await browser?.close(); await server?.stop(); globalThis.fetch = nativeFetch;
      await rm(dataDir, { recursive: true, force: true });
    }
  });
}
