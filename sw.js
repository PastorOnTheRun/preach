// Preach service worker: precache the app shell so it works offline (e.g. spotty church Wi-Fi).
// Bump VERSION on every release so devices pick up the new files.
const VERSION = 'preach-v1.1.0';
const SHELL = [
  './', 'index.html', 'config.js', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/util.js', 'js/storage.js', 'js/format.js', 'js/bible.js', 'js/paginator.js',
  'js/timer.js', 'js/recorder.js', 'js/feedback.js', 'js/sample.js',
  'js/cloud.js', 'js/sync.js', 'js/review.js', 'review.html',
  'vendor/mammoth.browser.min.js', 'vendor/supabase.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('preach-') && k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Same-origin GETs: serve from cache immediately, refresh the cache in the background
// (stale-while-revalidate). Cross-origin requests (API.Bible, FUMS) go straight to the network.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    // Navigations to the app root map to index.html; review.html etc. match themselves.
    const key = req.mode === 'navigate' && url.pathname.endsWith('/') ? 'index.html' : req;
    const cached = await cache.match(key, { ignoreSearch: req.mode === 'navigate' });
    const network = fetch(req).then(res => {
      if (res && res.ok && res.type === 'basic') cache.put(key, res.clone());
      return res;
    }).catch(() => null);
    if (cached) { e.waitUntil(network); return cached; }
    const res = await network;
    return res || new Response('Offline', { status: 503, statusText: 'Offline' });
  })());
});
