# Connections — Full Analyst Tool Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn the half-wired Connections feature into a real link-analysis tool: expand server-side graph to include warrants/citations/arrests/field-interviews/trespass/serve edges, fix the broken CSV export, replace the stub client panel with a new ConnectionsPage offering pan/zoom, depth slider, type filters, shortest-path search, saved investigations with annotations, and PDF/PNG export.

**Architecture:**
- **Server:** Extend `findConnections()` in [server/src/routes/connections.ts](../../server/src/routes/connections.ts) with 7 new edge sources. Add new endpoints `/connections/path`, `/connections/investigations` CRUD, `/connections/suggestions`. Introduce 3 new junction tables to replace `LIKE '%id%'` JSON-column scans. Per-request label/metadata caching. Fix CSV export to include computed edges.
- **Client:** New `client/src/pages/ConnectionsPage.tsx` using `d3-force` + `d3-zoom`. Keep existing `ConnectionsGraphPanel` as embedded mini-view but re-point it at `/connections/graph`. New `connection_investigations` schema stores seed, pinned layout, annotations. Export via `jsPDF` (already in tree) and canvas rasterization.
- **Schema:** 4 new tables (`case_person_links`, `case_incident_links`, `case_evidence_links`, `connection_investigations`) + a backfill for the cases JSON columns.

**Tech Stack:** Express 5 + better-sqlite3 (server), React 18 + TypeScript + Vite (client), `d3-force` + `d3-zoom` (new deps, ~30kb gz), `jsPDF` (existing), Vitest (tests).

**Non-negotiable ground rules:**
- Every task is TDD: failing test → impl → passing test → commit.
- Server route handlers: preserve existing `requireRole('admin','manager','supervisor','officer','dispatcher')` pattern from [connections.ts:411](../../server/src/routes/connections.ts:411). All new endpoints use `authenticateToken` + `auditLog()`.
- **Do NOT deploy until Phase 6 review.** Use `npm run dev` + Vitest locally.
- Follow CLAUDE.md Gotcha #42: do not use the better-sqlite3 bulk-execute method in `database.ts` — use `db.prepare().run()`.
- Follow CLAUDE.md Gotcha #21: 0 TypeScript errors required (`npx tsc --noEmit` gate).
- Follow CLAUDE.md Gotcha #43: deploy from main workspace, not this worktree, once we ship.
- Suggest-hidden-links is **rule-based only**, gated behind admin toggle, labeled "Heuristic — not evidence."
- Investigations default to **private to creator**, with explicit share-list (never role-wide).

---

## Phase 0 — Preflight (15 min)

### Task 0.1: Verify server suite is green before touching code

**Step 1:** Run the existing suite.

```bash
cd server && npx vitest run
```

Expected: 461 tests pass across 39 files in ~3s (per CLAUDE.md).
If red: STOP. Do not proceed. Fix pre-existing failures first (unrelated to this plan).

**Step 2:** Run typecheck.

```bash
cd server && npx tsc --noEmit
cd ../client && npx tsc --noEmit
```

Expected: 0 errors on both.

**Step 3:** Commit a marker.

```bash
git checkout -b claude/connections-analyst-tool
git commit --allow-empty -m "chore(connections): start analyst-tool feature branch"
```

---

## Phase 1 — Fix what's broken (foundational, ~3 hours)

### Task 1.1: Write failing integration test for `/api/connections/graph` returning a person's full graph

**Files:**
- Create: `server/tests/integration/connections.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { setupTestDataDir, teardownTestDataDir, createTestAdmin } from '../helpers/testDb';

let app: Application;
let testDir: string;
let adminToken: string;
let personId: number;
let incidentId: number;

beforeAll(async () => {
  testDir = setupTestDataDir();
  const { initDatabase, getDb } = await import('../../src/models/database');
  const db = initDatabase();
  const admin = createTestAdmin(db);
  const { createTestApp } = await import('../helpers/testApp');
  app = await createTestApp();

  // Login
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ username: admin.username, password: admin.password });
  adminToken = loginRes.body.token;

  // Seed data: 1 person, 1 incident, 1 incident_persons link
  const d = getDb();
  personId = Number(d.prepare(
    "INSERT INTO persons (first_name, last_name, dob) VALUES ('Test', 'Suspect', '1990-01-01')"
  ).run().lastInsertRowid);
  incidentId = Number(d.prepare(
    "INSERT INTO incidents (incident_number, incident_type, status) VALUES ('I-0001', 'Burglary', 'OPEN')"
  ).run().lastInsertRowid);
  d.prepare(
    "INSERT INTO incident_persons (incident_id, person_id, role) VALUES (?, ?, 'suspect')"
  ).run(incidentId, personId);
});

afterAll(() => { teardownTestDataDir(testDir); });

describe('GET /api/connections/graph', () => {
  it('returns graph with person seed + connected incident at depth 2', async () => {
    const res = await request(app)
      .get(`/api/connections/graph?type=person&id=${personId}&depth=2`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.nodes).toHaveLength(2);
    expect(res.body.nodes.find((n: any) => n.type === 'person')).toBeTruthy();
    expect(res.body.nodes.find((n: any) => n.type === 'incident')).toBeTruthy();
    expect(res.body.edges).toHaveLength(1);
    expect(res.body.edges[0].relationship).toBe('suspect');
  });

  it('rejects invalid type with 400', async () => {
    const res = await request(app)
      .get(`/api/connections/graph?type=unicorn&id=1&depth=2`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await request(app).get(`/api/connections/graph?type=person&id=${personId}`);
    expect(res.status).toBe(401);
  });
});
```

**Step 2: Run and verify it passes** (it should — endpoint already exists).

```bash
cd server && npx vitest run tests/integration/connections.test.ts
```

Expected: all 3 pass. This test locks current behavior before we modify.

**Step 3: Commit**

```bash
git add server/tests/integration/connections.test.ts
git commit -m "test(connections): lock baseline graph behavior"
```

### Task 1.2: Point client panel at the correct endpoint

**Files:**
- Modify: `client/src/components/ConnectionsGraphPanel.tsx:113-208` (the `fetchGraph` callback)

**Step 1: Write failing test (client-side — add to `client/src/components/__tests__/ConnectionsGraphPanel.test.tsx`)**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import ConnectionsGraphPanel from '../ConnectionsGraphPanel';

const mockFetch = vi.fn();
vi.mock('../../hooks/useApi', () => ({
  apiFetch: (url: string) => mockFetch(url),
}));

describe('ConnectionsGraphPanel', () => {
  beforeEach(() => { mockFetch.mockReset(); });

  it('calls /connections/graph with the person id', async () => {
    mockFetch.mockResolvedValueOnce({ nodes: [], edges: [] });
    render(<ConnectionsGraphPanel personId={42} personName="JANE DOE" />);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/connections/graph?type=person&id=42')
      );
    });
  });
});
```

**Step 2: Run and verify it fails** (panel currently calls `/records/persons/:id/system-history`).

```bash
cd client && npx vitest run src/components/__tests__/ConnectionsGraphPanel.test.tsx
```

Expected: FAIL — `mockFetch` was called with `/records/persons/42/system-history`.

**Step 3: Modify the component**

Replace the `fetchGraph` callback body. Full new implementation:

```tsx
const fetchGraph = useCallback(async () => {
  setLoading(true);
  try {
    const data = await apiFetch<{ nodes: any[]; edges: any[] }>(
      `/connections/graph?type=person&id=${personId}&depth=1`
    );
    const centerX = 300, centerY = 200;
    const newNodes: GraphNode[] = data.nodes.map((n, i) => {
      const isSeed = n.type === 'person' && String(n.entityId) === String(personId);
      return {
        id: n.id,
        type: n.type,
        label: (n.label || '').toUpperCase(),
        subLabel: n.metadata?.status || n.metadata?.incident_type || '',
        x: isSeed ? centerX : centerX + Math.cos(i) * 140 + Math.random() * 20,
        y: isSeed ? centerY : centerY + Math.sin(i) * 140 + Math.random() * 20,
        vx: 0, vy: 0,
        pinned: isSeed,
      };
    });
    const newEdges: GraphEdge[] = data.edges.map(e => ({
      source: e.source, target: e.target, label: (e.relationship || '').toUpperCase(),
    }));
    simulate(newNodes, newEdges);
    // ... keep existing normalize-to-viewport block
    setNodes(newNodes);
    setEdges(newEdges);
  } catch (err) { console.error('ConnectionsGraph fetch error:', err); }
  finally { setLoading(false); }
}, [personId, personName]);
```

Also update the `GraphNode.type` union at [ConnectionsGraphPanel.tsx:10](../../client/src/components/ConnectionsGraphPanel.tsx:10) to match server output:
```tsx
type: 'person' | 'vehicle' | 'property' | 'evidence' | 'case' | 'incident';
```
Remove `'warrant' | 'call' | 'citation'` from the type alias. Drop `NODE_COLORS` and `NODE_RADIUS` entries for those — add entries for `property` and `evidence` (already partially there).

**Step 4: Run test to verify it passes**

```bash
cd client && npx vitest run src/components/__tests__/ConnectionsGraphPanel.test.tsx
```

Expected: PASS.

**Step 5: Typecheck**

```bash
cd client && npx tsc --noEmit
```

Expected: 0 errors.

**Step 6: Commit**

```bash
git add client/src/components/ConnectionsGraphPanel.tsx client/src/components/__tests__/ConnectionsGraphPanel.test.tsx
git commit -m "fix(connections): point panel at real /connections/graph endpoint"
```

### Task 1.3: Fix CSV export to include computed edges

**Files:**
- Modify: `server/src/routes/connections.ts:519-543`

**Step 1: Failing test** — add to `server/tests/integration/connections.test.ts`:

```typescript
describe('GET /api/connections/export/csv', () => {
  it('includes edges from incident_persons, not just record_links', async () => {
    const res = await request(app)
      .get('/api/connections/export/csv')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/csv/);
    // Our seed inserted one incident_persons row. It must show up.
    expect(res.text).toContain('incident_persons');
    expect(res.text).toContain('suspect');
  });
});
```

**Step 2: Verify failure**

```bash
cd server && npx vitest run tests/integration/connections.test.ts -t "includes edges"
```

Expected: FAIL — current export only queries `record_links`.

**Step 3: Rewrite the handler**

Replace [connections.ts:522-543](../../server/src/routes/connections.ts:522) with a new handler that iterates all seed persons (or takes a `?seedType=person&seedId=123` filter) and runs `findConnections()` for each, collating unique edges. For the v1 cut, support two modes:

```typescript
router.get('/export/csv', requireRole('admin','manager','supervisor'), (req, res) => {
  try {
    const db = getDb();
    const { seedType, seedId } = req.query;
    const rows: any[] = [];

    if (seedType && seedId) {
      // Single-graph export (new)
      const graph = buildGraph(db, String(seedType), Number(seedId), 3);
      for (const e of graph.edges) {
        const [sType, sId] = e.source.split('-');
        const [tType, tId] = e.target.split('-');
        rows.push({
          source_type: sType, source_id: sId,
          target_type: tType, target_id: tId,
          relationship: e.relationship, source_table: e.sourceTable,
        });
      }
    } else {
      // Full-table export: keep legacy record_links + UNION all junction tables
      const legacy = db.prepare(
        `SELECT source_type, source_id, target_type, target_id, relationship,
                'record_links' as source_table FROM record_links`
      ).all();
      rows.push(...legacy as any[]);
      const incPers = db.prepare(
        `SELECT 'person' as source_type, person_id as source_id,
                'incident' as target_type, incident_id as target_id,
                role as relationship, 'incident_persons' as source_table
         FROM incident_persons`
      ).all();
      rows.push(...incPers as any[]);
      // Repeat for: incident_vehicles, call_persons, call_vehicles,
      //             client_persons, evidence (incident_id), arrest_cross_links,
      //             warrants (subject_person_id), citations (person_id, vehicle_id),
      //             field_interviews (person_id), trespass_orders (person_id)
    }

    sendCsv(res, 'connections_export.csv', [
      { key: 'source_type', header: 'Source Type' },
      { key: 'source_id', header: 'Source ID' },
      { key: 'target_type', header: 'Target Type' },
      { key: 'target_id', header: 'Target ID' },
      { key: 'relationship', header: 'Relationship' },
      { key: 'source_table', header: 'Source Table' },
    ], rows);

    auditLog(req, 'EXPORT', 'record_link', 0, `CSV export: ${rows.length} rows`);
  } catch (err: any) {
    console.error('[Connections] CSV export error:', err?.message);
    res.status(500).json({ error: 'Export failed', code: 'EXPORT_FAILED' });
  }
});
```

The `// Repeat for:` comment must be expanded to real SQL blocks. Each follows the same pattern as `incPers`.

**Step 4: Tests pass**

```bash
cd server && npx vitest run tests/integration/connections.test.ts
```

Expected: all tests pass.

**Step 5: Commit**

```bash
git add server/src/routes/connections.ts server/tests/integration/connections.test.ts
git commit -m "fix(connections): CSV export includes junction-table edges"
```

---

## Phase 2 — New edge sources (traversal power, ~4 hours)

Extend `findConnections()` in [connections.ts:120](../../server/src/routes/connections.ts:120) to traverse 7 new edge types. **Add a new server entity type `'warrant'` and expose a route for it, but keep the existing 6 types as valid seeds.**

### Task 2.1: Add warrant traversal (person ↔ warrant via `warrants.subject_person_id`)

**Step 1: Failing test** — add to `connections.test.ts`:

```typescript
it('traverses person → warrant via subject_person_id', async () => {
  const d = (await import('../../src/models/database')).getDb();
  const wid = d.prepare(
    "INSERT INTO warrants (warrant_number, subject_person_id, status) VALUES ('W-001', ?, 'ACTIVE')"
  ).run(personId).lastInsertRowid;

  const res = await request(app)
    .get(`/api/connections/graph?type=person&id=${personId}&depth=2`)
    .set('Authorization', `Bearer ${adminToken}`);

  expect(res.body.nodes.some((n: any) => n.type === 'warrant' && n.entityId === Number(wid))).toBe(true);
});
```

**Step 2: Verify failure.**

**Step 3: Implementation** — in [connections.ts:147](../../server/src/routes/connections.ts:147) `case 'person':` block, append:

```typescript
// warrants → warrants
const warrants = db.prepare(
  "SELECT id, status FROM warrants WHERE subject_person_id = ?"
).all(id) as any[];
for (const w of warrants) {
  results.push({ type: 'warrant', id: w.id, relationship: `warrant_${(w.status||'').toLowerCase()}`, sourceTable: 'warrants' });
}
```

Add `'warrant'` to `VALID_TYPES` at [connections.ts:408](../../server/src/routes/connections.ts:408).
Add label/metadata cases in `getRecordLabel` / `getNodeMetadata`:

```typescript
case 'warrant': {
  const w = db.prepare('SELECT warrant_number, status, warrant_type FROM warrants WHERE id = ?').get(id) as any;
  return w ? `${w.warrant_number} (${w.status})` : `Warrant #${id}`;
}
```

Add reverse traversal (warrant → person):

```typescript
case 'warrant': {
  const w = db.prepare('SELECT subject_person_id FROM warrants WHERE id = ?').get(id) as any;
  if (w?.subject_person_id) {
    results.push({ type: 'person', id: w.subject_person_id, relationship: 'subject', sourceTable: 'warrants' });
  }
  break;
}
```

**Step 4: Test passes. Step 5: Commit**

```bash
git commit -am "feat(connections): add warrant edges"
```

### Task 2.2–2.6: Citations, arrests, field-interviews, trespass, serve-queue

Follow the **same 5-step TDD cycle** for each. Summary of code deltas:

| Task | Seed types | New entity | Edge SQL |
|------|-----------|-----------|----------|
| 2.2 Citations | person, vehicle | citation | `SELECT id FROM citations WHERE person_id = ?` and `WHERE vehicle_id = ?` |
| 2.3 Arrests | person | arrest | `SELECT arrest_record_id FROM arrest_cross_links WHERE linked_type='person' AND linked_id = ?` |
| 2.4 Field Interviews | person | field_interview | `SELECT id FROM field_interviews WHERE person_id = ?` |
| 2.5 Trespass | person, property | trespass_order | `SELECT id FROM trespass_orders WHERE person_id = ?` and `WHERE property_id = ?` |
| 2.6 Serve queue | person, property | serve_job | `SELECT id FROM serve_queue WHERE recipient_person_id = ?` |

For each new entity type, add to `VALID_TYPES`, `getRecordLabel`, `getNodeMetadata`, both forward and reverse directions. Commit after each task.

### Task 2.7: Client — extend type union + color map

**Files:**
- Modify: `client/src/components/ConnectionsGraphPanel.tsx` (type union, NODE_COLORS, NODE_RADIUS)
- Modify: `client/src/pages/ConnectionsPage.tsx` (will be created in Phase 5 — for now just plan to mirror)

Add entries for `warrant` (`#dc2626`), `citation` (`#fbbf24`), `arrest` (`#ef4444`), `field_interview` (`#64748b`), `trespass_order` (`#a855f7`), `serve_job` (`#14b8a6`).

Commit: `"feat(connections): client color map for new edge types"`

---

## Phase 3 — Schema upgrade: junction tables + performance (~3 hours)

### Task 3.1: Add `case_person_links`, `case_incident_links`, `case_evidence_links`

**Files:**
- Modify: `server/src/models/database.ts` (add CREATE TABLE statements near other case-related tables — search for `CREATE TABLE IF NOT EXISTS cases`)

**Step 1: Failing test** — `server/tests/unit/caseJunctionTables.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { setupTestDataDir, teardownTestDataDir } from '../helpers/testDb';

describe('case junction tables', () => {
  it('case_person_links table exists with the right columns', async () => {
    const dir = setupTestDataDir();
    const { initDatabase, getDb } = await import('../../src/models/database');
    initDatabase();
    const d = getDb();
    const cols = d.prepare("PRAGMA table_info(case_person_links)").all() as any[];
    const names = cols.map(c => c.name);
    expect(names).toEqual(expect.arrayContaining(['case_id', 'person_id', 'relationship']));
    teardownTestDataDir(dir);
  });
  // repeat for case_incident_links, case_evidence_links
});
```

**Step 2: Verify failure.**

**Step 3: Implementation** — append three `db.prepare(...).run()` calls (NOT the bulk-execute method — Gotcha #42):

```typescript
db.prepare(`
  CREATE TABLE IF NOT EXISTS case_person_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id INTEGER NOT NULL,
    person_id INTEGER NOT NULL,
    relationship TEXT DEFAULT 'linked',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(case_id, person_id),
    FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
    FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE CASCADE
  )
`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_cpl_case ON case_person_links(case_id)`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_cpl_person ON case_person_links(person_id)`).run();
```

Repeat for `case_incident_links(case_id, incident_id)` and `case_evidence_links(case_id, evidence_id)`.

**Step 4: Tests pass. Step 5: Commit.**

### Task 3.2: One-time backfill from JSON columns

**Files:**
- Create: `server/src/migrations/2026-04-19-case-links-backfill.ts`
- Modify: `server/src/models/database.ts` (call the migration once after table creation)

**Step 1: Failing test** — integration test that inserts a case with `linked_persons='[1,2]'` and expects the backfill to produce two rows in `case_person_links`.

**Step 2: Verify failure. Step 3: Implementation.**

```typescript
// server/src/migrations/2026-04-19-case-links-backfill.ts
export function backfillCaseLinks(db: any) {
  const cases = db.prepare('SELECT id, linked_persons, linked_incidents, linked_evidence FROM cases').all() as any[];
  const insP = db.prepare('INSERT OR IGNORE INTO case_person_links (case_id, person_id) VALUES (?, ?)');
  const insI = db.prepare('INSERT OR IGNORE INTO case_incident_links (case_id, incident_id) VALUES (?, ?)');
  const insE = db.prepare('INSERT OR IGNORE INTO case_evidence_links (case_id, evidence_id) VALUES (?, ?)');
  db.transaction(() => {
    for (const c of cases) {
      try { JSON.parse(c.linked_persons || '[]').forEach((pid: any) => insP.run(c.id, Number(pid))); } catch {}
      try { JSON.parse(c.linked_incidents || '[]').forEach((iid: any) => insI.run(c.id, Number(iid))); } catch {}
      try { JSON.parse(c.linked_evidence || '[]').forEach((eid: any) => insE.run(c.id, Number(eid))); } catch {}
    }
  })();
}
```

Call it from `initDatabase()` **behind an idempotency guard** — e.g., only run if `case_person_links` count is 0 AND any case has a non-empty `linked_persons`.

**Step 4: Tests pass. Step 5: Commit.**

### Task 3.3: Replace JSON-LIKE scans in `findConnections()`

**Files:**
- Modify: `server/src/routes/connections.ts:177`, `:258`, `:326`, `:271-296` (all 4 `LIKE '%id%'` blocks and the case-seed block)

**Step 1: Failing perf regression test** — not strictly "fails" but add:

```typescript
it('does not use LIKE scan for cases.linked_persons lookup', async () => {
  // Create 100 cases, insert case_person_links rows, verify graph still returns the link
  // Also verify EXPLAIN QUERY PLAN does not say "SCAN TABLE cases" for a linked_persons lookup
});
```

**Step 2–4:** Swap the JSON-LIKE blocks for junction-table queries:

```typescript
// OLD (slow):
// const casesWithPerson = db.prepare("SELECT id, linked_persons FROM cases WHERE linked_persons LIKE ?").all(`%${escapeLike(String(id))}%`);

// NEW (indexed):
const casesWithPerson = db.prepare(
  "SELECT case_id as id FROM case_person_links WHERE person_id = ?"
).all(id) as any[];
for (const c of casesWithPerson) {
  results.push({ type: 'case', id: c.id, relationship: 'linked', sourceTable: 'case_person_links' });
}
```

Repeat for incidents, evidence. Keep the JSON-column reads ONLY in the cases writes (for backwards compat on existing client forms) — but mirror every write into the new junction table in the same transaction. That mirror-write happens in `server/src/routes/cases.ts` (separate task — find and modify POST/PUT handlers).

**Step 5: Commit.**

### Task 3.4: Per-request label cache

**Files:**
- Modify: `server/src/routes/connections.ts:347` (`buildGraph`)

Introduce a `Map<string, string>` label cache + `Map<string, any>` metadata cache scoped to one `buildGraph` call. Pass into `addNode`. Saves ~200 SQL reads on a full graph. Write a simple test that asserts `buildGraph` finishes in <100ms for a 50-node seed (not deterministic — use as smoke test with `performance.now()`).

Commit: `"perf(connections): cache labels/metadata per graph build"`

---

## Phase 4 — New endpoints: path, investigations, suggestions (~6 hours)

### Task 4.1: `GET /connections/path?from=type:id&to=type:id` — shortest path BFS

**Step 1: Failing test** — assert path between seeded person and incident returns 2 nodes + 1 edge.

**Step 2–3: Implementation** — new function `findShortestPath(db, fromType, fromId, toType, toId, maxDepth=5)` that returns `{ path: GNode[], edges: GEdge[] }` or 404 if no path. Algorithm: BFS from `from`, track parent pointers, halt when `to` visited, walk back.

**Step 4–5: Commit.**

### Task 4.2: `connection_investigations` table + CRUD endpoints

**Files:**
- Modify: `server/src/models/database.ts` (new CREATE TABLE)
- Modify: `server/src/routes/connections.ts` (new routes)
- Create: `server/tests/integration/connectionInvestigations.test.ts`

**Schema:**
```sql
CREATE TABLE IF NOT EXISTS connection_investigations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  seed_nodes TEXT NOT NULL,            -- JSON: [{type, id}, ...]
  pinned_layout TEXT,                  -- JSON: { "person-42": {x,y}, ... }
  annotations TEXT,                    -- JSON: { "person-42": "prime suspect" }
  shared_user_ids TEXT DEFAULT '[]',   -- JSON array of user ids
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX idx_ci_user ON connection_investigations(user_id);
```

**Endpoints (all TDD, one task per endpoint):**
- `POST /connections/investigations` — create (owner = `req.user.id`)
- `GET /connections/investigations` — list mine + shared-with-me
- `GET /connections/investigations/:id` — read (403 if not owner and not in `shared_user_ids`)
- `PUT /connections/investigations/:id` — update (owner only for `shared_user_ids` field)
- `DELETE /connections/investigations/:id` — delete (owner only)

Every CRUD goes through `auditLog(req, action, 'connection_investigation', id, ...)`.

### Task 4.3: Rule-based "suggest hidden links"

**Files:**
- Create: `server/src/utils/connectionSuggestions.ts`
- Modify: `server/src/routes/connections.ts` (add `GET /connections/suggestions?type=X&id=Y`)

**Rules (v1):**
1. **Shared phone** — two persons with identical `phone` → suggested link.
2. **Shared address** — two persons with identical `address` + `city` → suggested link.
3. **Co-occurrence** — two persons with ≥2 shared incidents (via `incident_persons`) → suggested link.
4. **Same-plate stops** — two persons appearing on `citations` for the same `vehicle_id` → suggested link.

Response shape:
```typescript
{ suggestions: Array<{
    type: string; id: number; label: string;
    reason: string;         // e.g. "Shares phone 555-1234 with seed"
    confidence: 'low' | 'medium' | 'high';
}> }
```

Gate behind `requireRole('admin','manager','supervisor')` (not all officers — higher bar). Admin-toggle check: read `system_config` key `connections.suggestions_enabled` — if false, return `403 FEATURE_DISABLED`.

Each rule: separate TDD task. Commit after each.

---

## Phase 5 — ConnectionsPage (new client page, ~1.5 days)

### Task 5.1: Install d3-force + d3-zoom

**Files:**
- Modify: `client/package.json`

```bash
cd client && npm install --save d3-force d3-zoom d3-selection
cd client && npm install --save-dev @types/d3-force @types/d3-zoom @types/d3-selection
```

Commit: `"chore(client): add d3-force + d3-zoom deps"`

### Task 5.2: Scaffold ConnectionsPage + route

**Files:**
- Create: `client/src/pages/ConnectionsPage.tsx`
- Modify: `client/src/App.tsx` or wherever routes are declared (grep for existing page routes) — add `<Route path="/connections" element={<ConnectionsPage />} />`
- Modify: `client/src/components/Layout.tsx` menu bar — add Connections link (search for other menu entries as pattern reference)

TDD with React Testing Library: render the page, assert it shows a search box and empty canvas.

### Task 5.3: Search + seed picker

Reuse `/connections/search` — already exists. Show dropdown of results. Clicking a result seeds the graph.

### Task 5.4: Force-directed layout via d3-force

Replace hand-rolled `simulate()` with:

```tsx
import { forceSimulation, forceManyBody, forceLink, forceCenter, forceCollide } from 'd3-force';

useEffect(() => {
  if (!nodes.length) return;
  const sim = forceSimulation(nodes)
    .force('charge', forceManyBody().strength(-400))
    .force('link', forceLink(edges).id((d: any) => d.id).distance(120))
    .force('center', forceCenter(viewW/2, viewH/2))
    .force('collide', forceCollide(35))
    .on('tick', () => setNodes([...sim.nodes() as any]));
  return () => { sim.stop(); };
}, [edges.length, nodes.length]);
```

### Task 5.5: Pan/zoom via d3-zoom

### Task 5.6: Type filter sidebar (checkboxes)

### Task 5.7: Depth slider (1-5) — re-fetches graph

### Task 5.8: Shortest-path UI (pick two nodes, call `/connections/path`)

### Task 5.9: Save investigation modal (POST to `/connections/investigations`)

### Task 5.10: Load investigation (restores pinned layout + annotations)

### Task 5.11: Node annotation popover (click node → textarea → save)

Each of 5.2–5.11 is its own TDD task. Keep each under ~200 lines of new code. Commit after each.

---

## Phase 6 — Export (~3 hours)

### Task 6.1: PNG export

**Files:**
- Create: `client/src/utils/graphToPng.ts`

Approach: serialize the SVG via `new XMLSerializer().serializeToString(svgEl)`, wrap in a `Blob`, draw onto a canvas at 2x resolution, export via `canvas.toBlob('image/png')`.

### Task 6.2: PDF export

Reuse existing `jsPDF` pipeline. Embed the PNG from 6.1, add a header (investigation name, seed node, generated-at timestamp, current user from [useApi.ts](../../client/src/hooks/useApi.ts)), and a node table below.

---

## Phase 7 — Ship (~1 hour)

### Task 7.1: Full server suite + client typecheck

```bash
cd server && npx vitest run && cd .. && cd client && npx tsc --noEmit && npx vitest run
```

All green.

### Task 7.2: Bump service worker CACHE_NAME

Modify `client/public/sw.js` — bump `CACHE_NAME` above current prod (check with `grep CACHE_NAME client/public/sw.js`).

### Task 7.3: Self-review via code-reviewer agent

```
Agent({ subagent_type: "feature-dev:code-reviewer", prompt: "Review this branch for the Connections feature. Seed-read: docs/plans/2026-04-19-connections-full-analyst-tool.md" })
```

### Task 7.4: Merge to main + deploy from main workspace (NOT this worktree — Gotcha #43)

### Task 7.5: Smoke-test on prod

- Open `/connections` — page loads
- Search for a known person, seed graph → see warrants, citations, incidents
- Save an investigation → reload → restored
- Export PDF → opens correctly

---

## Checkpoints for your review

Pause and show me diff + screenshots at:
- **End of Phase 1** — panel now shows richer data; CSV export works.
- **End of Phase 3** — backfill ran; perf fix verified with EXPLAIN.
- **End of Phase 4** — new endpoints working in Vitest.
- **End of Phase 5** — ConnectionsPage working locally. **I should browse it via preview tools before Phase 6.**
- **Before Phase 7.4 (deploy)** — final review.

## Out of scope (explicit)

- ML / embedding-based link suggestions.
- Cross-tenant sharing.
- Real-time multi-user collaboration on the same investigation.
- Mobile-optimized graph view.
- Geographic graph overlays (graph on the map).

If any of these come up, add to a follow-up plan.
