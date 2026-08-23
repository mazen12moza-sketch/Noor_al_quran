// نور القرآن — Service Worker
// Purpose: make the app itself (the HTML/CSS/JS shell) load with no
// internet once it has been opened at least once — this is what lets the
// installed app open normally even when fully closed and reopened offline.
// It intentionally does NOT touch the Quran text / audio caches — those are
// managed directly by the app (Cache Storage: "noor-quran-data-v1" and
// "noor-audio-v1") through explicit user actions (the "Download the full
// Quran" button, "Download this surah audio", etc).

const SHELL_CACHE = 'noor-shell-v10';
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => Promise.all(
        SHELL_FILES.map((url) => cache.add(url).catch(() => {
          // A missing optional file (e.g. no manifest yet) shouldn't block
          // installation of the rest of the shell.
        }))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(
      names
        .filter((name) => name.startsWith('noor-shell-') && name !== SHELL_CACHE)
        .map((name) => caches.delete(name))
    )).then(() => self.clients.claim())
  );
});

// App-shell strategy: for navigations and same-origin shell files, try the
// network first (so updates are picked up while online) and fall back to
// the cached copy the moment there's no connection. Everything else
// (external APIs, reciter audio, quran data, icons, fonts) is left
// untouched — the page's own code already knows how to work offline for
// those via the Cache Storage APIs it manages itself.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isNavigation = req.mode === 'navigate';
  const isShellFile = isSameOrigin && (
    isNavigation ||
    url.pathname.endsWith('/index.html') ||
    url.pathname.endsWith('/manifest.webmanifest') ||
    url.pathname === '/' 
  );

  if (!isShellFile) return; // let the browser/page handle it normally

  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(SHELL_CACHE).then((cache) => cache.put(isNavigation ? './index.html' : req, copy));
        return res;
      })
      .catch(() => caches.match(isNavigation ? './index.html' : req).then((cached) => cached || caches.match('./index.html')))
  );
});

// Best-effort prayer-time reminder while the app/browser process is alive
// in the background (NOT while fully closed — no web technology can wake a
// closed app to play audio; this is a real platform limitation, not a bug).
// If the page is open and posts a scheduled adhan time, we show a system
// notification as a backup to the in-page alert.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'notify-adhan') {
    const { title, body } = event.data;
    self.registration.showNotification(title || 'نور القرآن', {
      body: body || '',
      icon: './icons/apple-touch-icon.png',
      tag: 'adhan-reminder'
    }).catch(() => {});
  }
});
