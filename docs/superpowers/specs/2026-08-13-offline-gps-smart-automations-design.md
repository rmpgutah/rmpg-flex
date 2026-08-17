# Offline GPS Capture + Smart Automations Engine — Design

**Date:** 2026-08-13  
**Branch:** claude/offline-gps-smart-automations-a33fc5  
**Status:** Approved for implementation

---

## Overview

Two tightly coupled features:

1. **Offline GPS Buffer** — upgrade the existing localStorage failover queue in `useGpsTracking.ts` to IndexedDB + service worker background sync, enabling GPS capture across 24h+ offline deployments.
2. **Smart Automations Engine** — a hybrid client/server rule evaluator that fires configurable actions (alerts, status changes, welfare checks, Fleet.io sync) when GPS events match defined conditions.

Approach: **Hybrid** — client evaluates rules locally for immediate officer feedback, server evaluates the same rules on GPS ingest for dispatch-visible mutations and external integrations.

---

## Section 1 — Offline GPS Buffer

### Current State

`client/src/hooks/useGpsTracking.ts` line 234: `LS_GPS_QUEUE_KEY` stores unsynced fixes in `localStorage`, hard-capped at 2,000 fixes (~2.8h offline). Source comment explicitly calls out IndexedDB as the needed upgrade.

### New Design

**`client/src/utils/gpsStore.ts`** — owns an IndexedDB database `rmpg-gps` (version 1), object store `fixes`:

| Field | Type | Index | Notes |
|---|---|---|---|
| `id` | auto-increment | PK | |
| `ts` | number (epoch ms) | ✅ | Range queries for sync |
| `lat` | number | | |
| `lng` | number | | |
| `accuracy` | number \| null | | |
| `heading` | number \| null | | |
| `speed` | number \| null | | |
| `source` | string | | `'gps'`\|`'wifi'`\|`'ip'` |
| `synced` | 0 \| 1 | ✅ | 0=pending, 1=confirmed |

**Lifecycle:**
- `useGpsTracking.ts` writes every accepted fix to IndexedDB alongside the in-memory batch
- On successful `POST /dispatch/gps`, marks sent fix IDs as `synced=1`
- Prune `synced=1` fixes older than 72h on mount
- Migrate and remove `LS_GPS_QUEUE_KEY` — one store, one source of truth

**Service Worker Background Sync:**

`sw.js` registers a `sync` event tag `gps-flush`. On reconnect the browser fires the sync event → SW reads all `synced=0` fixes from IndexedDB, batches ≤500 per POST (stays under D1's 100-parameter cap via server's `executeInChunks`), POSTs to `POST /dispatch/gps`. GPS continues recording even when the browser tab is closed on Android Chrome/Edge. iOS Safari falls back to tab-resume drain (no background sync API support).

---

## Section 2 — Automation Rule Schema

### Migration 0094: `automation_rules`

```sql
CREATE TABLE IF NOT EXISTS automation_rules (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL,
  description       TEXT,
  created_by        INTEGER REFERENCES users(id),
  scope             TEXT NOT NULL DEFAULT 'global', -- 'global'|'unit'|'user'
  scope_id          INTEGER,                        -- unit_id or user_id
  enabled           INTEGER NOT NULL DEFAULT 1,
  trigger_type      TEXT NOT NULL,
  trigger_config    TEXT NOT NULL DEFAULT '{}',     -- JSON
  action_type       TEXT NOT NULL,
  action_config     TEXT NOT NULL DEFAULT '{}',     -- JSON
  dedup_window_ms   INTEGER NOT NULL DEFAULT 300000, -- 5 min
  evaluate_client   INTEGER NOT NULL DEFAULT 1,
  evaluate_server   INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_automation_rules_scope ON automation_rules(scope, scope_id);
CREATE INDEX IF NOT EXISTS idx_automation_rules_enabled ON automation_rules(enabled);
```

### Migration 0095: `automation_rule_firings`

```sql
CREATE TABLE IF NOT EXISTS automation_rule_firings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id     INTEGER NOT NULL REFERENCES automation_rules(id),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  unit_id     INTEGER,
  fired_at    TEXT NOT NULL DEFAULT (datetime('now')),
  trigger_lat REAL,
  trigger_lng REAL,
  context     TEXT DEFAULT '{}',  -- JSON: speed, geofence name, call_id, etc.
  source      TEXT NOT NULL       -- 'client'|'server'
);
CREATE INDEX IF NOT EXISTS idx_arf_rule_user ON automation_rule_firings(rule_id, user_id, fired_at);
CREATE INDEX IF NOT EXISTS idx_arf_fired_at ON automation_rule_firings(fired_at);
```

### Trigger Types

| `trigger_type` | `trigger_config` fields |
|---|---|
| `geofence_enter` / `geofence_exit` | `{ geofence_id: number }` |
| `no_movement` | `{ threshold_ms: number, radius_m: number }` |
| `speed_threshold` | `{ speed_ms: number, direction: 'above'|'below' }` |
| `call_proximity` | `{ radius_m: number }` |
| `beat_entry` / `beat_exit` | `{ beat_id: string }` |
| `low_accuracy` | `{ threshold_m: number }` |

### Action Types

| `action_type` | `action_config` | Client | Server |
|---|---|---|---|
| `notify_officer` | `{ message: string, severity: 'info'|'warn'|'critical' }` | ✅ | ✅ |
| `notify_dispatch` | `{ message: string, severity }` | ❌ | ✅ |
| `notify_supervisor` | `{ message: string, severity }` | ❌ | ✅ |
| `change_unit_status` | `{ status: string }` | ❌ | ✅ |
| `trigger_welfare_check` | `{ timer_ms: number }` | ❌ | ✅ (WelfareWatchDO) |
| `log_audit_event` | `{ category: string, note: string }` | ❌ | ✅ |
| `sync_fleet_odometer` | `{}` | ❌ | ✅ (Fleet.io) |

**Offline sync:** `automation_rules` added to `PULL_TABLES` in `src/routes/offline.ts`. Pull query filters by `scope='global' OR (scope='user' AND scope_id=:userId)` — officers never receive other users' personal rules.

---

## Section 3 — Client Rule Evaluator

**`client/src/utils/automationEngine.ts`**

Pure, stateless per-fix evaluator. No React dependency, no IndexedDB access — testable in Node/Vitest.

```ts
interface GpsFix {
  ts: number; lat: number; lng: number;
  accuracy: number | null; heading: number | null; speed: number | null;
  source: string;
}

interface EvaluatorState {
  lastFired: Record<number, number>;  // rule_id → epoch ms
  lastFix: GpsFix | null;
  assignedCallLatLng: { lat: number; lng: number } | null;
}

interface FiredAction {
  rule: AutomationRule;
  pendingServerAction: boolean;  // true for server-only action types
  localAction?: { type: 'notify_officer'; message: string; severity: string };
}

function evaluateRules(
  fix: GpsFix,
  rules: AutomationRule[],
  state: EvaluatorState,
  geofences: GeofenceFeature[],
): FiredAction[]
```

**Integration in `useGpsTracking.ts`:**
- `evaluatorStateRef = useRef<EvaluatorState>({ lastFired: {}, lastFix: null, assignedCallLatLng: null })`
- Called inside `watchPosition` callback after existing quality filters pass
- `notify_officer` actions → existing `showToast()` + browser Notification API
- Evaluator imported via dynamic `import()` to avoid initial bundle bloat
- Officer-confirm pattern for `call_proximity` rules: toast shows "You're near your assigned call — tap to mark on scene" with a confirm button that POSTs `change_unit_status` (does not auto-change, preserves dispatch authority)

**Trigger implementations:**
- `geofence_enter/exit` — point-in-polygon via existing `pointInAnyPolygon` utility (`src/utils/geofenceZones.ts` already imported in the GPS route)
- `no_movement` — haversine vs `state.lastFix`; if `< radius_m` for `> threshold_ms`, fire
- `speed_threshold` — `fix.speed` vs `trigger_config.speed_ms` + direction
- `call_proximity` — haversine vs `state.assignedCallLatLng` (populated from IndexedDB `calls_for_service`)
- `beat_entry/exit` — point-in-polygon vs beat GeoJSON (cached in R2, already loaded by the map layer)
- `low_accuracy` — `fix.accuracy > threshold_m`

---

## Section 4 — Server Rule Evaluator

**`src/utils/automationEngine.ts`**

Called from `src/routes/dispatch/gps.ts` after existing geofence + trip telemetry processing.

```ts
async function evaluateServerRules(
  db: D1Database,
  env: Env,
  ctx: ExecutionContext,
  userId: number,
  unitId: number | null,
  fixes: IncomingFix[],
): Promise<void>
```

**Rule loading:** Single D1 query per GPS POST — fetch all `evaluate_server=1` rules for this user (global + user-scoped). Cached in local `Map` for the request lifetime (no per-fix queries).

**Dedup:** Before firing, query `automation_rule_firings` for `rule_id + user_id` within `dedup_window_ms`. Insert new firing row via `ctx.waitUntil()` — never delays the GPS response.

**Action implementations:**

| Action | Implementation |
|---|---|
| `notify_dispatch` / `notify_supervisor` | `emitAlert()` → existing `notificationEngine` (same pattern as geofence alerts in the GPS route) |
| `notify_officer` | `POST /api/push` Web Push — existing push route |
| `change_unit_status` | `UPDATE units SET status=? WHERE id=?` + `broadcastAll()` WebSocket broadcast |
| `trigger_welfare_check` | Reset `WelfareWatchDO` timer via DO fetch stub (same pattern as `src/routes/welfare.ts`) |
| `log_audit_event` | `auditEmit()` existing utility |
| `sync_fleet_odometer` | `setFleetOdometer()` — already imported in GPS route |

**Error handling:** Each action wrapped in try/catch + `log.error()`. One failed action never blocks the rest — degraded execution, not a thrown error.

---

## Section 5 — Admin UI

**`AdminPage.tsx`** — new tab `'automations'` (four-edit wiring: `VALID_TABS`, `TabId` union, config array, render block).

### Sub-panels

**Rule Library** — table: Name, Trigger, Action, Scope, Client/Server badges, Enabled toggle. Row click opens Rule Editor modal.

**Rule Editor modal** — two-step:
1. Condition: `trigger_type` dropdown → dynamic config fields (geofence picker, numeric thresholds, radius slider)
2. Action: `action_type` dropdown → dynamic config (message text, status picker, timer input)

Scope picker: Global / Specific Unit / Specific Officer.

**Firing History** — last 500 `automation_rule_firings` rows, searchable by rule / officer / date. Shows Client vs Server source badge. Useful for tuning `dedup_window_ms`.

**Templates** — one-click install:
- "Welfare check — no movement 15 min" (`no_movement` → `trigger_welfare_check` + `notify_supervisor`)
- "Auto on-scene prompt — call proximity 100m" (`call_proximity` → `notify_officer` with confirm-to-status)
- "Speed alert — over 90 mph" (`speed_threshold` → `notify_supervisor`)
- "Beat entry log" (`beat_entry` → `log_audit_event`)

---

## Section 6 — Officer Self-Service

**`SettingsPage.tsx`** — new "My Automations" section.

**System rules panel** — global rules that apply to this officer, read-only with enabled/disabled status indicator.

**My rules panel** — `scope='user'` rules for this officer. Full create/edit/delete. Simplified rule editor — only `notify_officer` action type available. Officer-available trigger/action pairs:

| Trigger | Action | UX |
|---|---|---|
| `call_proximity` | `notify_officer` | Toast with tap-to-confirm status change (does NOT auto-mutate — dispatch stays authoritative) |
| `no_movement` | `notify_officer` | Personal welfare reminder fires before system-level threshold |

Officers cannot configure actions that affect other users' records or external systems.

---

## Architecture Diagram

```
GPS Fix (device)
  └─► useGpsTracking.ts
        ├─► IndexedDB gps_fixes (gpsStore.ts)       ← replaces localStorage
        ├─► automationEngine.ts (client eval)
        │     └─► notify_officer → toast / Notification API
        └─► POST /dispatch/gps  (online / sw background sync)
              └─► src/routes/dispatch/gps.ts
                    ├─► existing: geofence, trip telemetry, odometer
                    └─► src/utils/automationEngine.ts (server eval)
                          ├─► notify_dispatch/supervisor → notificationEngine
                          ├─► notify_officer → push route
                          ├─► change_unit_status → broadcastAll
                          ├─► trigger_welfare_check → WelfareWatchDO
                          ├─► log_audit_event → auditEmit
                          └─► sync_fleet_odometer → setFleetOdometer

Rules config:
  AdminPage "Smart Automations" tab
  SettingsPage "My Automations" section
  └─► D1 automation_rules
        └─► PULL_TABLES offline sync → device IndexedDB → client evaluator
```

---

## Files Created / Modified

### New files
- `client/src/utils/gpsStore.ts` — IndexedDB GPS fix store
- `client/src/utils/automationEngine.ts` — client rule evaluator (pure)
- `src/utils/automationEngine.ts` — server rule evaluator
- `migrations/0094_automation_rules.sql`
- `migrations/0095_automation_rule_firings.sql`

### Modified files
- `client/src/hooks/useGpsTracking.ts` — write to IndexedDB, remove localStorage queue, call client evaluator
- `client/public/sw.js` — add `sync` event handler for `gps-flush`
- `src/routes/offline.ts` — add `automation_rules` to PULL_TABLES with user-scoped filter
- `src/routes/dispatch/gps.ts` — call `evaluateServerRules()` after existing processing
- `client/src/pages/AdminPage.tsx` — add `automations` tab wiring
- `client/src/pages/SettingsPage.tsx` — add "My Automations" section

### New page components
- `client/src/components/admin/AutomationsTab.tsx` — rule library + firing history + templates
- `client/src/components/AutomationRuleEditor.tsx` — shared create/edit modal
- `client/src/components/AutomationRuleList.tsx` — shared rule table

---

## Security Considerations

- Officer rule creation restricted to `notify_officer` action type only — enforced server-side on `POST /api/automation-rules` (role check + action_type allowlist)
- `PULL_TABLES` filter prevents officers receiving other users' `scope='user'` rules
- Automation rules allowlisted in `ALLOWED_ENDPOINTS` for offline push: `POST /api/automation-rules/firings/client` (client firing audit log only — no mutations)
- `change_unit_status` server action verifies the firing rule's `scope` covers the target unit before updating
- `WelfareWatchDO` reset via automation uses same auth pattern as `src/routes/welfare.ts`

---

## Testing

- `tests/automationEngine.test.ts` — Node/Vitest: pure evaluator logic per trigger type, dedup window, edge cases (null speed, null accuracy)
- `tests/gpsStore.test.ts` — IndexedDB via `fake-indexeddb` shim
- `test-workers/automations.test.ts` — Miniflare: server evaluator integration, rule firing audit insert, dedup check
- `client/src/utils/__tests__/automationEngine.test.ts` — client evaluator mirrors server test coverage

---

## Migration Checklist

After merge, apply directly to live D1 `785de7ae`:

```bash
scripts/apply-migration.sh 0094_automation_rules.sql
scripts/apply-migration.sh 0095_automation_rule_firings.sql
```

Verify:
```bash
wrangler d1 execute rmpg-flex --remote --command "SELECT name FROM sqlite_master WHERE name LIKE 'automation%'"
```
