# Always-On Officer GPS Tracking — Design

**Date:** 2026-04-20
**Status:** Approved — ready for implementation planning
**Owner:** Backend + Dispatch UI

## Problem

Officer-safety requires that dispatch always has a live fix on every on-duty
officer. Today:

- `useGpsTracking` (browser/Electron) is mounted per-page. An officer sitting
  on a page that doesn't mount it goes silent with no warning.
- The OwnTracks phone path works but has no backstop — if the phone crashes or
  loses network, GPS simply stops and nobody is notified.
- The server's `GPS_STALE_MS = 30s` is used only for source-priority arbitration,
  not for raising alarms when a unit goes silent.

Result: it is possible for a unit to have no GPS ingest for hours while a
dispatcher watches a stale dot without knowing it's stale.

## Goal

Guarantee that dispatch is *either* receiving live GPS for every on-duty
officer, *or* visibly and audibly alerted that they aren't — within 3 minutes
of signal loss, with escalation up to supervisor notification at 15 minutes.

## Non-goals

- Forcing OwnTracks configuration from the server (can't — it's an app on the
  officer's phone).
- Replacing the existing multi-source GPS priority ladder (`browser_desktop=1`
  < `browser_mobile=2` < `clearpathgps=3` < `owntracks/traccar=4`). That stays.
- Offline mesh / LoRa / satellite fallbacks. Scope is strictly "the known
  sources fail silently" detection.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│ CLIENT                                                           │
│   Layout.tsx  ──mounts──▶  useGpsTracking (global, not per-page) │
│                    │                                             │
│                    ▼                                             │
│   WebSocket ◀── action: 'unit_gps_stale' / 'unit_gps_recovered'  │
│        │                                                         │
│        ▼                                                         │
│   DispatchPage unit list: colored "GPS LOST NmSs" badge + audio  │
└────────────────────────┬─────────────────────────────────────────┘
                         │ HTTP POST /owntracks, /gps, /clearpathgps
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│ SERVER                                                           │
│   gps.ts handler  ──writes──▶  units.gps_updated_at              │
│                                                                  │
│   gpsStaleWatchdog.ts (new)                                      │
│   setInterval 30s: scan on-duty units                            │
│     age = now − gps_updated_at                                   │
│     level = evaluateLevel(age)  // 0|1|2|3                       │
│     if level > stored escalation_level: emit, update, notify     │
│     if age < threshold AND alert open: resolve                   │
└──────────────────────────────────────────────────────────────────┘
```

### Scope — who gets watched

Only units where `status` ∈ (`available`, `enroute`, `on_scene`, `investigating`,
`transport`, `pursuit`). `off_duty` and `out_of_service` are skipped. This is a
query predicate (one SQL line), not a role check — keeps logic auditable.

## Data model

New table:

```sql
CREATE TABLE IF NOT EXISTS gps_stale_alerts (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id             INTEGER NOT NULL REFERENCES units(id),
  call_sign           TEXT NOT NULL,
  officer_id          INTEGER,
  officer_name        TEXT,
  last_gps_at         TEXT NOT NULL,       -- last known fix
  stale_detected_at   TEXT NOT NULL,       -- when watchdog first raised
  last_escalated_at   TEXT NOT NULL,       -- most recent level transition
  escalation_level    INTEGER NOT NULL DEFAULT 1, -- 1,2,3 only grows
  recovered_at        TEXT,                -- NULL = still open
  duration_sec        INTEGER,             -- set on recovery
  last_lat            REAL,
  last_lng            REAL,
  last_source         TEXT,
  notes               TEXT
);
CREATE INDEX idx_gps_stale_open ON gps_stale_alerts(unit_id, recovered_at);
CREATE INDEX idx_gps_stale_time ON gps_stale_alerts(stale_detected_at);
```

**Open-alert invariant:** at most one row per unit with `recovered_at IS NULL`.
Denormalized `call_sign`/`officer_name` preserve labels across officer/unit
rotations (same pattern `gps_breadcrumbs` uses).

## Watchdog behavior

```typescript
// server/src/utils/gpsStaleWatchdog.ts
const STALE_THRESHOLD_MS = 3 * 60_000;
const TICK_INTERVAL_MS   = 30_000;
const ON_DUTY = ['available', 'enroute', 'on_scene',
                 'investigating', 'transport', 'pursuit'];

export function evaluateLevel(ageMs: number): 0 | 1 | 2 | 3 {
  if (ageMs < 3  * 60_000) return 0;
  if (ageMs < 10 * 60_000) return 1;
  if (ageMs < 15 * 60_000) return 2;
  return 3;
}

export function tick() { /* see design section 3 */ }
setInterval(tick, TICK_INTERVAL_MS);
```

### Escalation ladder

| Age         | Level | Server action                                       | Dispatcher UX                              |
|-------------|-------|-----------------------------------------------------|--------------------------------------------|
| 0–3 min     | 0     | none                                                | green LED                                  |
| 3 min       | 1     | INSERT alert; WS `unit_gps_stale level=1`           | amber "GPS LOST 3m" + short beep           |
| 10 min      | 2     | UPDATE level=2; WS `unit_gps_stale level=2`         | red badge; louder beep; TTS                |
| 15 min      | 3     | UPDATE level=3; notify on-shift supervisors         | red flashing; "SUPERVISOR NOTIFIED"        |
| recovery    | —     | UPDATE recovered_at,duration_sec; WS `_recovered`   | green LED + "GPS RESTORED (was lost Nm)" toast |

Level only increases. Re-raising at same level is a no-op — idempotent on tick.

### Supervisor notification (level 3)

Uses existing `notification_rules` worker + `msGraphClient.ts` email path.
Watchdog tick does **not** retry failed sends in-loop — it inserts a
`notifications` row and lets the existing worker retry.

## Client integration

### Global tracker mount — `Layout.tsx`

```tsx
useGpsTracking({
  enabled: !!user && user.role !== 'admin_desk',
  unitCallSign: user?.call_sign,
});
```

The hook already dedupes via a localStorage session-owner lock, so existing
per-page mounts remain safe and will be cleaned up in a follow-up commit.

### Dispatch badge — `client/src/components/dispatch/GpsStaleBadge.tsx` (new)

Subscribes to `unit_gps_stale` / `unit_gps_recovered` WS actions. Local
state drives the visible "NmSs" counter so it advances smoothly between
server ticks. Per-unit "Silence for 60s" button mutes *that unit's* audio
only (global mute is an officer-safety anti-pattern).

### Open-alerts endpoint

`GET /api/dispatch/gps-stale/open` — returns all alerts with `recovered_at IS
NULL`. Used on page load and WS reconnect to rebuild badges without replaying
missed broadcasts.

`GET /api/dispatch/gps-stale/history?unit_id=&since=` — audit trail for
officer-safety post-incident review. Dispatcher+ role gate.

## Error handling

| Failure                        | Behavior                                                |
|--------------------------------|---------------------------------------------------------|
| Watchdog tick DB error         | `logger.error`, continue next tick; never crash interval|
| `notifySupervisors` fails      | Row stays open at level 3; worker retries email         |
| WebSocket broadcast fails      | DB row is source of truth; clients reconcile via `/open`|
| Server restart mid-incident    | Boot reconciliation re-evaluates levels from stored age |
| Clock skew (phone vs server)   | Watchdog compares server `Date.now()` vs `gps_updated_at` (server-stamped). Phone clock irrelevant. |

**Boot reconciliation:** on server start, scan open alerts. If unit's current
`gps_updated_at` is fresh, resolve immediately with a computed
`duration_sec`. If still stale, re-evaluate level from current age (no
re-chime — the persisted `escalation_level` prevents duplicate alerts).

## Testing

1. **Unit** (`evaluateLevel`) — boundary assertions at 2:59, 3:00, 9:59,
   10:00, 14:59, 15:00. ~6 tests.
2. **Integration** (`tick`) — vitest fake timers; seed unit with old
   `gps_updated_at`; call exported `tick()` directly; assert:
   - Age 3:01 creates row, emits level-1
   - Age 10:01 updates row to level 2, emits level-2
   - Age 15:01 updates row to level 3, calls `notifySupervisors` mock
   - Fresh GPS post → tick resolves, emits `_recovered`, sets `duration_sec`
   - Repeated ticks at same level do not re-broadcast (idempotency)
3. **Smoke** — `GET /api/dispatch/gps-stale/open` and `/history` return
   expected shapes under auth.

Test file: `server/src/utils/__tests__/gpsStaleWatchdog.test.ts`.

## Rollout

1. Ship watchdog + table + endpoints + broadcasts (server-only, shadow mode —
   no client UI yet). Verify on prod for 24h that alerts fire at the right
   times against real officer activity.
2. Ship `GpsStaleBadge` + audio + `Layout.tsx` global `useGpsTracking` mount.
3. Clean up redundant per-page `useGpsTracking` mounts.

## Out of scope (future work)

- Per-agency tunable thresholds (currently hardcoded 3/10/15).
- SMS escalation at level 3.
- Auto-BOLO creation when an alert reaches level 3 during a pursuit.
