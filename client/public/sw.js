// ============================================================
// RMPG Flex — Service Worker
// Provides offline caching for static assets while always
// fetching API data fresh from the network.
// Supports automatic updates with client notification.
// v1101: Console-error sweep. (1) Warrants: clicking a national-scraper row
//        no longer fires /warrants/<scraped-id> (synthetic string ids 400 on
//        the server's numeric guard) — the detail pane, single-warrant PDF and
//        attachment/email panels now read the unified list row, and every write
//        action is hidden on those rows with an "External · read-only" badge.
//        (2) New GET /api/oidc/dialer/check — the identifier-first SSO probe
//        LoginPage has always called but which never existed (404 every login).
//        (3) Password-change and password-reset forms now carry a hidden
//        username field for password managers / the Chrome DOM warning.
//        (The feature-flags 401 poll loop from the same log was already fixed
//        on main by #2990 — that fix is kept as-is, not re-litigated here.)
// v1102: Network-failure retry. Every `.catch()` in the fetch handler treated
//        "this worker was replaced mid-request" identically to "the device is
//        offline", so each deploy turned in-flight requests into synthetic
//        503s (an EMPTY-BODY one for anything hitting the catch-all branch).
//        fetchWithRetry() retries once before giving up, which separates the
//        two cheaply: a genuinely offline device fails again immediately,
//        a deploy-window blip succeeds on the retry.
// v1096: Fleet v2 (FleetShell) — Page 73 of the full-app frontend pass.
//        Added N shortcut (open New Vehicle modal when not typing),
//        Esc cascade (closes New Vehicle modal before propagating),
//        ?unit_id= deep-link param (alongside ?vehicle_id= and ?fleet_id=),
//        VehicleDetailRoute now distinguishes loading vs 404 (no more
//        silent blank on a bad ID), GpsTrackingRoute link updated from
//        /fleet-legacy to /map (the actual GPS map surface).
// v1097: Route Builder backend built (/api/dispatch/routing was never
//        mounted — all four endpoints 404'd) + Directions now flow through
//        the /api/mapbox proxy instead of direct api.mapbox.com fetches.
// v1098: Dispatch clear/close/cancel now releases the call's assigned units
//        back to 'available' server-side (units.current_call_id was never
//        cleared, so they stayed stuck 'dispatched' on a dead call forever).
//        Mapbox style-load HTML-response failures get a clear, actionable
//        error message instead of a raw JSON SyntaxError on screen.
// v1099: Active F-key nav tab + Dashboard "Alerts & Reminders" panel switched
//        from gold to steel-blue accent (--toolbar-nav-text-active, the
//        active-tile border/glow, and SpmGroup tone) — brand gold stays on
//        alerts/warnings only, blue carries the app's primary identity.
// v1100: New "Blue & Silver" full-override theme (Settings → Display & Theme),
//        same tier as the legacy black kill-switch: deep navy-blue surfaces
//        with a silver accent replacing gold. html.theme-blue-silver +
//        rmpg_theme_blue_silver flag; mutually exclusive with legacy black.
// v1089: Community (/community) — Page 71 of the full-app frontend pass.
//        Fixed critical bug: "New Event" modal never opened (showForm was
//        `editingRecord !== null`, but openNew() set it to null). Separate
//        showForm boolean state introduced. Replaced inline delete div with
//        ConfirmDialog. Added Esc cascade (delete → form), N shortcut,
//        ?event_id= deep-link, tab nav for Tips/Watch Groups/Alerts,
//        role-guard hiding write buttons for read-only roles, per-tab lazy
//        loading, and distinct empty-state messages.
// v451: Traccar replaces OwnTracks as the dominant primary GPS source.
//       /api/traccar (canonical) + /traccar (alias) accept Traccar
//       Client (OsmAnd HTTP), Traccar Server forward-webhook, and
//       generic flat JSON. /owntracks/* returns 410 Gone. Optional
//       Traccar Server REST API pull mode (15-second poll) when
//       traccar_server_url + email + password configured.
// v452: Align Traccar config keys with prod schema (traccar_url/email/
//       password/enabled/poll_interval). Migrate owntracks_pending_devices
//       → traccar_pending_devices. Honor traccar_enabled toggle.
// v453: /api/traccar/health route order fix (was shadowed by /:user).
// v454: Traccar Server poller decrypts AES-encrypted email/password from
//       system_config; top-level ESM import for poller; admin pull-status
//       card with live OK/ERROR pill; non-secret config keys render as
//       type=text; collapse traccar_pull_status to one row.
// v455: Traccar historical bulk import — every column preserved, with
//       map viewer (Historical GPS Tracks page + admin import section).
// v456: Bug fixes — allow traccar_url/enabled/poll_interval through
//       admin third-party-keys endpoint (URL save was rejected); fix
//       fv.unit_number → fv.vehicle_number in /historical/devices.
// v457: Mount /api/traccar webhook router AFTER admin router so the
//       /:user/:device wildcard no longer shadows specific endpoints
//       like /historical/devices, /devices, /mappings, /credentials.
//       Webhook still receives bare /api/traccar?token= and any unmatched
//       sub-paths from devices configured with /api/traccar/<u>/<d> URLs.
// v458: Stop encrypting non-secret keys (traccar_url, traccar_enabled,
//       traccar_poll_interval) when saved through admin third-party-keys.
//       Poller reads them raw; encryption was producing "Failed to parse
//       URL from <iv:tag:cipher>" errors in the pull-status panel.
// v459: Fix second column-name bug in /api/traccar/historical/devices —
//       fleet_vehicles uses plate_number, not license_plate.
// v460: Historical tracks visual upgrade — speed-bucketed polyline gradient
//       (6 colors blue→red), direction arrows along the track, distinct
//       Start (S) and End (E) markers, idle/stop detection (≥2 min) marked
//       with purple "P" pins, speed legend overlay in bottom-left corner.
// v461: Map sidebar A+B hybrid — gold-accented stratified section headers
//       (text-[#d4a017] uppercase, gold-glow + 0.18em tracking), uniform
//       brighter item rows (#b8b8b8) with gold-rail hover indicator. Heatmap
//       layer collapsed to soft haze (radius 30→14, opacity 0.7→0.28,
//       maxIntensity capped at 8) so it no longer reads as hard rings.
// v472: Offline CartoDB tile precaching removed — Google Maps
//       is the sole map surface (2026-04-29). TILE_CACHE_NAME retired.
// v473: Offline-mode subscribe-time reconciliation + HR test warmup
//       (2026-04-30). Forces clients onto the new bundle.
// v474: Call marker info bubble redesigned — 11 dispatcher fields packed
//       into a tight 280-340px panel: priority pill + call_number +
//       status pill + age in header; incident type subhead; address +
//       cross-street + property; beat/sector geography; time received
//       (relative + absolute); aggregated hazard banner (officer safety,
//       weapons, felony, domestic, hazmat, mental health, gang) only when
//       a flag is set; existing assigned/nearest unit sections preserved.
// v477: Merge origin/main into flamboyant-nobel — bring 42 PRs (business
//       records, ALPR design, map sidebar visual upgrade, click-target
//       a11y, loading screens, WebSocket Reconnecting pill, AbortController
//       timeouts) into the production-deployed branch (2026-05-01).
// v478: Spillman CAD console (P1 structural replica) — command line +
//       three status grids on Dispatch, toggle key rmpg_dispatch_cad_board.
// ============================================================

// 'rmpg-flex-BUILD' is a placeholder — the stamp-sw-version plugin in
// vite.config.ts replaces it with 'rmpg-flex-<git-sha>' on every prod build.
// NEVER hand-edit this to a vNNN literal: a static value means clients never
// invalidate their cache and keep serving the previous UI after deploys
// (incidents: SW v321 2026-05-24, and v563 2026-07-01).
const CACHE_NAME = 'rmpg-flex-BUILD';
const MAX_CACHE_ENTRIES = 500; // Limit main cache to prevent unbounded growth
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/favicon.png',
  '/rmpg flex.png',
  // Sampled console feedback sounds (soundAssets.ts) — offline-critical.
  // The system/UI set + the full Spillman/Motorola dispatch tone library
  // (dispatchTones.ts plays these asset-first with synth fallback).
  //
  // ⚠️ This list is EXPLICIT. A new sound added to client/public/sounds/ is
  // NOT precached until it appears here, and uiClickSounds is sample-only
  // with no synth fallback — so offline it plays silence.
  '/sounds/click.wav',
  '/sounds/navigate.wav',
  '/sounds/ui_open.wav',
  '/sounds/ui_close.wav',
  '/sounds/ui_error.wav',
  '/sounds/submit.wav',
  '/sounds/update.wav',
  '/sounds/delete.wav',
  '/sounds/login.wav',
  '/sounds/info.wav',
  '/sounds/caution.wav',
  '/sounds/warning.wav',
  '/sounds/error.wav',
  '/sounds/alert.wav',
  '/sounds/alarm.wav',
  '/sounds/chirp.wav',
  '/sounds/double_chirp.wav',
  '/sounds/descending.wav',
  '/sounds/p1_alert.wav',
  '/sounds/panic_continuous.wav',
  '/sounds/key_up.wav',
  '/sounds/key_out.wav',
  '/sounds/radio_grant.wav',
  '/sounds/radio_deny.wav',
  '/sounds/quick_call_2.wav',
  '/sounds/talk_permit_low.wav',
  '/sounds/call_alert.wav',
  '/sounds/knox_alert.wav',
  '/sounds/squelch_tail.wav',
  '/sounds/static_burst.wav',
  '/sounds/boop.wav',
  '/sounds/dispatch_bell.wav',
  '/sounds/data_chirp.wav',
  '/sounds/emergency_three.wav',
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

// Cache a response and run eviction, used as a fire-and-forget side effect
// alongside the returned network/cache response in every strategy branch
// below. Single .catch() prevents Cache API failures (QuotaExceededError,
// Safari private-browsing storage restrictions) from surfacing as unhandled
// promise rejections in the SW console.
function cachePut(cacheName, request, response) {
  caches.open(cacheName)
    .then((cache) => cache.put(request, response).then(() => trimCache(cacheName, MAX_CACHE_ENTRIES)))
    .catch(() => {});
}

// A fetch() rejection inside the SW does NOT reliably mean the device is
// offline. When a new worker takes over via skipWaiting() + clients.claim()
// (see the install/activate handlers below — this app swaps immediately, so
// it happens on EVERY deploy), requests the outgoing worker already had in
// flight are cancelled and reject with exactly the same TypeError as a real
// network loss. The catch branches downstream then synthesize a 503 "Offline"
// for a device that is perfectly online, which is how a routine deploy could
// hand the app an empty-body 503 for a page it was mid-navigation to.
//
// Retrying once separates the two cheaply. A genuinely offline device fails
// again right away (DNS/connect errors are sub-second), so an officer with no
// signal waits ~300ms longer before seeing the offline UI — while a
// deploy-window cancellation succeeds on the second attempt.
//
// Safe to replay: the fetch handler only ever reaches here for GET requests
// (the guard below returns early on any other method), and a GET Request has
// no body to consume, so the same Request object can be re-issued.
const RETRY_DELAY_MS = 300;

function fetchWithRetry(request) {
  return fetch(request).catch((firstErr) =>
    new Promise((resolve, reject) => {
      setTimeout(() => {
        // Reject with the ORIGINAL error so downstream catch branches and any
        // console output describe the initial failure, not the retry's.
        fetch(request).then(resolve, () => reject(firstErr));
      }, RETRY_DELAY_MS);
    })
  );
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
          // Notify v539+ clients that have an auto-reload handler.
          // The SW-side force-reload (client.navigate) was REMOVED
          // 2026-05-05 because it was causing perceived slowness on
          // Electron — the cache eviction + navigation triggered a
          // full bundle re-fetch every time a new SW activated. The
          // v539+ client-side auto-reload (1.5s after SW_UPDATED with
          // input-focus guard) is enough; pre-v539 sessions can do a
          // one-time manual reload.
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

// Third-party telemetry beacons that some operator networks (DNS sinkhole /
// ad blocker / corporate proxy) block outright. mapboxLoader.ts previously
// tried to redirect these via `mapboxgl.config.EVENTS_URL = ...`, but in
// mapbox-gl v3 EVENTS_URL is a read-only *getter* derived from API_URL — the
// assignment silently no-ops (threw in the try/catch, which swallowed it as
// if config were unwritable). Squelch the noise here instead: short-circuit
// these requests with an empty 204 before they ever hit the network, so a
// blocked beacon can't spam the console with `net::ERR_CONNECTION_REFUSED`.
// Purely cosmetic — these are fetch()/XHR POSTs with no Subresource
// Integrity check, so an empty synthetic body is safe.
//
// static.cloudflareinsights.com/beacon.min.js is deliberately NOT here —
// Cloudflare auto-injects that <script> tag with an `integrity="sha512-…"`
// attribute. A script load DOES enforce SRI, so answering it with an empty
// body doesn't silence the console — it swaps ERR_CONNECTION_REFUSED for a
// more confusing "Failed to find a valid digest in the integrity attribute"
// block (confirmed: the browser's reported hash is the SHA-512 of an empty
// string, i.e. our synthetic response). Net effect is identical either way
// (script never loads), so just let it fail its normal, less confusing way.
const TELEMETRY_HOSTS = ['events.mapbox.com', 'events.mapbox.cn'];

// Fetch — network-first for code/pages, cache-first for images and tiles
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (TELEMETRY_HOSTS.includes(url.hostname)) {
    event.respondWith(new Response(null, { status: 204 }));
    return;
  }

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
      fetchWithRetry(event.request)
        .then((response) => {
          if (response.ok) {
            cachePut(CACHE_NAME, event.request, response.clone());
          }
          return response;
        })
        .catch(() =>
          caches.match(event.request)
            .then((cached) => cached || caches.match('/'))
            .then((fallback) => fallback || new Response(
              '<!DOCTYPE html><html><head><title>Offline — RMPG Flex</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;padding:0}body{background:#0a0a0a;color:#d4a017;font-family:Calibri,Arial,Helvetica,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}.card{text-align:center;max-width:420px;padding:32px 28px;border:1px solid #222;background:#141414;border-radius:2px}h1{margin:0 0 12px;font-size:18px;letter-spacing:0.05em;text-transform:uppercase;color:#d4a017}p{margin:0 0 20px;color:#888;font-size:13px;line-height:1.5}button{background:#d4a017;color:#000;border:0;padding:10px 28px;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;cursor:pointer;border-radius:2px;font-family:inherit}button:hover{background:#f0bf38}</style></head><body><div class="card"><h1>Connection Lost</h1><p>Unable to reach the RMPG Flex server. Check your network connection and retry.</p><button onclick="window.location.reload()" type="button">Retry</button></div></body></html>',
              { status: 503, headers: { 'Content-Type': 'text/html' } }
            ))
        )
    );
    return;
  }

  // JS/CSS strategy split by URL shape:
  // - /assets/<name>-<hash>.<ext>  → CACHE FIRST (hash is the version, content
  //   is immutable; once cached, never re-fetch unless cache miss). This was
  //   the load-time killer: every launch spent seconds re-validating already-
  //   cached vendor + index chunks against the network before falling back.
  // - Anything else (e.g. /sw.js itself if accessed as a script) → network
  //   first with cache fallback (preserves the old behavior for non-hashed
  //   resources that DO change content for the same URL).
  if (url.pathname.match(/\.(js|css)$/)) {
    const isHashedAsset = url.pathname.startsWith('/assets/');

    if (isHashedAsset) {
      // Cache-first — return immediately if we have it, only hit network on miss.
      event.respondWith(
        caches.match(event.request).then((cached) => {
          if (cached) return cached;
          return fetchWithRetry(event.request)
            .then((response) => {
              // Poison guard: a deploy-removed chunk hash can come back as a
              // 200 text/html SPA fallback (index.html). NEVER cache or return
              // HTML for a JS/CSS request — that produces the "Expected a
              // JavaScript-or-Wasm module … MIME type text/html" execution
              // error and, if cached, persists it. Surface a 404 so the
              // dynamic import rejects and lazyRetry reloads the fresh bundle.
              const ct = response.headers.get('Content-Type') || '';
              if (ct.includes('text/html')) {
                return new Response('', { status: 404, statusText: 'Stale chunk (HTML fallback)' });
              }
              if (response.ok) {
                cachePut(CACHE_NAME, event.request, response.clone());
              }
              return response;
            })
            .catch(() => new Response('', { status: 503, statusText: 'Offline' }));
        })
      );
      return;
    }

    // Non-hashed JS/CSS → network first
    event.respondWith(
      fetchWithRetry(event.request)
        .then((response) => {
          // Same poison guard as the hashed branch — never cache/return HTML
          // for a JS/CSS request (see v716 note).
          const ct = response.headers.get('Content-Type') || '';
          if (ct.includes('text/html')) {
            return caches.match(event.request).then(
              (cached) => cached || new Response('', { status: 404, statusText: 'Stale chunk (HTML fallback)' })
            );
          }
          if (response.ok) {
            cachePut(CACHE_NAME, event.request, response.clone());
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
      return fetchWithRetry(event.request)
        .then((response) => {
          if (response.ok && url.pathname.match(/\.(png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot)$/)) {
            cachePut(CACHE_NAME, event.request, response.clone());
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
