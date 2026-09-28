import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { thumbnailUrl, selectThumbnail, createThumbnailCache, loadThumbnail, createThumbnail, TWITCH_IMAGE_HOSTS } from '../apps/mobile/thumbnails.js';
import { loadArtwork, buildPlanningPng } from '../apps/mobile/planning-export.js';
const art = 'https://static-cdn.jtvnw.net/ttv-boxart/42-{width}x{height}.jpg';
const stream = 'https://static-cdn.jtvnw.net/previews/live-{width}x{height}.jpg';

test('context selects stream/video/clip versus category, with appropriate Twitch dimensions', () => {
  const item = { thumbnailUrl: stream, twitchBoxArtUrl: art };
  assert.match(selectThumbnail(item), /42-285x380/);
  for (const context of ['stream', 'video', 'clip']) assert.match(selectThumbnail(item, context), /live-640x360/);
  assert.match(selectThumbnail({ thumbnail_url: stream.replaceAll('{', '%{') }, 'video'), /live-640x360/);
  assert.match(selectThumbnail({ thumbnailUrl: 'javascript:alert(1)', categoryId: '42' }, 'stream'), /42-640x360/);
  assert.equal(selectThumbnail({}), '');
  assert.equal(selectThumbnail({ twitchCategoryId: '../secret' }), '');
  assert.equal(selectThumbnail({ box_art_url: art }), thumbnailUrl(art));
  assert.equal(selectThumbnail({ thumbnailUrl: 'https://clips-media-assets2.twitch.tv/clip-preview-480x272.jpg' }, 'clip'), 'https://clips-media-assets2.twitch.tv/clip-preview-480x272.jpg');
});

test('only public HTTPS CDN URLs, without credentials, query tokens or fragments', () => {
  for (const value of ['http://static-cdn.jtvnw.net/a', 'https://static-cdn.jtvnw.net.evil.test/a', 'https://user:password@static-cdn.jtvnw.net/a', 'https://static-cdn.jtvnw.net:444/a', 'data:image/png;base64,x', '/local', undefined]) assert.equal(thumbnailUrl(value), '');
  assert.equal(thumbnailUrl(`${art}?access_token=secret#private`), thumbnailUrl(art));
});

test('cache coalesces, expires success/failure, refreshes and invalidates', async () => {
  let now = 0, calls = 0;
  const cache = createThumbnailCache({ now: () => now, ttl: 100, failureTtl: 10 });
  const loader = async () => { calls++; return calls === 1 ? null : { ok: true }; };
  const first = cache.load('a', loader);
  assert.equal(first, cache.load('a', loader));
  assert.equal(await first, null);
  await cache.load('a', loader); assert.equal(calls, 1);
  now = 11; assert.deepEqual(await cache.load('a', loader), { ok: true });
  now = 99; await cache.load('a', loader); assert.equal(calls, 2);
  now = 112; await cache.load('a', loader); assert.equal(calls, 3);
  await cache.load('a', loader, { refresh: true }); assert.equal(calls, 4);
  cache.invalidate('a'); await cache.load('a', loader); assert.equal(calls, 5);
  cache.invalidate(); await cache.load('a', loader); assert.equal(calls, 6);
  await cache.load('', loader); assert.equal(calls, 6);
});

test('cache bounds entries, catches rejection, and ignores stale completion after invalidation', async () => {
  const cache = createThumbnailCache({ limit: 2 });
  let finish;
  const old = cache.load('a', () => new Promise(resolve => { finish = resolve; }));
  await Promise.resolve(); cache.invalidate('a');
  await cache.load('a', () => 'new'); finish('old'); await old;
  assert.equal(await cache.load('a', () => 'unexpected'), 'new');
  await cache.load('b', () => { throw Error('offline'); });
  assert.equal(await cache.load('b', () => 'unexpected'), null);
  await cache.load('c', () => 'c');
  assert.equal(await cache.load('a', () => 'reloaded'), 'reloaded');
});

function imageFactory(outcome, sources = []) {
  return () => ({ naturalWidth: 640, naturalHeight: 360, set src(value) {
    sources.push({ value, cors: this.crossOrigin, referrer: this.referrerPolicy });
    if (outcome !== 'timeout') queueMicrotask(() => outcome === 'ok' ? this.onload?.() : this.onerror?.());
  } });
}

test('image loader handles 404, timeout and user refresh without network or leaking referrers', async () => {
  const url = 'https://static-cdn.jtvnw.net/test-retry.jpg'; const sources = [];
  assert.equal(await loadThumbnail(url, { imageFactory: imageFactory('error', sources) }), null);
  assert.equal(await loadThumbnail(url, { imageFactory: imageFactory('ok', sources) }), null);
  assert.equal(sources.length, 1);
  assert.ok(await loadThumbnail(url, { refresh: true, imageFactory: imageFactory('ok', sources) }));
  await loadThumbnail(url, { refresh: true, imageFactory: imageFactory('ok', sources) });
  assert.notEqual(sources[1].value, sources[2].value);
  assert.equal(sources[0].cors, 'anonymous'); assert.equal(sources[0].referrer, 'no-referrer');
  assert.equal(await loadThumbnail('https://static-cdn.jtvnw.net/timeout.jpg', { timeoutMs: 2, imageFactory: imageFactory('timeout') }), null);
});

function element(tag) {
  return { tag, children: [], attrs: {}, append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; }, setAttribute(key, value) { this.attrs[key] = value; }, getContext() { return { drawImage() {} }; } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test('DOM keeps deterministic placeholder for absent/error and renders only decoded pixels after retry', async () => {
  let calls = 0; const options = { documentApi: { createElement: element }, loader: async (_url, { refresh }) => { calls++; return refresh ? { naturalWidth: 640, naturalHeight: 360 } : null; } };
  const absent = createThumbnail({}, 'planning', options);
  assert.equal(absent.children.length, 1); assert.equal(calls, 0);
  const root = createThumbnail({ thumbnailUrl: stream }, 'video', options);
  await tick(); assert.equal(root.children[0].textContent, '◆');
  assert.ok(root.children.every(child => child.tag !== 'img'));
  root.children[1].onclick({ stopPropagation() {} }); await tick();
  assert.equal(root.children[0].tag, 'canvas'); assert.equal(calls, 2);
  assert.equal(root.children[1].disabled, false);
});

test('export loader validates source, omits credentials, blocks redirects and revokes blobs', async () => {
  const revoked = [], requests = [];
  const options = { imageFactory: imageFactory('ok'), fetchApi: async (url, init) => { requests.push([url, init]); return { ok: true, blob: async () => new Blob(['image']) }; }, urlApi: { createObjectURL: () => 'blob:test', revokeObjectURL: value => revoked.push(value) } };
  assert.equal(await loadArtwork('https://attacker.test/a', options), null); assert.equal(requests.length, 0);
  assert.ok(await loadArtwork(art, options)); assert.deepEqual(revoked, ['blob:test']);
  assert.match(requests[0][0], /285x380/);
  assert.equal(requests[0][1].credentials, 'omit'); assert.equal(requests[0][1].referrerPolicy, 'no-referrer'); assert.equal(requests[0][1].redirect, 'error');
  assert.equal(await loadArtwork(art, { ...options, fetchApi: async () => ({ ok: false }) }), null);
  assert.equal(await loadArtwork(art, { ...options, imageFactory: imageFactory('error') }), null);
  assert.equal(await loadArtwork(art, { ...options, timeoutMs: 2, imageFactory: imageFactory('timeout') }), null);
  assert.equal(revoked.length, 3);
});

for (const hasArtwork of [true, false]) test(`Planning PNG export completes ${hasArtwork ? 'with artwork' : 'without artwork'}`, async () => {
  let draws = 0, placeholders = 0;
  const context = { measureText: text => ({ width: text.length * 8 }), fillText: text => { if (text === '◆') placeholders++; }, beginPath() {}, roundRect() {}, fill() {}, fillRect() {}, strokeRect() {}, clip() {}, save() {}, restore() {}, drawImage() { draws++; }, createLinearGradient: () => ({ addColorStop() {} }) };
  const documentApi = { createElement: () => ({ getContext: () => context, toBlob: callback => callback(new Blob(['png'], { type: 'image/png' })) }) };
  const items = [{ id: '1', title: 'Live', category: 'live', source: 'TWITCH', desiredPublication: { twitch: true }, startAtUtc: new Date(2026, 8, 13, 20).toISOString(), endAtUtc: new Date(2026, 8, 13, 22).toISOString() }];
  const result = await buildPlanningPng(items, 'Test', { now: new Date(2026, 8, 13, 12), filters: { twitch: true, live: true }, documentApi, loadArtwork: async () => hasArtwork ? { naturalWidth: 285, naturalHeight: 380 } : null });
  assert.equal(result.blob.type, 'image/png'); assert.equal(result.count, 1); assert.equal(result.fileName, 'planning-aujourdhui.png');
  assert.equal(draws, hasArtwork ? 1 : 0); assert.equal(placeholders, hasArtwork ? 0 : 1);
});

test('served CSP allows only explicit thumbnail CDN hosts and blob export, preserving script restrictions', () => {
  for (const file of ['apps/mobile/index.html', 'apps/web/index.html', 'apps/server/src/index.ts']) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const img = /img-src ([^;]+)/.exec(source)[1];
    for (const host of TWITCH_IMAGE_HOSTS) assert.ok(img.includes(`https://${host}`));
    assert.ok(img.includes('blob:')); assert.ok(!img.includes('https:;')); assert.ok(!img.includes('*'));
    assert.ok(source.includes("script-src 'self';")); assert.ok(source.includes("object-src 'none'"));
  }
});
