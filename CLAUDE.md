# RMPG Flex — Claude Code Project Memory

> **Architecture audited 2026-05-24.** This file describes the current Cloudflare Workers deployment. The previous VPS-on-Hostinger architecture (rsync to `root@194.113.64.90`, `/opt/rmpg-flex`, systemd, better-sqlite3 file DB) is retired — do not follow any instruction that references SSH, rsync, `/opt/rmpg-flex`, or `systemctl restart rmpg-flex`.

## Project Overview

RMPG Flex is a **police CAD/RMS** (Computer-Aided Dispatch / Records Management System) for Rocky Mountain Protective Group, a private security / law enforcement company in Salt Lake City, Utah.

- **Domain**: https://rmpgutah.us (registrar: Network Solutions; DNS + proxy: Cloudflare)
- **Origin**: Cloudflare Worker `rmpg-flex` (entry `server/src/worker.ts`)
- **Database**: Cloudflare D1 `rmpg-flex` (`785de7ae-3e7a-4e01-93bb-d24ddd813f6b`) — bound as `DB`
- **Storage**: R2 — `rmpg-flex-uploads` (`UPLOADS`), `rmpg-flex-downloads` (`DOWNLOADS`)
- **Cache/state**: KV — `SESSIONS`, `RATE_LIMITS`
- **Timezone**: America/Denver
- **Version**: 5.8.0

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite 6 + Tailwind CSS (built to `client/dist/`, served via Cloudflare) |
| Backend | **Hono** router on Cloudflare Workers runtime (Express patterns adapted; Express itself does not run on Workers) |
| Database | **Cloudflare D1** via `server/src/models/d1Adapter.ts` (better-sqlite3-shaped async wrapper) |
| Auth | JWT (access + refresh) + WebAuthn (FIDO2) + TOTP 2FA |
| Real-time | WebSocket via Workers `webSocketPair()` (see `server/src/worker-middleware/websocket.ts`) |
| Maps | Google Maps JS API with offline CartoDB dark_matter tile fallback + GeoJSON overlays |
| Desktop | Electron (macOS DMG + Windows EXE) |
| Mobile | Capacitor (Android APK) |
| PDF | RMPG PDF Engine v1.0 (`client/src/lib/rmpg-pdf-engine/`) + PDF.js fallback; jsPDF for legacy reports |
| Voice | Edge TTS neural voice with radio audio processing |
| Styling | Spillman Flex / Motorola Solutions pure-black theme — `#0a0a0a` base, `#d4a017` gold, zero blue |

## Repository Layout

```
client/                React SPA (Vite → client/dist/)
  src/pages/           Page components
  src/components/      Shared components (PanelTitleBar, IconButton, StatsCard, ...)
  src/hooks/           Custom hooks (useApi, useLiveSync, ...)
  src/utils/           PDF gen, maps, CAD parser, voice alerts, call protocols
  src/lib/rmpg-pdf-engine/  Proprietary PDF reader + renderer + writer
  public/              Static assets, sw.js, offline tiles, GeoJSON
server/                Worker code (NOT a long-running Node server anymore)
  src/worker.ts        Hono entry — bindings interface lives here as `Env`
  src/worker-middleware/  websocket, request id, etc.
  src/routes/          Route handlers (one file per domain)
  src/middleware/      auth, rate-limit, audit, security headers
  src/models/database.ts   Schema source of truth (CREATE TABLE + addCol pattern)
  src/models/d1Adapter.ts  D1 ↔ better-sqlite3-shape bridge
  src/utils/           geocode, audit, totp, geofence, ...
  migrations/          Generated SQL applied to D1 (`server/migrations/alters/batch_*.sql` + numbered)
migrations/            Top-level numbered D1 migrations (0001..0011)
scripts/sync-d1.mjs    Parses database.ts, emits migrations for tables/cols missing in D1
deploy/deploy.sh       Wraps wrangler — calls `npx wrangler deploy` (NOT rsync)
desktop/               Electron wrapper
edge/                  Python edge runner for Flex Dashcam AI (Jetson Orin Nano)
```

## Critical Rules

### Never edit
- `wrangler.toml` bindings (`database_id`, KV `id`, R2 `bucket_name`) without confirming with the user — rebinding to a wrong ID can silently point production at an empty DB.
- `server/data/` — local dev SQLite only; not deployed. CI/Workers never read this.

### Deploy
- **Canonical trigger**: push to `main` → `.github/workflows/deploy.yml` runs `wrangler deploy`.
- **Manual**: `bash deploy/deploy.sh` (production) or `bash deploy/deploy.sh --dry-run` (preview).
- **Required GitHub secret**: `CLOUDFLARE_API_TOKEN` (Workers + Pages + D1 edit perms).
- **Verify after every deploy**: `curl -sf https://rmpgutah.us/api/health`.
- **Bump `CACHE_NAME` in `client/public/sw.js`** on every client change — old service workers will otherwise serve stale chunks.
- TLS is handled by Cloudflare automatically. No certs to manage.

### Schema changes
- Add new columns via `addCol(...)` in `server/src/models/database.ts` — never write raw `ALTER TABLE` in route code.
- Run `node scripts/sync-d1.mjs` to generate the migration SQL, then apply with `npx wrangler d1 execute rmpg-flex --remote --file migrations/<new>.sql`.
- D1 has SQLite semantics but is **async**. All `db.prepare(...).get()/all()/run()` calls return Promises through `d1Adapter` — always `await`.

### Security
- TOTP secrets are AES-256-GCM encrypted with a key derived from `JWT_SECRET`. **Rotating `JWT_SECRET` invalidates every TOTP enrollment** — users must re-enroll.
- WebAuthn RP ID is `rmpgutah.us`. Credentials are domain-bound.
- Every route requires JWT auth (`authenticateToken`) except `/api/health`, `/api/auth/login`, and the unauthenticated webhook endpoints.
- Roles: `admin`, `manager`, `supervisor`, `officer`, `dispatcher`, `contract_manager`, `client_viewer`, `human_resources`.

## Code Patterns

### Hono route (Workers-native)
```typescript
import { Hono } from 'hono';
import type { Env } from '../worker';
import { authenticateToken, requireRole } from '../middleware/auth';
import { getDb } from '../models/d1Adapter';
import { auditLog } from '../utils/auditLogger';

const app = new Hono<{ Bindings: Env }>();
app.use('*', authenticateToken);

app.get('/', requireRole('admin', 'officer'), async (c) => {
  const db = getDb(c.env.DB);
  const rows = await db.prepare('SELECT * FROM table WHERE ...').all();
  return c.json(rows);
});

app.post('/', requireRole('admin'), async (c) => {
  const body = await c.req.json();
  const db = getDb(c.env.DB);
  const result = await db.prepare('INSERT INTO ...').run(/* ... */);
  await auditLog(c, 'CREATE', 'table_name', result.last_row_id, null, body);
  return c.json({ success: true, id: result.last_row_id });
});

export default app;
```

### React page
```tsx
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';

export default function SomePage() {
  const [data, setData] = useState([]);
  useEffect(() => { apiFetch<any[]>('/some-endpoint').then(setData).catch(console.error); }, []);
  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="SECTION TITLE" icon={SomeIcon} />
      {/* Surface: bg-surface-base #0a0a0a, raised #141414, sunken #050505 */}
      {/* Borders: border-[#222222], gold: text-[#d4a017] */}
    </div>
  );
}
```

### Icon-only buttons
Use `<IconButton aria-label="...">` from `client/src/components/IconButton.tsx`. `aria-label` is a required TS prop (enforces accessibility at typecheck time). `type="button"` and `aria-hidden` on the child icon are applied automatically.

### Design tokens (Spillman / Motorola pure-black)
- Surfaces: `#0a0a0a` base, `#141414` raised, `#050505` sunken, `#000000` deep
- Brand gold: `#d4a017`. Neutral gray: `#888888`. **Zero blue anywhere.**
- Borders: `#222222` default, `#1a1a1a` subtle, `#2e2e2e` strong
- Radius: **2 px everywhere** — never `rounded-lg`
- Panel headers: gold text on dark chrome gradient (`#1a1a1a` → `#242424`)
- LED indicators: green/red/amber dots with `box-shadow` glow
- Table headers: `font-semibold` 9 px, `py-[3px]`. Rows: 11 px, `py-[2px]`. No pill badges.

### Logging
Use `logger` from `server/src/utils/logger.ts` (pino). Structured object first, message second: `logger.info({ userId }, 'fetching foo')`. Errors go under `err`: `logger.error({ err }, '...')`. Per-request child loggers live on `c.var.log` (carrying a request ID echoed in `X-Request-Id`).

### WebSockets
Workers handle WS via `webSocketPair()` in `server/src/worker-middleware/websocket.ts`. Broadcast helpers (`broadcastDispatchUpdate`, `broadcastUnitUpdate`) still exist but route through Durable Objects or KV — do not assume in-memory state survives across invocations.

## Key Systems

### Dispatch Geography (4-tier Miller drilldown)
`dispatch_areas` → `dispatch_sectors` → `dispatch_zones` → `dispatch_beats`. Plus `dispatch_codes` (10-codes + signal codes) and `premise_alerts`. Production previously ran a 5/46/166/427 legacy classification; the GeoJSON seed on fresh DBs is 6/29/288/719. The geography seed (`seedGeographyFromGeoJSON()` in `database.ts`) is idempotent and bails on non-empty tables.

### Incident RMS (Spillman Flex-style)
`incident_offenses` (UCR/NIBRS), `incident_officers`, `incident_links`. Master Name Index at `/api/incidents/mni/search`, full incident view at `/api/incidents/:id/full`.

### Citations
`citation_violations` with auto-summing fines + 39 extended fields. Batch ops: `/api/citations/batch/void`, `/api/citations/batch/status`.

### Dispatch Console
F2 New, F3 Dispatch, F5 Enroute, F6 OnScene, F7 Clear, F8 CMD, F12 NCIC. CAD command line with 20+ commands. 70+ call-type protocols with auto-priority/flags/backup rules. Edge TTS voice (`en-US-JennyNeural`) with radio squelch / bandpass / pink-noise.

### Serve / Process Service
`serve_queue` (~30 cols), `serve_attempts` (GPS + photo + signature), `serve_routes`, `serve_skip_traces`. Auto-creates serve jobs from PSO/process-service dispatch calls via `serveQueueLinker.ts`. API under `/api/process-server/*`.

### Skip Tracer V2
`server/src/routes/skiptracer-v2/` — 22 data sources (FBI Wanted, OFAC, NSOPW, Utah Courts, SLC Assessor, Arrests, …). `BaseDataSource` provides rate limiting, caching, retry, encrypted config.

### HR / Fleet / Arrests / Cases / FI / Court / Forensic / Trespass / UoF / Shift Plans
All present, each backed by `/api/<domain>/*`. See `server/src/routes/` for the file-per-domain layout.

### Advanced Search
- `/api/records/compound-search` — NCIC-style multi-field
- `/api/records/universal-search` — one query across 9 record types
- `/api/records/persons/:id/dossier` — full MNI dossier
- `/api/records/saved-searches` — user presets

### Evidence Chain (Phase 4)
Ed25519-signed `evidence_hashes` rows. Keys: `EVIDENCE_SIGNING_PRIVATE_KEY`, `EVIDENCE_SIGNING_PUBLIC_KEY` (base64 DER, generated via `server/scripts/generate-evidence-keypair.mjs`) — **independent** of `JWT_SECRET` and the dashcam HMAC secret so each can be rotated separately. Operator endpoints under `/api/evidence/*`. SOP at `docs/evidence-handling-sop.md`.

### Flex Dashcam AI
HMAC-authenticated ingest at `/api/dashcam-ai/event` and `/api/dashcam-ai/heartbeat` (shared secret `DASHCAM_FORWARD_SECRET`, separate from JWT). Edge runner in `edge/` (Python; `cd edge && pip install -e '.[dev]'`; tests `cd edge && pytest`). Cross-language HMAC framing: `HMAC-SHA256(secret, f"{ts}\n{body}")` — if you change framing in `server/src/utils/dashcamAiHmac.ts`, update `edge/flex_edge/signer.py` in the same PR.

### Maps (single surface)
Google Maps JS API only. CartoDB dark_matter raster tiles as offline fallback. GeoJSON overlays (`beat`, `county`, `municipality`, `highway`). **Do not reintroduce OpenLayers or Mapbox** — both were attempted and retired. Speculative `mapboxOverlays.ts` / `mapboxClient.ts` / `mapboxMap.ts` files on the stale `claude/flamboyant-nobel` branch should not be merged.

### PDF Editor
RMPG PDF Engine v1.0 (proprietary, at `client/src/lib/rmpg-pdf-engine/`) — native parser + renderer + writer with PDF.js v5 fallback. Server-side encryption uses `qpdf` (probe via `GET /api/pdf-tools/health`; 503 with `code: 'QPDF_MISSING'` when unavailable). 80 of 150 planned upgrades shipped; see prior CLAUDE.md history or PR roadmap for the full table if needed.

## Development

```bash
# Local dev — server runs as plain tsx + better-sqlite3 against server/data/rmpg-flex.db
npm run dev                              # client + server concurrently

# Build
npm run build                            # client → client/dist/
cd client && npx tsc --noEmit            # client typecheck (deploy gate)
cd server && npx tsc --noEmit            # server typecheck (deploy gate)

# Server tests
cd server && npx vitest run              # full suite
cd server && npm run check:routes        # route-collision guard

# D1 (Cloudflare)
npx wrangler d1 execute rmpg-flex --remote --command "SELECT COUNT(*) FROM users"
npx wrangler d1 execute rmpg-flex --remote --file migrations/0012_<name>.sql
node scripts/sync-d1.mjs                 # diff database.ts → emit missing tables/cols

# Deploy
bash deploy/deploy.sh                    # → wrangler deploy
bash deploy/deploy.sh --dry-run          # preview
curl -sf https://rmpgutah.us/api/health  # verify

# Desktop / Mobile
cd desktop && npm run build:all          # mac DMG + win EXE
npm run android:build                    # APK
```

### Quick status
```bash
curl -sf https://rmpgutah.us/api/health | python3 -m json.tool   # version + features
grep CACHE_NAME client/public/sw.js                              # local SW version
```

## Common Gotchas

1. **`JWT_SECRET` is load-bearing** — rotating it invalidates all TOTP enrollments (AES-256-GCM key is derived from it).
2. **D1 is async** — every `db.prepare(...).get/all/run` returns a Promise. Forgetting `await` returns `[object Promise]` or silently coerces to NaN.
3. **Workers have no filesystem** — `fs.readFileSync` will throw. Read static assets from R2 (`env.UPLOADS.get(key)`) or bundle them into the Worker.
4. **Workers have no long-lived process** — no in-memory rate limiters, queues, or pub/sub. Use KV (`RATE_LIMITS`), Durable Objects, or Queues. Anything `setInterval`-driven on the old VPS architecture needs to become a Cron Trigger.
5. **Two D1 databases exist** but only `rmpg-flex` (`785de7ae-3e7a-4e01-93bb-d24ddd813f6b`) is bound in `wrangler.toml`. The other (`rmpg-flex-db`, `c4455d24-...`) is an orphan from an early migration attempt — do not write to it; consider deleting once you confirm nothing references it.
6. **Multiple Workers in the account** (`rmpg-flex`, `rmpgflex`, `rmpg-flex-production`, `rmpg-flex-api`, `rmpg-flex-api-production`). Only `rmpg-flex` is the live production binding for `rmpgutah.us/*`. The others are stale deploy attempts and should be deleted once confirmed unused.
7. **R2 `system-essentials` bucket is not bound** in `wrangler.toml`. If it's meant as a backup destination, wire it up explicitly.
8. **Hono ≠ Express** — `req`/`res` are replaced by a single context `c`. Use `c.req.json()`, `c.req.param('id')`, `c.json(...)`, `c.env.DB`. Express middleware that touches `req.user` needs to be ported to set `c.set('user', ...)` and read via `c.get('user')`.
9. **`server/data/*.db` is local-dev only** — production data lives in D1. Do not commit local DB files; do not `rm` them either (they're someone's working state).
10. **Service Worker version** must be bumped on every client change (`client/public/sw.js` → `CACHE_NAME`) or browsers serve stale chunks for up to 24 h.
11. **CACHE_NAME being higher than prod does not prove your code is live.** Verify the specific change by hitting `/api/health` (which carries `version`) and by curl-ing a hashed asset.
12. **Pre-commit / pre-push hooks** run the server vitest suite. On Node 26 with `better-sqlite3@12.9.0` they fail with an ABI mismatch — downgrade to Node 22 LTS locally or accept `--no-verify` when the failure is the ABI error specifically.
13. **Branch `claude/flamboyant-nobel`** is severely stale (hundreds of commits behind main, including a worktree-bundle commit `b08bea7f` that conflicts with mainline DB/route/deploy changes). PR #555 was closed for this reason. Don't merge from this branch — cherry-pick if you need anything from it.
14. **The VPS is gone.** Any instruction, script, or doc that references `root@194.113.64.90`, `/opt/rmpg-flex`, `systemctl restart rmpg-flex`, `bash deploy/deploy.sh` writing via rsync, `/var/log/rmpg-deploy.log`, `/opt/deploy-rmpg-v2.sh`, or the webhook on port 9000 is **obsolete**. The new `deploy/deploy.sh` wraps `wrangler deploy` against Cloudflare.
15. **edge-tts-universal lazy load** — `Function('return import("edge-tts-universal")')()` to avoid tsx ESM resolver crash. Still applies in local dev; on Workers the same code path needs adapting (no `Function`-based dynamic import; use a top-level `await import`).

## Port Completion Status (audited 2026-05-24)

The Express→Hono port shipped each subsystem as a separate `<base>-worker.ts` file mounted via `mountXRoutes`. **Most subsystems are partial ports** — the original sweep commit `a802d87a "Fix remaining API endpoints: all 18 critical routes operational"` was explicitly a stop-the-bleeding pass to get 200 responses, not faithful implementations. Several files reached production with heavy functionality silently missing.

Approximate completion (Worker LOC ÷ Express LOC), sorted by gap severity:

| Subsystem | Worker / Express | % | Status |
|---|---|---|---|
| **fleet** | 128 / 6142 | **2%** | 🔴 Stub — damage-reports returns `[]`; most CRUD disabled |
| **notifications** | 54 / 636 | 8% | 🔴 Heavy stub |
| **email** | 153 / 1900 | 8% | 🔴 Stub — returns hardcoded "requires desktop application" |
| **personnel** | 357 / 4386 | 8% | 🔴 Most endpoints missing |
| **warrants** | 382 / 2515 | 15% | 🟡 Root GET fixed 2026-05-24; many secondary routes still absent |
| **reports** | 393 / 2592 | 15% | 🟡 Heavy gap |
| **comms** | 278 / 1477 | 18% | 🟡 |
| **admin** | 924 / 3722 | 24% | 🟡 58→10 auditLog calls; 40+ broadcast() missing |
| **dlRecords** | 294 / 976 | 30% | 🟡 |
| **incidents** | 746 / 2397 | 31% | 🟡 |
| **records** | 1758 / 4537 | 38% | 🟡 Dropped JOIN columns |
| **auth** | 779 / 2090 | 37% | 🟡 |
| **citations** | 706 / 983 | 71% | 🟡 5→0 auditLog calls |
| **court** | 602 / 1065 | 56% | 🟡 4→0 auditLog calls |
| **cases** | 927 / 1223 | 75% | 🟡 12→1 auditLog calls |
| (40+ others) | varies | 50-95% | Most are tolerable but unaudited for parity bugs |
| **(green)** | useOfForce, geocode, voicePersona, adminMapConfig, pdfEngine, companyDocuments | ≥100% | Port is at least as large as Express (no obvious gap) |

Run the live audit any time:

```bash
for w in server/src/routes/*-worker.ts; do
  base=$(basename "$w" -worker.ts)
  exp="server/src/routes/${base}.ts"; [ -f "$exp" ] || exp="server/src/routes/dispatch/${base}.ts"
  [ -f "$exp" ] || continue
  wl=$(wc -l < "$w"); el=$(wc -l < "$exp"); pct=$(echo "scale=0; $wl*100/$el" | bc)
  printf "%3d%%  %5d / %5d  %s\n" "$pct" "$wl" "$el" "$base"
done | sort -n
```

LOC ratio is a crude proxy — a faithful port can legitimately be shorter (less boilerplate) or longer (more `await` ceremony). Use it as a *triage signal*, then diff endpoint-by-endpoint against the Express source.

### Common port-time bug classes (see PR #556)

1. **`SELECT *` simplification** loses JOINed columns + computed subqueries the UI relies on (e.g., counts, FK labels).
2. **`ORDER BY name`** when Express uses `ORDER BY <thing>_name` — both columns may exist; the wrong one sorts unexpectedly.
3. **Wrong response shape** — bare array vs `{key1, key2}` object; client parser breaks.
4. **Missing query parameters** — filter/search/pagination params silently dropped from the destructure.
5. **Stub placeholders disguised as code** — e.g. `LIKE '%<lat*100>%'` instead of real geofence; returns 200 with wrong data.
6. **Dropped audit logs** — compliance gap, especially serious for citations / warrants / court / use-of-force / evidence.
7. **Dropped WebSocket broadcasts** — real-time UI updates silently die.
8. **Lost transaction wrapping on cascading DELETEs** — `D1Db.transaction` is currently a no-op stub; orphan-row risk.

## Open Questions / Tech Debt

- The Cloudflare D1 production database is sparsely populated (single-digit rows in `calls_for_service`, `incidents`, `citations`). Confirm whether RMPG is in pilot/staging use or whether a data migration from the dead Hostinger VPS is still pending.
- Decide whether to back up D1 to R2 on a schedule (`wrangler d1 export` + R2 PUT in a Cron Trigger). Currently no automated backups exist.
- Stale Workers and the orphan D1 should be deleted once confirmed unused — five `rmpg-flex*` Workers and two D1 instances inflate cost and confuse `wrangler` defaults.
- Pre-existing macOS-duplicate `* 2.ts` files litter `server/src/routes/` (auth-worker 2.ts, records-worker 2.ts, etc.). They compile and confuse `tsc` output. Bulk delete: `find server/src/routes -name '* 2.ts' -delete`.
- Finish the heavy-stub subsystems (fleet, email, notifications, personnel, reports). Each is multi-day work; the 2026-05-21 sweep commit explicitly deferred them.
- `D1Db.transaction` in `worker-middleware/d1Helpers.ts` is `fn => fn()` — no actual transaction. D1 supports batches via `db.batch([stmt1, stmt2])`. Convert cascading DELETEs / multi-statement writes to use it.
- Restore audit logging across citations/court/admin/cases (68 missing `auditLog` call sites). Defer to a focused compliance PR; the Express source has the exact call signatures.
