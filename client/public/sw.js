// ============================================================
// RMPG Flex — Service Worker
// Provides offline caching for static assets while always
// fetching API data fresh from the network.
// Supports automatic updates with client notification.
// v472: Offline CartoDB tile precaching removed — Google Maps
//       is the sole map surface (2026-04-29).
// ============================================================

const CACHE_NAME = 'rmpg-flex-v451';
const TILE_CACHE_NAME = 'rmpg-flex-tiles-v2';
const MAX_CACHE_ENTRIES = 500; // Limit main cache to prevent unbounded growth
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/favicon.png',
  '/rmpg flex.png',
];

// Evict entries when cache exceeds limit (order not guaranteed)
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxEntries) {
    const excess = keys.length - maxEntries;
    const startIndex = Math.floor(Math.random() * (keys.length - excess + 1));
    const toDelete = keys.slice(startIndex, startIndex + excess);
    await Promise.all(toDelete.map((key) => cache.delete(key)));
  }
}

// Install — pre-cache core shell, immediately activate
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .catch((err) => {
        console.warn('[SW] Pre-cache failed:', err);
        // Don't block install — partial cache is acceptable
      })
  );
  // Skip waiting so the new SW activates immediately
  self.skipWaiting();
});

// Activate — clean old caches (including the retired tile cache), claim clients, notify
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      // Delete every cache that isn't the current main cache. This also
      // evicts the retired 'rmpg-flex-tiles-v2' CartoDB tile cache.
      const oldKeys = keys.filter((k) => k !== CACHE_NAME);
      return Promise.all(oldKeys.map((k) => caches.delete(k))).then(() => {
        if (oldKeys.length > 0) {
          self.clients.matchAll({ type: 'window' }).then((clients) => {
            clients.forEach((client) => {
              client.postMessage({ type: 'SW_UPDATED', cacheName: CACHE_NAME });
            });
          });
        }
      });
    })
    .then(() => self.clients.claim())
  );
});

// Fetch — network-first for code/pages, cache-first for images and tiles
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache API calls, WebSocket, POST requests, or external map tiles
  if (
    url.pathname.startsWith('/api') ||
    url.pathname.startsWith('/ws') ||
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin
  ) {
    return;
  }

  // /tiles/* requests no longer have a special cache path. The CartoDB
  // tile fallback was retired 2026-04-29; if any code still references
  // /tiles/, requests fall through to the default network-first handler.

  // Navigation requests — always network first with offline fallback
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, clone);
              trimCache(CACHE_NAME, MAX_CACHE_ENTRIES);
            });
          }
          return response;
        })
        .catch(() =>
          caches.match(event.request)
            .then((cached) => cached || caches.match('/'))
            .then((fallback) => fallback || new Response(
              '<!DOCTYPE html><html><body style="background:#141e2b;color:#e5e7eb;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h1>Offline</h1><p>No network connection. Please reconnect and try again.</p></div></body></html>',
              { status: 503, headers: { 'Content-Type': 'text/html' } }
            ))
        )
    );
    return;
  }

  // JS and CSS files — NETWORK FIRST, cache fallback
  if (url.pathname.match(/\.(js|css)$/)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, clone);
              trimCache(CACHE_NAME, MAX_CACHE_ENTRIES);
            });
          }
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || new Response('', { status: 503, statusText: 'Offline' })))
    );
    return;
  }

  // Images, fonts, etc. — cache first (these rarely change for same filename)
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response.ok && url.pathname.match(/\.(png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot)$/)) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, clone);
              trimCache(CACHE_NAME, MAX_CACHE_ENTRIES);
            });
          }
          return response;
        })
        .catch(() => new Response('', { status: 503, statusText: 'Offline' }));
    })
  );
});

// ─── Background Sync ────────────────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'offline-sync-push') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'SYNC_PUSH_REQUESTED' });
        });
      })
    );
  }
});

// Listen for messages from the client — verify source is a controlled WindowClient
self.addEventListener('message', (event) => {
  // Only accept messages from controlled clients (same-origin guarantee)
  if (!event.source || (event.source.type !== undefined && event.source.type !== 'window')) {
    return;
  }
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CHECK_UPDATE') {
    self.registration.update();
  }
  if (event.data && event.data.type === 'REGISTER_SYNC') {
    if (self.registration.sync) {
      self.registration.sync.register('offline-sync-push').catch(() => {});
    }
  }
  // PRECACHE_TILES message retired 2026-04-29 — clients that still send
  // it (older PWA bundles) are silently ignored.
  // Clean unregister — clear all caches and unregister SW (troubleshooting)
  if (event.data && event.data.type === 'UNREGISTER') {
    event.waitUntil(
      caches
        .keys()
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .then(() => self.registration.unregister())
    );
  }
});
