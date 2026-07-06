# Geofence entry/exit detection — design

## Problem

Two disconnected geofence systems already exist in the codebase:

- `src/routes/geofences.ts` → `geofence_zones` table (`zone_name`, `zone_type`,
  `geojson_data`, `color`, `description`, `is_active`). `DrawGeofenceTool.tsx`
  (the map drawing UI) POSTs new zones here.
- `src/routes/dispatch/extensions.ts`'s `callActions.get/post('/geofences')`
  → a *different* `geofences` table. `useMapGeofenceAlerts.ts` (the map's
  geofence toggle/render/click-alert hook) reads from here via
  `/dispatch/calls/geofences`.

Because these two are unrelated, a zone drawn on the map is persisted
correctly but never appears anywhere else — it looks like it "vanished."
Separately, nothing in `src/routes/dispatch/gps.ts` (the GPS-ingestion route)
ever checks a unit's position against any geofence. There is no entry/exit
detection, no event log, and no dispatcher alert.

## Goals

1. Drawn zones are visible wherever geofences are rendered (single source of
   truth).
2. When a unit's GPS position enters or exits an active geofence zone, that
   transition is logged (audit trail / future dwell-time reporting) and a
   real-time alert reaches connected dispatchers.
3. Keep scope to detection + logging + alerting. No new zone-editing UI, no
   voice/audio alert channel, no per-zone alert-recipient configuration.

## Non-goals

- Migrating/backfilling the legacy `geofences` table's existing rows into
  `geofence_zones`. That table's route stays as-is; we just stop pointing new
  reads at it. (Low value, adds migration risk, no evidence anyone has zones
  stored there today worth preserving.)
- Per-officer geofence preferences (e.g. "only alert me for zones near my
  beat"). All connected dispatchers get all zone alerts, matching how
  `panic_alert` and `dispatch_update` already broadcast today.
- Editing zone geometry from anywhere but the existing draw tool.

## Design

### 1. Consolidate on `geofence_zones`

`useMapGeofenceAlerts.ts` currently fetches `GET /dispatch/calls/geofences`
(the dead-end table). Point it at `GET /geofences` instead (the route
`DrawGeofenceTool.tsx` already writes to). Adjust the client-side
`GeofenceZone` shape/mapping as needed — `geofence_zones` stores
`geojson_data` as a JSON string (a `Feature`/`Polygon`), not a raw
`coordinates` array, so the fetch mapping needs a small parse step.

### 2. Point-in-polygon detection in `gps.ts`

Inside the existing `gps.post('/')` handler, after a batch's points are
validated and the unit is resolved (same place trip-engine/mileage logic
already runs), take the **last accepted point** in the batch and:

1. Load active zones from `geofence_zones` (`is_active = 1`) — small table,
   fine to query per-batch; add a KV cache later only if this becomes a
   measurable cost.
2. For each zone, run a standard ray-casting point-in-polygon test against
   the zone's `geojson_data` polygon coordinates.
3. Look up the unit's current zone membership from a new `unit_geofence_state`
   table (`unit_id` PK, `zone_id`, `entered_at`). Compare against the fresh
   in/out result for each zone:
   - Not previously inside, now inside → **entry** event.
   - Previously inside, now outside → **exit** event.
   - Unchanged → no event.
4. On any transition: insert a `geofence_events` row (`unit_id`, `zone_id`,
   `event_type` ['enter'|'exit'], `latitude`, `longitude`, `created_at`),
   update `unit_geofence_state`, and broadcast a `geofence_alert` WebSocket
   message (`{ unit_id, call_sign, zone_id, zone_name, zone_type, event_type,
   latitude, longitude }`) via the existing `broadcastAll` helper.

This runs for every zone_type (per your answer) — no filtering by
`exclusion`/`alert` vs `inclusion`/`patrol_required`.

Failure handling: geofence detection is **best-effort and must never block
GPS ingestion** — wrap the whole block in try/catch with `log.error`, same
pattern as the trip-engine/mileage side-effects already in this route.

### 3. New tables (migration)

```sql
CREATE TABLE IF NOT EXISTS unit_geofence_state (
  unit_id     INTEGER PRIMARY KEY,
  zone_id     INTEGER NOT NULL,
  entered_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS geofence_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id     INTEGER NOT NULL,
  zone_id     INTEGER NOT NULL,
  event_type  TEXT NOT NULL CHECK(event_type IN ('enter','exit')),
  latitude    REAL,
  longitude   REAL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_geofence_events_unit ON geofence_events(unit_id, created_at);
CREATE INDEX IF NOT EXISTS idx_geofence_events_zone ON geofence_events(zone_id, created_at);
```

### 4. Client alert surface

Dispatch/map pages already have a WebSocket subscription mechanism
(`subscribe('...')`) and a `ToastProvider`. Add one `subscribe('geofence_alert', ...)`
handler (in `DispatchPage.tsx` and `MapboxMapPage.tsx`, the two surfaces that
already listen for `panic_alert`) that shows a toast: `"{call_sign} entered
{zone_name}"` / `"... exited ..."`. No new sound/voice — reuse whatever the
toast provider already does by default.

## Testing

- Unit tests for the point-in-polygon helper (pure function, easy to test
  with a known square/point fixtures).
- Unit tests for the entry/exit transition logic (given a prior state +
  a new in/out result, does it emit the right event or no-op).
- No new client component tests beyond a smoke check that the toast handler
  wires to the right message type — the existing `panic_alert` handler is
  the precedent to mirror.

## Open items deferred to a later pass (not blocking this PR)

- KV/cache layer for zone lookups if per-batch D1 queries become a cost
  concern at scale.
- Per-zone alert audio/voice.
- Dwell-time reporting UI built on top of `geofence_events` (the table is
  designed to support this later without a migration).
