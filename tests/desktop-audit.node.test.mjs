import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { WebSocketServer } from 'ws';
import { chromium } from '@playwright/test';

// Static UI + intercepted provider calls: no credentials or real provider actions.
test('Desktop audit: guards, thumbnails, chat focus, destinations and overflow', async () => {
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    const file = path.startsWith('/mobile/') ? `apps${path}` : `apps/web${path === '/preview/' ? '/preview/index.html' : path}`;
    try { res.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(await readFile(file)); }
    catch { res.writeHead(404).end(); }
  });
  let socket;
  const sockets = new WebSocketServer({ server, path: '/ws/v1' });
  sockets.on('connection', client => { socket = client; });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    page.setDefaultTimeout(5000);
    await page.addInitScript(() => {
      const listeners = new WeakMap();
      const add = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function(type, ...args) {
        if (!listeners.has(this)) listeners.set(this, new Set());
        listeners.get(this).add(type);
        return add.call(this, type, ...args);
      };
      window.unhandledButtons = () => [...document.querySelectorAll('button')].filter(button => {
        if (!button.checkVisibility() || button.disabled || button.onclick || listeners.get(button)?.has('click')) return false;
        if (button.type === 'submit' && (button.form?.onsubmit || listeners.get(button.form)?.has('submit'))) return false;
        return !button.closest('[data-delegated]');
      }).map(button => button.outerHTML);
    });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => route.fulfill({ json: {} }));
    let oauthAuthorized=false,oauthRequests=0,oauthStatusFails=false;
    await page.route('**/api/v1/supports/streamlabs/oauth/status', route => {
      oauthRequests++;
      if(oauthStatusFails)return route.fulfill({ status:503,json:{error:'OAuth status unavailable'} });
      return route.fulfill({ json: { configured: true, authorized: oauthAuthorized } });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/preview/`);
    await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
    await page.evaluate(() => {
      const s = window.__preview.state;
      s.runtime = true; s.runtimeAvailable = true; s.timerRunning = true; s.seconds = 60;
      Object.keys(s.productProfile.modules).forEach(key => s.productProfile.modules[key] = true);
      s.dashboard = {
        obs: { connected: false }, settings: {}, twitch: { connected: true, capabilities: { chatWrite: true, schedule: false } },
        google: { configured: true, connected: true, targetCalendarId: 'readonly', calendars: [{ id: 'readonly', summary: 'Lecture seule', writable: false }, { id: 'chosen', summary: 'Mon calendrier', writable: true }] },
        discord: { configured: true, connected: true },
        controlHub: { live: { isLive: true, thumbnailUrl: 'https://static-cdn.jtvnw.net/live.jpg' }, chat: { connected: true, messages: [] }, audience: { viewerCount: 5, chatters: Array.from({ length: 125 }, (_, i) => ({ id: `${i}`, displayName: 'LongName'.repeat(12), role: i === 0 ? 'moderator' : 'viewer' })) }, integrations: { streamlabs: { status: 'DISCONNECTED' }, wizebot: { status: 'NOT_CONFIGURED' } } }
      };
    });
    // Connect the application's real WebSocket handler via its normal runtime refresh.
    const runtime = await page.evaluate(() => {
      const s = window.__preview.state;
      s.dashboard.timer = { running: true, remaining: 60 };
      return { dashboard: s.dashboard, profile: s.productProfile, modules: s.moduleStates };
    });
    await page.route('**/api/v1/state', route => route.fulfill({ json: runtime.dashboard }));
    await page.route('**/api/v1/profile', route => route.fulfill({ json: { profile: runtime.profile, modules: runtime.modules } }));
    await page.route('**/api/v1/soundboard', route => route.fulfill({ json: { sounds: [] } }));
    await page.locator('[data-view="camp"]').click();
    await page.locator('[data-refresh-prelive]').click();
    await page.waitForFunction(() => document.querySelector('#runtime-status').textContent === 'Runtime PC');
    assert.ok(socket, 'Production WebSocket connected');
    // Wait for the onopen refresh before starting the interaction checks.
    await page.waitForTimeout(100);
    let imageRequests = 0;
    await page.route('https://static-cdn.jtvnw.net/**', async route => {
      imageRequests++;
      if (imageRequests === 1) return route.abort();
      await route.fulfill({ contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64') });
    });
    await page.locator('[data-view="live"]').click();
    await page.locator('.audience-details summary').click();
    assert.equal(await page.locator('.audience-list>span').count(), 125);
    assert.match(await page.locator('.audience-list').innerText(), /Modérateur/);
    assert.equal(await page.locator('[data-live-toggle]').isDisabled(), true);
    assert.match(await page.locator('[data-live-toggle]').getAttribute('title'), /OBS hors ligne/);
    const emit = async (number, connected = true) => {
      runtime.dashboard.controlHub.audience.viewerCount = 40 + number;
      runtime.dashboard.controlHub.chat.connected = connected;
      runtime.dashboard.controlHub.chat.messages.push({ chatter: { displayName: 'Alice' }, text: `Message WS ${number}`, receivedAt: '2026-09-28T12:00:00Z' });
      runtime.dashboard.controlHub.live.title = `Titre WS ${number}`;
      runtime.dashboard.obs.connected = number % 2 === 1;
      runtime.dashboard.controlHub.audience.chatters[0].displayName = `Participant ${number}`;
      runtime.dashboard.controlHub.audience.chatters[0].role = number % 2 === 1 ? 'vip' : 'moderator';
      socket.send(JSON.stringify({ type: 'state.updated', data: runtime.dashboard }));
      await page.waitForFunction(n => document.querySelector('.live-hero-desktop h2').textContent === `Titre WS ${n}`, number);
      assert.match(await page.locator('.live-chat-panel .section-head .label').innerText(), new RegExp(`${40 + number} viewers`));
      assert.equal(await page.locator('[data-live-toggle]').isDisabled(), number % 2 !== 1);
      assert.match(await page.locator('.audience-list').innerText(), new RegExp(`Participant ${number}`));
      assert.equal(await page.locator('.audience-list small').first().innerText(), number % 2 === 1 ? 'VIP' : 'Modérateur');
      assert.match(await page.locator('#runtime-copy').innerText(), number % 2 === 1 ? /OBS connecté/ : /OBS hors ligne/);
    };
    for (const number of [1, 2, 3]) {
      await emit(number);
      assert.match(await page.locator('.desktop-chat-list').innerText(), new RegExp(`Message WS ${number}`));
      assert.equal(await page.locator('.audience-details summary').evaluate(el => el === document.activeElement), true);
      assert.equal(await page.locator('.audience-details').evaluate(el => el.open), true);
    }
    const chat = page.getByRole('textbox', { name: 'Message Twitch' });
    await chat.fill('Brouillon conservé');
    await chat.evaluate(input => input.setSelectionRange(4, 9));
    for (const number of [4, 5, 6]) {
      await emit(number, number !== 5);
      assert.match(await page.locator('.desktop-chat-list').innerText(), number === 5 ? /Chat hors ligne/ : new RegExp(`Message WS ${number}`));
      assert.equal(await chat.inputValue(), 'Brouillon conservé');
      assert.equal(await chat.evaluate(el => el === document.activeElement), true);
      assert.deepEqual(await chat.evaluate(el => [el.selectionStart, el.selectionEnd]), [4, 9]);
      assert.equal(await page.locator('.audience-details').evaluate(el => el.open), true);
    }
    await page.waitForTimeout(1200);
    assert.equal(await chat.inputValue(), 'Brouillon conservé');
    assert.equal(await chat.evaluate(el => el === document.activeElement), true);
    // Deferred structural changes catch up on focus leaving the view, without losing drafts.
    await page.locator('#content').focus();
    await page.waitForTimeout(50);
    assert.equal(await chat.inputValue(), 'Brouillon conservé');
    assert.equal(await page.locator('.audience-details').evaluate(el => el.open), true);
    const retry = page.getByRole('button', { name: 'Rafraîchir la miniature' });
    await retry.click();
    await page.waitForSelector('#live-thumbnail canvas');
    assert.equal(imageRequests, 2);
    assert.deepEqual(await page.evaluate(() => window.unhandledButtons()), []);
    for (const width of [1100, 900]) {
      await page.setViewportSize({ width, height: 800 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Live overflow at ${width}`);
    }
    await page.locator('[data-view="camp"]').click();
    await page.locator('[data-camp="Connexions"]').click();
    const twitchSync = page.locator('[data-connection-action="twitch-sync"]');
    assert.equal(await twitchSync.isDisabled(), true, 'Connected Twitch without Planning scope');
    assert.match(await twitchSync.getAttribute('title'), /Planning/);
    for (const schedule of [true, false, true]) {
      runtime.dashboard.twitch.capabilities.schedule = schedule;
      socket.send(JSON.stringify({ type: 'state.updated', data: runtime.dashboard }));
      await page.waitForFunction(expected => document.querySelector('[data-connection-action="twitch-sync"]').disabled === !expected, schedule);
      if (!schedule) {
        const reason = await twitchSync.getAttribute('aria-describedby');
        assert.match(await page.locator('#' + reason).innerText(), /Planning/);
      } else {
        assert.equal(await twitchSync.getAttribute('aria-describedby'), null);
      }
    }
    for (const action of ['google-sync', 'streamlabs-test-real', 'discord-settings-save', 'obs-launch', 'wizebot-refresh']) {
      const button = page.locator(`[data-connection-action="${action}"]`);
      assert.equal(await button.isDisabled(), true, action);
      assert.ok(await button.getAttribute('aria-describedby'), action);
    }
    assert.equal(await page.locator('[data-connection-action="streamlabs-test"]').isEnabled(), true);
    assert.match(await page.locator('#camp-copy').innerText(), /simulation locale, sans Alert Box/);
    let obsTests = 0;
    await page.route('**/api/v1/obs/test', async route => {
      obsTests++;
      await new Promise(resolve => setTimeout(resolve, 100));
      await route.fulfill({ status: 503, json: { error: 'OBS indisponible pour ce test' } });
    });
    const obsTest = page.locator('[data-connection-action="obs-test"]');
    await obsTest.click();
    assert.equal(await obsTest.getAttribute('aria-busy'), 'true');
    await obsTest.evaluate(button => button.click());
    await page.waitForFunction(() => !document.querySelector('[data-connection-action="obs-test"]').disabled);
    assert.equal(obsTests, 1);
    assert.match(await page.locator('#toast').innerText(), /OBS indisponible pour ce test/);
    await page.route('**/api/v1/discord/status', route => route.fulfill({ json: runtime.dashboard.discord }));
    await page.route('**/api/v1/discord/guilds', route => route.fulfill({ json: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] }));
    await page.route('**/api/v1/discord/guilds/*/channels', async route => {
      const a = route.request().url().includes('/a/');
      if(a) await new Promise(resolve => setTimeout(resolve, 200));
      await route.fulfill({ json: [{ id: a ? 'old' : 'new', name: a ? 'ancien' : 'nouveau' }] });
    });
    await page.locator('[data-connection-action="discord-load"]').click();
    await page.waitForSelector('#preview-discord-guild option[value="a"]', { state: 'attached' });
    await page.locator('#preview-discord-guild').selectOption('a');
    await page.locator('#preview-discord-guild').selectOption('b');
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#preview-discord-channel option[value="old"]').count(), 0);
    await page.locator('#preview-discord-channel').selectOption('new');
    assert.equal(await page.locator('[data-connection-action="discord-settings-save"]').isEnabled(), true);
    // Provider snapshots must override the older /connections projection while editing.
    await page.evaluate(() => {
      window.__preview.state.connections = ['obs','google','discord','twitch','streamlabs','wizebot'].map(id => ({ id, status: 'disconnected', capabilities: ['configure'], message: 'Ancien état déconnecté' }));
      document.querySelector('#preview-google-calendar').value = 'chosen';
    });
    const messageDraft = page.locator('#preview-discord-message');
    const tokenDraft = page.locator('#preview-discord-token');
    await messageDraft.fill('Destination et brouillon conservés');
    await tokenDraft.fill('brouillon-local');
    for (const focus of [page.locator('[data-connection-control="google-auth"]'), messageDraft]) {
      await focus.focus();
      for (const connected of [true, false, true]) {
        runtime.dashboard.obs.connected = connected;
        runtime.dashboard.google.connected = connected;
        runtime.dashboard.discord.connected = connected;
        runtime.dashboard.twitch.connected = connected;
        runtime.dashboard.controlHub.integrations.streamlabs.status = connected ? 'CONNECTED' : 'DISCONNECTED';
        runtime.dashboard.controlHub.integrations.wizebot.status = connected ? 'CONNECTED' : 'DISCONNECTED';
        socket.send(JSON.stringify({ type: 'state.updated', data: runtime.dashboard }));
        await page.waitForFunction(expected => document.querySelector('[data-connection-id="obs"] .section-head .label').textContent === expected, connected ? 'Connecté' : 'Déconnecté');
        for (const id of ['google','twitch','streamlabs','wizebot']) {
          assert.match(await page.locator(`[data-connection-id="${id}"] .section-head .label`).innerText(), connected ? /^Connecté/ : /^Déconnecté/);
        }
        assert.match(await page.locator('[data-connection-id="discord"] .section-head .label').innerText(), connected ? /^Connecté/ : /non connecté/);
        assert.equal(await page.locator('[data-connection-control="google-auth"]').getAttribute('data-connection-action'), connected ? 'google-disconnect' : 'google-connect');
        assert.equal(await page.locator('[data-connection-control="twitch-auth"]').getAttribute('data-connection-action'), connected ? 'twitch-disconnect' : 'twitch-connect');
        assert.equal(await page.locator('[data-connection-action="twitch-sync"]').isDisabled(), !connected);
        assert.equal(await page.locator('[data-connection-action="discord-settings-save"]').isDisabled(), !connected);
        assert.equal(await focus.evaluate(el => el === document.activeElement), true);
        assert.equal(await messageDraft.inputValue(), 'Destination et brouillon conservés');
        assert.equal(await tokenDraft.inputValue(), 'brouillon-local');
        assert.equal(await page.locator('#preview-google-calendar').inputValue(), 'chosen');
        assert.equal(await page.locator('#preview-discord-guild').inputValue(), 'b');
        assert.equal(await page.locator('#preview-discord-channel').inputValue(), 'new');
        assert.equal(await page.locator('.provider-message').count(), 0);
      }
    }
    // A manual Socket token must not authorize the real test.
    const realTest=page.locator('[data-connection-action="streamlabs-test-real"]');
    const beforeOAuth=oauthRequests;
    socket.send(JSON.stringify({ type:'state.updated',data:runtime.dashboard }));
    await page.waitForFunction(() => window.__preview.state.streamlabsOAuth?.authorized === false);
    await page.waitForTimeout(350);
    assert.ok(oauthRequests>beforeOAuth);
    assert.equal(await realTest.isDisabled(),true);
    assert.match(await realTest.getAttribute('title'),/Autorise Streamlabs via OAuth/);
    await page.route('**/api/v1/supports/streamlabs/oauth/start', route => route.fulfill({ json: { authorizationUrl:'https://streamlabs.com/api/v2.0/authorize?state=test' } }));
    await page.evaluate(() => { window.streamDashboardDesktop={openExternalAuth:async url=>{window.openedOAuth=url}}; });
    await page.locator('[data-connection-action="streamlabs-oauth-connect"]').click();
    await page.waitForFunction(() => window.openedOAuth?.includes('streamlabs.com'));
    const clientDraft=page.locator('#preview-streamlabs-oauth-form [name="clientId"]');
    await clientDraft.fill('Identifiant en cours de saisie');
    await messageDraft.focus();
    await page.route('**/api/v1/streamlabs/oauth/callback?code=test&state=test', async route => {
      oauthAuthorized=true;
      await route.fulfill({ body:'Autorisation réussie' });
      // The Socket was already CONNECTED using a manual token: no connectivity transition is required.
      socket.send(JSON.stringify({ type:'state.updated',data:runtime.dashboard }));
    });
    await page.evaluate(() => fetch('/api/v1/streamlabs/oauth/callback?code=test&state=test'));
    await page.waitForFunction(() => !document.querySelector('[data-connection-action="streamlabs-test-real"]').disabled);
    assert.equal(await messageDraft.evaluate(el=>el===document.activeElement),true);
    assert.equal(await messageDraft.inputValue(),'Destination et brouillon conservés');
    assert.equal(await clientDraft.inputValue(),'Identifiant en cours de saisie');
    assert.equal(await tokenDraft.inputValue(),'brouillon-local');
    assert.equal(await page.locator('#preview-google-calendar').inputValue(),'chosen');
    assert.equal(await page.locator('#preview-discord-guild').inputValue(),'b');
    assert.equal(await page.locator('#preview-discord-channel').inputValue(),'new');
    assert.equal(await realTest.getAttribute('aria-describedby'),null);
    oauthStatusFails=true;
    socket.send(JSON.stringify({ type:'state.updated',data:runtime.dashboard }));
    await page.waitForFunction(() => document.querySelector('[data-connection-action="streamlabs-test-real"]').title.includes('Vérification OAuth Streamlabs indisponible'));
    assert.equal(await realTest.isDisabled(),true);
    assert.equal(await messageDraft.evaluate(el=>el===document.activeElement),true);
    oauthStatusFails=false;
    socket.send(JSON.stringify({ type:'state.updated',data:runtime.dashboard }));
    await page.waitForFunction(() => !document.querySelector('[data-connection-action="streamlabs-test-real"]').disabled);

    await page.locator('#preview-discord-guild').selectOption('');
    assert.equal(await page.locator('#preview-discord-channel').inputValue(), '');
    assert.equal(await page.locator('[data-connection-action="discord-settings-save"]').isDisabled(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Connections overflow');
    assert.deepEqual(await page.evaluate(() => window.unhandledButtons()), []);
    await page.evaluate(() => {
      const s = window.__preview.state;
      s.planning = [{ day: 'Demain', time: '20:00', title: 'Un titre très long '.repeat(20), kind: 'Twitch', raw: { endAtUtc: '2099-01-01T22:00:00Z', twitchCategoryId: '42' } }];
    });
    await page.locator('[data-view="planning"]').click();
    assert.ok(await page.locator('.planning-entry .twitch-thumbnail').count());
    assert.equal(await page.locator('button button').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Planning overflow');
    assert.deepEqual(await page.evaluate(() => window.unhandledButtons()), []);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    for (const client of sockets.clients) client.terminate();
    await new Promise(resolve => sockets.close(resolve));
    await new Promise(resolve => server.close(resolve));
  }
});
