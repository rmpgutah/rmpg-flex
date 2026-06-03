# RMPG Flex — Claude Code Project Memory

> **This file describes the Cloudflare Workers stack only** (live as of 2026-05-24).
> The retired Hostinger VPS architecture (`/opt/rmpg-flex`, rsync deploys, systemd,
> Express, better-sqlite3) is dead. Its source has been moved to
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
| Styling | Spillman Flex / Motorola Solutions pure-black theme — `#0a0a0a` base, `#d4a017` gold, zero blue |

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
desktop/            Electron wrapper — undecided whether to keep in CF era
deploy/             VPS deploy scripts — likely dead, retained until confirmed
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
# ⚠️ A Cloudflare **managed challenge** now fronts both zones, so a plain
# `curl -sf https://api.rmpgutah.us/api/health` returns HTTP 403 ("Just a
# moment…") even when the API is perfectly healthy — the bot check needs JS
# + cookies that curl can't solve. Confirmed 2026-05-29 (also reproduced live:
# the SPA + /dispatch load fine in a real browser while curl gets 403).
# The old curl checks are NOT a valid signal anymore.

# Working verification options (pick one):
# 1. Browser: open https://rmpgutah.us/ and https://api.rmpgutah.us/api/health
#    in a real browser (solves the challenge) and eyeball the JSON / SPA shell.
# 2. DB-level health (bypasses the WAF entirely) via the Cloudflare API/D1:
#    query the LIVE DB `rmpg-flex` (785de7ae-3e7a-4e01-93bb-d24ddd813f6b),
#    e.g. `SELECT COUNT(*) FROM sqlite_master WHERE type='table'` (expect ~180).
# 3. Scripted HTTP: add a WAF "Skip → Managed Challenge" custom rule for
#    `http.request.uri.path eq "/api/health"` (and/or gate it on a secret
#    header), then `curl -sf` works again in CI.
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

1. Add a new file under `migrations/` using the next free integer prefix (see [`migrations/README.md`](migrations/README.md)). Current high-water is `0022`.
2. Write idempotent DDL — `CREATE TABLE IF NOT EXISTS`. D1 does **not** support `IF NOT EXISTS` on `ADD COLUMN`, so either accept the failure on re-apply or wrap the `ALTER` in a check via the Worker boot reconciler.
3. Test locally: `npm run migrate:local`.
4. Merge to main — `deploy.yml` applies it to remote D1 (and continues on error, as documented above).
5. **All `db.prepare(...).first() / .all() / .run()` are async** on D1 — always `await`.

## Security

- **`JWT_SECRET`** is the only auth secret in the Worker today (set via `wrangler secret put JWT_SECRET`). The old VPS-era TOTP encryption tying secrets together is not yet ported.
- **CORS** is enforced by the Hono `cors()` middleware in `src/index.ts`, reading the allow-list from `CORS_ORIGINS` (`https://rmpgutah.us,https://www.rmpgutah.us,http://localhost:5173`).
- **Auth middleware** is mounted per-path-prefix in `src/index.ts` (e.g. `app.use('/api/dispatch', authMiddleware)`). Public routes: `/api/health`, `/api/auth`, `/api/map-data`. Everything else requires a valid JWT.
- **Roles** (from the VPS era, still in the DB): `admin`, `manager`, `supervisor`, `officer`, `dispatcher`, `contract_manager`, `client_viewer`, `human_resources`.

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
      {/* Surface tokens: bg-surface-base #0a0a0a, raised #141414, sunken #050505 */}
    </div>
  );
}
```

`apiFetch` (in `client/src/hooks/useApi.ts`) targets the API base URL (`https://api.rmpgutah.us` in prod, `http://localhost:8787` in dev). Pass a path with or without `/api` — it normalises.

### Icon-only buttons
Use `<IconButton aria-label="...">` from `client/src/components/IconButton.tsx`. The `aria-label` is a required TS prop — that's the only enforcement; no ESLint a11y plugin runs in `client/`.

### Design tokens (Spillman / Motorola pure-black)
- Surfaces: `#0a0a0a` base, `#141414` raised, `#050505` sunken, `#000000` deep
- Brand gold: `#d4a017`. Neutral gray: `#888888`. **Zero blue anywhere.**
- Borders: `#222222` default, `#1a1a1a` subtle, `#2e2e2e` strong
- Radius: **2 px everywhere** — never `rounded-lg`. Global Tailwind override at the end of `client/src/index.css` enforces this with `!important`.
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
