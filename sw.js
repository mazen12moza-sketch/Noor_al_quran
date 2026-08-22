/* Noor Al-Quran — service worker
   Responsible for: making the app installable and letting the app shell
   (this HTML/CSS/JS + icons) load with no internet once it has been
   opened at least once online.

   It deliberately does NOT cache reciter audio or Quran text data —
   those are handled explicitly by index.html using their own Cache
   Storage buckets (noor-audio-v1, noor-quran-data-v1), so audio is only
   ever stored when the person taps "save/download", while the Quran
   text saves itself automatically in the background. Bump SHELL_CACHE's
   version suffix whenever this app is updated so old shells get replaced. */

const SHELL_CACHE = 'noor-shell-v1';
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/favicon-16.png',
  './icons/favicon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

// Caches this service worker is allowed to delete on activate. Anything
// outside this list (the audio/Quran-data caches above) is left alone.
const OWNED_CACHE_PREFIX = 'noor-shell-';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Cache each file independently so one missing/renamed asset (e.g. an
    // icon that wasn't uploaded) can't fail the whole install step.
    await Promise.all(SHELL_FILES.map(async (url) => {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (res && res.ok) await cache.put(url, res.clone());
      } catch (e) { /* that one file just won't be available offline yet */ }
    }));
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((n) => n.startsWith(OWNED_CACHE_PREFIX) && n !== SHELL_CACHE)
        .map((n) => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Only manage same-origin app-shell requests here. Cross-origin requests
  // (Quran API, prayer-time API, reciter audio, Google Fonts, etc.) are left
  // to the network / to the page's own explicit caching so this file never
  // silently grows to hold megabytes of audio or API data.
  if (url.origin !== self.location.origin) return;

  // Navigations (opening/reloading the app): try the network first so an
  // online visitor always gets the latest version, but fall back to the
  // cached shell the moment there's no connection.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(SHELL_CACHE);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch (e) {
        const cache = await caches.open(SHELL_CACHE);
        return (await cache.match('./index.html')) || (await cache.match('./'));
      }
    })());
    return;
  }

  // Other same-origin static files (manifest, icons): cache-first, filling
  // the cache in the background so it stays fresh for next time.
  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(req);
    const network = fetch(req).then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    return cached || (await network) || Response.error();
  })());
});
