# Repair Book — RMPG Flex troubleshooting ledger

Bug fixes, newest first. Each entry records the symptom as it was actually
observed, the underlying logic failure, the fix, and the mechanical guard that
keeps it from returning. Add an entry for every bug fix; a fix with no
Prevention line is an invitation to ship the bug twice.

---

## 2026-09-15 — Three production console defects (sync 500s, unparseable map colors, blocked Twilio sounds)

All three were found in a single dispatcher browser console on `rmpgutah.us`.
None of them produced an entry in `error_log`, and none failed a CI gate.

### 1. `/api/sync/queue` and `/api/sync/conflicts` returned HTTP 500

- **Issue**: The Admin → Sync Status tab fired
  `GET /api/sync/queue` and `GET /api/sync/conflicts?limit=50`; both returned
  500 and `useApi` retried each three times (2s / 4s / 8s backoff), so one tab
  mount produced eight failed requests. The Worker-side error was
  `D1_ERROR: no such table: sync_queue: SQLITE_ERROR`.
- **Root cause**: `sync_queue` and `sync_conflicts` are created by migrations
  `0249_sync_queue.sql` and `0250_sync_conflicts.sql`, both marked
  `Local-only` in their headers and deliberately never applied to live D1 —
  they belong to the FZ-55 secondary server. `src/routes/sync.ts` queried them
  unconditionally, so on the cloud deployment the D1 error escaped the handler
  body and the global `onError` converted "expected absence" into a 500.
  Nothing was wrong with the schema; the route had no notion that its tables
  are optional.
- **Resolution**: Added `tableExists()` to `src/utils/db.ts` (via
  `sqlite_master`, not `pragma_table_info`, which cannot distinguish a missing
  table from a column-less one) and gated every `/api/sync` handler on it.
  Reads now answer `200 { provisioned: false, … }` with zeroed counts and an
  empty conflict list; `POST /replay` and `POST /enqueue` answer
  `503 { code: 'not_provisioned' }`. `SyncStatusTab` renders an explanatory
  line and disables the replay button instead of surfacing a raw error. Also
  hardened the `page`/`limit` parsing, which bound `NaN` into `LIMIT` on
  non-numeric input.
- **Prevention**: `test-workers/syncRouteNotProvisioned.test.ts`. The Miniflare
  D1 has no FZ-55 tables, which is exactly the live cloud shape, so the test
  reproduces the bug with no fixture — verified by running it against the
  pre-fix route, where it fails with the original `no such table` error. It
  also pins that the provisioning probe did not become an authz bypass: the
  role check still runs first.

### 2. Mapbox dropped the crime layer: `Could not parse color from value 'var(--sev-warn)'`

- **Issue**: On the Navigation map, three repeated console errors —
  `Failed to evaluate expression "["to-color",["get","color"]]". Could not
  parse color from value 'var(--sev-warn)'`, and the same for
  `var(--brand-gold)` and `var(--sev-ok)`. The crime incident layer painted
  nothing. No error came from RMPG code.
- **Root cause**: `NavigationPage`'s `CLASS_META` maps each crime class to a
  CSS variable — correct for the DOM legend on the same page — and
  `crimeColor(p)` fed that value straight into a GeoJSON feature's `color`
  property, read by a paint expression (`'circle-color': ['get','color']`).
  Mapbox GL resolves paint colors in a shader, where `var()` has no meaning,
  so every feature's color failed to parse. The trio of values maps exactly to
  the `property` / `other` / `cfs` classes. The guard for this
  (`safeMapboxColor`) already existed, and `mapboxSafeLayer.ts` already said it
  "belongs at every config-to-mapbox seam" — it was applied at 2 of 10 seams.
- **Resolution**: Resolved the color at the seam in all ten feature builders
  (`NavigationPage` crime + corridor-hazard layers, `NavMapView` pins,
  `SightingsMap`, `useMapDrawing`, `useMapClustering`, `useMapBreadcrumbs`,
  `useMapWeatherAlerts`, `serveMapUtils`, plus the two already guarded). The
  CSS variables stay as-is where they feed the DOM; only the Mapbox seam
  changes. Several of these seams carry officer- or DB-supplied colors
  (drawn shapes, dropped pins), so they were latent instances of the same bug,
  not just style cleanup.
- **Prevention**: `client/src/utils/__tests__/mapboxFeatureColorGuard.test.ts`
  — a ratchet that finds every module registering a `['get','color']` paint
  expression, extracts each `color:` assignment inside a GeoJSON `properties`
  literal, and fails if one does not pass through `safeMapboxColor()`. It
  carries a sanity floor on the number of files scanned so it cannot pass
  vacuously if the scan silently stops matching. Verified to fail on a
  reverted seam. Named `mapbox*` on purpose so it runs under
  `vitest.maps.config.ts` — the default client config excludes map globs.

### 3. Twilio Voice SDK sounds blocked by CSP

- **Issue**: 16 console violations per page load, e.g.
  `Connecting to 'https://sdk.twilio.com/js/client/sounds/releases/1.0.0/incoming.mp3'
  violates … connect-src … The action has been blocked.` — once report-only
  (the zone Transform Rule policy) and twice enforced.
- **Root cause**: The native softphone's Twilio Voice JS SDK preloads its
  ringtone and DTMF samples from `sdk.twilio.com` using XHR, so `connect-src`
  governs them — not `media-src`, which only ever sees the blob played
  afterwards. The host was absent from both `ALLOWED_CONNECT` in
  `functions/_middleware.ts` and the meta-tag policy in `client/index.html`.
  The SDK swallows the load failure, so the symptom is a silent dialer (no
  ring, no DTMF feedback, no disconnect tone) with only a console flood to
  show for it — the same silent-block class as the RainViewer tile host in
  2026-08-09.
- **Resolution**: Added `https://sdk.twilio.com` to `connect-src` in both
  policies. The enforced Pages header is the one that matters; the meta tag is
  kept in sync because a divergence between the two is how the RainViewer
  outage hid.
- **Prevention**: A case in `client/src/utils/__tests__/pagesCsp.test.ts`
  asserting the host is present in **both** policies, so neither can drift.
