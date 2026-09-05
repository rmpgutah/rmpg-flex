# RMPG Flex — Claude Code Project Memory

> **This file describes the Cloudflare Workers stack only** (live as of 2026-05-24).
> The Hostinger VPS architecture (`/opt/rmpg-flex`, rsync deploys, systemd,
> Express, better-sqlite3) is **dead and the host is decommissioned** (shut down
> 2026-06-15 — there is no longer a server at `194.113.64.90` to ssh/rsync/systemctl
> against). Its source — the old `legacy/server-vps/` tree, the stale duplicate
> top-level `server/` directory, and the dead `deploy/` rsync scripts — was
> **deleted outright in the 2026-07-16 repo cleanup** rather than merely quarantined.
> See [`LEGACY.md`](LEGACY.md) for a quick live-directory map before assuming
> anything about the codebase.

## Project Overview

RMPG Flex is a **police CAD/RMS** (Computer-Aided Dispatch / Records Management System) for Rocky Mountain Protective Group, a private security / law enforcement company in Salt Lake City, Utah.

- **App domain**: https://rmpgutah.us (React SPA on Cloudflare Pages)
- **API domain**: https://api.rmpgutah.us (Worker `rmpg-flex-api`, entry [`src/index.ts`](src/index.ts))
- **Database**: Cloudflare D1 `rmpg-flex` (`785de7ae-3e7a-4e01-93bb-d24ddd813f6b`), bound as `DB` — the live 6 MB dataset both Workers share (verified 2026-05-29 via `wrangler.toml` + row counts). The old `rmpg-flex-db` (`8893480a-…`) is **abandoned** (0 calls/persons, missing tables); do not target it.
- **Storage**: R2 — `system-essentials` bound as `MAP_DATA`
- **Cache/state**: KV namespace `8e01c392038e4f76838ca9a1130c908e` bound as `KV`
- **Durable Objects**: `WelfareWatchDO` (one instance per officer for welfare-check timers)
- **Timezone**: America/Denver
- **Versions**: Worker `1.0.0` (root `package.json`), client `5.8.4` (`client/package.json`)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| API | **Hono** on Cloudflare Workers (`src/index.ts`) |
| Database | **Cloudflare D1** accessed via `src/utils/db.ts` (native `D1Database.prepare(...).bind(...).all()` / `.first()` / `.run()`) |
| Auth | JWT via `jose` (`src/middleware/auth.ts`) + bcryptjs for password hashes |
| Real-time | WebSocket via Workers `webSocketPair()` (`src/routes/ws.ts`) |
| Frontend | React 18 + TypeScript + Vite 6 + Tailwind (built to `client/dist/`, deployed to Cloudflare Pages project `rmpg-flex`) |
| Maps | **Mapbox GL JS** (overrides the legacy "Google Maps only" rule, which was anti-fragmentation for the VPS — see `[[project-mapbox-decision]]` memory) |
| Edge | Python edge runner for Flex Dashcam AI (`edge/`, Jetson target) — independent of the Worker |
| Styling | **Blue / Silver / Gold theme (Blue & Silver default 2026-07-04; gold reintroduced 2026-07-24)** — deep navy-blue surfaces (`surface-base #22405f`), silver/platinum structural accent, near-white text, and gold restricted to **two roles only** (field labels + section/panel headers, via `--field-label-color` / `--panel-header-color`). Red/green/amber stay reserved for CAD severity. Forced always-dark, same tier as the legacy pure-black kill-switch — not part of the old day/night schedule (still selectable as an opt-out, see Design tokens below). Colors come from CSS-variable-backed Tailwind tokens in [`client/src/styles/theme-palettes.css`](client/src/styles/theme-palettes.css) (the single source of palette truth) — **never hardcode hex**. |

## Repository Layout

```
src/                Cloudflare Worker (live API)
  index.ts          Hono app entry; route mounting; CORS/secure-headers/logger middleware
  middleware/auth.ts  JWT verification
  routes/           One file per domain — auth, health, dispatch/, records, warrants, ...
  routes/dispatch/  Dispatch subsystem (calls, units, gps, geography, aggregates, ...)
  durable-objects/  WelfareWatchDO
  utils/            db.ts, utahWarrantPoller.ts
  types.ts          Shared TS types

client/             React SPA (Vite → client/dist/, deployed to CF Pages)
  src/pages/        Page components (one per route)
  src/components/   Shared components (StatsCard, PanelTitleBar, IconButton, …)
  src/hooks/        useApi (apiFetch), useLiveSync, useDistrictLookup, …
  src/utils/        PDF gen, Mapbox helpers, CAD parser, voice alerts, call protocols
  public/           Static assets, service worker (sw.js), GeoJSON layers

migrations/         D1 SQL migrations — see migrations/README.md for numbering quirks
wrangler.toml       Worker bindings (DB, KV, MAP_DATA, WELFARE_WATCH), cron, vars
scripts/            Codegen + one-off ops scripts (D1 schema sync, geography seed)
edge/               Python edge runner for Flex Dashcam AI (independent of Worker)

desktop/            Electron wrapper — kept (in active use)
                    NOTE: legacy/ (retired VPS-era server code), the stale duplicate
                    top-level server/, and deploy/ (VPS-era deploy scripts) were all
                    DELETED outright in the 2026-07-16 repo cleanup. If a comment or
                    doc still references legacy/server-vps, server/, or
                    bash deploy/deploy.sh — that's the canonical "do not use" recipe;
                    none of it lived in the CF era and none of it exists anymore.
```

## Deploy

**Canonical trigger**: `git push origin main` → `.github/workflows/deploy.yml`:

1. `npm run typecheck` (Worker)
2. `wrangler d1 migrations apply rmpg-flex --remote` (`continue-on-error: true`; the Worker reconciles missing columns at boot)
3. `wrangler deploy` (Worker)
4. `cd client && npm ci && npm run build`
5. `wrangler pages deploy client/dist --project-name=rmpg-flex --branch=main`

**Required GitHub secrets**: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

**Verify after every deploy**:
```bash
# ✅ As of 2026-06-12, `curl -sf https://api.rmpgutah.us/api/health` WORKS again
# (returns HTTP 200 + JSON). A WAF custom rule in the http_request_firewall_custom
# phase (zone rmpgutah.us = addedd9f3c798f85de2d3eea18ccef9a; ruleset
# fb286265c2ad4f009c3fbcb7aac35e6c, rule 472b15f78f50420f871dd6c71e990ac7)
# SKIPs the managed challenge for `http.request.uri.path eq "/api/health"`:
curl -sf https://api.rmpgutah.us/api/health   # expect {"status":"ok",...}

# ⚠️ The skip rule is scoped to /api/health ONLY. Every OTHER path on both zones
# is still behind a Cloudflare **managed challenge**, so a plain curl to any other
# endpoint (or the SPA) returns HTTP 403 ("Just a moment…") even when healthy —
# the bot check needs JS + cookies curl can't solve (confirmed 2026-05-29). For
# anything besides /api/health, use one of:
# 1. Browser: open https://rmpgutah.us/ and https://api.rmpgutah.us/api/health
#    in a real browser (solves the challenge) and eyeball the JSON / SPA shell.
# 2. DB-level health (bypasses the WAF entirely) via the Cloudflare API/D1:
#    query the LIVE DB `rmpg-flex` (785de7ae-3e7a-4e01-93bb-d24ddd813f6b),
#    e.g. `SELECT COUNT(*) FROM sqlite_master WHERE type='table'` (expect ~180).
```

**Service worker cache**: `CACHE_NAME` in `client/public/sw.js` is the literal placeholder `'rmpg-flex-BUILD'`. The `stamp-sw-version` Vite plugin in [`client/vite.config.ts`](client/vite.config.ts) replaces it with `'rmpg-flex-<git-short-sha>'` in `dist/sw.js` during `closeBundle()` on every production build, so every commit gets a unique cache name automatically. **Do not edit `CACHE_NAME` by hand** — manual bumps are no-ops and were a chronic merge-conflict source (the whole reason this auto-stamp exists). If you want to document what shipped, add a one-line `// vNNN:` changelog comment under the most recent one in `sw.js`; those are pure documentation and don't influence cache invalidation. Historical: incident 2026-05-24 (SW v321 lived in prod for weeks while source moved to v563) was the original reason for manual bumps before the auto-stamp refactor.

**Manual / local invocations**:
```bash
npm run dev               # wrangler dev (local Worker on 8787)
npm run typecheck         # tsc --noEmit on /src/
cd client && npm run dev  # Vite dev server on 5173
npm run migrate:local     # apply migrations to local D1
npm run migrate:prod      # apply migrations to remote D1
```

## Schema changes (D1)

1. Add a new file under `migrations/` using the next free integer prefix (see [`migrations/README.md`](migrations/README.md)). Current high-water is `0280` (check `ls migrations/ | tail` — duplicate prefixes exist, e.g. two `0075`/`0084`/`0085` files).
2. Write idempotent DDL — `CREATE TABLE IF NOT EXISTS`. D1 does **not** support `IF NOT EXISTS` on `ADD COLUMN`, so either accept the failure on re-apply or wrap the `ALTER` in a check via the Worker boot reconciler.
3. Test locally: `npm run migrate:local`.
4. Merge to main — `deploy.yml` applies it to remote D1 (and continues on error, as documented above).
5. **⚠️ Migrations routinely fail to reach live D1 silently** (deploy step is `continue-on-error`; migration tracking historically targeted the abandoned DB). After merging, apply the DDL **AND** mark it tracked in one shot via [`scripts/apply-migration.sh`](scripts/apply-migration.sh):

   ```bash
   scripts/apply-migration.sh 0147_my_new_migration.sql
   ```

   The helper runs `wrangler d1 execute --remote --file` then `INSERT OR IGNORE INTO d1_migrations`. Skipping the tracker insert is what caused the 19-row drift sweep on 2026-06-22 — wrangler then retries those files forever, hiding any real failure under swallowed "duplicate column name" noise. Verify the change landed with `pragma_table_info('<table>')`. A runtime "no such column/table" error is almost always a migration that never landed.
6. **All `db.prepare(...).first() / .all() / .run()` are async** on D1 — always `await`.

## Security

- **`JWT_SECRET`** is the only auth secret in the Worker today (set via `wrangler secret put JWT_SECRET`). The old VPS-era TOTP encryption tying secrets together is not yet ported.
- **Integration secrets** (optional bindings, read only from `c.env`, never hard-coded): `IPED_API_KEY`, `ROBOFLOW_API_KEY` (ALPR — see below). Set with `wrangler secret put <NAME>`; for local dev put them in `.dev.vars` (gitignored). A route returns 503 when its key is unset rather than crashing.
- **`EMAIL_FIELD_ENCRYPTION_KEK`** encrypts cached email content at rest (`src/utils/emailFieldCrypto.ts`) and is REQUIRED, not optional — it fails CLOSED (throws `EmailFieldEncryptionError`) rather than storing plaintext. If unset or malformed: the poll upsert into `email_messages` silently skips caching new mail (logged, not crashed), `GET /messages/search` returns an empty result set indistinguishable from "no matches" (also logged), and pending rows in `email_scheduled` stay `'pending'` and retry on the next cron tick rather than being destroyed. Set with `wrangler secret put EMAIL_FIELD_ENCRYPTION_KEK` (32 random bytes, base64 — e.g. `openssl rand -base64 32`); for local dev put it in `.dev.vars` (gitignored).
- **CORS** is enforced by the Hono `cors()` middleware in `src/index.ts`, reading the allow-list from `CORS_ORIGINS` (`https://rmpgutah.us,https://www.rmpgutah.us,http://localhost:5173`).
- **Auth middleware** is mounted per-path-prefix in `src/index.ts` (e.g. `app.use('/api/dispatch', authMiddleware)`). Public routes: `/api/health`, `/api/auth`, `/api/map-data`. Everything else requires a valid JWT.
- **Roles** (from the VPS era, still in the DB): `admin`, `manager`, `supervisor`, `officer`, `dispatcher`, `contract_manager`, `client_viewer`, `human_resources`.

## External integrations

### ALPR Vehicle Details Capture (Roboflow)

Sends a captured image to the Roboflow **serverless workflow** "ALPR Vehicle
Details Capture" (`workspace=rmpg-utah`, `workflow=alpr-vehicle-details-capture-1781360579827`)
and wires the result into the intel plate log.

- **Client**: [`src/utils/roboflowAlpr.ts`](src/utils/roboflowAlpr.ts) — Worker-safe (no `node:*`).
  `runAlprVehicleCapture()` = `fetch` + `AbortController` timeout + bounded retries/backoff + typed
  errors (`RoboflowConfigError|TimeoutError|HttpError`). Parsing is **schema-agnostic**: the Roboflow
  HTTP envelope (`{ outputs: [ {<name>:value} ] }`, 1 entry/image; images → base64) is stable, so
  `parseAlprResponse()` classifies each output **by shape** (base64 image / detection set / scalar)
  and maps scalars to a normalized `AlprCapture` via key heuristics. Pure helpers are unit-tested in
  [`tests/roboflowAlpr.test.ts`](tests/roboflowAlpr.test.ts) (`npx vitest run tests/roboflowAlpr.test.ts`).
- **Route**: [`src/routes/alpr.ts`](src/routes/alpr.ts) mounted at `/api/alpr` (`auth: 'required'`).
  `POST /capture` (multipart `image`/`photo` + optional `call_id`/`incident_id` + declared params).
  **On-scene flow**: with a `call_id`/`incident_id` the original lands under R2 `field-photos/` + a
  `field_photos` row, so it **auto-attaches to that call's photo gallery**. Then for **every** vehicle
  in the frame (`parseVehicles` → `enhanced_alpr_record.vehicles[]`) it **upserts a `vehicles_records`
  row by plate (creates if new), links it to the call via `call_vehicles`** (`role='observed'`), logs a
  `vehicle_sightings` row, and runs `screenVehicle()` (stolen/watchlist → critical-hit notification).
  Capture-level row in `alpr_captures` carries `call_id`/`field_photo_id`/`vehicle_count`/
  `vehicle_record_ids`. Also `GET /captures` (filter `?call_id=`), `/capture/:id`, `/image/*`, `/health`.
  Defaults `disable_rmpgutah_api: true`; repeated `capture_id` is idempotent (offline-replay safe).
- **Mobile UI**: [`FieldCameraPage`](client/src/pages/mobile/FieldCameraPage.tsx) (`/field-camera?call_id=…&alpr=1`)
  has a "Scan vehicles" mode that posts the stamped photo to `/alpr/capture` with the call context and
  shows the per-vehicle results + hits; [`ActiveCallsCard`](client/src/pages/mobile/cards/ActiveCallsCard.tsx)
  has a per-call scan launch. Multipart uploads use the new `apiPostForm` helper in
  [`useApi.ts`](client/src/hooks/useApi.ts) (NOT `apiFetch`, which forces `application/json` and breaks
  multipart). [`PlateLogPage`](client/src/pages/PlateLogPage.tsx) keeps a standalone plate scanner.
- **Config**: needs `ROBOFLOW_API_KEY` secret (from app.roboflow.com/settings/api). Unset → `/api/alpr`
  returns 503. Optional `ROBOFLOW_API_URL` overrides the serverless base.
- **Schema**: migrations `0108_alpr_captures.sql` (`alpr_captures`) + `0109_alpr_call_link.sql` (call/
  multi-vehicle columns). The route reconciles the table + columns at runtime via `columnExists()` — but
  still **apply 0108 + 0109 directly to live D1 `785de7ae`** after merge (deploy apply is
  `continue-on-error`). Reuses existing `vehicles_records`, `call_vehicles`, `field_photos`, `vehicle_sightings`.
- **Grounded 2026-06-13** via `workflows_get`: the workflow has **50 inputs + 73 outputs**. The parser
  reads the real shapes — `license_plate_text` (GLM-OCR), the structured `vehicle_details` dict
  (`make`/`model`/`color_primary`/`year_range`/`license_plate_state_or_region`/`vehicle_type`), plate
  confidence from `enhanced_alpr_record.vehicles[].field_confidence.plate`, and top-level `risk_score`/
  `review_*`/`watchlist_hit` scalars — with key-heuristic fallbacks. **Every workflow parameter is a
  string-typed `WorkflowParameter`** (defaults `'true'`/`'0.75'`), so the route passes all params as
  STRINGS (not JS booleans/numbers) — downstream blocks compare against the strings. `disable_rmpgutah_api`
  defaults to `'true'` so the workflow doesn't POST back to us. (Note: a live `workflows_run` to capture
  a real response overflows the MCP serializer — 73 outputs incl. base64 images — so the declared
  `output_structure` is the authoritative shape; run it via the serverless REST endpoint with a key if a
  literal sample is needed.)

### Fleet.io (commercial fleet management SaaS)

Bidirectional sync between RMPG's in-house fleet system and Fleet.io. RMPG remains
the operational entry surface (dispatch/MDT/patrol); Fleet.io is the downstream
discipline layer for PM reminders, parts, vendor invoicing, and reports. Outbound
went live in PR 1 (seed only); the webhook receiver + inbound sync code shipped
in PR 4. Full spec: [`docs/superpowers/specs/2026-06-21-fleetio-integration-design.md`](docs/superpowers/specs/2026-06-21-fleetio-integration-design.md).

**⚠️ "PR 4 shipped" ≠ "bidirectional sync is live in production."** Live D1
audit (2026-07-29, `docs/superpowers/specs/2026-07-29-fleetio-fleet-manager-gap-audit.md`)
found the inbound webhook receiver deployed and technically correct
(secret-gated via `FLEETIO_WEBHOOK_SECRET`, deduped, `waitUntil`-backed) but
with exactly **one** inbound event in `fleetio_events` ever (2026-06-21,
`vehicle/update`) — most plausibly a single manual test, not a live,
operator-registered Fleet.io webhook subscription. `fleetio_conflicts` has 0
rows. Outbound (RMPG → Fleet.io) is genuinely active. Read this as
"outbound live; inbound webhook code shipped but not observably in use"
until someone confirms a real webhook subscription is registered in
app.fleetio.com and inbound events start flowing again.

- **Adapter**: [`src/utils/fleetio/client.ts`](src/utils/fleetio/client.ts) — Worker-safe REST client
  for Fleet.io API v1 (`https://secure.fleetio.com/api/v1`). Dual-header auth
  (`Authorization: Token <key>` + `Account-Token: <token>`). Typed errors
  (`FleetioConfigError | FleetioTimeoutError | FleetioHttpError | FleetioRateLimitError`).
  Retry/backoff/timeout. Unit-tested in [`tests/fleetioClient.test.ts`](tests/fleetioClient.test.ts).
- **Route**: [`src/routes/fleetio.ts`](src/routes/fleetio.ts) at `/api/fleetio` (auth: required).
  `GET /test-connection` (any user), `GET /sync-status` (admin), `POST /seed` (admin —
  pushes every `fleet_vehicles` row that lacks a `fleetio_links` entry).
- **Bookkeeping schema**: migration `0133_fleetio_sync_tables.sql` — `fleetio_links`
  (RMPG↔Fleet.io id mapping), `fleetio_events` (in/outbound event queue with
  idempotency key), `fleetio_conflicts` (field-level disagreements; PR 4),
  `fleetio_sync_state` (cursor positions per resource).
- **Config**: secrets `FLEETIO_API_KEY` + `FLEETIO_ACCOUNT_TOKEN` (+ `FLEETIO_WEBHOOK_SECRET`
  in PR 4) via `npx wrangler secret put`. Var `FLEETIO_API_BASE` in `wrangler.toml`
  `[vars]`. Unset → `/api/fleetio/*` returns 503 `{ code: 'not_configured' }`.
- **Cron**: `*/30 * * * *` reconciliation (stub in PR 1; real handler in PR 4).
- **🔴 After merge**: apply `0133_fleetio_sync_tables.sql` DIRECTLY to live D1
  `785de7ae` and verify via `pragma_table_info` (deploy is `continue-on-error`).
  Set the two secrets, then hit `POST /api/fleetio/seed` once.

#### Fleet.io invariants — read before touching the adapter (hardened 2026-07-26)

- **⚠️ Fleet.io has TWO pagination contracts and the live one is decided by the
  API VERSION BOUND TO THE KEY** (chosen at key creation; there is no
  per-request version header, so the code cannot read it). Cursor-era
  (2024-01-01+, incl. the current 2025-05-05): `?per_page=<=100` +
  `?start_cursor=`, body `{ records, current_cursor, next_cursor, per_page,
  estimated_remaining_count }`. Legacy: `?page=N&per=<=100`, body is a **bare
  array**, counts in `X-Pagination-*` **headers**. **There is no
  `{records, pagination:{total_pages}}` body envelope** — an earlier revision
  declared one, so `pagination?.total_pages ?? 1` always resolved to 1 and every
  paginated pull silently stopped after 100 records. Always paginate via
  `iterateList` / `listAllVehicles` / `listAllFuelEntries` in
  [`client.ts`](src/utils/fleetio/client.ts); never hand-roll a page loop.
- **`fleetio_links.fleetio_resource` is part of a UNIQUE index**
  (`UNIQUE(fleetio_resource, fleetio_id)`), so the string is **identity, not a
  label**. Always source it from `FLEETIO_LINK_RESOURCE` in
  [`resources.ts`](src/utils/fleetio/resources.ts) (canonical = the Fleet.io REST
  path segment: `vehicles`, `fuel_entries`, `work_orders`, `vendors`, `parts`).
  `/seed`+`/pull` once wrote `'vehicles'` while `recordLink` wrote `'vehicle'`,
  which both defeated the unique index and made `/pull` blind to sync-created
  links. Migration `0206` normalizes existing rows; readers stay tolerant of the
  legacy singular via `acceptedLinkResources`.
- **`fleetio_events.resource_id` MEANS DIFFERENT THINGS PER DIRECTION** — the
  RMPG row id on `outbound`, the **Fleet.io id** on `inbound`. `applyInbound`
  must resolve it through `fleetio_links` first (it does, via `lookupRmpgId`).
  Using it directly as a local id — which every inbound path did before
  2026-07-26 — makes a webhook for Fleet.io vehicle 501 run
  `UPDATE fleet_vehicles … WHERE id = 501`, corrupting an unrelated record with
  no error surface.
- **Inbound FK values are remote ids.** `vendor_id` / `vehicle_id` arrive as
  Fleet.io ids and MUST be reverse-translated (`INBOUND_FK_MAP` +
  `translateInboundFks`) before they touch an RMPG FK column; drop them when
  unmappable rather than writing the remote id through.
- **POST and DELETE are never retried** (`isRetryableMethod`). Fleet.io has no
  idempotency-key header, so replaying a timed-out POST double-creates and
  replaying a succeeded DELETE 404s into a false dead letter.
- **Every emit kind in `EMIT_KIND_TO_RESOURCE` needs a `dispatchOutbound`
  branch.** A missing one isn't inert — it throws 501, burns all 7 retries,
  dead-letters, and pages an operator. `fuel.delete` did exactly that for weeks.
- **Match delete semantics per resource**: RMPG soft-deletes vendors
  (`active=0`) → Fleet.io `PATCH /vendors/:id/archive` (verb confirmed live
  2026-07-29 — an earlier fix corrected the path but left the verb as `POST`,
  which 404s and was silently swallowed by the delete branch's "already
  archived" handling); RMPG hard-deletes parts
  and fuel entries → Fleet.io `DELETE`. Never translate a soft delete into a
  hard remote one.
- **`/pull` and `/seed` both pace at `PACE_MS` (1.2 s, `src/routes/fleetio.ts:47`)**
  — this is RMPG's own self-imposed pacing, **not a documented Fleet.io platform
  limit** (confirmed 2026-07-29: Fleet.io's own docs say limits are
  plan-dependent — "consult your plan" — with no fixed number published). Any
  new loop that calls Fleet.io must pace too, but don't cite "50 req/min" as
  a Fleet.io-documented ceiling outside this codebase.
- Parse D1 timestamps with `parseD1TimestampMs` — `datetime('now')` is
  zone-less and `Date.parse` reads that as LOCAL time, which silently skews
  every `shared`-field last-write-wins verdict off a UTC host.
- **🔴 After merge**: apply `0206_fleetio_link_resource_canonicalization.sql` to
  live D1 `785de7ae` via `scripts/apply-migration.sh`, then verify with
  `SELECT fleetio_resource, COUNT(*) FROM fleetio_links GROUP BY 1` — expect
  only the five canonical plural values.

### CarsXE (vehicle data: plate decode, VIN specs, lien/theft, history)

Manual, officer-triggered vehicle-data lookups at `/api/carxe`
([`src/routes/carxe.ts`](src/routes/carxe.ts), client in
[`src/utils/carxe/`](src/utils/carxe/)). Cached 24 h in `carxe_lookups` so a
re-pull never re-bills a CarsXE credit. Secret `CARXE_API_KEY`; unset →
`200 { ok:false, code:'not_configured' }`. Migrations `0213` (cache table),
`0215` (vehicles_records identity indexes) — all applied + tracked on live.

#### CarsXE invariants — read before touching the vehicle-record bridge

- **The RMS is PLATE-keyed, not VIN-keyed.** Live audit 2026-07-30: **38 of 42**
  `vehicles_records` rows have NO `vin`; **0** lack a `plate_number`. Both UI
  call sites ([`VehicleDossier`](client/src/components/VehicleDossier.tsx),
  [`PlateLogPage`](client/src/pages/PlateLogPage.tsx)) enter via plate. Any
  vehicle lookup written as `WHERE vin = ?` alone matches ~10% of the fleet.
  That is not hypothetical: the original theft path did exactly this, so it
  **INSERTed a duplicate row** and stamped `is_stolen=1` on an orphan while the
  plate-keyed record officers actually see in the dossier stayed clean.
- **ALWAYS resolve identity through `resolveVehicleRecord` /
  `upsertVehicleFromCarxe`** in
  [`src/utils/carxe/vehicleRecords.ts`](src/utils/carxe/vehicleRecords.ts).
  Order is VIN → plate+state → plate, and it is the single seam every CarsXE
  write path shares. Never hand-roll a vehicle match.
- **Writes are FILL-ONLY.** Every column goes through
  `COALESCE(NULLIF(col,''), ?)` (or `COALESCE(col, ?)` for numerics), so CarsXE
  can populate a BLANK field but can never overwrite officer-entered data.
  CarsXE is commercial third-party data landing in an authoritative
  law-enforcement record — this is a policy constraint, not a style choice.
  **The one deliberate exception is `is_stolen` / `stolen_status`**, which
  overwrite because a stale blank must never beat a live active-theft finding.
- **⚠️ `idx_vehicles_records_vin_unique` is a PARTIAL + EXPRESSION index**
  (`ON vehicles_records(UPPER(TRIM(vin))) WHERE vin IS NOT NULL AND TRIM(vin) != ''`).
  SQLite will only use a partial index when the query's predicate **provably
  implies the index's**, so a VIN lookup MUST carry the redundant-looking
  `vin IS NOT NULL AND TRIM(vin) != ''` prefix. Verified via `EXPLAIN QUERY
  PLAN` on live: without it the plan is `SCAN vehicles_records`; with it,
  `SEARCH ... USING INDEX`. Do not "simplify" that prefix away.
- **Only an ACTIVE theft alerts.** `isActiveTheftEvent` requires *both*
  `'active'` and `'theft'` in the event string, so "Theft Recovered" / "Theft
  Record Cleared" do NOT page an officer. Liens and title brands (SALVAGE /
  FLOOD / LEMON, via `titleStatusFromHistory`) are records data only — they
  fill `lien_holder` / `title_status` and raise nothing.
- **Theft notifications dedupe per `(vehicle, recipient)`** over
  `THEFT_NOTIFY_DEDUPE_MS` (= the 24 h cache TTL). The theft path deliberately
  runs on cache hits so a re-pull still screens, which made the notification
  INSERT the one non-idempotent step. Dedupe is per-recipient — a different
  officer pulling the same VIN must still be warned.
- **A vehicle-record write must never fail the officer's lookup.** Each upsert
  is wrapped in try/catch + `log.error` and degrades. **Consequence for tests:
  a missing table or broken mapper is INVISIBLE** — assert on the returned
  `vehicle_record` and on the row itself, never just on `res.status`.
- `notifications` and `vehicles_records` both had **zero indexes** before
  `0214`/`0215`. Assume nothing about index coverage on older tables; check
  `sqlite_master` and confirm with `EXPLAIN QUERY PLAN`.

### Dial Connect (Twilio dialer at dialer.rmpgutah.us) — call-archive invariants

The dialer is a separate app embedded as an iframe by
[`DialerPanel`](client/src/components/DialerPanel.tsx); it talks to the CAD via
`postMessage` and the CAD archives calls through `POST /api/dialer-connect/events`
([`src/routes/dialerConnect.ts`](src/routes/dialerConnect.ts)). Hardened 2026-09-05
after call history showed 10 "unknown" rows with no number, no duration, and a
`failed` call re-labelled `completed`.

- **Only `call_status` may set `status`.** `recording_ready` / `transcript_ready`
  carry no status and are bound as NULL so `COALESCE(?, status)` keeps
  `missed`/`failed`. Before the fix the client rewrote them as `call_status` and the
  Worker defaulted the missing status to `'completed'`.
- **Absent fields are NULL, never defaults.** `ingestCallFields` in
  [`src/utils/dialerConnect.ts`](src/utils/dialerConnect.ts) returns `null` for a
  missing/invalid direction, status, number, or duration; insert-only defaults
  (`'inbound'`, `'completed'`, `now`) are applied in the INSERT column list only and
  the `ON CONFLICT … DO UPDATE` branch binds the raw nullable values.
- **One upsert statement, keyed by the partial UNIQUE index on `call_sid`.** A
  `completed` event and a `recording_ready` event racing for the same SID used to
  check-then-insert and either double-inserted or 500'd on the index (the client
  swallows that error, so it was invisible). Pinned by
  `test-workers/dialerConnectEvents.test.ts`, including a `Promise.all` race.
- **Forward everything on `recording_ready`.** It is the only event that carries
  numbers/direction/duration for a call whose status event was missed; the bridge
  must pass `from`/`to`/`direction`/`startedAt`/`endedAt`/`durationSeconds`/
  `dispatcherName` through, not just the SID and URL.
- **Every recording is COPIED into RMPG Flex (encrypted R2), never just linked.**
  `mirrorRecording` runs inline on `/events` + `/ingest` (via `waitUntil`), lazily
  when `/calls/:id/audio` has to proxy, and from the `*/30` cron backstop
  (`mirrorPendingRecordings`, exported from the route). `recording_source_url`
  stays as provenance; `recording_r2_key` is what playback/download/export serve.
  Retries are bounded by `MIRROR_MAX_ATTEMPTS` via `recording_mirror_attempts` /
  `recording_mirror_error` / `recording_mirrored_at` (migration
  `0280_dialer_recording_mirror.sql`, also reconciled at runtime). Only
  `isAllowedRecordingSourceUrl` hosts are ever fetched. Pinned by
  `test-workers/dialerConnectRecordingMirror.test.ts`. The UI shows an
  `Archived` / `Copy pending` chip per row. The dialer stays at
  `https://dialer.rmpgutah.us` (`DIALER_ORIGIN`) — the mirror is additive.
- **🔴 After merge**: `scripts/apply-migration.sh 0280_dialer_recording_mirror.sql`
  against live D1 `785de7ae`, then confirm the backfill with
  `SELECT COUNT(*) FROM dialer_calls WHERE recording_source_url IS NOT NULL AND recording_r2_key IS NULL`
  trending to 0 over the next few cron ticks.
- **UI: `counterpartyNumber` / `clusterCounterparties`** in
  [`client/src/utils/dialerConnect.ts`](client/src/utils/dialerConnect.ts) fall back to
  whichever number exists and never cluster numberless rows (no more
  "dup unknown ×10").

### Legal Data Hunter (manual warrant-charge validation)

Manual, officer-initiated cross-reference of a warrant's charge text against the Legal Data
Hunter API (230+ jurisdictions). **Not** an auto-screen — never runs on warrant create/update,
never blocks any warrant workflow. Full design:
[`docs/superpowers/specs/2026-07-17-legal-data-hunter-integration-design.md`](docs/superpowers/specs/2026-07-17-legal-data-hunter-integration-design.md).

- **Client**: [`src/utils/legalDataHunter/client.ts`](src/utils/legalDataHunter/client.ts) —
  Worker-safe `fetch` wrapper for `POST /v1/resolve` and `POST /v1/search`
  (`https://legaldatahunter.com`). Typed errors (`LdhConfigError|LdhTimeoutError|LdhHttpError|LdhRateLimitError`).
  Unit-tested in [`tests/legalDataHunterClient.test.ts`](tests/legalDataHunterClient.test.ts).
- **Rate limiting**: LDH's own limits are 10 req/min / 20 req/day / 600/period — far too low for
  any automated pipeline. [`src/utils/legalDataHunter/rateLimit.ts`](src/utils/legalDataHunter/rateLimit.ts)
  enforces a self-imposed buffer (8/min, 18/day) via KV counters before any live call is made.
- **Route**: [`src/routes/legalDataHunter.ts`](src/routes/legalDataHunter.ts) at
  `/api/legal-data-hunter` (auth required, `client_viewer` excluded). `POST /validate` tries, in
  order: the local `utah_statutes` table (free, Utah-only) → the `legal_charge_validations` D1
  cache → a live LDH call under the rate budget. `GET /usage` (admin/manager) reports today's
  call count.
- **Schema**: migration `0191_legal_data_hunter.sql` — `legal_charge_validations`
  (charge text/state → cached match, unique per normalized charge+state). No new columns on
  `warrants` (100-col cap).
- **UI**: [`LegalDataHunterValidateButton`](client/src/components/LegalDataHunterValidateButton.tsx),
  embedded on `WarrantsPage.tsx`'s warrant-detail "Offense / Charges" block. Click-to-validate
  only — no polling, no background state.
- **Config**: secret `LEGAL_DATA_HUNTER_API_KEY` via `wrangler secret put` (prod) / `.dev.vars`
  (local, gitignored). Unset → `/api/legal-data-hunter/validate` returns
  `200 { ok: false, code: 'not_configured' }`.
  ⚠️ If setting this up from the original integration session, the API key shared in that
  chat was pasted into a non-secret channel and must be rotated before use — never reuse
  a key that appeared in conversation text.

## Code Patterns

### Logging & observability (2026-06-24: structured JSON logger)

**Use `src/utils/logger.ts` instead of raw `console.log/error`** for all new code. The structured logger (`log.info / log.warn / log.error`) writes JSON lines with service name, log level, trace ID, and machine-parseable context. Each line is a single `JSON.stringify` call — compatible with Workers Logs, `wrangler tail --format json`, and external log sinks.

```ts
import { log } from '../utils/logger';
log.info('User logged in', { userId: 123 });
log.error('DB query failed', { sql }, err);  // err is formatted as {name, message, stack}
```

**Trace IDs** are auto-generated per-request via `traceMiddleware()` (replaces `logger()` from `hono/logger`). Every response gets `X-Trace-Id` header. Access from any middleware/handler via `c.get('traceId')`.

```ts
app.use('*', traceMiddleware());      // sets traceId on c.var + X-Trace-Id header
app.use('*', requestLogMiddleware()); // logs every request as JSON
```

**Error persistence** (`error_log` table, migration 0156): unhandled route errors are automatically persisted via `logErrorToDb()` in the global `onError` handler. The table stores severity, category, message, JSON details, trace ID, user ID, source route, and status code. Fire-and-forget via `waitUntil` — never blocks the response.

```ts
logErrorToDb(c.env.DB, {
  severity: 'error',
  category: 'route',
  message: err.message,
  details: { route, userId },
  traceId,
  source: route,
  statusCode: 500,
}, c.executionCtx);
```

**Health check** (`GET /api/health`) probes D1, KV, R2 (`MAP_DATA`, `UPLOADS`, `DOWNLOADS`), and all 6 Durable Object namespaces. Returns latency per service. Status is `'ok'` when all connected; `'degraded'` when any service is unreachable (still HTTP 200 — health probes don't fail the site).

**Log migration plan**: Convert existing `console.log/error` calls incrementally. High-priority targets: route handlers, cron sweepers, and integration clients (Fleet.io, Roboflow, ClearPath). Legacy `console.*` calls co-exist — the structured logger is additive, not a removal gate.

### Worker route (Hono)
```ts
import { Hono } from 'hono';

const app = new Hono<{ Bindings: { DB: D1Database } }>();

app.get('/', async (c) => {
  const rows = await c.env.DB.prepare('SELECT * FROM table WHERE org = ?')
    .bind(c.var.user.org_id)
    .all();
  return c.json(rows.results);
});

app.post('/', async (c) => {
  const body = await c.req.json();
  const result = await c.env.DB.prepare('INSERT INTO ... VALUES (?, ?)')
    .bind(body.foo, body.bar)
    .run();
  return c.json({ success: true, id: result.meta.last_row_id });
});

export default app;
```

Routes are mounted from `src/index.ts`. Per-prefix `app.use('/api/<prefix>', authMiddleware)` calls gate access.

### React page
```tsx
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';

export default function SomePage() {
  const [data, setData] = useState<Foo[]>([]);
  useEffect(() => { apiFetch<Foo[]>('/some-endpoint').then(setData).catch(console.error); }, []);
  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="SECTION TITLE" icon={SomeIcon} />
      {/* Surfaces are theme-variable-backed — use the rmpg/brand/surface Tailwind tokens
          (e.g. bg-surface-base, bg-surface-raised, text-brand-400). They re-theme automatically
          between night and day; never hardcode hex. Night vs day values live in
          client/src/styles/theme-palettes.css. */}
    </div>
  );
}
```

`apiFetch` (in `client/src/hooks/useApi.ts`) targets the API base URL (`https://api.rmpgutah.us` in prod, `http://localhost:8787` in dev). Pass a path with or without `/api` — it normalises.

### Icon-only buttons
Use `<IconButton aria-label="...">` from `client/src/components/IconButton.tsx`. The `aria-label` is a required TS prop — that's the only enforcement; no ESLint a11y plugin runs in `client/`.

### Design tokens (Blue & Silver theme — app-wide default as of 2026-07-04)
The app's default theme is now **Blue & Silver** (`html.theme-blue-silver`) — deep navy-blue surfaces, a cool silver/platinum accent (replacing the old warm gold), near-white text, and red reserved for critical/safety severity. This is a strict, always-dark forced palette (same tier as the legacy pure-black kill-switch), not part of the old day/night schedule. **Do not hardcode hex** — every surface/brand/border color is a CSS variable, and the same Tailwind token re-themes automatically.

- **Palette source of truth:** [`client/src/styles/theme-palettes.css`](client/src/styles/theme-palettes.css). The `html.theme-blue-silver` block is now the operative default. The historical night (`:root, html.theme-dark, .tactical-dark`, steel-blue+gold) and day (`html.theme-light`, light grey+gold) blocks, plus the legacy kill-switch (`html.theme-legacy-black`, pure-black restore), all still exist and can be selected as opt-outs — see Theme engine below. The `rmpg-*`/`brand-*`/`surface-*`/`blue-*` Tailwind tokens in `client/tailwind.config.js` are `rgb(var(--x-rgb)/<alpha-value>)`, so a component using `bg-rmpg-700`/`text-brand-400` re-themes with zero code changes.
- **Blue = surfaces/brand accent, Silver = structural chrome, Gold = labels/headers only, White = near-white text (`--text-primary #f0f4f9`), Red = `--sev-critical` for critical/safety alerts only.** Severity/priority/unit-status hues (green=ok, amber=warn, orange=high, purple=special) stay their fixed operational meanings across every theme variant — they encode CAD semantics, not brand chrome, and were intentionally left alone by every re-theme.

#### Gold / Silver accent tokens (2026-07-24) — read before touching any accent color

- **Use `--accent-silver-*` and `--accent-gold-*`.** Full ramps 300–700 with matching
  `-rgb` triples, exposed as Tailwind `accent-silver-*` / `accent-gold-*`.
- **⚠️ `--brand-gold` renders SILVER (`#c3ccd6`) and is a deliberate compat alias.**
  That inversion was the original Blue & Silver theme's identity, and ~500 files
  consume the `brand-gold-*` ramp *expecting silver*. **Do not "fix" it to gold** —
  that flips 500 files at once. Prefer the explicit `--accent-*` names in new code.
- **Gold is split by WCAG role. This is measured, not taste:**
  - **Text** → `--accent-gold-300 #d9bd72`. Passes AA on navy: 5.83 / 4.63 / 7.02
    against `--surface-base` / `-raised` / `-sunken`.
  - **Graphics** (map arterial lines only) → `--accent-gold-500 #b8912f`. Graphical
    objects need just 3:1 (WCAG 1.4.11); passes at 3.63.
  - **NEVER use `#b8912f` for text** — 2.88:1 on `--surface-raised`, and raised
    panels are exactly where field labels sit.
  - **Legacy `#d4a017` is banned** in the blue-silver block: fails AA (4.50 / 3.57 /
    5.41) *and* is the worst match to `--sev-warn #f59e0b` (1.11 luminance ratio), so
    decorative gold would be confusable with a real overdue/threshold alert.
- **Gold has exactly TWO app roles**, both routed through variables:
  `--field-label-color` and `--panel-header-color`. **Any gold surface not resolving
  through those two vars (or the map palette) is a defect by definition** — that
  invariant is what makes gold placement mechanically auditable. Never write a raw
  `text-accent-gold-*` class in a component.
- **Icons, borders, dividers, secondary text, and active/selected state stay SILVER.**
  Gold is banned from badges, chips, status icons, and anything reporting a condition:
  static chrome cannot signal state, transient indicators can.
- **Numeric metric values are data, not labels** — use `text-rmpg-100`, not gold.
- **Every role variable must be defined in ALL FOUR theme blocks.** A var consumed as
  `text-[color:var(--x)]` silently drops the color when the active block omits it.
  `accentTokens.test.ts` has a theme-block-completeness test that enforces this.
- **Nothing color-valued belongs in `client/src/index.css`.** Colors defined there are
  theme-invariant by construction and escape the theme system entirely. That is what
  made every panel title bar render a pure-black `--titlebar-gradient` under Blue &
  Silver, and the active nav tile render `rgba(0,0,0,0.38)`. Fixed 2026-07-24 by moving
  those vars into all four palette blocks.
- **Maps use a FIXED palette** (`MAP_PALETTE` in [`client/src/utils/mapboxBasemap.ts`](client/src/utils/mapboxBasemap.ts)),
  identical across dark / tactical-dark / legacy / day: navy land, darker navy water,
  **gold arterial lines + gold major place labels**, silver minor roads and labels.
  This supersedes the 2026-07-07 "maps follow the active theme" decision — under that
  scheme the map's accent tracked `--brand-gold`, which is silver, so the map had no
  gold at all. Literal hex is CORRECT in this module: Mapbox GL cannot resolve
  `var(--x)` in a paint property, and the modern space-separated `rgb(r g b)` form
  **blanks the map**. Variant `'light'` now routes through the dark restyle; only the
  explicit `'print'` variant opts out.
- **Exactly ONE palette class is stamped on `<html>`.** `applyThemePreference` in
  `theme.ts` and the pre-paint boot script in `client/index.html` must resolve
  **identically** or the page visibly swaps themes after hydration. Before 2026-07-24
  production ran as `class="theme-dark dark theme-blue-silver"` — two palettes at once,
  with Blue & Silver winning only by CSS source order, meaning any bundler reordering
  would have silently reverted the whole app to night.
- **Theme engine** — resolution order is `legacy → Blue & Silver (default) → active override → schedule`:
  - [`client/src/utils/themeSchedule.ts`](client/src/utils/themeSchedule.ts) (pure `resolveScheduledTheme`/`resolveEffectiveTheme`, unit-tested) + [`theme.ts`](client/src/utils/theme.ts) (`resolveCurrentTheme`, `readThemeOverride`/`writeThemeOverride`, `isLegacyBlackForced`, `isBlueSilverForced`).
  - `UserPreferencesContext` controller re-applies every 60s + on focus/visibility.
  - The inline pre-paint boot script in `client/index.html` (resolves the same way to avoid FOUC).
  - **Keys:** localStorage `rmpg_theme_blue_silver` — **defaults ON** (absent or any value other than `'0'` = on); set to `'0'` to opt back out to the retired gold day/night scheme. `rmpg_theme_override` = `{theme:'dark'|'light', active:boolean}` only takes effect when Blue & Silver is opted out. **`rmpg_theme_legacy='1'` is a kill-switch** that restores the old pure-black theme instantly (wins over Blue & Silver if both are somehow set), no deploy.
  - **Test gotcha:** any test exercising day/night-schedule or legacy-kill-switch logic in isolation must explicitly `localStorage.setItem(BLUE_SILVER_FLAG_KEY, '0')` in its setup, or the new default-on Blue & Silver will force `dark` regardless of what the test is trying to check (see `client/src/utils/__tests__/themeOverride.test.ts`/`themeLegacy.test.ts` for the pattern).
- **Tactical surfaces stay dark always** via the `.tactical-dark` class — live **Map / dashcam & body-cam HUDs / MDT / turn-by-turn Nav** (a bright map at night blinds a driver), regardless of day/night.
- Radius: **2 px everywhere** — never `rounded-lg`. Global Tailwind override at the end of `client/src/index.css` enforces this with `!important`.
- ⚠️ **Per-page hex tail — measure it, don't guess.** Run `cd client && npx tsx scripts/audit-hex.mjs`
  for the live tally (and `--list <dir>` for one batch's files). As of 2026-07-25:
  **4,232 in-scope literals across 455 files**, plus 1,058 correctly EXCLUDED across
  117 files. The old "~12k" figure in `docs/theme-hex-audit-baseline.txt` predates the
  classifier and is not comparable. Shared surfaces re-theme; per-page hardcoded hex
  does not. When you touch a page, migrate its hex.
  - **`scripts/audit-hex.mjs` + `src/utils/hexClassifier.ts` are deny-by-default** and
    match on PATH. Excluded because migrating them BREAKS things: PDF generators
    (jsPDF/pdf-lib take literal color args), Mapbox paint modules (`var()` blanks a
    map), `.tactical-dark` fixed values (map/dashcam/MDT/nav are *intentionally*
    near-black so a bright UI never blinds a driver at night), fixed CAD palettes, and
    test fixtures. Wrongly migrating one of these breaks a document or a map; wrongly
    excluding a file just means a human reviews it later. **When in doubt, exclude.**
  - **The substitution table is a ROLE map, not a find-and-replace map.** The same hex
    routinely serves two roles: `AlarmTrackingPage` used `#0a0a0a` for the page
    background (5 sites) *and* recessed modal inputs (21 sites). Open the JSX and
    decide what the element IS. Smell test: if converted count == occurrence count for
    every hex in a file, nothing was split by role and something was missed.
  - **Run the FULL client suite before landing a batch**, not just targeted tests. A red
    test (`themeBlueSilver.test.ts`, pinning the stale `#0c1a2b`) hid behind green
    targeted runs for four tasks in the 2026-07-24 sweep.
- ⚠️ **A Tailwind class only works if its key is configured.** `bg-surface-hover` was
  used 14× across 7 components while `hover` was never a key in the `surface` scale, so
  Tailwind emitted no CSS and every one of those hover states silently did nothing.
  Verify a new token actually reaches `dist/assets/*.css` before trusting it.
- Tables: header `font-semibold` 9 px, `py-[3px]`; rows 11 px, `py-[2px]`. No pill badges.
  - **Exception: Warrants page** (`WarrantsPage.tsx` and its extracted tab components, see `docs/superpowers/specs/2026-07-14-warrants-page-rebuild-design.md`) — deliberately uses looser row padding and pill-shaped status badges as part of its 2026-07-14 rebuild. Don't "fix" this back to the dense rule; it's an intentional, approved exception scoped to that page.

## Testing & CI

`.github/workflows/pr-tests.yml` runs on every PR + push to main:

1. **`worker-typecheck`** — `npm run typecheck` (tsc on `/src/`)
2. **`worker-tests`** — `npx vitest run` (the `tests/` suite)
3. **`worker-integration-tests`** — `npm run test:worker` (Miniflare, `test-workers/`, via `vitest.workers.config.mts`)
4. **`client-typecheck`** — `cd client && npx tsc --noEmit`
5. **`client-tests`** — `cd client && npx vitest run`
6. **`client-build`** — `cd client && npx vite build` (depends on client-typecheck)

The Worker **does** have test suites — `tests/` (Node) and `test-workers/` (Miniflare), both gated in CI. Earlier revisions of this file said "no Worker test suite yet — Miniflare is Phase 2 tech debt"; that was already stale when written, contradicted by this file's own 2026-06-24 Session Log entry. When you add a new route, prefer adding a smoke test in the same PR.

### The two gates are NOT the same set — don't assume one covers the other

`.husky/pre-push` runs **four** stages: worker types → client types → client vitest → **desktop tests**. It is *not* a mirror of CI. The sets overlap; neither contains the other:

| Stage | pre-push | CI |
|---|---|---|
| Worker typecheck | ✅ | ✅ |
| Client typecheck | ✅ | ✅ |
| Client vitest | ✅ | ✅ |
| **Desktop tests** (`cd desktop && npm test`) | ✅ | ❌ **no CI job exists** |
| Worker vitest | ❌ | ✅ |
| Worker integration (Miniflare) | ❌ | ✅ |
| Client build (`vite build`) | ❌ | ✅ |

**Consequence for `git push --no-verify`:** "CI is the next gate" is true for the three shared stages and **false for desktop tests** — this hook is their only gate anywhere. Bypassing is reasonable when your change doesn't touch `desktop/`; it is genuinely unsafe when it does. Check `git diff --name-only origin/main | grep ^desktop/` before deciding.

**Why pre-push is slow (often 5–15 min), and it's usually not your change:** stage [4/4] rebuilds `better-sqlite3` for the Node ABI to run the desktop tests, then restores it to the Electron ABI via an EXIT trap. That's native compilation twice. If `desktop/node_modules` is absent (common in a fresh worktree) it also runs a full `npm install` whose `electron-rebuild` postinstall compiles again. Budget for it rather than assuming the hook has hung, and prefer backgrounding the push over killing it — a killed push leaves the branch unpushed while the commit exists locally.

**Known fail-open in the hook (unfixed as of 2026-07-25):** the "skip when nothing to push" guard is
`[ "$(git rev-list --count HEAD ^origin/main 2>/dev/null || echo 0)" = "0" ]`. When `origin/main` is
not present locally, `git rev-list` errors, `|| echo 0` yields `0`, and the **entire gate silently
skips** while printing "no commits ahead of origin/main" — so a broken ref and a legitimate no-op are
indistinguishable. If you see that message on a branch you know has commits, the gate did not run;
verify manually with `npm run typecheck && cd client && npx tsc --noEmit && npx vitest run`.

## Common Gotchas (CF era)

1. **`/server/` is dead and no longer exists** — the old VPS-era Express server (and its stale duplicate at top-level `server/`) was deleted outright in the 2026-07-16 repo cleanup. If you see `import ... from 'server/...'` anywhere, that's a bug from before the rehoming and should be ported to `/src/`.
2. **`/src/` and `/client/src/` both contain TypeScript** — `/src/` is the Worker, `/client/src/` is React. They share no build, no `tsconfig`, no `package.json`. Edits to one do not affect the other.
3. **D1 queries are async** — `await db.prepare(...).first()`. Forgetting `await` returns a Promise that JSON-serialises to `{}`, which the client then logs as "empty response."
4. **`deploy.yml` step `Apply D1 migrations` has `continue-on-error: true`** — the Worker reconciles missing columns at boot, but you cannot rely on the deploy log alone to tell you a migration succeeded. After deploying, query the table directly via `wrangler d1 execute rmpg-flex --remote --command 'SELECT name FROM sqlite_master ...'` to confirm.
5. **D1 has dirty schema in prod** — earlier migrations partially applied during the rehoming. New migrations must be idempotent. See [`migrations/README.md`](migrations/README.md).
6. **Service worker cache** — `CACHE_NAME` in `client/public/sw.js` auto-stamps from the git short SHA via the `stamp-sw-version` plugin in [`client/vite.config.ts`](client/vite.config.ts) on every production build. Do NOT edit `CACHE_NAME` manually — it's a literal placeholder `'rmpg-flex-BUILD'` in source and a hand bump is a merge-conflict magnet (this auto-stamp refactor exists for that reason). Add a one-line changelog comment under the most recent `// vNNN:` entry if you want to document what shipped, but the cache name itself is handled for you.
7. **Mapbox token** — `client/src/utils/mapboxApiKey.ts` reads `VITE_MAPBOX_ACCESS_TOKEN` at build time. The error string in that file still says "Add MAPBOX_ACCESS_TOKEN to server/.env" — that's stale (no `.env` on Workers); the token must be embedded into the Vite build via `client/.env` or Cloudflare Pages env vars.
8. **Cloudflare Pages != Worker** — the React app on Pages (`rmpgutah.us`) is a separate deployment from the Worker on `api.rmpgutah.us`. Both deploy together via `deploy.yml`, but each can fail independently. Check Pages logs in the Cloudflare dashboard if the SPA shell breaks while the API is healthy (or vice versa).
9. **WebSocket route** (`src/routes/ws.ts`) uses Workers' `webSocketPair()` — the auth/upgrade dance differs subtly from Node `ws`. JWT is verified once at upgrade time; subsequent messages on that socket are trusted.
10. **`WelfareWatchDO` is SQLite-backed (`new_sqlite_classes`)** — free-plan compatible. Same API surface for our use case but storage is per-DO, isolated from D1.
11. **Megafiles still exist on the client** — `FirecrawlTab.tsx` (11k lines), `MapPage.tsx` / `DispatchPage.tsx` (~6k each), `WarrantsPage.tsx` (4k). Split opportunistically when you're already in them; don't schedule a "refactoring sprint."
12. **Comments in `/src/` and `/client/src/` that say "mirrors server/..."** — that VPS-era source tree no longer exists in this repo (deleted 2026-07-16, previously at `legacy/server-vps/`). Read those comments as historical reference only; the canonical implementation is whatever's in `/src/`.
13. **Buildroot (`kiosk-linux/`) does not build on macOS directly** — use Colima + Docker.
    Build inside **named Docker volumes**, not host bind-mounts — bind-mounting the
    output tree through Colima's virtiofs/9p hits a repeatable file-corruption bug
    during kernel tarball extraction. Copy only final images out to the host at the end.
14. **QEMU + virtio-gpu testing**: pass `-vga none -device virtio-gpu-pci` (the default
    VGA adapter is captured by `screendump` otherwise, not the virtio device). Monitor
    Unix sockets must live under `/tmp` via `mktemp -u` — a path under a deep worktree
    dir exceeds the 104-byte `sockaddr_un` limit. `modetest` exits almost immediately on
    non-interactive stdin — process-alive is never a valid success signal; check its log
    output instead, and give it a **read-write** FIFO (`exec 3<>fifo`), not read-only
    (read-only blocks the whole shell command before `modetest` even runs).
15. **gnu-efi / UEFI apps on macOS**: the ELF/x86_64-elf-gcc cross-toolchain path
    page-faults on real boot. Use Apple clang + `lld` targeting `x86_64-unknown-windows`
    (native PE/COFF) instead — sidesteps the ELF-reloc trampoline entirely.
16. **`AdminPage.tsx` tab wiring** — adding a tab needs FOUR edits: `VALID_TABS` array,
    the `TabId` type union, the `{id,label,icon}` config array, AND an
    `{activeTab === '...' && <Tab/>}` render block. Missing the `TabId` union entry
    compiles-looks-fine until `tsc` — easy to miss when following an older plan brief.
17. **`main` is a protected branch** — direct push is rejected; PR + passing checks
    required. After a squash-merge, a still-open feature branch's later commits diverge
    from the new squash commit on `origin/main` — don't just diff/rebase blindly; cut a
    fresh branch off current `origin/main` and `git checkout <old-branch> -- <files>` to
    bring over only the genuinely-new files, or the PR diff can misleadingly look like it
    reverts other concurrently-merged work.
18. **Subagents cannot block across turns for long-running builds** (multi-hour Buildroot
    compiles, etc.) — a dispatched subagent saying "I'll wait for it to finish" just ends
    its turn with no progress on resume. Monitor long builds directly via Bash
    (`docker ps`/`docker logs`) + `ScheduleWakeup` instead of delegating the wait.
19. **D1 100-column HARD cap** — D1's SQLite is compiled with `SQLITE_MAX_COLUMN = 100`. This is not a SELECT-width limit: **a table with a 101st column becomes unreadable** — workerd reports `malformed database schema (calls_for_service) - too many columns` and every query against it fails `SQLITE_CORRUPT` (reproduced 2026-09-05 on local D1 by adding one column to `calls_for_service`). `calls_for_service` (exactly 100 cols) and `persons` (94 cols) are at or near the cap on live. **Never `ALTER TABLE … ADD COLUMN` against either of those** — new columns go to the `_ext` overflow table (1:1 pattern, see `calls_for_service_ext`). Any rebuild of `calls_for_service` (CHECK-constraint changes need one) must copy exactly the baseline column list behind a `pragma_table_info` count guard — see `migrations/0262_calls_status_merged_split.sql` and its pin test `tests/migration0262CallsRebuild.test.ts`. (The original 0262 recreated the table with 38 wrong columns; only wrangler's per-file transaction kept it from wiping live.) `scripts/check-column-cap.js` (run by `.github/workflows/column-cap-check.yml` on every PR touching `migrations/`) fails CI if a PR adds an ALTER against a watched table. Override with `ALLOW_ALTER_<TABLE>=1` env var on the workflow run if you genuinely have no other option, and document the reason in the PR body.
20. **⚠️ D1 100-BOUND-PARAMETER cap — a SEPARATE limit from the column cap above.** D1 rejects any query carrying more than 100 bound parameters, **at bind time, before execution** ([limits](https://developers.cloudflare.com/d1/platform/limits/)). This bites every `… IN (?,?,…)` list built from a caller-supplied array, because the query's **shape then grows with the data**: it passes every test and every dev run, then fails the first time real data crosses 100 rows.
    - **Never build an IN-list from an unbounded array.** Use `queryInChunks` / `executeInChunks` / `chunkBindings` from [`src/utils/db.ts`](src/utils/db.ts), which own the cap. `leadingBindings` accounts for parameters bound *outside* the IN-list so they can't be squeezed out of the budget.
    - **It usually does NOT reach `error_log`.** D1 throws from inside `query()`/`execute()` rather than from the route body, so a route without its own try/catch just 500s with nothing persisted — the browser console is the only evidence. Don't conclude "no errors" from an empty `error_log`.
    - **The silent variant is worse than the 500.** `intelQueryFlags.ts` catches and logs per-block, so >100 persons returned **empty flags** instead of failing — `ACTIVE WARRANT` / `OFFICER SAFETY` badges vanished from large result sets with nothing on screen. Found in 5 sites total (2026-07-26): `fleetio/conflicts`, `serveDashboard`, `statutes`, `admin` bulk-reassign, `intelQueryFlags`.
    - **Dedupe before chunking** when results are accumulated per key. A duplicated id can land in two chunks and double-count totals that a single query would have aggregated once.
    - **Chunked writes are not atomic.** `executeInChunks` is one statement per chunk; use `db.batch()` if you need all-or-nothing.
    - Grep for new instances with `grep -rn "map(() => '?')" src/` — lists built from fixed constants or schema column arrays are fine; ones built from request bodies are not.

## Cross-reference: dead instructions to ignore

If you encounter any of these in code comments, docs, or older messages, **do not follow them** — they describe the retired VPS:

- `bash deploy/deploy.sh` (any form, with or without flags)
- `ssh root@194.113.64.90` / `/opt/rmpg-flex/` / `systemctl restart rmpg-flex`
- `rsync -az ... root@194.113.64.90:...`
- `better-sqlite3`, `initDatabase()` from `server/src/models/database.ts`
- `addCol(...)` migrations in `database.ts` — D1 uses files in `migrations/` instead
- nginx config tweaks (`/etc/nginx/sites-enabled/rmpgutah.us`, `mime.types`, `brotli.conf`) — Cloudflare handles all edge TLS / compression / caching
- Manual `CACHE_NAME` bump in `client/public/sw.js` (VPS-era or otherwise) — the value is now auto-stamped from the git short SHA by the `stamp-sw-version` Vite plugin; source stays as the literal placeholder `'rmpg-flex-BUILD'`
- TOTP / WebAuthn / Evidence-chain Ed25519 setup — those features were VPS-only and have not been ported to the Worker yet
- Husky `pre-push` instructions about running 461 server tests — that VPS-era Express suite was removed when `/server/` was quarantined. Do **not** generalize this into "pre-push runs no tests": it still runs client vitest **and desktop tests** (see "The two gates are NOT the same set" above).

When in doubt: `grep` for the actual file under `/src/` or `/client/src/`. The deployed code is always the source of truth, never a comment.

## Session Log

### 2026-06-24 — Phases 1–5: migration overhaul, observability, tests, analytics pipeline, display label standardization

**Phase 1: Migration System Overhaul**
- Drift detection script (`scripts/check-migration-drift.sh`) — portable (no `grep -P`)
- `migrations/README.md` updated with high-water 0155, next-free 0156, 20 duplicate-prefix entries
- `.github/workflows/deploy.yml`: schema drift check + post-deploy health verify

**Phase 2: Structured Observability**
- `src/utils/logger.ts`: JSON structured logger (`log.info/warn/error`), `generateTraceId`, `traceMiddleware`/`requestLogMiddleware`, `logErrorToDb`
- `src/routes/health.ts`: multi-service health probe (D1, KV, R2, 6 DO namespaces) — returns HTTP 200 even in degraded state
- `migrations/0156_error_log.sql`: `error_log` table + 3 indexes
- `src/index.ts`: traceMiddleware → requestLogMiddleware → secureHeaders → cors → onError wiring
- `src/types.ts`: `traceId?: string` in `Variables`
- CLAUDE.md: Observability section added under Code Patterns

**Phase 3: Worker Integration Tests (14 passing)**
- `test-workers/health.test.ts`: 6 Miniflare tests for multi-service health probe (`npx vitest run --config vitest.workers.config.mts`)
- `test-workers/auth.test.ts`: 6 Miniflare tests for auth middleware + RBAC
- `tests/logger.test.ts`: 12 Node tests for structured JSON logger
- `tests/errorLog.test.ts`: 6 Node tests for D1 error persistence
- Bug fixes discovered during testing: `src/index.ts` ExecutionContext type mismatch, `src/routes/serve.ts:580` param fallback, `test-workers/auth.test.ts` import/assertion fixes

**Phase 4: Analytics Pipeline Activation Path**
- `scripts/setup-analytics-pipeline.sh`: one-click Pipelines + R2 catalog setup

**Phase 5: Display Label Standardization**
- Removed 5 local duplicate `toDisplayLabel` functions (CrmPage, ReportsTab, ProposalsTab, LeadsTab, InvoicesPage)
- Replaced 77 inline `.replace(/_/g, ' ').replace(/\b\w/g, ...)` patterns across ~45 files with `toDisplayLabel()` from `client/src/utils/formatters.ts`
- Expanded `ACRONYMS` set from ~25 to ~80 entries
- Fixed imports in StatusBadge, EvidenceTab, BusinessTab, DocumentsTab, BenefitsTab, DashCameraTab, ServeJobCard, IpedPage, DispatchPage, FleetAnalyticsTab, and others

**Verification**: Worker typecheck (`tsc --noEmit` + `tsc -p tsconfig.test.json`) ✅; Node tests (18) ✅; Miniflare worker tests (14) ✅; client build (`vite build`) ✅ 21.34s; client typecheck (12 pre-existing errors, 0 from changes); client tests (9 pre-existing failures in 4 files: equipmentCustodyPdf/prettyAction, MdtPage/button label, PlateLogPage/missing ToastProvider)

> **⚠️ The "12 pre-existing typecheck errors / 9 pre-existing test failures" above is
> STALE — do not treat it as the current baseline.** Re-measured 2026-07-24: all four
> gates are clean (worker typecheck 0, worker vitest 246 files/2004 passed,
> client typecheck 0, client vitest 443 files/3101 passed). Because the baseline is
> clean, **any** failure you see is caused by your own change — a red gate is a hard
> stop, not a judgement call. Re-measure rather than trusting this log.
>
> **Fresh-worktree prerequisite:** run `cd client && npm install --legacy-peer-deps`
> first. Without `client/node_modules`, `tsc` reports ~97,000 phantom
> `Cannot find module` errors that look catastrophic and mean nothing.
>
> **Pre-commit hook flake:** a repo-wide hook runs the Worker vitest suite on every
> commit (`core.hooksPath` is shared across worktrees, so it fires from inside a
> worktree too). Under CPU contention `tests/pdfSign.test.ts` (SLH-DSA post-quantum
> keygen) and `tests/footage/flexcamRoute.test.ts` time out against a 5s limit. The
> failure count tracks machine load — observed 9 fails at load 56, 7 at 47, 1 at 29,
> 0 at 17 — and all pass in isolation. It is contention, not a regression.

**Infrastructure**: Node.js v24.18.0 installed; `npx` via full path due to PowerShell execution policy blocking `.ps1` scripts; `workerd`/`esbuild`/`sharp` postinstall scripts skipped (allowScripts policy)
