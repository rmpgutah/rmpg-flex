# Intel Wave 3a — Utah Jail / Booking Records Ingestion

**Date:** 2026-06-12 · **Status:** Approved · **Builds on:** intel platform (#1164, #1168, #1169), warrantSources framework

## Goal

Pull Utah jail/booking records into the records database and cross-hit every
booking against the intel layer (known persons, watchlist, warrants). Coverage
strategy: **statewide UDC offender search + VINELink first, per-county adapters
as backfill, manual roster ingestion as the always-works backbone.**

## Reality constraints (honest scoping)

- Utah has 29 county jails on heterogeneous platforms; no shared API.
- Cloudflare Workers cannot run a headless browser, so JS-rendered portals
  (`browser`/`portal` kinds) cannot be scraped in-Worker today — those counties
  stay `pending` with a clear admin status until an HTML/JSON endpoint is found
  or an external render step is added.
- Therefore the **reliable backbone is the normalized ingestion + cross-hit
  pipeline**; live adapters feed it where they can, and a manual paste/upload
  path feeds it everywhere else.

## Storage

- Bookings land in the EXISTING `arrest_records` table (entry_source
  `'roster_scrape'` or `'roster_manual'`), reusing its UNIQUE(jailbase_id,
  source_id) — we synthesize a stable `source_id` = `${countyKey}:${bookingId}`
  and put it in `jailbase_id` (sentinel-compatible). No new bookings table.
- New `jail_roster_sources` registry table (migration 0101): one row per
  county/source — key, display_name, county, source_url, kind, status
  ('active'|'pending'|'disabled'), last_run_at, last_status, row_count. Seeded
  with all 29 Utah counties + UDC + VINELink.

## Components

### 1. Registry + framework — `src/utils/jailSources/`

- `types.ts`: `JailBooking` (normalized: source_key, booking_id, full/first/last
  name, dob, booking_date, charges[], county, mugshot_url, detail_url),
  `JailSourceAdapter { meta; fetchRecent(env): Promise<JailBooking[]> }`,
  `SourceKind = 'html'|'json'|'browser'|'portal'|'manual'`.
- `registry.ts`: code-resident adapter list + `getActiveSources(db)` reading
  `jail_roster_sources.status='active'` (fail-open to none on missing table — a
  bad config must not spam, unlike warrants which fail-open to all).
- `adapters/udc.ts`: Utah Dept. of Corrections statewide offender search
  (`json`/`html` attempt; on anti-bot/failure returns [] and records
  last_status so the admin panel shows the outage — never throws the cron).
- `adapters/vinelink.ts`: VINELink statewide lookup attempt, same degradation
  contract.
- `seed.ts`: the 29-county + UDC + VINELink registry rows (idempotent upsert,
  applied by migration + a boot reconcile).

### 2. Ingestion + cross-hit — `src/utils/jailIngest.ts`

- `ingestBookings(db, bookings)`: for each normalized booking —
  1. Upsert into `arrest_records` (dedupe on synthesized source id).
  2. **Cross-hit**: match to existing persons by (last+first+dob) or
     (last+first); on match, run `screenPerson` (reuse Wave 1 engine) and, if
     the person is on the watchlist OR has an active warrant, raise an
     `anomaly_alerts` row (`jail_booking:<arrestId>` dedup) + notify watchers.
  3. If matched person exists, write an `intel_link_suggestions`-style nothing
     — instead set `arrest_records` person linkage via existing
     `arrest_cross_links` (type 'person') so the booking shows on the dossier
     timeline immediately.
- Pure helpers (name/charge normalization, dedupe key) unit-tested.

### 3. Scan orchestrator — `src/utils/jailSources/runScan.ts`

- `runJailScan(db)`: for each active source, `fetchRecent` (try/catch per
  source — one bad source never aborts the rest), `ingestBookings`, update
  `jail_roster_sources` last_run/last_status/row_count. Polite pacing between
  sources. Called from the 4-hourly cron branch.

### 4. API — add to `src/routes/intel.ts`

- `GET /api/intel/jail/sources` (operational) — registry + status for admin.
- `POST /api/intel/jail/scan` (admin) — run now.
- `POST /api/intel/jail/ingest` (supervisor+) — manual paste: body
  `{county, format:'csv'|'lines', text}` → parse rows (name, dob?, booking_date?,
  charges?) → `ingestBookings`. Returns `{ingested, matched, alerts}`.
- `GET /api/intel/jail/bookings?q=&county=&limit=` — search ingested bookings
  (from arrest_records where entry_source LIKE 'roster%').

### 5. UI — `client/src/pages/JailRecordsPage.tsx` at `/intel/jail`

- Source-status grid (county, kind, status, last run, count) with colored
  health dots.
- Manual ingestion box: pick county, paste CSV/lines, INGEST → shows
  ingested/matched/alert counts + any hit banners.
- Recent bookings list with cross-hit badges (linked person, watchlist, warrant).
- Nav entry beside Quick Capture.

## Error handling

Every adapter degrades to [] + recorded status (never throws the cron). Ingest
is per-row try/catch. Missing tables (migration drift) log once and no-op.
Manual ingestion validates and reports per-row parse failures.

## Testing

- Worker vitest: parser (CSV/lines), normalization, dedupe-key, cross-hit
  match logic (pure parts) in `tests/jailIngest.test.ts`.
- Client vitest: JailRecordsPage render (source grid + ingest result).
- Migration 0101 — apply directly to live D1 post-merge. SW bump.

## Out of scope (later)

Per-county browser/portal adapters needing JS rendering (external render step),
mugshot R2 archival, in-app interaction recording, native background recording.
