// ============================================================
// RMPG Flex — Service Worker
// Provides offline caching for static assets and API GET responses.
// API data is served stale from rmpg-api-data cache when offline.
// Supports automatic updates with client notification.
// v1108: FetchEvent rejections still fire from stale controllers AND from
//        dialer.rmpgutah.us/sw.js (separate origin). Wrap the Flex fetch
//        handler so a throw never rejects respondWith. Never take ownership
//        of Cloudflare Insights or any other cross-origin URL.
// v1106: Login navigations must not become an empty 503 Offline when the
//        document URL has a query string (`/login?return=%2F`) that missed
//        the precached `/` shell. Match ignoreSearch and always stash `/`.
// v1106: Route Planner Mapbox 422 (stale depart_at) + serve-attempt upload
//        KEK fallback. SW skips chrome-extension / blob / /cdn-cgi so those
//        fetches are not "Uncaught (in promise) TypeError: Failed to fetch".
// v1105: Field-console offline sweep. Do not take ownership of
//        static.cloudflareinsights.com (FetchEvent rejection + SRI). Strip
//        more beacon <script> shapes from HTML. Same-origin API cache warm
//        (no X-Offline-Warm CORS preflight).
// v1103: Offline data layer. API GET responses are now cached in a stable
//        'rmpg-api-data' cache (network-first, stale fallback). Pages load
//        with last-seen data when offline instead of going blank. Auth,
//        health, WebSocket, and offline-sync endpoints are excluded from
//        caching. A separate 250-entry eviction cap applies to the API
//        cache so it does not grow unbounded. The rmpg-api-data cache
//        survives app deployments (only the versioned rmpg-flex-* caches
//        are pruned on activate). Write-queue flush (SYNC_PUSH_REQUESTED)
//        now wired from the SW background-sync event to the page's
//        processQueue() via the message channel.
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
// v1103: Background sync (gps-flush tag) — flushes unsynced IDB GPS fixes to
//        /api/dispatch/gps in ≤500-fix chunks when the device reconnects,
//        even if the RMPG Flex tab is closed. Replaces localStorage failover.
// ============================================================

// 'rmpg-flex-BUILD' is a placeholder — the stamp-sw-version plugin in
// vite.config.ts replaces it with 'rmpg-flex-<git-sha>' on every prod build.
// NEVER hand-edit this to a vNNN literal: a static value means clients never
// invalidate their cache and keep serving the previous UI after deploys
// (incidents: SW v321 2026-05-24, and v563 2026-07-01).
const CACHE_NAME = 'rmpg-flex-BUILD';
const MAX_CACHE_ENTRIES = 500; // Limit main cache to prevent unbounded growth
// Separate stable cache for API GET responses so it survives app deployments.
// Named without the build SHA so it persists across updates.
const API_CACHE_NAME = 'rmpg-api-data';
const MAX_API_CACHE_ENTRIES = 250;
// API endpoints whose responses change too rapidly or are security-sensitive
// to serve stale. All others are cached network-first.
const API_NO_CACHE = ['/api/auth', '/api/health', '/api/ws', '/api/offline'];
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
  var limit = cacheName === API_CACHE_NAME ? MAX_API_CACHE_ENTRIES : MAX_CACHE_ENTRIES;
  caches.open(cacheName)
    .then((cache) => cache.put(request, response).then(() => trimCache(cacheName, limit)))
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

// Cache Storage reads can REJECT, not just miss — quota pressure, a browser
// eviction mid-read, or storage torn down while a worker is being replaced.
// Every fetch() chain below already ends in .catch(), but the caches.match()
// chains did not, so one rejecting read went straight through respondWith.
// A promise handed to respondWith must never reject: when it does the browser
// logs "The FetchEvent for <url> resulted in a network error response: the
// promise was rejected" and the page gets a hard failure instead of the
// offline fallback this handler exists to provide — it does NOT quietly fall
// back to the network. A burst of identical rejections in the same millisecond
// is the signature, since parallel asset requests share the one failing cache.
//
// Treating a rejected read as a miss is right in every branch here: a miss
// falls through to the network, which is exactly what an unusable cache wants.
function cacheMatch(request, matchOpts) {
  return caches.match(request, matchOpts).catch(() => undefined);
}

function fetchWithRetry(request, opts) {
  var fetchOpts = opts || {};
  return fetch(request, fetchOpts).catch((firstErr) =>
    new Promise((resolve, reject) => {
      setTimeout(() => {
        fetch(request, fetchOpts).then(resolve, () => reject(firstErr));
      }, RETRY_DELAY_MS);
    })
  );
}

// A promise given to event.respondWith must never reject. Network errors,
// cache failures, and blocked third-party hosts otherwise surface as
// "Uncaught (in promise) TypeError: Failed to fetch" on the FetchEvent.
function settleFetch(promise, fallback) {
  return Promise.resolve(promise).catch(function () {
    return fallback || new Response('', { status: 503, statusText: 'Offline' });
  });
}

function safeRespond(event, promise) {
  event.respondWith(settleFetch(promise));
}

// Install — pre-cache core shell, immediately activate.
// cache.addAll is ATOMIC — if ANY single file fails (one sound file on spotty
// cellular), NOTHING gets cached, including index.html. Use individual puts so
// critical assets (index.html, manifest) survive even when optional sounds fail.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) =>
        Promise.allSettled(
          STATIC_ASSETS.map((asset) =>
            fetch(asset, { cache: 'reload' })
              .then((res) => {
                if (res.ok) return cache.put(asset, res);
              })
              .catch(() => {})
          )
        )
      )
      .then((results) => {
        var failed = results
          ? results.filter((r) => r.status === 'rejected').length
          : 0;
        if (failed > 0) {
          console.warn('[SW] Pre-cache: ' + failed + '/' + STATIC_ASSETS.length + ' assets failed');
        }
      })
      .catch((err) => {
        console.warn('[SW] Pre-cache failed:', err);
      })
  );
  self.skipWaiting();
});

// Activate — clean stale caches, claim clients, notify.
// Keep the IMMEDIATELY PREVIOUS cache alive so in-flight sessions whose
// index.html still references old chunk URLs can serve them from cache
// instead of 404-ing against the new deploy. Only caches older than the
// previous deploy (and the retired tile cache) are purged.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      // Keep the current main cache + the immediately previous rmpg-flex-* cache
      // (protects in-flight chunk requests from concurrent deploy). Also keep
      // the stable API data cache unconditionally — it survives every deploy.
      const oldKeys = keys.filter((k) => k !== CACHE_NAME && k !== API_CACHE_NAME);
      const rmpgKeys = oldKeys
        .filter((k) => k.startsWith('rmpg-flex-'))
        .sort();
      const previousCache = rmpgKeys.length > 0 ? rmpgKeys[rmpgKeys.length - 1] : null;
      const toDelete = oldKeys.filter((k) => k !== previousCache);
      return Promise.all(toDelete.map((k) => caches.delete(k)));
    })
    .then(() => self.clients.claim())
    .then(() => {
      // Notify all window clients that a new version is active. Must run AFTER
      // clients.claim() so matchAll() returns the clients now controlled by this
      // SW — before claim(), the new SW controls zero clients and the message
      // goes to an empty list (the bug that caused updates to be invisible until
      // a manual reload).
      self.clients.matchAll({ type: 'window' }).then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'SW_UPDATED', cacheName: CACHE_NAME });
        });
      });
    })
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
// static.cloudflareinsights.com/beacon.min.js is NOT in TELEMETRY_HOSTS —
// Cloudflare auto-injects that <script> tag with an `integrity="sha512-…"`
// attribute. A 204 response from TELEMETRY_HOSTS would fail the SRI check,
// swapping one console error for another. Instead, the navigation handler
// below strips the beacon <script> tag from the HTML response before the
// browser ever parses it — no tag means no fetch, no SRI check, no console
// error of any kind.
const TELEMETRY_HOSTS = ['events.mapbox.com', 'events.mapbox.cn'];

// Self-heal for the stale-chunk wedge (live incident 2026-07-30).
//
// When the poison guard below sees HTML for a /assets/*.js request, the real
// culprit is the CACHED NAVIGATION SHELL: an index.html we cached earlier whose
// entry <script> points at a hash the current deploy no longer serves. Leaving
// that shell cached means every subsequent navigation re-serves the same dead
// pointer, so the tab can never recover on its own.
//
// Drop the cached navigation entries (SPA routes have no file extension) so the
// NEXT navigation goes to the network for fresh HTML. Best-effort and fully
// swallowed: this runs inside waitUntil and must never affect the response.
async function purgeCachedShell() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    await Promise.all(
      keys
        .filter((req) => {
          try {
            const p = new URL(req.url).pathname;
            // '/' and extensionless SPA routes are navigation shells.
            // Anything with an extension (.js/.css/.png/…) is a real asset.
            return p === '/' || !/\.[a-z0-9]+$/i.test(p);
          } catch (e) {
            return false;
          }
        })
        .map((req) => cache.delete(req)),
    );
  } catch (e) {
    /* best effort — never let self-heal break the fetch path */
  }
}

// v1104: Automation firing drain — flushClientFirings() chained after GPS
//        flush in the gps-flush sync event so offline automation firings are
//        replayed to dispatch the moment the device reconnects.
// ── Background sync: flush unsynced GPS fixes + automation firings ────────
self.addEventListener('sync', (event) => {
  if (event.tag !== 'gps-flush') return;
  event.waitUntil(flushGpsFixes().then(() => flushClientFirings()));
});

async function flushGpsFixes() {
  let db;
  try {
    db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('rmpg-gps', 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return; // IDB unavailable — nothing to flush
  }

  const fixes = await new Promise((resolve) => {
    const tx = db.transaction('fixes', 'readonly');
    const idx = tx.objectStore('fixes').index('synced');
    const req = idx.getAll(0);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve([]);
  });

  if (!fixes || fixes.length === 0) return;

  // Batch in chunks of 500 to stay within server limits
  for (let i = 0; i < fixes.length; i += 500) {
    const chunk = fixes.slice(i, i + 500);
    const points = chunk.map((f) => ({
      latitude: f.lat, longitude: f.lng,
      accuracy: f.accuracy, heading: f.heading,
      speed: f.speed, timestamp: new Date(f.ts).toISOString(),
      source: f.source,
    }));

    let ok = false;
    try {
      const res = await fetch('/api/dispatch/gps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points }),
        credentials: 'include',
      });
      ok = res.ok;
    } catch {
      throw new Error('GPS flush network failure — sync will retry');
    }

    if (ok) {
      const ids = chunk.map((f) => f.id);
      await new Promise((resolve) => {
        const tx = db.transaction('fixes', 'readwrite');
        const store = tx.objectStore('fixes');
        ids.forEach((id) => {
          const req = store.get(id);
          req.onsuccess = () => { if (req.result) store.put({ ...req.result, synced: 1 }); };
        });
        tx.oncomplete = resolve;
      });
    }
  }
}

async function flushClientFirings() {
  let db;
  try {
    db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('rmpg-automations', 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return; // IDB unavailable — nothing to flush
  }

  const firings = await new Promise((resolve) => {
    const tx = db.transaction('firings', 'readonly');
    const req = tx.objectStore('firings').index('synced').getAll(0);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve([]);
  });

  if (!firings || firings.length === 0) return;

  let ok = false;
  try {
    const res = await fetch('/api/automation-rules/firings/client', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firings }),
      credentials: 'include',
    });
    ok = res.ok;
  } catch {
    throw new Error('Automation firing flush network failure — sync will retry');
  }

  if (ok) {
    const ids = firings.map((f) => f.id);
    await new Promise((resolve) => {
      const tx = db.transaction('firings', 'readwrite');
      const store = tx.objectStore('firings');
      ids.forEach((id) => {
        const req = store.get(id);
        req.onsuccess = () => { if (req.result) store.put({ ...req.result, synced: 1 }); };
      });
      tx.oncomplete = resolve;
    });
  }
}

// Fetch — network-first for code/pages, cache-first for images and tiles
self.addEventListener('fetch', (event) => {
  try {
  var url;
  try {
    url = new URL(event.request.url);
  } catch {
    return;
  }

  // Cloudflare Insights is injected on both rmpgutah.us and dialer.rmpgutah.us.
  // Taking ownership (204 or fetch()) either fails SRI or rejects the
  // FetchEvent when the beacon is blocked. Never respondWith these.
  if (
    url.hostname === 'static.cloudflareinsights.com' ||
    url.hostname.endsWith('.cloudflareinsights.com')
  ) {
    return;
  }

  // Cross-origin: never fetch() on the worker's behalf. Operator networks
  // (DNS sinkhole / ad block / managed challenge) routinely block the
  // Cloudflare beacon, Mapbox telemetry, and the dialer iframe. Owning those
  // requests turns a silent block into "The FetchEvent for <url> resulted in
  // a network error response: the promise was rejected".
  if (url.origin !== self.location.origin) {
    if (TELEMETRY_HOSTS.includes(url.hostname)) {
      safeRespond(event, new Response(null, { status: 204 }));
    }
    return;
  }

  // Cloudflare Web Analytics is injected with integrity="sha512-…". Taking
  // ownership (204 or fetch()) either fails SRI or, when the network is
  // down, rejects the FetchEvent. Let the browser handle the blocked beacon;
  // the navigation handler strips the <script> tag so subsequent loads never
  // request it. (Redundant with the origin check above; kept as a named
  // guard if Pages ever same-origin-proxies the beacon.)
  if (url.hostname === 'static.cloudflareinsights.com') {
    return;
  }

  // Never intercept opaque/extension/CDN-CGI traffic. Taking ownership of a
  // request we cannot complete rejects the FetchEvent ("Uncaught TypeError:
  // Failed to fetch" at sw.js:2) even when the page itself would have been fine.
  if (
    url.protocol === 'chrome-extension:' ||
    url.protocol === 'moz-extension:' ||
    url.protocol === 'blob:' ||
    url.protocol === 'data:' ||
    url.pathname.startsWith('/cdn-cgi/')
  ) {
    return;
  }

  if (TELEMETRY_HOSTS.includes(url.hostname)) {
    safeRespond(event,new Response(null, { status: 204 }));
    return;
  }

  // API GET caching — network-first with stale fallback for same-origin GET
  // /api/* requests that are not on the no-cache list. Responses are stored in
  // the stable API_CACHE_NAME cache (survives app deploys). When the network
  // fails, the last successful response is served so pages show stale data
  // instead of going blank. A 503 JSON stub is served as a last resort.
  if (
    url.origin === self.location.origin &&
    event.request.method === 'GET' &&
    url.pathname.startsWith('/api') &&
    !API_NO_CACHE.some((prefix) => url.pathname.startsWith(prefix))
  ) {
    safeRespond(event,
      fetchWithRetry(event.request)
        .then((response) => {
          if (response.ok) {
            cachePut(API_CACHE_NAME, event.request, response.clone());
          }
          return response;
        })
        .catch(() =>
          cacheMatch(event.request).then((cached) =>
            cached || new Response(
              JSON.stringify({ error: 'offline', data: null }),
              { status: 503, headers: { 'Content-Type': 'application/json' } }
            )
          )
        )
    );
    return;
  }

  // Never cache WebSocket, non-GET requests, or external origins.
  // Auth / health / offline endpoints above are also passed through (API_NO_CACHE).
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

  // Navigation requests — always network first with offline fallback.
  // Force cache: 'no-cache' so the browser doesn't serve a stale HTTP-cached
  // index.html from a previous deploy (the SW cache is the offline fallback,
  // not the HTTP cache).
  if (event.request.mode === 'navigate') {
    safeRespond(event,
      fetchWithRetry(event.request, { cache: 'no-cache' })
        .then((response) => {
          if (response.ok) {
            const ct = response.headers.get('Content-Type') || '';
            if (ct.includes('text/html')) {
              // Strip the Cloudflare beacon <script> tag before the browser
              // parses the HTML. CF Pages injects it with an integrity="sha512-…"
              // attribute; a SW 204 response fails the SRI check (empty body
              // hash mismatch), so interception is not an option. Stripping the
              // tag here means no element exists to CSP-check or fetch, so no
              // console error of any kind fires regardless of CSP policy.
              return response.text().then((html) => {
                var stripped = html
                  .replace(/<script\b[^>]*cloudflareinsights[^>]*>[\s\S]*?<\/script>/gi, '')
                  .replace(/<script\b[^>]*static\.cloudflareinsights\.com[^>]*>[\s\S]*?<\/script>/gi, '')
                  .replace(/<script\b[^>]*data-cf-beacon[^>]*>[\s\S]*?<\/script>/gi, '')
                  .replace(/<script\b[^>]*beacon\.min\.js[^>]*>[\s\S]*?<\/script>/gi, '');
                var headers = {};
                response.headers.forEach(function(v, k) {
                  if (k.toLowerCase() !== 'content-length') headers[k] = v;
                });
                var clean = new Response(stripped, { status: response.status, statusText: response.statusText, headers: headers });
                cachePut(CACHE_NAME, event.request, clean.clone());
                // Precache key is `/`. Login and other SPA routes are the same
                // document; without this, `/login?return=%2F` misses on the
                // next navigation and the SW synthesizes 503 Offline.
                cachePut(CACHE_NAME, new URL('/', self.location.origin).href, clean.clone());
                return clean;
              });
            }
            cachePut(CACHE_NAME, event.request, response.clone());
          }
          return response;
        })
        .catch(() =>
          cacheMatch(event.request, { ignoreSearch: true })
            .then((cached) => cached || cacheMatch(new URL('/', self.location.origin).href) || cacheMatch('/'))
            .then((fallback) => fallback || new Response(
              '<!DOCTYPE html><html><head><title>Offline — RMPG Flex</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;padding:0}body{background:#172a3f;color:#f0f4f9;font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}.card{text-align:center;max-width:420px;padding:32px 28px;border:1px solid #2a4a6b;background:#1e3550;border-radius:2px}h1{margin:0 0 12px;font-size:18px;letter-spacing:0.05em;text-transform:uppercase;color:#f0f4f9}p{margin:0 0 20px;color:#8fa3b8;font-size:13px;line-height:1.5}button{background:#2a4a6b;color:#f0f4f9;border:1px solid #3b6a9a;padding:10px 28px;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;cursor:pointer;border-radius:2px;font-family:inherit}button:hover{background:#3b6a9a}.cd{font-size:10px;color:#8fa3b8;font-family:Arial;margin-top:12px}</style></head><body><div class="card"><h1>Connection Lost</h1><p>Unable to reach the RMPG Flex server. Check your network connection.</p><button onclick="window.location.reload()" type="button">Retry Connection</button><div class="cd" id="cd">Retrying in 5s...</div></div><script>var r=5,t=setInterval(function(){r--;if(r<=0){clearInterval(t);window.location.reload()}else{document.getElementById("cd").textContent="Retrying in "+r+"s..."}},1000)</script></body></html>',
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
      safeRespond(event,
        cacheMatch(event.request).then((cached) => {
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
                // Evict the cached shell that pointed at this dead hash, so the
                // next navigation refetches fresh HTML instead of re-serving the
                // same broken entry <script> forever. Without this the tab is
                // wedged on the INITIALIZING splash permanently — see
                // purgeCachedShell() above and index.html's entry error handler.
                event.waitUntil(purgeCachedShell());
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
    safeRespond(event,
      fetchWithRetry(event.request)
        .then((response) => {
          // Same poison guard as the hashed branch — never cache/return HTML
          // for a JS/CSS request (see v716 note).
          const ct = response.headers.get('Content-Type') || '';
          if (ct.includes('text/html')) {
            return cacheMatch(event.request).then(
              (cached) => cached || new Response('', { status: 404, statusText: 'Stale chunk (HTML fallback)' })
            );
          }
          if (response.ok) {
            cachePut(CACHE_NAME, event.request, response.clone());
          }
          return response;
        })
        .catch(() => cacheMatch(event.request).then((cached) => cached || new Response('', { status: 503, statusText: 'Offline' })))
    );
    return;
  }

  // GeoJSON district overlay files (/geojson/*.geojson) — loaded by the
  // dispatch map on every visit. These files are up to 9 MB each so they are
  // NOT in STATIC_ASSETS (that would bloat every install). Instead, cache
  // network-first on the first successful fetch, then serve cache-first with
  // a background refresh on repeat visits. When both network and cache fail
  // (true offline, first visit), return an empty FeatureCollection so the map
  // renders without overlays rather than logging a 503 console error.
  if (url.pathname.startsWith('/geojson/') && url.pathname.endsWith('.geojson')) {
    safeRespond(event,
      cacheMatch(event.request).then((cached) => {
        var networkFetch = fetchWithRetry(event.request)
          .then((response) => {
            if (response.ok) cachePut(CACHE_NAME, event.request, response.clone());
            return response;
          })
          .catch(() => cached || new Response(
            JSON.stringify({ type: 'FeatureCollection', features: [] }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          ));
        if (cached) {
          // Serve the cached version immediately; refresh in the background.
          event.waitUntil(networkFetch.catch(function () {}));
          return cached;
        }
        return networkFetch;
      })
    );
    return;
  }

  // Images, fonts, etc. — cache first (these rarely change for same filename)
  safeRespond(event,
    cacheMatch(event.request).then((cached) => {
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
  } catch (err) {
    // A throw from the fetch handler after respondWith is not possible, but a
    // throw BEFORE respondWith is silent. After respondWith, an uncaught
    // exception is logged as FetchEvent network error. Never let either leak.
    try {
      event.respondWith(new Response('', { status: 503, statusText: 'Offline' }));
    } catch {
      /* respondWith already called */
    }
  }
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
