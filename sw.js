/* Yours — service worker
   ----------------------------------------------------------------
   Speed-focused offline shell:
   - Precaches the app's inner pages and core assets on install.
   - Same-origin pages: stale-while-revalidate. The cached copy is
     served immediately (instant in-app navigation) while the fresh
     copy downloads in the background for the next visit.
   - Same-origin static assets (css/js/icons/images): cache-first.
   - Big CDN dependencies (Tailwind Play CDN, Font Awesome, Google
     Fonts, jsDelivr) are cached at runtime with stale-while-revalidate
     so they are only downloaded once per cache version.
   - Character media on R2 / ImageKit is cache-first (the admin gives
     every upload a new filename, so URLs are effectively immutable).
   - Supabase API traffic is never cached.
*/
var CACHE = 'yours-v10';
var RUNTIME = 'yours-runtime-v10';

var PRECACHE = [
  './',
  'install.html',
  'index.html',
  'feed.html',
  'Discover.html',
  'chat.html',
  'messaging.html',
  'character-profile.html',
  'user-profile.html',
  'settings.html',
  'notifications.html',
  'recharge.html',
  'auth.html',
  'confirm-email.html',
  'call.html',
  'css/app.css',
  'css/onboarding.css',
  'js/api-client.js',
  'js/onboarding.js',
  'js/desktop-shell.js',
  'js/pwa.js',
  'js/vendor/dexie.min.js',
  'js/db.js',
  'js/opfs.js',
  'js/local-store.js',
  'js/storage.js',
  'js/media-viewer.js',
  'js/memory.js',
  'js/chat-engine.js',
  'js/migrate.js',
  'js/incoming-call.js',
  'js/rag-worker.js',
  'js/animations.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-512-maskable.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
  'Assets/football-card.png',
  'Assets/browser.png',
  'Assets/ai-technology.png',
  'Assets/user-1.png',
  'Assets/yours-screen1-trim.jpg',
  'Assets/yours-screen2-trim.jpg',
  'manifest.webmanifest'
];

// Third-party assets that block first paint — cache once, reuse forever
// (until CACHE changes).
var CDN_HOSTS = [
  'cdn.tailwindcss.com',
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net'
];

// Character media hosts: uploads always get a new filename, so the URL is
// safe to serve from cache.
var MEDIA_HOSTS = [
  'pub-475cca0b7414418d866128a4b30dfd97.r2.dev',
  'ik.imagekit.io'
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
        return k !== CACHE && k !== RUNTIME;
      }).map(function (k) {
        return caches.delete(k);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// Serve the cached copy immediately, refresh it in the background.
function staleWhileRevalidate(event, cacheName) {
  var req = event.request;
  return caches.open(cacheName).then(function (cache) {
    return cache.match(req).then(function (hit) {
      var network = fetch(req).then(function (res) {
        var cacheable = res && (res.ok || res.type === 'opaque');
        if (cacheable) cache.put(req, res.clone());
        return res;
      }).catch(function () {
        return hit;
      });
      if (hit) {
        event.waitUntil(network);
        return hit;
      }
      return network;
    });
  });
}

// Serve from cache, only hitting the network on a miss.
function cacheFirst(req, cacheName) {
  return caches.open(cacheName).then(function (cache) {
    return cache.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      });
    });
  });
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);

  // Character images/videos: cache-first so a revisited profile/feed is
  // instant and does not re-download multi-MB media.
  if (MEDIA_HOSTS.indexOf(url.hostname) !== -1) {
    event.respondWith(cacheFirst(req, RUNTIME));
    return;
  }

  // CDN dependencies: instant on repeat views, updated in the background.
  if (url.origin !== self.location.origin) {
    if (CDN_HOSTS.indexOf(url.hostname) !== -1) {
      event.respondWith(staleWhileRevalidate(event, RUNTIME));
    }
    // Everything else cross-origin (Supabase, backend API) is untouched.
    return;
  }

  // Pages: serve the cached document instantly, refresh it in the
  // background. Falls back to the cached shell when offline.
  if (req.mode === 'navigate' ||
      (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      staleWhileRevalidate(event, CACHE).then(function (res) {
        return res || caches.match(req).then(function (hit) {
          return hit || caches.match('index.html');
        });
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match('index.html');
        });
      })
    );
    return;
  }

  // Static assets: cache-first, then network (and cache it).
  event.respondWith(cacheFirst(req, CACHE));
});
