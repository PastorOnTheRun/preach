// Preach service worker.
// - App code (pages, HTML, JS, CSS, config, manifest): NETWORK-FIRST with a ~3 s timeout, so devices
//   always get the latest release when online, falling back to the cached copy when offline/slow.
// - Fonts, icons and vendor libraries: cache-first (they rarely change).
// The page (js/app.js) registers this with updateViaCache: 'none', checks for updates on load and when
// the app comes back to the foreground, and activates a waiting worker via the SKIP_WAITING message.
// Bump VERSION on every release.
const VERSION = 'preach-v1.4.1';
const NET_TIMEOUT = 3000;
const SHELL = [
  './', 'index.html', 'config.js', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/util.js', 'js/storage.js', 'js/format.js', 'js/bible.js', 'js/paginator.js',
  'js/timer.js', 'js/recorder.js', 'js/feedback.js', 'js/sample.js',
  'js/cloud.js', 'js/sync.js', 'js/review.js', 'review.html', 'js/grade.js',
  'js/slides.js', 'js/screenlink.js', 'js/screen.js', 'screen.html', 'css/screen.css', 'fonts/archivo-wide-latin.woff2',
  'vendor/mammoth.browser.min.js', 'vendor/supabase.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png'
];
const STATIC_RE = /\/(fonts|icons|vendor)\//;

self.addEventListener('install', e => {
  // cache: 'reload' bypasses the browser HTTP cache so a new release never precaches stale files.
  // Activate as soon as the new files are cached (also rescues devices running older pages that never
  // send SKIP_WAITING). Activating is harmless mid-sermon: the page only *reloads* at a safe moment.
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('preach-') && k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function cacheKey(req, url) {
  if (req.mode === 'navigate' && url.pathname.endsWith('/')) return new URL('index.html', self.registration.scope).href;
  return url.origin + url.pathname; // ignore ?cb= style query strings
}

async function networkFirst(e, req, url) {
  const cache = await caches.open(VERSION);
  const key = cacheKey(req, url);
  // Revalidate with the server every time (GitHub Pages sends max-age=600, which caused stale code).
  const network = fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' }).then(res => {
    if (res && res.ok && res.type === 'basic') { const copy = res.clone(); e.waitUntil(cache.put(key, copy)); }
    return res;
  });
  network.catch(() => {});
  let timer;
  const timeout = new Promise(r => { timer = setTimeout(() => r('timeout'), NET_TIMEOUT); });
  try {
    const res = await Promise.race([network, timeout]);
    clearTimeout(timer);
    if (res !== 'timeout' && res && (res.ok || res.status === 404)) return res;
  } catch (_) { clearTimeout(timer); }
  const cached = await cache.match(key) || await cache.match(req, { ignoreSearch: true });
  if (cached) return cached;
  try { return await network; } catch (_) { return new Response('Offline', { status: 503, statusText: 'Offline' }); }
}

async function cacheFirst(e, req, url) {
  const cache = await caches.open(VERSION);
  const key = url.origin + url.pathname;
  const cached = await cache.match(key);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.ok && res.type === 'basic') e.waitUntil(cache.put(key, res.clone()));
    return res;
  } catch (_) { return new Response('Offline', { status: 503, statusText: 'Offline' }); }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // API.Bible, Supabase etc. go straight to the network
  if (req.headers.has('range')) return; // media range requests: let the browser handle them
  e.respondWith(STATIC_RE.test(url.pathname) ? cacheFirst(e, req, url) : networkFirst(e, req, url));
});
