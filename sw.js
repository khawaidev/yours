/* Yours — service worker
   ------------------------------------------------------------
   Minimal offline shell:
   - Precaches the install page and core app assets.
   - Same-origin GETs: network-first for documents (so users
     always get the newest page), cache-first for static
     assets (css/js/icons/images).
   - Cross-origin requests (Supabase, CDNs, R2 images) are
     never touched — they go straight to the network.
*/
var CACHE = 'yours-v5';

var PRECACHE = [
  './',
  'install.html',
  'index.html',
  'auth.html',
  'confirm-email.html',
  'Age.html',
  'name.html',
  'age-interest.html',
  'art-interest.html',
  'eye-interest.html',
  'explore-interest.html',
  'personality-interest.html',
  'analyse.html',
  'css/app.css',
  'css/onboarding.css',
  'js/api-client.js',
  'js/onboarding.js',
  'js/desktop-shell.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/favicon-32.png',
  'Assets/yours-screen1-trim.jpg',
  'Assets/yours-screen2-trim.jpg',
  'manifest.webmanifest'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // Individual puts so one bad asset can't fail the install.
      return Promise.all(PRECACHE.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () {});
      }));
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        return k !== CACHE;
      }).map(function (k) {
        return caches.delete(k);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);

  // Never intercept cross-origin traffic.
  if (url.origin !== self.location.origin) return;

  // Documents: network-first, fall back to the cached page.
  if (req.mode === 'navigate' ||
      (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match('index.html');
        });
      })
    );
    return;
  }

  // Static assets: cache-first, then network (and cache it).
  event.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    })
  );
});
