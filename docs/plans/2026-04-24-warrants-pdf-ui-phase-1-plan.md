# Warrants PDF v2 + List UI Polish — Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship a detailed, print-worthy warrants PDF (officer-safety briefing + handoff documentation) and a polished Warrants-tab list UI (triage affordances + bulk archive/review/print-packet) without introducing any officer-assignment or service-execution workflow.

**Architecture:** Pure additive feature. Server adds 3 nullable columns via lazy `ensureWarrantReviewColumns(db)`, extends existing GET endpoints with new JOINs + filter query params, adds two bulk POST endpoints. PDF generator extends `WarrantPdfData` interface and adds new content blocks inside the existing `generateWarrantReport` function. UI extends the existing Warrants tab table with new columns, filter chips bound to URL query params, and a bulk action bar. No breaking changes to existing consumers (`WarrantAlertBanner`, `WarrantBadge`, `downloadRecordPdf`).

**Tech Stack:** Node + TypeScript (tsx runtime) + Express 4 + better-sqlite3 + React 18 + Tailwind + Vite 6 + jsPDF + qrcode npm package (new) + vitest.

**Design doc:** [`docs/plans/2026-04-24-warrants-pdf-ui-phase-1-design.md`](./2026-04-24-warrants-pdf-ui-phase-1-design.md)

**Branch:** `feat/warrants-pdf-ui-phase-1-2026-04-24`

---

## Task 1: Server helpers — lazy columns + indexes + bucket/age/freshness utilities

**Files:**
- Create: `server/src/utils/warrantHelpers.ts`
- Create: `server/tests/utils/warrantHelpers.test.ts`
- Create: `server/tests/unit/warrantReviewColumns.test.ts`

### Step 1.1: Write failing test for `computePriorityBucket`

Create `server/tests/utils/warrantHelpers.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  computePriorityBucket,
  formatAge,
  computeFreshnessClass,
} from '../../src/utils/warrantHelpers';

describe('computePriorityBucket', () => {
  it('returns critical for score >= 90', () => {
    expect(computePriorityBucket(95)).toBe('critical');
    expect(computePriorityBucket(100)).toBe('critical');
  });
  it('returns high for 70-89', () => {
    expect(computePriorityBucket(70)).toBe('high');
    expect(computePriorityBucket(89)).toBe('high');
  });
  it('returns medium for 40-69', () => {
    expect(computePriorityBucket(40)).toBe('medium');
    expect(computePriorityBucket(69)).toBe('medium');
  });
  it('returns low for < 40 or null', () => {
    expect(computePriorityBucket(0)).toBe('low');
    expect(computePriorityBucket(null)).toBe('low');
    expect(computePriorityBucket(undefined)).toBe('low');
  });
});

describe('formatAge', () => {
  it('formats days', () => {
    expect(formatAge(0)).toBe('0d');
    expect(formatAge(3)).toBe('3d');
    expect(formatAge(13)).toBe('13d');
  });
  it('formats weeks', () => {
    expect(formatAge(14)).toBe('2w');
    expect(formatAge(28)).toBe('4w');
  });
  it('formats months', () => {
    expect(formatAge(60)).toBe('2mo');
    expect(formatAge(180)).toBe('6mo');
  });
  it('formats years', () => {
    expect(formatAge(365)).toBe('1y');
    expect(formatAge(730)).toBe('2y');
  });
  it('handles null', () => {
    expect(formatAge(null)).toBe('—');
  });
});

describe('computeFreshnessClass', () => {
  it('returns fresh for < 1 day', () => {
    expect(computeFreshnessClass(0)).toBe('fresh');
    expect(computeFreshnessClass(0.5)).toBe('fresh');
  });
  it('returns recent for 1-6 days', () => {
    expect(computeFreshnessClass(1)).toBe('recent');
    expect(computeFreshnessClass(6)).toBe('recent');
  });
  it('returns stale for 7-29 days', () => {
    expect(computeFreshnessClass(7)).toBe('stale');
    expect(computeFreshnessClass(29)).toBe('stale');
  });
  it('returns old for >= 30 days', () => {
    expect(computeFreshnessClass(30)).toBe('old');
    expect(computeFreshnessClass(365)).toBe('old');
  });
  it('returns manual for null', () => {
    expect(computeFreshnessClass(null)).toBe('manual');
  });
});
```

### Step 1.2: Run test — expect FAIL

Run: `cd server && npx vitest run tests/utils/warrantHelpers.test.ts`

Expected: FAIL with "Cannot find module '../../src/utils/warrantHelpers'".

### Step 1.3: Write the implementation

Create `server/src/utils/warrantHelpers.ts`:

```typescript
// ============================================================
// Warrant Helpers
// ============================================================
// Shared helpers for the warrants surface area:
//   - Lazy schema initializers (survive process restart order)
//   - Priority / age / freshness computation for list UI + PDF
// ============================================================

import type Database from 'better-sqlite3';

// ── Priority bucket ──────────────────────────────────────────
export type PriorityBucket = 'critical' | 'high' | 'medium' | 'low';

export function computePriorityBucket(
  score: number | null | undefined
): PriorityBucket {
  if (score == null) return 'low';
  if (score >= 90) return 'critical';
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

// ── Age formatting ───────────────────────────────────────────
export function formatAge(days: number | null | undefined): string {
  if (days == null) return '—';
  const d = Math.floor(days);
  if (d < 14) return `${d}d`;
  if (d < 60) return `${Math.floor(d / 7)}w`;
  if (d < 365) return `${Math.floor(d / 30)}mo`;
  return `${Math.floor(d / 365)}y`;
}

// ── Freshness (time since last scraper refresh) ──────────────
export type FreshnessClass = 'fresh' | 'recent' | 'stale' | 'old' | 'manual';

export function computeFreshnessClass(
  daysSinceScrape: number | null | undefined
): FreshnessClass {
  if (daysSinceScrape == null) return 'manual';
  if (daysSinceScrape < 1) return 'fresh';
  if (daysSinceScrape < 7) return 'recent';
  if (daysSinceScrape < 30) return 'stale';
  return 'old';
}

// ── Lazy schema: columns ─────────────────────────────────────
// Three new columns on `warrants`, all nullable, idempotent.
// Must be called from each handler that reads/writes these
// fields — DO NOT call at module load (see CLAUDE.md gotcha #24).

let reviewColumnsEnsured = false;

export function ensureWarrantReviewColumns(db: Database.Database): void {
  if (reviewColumnsEnsured) return;
  try {
    const cols = db
      .prepare("PRAGMA table_info(warrants)")
      .all() as { name: string }[];
    if (!cols.some((c) => c.name === 'reviewed_at')) {
      db.prepare('ALTER TABLE warrants ADD COLUMN reviewed_at TEXT').run();
    }
    if (!cols.some((c) => c.name === 'reviewed_by')) {
      db.prepare('ALTER TABLE warrants ADD COLUMN reviewed_by INTEGER').run();
    }
    if (!cols.some((c) => c.name === 'last_scraped_at')) {
      db.prepare('ALTER TABLE warrants ADD COLUMN last_scraped_at TEXT').run();
    }
    reviewColumnsEnsured = true;
  } catch {
    // table doesn't exist yet — retry on next call
  }
}

// ── Lazy schema: indexes ─────────────────────────────────────
let indexesEnsured = false;

export function ensureWarrantIndexes(db: Database.Database): void {
  if (indexesEnsured) return;
  try {
    db.prepare(
      'CREATE INDEX IF NOT EXISTS idx_warrants_priority ON warrants(priority_score)'
    ).run();
    db.prepare(
      'CREATE INDEX IF NOT EXISTS idx_warrants_issue_date ON warrants(issue_date)'
    ).run();
    db.prepare(
      'CREATE INDEX IF NOT EXISTS idx_warrants_subject_person ON warrants(subject_person_id)'
    ).run();
    db.prepare(
      'CREATE INDEX IF NOT EXISTS idx_warrants_source ON warrants(source)'
    ).run();
    db.prepare(
      'CREATE INDEX IF NOT EXISTS idx_warrants_last_scraped ON warrants(last_scraped_at)'
    ).run();
    indexesEnsured = true;
  } catch {
    // retry next call
  }
}

// Exposed for tests
export function _resetEnsuredForTests(): void {
  reviewColumnsEnsured = false;
  indexesEnsured = false;
}
```

### Step 1.4: Run test — expect PASS

Run: `cd server && npx vitest run tests/utils/warrantHelpers.test.ts`

Expected: **17 passed**.

### Step 1.5: Write failing test for `ensureWarrantReviewColumns`

Create `server/tests/unit/warrantReviewColumns.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  ensureWarrantReviewColumns,
  ensureWarrantIndexes,
  _resetEnsuredForTests,
} from '../../src/utils/warrantHelpers';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.prepare(`
    CREATE TABLE warrants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      warrant_number TEXT,
      priority_score INTEGER DEFAULT 0,
      issue_date TEXT,
      subject_person_id INTEGER,
      source TEXT
    )
  `).run();
  return db;
}

function hasColumn(db: Database.Database, col: string): boolean {
  const rows = db.prepare('PRAGMA table_info(warrants)').all() as {
    name: string;
  }[];
  return rows.some((r) => r.name === col);
}

function hasIndex(db: Database.Database, idx: string): boolean {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?")
    .all(idx) as { name: string }[];
  return rows.length > 0;
}

describe('ensureWarrantReviewColumns', () => {
  beforeEach(() => _resetEnsuredForTests());

  it('adds reviewed_at, reviewed_by, last_scraped_at on fresh schema', () => {
    const db = makeDb();
    expect(hasColumn(db, 'reviewed_at')).toBe(false);
    ensureWarrantReviewColumns(db);
    expect(hasColumn(db, 'reviewed_at')).toBe(true);
    expect(hasColumn(db, 'reviewed_by')).toBe(true);
    expect(hasColumn(db, 'last_scraped_at')).toBe(true);
  });

  it('is idempotent on second call', () => {
    const db = makeDb();
    ensureWarrantReviewColumns(db);
    expect(() => ensureWarrantReviewColumns(db)).not.toThrow();
    expect(hasColumn(db, 'reviewed_at')).toBe(true);
  });

  it('is idempotent when columns already exist', () => {
    const db = makeDb();
    db.prepare('ALTER TABLE warrants ADD COLUMN reviewed_at TEXT').run();
    _resetEnsuredForTests();
    expect(() => ensureWarrantReviewColumns(db)).not.toThrow();
  });

  it('silently handles missing table', () => {
    const db = new Database(':memory:');
    expect(() => ensureWarrantReviewColumns(db)).not.toThrow();
  });
});

describe('ensureWarrantIndexes', () => {
  beforeEach(() => _resetEnsuredForTests());

  it('adds all 5 indexes on fresh schema', () => {
    const db = makeDb();
    ensureWarrantIndexes(db);
    expect(hasIndex(db, 'idx_warrants_priority')).toBe(true);
    expect(hasIndex(db, 'idx_warrants_issue_date')).toBe(true);
    expect(hasIndex(db, 'idx_warrants_subject_person')).toBe(true);
    expect(hasIndex(db, 'idx_warrants_source')).toBe(true);
    expect(hasIndex(db, 'idx_warrants_last_scraped')).toBe(true);
  });

  it('is idempotent', () => {
    const db = makeDb();
    ensureWarrantIndexes(db);
    expect(() => ensureWarrantIndexes(db)).not.toThrow();
  });
});
```

### Step 1.6: Run test — expect PASS

Run: `cd server && npx vitest run tests/unit/warrantReviewColumns.test.ts`

Expected: **6 passed**.

### Step 1.7: Commit

```bash
git add server/src/utils/warrantHelpers.ts server/tests/utils/warrantHelpers.test.ts server/tests/unit/warrantReviewColumns.test.ts
git commit -m "feat(warrants): helpers for priority bucket, age, freshness, lazy schema init"
```

---

## Task 2: Extend `GET /api/warrants` with filter query params + computed fields

**Files:**
- Modify: `server/src/routes/warrants.ts`
- Modify: `server/tests/integration/warrants.test.ts`

### Step 2.1: Locate the existing `GET /warrants` handler

Run: `grep -n "router.get('/', " server/src/routes/warrants.ts` — note the line number.

### Step 2.2: Write failing tests for filter query params

Add to `server/tests/integration/warrants.test.ts` (inside the existing `describe('GET /api/warrants', ...)` block):

```typescript
it('filters by priority_min', async () => {
  await seedWarrants([{ priority_score: 20 }, { priority_score: 60 }, { priority_score: 90 }]);
  const res = await agent.get('/api/warrants?priority_min=70').expect(200);
  expect(res.body.data).toHaveLength(1);
  expect(res.body.data[0].priority_score).toBe(90);
});

it('filters by since_days', async () => {
  const now = new Date();
  const old = new Date(now.getTime() - 30 * 86400000).toISOString();
  const recent = new Date(now.getTime() - 3 * 86400000).toISOString();
  await seedWarrants([{ issue_date: old }, { issue_date: recent }]);
  const res = await agent.get('/api/warrants?since_days=7').expect(200);
  expect(res.body.data).toHaveLength(1);
});

it('filters by matches_person', async () => {
  await seedWarrants([{ subject_person_id: null }, { subject_person_id: 42 }]);
  const res = await agent.get('/api/warrants?matches_person=1').expect(200);
  expect(res.body.data).toHaveLength(1);
  expect(res.body.data[0].subject_person_id).toBe(42);
});

it('filters by state source', async () => {
  await seedWarrants([
    { source: 'ut_warrants' },
    { source: 'nv_state' },
    { source: 'manual' },
  ]);
  const res = await agent.get('/api/warrants?state=UT').expect(200);
  expect(res.body.data).toHaveLength(1);
});

it('combines filters with AND', async () => {
  await seedWarrants([
    { priority_score: 90, subject_person_id: null },
    { priority_score: 90, subject_person_id: 42 },
    { priority_score: 20, subject_person_id: 42 },
  ]);
  const res = await agent
    .get('/api/warrants?priority_min=70&matches_person=1')
    .expect(200);
  expect(res.body.data).toHaveLength(1);
});

it('returns computed age_days and matches_person', async () => {
  const old = new Date(Date.now() - 10 * 86400000).toISOString();
  await seedWarrants([{ issue_date: old, subject_person_id: 42 }]);
  const res = await agent.get('/api/warrants').expect(200);
  const w = res.body.data[0];
  expect(w.age_days).toBeGreaterThanOrEqual(9);
  expect(w.age_days).toBeLessThanOrEqual(11);
  expect(w.matches_person).toBe(1);
});
```

### Step 2.3: Run tests — expect FAIL

Run: `cd server && npx vitest run tests/integration/warrants.test.ts -t "filters by"`

Expected: all new tests FAIL.

### Step 2.4: Extend the handler

In `server/src/routes/warrants.ts`, add the import at the top:

```typescript
import { ensureWarrantReviewColumns, ensureWarrantIndexes } from '../utils/warrantHelpers';
```

Replace the existing `router.get('/', ...)` block with:

```typescript
router.get('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    ensureWarrantReviewColumns(db);
    ensureWarrantIndexes(db);

    const priorityMin = req.query.priority_min
      ? parseInt(String(req.query.priority_min), 10)
      : null;
    const sinceDays = req.query.since_days
      ? parseInt(String(req.query.since_days), 10)
      : null;
    const matchesPerson = req.query.matches_person === '1';
    const state = typeof req.query.state === 'string' ? req.query.state : null;
    const statePrefix =
      typeof req.query.state_prefix === 'string' ? req.query.state_prefix : null;
    const includeArchived = req.query.include_archived === '1';
    const sort = typeof req.query.sort === 'string' ? req.query.sort : 'priority';
    const order = req.query.order === 'asc' ? 'ASC' : 'DESC';

    const wheres: string[] = [];
    const params: any[] = [];
    if (!includeArchived) wheres.push('w.archived_at IS NULL');
    if (priorityMin != null) {
      wheres.push('w.priority_score >= ?');
      params.push(priorityMin);
    }
    if (sinceDays != null) {
      wheres.push("julianday('now') - julianday(COALESCE(w.issue_date, w.created_at)) <= ?");
      params.push(sinceDays);
    }
    if (matchesPerson) wheres.push('w.subject_person_id IS NOT NULL');
    if (state) {
      wheres.push('lower(w.source) LIKE ?');
      params.push(`${state.toLowerCase()}_%`);
    }
    if (statePrefix) {
      wheres.push('w.source LIKE ?');
      params.push(`${statePrefix}%`);
    }
    const whereSql = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';

    const sortMap: Record<string, string> = {
      priority: 'w.priority_score',
      age: "julianday('now') - julianday(COALESCE(w.issue_date, w.created_at))",
      freshness: "julianday('now') - julianday(COALESCE(w.last_scraped_at, w.updated_at))",
      alpha: 'w.warrant_number',
    };
    const sortExpr = sortMap[sort] || sortMap.priority;

    const rows = db
      .prepare(`
        SELECT
          w.*,
          p.first_name AS subject_first_name,
          p.last_name  AS subject_last_name,
          p.dob        AS subject_dob,
          p.photo_url  AS subject_photo_url,
          CAST(julianday('now') - julianday(COALESCE(w.issue_date, w.created_at)) AS INTEGER) AS age_days,
          CAST(julianday('now') - julianday(COALESCE(w.last_scraped_at, w.updated_at)) AS INTEGER) AS freshness_days,
          CASE WHEN w.subject_person_id IS NOT NULL THEN 1 ELSE 0 END AS matches_person
        FROM warrants w
        LEFT JOIN persons p ON p.id = w.subject_person_id
        ${whereSql}
        ORDER BY ${sortExpr} ${order} NULLS LAST
        LIMIT 1000
      `)
      .all(...params);

    res.json({ data: rows });
  } catch (err: any) {
    console.error('[warrants] list error:', err?.message);
    res.status(500).json({ error: 'Failed to list warrants', code: 'LIST_WARRANTS_ERROR' });
  }
});
```

### Step 2.5: Run tests — expect PASS

Run: `cd server && npx vitest run tests/integration/warrants.test.ts`

Expected: all tests PASS (existing + 6 new).

### Step 2.6: Commit

```bash
git add server/src/routes/warrants.ts server/tests/integration/warrants.test.ts
git commit -m "feat(warrants): filter query params + computed age/freshness/matches on list"
```

---

## Task 3: Extend `GET /api/warrants/:id` with joined detail blocks

**Files:**
- Modify: `server/src/routes/warrants.ts`
- Modify: `server/tests/integration/warrants.test.ts`

### Step 3.1: Write failing tests

Add to `server/tests/integration/warrants.test.ts`:

```typescript
describe('GET /api/warrants/:id detail extensions', () => {
  it('includes statute_text when statute_id linked', async () => {
    const statuteId = db
      .prepare('INSERT INTO utah_statutes (citation, title) VALUES (?, ?)')
      .run('76-6-404', 'Theft').lastInsertRowid;
    const warrantId = seedWarrant({ statute_id: statuteId });
    const res = await agent.get(`/api/warrants/${warrantId}`).expect(200);
    expect(res.body.data.statute_text).toContain('Theft');
  });

  it('includes rmpg_encounters when subject linked and has call_persons rows', async () => {
    const personId = seedPerson();
    const callId = seedCall();
    db.prepare(
      'INSERT INTO call_persons (call_id, person_id) VALUES (?, ?)'
    ).run(callId, personId);
    const warrantId = seedWarrant({ subject_person_id: personId });
    const res = await agent.get(`/api/warrants/${warrantId}`).expect(200);
    expect(res.body.data.rmpg_encounters).toBeInstanceOf(Array);
    expect(res.body.data.rmpg_encounters.length).toBeGreaterThan(0);
  });

  it('returns empty encounters/associates/vehicles when no subject link', async () => {
    const warrantId = seedWarrant({ subject_person_id: null });
    const res = await agent.get(`/api/warrants/${warrantId}`).expect(200);
    expect(res.body.data.rmpg_encounters).toEqual([]);
    expect(res.body.data.known_associates).toEqual([]);
    expect(res.body.data.known_vehicles).toEqual([]);
  });
});
```

### Step 3.2: Run — expect FAIL

Run: `cd server && npx vitest run tests/integration/warrants.test.ts -t "detail extensions"`

### Step 3.3: Extend the `GET /:id` handler

Locate and replace the existing `router.get('/:id', ...)` block:

```typescript
router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    ensureWarrantReviewColumns(db);

    const warrant = db
      .prepare(`
        SELECT w.*,
               p.first_name AS subject_first_name,
               p.last_name  AS subject_last_name,
               p.dob        AS subject_dob,
               p.photo_url  AS subject_photo_url,
               p.alias_nickname AS subject_aliases,
               p.scars_marks_tattoos AS subject_scars_marks_tattoos,
               p.distinguishing_features AS subject_distinguishing_features,
               s.title AS statute_text
        FROM warrants w
        LEFT JOIN persons p ON p.id = w.subject_person_id
        LEFT JOIN utah_statutes s ON s.id = w.statute_id
        WHERE w.id = ?
      `)
      .get(req.params.id) as any;

    if (!warrant) {
      res.status(404).json({ error: 'Warrant not found', code: 'WARRANT_NOT_FOUND' });
      return;
    }

    const encounters: any[] = [];
    const associates: any[] = [];
    const vehicles: any[] = [];

    if (warrant.subject_person_id) {
      const callRows = db
        .prepare(`
          SELECT c.created_at AS date, c.call_number AS context, pr.name AS property
          FROM call_persons cp
          JOIN calls_for_service c ON c.id = cp.call_id
          LEFT JOIN properties pr ON pr.id = c.property_id
          WHERE cp.person_id = ?
          ORDER BY c.created_at DESC
          LIMIT 20
        `)
        .all(warrant.subject_person_id);
      const incRows = db
        .prepare(`
          SELECT i.created_at AS date, i.incident_number AS context, NULL AS property
          FROM incident_persons ip
          JOIN incidents i ON i.id = ip.incident_id
          WHERE ip.person_id = ?
          ORDER BY i.created_at DESC
          LIMIT 20
        `)
        .all(warrant.subject_person_id);
      let fiRows: any[] = [];
      try {
        fiRows = db
          .prepare(`
            SELECT date, fi_number AS context, NULL AS property
            FROM field_interviews
            WHERE person_id = ?
            ORDER BY date DESC
            LIMIT 20
          `)
          .all(warrant.subject_person_id);
      } catch {
        // field_interviews may not exist
      }
      const combined = [...callRows, ...incRows, ...fiRows].sort(
        (a, b) => (b.date || '').localeCompare(a.date || '')
      );
      encounters.push(...combined.slice(0, 20));

      try {
        const a = db
          .prepare(`
            SELECT p.first_name || ' ' || p.last_name AS name,
                   pa.relationship_type AS relationship
            FROM person_associates pa
            JOIN persons p ON p.id = pa.associate_id
            WHERE pa.person_id = ?
            LIMIT 10
          `)
          .all(warrant.subject_person_id);
        associates.push(...a);
      } catch {
        // person_associates may not exist
      }

      try {
        const v = db
          .prepare(`
            SELECT plate_number AS plate,
                   (COALESCE(year,'') || ' ' || COALESCE(make,'') || ' ' || COALESCE(model,'') || ' ' || COALESCE(color,'')) AS description
            FROM vehicles_records
            WHERE owner_person_id = ?
            LIMIT 10
          `)
          .all(warrant.subject_person_id);
        vehicles.push(...v);
      } catch {
        // vehicles_records may not exist
      }
    }

    res.json({
      data: {
        ...warrant,
        rmpg_encounters: encounters,
        known_associates: associates,
        known_vehicles: vehicles,
      },
    });
  } catch (err: any) {
    console.error('[warrants] detail error:', err?.message);
    res.status(500).json({ error: 'Failed to get warrant', code: 'GET_WARRANT_ERROR' });
  }
});
```

### Step 3.4: Run tests — expect PASS

Run: `cd server && npx vitest run tests/integration/warrants.test.ts`

### Step 3.5: Commit

```bash
git add server/src/routes/warrants.ts server/tests/integration/warrants.test.ts
git commit -m "feat(warrants): detail endpoint joins statute/encounters/associates/vehicles"
```

---

## Task 4: Bulk endpoints — archive + review

**Files:**
- Modify: `server/src/routes/warrants.ts`
- Modify: `server/tests/integration/warrants.test.ts`

### Step 4.1: Write failing tests

Add to `server/tests/integration/warrants.test.ts`:

```typescript
describe('POST /api/warrants/bulk-archive', () => {
  it('archives all non-archived ids', async () => {
    const ids = [seedWarrant({}), seedWarrant({}), seedWarrant({})];
    const res = await agent
      .post('/api/warrants/bulk-archive')
      .send({ warrant_ids: ids })
      .expect(200);
    expect(res.body.archived).toBe(3);
    expect(res.body.skipped).toBe(0);
  });

  it('skips already-archived', async () => {
    const a = seedWarrant({ archived_at: '2026-01-01' });
    const b = seedWarrant({});
    const res = await agent
      .post('/api/warrants/bulk-archive')
      .send({ warrant_ids: [a, b] })
      .expect(200);
    expect(res.body.archived).toBe(1);
    expect(res.body.skipped).toBe(1);
  });

  it('rejects empty array', async () => {
    await agent.post('/api/warrants/bulk-archive').send({ warrant_ids: [] }).expect(400);
  });

  it('rejects > 500 ids', async () => {
    const ids = Array.from({ length: 501 }, (_, i) => i + 1);
    await agent.post('/api/warrants/bulk-archive').send({ warrant_ids: ids }).expect(400);
  });
});

describe('POST /api/warrants/bulk-review', () => {
  it('sets reviewed_at on all ids', async () => {
    const ids = [seedWarrant({}), seedWarrant({})];
    const res = await agent
      .post('/api/warrants/bulk-review')
      .send({ warrant_ids: ids })
      .expect(200);
    expect(res.body.reviewed).toBe(2);
    const row = db.prepare('SELECT reviewed_at FROM warrants WHERE id=?').get(ids[0]) as any;
    expect(row.reviewed_at).toBeTruthy();
  });
});
```

### Step 4.2: Run — expect FAIL

Run: `cd server && npx vitest run tests/integration/warrants.test.ts -t "bulk-"`

### Step 4.3: Implement the endpoints

Add to `server/src/routes/warrants.ts` (anywhere after the other `router.post` blocks):

```typescript
router.post('/bulk-archive', (req: Request, res: Response) => {
  try {
    const db = getDb();
    ensureWarrantReviewColumns(db);
    const ids = Array.isArray(req.body?.warrant_ids) ? req.body.warrant_ids : [];
    if (ids.length === 0) {
      res.status(400).json({ error: 'warrant_ids must be a non-empty array', code: 'WARRANT_IDS_REQUIRED' });
      return;
    }
    if (ids.length > 500) {
      res.status(400).json({ error: 'Bulk operations limited to 500 warrants per request', code: 'BULK_LIMIT_EXCEEDED' });
      return;
    }
    const placeholders = ids.map(() => '?').join(',');
    const now = localNow();
    const userId = req.user!.userId;
    const result = db
      .prepare(`UPDATE warrants SET archived_at = ?, archived_by = ? WHERE id IN (${placeholders}) AND archived_at IS NULL`)
      .run(now, userId, ...ids);
    res.json({ archived: result.changes, skipped: ids.length - result.changes });
  } catch (err: any) {
    console.error('[warrants] bulk-archive error:', err?.message);
    res.status(500).json({ error: 'Bulk archive failed', code: 'BULK_ARCHIVE_ERROR' });
  }
});

router.post('/bulk-review', (req: Request, res: Response) => {
  try {
    const db = getDb();
    ensureWarrantReviewColumns(db);
    const ids = Array.isArray(req.body?.warrant_ids) ? req.body.warrant_ids : [];
    if (ids.length === 0) {
      res.status(400).json({ error: 'warrant_ids must be a non-empty array', code: 'WARRANT_IDS_REQUIRED' });
      return;
    }
    if (ids.length > 500) {
      res.status(400).json({ error: 'Bulk operations limited to 500 warrants per request', code: 'BULK_LIMIT_EXCEEDED' });
      return;
    }
    const placeholders = ids.map(() => '?').join(',');
    const now = localNow();
    const userId = req.user!.userId;
    const result = db
      .prepare(`UPDATE warrants SET reviewed_at = ?, reviewed_by = ? WHERE id IN (${placeholders})`)
      .run(now, userId, ...ids);
    res.json({ reviewed: result.changes });
  } catch (err: any) {
    console.error('[warrants] bulk-review error:', err?.message);
    res.status(500).json({ error: 'Bulk review failed', code: 'BULK_REVIEW_ERROR' });
  }
});
```

### Step 4.4: Run tests — expect PASS

Run: `cd server && npx vitest run tests/integration/warrants.test.ts`

### Step 4.5: Commit

```bash
git add server/src/routes/warrants.ts server/tests/integration/warrants.test.ts
git commit -m "feat(warrants): bulk-archive + bulk-review endpoints"
```

---

## Task 5: Add `qrcode` npm dep + extend `WarrantPdfData` interface

**Files:**
- Modify: `client/package.json`
- Modify: `client/src/utils/recordPdfGenerator.ts`
- Modify: `client/src/utils/__tests__/recordPdfGenerator.smoke.test.ts`

### Step 5.1: Install qrcode

Run: `cd client && npm install qrcode && npm install --save-dev @types/qrcode`

### Step 5.2: Extend `WarrantPdfData` interface

Open `client/src/utils/recordPdfGenerator.ts`, locate `export interface WarrantPdfData` (around line 585), and add these fields before the closing brace:

```typescript
  // NEW — Phase 1 enhancement (2026-04-24)
  oca_number?: string;
  ori?: string;
  ncic_entry_number?: string;
  issue_date?: string;
  priority_score?: number;
  statute_text?: string;
  qr_code_data_url?: string;
  subject_aliases?: string[];
  subject_scars_marks_tattoos?: string;
  subject_distinguishing_features?: string;
  known_associates?: { name: string; relationship: string }[];
  known_vehicles?: { plate: string; description: string }[];
  source_scraper_name?: string;
  source_state?: string;
  source_url?: string;
  source_last_scraped_at?: string;
  source_verification?: string;
  rmpg_encounters?: { date: string; context: string; property?: string }[];
  printed_by_name?: string;
  printed_by_badge?: string;
  printed_at?: string;
```

### Step 5.3: Run client typecheck

Run: `cd client && npx tsc --noEmit`

Expected: 0 errors.

### Step 5.4: Smoke test — confirm existing PDF still renders

Run: `cd client && npx vitest run src/utils/__tests__/recordPdfGenerator.smoke.test.ts`

Expected: all pass (new fields are optional, don't break existing).

### Step 5.5: Commit

```bash
git add client/package.json client/package-lock.json client/src/utils/recordPdfGenerator.ts
git commit -m "feat(warrants-pdf): add qrcode dep + extend WarrantPdfData interface"
```

---

## Task 6: PDF v2 — QR code + NCIC block + priority indicator + bigger mugshot

**Files:**
- Modify: `client/src/utils/recordPdfGenerator.ts`

### Step 6.1: Import qrcode + add helper

Add at the top of `recordPdfGenerator.ts`:

```typescript
import QRCode from 'qrcode';
```

Add this helper above `generateWarrantReport`:

```typescript
async function generateQrDataUrl(text: string): Promise<string | null> {
  try {
    return await QRCode.toDataURL(text, { width: 96, margin: 0, errorCorrectionLevel: 'M' });
  } catch {
    return null;
  }
}
```

### Step 6.2: Add QR code + priority stamp + NCIC block

In `generateWarrantReport`, right after `drawNibrsHeader(...)`:

```typescript
// QR code — top-right of page 1
const qrUrl = data.qr_code_data_url ||
  (typeof window !== 'undefined' && (data as any).id
    ? await generateQrDataUrl(`${window.location.origin}/warrants/${(data as any).id}`)
    : null);
if (qrUrl) {
  doc.addImage(qrUrl, 'PNG', rx - 24, 4, 24, 24);
}

// Priority stamp — below header, right column
const bucket = data.priority_score == null ? null :
  data.priority_score >= 90 ? { label: 'CRITICAL', color: [220, 38, 38] } :
  data.priority_score >= 70 ? { label: 'HIGH',     color: [245, 158, 11] } :
  data.priority_score >= 40 ? { label: 'MEDIUM',   color: [100, 116, 139] } :
  { label: 'LOW', color: [156, 163, 175] };
if (bucket) {
  doc.setFillColor(bucket.color[0], bucket.color[1], bucket.color[2]);
  doc.setTextColor(255, 255, 255);
  doc.roundedRect(rx - 55, 32, 50, 8, 1, 1, 'F');
  doc.setFontSize(9);
  doc.text(`${bucket.label} ${data.priority_score}/100`, rx - 30, 37.5, { align: 'center' });
  doc.setTextColor(0, 0, 0);
}

// NCIC compliance block
y = checkPageBreak(doc, y, 14, statusPrio);
{
  const sec = openAutoSection(doc, 'NCIC / ORI', y);
  y = sec.contentY;
  const quarterW = ffw / 4;
  fieldLabelValue(doc, 'ORI',        data.ori        ?? '—', lx + quarterW * 0, y, quarterW);
  fieldLabelValue(doc, 'OCA #',      data.oca_number ?? '—', lx + quarterW * 1, y, quarterW);
  fieldLabelValue(doc, 'NCIC Entry', data.ncic_entry_number ?? '—', lx + quarterW * 2, y, quarterW);
  fieldLabelValue(doc, 'Issue Date', fmtDate(data.issue_date) || '—', lx + quarterW * 3, y, quarterW);
  y += 10;
  y = closeAutoSection(doc, sec.sectionY, y);
}
```

### Step 6.3: Enlarge the mugshot

Locate the existing `doc.addImage(data.subject_photo_url, ...)` call in the Subject block and change the width/height parameters from the current ~24pt × ~24pt to **50pt × 50pt** (about 2" × 2"). Shift the adjacent text column right accordingly.

### Step 6.4: Run PDF smoke

Run: `cd client && npx vitest run src/utils/__tests__/recordPdfGenerator.smoke.test.ts`

### Step 6.5: Commit

```bash
git add client/src/utils/recordPdfGenerator.ts
git commit -m "feat(warrants-pdf): QR code + priority stamp + NCIC block + larger mugshot"
```

---

## Task 7: PDF v2 — aliases, statute text, associates/vehicles, source, encounters, watermarks, print audit

**Files:**
- Modify: `client/src/utils/recordPdfGenerator.ts`

### Step 7.1: Add diagonal-watermark helper

At file scope in `recordPdfGenerator.ts`:

```typescript
function drawDiagonalWatermark(
  doc: jsPDF,
  text: string,
  color: [number, number, number, number]
) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  doc.setFontSize(72);
  doc.setTextColor(color[0], color[1], color[2]);
  (doc as any).setGState?.(new (doc as any).GState({ opacity: color[3] }));
  doc.text(text, pageW / 2, pageH / 2, { align: 'center', angle: -30 });
  (doc as any).setGState?.(new (doc as any).GState({ opacity: 1 }));
  doc.setTextColor(0, 0, 0);
}
```

### Step 7.2: Add content blocks inside `generateWarrantReport`

After the existing court/service blocks (and before the function returns), add:

```typescript
// ── Subject identification ──
if (data.subject_aliases?.length || data.subject_distinguishing_features || data.subject_scars_marks_tattoos) {
  y = checkPageBreak(doc, y, 16, statusPrio);
  const sec = openAutoSection(doc, 'Subject Identification', y);
  y = sec.contentY;
  if (data.subject_aliases?.length) {
    fieldLabelValue(doc, 'AKAs', data.subject_aliases.join(', '), lx, y, ffw);
    y += 8;
  }
  if (data.subject_scars_marks_tattoos) {
    fieldLabelValue(doc, 'Scars / Marks / Tattoos', data.subject_scars_marks_tattoos, lx, y, ffw);
    y += 8;
  }
  if (data.subject_distinguishing_features) {
    fieldLabelValue(doc, 'Distinguishing', data.subject_distinguishing_features, lx, y, ffw);
    y += 8;
  }
  y = closeAutoSection(doc, sec.sectionY, y);
}

// ── Statute text ──
if (data.statute_text) {
  y = checkPageBreak(doc, y, 14, statusPrio);
  const sec = openAutoSection(doc, 'Statute', y);
  y = sec.contentY;
  doc.setFontSize(9);
  const lines = doc.splitTextToSize(data.statute_text, ffw);
  doc.text(lines, lx, y + 4);
  y += 4 + lines.length * 4;
  y = closeAutoSection(doc, sec.sectionY, y);
}

// ── Known associates ──
if (data.known_associates?.length) {
  y = checkPageBreak(doc, y, 14, statusPrio);
  const sec = openAutoSection(doc, 'Known Associates', y);
  y = sec.contentY;
  doc.setFontSize(8);
  data.known_associates.slice(0, 10).forEach((a, idx) => {
    doc.text(`${a.name}  (${a.relationship || 'associate'})`, lx + 2, y + 4 + idx * 4);
  });
  y += data.known_associates.slice(0, 10).length * 4 + 4;
  y = closeAutoSection(doc, sec.sectionY, y);
}

// ── Known vehicles ──
if (data.known_vehicles?.length) {
  y = checkPageBreak(doc, y, 14, statusPrio);
  const sec = openAutoSection(doc, 'Known Vehicles', y);
  y = sec.contentY;
  doc.setFontSize(8);
  data.known_vehicles.slice(0, 10).forEach((v, idx) => {
    doc.text(`${v.plate}  ${v.description}`, lx + 2, y + 4 + idx * 4);
  });
  y += data.known_vehicles.slice(0, 10).length * 4 + 4;
  y = closeAutoSection(doc, sec.sectionY, y);
}

// ── Source / provenance ──
y = checkPageBreak(doc, y, 18, statusPrio);
{
  const sec = openAutoSection(doc, 'Source / Provenance', y);
  y = sec.contentY;
  const halfW = ffw / 2;
  if (data.source_scraper_name) {
    fieldLabelValue(doc, 'Scraper', data.source_scraper_name, lx, y, halfW);
    fieldLabelValue(doc, 'State',   data.source_state || '—',  lx + halfW, y, halfW);
    y += 8;
  } else {
    fieldLabelValue(doc, 'Source', 'Manually entered', lx, y, halfW);
    fieldLabelValue(doc, 'By',     data.entered_by_name || 'Unknown', lx + halfW, y, halfW);
    y += 8;
  }
  if (data.source_url) {
    fieldLabelValue(doc, 'URL', data.source_url, lx, y, ffw);
    y += 8;
  }
  fieldLabelValue(doc, 'Last refreshed', fmtDate(data.source_last_scraped_at) || '—', lx, y, halfW);
  fieldLabelValue(doc, 'Verification',   data.source_verification || 'auto-scraped', lx + halfW, y, halfW);
  y += 8;
  y = closeAutoSection(doc, sec.sectionY, y);
}

// ── RMPG encounters ──
if (data.rmpg_encounters?.length) {
  y = checkPageBreak(doc, y, 14, statusPrio);
  const sec = openAutoSection(doc, 'RMPG Encounters', y);
  y = sec.contentY;
  doc.setFontSize(8);
  data.rmpg_encounters.slice(0, 20).forEach((e, idx) => {
    doc.text(
      `${fmtDate(e.date)}  ${e.context}${e.property ? '  —  ' + e.property : ''}`,
      lx + 2,
      y + 4 + idx * 4
    );
  });
  y += data.rmpg_encounters.slice(0, 20).length * 4 + 4;
  y = closeAutoSection(doc, sec.sectionY, y);
}

// ── Watermarks ──
if (data.expires_at && new Date(data.expires_at) < new Date()) {
  drawDiagonalWatermark(doc, 'EXPIRED', [220, 38, 38, 0.15]);
}
if (data.archived_at) {
  drawDiagonalWatermark(doc, 'ARCHIVED', [100, 116, 139, 0.15]);
}

// ── Print audit footer ──
doc.setFontSize(7);
doc.setTextColor(100, 100, 100);
const audit = `Printed by: ${data.printed_by_name || 'Unknown'}${data.printed_by_badge ? ' #' + data.printed_by_badge : ''}  on  ${fmtDate(data.printed_at) || fmtDate(new Date().toISOString())}`;
doc.text(audit, lx, doc.internal.pageSize.getHeight() - 6);
doc.setTextColor(0, 0, 0);
```

### Step 7.3: Add smoke tests

Append to `client/src/utils/__tests__/recordPdfGenerator.smoke.test.ts`:

```typescript
it('renders with all new fields populated', async () => {
  const data = {
    ...minWarrant,
    oca_number: '2026-CR-4827',
    ori: 'UT0181700',
    ncic_entry_number: 'N28B9',
    issue_date: '2026-04-01',
    priority_score: 87,
    statute_text: 'Theft — Obtaining property by deception',
    subject_aliases: ['Johnny', 'Red'],
    subject_distinguishing_features: 'snake tattoo neck',
    known_associates: [{ name: 'Doe, Jane', relationship: 'spouse' }],
    known_vehicles: [{ plate: 'ABC123', description: '2021 Civic Blue' }],
    rmpg_encounters: [{ date: '2026-03-20', context: 'FI-2026-0012', property: 'Walmart' }],
    source_scraper_name: 'Utah Warrants Live',
    source_state: 'UT',
    source_last_scraped_at: '2026-04-24T13:45:00Z',
    printed_by_name: 'Zamora',
    printed_by_badge: '142',
    printed_at: '2026-04-24T14:32:00Z',
  };
  const doc = await generateRecordPdf('warrant', data);
  expect(doc.output('arraybuffer').byteLength).toBeGreaterThan(5000);
});

it('renders EXPIRED watermark for past expires_at', async () => {
  const data = { ...minWarrant, expires_at: '2020-01-01' };
  const doc = await generateRecordPdf('warrant', data);
  expect(doc).toBeDefined();
});

it('renders ARCHIVED watermark when archived_at set', async () => {
  const data = { ...minWarrant, archived_at: '2026-04-01' };
  const doc = await generateRecordPdf('warrant', data);
  expect(doc).toBeDefined();
});

it('renders with minimal data without crashing', async () => {
  const doc = await generateRecordPdf('warrant', minWarrant);
  expect(doc).toBeDefined();
});

it('handles Unicode subject name', async () => {
  const doc = await generateRecordPdf('warrant', {
    ...minWarrant,
    subject_first_name: 'Müller',
    subject_last_name: '王',
  });
  expect(doc).toBeDefined();
});
```

### Step 7.4: Run PDF smoke

Run: `cd client && npx vitest run src/utils/__tests__/recordPdfGenerator.smoke.test.ts`

### Step 7.5: Commit

```bash
git add client/src/utils/recordPdfGenerator.ts client/src/utils/__tests__/recordPdfGenerator.smoke.test.ts
git commit -m "feat(warrants-pdf): aliases, statute text, associates/vehicles, source, encounters, watermarks, print audit"
```

---

## Task 8: UI — new list columns + sort + sticky header

**Files:**
- Create: `client/src/utils/warrantListHelpers.ts`
- Create: `client/src/utils/__tests__/warrantListHelpers.test.ts`
- Modify: `client/src/pages/WarrantsPage.tsx`

### Step 8.1: Create client helpers

Create `client/src/utils/warrantListHelpers.ts`:

```typescript
export type PriorityBucket = 'critical' | 'high' | 'medium' | 'low';

export function priorityBucket(score: number | null | undefined): PriorityBucket {
  if (score == null) return 'low';
  if (score >= 90) return 'critical';
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

export function priorityChipClass(bucket: PriorityBucket): string {
  return {
    critical: 'bg-red-900/40 text-red-200 border-red-700',
    high:     'bg-amber-900/40 text-amber-200 border-amber-700',
    medium:   'bg-slate-800 text-slate-200 border-slate-600',
    low:      'bg-zinc-800 text-zinc-300 border-zinc-600',
  }[bucket];
}

export function formatAge(days: number | null | undefined): string {
  if (days == null) return '—';
  const d = Math.floor(days);
  if (d < 14) return `${d}d`;
  if (d < 60) return `${Math.floor(d / 7)}w`;
  if (d < 365) return `${Math.floor(d / 30)}mo`;
  return `${Math.floor(d / 365)}y`;
}

export type FreshnessClass = 'fresh' | 'recent' | 'stale' | 'old' | 'manual';

export function freshnessClass(daysSinceScrape: number | null | undefined): FreshnessClass {
  if (daysSinceScrape == null) return 'manual';
  if (daysSinceScrape < 1) return 'fresh';
  if (daysSinceScrape < 7) return 'recent';
  if (daysSinceScrape < 30) return 'stale';
  return 'old';
}

export function freshnessIcon(cls: FreshnessClass): string {
  return { fresh: '🟢', recent: '🟡', stale: '🟠', old: '⚫', manual: '✏️' }[cls];
}

export function stateFromSource(source: string | null | undefined): string {
  if (!source) return '—';
  if (source.startsWith('fed_') || source.startsWith('federal_')) return 'FED';
  const m = source.match(/^([a-z]{2})_/);
  return m ? m[1].toUpperCase() : '—';
}
```

### Step 8.2: Write tests

Create `client/src/utils/__tests__/warrantListHelpers.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  priorityBucket,
  formatAge,
  freshnessClass,
  stateFromSource,
} from '../warrantListHelpers';

describe('warrantListHelpers', () => {
  it('priorityBucket', () => {
    expect(priorityBucket(95)).toBe('critical');
    expect(priorityBucket(75)).toBe('high');
    expect(priorityBucket(50)).toBe('medium');
    expect(priorityBucket(5)).toBe('low');
    expect(priorityBucket(null)).toBe('low');
  });
  it('formatAge', () => {
    expect(formatAge(3)).toBe('3d');
    expect(formatAge(15)).toBe('2w');
    expect(formatAge(180)).toBe('6mo');
    expect(formatAge(800)).toBe('2y');
    expect(formatAge(null)).toBe('—');
  });
  it('freshnessClass', () => {
    expect(freshnessClass(0)).toBe('fresh');
    expect(freshnessClass(3)).toBe('recent');
    expect(freshnessClass(20)).toBe('stale');
    expect(freshnessClass(60)).toBe('old');
    expect(freshnessClass(null)).toBe('manual');
  });
  it('stateFromSource', () => {
    expect(stateFromSource('ut_warrants')).toBe('UT');
    expect(stateFromSource('fed_usms_wanted')).toBe('FED');
    expect(stateFromSource('manual')).toBe('—');
    expect(stateFromSource(null)).toBe('—');
  });
});
```

Run: `cd client && npx vitest run src/utils/__tests__/warrantListHelpers.test.ts`
Expected: PASS.

### Step 8.3: Add sort state to WarrantsPage

In `client/src/pages/WarrantsPage.tsx`, near the other `useState` calls, add:

```typescript
const [sortKey, setSortKey] = useState<'priority' | 'age' | 'freshness' | 'alpha'>('priority');
const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
```

### Step 8.4: Extend the warrants table rendering

Inside the `{activeTab === 'warrants' && (...)}` block, modify the `<thead>` and `<tbody>` of the warrants table. Wrap `<thead>` with sticky classes:

```tsx
<thead className="sticky top-0 bg-surface-base z-10">
```

Add new `<th>` columns:

```tsx
<th>
  <input type="checkbox" onChange={handleSelectAllVisible} checked={allVisibleSelected} />
</th>
<th>★</th>
<th className="cursor-pointer" onClick={() => toggleSort('priority')}>Priority</th>
<th className="cursor-pointer" onClick={() => toggleSort('age')}>Age</th>
<th className="cursor-pointer" onClick={() => toggleSort('freshness')}>Freshness</th>
<th>Source</th>
<th>Warrant #</th>
<th>Subject</th>
<th>Type</th>
<th>Charge</th>
<th>Status</th>
<th>Actions</th>
```

In each `<tr>`:

```tsx
<td><input type="checkbox" checked={selectedIds.has(w.id)} onChange={() => toggleRowSelect(w.id)} /></td>
<td>{w.matches_person ? <span className="text-amber-400">★</span> : null}</td>
<td>
  <span className={`px-2 py-0.5 text-[9px] uppercase font-bold border ${priorityChipClass(priorityBucket(w.priority_score))}`}>
    {priorityBucket(w.priority_score)}
  </span>
</td>
<td className="text-xs">{formatAge(w.age_days)}</td>
<td className="text-xs">{freshnessIcon(freshnessClass(w.freshness_days))} <span className="text-rmpg-400">{formatAge(w.freshness_days)}</span></td>
<td className="text-xs font-mono">{stateFromSource(w.source)}</td>
```

`toggleSort`:

```typescript
function toggleSort(key: 'priority' | 'age' | 'freshness' | 'alpha') {
  if (sortKey === key) {
    setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
  } else {
    setSortKey(key);
    setSortOrder(key === 'priority' ? 'desc' : 'asc');
  }
}
```

### Step 8.5: Wire sort into fetchWarrants

In `fetchWarrants`, append to the URL query string:

```typescript
if (sortKey) params.set('sort', sortKey);
if (sortOrder) params.set('order', sortOrder);
```

### Step 8.6: Typecheck + commit

Run: `cd client && npx tsc --noEmit`

```bash
git add client/src/utils/warrantListHelpers.ts client/src/utils/__tests__/warrantListHelpers.test.ts client/src/pages/WarrantsPage.tsx
git commit -m "feat(warrants-ui): new list columns (match/priority/age/freshness/source) + sticky header + sort"
```

---

## Task 9: UI — filter chips bound to URL query params

**Files:**
- Modify: `client/src/pages/WarrantsPage.tsx`

### Step 9.1: Add filter state + URL sync

Inside `WarrantsPage`, add:

```typescript
const [filterPriority, setFilterPriority] = useState(false);
const [filterSinceWeek, setFilterSinceWeek] = useState(false);
const [filterMatches, setFilterMatches] = useState(false);
const [filterState, setFilterState] = useState<string>('');
const [filterFederal, setFilterFederal] = useState(false);
const [filterArchived, setFilterArchived] = useState(false);

const anyFilterActive = filterPriority || filterSinceWeek || filterMatches || !!filterState || filterFederal || filterArchived;

function clearAllFilters() {
  setFilterPriority(false);
  setFilterSinceWeek(false);
  setFilterMatches(false);
  setFilterState('');
  setFilterFederal(false);
  setFilterArchived(false);
}

// Hydrate from URL on mount
useEffect(() => {
  const p = new URLSearchParams(window.location.search);
  setFilterPriority(p.get('priority_min') === '70');
  setFilterSinceWeek(p.get('since_days') === '7');
  setFilterMatches(p.get('matches_person') === '1');
  setFilterState(p.get('state') || '');
  setFilterFederal(p.get('state_prefix') === 'fed_');
  setFilterArchived(p.get('include_archived') === '1');
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

// Persist to URL when filters change
useEffect(() => {
  const p = new URLSearchParams();
  if (filterPriority) p.set('priority_min', '70');
  if (filterSinceWeek) p.set('since_days', '7');
  if (filterMatches) p.set('matches_person', '1');
  if (filterState) p.set('state', filterState);
  if (filterFederal) p.set('state_prefix', 'fed_');
  if (filterArchived) p.set('include_archived', '1');
  const qs = p.toString();
  window.history.replaceState({}, '', qs ? `?${qs}` : window.location.pathname);
}, [filterPriority, filterSinceWeek, filterMatches, filterState, filterFederal, filterArchived]);
```

### Step 9.2: Render the chip bar

Above the warrants table, inside the Warrants-tab JSX:

```tsx
<div className="flex flex-wrap gap-1.5 px-3 py-2 border-b border-[#222]">
  <FilterChip active={!anyFilterActive} onClick={clearAllFilters}>All</FilterChip>
  <FilterChip active={filterPriority} onClick={() => setFilterPriority(v => !v)}>High priority</FilterChip>
  <FilterChip active={filterSinceWeek} onClick={() => setFilterSinceWeek(v => !v)}>New this week</FilterChip>
  <FilterChip active={filterMatches} onClick={() => setFilterMatches(v => !v)}>Matches our person</FilterChip>
  <select value={filterState} onChange={e => setFilterState(e.target.value)} className="select-dark text-xs">
    <option value="">By state</option>
    <option value="UT">UT</option>
    <option value="NV">NV</option>
    <option value="WY">WY</option>
    <option value="CO">CO</option>
  </select>
  <FilterChip active={filterFederal} onClick={() => setFilterFederal(v => !v)}>Federal only</FilterChip>
  <FilterChip active={filterArchived} onClick={() => setFilterArchived(v => !v)}>Show archived</FilterChip>
</div>
```

Define the `FilterChip` component inline at the top of the file:

```tsx
function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`px-2.5 py-1 text-[10px] uppercase font-bold tracking-wider border ${active ? 'bg-[#d4a017] text-black border-[#d4a017]' : 'bg-transparent text-rmpg-300 border-rmpg-600 hover:border-rmpg-400'}`}>
      {children}
    </button>
  );
}
```

### Step 9.3: Wire filter state into `fetchWarrants`

Modify the URL construction in `fetchWarrants`:

```typescript
const params = new URLSearchParams();
if (filterPriority) params.set('priority_min', '70');
if (filterSinceWeek) params.set('since_days', '7');
if (filterMatches) params.set('matches_person', '1');
if (filterState) params.set('state', filterState);
if (filterFederal) params.set('state_prefix', 'fed_');
if (filterArchived) params.set('include_archived', '1');
if (sortKey) params.set('sort', sortKey);
if (sortOrder) params.set('order', sortOrder);
return apiFetch<{ data: any[] }>(`/warrants?${params.toString()}`);
```

### Step 9.4: Re-fetch when filters change

```typescript
useEffect(() => {
  if (activeTab === 'warrants') fetchWarrants();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [filterPriority, filterSinceWeek, filterMatches, filterState, filterFederal, filterArchived, sortKey, sortOrder]);
```

### Step 9.5: Typecheck + commit

Run: `cd client && npx tsc --noEmit`

```bash
git add client/src/pages/WarrantsPage.tsx
git commit -m "feat(warrants-ui): filter chips with URL query-param persistence"
```

---

## Task 10: UI — bulk action bar (select / archive / review / print-packet)

**Files:**
- Modify: `client/src/pages/WarrantsPage.tsx`
- Modify: `client/src/utils/recordPdfGenerator.ts` (extract `renderWarrantIntoDoc`)

### Step 10.1: Extract reusable render function

In `client/src/utils/recordPdfGenerator.ts`, refactor `generateWarrantReport` so its body is callable from both a single-warrant flow and a packet flow.

Split the current async function into:

```typescript
export async function renderWarrantIntoDoc(doc: jsPDF, data: WarrantPdfData): Promise<void> {
  // ... entire current body of generateWarrantReport that operates on `doc` ...
}

async function generateWarrantReport(doc: jsPDF, data: WarrantPdfData) {
  await renderWarrantIntoDoc(doc, data);
}
```

This requires no behavior change — it's just a rename of the body into an exported helper.

### Step 10.2: Add packet-builder helper

Create `client/src/utils/warrantPacket.ts`:

```typescript
import { jsPDF } from 'jspdf';
import { renderWarrantIntoDoc, type WarrantPdfData } from './recordPdfGenerator';
import { apiFetch } from '../hooks/useApi';

export async function buildWarrantPacketPdf(warrantIds: number[], currentUser?: { full_name?: string; badge_number?: string }): Promise<void> {
  const doc = new jsPDF();
  let first = true;
  for (const id of warrantIds) {
    const res = await apiFetch<{ data: any }>(`/warrants/${id}`);
    const data: WarrantPdfData = {
      ...res.data,
      printed_by_name: currentUser?.full_name,
      printed_by_badge: currentUser?.badge_number,
      printed_at: new Date().toISOString(),
    };
    if (!first) doc.addPage();
    first = false;
    await renderWarrantIntoDoc(doc, data);
  }
  doc.save(`warrant-packet-${new Date().toISOString().slice(0, 10)}.pdf`);
}
```

### Step 10.3: Add selection state + action bar in WarrantsPage

```typescript
const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

function toggleRowSelect(id: number) {
  setSelectedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
}
```

Action bar (inside Warrants tab, above the chip bar):

```tsx
{selectedIds.size > 0 && (
  <div className="flex items-center gap-2 px-3 py-2 bg-[#d4a017]/10 border-b border-[#d4a017]/40">
    <span className="text-xs text-[#d4a017] font-bold">{selectedIds.size} selected</span>
    <button onClick={handleBulkPrintPacket} className="toolbar-btn text-xs">Print packet PDF</button>
    <button onClick={handleBulkReview} className="toolbar-btn text-xs">Mark reviewed</button>
    <button onClick={handleBulkArchive} className="toolbar-btn text-xs">Archive</button>
    <button onClick={() => setSelectedIds(new Set())} className="toolbar-btn text-xs">Clear</button>
  </div>
)}
```

### Step 10.4: Handlers

```typescript
async function handleBulkArchive() {
  if (!selectedIds.size) return;
  if (!window.confirm(`Archive ${selectedIds.size} warrant(s)?`)) return;
  const res = await apiFetch<{ archived: number; skipped: number }>('/warrants/bulk-archive', {
    method: 'POST',
    body: JSON.stringify({ warrant_ids: Array.from(selectedIds) }),
  });
  addToast(`Archived ${res.archived} warrant(s)${res.skipped ? `, skipped ${res.skipped} already-archived` : ''}`, 'success');
  setSelectedIds(new Set());
  fetchWarrants();
}

async function handleBulkReview() {
  if (!selectedIds.size) return;
  const res = await apiFetch<{ reviewed: number }>('/warrants/bulk-review', {
    method: 'POST',
    body: JSON.stringify({ warrant_ids: Array.from(selectedIds) }),
  });
  addToast(`Marked ${res.reviewed} warrant(s) reviewed`, 'success');
  setSelectedIds(new Set());
  fetchWarrants();
}

async function handleBulkPrintPacket() {
  if (!selectedIds.size) return;
  if (selectedIds.size > 200) { addToast('Packet print limited to 200 warrants', 'error'); return; }
  if (selectedIds.size > 50 && !window.confirm(`Print ${selectedIds.size} warrants as a single packet? This may take 30+ seconds.`)) return;
  const ids = Array.from(selectedIds);
  await buildWarrantPacketPdf(ids, { full_name: currentUser?.full_name, badge_number: currentUser?.badge_number });
  addToast(`Packet PDF generated (${ids.length} warrants)`, 'success');
}
```

Import `buildWarrantPacketPdf` at the top of `WarrantsPage.tsx`.

### Step 10.5: Typecheck + commit

Run: `cd client && npx tsc --noEmit`

```bash
git add client/src/utils/warrantPacket.ts client/src/utils/recordPdfGenerator.ts client/src/pages/WarrantsPage.tsx
git commit -m "feat(warrants-ui): bulk action bar (archive/review/print-packet) + shared packet builder"
```

---

## Task 11: Detail panel additions — source provenance + RMPG encounters + print button

**Files:**
- Modify: `client/src/pages/WarrantsPage.tsx`

### Step 11.1: Render new collapsible sections in the detail panel

When a warrant is selected, add to the right-side detail panel:

```tsx
{detail.source_scraper_name && (
  <CollapsibleSection title="Source / Provenance" icon={Database} defaultOpen={false}>
    <div className="text-xs space-y-1">
      <div>Scraper: <span className="text-rmpg-200">{detail.source_scraper_name}</span></div>
      <div>State: <span className="text-rmpg-200">{detail.source_state}</span></div>
      {detail.source_url && <div>URL: <a href={detail.source_url} target="_blank" rel="noreferrer" className="text-amber-400 underline">link</a></div>}
      <div>Last refreshed: {fmtDate(detail.last_scraped_at)}</div>
    </div>
  </CollapsibleSection>
)}

{detail.rmpg_encounters?.length > 0 && (
  <CollapsibleSection title={`RMPG Encounters (${detail.rmpg_encounters.length})`} icon={Activity} defaultOpen={false}>
    {detail.rmpg_encounters.slice(0, 20).map((e: any, i: number) => (
      <div key={i} className="text-xs py-1 border-b border-rmpg-700">
        <span className="text-rmpg-400">{fmtDate(e.date)}</span>
        <span className="text-rmpg-200 ml-2">{e.context}</span>
        {e.property && <span className="text-rmpg-500 ml-2">— {e.property}</span>}
      </div>
    ))}
  </CollapsibleSection>
)}

{(detail.known_associates?.length > 0 || detail.known_vehicles?.length > 0) && (
  <CollapsibleSection title="Known Associates & Vehicles" icon={Users} defaultOpen={false}>
    {detail.known_associates?.map((a: any, i: number) => (
      <div key={`a${i}`} className="text-xs">{a.name} ({a.relationship})</div>
    ))}
    {detail.known_vehicles?.map((v: any, i: number) => (
      <div key={`v${i}`} className="text-xs">{v.plate}  {v.description}</div>
    ))}
  </CollapsibleSection>
)}

<button onClick={() => handlePrintWarrantPdf(detail.id)} className="toolbar-btn toolbar-btn-primary w-full mt-3">
  <Printer className="w-3.5 h-3.5" /> Print PDF
</button>
```

### Step 11.2: `handlePrintWarrantPdf`

```typescript
async function handlePrintWarrantPdf(id: number) {
  const res = await apiFetch<{ data: any }>(`/warrants/${id}`);
  const data = {
    ...res.data,
    subject_aliases: res.data.subject_aliases ? [res.data.subject_aliases] : undefined,
    printed_by_name: currentUser?.full_name,
    printed_by_badge: currentUser?.badge_number,
    printed_at: new Date().toISOString(),
  };
  await downloadRecordPdf('warrant', data, `warrant-${data.warrant_number}.pdf`);
}
```

### Step 11.3: Typecheck + commit

Run: `cd client && npx tsc --noEmit`

```bash
git add client/src/pages/WarrantsPage.tsx
git commit -m "feat(warrants-ui): detail panel source/encounters/associates collapsibles + Print PDF button"
```

---

## Task 12: Full verification + deploy

### Step 12.1: Run full server vitest

Run: `cd server && npx vitest run`
Expected: **~610 passing (589 existing + ~21 new)**, 0 failures.

### Step 12.2: Run full client vitest

Run: `cd client && npx vitest run`
Expected: all pass.

### Step 12.3: Full typecheck

Run: `cd server && npx tsc --noEmit` → 0 errors.
Run: `cd client && npx tsc --noEmit` → 0 errors.

### Step 12.4: Client build

Run: `cd client && npx vite build` → exit 0.

### Step 12.5: Bump SW cache

Find the current `CACHE_NAME` in `client/public/sw.js`, increment the trailing integer (e.g. v182 → v183).

### Step 12.6: Apply to live VPS

From the VPS feature clone:

```bash
cp -r /tmp/feat-warrants/server/src/* /opt/rmpg-flex/server/src/
cp -r /tmp/feat-warrants/client/src/* /opt/rmpg-flex/client/src/
cp /tmp/feat-warrants/client/public/sw.js /opt/rmpg-flex/client/public/sw.js
cd /opt/rmpg-flex/client && npx vite build
systemctl restart rmpg-flex
sleep 3
curl -sf https://rmpgutah.us/api/health
```

### Step 12.7: Manual checklist on production

- [ ] Warrants tab — new columns render (Match/Priority/Age/Freshness/Source)
- [ ] Click "High priority" chip — URL gets `?priority_min=70`, results filter
- [ ] Click "Matches our person" chip — AND logic applies
- [ ] Clear all filters — URL clean, all rows back
- [ ] Sort by Age ascending/descending works
- [ ] Sticky header stays on scroll
- [ ] Select 3 warrants — action bar shows "3 selected"
- [ ] Bulk archive 3 — toast "Archived 3", rows removed
- [ ] Bulk review 3 — toast "Marked 3 reviewed"
- [ ] Bulk print packet 3 — single PDF with 3 warrants downloads
- [ ] Click a warrant — detail panel loads with Source/Encounters/Associates sections
- [ ] Click Print PDF — opens single-warrant PDF with QR, NCIC block, bigger mugshot, statute text
- [ ] Scan the QR with phone — opens `/warrants/:id`
- [ ] Print an expired warrant — EXPIRED watermark visible
- [ ] Print an archived warrant — ARCHIVED watermark visible
- [ ] `WarrantAlertBanner` still shows on a call with linked person — regression
- [ ] `WarrantBadge` still shows on a person record — regression

### Step 12.8: Commit cache bump + push

```bash
git add client/public/sw.js
git commit -m "chore(sw): bump cache version for warrants PDF v2 + UI deploy"
git push
```

### Step 12.9: Open PR

```bash
gh pr create \
  --base main \
  --head feat/warrants-pdf-ui-phase-1-2026-04-24 \
  --title "feat(warrants): PDF v2 + list UI polish (Phase 1)" \
  --body "See docs/plans/2026-04-24-warrants-pdf-ui-phase-1-design.md for design. Implementation plan at docs/plans/2026-04-24-warrants-pdf-ui-phase-1-plan.md. All 12 tasks complete; vitest green; production verified."
```

### Step 12.10: Inspect commit history

```bash
git log --oneline feat/warrants-pdf-ui-phase-1-2026-04-24 ^main
```

Expected: ~11 commits from Tasks 1–11 + cache bump + design doc.

---

## Success criteria

- [ ] All 12 tasks complete, each with its own commit
- [ ] Server typecheck 0 errors
- [ ] Client typecheck 0 errors
- [ ] Client vite build exit 0
- [ ] Full vitest: 589 → ~610 passing, 0 failures
- [ ] Manual checklist 100% green on production
- [ ] No regression in `WarrantAlertBanner`, `WarrantBadge`, existing PDF consumers
- [ ] PR open and MERGEABLE
