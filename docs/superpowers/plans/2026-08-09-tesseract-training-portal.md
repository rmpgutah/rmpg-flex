# Tesseract Training Setup Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admin/manager users browse existing serve-intake documents that already have real OCR output, correct that text into verified ground truth, and submit the pair into the existing `TESSERACT_TRAINING` R2 bucket — building the labeled corpus a future manual `tesstrain` run needs.

**Architecture:** A new Worker route (`src/routes/tesseractTraining.ts`) reuses `serve_intake_documents` (no new upload mechanism) and the exact encrypted-R2 read pattern already proven in `src/routes/serveIntake.ts`'s file-serving route. A new, minimal D1 table tracks which documents have already been submitted. A new standalone client page provides the browse/correct/submit UI.

**Tech Stack:** Hono route (TypeScript), D1, R2 (`UPLOADS` for reading source images, `TESSERACT_TRAINING` for writing labeled pairs), React/TypeScript client page.

## Global Constraints

- Role gate: `['admin', 'manager']` only, matching the convention already established on `src/routes/tesseractOcr.ts`'s `/ocr` endpoint (per spec §2.2) — NOT the broader `INTAKE_ROLES`/`REVIEW_ROLES` used elsewhere in `serveIntake.ts`.
- No new document upload mechanism — only browses/reads existing `serve_intake_documents` rows (spec §3, Non-goals).
- No triggering of the actual `tesstrain` fine-tuning process (spec §3, Non-goals) — this plan's scope ends at "labeled pair written to R2 + tracked in D1."
- Writes to the `TESSERACT_TRAINING` bucket are **plain, unencrypted** objects — matching the existing convention already shipped in `scripts/upload-tesseract-training-pair.ts` (which writes via `wrangler r2 object put` with no client-side encryption). This plan does not introduce envelope encryption for this bucket; it stays consistent with the already-shipped precedent rather than silently changing it.
- D1 tracking-row insert happens only AFTER both R2 objects are confirmed written (spec §2.2, "Write ordering").
- Next free migration number: `0230` (confirmed against current `migrations/` high-water mark, `0229_shift_swap_approval_workflow.sql`).

---

### Task 1: Migration — `tesseract_training_corpus` tracking table

**Files:**
- Create: `migrations/0230_tesseract_training_corpus.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: the `tesseract_training_corpus` table (columns: `id`, `serve_intake_document_id` UNIQUE, `added_by`, `added_at`), which Task 2's route reads/writes by these exact column names.

- [ ] **Step 1: Write the migration**

Create `migrations/0230_tesseract_training_corpus.sql`:

```sql
-- Tracks which serve_intake_documents have already been reviewed, corrected,
-- and submitted as a labeled Tesseract fine-tuning pair (see
-- docs/superpowers/specs/2026-08-09-tesseract-training-portal-design.md).
-- Deliberately minimal — existence of a row here means "already in the
-- TESSERACT_TRAINING R2 corpus," nothing more.
CREATE TABLE IF NOT EXISTS tesseract_training_corpus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  serve_intake_document_id INTEGER NOT NULL UNIQUE,
  added_by INTEGER NOT NULL,
  added_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tesseract_training_corpus_doc
  ON tesseract_training_corpus(serve_intake_document_id);
```

- [ ] **Step 2: Apply locally**

Run: `npm run migrate:local`
Expected: migration applies with no errors.

- [ ] **Step 3: Verify the table exists**

Run: `npx wrangler d1 execute rmpg-flex --local --command "SELECT sql FROM sqlite_master WHERE name='tesseract_training_corpus'"`
Expected: prints the `CREATE TABLE` statement back, confirming it landed.

- [ ] **Step 4: Commit**

```bash
git add migrations/0230_tesseract_training_corpus.sql
git commit -m "feat(tesseract-training): add tesseract_training_corpus tracking migration"
```

---

### Task 2: Backend route (`src/routes/tesseractTraining.ts`)

**Files:**
- Create: `src/routes/tesseractTraining.ts`
- Modify: `src/routesConfig.ts` (mount the route)

**Interfaces:**
- Consumes: `tesseract_training_corpus` table from Task 1; `getDb, query, queryFirst, execute` from `../utils/db`; `getDecrypted, putEncrypted` from `../utils/encryptedR2` (only `getDecrypted` is used here — reading existing encrypted `UPLOADS` objects; writes to `TESSERACT_TRAINING` are plain per the Global Constraints, so `putEncrypted` is NOT used for the write side); `clampIntParam` from `../utils/paginationParams`.
- Produces: `GET /api/tesseract-training/documents`, `GET /api/tesseract-training/documents/:id`, `GET /api/tesseract-training/documents/:id/image`, `POST /api/tesseract-training/documents/:id/submit` — Task 3's client page calls these four endpoints by these exact paths and shapes.

- [ ] **Step 1: Write the route file**

Create `src/routes/tesseractTraining.ts`:

```ts
// ============================================================
// RMPG Flex — Tesseract Training Setup Portal
// ============================================================
// Lets admin/manager users browse existing serve_intake_documents that
// already have real OCR output, correct that text into verified ground
// truth, and submit the pair into the TESSERACT_TRAINING R2 bucket —
// building the labeled corpus a future manual `tesstrain` run needs.
// See docs/superpowers/specs/2026-08-09-tesseract-training-portal-design.md.
//
// Does NOT trigger fine-tuning itself — that stays a manual, local,
// operator-run process (per the design's non-goals).
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { getDecrypted } from '../utils/encryptedR2';
import { clampIntParam } from '../utils/paginationParams';

const tesseractTraining = new Hono<Env>();

function requireAdminManager(c: any): boolean {
  const user = c.get('user');
  return !!user && ['admin', 'manager'].includes(user.role);
}

interface DocRow {
  id: number;
  file_name: string;
  file_type: string;
  r2_key: string;
  raw_text: string | null;
  doc_type: string | null;
  created_at: string;
}

// GET /api/tesseract-training/documents?page=1
tesseractTraining.get('/documents', async (c) => {
  if (!requireAdminManager(c)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  const db = getDb(c.env);
  const page = clampIntParam(c.req.query('page'), 1, 1, 100000);
  const pageSize = 50;
  const offset = (page - 1) * pageSize;

  const rows = await query<DocRow & { already_in_corpus: number }>(
    db,
    `SELECT d.id, d.file_name, d.file_type, d.doc_type, d.created_at,
            CASE WHEN t.id IS NOT NULL THEN 1 ELSE 0 END AS already_in_corpus
       FROM serve_intake_documents d
       LEFT JOIN tesseract_training_corpus t ON t.serve_intake_document_id = d.id
      WHERE d.status = 'extracted'
      ORDER BY d.created_at DESC
      LIMIT ? OFFSET ?`,
    pageSize, offset,
  );

  return c.json({
    rows: rows.map((r) => ({ ...r, already_in_corpus: !!r.already_in_corpus })),
    page, pageSize,
  });
});

// GET /api/tesseract-training/documents/:id
tesseractTraining.get('/documents/:id', async (c) => {
  if (!requireAdminManager(c)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const db = getDb(c.env);
  const doc = await queryFirst<DocRow>(
    db,
    `SELECT id, file_name, file_type, r2_key, raw_text, doc_type, created_at
       FROM serve_intake_documents WHERE id = ?`,
    id,
  );
  if (!doc) return c.json({ error: 'Not found' }, 404);
  const inCorpus = await queryFirst<{ id: number }>(
    db,
    `SELECT id FROM tesseract_training_corpus WHERE serve_intake_document_id = ?`,
    id,
  );
  return c.json({ ...doc, already_in_corpus: !!inCorpus });
});

// GET /api/tesseract-training/documents/:id/image
// Same decrypt-then-legacy-fallback pattern as
// src/routes/serveIntake.ts:1387-1424 (GET /documents/:docId/file) — a
// genuine decrypt failure THROWS rather than falling back, since that
// indicates real corruption, not the expected legacy-object case.
tesseractTraining.get('/documents/:id/image', async (c) => {
  if (!requireAdminManager(c)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const db = getDb(c.env);
  const doc = await queryFirst<{ r2_key: string; file_type: string; file_name: string }>(
    db,
    'SELECT r2_key, file_type, file_name FROM serve_intake_documents WHERE id = ?',
    id,
  );
  if (!doc?.r2_key) return c.json({ error: 'Not found' }, 404);
  const decrypted = await getDecrypted(c.env.UPLOADS, db, c.env.FILE_ENCRYPTION_KEK, doc.r2_key);
  if (decrypted) {
    return new Response(decrypted.bytes, {
      headers: {
        'Content-Type': doc.file_type || 'application/octet-stream',
        'Content-Disposition': `inline; filename="${(doc.file_name || 'document').replace(/"/g, '')}"`,
        'Cache-Control': 'private, max-age=300',
      },
    });
  }
  const legacy = await c.env.UPLOADS.get(doc.r2_key);
  if (!legacy) return c.json({ error: 'File missing in R2' }, 404);
  return new Response(legacy.body, {
    headers: {
      'Content-Type': doc.file_type || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${(doc.file_name || 'document').replace(/"/g, '')}"`,
      'Cache-Control': 'private, max-age=300',
    },
  });
});

// POST /api/tesseract-training/documents/:id/submit
// Body: { ground_truth_text: string }
tesseractTraining.post('/documents/:id/submit', async (c) => {
  if (!requireAdminManager(c)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  const user = c.get('user');
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);

  const existing = await queryFirst<{ id: number }>(
    getDb(c.env),
    `SELECT id FROM tesseract_training_corpus WHERE serve_intake_document_id = ?`,
    id,
  );
  if (existing) {
    return c.json({ error: 'Document already in training corpus', code: 'ALREADY_SUBMITTED' }, 409);
  }

  let body: { ground_truth_text?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const groundTruthText = (body.ground_truth_text ?? '').trim();
  if (!groundTruthText) {
    return c.json({ error: 'ground_truth_text is required' }, 400);
  }

  const db = getDb(c.env);
  const doc = await queryFirst<{ r2_key: string; file_type: string }>(
    db,
    'SELECT r2_key, file_type FROM serve_intake_documents WHERE id = ?',
    id,
  );
  if (!doc?.r2_key) return c.json({ error: 'Not found' }, 404);

  // Fetch the same image bytes the /image route serves (decrypt-then-legacy-
  // fallback), so the corpus copy matches exactly what a reviewer looked at.
  const decrypted = await getDecrypted(c.env.UPLOADS, db, c.env.FILE_ENCRYPTION_KEK, doc.r2_key);
  let imageBytes: ArrayBuffer;
  if (decrypted) {
    imageBytes = decrypted.bytes;
  } else {
    const legacy = await c.env.UPLOADS.get(doc.r2_key);
    if (!legacy) return c.json({ error: 'Source file missing in R2' }, 404);
    imageBytes = await legacy.arrayBuffer();
  }

  const ext = (doc.file_type || '').includes('png') ? '.png'
    : (doc.file_type || '').includes('jpeg') ? '.jpg'
    : '.bin';

  // TESSERACT_TRAINING writes are plain (unencrypted) — matching the
  // existing convention already shipped in
  // scripts/upload-tesseract-training-pair.ts, which writes via
  // `wrangler r2 object put` with no client-side encryption. Not changed
  // here; see this plan's Global Constraints.
  try {
    await c.env.TESSERACT_TRAINING.put(`training-corpus/${id}/image${ext}`, imageBytes, {
      httpMetadata: { contentType: doc.file_type || 'application/octet-stream' },
    });
    await c.env.TESSERACT_TRAINING.put(`training-corpus/${id}/ground-truth.txt`, groundTruthText, {
      httpMetadata: { contentType: 'text/plain' },
    });
  } catch (err) {
    return c.json({
      error: 'Failed to write training pair to R2',
      code: 'R2_WRITE_FAILED',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }

  // D1 insert happens ONLY after both R2 writes succeed (see Global
  // Constraints — never record "this exists" before storage actually has it).
  await execute(
    db,
    `INSERT INTO tesseract_training_corpus (serve_intake_document_id, added_by) VALUES (?, ?)`,
    id, user.id,
  );

  return c.json({ success: true, document_id: id });
});

export default tesseractTraining;
```

- [ ] **Step 2: Add `TESSERACT_TRAINING` to the `Env`/`Bindings` type**

Confirmed missing: `src/types.ts:17` declares `UPLOADS: R2Bucket;` but the infrastructure plan (`docs/superpowers/plans/2026-08-08-custom-tesseract-ocr.md`, Task 1) never added a corresponding binding type for `TESSERACT_TRAINING` when it added the `[[r2_buckets]]` block to `wrangler.toml` — a real gap in that earlier plan, being closed here since this task is the first consumer that actually needs the type. Add immediately after `src/types.ts:17`:

```ts
  TESSERACT_TRAINING: R2Bucket;
```

- [ ] **Step 3: Mount the route**

In `src/routesConfig.ts`, add the import immediately after the existing `import tesseractOcr from './routes/tesseractOcr';` line:

```ts
import tesseractTraining from './routes/tesseractTraining';
```

And add the mount entry immediately after the existing `{ prefix: '/api/tesseract-ocr', router: tesseractOcr, auth: 'required' },` line:

```ts
  { prefix: '/api/tesseract-training', router: tesseractTraining, auth: 'required' },
```

- [ ] **Step 4: Run the full test suite and typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: PASS, no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/routes/tesseractTraining.ts src/routesConfig.ts src/types.ts
git commit -m "feat(tesseract-training): add training-portal backend route"
```

---

### Task 3: Client page

**Files:**
- Create: `client/src/pages/TesseractTrainingPage.tsx` (NOT under `pages/admin/` — that directory holds `AdminPage`'s tab components, e.g. `AdminAISettingsTab.tsx`; standalone admin-gated pages like `AuditLogPage.tsx` live directly under `client/src/pages/`, confirmed at `client/src/App.tsx:118`)
- Modify: `client/src/App.tsx` (add the lazy import + route)

**Interfaces:**
- Consumes: `GET /api/tesseract-training/documents`, `GET /api/tesseract-training/documents/:id`, `GET /api/tesseract-training/documents/:id/image`, `POST /api/tesseract-training/documents/:id/submit` from Task 2, via the existing `apiFetch` helper (`client/src/hooks/useApi.ts`).
- Produces: a route at `/tesseract-training` — nothing else in this plan consumes this page.

- [ ] **Step 1: Confirmed routing convention — no discovery needed**

`client/src/App.tsx:118` already has the exact precedent to mirror, for a standalone admin-gated page (`AuditLogPage`, routed at `/audit`, outside the `AdminPage` tab system):

```ts
const AuditLogPage = lazyRetry(() => import('./pages/AuditLogPage'));
```
```tsx
<Route path="/audit" element={<AdminRoute><RouteErrorBoundary><AuditLogPage /></RouteErrorBoundary></AdminRoute>} />
```

This task follows that pattern exactly, substituting `TesseractTrainingPage` and `/tesseract-training`.

- [ ] **Step 2: Write the page component**

Create `client/src/pages/TesseractTrainingPage.tsx`:

```tsx
import { useState, useEffect, useCallback } from 'react';
import { apiFetch, authedImageUrl } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';

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

export default function TesseractTrainingPage() {
  const [rows, setRows] = useState<DocRow[]>([]);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<DocDetail | null>(null);
  const [groundTruth, setGroundTruth] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Register the route**

In `client/src/App.tsx`, add the lazy import immediately after the existing `const AuditLogPage = lazyRetry(() => import('./pages/AuditLogPage'));` line (line 118):

```ts
const TesseractTrainingPage = lazyRetry(() => import('./pages/TesseractTrainingPage'));
```

And add the route immediately after the existing `<Route path="/audit" ...>` line (line 691):

```tsx
            <Route path="/tesseract-training" element={<AdminRoute><RouteErrorBoundary><TesseractTrainingPage /></RouteErrorBoundary></AdminRoute>} />
```

- [ ] **Step 4: Run the client test suite and typecheck**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: PASS, no regressions.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/TesseractTrainingPage.tsx client/src/App.tsx
git commit -m "feat(tesseract-training): add training portal client page"
```

(Adjust the second `git add` path if Step 1 found a different router file than `client/src/App.tsx`.)
