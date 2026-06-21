# RMPG Flex — Claude Code Project Memory

> **This file describes the Cloudflare Workers stack only** (live as of 2026-05-24).
> The Hostinger VPS architecture (`/opt/rmpg-flex`, rsync deploys, systemd,
> Express, better-sqlite3) is **dead and the host is decommissioned** (shut down
> 2026-06-15 — there is no longer a server at `194.113.64.90` to ssh/rsync/systemctl
> against). Its source has been moved to
> [`legacy/server-vps/`](legacy/README.md) and is not built, tested, or deployed.
> See [`LEGACY.md`](LEGACY.md) for a quick live-vs-dead map of every top-level
> directory before assuming anything about the codebase.

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
| Styling | Spillman Flex day/night theme — **night (default)** = dark steel-blue Spillman (`surface-base #0d1722`), **day** = light-grey Spillman, auto-switching on a shift schedule (06:00–18:00 local). Colors come from CSS-variable-backed Tailwind tokens in [`client/src/styles/theme-palettes.css`](client/src/styles/theme-palettes.css) (the single source of palette truth) — **never hardcode hex**. Brand gold stays `#d4a017`. "Zero blue" is no longer a rule — steel-blue is the new identity. (The old pure-black `#000000` default is now a legacy kill-switch only — see Design tokens below.) |

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

legacy/             ⚠️  RETIRED VPS-era code (read-only, do not import) — see LEGACY.md
desktop/            Electron wrapper — kept (in active use)
                    NOTE: deploy/ (VPS-era deploy scripts) was DELETED in cleanup PR 2.
                    If a comment or doc still references bash deploy/deploy.sh —
                    that's the canonical "do not use" recipe; it never lived in CF era.
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

**Service worker cache**: bump `CACHE_NAME` in `client/public/sw.js` on every client change so users don't get stale chunks. Incident 2026-05-24: SW v321 lived in prod for weeks while source moved to v563 because the old `deploy.yml` only ran the Worker step. The new pipeline deploys both — but the SW bump is still required for cache invalidation.

**Manual / local invocations**:
```bash
npm run dev               # wrangler dev (local Worker on 8787)
npm run typecheck         # tsc --noEmit on /src/
cd client && npm run dev  # Vite dev server on 5173
npm run migrate:local     # apply migrations to local D1
npm run migrate:prod      # apply migrations to remote D1
```

## Schema changes (D1)

1. Add a new file under `migrations/` using the next free integer prefix (see [`migrations/README.md`](migrations/README.md)). Current high-water is `0093` (check `ls migrations/ | tail` — duplicate prefixes exist, e.g. two `0075`/`0084`/`0085` files).
2. Write idempotent DDL — `CREATE TABLE IF NOT EXISTS`. D1 does **not** support `IF NOT EXISTS` on `ADD COLUMN`, so either accept the failure on re-apply or wrap the `ALTER` in a check via the Worker boot reconciler.
3. Test locally: `npm run migrate:local`.
4. Merge to main — `deploy.yml` applies it to remote D1 (and continues on error, as documented above).
5. **⚠️ Migrations routinely fail to reach live D1 silently** (deploy step is `continue-on-error`; migration tracking historically targeted the abandoned DB). After merging, ALSO apply the DDL directly to live `rmpg-flex` (`785de7ae-…`) via the Cloudflare D1 API and verify with `pragma_table_info('<table>')`. A runtime "no such column/table" error is almost always a migration that never landed — check `pragma_table_info` before debugging route code. (Full drift sweep 2026-06-10: `0093_schema_drift_sweep.sql` reconciled all drift to date.)
6. **All `db.prepare(...).first() / .all() / .run()` are async** on D1 — always `await`.

## Security

- **`JWT_SECRET`** is the only auth secret in the Worker today (set via `wrangler secret put JWT_SECRET`). The old VPS-era TOTP encryption tying secrets together is not yet ported.
- **Integration secrets** (optional bindings, read only from `c.env`, never hard-coded): `IPED_API_KEY`, `ROBOFLOW_API_KEY` (ALPR — see below). Set with `wrangler secret put <NAME>`; for local dev put them in `.dev.vars` (gitignored). A route returns 503 when its key is unset rather than crashing.
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
goes live in PR 1 (this PR — seed only); bidirectional real-time + webhooks land in
PR 4. Full spec: [`docs/superpowers/specs/2026-06-21-fleetio-integration-design.md`](docs/superpowers/specs/2026-06-21-fleetio-integration-design.md).

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

## Code Patterns

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

### Design tokens (Spillman day/night theme)
The app has a **system-wide day/night theme** (PR #1277 + #1279). **Night is the default** (dark steel-blue Spillman); **day** is a light-grey Spillman skin. The two auto-switch on a shift schedule (06:00–18:00 local = day). **Do not hardcode hex** — every surface/brand/border color is a CSS variable, and the same Tailwind token re-themes between night and day by swapping the variable.

- **Palette source of truth:** [`client/src/styles/theme-palettes.css`](client/src/styles/theme-palettes.css). Three blocks — night (`:root, html.theme-dark, .tactical-dark`, steel-blue), day (`html.theme-light`, light grey, scale inverted), and the legacy kill-switch (`html.theme-legacy-black`, pure-black restore). The `rmpg-*`/`brand-*`/`surface-*`/`blue-*` Tailwind tokens in `client/tailwind.config.js` are `rgb(var(--x-rgb)/<alpha-value>)`, so a component using `bg-rmpg-700`/`text-brand-400` re-themes with zero code changes.
- **Brand gold stays `#d4a017`.** Neutral gray `#888888`. **"Zero blue" is no longer a rule** — steel-blue is the new identity.
- **Theme engine** — all resolve identically as `legacy → active override → schedule`:
  - [`client/src/utils/themeSchedule.ts`](client/src/utils/themeSchedule.ts) (pure `resolveScheduledTheme`/`resolveEffectiveTheme`, unit-tested) + [`theme.ts`](client/src/utils/theme.ts) (`resolveCurrentTheme`, `readThemeOverride`/`writeThemeOverride`, `isLegacyBlackForced`).
  - `UserPreferencesContext` controller re-applies every 60s + on focus/visibility.
  - The inline pre-paint boot script in `client/index.html` (resolves the same way to avoid FOUC).
  - **Keys:** localStorage `rmpg_theme_override` = `{theme:'dark'|'light', active:boolean}` is the source of truth (manual pick = `active:true`, Auto = `active:false`). **`rmpg_theme_legacy='1'` is a kill-switch** that restores the old pure-black theme instantly, no deploy.
- **Tactical surfaces stay dark always** via the `.tactical-dark` class — live **Map / dashcam & body-cam HUDs / MDT / turn-by-turn Nav** (a bright map at night blinds a driver), regardless of day/night.
- Radius: **2 px everywhere** — never `rounded-lg`. Global Tailwind override at the end of `client/src/index.css` enforces this with `!important`.
- ⚠️ Phase 2/3 tail: ~12k raw-hex values still live in individual components (`docs/theme-hex-audit-baseline.txt` sizes it). Shared surfaces re-theme; per-page hardcoded hex does not. When you touch a page, prefer migrating its hex to tokens.
- Tables: header `font-semibold` 9 px, `py-[3px]`; rows 11 px, `py-[2px]`. No pill badges.

## Testing & CI

`.github/workflows/pr-tests.yml` runs on every PR + push to main:

1. **`worker-typecheck`** — `npm run typecheck` (tsc on `/src/`)
2. **`client-typecheck`** — `cd client && npx tsc --noEmit`
3. **`client-tests`** — `cd client && npx vitest run`
4. **`client-build`** — `cd client && npx vite build` (depends on client-typecheck)

There is no Worker test suite yet — only typecheck. **Adding vitest for `/src/` with Miniflare is tracked as Phase 2 tech debt.** When you add a new route, prefer adding a smoke test in the same PR.

`.husky/pre-push` mirrors CI locally (worker types + client types + client vitest). Bypass with `git push --no-verify` only for genuine hotfixes — CI is the next gate.

## Common Gotchas (CF era)

1. **`/server/` is dead** — it's been moved to `legacy/server-vps/`. If you see `import ... from 'server/...'` anywhere outside `legacy/`, that's a bug from before the rehoming and should be ported to `/src/`.
2. **`/src/` and `/client/src/` both contain TypeScript** — `/src/` is the Worker, `/client/src/` is React. They share no build, no `tsconfig`, no `package.json`. Edits to one do not affect the other.
3. **D1 queries are async** — `await db.prepare(...).first()`. Forgetting `await` returns a Promise that JSON-serialises to `{}`, which the client then logs as "empty response."
4. **`deploy.yml` step `Apply D1 migrations` has `continue-on-error: true`** — the Worker reconciles missing columns at boot, but you cannot rely on the deploy log alone to tell you a migration succeeded. After deploying, query the table directly via `wrangler d1 execute rmpg-flex --remote --command 'SELECT name FROM sqlite_master ...'` to confirm.
5. **D1 has dirty schema in prod** — earlier migrations partially applied during the rehoming. New migrations must be idempotent. See [`migrations/README.md`](migrations/README.md).
6. **Service worker cache** — bump `CACHE_NAME` in `client/public/sw.js` on every client change. Without a bump, users keep serving the old hash-named bundles from cache for up to 24 h.
7. **Mapbox token** — `client/src/utils/mapboxApiKey.ts` reads `VITE_MAPBOX_ACCESS_TOKEN` at build time. The error string in that file still says "Add MAPBOX_ACCESS_TOKEN to server/.env" — that's stale (no `.env` on Workers); the token must be embedded into the Vite build via `client/.env` or Cloudflare Pages env vars.
8. **Cloudflare Pages != Worker** — the React app on Pages (`rmpgutah.us`) is a separate deployment from the Worker on `api.rmpgutah.us`. Both deploy together via `deploy.yml`, but each can fail independently. Check Pages logs in the Cloudflare dashboard if the SPA shell breaks while the API is healthy (or vice versa).
9. **WebSocket route** (`src/routes/ws.ts`) uses Workers' `webSocketPair()` — the auth/upgrade dance differs subtly from Node `ws`. JWT is verified once at upgrade time; subsequent messages on that socket are trusted.
10. **`WelfareWatchDO` is SQLite-backed (`new_sqlite_classes`)** — free-plan compatible. Same API surface for our use case but storage is per-DO, isolated from D1.
11. **Megafiles still exist on the client** — `FirecrawlTab.tsx` (11k lines), `MapPage.tsx` / `DispatchPage.tsx` (~6k each), `WarrantsPage.tsx` (4k). Split opportunistically when you're already in them; don't schedule a "refactoring sprint."
12. **Comments in `/src/` and `/client/src/` that say "mirrors server/..."** — those references now point at `legacy/server-vps/...`. Read them as historical reference only; the canonical implementation is whatever's in `/src/`.
13. **D1 100-column SELECT cap** — Cloudflare D1 caps SELECT result sets at ~100 columns. `calls_for_service` (100 cols) and `persons` (94 cols) are at or near the cap on live. **Never `ALTER TABLE … ADD COLUMN` against either of those** — new columns go to the `_ext` overflow table (1:1 pattern, see `calls_for_service_ext`). `scripts/check-column-cap.js` (run by `.github/workflows/column-cap-check.yml` on every PR touching `migrations/`) fails CI if a PR adds an ALTER against a watched table. Override with `ALLOW_ALTER_<TABLE>=1` env var on the workflow run if you genuinely have no other option, and document the reason in the PR body.

## Cross-reference: dead instructions to ignore

If you encounter any of these in code comments, docs, or older messages, **do not follow them** — they describe the retired VPS:

- `bash deploy/deploy.sh` (any form, with or without flags)
- `ssh root@194.113.64.90` / `/opt/rmpg-flex/` / `systemctl restart rmpg-flex`
- `rsync -az ... root@194.113.64.90:...`
- `better-sqlite3`, `initDatabase()` from `server/src/models/database.ts`
- `addCol(...)` migrations in `database.ts` — D1 uses files in `migrations/` instead
- nginx config tweaks (`/etc/nginx/sites-enabled/rmpgutah.us`, `mime.types`, `brotli.conf`) — Cloudflare handles all edge TLS / compression / caching
- `CACHE_NAME` bump on the **VPS** — only the local `client/public/sw.js` matters
- TOTP / WebAuthn / Evidence-chain Ed25519 setup — those features were VPS-only and have not been ported to the Worker yet
- Husky `pre-push` instructions about running 461 server tests — that gate was removed when `/server/` was quarantined

When in doubt: `grep` for the actual file under `/src/` or `/client/src/`. The deployed code is always the source of truth, never a comment.
