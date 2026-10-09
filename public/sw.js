/* ══════════════════════════════════════════════════════════════════════════
   JapaQuest Service Worker v3 — fast on poor networks, full offline fallback
   ──────────────────────────────────────────────────────────────────────────
   • Precache the app shell on install: the app loads instantly on repeat
     visits, even before the network answers.
   • Stale-while-revalidate for CSS/JS/fonts/icons — fastest possible paint,
     refreshed silently in the background for next time.
   • API: network-first with a cached fallback. GET responses (models list,
     plans, destinations, visa data…) are cached, so when the network drops
     the app keeps working with the last known data instead of an error.
   • Background warm-up: after activation pages can post {type:'WARM', urls:[
     …]} to prefetch data into the cache while the connection is idle, so a
     commute with no signal still has everything the user opened before.
   • No credentials are ever cached: requests carrying an Authorization
     header settle to network-only (responses could embed user data, and the
     httpOnly session cookie is never readable/stored here either).
   ══════════════════════════════════════════════════════════════════════════ */
const VERSION = 'v3';
const SHELL_CACHE  = 'jq-shell-'  + VERSION;
const STATIC_CACHE = 'jq-static-' + VERSION;
const API_CACHE    = 'jq-api-'    + VERSION;

// The fastest possible first paint: shell pages + core styling + icons.
const PRECACHE = [
  '/', '/index.html', '/style.css', '/manifest.json',
  '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    Promise.all([
      caches.open(SHELL_CACHE).then(c => c.addAll(PRECACHE)),
      caches.open(STATIC_CACHE),
      caches.open(API_CACHE),
    ]).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k =>
        ![SHELL_CACHE, STATIC_CACHE, API_CACHE].includes(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── helpers ───────────────────────────────────────────────────────────────
const isStatic = url => /\.(css|js|png|jpg|jpeg|svg|ico|woff2?|webp|ttf)$/i.test(url.pathname)
  || url.pathname.startsWith('/icons/');
// Warm-cacheable read-only APIs (no auth headers, safe to share across users
// of this device): public reference data the dashboards re-read on boot.
const isWarmableApi = url =>
  /^\/api\/(app-info|visa\/|geo|user\/plans|ai\/models)/.test(url.pathname);

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request).then(res => {
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  }).catch(() => null);
  return cached || (await network) || Response.error();
}

async function apiStrategy(e) {
  const req = e.request;
  // Never cache anything tied to credentials or non-GET writes.
  if (req.method !== 'GET' || req.headers.get('authorization'))
    return fetch(req).catch(() => new Response(
      JSON.stringify({ error: 'You are offline. Please reconnect.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }));

  const cache = await caches.open(API_CACHE);
  try {
    const res = await fetch(req);
    if (res.ok && isWarmableApi(new URL(req.url))) cache.put(req, res.clone());
    return res;
  } catch {
    const cached = await cache.match(req);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'offline', offline: true }),
      { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // let CDN/font requests pass through

  if (url.pathname.startsWith('/api/')) { e.respondWith(apiStrategy(e)); return; }

  // Brand assets change with admin uploads — network-first, cached fallback.
  if (url.pathname === '/manifest.json' || url.pathname === '/favicon.ico' || url.pathname.startsWith('/uploads/')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  if (isStatic(url)) { e.respondWith(staleWhileRevalidate(e.request, STATIC_CACHE)); return; }

  // HTML: network-first so fresh builds win; cached shell answers offline —
  // on a 2G connection the SW quickly serves the cached copy if network stalls.
  e.respondWith(Promise.race([
    fetch(e.request).then(r => {
      if (r && r.ok) caches.open(SHELL_CACHE).then(c => c.put(e.request, r.clone()));
      return r;
    }).catch(() => null),
    new Promise(res => setTimeout(() => res(caches.match(e.request).then(c => c || caches.match('/'))), 3000)),
  ]).then(r => r || caches.match(e.request).then(c => c || caches.match('/'))));
});

// ── BACKGROUND WARM-UP ─────────────────────────────────────────────────────
// Pages post {type:'WARM', urls:[…]} to prefetch data while connectivity is
// good — the equivalent of "download the necessary information now so it is
// available when the network is gone".
self.addEventListener('message', e => {
  if (!e.data || e.data.type !== 'WARM') return;
  const urls = (e.data.urls || []).filter(u => {
    try { const w = new URL(u, location.origin); return w.origin === location.origin; } catch { return false; }
  }).slice(0, 50);
  e.waitUntil((async () => {
    const [apiCache, staticCache] = [await caches.open(API_CACHE), await caches.open(STATIC_CACHE)];
    for (const u of urls) {
      try {
        const res = await fetch(u, { credentials: 'omit' });
        const target = new URL(u, location.origin).pathname.startsWith('/api/') ? apiCache : staticCache;
        if (res.ok) await target.put(u, res.clone());
      } catch {}
    }
    const clients = await self.clients.matchAll();
    clients.forEach(c => c.postMessage({ type: 'WARMED', count: urls.length }));
  })());
});
