// Noor Al-Quran service worker
// Scope: cache the app shell (this page + manifest + icons) so the app opens and
// works offline. Everything else — reciter audio (mp3quran.net, cdn.islamic.network),
// the surah/tafsir text APIs (alquran.cloud) and prayer-time lookups (aladhan.com) —
// is left completely untouched here and always goes straight to the network. That's
// intentional: audio must stay online to play, and prayer times must stay fresh.

// IMPORTANT: bump this version number (v1 -> v2 -> v3 ...) every time you
// update index.html (or any shell file) and re-upload sw.js. Changing this
// string is what makes the "activate" step below wipe the old cache and pull
// fresh files for every visitor automatically — no need for anyone to clear
// their browser data manually.
const CACHE_NAME = 'noor-alquran-shell-v5';
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

// Hosts that must NEVER be served from cache or intercepted — recitation audio,
// live Quran/tafsir text, and prayer-time data all need a real network request.
const NEVER_CACHE_HOSTS = [
  'mp3quran.net',
  'islamic.network',
  'alisam.ru',
  'alquran.cloud',
  'aladhan.com',
  'islamcan.com'
];

// The Azkar reciter's audio (hisnmuslim.com) is the opposite case: once a track
// has been played while online, it's kept in this separate, permanent cache so
// it plays with no internet the next time — the "download once, works forever
// offline" behaviour. Kept in its own cache (not CACHE_NAME) so it survives
// every future app-shell update instead of being wiped on each version bump.
const AZKAR_AUDIO_CACHE = 'noor-alquran-azkar-audio-v1';
const AZKAR_AUDIO_HOSTS = ['hisnmuslim.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

// Lets the page (see index.html) tell a waiting worker to activate right away
// instead of waiting for every tab to be closed and reopened.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((n) => n !== CACHE_NAME && n !== AZKAR_AUDIO_CACHE)
          .map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // Azkar reciter audio: cache-first. First listen (online) saves a permanent
  // offline copy inside the app's own storage; every listen after that —
  // online or offline — plays instantly from that copy, no external request.
  if (AZKAR_AUDIO_HOSTS.some((h) => url.hostname.endsWith(h))) {
    event.respondWith(
      caches.open(AZKAR_AUDIO_CACHE).then((cache) =>
        cache.match(req).then((cached) => {
          if (cached) return cached;
          return fetch(req).then((res) => {
            // Cross-origin audio without CORS headers arrives as an "opaque"
            // response (status 0, res.ok is always false) — still perfectly
            // cacheable and playable, so cache it whenever a response comes
            // back at all, not just when res.ok is true.
            if (res) cache.put(req, res.clone());
            return res;
          }).catch(() => cached); // offline and never cached: nothing to serve
        })
      )
    );
    return;
  }

  // Let other audio and live-data requests pass straight through — no caching,
  // no interception at all, exactly like a normal uncontrolled page.
  if (NEVER_CACHE_HOSTS.some((h) => url.hostname.endsWith(h))) return;

  // Only handle same-origin app-shell requests.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req, { cache: 'no-store' })
      .then((res) => {
        // Keep the offline copy fresh whenever we do have a connection.
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
  );
});
