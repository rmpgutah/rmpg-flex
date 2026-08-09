# Tesseract OCR Learning Portal + Gated Production Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify the Tesseract OCR container actually works live, rebuild the training portal with bounding-box (real training data) and free-form (review-only) annotation on top of the existing text-correction flow, surface it from AdminPage and ServeIntakePage, and add a feature-flag-gated (default OFF) Tesseract-primary OCR leg for Serve Intake images — with the flag flip itself left to the user after an A/B run.

**Architecture:** Two new D1 tables back the annotation layers; five new routes on the existing `tesseractTraining.ts` router serve them; a rebuilt `TesseractTrainingPage.tsx` adds a mode toggle (Text / Boxes / Notes) with a `<canvas>` overlay for the two new modes. The gated OCR leg lives in `src/routes/serveIntake.ts` (which already imports `@cloudflare/containers`) as a wrapper around the existing `ocrImage()`, NOT inside `serveIntakeOcr.ts` — that file is deliberately container-import-free so it stays testable under plain Node vitest (see its own file header). The feature flag reuses the existing KV-backed `feature_flags` mechanism (`src/routes/adminDev.ts` + `client/src/context/FeatureFlagsContext.tsx`), adding one key rather than inventing a new toggle system.

**Tech Stack:** Hono routes, D1, Cloudflare Containers, React + Canvas 2D API (no new npm dependency), existing KV feature-flags pattern, Vitest (Node + Miniflare conventions already in the repo).

## Global Constraints

- Every D1 write path: `await` all `.prepare().first()/.all()/.run()` calls (D1 is fully async).
- New migration file uses `CREATE TABLE IF NOT EXISTS` — idempotent, per repo convention.
- `tesseractTraining.ts` route gating: reuse the existing `requireAdminManager(c)` helper already in that file — do not invent a second gate.
- `serveIntakeOcr.ts` must NOT gain an `import ... from '@cloudflare/containers'` — that import stays exclusive to route files per that file's own header comment, so it keeps working under plain Node vitest.
- The `tesseract_ocr_primary` feature flag defaults to `false` in BOTH the server (`src/routes/adminDev.ts`) and client (`client/src/context/FeatureFlagsContext.tsx`) `DEFAULT_FLAGS`. No task in this plan sets it to `true`.
- `AdminPage.tsx` tab additions require ALL FOUR edits (per CLAUDE.md gotcha #16): `TabId` union, `VALID_TABS` array, tab config array entry, `activeTab === '...'` render block. Missing one compiles clean until `tsc` catches it late.
- Run `npm run typecheck` (worker) and `cd client && npx tsc --noEmit` (client) after any task touching their respective trees, before committing.

---

### Task 1: Live-verify and fix the Tesseract container path

**Files:**
- Modify (if broken): `containers/tesseract-ocr/server.py`, `containers/tesseract-ocr/Dockerfile`, `src/containers/tesseractOcrContainer.ts`, `src/routes/tesseractOcr.ts`
- Modify (stale comment, found during spec research): `.github/workflows/deploy.yml:105-106`

**Interfaces:**
- Consumes: nothing from later tasks.
- Produces: a live, working `GET /api/tesseract-ocr/health` (200, `tesseract_version` present) and `POST /api/tesseract-ocr/ocr` (200, non-empty `text` field on a real image) — later tasks' A/B run (Task 9) depends on this actually working.

- [ ] **Step 1: Fix the stale deploy.yml comment**

`.github/workflows/deploy.yml` lines 105-106 currently read:
```yaml
          # [[containers]] removed from wrangler.toml (PdfToolsContainer
          # intentionally off). No --containers-rollout flag needed.
```
This is factually wrong — `wrangler.toml` has an active `[[containers]]` block for `TesseractOcrContainer`, and `PdfToolsContainer` was re-enabled earlier this session. Replace with:
```yaml
          # wrangler 4.x deploys [[containers]] automatically with a plain
          # `deploy` command — no --containers-rollout flag exists/needed.
          # Both PdfToolsContainer and TesseractOcrContainer are active here.
```

- [ ] **Step 2: Confirm the container is actually deployed**

Run:
```bash
npx wrangler deployments list --name rmpg-flex-api 2>&1 | head -20
```
Confirm the most recent deployment postdates the commit that added the `[[containers]]` block for `TesseractOcrContainer` (`v8-tesseractocr` migration tag in `wrangler.toml`). If it doesn't, trigger a deploy by pushing an empty-diff commit or ask the user to confirm a deploy has run since — do not proceed to Step 3 against a stale deployment.

- [ ] **Step 3: Hit the live health endpoint with a real admin/manager JWT**

Get a token (ask the user for a live admin session token, or use the temp audit account per `reference-live-test-account` memory if available), then:
```bash
curl -s -H "Authorization: Bearer $TOKEN" https://api.rmpgutah.us/api/tesseract-ocr/health
```
Expected: `{"status":"ok","tesseract_version":"tesseract 5....","custom_model_present":false}` (`custom_model_present: false` is CORRECT at this stage — no fine-tuning has happened yet, per spec non-goals).

If this instead returns `503 {"status":"unavailable","code":"CONTAINER_UNREACHABLE",...}`: read the `detail` field, it's the container-fetch error message. Common causes to check in order: (a) `TESSERACT_OCR` container has `max_instances: 3` in `wrangler.toml` — confirm the account hasn't hit a Containers plan limit via `npx wrangler containers list`; (b) the container image failed to build — check `containers/tesseract-ocr/model/rmpg.traineddata` was actually populated by the "Fetch Tesseract model" deploy step by re-running `./scripts/fetch-tesseract-model.sh` locally and confirming a non-empty file lands at that path; (c) `server.py`'s `TESSDATA_DIR = "/usr/share/tesseract-ocr/5/tessdata"` — confirm this path is correct for the `tesseract-ocr` apt package version that lands on `python:3.12-slim-bookworm` by checking `apt-cache policy tesseract-ocr` inside a throwaway container (`docker run --rm python:3.12-slim-bookworm bash -c "apt-get update && apt-get install -y tesseract-ocr && dpkg -L tesseract-ocr | grep tessdata"`) — if the real path differs, fix `TESSDATA_DIR` in `server.py` to match.

- [ ] **Step 4: Hit the live OCR endpoint with a real test image**

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  -F "image=@tests/fixtures/serve-intake/vision/homoglyph-address.png" \
  https://api.rmpgutah.us/api/tesseract-ocr/ocr
```
Expected: `{"text":"..."}` with real (if rough) extracted text — not an empty string, not a 500.

If this 500s with "OCR processing failed": the most likely cause given `-l rmpg` in `server.py`'s `subprocess.run` call is that no `rmpg.traineddata` file exists at `TESSDATA_DIR` (the stock-fallback copy step in `fetch-tesseract-model.sh` failed silently under `continue-on-error: true`). Confirm by checking the "Fetch Tesseract model" step's log in the most recent GitHub Actions run (`gh run list --workflow=deploy.yml --limit=1` then `gh run view <id> --log | grep -A5 "Fetch Tesseract model"`). If the step failed, re-run it manually and redeploy.

- [ ] **Step 5: Record the result and commit any fixes**

Whatever was actually broken (or confirmed already working), commit the fix (or the comment correction from Step 1 alone if nothing else was broken):
```bash
git add .github/workflows/deploy.yml [any other files fixed]
git commit -m "fix(tesseract): correct stale deploy.yml comment + verify container health live

Confirmed GET /api/tesseract-ocr/health and POST /ocr work end-to-end
on live D1/Containers. [Add one line here describing the actual fix,
if Steps 3/4 found a real bug — replace this bracket before committing.]"
```

---

### Task 2: Migration — box annotation and review-note tables

**Files:**
- Create: `migrations/0233_tesseract_training_annotations.sql`

**Interfaces:**
- Produces: tables `tesseract_box_annotations` and `tesseract_review_annotations`, consumed by Task 3.

- [ ] **Step 1: Write the migration file**

```sql
-- migrations/0233_tesseract_training_annotations.sql
-- Two new annotation layers for the Tesseract OCR Learning portal, on top
-- of the existing whole-document text-correction flow (tesseract_training_corpus,
-- migration 0230). See docs/superpowers/specs/2026-08-09-tesseract-ocr-learning-production-design.md.

-- Real training data: one row per marked word/line region + its corrected
-- text. Coordinates are in ORIGINAL image pixel space (top-left origin),
-- NOT tile/PDF coordinate space — shaped so a future manual `tesstrain` run
-- can emit a Tesseract .box file directly from this table.
CREATE TABLE IF NOT EXISTS tesseract_box_annotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  serve_intake_document_id INTEGER NOT NULL,
  x0 INTEGER NOT NULL,
  y0 INTEGER NOT NULL,
  x1 INTEGER NOT NULL,
  y1 INTEGER NOT NULL,
  corrected_text TEXT NOT NULL,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (serve_intake_document_id) REFERENCES serve_intake_documents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tesseract_box_annotations_doc ON tesseract_box_annotations(serve_intake_document_id);

-- Review notes only: free-form strokes (arrows/circles/highlights) as a
-- JSON array of {tool, points[], color}. NEVER read by any training path —
-- purely a human-to-human "look at this" layer. One row per document
-- (whole note layer replaced on save, not appended).
CREATE TABLE IF NOT EXISTS tesseract_review_annotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  serve_intake_document_id INTEGER NOT NULL UNIQUE,
  strokes_json TEXT NOT NULL,
  updated_by INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (serve_intake_document_id) REFERENCES serve_intake_documents(id) ON DELETE CASCADE
);
```

- [ ] **Step 2: Apply locally and verify**

```bash
npm run migrate:local
npx wrangler d1 execute rmpg-flex --local --command "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'tesseract_%'"
```
Expected: three rows — `tesseract_training_corpus`, `tesseract_box_annotations`, `tesseract_review_annotations`.

- [ ] **Step 3: Commit**

```bash
git add migrations/0233_tesseract_training_annotations.sql
git commit -m "feat(tesseract): add box-annotation and review-note tables"
```

---

### Task 3: Backend routes — box annotations (list/create/delete)

**Files:**
- Modify: `src/routes/tesseractTraining.ts`
- Test: `tests/tesseractBoxAnnotations.test.ts`

**Interfaces:**
- Consumes: `requireAdminManager(c)`, `getDb`, `query`, `queryFirst`, `execute` (already imported in `tesseractTraining.ts`).
- Produces: `GET /api/tesseract-training/documents/:id/boxes`, `POST /api/tesseract-training/documents/:id/boxes`, `DELETE /api/tesseract-training/documents/:id/boxes/:boxId` — consumed by Task 6's frontend.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/tesseractBoxAnnotations.test.ts
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import tesseractTrainingRouter from '../src/routes/tesseractTraining';

function makeDb(opts: {
  boxes?: Array<{ id: number; serve_intake_document_id: number; x0: number; y0: number; x1: number; y1: number; corrected_text: string; created_at: string }>;
} = {}) {
  const boxes = opts.boxes ?? [];
  let nextId = boxes.length + 1;

  const prepare = (sql: string) => {
    let boundArgs: any[] = [];
    const stmt: any = {
      bind: (...args: any[]) => { boundArgs = args; return stmt; },
      first: async () => null,
      all: async () => {
        if (/FROM tesseract_box_annotations WHERE serve_intake_document_id/.test(sql)) {
          const docId = boundArgs[0];
          return { results: boxes.filter((b) => b.serve_intake_document_id === docId) };
        }
        return { results: [] };
      },
      run: async () => {
        if (/INSERT INTO tesseract_box_annotations/.test(sql)) {
          const [docId, x0, y0, x1, y1, correctedText, createdBy] = boundArgs;
          const row = { id: nextId++, serve_intake_document_id: docId, x0, y0, x1, y1, corrected_text: correctedText, created_at: 'now' };
          boxes.push(row);
          return { meta: { changes: 1, last_row_id: row.id } };
        }
        if (/DELETE FROM tesseract_box_annotations/.test(sql)) {
          const boxId = boundArgs[0];
          const idx = boxes.findIndex((b) => b.id === boxId);
          if (idx >= 0) boxes.splice(idx, 1);
          return { meta: { changes: idx >= 0 ? 1 : 0 } };
        }
        return { meta: { changes: 0 } };
      },
    };
    return stmt;
  };

  return { prepare, _boxes: boxes };
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

describe('tesseract box annotations', () => {
  test('GET /documents/:id/boxes returns 403 for a non-admin/manager role', async () => {
    const app = makeApp('officer');
    const res = await app.request('/documents/1/boxes', {}, { DB: makeDb() });
    expect(res.status).toBe(403);
  });

  test('GET /documents/:id/boxes returns only boxes for that document', async () => {
    const app = makeApp('admin');
    const db = makeDb({
      boxes: [
        { id: 1, serve_intake_document_id: 5, x0: 10, y0: 20, x1: 100, y1: 40, corrected_text: 'Main St', created_at: 'now' },
        { id: 2, serve_intake_document_id: 6, x0: 0, y0: 0, x1: 5, y1: 5, corrected_text: 'other doc', created_at: 'now' },
      ],
    });
    const res = await app.request('/documents/5/boxes', {}, { DB: db });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.boxes).toHaveLength(1);
    expect(body.boxes[0].corrected_text).toBe('Main St');
  });

  test('POST /documents/:id/boxes creates a box and returns its id', async () => {
    const app = makeApp('manager');
    const db = makeDb();
    const res = await app.request('/documents/5/boxes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x0: 1, y0: 2, x1: 3, y1: 4, corrected_text: 'S Main St' }),
    }, { DB: db });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(typeof body.id).toBe('number');
  });

  test('POST /documents/:id/boxes rejects a missing corrected_text', async () => {
    const app = makeApp('admin');
    const res = await app.request('/documents/5/boxes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x0: 1, y0: 2, x1: 3, y1: 4, corrected_text: '' }),
    }, { DB: makeDb() });
    expect(res.status).toBe(400);
  });

  test('DELETE /documents/:id/boxes/:boxId removes the box', async () => {
    const app = makeApp('admin');
    const db = makeDb({ boxes: [{ id: 9, serve_intake_document_id: 5, x0: 1, y0: 1, x1: 2, y1: 2, corrected_text: 'x', created_at: 'now' }] });
    const res = await app.request('/documents/5/boxes/9', { method: 'DELETE' }, { DB: db });
    expect(res.status).toBe(200);
    expect(db._boxes).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tesseractBoxAnnotations.test.ts`
Expected: FAIL — routes don't exist yet, all requests 404.

- [ ] **Step 3: Implement the routes**

Add to `src/routes/tesseractTraining.ts`, after the existing `/documents/:id/submit` handler and before `export default tesseractTraining;`:

```typescript
interface BoxRow {
  id: number;
  serve_intake_document_id: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  corrected_text: string;
  created_at: string;
}

// GET /api/tesseract-training/documents/:id/boxes
tesseractTraining.get('/documents/:id/boxes', async (c) => {
  if (!requireAdminManager(c)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const db = getDb(c.env);
  const boxes = await query<BoxRow>(
    db,
    `SELECT id, serve_intake_document_id, x0, y0, x1, y1, corrected_text, created_at
       FROM tesseract_box_annotations WHERE serve_intake_document_id = ? ORDER BY created_at ASC`,
    id,
  );
  return c.json({ boxes });
});

// POST /api/tesseract-training/documents/:id/boxes
// Body: { x0, y0, x1, y1, corrected_text }
tesseractTraining.post('/documents/:id/boxes', async (c) => {
  if (!requireAdminManager(c)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  const user = c.get('user');
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);

  let body: { x0?: number; y0?: number; x1?: number; y1?: number; corrected_text?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const { x0, y0, x1, y1 } = body;
  const correctedText = (body.corrected_text ?? '').trim();
  if (
    typeof x0 !== 'number' || typeof y0 !== 'number' ||
    typeof x1 !== 'number' || typeof y1 !== 'number' ||
    !correctedText
  ) {
    return c.json({ error: 'x0, y0, x1, y1, and corrected_text are all required' }, 400);
  }

  const db = getDb(c.env);
  const result = await execute(
    db,
    `INSERT INTO tesseract_box_annotations (serve_intake_document_id, x0, y0, x1, y1, corrected_text, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id, x0, y0, x1, y1, correctedText, user.id,
  );
  return c.json({ success: true, id: result.meta.last_row_id });
});

// DELETE /api/tesseract-training/documents/:id/boxes/:boxId
tesseractTraining.delete('/documents/:id/boxes/:boxId', async (c) => {
  if (!requireAdminManager(c)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  const boxId = parseInt(c.req.param('boxId'), 10);
  if (isNaN(boxId)) return c.json({ error: 'Invalid boxId' }, 400);
  const db = getDb(c.env);
  await execute(db, `DELETE FROM tesseract_box_annotations WHERE id = ?`, boxId);
  return c.json({ success: true });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tesseractBoxAnnotations.test.ts`
Expected: PASS, all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/routes/tesseractTraining.ts tests/tesseractBoxAnnotations.test.ts
git commit -m "feat(tesseract): add box-annotation CRUD routes"
```

---

### Task 4: Backend routes — review notes (get/put)

**Files:**
- Modify: `src/routes/tesseractTraining.ts`
- Test: `tests/tesseractReviewNotes.test.ts`

**Interfaces:**
- Consumes: same helpers as Task 3.
- Produces: `GET /api/tesseract-training/documents/:id/notes`, `PUT /api/tesseract-training/documents/:id/notes` — consumed by Task 7's frontend.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/tesseractReviewNotes.test.ts
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import tesseractTrainingRouter from '../src/routes/tesseractTraining';

function makeDb(opts: { note?: { serve_intake_document_id: number; strokes_json: string } | null } = {}) {
  let note = opts.note ?? null;

  const prepare = (sql: string) => {
    let boundArgs: any[] = [];
    const stmt: any = {
      bind: (...args: any[]) => { boundArgs = args; return stmt; },
      first: async () => {
        if (/FROM tesseract_review_annotations WHERE serve_intake_document_id/.test(sql)) {
          const docId = boundArgs[0];
          return note && note.serve_intake_document_id === docId ? note : null;
        }
        return null;
      },
      all: async () => ({ results: [] }),
      run: async () => {
        if (/INSERT INTO tesseract_review_annotations/.test(sql) || /INSERT OR REPLACE INTO tesseract_review_annotations/.test(sql)) {
          const [docId, strokesJson] = boundArgs;
          note = { serve_intake_document_id: docId, strokes_json: strokesJson };
        }
        return { meta: { changes: 1 } };
      },
    };
    return stmt;
  };

  return { prepare, _getNote: () => note };
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

describe('tesseract review notes', () => {
  test('GET /documents/:id/notes returns null when none saved yet', async () => {
    const app = makeApp('admin');
    const res = await app.request('/documents/5/notes', {}, { DB: makeDb() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.strokes).toBeNull();
  });

  test('PUT /documents/:id/notes saves the strokes layer, GET returns it', async () => {
    const app = makeApp('manager');
    const db = makeDb();
    const strokes = [{ tool: 'arrow', points: [[1, 2], [3, 4]], color: 'red' }];
    const putRes = await app.request('/documents/5/notes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strokes }),
    }, { DB: db });
    expect(putRes.status).toBe(200);

    const getRes = await app.request('/documents/5/notes', {}, { DB: db });
    const body = await getRes.json() as any;
    expect(body.strokes).toEqual(strokes);
  });

  test('PUT /documents/:id/notes returns 403 for a non-admin/manager role', async () => {
    const app = makeApp('officer');
    const res = await app.request('/documents/5/notes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strokes: [] }),
    }, { DB: makeDb() });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tesseractReviewNotes.test.ts`
Expected: FAIL — routes don't exist yet.

- [ ] **Step 3: Implement the routes**

Add to `src/routes/tesseractTraining.ts`, after the box-annotation routes from Task 3:

```typescript
// GET /api/tesseract-training/documents/:id/notes
tesseractTraining.get('/documents/:id/notes', async (c) => {
  if (!requireAdminManager(c)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const db = getDb(c.env);
  const row = await queryFirst<{ strokes_json: string }>(
    db,
    `SELECT strokes_json FROM tesseract_review_annotations WHERE serve_intake_document_id = ?`,
    id,
  );
  return c.json({ strokes: row ? JSON.parse(row.strokes_json) : null });
});

// PUT /api/tesseract-training/documents/:id/notes
// Body: { strokes: Array<{ tool: string; points: number[][]; color: string }> }
// Review notes only — NEVER read by any training path (see migration 0233
// header comment). Whole layer replaced on each save.
tesseractTraining.put('/documents/:id/notes', async (c) => {
  if (!requireAdminManager(c)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  const user = c.get('user');
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);

  let body: { strokes?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  if (!Array.isArray(body.strokes)) {
    return c.json({ error: 'strokes must be an array' }, 400);
  }

  const db = getDb(c.env);
  await execute(
    db,
    `INSERT INTO tesseract_review_annotations (serve_intake_document_id, strokes_json, updated_by)
     VALUES (?, ?, ?)
     ON CONFLICT(serve_intake_document_id) DO UPDATE SET
       strokes_json = excluded.strokes_json,
       updated_by = excluded.updated_by,
       updated_at = datetime('now')`,
    id, JSON.stringify(body.strokes), user.id,
  );
  return c.json({ success: true });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tesseractReviewNotes.test.ts`
Expected: PASS, all 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/routes/tesseractTraining.ts tests/tesseractReviewNotes.test.ts
git commit -m "feat(tesseract): add review-notes get/put routes"
```

---

### Task 5: Feature flag — `tesseract_ocr_primary` (server + client)

**Files:**
- Modify: `src/routes/adminDev.ts`
- Modify: `client/src/context/FeatureFlagsContext.tsx`
- Modify: `client/src/pages/admin/AdminDevSettingsTab.tsx`
- Test: `tests/adminDevFeatureFlags.test.ts` (extend if it exists, else create)

**Interfaces:**
- Produces: `loadFlags()` exported from `src/routes/adminDev.ts` (for Task 6 to read `tesseract_ocr_primary` server-side), and the flag surfaced in the existing admin toggle UI (no new UI code needed — `AdminDevSettingsTab.tsx` renders generically from `FLAG_LABELS`).

- [ ] **Step 1: Check for an existing feature-flags test file**

```bash
find tests -iname "*adminDev*" -o -iname "*featureFlag*"
```
If one exists, read it and extend it in Step 4 below instead of creating a new file — follow its existing mock pattern.

- [ ] **Step 2: Add the flag to the server default set and export `loadFlags`**

In `src/routes/adminDev.ts`, change:
```typescript
const DEFAULT_FLAGS = {
  draw: true,
  annotations: true,
  gps_replay: true,
  nav_overlay: true,
  buildings_3d: true,
  buffer_rings: true,
  ruler: true,
  minimap: true,
  dev_diagnostics: false,
} as const;

type FlagKey = keyof typeof DEFAULT_FLAGS;
```
to:
```typescript
export const DEFAULT_FLAGS = {
  draw: true,
  annotations: true,
  gps_replay: true,
  nav_overlay: true,
  buildings_3d: true,
  buffer_rings: true,
  ruler: true,
  minimap: true,
  dev_diagnostics: false,
  // Gates the Tesseract-primary OCR leg in src/routes/serveIntake.ts.
  // Default OFF: no fine-tuned model exists yet and no A/B benchmark has
  // been reviewed. Flip only after a human reviews scripts/serve-intake-vision-ab.ts
  // results — see docs/superpowers/specs/2026-08-09-tesseract-ocr-learning-production-design.md.
  tesseract_ocr_primary: false,
} as const;

export type FlagKey = keyof typeof DEFAULT_FLAGS;
```
Then change the module-private `loadFlags` to be exported:
```typescript
export async function loadFlags(kv: KVNamespace): Promise<Record<FlagKey, boolean>> {
```
(was `async function loadFlags(...)` — just add `export`.)

- [ ] **Step 3: Mirror the flag on the client**

In `client/src/context/FeatureFlagsContext.tsx`:
```typescript
export interface FeatureFlags {
  draw: boolean;
  annotations: boolean;
  gps_replay: boolean;
  nav_overlay: boolean;
  buildings_3d: boolean;
  buffer_rings: boolean;
  ruler: boolean;
  minimap: boolean;
  dev_diagnostics: boolean;
  tesseract_ocr_primary: boolean;
}

const DEFAULT_FLAGS: FeatureFlags = {
  draw: true,
  annotations: true,
  gps_replay: true,
  nav_overlay: true,
  buildings_3d: true,
  buffer_rings: true,
  ruler: true,
  minimap: true,
  dev_diagnostics: false,
  tesseract_ocr_primary: false,
};
```

In `client/src/pages/admin/AdminDevSettingsTab.tsx`:
```typescript
const FLAG_LABELS: Record<keyof FeatureFlags, string> = {
  draw: 'Draw Geofence',
  annotations: 'Annotations',
  gps_replay: 'GPS Replay',
  nav_overlay: 'Nav Overlay',
  buildings_3d: '3D Buildings',
  buffer_rings: 'Buffer Rings',
  ruler: 'Ruler',
  minimap: 'Minimap',
  dev_diagnostics: 'Dev Diagnostics',
  tesseract_ocr_primary: 'Tesseract OCR Primary (Serve Intake)',
};
```
`FLAG_LABELS` is typed `Record<keyof FeatureFlags, string>`, so `tsc` will refuse to compile if this entry is missing — that's the safety net for this step.

- [ ] **Step 4: Write/extend the test**

If no existing file, create `tests/adminDevFeatureFlags.test.ts`:
```typescript
import { describe, test, expect } from 'vitest';
import { Hono } from 'hono';
import adminDevRouter from '../src/routes/adminDev';
import { DEFAULT_FLAGS } from '../src/routes/adminDev';

function makeKv(initial?: Record<string, boolean>) {
  const store = new Map<string, string>();
  if (initial) store.set('feature_flags', JSON.stringify(initial));
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => { store.set(key, value); },
  };
}

function makeApp(role: string) {
  const app = new Hono<{ Bindings: any; Variables: any }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 1, username: 'tester', role, full_name: 'Test' });
    await next();
  });
  app.route('/', adminDevRouter);
  return app;
}

describe('tesseract_ocr_primary feature flag', () => {
  test('defaults to false', async () => {
    const app = makeApp('admin');
    const res = await app.request('/feature-flags', {}, { KV: makeKv() });
    const body = await res.json() as any;
    expect(body.tesseract_ocr_primary).toBe(false);
  });

  test('DEFAULT_FLAGS export includes the key set to false', () => {
    expect(DEFAULT_FLAGS.tesseract_ocr_primary).toBe(false);
  });

  test('admin can flip it on via PUT', async () => {
    const app = makeApp('admin');
    const kv = makeKv();
    const putRes = await app.request('/feature-flags', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tesseract_ocr_primary: true }),
    }, { KV: kv });
    expect(putRes.status).toBe(200);
    const getRes = await app.request('/feature-flags', {}, { KV: kv });
    const body = await getRes.json() as any;
    expect(body.tesseract_ocr_primary).toBe(true);
  });
});
```

- [ ] **Step 5: Run tests, typecheck both trees**

```bash
npx vitest run tests/adminDevFeatureFlags.test.ts
npm run typecheck
cd client && npx tsc --noEmit
```
Expected: all pass. The `tsc --noEmit` runs are the real gate here — they'll fail loudly if `FLAG_LABELS` or `FeatureFlags` is missing the new key anywhere.

- [ ] **Step 6: Commit**

```bash
git add src/routes/adminDev.ts client/src/context/FeatureFlagsContext.tsx client/src/pages/admin/AdminDevSettingsTab.tsx tests/adminDevFeatureFlags.test.ts
git commit -m "feat(tesseract): add tesseract_ocr_primary feature flag, default off"
```

---

### Task 6: Gated Tesseract OCR leg in Serve Intake

**Files:**
- Modify: `src/routes/serveIntake.ts` (lines ~313, ~541, ~1451 per current line numbers — verify with `grep -n "ocrImage(c.env" src/routes/serveIntake.ts` before editing, since earlier tasks may have shifted lines)
- Test: `test-workers/tesseractOcrLeg.test.ts` (Miniflare — this touches `@cloudflare/containers`, so it needs the Miniflare suite, not plain Node vitest, per CLAUDE.md's test-suite split)

**Interfaces:**
- Consumes: `loadFlags` (exported in Task 5), `ocrImage`/`ocrText` from `serveIntakeOcr.ts` (existing), `getContainer` from `@cloudflare/containers` (already imported in this file).
- Produces: `ocrImageWithTesseractGate(env, bytes, mime)` — same signature and return type (`Promise<ExtractionResult>`) as the existing `ocrImage()`, used as its drop-in replacement at all three call sites.

- [ ] **Step 1: Confirm current call-site line numbers**

```bash
grep -n "ocrImage(c.env" src/routes/serveIntake.ts
```
Note the three matching line numbers before editing — Tasks 1-5 didn't touch this file, so they should still be at (or near) lines 313, 541, 1451, but confirm rather than assume.

- [ ] **Step 2: Add the import for `loadFlags`**

At the top of `src/routes/serveIntake.ts`, alongside the existing `import { withTimeout, ocrImage, ocrText } from '../utils/serveIntakeOcr';` line, add:
```typescript
import { loadFlags } from './adminDev';
```

- [ ] **Step 3: Write the gate wrapper function**

Add this function in `src/routes/serveIntake.ts`, near the top of the file after the existing imports (before the first route handler) — it needs to sit in this file specifically because it calls `getContainer`, which this file already imports at module scope (see Global Constraints — `serveIntakeOcr.ts` must stay container-import-free):

```typescript
const TESSERACT_CONTAINER_NAME = 'shared'; // matches src/routes/tesseractOcr.ts's CONTAINER_NAME

// Tesseract-first OCR leg, gated behind the tesseract_ocr_primary feature
// flag (default OFF — see src/routes/adminDev.ts DEFAULT_FLAGS). When
// enabled, calls the self-hosted Tesseract container for raw text, then
// runs that text through the SAME Claude-first/Workers-AI-fallback field
// extraction as every other text-based leg (ocrText) — Tesseract only
// replaces the OCR step, not field extraction. Falls back to the existing
// Claude-vision -> Workers-AI-vision chain (ocrImage) on ANY container
// error, exactly like every other leg in this pipeline degrades rather
// than failing the request.
async function ocrImageWithTesseractGate(
  env: Env['Bindings'], bytes: Uint8Array, mime: string,
): Promise<ExtractionResult> {
  let tesseractEnabled = false;
  try {
    const flags = await loadFlags(env.KV);
    tesseractEnabled = flags.tesseract_ocr_primary;
  } catch {
    tesseractEnabled = false; // KV read failure must not block OCR — fall through to the existing chain
  }

  if (tesseractEnabled) {
    try {
      const form = new FormData();
      form.append('image', new Blob([bytes], { type: mime }), 'input');
      const container = getContainer(env.TESSERACT_OCR, TESSERACT_CONTAINER_NAME);
      const res = await container.fetch(new Request('http://container/ocr', { method: 'POST', body: form }));
      if (res.ok) {
        const body = await res.json() as { text?: string };
        const text = (body.text ?? '').trim();
        if (text.length >= 20) {
          const extraction = await ocrText(env, text);
          if (extraction.success) {
            return { ...extraction, model: `tesseract+${extraction.model}` };
          }
        }
      }
    } catch {
      // Container unreachable, timed out, or returned unusable text — fall
      // through to the existing chain below, same as every other leg here.
    }
  }

  return ocrImage(env, bytes, mime);
}
```

- [ ] **Step 4: Replace the three call sites**

Replace each of the three `ocrImage(c.env, bytes, file.type)` / `ocrImage(c.env, bytes, doc.file_type)` calls (confirmed in Step 1) with `ocrImageWithTesseractGate(c.env, bytes, file.type)` (or `doc.file_type` at the third site) — same arguments, just the function name changes. Leave the surrounding `ocrEngine = extraction.model.startsWith('claude') ? 'claude-vision' : 'workers-ai-vision'` lines as-is; a Tesseract-produced result's `model` field starts with `tesseract+`, so it falls through to `'workers-ai-vision'` today. This is acceptable for this plan (the spec's non-goal boundary — mislabeling engine analytics is not blocking) but flag it in the commit message so a future task can add a proper `'tesseract'` branch to that label logic.

- [ ] **Step 5: Write the Miniflare test**

```typescript
// test-workers/tesseractOcrLeg.test.ts
import { describe, test, expect, vi } from 'vitest';
import { unstable_dev } from 'wrangler';
// Follow the exact setup pattern already used in test-workers/health.test.ts
// or test-workers/auth.test.ts for unstable_dev config — read one of those
// files first and copy its worker-startup boilerplate verbatim, then add:

describe('Tesseract OCR gate', () => {
  test('flag OFF (default) never calls the Tesseract container', async () => {
    // With tesseract_ocr_primary absent/false in KV, upload an image via
    // POST /api/serve-intake/upload and assert the response's document
    // ocr_engine is 'claude-vision' or 'workers-ai-vision' — never
    // starts with 'tesseract'. This is the regression guard for the
    // "default OFF" constraint in this plan's Global Constraints.
  });
});
```
Read `test-workers/health.test.ts` in full before writing this — it has the exact `unstable_dev`/Miniflare bootstrap this new test needs (binding mocks for `DB`, `KV`, `UPLOADS`, auth token minting for an admin/manager test user). Complete the test body using that file's established helpers rather than reinventing them.

- [ ] **Step 6: Run the Miniflare suite**

```bash
npm run test:worker
```
Expected: PASS, including the new test.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
git add src/routes/serveIntake.ts test-workers/tesseractOcrLeg.test.ts
git commit -m "feat(tesseract): gated Tesseract-primary OCR leg, default off

Adds ocrImageWithTesseractGate() as a drop-in replacement for ocrImage()
at all three Serve Intake OCR call sites. Reads tesseract_ocr_primary
from the existing feature_flags KV mechanism; falls back to the
existing Claude-vision -> Workers-AI chain on any container error or
when the flag is off (the default). Does not flip the flag."
```

---

### Task 7: Rebuild `TesseractTrainingPage.tsx` — mode toggle + Boxes canvas

**Files:**
- Modify: `client/src/pages/TesseractTrainingPage.tsx`
- Create: `client/src/utils/tesseractImageCoords.ts`
- Test: `client/tests/tesseractImageCoords.test.ts`

**Interfaces:**
- Consumes: `apiFetch`, `authedImageUrl` (existing), the box routes from Task 3.
- Produces: `imageToNaturalCoords(displayRect, naturalWidth, naturalHeight, point)` pure function, unit-tested independently of the canvas UI.

- [ ] **Step 1: Write the failing coordinate-conversion test**

```typescript
// client/tests/tesseractImageCoords.test.ts
import { describe, test, expect } from 'vitest';
import { imageToNaturalCoords } from '../src/utils/tesseractImageCoords';

describe('imageToNaturalCoords', () => {
  test('identity when displayed at natural size', () => {
    const rect = { left: 0, top: 0, width: 800, height: 600 };
    const result = imageToNaturalCoords(rect, 800, 600, { x: 400, y: 300 });
    expect(result).toEqual({ x: 400, y: 300 });
  });

  test('scales up when displayed smaller than natural size', () => {
    // Image is natively 1600x1200 but rendered at 800x600 (half scale).
    const rect = { left: 0, top: 0, width: 800, height: 600 };
    const result = imageToNaturalCoords(rect, 1600, 1200, { x: 400, y: 300 });
    expect(result).toEqual({ x: 800, y: 600 });
  });

  test('accounts for the rect offset (image not at page origin)', () => {
    const rect = { left: 50, top: 20, width: 800, height: 600 };
    const result = imageToNaturalCoords(rect, 800, 600, { x: 450, y: 320 });
    // Point at (450,320) in PAGE coordinates, minus the (50,20) offset,
    // is (400,300) in the image's own display coordinates.
    expect(result).toEqual({ x: 400, y: 300 });
  });

  test('clamps out-of-bounds points to the image edges', () => {
    const rect = { left: 0, top: 0, width: 800, height: 600 };
    expect(imageToNaturalCoords(rect, 800, 600, { x: -10, y: 900 })).toEqual({ x: 0, y: 600 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run tests/tesseractImageCoords.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the conversion function**

```typescript
// client/src/utils/tesseractImageCoords.ts
export interface DisplayRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Converts a page-coordinate point (e.g. from a pointer event) into the
 * image's OWN natural pixel space, accounting for the image's on-page
 * position/size (displayRect, typically from getBoundingClientRect())
 * and its natural (unscaled) dimensions (naturalWidth/naturalHeight).
 * Used so box annotations drawn on a scaled/responsive <img> are stored
 * in coordinates meaningful against the original document image.
 */
export function imageToNaturalCoords(
  displayRect: DisplayRect,
  naturalWidth: number,
  naturalHeight: number,
  point: Point,
): Point {
  const localX = point.x - displayRect.left;
  const localY = point.y - displayRect.top;
  const scaleX = naturalWidth / displayRect.width;
  const scaleY = naturalHeight / displayRect.height;
  const x = Math.round(Math.min(Math.max(localX * scaleX, 0), naturalWidth));
  const y = Math.round(Math.min(Math.max(localY * scaleY, 0), naturalHeight));
  return { x, y };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run tests/tesseractImageCoords.test.ts`
Expected: PASS, all 4 tests.

- [ ] **Step 5: Rebuild the page component with a mode toggle and Boxes canvas**

Replace the full contents of `client/src/pages/TesseractTrainingPage.tsx`:

```tsx
import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch, authedImageUrl } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import { imageToNaturalCoords } from '../utils/tesseractImageCoords';

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

interface BoxAnnotation {
  id: number;
  x0: number; y0: number; x1: number; y1: number;
  corrected_text: string;
}

type Mode = 'text' | 'boxes' | 'notes';

export default function TesseractTrainingPage() {
  const [rows, setRows] = useState<DocRow[]>([]);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<DocDetail | null>(null);
  const [groundTruth, setGroundTruth] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('text');

  const [boxes, setBoxes] = useState<BoxAnnotation[]>([]);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawRect, setDrawRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [pendingBoxText, setPendingBoxText] = useState('');
  const imgRef = useRef<HTMLImageElement>(null);

  const loadList = useCallback(() => {
    apiFetch<{ rows: DocRow[] }>(`/tesseract-training/documents?page=${page}`)
      .then((res) => setRows(res.rows))
      .catch(console.error);
  }, [page]);

  useEffect(() => { loadList(); }, [loadList]);

  useEffect(() => {
    if (selectedId == null) { setDetail(null); return; }
    apiFetch<DocDetail>(`/tesseract-training/documents/${selectedId}`)
      .then((d) => { setDetail(d); setGroundTruth(d.raw_text ?? ''); setSubmitError(null); })
      .catch(console.error);
  }, [selectedId]);

  const loadBoxes = useCallback(() => {
    if (selectedId == null) return;
    apiFetch<{ boxes: BoxAnnotation[] }>(`/tesseract-training/documents/${selectedId}/boxes`)
      .then((res) => setBoxes(res.boxes))
      .catch(console.error);
  }, [selectedId]);

  useEffect(() => { if (mode === 'boxes') loadBoxes(); }, [mode, loadBoxes]);

  const handleSubmit = async () => {
    if (selectedId == null) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await apiFetch(`/tesseract-training/documents/${selectedId}/submit`, {
        method: 'POST',
        body: JSON.stringify({ ground_truth_text: groundTruth }),
      });
      setSelectedId(null);
      loadList();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const p = imageToNaturalCoords(rect, imgRef.current.naturalWidth, imgRef.current.naturalHeight, { x: e.clientX, y: e.clientY });
    setDrawStart(p);
    setDrawRect({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drawStart || !imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const p = imageToNaturalCoords(rect, imgRef.current.naturalWidth, imgRef.current.naturalHeight, { x: e.clientX, y: e.clientY });
    setDrawRect({
      x0: Math.min(drawStart.x, p.x), y0: Math.min(drawStart.y, p.y),
      x1: Math.max(drawStart.x, p.x), y1: Math.max(drawStart.y, p.y),
    });
  };

  const handleCanvasPointerUp = () => {
    setDrawStart(null);
    // drawRect stays set — the inline text input below the image commits it.
  };

  const commitBox = async () => {
    if (!drawRect || selectedId == null || !pendingBoxText.trim()) return;
    await apiFetch(`/tesseract-training/documents/${selectedId}/boxes`, {
      method: 'POST',
      body: JSON.stringify({ ...drawRect, corrected_text: pendingBoxText.trim() }),
    });
    setDrawRect(null);
    setPendingBoxText('');
    loadBoxes();
  };

  const deleteBox = async (boxId: number) => {
    if (selectedId == null) return;
    await apiFetch(`/tesseract-training/documents/${selectedId}/boxes/${boxId}`, { method: 'DELETE' });
    loadBoxes();
  };

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="TESSERACT TRAINING SETUP" />
      <div className="flex gap-4">
        <div className="w-1/3 space-y-2">
          {rows.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelectedId(r.id)}
              className={`block w-full text-left p-2 text-[11px] border ${r.already_in_corpus ? 'opacity-50' : ''}`}
            >
              {r.file_name} {r.already_in_corpus ? '(already labeled)' : ''}
            </button>
          ))}
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</button>
            <button onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        </div>
        <div className="w-2/3">
          {detail && (
            <div className="space-y-2">
              <div className="flex gap-2 border-b border-surface-border">
                {(['text', 'boxes', 'notes'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`px-3 py-1 text-[11px] uppercase ${mode === m ? 'border-b-2 border-brand-400 text-brand-300' : 'text-rmpg-500'}`}
                  >
                    {m}
                  </button>
                ))}
              </div>

              {mode === 'text' && (
                <>
                  <img
                    src={authedImageUrl(`/api/tesseract-training/documents/${detail.id}/image`)}
                    alt={detail.file_name}
                    className="max-w-full border"
                  />
                  <textarea
                    value={groundTruth}
                    onChange={(e) => setGroundTruth(e.target.value)}
                    rows={12}
                    className="w-full border p-2 text-[11px] font-mono"
                  />
                  {submitError && <p className="text-[11px] text-red-500">{submitError}</p>}
                  <button
                    onClick={handleSubmit}
                    disabled={submitting || detail.already_in_corpus}
                    className="px-3 py-1 border"
                  >
                    {detail.already_in_corpus ? 'Already Submitted' : 'Submit to Training Corpus'}
                  </button>
                </>
              )}

              {mode === 'boxes' && (
                <div className="space-y-2">
                  <p className="text-[11px] text-rmpg-500">
                    Drag a box over a word or line, then type its correct text below.
                    These boxes become real Tesseract training data.
                  </p>
                  <div
                    className="relative inline-block"
                    onPointerDown={handleCanvasPointerDown}
                    onPointerMove={handleCanvasPointerMove}
                    onPointerUp={handleCanvasPointerUp}
                  >
                    <img
                      ref={imgRef}
                      src={authedImageUrl(`/api/tesseract-training/documents/${detail.id}/image`)}
                      alt={detail.file_name}
                      className="max-w-full border block"
                    />
                    <svg className="absolute top-0 left-0 w-full h-full pointer-events-none">
                      {boxes.map((b) => (
                        <rect
                          key={b.id}
                          x={`${(b.x0 / (imgRef.current?.naturalWidth || 1)) * 100}%`}
                          y={`${(b.y0 / (imgRef.current?.naturalHeight || 1)) * 100}%`}
                          width={`${((b.x1 - b.x0) / (imgRef.current?.naturalWidth || 1)) * 100}%`}
                          height={`${((b.y1 - b.y0) / (imgRef.current?.naturalHeight || 1)) * 100}%`}
                          fill="none" stroke="lime" strokeWidth={2}
                        />
                      ))}
                      {drawRect && (
                        <rect
                          x={`${(drawRect.x0 / (imgRef.current?.naturalWidth || 1)) * 100}%`}
                          y={`${(drawRect.y0 / (imgRef.current?.naturalHeight || 1)) * 100}%`}
                          width={`${((drawRect.x1 - drawRect.x0) / (imgRef.current?.naturalWidth || 1)) * 100}%`}
                          height={`${((drawRect.y1 - drawRect.y0) / (imgRef.current?.naturalHeight || 1)) * 100}%`}
                          fill="none" stroke="yellow" strokeWidth={2}
                        />
                      )}
                    </svg>
                  </div>
                  {drawRect && (
                    <div className="flex gap-2">
                      <input
                        value={pendingBoxText}
                        onChange={(e) => setPendingBoxText(e.target.value)}
                        placeholder="Correct text for this region"
                        className="flex-1 border p-1 text-[11px]"
                      />
                      <button onClick={commitBox} className="px-3 py-1 border">Save Box</button>
                      <button onClick={() => { setDrawRect(null); setPendingBoxText(''); }} className="px-3 py-1 border">Cancel</button>
                    </div>
                  )}
                  <ul className="space-y-1">
                    {boxes.map((b) => (
                      <li key={b.id} className="flex justify-between text-[11px] border p-1">
                        <span>{b.corrected_text}</span>
                        <button onClick={() => deleteBox(b.id)} className="text-red-500">Delete</button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {mode === 'notes' && (
                <p className="text-[11px] text-rmpg-500">Notes mode implemented in the next task.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Typecheck**

```bash
cd client && npx tsc --noEmit
```
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/TesseractTrainingPage.tsx client/src/utils/tesseractImageCoords.ts client/tests/tesseractImageCoords.test.ts
git commit -m "feat(tesseract): add Boxes annotation mode to the training page"
```

---

### Task 8: Notes (free-form annotation) mode

**Files:**
- Modify: `client/src/pages/TesseractTrainingPage.tsx`

**Interfaces:**
- Consumes: `GET`/`PUT /documents/:id/notes` (Task 4).
- Produces: complete Notes mode UI — no further tasks depend on this one.

- [ ] **Step 1: Add stroke state and drawing handlers**

In `client/src/pages/TesseractTrainingPage.tsx`, add near the other `useState` calls:

```tsx
  interface Stroke { tool: 'arrow' | 'circle' | 'highlight'; points: [number, number][]; color: string }
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [activeTool, setActiveTool] = useState<Stroke['tool']>('highlight');
  const [drawingStroke, setDrawingStroke] = useState<Stroke | null>(null);
  const [notesDirty, setNotesDirty] = useState(false);
```

Add a loader alongside `loadBoxes`:

```tsx
  const loadNotes = useCallback(() => {
    if (selectedId == null) return;
    apiFetch<{ strokes: Stroke[] | null }>(`/tesseract-training/documents/${selectedId}/notes`)
      .then((res) => { setStrokes(res.strokes ?? []); setNotesDirty(false); })
      .catch(console.error);
  }, [selectedId]);

  useEffect(() => { if (mode === 'notes') loadNotes(); }, [mode, loadNotes]);
```

- [ ] **Step 2: Replace the Notes-mode placeholder block**

Replace:
```tsx
              {mode === 'notes' && (
                <p className="text-[11px] text-rmpg-500">Notes mode implemented in the next task.</p>
              )}
```
with:
```tsx
              {mode === 'notes' && (
                <div className="space-y-2">
                  <p className="text-[11px] text-rmpg-500">
                    Free-form marks for human reviewers only — never used for training.
                  </p>
                  <div className="flex gap-2">
                    {(['highlight', 'circle', 'arrow'] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => setActiveTool(t)}
                        className={`px-2 py-1 text-[11px] border ${activeTool === t ? 'bg-surface-raised' : ''}`}
                      >
                        {t}
                      </button>
                    ))}
                    <button
                      onClick={async () => {
                        if (selectedId == null) return;
                        await apiFetch(`/tesseract-training/documents/${selectedId}/notes`, {
                          method: 'PUT',
                          body: JSON.stringify({ strokes }),
                        });
                        setNotesDirty(false);
                      }}
                      disabled={!notesDirty}
                      className="px-2 py-1 text-[11px] border ml-auto"
                    >
                      Save Notes
                    </button>
                  </div>
                  <div
                    className="relative inline-block"
                    onPointerDown={(e) => {
                      if (!imgRef.current) return;
                      const rect = imgRef.current.getBoundingClientRect();
                      const p = imageToNaturalCoords(rect, imgRef.current.naturalWidth, imgRef.current.naturalHeight, { x: e.clientX, y: e.clientY });
                      setDrawingStroke({ tool: activeTool, points: [[p.x, p.y]], color: '#f59e0b' });
                    }}
                    onPointerMove={(e) => {
                      if (!drawingStroke || !imgRef.current) return;
                      const rect = imgRef.current.getBoundingClientRect();
                      const p = imageToNaturalCoords(rect, imgRef.current.naturalWidth, imgRef.current.naturalHeight, { x: e.clientX, y: e.clientY });
                      setDrawingStroke({ ...drawingStroke, points: [...drawingStroke.points, [p.x, p.y]] });
                    }}
                    onPointerUp={() => {
                      if (drawingStroke) {
                        setStrokes((prev) => [...prev, drawingStroke]);
                        setNotesDirty(true);
                      }
                      setDrawingStroke(null);
                    }}
                  >
                    <img
                      ref={imgRef}
                      src={authedImageUrl(`/api/tesseract-training/documents/${detail.id}/image`)}
                      alt={detail.file_name}
                      className="max-w-full border block"
                    />
                    <svg className="absolute top-0 left-0 w-full h-full pointer-events-none">
                      {[...strokes, ...(drawingStroke ? [drawingStroke] : [])].map((s, i) => (
                        <polyline
                          key={i}
                          points={s.points.map(([x, y]) => `${(x / (imgRef.current?.naturalWidth || 1)) * 100}%,${(y / (imgRef.current?.naturalHeight || 1)) * 100}%`).join(' ')}
                          fill="none" stroke={s.color} strokeWidth={3} strokeLinecap="round"
                        />
                      ))}
                    </svg>
                  </div>
                </div>
              )}
```

- [ ] **Step 3: Typecheck**

```bash
cd client && npx tsc --noEmit
```
Expected: no new errors. (SVG `points` percentage strings are valid per SVG spec; this matches the existing Boxes mode's percentage-based rendering approach from Task 7.)

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/TesseractTrainingPage.tsx
git commit -m "feat(tesseract): add Notes free-form annotation mode"
```

---

### Task 9: AdminPage tab wiring

**Files:**
- Modify: `client/src/pages/AdminPage.tsx`

**Interfaces:**
- Consumes: `TesseractTrainingPage` (default export, existing import path `../pages/TesseractTrainingPage` — confirm this relative path from `AdminPage.tsx`'s own location, which is also under `client/src/pages/`, so the import is `./TesseractTrainingPage`).
- Produces: nothing consumed by later tasks — this is a leaf integration point.

- [ ] **Step 1: Add the import**

Near the top of `client/src/pages/AdminPage.tsx`, alongside the other tab-component imports:
```tsx
import TesseractTrainingPage from './TesseractTrainingPage';
```

- [ ] **Step 2: Add `ScanText` to the lucide-react import**

Find the multi-line `import { ... } from 'lucide-react';` block (starts around line 3) and add `ScanText` to the list of named imports.

- [ ] **Step 3: Edit 1 of 4 — `TabId` union**

Add `'ocr_learning'` to the `TabId` union type (line ~262):
```tsx
type TabId = 'users' | 'clients' | ... | 'kiosk_devices' | 'ocr_learning';
```

- [ ] **Step 4: Edit 2 of 4 — `VALID_TABS` array**

Add `'ocr_learning'` to the `VALID_TABS` array (line ~289):
```tsx
const VALID_TABS = [..., 'kiosk_devices', 'ocr_learning'];
```

- [ ] **Step 5: Edit 3 of 4 — tab config array**

In the `Integrations` category's `tabs` array (where `'training'` already sits, around line 764), add:
```tsx
        { id: 'ocr_learning', label: 'Tesseract OCR Learning', icon: ScanText },
```

- [ ] **Step 6: Edit 4 of 4 — render block**

Alongside the existing `{activeTab === 'training' && (...)}` block (around line 1269), add:
```tsx
        {activeTab === 'ocr_learning' && <TesseractTrainingPage />}
```

- [ ] **Step 7: Typecheck**

```bash
cd client && npx tsc --noEmit
```
Expected: no new errors — this is exactly the check that catches a missed edit among the four (CLAUDE.md gotcha #16).

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/AdminPage.tsx
git commit -m "feat(tesseract): add Tesseract OCR Learning tab to AdminPage"
```

---

### Task 10: Serve Intake — OCR Learning button + Enforcement tab

**Files:**
- Modify: `client/src/pages/ServeIntakePage.tsx`

**Interfaces:**
- Consumes: `useAuth` (already imported), `useNavigate` (already imported).
- Produces: nothing consumed by later tasks — leaf integration point.

- [ ] **Step 1: Extend the tab union and add navigation**

Change the existing tab state declaration (line ~363):
```tsx
  const [activeTab, setActiveTab] = useState<'intake' | 'schedule'>('intake');
```
to:
```tsx
  const [activeTab, setActiveTab] = useState<'intake' | 'schedule' | 'enforcement'>('intake');
```

- [ ] **Step 2: Add the `ScanText` icon import**

In the existing `lucide-react` import line (line 2), add `ScanText` to the list.

- [ ] **Step 3: Add the header launch button**

Locate the `<PanelTitleBar title="Process Service Intake" icon={Upload} />` line (around line 970) and add a role-gated button directly after it:
```tsx
      <PanelTitleBar title="Process Service Intake" icon={Upload} />

      {user && ['admin', 'manager'].includes(user.role) && (
        <button
          onClick={() => navigate('/tesseract-training')}
          className="flex items-center gap-1.5 px-3 py-1 text-[11px] border border-surface-border hover:bg-surface-raised"
        >
          <ScanText size={12} /> OCR Learning
        </button>
      )}
```
Confirm `user` is already available in this component's scope from `useAuth()` (it is — `LiveDlScanner`/other admin-gated UI in this same file already reads `user.role`; grep `const { user }` in this file to find the exact existing destructuring line and reuse it rather than re-calling `useAuth()`).

- [ ] **Step 4: Extend the tab strip**

Change the tab-strip `.map` (around line 986) from:
```tsx
        {(['intake', 'schedule'] as const).map((tab) => (
```
to:
```tsx
        {(['intake', 'schedule', 'enforcement'] as const).map((tab) => (
```
and extend the icon/label ternaries just below it:
```tsx
            {tab === 'intake' ? <Upload size={11} /> : tab === 'schedule' ? <CalendarDays size={11} /> : <ScanText size={11} />}
            {tab === 'intake' ? 'Intake' : tab === 'schedule' ? 'Attempt Schedule' : 'Enforcement'}
```

- [ ] **Step 5: Add the Enforcement tab panel**

After the existing `{activeTab === 'schedule' && (<ServeAttemptCalendar />)}` block, add:
```tsx
      {activeTab === 'enforcement' && (
        <div className="p-4 space-y-3">
          <p className="text-[11px] text-rmpg-500">
            Enforcement tools for Serve Intake.
          </p>
          {user && ['admin', 'manager'].includes(user.role) && (
            <button
              onClick={() => navigate('/tesseract-training')}
              className="flex items-center gap-1.5 px-3 py-1 text-[11px] border border-surface-border hover:bg-surface-raised"
            >
              <ScanText size={12} /> Tesseract OCR Learning
            </button>
          )}
        </div>
      )}
```

- [ ] **Step 6: Guard the intake-only warning banner**

The existing fallback-engine warning banner is already gated with `{activeTab === 'intake' && showFallbackWarning && (...)}` — no change needed there, confirm it still reads correctly with the third tab added (it does, since it explicitly checks `=== 'intake'`).

- [ ] **Step 7: Typecheck**

```bash
cd client && npx tsc --noEmit
```
Expected: no new errors.

- [ ] **Step 8: Manual verification in the browser**

Start the client dev server and confirm: the OCR Learning button appears in the header for an admin/manager test account and navigates to `/tesseract-training`; the Enforcement tab renders with its own sub-button; both are absent for a non-admin/manager role (e.g. `officer`).

- [ ] **Step 9: Commit**

```bash
git add client/src/pages/ServeIntakePage.tsx
git commit -m "feat(tesseract): add OCR Learning button and Enforcement tab to Serve Intake"
```

---

### Task 11: Run the A/B benchmark and report results

**Files:** none modified — this is a measurement task.

**Interfaces:**
- Consumes: the now-verified-working container (Task 1), the existing `scripts/serve-intake-vision-ab.ts` and its `tests/fixtures/serve-intake/vision/` fixture corpus (both pre-existing, from an earlier session).
- Produces: a results report for the user — no code artifact. This task does NOT flip `tesseract_ocr_primary`.

- [ ] **Step 1: Confirm the script's Tesseract candidate points at the now-working route**

```bash
grep -n "runTesseractCustom" -A15 scripts/serve-intake-vision-ab.ts
```
Confirm it calls `/api/tesseract-ocr/ocr` (the route verified live in Task 1) with a valid admin/manager token — read the surrounding auth setup (`RMPG_FLEX_JWT` env var, per this session's prior summary) and confirm that env var is set before running.

- [ ] **Step 2: Run the A/B script**

```bash
RMPG_FLEX_JWT="$TOKEN" npx tsx scripts/serve-intake-vision-ab.ts
```
Capture the full output — per-candidate accuracy/timing across the fixture corpus, including the Tesseract candidate alongside Claude/OpenAI/Workers-AI/GLM.

- [ ] **Step 3: Report to the user, do not act unilaterally**

Summarize the numbers directly to the user: Tesseract's accuracy relative to the other candidates, and its latency. State explicitly that `tesseract_ocr_primary` remains `false` and that flipping it is the user's call. Do not toggle the flag as part of this task regardless of how the numbers look — that decision was explicitly reserved for the user during brainstorming (see Global Constraints).

---

## Self-Review Notes (from plan authoring)

- **Spec coverage:** §1 → Task 1. §2 → Task 2. §3 → Tasks 3-4. §4 → Tasks 7-8. §5 → Task 9. §6 → Task 10. §7 → Task 6 (implementation moved from `serveIntakeOcr.ts` to `serveIntake.ts` — see that task's Architecture note — to preserve the container-import-free constraint the spec itself documents in its own Global Constraints; this is a refinement, not a deviation from the spec's outward behavior). §8 → Task 11.
- **Type consistency:** `ocrImageWithTesseractGate` (Task 6) matches `ocrImage`'s exact signature `(env: Env['Bindings'], bytes: Uint8Array, mime: string): Promise<ExtractionResult>` so it's a true drop-in. `BoxAnnotation` (Task 7 frontend) field names (`x0,y0,x1,y1,corrected_text,id`) match the `BoxRow`/response shape produced by Task 3's backend exactly.
- **Placeholder scan:** no "TBD"/"handle appropriately" language; Task 1's live-verification steps carry concrete commands and concrete conditional fixes for the most likely failure modes rather than an open-ended "investigate."
