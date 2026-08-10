# Tesseract Training Package Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin/manager click "Start Training Run" on the Tesseract Learning portal to bundle every approved corpus document into a ready-to-run `tesstrain` package (zip, with a generated README), save it to R2 with a history log, and download it later.

**Architecture:** One new D1 table logs each generated package. One new route builds the zip synchronously (in-memory, via `fflate`) from existing `TESSERACT_TRAINING` R2 objects and saves it back to R2 under a new prefix. Two more routes list history and stream a saved package back. One frontend section adds the trigger button and history table to the existing Learning page.

**Tech Stack:** Hono routes, D1, Cloudflare R2 (`TESSERACT_TRAINING` bucket, already bound), `fflate` (zip library — already a transitive dependency, promoted to direct), React (existing `TesseractTrainingPage.tsx` patterns).

## Global Constraints

- Only `tesseract_training_corpus` rows with `approval_status = 'approved'` are eligible for packaging — matches the design's "approval = training-ready" meaning.
- Box annotations (`tesseract_box_annotations`) and review notes (`tesseract_review_annotations`) are NOT included in the package — out of scope per the design.
- `tesstrain` execution itself stays manual/local — no task in this plan runs it or touches `tesseract_ocr_primary`.
- Every route reuses the existing `requireAdminManager(c)` helper in `src/routes/tesseractTraining.ts` — no new gate.
- Zero eligible documents → `400 { error: 'No approved documents to package', code: 'NOTHING_TO_TRAIN' }`, never an empty zip.
- Run `npm run typecheck` after any `src/` change, `cd client && npx tsc --noEmit` after any `client/` change, before every commit.

---

### Task 1: Migration + `fflate` dependency

**Files:**
- Create: `migrations/0235_tesseract_training_runs.sql`
- Modify: `package.json` (promote `fflate` from transitive to direct dependency)

**Interfaces:**
- Produces: `tesseract_training_runs` table — consumed by Tasks 2 and 3. `fflate`'s `zipSync`/`unzipSync` — consumed by Task 2.

- [ ] **Step 1: Write the migration**

```sql
-- migrations/0235_tesseract_training_runs.sql
-- History log for generated tesstrain-ready packages. See
-- docs/superpowers/specs/2026-08-10-tesseract-training-package-export-design.md.
-- Each row's r2_key points at the exact saved zip under TESSERACT_TRAINING,
-- so re-downloading an old run returns the same bytes, not a re-bundled one.
CREATE TABLE IF NOT EXISTS tesseract_training_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  generated_by INTEGER NOT NULL,
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  document_count INTEGER NOT NULL,
  document_ids_json TEXT NOT NULL,
  r2_key TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tesseract_training_runs_generated_at ON tesseract_training_runs(generated_at DESC);
```

- [ ] **Step 2: Apply locally and verify**

```bash
npm run migrate:local
npx wrangler d1 execute rmpg-flex --local --command "SELECT name FROM sqlite_master WHERE type='table' AND name='tesseract_training_runs'"
```
Expected: one row, `tesseract_training_runs`. If `migrate:local`'s full batch aborts on a
pre-existing unrelated migration (documented CLAUDE.md "dirty schema" issue), apply this
file directly instead:
```bash
npx wrangler d1 execute rmpg-flex --local --file migrations/0235_tesseract_training_runs.sql
```

- [ ] **Step 3: Promote `fflate` to a direct dependency**

`fflate` is currently only a transitive dependency (pulled in by `pmtiles`, confirmed via
`npm ls fflate` → `pmtiles@4.4.1 └── fflate@0.8.3`). Add it explicitly to
`package.json`'s `"dependencies"` block (alphabetical order, matching the existing list):
```json
    "fflate": "^0.8.3",
```
Then run:
```bash
npm install
npm ls fflate
```
Expected: `fflate@0.8.3` (or newer patch) listed as a direct dependency, no version
conflict with the transitive one already resolved.

- [ ] **Step 4: Commit**

```bash
git add migrations/0235_tesseract_training_runs.sql package.json package-lock.json
git commit -m "feat(tesseract): add training_runs table, promote fflate to direct dependency"
```

---

### Task 2: Backend — `POST /documents/runs` (build + save package)

**Files:**
- Modify: `src/routes/tesseractTraining.ts`
- Test: `tests/tesseractTrainingRuns.test.ts`

**Interfaces:**
- Consumes: `requireAdminManager`, `getDb`, `query`, `execute` (already imported); `zipSync` from `fflate` (new import); `c.env.TESSERACT_TRAINING` (R2 bucket, already bound and used elsewhere in this file).
- Produces: `POST /api/tesseract-training/runs` → `{ id: number, document_count: number }` — consumed by Task 4's frontend "Start Training Run" button.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/tesseractTrainingRuns.test.ts
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import tesseractTrainingRouter from '../src/routes/tesseractTraining';
import { unzipSync, strFromU8 } from 'fflate';

function makeDb(opts: {
  approvedDocIds?: number[];
} = {}) {
  const approvedDocIds = opts.approvedDocIds ?? [];
  const inserts: Array<{ count: number; ids: number[]; r2Key: string; by: number }> = [];

  const prepare = (sql: string) => {
    let boundArgs: any[] = [];
    const stmt: any = {
      bind: (...args: any[]) => { boundArgs = args; return stmt; },
      all: async () => {
        if (/FROM tesseract_training_corpus WHERE approval_status/.test(sql)) {
          return { results: approvedDocIds.map((id) => ({ serve_intake_document_id: id })) };
        }
        return { results: [] };
      },
      first: async () => null,
      run: async () => {
        if (/INSERT INTO tesseract_training_runs/.test(sql)) {
          const [by, count, idsJson, r2Key] = boundArgs;
          inserts.push({ by, count, ids: JSON.parse(idsJson), r2Key });
          return { meta: { changes: 1, last_row_id: inserts.length } };
        }
        return { meta: { changes: 0 } };
      },
    };
    return stmt;
  };

  return { prepare, _inserts: inserts };
}

function makeR2(objectsByDoc: Record<number, { imageBytes: Uint8Array; groundTruth: string }>) {
  const puts: Array<{ key: string; bytes: Uint8Array }> = [];
  return {
    list: async ({ prefix }: { prefix: string }) => {
      const m = prefix.match(/^training-corpus\/(\d+)\//);
      const docId = m ? Number(m[1]) : -1;
      if (!(docId in objectsByDoc)) return { objects: [] };
      return {
        objects: [
          { key: `training-corpus/${docId}/image.png` },
          { key: `training-corpus/${docId}/ground-truth.txt` },
        ],
      };
    },
    get: async (key: string) => {
      const m = key.match(/^training-corpus\/(\d+)\/(image\.png|ground-truth\.txt)$/);
      if (!m) return null;
      const docId = Number(m[1]);
      const entry = objectsByDoc[docId];
      if (!entry) return null;
      const bytes = m[2] === 'image.png' ? entry.imageBytes : new TextEncoder().encode(entry.groundTruth);
      return { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    },
    put: async (key: string, bytes: Uint8Array) => { puts.push({ key, bytes }); },
    _puts: puts,
  };
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

describe('tesseract training runs — POST /runs', () => {
  test('returns 403 for a non-admin/manager role', async () => {
    const app = makeApp('officer');
    const res = await app.request('/documents/runs', { method: 'POST' }, {
      DB: makeDb(), TESSERACT_TRAINING: makeR2({}),
    });
    expect(res.status).toBe(403);
  });

  test('returns 400 when no documents are approved', async () => {
    const app = makeApp('admin');
    const res = await app.request('/documents/runs', { method: 'POST' }, {
      DB: makeDb({ approvedDocIds: [] }), TESSERACT_TRAINING: makeR2({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.code).toBe('NOTHING_TO_TRAIN');
  });

  test('bundles approved documents into a zip with the expected layout and saves it to R2', async () => {
    const app = makeApp('manager');
    const db = makeDb({ approvedDocIds: [12, 34] });
    const r2 = makeR2({
      12: { imageBytes: new Uint8Array([1, 2, 3]), groundTruth: 'Recipient: Jane Doe' },
      34: { imageBytes: new Uint8Array([4, 5, 6]), groundTruth: 'Recipient: John Roe' },
    });
    const res = await app.request('/documents/runs', { method: 'POST' }, { DB: db, TESSERACT_TRAINING: r2 });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.document_count).toBe(2);
    expect(typeof body.id).toBe('number');

    expect(r2._puts).toHaveLength(1);
    const zipBytes = r2._puts[0].bytes;
    const unzipped = unzipSync(zipBytes);
    expect(Object.keys(unzipped).sort()).toEqual([
      'README.md',
      'rmpg-ground-truth/12.gt.txt',
      'rmpg-ground-truth/12.png',
      'rmpg-ground-truth/34.gt.txt',
      'rmpg-ground-truth/34.png',
    ]);
    expect(strFromU8(unzipped['rmpg-ground-truth/12.gt.txt'])).toBe('Recipient: Jane Doe');
    expect(strFromU8(unzipped['README.md'])).toContain('MODEL_NAME=rmpg');

    expect(db._inserts).toHaveLength(1);
    expect(db._inserts[0].count).toBe(2);
    expect(db._inserts[0].ids.sort()).toEqual([12, 34]);
    expect(db._inserts[0].r2Key).toBe(r2._puts[0].key);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tesseractTrainingRuns.test.ts`
Expected: FAIL — route doesn't exist, 404.

- [ ] **Step 3: Implement the route**

Add to `src/routes/tesseractTraining.ts`. First, add the import at the top of the file
alongside the existing imports:
```typescript
import { zipSync, strToU8 } from 'fflate';
```

Then add the route, after the `/documents/bulk-submit` route and before
`export default tesseractTraining;`:

```typescript
// POST /api/tesseract-training/documents/runs
// Bundles every approved tesseract_training_corpus document into a
// tesstrain-ready zip (image + ground-truth pairs, exactly the shape
// tesstrain's GROUND_TRUTH_DIR expects) and saves it to R2. Does NOT run
// tesstrain itself — that stays a manual, local, operator-run process.
tesseractTraining.post('/documents/runs', async (c) => {
  if (!requireAdminManager(c)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  const user = c.get('user');
  const db = getDb(c.env);

  const approved = await query<{ serve_intake_document_id: number }>(
    db,
    `SELECT serve_intake_document_id FROM tesseract_training_corpus WHERE approval_status = 'approved'`,
  );
  if (approved.length === 0) {
    return c.json({ error: 'No approved documents to package', code: 'NOTHING_TO_TRAIN' }, 400);
  }

  const zipEntries: Record<string, Uint8Array> = {};
  for (const { serve_intake_document_id: docId } of approved) {
    const listed = await c.env.TESSERACT_TRAINING.list({ prefix: `training-corpus/${docId}/` });
    const imageKey = listed.objects.find((o: { key: string }) => /\/image\.[^/]+$/.test(o.key))?.key;
    const gtKey = listed.objects.find((o: { key: string }) => o.key.endsWith('/ground-truth.txt'))?.key;
    if (!imageKey || !gtKey) continue; // source objects missing — skip rather than fail the whole run

    const imageObj = await c.env.TESSERACT_TRAINING.get(imageKey);
    const gtObj = await c.env.TESSERACT_TRAINING.get(gtKey);
    if (!imageObj || !gtObj) continue;

    const ext = imageKey.split('.').pop() || 'png';
    zipEntries[`rmpg-ground-truth/${docId}.${ext}`] = new Uint8Array(await imageObj.arrayBuffer());
    zipEntries[`rmpg-ground-truth/${docId}.gt.txt`] = new Uint8Array(await gtObj.arrayBuffer());
  }

  const includedIds = approved
    .map((r) => r.serve_intake_document_id)
    .filter((docId) => `rmpg-ground-truth/${docId}.gt.txt` in zipEntries);
  if (includedIds.length === 0) {
    return c.json({ error: 'No approved documents to package', code: 'NOTHING_TO_TRAIN' }, 400);
  }

  const generatedAt = new Date().toISOString();
  const readme = `# RMPG Flex — Tesseract Training Package

Generated: ${generatedAt}
Documents included: ${includedIds.length}

## To train

1. Clone tesstrain if you haven't already:
   git clone https://github.com/tesseract-ocr/tesstrain.git
   cd tesstrain

2. Extract this package's rmpg-ground-truth/ folder into tesstrain's data/ directory:
   data/rmpg-ground-truth/

3. Run training (requires the stock \`eng\` traineddata as the starting point):
   make training MODEL_NAME=rmpg START_MODEL=eng TESSDATA=/usr/share/tesseract-ocr/5/tessdata GROUND_TRUTH_DIR=data/rmpg-ground-truth

4. The resulting data/rmpg.traineddata is the fine-tuned model. Upload it to:
   rmpg-flex-tesseract-training/models/latest/tesseract.traineddata
   (this is the R2 key scripts/fetch-tesseract-model.sh looks for on the next deploy)
`;
  zipEntries['README.md'] = strToU8(readme);

  const zipped = zipSync(zipEntries);
  const r2Key = `training-runs/${Date.now()}/package.zip`;
  await c.env.TESSERACT_TRAINING.put(r2Key, zipped, {
    httpMetadata: { contentType: 'application/zip' },
  });

  const result = await execute(
    db,
    `INSERT INTO tesseract_training_runs (generated_by, document_count, document_ids_json, r2_key) VALUES (?, ?, ?, ?)`,
    user.id, includedIds.length, JSON.stringify(includedIds), r2Key,
  );
  return c.json({ id: result.meta.last_row_id, document_count: includedIds.length });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tesseractTrainingRuns.test.ts`
Expected: PASS, all 3 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/routes/tesseractTraining.ts tests/tesseractTrainingRuns.test.ts
git commit -m "feat(tesseract): add POST /documents/runs to build and save a training package"
```

---

### Task 3: Backend — `GET /documents/runs` (history) + `GET /documents/runs/:id/download`

**Files:**
- Modify: `src/routes/tesseractTraining.ts`
- Test: `tests/tesseractTrainingRuns.test.ts` (extend, same file as Task 2)

**Interfaces:**
- Consumes: `tesseract_training_runs` table (Task 1), `clampIntParam` (already imported in this file).
- Produces: `GET /api/tesseract-training/documents/runs?page=1` → `{ rows: [{id, generated_at, generated_by, document_count}], page, pageSize }`; `GET /api/tesseract-training/documents/runs/:id/download` → the saved zip bytes with `Content-Disposition` — consumed by Task 4's frontend history table.

- [ ] **Step 1: Write the failing tests**

Append to `tests/tesseractTrainingRuns.test.ts` (extend the existing `makeDb`/`makeR2`
helpers from Task 2 rather than duplicating them — add a `runs` option to `makeDb` and a
`savedZip` option to `makeR2`):

```typescript
// Extend makeDb's signature to accept: runs?: Array<{id:number; generated_at:string; generated_by:number; document_count:number; r2_key:string}>
// and answer `all`/`first` queries against `FROM tesseract_training_runs` accordingly.
// Extend makeR2 to accept: savedZip?: {key: string; bytes: Uint8Array} and answer
// `get(key)` for that key with { arrayBuffer: async () => bytes.buffer, ... }.

describe('tesseract training runs — GET /runs and download', () => {
  test('GET /documents/runs returns 403 for a non-admin/manager role', async () => {
    const app = makeApp('officer');
    const res = await app.request('/documents/runs', {}, { DB: makeDb(), TESSERACT_TRAINING: makeR2({}) });
    expect(res.status).toBe(403);
  });

  test('GET /documents/runs lists runs newest first', async () => {
    const app = makeApp('admin');
    const db = makeDb({
      runs: [
        { id: 1, generated_at: '2026-08-01T00:00:00Z', generated_by: 42, document_count: 3, r2_key: 'training-runs/1/package.zip' },
        { id: 2, generated_at: '2026-08-05T00:00:00Z', generated_by: 42, document_count: 7, r2_key: 'training-runs/2/package.zip' },
      ],
    });
    const res = await app.request('/documents/runs', {}, { DB: db, TESSERACT_TRAINING: makeR2({}) });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.rows.map((r: any) => r.id)).toEqual([2, 1]);
  });

  test('GET /documents/runs/:id/download streams the saved zip with the right headers', async () => {
    const app = makeApp('manager');
    const zipBytes = new Uint8Array([80, 75, 3, 4]); // PK.. zip magic bytes, doesn't need to be a real zip for this test
    const db = makeDb({
      runs: [{ id: 5, generated_at: '2026-08-05T00:00:00Z', generated_by: 42, document_count: 2, r2_key: 'training-runs/5/package.zip' }],
    });
    const r2 = makeR2({ savedZip: { key: 'training-runs/5/package.zip', bytes: zipBytes } });
    const res = await app.request('/documents/runs/5/download', {}, { DB: db, TESSERACT_TRAINING: r2 });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toContain('rmpg-training-5.zip');
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(buf)).toEqual(Array.from(zipBytes));
  });

  test('GET /documents/runs/:id/download returns 404 for an unknown id', async () => {
    const app = makeApp('admin');
    const res = await app.request('/documents/runs/999/download', {}, { DB: makeDb({ runs: [] }), TESSERACT_TRAINING: makeR2({}) });
    expect(res.status).toBe(404);
  });
});
```

Update `makeDb` (from Task 2) to also handle these queries:
```typescript
      all: async () => {
        if (/FROM tesseract_training_corpus WHERE approval_status/.test(sql)) {
          return { results: approvedDocIds.map((id) => ({ serve_intake_document_id: id })) };
        }
        if (/FROM tesseract_training_runs/.test(sql) && /ORDER BY/.test(sql)) {
          return { results: (opts.runs ?? []).slice().sort((a, b) => b.id - a.id) };
        }
        return { results: [] };
      },
      first: async () => {
        if (/FROM tesseract_training_runs WHERE id/.test(sql)) {
          return (opts.runs ?? []).find((r) => r.id === boundArgs[0]) ?? null;
        }
        return null;
      },
```
(Add `runs` to `makeDb`'s options type: `runs?: Array<{ id: number; generated_at: string; generated_by: number; document_count: number; r2_key: string }>`.)

Update `makeR2` (from Task 2) to also handle a saved-zip lookup:
```typescript
function makeR2(objectsByDoc: Record<number, { imageBytes: Uint8Array; groundTruth: string }>, savedZip?: { key: string; bytes: Uint8Array }) {
  // ...existing list/put/get for training-corpus/ objects...
  const originalGet = /* the existing get function body */;
  return {
    // ...
    get: async (key: string) => {
      if (savedZip && key === savedZip.key) {
        return { arrayBuffer: async () => savedZip.bytes.buffer.slice(savedZip.bytes.byteOffset, savedZip.bytes.byteOffset + savedZip.bytes.byteLength) };
      }
      // fall through to the existing training-corpus/ object lookup
    },
    // ...
  };
}
```
(Since the brief shows `makeR2({ savedZip: {...} })` as a single-object call in some test
cases and `makeR2({})` in others, adjust the signature to `makeR2(opts: { objectsByDoc?: ...; savedZip?: ... })` — a single options object — and update the Task 2 call sites in this same file to match. This is a small internal test-helper signature change, not a production code change.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tesseractTrainingRuns.test.ts`
Expected: the 4 new tests FAIL (routes don't exist); the 3 Task-2 tests still PASS (helper
signature change must not break them — fix the Task 2 test's `makeR2({...})` call sites if
needed to match the new single-options-object signature).

- [ ] **Step 3: Implement the routes**

Add to `src/routes/tesseractTraining.ts`, right after the `/documents/runs` POST route:

```typescript
interface TrainingRunRow {
  id: number;
  generated_at: string;
  generated_by: number;
  document_count: number;
}

// GET /api/tesseract-training/documents/runs?page=1
tesseractTraining.get('/documents/runs', async (c) => {
  if (!requireAdminManager(c)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  const db = getDb(c.env);
  const page = clampIntParam(c.req.query('page'), 1, 1, 100000);
  const pageSize = 20;
  const offset = (page - 1) * pageSize;
  const rows = await query<TrainingRunRow>(
    db,
    `SELECT id, generated_at, generated_by, document_count
       FROM tesseract_training_runs
      ORDER BY generated_at DESC
      LIMIT ? OFFSET ?`,
    pageSize, offset,
  );
  return c.json({ rows, page, pageSize });
});

// GET /api/tesseract-training/documents/runs/:id/download
tesseractTraining.get('/documents/runs/:id/download', async (c) => {
  if (!requireAdminManager(c)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const db = getDb(c.env);
  const run = await queryFirst<{ r2_key: string }>(
    db,
    `SELECT r2_key FROM tesseract_training_runs WHERE id = ?`,
    id,
  );
  if (!run) return c.json({ error: 'Not found' }, 404);
  const obj = await c.env.TESSERACT_TRAINING.get(run.r2_key);
  if (!obj) return c.json({ error: 'Package missing in R2' }, 404);
  return new Response(obj.body ?? (await obj.arrayBuffer()), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="rmpg-training-${id}.zip"`,
    },
  });
});
```
**Route ordering note**: `GET /documents/:id` is registered at line 66 of the current
file, and the new `GET /documents/runs`/`GET /documents/runs/:id/download` routes are
appended after line ~345 (after the Task 2 `POST /documents/runs` route). Hono's router
prioritizes static path segments over `:id` params regardless of registration order, so
`/documents/runs` should NOT be captured by `/documents/:id` with `:id` bound to the
literal string `"runs"` — but this is exactly the kind of routing assumption to verify
with a real test rather than trust by construction. Step 4 below is the check: if
`GET /documents/runs` returns a 400 "Invalid id" (the `:id` handler rejecting `"runs"` as
non-numeric) instead of the run-list response, move the two new GET routes to
immediately before line 66's `GET /documents/:id` definition and re-run.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tesseractTrainingRuns.test.ts`
Expected: PASS, all 7 tests (3 from Task 2 + 4 new). If the `GET /documents/runs` test
fails with a 400 instead of 200, apply the route-ordering fix described in Step 3's
IMPORTANT note, then re-run.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/routes/tesseractTraining.ts tests/tesseractTrainingRuns.test.ts
git commit -m "feat(tesseract): add GET /documents/runs list and download routes"
```

---

### Task 4: Frontend — Training Runs section

**Files:**
- Modify: `client/src/pages/TesseractTrainingPage.tsx`

**Interfaces:**
- Consumes: `POST /documents/runs`, `GET /documents/runs`, `GET /documents/runs/:id/download` (Tasks 2-3); `stats.total_approved` (already loaded by the existing coverage dashboard panel).

- [ ] **Step 1: Add state and loaders**

Add near the other interfaces at the top of `client/src/pages/TesseractTrainingPage.tsx`:
```tsx
interface TrainingRun {
  id: number;
  generated_at: string;
  generated_by: number;
  document_count: number;
}
```

Add state and a loader alongside the other `useState`/`useCallback` declarations:
```tsx
  const [runs, setRuns] = useState<TrainingRun[]>([]);
  const [startingRun, setStartingRun] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const loadRuns = useCallback(() => {
    apiFetch<{ rows: TrainingRun[] }>('/tesseract-training/documents/runs?page=1')
      .then((res) => setRuns(res.rows))
      .catch(console.error);
  }, []);

  useEffect(() => { loadRuns(); }, [loadRuns]);

  const handleStartRun = async () => {
    setStartingRun(true);
    setRunError(null);
    try {
      await apiFetch('/tesseract-training/documents/runs', { method: 'POST' });
      loadRuns();
      loadStats();
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Failed to start training run');
    } finally {
      setStartingRun(false);
    }
  };
```
(`loadStats` is the existing function from the coverage-dashboard task — reused here
unchanged, no new definition needed.)

- [ ] **Step 2: Render the Training Runs section**

Add this block immediately after the existing coverage dashboard panel's closing `)}`
(the block that starts `{stats && (...)}`) and before the `<div className="flex gap-4">`
that holds the document list + detail pane:

```tsx
      <div className="border border-surface-border p-3 space-y-2">
        <p className="text-[11px] font-bold uppercase tracking-wide">Training Runs</p>
        <button
          onClick={handleStartRun}
          disabled={startingRun || !stats || stats.total_approved === 0}
          className="px-3 py-1 border text-[11px]"
        >
          {startingRun ? 'Building Package...' : 'Start Training Run'}
        </button>
        {stats && stats.total_approved === 0 && (
          <p className="text-[11px] text-fg-muted">
            Approve at least one document before starting a training run.
          </p>
        )}
        {runError && <p className="text-[11px] text-red-500">{runError}</p>}
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-fg-muted">
              <th>Generated</th><th>Documents</th><th></th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id}>
                <td>{new Date(run.generated_at).toLocaleString()}</td>
                <td>{run.document_count}</td>
                <td>
                  <a
                    href={authedImageUrl(`/api/tesseract-training/documents/runs/${run.id}/download`)}
                    download={`rmpg-training-${run.id}.zip`}
                  >
                    Download
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
```
`authedImageUrl` is reused here (already imported in this file) purely for its existing
behavior of appending the auth token as a query param to a plain `<a>`/`<img>` URL — the
same reason it's used for the document image elsewhere on this page; the download route
happens to serve a zip instead of an image, but the auth-token-in-URL mechanism is
identical.

- [ ] **Step 3: Typecheck**

```bash
cd client && npx tsc --noEmit
```
Expected: no new errors.

- [ ] **Step 4: Manual verification**

Start the client dev server, navigate to the Tesseract Learning page (via AdminPage's
"Tesseract OCR Learning" tab or `/tesseract-training` directly). Confirm the "Start
Training Run" button is disabled when the coverage panel shows 0 approved documents, and
that the Training Runs table renders (even if empty) without errors. If a live admin
session isn't reachable in this environment, state that clearly rather than fabricating a
browser check, and rely on the typecheck + code review instead.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/TesseractTrainingPage.tsx
git commit -m "feat(tesseract): add Training Runs section to the Learning portal"
```

---

## Self-Review Notes (from plan authoring)

- **Spec coverage:** §1 (package contents) → Task 2. §2 (schema) → Task 1. §3 (routes) →
  Tasks 2-3. §4 (UI) → Task 4.
- **Type consistency:** `TrainingRunRow`/`TrainingRun` field names (`id`, `generated_at`,
  `generated_by`, `document_count`) match exactly between the backend response (Task 3)
  and the frontend interface (Task 4). The zip's internal path convention
  (`rmpg-ground-truth/<id>.<ext>` / `rmpg-ground-truth/<id>.gt.txt`) is used identically in
  the route implementation (Task 2) and the test assertions (Task 2's test).
- **Placeholder scan:** no TBD/TODO. Task 3's route-ordering caveat gives a concrete,
  checkable symptom (400 "Invalid id" vs. a real run-list response) and a concrete fix
  instruction, rather than an open-ended "handle routing carefully."
- **Risk flagged deliberately**: Task 3's Hono route-ordering note is included because this
  file's existing `GET /documents/:id` route was NOT read by the plan author with its exact
  current line number confirmed against `/documents/runs`'s placement — the implementer
  must verify via the test suite itself (a 400 vs 200 on `GET /documents/runs` is an
  unambiguous, cheap signal) rather than trust that route order in this file happens to be
  safe by construction.
