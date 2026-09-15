const CACHE = 'streamdashboard-mobile-v7';
const PATHS = new Set([
  '/mobile/',
  '/mobile/index.html',
  '/mobile/mobile.css',
  '/mobile/mobile.js',
  '/mobile/mobile-polish.js',
  '/mobile/planning-export.js',
  '/mobile/planning-model.js',
  '/mobile/shared/recurrence.js',
  '/mobile/companion-store.js',
  '/mobile/templates-ui.js',
  '/mobile/manifest.webmanifest',
  '/mobile/icon-192.png',
  '/mobile/icon-512.png',
]);
const ASSETS = ['./', 'mobile.css', 'mobile.js', 'mobile-polish.js', 'planning-export.js', 'planning-model.js', 'shared/recurrence.js', 'companion-store.js', 'templates-ui.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET'
    || url.origin !== self.location.origin
    || url.search
    || !PATHS.has(url.pathname)) return;
  event.respondWith(fetch(event.request)
    .then(response => {
      if (response.ok) {
        const copy = response.clone();
        void caches.open(CACHE).then(cache => cache.put(event.request, copy));
      }
      return response;
    })
    .catch(() => caches.match(event.request)));
});
