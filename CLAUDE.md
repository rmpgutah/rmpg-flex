# RMPG Flex — Claude Code Project Memory

## Project Overview

RMPG Flex is a **police CAD/RMS (Computer-Aided Dispatch / Records Management System)** for Rocky Mountain Protective Group, a private security / law enforcement company operating in Salt Lake City, Utah.

- **Domain**: https://rmpgutah.us
- **Production VPS**: root@194.113.64.90 (`/opt/rmpg-flex`)
- **Service**: `systemd` unit `rmpg-flex` (HTTPS on 443, HTTP redirect on 80)
- **Database**: SQLite via `better-sqlite3` at `server/data/rmpg-flex.db`
- **Timezone**: America/Denver (Mountain Time)
- **Version**: 5.7.0

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18 + TypeScript + Vite 6 + Tailwind CSS |
| **Backend** | Express 4 + TypeScript (tsx runtime) + better-sqlite3 |
| **Auth** | JWT (access + refresh) + WebAuthn (FIDO2/YubiKey) + TOTP 2FA |
| **Real-time** | WebSocket (ws) for live dispatch, GPS, presence |
| **Maps** | Google Maps JS API + offline CartoDB dark_matter tiles + GeoJSON overlays |
| **Desktop** | Electron (macOS DMG + Windows EXE) with offline sync |
| **Mobile** | Capacitor (Android APK) |
| **PDF** | jsPDF for reports, citations, patrol logs |
| **Voice** | Edge TTS neural voice with radio audio processing |
| **Styling** | Spillman Flex / Motorola Solutions dark theme — `#0a0a0a` pure black base, `#d4a017` gold accent |

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
      {/* Surface colors: bg-surface-base, bg-surface-raised, bg-surface-sunken */}
      {/* Borders: border-[#222222], Gold accent: text-[#d4a017] */}
    </div>
  );
}
```

### Design System (Spillman Flex / Motorola Solutions — Pure Black)
```
Surface colors: #0a0a0a (base), #141414 (raised), #050505 (sunken)
Brand gray:    #888888    Brand gold: #d4a017
Border:        #222222 (default), #2e2e2e (strong)
All radius:    2px (sharp CAD console corners — never rounded-lg)
Shadows:       Subtle only — depth via 3D beveled borders, not drop shadows
Panel headers: Gold text + dark gradient background
LED indicators: Green/red/amber dots with box-shadow glow
Fonts:         System sans-serif for UI, JetBrains Mono for data/readouts
CSS variables: --surface-base, --surface-raised, --brand-blue (now gray), --border-default
Tailwind blue palette: Overridden to grayscale (text-blue-500 renders gray)
CSS utility classes: .panel-base, .panel-raised, .panel-sunken (map to CSS vars)
Input classes: .input-dark, .select-dark, .textarea-dark (blocky Motorola-style)
```

### WebSocket Broadcasts
```typescript
broadcastDispatchUpdate({ action: 'call_updated', call: updatedCall });
broadcastUnitUpdate({ action: 'unit_status', unit: updatedUnit });
```

### Offline-First Maps
- Google Maps JS API (dark styled via `DARK_MAP_STYLE`)
- CartoDB dark_matter tiles as offline fallback (`/tiles/{z}/{x}/{y}.png`)
- GeoJSON layers: beat.geojson (719 features), county, municipality, highway, state_boundary, place
- Service Worker (sw.js v150) pre-caches tiles for Utah operational area
- Tile coverage: Utah state Z7-8, Wasatch Front Z9-11, SLC Metro Z12-14, SLC Core Z15

## Development

```bash
npm run dev              # Start both client (Vite :5173) and server (tsx :3001)
npm run build            # Build client only (Vite → client/dist/)
cd client && npx vite build       # Build client (used by deploy)
cd server && npx vitest run       # Run server tests (43 tests)
cd client && npx tsc --noEmit     # TypeScript typecheck (should pass with 0 errors)

# Desktop builds
cd desktop && npm run build:all   # Build macOS DMG + Windows EXE
node desktop/scripts/copyToDownloads.cjs  # Copy to server/downloads/

# Deploy
bash deploy/deploy.sh             # Code only to VPS (runs typecheck + tests + build + rsync)
bash deploy/deploy.sh --all       # Code + desktop installers to VPS
```

**Note**: TypeScript strict check passes with 0 errors as of v5.7.0. Vite build is the deploy gate.

### Google Maps API Key
Set in `client/.env` as `VITE_GOOGLE_MAPS_API_KEY`

## Key Systems

### Dispatch Geography (3-tier)
- `dispatch_districts` table — stores section_id, zone_id, beat_id, dispatch_code, names
- Geofence: `server/src/utils/geofence.ts` — point-in-polygon beat identification from GPS
- `findNearestBeat()` fallback within 1.25 miles when exact polygon miss
- GeoJSON beat polygons (719 features) with section-colored labels on map
- API: `/api/dispatch/districts` (list), `/api/dispatch/districts/identify?lat=&lng=` (GPS lookup)

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
- Edge TTS voice with radio squelch beeps, bandpass EQ, pink noise static

### CRM (OVERWATCH)
- `crm_leads`, `crm_proposals`, `crm_tasks`, `crm_payments`, `crm_proposal_versions`
- Pipeline funnel, revenue trends, invoice aging, recurring billing
- API: `/api/crm/*`, `/api/crm-leads/*`, `/api/crm-proposals/*`
- Page: `CrmPage.tsx` with ProposalsTab, LeadsTab, dashboard

### HR & Personnel
- `hr_disciplinary`, `hr_performance_reviews`, `hr_pay_periods`, `leave_requests`, `overtime_requests`
- Time & attendance with date range, batch clock-in, edit history
- API: `/api/hr/*`, `/api/personnel/*`
- Page: `pages/hr/HrPage.tsx` (directory-based with tabs)

### Forensics Lab (IPED)
- Digital forensics case management, exhibits, chain of custody
- IPED integration for hash set analysis
- API: `/api/forensics/*`, `/api/iped/*`
- Page: `ForensicLabPage.tsx`

### Court Tracker
- Court events, subpoenas, continuances, outcome recording
- API: `/api/court/*`
- Page: `CourtTrackerPage.tsx`

### Warrant Intelligence
- Utah warrant scraper with IP-block detection, adaptive rate limiting
- Universal warrant scanner (auto-checks persons linked to calls)
- Dashboard with severity badges, scan feed, link-to-call
- API: `/api/warrants/*` (dashboard/stats, dashboard/feed, unified)
- Page: `WarrantsPage.tsx` with dashboard, warrants, watch_hits, person intel tabs

### Offline Mode
- Browser: IndexedDB (`rmpg-flex-offline`) + service worker + connectivity monitor
- Desktop: SQLite (`rmpg-local.db`) + IPC bridge + sync manager
- 24-hour PIN system for offline write authorization (HMAC-SHA256 deterministic PINs)
- Sync engine: pull every 10s-10min per table, push queue batched 20 items
- Offline-capable endpoints: calls, units, GPS, incidents, persons, vehicles, citations, evidence, time entries
- Files: `client/src/services/offline*.ts`, `desktop/localDb.js`, `server/src/routes/offline.ts`

### Email (Microsoft 365)
- OAuth2 integration with Microsoft Graph API
- Inbox, compose, reply, attachments, scheduled send
- Email images: `sandbox="allow-same-origin"` on iframe, CSP allows `https:` images
- Image proxy: `GET /api/email/image-proxy?url=` for CDNs that block iframe requests
- Files: `server/src/routes/email.ts`, `client/src/pages/EmailPage.tsx`

### National Warrant Search
- 50-state warrant source coverage (FBI API + state/county sheriff pages)
- 5 custom parsers: FBI JSON API, Washoe NV, Pima AZ, Denver CO, Flathead MT
- Generic HTML fallback parser for unknown sources
- Circuit breaker with exponential backoff (1h → 24h)
- Page: `NationalWarrantSearchPage.tsx` with US coverage map
- API: `/api/warrants/national-search`, `/api/warrants/national-coverage`

### Process Service (Serve)
- Intake portal for client document uploads
- Affidavit of Service / Non-Service PDF generation
- Route optimization for serve attempts
- Files: `server/src/routes/serve.ts`, `server/src/routes/serveIntake.ts`

### CI / GitHub Actions
- Self-hosted runner on VPS (194.113.64.90) — systemd service `actions.runner.*.rmpg-vps`
- Workflow: `.github/workflows/codeql.yml` — TypeScript check + npm audit + Vite build
- Requires GitHub Team plan ($4/mo) for private repo Actions — currently blocked on Free plan

### Integration Hub
- Integration health monitoring with WebSocket alerts
- ClearPathGPS v3 API, weather auto-fill, body/dash cameras
- API: `/api/clearpathgps/*`, `/api/dashcam-videos/*`

## Common Gotchas

1. **JWT_SECRET must be permanent** — random-on-restart breaks TOTP decryption
2. **rsync --delete** in deploy — production-only dirs are excluded, don't remove those excludes
3. **Electron desktop app** is in `desktop/` with its own `package.json` and `node_modules`
4. **Large files** — DispatchPage.tsx (~6,400 lines), MapPage.tsx (~5,500 lines), dispatch calls.ts (~2,200 lines)
5. **Service Worker versioning** — bump `CACHE_NAME` in `sw.js` when changing client assets
6. **Electron cache** — users must quit + clear `~/Library/Application Support/rmpg-flex-desktop/Cache` or press Cmd+Shift+R
7. **Auth middleware name** — it's `authenticateToken` not `authenticate`
8. **API fetch** — use `apiFetch()` from `hooks/useApi.ts`, not `useApi()` hook
9. **Database migrations** — all in `database.ts` using `addCol()` helper, lazy CREATE TABLE patterns
10. **Deploy from worktree** — `deploy.sh` auto-detects project root, works from any worktree
11. **CSS overrides** — global Spillman enforcement rules at end of `index.css` force 2px radius, black backgrounds, subtle shadows
12. **nginx /downloads/** — proxied to Node.js (port 3001), not served as static files
13. **Dispatch layout** — DispatchPage uses `flex h-full` row layout. Never wrap in flex-col or add block children — use `position: fixed` for overlays
14. **Electron full cache clear** — `pkill -f "RMPG Flex"; sleep 1; rm -rf ~/Library/Application\ Support/rmpg-flex-desktop/{Cache,Service\ Worker,GPUCache,Code\ Cache}`
15. **Worktree deploys** — `deploy.sh` deploys whatever branch the worktree is on. Main branch is NOT updated. Merge worktree branch to main separately
16. **nginx on VPS** — config at `/etc/nginx/sites-enabled/rmpg-flex`. New top-level URL paths must proxy to Node (port 3001), not serve static
17. **Tailwind override pattern** — global Spillman enforcement at end of `index.css` uses `!important` to override utility classes (e.g., `.rounded-lg { border-radius: 2px !important; }`)
18. **PATH in Claude Code sessions** — `npx`/`node` may not be found. Prefix with `export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"`
19. **Worktree file paths** — when operating in a worktree, ALL edits must use the worktree path (`.claude/worktrees/<name>/`), not the main repo path. Edits to the main repo path are invisible to the worktree and will be lost
20. **Blue is dead** — Tailwind's entire `blue` palette is overridden to grayscale in `tailwind.config.js`. Any `text-blue-*`, `bg-blue-*`, `border-blue-*` renders gray. Use CSS variables (`var(--brand-blue)`) or the custom `rmpg-*` / `brand-*` Tailwind classes instead
21. **Multer must stay on 1.x** — multer 2.0 has an incompatible API (removes `diskStorage()`, `memoryStorage()`, `upload.single()` pattern). 8 route files use 1.x API. Dependabot multer alerts cannot be auto-fixed
22. **Panel CSS classes** — use `.panel-raised`, `.panel-sunken`, `.panel-base` for surface backgrounds. These are defined in `index.css` and map to CSS variables. Without them, elements render with no background (white)
