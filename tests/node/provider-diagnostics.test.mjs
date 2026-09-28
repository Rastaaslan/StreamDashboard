import test from 'node:test';
import assert from 'node:assert/strict';
import { providerDiagnostic, wizardState, capabilityAvailability } from '../../apps/mobile/provider-diagnostics.js';
import { createNativeProviderAdapter, createStandaloneProviderSync } from '../../apps/mobile/provider-sync.js';
import { createCompanionStore, CompanionMode } from '../../apps/mobile/companion-store.js';

function trackedStore(updates, event) {
  const data = new Map();
  const store = createCompanionStore({ getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) });
  store.createEvent(event);
  const update = store.updateProvider;
  store.updateProvider = (...args) => { updates.push(args); return update(...args); };
  return store;
}

for (const provider of ['twitch', 'google']) {
  test(`${provider}: wizard configuration → OAuth → test → ready, reauth and logout`, () => {
    const raw = { configured: false };
    const step = () => wizardState(providerDiagnostic(raw)).step;
    assert.equal(step(), 'configuration');
    raw.configured = true; assert.equal(step(), 'oauth');
    raw.connected = true; assert.equal(step(), 'test');
    raw.tested = true; assert.equal(step(), 'ready');
    assert.equal(wizardState(providerDiagnostic(raw), true).step, 'oauth');
    raw.code = 'REAUTH_REQUIRED'; assert.equal(step(), 'oauth');
    raw.code = 'NETWORK'; assert.equal(step(), 'test');
    raw.connected = false; assert.equal(step(), 'oauth');
  });
  test(`${provider}: native mutation requires a tested capability`, async () => {
    const capability = provider === 'google' ? 'calendar' : 'schedule';
    let calls = 0;
    let tested = false;
    const adapter = createNativeProviderAdapter({
      [`${provider}Test`]: () => JSON.stringify({ ok: true, configured: true, connected: true, tested, capabilities: [capability] }),
      [`${provider}CreatePlanning`]: () => { calls++; return '{"ok":true,"remoteId":"existing-account-event"}'; },
    });
    await assert.rejects(adapter.mutate(provider, 'create', {}, {}), /connecter|permissions/);
    assert.equal(calls, 0);
    tested = true;
    assert.equal((await adapter.mutate(provider, 'create', {}, {})).remoteId, 'existing-account-event');
    assert.equal(calls, 1);
  });
}
test('diagnostics redact arbitrary secrets in every untrusted field', () => {
  const secret = 'sensitive-OAuth-value';
  const result = providerDiagnostic({ configured: true, connected: true, tested: true, access_token: secret, refresh_token: secret, client_secret: secret, message: secret, code: secret, calendar: secret, scopes: [secret], capabilities: [secret, 'calendar'], lastSync: secret });
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.deepEqual(result.capabilities, []);
  assert.equal(result.tested, false);
  assert.match(result.error, /Internet/);
});
test('diagnostics explain configuration, scopes and calendar requirements', () => {
  assert.match(providerDiagnostic().error, /Client ID absent/);
  for (const code of ['SCOPES', 'HTTP_403', 'CALENDAR', 'ACCOUNT']) assert.ok(providerDiagnostic({ configured: true, code }).error);
  const result = providerDiagnostic({ configured: true, connected: true, tested: true, calendar: 'primary', lastSync: 1700000000000, scopes: ['https://www.googleapis.com/auth/calendar.events'], capabilities: ['calendar'] });
  assert.equal(result.calendar, 'Principal');
  assert.equal(result.lastSync, '2023-11-14T22:13:20.000Z');
  assert.equal(capabilityAvailability(result, 'calendar').available, true);
  assert.equal(capabilityAvailability(result, 'schedule').available, false);
  assert.ok(capabilityAvailability(result, 'schedule').reason);
});
test('bridge error messages never relay raw provider payloads', async () => {
  const adapter = createNativeProviderAdapter({ twitchAuthorize: () => JSON.stringify({ ok: false, code: 'AUTH', message: 'Bearer SECRET' }) });
  await assert.rejects(adapter.authorize('twitch'), error => !error.message.includes('SECRET') && /OAuth/.test(error.message));
});
test('CB-2 retry chooses create/update independently and stores sanitized errors', async () => {
  const calls = [], updates = [];
  const event = { id: 'event', desiredPublication: { twitch: true, google: true }, providerLinks: { twitch: { remoteId: 't1' }, google: { status: 'error' } } };
  const sync = createStandaloneProviderSync({ store: trackedStore(updates, event), adapter: {
    mutate: async (provider, action) => { calls.push([provider, action]); if (provider === 'google') throw Object.assign(new Error('access_token=SECRET'), { code: 'NETWORK' }); return { remoteId: 't1' }; },
  } });
  await sync.apply(CompanionMode.ONLINE_STANDALONE, event);
  assert.deepEqual(calls, [['twitch', 'update'], ['google', 'create']]);
  assert.ok(!JSON.stringify(updates).includes('SECRET'));
  calls.length = 0;
  await sync.apply(CompanionMode.ONLINE_PC, event);
  await sync.apply(CompanionMode.OFFLINE, event);
  assert.equal(calls.length, 0);
});

for (const provider of ['twitch', 'google']) {
  for (const [code, expected] of Object.entries({ NETWORK: /Internet.*retester/, ACCOUNT: /affilié ou partenaire/, CALENDAR: /calendrier.*écriture/, REAUTH_REQUIRED: /réautoriser/ })) {
    test(`${provider}: ${code} is preserved through diagnostic refusal and persistence`, async () => {
      let mutations = 0;
      const updates = [];
      const adapter = createNativeProviderAdapter({
        [`${provider}Test`]: () => JSON.stringify({ ok: true, configured: true, connected: true, code, message: 'Bearer SECRET', access_token: 'SECRET', capabilities: ['schedule', 'calendar'] }),
        [`${provider}CreatePlanning`]: () => { mutations++; return '{"ok":true}'; },
      });
      const sync = createStandaloneProviderSync({ adapter, store: trackedStore(updates, { id: 'event', desiredPublication: { [provider]: true } }) });
      const result = await sync.apply(CompanionMode.ONLINE_STANDALONE, { id: 'event', desiredPublication: { [provider]: true } });
      assert.equal(mutations, 0);
      assert.equal(result[0].error.code, code);
      assert.match(updates.at(-1)[2].lastError, expected);
      assert.ok(!JSON.stringify(updates).includes('SECRET'));
      assert.ok(!JSON.stringify(result).includes('SECRET'));
      assert.ok(!result[0].error.message.includes('SECRET'));
      if (code !== 'REAUTH_REQUIRED') assert.doesNotMatch(updates.at(-1)[2].lastError, /réautoriser/);
    });
  }
}

test('an unknown diagnostic code is redacted before the mutation refusal', async () => {
  const adapter = createNativeProviderAdapter({ googleTest: () => JSON.stringify({ ok: true, configured: true, connected: true, code: 'SECRET' }) });
  await assert.rejects(adapter.mutate('google', 'create', {}, {}), error => error.code === 'NETWORK' && !error.message.includes('SECRET'));
});
