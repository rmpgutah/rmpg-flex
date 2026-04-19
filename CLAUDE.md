# RMPG Flex — Claude Code Project Memory

## Project Overview

RMPG Flex is a **police CAD/RMS (Computer-Aided Dispatch / Records Management System)** for Rocky Mountain Protective Group, a private security / law enforcement company operating in Salt Lake City, Utah.

- **Domain**: https://rmpgutah.us
- **Production VPS**: root@194.113.64.90 (`/opt/rmpg-flex`)
- **Service**: `systemd` unit `rmpg-flex` (HTTPS on 443, HTTP redirect on 80)
- **Database**: SQLite via `better-sqlite3` at `server/data/rmpg-flex.db`
- **Timezone**: America/Denver (Mountain Time)
- **Version**: 5.8.0 (server, client, desktop, root)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18 + TypeScript + Vite 6 + Tailwind CSS |
| **Backend** | Express 5 + TypeScript (tsx runtime) + better-sqlite3 |
| **Auth** | JWT (access + refresh) + WebAuthn (FIDO2/YubiKey) + TOTP 2FA |
| **Real-time** | WebSocket (ws) for live dispatch, GPS, presence |
| **Maps** | Google Maps JS API + offline CartoDB dark_matter tiles + GeoJSON overlays |
| **Desktop** | Electron (macOS DMG + Windows EXE) with offline sync |
| **Mobile** | Capacitor (Android APK) |
| **PDF** | jsPDF for reports, citations, patrol logs |
| **Voice** | Edge TTS neural voice with radio audio processing |
| **Styling** | Spillman Flex / Motorola Solutions pure black theme — `#0a0a0a` base, `#d4a017` gold accent, zero blue |

## Architecture

```
client/           React SPA (Vite build → client/dist/)
  src/pages/      Page components (one per route)
  src/components/ Shared components (StatsCard, PanelTitleBar, CollapsibleSection, etc.)
  src/hooks/      Custom React hooks (useApi, useLiveSync, useDistrictLookup, etc.)
  src/utils/      Utility modules (PDF gen, maps, CAD parser, voice alerts, call protocols)
  public/         Static assets, service worker (sw.js), offline tiles, GeoJSON layers
server/           Express API server
  src/routes/     API route handlers (one file per domain)
  src/routes/dispatch/  Dispatch subsystem (calls, units, GPS, aggregates, districts)
  src/middleware/  Auth, rate-limiting, audit, security headers
  src/utils/      Server utilities (geocode, audit, TOTP, geofence, websocket)
  src/models/     Database setup + migrations (database.ts — all tables + addCol migrations)
  data/           SQLite database (PRODUCTION ONLY on VPS)
  certs/          SSL cert symlinks (PRODUCTION ONLY on VPS)
desktop/          Electron wrapper with offline sync, auto-update, IPC bridge
deploy/           Deployment scripts (deploy.sh, deploy-all.sh)
```

## Critical Rules

### NEVER modify or delete these production-only paths:
- `server/data/` — SQLite database (lives only on VPS)
- `server/certs/` — SSL certificate symlinks (lives only on VPS)
- `server/.env` — Production secrets (JWT_SECRET, etc.)
- `server/uploads/` — User-uploaded attachments

### Deploy Safety
- **Deploy command**: `bash deploy/deploy.sh` (code only) or `bash deploy/deploy.sh --all` (code + installers)
- Deploy script auto-detects project root via `$(dirname "$0")/..` — works from worktrees
- Both scripts exclude `server/data`, `server/certs`, `server/.env`, `server/uploads`
- After deploy, always verify: `curl -sf https://rmpgutah.us/api/health`
- **Always bump `CACHE_NAME` in `client/public/sw.js`** when deploying client changes
- SSL certs: Let's Encrypt symlinks `/etc/letsencrypt/live/rmpgutah.us/` → `server/certs/`

### Security
- TOTP secrets are AES-256-GCM encrypted using a key derived from `JWT_SECRET`
- If `JWT_SECRET` changes, all TOTP secrets become unrecoverable — users must re-enroll
- WebAuthn RP ID is `rmpgutah.us` — credentials are domain-bound
- All routes require JWT auth via `authenticateToken` middleware
- Role-based access: admin, manager, supervisor, officer, dispatcher, contract_manager, client_viewer, human_resources

## Code Patterns

### Express Route Pattern
```typescript
import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { auditLog } from '../utils/auditLogger';
import { broadcastDispatchUpdate } from '../utils/websocket';

const router = Router();
router.use(authenticateToken);

router.get('/', requireRole('admin', 'officer'), (req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM table WHERE ...').all();
  res.json(rows);
});

router.post('/', requireRole('admin'), (req: Request, res: Response) => {
  const db = getDb();
  // ... insert logic
  auditLog(req, 'CREATE', 'table_name', id, null, newData);
  broadcastDispatchUpdate({ action: 'entity_created', data: { ... } });
  res.json({ success: true, id });
});

export default router;
```

### React Page Pattern
Pages use Tailwind dark theme, `apiFetch` for API calls, WebSocket for live updates:
```tsx
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';

export default function SomePage() {
  const [data, setData] = useState([]);

  useEffect(() => {
    apiFetch<any[]>('/some-endpoint').then(setData).catch(console.error);
  }, []);

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="SECTION TITLE" icon={SomeIcon} />
      {/* Surface colors: bg-surface-base (#0a0a0a), bg-surface-raised (#141414), bg-surface-sunken (#050505) */}
      {/* Borders: border-[#222222], Gold accent: text-[#d4a017] */}
    </div>
  );
}
```

### Client-side PDF smoke tests (introduced 2026-04-18)
```typescript
// Pattern for catching regressions in the large v1 PDF generators (which
// lack structural test coverage). Smoke tests don't validate output
// correctness — they verify each public generator accepts minimum-viable
// data and completes without throwing. That's enough to catch the common
// regressions: missing null-checks on optional fields, broken imports
// after refactors, signature drift.

// In tests/setup stub fetch for admin-branding endpoint to avoid jsdom
// network calls. Stub once per beforeEach:
vi.stubGlobal('fetch', vi.fn(async (url: string) => {
  if (url.includes('/api/admin/config/branding')) {
    return new Response(JSON.stringify([]), { status: 200 });
  }
  return new Response('', { status: 404 });
}));

// Then exhaustively call each generator type with minimum-viable data:
it('generates a call PDF from minimal data', async () => {
  const doc = await generateRecordPdf('call', { call_number: 'X', incident_type: 'Y', priority: '3', status: 'CLEARED', description: '.' });
  expect(doc.getNumberOfPages()).toBeGreaterThan(0);
});
```
- Smoke test files live at `client/src/utils/__tests__/*.smoke.test.ts`
- Current coverage: `recordPdfGenerator.smoke.test.ts` (15 tests — all 9 RecordPdfType values + BOLO + WarrantSummary + setActiveOfficerSignature), `pdfGenerator.smoke.test.ts` (9 tests — all 8 PdfReportType values + populated-fields variant)
- **When touching the big v1 PDF files, the smoke suite is your safety net.** If you split a generator into a new module, a broken import will fail the smoke test before it reaches a user.
- jsdom prints `HTMLCanvasElement.getContext()` warnings — these are benign (jsPDF's fallbacks handle it).

### Structured Logging (pino — introduced 2026-04-18)
```typescript
// Server-side logging pattern — use the structured logger, not console.*
import { logger } from '../utils/logger';

logger.info('server started');                               // operational milestone
logger.warn({ err, scheduler: 'x' }, 'scheduler failed');    // recoverable issue
logger.error({ err }, 'database query failed');              // real error
logger.fatal({ err }, 'uncaught exception');                 // crash-path only

// Inside route handlers, prefer the per-request child logger (carries request ID):
router.get('/foo', (req, res) => {
  (req as any).log.info({ userId: req.user.id }, 'fetching foo');
  // ...
});
```
- **Structured over stringly-typed:** put variables in the object arg (`logger.info({ userId, ip }, 'msg')`), not in template strings. Pino indexes the JSON for search in production.
- **Errors go under `err`:** `logger.error({ err }, 'message')` lets pino's serializer capture stack traces. Don't do `logger.error(err, ...)` or `logger.error({ error: err }, ...)`.
- **Request IDs are automatic:** `httpLogger` middleware attaches `req.log` with a per-request ID, echoed back to clients via `X-Request-Id` response header. An `x-request-id` from nginx/upstream is honored if present.
- **Tainted strings still need `logSafe`:** any string derived from request body, query params, or scraper output should be wrapped in `logSafe(value)` before logging (CR/LF stripping, length cap). Pino alone doesn't prevent log injection.
- **Redaction:** `authorization`, `cookie`, `password*`, `token*`, `totp*` fields are auto-redacted at any nesting depth in the logger config.
- **Noisy routes ignored:** `/api/health`, `/assets/*`, `/tiles/*`, `/sw.js`, `/favicon.ico` skip per-request logging.
- **ASCII startup banner stays `console.log`** — one-shot decorative output, not machine-read.
- **Existing 2,300+ console.* calls are NOT yet migrated** — they'll migrate opportunistically as other work touches those files. Only index.ts + auth middleware + global error handler went live with the introduction (2026-04-18). New code must use `logger`.

### Icon-only buttons — use `<IconButton>` (introduced 2026-04-19)
```tsx
import IconButton from '../components/IconButton';

<IconButton onClick={handleDelete} aria-label={`Delete ${row.name}`} className="...">
  <Trash2 className="w-4 h-4" />
</IconButton>
```
- **Rule**: any `<button>` whose visible content is a lucide icon with no accompanying text must use `IconButton`. Buttons that already contain visible text (`<button><X /> Close</button>`) stay as plain `<button>` — the text labels them.
- `aria-label` is a **required TypeScript prop** — omitting it fails `tsc --noEmit` (the deploy gate). That is the enforcement; no ESLint a11y plugin is installed in `client/`.
- `type="button"` is applied automatically, and the child icon is wrapped with `aria-hidden="true"` — don't repeat those.
- Derive the label from (in order): existing `title` attribute, the `onClick` handler name, surrounding row context (include row identifiers: ``Delete ${warrant.number}``), or icon semantics (X→"Close"/"Remove", RefreshCw→"Refresh", Pencil→"Edit", Trash2→"Delete", Eye→"View", Plus→"Add").
- **Migrated 2026-04-19**: 146 buttons across 23 page files. `client/src/pages/dispatch/DispatchPage.tsx` (6,386 lines) is intentionally deferred — migrate as you touch surrounding code. A handful of other pages may still contain holdouts; fix opportunistically.

### Design System (Spillman Flex / Motorola Solutions — Pure Black Theme)
```
Surface colors: #0a0a0a (base), #141414 (raised), #050505 (sunken), #000000 (deep)
Brand gold:    #d4a017    Neutral gray: #888888 (replaced all blue)
Border:        #222222 (default), #1a1a1a (subtle), #2e2e2e (strong)
All radius:    2px (sharp CAD console corners — never rounded-lg)
Shadows:       Subtle only — depth via 3D beveled borders, not drop shadows
Panel headers: Gold text + dark chrome gradient (#1a1a1a → #242424)
LED indicators: Green/red/amber dots with box-shadow glow
Fonts:         System sans-serif for UI, monospace for data/readouts
Table headers: font-semibold 9px, py-[3px] — thin spreadsheet style
Table rows:    py-[2px], 11px — compact, no pill badges (plain colored text)
```

### WebSocket Broadcasts
```typescript
broadcastDispatchUpdate({ action: 'call_updated', call: updatedCall });
broadcastUnitUpdate({ action: 'unit_status', unit: updatedUnit });
```

### Offline-First Maps
- Google Maps JS API (dark styled via `DARK_MAP_STYLE`)
- CartoDB dark_matter tiles as offline fallback (`/tiles/{z}/{x}/{y}.png`)
- GeoJSON layers: beat.geojson (719 features), county.geojson, municipality.geojson, highway.geojson
- Service Worker (sw.js — bump `CACHE_NAME` version on every deploy) pre-caches tiles for Utah operational area
- Tile coverage: Utah state Z7-8, Wasatch Front Z9-11, SLC Metro Z12-14, SLC Core Z15

## Development

```bash
npm run dev              # Start both client (Vite :5173) and server (tsx :3001)
npm run build            # Build client only (Vite → client/dist/)
cd client && npx tsc --noEmit  # TypeScript typecheck (deploy script runs this)

# Server regression gates — now wired into 3-layer defense (as of 2026-04-18):
#   Layer 1: .husky/pre-push         — runs on every `git push` (local, fast)
#   Layer 2: .github/workflows/pr-tests.yml — runs on PR + push to main (CI)
#   Layer 3: deploy/deploy.sh        — runs before VPS rsync (self-heals missing node_modules)
# Manual invocations still available:
cd server && npx vitest run         # Full server suite — 461 tests across 39 files, ~3s (requires `npm install` in server/ first)
cd server && npm run check:routes   # Route-collision guard — 114 files, 0 duplicate METHOD+path handlers expected
cd server && npx tsc --noEmit       # 0 errors (fixed 2026-04-18 via paramStr() helper; now a hard gate in all 3 layers)

# Desktop builds
cd desktop && npm run build:all   # Build macOS DMG + Windows EXE
node desktop/scripts/copyToDownloads.cjs  # Copy to server/downloads/

# Deploy
bash deploy/deploy.sh             # Code only to VPS
bash deploy/deploy.sh --all       # Code + desktop installers to VPS

# Direct deploy (bypasses typecheck gate — used when deploy.sh fails):
cd client && npx vite build
rsync -az --delete client/dist/ root@194.113.64.90:/opt/rmpg-flex/client/dist/
rsync -az client/public/sw.js root@194.113.64.90:/opt/rmpg-flex/client/dist/sw.js
rsync -az --delete --exclude='node_modules' --exclude='data' --exclude='certs' --exclude='.env' --exclude='uploads' server/ root@194.113.64.90:/opt/rmpg-flex/server/
ssh root@194.113.64.90 "systemctl restart rmpg-flex"  # Only needed for server changes
curl -sf https://rmpgutah.us/api/health               # Verify
```

### Quick Status Check
```bash
curl -sf https://rmpgutah.us/api/health | python3 -m json.tool  # Server version + features
ssh root@194.113.64.90 "grep CACHE_NAME /opt/rmpg-flex/client/dist/sw.js"  # Deployed SW version
grep CACHE_NAME client/public/sw.js  # Local SW version
```

### Google Maps API Key
Set in `client/.env` as `VITE_GOOGLE_MAPS_API_KEY`

## Key Systems

### Dispatch Geography (4-tier Miller drilldown)
- `dispatch_areas` → `dispatch_sectors` → `dispatch_zones` → `dispatch_beats` (renamed from `dispatch_sections` in 2026-04-11 rebuild)
- `dispatch_codes` — 68 pre-seeded 10-codes + signal codes
- `premise_alerts` — persistent location-based warnings
- GeoJSON beat polygons with sector-colored labels on map
- API: `server/src/routes/dispatch/geography.ts` — CRUD for all 4 tiers + `/tree` (nested) + `/identify?lat&lng` (point lookup)
- UI: `client/src/pages/GeographyPage.tsx` — 4-column Miller drilldown (Areas 180px → Sectors 200px → Zones 240px → Beats 240px → Detail pane)
- Production runs legacy 5/46/166/427 classification; fresh DBs get the full 6/29/288/719 Utah GeoJSON seed (see Gotcha #41)

### Incident RMS (Spillman Flex)
- `incident_offenses` — UCR/NIBRS codes, statute linkage, suspect/victim mapping
- `incident_officers` — multi-officer tracking with roles and timestamps
- `incident_links` — cross-reference to calls, cases, warrants, citations, arrests
- Master Name Index: `/api/incidents/mni/search`, `/api/incidents/mni/person/:id`
- Full incident view: `/api/incidents/:id/full` (aggregated)

### Citations (Spillman Flex)
- `citation_violations` — multiple violations per citation, auto-summing fines
- 39 extended fields: traffic data, vehicle details, bond, court, disposition
- Batch operations: `/api/citations/batch/void`, `/api/citations/batch/status`

### Dispatch Console
- F-key hotkeys: F2=New, F3=Dispatch, F5=Enroute, F6=OnScene, F7=Clear, F8=CMD, F12=NCIC
- Status bar (fixed bottom): P1/P2 counts, unit metrics, F-key hints, clock
- CAD command line: 20+ commands including 10-code lookup, premise alerts
- Call type protocols: 70+ incident types with auto-priority/flags/backup rules
- Edge TTS voice (`en-US-JennyNeural`) with radio squelch beeps, bandpass EQ, pink noise static
- Call → Incident auto-links persons/vehicles from `call_persons`/`call_vehicles`

### Serve / Process Service
- `serve_queue` — 30+ columns: recipient info, document type, deadline, GPS, officer assignment
- `serve_attempts` — GPS-tracked service attempts with photo/signature capture
- `serve_routes` — optimized route planning with waypoints
- `serve_skip_traces` — skip trace results per serve job
- `serveQueueLinker.ts` — auto-creates serve jobs from PSO/process service dispatch calls
- API: `/api/process-server/*` (mounted via `serve.ts`)

### Skip Tracer V2
- `server/src/routes/skiptracer-v2/` — modular source adapter system
- 22 data sources: FBI Wanted, OFAC, NSOPW, Utah Courts, SLC Assessor, Arrests, etc.
- `BaseDataSource` — rate limiting, caching, retry, encrypted config
- API: `/api/skiptracer-v2/search`, `/api/skiptracer-v2/sources`

### HR Module
- `leave_requests` + `leave_balances` — leave management with approval workflow
- `disciplinary_records` — officer disciplinary tracking
- `performance_reviews` + `review_cycles` — review management
- `overtime_requests` — OT tracking
- `hr_pay_periods` + `hr_pay_rates` + `hr_payroll_entries` — full payroll pipeline
- API: `/api/hr/*`

### Fleet Management
- `fleet_vehicles` — vehicle tracking with `next_service_mileage`
- `fleet_maintenance`, `fleet_fuel_log`, `fleet_inspections`, `fleet_damage_reports`
- API: `/api/fleet/*`

### Arrests & Jail Roster
- `arrest_records` — manual entry, CSV import, JailBase scraper sync
- `arrest_cross_links` — link arrests to persons
- `jailRosterScraper.ts` — automated jail roster sync
- API: `/api/arrests/*`

### Case Management
- 8 junction tables: `case_persons`, `case_vehicles`, `case_incidents`, `case_calls`, `case_evidence`, `case_citations`, `case_warrants`, `case_properties`
- API: `/api/cases/*`

### Field Interviews
- `field_interviews` — FI contact cards with GPS, photos, person/vehicle links
- Auto-generates FI-YY-NNNNN numbers
- API: `/api/field-interviews` (CRUD, by-person, by-location radius, stats)

### Dispatch Messaging
- `dispatch_messages` — secure dispatcher-to-unit messaging
- Channels: dispatch, unit-to-unit, broadcast, BOLO
- WebSocket delivery for real-time
- API: `/api/dispatch-messages`

### Advanced Search
- **Compound Search**: `/api/records/compound-search` — NCIC-style multi-field (name wildcard, DOB range, physical description, address radius, plate, flags)
- **Universal Search**: `/api/records/universal-search` — one query across 9 record types
- **MNI Dossier**: `/api/records/persons/:id/dossier` — complete person intelligence package
- **Saved Searches**: `/api/records/saved-searches` — user preset CRUD

### Other Systems
- **Court Tracker**: `court_events` table, API `/api/court/*`
- **Forensic Lab**: `forensic_cases`, `forensic_exhibits`, `forensic_analyses`, API `/api/forensic-lab/*`
- **Trespass Orders**: `trespass_orders`, `trespass_violations`, API `/api/trespass-orders/*`
- **Use of Force**: `use_of_force` table for incident-linked UoF reports
- **Shift Plans**: `shift_plans`, `shift_swap_requests`
- **Notification Rules**: `notification_rules` for custom alert automation

## Common Gotchas

1. **JWT_SECRET must be permanent** — random-on-restart breaks TOTP decryption
2. **rsync --delete** in deploy — production-only dirs are excluded, don't remove those excludes
3. **Electron desktop app** is in `desktop/` with its own `package.json` and `node_modules`
4. **Large files** — DispatchPage.tsx (6,386 lines), MapPage.tsx (5,488 lines), dispatch calls.ts (2,185 lines)
5. **Service Worker versioning** — bump `CACHE_NAME` in `sw.js` when changing client assets
6. **Electron cache** — users must quit + clear `~/Library/Application Support/rmpg-flex-desktop/Cache` or press Cmd+Shift+R
7. **Auth middleware name** — it's `authenticateToken` not `authenticate`
8. **API fetch** — use `apiFetch()` from `hooks/useApi.ts`, not `useApi()` hook
9. **Database migrations** — all in `database.ts` using `addCol()` helper, lazy CREATE TABLE patterns
10. **Deploy from worktree** — `deploy.sh` auto-detects project root, works from any worktree
11. **CSS overrides** — global Spillman enforcement rules at end of `index.css` force 2px radius, navy backgrounds, subtle shadows
12. **nginx /downloads/** — proxied to Node.js (port 3001), not served as static files
13. **Dispatch layout** — DispatchPage uses `flex h-full` row layout. Never wrap in flex-col or add block children — use `position: fixed` for overlays
14. **Electron full cache clear** — `pkill -f "RMPG Flex"; sleep 1; rm -rf ~/Library/Application\ Support/rmpg-flex-desktop/{Cache,Service\ Worker,GPUCache,Code\ Cache}`
15. **Worktree deploys** — `deploy.sh` deploys whatever branch the worktree is on. Main branch is NOT updated. Merge worktree branch to main separately
16. **nginx on VPS** — config at `/etc/nginx/sites-enabled/rmpg-flex`. New top-level URL paths must proxy to Node (port 3001), not serve static
17. **Tailwind override pattern** — global Spillman enforcement at end of `index.css` uses `!important` to override utility classes (e.g., `.rounded-lg { border-radius: 2px !important; }`)
18. **PATH in Claude Code sessions** — `npx`/`node` may not be found. Prefix with `export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"`
19. **edge-tts-universal** — must use `Function('return import("edge-tts-universal")')()` to avoid tsx ESM resolver crash at startup. Lazy-loads on first TTS request.
20. **VPS npm install** — requires `--legacy-peer-deps` flag due to peer dependency conflicts
21. **Deploy typecheck gate** — `deploy.sh` runs both server and client `npx tsc --noEmit` as hard gates (as of 2026-04-18). Both ship with 0 TS errors; if either gate fails, fix the errors rather than reaching for the "Direct deploy" bypass above — bypassing hides real regressions. The Express 5 `req.params.X: string | string[]` noise (previously 52 tolerated errors) is now handled via the `paramStr()` / `paramNum()` helpers in `server/src/utils/reqHelpers.ts` — use those at the read site (e.g. `parseInt(paramStr(req.params.id), 10)`) rather than `as string` casts so the coercion is visible.
22. **Vite bundle splitting** — `vite.config.ts` has `manualChunks` for vendor-react, vendor-pdf, vendor-icons. Each gets 1-year immutable cache via nginx `/assets/` location block.
23. **nginx gzip** — configured in `/etc/nginx/conf.d/performance.conf` (level 6), NOT in nginx.conf (those lines are commented out). Don't uncomment nginx.conf gzip — it creates duplicates.
24. **calls_for_service columns** — 22+ columns added via addCol for PSO, tactical flags, timestamps. The redispatch INSERT has 74 columns — verify column count matches if modifying.
25. **incidents columns** — 17 boolean flags (mental_health_crisis, juvenile_involved, etc.) added via addCol. POST INSERT has 86 columns.
26. **serve_queue columns** — 20+ columns added via addCol beyond the 13 in CREATE TABLE. Code expects sm_job_id, recipient_*, document_type, etc.
27. **2FA login flow** — Server returns `step: 'setup_2fa'` for users without TOTP. Set `totp_exempt = 1` in users table to bypass. Rate limiter is in-memory — restart server to clear.
28. **Agent scan accuracy** — subagent INSERT column count reports are often wrong (miss NULL, literals, ternary expressions). Always verify with python3 counter script before acting on mismatch reports.
29. **persons table** — CREATE TABLE has 17 columns + 70 addCol migrations = 87 total. INSERT uses 81. This is correct — don't report as mismatch.
30. **callActions.ts route prefixes** — routes use `/calls/:id/...` prefix (NOT `/:id/...`). All dispatch sub-routers mount at `/` under `/api/dispatch`. Client calls `/dispatch/calls/:id/...`.
31. **Email iframe images** — use `srcdoc` + `sandbox="allow-same-origin allow-popups"` (NOT blob: URL). Blob origin blocks external image loading.
32. **PDF process_service crash** — all field values must be strings. Use `safeStr()` wrapper: `const safeStr = (v: any): string => (v == null) ? '' : String(v);`
33. **apiFetch prefix** — `apiFetch('/api/...')` works fine (doesn't double-prefix) because line 287 of useApi.ts checks `startsWith('/api')`. Both `/api/x` and `/x` are valid.
34. **Password reset** — `cd /opt/rmpg-flex/server && node -e "const bcrypt=require('bcryptjs'); const db=require('better-sqlite3')('data/rmpg-flex.db'); db.prepare('UPDATE users SET password_hash=? WHERE username=?').run(bcrypt.hashSync('NewPass!',12),'username'); db.close()"`
35. **VPS reboot recovery** — after VPS reboot, check `grep CACHE_NAME /opt/rmpg-flex/client/dist/sw.js` to verify deployed version. If stale, redeploy from worktree. Data in `server/data/` survives reboots.
36. **Dual CREATE TABLE in database.ts** — Some tables (e.g. `field_interviews`) have two `CREATE TABLE IF NOT EXISTS` blocks with different column names. The FIRST one wins on production. Phase 1 definitions (later in the file) are skipped. Always check which definition is actually active.
37. **Server rsync drops** — `rsync --delete server/` to VPS frequently drops SSH mid-transfer. Use `rsync -az server/src/ root@194.113.64.90:/opt/rmpg-flex/server/src/` (src only, no --delete) as the reliable fallback.
38. **Client-server field name audit** — When form saves fail silently (data missing after save), check that client form field names exactly match server INSERT column names. Known past mismatches: ForensicLab (`synopsis`→`description`, `incident_id`→`linked_incident_id`), FieldInterviews (`location`/`contact_reason`/`action_taken` vs Phase 1 aliases).
39. **npm `overrides` with `>=` is a footgun** — `"path-to-regexp": ">=0.1.13"` tells npm "any version ≥ 0.1.13", which resolves to the *highest* matching version (e.g. 8.x). Under Express 4 that broke boot with `TypeError: pathRegexp is not a function` in `express/lib/router/layer.js` because Express 4 required the 0.1.x function-default export. **Always use EXACT pins in `overrides`** (e.g. `"lodash": "4.17.21"`) unless you explicitly want a range. `server/package.json` currently pins only `dompurify` defensively — the `path-to-regexp: "0.1.13"` override was **removed in the Express 5 migration** (2026-04-10, commit 1c65343d) because Express 5's bundled router 2.x ships path-to-regexp 8.x with the DoS already patched upstream. **Do NOT re-add the path-to-regexp override** under Express 5; it will break the router at boot.
40. **`deploy.sh` uses `rsync -avz` WITHOUT `--delete`** (deliberate safety against wiping `server/data/` if an exclusion rule is wrong). Consequence: files you rename or delete locally stay on the VPS as zombies after a normal `bash deploy/deploy.sh`. After any file rename/deletion refactor, manually clean up on the VPS: `ssh root@194.113.64.90 'rm /opt/rmpg-flex/path/to/old-file'`. Verify the active router imports the new file first to confirm the zombie is truly dead. The "Direct deploy" block in the Development section DOES use `--delete` — use that only for `dist` and only when you've verified the file list.
41. **Geography seed is idempotent and only runs on empty tables** — `database.ts:~2956` calls `seedGeographyFromGeoJSON()` which bails if any of `dispatch_areas`/`dispatch_sectors`/`dispatch_zones`/`dispatch_beats` have rows. Fresh DBs get the full 6-area / 29-sector / 288-zone / 719-beat Utah GeoJSON seed. Production preserves its legacy 5/46/166/427 classification and 144 live FK references from `calls_for_service`/`incidents`/`citations`. A true production reseed needs a deliberate data migration with FK remap by `sector_code`/`zone_code`/`beat_code` strings, not a `DELETE FROM` + server restart.
42. **Security hook blocks the literal string `e``x``e``c(` in the Edit tool** — the tool-call hook treats any occurrence of that substring (without the backticks) as a potential `child_process` shell-execution call and rejects the edit, even inside better-sqlite3 code. For single-statement DDL in `server/src/models/database.ts`, use `db.prepare('CREATE TABLE IF NOT EXISTS ...').run()` instead of the better-sqlite3 bulk-execute shortcut method. Multi-statement DDL can be split into multiple `db.prepare().run()` calls or wrapped in `db.transaction(() => { ... })()`. The hook is defensive and works even when the substring appears inside documentation or comments, so you may need to split the word across backticks when writing about it.
43. **Parallel worktree deploys silently clobber each other** — `deploy.sh` deploys **whatever branch the caller's worktree is on**, not `main`, and uses `rsync` to push source files to `/opt/rmpg-flex/`. If two Claude sessions are running in different worktrees, the last one to run `deploy.sh` wins, regardless of which branch has the newer work. This happened 2026-04-17: session A deployed PR #198 (SW v229) at 10:58 UTC, session B from a different worktree on the old `d1e88c90` hotfix branch ran `deploy.sh` at 11:10 UTC and clobbered prod back to pre-fix Layout.tsx + CSS bundle (SW v244 — higher *number* but stale *source*). **A higher CACHE_NAME version on prod does not prove your code is live.** Always verify the specific fix reached the VPS by greping source files directly: `ssh root@194.113.64.90 "grep -c '<distinctive-string-from-your-fix>' /opt/rmpg-flex/<path>"`. If that returns the wrong count, pull main locally, bump CACHE_NAME above prod's current value, and redeploy from the main workspace (not any sub-worktree). A deploy-lock (e.g. touch `/tmp/rmpg-deploy.lock` at start of `deploy.sh` with a 10-min expiry) would prevent this, but is not currently implemented.
44. **Husky pre-push hook is silently bypassed in worktrees with a per-worktree `core.hooksPath` override** — Husky v9 sets `core.hooksPath=.husky/_` at the **repository** level (in `.git/config`), but `git worktree add` may write a **per-worktree** override at `.git/worktrees/<name>/config.worktree` pointing back at `.git/hooks`. The per-worktree value wins. Symptom: `git config core.hooksPath` returns `.git/hooks` (not `.husky/_`) and no `pre-push` fires on `git push`, so the full-suite gate added 2026-04-18 silently does nothing. Check with `git config --show-origin --get-all core.hooksPath` — if the `config.worktree` origin appears, fix with `git config --worktree --unset core.hooksPath` in that worktree. After fix, verify with `git hook run pre-push` (should print the husky hook's banner). This must be run **once per worktree** that was created before husky was installed. Worktrees created *after* husky's `prepare` has run inherit the repo-level config cleanly.
