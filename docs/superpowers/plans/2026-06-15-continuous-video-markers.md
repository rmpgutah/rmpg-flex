# Continuous Video + Timeline Markers (W6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn the 40s chunks of a drive into a timeline with **markers** — camera-triggered driving-violation event tags + turn/direction-change pins (GPS-derived, with camera hard-turns distinctly flagged) — and expose them (plus the seamless ordered-chunk manifest) so the viewer can pin them on the scrubber.

**Architecture:** Pure helpers do the geometry (turn detection) and time math (marker → playable offset). A `footage_markers` table stores derived markers per request. `buildFootageMarkers()` derives them from (a) the ClearPath event list classified via the existing `classifyDrivingEvent`, and (b) the GPS track (`gps[]` on media objects) via `detectTurns`. Endpoints expose markers + the existing ordered-chunk manifest. Client scrubber rendering is a follow-on increment.

**Tech Stack:** Workers/Hono/D1/R2, vitest (pure helpers). Reuses `haversineM`+`bearing` (`src/utils/tripTelemetry.ts`), `classifyDrivingEvent` (`src/utils/drivingEvents.ts`), `buildManifest` (`src/utils/footage/concat.ts`), `listMedia` (`src/utils/clearpathGps.ts`).

This plan is committed to the SAME branch/PR (#1349) per the operator's "one growing PR" choice.

---

## File Structure
- `src/utils/tripTelemetry.ts` — **modify**: `export` the existing `bearing` (currently module-local) for reuse.
- `src/utils/footage/turns.ts` — **new**, pure: `angleDelta` + `detectTurns`. Tested.
- `src/utils/footage/markerOffset.ts` — **new**, pure: `markerOffsetMs` (ts → playable offset, gap-aware). Tested.
- `src/utils/footage/markers.ts` — **new**: `footage_markers` schema + `buildFootageMarkers()` derivation.
- `src/routes/flexcam.ts` — **modify**: `GET /footage/:id/markers`; include markers in `GET /footage/:id`.
- `tests/footageTurns.test.ts`, `tests/footageMarkerOffset.test.ts` — **new**.

---

### Task 1: Export `bearing` from tripTelemetry

**Files:** Modify `src/utils/tripTelemetry.ts`

- [ ] **Step 1:** Change `function bearing(` to `export function bearing(` (line ~32). No other change.
- [ ] **Step 2:** `npm run typecheck` → PASS.
- [ ] **Step 3:** Commit: `git commit -am "refactor(trip): export bearing() for reuse by footage turn detection"`

---

### Task 2: Turn-detection helper (pure, TDD)

**Files:** Create `src/utils/footage/turns.ts`; Test `tests/footageTurns.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/footageTurns.test.ts
import { describe, it, expect } from 'vitest';
import { angleDelta, detectTurns, type GpsPoint } from '../src/utils/footage/turns';

describe('angleDelta', () => {
  it('returns signed smallest angle, wrap-aware', () => {
    expect(angleDelta(10, 40)).toBe(30);
    expect(angleDelta(40, 10)).toBe(-30);
    expect(angleDelta(350, 10)).toBe(20);   // wrap forward
    expect(angleDelta(10, 350)).toBe(-20);  // wrap back
  });
});

// Build a track heading due-north then turning due-east (a right turn).
// Points ~30m apart so bearings are reliable.
function leg(fromLat: number, fromLng: number, dLat: number, dLng: number, n: number, t0: number): GpsPoint[] {
  const pts: GpsPoint[] = [];
  for (let i = 0; i < n; i++) pts.push({ lat: fromLat + dLat * i, lng: fromLng + dLng * i, ts: t0 + i * 1000 });
  return pts;
}

describe('detectTurns', () => {
  it('finds no turns on a straight track', () => {
    const north = leg(40.0, -111.0, 0.0003, 0, 6, 0);
    expect(detectTurns(north)).toEqual([]);
  });
  it('detects a right turn (north → east)', () => {
    const north = leg(40.0, -111.0, 0.0003, 0, 5, 0);
    const last = north[north.length - 1];
    const east = leg(last.lat, last.lng, 0, 0.0004, 5, 5000);
    const turns = detectTurns([...north, ...east]);
    expect(turns.length).toBe(1);
    expect(turns[0].turnDir).toBe('right');
  });
  it('detects a left turn (north → west)', () => {
    const north = leg(40.0, -111.0, 0.0003, 0, 5, 0);
    const last = north[north.length - 1];
    const west = leg(last.lat, last.lng, 0, -0.0004, 5, 5000);
    const turns = detectTurns([...north, ...west]);
    expect(turns.length).toBe(1);
    expect(turns[0].turnDir).toBe('left');
  });
  it('ignores near-stationary jitter (segments below minSegM)', () => {
    const jitter: GpsPoint[] = Array.from({ length: 8 }, (_, i) => ({
      lat: 40.0 + (i % 2) * 0.000002, lng: -111.0 - (i % 2) * 0.000002, ts: i * 1000,
    }));
    expect(detectTurns(jitter)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run → FAIL** (`npx vitest run tests/footageTurns.test.ts`) — module missing.

- [ ] **Step 3: Implement**

```ts
// src/utils/footage/turns.ts
// Pure GPS turn / direction-change detection for FlexCam timeline pins. A turn is
// a cumulative heading change beyond a threshold, collapsed to one marker. Reuses
// haversineM + bearing from tripTelemetry. Unit-tested in tests/footageTurns.test.ts.
import { haversineM, bearing } from '../tripTelemetry';

export interface GpsPoint { lat: number; lng: number; ts: number; } // ts epoch ms
export interface TurnMarker { ts: number; turnDir: 'left' | 'right'; headingDeg: number; deltaDeg: number; }

/** Signed smallest angle a→b in [-180,180], wrap-aware. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/** Detect turns from a GPS track. Builds reliable segment bearings between points
 *  ≥ minSegM apart (drops GPS jitter), then accumulates signed heading change;
 *  when |accumulated| ≥ thresholdDeg it emits one marker (dir by sign) and re-anchors
 *  to the new heading. Pure. */
export function detectTurns(points: GpsPoint[], opts?: { thresholdDeg?: number; minSegM?: number }): TurnMarker[] {
  const thresholdDeg = opts?.thresholdDeg ?? 35;
  const minSegM = opts?.minSegM ?? 12;
  const pts = [...points].filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)).sort((a, b) => a.ts - b.ts);

  // Reliable segment bearings (skip near-stationary hops).
  const segs: Array<{ heading: number; ts: number }> = [];
  let prev: GpsPoint | null = null;
  for (const p of pts) {
    if (prev && haversineM(prev.lat, prev.lng, p.lat, p.lng) >= minSegM) {
      segs.push({ heading: bearing(prev.lat, prev.lng, p.lat, p.lng), ts: p.ts });
      prev = p;
    } else if (!prev) {
      prev = p;
    }
  }
  if (segs.length < 2) return [];

  const turns: TurnMarker[] = [];
  let anchor = segs[0].heading;
  let accum = 0;
  for (let i = 1; i < segs.length; i++) {
    const step = angleDelta(segs[i - 1].heading, segs[i].heading);
    // Reset accumulation if the step reverses direction (separate turns).
    if (accum !== 0 && Math.sign(step) !== Math.sign(accum) && Math.abs(step) > 5) { anchor = segs[i - 1].heading; accum = 0; }
    accum += step;
    if (Math.abs(accum) >= thresholdDeg) {
      const headingDeg = ((segs[i].heading % 360) + 360) % 360;
      turns.push({ ts: segs[i].ts, turnDir: accum > 0 ? 'right' : 'left', headingDeg, deltaDeg: accum });
      anchor = segs[i].heading; accum = 0;
    }
  }
  return turns;
}
```

- [ ] **Step 4: Run → PASS** (`npx vitest run tests/footageTurns.test.ts`).
- [ ] **Step 5: Commit** `git add src/utils/footage/turns.ts tests/footageTurns.test.ts && git commit -m "feat(footage): pure GPS turn/direction-change detection (timeline pins)"`

---

### Task 3: Marker-offset helper (pure, TDD)

**Files:** Create `src/utils/footage/markerOffset.ts`; Test `tests/footageMarkerOffset.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/footageMarkerOffset.test.ts
import { describe, it, expect } from 'vitest';
import { markerOffsetMs } from '../src/utils/footage/markerOffset';

const chunks = [ // each 40s; seq 1 is a gap (missing → not downloaded)
  { seq: 0, from_ts: 1000, to_ts: 41000, status: 'downloaded' },
  { seq: 1, from_ts: 41000, to_ts: 81000, status: 'missing' },
  { seq: 2, from_ts: 81000, to_ts: 121000, status: 'downloaded' },
];

describe('markerOffsetMs', () => {
  it('offsets within the first downloaded chunk', () => {
    expect(markerOffsetMs(11000, chunks)).toBe(10000); // 10s into chunk 0
  });
  it('skips the gap so chunk 2 starts at 40000 on the playable timeline', () => {
    expect(markerOffsetMs(91000, chunks)).toBe(50000); // 40000 (chunk0) + 10000 into chunk2
  });
  it('returns null for a ts inside a missing chunk', () => {
    expect(markerOffsetMs(61000, chunks)).toBeNull();
  });
  it('returns null for a ts outside the track', () => {
    expect(markerOffsetMs(500, chunks)).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```ts
// src/utils/footage/markerOffset.ts
// Map an absolute event timestamp to its offset on the PLAYABLE (downloaded-only,
// gap-collapsed) timeline of a request's chunks. Pure. Tested.
export interface OffsetChunk { seq: number; from_ts: number; to_ts: number; status: string; }

export function markerOffsetMs(tsMs: number, chunks: OffsetChunk[]): number | null {
  const ordered = [...chunks].sort((a, b) => a.seq - b.seq);
  let played = 0;
  for (const c of ordered) {
    if (c.status !== 'downloaded') continue;          // gaps don't occupy the playable timeline
    if (tsMs >= c.from_ts && tsMs < c.to_ts) return played + (tsMs - c.from_ts);
    played += c.to_ts - c.from_ts;
  }
  return null;                                         // ts in a gap or outside the track
}
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `git add src/utils/footage/markerOffset.ts tests/footageMarkerOffset.test.ts && git commit -m "feat(footage): pure marker time→playable-offset mapping (gap-aware)"`

---

### Task 4: `footage_markers` table + derivation

**Files:** Create `src/utils/footage/markers.ts`

- [ ] **Step 1: Implement schema + derivation**

```ts
// src/utils/footage/markers.ts
// Derive + store FlexCam timeline markers for a footage request: camera-triggered
// driving-violation event tags (ClearPath events → classifyDrivingEvent) and
// turn/direction-change pins (GPS track → detectTurns), with camera hard-turns
// distinctly flagged. Idempotent per request (DELETE+reinsert). Best-effort.
import type { Bindings } from '../../types';
import { getDb, query, queryFirst, execute } from '../db';
import { getApiConfig, listMedia } from '../clearpathGps';
import { classifyDrivingEvent } from '../drivingEvents';
import { detectTurns, type GpsPoint } from './turns';
import { markerOffsetMs, type OffsetChunk } from './markerOffset';

type DB = D1Database;

let markersReady = false;
export async function ensureMarkersSchema(db: DB): Promise<void> {
  if (markersReady) return;
  await execute(db, `CREATE TABLE IF NOT EXISTS footage_markers (
    id INTEGER PRIMARY KEY AUTOINCREMENT, footage_request_id INTEGER NOT NULL,
    ts_ms INTEGER NOT NULL, offset_ms INTEGER, kind TEXT NOT NULL, type TEXT, severity TEXT,
    label TEXT, lat REAL, lng REAL, heading_deg REAL, turn_dir TEXT,
    created_at TEXT DEFAULT (datetime('now')))`);
  await execute(db, `CREATE INDEX IF NOT EXISTS idx_footage_markers_req ON footage_markers(footage_request_id, offset_ms)`);
  markersReady = true;
}

/** Derive markers for one request from ClearPath events + GPS track. Replaces any
 *  existing markers for that request. Returns the count. Never throws. */
export async function buildFootageMarkers(env: Bindings, requestId: number): Promise<number> {
  const db = getDb(env);
  await ensureMarkersSchema(db);
  const req = await queryFirst<{ id: number; asset_id: number; from_ts: number; to_ts: number }>(
    db, 'SELECT id, asset_id, from_ts, to_ts FROM footage_requests WHERE id=?', requestId).catch(() => null);
  if (!req) return 0;
  const chunks = await query<OffsetChunk>(db,
    'SELECT seq, from_ts, to_ts, status FROM footage_chunks WHERE request_id=? ORDER BY seq', requestId).catch(() => []);

  const client = await getApiConfig(db, env).catch(() => null);
  const markers: Array<{ ts: number; kind: string; type: string | null; severity: string | null; label: string | null; lat: number | null; lng: number | null; heading: number | null; turnDir: string | null }> = [];
  const track: GpsPoint[] = [];
  const hardTurnTimes: number[] = [];

  if (client) {
    const page = await listMedia(env, client, req.asset_id, req.from_ts, req.to_ts, 0, 50).catch(() => null);
    for (const ev of page?.items ?? []) {
      for (const mo of ev.mediaObject) {
        for (const g of mo.gps ?? []) {
          if (Number.isFinite(g.latitude) && Number.isFinite(g.longitude) && g.timestamp) track.push({ lat: g.latitude, lng: g.longitude, ts: g.timestamp });
        }
        const cls = classifyDrivingEvent(mo.eventType);
        if (mo.eventType && cls.type !== 'custom') {
          const ts = ev.eventTimestamp || mo.lastUpdate || req.from_ts;
          markers.push({ ts, kind: 'event', type: cls.type, severity: cls.severity, label: mo.eventType, lat: mo.location?.lat ?? null, lng: mo.location?.lng ?? null, heading: null, turnDir: null });
          if (cls.type === 'hard_turn') hardTurnTimes.push(ts);
        }
      }
    }
  }

  // Turn pins from the GPS track; flag ones near a camera hard-turn event (±3s).
  for (const t of detectTurns(track)) {
    const camera = hardTurnTimes.some((h) => Math.abs(h - t.ts) <= 3000);
    markers.push({ ts: t.ts, kind: camera ? 'camera_hard_turn' : 'gps_turn', type: 'turn', severity: camera ? 'warning' : 'info',
      label: `${t.turnDir} turn`, lat: null, lng: null, heading: t.headingDeg, turnDir: t.turnDir });
  }

  await execute(db, 'DELETE FROM footage_markers WHERE footage_request_id=?', requestId).catch(() => {});
  for (const m of markers) {
    const offset = markerOffsetMs(m.ts, chunks);
    await execute(db, `INSERT INTO footage_markers
      (footage_request_id, ts_ms, offset_ms, kind, type, severity, label, lat, lng, heading_deg, turn_dir)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      requestId, m.ts, offset, m.kind, m.type, m.severity, m.label, m.lat, m.lng, m.heading, m.turnDir).catch(() => {});
  }
  return markers.length;
}
```

- [ ] **Step 2:** `npm run typecheck` → PASS.
- [ ] **Step 3: Commit** `git add src/utils/footage/markers.ts && git commit -m "feat(footage): derive timeline markers (event tags + GPS turn pins) per request"`

---

### Task 5: Marker endpoints on the flexcam router

**Files:** Modify `src/routes/flexcam.ts`

- [ ] **Step 1: Add the markers endpoint + a derive trigger**

Add import: `import { ensureMarkersSchema, buildFootageMarkers } from '../utils/footage/markers';`

Add routes (before `export default flexcam;`):

```ts
// Timeline markers for a request. ?rebuild=1 re-derives from ClearPath events + GPS.
flexcam.get('/footage/:id/markers', async (c): Promise<Response> => {
  const db = getDb(c.env); await ensureMarkersSchema(db);
  const id = Number(c.req.param('id'));
  if (c.req.query('rebuild') === '1') { try { await buildFootageMarkers(c.env, id); } catch { /* best-effort */ } }
  const markers = await query(db,
    'SELECT ts_ms, offset_ms, kind, type, severity, label, lat, lng, heading_deg, turn_dir FROM footage_markers WHERE footage_request_id=? ORDER BY offset_ms', id).catch(() => []);
  return c.json({ markers });
});
```

Also extend `GET /footage/:id` to include markers in its response: after building `manifest`, add
`const markers = await query(db, 'SELECT ts_ms, offset_ms, kind, type, severity, label, heading_deg, turn_dir FROM footage_markers WHERE footage_request_id=? ORDER BY offset_ms', id).catch(() => []);`
and return `{ request: req, manifest, markers }`.

- [ ] **Step 2:** `npm run typecheck` → PASS.
- [ ] **Step 3: Commit** `git add src/routes/flexcam.ts && git commit -m "feat(flexcam): GET /footage/:id/markers + include markers in footage detail"`

---

### Task 6: Verify

- [ ] **Step 1:** `npm run typecheck && npx vitest run` → all PASS (incl. 2 new suites).
- [ ] **Step 2:** Push to the same branch (grows PR #1349): `git push`.

---

## Self-Review
- **Spec coverage (W6):** event tags → Task 4 (`classifyDrivingEvent`). GPS turn pins + camera-hard-turn flag → Tasks 2, 4. marker offset on playable timeline → Task 3. markers exposed for the scrubber → Task 5. Seamless continuous player uses the existing `buildManifest` ordered-chunk list (already returned by `GET /footage/:id`) — client rendering of the player + pins is the **follow-on increment** (noted, not silently dropped).
- **Placeholders:** none.
- **Type consistency:** `GpsPoint`/`TurnMarker` (turns.ts) used in markers.ts; `OffsetChunk` (markerOffset.ts) used in markers.ts + Task 5 query; `bearing` exported in Task 1 before turns.ts imports it.
- **Deferred (next increment):** client viewer — seamless ordered-chunk player + scrubber pin rendering (consumes `GET /footage/:id` manifest + markers).
