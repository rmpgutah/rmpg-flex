// ============================================================
// RMPG Flex — Service Worker
// Provides offline caching for static assets while always
// fetching API data fresh from the network.
// Supports automatic updates with client notification.
// ============================================================

const CACHE_NAME = 'rmpg-flex-v52';
const MAP_TILE_CACHE = 'rmpg-flex-map-tiles-v1';
const MAP_TILE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAP_TILE_MAX_ENTRIES = 2000; // cap tile cache size
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/favicon.png',
  '/rmpg flex.png',
];

// Install — pre-cache core shell, immediately activate
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  // Skip waiting so the new SW activates immediately
  self.skipWaiting();
});

// Activate — clean old caches (preserve map tile cache), claim clients, notify of update
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      // Delete old caches but keep the current version + map tile cache
      const keepCaches = [CACHE_NAME, MAP_TILE_CACHE];
      const oldKeys = keys.filter((k) => !keepCaches.includes(k));
      return Promise.all(oldKeys.map((k) => caches.delete(k))).then(() => {
        if (oldKeys.length > 0) {
          // Notify all clients that an update was applied
          self.clients.matchAll({ type: 'window' }).then((clients) => {
            clients.forEach((client) => {
              client.postMessage({ type: 'SW_UPDATED', cacheName: CACHE_NAME });
            });
          });
        }
      });
    })
  );
  // Take control of all open tabs immediately
  self.clients.claim();
});

// Fetch — network-first for code/pages, cache-first only for images
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache API calls, WebSocket, or POST requests
  if (
    url.pathname.startsWith('/api') ||
    url.pathname.startsWith('/ws') ||
    event.request.method !== 'GET'
  ) {
    return;
  }

  // Google Maps tiles — stale-while-revalidate
  // Serve cached tiles immediately (no black screen on spotty hotspot),
  // then update cache from network in the background. If network fails,
  // cached tiles still render correctly.
  const isMapTile =
    url.origin !== self.location.origin && (
      url.hostname.includes('googleapis.com') ||
      url.hostname.includes('gstatic.com') ||
      url.hostname.includes('google.com')
    );

  if (isMapTile) {
    event.respondWith(
      caches.open(MAP_TILE_CACHE).then((cache) =>
        cache.match(event.request).then((cached) => {
          const networkFetch = fetch(event.request)
            .then((response) => {
              if (response.ok) {
                cache.put(event.request, response.clone());
              }
              return response;
            })
            .catch(() => {
              // Network failed — return cached or transparent fallback
              return cached || new Response('', { status: 503 });
            });

          // Return cached immediately if available, update in background
          return cached || networkFetch;
        })
      )
    );
    return;
  }

  // All other external origins — pass through without caching
  if (url.origin !== self.location.origin) {
    return;
  }

  // Navigation requests — always network first
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match('/') || caches.match(event.request))
    );
    return;
  }

  // JS and CSS files — NETWORK FIRST, cache fallback
  // Even though Vite hashes filenames, same hash can have different content
  // across deploys (e.g. build config changes, define replacements)
  if (url.pathname.match(/\.(js|css)$/)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || new Response('', { status: 503 })))
    );
    return;
  }

  // Images, fonts, etc. — cache first (these rarely change for same filename)
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok && url.pathname.match(/\.(png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot)$/)) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});

// Listen for messages from the client
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CHECK_UPDATE') {
    self.registration.update();
  }
});

// ─── Map Tile Cache Maintenance ─────────────────────────────
// Trim the map tile cache to prevent unbounded storage growth.
// Runs on activate and can be triggered manually.
async function trimMapTileCache() {
  try {
    const cache = await caches.open(MAP_TILE_CACHE);
    const keys = await cache.keys();
    if (keys.length > MAP_TILE_MAX_ENTRIES) {
      // Delete oldest entries (first in = first out)
      const excess = keys.length - MAP_TILE_MAX_ENTRIES;
      await Promise.all(keys.slice(0, excess).map((k) => cache.delete(k)));
    }
  } catch { /* non-critical */ }
}

// Trim on activate
self.addEventListener('activate', () => { trimMapTileCache(); });
