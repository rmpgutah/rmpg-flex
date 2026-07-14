# Forensics Government-Standard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `src/routes/forensics.ts` to a CJIS/ISO-17025-style government standard by adding tamper-evident exhibit hashing, RMS cross-links, a properly-recorded QC workflow, and report/analysis templates — closing the gaps documented in [docs/superpowers/specs/2026-07-13-forensics-government-standard-design.md](../specs/2026-07-13-forensics-government-standard-design.md).

**Architecture:** One new migration (`0187_forensics_gov_standard.sql`) adds 5 tables (`forensic_exhibit_hashes`, `forensic_case_links`, `forensic_qc_checks`, `forensic_report_templates`, `forensic_analysis_templates`) plus 2 columns on `forensic_cases` (`metadata`, `report_sections`). All new endpoints are added directly to the existing `src/routes/forensics.ts` file, following its established conventions (`requireRole`, `logActivity`, `dbErrorResponse`, `query`/`queryFirst`/`execute` from `src/utils/db.ts`). The frontend (`ForensicLabPage.tsx`) already calls most of these endpoints and silently swallows their 404s — this plan makes those calls succeed and fixes one real, previously-undiscovered bug along the way (see Task 1, discovery note).

**Tech Stack:** Hono (Cloudflare Worker), D1 (SQLite), Vitest + `@cloudflare/vitest-pool-workers` (Miniflare) for Worker tests, React/TypeScript client.

---

## Pre-flight

- [ ] **Step 1: Confirm the next free migration number**

Run: `ls migrations/*.sql | sed 's/.*\///' | sort -V | tail -3`
Expected: highest file is `0186_warrants_reviewed_at.sql` (confirmed at design time — re-check in case other work landed since). If a higher number exists, use `<highest + 1>` in place of `0187` throughout this plan.

- [ ] **Step 2: Confirm you're on the right branch**

Run: `git branch --show-current`
Expected: `claude/connections-forensics-reconstruction-09a1ce` (or whatever feature branch this work is happening on — do not commit to `main`).

---

## Task 1: Migration — new tables and columns

**Discovery note (read before starting):** while researching this task, inspection of `ForensicLabPage.tsx:780-792` (`saveMetadata`/`parseMeta`) showed the digital-imaging metadata feature (`handleSaveImaging`) already sends `PUT /forensic-lab/:id` with a `metadata` field — but `forensic_cases` has **no `metadata` column**, and `CASE_UPDATABLE` (forensics.ts:320-325) doesn't include `metadata` either. Since it's the *only* field in that PUT body, the request currently hits the `sets.length === 0` guard and returns `400 NO_FIELDS` — **imaging metadata saves are silently broken today**. This task fixes that as part of adding `metadata`/`report_sections` columns (Task 2 wires `metadata` into `CASE_UPDATABLE`).

**Files:**
- Create: `migrations/0187_forensics_gov_standard.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- ============================================================
-- 0187_forensics_gov_standard.sql
-- ============================================================
-- Forensics government-standard follow-up to 0029_forensics.sql:
-- tamper-evident exhibit hashing, RMS cross-links, formalized QC,
-- and report/analysis templates. See
-- docs/superpowers/specs/2026-07-13-forensics-government-standard-design.md
-- ============================================================

-- ── forensic_exhibit_hashes — append-only hash history per exhibit ──
-- Never UPDATE a row. Re-verifying inserts a new purpose='reverify' row;
-- the API layer compares it against the most recent same-algorithm row
-- and sets mismatch=1 if they differ. This history IS the tamper
-- evidence — overwriting hash_md5/hash_sha256 on forensic_exhibits
-- (as the original MVP did) destroys exactly the evidence a re-hash is
-- supposed to produce.
CREATE TABLE IF NOT EXISTS forensic_exhibit_hashes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  forensic_case_id INTEGER NOT NULL REFERENCES forensic_cases(id) ON DELETE CASCADE,
  exhibit_id INTEGER NOT NULL REFERENCES forensic_exhibits(id) ON DELETE CASCADE,
  algorithm TEXT NOT NULL CHECK(algorithm IN ('md5','sha1','sha256')),
  hash_value TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'intake' CHECK(purpose IN ('intake','reverify')),
  file_name TEXT,
  mismatch INTEGER NOT NULL DEFAULT 0,
  computed_by INTEGER REFERENCES users(id),
  computed_by_name TEXT,
  computed_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_forensic_exhibit_hashes_exhibit ON forensic_exhibit_hashes(exhibit_id);
CREATE INDEX IF NOT EXISTS idx_forensic_exhibit_hashes_case ON forensic_exhibit_hashes(forensic_case_id);

-- ── forensic_case_links — cross-references to other RMS entities ──
-- Same shape/spirit as the app-wide `record_links` table, scoped to
-- forensic cases so it can be queried the same way `record_links` is
-- queried in src/routes/connections.ts.
CREATE TABLE IF NOT EXISTS forensic_case_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  forensic_case_id INTEGER NOT NULL REFERENCES forensic_cases(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  entity_label TEXT,
  relationship TEXT NOT NULL DEFAULT 'related',
  linked_by INTEGER REFERENCES users(id),
  linked_by_name TEXT,
  linked_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(forensic_case_id, entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_forensic_case_links_case ON forensic_case_links(forensic_case_id);

-- ── forensic_qc_checks — formal QC record (ISO-17025/ANAB-style) ──
-- Previously QC checks were written into the generic `activity_log`
-- table with a JSON-stringified `details` blob the frontend couldn't
-- reliably parse (checked `details?.includes('PASS')` against JSON —
-- never matched). A dedicated table is also what accreditation
-- standards expect: QC is its own auditable record, not folded into
-- generic activity.
CREATE TABLE IF NOT EXISTS forensic_qc_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  forensic_case_id INTEGER NOT NULL REFERENCES forensic_cases(id) ON DELETE CASCADE,
  exhibit_id INTEGER REFERENCES forensic_exhibits(id) ON DELETE SET NULL,
  check_type TEXT NOT NULL,
  reviewer_id INTEGER REFERENCES users(id),
  reviewer_name TEXT,
  pass INTEGER NOT NULL DEFAULT 1,
  reviewer_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_forensic_qc_checks_case ON forensic_qc_checks(forensic_case_id);

-- ── Report + analysis templates ──
-- GET /forensics/templates/report and GET /forensics/analysis-templates
-- already exist in src/routes/forensics.ts and query these exact table
-- names — they've been 404-ing to an empty array because the tables
-- were never created in any prior migration.
CREATE TABLE IF NOT EXISTS forensic_report_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  case_type TEXT,
  sections TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS forensic_analysis_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  case_type TEXT,
  analysis_type TEXT NOT NULL,
  methodology TEXT,
  equipment_used TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ── forensic_cases new columns ──
-- metadata: generic per-case JSON bag. ForensicLabPage.tsx's
-- parseMeta()/saveMetadata() already read/write this field name via
-- PUT /forensic-lab/:id — the column has just never existed, so every
-- imaging-metadata save has been silently failing (see plan Task 1
-- discovery note). D1 has no ADD COLUMN IF NOT EXISTS; per CLAUDE.md
-- this is expected to error harmlessly on re-apply.
ALTER TABLE forensic_cases ADD COLUMN metadata TEXT DEFAULT '{}';

-- report_sections: JSON section list applied from a report template via
-- POST /forensic-lab/:caseId/apply-template (Task 5), read by
-- generateForensicCasePdf() to render a structured layout.
ALTER TABLE forensic_cases ADD COLUMN report_sections TEXT;

-- ── Starter templates so the tabs aren't empty on first deploy ──
INSERT INTO forensic_report_templates (name, case_type, sections) VALUES
  ('Standard DNA Report', 'general', '[{"key":"summary","label":"Case Summary"},{"key":"exhibits","label":"Exhibit Inventory"},{"key":"methodology","label":"Methodology"},{"key":"results","label":"Results"},{"key":"conclusion","label":"Conclusion"}]'),
  ('Digital Forensics Imaging Report', 'digital', '[{"key":"summary","label":"Case Summary"},{"key":"imaging","label":"Acquisition & Imaging"},{"key":"exhibits","label":"Exhibit Inventory"},{"key":"analysis","label":"Analysis Findings"},{"key":"conclusion","label":"Conclusion"}]');

INSERT INTO forensic_analysis_templates (name, case_type, analysis_type, methodology, equipment_used) VALUES
  ('Standard DNA Extraction & Profiling', 'general', 'dna', 'STR profiling per standard operating procedure', 'Genetic analyzer'),
  ('Digital Forensics Imaging', 'digital', 'digital_forensics', 'Forensic bit-for-bit disk image with write-blocker; hash verification pre/post', 'Write-blocker, forensic imaging workstation');
```

- [ ] **Step 2: Apply locally and verify**

Run: `npm run migrate:local`
Expected: completes without error (the two `ALTER TABLE` statements may print a "duplicate column" warning on a *second* run only — first run should be clean).

Run: `npx wrangler d1 execute rmpg-flex --local --command "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'forensic_%'"`
Expected: includes `forensic_cases`, `forensic_exhibits`, `forensic_analyses`, `forensic_activity_log`, `forensic_exhibit_hashes`, `forensic_case_links`, `forensic_qc_checks`, `forensic_report_templates`, `forensic_analysis_templates`.

- [ ] **Step 3: Commit**

```bash
git add migrations/0187_forensics_gov_standard.sql
git commit -m "feat(forensics): add tables for exhibit hashes, case links, QC checks, and templates"
```

---

## Task 2: Hash / tamper-evidence endpoints

**Files:**
- Modify: `src/routes/forensics.ts` (insert after the custody-transfer endpoint, which ends at line 612, before the `// ANALYSES` section header)
- Modify: `src/routes/forensics.ts:320-325` (`CASE_UPDATABLE` — add `'metadata'`, `'report_sections'`)
- Test: `test-workers/forensicsHashes.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test-workers/forensicsHashes.test.ts
//
// Route-level test (Miniflare/workerd) for the forensic exhibit hash
// endpoints. Covers the tamper-evidence contract: intake hash recorded
// clean, a differing re-verify hash gets flagged as a mismatch, and the
// GET /:caseId/hashes stats roll up correctly.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import forensics from '../src/routes/forensics';

const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
app.use('*', async (c, next) => {
  c.set('user', { id: 1, role: 'admin', username: 'test-examiner' });
  c.set('userId', 1);
  await next();
});
app.route('/api/forensic-lab', forensics);

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT, role TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS forensic_cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT, lab_number TEXT UNIQUE NOT NULL,
    case_type TEXT NOT NULL DEFAULT 'general', status TEXT NOT NULL DEFAULT 'received',
    priority TEXT NOT NULL DEFAULT 'normal', title TEXT NOT NULL, description TEXT,
    requesting_agency TEXT, requesting_officer TEXT, lead_examiner_id INTEGER,
    linked_incident_id INTEGER, linked_case_id INTEGER, linked_incident_number TEXT,
    linked_case_number TEXT, received_date TEXT NOT NULL DEFAULT (datetime('now')),
    due_date TEXT, completed_date TEXT, released_date TEXT, notes TEXT,
    metadata TEXT DEFAULT '{}', report_sections TEXT, archived_at TEXT,
    created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS forensic_exhibits (
    id INTEGER PRIMARY KEY AUTOINCREMENT, forensic_case_id INTEGER NOT NULL,
    exhibit_number TEXT NOT NULL, exhibit_type TEXT NOT NULL DEFAULT 'other',
    description TEXT NOT NULL, hash_md5 TEXT, hash_sha256 TEXT,
    chain_of_custody TEXT DEFAULT '[]', disposition TEXT DEFAULT 'in_lab',
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS forensic_exhibit_hashes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, forensic_case_id INTEGER NOT NULL,
    exhibit_id INTEGER NOT NULL, algorithm TEXT NOT NULL, hash_value TEXT NOT NULL,
    purpose TEXT NOT NULL DEFAULT 'intake', file_name TEXT, mismatch INTEGER NOT NULL DEFAULT 0,
    computed_by INTEGER, computed_by_name TEXT, computed_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS forensic_activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, forensic_case_id INTEGER NOT NULL,
    exhibit_id INTEGER, action TEXT NOT NULL, details TEXT,
    performed_by INTEGER, performed_by_name TEXT, performed_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS forensic_hash_sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, set_type TEXT NOT NULL
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS forensic_hash_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT, hash_set_id INTEGER NOT NULL,
    hash_value TEXT NOT NULL, hash_type TEXT NOT NULL
  )`);
  await execute(db, `INSERT INTO users (id, full_name, role) VALUES (1, 'Test Examiner', 'admin')`);
});

describe('POST /:caseId/exhibits/:exhibitId/hashes — tamper-evidence', () => {
  it('records a clean intake hash with mismatch=false', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    await execute(db, `INSERT INTO forensic_cases (id, lab_number, title) VALUES (1, 'LAB-26-0001', 'Test Case')`);
    await execute(db, `INSERT INTO forensic_exhibits (id, forensic_case_id, exhibit_number, description) VALUES (1, 1, 'E-001', 'Hard drive')`);

    const res = await app.request('/api/forensic-lab/1/exhibits/1/hashes', {
      method: 'POST', body: JSON.stringify({ algorithm: 'sha256', hash_value: 'AABBCC', purpose: 'intake' }),
    }, env as unknown as Record<string, unknown>);

    expect(res.status).toBe(201);
    const body = await res.json() as { mismatch: boolean; data: { hash_value: string } };
    expect(body.mismatch).toBe(false);
    expect(body.data.hash_value).toBe('aabbcc'); // lowercased for consistent comparison
  });

  it('flags a differing re-verify hash as a mismatch', async () => {
    const res = await app.request('/api/forensic-lab/1/exhibits/1/hashes', {
      method: 'POST', body: JSON.stringify({ algorithm: 'sha256', hash_value: 'DDEEFF', purpose: 'reverify' }),
    }, env as unknown as Record<string, unknown>);

    expect(res.status).toBe(201);
    const body = await res.json() as { mismatch: boolean };
    expect(body.mismatch).toBe(true);
  });

  it('GET /:caseId/hashes rolls up total/flagged stats', async () => {
    const res = await app.request('/api/forensic-lab/1/hashes', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { hashes: unknown[]; stats: { total: number; flagged: number } };
    expect(body.stats.total).toBe(2);
    expect(body.stats.flagged).toBe(1); // the mismatch row
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:worker -- forensicsHashes`
Expected: FAIL — `POST /api/forensic-lab/1/exhibits/1/hashes` returns 404 (route doesn't exist yet).

- [ ] **Step 3: Add `metadata`/`report_sections` to `CASE_UPDATABLE`**

In `src/routes/forensics.ts`, find:

```typescript
const CASE_UPDATABLE = new Set([
  'case_type', 'status', 'priority', 'title', 'description',
  'requesting_agency', 'requesting_officer', 'lead_examiner_id',
  'linked_incident_id', 'linked_case_id', 'linked_incident_number',
  'linked_case_number', 'due_date', 'completed_date', 'released_date', 'notes',
]);
```

Replace with:

```typescript
const CASE_UPDATABLE = new Set([
  'case_type', 'status', 'priority', 'title', 'description',
  'requesting_agency', 'requesting_officer', 'lead_examiner_id',
  'linked_incident_id', 'linked_case_id', 'linked_incident_number',
  'linked_case_number', 'due_date', 'completed_date', 'released_date', 'notes',
  // metadata: generic per-case JSON bag (imaging workflow, etc.) — client
  // already sends this via saveMetadata() in ForensicLabPage.tsx, but the
  // column/field didn't exist until migration 0187, so every save 400'd
  // on "No fields to update". report_sections: JSON layout from an
  // applied report template (see POST /:caseId/apply-template).
  'metadata', 'report_sections',
]);
```

- [ ] **Step 4: Insert the hash endpoints**

In `src/routes/forensics.ts`, immediately after the custody-transfer endpoint's closing `});` (the block ending `return c.json({ error: 'Failed to record custody transfer', code: 'CUSTODY_ERROR' }, 500);\n  }\n});`) and before the `// ANALYSES` section comment block, insert:

```typescript
// ═══════════════════════════════════════════════════════════════
// HASHES — tamper-evident file integrity (forensic_exhibit_hashes)
// ═══════════════════════════════════════════════════════════════

const HASH_ALGORITHMS = new Set(['md5', 'sha1', 'sha256']);
const HASH_PURPOSES = new Set(['intake', 'reverify']);

// POST /:caseId/exhibits/:exhibitId/hashes — append-only. Compares the new
// value against the most recent row for the same algorithm on this
// exhibit; a differing value is flagged as a possible tamper event and
// logged to the case activity timeline (not just the Hashes tab), since
// a hash mismatch is chain-of-custody-critical, not merely informational.
forensics.post('/:caseId/exhibits/:exhibitId/hashes', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const caseId = parseInt(c.req.param('caseId'), 10);
    const exhibitId = parseInt(c.req.param('exhibitId'), 10);
    if (isNaN(caseId) || isNaN(exhibitId)) return c.json({ error: 'Invalid IDs', code: 'INVALID_ID' }, 400);
    const userId = c.get('userId') as number;
    const b = await c.req.json<Record<string, unknown>>();

    if (typeof b.algorithm !== 'string' || !HASH_ALGORITHMS.has(b.algorithm)) {
      return c.json({ error: 'algorithm must be one of md5, sha1, sha256', code: 'ALGORITHM_REQUIRED' }, 400);
    }
    if (typeof b.hash_value !== 'string' || !b.hash_value.trim()) {
      return c.json({ error: 'hash_value required', code: 'HASH_VALUE_REQUIRED' }, 400);
    }
    const purpose = typeof b.purpose === 'string' && HASH_PURPOSES.has(b.purpose) ? b.purpose : 'intake';
    const hashValue = b.hash_value.trim().toLowerCase();

    const exhibit = await queryFirst<{ id: number }>(
      db, 'SELECT id FROM forensic_exhibits WHERE id = ? AND forensic_case_id = ?', exhibitId, caseId,
    );
    if (!exhibit) return c.json({ error: 'Exhibit not found', code: 'NOT_FOUND' }, 404);

    const prior = await queryFirst<{ hash_value: string }>(
      db,
      `SELECT hash_value FROM forensic_exhibit_hashes
       WHERE exhibit_id = ? AND algorithm = ? ORDER BY computed_at DESC, id DESC LIMIT 1`,
      exhibitId, b.algorithm,
    );
    const mismatch = prior ? prior.hash_value.toLowerCase() !== hashValue : false;

    const user = await queryFirst<{ full_name: string }>(db, 'SELECT full_name FROM users WHERE id = ?', userId);
    const result = await execute(
      db,
      `INSERT INTO forensic_exhibit_hashes
         (forensic_case_id, exhibit_id, algorithm, hash_value, purpose, file_name, mismatch, computed_by, computed_by_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      caseId, exhibitId, b.algorithm, hashValue, purpose, b.file_name ?? null, mismatch ? 1 : 0, userId, user?.full_name ?? '',
    );
    const newId = Number(result.meta.last_row_id);

    if (mismatch) {
      await logActivity(db, caseId, 'hash_mismatch',
        `${b.algorithm.toUpperCase()} mismatch on exhibit ${exhibitId} (${purpose})`,
        userId, user?.full_name ?? '', exhibitId);
    } else {
      await logActivity(db, caseId, 'hash_recorded',
        `${b.algorithm.toUpperCase()} ${purpose} hash recorded for exhibit ${exhibitId}`,
        userId, user?.full_name ?? '', exhibitId);
    }

    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM forensic_exhibit_hashes WHERE id = ?', newId);
    return c.json({ data: created, mismatch }, 201);
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to record hash', 'HASH_POST_ERROR');
  }
});

// GET /:caseId/hashes — flat list across every exhibit in the case, plus
// the {total, flagged, matched} stats ForensicLabPage.tsx's Hashes tab
// reads directly. `matched`/`flagged` cross-reference forensic_hash_entries
// (populated by the existing IPED import pipeline, src/routes/iped.ts) —
// a match against a 'known_bad' set folds into `flagged` alongside
// mismatches; a match against any other set type (nsrl/known_good/etc.)
// counts as `matched` only.
forensics.get('/:caseId/hashes', async (c) => {
  try {
    const db = getDb(c.env);
    const caseId = parseInt(c.req.param('caseId'), 10);
    if (isNaN(caseId)) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);

    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT h.*, e.exhibit_number, e.description AS exhibit_description
       FROM forensic_exhibit_hashes h
       JOIN forensic_exhibits e ON h.exhibit_id = e.id
       WHERE h.forensic_case_id = ?
       ORDER BY h.computed_at DESC, h.id DESC`,
      caseId,
    );

    const hashes: Record<string, unknown>[] = [];
    let flagged = 0;
    let matched = 0;
    for (const row of rows) {
      const hashValue = row.hash_value as string;
      const hashType = row.algorithm as string;
      const setMatch = await queryFirst<{ set_type: string }>(
        db,
        `SELECT hs.set_type FROM forensic_hash_entries fe
         JOIN forensic_hash_sets hs ON fe.hash_set_id = hs.id
         WHERE fe.hash_value = ? AND fe.hash_type = ? LIMIT 1`,
        hashValue, hashType,
      );
      const hashSetMatch = !!setMatch;
      const isMismatch = row.mismatch === 1;
      const isKnownBad = setMatch?.set_type === 'known_bad';
      if (isMismatch || isKnownBad) flagged++;
      if (hashSetMatch && !isKnownBad) matched++;
      hashes.push({
        ...row,
        file_name: row.file_name ?? row.exhibit_description,
        sha256: hashType === 'sha256' ? hashValue : undefined,
        flagged: isMismatch || isKnownBad,
        hash_set_match: hashSetMatch,
        hash_set_type: setMatch?.set_type ?? null,
      });
    }

    return c.json({ hashes, stats: { total: hashes.length, flagged, matched } });
  } catch (err) {
    return c.json({ error: 'Failed to get hashes', code: 'HASHES_GET_ERROR' }, 500);
  }
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:worker -- forensicsHashes`
Expected: PASS (3 tests).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add src/routes/forensics.ts test-workers/forensicsHashes.test.ts
git commit -m "feat(forensics): add tamper-evident hash endpoints and fix broken metadata save"
```

---

## Task 3: Cross-links endpoints

**Files:**
- Modify: `src/routes/forensics.ts` (insert after the hash endpoints from Task 2, before `// ANALYSES`)
- Test: `test-workers/forensicsLinks.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test-workers/forensicsLinks.test.ts
//
// Route-level test for forensic case cross-links: search, create, list,
// delete. Mirrors the request/response contract of GET /records/search
// (src/routes/records.ts:2003) so the ForensicLabPage Links tab's search
// bar behaves identically to LinkRecordModal elsewhere in the app.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import forensics from '../src/routes/forensics';

const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
app.use('*', async (c, next) => {
  c.set('user', { id: 1, role: 'admin', username: 'test-examiner' });
  c.set('userId', 1);
  await next();
});
app.route('/api/forensic-lab', forensics);

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT, role TEXT)`);
  await execute(db, `CREATE TABLE IF NOT EXISTS forensic_cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT, lab_number TEXT UNIQUE NOT NULL, title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'received', created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS forensic_case_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT, forensic_case_id INTEGER NOT NULL,
    entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL, entity_label TEXT,
    relationship TEXT NOT NULL DEFAULT 'related', linked_by INTEGER, linked_by_name TEXT,
    linked_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS forensic_activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, forensic_case_id INTEGER NOT NULL, exhibit_id INTEGER,
    action TEXT NOT NULL, details TEXT, performed_by INTEGER, performed_by_name TEXT,
    performed_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS persons (
    id INTEGER PRIMARY KEY AUTOINCREMENT, first_name TEXT, last_name TEXT, phone TEXT
  )`);
  await execute(db, `INSERT INTO users (id, full_name, role) VALUES (1, 'Test Examiner', 'admin')`);
  await execute(db, `INSERT INTO forensic_cases (id, lab_number, title) VALUES (1, 'LAB-26-0002', 'Link Test Case')`);
  await execute(db, `INSERT INTO persons (id, first_name, last_name, phone) VALUES (1, 'Jane', 'Doe', '555-0100')`);
});

describe('Forensic case links', () => {
  it('GET /:caseId/links/search?type=person&q= returns a labeled result', async () => {
    const res = await app.request('/api/forensic-lab/1/links/search?type=person&q=Doe', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ id: number; label: string }>;
    expect(body.length).toBe(1);
    expect(body[0].label).toBe('Doe, Jane');
  });

  it('POST /:caseId/links creates a link with a server-resolved label', async () => {
    const res = await app.request('/api/forensic-lab/1/links', {
      method: 'POST', body: JSON.stringify({ entity_type: 'person', entity_id: 1, relationship: 'suspect' }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { entity_label: string; relationship: string } };
    expect(body.data.entity_label).toBe('Doe, Jane');
    expect(body.data.relationship).toBe('suspect');
  });

  it('GET /:caseId/links lists the created link', async () => {
    const res = await app.request('/api/forensic-lab/1/links', {}, env as unknown as Record<string, unknown>);
    const body = await res.json() as Array<{ id: number }>;
    expect(body.length).toBe(1);
  });

  it('DELETE /:caseId/links/:linkId removes it', async () => {
    const listRes = await app.request('/api/forensic-lab/1/links', {}, env as unknown as Record<string, unknown>);
    const [link] = await listRes.json() as Array<{ id: number }>;
    const delRes = await app.request(`/api/forensic-lab/1/links/${link.id}`, { method: 'DELETE' }, env as unknown as Record<string, unknown>);
    expect(delRes.status).toBe(200);
    const listRes2 = await app.request('/api/forensic-lab/1/links', {}, env as unknown as Record<string, unknown>);
    expect(await listRes2.json()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:worker -- forensicsLinks`
Expected: FAIL — `GET /api/forensic-lab/1/links/search` returns 404.

- [ ] **Step 3: Insert the links endpoints**

In `src/routes/forensics.ts`, after the hash endpoints added in Task 2 and before `// ANALYSES`, insert:

```typescript
// ═══════════════════════════════════════════════════════════════
// LINKS — cross-references to other RMS entities (forensic_case_links)
// ═══════════════════════════════════════════════════════════════

const LINK_ENTITY_TYPES = new Set(['person', 'vehicle', 'case', 'incident', 'evidence', 'warrant']);

// GET /:caseId/links/search?q=&type= — mirrors the request/response
// contract of GET /records/search (src/routes/records.ts:2003): same
// `type` param values, same label-synthesis-on-every-row convention,
// same 50-row cap, same "unknown type → []" behavior, so the Links tab
// search bar behaves identically to LinkRecordModal elsewhere in the app.
forensics.get('/:caseId/links/search', async (c) => {
  try {
    const db = getDb(c.env);
    const q = c.req.query('q');
    const type = (c.req.query('type') || 'person').toLowerCase();
    if (!q || q.length < 2) return c.json([]);
    if (!LINK_ENTITY_TYPES.has(type)) return c.json([]);
    const like = `%${q}%`;

    if (type === 'person') {
      const rows = await query<Record<string, unknown>>(db, `
        SELECT id, first_name, last_name, phone FROM persons
        WHERE last_name LIKE ? OR first_name LIKE ? OR phone LIKE ?
        ORDER BY last_name, first_name LIMIT 50
      `, like, like, like);
      return c.json(rows.map((r) => ({ ...r, type: 'person', label: [r.last_name, r.first_name].filter(Boolean).join(', ') || `Person #${r.id}` })));
    }
    if (type === 'vehicle') {
      const rows = await query<Record<string, unknown>>(db, `
        SELECT id, plate_number, make, model, year FROM vehicles_records
        WHERE plate_number LIKE ? OR vin LIKE ? OR make LIKE ? OR model LIKE ?
        ORDER BY plate_number LIMIT 50
      `, like, like, like, like);
      return c.json(rows.map((r) => ({ ...r, type: 'vehicle', label: (r.plate_number as string) || `Vehicle #${r.id}` })));
    }
    if (type === 'case') {
      const rows = await query<Record<string, unknown>>(db, `
        SELECT id, case_number, title FROM cases
        WHERE case_number LIKE ? OR title LIKE ? ORDER BY created_at DESC LIMIT 50
      `, like, like);
      return c.json(rows.map((r) => ({ ...r, type: 'case', label: [r.case_number, r.title].filter(Boolean).join(' — ') || `Case #${r.id}` })));
    }
    if (type === 'incident') {
      const rows = await query<Record<string, unknown>>(db, `
        SELECT id, incident_number, incident_type FROM incidents
        WHERE incident_number LIKE ? OR incident_type LIKE ? ORDER BY created_at DESC LIMIT 50
      `, like, like);
      return c.json(rows.map((r) => ({ ...r, type: 'incident', label: [r.incident_number, r.incident_type].filter(Boolean).join(' — ') || `Incident #${r.id}` })));
    }
    if (type === 'evidence') {
      const rows = await query<Record<string, unknown>>(db, `
        SELECT id, evidence_number, description FROM evidence
        WHERE evidence_number LIKE ? OR description LIKE ? ORDER BY evidence_number LIMIT 50
      `, like, like);
      return c.json(rows.map((r) => ({ ...r, type: 'evidence', label: [r.evidence_number, r.description].filter(Boolean).join(' — ') || `Evidence #${r.id}` })));
    }
    if (type === 'warrant') {
      const rows = await query<Record<string, unknown>>(db, `
        SELECT id, warrant_number, subject_name FROM warrants
        WHERE warrant_number LIKE ? OR subject_name LIKE ? ORDER BY created_at DESC LIMIT 50
      `, like, like);
      return c.json(rows.map((r) => ({ ...r, type: 'warrant', label: [r.warrant_number, r.subject_name].filter(Boolean).join(' — ') || `Warrant #${r.id}` })));
    }
    return c.json([]);
  } catch (err) {
    return dbErrorResponse(c, err, 'Link search failed', 'LINK_SEARCH_ERROR');
  }
});

forensics.get('/:caseId/links', async (c) => {
  try {
    const db = getDb(c.env);
    const caseId = parseInt(c.req.param('caseId'), 10);
    if (isNaN(caseId)) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
    const rows = await query<Record<string, unknown>>(
      db, 'SELECT * FROM forensic_case_links WHERE forensic_case_id = ? ORDER BY linked_at DESC', caseId,
    );
    return c.json(rows);
  } catch (err) {
    return c.json({ error: 'Failed to list links', code: 'LINKS_LIST_ERROR' }, 500);
  }
});

// Label lookup table for POST /:caseId/links — server resolves the label
// itself rather than trusting a client-supplied one, matching the
// principle already used by GET /records/search.
const LINK_LABEL_QUERIES: Record<string, string> = {
  person: `SELECT (last_name || ', ' || first_name) AS label FROM persons WHERE id = ?`,
  vehicle: `SELECT plate_number AS label FROM vehicles_records WHERE id = ?`,
  case: `SELECT case_number AS label FROM cases WHERE id = ?`,
  incident: `SELECT incident_number AS label FROM incidents WHERE id = ?`,
  evidence: `SELECT evidence_number AS label FROM evidence WHERE id = ?`,
  warrant: `SELECT warrant_number AS label FROM warrants WHERE id = ?`,
};

forensics.post('/:caseId/links', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const caseId = parseInt(c.req.param('caseId'), 10);
    if (isNaN(caseId)) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
    const userId = c.get('userId') as number;
    const b = await c.req.json<Record<string, unknown>>();

    if (typeof b.entity_type !== 'string' || !LINK_ENTITY_TYPES.has(b.entity_type)) {
      return c.json({ error: 'entity_type required and must be a supported type', code: 'ENTITY_TYPE_REQUIRED' }, 400);
    }
    const entityId = Number(b.entity_id);
    if (!Number.isFinite(entityId)) return c.json({ error: 'entity_id required', code: 'ENTITY_ID_REQUIRED' }, 400);
    const relationship = typeof b.relationship === 'string' && b.relationship.trim() ? b.relationship.trim() : 'related';

    const found = await queryFirst<{ label: string | null }>(db, LINK_LABEL_QUERIES[b.entity_type], entityId);
    if (!found) return c.json({ error: `${b.entity_type} #${entityId} not found`, code: 'ENTITY_NOT_FOUND' }, 400);
    const entityLabel = found.label || `${b.entity_type} #${entityId}`;

    const user = await queryFirst<{ full_name: string }>(db, 'SELECT full_name FROM users WHERE id = ?', userId);
    const result = await execute(
      db,
      `INSERT INTO forensic_case_links (forensic_case_id, entity_type, entity_id, entity_label, relationship, linked_by, linked_by_name)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      caseId, b.entity_type, entityId, entityLabel, relationship, userId, user?.full_name ?? '',
    );
    const newId = Number(result.meta.last_row_id);

    await logActivity(db, caseId, 'link_added', `Linked ${b.entity_type} "${entityLabel}" (${relationship})`, userId, user?.full_name ?? '');

    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM forensic_case_links WHERE id = ?', newId);
    return c.json({ data: created }, 201);
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to link entity', 'LINK_POST_ERROR');
  }
});

forensics.delete('/:caseId/links/:linkId', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const caseId = parseInt(c.req.param('caseId'), 10);
    const linkId = parseInt(c.req.param('linkId'), 10);
    if (isNaN(caseId) || isNaN(linkId)) return c.json({ error: 'Invalid IDs', code: 'INVALID_ID' }, 400);
    const existing = await queryFirst<{ entity_type: string; entity_label: string }>(
      db, 'SELECT entity_type, entity_label FROM forensic_case_links WHERE id = ? AND forensic_case_id = ?', linkId, caseId,
    );
    if (!existing) return c.json({ error: 'Link not found', code: 'NOT_FOUND' }, 404);
    await execute(db, 'DELETE FROM forensic_case_links WHERE id = ?', linkId);
    const userId = c.get('userId') as number;
    const user = await queryFirst<{ full_name: string }>(db, 'SELECT full_name FROM users WHERE id = ?', userId);
    await logActivity(db, caseId, 'link_removed', `Unlinked ${existing.entity_type} "${existing.entity_label}"`, userId, user?.full_name ?? '');
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: 'Failed to remove link', code: 'LINK_DELETE_ERROR' }, 500);
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:worker -- forensicsLinks`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/routes/forensics.ts test-workers/forensicsLinks.test.ts
git commit -m "feat(forensics): add cross-link endpoints (search/create/list/delete)"
```

---

## Task 4: QC workflow — formalize into `forensic_qc_checks`

**Files:**
- Modify: `src/routes/forensics.ts:891-899` (`GET /:id/qc-history`) and `:903-917` (`POST /:id/qc-check`)
- Test: `test-workers/forensicsQc.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test-workers/forensicsQc.test.ts
//
// Route-level test for the QC workflow. Previously /qc-check wrote a
// JSON-stringified blob into the generic activity_log table and
// /qc-history read it back — the frontend's `details?.includes('PASS')`
// check never matched the JSON, so QC results always rendered as FAIL.
// This proves the new forensic_qc_checks-backed endpoints round-trip a
// structured pass/fail correctly.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import forensics from '../src/routes/forensics';

const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
app.use('*', async (c, next) => {
  c.set('user', { id: 1, role: 'admin', username: 'test-examiner' });
  c.set('userId', 1);
  await next();
});
app.route('/api/forensic-lab', forensics);

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT, role TEXT)`);
  await execute(db, `CREATE TABLE IF NOT EXISTS forensic_cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT, lab_number TEXT UNIQUE NOT NULL, title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'received', created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS forensic_qc_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT, forensic_case_id INTEGER NOT NULL, exhibit_id INTEGER,
    check_type TEXT NOT NULL, reviewer_id INTEGER, reviewer_name TEXT, pass INTEGER NOT NULL DEFAULT 1,
    reviewer_notes TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS forensic_activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, forensic_case_id INTEGER NOT NULL, exhibit_id INTEGER,
    action TEXT NOT NULL, details TEXT, performed_by INTEGER, performed_by_name TEXT,
    performed_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await execute(db, `INSERT INTO users (id, full_name, role) VALUES (1, 'Test Examiner', 'admin')`);
  await execute(db, `INSERT INTO forensic_cases (id, lab_number, title) VALUES (1, 'LAB-26-0003', 'QC Test Case')`);
});

describe('QC workflow', () => {
  it('POST /:id/qc-check records a structured pass/fail', async () => {
    const res = await app.request('/api/forensic-lab/1/qc-check', {
      method: 'POST', body: JSON.stringify({ check_type: 'peer_review', pass: false, reviewer_notes: 'Chain of custody gap on E-002' }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { pass: number; check_type: string } };
    expect(body.data.pass).toBe(0);
    expect(body.data.check_type).toBe('peer_review');
  });

  it('GET /:id/qc-history returns the structured record, not a JSON blob', async () => {
    const res = await app.request('/api/forensic-lab/1/qc-history', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ pass: number; reviewer_notes: string }> };
    expect(body.data.length).toBe(1);
    expect(body.data[0].pass).toBe(0);
    expect(body.data[0].reviewer_notes).toBe('Chain of custody gap on E-002');
  });

  it('POST /:id/qc-check is role-gated', async () => {
    const unauthedApp = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
    unauthedApp.use('*', async (c, next) => { c.set('user', { id: 2, role: 'client_viewer', username: 'viewer' }); c.set('userId', 2); await next(); });
    unauthedApp.route('/api/forensic-lab', forensics);
    const res = await unauthedApp.request('/api/forensic-lab/1/qc-check', {
      method: 'POST', body: JSON.stringify({ check_type: 'peer_review', pass: true }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:worker -- forensicsQc`
Expected: FAIL — the current `/qc-check` handler has no role gate (test 3 fails: gets 200 not 403), and `pass`/`reviewer_notes` fields don't exist on the `activity_log`-backed response (tests 1-2 fail on shape).

- [ ] **Step 3: Replace the QC handlers**

In `src/routes/forensics.ts`, find the existing block (currently around lines 891-899 and 903-917):

```typescript
forensics.get('/:id/qc-history', async (c) => {
  try {
    const db = getDb(c.env);
    const id = Number(c.req.param('id'));
    const rows = await query<Record<string, unknown>>(db,
      `SELECT * FROM activity_log WHERE entity_type = 'forensic_case' AND entity_id = ? AND action LIKE '%qc%' ORDER BY created_at DESC LIMIT 50`, id);
    return c.json({ data: rows });
  } catch { return c.json({ data: [] }); }
});

// /analysis-templates relocated to before /:id (see comment block near line 188).

forensics.post('/:id/qc-check', async (c) => {
  try {
    const db = getDb(c.env);
    const id = Number(c.req.param('id'));
    const body = await c.req.json<Record<string, unknown>>();
    const userId = c.get('userId') as number;
    const fc = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM forensic_cases WHERE id = ?', id);
    if (!fc) return c.json({ error: 'Case not found' }, 404);
    await execute(db,
      `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
       VALUES (?, 'qc_check', 'forensic_case', ?, ?, datetime('now'))`,
      userId, id, JSON.stringify({ result: body.result || 'pass', notes: body.notes || '' }));
    return c.json({ success: true });
  } catch { return c.json({ error: 'QC check failed' }, 500); }
});
```

Replace with:

```typescript
// GET /:id/qc-history — reads the dedicated forensic_qc_checks table.
// Previously read the generic activity_log table with a JSON-stringified
// `details` blob the frontend couldn't reliably parse
// (`qc.details?.includes('PASS')` never matched JSON — QC results always
// rendered as FAIL). A dedicated table also satisfies ISO-17025/ANAB's
// expectation that QC be its own auditable record.
forensics.get('/:id/qc-history', async (c) => {
  try {
    const db = getDb(c.env);
    const id = Number(c.req.param('id'));
    if (isNaN(id)) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT * FROM forensic_qc_checks WHERE forensic_case_id = ? ORDER BY created_at DESC, id DESC LIMIT 50`,
      id,
    );
    return c.json({ data: rows });
  } catch { return c.json({ data: [] }); }
});

// /analysis-templates relocated to before /:id (see comment block near line 188).

// POST /:id/qc-check — now role-gated (admin/manager/supervisor, matching
// the reviewer-tier roles elsewhere in this file) since it wasn't gated
// at all previously, an odd gap on a QC-record-critical endpoint.
forensics.post('/:id/qc-check', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = Number(c.req.param('id'));
    if (isNaN(id)) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
    const body = await c.req.json<Record<string, unknown>>();
    const userId = c.get('userId') as number;
    const fc = await queryFirst<{ id: number }>(db, 'SELECT id FROM forensic_cases WHERE id = ?', id);
    if (!fc) return c.json({ error: 'Case not found', code: 'NOT_FOUND' }, 404);

    const checkType = typeof body.check_type === 'string' && body.check_type.trim() ? body.check_type : 'peer_review';
    const pass = body.pass !== false; // default true unless explicitly false
    const reviewerNotes = typeof body.reviewer_notes === 'string'
      ? body.reviewer_notes
      : (typeof body.notes === 'string' ? body.notes : null);

    const user = await queryFirst<{ full_name: string }>(db, 'SELECT full_name FROM users WHERE id = ?', userId);
    const result = await execute(
      db,
      `INSERT INTO forensic_qc_checks (forensic_case_id, exhibit_id, check_type, reviewer_id, reviewer_name, pass, reviewer_notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id, body.exhibit_id ?? null, checkType, userId, user?.full_name ?? '', pass ? 1 : 0, reviewerNotes,
    );
    const newId = Number(result.meta.last_row_id);

    await logActivity(db, id, 'qc_check', `${checkType}: ${pass ? 'PASS' : 'FAIL'}`, userId, user?.full_name ?? '');

    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM forensic_qc_checks WHERE id = ?', newId);
    return c.json({ data: created, success: true });
  } catch (err) {
    return dbErrorResponse(c, err, 'QC check failed', 'QC_CHECK_ERROR');
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:worker -- forensicsQc`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/routes/forensics.ts test-workers/forensicsQc.test.ts
git commit -m "fix(forensics): move QC checks to a dedicated table, fix PASS/FAIL bug, add role gate"
```

---

## Task 5: Report template application

**Files:**
- Modify: `src/routes/forensics.ts` (insert after `GET /capacity/planning`, near the end of the file, before `export default forensics;`)
- Test: `test-workers/forensicsTemplates.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test-workers/forensicsTemplates.test.ts
//
// Route-level test for applying a report template to a case. Confirms
// the template's `sections` JSON is copied onto
// forensic_cases.report_sections, which generateForensicCasePdf() (client-
// side, not tested here) reads to render a structured layout.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import forensics from '../src/routes/forensics';

const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
app.use('*', async (c, next) => {
  c.set('user', { id: 1, role: 'admin', username: 'test-examiner' });
  c.set('userId', 1);
  await next();
});
app.route('/api/forensic-lab', forensics);

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT, role TEXT)`);
  await execute(db, `CREATE TABLE IF NOT EXISTS forensic_cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT, lab_number TEXT UNIQUE NOT NULL, title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'received', report_sections TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS forensic_report_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, case_type TEXT,
    sections TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS forensic_activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, forensic_case_id INTEGER NOT NULL, exhibit_id INTEGER,
    action TEXT NOT NULL, details TEXT, performed_by INTEGER, performed_by_name TEXT,
    performed_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await execute(db, `INSERT INTO users (id, full_name, role) VALUES (1, 'Test Examiner', 'admin')`);
  await execute(db, `INSERT INTO forensic_cases (id, lab_number, title) VALUES (1, 'LAB-26-0004', 'Template Test Case')`);
  await execute(db, `INSERT INTO forensic_report_templates (id, name, sections) VALUES (1, 'Standard DNA Report', '[{"key":"summary","label":"Case Summary"}]')`);
});

describe('POST /:caseId/apply-template', () => {
  it('copies the template sections onto the case', async () => {
    const res = await app.request('/api/forensic-lab/1/apply-template', {
      method: 'POST', body: JSON.stringify({ template_id: 1 }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { report_sections: string } };
    expect(JSON.parse(body.data.report_sections)).toEqual([{ key: 'summary', label: 'Case Summary' }]);
  });

  it('404s for an unknown template', async () => {
    const res = await app.request('/api/forensic-lab/1/apply-template', {
      method: 'POST', body: JSON.stringify({ template_id: 999 }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:worker -- forensicsTemplates`
Expected: FAIL — route doesn't exist (404 on both, second test expects 404 for the wrong reason so verify via the response body/error code, not just status).

- [ ] **Step 3: Insert the apply-template endpoint**

In `src/routes/forensics.ts`, immediately before the final `export default forensics;`, insert:

```typescript
// POST /:caseId/apply-template — copies a report template's `sections`
// onto forensic_cases.report_sections. generateForensicCasePdf()
// (client-side, forensicCasePdf.ts) reads this to render a structured
// report layout instead of its hardcoded default.
forensics.post('/:caseId/apply-template', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const caseId = parseInt(c.req.param('caseId'), 10);
    if (isNaN(caseId)) return c.json({ error: 'Invalid case ID', code: 'INVALID_ID' }, 400);
    const b = await c.req.json<Record<string, unknown>>();
    const templateId = Number(b.template_id);
    if (!Number.isFinite(templateId)) return c.json({ error: 'template_id required', code: 'TEMPLATE_ID_REQUIRED' }, 400);

    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM forensic_cases WHERE id = ?', caseId);
    if (!existing) return c.json({ error: 'Forensics case not found', code: 'NOT_FOUND' }, 404);

    const template = await queryFirst<{ sections: string; name: string }>(
      db, 'SELECT sections, name FROM forensic_report_templates WHERE id = ? AND active = 1', templateId,
    );
    if (!template) return c.json({ error: 'Template not found', code: 'TEMPLATE_NOT_FOUND' }, 404);

    await execute(
      db, `UPDATE forensic_cases SET report_sections = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
      template.sections, caseId,
    );

    const userId = c.get('userId') as number;
    const user = await queryFirst<{ full_name: string }>(db, 'SELECT full_name FROM users WHERE id = ?', userId);
    await logActivity(db, caseId, 'template_applied', `Applied report template "${template.name}"`, userId, user?.full_name ?? '');

    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM forensic_cases WHERE id = ?', caseId);
    return c.json({ data: updated });
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to apply template', 'APPLY_TEMPLATE_ERROR');
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:worker -- forensicsTemplates`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/routes/forensics.ts test-workers/forensicsTemplates.test.ts
git commit -m "feat(forensics): add report-template application endpoint"
```

---

## Task 6: Frontend wiring

**Files:**
- Modify: `client/src/pages/ForensicLabPage.tsx:469-476` (remove stale 404-swallowing comment now that the endpoints are real)
- Modify: `client/src/pages/ForensicLabPage.tsx` QC History rendering (fix the PASS/FAIL display bug — read the structured `pass` field instead of string-matching `details`)

- [ ] **Step 1: Update the stale comment at `fetchCaseDetail`**

Find (around line 466-476):

```typescript
      const raw = await apiFetch<{ data: ForensicCase } | ForensicCase>(`/forensic-lab/${id}`, { signal });
      const detail = (raw as { data?: ForensicCase })?.data ?? (raw as ForensicCase);
      setSelectedCase(detail);
      // Fetch links and hashes in parallel — these endpoints currently 404 on
      // live (not implemented in src/routes/forensics.ts as of this PR), so the
      // .catch() coerces to empty + the panels show "No links / hashes" rather
      // than spamming the toast queue. Re-enable once the server endpoints land.
      apiFetch<any[]>(`/forensic-lab/${id}/links`, { signal }).then(l => setCaseLinks(asArray(l))).catch(() => setCaseLinks([]));
      apiFetch<{ hashes: any[]; stats: any }>(`/forensic-lab/${id}/hashes`, { signal })
        .then(d => { setHashes(asArray(d?.hashes)); setHashStats(d?.stats || null); })
        .catch(() => { setHashes([]); setHashStats(null); });
```

Replace with:

```typescript
      const raw = await apiFetch<{ data: ForensicCase } | ForensicCase>(`/forensic-lab/${id}`, { signal });
      const detail = (raw as { data?: ForensicCase })?.data ?? (raw as ForensicCase);
      setSelectedCase(detail);
      // Fetch links and hashes in parallel. The .catch() stays as defensive
      // handling for a transient network error, not a 404 workaround — both
      // endpoints are implemented as of migration 0187 (see
      // docs/superpowers/specs/2026-07-13-forensics-government-standard-design.md).
      apiFetch<any[]>(`/forensic-lab/${id}/links`, { signal }).then(l => setCaseLinks(asArray(l))).catch(() => setCaseLinks([]));
      apiFetch<{ hashes: any[]; stats: any }>(`/forensic-lab/${id}/hashes`, { signal })
        .then(d => { setHashes(asArray(d?.hashes)); setHashStats(d?.stats || null); })
        .catch(() => { setHashes([]); setHashStats(null); });
```

- [ ] **Step 2: Fix the QC History PASS/FAIL display bug**

Find (around line 1766-1777):

```typescript
                      {qcHistory.map((qc: any, i: number) => (
                        <div key={i} className="panel-beveled p-2 text-[10px]">
                          <div className="flex items-center gap-2">
                            <span className={`font-bold ${qc.details?.includes('PASS') ? 'text-green-400' : 'text-red-400'}`}>
                              {qc.details?.includes('PASS') ? 'PASS' : 'FAIL'}
                            </span>
                            <span className="text-rmpg-400">{toDisplayLabel(qc.action)}</span>
                          </div>
                          <div className="text-rmpg-500 mt-0.5">{qc.performed_by_name} — {qc.performed_at}</div>
                          {qc.details && <div className="text-rmpg-300 mt-0.5 line-clamp-2">{qc.details}</div>}
                        </div>
                      ))}
```

Replace with:

```typescript
                      {qcHistory.map((qc: any, i: number) => (
                        <div key={i} className="panel-beveled p-2 text-[10px]">
                          <div className="flex items-center gap-2">
                            <span className={`font-bold ${qc.pass ? 'text-green-400' : 'text-red-400'}`}>
                              {qc.pass ? 'PASS' : 'FAIL'}
                            </span>
                            <span className="text-rmpg-400">{toDisplayLabel(qc.check_type)}</span>
                          </div>
                          <div className="text-rmpg-500 mt-0.5">{qc.reviewer_name} — {qc.created_at}</div>
                          {qc.reviewer_notes && <div className="text-rmpg-300 mt-0.5 line-clamp-2">{qc.reviewer_notes}</div>}
                        </div>
                      ))}
```

(Field names now come from `forensic_qc_checks` directly — `qc.action`/`qc.details`/`qc.performed_by_name`/`qc.performed_at` from the old `activity_log`-backed response are replaced with `qc.check_type`/`qc.reviewer_notes`/`qc.reviewer_name`/`qc.created_at`, matching Task 4's new table.)

- [ ] **Step 3: Typecheck the client**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors (this file doesn't have strict typing on `qc: any`, so field renames won't be caught by the compiler — verify manually against the Task 4 table schema instead).

- [ ] **Step 4: Manual verification**

Run: `npm run dev` (Worker) and `cd client && npm run dev` (Vite), then in a browser:
1. Open the Forensic Lab page, create a test case.
2. Open the case, go to the QC tab, record a check with "Fail" selected and a note.
3. Confirm it appears in QC History with a red "FAIL" label and the note text — not the old always-red-regardless-of-input bug.
4. Go to the Links tab, search for a person, link them, confirm they appear in "Linked Entities" with the right label.
5. Go to the Hashes tab — confirm it no longer silently shows "No hashes computed yet" due to a 404 (posting a hash isn't wired to a UI button yet per the spec's non-goals around hash *computation* UI, so an empty state here is still expected unless a hash was inserted directly via the API for this manual check).

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/ForensicLabPage.tsx
git commit -m "fix(forensics-ui): wire links/hashes to real endpoints, fix QC PASS/FAIL display"
```

---

## Task 7: Full verification pass

- [ ] **Step 1: Run the full Worker test suite**

Run: `npm run test:worker`
Expected: all forensics tests pass; no regressions in existing Worker tests (`health.test.ts`, `auth.test.ts`, etc.).

- [ ] **Step 2: Run Worker typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Run client typecheck and build**

Run: `cd client && npx tsc --noEmit && npx vite build`
Expected: clean typecheck; build succeeds.

- [ ] **Step 4: Re-confirm the migration applies cleanly on a fresh local DB**

Run: `rm -rf .wrangler/state/v3/d1` (clears local D1 state) then `npm run migrate:local`
Expected: all migrations including `0187_forensics_gov_standard.sql` apply without error.

- [ ] **Step 5: Deploy note for whoever merges this**

After merge to `main`, per `CLAUDE.md`'s migration-drift rule, apply the migration directly to live D1 and verify:

```bash
scripts/apply-migration.sh 0187_forensics_gov_standard.sql
npx wrangler d1 execute rmpg-flex --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('forensic_exhibit_hashes','forensic_case_links','forensic_qc_checks','forensic_report_templates','forensic_analysis_templates')"
```
Expected: all 5 table names returned.

---

## Spec Coverage Checklist

- [x] Hash / tamper-evidence (append-only history, mismatch detection, stats) — Task 2
- [x] Digital-imaging metadata save bug — Task 1 discovery + Task 2 Step 3
- [x] Cross-links (search/create/list/delete) — Task 3
- [x] QC workflow formalization + PASS/FAIL bug fix — Task 4
- [x] Report template application — Task 5
- [x] Analysis/report template tables (unblocks already-coded `GET` endpoints) — Task 1
- [x] Frontend wiring + stale-comment cleanup — Task 6
- [x] Worker test coverage for all new endpoints — Tasks 2-5
- [x] Deploy/migration verification steps — Task 7

Not covered by this plan (explicitly out of scope per the spec's non-goals): known-hash-set contraband matching UI, server-side PDF rendering, `connections.ts`/`ConnectionsPage.tsx` changes, `queue/reorder` UI.
