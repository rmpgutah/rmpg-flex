# Integration Hub Design

**Date:** 2026-03-21
**Status:** Approved
**Scope:** Dashboard widget + setup wizard + health monitoring for existing 4 integrations

## Problem

The 4 integrations (ClearPathGPS, ServeManager, Microbilt, IPED) each live in separate admin tabs with no unified view. Users can't see integration health at a glance, there's no guided setup flow, and failures are silent until someone manually checks.

## Solution

### 1. Aggregated Status API

**Endpoint:** `GET /api/integrations/status`
**Auth:** admin, manager roles
**File:** `server/src/routes/integrations.ts`

```typescript
interface IntegrationStatus {
  id: string;                     // 'clearpathgps' | 'servemanager' | 'microbilt' | 'iped'
  name: string;
  configured: boolean;
  connected: boolean;
  lastSync: string | null;
  lastError: string | null;
  lastHealthCheck: string | null;
  health: 'healthy' | 'degraded' | 'error' | 'unconfigured';
  syncing: boolean;
  syncProgress: number | null;    // 0-100
  uptimePercent: number | null;   // 0-100, rolling 24h
  stats: Record<string, number>;
}
```

Health logic:
- `unconfigured` — no credentials
- `healthy` — credentials exist, last test/sync succeeded
- `degraded` — credentials exist, last sync stale (>24h) or had warnings
- `error` — last connection test or sync failed

### 2. Dashboard Widget

**Placement:** After Operational Status row on DashboardPage
**Layout:** 4-column grid (responsive: 2 on tablet, 1 on mobile)

Each card:
- LED indicator (green/amber/red/gray)
- Integration name + icon
- Key stat (vehicle count, job count, etc.)
- Last sync relative time
- 24h uptime bar
- Active sync progress bar
- Configure link → admin tab
- "Setup" button for unconfigured → opens wizard

**Data:** Fetched on mount + 60s poll, updated via WebSocket for health changes.

### 3. Setup Wizard Modal

**Component:** `IntegrationWizardModal`
**Steps:** Welcome → Credentials → Test → Sync → Done

Credential configs:
- ClearPathGPS: account, user, password, base_url
- ServeManager: api_key
- Microbilt: client_id, client_secret, subscriber_id, environment
- IPED: base_url, api_key

Each step auto-advances on success. Test step shows diagnostics on failure.

### 4. Health Monitoring

**Server-side:** Background probe every 5 minutes for configured integrations.
- Tests using each integration's existing test endpoint
- Stores results in `integration_health_log` table
- Exponential backoff on failure (1min → 5min → 15min)
- After 3 consecutive failures: broadcasts `integration_health_alert` via WebSocket

**Client-side:**
- WebSocket listener for health alerts
- Toast notification on healthy → error transition
- Dashboard auto-updates via WebSocket

**Database:**
```sql
CREATE TABLE IF NOT EXISTS integration_health_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id TEXT NOT NULL,
  status TEXT NOT NULL,
  response_time_ms INTEGER,
  error_message TEXT,
  checked_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
```

## Files to Create/Modify

### New Files
- `server/src/routes/integrations.ts` — aggregated status + health check endpoints
- `server/src/utils/integrationHealthChecker.ts` — background health probe
- `client/src/components/IntegrationHub.tsx` — dashboard widget
- `client/src/components/IntegrationWizardModal.tsx` — setup wizard

### Modified Files
- `server/src/models/database.ts` — add `integration_health_log` table
- `server/src/index.ts` — register integrations route + start health checker
- `client/src/pages/DashboardPage.tsx` — add IntegrationHub widget
- `client/src/types/index.ts` — add IntegrationStatus types
- `client/public/sw.js` — cache bump
