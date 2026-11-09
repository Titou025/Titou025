const CACHE = 'la-peche-v4';
const FILES = ['./', './index.html', './style.css', './app.js', './manifest.json', './icon-180.png', './icon-192.png', './icon-512.png', './lib/html5-qrcode.min.js', './ciqual.json'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin) return; // API Open Food Facts : toujours réseau
  // réseau d'abord (mises à jour), cache si hors ligne
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(k => k.put(e.request, c)); return r; })
    .catch(() => caches.match(e.request)));
});
