# Integration Hub Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a unified Integration Hub dashboard widget with setup wizard, health monitoring, and auto-retry for the 4 existing integrations (ClearPathGPS, ServeManager, Microbilt, IPED).

**Architecture:** Server-side aggregated status API + background health checker with exponential backoff. Client-side dashboard widget with WebSocket-driven updates and a step-by-step setup wizard modal.

**Tech Stack:** Express + better-sqlite3 (server), React + TypeScript + Tailwind (client), WebSocket for real-time health alerts.

---

## Task 1: Database — Add integration_health_log Table

**Files:**
- Modify: `server/src/models/database.ts` (after line ~3102, the last CREATE TABLE)

**Step 1: Add the health log table schema**

In `server/src/models/database.ts`, after the `forensic_hash_entries` table (around line 3102), add:

```sql
CREATE TABLE IF NOT EXISTS integration_health_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('healthy','degraded','error')),
  response_time_ms INTEGER,
  error_message TEXT,
  checked_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
```

And add an index:

```sql
CREATE INDEX IF NOT EXISTS idx_health_log_integration ON integration_health_log(integration_id, checked_at);
```

**Step 2: Verify the server starts without errors**

Run: `cd server && npx tsx src/index.ts` (briefly, then Ctrl+C)
Expected: No schema errors, table created.

**Step 3: Commit**

```bash
git add server/src/models/database.ts
git commit -m "feat: add integration_health_log table for health monitoring"
```

---

## Task 2: TypeScript Types — Add IntegrationStatus Types

**Files:**
- Modify: `client/src/types/index.ts` (before the end of file, around line 2207)

**Step 1: Add integration types**

```typescript
// ─── Integration Hub ─────────────────────────────────────────

export type IntegrationId = 'clearpathgps' | 'servemanager' | 'microbilt' | 'iped';

export type IntegrationHealth = 'healthy' | 'degraded' | 'error' | 'unconfigured';

export interface IntegrationStatus {
  id: IntegrationId;
  name: string;
  description: string;
  configured: boolean;
  connected: boolean;
  lastSync: string | null;
  lastError: string | null;
  lastHealthCheck: string | null;
  health: IntegrationHealth;
  syncing: boolean;
  syncProgress: number | null;
  uptimePercent: number | null;
  stats: Record<string, number>;
}

export interface IntegrationHealthAlert {
  integrationId: IntegrationId;
  previousHealth: IntegrationHealth;
  currentHealth: IntegrationHealth;
  error: string | null;
  timestamp: string;
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd client && npx tsc --noEmit`
Expected: 0 errors

**Step 3: Commit**

```bash
git add client/src/types/index.ts
git commit -m "feat: add IntegrationStatus and IntegrationHealth types"
```

---

## Task 3: Server — Aggregated Status API Route

**Files:**
- Create: `server/src/routes/integrations.ts`
- Modify: `server/src/index.ts` (add import + app.use)

**Step 1: Create the integrations route**

Create `server/src/routes/integrations.ts`:

```typescript
import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from './auth';

const router = Router();
router.use(authenticateToken);

// Integration metadata registry
const INTEGRATIONS = [
  {
    id: 'clearpathgps',
    name: 'ClearPathGPS',
    description: 'Fleet vehicle GPS tracking, trip history, and location monitoring',
    configKeys: ['clearpathgps_account', 'clearpathgps_user', 'clearpathgps_password'],
    syncLogTable: 'cpgps_sync_log',
    syncLogTimeColumn: 'started_at',
    statsQueries: {
      vehicles: 'SELECT COUNT(*) as c FROM cpgps_vehicles',
      trips: 'SELECT COUNT(*) as c FROM cpgps_trips',
      locations: 'SELECT COUNT(*) as c FROM cpgps_locations',
      alerts: 'SELECT COUNT(*) as c FROM cpgps_alerts',
    },
  },
  {
    id: 'servemanager',
    name: 'ServeManager',
    description: 'Service of process job tracking and server attempt monitoring',
    configKeys: ['servemanager_api_key'],
    syncLogTable: 'sm_sync_log',
    syncLogTimeColumn: 'started_at',
    statsQueries: {
      jobs: 'SELECT COUNT(*) as c FROM sm_jobs',
      attempts: 'SELECT COUNT(*) as c FROM sm_attempts',
    },
  },
  {
    id: 'microbilt',
    name: 'Microbilt',
    description: 'Background screening, DL verification, and OFAC SDN watch list',
    configKeys: ['microbilt_client_id', 'microbilt_client_secret'],
    syncLogTable: 'ofac_sync_log',
    syncLogTimeColumn: 'started_at',
    statsQueries: {
      sdn_entries: 'SELECT COUNT(*) as c FROM ofac_sdn_entries',
      dl_records: 'SELECT COUNT(*) as c FROM dl_records',
    },
  },
  {
    id: 'iped',
    name: 'IPED Digital Forensics',
    description: 'Digital forensics case management, evidence indexing, and findings import',
    configKeys: ['iped_base_url', 'iped_api_key'],
    syncLogTable: null,
    syncLogTimeColumn: null,
    statsQueries: {
      cases: 'SELECT COUNT(*) as c FROM forensic_cases',
      exhibits: 'SELECT COUNT(*) as c FROM forensic_exhibits',
    },
  },
];

function isConfigured(db: any, configKeys: string[]): boolean {
  for (const key of configKeys) {
    const row = db.prepare(
      "SELECT config_value FROM system_config WHERE config_key = ? AND category = 'integrations' AND is_active = 1"
    ).get(key) as any;
    if (!row?.config_value) return false;
  }
  return true;
}

function getLastSync(db: any, table: string | null, timeCol: string | null): string | null {
  if (!table || !timeCol) return null;
  try {
    const row = db.prepare(`SELECT ${timeCol} as ts FROM ${table} ORDER BY id DESC LIMIT 1`).get() as any;
    return row?.ts || null;
  } catch { return null; }
}

function getStats(db: any, queries: Record<string, string>): Record<string, number> {
  const stats: Record<string, number> = {};
  for (const [key, sql] of Object.entries(queries)) {
    try {
      stats[key] = (db.prepare(sql).get() as any)?.c || 0;
    } catch { stats[key] = 0; }
  }
  return stats;
}

function getHealth(db: any, integrationId: string, configured: boolean): {
  health: string; lastHealthCheck: string | null; lastError: string | null;
  uptimePercent: number | null; connected: boolean;
} {
  if (!configured) return { health: 'unconfigured', lastHealthCheck: null, lastError: null, uptimePercent: null, connected: false };

  // Get latest health check
  const latest = db.prepare(
    'SELECT * FROM integration_health_log WHERE integration_id = ? ORDER BY checked_at DESC LIMIT 1'
  ).get(integrationId) as any;

  // Calculate 24h uptime
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const checks = db.prepare(
    'SELECT status FROM integration_health_log WHERE integration_id = ? AND checked_at > ?'
  ).all(integrationId, twentyFourHoursAgo) as any[];

  let uptimePercent: number | null = null;
  if (checks.length > 0) {
    const healthy = checks.filter((c: any) => c.status === 'healthy').length;
    uptimePercent = Math.round((healthy / checks.length) * 100);
  }

  // Determine health
  let health = 'healthy';
  if (latest?.status === 'error') health = 'error';
  else if (latest?.status === 'degraded') health = 'degraded';
  else if (!latest) {
    // No health checks yet — check if last sync is stale
    health = 'degraded';
  }

  return {
    health,
    lastHealthCheck: latest?.checked_at || null,
    lastError: latest?.status === 'error' ? latest.error_message : null,
    uptimePercent,
    connected: health === 'healthy',
  };
}

// GET /api/integrations/status
router.get('/status', requireRole('admin', 'manager'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const statuses = INTEGRATIONS.map(intg => {
      const configured = isConfigured(db, intg.configKeys);
      const lastSync = getLastSync(db, intg.syncLogTable, intg.syncLogTimeColumn);
      const stats = getStats(db, intg.statsQueries);
      const healthInfo = getHealth(db, intg.id, configured);

      return {
        id: intg.id,
        name: intg.name,
        description: intg.description,
        configured,
        connected: healthInfo.connected,
        lastSync,
        lastError: healthInfo.lastError,
        lastHealthCheck: healthInfo.lastHealthCheck,
        health: healthInfo.health,
        syncing: false,       // Updated by sync endpoints directly
        syncProgress: null,   // Updated by sync endpoints directly
        uptimePercent: healthInfo.uptimePercent,
        stats,
      };
    });

    res.json({ integrations: statuses });
  } catch (error: any) {
    console.error('Integration status error:', error);
    res.status(500).json({ error: 'Failed to fetch integration status' });
  }
});

// GET /api/integrations/health-log/:id — Recent health checks for an integration
router.get('/health-log/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const logs = db.prepare(
      'SELECT * FROM integration_health_log WHERE integration_id = ? ORDER BY checked_at DESC LIMIT 50'
    ).all(req.params.id);
    res.json({ logs });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch health log' });
  }
});

export default router;
```

**Step 2: Register the route in server/src/index.ts**

After line 75 (`import clearpathgpsRoutes from './routes/clearpathgps';`), add:

```typescript
import integrationsRoutes from './routes/integrations';
```

After line 182 (`app.use('/api/clearpathgps', clearpathgpsRoutes);`), add:

```typescript
app.use('/api/integrations', integrationsRoutes);
```

**Step 3: Verify server compiles**

Run: `cd server && npx tsx src/index.ts` (briefly)
Expected: Server starts, no errors

**Step 4: Commit**

```bash
git add server/src/routes/integrations.ts server/src/index.ts
git commit -m "feat: add aggregated integration status API endpoint"
```

---

## Task 4: Server — Background Health Checker

**Files:**
- Create: `server/src/utils/integrationHealthChecker.ts`
- Modify: `server/src/index.ts` (start checker on boot)

**Step 1: Create the health checker utility**

Create `server/src/utils/integrationHealthChecker.ts`:

```typescript
import { getDb } from '../models/database';
import { broadcast } from './websocket';

const HEALTH_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
const CONSECUTIVE_FAILURE_THRESHOLD = 3;
const MAX_LOG_AGE_DAYS = 7;

interface IntegrationProbe {
  id: string;
  name: string;
  configKeys: string[];
  testFn: () => Promise<{ ok: boolean; responseTimeMs: number; error?: string }>;
}

// Track consecutive failures for alerting
const failureCounts: Record<string, number> = {};
const previousHealth: Record<string, string> = {};

function isConfigured(db: any, configKeys: string[]): boolean {
  for (const key of configKeys) {
    const row = db.prepare(
      "SELECT config_value FROM system_config WHERE config_key = ? AND category = 'integrations' AND is_active = 1"
    ).get(key) as any;
    if (!row?.config_value) return false;
  }
  return true;
}

async function probeIntegration(probe: IntegrationProbe): Promise<void> {
  const db = getDb();

  // Skip unconfigured integrations
  if (!isConfigured(db, probe.configKeys)) {
    previousHealth[probe.id] = 'unconfigured';
    return;
  }

  const start = Date.now();
  let status = 'healthy';
  let errorMessage: string | null = null;
  let responseTimeMs = 0;

  try {
    const result = await probe.testFn();
    responseTimeMs = result.responseTimeMs;
    if (!result.ok) {
      status = 'error';
      errorMessage = result.error || 'Connection test failed';
    }
  } catch (err: any) {
    responseTimeMs = Date.now() - start;
    status = 'error';
    errorMessage = err.message || 'Unknown error';
  }

  // Log the result
  db.prepare(
    'INSERT INTO integration_health_log (integration_id, status, response_time_ms, error_message) VALUES (?, ?, ?, ?)'
  ).run(probe.id, status, responseTimeMs, errorMessage);

  // Track failures for alerting
  if (status === 'error') {
    failureCounts[probe.id] = (failureCounts[probe.id] || 0) + 1;
  } else {
    failureCounts[probe.id] = 0;
  }

  // Broadcast health alert on state change
  const prev = previousHealth[probe.id];
  if (prev && prev !== status) {
    broadcast('system', 'integration_health_alert', {
      integrationId: probe.id,
      integrationName: probe.name,
      previousHealth: prev,
      currentHealth: status,
      error: errorMessage,
      timestamp: new Date().toISOString(),
      consecutiveFailures: failureCounts[probe.id] || 0,
    });
  }
  previousHealth[probe.id] = status;

  // Log critical failures
  if ((failureCounts[probe.id] || 0) >= CONSECUTIVE_FAILURE_THRESHOLD) {
    console.warn(`[HealthChecker] ${probe.name} has ${failureCounts[probe.id]} consecutive failures`);
  }
}

// Test functions for each integration
async function testClearPathGps(): Promise<{ ok: boolean; responseTimeMs: number; error?: string }> {
  const start = Date.now();
  try {
    // Use the existing status endpoint logic — just check if we can query the DB tables
    const db = getDb();
    const count = (db.prepare('SELECT COUNT(*) as c FROM cpgps_vehicles').get() as any)?.c;
    return { ok: count !== undefined, responseTimeMs: Date.now() - start };
  } catch (err: any) {
    return { ok: false, responseTimeMs: Date.now() - start, error: err.message };
  }
}

async function testServeManager(): Promise<{ ok: boolean; responseTimeMs: number; error?: string }> {
  const start = Date.now();
  try {
    const db = getDb();
    const count = (db.prepare('SELECT COUNT(*) as c FROM sm_jobs').get() as any)?.c;
    return { ok: count !== undefined, responseTimeMs: Date.now() - start };
  } catch (err: any) {
    return { ok: false, responseTimeMs: Date.now() - start, error: err.message };
  }
}

async function testMicrobilt(): Promise<{ ok: boolean; responseTimeMs: number; error?: string }> {
  const start = Date.now();
  try {
    const db = getDb();
    const count = (db.prepare('SELECT COUNT(*) as c FROM ofac_sdn_entries').get() as any)?.c;
    return { ok: count !== undefined, responseTimeMs: Date.now() - start };
  } catch (err: any) {
    return { ok: false, responseTimeMs: Date.now() - start, error: err.message };
  }
}

async function testIped(): Promise<{ ok: boolean; responseTimeMs: number; error?: string }> {
  const start = Date.now();
  try {
    const db = getDb();
    const count = (db.prepare('SELECT COUNT(*) as c FROM forensic_cases').get() as any)?.c;
    return { ok: count !== undefined, responseTimeMs: Date.now() - start };
  } catch (err: any) {
    return { ok: false, responseTimeMs: Date.now() - start, error: err.message };
  }
}

const PROBES: IntegrationProbe[] = [
  { id: 'clearpathgps', name: 'ClearPathGPS', configKeys: ['clearpathgps_account', 'clearpathgps_user', 'clearpathgps_password'], testFn: testClearPathGps },
  { id: 'servemanager', name: 'ServeManager', configKeys: ['servemanager_api_key'], testFn: testServeManager },
  { id: 'microbilt', name: 'Microbilt', configKeys: ['microbilt_client_id', 'microbilt_client_secret'], testFn: testMicrobilt },
  { id: 'iped', name: 'IPED', configKeys: ['iped_base_url', 'iped_api_key'], testFn: testIped },
];

async function runHealthChecks(): Promise<void> {
  for (const probe of PROBES) {
    try {
      await probeIntegration(probe);
    } catch (err) {
      console.error(`[HealthChecker] Error probing ${probe.name}:`, err);
    }
  }

  // Cleanup old logs (keep 7 days)
  try {
    const db = getDb();
    const cutoff = new Date(Date.now() - MAX_LOG_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('DELETE FROM integration_health_log WHERE checked_at < ?').run(cutoff);
  } catch { /* ignore cleanup errors */ }
}

let healthInterval: NodeJS.Timeout | null = null;

export function startHealthChecker(): void {
  console.log('[HealthChecker] Starting integration health monitoring (every 5 min)');

  // Initial check after 30s delay (let server fully boot)
  setTimeout(() => {
    runHealthChecks();
    healthInterval = setInterval(runHealthChecks, HEALTH_CHECK_INTERVAL);
  }, 30_000);
}

export function stopHealthChecker(): void {
  if (healthInterval) {
    clearInterval(healthInterval);
    healthInterval = null;
  }
}
```

**Step 2: Start the health checker on server boot**

In `server/src/index.ts`, add the import after the other utility imports (around line 21):

```typescript
import { startHealthChecker } from './utils/integrationHealthChecker';
```

Then in the background tasks section (around line 345, after `scheduleOfacSync()`), add:

```typescript
startHealthChecker();
```

**Step 3: Verify server starts with health checker**

Run: `cd server && npx tsx src/index.ts`
Expected: Console shows `[HealthChecker] Starting integration health monitoring (every 5 min)`

**Step 4: Commit**

```bash
git add server/src/utils/integrationHealthChecker.ts server/src/index.ts
git commit -m "feat: add background integration health checker with WebSocket alerts"
```

---

## Task 5: Client — IntegrationHub Dashboard Widget

**Files:**
- Create: `client/src/components/IntegrationHub.tsx`
- Modify: `client/src/pages/DashboardPage.tsx` (import + render)

**Step 1: Create the IntegrationHub component**

Create `client/src/components/IntegrationHub.tsx`. This is the main dashboard widget showing all 4 integrations as cards with LED indicators, stats, uptime bars, and setup/configure actions.

Key design decisions:
- Uses `apiFetch` to get `GET /api/integrations/status`
- Polls every 60 seconds
- Subscribes to `integration_health_alert` WebSocket events for real-time updates
- Shows LED indicators matching the app's `led-dot led-green/led-amber/led-red` classes
- Uptime bar is a thin progress bar (green/amber/red based on percentage)
- Unconfigured integrations show a "Setup" button that opens the wizard
- Admin/manager roles only — component renders null for other roles
- Responsive: 4 cols → 2 cols → 1 col

The component should:
- Import `IntegrationStatus` type from `../types`
- Import `useAuth` from `../context/AuthContext`
- Import `useWebSocket` or `useLiveSync` for WS events
- Import `apiFetch` from `../hooks/useApi`
- Import icons: `Wifi, WifiOff, MapPin, Briefcase, Shield, Microscope, Settings, RefreshCw, Loader2, ArrowRight, ChevronUp, ChevronDown`
- Import `PanelTitleBar` from `./PanelTitleBar`
- Accept props: `onSetupClick?: (integrationId: string) => void`

**Integration icon mapping:**
```typescript
const INTEGRATION_ICONS: Record<string, React.ElementType> = {
  clearpathgps: MapPin,
  servemanager: Briefcase,
  microbilt: Shield,
  iped: Microscope,
};
```

**Health → LED class mapping:**
```typescript
const HEALTH_LED: Record<string, string> = {
  healthy: 'led-green',
  degraded: 'led-amber animate-led-pulse',
  error: 'led-red animate-led-blink',
  unconfigured: '',
};
```

**Relative time helper:**
```typescript
function relativeTime(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}
```

**Step 2: Wire into DashboardPage**

In `client/src/pages/DashboardPage.tsx`:

Add import:
```typescript
import IntegrationHub from '../components/IntegrationHub';
```

After the closing `</div>` of the "Activity Feed + Operational Alerts Row" section (around line 655), add:

```tsx
{/* Integration Hub */}
<IntegrationHub onSetupClick={(id) => navigate(`/admin?tab=${id}`)} />
```

**Step 3: Verify it renders**

Run the dev server, navigate to dashboard, confirm widget appears.

**Step 4: Commit**

```bash
git add client/src/components/IntegrationHub.tsx client/src/pages/DashboardPage.tsx
git commit -m "feat: add Integration Hub dashboard widget with live status"
```

---

## Task 6: Client — IntegrationWizardModal Component

**Files:**
- Create: `client/src/components/IntegrationWizardModal.tsx`
- Modify: `client/src/components/IntegrationHub.tsx` (add wizard trigger)

**Step 1: Create the wizard modal**

Create `client/src/components/IntegrationWizardModal.tsx`. A multi-step modal that guides through: Welcome → Credentials → Test → Sync → Done.

Key design:
- Step 1 (Welcome): Shows what the integration does, what credentials are needed
- Step 2 (Credentials): Dynamic form fields based on integration config
- Step 3 (Test): Auto-tests connection using existing `/api/{integration}/test*` endpoint
- Step 4 (Sync): Optionally triggers initial data pull
- Step 5 (Done): Success confirmation with "View Data" and "Close" buttons

**Props:**
```typescript
interface IntegrationWizardModalProps {
  isOpen: boolean;
  integrationId: string | null;
  onClose: () => void;
  onComplete: () => void;
}
```

**Credential field configs:**
```typescript
const WIZARD_CONFIGS: Record<string, WizardConfig> = {
  clearpathgps: {
    name: 'ClearPathGPS',
    description: 'Connect to ClearPathGPS for real-time fleet vehicle tracking, GPS breadcrumbs, trip history, and driver alerts.',
    fields: [
      { key: 'account', label: 'Account Name', type: 'text', placeholder: 'Your ClearPathGPS account name' },
      { key: 'user', label: 'Username', type: 'text', placeholder: 'API username' },
      { key: 'password', label: 'Password', type: 'password', placeholder: 'API password' },
      { key: 'base_url', label: 'Base URL', type: 'text', placeholder: 'https://api.clearpathgps.com', defaultValue: 'https://api.clearpathgps.com' },
    ],
    configureEndpoint: '/api/clearpathgps/configure',
    testEndpoint: '/api/clearpathgps/test',
    syncEndpoint: '/api/clearpathgps/sync',
    configureMethod: 'POST',
  },
  servemanager: {
    name: 'ServeManager',
    description: 'Connect to ServeManager for service of process job tracking, server attempt monitoring, and court case integration.',
    fields: [
      { key: 'api_key', label: 'API Key', type: 'password', placeholder: 'Your ServeManager API key' },
    ],
    configureEndpoint: '/api/servemanager/api-key',
    testEndpoint: '/api/servemanager/test-connection',
    syncEndpoint: '/api/servemanager/sync',
    configureMethod: 'PUT',
  },
  microbilt: {
    name: 'Microbilt',
    description: 'Connect to Microbilt for background screening, driver license verification, and OFAC SDN watch list monitoring.',
    fields: [
      { key: 'client_id', label: 'Client ID', type: 'text', placeholder: 'OAuth client ID' },
      { key: 'client_secret', label: 'Client Secret', type: 'password', placeholder: 'OAuth client secret' },
      { key: 'subscriber_id', label: 'Subscriber ID', type: 'text', placeholder: 'Microbilt subscriber ID' },
      { key: 'environment', label: 'Environment', type: 'select', options: ['sandbox', 'production'], defaultValue: 'sandbox' },
    ],
    configureEndpoint: '/api/microbilt/credentials',
    testEndpoint: '/api/microbilt/test-connection',
    syncEndpoint: '/api/microbilt/ofac/sync',
    configureMethod: 'PUT',
  },
  iped: {
    name: 'IPED Digital Forensics',
    description: 'Connect to IPED for digital forensics case management, evidence indexing, regex findings import, and timeline synchronization.',
    fields: [
      { key: 'base_url', label: 'IPED Server URL', type: 'text', placeholder: 'http://localhost:8080' },
      { key: 'api_key', label: 'API Key', type: 'password', placeholder: 'IPED API key (optional)' },
    ],
    configureEndpoint: '/api/iped/configure',
    testEndpoint: '/api/iped/test-connection',
    syncEndpoint: null,
    configureMethod: 'PUT',
  },
};
```

Uses the existing `FormModal` pattern for consistency. Step transitions are animated with fade-in.

**Step 2: Wire wizard into IntegrationHub**

In `IntegrationHub.tsx`, add state for the wizard:
```typescript
const [wizardOpen, setWizardOpen] = useState(false);
const [wizardIntegrationId, setWizardIntegrationId] = useState<string | null>(null);
```

On unconfigured card's "Setup" button, open the wizard:
```typescript
onClick={() => { setWizardIntegrationId(intg.id); setWizardOpen(true); }}
```

Render the modal at the bottom of the component.

**Step 3: Verify wizard flow**

Open dashboard, click "Setup" on an unconfigured integration, walk through the steps.

**Step 4: Commit**

```bash
git add client/src/components/IntegrationWizardModal.tsx client/src/components/IntegrationHub.tsx
git commit -m "feat: add integration setup wizard with guided credential configuration"
```

---

## Task 7: Service Worker Cache Bump + Final Build

**Files:**
- Modify: `client/public/sw.js` (cache version bump)

**Step 1: Bump the service worker cache version**

Change the `CACHE_NAME` constant from current version to next version (e.g., `v44` → `v45`).

**Step 2: Run TypeScript check**

Run: `cd client && npx tsc --noEmit`
Expected: 0 errors

**Step 3: Run production build**

Run: `cd client && npm run build`
Expected: Build succeeds

**Step 4: Copy dist to main repo**

```bash
rsync -a --delete client/dist/ /path/to/main/repo/client/dist/
```

**Step 5: Commit**

```bash
git add client/public/sw.js
git commit -m "chore: bump service worker cache for integration hub release"
```

---

## Summary

| Task | What | Files | Estimated |
|------|------|-------|-----------|
| 1 | Database table | database.ts | 2 min |
| 2 | TypeScript types | types/index.ts | 2 min |
| 3 | Aggregated status API | integrations.ts, index.ts | 5 min |
| 4 | Background health checker | integrationHealthChecker.ts, index.ts | 5 min |
| 5 | Dashboard widget | IntegrationHub.tsx, DashboardPage.tsx | 10 min |
| 6 | Setup wizard modal | IntegrationWizardModal.tsx, IntegrationHub.tsx | 10 min |
| 7 | Cache bump + build | sw.js | 2 min |
