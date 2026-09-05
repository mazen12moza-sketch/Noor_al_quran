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

const CACHE_NAME = 'noor-app-shell-v27'; // bump this number any time you want to force everyone onto a clean copy

self.addEventListener('install', () => {
  self.skipWaiting(); // activate the new version immediately, don't wait for old tabs to close
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Delete every OLD cache version so nothing stale can ever be served again.
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
      await self.clients.claim(); // take control of any already-open tabs right away
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // never intercept POST/PUT/etc.

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // let every external API call (Quran, prayer times, audio...) go straight to the network, untouched

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
