// ============================================================
// RMPG Flex — Service Worker
// Provides offline caching for static assets while always
// fetching API data fresh from the network.
// Supports automatic updates with client notification.
// v45: Offline tile layer caching (CartoDB dark_matter Z7-15).
//      Pre-downloads 1,738 tiles (~11 MB) for Utah operational
//      area so maps work on vehicle WiFi dead zones.
// ============================================================

const CACHE_NAME = 'rmpg-flex-v224';
const TILE_CACHE_NAME = 'rmpg-flex-tiles-v2';
const MAX_CACHE_ENTRIES = 500; // Limit main cache to prevent unbounded growth
const MAX_TILE_CACHE_ENTRIES = 3000; // Tile cache limit
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/favicon.png',
  '/rmpg flex.png',
  '/maps/utah-z7.png',
  '/maps/utah-slc-z11.png',
  '/maps/utah-slc-z13.png',
  '/tiles/manifest.json',
];

// Evict oldest entries when cache exceeds limit
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxEntries) {
    const toDelete = keys.slice(0, keys.length - maxEntries);
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

// Activate — clean old caches, claim clients, notify, then start tile pre-cache
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      // Delete old caches (but preserve the current tile cache)
      const oldKeys = keys.filter((k) => k !== CACHE_NAME && k !== TILE_CACHE_NAME);
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
    .then(() => {
      // Kick off background tile pre-caching (non-blocking)
      precacheTiles();
    })
  );
});

// ── Background Tile Pre-Caching ────────────────────────────
// Reads the tile manifest and caches tiles in batches of 50.
// Runs after activation so it doesn't block SW install.
// If the user revisits, already-cached tiles are skipped.
async function precacheTiles() {
  try {
    // Check storage quota — skip tile caching if usage exceeds 80%
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      if (estimate.usage && estimate.quota && estimate.usage / estimate.quota > 0.8) {
        console.log('[SW] Storage quota >80% — skipping tile pre-cache');
        return;
      }
    }

    const resp = await fetch('/tiles/manifest.json');
    if (!resp.ok) return;
    const tilePaths = await resp.json();
    if (!Array.isArray(tilePaths) || tilePaths.length === 0) return;

    const tileCache = await caches.open(TILE_CACHE_NAME);

    // Check which tiles are already cached
    const uncached = [];
    for (const path of tilePaths) {
      const existing = await tileCache.match(path);
      if (!existing) uncached.push(path);
    }

    if (uncached.length === 0) return;

    // Cache in batches of 50
    const BATCH = 50;
    let done = 0;
    for (let i = 0; i < uncached.length; i += BATCH) {
      const batch = uncached.slice(i, i + BATCH);
      await Promise.all(
        batch.map((path) =>
          fetch(path)
            .then((r) => {
              if (r.ok) return tileCache.put(path, r);
            })
            .catch(() => { /* skip failed tiles — will be retried on next activation */ })
        )
      );
      done += batch.length;

      // Notify clients of progress
      self.clients.matchAll({ type: 'window' }).then((clients) => {
        clients.forEach((c) => {
          c.postMessage({
            type: 'TILE_PRECACHE_PROGRESS',
            done,
            total: uncached.length,
          });
        });
      });
    }

    // Trim tile cache to limit
    await trimCache(TILE_CACHE_NAME, MAX_TILE_CACHE_ENTRIES);

    // Notify completion
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      clients.forEach((c) => {
        c.postMessage({ type: 'TILE_PRECACHE_COMPLETE', count: uncached.length });
      });
    });
  } catch (err) {
    console.warn('[SW] Tile pre-cache error:', err);
    // Non-fatal — tiles will be cached on-demand via fetch handler
  }
}

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

  // ── Offline map tiles — cache-first from tile cache ──
  // These are pre-downloaded CartoDB dark_matter tiles in /tiles/{z}/{x}/{y}.png
  // Cache-first is correct because tiles are static and never change.
  if (url.pathname.startsWith('/tiles/')) {
    event.respondWith(
      caches.open(TILE_CACHE_NAME).then((tileCache) =>
        tileCache.match(event.request).then((cached) => {
          if (cached) return cached;
          // Not in tile cache — try main cache, then network
          return caches.match(event.request).then((mainCached) => {
            if (mainCached) return mainCached;
            return fetch(event.request).then(async (response) => {
              if (response.ok) {
                // Only cache if we have storage headroom
                let canCache = true;
                if (navigator.storage && navigator.storage.estimate) {
                  try {
                    const est = await navigator.storage.estimate();
                    if (est.usage && est.quota && est.usage / est.quota > 0.8) canCache = false;
                  } catch { /* proceed with caching */ }
                }
                if (canCache) tileCache.put(event.request, response.clone());
              }
              return response;
            }).catch(() => {
              // Tile unavailable offline — return transparent 1x1 PNG
              return new Response(
                Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), c => c.charCodeAt(0)),
                { status: 200, headers: { 'Content-Type': 'image/png' } }
              );
            });
          });
        })
      )
    );
    return;
  }

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
  // Allow manual trigger of tile pre-caching
  if (event.data && event.data.type === 'PRECACHE_TILES') {
    precacheTiles();
  }
  // Clean unregister — clear all caches and unregister SW (troubleshooting)
  if (event.data && event.data.type === 'UNREGISTER') {
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))));
    self.registration.unregister();
  }
});
