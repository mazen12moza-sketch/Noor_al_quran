// Noor Al-Quran service worker
// Scope: cache the app shell (this page + manifest + icons), the Quran/tafsir
// text (alquran.cloud), the Azkar reciter's audio (hisnmuslim.com), and reciter
// surah audio (mp3quran.net, cdn.islamic.network, alisam.ru) so the app — and
// anything the visitor has actually opened/downloaded — keeps working offline.
// Prayer-time lookups (aladhan.com) are the one thing left untouched, since
// those must always be fresh.

// IMPORTANT: bump this version number (v1 -> v2 -> v3 ...) every time you
// update index.html (or any shell file) and re-upload sw.js. Changing this
// string is what makes the "activate" step below wipe the old cache and pull
// fresh files for every visitor automatically — no need for anyone to clear
// their browser data manually.
const CACHE_NAME = 'noor-alquran-shell-v9';
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

// Prayer-time data needs a real network request every time — never cached.
const NEVER_CACHE_HOSTS = [
  'aladhan.com',
  'islamcan.com'
];

// Quran text, tafsir, and the daily-ayah lookup (alquran.cloud): network-first
// so it's always current when online, but every successful response is also
// saved to a permanent cache — so once a surah or the daily ayah has been
// opened at least once online, it keeps opening offline from then on, instead
// of showing "تعذر تحميل الآية اليومية". Kept in its own cache (not CACHE_NAME)
// so it survives future app-shell updates instead of being wiped on each bump.
const QURAN_TEXT_CACHE = 'noor-alquran-quran-text-v1';
const QURAN_TEXT_HOSTS = ['alquran.cloud'];

// The Azkar reciter's audio (hisnmuslim.com) is the opposite case: once a track
// has been played while online, it's kept in this separate, permanent cache so
// it plays with no internet the next time — the "download once, works forever
// offline" behaviour. Kept in its own cache (not CACHE_NAME) so it survives
// every future app-shell update instead of being wiped on each version bump.
const AZKAR_AUDIO_CACHE = 'noor-alquran-azkar-audio-v1';
const AZKAR_AUDIO_HOSTS = ['hisnmuslim.com'];

// Quran recitation audio (mp3quran.net, cdn.islamic.network, alisam.ru):
// cache-first, same "download once, keep it forever" behaviour. This is what
// makes the "⬇ Download this surah audio" button in the app store the file
// *inside* the app's own storage instead of the phone's Downloads folder —
// and it also means any surah a visitor simply listens to once while online
// quietly becomes available offline too. Kept in its own permanent cache so
// downloaded reciters survive every future app-shell update.
const SURAH_AUDIO_CACHE = 'noor-alquran-surah-audio-v1';
const SURAH_AUDIO_HOSTS = ['mp3quran.net', 'islamic.network', 'alisam.ru'];

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
  const KEEP = [CACHE_NAME, AZKAR_AUDIO_CACHE, QURAN_TEXT_CACHE, SURAH_AUDIO_CACHE];
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((n) => !KEEP.includes(n)).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

// Shared cache-first handler: serve from the given permanent cache if present,
// otherwise fetch, store a copy for next time (including opaque cross-origin
// audio responses, which always report ok:false but are still cacheable), and
// fall back to any previously cached copy if the network fails while offline.
function cacheFirst(req, cacheName){
  return caches.open(cacheName).then((cache) =>
    cache.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res) cache.put(req, res.clone());
        return res;
      }).catch(() => cached);
    })
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // Quran/tafsir text + daily ayah: network-first, permanent cache fallback.
  if (QURAN_TEXT_HOSTS.some((h) => url.hostname.endsWith(h))) {
    event.respondWith(
      caches.open(QURAN_TEXT_CACHE).then((cache) =>
        fetch(req).then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        }).catch(() => cache.match(req)) // offline: fall back to last saved copy
      )
    );
    return;
  }

  if (AZKAR_AUDIO_HOSTS.some((h) => url.hostname.endsWith(h))) {
    event.respondWith(cacheFirst(req, AZKAR_AUDIO_CACHE));
    return;
  }

  if (SURAH_AUDIO_HOSTS.some((h) => url.hostname.endsWith(h))) {
    event.respondWith(cacheFirst(req, SURAH_AUDIO_CACHE));
    return;
  }

  // Prayer times: pass straight through — no caching, no interception at all.
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
