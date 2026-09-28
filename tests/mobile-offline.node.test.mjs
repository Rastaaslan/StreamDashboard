import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const base = 'https://dashboard.test/mobile/';
const mobileRoot = new URL('../apps/mobile/', import.meta.url);
const workerSource = await readFile(new URL('sw.js', mobileRoot), 'utf8');
const localFile = url => new URL(new URL(url).pathname.slice('/mobile/'.length) || 'index.html', mobileRoot);

// Discover entry modules and transitive static imports/re-exports from the shipped
// files, rather than maintaining a second list that could miss a new dependency.
async function startupModules() {
  const html = await readFile(new URL('index.html', mobileRoot), 'utf8');
  const pending = [...html.matchAll(/<script\b[^>]*type="module"[^>]*src="([^"]+)"/g)].map(match => new URL(match[1], base).href);
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

function workerHarness() {
  const listeners = new Map();
  const stores = new Map([['streamdashboard-mobile-v12', new Map()]]);
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
        async put(request, response) { store.set(key(request), response); },
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
    async match(request) {
      for (const store of stores.values()) if (store.has(key(request))) return store.get(key(request)).clone();
    },
  };
  vm.runInNewContext(workerSource, {
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
  const newCaches = [...worker.stores.keys()].filter(name => name !== 'streamdashboard-mobile-v12');
  assert.equal(newCaches.length, 1, 'The precache version must change');
  const precache = worker.stores.get(newCaches[0]);
  for (const url of modules.keys()) assert.ok(precache.has(url), `Missing precache entry: ${url}`);
  await worker.lifecycle('activate');
  assert.equal(worker.stores.has('streamdashboard-mobile-v12'), false);
  assert.equal(worker.claimed, true);
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
