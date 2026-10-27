import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const base = 'https://dashboard.test/mobile/';
const mobileRoot = new URL('../apps/mobile/', import.meta.url);
const workerSource = await readFile(new URL('sw.js', mobileRoot), 'utf8');
const controlWorkerSource = await readFile(new URL('control-sw.js', mobileRoot), 'utf8');
const localFile = url => { const relative = new URL(url).pathname.slice('/mobile/'.length); return new URL(relative.endsWith('/') || !relative ? relative + 'index.html' : relative, mobileRoot); };
const previousCache = 'streamdashboard-mobile-v21-live-tags';

// Discover entry modules and transitive static imports/re-exports from the shipped
// files, rather than maintaining a second list that could miss a new dependency.
async function startupModules(entry = 'index.html') {
  const html = await readFile(new URL(entry, mobileRoot), 'utf8');
  const pending = [...html.matchAll(/<script\b[^>]*type="module"[^>]*src="([^"]+)"/g)].map(match => new URL(match[1], new URL(entry, base)).href);
  assert.ok(pending.length, 'At least one startup module must be discovered');
  const modules = new Map();
  while (pending.length) {
    const url = pending.pop();
    if (modules.has(url)) continue;
    const source = await readFile(localFile(url), 'utf8');
    modules.set(url, source);
    for (const match of source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) pending.push(new URL(match[1], url).href);
    for (const match of source.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?:[^;'"\n]*?\s+from\s*)?['"]([^'"]+)['"]/g)) {
      assert.ok(match[1].startsWith('.'), `Startup import must resolve locally: ${match[1]}`);
      pending.push(new URL(match[1], url).href);
    }
  }
  return modules;
}

async function startupStyles(entry) {
  const html = await readFile(new URL(entry, mobileRoot), 'utf8');
  const pending = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)]
    .map(match => new URL(match[1], new URL(entry, base)).href);
  const styles = new Map();
  while (pending.length) {
    const url = pending.pop();
    if (styles.has(url)) continue;
    const source = await readFile(localFile(url), 'utf8');
    styles.set(url, source);
    for (const match of source.matchAll(/@import\s+url\(['"]?([^'"\s)]+)['"]?\)/g)) pending.push(new URL(match[1], url).href);
  }
  return styles;
}

function workerHarness(source=workerSource) {
  const listeners = new Map();
  const stores = new Map([[previousCache, new Map()], ['unrelated-cache', new Map()]]);
  const attempts = [];
  let claimed = false, skipped = false;
  const key = value => new URL(typeof value === 'string' ? value : value.url, base).href;
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async addAll(assets) {
          // Simulate successful installation using repository bytes, never HTTP.
          for (const asset of assets) store.set(key(asset), new Response(await readFile(localFile(key(asset)))));
        },
        async match(request){return store.get(key(request))?.clone();},
        async put(request, response) { store.set(key(request), response); },
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
    async match(request) {
      for (const store of stores.values()) if (store.has(key(request))) return store.get(key(request)).clone();
    },
  };
  vm.runInNewContext(source, {
    URL, caches,
    fetch: async request => { attempts.push(request.url); throw new TypeError('Network unavailable'); },
    self: {
      location: new URL(base),
      addEventListener: (name, listener) => listeners.set(name, listener),
      skipWaiting: async () => { skipped = true; },
      clients: { claim: async () => { claimed = true; } },
    },
  });
  return {
    stores, attempts,
    get claimed() { return claimed; },
    get skipped() { return skipped; },
    async lifecycle(name) {
      let completion;
      listeners.get(name)({ waitUntil(promise) { completion = promise; } });
      assert.ok(completion, `${name} must wait for cache operations`);
      await completion;
    },
    request(url, method = 'GET') {
      let response;
      listeners.get('fetch')({ request: new Request(url, { method }), respondWith(promise) { response = promise; } });
      return response;
    },
  };
}

test('new cache installs every startup module and serves its bytes when all network requests fail', async () => {
  const modules = await startupModules();
  assert.ok(modules.has(new URL('thumbnails.js', base).href));
  assert.ok(modules.has(new URL('shared/recurrence.js', base).href), 'Transitive dependencies are discovered');
  const worker = workerHarness();
  await worker.lifecycle('install');
  assert.equal(worker.skipped, true);
  const newCaches = [...worker.stores.keys()].filter(name => name.startsWith('streamdashboard-mobile-') && name !== previousCache);
  assert.equal(newCaches.length, 1, 'The precache version must change');
  const precache = worker.stores.get(newCaches[0]);
  for (const url of modules.keys()) assert.ok(precache.has(url), `Missing precache entry: ${url}`);
  await worker.lifecycle('activate');
  assert.equal(worker.stores.has(previousCache), false);
  assert.equal(worker.claimed, true);
  assert.equal(worker.stores.has('unrelated-cache'), true, 'Activation must not delete other applications’ caches');
  for (const [url, source] of modules) {
    const result = worker.request(url);
    assert.ok(result, `Worker does not intercept mandatory module: ${url}`);
    const response = await result;
    assert.ok(response?.ok, `No offline response for ${url}`);
    assert.equal(await response.text(), source, `Offline module bytes differ: ${url}`);
  }
  assert.equal(worker.attempts.length, modules.size, 'Every module was tested with a rejected network request');
  for (const module of ['sync-center.js', 'provider-diagnostics.js', 'thumbnails.js', 'prelive-diagnostic.js', 'features/prelive.js']) assert.ok(modules.has(new URL(module, base).href), module);
  const explicitPage = await worker.request(new URL('index.html', base));
  assert.equal(await explicitPage.text(), await readFile(new URL('index.html', mobileRoot), 'utf8'));
  const page = await worker.request(base);
  assert.equal(await page.text(), await readFile(new URL('index.html', mobileRoot), 'utf8'));
});

test('offline support remains scoped to same-origin static GET requests', async () => {
  const worker = workerHarness();
  await worker.lifecycle('install');
  for (const [url, method] of [
    [new URL('thumbnails.js', base).href, 'POST'],
    ['https://external.test/mobile/thumbnails.js', 'GET'],
    [new URL('thumbnails.js?token=private', base).href, 'GET'],
    ['https://dashboard.test/api/v1/state', 'GET'],
  ]) assert.equal(worker.request(url, method), undefined);
  assert.equal(worker.attempts.length, 0);
});

test('the production control shell, local services and styles boot entirely from installed assets without network', async () => {
  const assets = new Map([...await startupModules('control/index.html'), ...await startupStyles('control/index.html')]);
  for (const file of ['control/device-audio.js', 'control/device-streamlabs.js', 'control/device-services.js', 'control/device-bridge.js', 'control/local-planning.js', 'shared/planning-engine.js', 'shared/autonomy.js', 'control/performance.css', 'control-fonts.css']) {
    assert.ok(assets.has(new URL(file, base).href), `Production dependency not exercised: ${file}`);
  }
  const worker = workerHarness(controlWorkerSource);
  await worker.lifecycle('install');
  await worker.lifecycle('activate');
  for (const [url, source] of assets) {
    const pending = worker.request(url);
    assert.ok(pending, `Missing offline control route: ${url}`);
    const response = await pending;
    assert.ok(response?.ok, `Missing installed control asset: ${url}`);
    assert.equal(await response.text(), source, `Stale production asset: ${url}`);
  }
  for (const entry of ['control/', 'control/index.html']) {
    const response = await worker.request(new URL(entry, base));
    assert.equal(await response.text(), await readFile(new URL('control/index.html', mobileRoot), 'utf8'));
  }
  assert.equal(worker.request(new URL('control/device-audio.js?credential=private', base)), undefined);
  assert.equal(worker.request('https://dashboard.test/api/v2/wizebot/command', 'POST'), undefined);
});
