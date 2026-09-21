/* JapaQuest — Service Worker v2.0 */
const CACHE  = 'japaplus-v2';
const STATIC = ['/', '/style.css', '/manifest.json', '/icons/icon.svg', '/icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Always network-first for API
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(e.request).catch(() =>
      new Response(JSON.stringify({error:'You are offline. Please reconnect.'}),
        {status:503,headers:{'Content-Type':'application/json'}})));
    return;
  }

  // Cache-first for static assets
  if (url.pathname.match(/\.(css|png|svg|ico|woff2|jpg|webp)$/)) {
    e.respondWith(caches.match(e.request).then(c => c || fetch(e.request).then(r => {
      caches.open(CACHE).then(cache => cache.put(e.request, r.clone()));
      return r;
    })));
    return;
  }

  // Network-first for HTML, fall back to cache (then home) when offline
  e.respondWith(fetch(e.request).then(r => {
    caches.open(CACHE).then(c => c.put(e.request, r.clone()));
    return r;
  }).catch(() => caches.match(e.request).then(c => c || caches.match('/'))));
});
