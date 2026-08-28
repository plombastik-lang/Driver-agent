const CACHE = 'driver-agent-v2.1-20260828-1';
const ASSETS = ['./','./index.html','./styles.css','./app.js','./manifest.webmanifest','./icon-180.png','./icon-192.png','./icon-512.png'];
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))),
    self.clients.claim()
  ]));
});
self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request, {cache:'no-store'}).then(response => {
      const copy = response.clone();
      caches.open(CACHE).then(c => c.put(event.request, copy));
      return response;
    }).catch(() => caches.match(event.request))
  );
});
