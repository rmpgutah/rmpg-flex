# Palantir Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing entity-relationship graph engine (`src/routes/connections.ts`, `client/src/components/ConnectionsGraphPanel.tsx`) with ALPR sightings as graph nodes, a date-range filter, a GPS/ALPR map overlay panel, and forensic case/exhibit nodes — per [docs/superpowers/specs/2026-07-13-palantir-phase1-graph-foundation-design.md](../specs/2026-07-13-palantir-phase1-graph-foundation-design.md).

**Architecture:** All backend work is additive to `connections.ts`'s existing `VALID_TYPES`/`loadNode()`/`findConnections()` switch-per-type pattern — no rewrite of BFS traversal, dedup, or the `MAX_NODES` cap. GPS never becomes graph nodes (too high-volume); it surfaces only in a new map-overlay panel, mirroring the existing `ForensicTrackMap.tsx` Mapbox-embed pattern. Forensic case/exhibit nodes ride on the already-shipped `forensic_case_entity_links` table (PR #2790, merged ahead of this plan).

**Tech Stack:** Hono (Cloudflare Worker), D1, `mapbox-gl` via the app's existing `mapboxLoader`/`mapboxBasemap` helpers, React/TypeScript, Vitest + `@cloudflare/vitest-pool-workers` for Worker tests.

---

## Pre-flight

- [ ] **Step 1: Confirm `forensic_case_entity_links` exists on this branch**

Run: `git log --oneline --all | grep -i "forensic_case_entity_links\|rename forensic_case_links" | head -3`
Expected: shows commit `9639287f5f` (or later) — confirms the forensics PR's rename landed. If this branch is cut from `main` before that PR merged, `git merge origin/main` (or the equivalent for this repo's integration flow) first — Task 4 of this plan depends on that table.

- [ ] **Step 2: Confirm you're on a feature branch, not main**

Run: `git branch --show-current`
Expected: a `claude/...` feature branch.

---

## Task 1: ALPR as graph nodes/edges

**Files:**
- Modify: `src/routes/connections.ts` (`VALID_TYPES` array, `loadNode()` switch, `findConnections()` switch)
- Modify: `client/src/components/ConnectionsGraphPanel.tsx` (`NODE_COLORS`, `NODE_RADIUS`, `GraphNode.type` union)
- Test: `test-workers/connectionsAlpr.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test-workers/connectionsAlpr.test.ts
//
// Route-level test (Miniflare/workerd) confirming ALPR sightings surface
// as graph nodes/edges when traversing from a vehicle, call, or incident.
// alpr_captures is already FK'd to vehicles_records/calls_for_service/
// incidents (migrations 0108-0115) — this proves connections.ts actually
// walks those FKs, which it didn't before this task.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import connections from '../src/routes/connections';

const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
app.use('*', async (c, next) => {
  c.set('user', { id: 1, role: 'admin', username: 'test-analyst' });
  c.set('userId', 1);
  await next();
});
app.route('/api/connections', connections);

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT, role TEXT)`);
  await execute(db, `CREATE TABLE IF NOT EXISTS vehicles_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT, plate_number TEXT, make TEXT, model TEXT, year INTEGER
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS alpr_captures (
    id INTEGER PRIMARY KEY AUTOINCREMENT, sighting_id INTEGER, capture_id TEXT, case_id INTEGER,
    plate TEXT, state TEXT, lat REAL, lng REAL, location_text TEXT, captured_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), call_id INTEGER, incident_id INTEGER,
    vehicle_record_ids TEXT DEFAULT '[]'
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS vehicle_sightings (
    id INTEGER PRIMARY KEY AUTOINCREMENT, plate TEXT, state TEXT, vehicle_id INTEGER,
    location_text TEXT, lat REAL, lng REAL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await execute(db, `INSERT INTO users (id, full_name, role) VALUES (1, 'Test Analyst', 'admin')`);
  await execute(db, `INSERT INTO vehicles_records (id, plate_number, make, model, year) VALUES (1, '8JAR3', 'Dodge', 'RAM', 2022)`);
  await execute(db, `INSERT INTO alpr_captures (id, plate, state, lat, lng, location_text, vehicle_record_ids) VALUES (1, '8JAR3', 'UT', 40.76, -111.89, 'Main St', '[1]')`);
});

describe('ALPR graph nodes', () => {
  it('GET /connections/graph?type=vehicle&id=1 includes the ALPR sighting node', async () => {
    const res = await app.request('/api/connections/graph?type=vehicle&id=1&depth=1', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { nodes: Array<{ type: string; entityId: number; label: string }>; edges: Array<{ relationship: string }> };
    const alprNode = body.nodes.find((n) => n.type === 'alpr_sighting' && n.entityId === 1);
    expect(alprNode).toBeTruthy();
    expect(alprNode?.label).toContain('8JAR3');
    expect(body.edges.some((e) => e.relationship === 'alpr_capture')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:worker -- connectionsAlpr`
Expected: FAIL — `alpr_sighting` is not in `VALID_TYPES`... actually the graph endpoint doesn't validate the *node* type reached via traversal (only the seed `type` query param), so this will fail because no `alpr_sighting` node appears in the response (the vehicle→ALPR join doesn't exist yet in `findConnections()`).

- [ ] **Step 3: Add `alpr_sighting` to `VALID_TYPES`**

In `src/routes/connections.ts`, find:

```typescript
const VALID_TYPES = [
  'person', 'vehicle', 'property', 'business', 'evidence', 'case', 'incident',
  'warrant', 'citation', 'arrest', 'field_interview', 'trespass_order',
  'serve_job', 'call', 'report', 'intel_report',
];
```

Replace with:

```typescript
const VALID_TYPES = [
  'person', 'vehicle', 'property', 'business', 'evidence', 'case', 'incident',
  'warrant', 'citation', 'arrest', 'field_interview', 'trespass_order',
  'serve_job', 'call', 'report', 'intel_report', 'alpr_sighting',
];
```

- [ ] **Step 4: Add the `alpr_sighting` case to `loadNode()`**

In `src/routes/connections.ts`, inside the `loadNode()` function's `switch(type)` block, add a new case (alongside the existing `'evidence'` case at line ~121):

```typescript
      case 'alpr_sighting': {
        // alpr_captures is the ALPR-specific record; vehicle_sightings is
        // the older/plainer plate-log path every ALPR capture also writes
        // to. Try alpr_captures first (richer metadata), fall back to
        // vehicle_sightings for rows with no ALPR counterpart.
        const cap = await queryFirst<any>(db, 'SELECT plate, state, location_text, lat, lng, created_at FROM alpr_captures WHERE id = ?', id);
        if (cap) {
          return {
            label: `${cap.plate || '?'} (${cap.state || '?'}) — ${cap.location_text || 'unknown location'}`,
            metadata: cap,
          };
        }
        const sighting = await queryFirst<any>(db, 'SELECT plate, state, location_text, lat, lng, created_at FROM vehicle_sightings WHERE id = ?', id);
        return {
          label: sighting ? `${sighting.plate || '?'} (${sighting.state || '?'}) — ${sighting.location_text || 'unknown location'}` : `ALPR Sighting #${id}`,
          metadata: sighting || {},
        };
      }
```

- [ ] **Step 5: Add ALPR join branches to `findConnections()`**

In `src/routes/connections.ts`, inside `findConnections()`'s `case 'vehicle':` block, add (after the existing junction-table `add(...)` calls in that case, before its `break;`):

```typescript
        // ALPR sightings for this vehicle — capped at 20 most recent so a
        // frequently-scanned plate can't flood this node's edge count the
        // way MAX_NODES caps the graph overall.
        for (const r of await query<any>(db,
          `SELECT id FROM alpr_captures WHERE vehicle_record_ids LIKE '%' || ? || '%' ORDER BY created_at DESC LIMIT 20`,
          `"${id}"`,
        )) add('alpr_sighting', r.id, 'alpr_capture', 'alpr_captures');
        for (const r of await query<any>(db,
          `SELECT id FROM vehicle_sightings WHERE vehicle_id = ? ORDER BY created_at DESC LIMIT 20`, id,
        )) add('alpr_sighting', r.id, 'alpr_capture', 'vehicle_sightings');
```

Then add two new top-level cases to the same `switch(type)` in `findConnections()` (alongside `case 'evidence':`):

```typescript
      case 'call': {
        for (const r of await query<any>(db,
          `SELECT id FROM alpr_captures WHERE call_id = ? ORDER BY created_at DESC LIMIT 20`, id,
        )) add('alpr_sighting', r.id, 'alpr_capture', 'alpr_captures');
        break;
      }
```

**Note:** if `case 'call':` already exists elsewhere in the switch (check before adding — the plan's Explore pass didn't confirm this one way or the other), merge this query into the EXISTING `case 'call':` block instead of adding a duplicate case (a JS `switch` with two `case 'call':` labels is a silent bug — the second is unreachable). Same caution applies to `case 'incident':` below — this file already has an `incident` case (used by the `'evidence'` case's `add('incident', ...)` calls elsewhere), so add this query into that EXISTING case rather than creating a duplicate:

```typescript
        // (add this query inside the existing case 'incident': block)
        for (const r of await query<any>(db,
          `SELECT id FROM alpr_captures WHERE incident_id = ? ORDER BY created_at DESC LIMIT 20`, id,
        )) add('alpr_sighting', r.id, 'alpr_capture', 'alpr_captures');
```

- [ ] **Step 6: Add `alpr_sighting` styling to the client graph panel**

In `client/src/components/ConnectionsGraphPanel.tsx`, add to `NODE_COLORS`:

```typescript
  alpr_sighting: '#06b6d4',
```

And to `NODE_RADIUS`:

```typescript
  alpr_sighting: 14,
```

If `GraphNode['type']` is a string literal union (not a plain `string`) anywhere in this file, add `'alpr_sighting'` to it too — check by searching for `type:` in an interface/type near the top of the file.

- [ ] **Step 7: Run test to verify it passes**

Run: `npm run test:worker -- connectionsAlpr`
Expected: PASS (1 test).

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck && cd client && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add src/routes/connections.ts client/src/components/ConnectionsGraphPanel.tsx test-workers/connectionsAlpr.test.ts
git commit -m "feat(connections): add ALPR sightings as graph nodes for vehicle/call/incident"
```

---

## Task 2: Timeline date-range filter

**Files:**
- Modify: `src/routes/connections.ts` (`buildGraph()`, `GET /graph` route)
- Modify: `client/src/components/ConnectionsGraphPanel.tsx` (date-range control)
- Test: `test-workers/connectionsDateFilter.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test-workers/connectionsDateFilter.test.ts
//
// Confirms GET /connections/graph?date_from=&date_to= excludes dated
// nodes (incident/call/citation/etc.) outside the range while always
// including undated node types (person/vehicle/property/...) — an
// investigator shouldn't lose a person from the graph just because
// they're time-filtering incidents.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import connections from '../src/routes/connections';

const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
app.use('*', async (c, next) => {
  c.set('user', { id: 1, role: 'admin', username: 'test-analyst' });
  c.set('userId', 1);
  await next();
});
app.route('/api/connections', connections);

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT, role TEXT)`);
  await execute(db, `CREATE TABLE IF NOT EXISTS persons (id INTEGER PRIMARY KEY AUTOINCREMENT, first_name TEXT, last_name TEXT)`);
  await execute(db, `CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT, incident_number TEXT, incident_type TEXT,
    occurred_date TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), status TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS incident_persons (id INTEGER PRIMARY KEY AUTOINCREMENT, incident_id INTEGER, person_id INTEGER, role TEXT)`);
  await execute(db, `INSERT INTO users (id, full_name, role) VALUES (1, 'Test Analyst', 'admin')`);
  await execute(db, `INSERT INTO persons (id, first_name, last_name) VALUES (1, 'Jane', 'Doe')`);
  await execute(db, `INSERT INTO incidents (id, incident_number, incident_type, occurred_date) VALUES (1, 'INC-1', 'theft', '2026-01-15')`);
  await execute(db, `INSERT INTO incidents (id, incident_number, incident_type, occurred_date) VALUES (2, 'INC-2', 'assault', '2026-06-15')`);
  await execute(db, `INSERT INTO incident_persons (incident_id, person_id, role) VALUES (1, 1, 'suspect'), (2, 1, 'suspect')`);
});

describe('Date-range filtering', () => {
  it('excludes an out-of-range incident but keeps the undated person node', async () => {
    const res = await app.request(
      '/api/connections/graph?type=person&id=1&depth=1&date_from=2026-06-01&date_to=2026-06-30',
      {}, env as unknown as Record<string, unknown>,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { nodes: Array<{ type: string; entityId: number }> };
    expect(body.nodes.some((n) => n.type === 'person' && n.entityId === 1)).toBe(true);
    expect(body.nodes.some((n) => n.type === 'incident' && n.entityId === 2)).toBe(true);
    expect(body.nodes.some((n) => n.type === 'incident' && n.entityId === 1)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:worker -- connectionsDateFilter`
Expected: FAIL — `date_from`/`date_to` are silently ignored today, so both incidents appear.

- [ ] **Step 3: Add a date-field map and post-filter to `buildGraph()`**

In `src/routes/connections.ts`, near the existing `TIMELINE_TABLE`/`TIMELINE_QUERY` maps (reuse `TIMELINE_TABLE` directly; add one new map), add:

```typescript
// Canonical "when did this happen" column per node type, for date-range
// filtering. Deliberately a SUBSET of VALID_TYPES — person/vehicle/
// property/business/etc. have no single occurrence date, so they're
// never filtered by range (an investigator shouldn't lose a person from
// the graph just because they're time-filtering incidents).
const DATE_FIELD: Record<string, string> = {
  incident: 'occurred_date', call: 'created_at', citation: 'violation_date',
  warrant: 'issued_date', arrest: 'booking_date', field_interview: 'created_at',
  trespass_order: 'effective_date', case: 'created_at', evidence: 'created_at',
  intel_report: 'disseminated_at', alpr_sighting: 'created_at',
};
```

Modify `buildGraph()`'s signature and add a post-BFS filter step. Find:

```typescript
async function buildGraph(
  db: D1Database,
  seedType: string,
  seedId: number,
  maxDepth = 2,
): Promise<{ nodes: GNode[]; edges: GEdge[] }> {
```

Replace with:

```typescript
async function buildGraph(
  db: D1Database,
  seedType: string,
  seedId: number,
  maxDepth = 2,
  dateFrom?: string,
  dateTo?: string,
): Promise<{ nodes: GNode[]; edges: GEdge[] }> {
```

Find the function's final line:

```typescript
  return { nodes: Array.from(nodeMap.values()), edges };
}
```

Replace with:

```typescript
  let nodes = Array.from(nodeMap.values());
  if (dateFrom || dateTo) {
    nodes = await filterNodesByDateRange(db, nodes, dateFrom, dateTo);
    const keptKeys = new Set(nodes.map((n) => n.id));
    const filteredEdges = edges.filter((e) => keptKeys.has(e.source) && keptKeys.has(e.target));
    return { nodes, edges: filteredEdges };
  }
  return { nodes, edges };
}

// Batches by type (one query per type present in the node set, using an
// IN(...) clause) rather than one query per node — avoids the N+1 pattern
// the Task 2 hash-endpoint code review flagged in the forensics work.
// Nodes whose type has no DATE_FIELD entry (person/vehicle/property/...)
// always pass through unfiltered.
async function filterNodesByDateRange(
  db: D1Database, nodes: GNode[], dateFrom?: string, dateTo?: string,
): Promise<GNode[]> {
  const byType = new Map<string, number[]>();
  for (const n of nodes) {
    if (!DATE_FIELD[n.type]) continue;
    byType.set(n.type, [...(byType.get(n.type) || []), n.entityId]);
  }
  const inRange = new Set<string>();
  for (const [type, ids] of byType) {
    const table = TIMELINE_TABLE[type];
    const col = DATE_FIELD[type];
    if (!table) continue;
    try {
      const ph = ids.map(() => '?').join(',');
      const conditions: string[] = [`id IN (${ph})`];
      const params: unknown[] = [...ids];
      if (dateFrom) { conditions.push(`${col} >= ?`); params.push(dateFrom); }
      if (dateTo) { conditions.push(`${col} <= ?`); params.push(dateTo); }
      const rows = await query<{ id: number }>(db, `SELECT id FROM ${table} WHERE ${conditions.join(' AND ')}`, ...params);
      for (const r of rows) inRange.add(`${type}-${r.id}`);
    } catch (err) {
      console.error(`[Connections] date-filter ${type} error:`, (err as Error)?.message);
    }
  }
  return nodes.filter((n) => !DATE_FIELD[n.type] || inRange.has(n.id));
}
```

- [ ] **Step 4: Wire the new params into the `GET /graph` route**

In `src/routes/connections.ts`, find:

```typescript
  const maxDepth = Math.min(Math.max(Number(depth) || 2, 1), 3);
  const graph = await buildGraph(getDb(c.env), type, Number(id), maxDepth);
```

Replace with:

```typescript
  const maxDepth = Math.min(Math.max(Number(depth) || 2, 1), 3);
  const dateFrom = c.req.query('date_from') || undefined;
  const dateTo = c.req.query('date_to') || undefined;
  const graph = await buildGraph(getDb(c.env), type, Number(id), maxDepth, dateFrom, dateTo);
```

- [ ] **Step 5: Add a date-range control to the client panel**

In `client/src/components/ConnectionsGraphPanel.tsx`, add two new pieces of state near the existing `hoveredNode`/`loading` state:

```typescript
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
```

Update the fetch call (found in Step in Task 1's Explore notes at `fetchGraph`) to include the range and re-fetch when it changes:

```typescript
  const fetchGraph = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ type: 'person', id: String(personId), depth: '1' });
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      const data = await apiFetch<{ nodes: any[]; edges: any[] }>(`/connections/graph?${params}`);
```

(Keep the rest of `fetchGraph`'s body unchanged — only the URL construction changes. Add `dateFrom, dateTo` to the `useCallback` dependency array, and confirm the existing `useEffect` that calls `fetchGraph()` re-runs when those change — if that `useEffect`'s dependency array is `[fetchGraph]`, no further change is needed since `fetchGraph` itself changes identity when `dateFrom`/`dateTo` change.)

Add simple date inputs to the component's toolbar JSX (wherever `SAVE INVESTIGATION`/`EXPORT PNG` buttons live per the live app's toolbar — locate that JSX region and add alongside it):

```tsx
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="px-2 py-1 text-xs bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100"
          aria-label="Filter from date"
        />
        <span className="text-rmpg-500 text-xs">to</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="px-2 py-1 text-xs bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100"
          aria-label="Filter to date"
        />
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test:worker -- connectionsDateFilter`
Expected: PASS (1 test).

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck && cd client && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/routes/connections.ts client/src/components/ConnectionsGraphPanel.tsx test-workers/connectionsDateFilter.test.ts
git commit -m "feat(connections): add date-range filtering to the graph endpoint and panel"
```

---

## Task 3: GPS/geo map overlay panel

**Files:**
- Modify: `src/routes/connections.ts` (two new read-only endpoints)
- Create: `client/src/components/ConnectionsMapPanel.tsx`
- Modify: `client/src/pages/ConnectionsPage.tsx` (mount the new panel)
- Test: `test-workers/connectionsGeo.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test-workers/connectionsGeo.test.ts
//
// Read-only GPS-track and geo-point endpoints backing the map overlay
// panel. GPS never becomes graph NODES (too high-volume — see the
// design spec's non-goals) — this is purely a detail view for whatever
// node is currently selected in the graph.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import connections from '../src/routes/connections';

const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
app.use('*', async (c, next) => {
  c.set('user', { id: 1, role: 'admin', username: 'test-analyst' });
  c.set('userId', 1);
  await next();
});
app.route('/api/connections', connections);

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT, role TEXT)`);
  await execute(db, `CREATE TABLE IF NOT EXISTS units (id INTEGER PRIMARY KEY AUTOINCREMENT, call_sign TEXT, officer_id INTEGER)`);
  await execute(db, `CREATE TABLE IF NOT EXISTS gps_breadcrumbs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, unit_id INTEGER, officer_id INTEGER,
    latitude REAL, longitude REAL, current_call_id INTEGER,
    recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS alpr_captures (
    id INTEGER PRIMARY KEY AUTOINCREMENT, plate TEXT, lat REAL, lng REAL,
    call_id INTEGER, incident_id INTEGER, vehicle_record_ids TEXT DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await execute(db, `INSERT INTO users (id, full_name, role) VALUES (1, 'Test Analyst', 'admin')`);
  await execute(db, `INSERT INTO units (id, call_sign, officer_id) VALUES (1, 'P12', 5)`);
  await execute(db, `INSERT INTO gps_breadcrumbs (unit_id, officer_id, latitude, longitude) VALUES (1, 5, 40.76, -111.89)`);
  await execute(db, `INSERT INTO alpr_captures (plate, lat, lng, call_id) VALUES ('8JAR3', 40.77, -111.90, 42)`);
});

describe('Map overlay endpoints', () => {
  it('GET /connections/person/5/gps-track returns breadcrumbs for the officer\'s units', async () => {
    const res = await app.request('/api/connections/person/5/gps-track', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ lat: number; lng: number }> };
    expect(body.data.length).toBe(1);
    expect(body.data[0].lat).toBeCloseTo(40.76);
  });

  it('GET /connections/call/42/geo-points returns ALPR pins for the call', async () => {
    const res = await app.request('/api/connections/call/42/geo-points', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ lat: number; lng: number; source: string }> };
    expect(body.data.length).toBe(1);
    expect(body.data[0].source).toBe('alpr');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:worker -- connectionsGeo`
Expected: FAIL — both routes 404.

- [ ] **Step 3: Add the two endpoints to `connections.ts`**

Add near the end of `src/routes/connections.ts`, before its final export:

```typescript
// ═══════════════════════════════════════════════════════════════
// MAP OVERLAY — read-only detail views, NOT graph nodes (see design
// spec non-goals: GPS breadcrumbs are too high-volume to graph 1:1).
// ═══════════════════════════════════════════════════════════════

// GET /:type/:id/gps-track?date_from=&date_to= — for a person node,
// resolves their assigned units (units.officer_id) and returns
// gps_breadcrumbs for those units. For a call node, returns breadcrumbs
// where current_call_id matches. Any other type returns an empty array
// rather than an error, keeping the map panel silent for node types
// with no GPS relevance.
connections.get('/:type/:id/gps-track', operational, async (c) => {
  try {
    const db = getDb(c.env);
    const type = c.req.param('type');
    const id = Number(c.req.param('id'));
    if (isNaN(id)) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
    const dateFrom = c.req.query('date_from');
    const dateTo = c.req.query('date_to');
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (type === 'person') {
      conditions.push('officer_id = ?');
      params.push(id);
    } else if (type === 'call') {
      conditions.push('current_call_id = ?');
      params.push(id);
    } else {
      return c.json({ data: [] });
    }
    if (dateFrom) { conditions.push('recorded_at >= ?'); params.push(dateFrom); }
    if (dateTo) { conditions.push('recorded_at <= ?'); params.push(dateTo); }

    const rows = await query<{ latitude: number; longitude: number; recorded_at: string }>(
      db,
      `SELECT latitude, longitude, recorded_at FROM gps_breadcrumbs WHERE ${conditions.join(' AND ')} ORDER BY recorded_at ASC LIMIT 2000`,
      ...params,
    );
    return c.json({ data: rows.map((r) => ({ lat: r.latitude, lng: r.longitude, recorded_at: r.recorded_at })) });
  } catch (err) {
    console.error('[Connections] gps-track error:', (err as Error)?.message);
    return c.json({ data: [] });
  }
});

// GET /:type/:id/geo-points?date_from=&date_to= — for vehicle/call/
// incident nodes, returns ALPR capture lat/lng as pins (source: 'alpr').
connections.get('/:type/:id/geo-points', operational, async (c) => {
  try {
    const db = getDb(c.env);
    const type = c.req.param('type');
    const id = Number(c.req.param('id'));
    if (isNaN(id)) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
    const dateFrom = c.req.query('date_from');
    const dateTo = c.req.query('date_to');
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (type === 'vehicle') {
      conditions.push(`vehicle_record_ids LIKE '%' || ? || '%'`);
      params.push(`"${id}"`);
    } else if (type === 'call') {
      conditions.push('call_id = ?');
      params.push(id);
    } else if (type === 'incident') {
      conditions.push('incident_id = ?');
      params.push(id);
    } else {
      return c.json({ data: [] });
    }
    if (dateFrom) { conditions.push('created_at >= ?'); params.push(dateFrom); }
    if (dateTo) { conditions.push('created_at <= ?'); params.push(dateTo); }

    const rows = await query<{ lat: number; lng: number; created_at: string; plate: string }>(
      db,
      `SELECT lat, lng, created_at, plate FROM alpr_captures WHERE ${conditions.join(' AND ')} AND lat IS NOT NULL ORDER BY created_at DESC LIMIT 500`,
      ...params,
    );
    return c.json({ data: rows.map((r) => ({ lat: r.lat, lng: r.lng, source: 'alpr', label: r.plate, recorded_at: r.created_at })) });
  } catch (err) {
    console.error('[Connections] geo-points error:', (err as Error)?.message);
    return c.json({ data: [] });
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:worker -- connectionsGeo`
Expected: PASS (2 tests).

- [ ] **Step 5: Create the map panel component**

Create `client/src/components/ConnectionsMapPanel.tsx`, modeled directly on the existing `ForensicTrackMap.tsx` (`initMapbox`/`mapboxgl`/`MAPBOX_STYLE_DARK`/`registerMapInstance`/`applyRmpgBasemap` pattern — read that file first for the exact init sequence):

```tsx
// ============================================================
// RMPG Flex — Connections Map Overlay Panel (Mapbox)
// ============================================================
// Read-only geo detail view for the currently-selected graph node.
// GPS breadcrumbs and ALPR sightings are NOT graph nodes (too
// high-volume) — this panel is the only place they're geo-rendered,
// reusing the mapboxLoader/mapboxBasemap init pattern from
// ForensicTrackMap.tsx rather than a new map integration.
// ============================================================
import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { initMapbox, mapboxgl, MAPBOX_STYLE_DARK, registerMapInstance, unregisterMapInstance } from '../utils/mapboxLoader';
import { getMapboxAccessToken } from '../utils/mapboxApiKey';
import { applyRmpgBasemap } from '../utils/mapboxBasemap';
import { buildDotMarker, isValidLngLat } from '../utils/mapMarkers';
import { apiFetch } from '../hooks/useApi';

const CYAN = '#06b6d4';

interface Props {
  nodeType: string;
  nodeEntityId: number;
  dateFrom?: string;
  dateTo?: string;
  height?: number;
}

export default function ConnectionsMapPanel({ nodeType, nodeEntityId, dateFrom, dateTo, height = 220 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const [loading, setLoading] = useState(true);
  const [pointCount, setPointCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (dateFrom) params.set('date_from', dateFrom);
        if (dateTo) params.set('date_to', dateTo);
        const [trackRes, geoRes] = await Promise.all([
          apiFetch<{ data: Array<{ lat: number; lng: number }> }>(`/connections/${nodeType}/${nodeEntityId}/gps-track?${params}`).catch(() => ({ data: [] })),
          apiFetch<{ data: Array<{ lat: number; lng: number; label?: string }> }>(`/connections/${nodeType}/${nodeEntityId}/geo-points?${params}`).catch(() => ({ data: [] })),
        ]);
        if (cancelled) return;
        const track = (trackRes.data || []).filter((p) => isValidLngLat(p.lng, p.lat));
        const points = (geoRes.data || []).filter((p) => isValidLngLat(p.lng, p.lat));
        setPointCount(track.length + points.length);

        const token = await getMapboxAccessToken();
        if (cancelled || !containerRef.current) return;
        initMapbox(token);
        const first = track[0] || points[0];
        const center: [number, number] = first ? [first.lng, first.lat] : [-111.891, 40.7608];
        const map = new mapboxgl.Map({ container: containerRef.current, style: MAPBOX_STYLE_DARK, center, zoom: 12, attributionControl: false });
        mapRef.current = map;
        registerMapInstance(map);
        map.on('style.load', () => applyRmpgBasemap(map, { variant: 'dark' }));
        map.on('load', () => {
          if (cancelled) return;
          if (track.length > 1) {
            const line = track.map((p) => [p.lng, p.lat]);
            map.addSource('gps-track', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } } });
            map.addLayer({ id: 'gps-track', type: 'line', source: 'gps-track', paint: { 'line-color': CYAN, 'line-width': 3, 'line-opacity': 0.85 } });
          }
          for (const p of points) {
            const el = buildDotMarker({ color: '#ef4444', size: 10 });
            const m = new mapboxgl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map);
            markersRef.current.push(m);
          }
          const all = [...track, ...points];
          if (all.length > 1) {
            const b = all.reduce((acc, pt) => acc.extend([pt.lng, pt.lat]), new mapboxgl.LngLatBounds([all[0].lng, all[0].lat], [all[0].lng, all[0].lat]));
            map.fitBounds(b, { padding: 32, maxZoom: 15, duration: 0 });
          }
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      if (mapRef.current) { unregisterMapInstance(mapRef.current); mapRef.current.remove(); mapRef.current = null; }
    };
  }, [nodeType, nodeEntityId, dateFrom, dateTo]);

  return (
    <div className="relative panel-beveled bg-surface-sunken" style={{ height }}>
      <div ref={containerRef} className="absolute inset-0" />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-sunken/80">
          <Loader2 size={20} className="animate-spin text-brand-400" />
        </div>
      )}
      {!loading && pointCount === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-rmpg-500">
          No geo data for this entity.
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Mount the panel in `ConnectionsPage.tsx`**

Read `client/src/pages/ConnectionsPage.tsx` to find where a node's selection state lives (per the Task 1 Explore notes, `ConnectionsGraphPanel.tsx` currently has no click handler — check whether `ConnectionsPage.tsx` itself tracks a "selected node" separately, e.g. via the search bar's currently-searched entity). Mount `<ConnectionsMapPanel nodeType={...} nodeEntityId={...} dateFrom={...} dateTo={...} />` in a sensible location — a collapsible section below or beside the graph panel, following whatever panel-layout convention `ConnectionsPage.tsx` already uses for its other sections (the toolbar row with SAVE/EXPORT buttons visible in the live page suggests this file already has a multi-panel layout to fit into). If `ConnectionsGraphPanel.tsx` has no way to report the currently-selected node up to `ConnectionsPage.tsx`, add a minimal `onNodeSelect?: (type: string, entityId: number) => void` prop, called from the existing (currently inert) node click affordance noted in Task 1's Explore pass (`cursor: 'pointer'` was already set but never wired to a handler) — wire an `onClick` on each node `<g>` that calls `onNodeSelect(n.type, n.entityId)`.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck && cd client && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/routes/connections.ts client/src/components/ConnectionsMapPanel.tsx client/src/pages/ConnectionsPage.tsx client/src/components/ConnectionsGraphPanel.tsx test-workers/connectionsGeo.test.ts
git commit -m "feat(connections): add GPS/ALPR map overlay panel for the selected graph node"
```

---

## Task 4: Forensics tie-in

**Files:**
- Modify: `src/routes/connections.ts` (`VALID_TYPES`, `loadNode()`, `findConnections()`)
- Modify: `client/src/components/ConnectionsGraphPanel.tsx` (`NODE_COLORS`, `NODE_RADIUS`)
- Test: `test-workers/connectionsForensics.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test-workers/connectionsForensics.test.ts
//
// Confirms forensic cases become graph nodes, reachable from a linked
// entity via the forensic_case_entity_links table (shipped in PR #2790)
// exactly the way record_links is already queried bidirectionally.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import connections from '../src/routes/connections';

const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
app.use('*', async (c, next) => {
  c.set('user', { id: 1, role: 'admin', username: 'test-analyst' });
  c.set('userId', 1);
  await next();
});
app.route('/api/connections', connections);

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT, role TEXT)`);
  await execute(db, `CREATE TABLE IF NOT EXISTS persons (id INTEGER PRIMARY KEY AUTOINCREMENT, first_name TEXT, last_name TEXT)`);
  await execute(db, `CREATE TABLE IF NOT EXISTS forensic_cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT, lab_number TEXT, title TEXT,
    received_date TEXT NOT NULL DEFAULT (datetime('now')), status TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS forensic_case_entity_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT, forensic_case_id INTEGER NOT NULL,
    entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL, entity_label TEXT,
    relationship TEXT NOT NULL DEFAULT 'related', linked_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await execute(db, `INSERT INTO users (id, full_name, role) VALUES (1, 'Test Analyst', 'admin')`);
  await execute(db, `INSERT INTO persons (id, first_name, last_name) VALUES (1, 'Jane', 'Doe')`);
  await execute(db, `INSERT INTO forensic_cases (id, lab_number, title) VALUES (1, 'LAB-26-0010', 'DNA Case')`);
  await execute(db, `INSERT INTO forensic_case_entity_links (forensic_case_id, entity_type, entity_id, entity_label, relationship) VALUES (1, 'person', 1, 'Doe, Jane', 'suspect')`);
});

describe('Forensic case graph nodes', () => {
  it('GET /connections/graph?type=person&id=1 includes the linked forensic case', async () => {
    const res = await app.request('/api/connections/graph?type=person&id=1&depth=1', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { nodes: Array<{ type: string; entityId: number; label: string }> };
    const fcNode = body.nodes.find((n) => n.type === 'forensic_case' && n.entityId === 1);
    expect(fcNode).toBeTruthy();
    expect(fcNode?.label).toContain('LAB-26-0010');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:worker -- connectionsForensics`
Expected: FAIL — `forensic_case` not in `VALID_TYPES`, no join exists yet.

- [ ] **Step 3: Add `forensic_case`/`forensic_exhibit` to `VALID_TYPES`**

```typescript
const VALID_TYPES = [
  'person', 'vehicle', 'property', 'business', 'evidence', 'case', 'incident',
  'warrant', 'citation', 'arrest', 'field_interview', 'trespass_order',
  'serve_job', 'call', 'report', 'intel_report', 'alpr_sighting',
  'forensic_case', 'forensic_exhibit',
];
```

- [ ] **Step 4: Add `loadNode()` cases**

```typescript
      case 'forensic_case': {
        const fc = await queryFirst<any>(db, 'SELECT lab_number, title, status, received_date FROM forensic_cases WHERE id = ?', id);
        return { label: fc ? `${fc.lab_number || ''} — ${fc.title || ''}`.trim() || `Forensic Case #${id}` : `Forensic Case #${id}`, metadata: fc || {} };
      }
      case 'forensic_exhibit': {
        const fe = await queryFirst<any>(db, 'SELECT exhibit_number, description, disposition FROM forensic_exhibits WHERE id = ?', id);
        return { label: fe ? `${fe.exhibit_number || ''} — ${fe.description || ''}`.trim() || `Exhibit #${id}` : `Exhibit #${id}`, metadata: fe || {} };
      }
```

- [ ] **Step 5: Add bidirectional `forensic_case_entity_links` lookup**

Find the existing generic `record_links` bidirectional query block (per the Task-1 Explore notes, around `connections.ts:202-222` — queried for EVERY node type, not inside the `switch`). Add a parallel query for `forensic_case_entity_links` in the same spot, since it follows the identical bidirectional pattern but is a separate table:

```typescript
  // forensic_case_entity_links — same bidirectional pattern as record_links
  // above, but a separate table (shipped in the forensics government-
  // standard PR) rather than the generic cross-link table.
  try {
    for (const r of await query<any>(db,
      `SELECT forensic_case_id, entity_type, entity_id, relationship FROM forensic_case_entity_links
       WHERE (entity_type = ? AND entity_id = ?)`, type, id,
    )) add('forensic_case', r.forensic_case_id, r.relationship || 'linked', 'forensic_case_entity_links');

    if (type === 'forensic_case') {
      for (const r of await query<any>(db,
        `SELECT entity_type, entity_id, relationship FROM forensic_case_entity_links WHERE forensic_case_id = ?`, id,
      )) add(r.entity_type, r.entity_id, r.relationship || 'linked', 'forensic_case_entity_links');
    }
  } catch (err) {
    console.error('[Connections] forensic_case_entity_links error:', (err as Error)?.message);
  }
```

(Match this to whatever local variable name the existing `record_links` block uses for `add(...)` — per the Task-1 Explore pass, `findConnections()` has a local `add()` helper used throughout; reuse it, don't redefine.)

- [ ] **Step 6: Add exhibit reachability from a forensic case**

In `findConnections()`, add a new case:

```typescript
      case 'forensic_case': {
        for (const r of await query<any>(db, 'SELECT id FROM forensic_exhibits WHERE forensic_case_id = ?', id))
          add('forensic_exhibit', r.id, 'exhibit_of', 'forensic_exhibits');
        break;
      }
```

- [ ] **Step 7: Add client styling**

In `client/src/components/ConnectionsGraphPanel.tsx`:

```typescript
  forensic_case: '#a3e635',
  forensic_exhibit: '#84cc16',
```

(add to `NODE_COLORS`), and:

```typescript
  forensic_case: 18,
  forensic_exhibit: 14,
```

(add to `NODE_RADIUS`).

- [ ] **Step 8: Run test to verify it passes**

Run: `npm run test:worker -- connectionsForensics`
Expected: PASS (1 test).

- [ ] **Step 9: Typecheck**

Run: `npm run typecheck && cd client && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add src/routes/connections.ts client/src/components/ConnectionsGraphPanel.tsx test-workers/connectionsForensics.test.ts
git commit -m "feat(connections): add forensic case/exhibit nodes via forensic_case_entity_links"
```

---

## Task 5: Full verification pass

- [ ] **Step 1: Run the full Worker test suite**

Run: `npm run test:worker`
Expected: all 4 new test files pass (`connectionsAlpr`, `connectionsDateFilter`, `connectionsGeo`, `connectionsForensics`); no regressions elsewhere (compare against the known pre-existing `dispatchCallClose`/`panicSafetyFixes` failures from the prior PR's verification — those are unrelated to this branch and expected to still fail identically if present).

- [ ] **Step 2: Worker + client typecheck**

Run: `npm run typecheck && cd client && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Client build**

Run: `cd client && npx vite build`
Expected: succeeds.

- [ ] **Step 4: Manual smoke check against a real graph**

This step needs a real D1 dataset with actual ALPR/GPS/forensic rows to be meaningful — Miniflare tests use synthetic data. If a local D1 with real-shaped data is available (`npm run migrate:local` + any seed scripts this repo has), open the Connections page for a person or vehicle known to have ALPR sightings and confirm: the alpr_sighting nodes render with the new cyan color, the date-range inputs actually narrow the graph, and clicking a node updates the new map panel. If no such dataset is available in this environment, note that this step is deferred to a live/staging smoke test post-merge rather than skipped silently.

- [ ] **Step 5: Commit note**

No new migration in this plan (Task 4 depends entirely on the already-shipped `forensic_case_entity_links` table from PR #2790) — nothing to apply to live D1 beyond what that PR already covers.

---

## Spec Coverage Checklist

- [x] ALPR sightings as graph nodes/edges (vehicle/call/incident) — Task 1
- [x] Timeline date-range filtering on the graph endpoint + client control — Task 2
- [x] GPS/ALPR map overlay panel (read-only, not graph nodes) — Task 3
- [x] Forensic case/exhibit nodes via `forensic_case_entity_links` — Task 4
- [x] Worker test coverage for all 4 additions — Tasks 1-4
- [x] No graph-library swap, no GPS clustering, no investigation boards, no AI features — respected per the spec's explicit non-goals; nothing in this plan touches those areas

Not covered by this plan (deferred to future phases per the original Palantir roadmap discussion): investigation workbench (Phase 2), advanced visualization/graph-library swap (Phase 3), AI-assisted analysis (Phase 4).
