# RMPG Flex — Claude Code Project Memory

## Project Overview

RMPG Flex is a **police CAD/RMS (Computer-Aided Dispatch / Records Management System)** for Rocky Mountain Protective Group, a private security / law enforcement company operating in Salt Lake City, Utah.

- **Domain**: https://rmpgutah.us
- **Production VPS**: root@194.113.64.90 (`/opt/rmpg-flex`)
- **Service**: `systemd` unit `rmpg-flex` (HTTPS on 443, HTTP redirect on 80)
- **Database**: SQLite via `better-sqlite3` at `server/data/rmpg-flex.db`
- **Timezone**: America/Denver (Mountain Time)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18 + TypeScript + Vite 6 + Tailwind CSS |
| **Backend** | Express 4 + TypeScript (tsx runtime) + better-sqlite3 |
| **Auth** | JWT (access + refresh) + WebAuthn (FIDO2/YubiKey) + TOTP 2FA |
| **Real-time** | WebSocket (ws) for live dispatch, GPS, presence |
| **Maps** | Google Maps JS API + offline CartoDB dark_matter tiles |
| **Desktop** | Electron (macOS DMG + Windows EXE) with offline sync |
| **Mobile** | Capacitor (Android APK) |
| **PDF** | jsPDF for reports, citations, patrol logs |
| **Styling** | Dark theme throughout — `#0a0a0a` background, JetBrains Mono font |

## Architecture

```
client/           React SPA (Vite build → client/dist/)
  src/pages/      Page components (one per route)
  src/components/ Shared components
  src/hooks/      Custom React hooks
  src/utils/      Utility modules (PDF gen, maps, CAD parser)
  public/         Static assets, service worker, offline tiles
server/           Express API server
  src/routes/     API route handlers (one file per domain)
  src/middleware/  Auth, rate-limiting, audit middleware
  src/utils/      Server utilities (geocode, audit, TOTP)
  src/models/     Database setup
  data/           SQLite database (PRODUCTION ONLY on VPS)
  certs/          SSL cert symlinks (PRODUCTION ONLY on VPS)
desktop/          Electron wrapper with offline sync
deploy/           Deployment scripts
scripts/          Dev tooling (tile downloader, version bump)
```

## Critical Rules

### NEVER modify or delete these production-only paths:
- `server/data/` — SQLite database (lives only on VPS)
- `server/certs/` — SSL certificate symlinks (lives only on VPS)
- `server/.env` — Production secrets (JWT_SECRET, etc.)
- `server/uploads/` — User-uploaded attachments

### Deploy Safety
- **Deploy command**: `bash deploy/deploy.sh` (code) or `bash deploy/deploy-all.sh` (full release)
- Both scripts exclude `server/data`, `server/certs`, `server/.env`, `server/uploads`
- `deploy-all.sh` uses `--delete` flag — excluded paths are protected
- After deploy, always verify: `curl -sf https://rmpgutah.us/api/health`
- SSL certs are Let's Encrypt symlinks: `/etc/letsencrypt/live/rmpgutah.us/` → `server/certs/`
- If SSL breaks: `ssh root@194.113.64.90` then recreate symlinks in `server/certs/`

### Security
- TOTP secrets are AES-256-GCM encrypted using a key derived from `JWT_SECRET`
- If `JWT_SECRET` changes, all TOTP secrets become unrecoverable — users must re-enroll
- WebAuthn RP ID is `rmpgutah.us` — credentials are domain-bound
- All routes require JWT auth via `authenticate` middleware
- Role-based access: admin, manager, supervisor, officer, dispatcher, contract_manager

## Code Patterns

### Express Route Pattern
Every route file in `server/src/routes/` follows this pattern:
```typescript
import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import db from '../models/database';
import { auditLog } from '../utils/auditLogger';
import { broadcast } from '../utils/websocket';

const router = Router();
router.use(authenticate);

router.get('/', requireRole(['admin', 'officer']), (req, res) => {
  const rows = db.prepare('SELECT * FROM table WHERE ...').all();
  res.json(rows);
});

router.post('/', requireRole(['admin']), (req, res) => {
  // ... insert logic
  auditLog(req, 'CREATE', 'table_name', id, null, newData);
  broadcast('entity:created', { ... });
  res.json({ success: true, id });
});

export default router;
```

### React Page Pattern
Pages use Tailwind dark theme, fetch via `useApi` hook, WebSocket for live updates:
```tsx
export default function SomePage() {
  const api = useApi();
  const [data, setData] = useState([]);

  useEffect(() => {
    api.get('/api/endpoint').then(res => res.ok && res.json()).then(setData);
  }, []);

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-lg font-bold text-white">Title</h1>
      {/* Dark theme: bg-[#0a0a0a], borders #1a1a1a, text-white */}
    </div>
  );
}
```

### WebSocket Broadcasts
When data changes, broadcast to all connected clients for real-time sync:
```typescript
broadcast('calls:updated', updatedCall);     // Dispatch updates
broadcast('units:status', { call_sign, status }); // Unit status
broadcast('gps:update', { call_sign, lat, lng }); // GPS tracking
```

### Offline-First Maps
- Google Maps is the primary map provider (dark styled)
- CartoDB dark_matter tiles (`/tiles/{z}/{x}/{y}.png`) render beneath Google tiles
- When Google tiles fail (vehicle WiFi dead zones), offline tiles show through
- Service Worker (sw.js v45) pre-caches tiles in background after activation
- Tile coverage: Utah state Z7-8, Wasatch Front Z9-11, SLC Metro Z12-14, SLC Core Z15

## Development

```bash
npm run dev              # Start both client (Vite :5173) and server (tsx :3001)
npm run build            # Build client only (Vite → client/dist/)
npm run deploy           # Build + deploy to VPS
npm run deploy:all       # Full release (desktop + Android + web + deploy)
```

### Google Maps API Key
`AIzaSyCfKRUuJkUFlfuc9FvjJiVpm6_p5kASCtM` — set in client `.env` as `VITE_GOOGLE_MAPS_API_KEY`

## Common Gotchas

1. **JWT_SECRET must be permanent** — random-on-restart breaks TOTP decryption
2. **rsync --delete** in deploy-all.sh — production-only dirs are excluded, don't remove those excludes
3. **Electron desktop app** is in `desktop/` with its own `package.json` and `node_modules`
4. **Large files** — DispatchPage.tsx (2,788 lines), MapPage.tsx (3,047 lines), dispatch.ts route (2,738 lines) — be careful with full rewrites
5. **Service Worker versioning** — bump `CACHE_NAME` in `sw.js` when changing cached assets
6. **Google Maps dark style** — uses custom `DARK_MAP_STYLE` from `googleMapsLoader.ts`, not a built-in style
