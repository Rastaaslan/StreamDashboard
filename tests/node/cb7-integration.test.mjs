import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { CompanionMode, createCompanionStore } from '../../apps/mobile/companion-store.js';
import { createNativeProviderAdapter, createStandaloneProviderSync } from '../../apps/mobile/provider-sync.js';
import { providerDiagnostic, planningPublicationPermissions } from '../../apps/mobile/provider-diagnostics.js';
import { syncSummary, createProviderRetry } from '../../apps/mobile/sync-center.js';
import { diagnosePrelive } from '../../apps/mobile/prelive-diagnostic.js';

test('assistant refusal → Planning error → targeted sync retry → prelive recovery', async () => {
  const data = new Map();
  const store = createCompanionStore({ getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) });
  const item = store.createEvent({ title: 'Live', desiredPublication: { google: true }, providerLinks: { twitch: { status: 'synced', remoteId: 't' } } }).item;
  let code = 'CALENDAR', writes = 0;
  const status = () => ({ ok: true, configured: true, connected: true, tested: !code, code, capabilities: ['connect', 'calendar'], access_token: 'SECRET', message: 'Bearer SECRET' });
  const adapter = createNativeProviderAdapter({ googleTest: () => JSON.stringify(status()), googleCreatePlanning: () => { writes++; return JSON.stringify({ ok: true, remoteId: 'g' }); } });
  const sync = createStandaloneProviderSync({ store, adapter });
  const mode = CompanionMode.ONLINE_STANDALONE;
  const phone = () => ({ google: providerDiagnostic(status()) });
  const permissions = () => planningPublicationPermissions({ mode, phone: phone() });
  const diagnostic = () => diagnosePrelive({ mode, cache: store.snapshot(), phone: phone() });
  assert.equal(permissions().google.available, false);
  // This scenario exercises only Google; a general reconciliation also unpublishes disabled Twitch.
  await sync.apply(mode, item, undefined, 'google');
  assert.equal(writes, 0);
  const summary = syncSummary(store.snapshot(), undefined, mode);
  assert.equal(summary.entries.find(entry => entry.provider === 'google').retryable, true);
  assert.equal(diagnostic().checks.find(check => check.id === 'providers').status, 'warning');
  assert.equal(diagnostic().checks.some(check => check.status === 'blocker'), false);
  assert.ok(!JSON.stringify([store.snapshot(), phone(), diagnostic()]).includes('SECRET'));
  code = '';
  assert.equal(permissions().google.available, true);
  const retry = createProviderRetry({ getMode: () => mode, nativeAvailable: () => true, standaloneRetry: (event, provider) => sync.apply(mode, event, undefined, provider) });
  await retry(store.snapshot().planning[0], 'google');
  assert.equal(writes, 1);
  assert.equal(store.snapshot().planning[0].providerLinks.twitch.remoteId, 't');
  assert.equal(syncSummary(store.snapshot(), undefined, mode).entries.some(entry => entry.retryable), false);
  assert.equal(diagnostic().checks.find(check => check.id === 'providers').status, 'ok');
  assert.equal(diagnostic().status, 'warning', 'Provider success must not acknowledge the pending PC queue');
  store.applySyncResponse({ acknowledged: store.snapshot().pending.map(op => op.id), conflicts: [] });
  assert.equal(diagnostic().status, 'ok');
});

test('remote deletion remains a prelive warning even with a stale synced status', () => {
  const result = diagnosePrelive({ mode: 'ONLINE_STANDALONE', cache: { planning: [{ providerLinks: { google: { status: 'synced', deletedRemotely: true } } }] } });
  assert.equal(result.checks.find(check => check.id === 'planning-sync').status, 'warning');
});

test('a native retry completing after PC reconnection cannot replace the PC dashboard', async () => {
  const source = readFileSync(new URL('../../apps/mobile/mobile.js', import.meta.url), 'utf8');
  let finish;
  const rendered = [];
  const scope = vm.createContext({
    CompanionMode, companionMode: CompanionMode.ONLINE_STANDALONE, StreamDashboardProviders: {},
    providerSync: { apply: () => new Promise(resolve => { finish = resolve; }) },
    render: state => rendered.push(state), offlineState: () => 'local', refreshProviderAccounts: async () => {},
  });
  vm.runInContext(source.slice(source.indexOf('async function syncEventProviders('), source.indexOf('function render(next)')), scope);
  const pending = scope.syncEventProviders({ id: 'event' }, undefined, 'google');
  await Promise.resolve();
  assert.deepEqual(rendered, ['local']);
  scope.companionMode = CompanionMode.ONLINE_PC;
  rendered.push('fresh PC');
  finish(); await pending;
  assert.deepEqual(rendered, ['local', 'fresh PC']);
});

test('integrated shell has unique IDs, imports and property handlers, and exactly five tabs', () => {
  const read = file => readFileSync(new URL(`../../apps/mobile/${file}`, import.meta.url), 'utf8');
  const html = read('index.html');
  const unique = values => assert.equal(new Set(values).size, values.length);
  unique([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  assert.deepEqual([...html.matchAll(/<button[^>]*data-tab="[^"]+"[^>]*aria-label="([^"]+)"/g)].map(match => match[1]), ['Accueil', 'Live', 'Sons', 'Planning', 'Plus']);
  assert.doesNotMatch(html, /id="(?:fab|command-palette)"/);
  const scripts = ['mobile.js', 'features/preparation.js', 'features/templates.js', 'features/prelive.js'];
  const handlers = [];
  for (const file of scripts) {
    const source = read(file);
    unique([...source.matchAll(/^import .*from ['"]([^'"]+)['"]/gm)].map(match => match[1]));
    handlers.push(...[...source.matchAll(/\$\(['"]([^'"]+)['"]\)\.(on\w+)\s*=/g)].map(match => `${match[1]}:${match[2]}`));
  }
  unique(handlers);
  assert.equal((read('mobile.js').match(/addEventListener\('provider-auth'/g) || []).length, 1);
});
