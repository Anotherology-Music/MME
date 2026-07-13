// mmv-sw.js — minimal service worker for the MME MIDI/CC editor.
//
// Only job: let the page be installed as a PWA and opened once without a
// network round-trip. The app itself is fully client-side (no fetches for
// its own operation — projects/audio load from local disk, not a server),
// so there's nothing else worth caching. Must ship as a real file next to
// whichever name the editor's .html is served as (mmv-midi-editor.html or
// mme.html) — the app registers it via a relative URL.
//
// Bump CACHE if this caching strategy ever needs to be invalidated; it's
// otherwise low-maintenance since fetch() always prefers the network.
const CACHE = 'mmv-shell-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.add(new Request(self.registration.scope, { cache: 'reload' })))
      .catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(event.request).then((cached) => cached || caches.match(self.registration.scope))
    )
  );
});
