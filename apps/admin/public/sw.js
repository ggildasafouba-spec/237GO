// Service worker minimal pour 237GO Admin (PWA installable).
// Stratégie "network-first" : on privilégie toujours le réseau pour garder les
// données à jour ; le cache ne sert que de secours hors-ligne pour la coquille.

const CACHE = '237go-admin-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // On ne touche pas aux appels API : toujours réseau direct (données fraîches).
  if (request.method !== 'GET' || request.url.includes('/api/')) return;

  event.respondWith(
    fetch(request)
      .then((resp) => {
        // Mettre en cache la coquille/les assets pour le mode hors-ligne
        const copy = resp.clone();
        caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        return resp;
      })
      .catch(() => caches.match(request).then((r) => r || caches.match('/index.html')))
  );
});
