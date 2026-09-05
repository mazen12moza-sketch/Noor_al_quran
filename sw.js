// sw.js — Noor Al-Quran service worker
// =================================================================
// Strategy: NETWORK-FIRST for the app itself (index.html, css, js,
// icons, manifest). Every time you open the app with internet, it
// fetches the latest version AND updates the offline copy to match.
// Only when the network truly fails (you're offline) does it fall
// back to whatever was cached from your LAST successful online
// visit — never an old, stuck, install-time snapshot.
//
// API calls (Quran text, prayer times, audio, tafsir, etc.) are
// NOT touched here at all — those are handled separately inside
// index.html itself via IndexedDB, so they keep working exactly as
// before.
// =================================================================

const CACHE_NAME = 'noor-app-shell-v29'; // bump this number any time you want to force everyone onto a clean copy

// Firebase's SDK + the app's web fonts come from a different domain
// (gstatic.com / googleapis.com), not this site. They're cached
// "stale-while-revalidate" style: serve instantly from cache if we
// have it (so a flaky connection can't break Google sign-in), while
// always fetching a fresh copy in the background to keep it current.
const THIRD_PARTY_CACHE_HOSTS = ['www.gstatic.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', () => {
  self.skipWaiting(); // activate the new version immediately, don't wait for old tabs to close
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Delete only OLD versions of THIS service worker's own app-shell
      // cache — never touch other caches the app itself manages (like
      // downloaded reciter audio), and never touch IndexedDB at all,
      // which is a completely separate storage system.
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith('noor-app-shell-') && k !== CACHE_NAME).map((k) => caches.delete(k))
      );
      await self.clients.claim(); // take control of any already-open tabs right away
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // never intercept POST/PUT/etc.

  const url = new URL(req.url);
  const isOwnOrigin = url.origin === self.location.origin;
  const isCachedThirdParty = THIRD_PARTY_CACHE_HOSTS.includes(url.hostname);

  if (!isOwnOrigin && !isCachedThirdParty) return; // everything else (Quran API, prayer times, audio...) goes straight to the network, untouched

  if (isCachedThirdParty) {
    // Stale-while-revalidate: answer instantly from cache if we have it
    // (Firebase/fonts load reliably even on a shaky connection), but always
    // refetch in the background so the cached copy never goes permanently
    // stale.
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(req);
        const networkFetch = fetch(req).then((res) => { cache.put(req, res.clone()); return res; }).catch(() => null);
        return cached || (await networkFetch) || Response.error();
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      try {
        // Always try the network FIRST — this is what makes sure you get
        // the newest deployed version whenever you have internet.
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone()); // keep the offline copy in sync with what was just loaded
        return fresh;
      } catch (err) {
        // Network truly failed (offline) — fall back to the LAST
        // successfully loaded copy, not an old fixed snapshot.
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(req);
        if (cached) return cached;
        if (req.mode === 'navigate') {
          const shell = await cache.match('./index.html');
          if (shell) return shell;
        }
        throw err;
      }
    })()
  );
});
