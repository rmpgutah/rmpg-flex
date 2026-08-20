# Tesseract Training Portal Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a coverage dashboard, single-person approval status, bulk-submit, and document-list filtering to the existing Tesseract training portal (`src/routes/tesseractTraining.ts` + `client/src/pages/TesseractTrainingPage.tsx`), without touching the box/notes annotation routes or any production OCR path.

**Architecture:** One new migration adds three columns to the existing `tesseract_training_corpus` table. Four new/modified backend routes extend the existing router. Four frontend additions extend the existing page component. No new tables, no new files beyond tests.

**Tech Stack:** Hono routes, D1, React (existing `TesseractTrainingPage.tsx` state/patterns), Vitest (Node mock-DB convention already established in `tests/tesseractTraining.test.ts`).

## Global Constraints

- Every new/modified route reuses the existing `requireAdminManager(c)` helper in `src/routes/tesseractTraining.ts` — no new gate.
- Approval is single-person: any admin/manager may approve, including the original submitter.
- Bulk submit rejects more than 100 document IDs per call with `400` (D1 bound-parameter cap, CLAUDE.md gotcha #20) — never silently truncate.
- `doc_type: null` is a real, valid group in the stats response — do not filter it out.
- All D1 calls go through this repo's `query`/`queryFirst`/`execute` helpers (`src/utils/db.ts`) and are `await`ed.
- Run `npm run typecheck` after any `src/` change, `cd client && npx tsc --noEmit` after any `client/` change, before every commit.
- Box annotations (`tesseract_box_annotations`) and review notes (`tesseract_review_annotations`) are NOT touched by any task in this plan — approval and bulk operations apply only to `tesseract_training_corpus`.

---

### Task 1: Migration — approval columns

**Files:**
- Create: `migrations/0234_tesseract_training_approval.sql`

**Interfaces:**
- Produces: `tesseract_training_corpus.approval_status` (`'pending'` default), `.approved_by`, `.approved_at` — consumed by Tasks 2 and 3.

- [ ] **Step 1: Write the migration**

```sql
-- migrations/0234_tesseract_training_approval.sql
-- Single-person approval gate on top of the existing whole-document
-- text-correction flow (tesseract_training_corpus, migration 0230). Every
-- new submission lands as 'pending' via the column default; an admin or
-- manager (including the original submitter) flips it to 'approved' via
-- POST /documents/:id/approve. See
-- docs/superpowers/specs/2026-08-10-tesseract-training-portal-enhancements-design.md.
ALTER TABLE tesseract_training_corpus ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'pending' CHECK(approval_status IN ('pending', 'approved'));
ALTER TABLE tesseract_training_corpus ADD COLUMN approved_by INTEGER;
ALTER TABLE tesseract_training_corpus ADD COLUMN approved_at TEXT;
```

- [ ] **Step 2: Apply locally and verify**

```bash
npm run migrate:local
npx wrangler d1 execute rmpg-flex --local --command "SELECT sql FROM sqlite_master WHERE type='table' AND name='tesseract_training_corpus'"
```
Expected: the printed `CREATE TABLE` statement (D1/SQLite records the ALTER as
part of the table's schema) shows all three new columns. If `migrate:local` aborts on
an unrelated earlier migration (a known pre-existing local-D1 drift issue — see
CLAUDE.md's "D1 has dirty schema" gotcha), apply this one file directly instead:
```bash
npx wrangler d1 execute rmpg-flex --local --file migrations/0234_tesseract_training_approval.sql
```

- [ ] **Step 3: Commit**

```bash
git add migrations/0234_tesseract_training_approval.sql
git commit -m "feat(tesseract): add approval_status columns to training corpus"
```

---

### Task 2: Backend — coverage stats route

**Files:**
- Modify: `src/routes/tesseractTraining.ts`
- Test: `tests/tesseractTrainingStats.test.ts`

**Interfaces:**
- Consumes: `requireAdminManager`, `getDb`, `query` (already imported in the file).
- Produces: `GET /api/tesseract-training/stats` → `{ total_eligible, total_labeled, total_approved, by_doc_type: [{doc_type, eligible, labeled, approved}] }` — consumed by Task 6's frontend dashboard.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/tesseractTrainingStats.test.ts
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import tesseractTrainingRouter from '../src/routes/tesseractTraining';

function makeDb(rows: Array<{ doc_type: string | null; eligible: number; labeled: number; approved: number }>) {
  const prepare = (sql: string) => {
    const stmt: any = {
      bind: (..._args: any[]) => stmt,
      all: async () => {
        if (/GROUP BY d\.doc_type/.test(sql)) return { results: rows };
        return { results: [] };
      },
      first: async () => null,
      run: async () => ({ meta: { changes: 0 } }),
    };
    return stmt;
  };
  return { prepare };
}

function makeApp(role: string) {
  const app = new Hono<{ Bindings: any; Variables: any }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 42, username: 'tester', role, full_name: 'Test User' });
    await next();
  });
  app.route('/', tesseractTrainingRouter);
  return app;
}

beforeEach(() => vi.clearAllMocks());

describe('tesseract training stats', () => {
  test('GET /stats returns 403 for a non-admin/manager role', async () => {
    const app = makeApp('officer');
    const res = await app.request('/stats', {}, { DB: makeDb([]) });
    expect(res.status).toBe(403);
  });

  test('GET /stats aggregates totals and by_doc_type, including a null doc_type group', async () => {
    const app = makeApp('admin');
    const rows = [
      { doc_type: 'summons', eligible: 40, labeled: 12, approved: 6 },
      { doc_type: 'subpoena', eligible: 15, labeled: 3, approved: 1 },
      { doc_type: null, eligible: 8, labeled: 0, approved: 0 },
    ];
    const res = await app.request('/stats', {}, { DB: makeDb(rows) });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.total_eligible).toBe(63);
    expect(body.total_labeled).toBe(15);
    expect(body.total_approved).toBe(7);
    expect(body.by_doc_type).toHaveLength(3);
    expect(body.by_doc_type.find((r: any) => r.doc_type === null)).toEqual(
      { doc_type: null, eligible: 8, labeled: 0, approved: 0 },
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tesseractTrainingStats.test.ts`
Expected: FAIL — route doesn't exist, 404.

- [ ] **Step 3: Implement the route**

Add to `src/routes/tesseractTraining.ts`, immediately after the `requireAdminManager`
function definition and before the `/documents` route (so it doesn't collide with the
`/documents/:id` param route — Hono matches literal segments before params, but placing
it early keeps route order readable):

```typescript
interface StatsRow {
  doc_type: string | null;
  eligible: number;
  labeled: number;
  approved: number;
}

// GET /api/tesseract-training/stats
tesseractTraining.get('/stats', async (c) => {
  if (!requireAdminManager(c)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  const db = getDb(c.env);
  const byDocType = await query<StatsRow>(
    db,
    `SELECT d.doc_type AS doc_type,
            COUNT(*) AS eligible,
            SUM(CASE WHEN t.id IS NOT NULL THEN 1 ELSE 0 END) AS labeled,
            SUM(CASE WHEN t.approval_status = 'approved' THEN 1 ELSE 0 END) AS approved
       FROM serve_intake_documents d
       LEFT JOIN tesseract_training_corpus t ON t.serve_intake_document_id = d.id
      WHERE d.status = 'extracted'
      GROUP BY d.doc_type`,
  );
  const totals = byDocType.reduce(
    (acc, r) => ({
      total_eligible: acc.total_eligible + r.eligible,
      total_labeled: acc.total_labeled + r.labeled,
      total_approved: acc.total_approved + r.approved,
    }),
    { total_eligible: 0, total_labeled: 0, total_approved: 0 },
  );
  return c.json({ ...totals, by_doc_type: byDocType });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tesseractTrainingStats.test.ts`
Expected: PASS, both tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/routes/tesseractTraining.ts tests/tesseractTrainingStats.test.ts
git commit -m "feat(tesseract): add coverage stats route"
```

---

### Task 3: Backend — approve route + approval_status in existing responses

**Files:**
- Modify: `src/routes/tesseractTraining.ts`
- Modify: `tests/tesseractTraining.test.ts` (extend existing `DocRow`-shaped mock to carry `approval_status`)
- Test: `tests/tesseractTrainingApproval.test.ts`

**Interfaces:**
- Produces: `POST /api/tesseract-training/documents/:id/approve`; `approval_status` field added to the existing `GET /documents` and `GET /documents/:id` responses — consumed by Task 7's frontend.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/tesseractTrainingApproval.test.ts
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import tesseractTrainingRouter from '../src/routes/tesseractTraining';

function makeDb(opts: {
  corpus?: Record<number, { id: number; approval_status: string }>;
} = {}) {
  const corpus = opts.corpus ?? {};
  const updates: Array<{ id: number; approvedBy: number }> = [];

  const prepare = (sql: string) => {
    let boundArgs: any[] = [];
    const stmt: any = {
      bind: (...args: any[]) => { boundArgs = args; return stmt; },
      first: async () => {
        if (/FROM tesseract_training_corpus WHERE serve_intake_document_id/.test(sql)) {
          const docId = boundArgs[0];
          return corpus[docId] ?? null;
        }
        return null;
      },
      all: async () => ({ results: [] }),
      run: async () => {
        if (/UPDATE tesseract_training_corpus SET approval_status/.test(sql)) {
          const [approvedBy, docId] = boundArgs;
          if (corpus[docId]) corpus[docId].approval_status = 'approved';
          updates.push({ id: docId, approvedBy });
          return { meta: { changes: corpus[docId] ? 1 : 0 } };
        }
        return { meta: { changes: 0 } };
      },
    };
    return stmt;
  };

  return { prepare, _updates: updates, _corpus: corpus };
}

function makeApp(role: string) {
  const app = new Hono<{ Bindings: any; Variables: any }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 42, username: 'tester', role, full_name: 'Test User' });
    await next();
  });
  app.route('/', tesseractTrainingRouter);
  return app;
}

beforeEach(() => vi.clearAllMocks());

describe('tesseract training approval', () => {
  test('POST /documents/:id/approve returns 403 for a non-admin/manager role', async () => {
    const app = makeApp('officer');
    const res = await app.request('/documents/5/approve', { method: 'POST' }, { DB: makeDb() });
    expect(res.status).toBe(403);
  });

  test('POST /documents/:id/approve returns 404 when the document is not in the corpus', async () => {
    const app = makeApp('admin');
    const res = await app.request('/documents/5/approve', { method: 'POST' }, { DB: makeDb() });
    expect(res.status).toBe(404);
  });

  test('POST /documents/:id/approve marks a pending submission approved', async () => {
    const app = makeApp('manager');
    const db = makeDb({ corpus: { 5: { id: 1, approval_status: 'pending' } } });
    const res = await app.request('/documents/5/approve', { method: 'POST' }, { DB: db });
    expect(res.status).toBe(200);
    expect(db._corpus[5].approval_status).toBe('approved');
  });

  test('POST /documents/:id/approve is idempotent on an already-approved submission', async () => {
    const app = makeApp('admin');
    const db = makeDb({ corpus: { 5: { id: 1, approval_status: 'approved' } } });
    const res = await app.request('/documents/5/approve', { method: 'POST' }, { DB: db });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tesseractTrainingApproval.test.ts`
Expected: FAIL — route doesn't exist.

- [ ] **Step 3: Implement the approve route**

Add to `src/routes/tesseractTraining.ts`, right after the existing `/documents/:id/submit`
handler (before the `BoxRow` interface):

```typescript
// POST /api/tesseract-training/documents/:id/approve
// Single-person approval: any admin/manager, including the original submitter.
// Idempotent — approving an already-approved document is a 200 no-op, not an error.
tesseractTraining.post('/documents/:id/approve', async (c) => {
  if (!requireAdminManager(c)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  const user = c.get('user');
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);

  const db = getDb(c.env);
  const existing = await queryFirst<{ id: number; approval_status: string }>(
    db,
    `SELECT id, approval_status FROM tesseract_training_corpus WHERE serve_intake_document_id = ?`,
    id,
  );
  if (!existing) {
    return c.json({ error: 'Document is not in the training corpus', code: 'NOT_SUBMITTED' }, 404);
  }
  if (existing.approval_status === 'approved') {
    return c.json({ success: true, already_approved: true });
  }

  await execute(
    db,
    `UPDATE tesseract_training_corpus SET approval_status = 'approved', approved_by = ?, approved_at = datetime('now') WHERE serve_intake_document_id = ?`,
    user.id, id,
  );
  return c.json({ success: true });
});
```

- [ ] **Step 4: Surface `approval_status` in `GET /documents` and `GET /documents/:id`**

In the existing `/documents` handler, change the `SELECT` and `interface DocRow` usage:
```typescript
  const rows = await query<DocRow & { already_in_corpus: number; approval_status: string | null }>(
    db,
    `SELECT d.id, d.file_name, d.file_type, d.doc_type, d.created_at,
            CASE WHEN t.id IS NOT NULL THEN 1 ELSE 0 END AS already_in_corpus,
            t.approval_status AS approval_status
       FROM serve_intake_documents d
       LEFT JOIN tesseract_training_corpus t ON t.serve_intake_document_id = d.id
      WHERE d.status = 'extracted'
      ORDER BY d.created_at DESC
      LIMIT ? OFFSET ?`,
    pageSize, offset,
  );
```
(The response mapping below it, `rows.map((r) => ({ ...r, already_in_corpus: !!r.already_in_corpus }))`,
needs no change — `approval_status` passes through as-is, `null` for documents never submitted.)

In the existing `/documents/:id` handler, add a second lookup alongside the existing
`inCorpus` query:
```typescript
  const corpusRow = await queryFirst<{ id: number; approval_status: string }>(
    db,
    `SELECT id, approval_status FROM tesseract_training_corpus WHERE serve_intake_document_id = ?`,
    id,
  );
  return c.json({ ...doc, already_in_corpus: !!corpusRow, approval_status: corpusRow?.approval_status ?? null });
```
This replaces the existing `inCorpus` query + its `already_in_corpus: !!inCorpus` return line —
same query, one extra selected column, so no new round trip.

- [ ] **Step 5: Update the existing test file's mock to carry `approval_status`**

In `tests/tesseractTraining.test.ts`, the `makeDb()` helper's `first` branch for
`FROM tesseract_training_corpus WHERE serve_intake_document_id` currently returns
`corpusIds.has(id) ? { id } : null`. Change it to also carry a status field so the route's
new column read doesn't silently pass `undefined`:
```typescript
        if (/FROM tesseract_training_corpus WHERE serve_intake_document_id/.test(sql)) {
          const id = boundArgs[0];
          return corpusIds.has(id) ? { id: 1, approval_status: 'pending' } : null;
        }
```
Run the existing suite (`npx vitest run tests/tesseractTraining.test.ts`) after this change
to confirm none of its existing assertions broke — they check `already_in_corpus`, not
`approval_status`, so they should be unaffected by this addition.

- [ ] **Step 6: Run tests to verify they pass**

```bash
npx vitest run tests/tesseractTrainingApproval.test.ts tests/tesseractTraining.test.ts
```
Expected: PASS, all tests in both files.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
git add src/routes/tesseractTraining.ts tests/tesseractTrainingApproval.test.ts tests/tesseractTraining.test.ts
git commit -m "feat(tesseract): add single-person approval route and surface approval_status"
```

---

### Task 4: Backend — shared submit helper + bulk-submit route

**Files:**
- Modify: `src/routes/tesseractTraining.ts`
- Test: `tests/tesseractTrainingBulkSubmit.test.ts`

**Interfaces:**
- Consumes: existing `getDecrypted`, `c.env.UPLOADS`, `c.env.TESSERACT_TRAINING`, `execute`, `queryFirst`.
- Produces: `submitDocumentToCorpus(c, id, userId, groundTruthText): Promise<{ success: true } | { success: false; error: string; code: string; status: number }>` (module-private helper, used by both the existing single-submit route and the new bulk route); `POST /api/tesseract-training/documents/bulk-submit`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/tesseractTrainingBulkSubmit.test.ts
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import tesseractTrainingRouter from '../src/routes/tesseractTraining';

function makeLegacyR2Object() {
  return { body: 'legacy-body', httpMetadata: {}, arrayBuffer: async () => new ArrayBuffer(8) };
}

function makeDb(opts: {
  docs?: Record<number, { r2_key: string; file_type: string; raw_text?: string | null }>;
  corpusIds?: Set<number>;
} = {}) {
  const docs = opts.docs ?? {};
  const corpusIds = opts.corpusIds ?? new Set<number>();
  const inserts: number[] = [];

  const prepare = (sql: string) => {
    let boundArgs: any[] = [];
    const stmt: any = {
      bind: (...args: any[]) => { boundArgs = args; return stmt; },
      first: async () => {
        if (/FROM tesseract_training_corpus WHERE serve_intake_document_id/.test(sql)) {
          return corpusIds.has(boundArgs[0]) ? { id: 1 } : null;
        }
        if (/FROM serve_intake_documents WHERE id/.test(sql)) {
          return docs[boundArgs[0]] ?? null;
        }
        return null;
      },
      all: async () => ({ results: [] }),
      run: async () => {
        if (/INSERT INTO tesseract_training_corpus/.test(sql)) inserts.push(boundArgs[0]);
        return { meta: { changes: 1, last_row_id: 1 } };
      },
    };
    return stmt;
  };

  return { prepare, _inserts: inserts };
}

function makeApp(role: string) {
  const app = new Hono<{ Bindings: any; Variables: any }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 42, username: 'tester', role, full_name: 'Test User' });
    await next();
  });
  app.route('/', tesseractTrainingRouter);
  return app;
}

function makeEnv(db: ReturnType<typeof makeDb>) {
  return {
    DB: db,
    UPLOADS: { get: async () => makeLegacyR2Object() },
    TESSERACT_TRAINING: { put: async () => {} },
    FILE_ENCRYPTION_KEK: 'unused',
  };
}

beforeEach(() => vi.clearAllMocks());

describe('tesseract training bulk submit', () => {
  test('POST /documents/bulk-submit returns 403 for a non-admin/manager role', async () => {
    const app = makeApp('officer');
    const res = await app.request('/documents/bulk-submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document_ids: [1] }),
    }, makeEnv(makeDb()));
    expect(res.status).toBe(403);
  });

  test('POST /documents/bulk-submit rejects more than 100 ids', async () => {
    const app = makeApp('admin');
    const ids = Array.from({ length: 101 }, (_, i) => i + 1);
    const res = await app.request('/documents/bulk-submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document_ids: ids }),
    }, makeEnv(makeDb()));
    expect(res.status).toBe(400);
  });

  test('POST /documents/bulk-submit reports per-id success and failure independently', async () => {
    const app = makeApp('manager');
    const db = makeDb({
      docs: {
        10: { r2_key: 'uploads/10', file_type: 'image/png', raw_text: 'Recipient: Jane Doe' },
        11: { r2_key: 'uploads/11', file_type: 'image/png', raw_text: 'Recipient: John Roe' },
      },
      corpusIds: new Set([11]), // 11 already submitted -> should fail
    });
    const res = await app.request('/documents/bulk-submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document_ids: [10, 11, 999] }), // 999 doesn't exist -> should fail
    }, makeEnv(db));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.results).toEqual([
      { id: 10, success: true },
      { id: 11, success: false, error: 'Document already in training corpus' },
      { id: 999, success: false, error: 'Not found' },
    ]);
    expect(db._inserts).toEqual([10]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tesseractTrainingBulkSubmit.test.ts`
Expected: FAIL — route doesn't exist.

- [ ] **Step 3: Extract the shared helper and rewrite the single-submit route to use it**

Replace the ENTIRE existing `/documents/:id/submit` handler in
`src/routes/tesseractTraining.ts` (from `// POST /api/tesseract-training/documents/:id/submit`
through its closing `});`) with:

```typescript
// Shared by the single-submit route below and the bulk-submit route. Writes the
// document's image + ground truth to TESSERACT_TRAINING R2, then inserts the
// D1 row ONLY after both R2 writes succeed (see Global Constraints — never
// record "this exists" before storage actually has it). Returns a discriminated
// result rather than throwing, so bulk-submit can continue past one failure.
async function submitDocumentToCorpus(
  c: any, id: number, userId: number, groundTruthText: string,
): Promise<{ success: true } | { success: false; error: string; code: string; status: number }> {
  const trimmed = groundTruthText.trim();
  if (!trimmed) {
    return { success: false, error: 'ground_truth_text is required', code: 'MISSING_TEXT', status: 400 };
  }

  const db = getDb(c.env);
  const existing = await queryFirst<{ id: number }>(
    db,
    `SELECT id FROM tesseract_training_corpus WHERE serve_intake_document_id = ?`,
    id,
  );
  if (existing) {
    return { success: false, error: 'Document already in training corpus', code: 'ALREADY_SUBMITTED', status: 409 };
  }

  const doc = await queryFirst<{ r2_key: string; file_type: string }>(
    db,
    'SELECT r2_key, file_type FROM serve_intake_documents WHERE id = ?',
    id,
  );
  if (!doc?.r2_key) {
    return { success: false, error: 'Not found', code: 'NOT_FOUND', status: 404 };
  }

  const decrypted = await getDecrypted(c.env.UPLOADS, db, c.env.FILE_ENCRYPTION_KEK, doc.r2_key);
  let imageBytes: Uint8Array | ArrayBuffer;
  if (decrypted) {
    imageBytes = decrypted.bytes;
  } else {
    const legacy = await c.env.UPLOADS.get(doc.r2_key);
    if (!legacy) {
      return { success: false, error: 'Source file missing in R2', code: 'SOURCE_MISSING', status: 404 };
    }
    imageBytes = await legacy.arrayBuffer();
  }

  const ext = (doc.file_type || '').includes('png') ? '.png'
    : (doc.file_type || '').includes('jpeg') ? '.jpg'
    : '.bin';

  try {
    await c.env.TESSERACT_TRAINING.put(`training-corpus/${id}/image${ext}`, imageBytes, {
      httpMetadata: { contentType: doc.file_type || 'application/octet-stream' },
    });
    await c.env.TESSERACT_TRAINING.put(`training-corpus/${id}/ground-truth.txt`, trimmed, {
      httpMetadata: { contentType: 'text/plain' },
    });
  } catch (err) {
    return {
      success: false,
      error: 'Failed to write training pair to R2',
      code: 'R2_WRITE_FAILED',
      status: 500,
    };
  }

  await execute(
    db,
    `INSERT INTO tesseract_training_corpus (serve_intake_document_id, added_by) VALUES (?, ?)`,
    id, userId,
  );
  return { success: true };
}

// POST /api/tesseract-training/documents/:id/submit
// Body: { ground_truth_text: string }
tesseractTraining.post('/documents/:id/submit', async (c) => {
  if (!requireAdminManager(c)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  const user = c.get('user');
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);

  let body: { ground_truth_text?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const result = await submitDocumentToCorpus(c, id, user.id, body.ground_truth_text ?? '');
  if (!result.success) {
    return c.json({ error: result.error, code: result.code }, result.status as any);
  }
  return c.json({ success: true, document_id: id });
});

// POST /api/tesseract-training/documents/bulk-submit
// Body: { document_ids: number[] } — max 100 per call (D1 bound-parameter cap,
// CLAUDE.md gotcha #20). Each document's EXISTING raw_text is used verbatim as
// ground truth — this is the "already correct, just accept it" path; per-document
// text correction stays the single-submit route's job. One failing document does
// not abort the rest.
tesseractTraining.post('/documents/bulk-submit', async (c) => {
  if (!requireAdminManager(c)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  const user = c.get('user');

  let body: { document_ids?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const ids = body.document_ids;
  if (!Array.isArray(ids) || !ids.every((v) => typeof v === 'number')) {
    return c.json({ error: 'document_ids must be an array of numbers' }, 400);
  }
  if (ids.length > 100) {
    return c.json({ error: 'document_ids exceeds the 100-item limit per call', code: 'TOO_MANY_IDS' }, 400);
  }

  const db = getDb(c.env);
  const results: Array<{ id: number; success: boolean; error?: string }> = [];
  for (const id of ids) {
    const doc = await queryFirst<{ raw_text: string | null }>(
      db,
      'SELECT raw_text FROM serve_intake_documents WHERE id = ?',
      id,
    );
    if (!doc) {
      results.push({ id, success: false, error: 'Not found' });
      continue;
    }
    const result = await submitDocumentToCorpus(c, id, user.id, doc.raw_text ?? '');
    results.push(result.success ? { id, success: true } : { id, success: false, error: result.error });
  }
  return c.json({ results });
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/tesseractTrainingBulkSubmit.test.ts tests/tesseractTraining.test.ts
```
Expected: PASS, all tests in both files — the second run confirms the refactored
single-submit route is still byte-behavior-identical to before.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/routes/tesseractTraining.ts tests/tesseractTrainingBulkSubmit.test.ts
git commit -m "feat(tesseract): extract shared submit helper, add bulk-submit route"
```

---

### Task 5: Backend — document list filtering

**Files:**
- Modify: `src/routes/tesseractTraining.ts`
- Modify: `tests/tesseractTraining.test.ts`

**Interfaces:**
- Produces: `GET /documents` accepts optional `doc_type`, `labeled` (`'true'`/`'false'`), `from`/`to` (ISO date strings) query params — consumed by Task 9's frontend filter bar.

- [ ] **Step 1: Write the failing test**

Add to `tests/tesseractTraining.test.ts` (append to the existing `describe` block for
`/documents`, following that file's established pattern — read the file first to place
this next to the other `/documents` tests):

```typescript
  test('GET /documents filters by doc_type, labeled, and date range', async () => {
    const app = makeApp('admin');
    const db = makeDb();
    // Override .all() to assert the SQL carries the expected WHERE clauses and
    // bound values, since this mock DB doesn't do real filtering.
    let capturedSql = '';
    let capturedArgs: any[] = [];
    const originalPrepare = db.prepare.bind(db);
    (db as any).prepare = (sql: string) => {
      const stmt = originalPrepare(sql);
      const originalBind = stmt.bind.bind(stmt);
      stmt.bind = (...args: any[]) => { capturedSql = sql; capturedArgs = args; return originalBind(...args); };
      return stmt;
    };
    await app.request(
      '/documents?doc_type=summons&labeled=false&from=2026-01-01&to=2026-12-31',
      {}, { DB: db },
    );
    expect(capturedSql).toMatch(/d\.doc_type = \?/);
    expect(capturedSql).toMatch(/t\.id IS NULL/);
    expect(capturedSql).toMatch(/d\.created_at >= \?/);
    expect(capturedSql).toMatch(/d\.created_at <= \?/);
    expect(capturedArgs).toContain('summons');
    expect(capturedArgs).toContain('2026-01-01');
    expect(capturedArgs).toContain('2026-12-31');
  });

  test('GET /documents treats doc_type=null as an explicit IS NULL filter', async () => {
    const app = makeApp('admin');
    const db = makeDb();
    let capturedSql = '';
    const originalPrepare = db.prepare.bind(db);
    (db as any).prepare = (sql: string) => {
      const stmt = originalPrepare(sql);
      if (/FROM serve_intake_documents/.test(sql)) capturedSql = sql;
      return stmt;
    };
    await app.request('/documents?doc_type=null', {}, { DB: db });
    expect(capturedSql).toMatch(/d\.doc_type IS NULL/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tesseractTraining.test.ts`
Expected: FAIL — the two new tests fail (current query has no filter clauses to match).

- [ ] **Step 3: Implement filtering**

Replace the existing `/documents` handler's body (from `const db = getDb(c.env);` through
the `return c.json({...})`) with:

```typescript
  const db = getDb(c.env);
  const page = clampIntParam(c.req.query('page'), 1, 1, 100000);
  const pageSize = 50;
  const offset = (page - 1) * pageSize;

  const docType = c.req.query('doc_type');
  const labeled = c.req.query('labeled');
  const from = c.req.query('from');
  const to = c.req.query('to');

  const conditions = [`d.status = 'extracted'`];
  const args: unknown[] = [];
  if (docType === 'null') {
    conditions.push('d.doc_type IS NULL');
  } else if (docType) {
    conditions.push('d.doc_type = ?');
    args.push(docType);
  }
  if (labeled === 'true') {
    conditions.push('t.id IS NOT NULL');
  } else if (labeled === 'false') {
    conditions.push('t.id IS NULL');
  }
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
    conditions.push('d.created_at >= ?');
    args.push(from);
  }
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    conditions.push('d.created_at <= ?');
    args.push(to);
  }

  const rows = await query<DocRow & { already_in_corpus: number; approval_status: string | null }>(
    db,
    `SELECT d.id, d.file_name, d.file_type, d.doc_type, d.created_at,
            CASE WHEN t.id IS NOT NULL THEN 1 ELSE 0 END AS already_in_corpus,
            t.approval_status AS approval_status
       FROM serve_intake_documents d
       LEFT JOIN tesseract_training_corpus t ON t.serve_intake_document_id = d.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY d.created_at DESC
      LIMIT ? OFFSET ?`,
    ...args, pageSize, offset,
  );

  return c.json({
    rows: rows.map((r) => ({ ...r, already_in_corpus: !!r.already_in_corpus })),
    page, pageSize,
  });
```
Malformed `from`/`to` values (failing the `YYYY-MM-DD` regex) are silently ignored rather
than rejected, per the spec's "degrade to no filter, don't 400" decision — an invalid date
still returns the unfiltered list rather than an error page.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tesseractTraining.test.ts`
Expected: PASS, all tests including the two new ones.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/routes/tesseractTraining.ts tests/tesseractTraining.test.ts
git commit -m "feat(tesseract): add doc_type/labeled/date-range filtering to document list"
```

---

### Task 6: Frontend — coverage dashboard panel

**Files:**
- Modify: `client/src/pages/TesseractTrainingPage.tsx`

**Interfaces:**
- Consumes: `GET /tesseract-training/stats` (Task 2).
- Produces: nothing consumed by later tasks — this is a self-contained UI addition, though Task 9's filter bar will reuse the same `by_doc_type` list for its dropdown options (documented there).

- [ ] **Step 1: Add stats state and loader**

In `client/src/pages/TesseractTrainingPage.tsx`, add near the other interfaces at the top:

```tsx
interface StatsByDocType { doc_type: string | null; eligible: number; labeled: number; approved: number }
interface Stats { total_eligible: number; total_labeled: number; total_approved: number; by_doc_type: StatsByDocType[] }
```

Add state and a loader alongside the existing `loadList`:

```tsx
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsOpen, setStatsOpen] = useState(true);

  const loadStats = useCallback(() => {
    apiFetch<Stats>('/tesseract-training/stats').then(setStats).catch(console.error);
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);
```

- [ ] **Step 2: Render the panel**

Immediately after the `<PanelTitleBar title="TESSERACT TRAINING SETUP" />` line, add:

```tsx
      {stats && (
        <div className="border border-surface-border p-3 space-y-2">
          <button
            onClick={() => setStatsOpen((v) => !v)}
            className="text-[11px] font-bold uppercase tracking-wide"
          >
            Coverage {statsOpen ? '▲' : '▼'}
          </button>
          {statsOpen && (
            <div className="space-y-1 text-[11px]">
              <p>
                {stats.total_labeled} / {stats.total_eligible} documents labeled
                ({stats.total_approved} approved)
              </p>
              <table className="w-full">
                <thead>
                  <tr className="text-left text-fg-muted">
                    <th>Doc Type</th><th>Eligible</th><th>Labeled</th><th>Approved</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.by_doc_type.map((row) => (
                    <tr key={row.doc_type ?? '(none)'}>
                      <td>{row.doc_type ?? '(unclassified)'}</td>
                      <td>{row.eligible}</td>
                      <td>{row.labeled}</td>
                      <td>{row.approved}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
```

- [ ] **Step 3: Typecheck**

```bash
cd client && npx tsc --noEmit
```
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/TesseractTrainingPage.tsx
git commit -m "feat(tesseract): add coverage dashboard panel"
```

---

### Task 7: Frontend — approval badge and Approve button

**Files:**
- Modify: `client/src/pages/TesseractTrainingPage.tsx`

**Interfaces:**
- Consumes: `POST /documents/:id/approve` (Task 3), `approval_status` field now present on `DocRow`/`DocDetail` (Task 3).

- [ ] **Step 1: Add `approval_status` to the existing interfaces**

Change:
```tsx
interface DocRow {
  id: number;
  file_name: string;
  doc_type: string | null;
  created_at: string;
  already_in_corpus: boolean;
}

interface DocDetail {
  id: number;
  file_name: string;
  raw_text: string | null;
  already_in_corpus: boolean;
}
```
to:
```tsx
interface DocRow {
  id: number;
  file_name: string;
  doc_type: string | null;
  created_at: string;
  already_in_corpus: boolean;
  approval_status: 'pending' | 'approved' | null;
}

interface DocDetail {
  id: number;
  file_name: string;
  raw_text: string | null;
  already_in_corpus: boolean;
  approval_status: 'pending' | 'approved' | null;
}
```

- [ ] **Step 2: Add the badge to the document list row**

Change the list row button's label:
```tsx
            <button
              key={r.id}
              onClick={() => setSelectedId(r.id)}
              className={`block w-full text-left p-2 text-[11px] border ${r.already_in_corpus ? 'opacity-50' : ''}`}
            >
              {r.file_name} {r.already_in_corpus ? '(already labeled)' : ''}
            </button>
```
to:
```tsx
            <button
              key={r.id}
              onClick={() => setSelectedId(r.id)}
              className={`block w-full text-left p-2 text-[11px] border ${r.already_in_corpus ? 'opacity-50' : ''}`}
            >
              {r.file_name}
              {r.approval_status === 'approved' && ' [APPROVED]'}
              {r.approval_status === 'pending' && ' [PENDING]'}
            </button>
```

- [ ] **Step 3: Add the Approve button to Text mode**

Add `const [approving, setApproving] = useState(false);` alongside the other `useState`
declarations, and a handler:
```tsx
  const handleApprove = async () => {
    if (selectedId == null) return;
    setApproving(true);
    try {
      await apiFetch(`/tesseract-training/documents/${selectedId}/approve`, { method: 'POST' });
      setDetail((d) => (d ? { ...d, approval_status: 'approved' } : d));
      loadList();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Approval failed');
    } finally {
      setApproving(false);
    }
  };
```
Then, in the Text mode block, change the existing submit button's surrounding markup from:
```tsx
                  {submitError && <p className="text-[11px] text-red-500">{submitError}</p>}
                  <button
                    onClick={handleSubmit}
                    disabled={submitting || detail.already_in_corpus}
                    className="px-3 py-1 border"
                  >
                    {detail.already_in_corpus ? 'Already Submitted' : 'Submit to Training Corpus'}
                  </button>
```
to:
```tsx
                  {submitError && <p className="text-[11px] text-red-500">{submitError}</p>}
                  <button
                    onClick={handleSubmit}
                    disabled={submitting || detail.already_in_corpus}
                    className="px-3 py-1 border"
                  >
                    {detail.already_in_corpus ? 'Already Submitted' : 'Submit to Training Corpus'}
                  </button>
                  {detail.already_in_corpus && detail.approval_status === 'pending' && (
                    <button
                      onClick={handleApprove}
                      disabled={approving}
                      className="px-3 py-1 border ml-2"
                    >
                      Approve
                    </button>
                  )}
```

- [ ] **Step 4: Typecheck**

```bash
cd client && npx tsc --noEmit
```
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/TesseractTrainingPage.tsx
git commit -m "feat(tesseract): add approval badge and Approve button"
```

---

### Task 8: Frontend — bulk submit

**Files:**
- Modify: `client/src/pages/TesseractTrainingPage.tsx`

**Interfaces:**
- Consumes: `POST /documents/bulk-submit` (Task 4).

- [ ] **Step 1: Add selection state and the bulk-submit handler**

Add alongside the other `useState` declarations:
```tsx
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkResultSummary, setBulkResultSummary] = useState<string | null>(null);

  const toggleSelected = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleBulkSubmit = async () => {
    if (selectedIds.size === 0) return;
    setBulkSubmitting(true);
    setBulkResultSummary(null);
    try {
      const res = await apiFetch<{ results: Array<{ id: number; success: boolean; error?: string }> }>(
        '/tesseract-training/documents/bulk-submit',
        { method: 'POST', body: JSON.stringify({ document_ids: Array.from(selectedIds) }) },
      );
      const succeeded = res.results.filter((r) => r.success).length;
      const failed = res.results.length - succeeded;
      setBulkResultSummary(`${succeeded} submitted, ${failed} failed`);
      setSelectedIds(new Set());
      loadList();
      loadStats();
    } catch (err) {
      setBulkResultSummary(err instanceof Error ? err.message : 'Bulk submit failed');
    } finally {
      setBulkSubmitting(false);
    }
  };
```

- [ ] **Step 2: Add checkboxes to the document list and the bulk-submit button**

Change the document list rendering from:
```tsx
        <div className="w-1/3 space-y-2">
          {rows.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelectedId(r.id)}
              className={`block w-full text-left p-2 text-[11px] border ${r.already_in_corpus ? 'opacity-50' : ''}`}
            >
              {r.file_name}
              {r.approval_status === 'approved' && ' [APPROVED]'}
              {r.approval_status === 'pending' && ' [PENDING]'}
            </button>
          ))}
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</button>
            <button onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        </div>
```
to:
```tsx
        <div className="w-1/3 space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={selectedIds.has(r.id)}
                onChange={() => toggleSelected(r.id)}
                disabled={r.already_in_corpus}
                aria-label={`Select ${r.file_name} for bulk submit`}
              />
              <button
                onClick={() => setSelectedId(r.id)}
                className={`flex-1 text-left p-2 text-[11px] border ${r.already_in_corpus ? 'opacity-50' : ''}`}
              >
                {r.file_name}
                {r.approval_status === 'approved' && ' [APPROVED]'}
                {r.approval_status === 'pending' && ' [PENDING]'}
              </button>
            </div>
          ))}
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</button>
            <button onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
          {selectedIds.size > 0 && (
            <div className="space-y-1">
              <button onClick={handleBulkSubmit} disabled={bulkSubmitting} className="px-3 py-1 border w-full">
                Submit {selectedIds.size} Selected
              </button>
              {bulkResultSummary && <p className="text-[11px]">{bulkResultSummary}</p>}
            </div>
          )}
        </div>
```
A document already in the corpus (`already_in_corpus`) has its checkbox disabled — bulk
submit is only meaningful for not-yet-labeled documents, and the backend's
`ALREADY_SUBMITTED` rejection would otherwise report a confusing "failure" for a document
the operator didn't intend to touch.

- [ ] **Step 3: Typecheck**

```bash
cd client && npx tsc --noEmit
```
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/TesseractTrainingPage.tsx
git commit -m "feat(tesseract): add bulk-submit checkboxes and summary"
```

---

### Task 9: Frontend — filter bar

**Files:**
- Modify: `client/src/pages/TesseractTrainingPage.tsx`

**Interfaces:**
- Consumes: `GET /documents` filter params (Task 5); `stats.by_doc_type` (Task 6, already loaded) for the doc_type dropdown's options — no second query needed.

- [ ] **Step 1: Add filter state and reflect it in the URL query string**

This page doesn't currently use `useSearchParams` — add it alongside the existing imports:
```tsx
import { useSearchParams } from 'react-router';
```
Add state, initialized from the URL, alongside the other `useState` declarations:
```tsx
  const [searchParams, setSearchParams] = useSearchParams();
  const [filterDocType, setFilterDocType] = useState(searchParams.get('doc_type') ?? '');
  const [filterLabeled, setFilterLabeled] = useState(searchParams.get('labeled') ?? '');
  const [filterFrom, setFilterFrom] = useState(searchParams.get('from') ?? '');
  const [filterTo, setFilterTo] = useState(searchParams.get('to') ?? '');
```

- [ ] **Step 2: Wire the filters into `loadList` and the URL**

Change the existing `loadList`:
```tsx
  const loadList = useCallback(() => {
    apiFetch<{ rows: DocRow[] }>(`/tesseract-training/documents?page=${page}`)
      .then((res) => setRows(res.rows))
      .catch(console.error);
  }, [page]);
```
to:
```tsx
  const loadList = useCallback(() => {
    const params = new URLSearchParams({ page: String(page) });
    if (filterDocType) params.set('doc_type', filterDocType);
    if (filterLabeled) params.set('labeled', filterLabeled);
    if (filterFrom) params.set('from', filterFrom);
    if (filterTo) params.set('to', filterTo);
    apiFetch<{ rows: DocRow[] }>(`/tesseract-training/documents?${params.toString()}`)
      .then((res) => setRows(res.rows))
      .catch(console.error);
    setSearchParams(params, { replace: true });
  }, [page, filterDocType, filterLabeled, filterFrom, filterTo, setSearchParams]);
```

- [ ] **Step 3: Render the filter bar**

Add immediately above the document list's `{rows.map(...)}` block:
```tsx
          <div className="space-y-1 pb-2 border-b border-surface-border">
            <select
              value={filterDocType}
              onChange={(e) => setFilterDocType(e.target.value)}
              className="w-full text-[11px] border p-1"
            >
              <option value="">All doc types</option>
              <option value="null">(unclassified)</option>
              {stats?.by_doc_type
                .filter((r) => r.doc_type != null)
                .map((r) => (
                  <option key={r.doc_type} value={r.doc_type!}>{r.doc_type}</option>
                ))}
            </select>
            <select
              value={filterLabeled}
              onChange={(e) => setFilterLabeled(e.target.value)}
              className="w-full text-[11px] border p-1"
            >
              <option value="">Labeled + unlabeled</option>
              <option value="true">Labeled only</option>
              <option value="false">Unlabeled only</option>
            </select>
            <div className="flex gap-1">
              <input
                type="date"
                value={filterFrom}
                onChange={(e) => setFilterFrom(e.target.value)}
                className="flex-1 text-[11px] border p-1"
              />
              <input
                type="date"
                value={filterTo}
                onChange={(e) => setFilterTo(e.target.value)}
                className="flex-1 text-[11px] border p-1"
              />
            </div>
          </div>
```

- [ ] **Step 4: Typecheck**

```bash
cd client && npx tsc --noEmit
```
Expected: no new errors.

- [ ] **Step 5: Manual verification**

Start the client dev server, navigate to the Tesseract Learning page, set a doc_type
filter, and confirm the URL updates to `?doc_type=...` and the list re-fetches. Confirm
reloading the page with that URL restores the same filter selection.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/TesseractTrainingPage.tsx
git commit -m "feat(tesseract): add document list filter bar"
```

---

## Self-Review Notes (from plan authoring)

- **Spec coverage:** §1 (dashboard) → Tasks 2, 6. §2 (approval) → Tasks 1, 3, 7. §3 (bulk
  submit) → Task 4, 8. §4 (filtering) → Task 5, 9.
- **Type consistency:** `submitDocumentToCorpus`'s return shape
  (`{success:true} | {success:false, error, code, status}`) is used identically by both
  the rewritten single-submit route (Task 4 Step 3) and the bulk-submit route in the same
  step — no drift between them. `approval_status: 'pending' | 'approved' | null` is used
  consistently across the backend response shapes (Task 3) and the frontend interfaces
  (Task 7).
- **Placeholder scan:** no TBD/TODO; Task 1's local-migration-drift fallback step gives a
  concrete alternate command rather than "handle appropriately."
