/* Within — service worker: keeps the whole app (and the PDF reader) on the phone. */
const VERSION = 'within-v2';
const CORE = [
  './',
  './index.html',
  './styles.css',
  './data.js',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];
const CDN = [
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(CORE);
    // The PDF reader is optional: if it can't be fetched now, it is cached the first time it loads.
    await Promise.allSettled(CDN.map((url) => cache.add(new Request(url, { mode: 'cors' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== VERSION) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isCdn = url.hostname === 'cdnjs.cloudflare.com';
  if (!sameOrigin && !isCdn) return;

  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    let hit = await cache.match(req, { ignoreSearch: sameOrigin });
    if (!hit && req.mode === 'navigate') hit = (await cache.match('./index.html')) || (await cache.match('./'));

    const fetchAndCache = () => fetch(req).then((res) => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    });

    if (hit) {
      // Serve instantly from the phone; quietly refresh app files in the background when online.
      if (sameOrigin) event.waitUntil(fetchAndCache().catch(() => {}));
      return hit;
    }
    try {
      return await fetchAndCache();
    } catch (err) {
      return Response.error();
    }
  })());
});
