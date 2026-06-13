# Document Subsystem (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a server-backed Word/Pages-style `documents` model (title, markdown-marker body, owner, revisions, finalize-lock, many-to-many call/incident links) surfaced as a per-call Document tab and a standalone Documents Library, reusing Phase 1's grammar + PDF renderer.

**Architecture:** New D1 tables (`documents`, `document_revisions`, `document_links`) + a Hono router at `/api/docs`. The document body is plain markdown-marker text rendered by Phase 1's shared grammar — the same browser renderer (lifted into a shared helper) and the same `addFormattedText` PDF path. Lifecycle: `draft → finalized (locked) → reopen → draft`; every save snapshots a revision.

**Tech Stack:** Cloudflare Workers + Hono + D1 (`src/`), React 18 + TS + Vite + Tailwind (`client/`), jsPDF, vitest + @testing-library/react.

**Branch:** This work is **stacked on the Phase 1 branch** `claude/reverent-fermat-9b544e`. The current worktree branch (`claude/angry-fermi-b6dde8`) is already reset onto the Phase 1 tip — `client/src/utils/noteFormatting.ts` and `client/src/pages/dispatch/components/NoteComposer.tsx` are present. The Phase 2 PR base = the Phase 1 branch.

**Spec:** [`docs/superpowers/specs/2026-06-13-document-subsystem-design.md`](../specs/2026-06-13-document-subsystem-design.md)

**Naming guard:** The client type for a document is **`DocRecord`** (NOT `Document` — that shadows the DOM global). The Worker prefix is **`/api/docs`** (distinct from `/api/documents`, the file-folder system). The user-facing label is **"Documents Library"**.

---

## Phase 1 — Storage & Worker API

### Task 1: Migration `0104_documents_subsystem.sql`

**Files:**
- Create: `migrations/0104_documents_subsystem.sql`

- [ ] **Step 1: Create the migration file**

Create `migrations/0104_documents_subsystem.sql` with exactly:

```sql
-- 0104: Document subsystem (Phase 2 of dispatch-notes).
-- Authored, formatted, reopenable documents. DISTINCT from document_folders
-- (file cabinet) and company_documents (policy docs). Body is Phase-1
-- markdown-marker text; body_format leaves a door open for a future 'html' body.
-- Idempotent. After merge, ALSO apply directly to live D1 785de7ae (see CLAUDE.md).

CREATE TABLE IF NOT EXISTS documents (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL DEFAULT '',
  body_format     TEXT NOT NULL DEFAULT 'markdown',
  status          TEXT NOT NULL DEFAULT 'draft',
  owner_id        INTEGER,
  owner_username  TEXT,
  revision        INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at      TEXT,
  finalized_at    TEXT,
  finalized_by    TEXT,
  reopened_at     TEXT,
  reopened_by     TEXT,
  deleted_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_documents_owner   ON documents(owner_username);
CREATE INDEX IF NOT EXISTS idx_documents_status  ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_deleted ON documents(deleted_at);

CREATE TABLE IF NOT EXISTS document_revisions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id       INTEGER NOT NULL,
  revision_number   INTEGER NOT NULL,
  title             TEXT NOT NULL,
  body              TEXT NOT NULL,
  body_format       TEXT NOT NULL DEFAULT 'markdown',
  saved_by          INTEGER,
  saved_by_username TEXT,
  saved_at          TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  change_note       TEXT,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_doc_revisions_doc ON document_revisions(document_id, revision_number);

CREATE TABLE IF NOT EXISTS document_links (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id  INTEGER NOT NULL,
  target_type  TEXT NOT NULL,
  target_id    INTEGER NOT NULL,
  linked_by    INTEGER,
  linked_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  UNIQUE (document_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_doc_links_target ON document_links(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_doc_links_doc    ON document_links(document_id);
```

- [ ] **Step 2: Apply to local D1**

Run: `npm run migrate:local`
Expected: applies cleanly (output lists `0104_documents_subsystem.sql`). Re-running is a no-op (idempotent).

- [ ] **Step 3: Verify the tables exist locally**

Run: `npx wrangler d1 execute rmpg-flex --local --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('documents','document_revisions','document_links') ORDER BY name"`
Expected: three rows — `document_links`, `document_revisions`, `documents`.

- [ ] **Step 4: Commit**

```bash
git add migrations/0104_documents_subsystem.sql
git commit -m "feat(docs): migration 0104 — documents + revisions + links tables"
```

> **Live-D1 note (post-merge, do NOT do during implementation):** after the PR merges, apply the same DDL directly to live `785de7ae` via the Cloudflare D1 API and verify with `SELECT name FROM pragma_table_info('documents')`. The deploy pipeline's migration step is `continue-on-error` and historically misses live (CLAUDE.md §"Schema changes").

---

### Task 2: Worker router `src/routes/documents/library.ts`

**Files:**
- Create: `src/routes/documents/library.ts`
- Modify: `src/routesConfig.ts` (import + one route-table entry)

- [ ] **Step 1: Write the full router file**

Create `src/routes/documents/library.ts` with exactly:

```ts
// ============================================================
// RMPG Flex — Documents Library (Cloudflare Worker)
// ============================================================
// Authored, formatted, reopenable documents (Phase 2 of the
// dispatch-notes work). DISTINCT from /api/documents (file
// folders) and /api/company-documents (policy docs). Mounted at
// /api/docs. Body is Phase-1 markdown-marker text.
//
// Tables (migration 0104): documents, document_revisions,
// document_links. Lifecycle: draft -> finalized (locked) ->
// reopen -> draft. Every save snapshots a revision row.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query, queryFirst, execute } from '../../utils/db';
import { requireRole } from '../../middleware/auth';

const lib = new Hono<Env>();

const READ_ROLES = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'];
const ADMIN_ROLES = ['admin', 'manager'];

type Actor = { id: number; username: string; role: string; full_name?: string };
const actorOf = (c: any): Actor | undefined => c.get('user') as Actor | undefined;

function canModify(doc: { owner_username: string | null }, actor?: Actor): boolean {
  if (!actor) return false;
  if (ADMIN_ROLES.includes(actor.role)) return true;
  return !!doc.owner_username && doc.owner_username === actor.username;
}

async function logActivity(c: any, action: string, id: number, details: unknown) {
  try {
    await execute(getDb(c.env),
      `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
       VALUES (?, ?, 'documents', ?, ?, ?)`,
      (c.get('userId') as number) ?? null, action, id,
      typeof details === 'string' ? details : JSON.stringify(details ?? ''),
      c.req.header('CF-Connecting-IP') || 'unknown');
  } catch { /* audit best-effort */ }
}

const linksFor = (c: any, docId: number) => query(getDb(c.env),
  `SELECT id, document_id, target_type, target_id, linked_by, linked_at
   FROM document_links WHERE document_id = ? ORDER BY linked_at`, docId);

// All routes require an operational role (officers included — they author narratives).
lib.use('*', requireRole(...READ_ROLES));

// ── List ──────────────────────────────────────────────────────
lib.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    const actor = actorOf(c);
    const sp = new URL(c.req.url).searchParams;
    const q = sp.get('q');
    const status = sp.get('status');
    const mine = sp.get('mine');
    const targetType = sp.get('target_type');
    const targetId = sp.get('target_id');
    const limit = Math.min(parseInt(sp.get('limit') || '100', 10) || 100, 500);
    const offset = parseInt(sp.get('offset') || '0', 10) || 0;

    const where: string[] = ['d.deleted_at IS NULL'];
    const whereParams: unknown[] = [];
    if (q) { where.push('d.title LIKE ?'); whereParams.push(`%${q}%`); }
    if (status) { where.push('d.status = ?'); whereParams.push(status); }
    if (mine === 'true' && actor?.username) { where.push('d.owner_username = ?'); whereParams.push(actor.username); }

    const joinParams: unknown[] = [];
    let join = '';
    if ((targetType === 'call' || targetType === 'incident') && targetId) {
      join = 'JOIN document_links dl ON dl.document_id = d.id AND dl.target_type = ? AND dl.target_id = ?';
      joinParams.push(targetType, Number(targetId));
    }

    const rows = await query(db,
      `SELECT d.id, d.title, d.status, d.body_format, d.owner_id, d.owner_username,
              d.revision, d.created_at, d.updated_at, d.finalized_at, d.finalized_by
       FROM documents d ${join}
       WHERE ${where.join(' AND ')}
       ORDER BY COALESCE(d.updated_at, d.created_at) DESC
       LIMIT ? OFFSET ?`,
      ...joinParams, ...whereParams, limit, offset);
    return c.json({ data: rows });
  } catch (err) {
    console.error('List documents error:', err);
    return c.json({ error: 'Failed to list documents', code: 'DOC_LIST_ERROR' }, 500);
  }
});

// ── Create ────────────────────────────────────────────────────
lib.post('/', async (c) => {
  try {
    const db = getDb(c.env);
    const actor = actorOf(c);
    const body = await c.req.json().catch(() => ({} as any));
    const title = String(body.title || '').trim();
    if (!title) return c.json({ error: 'Title is required', code: 'DOC_TITLE_REQUIRED' }, 400);
    const text = typeof body.body === 'string' ? body.body : '';

    const res = await execute(db,
      `INSERT INTO documents (title, body, body_format, status, owner_id, owner_username, revision, updated_at)
       VALUES (?, ?, 'markdown', 'draft', ?, ?, 1, datetime('now','localtime'))`,
      title, text, actor?.id ?? null, actor?.username ?? null);
    const id = Number(res.meta.last_row_id);

    await execute(db,
      `INSERT INTO document_revisions (document_id, revision_number, title, body, body_format, saved_by, saved_by_username, change_note)
       VALUES (?, 1, ?, ?, 'markdown', ?, ?, ?)`,
      id, title, text, actor?.id ?? null, actor?.username ?? null, body.change_note ?? 'created');

    if (Array.isArray(body.links)) {
      for (const l of body.links) {
        if (l && (l.target_type === 'call' || l.target_type === 'incident') && l.target_id != null) {
          await execute(db,
            `INSERT OR IGNORE INTO document_links (document_id, target_type, target_id, linked_by)
             VALUES (?, ?, ?, ?)`,
            id, l.target_type, Number(l.target_id), actor?.id ?? null);
        }
      }
    }
    await logActivity(c, 'CREATE', id, { title });
    const doc = await queryFirst(db, 'SELECT * FROM documents WHERE id = ?', id);
    const links = await linksFor(c, id);
    return c.json({ success: true, data: { ...(doc as object), links } });
  } catch (err) {
    console.error('Create document error:', err);
    return c.json({ error: 'Failed to create document', code: 'DOC_CREATE_ERROR' }, 500);
  }
});

// ── Revision detail (register BEFORE /:id so static segments win) ──
lib.get('/:id/revisions/:rev', async (c) => {
  const db = getDb(c.env);
  const id = parseInt(c.req.param('id'), 10);
  const rev = parseInt(c.req.param('rev'), 10);
  const row = await queryFirst(db,
    'SELECT * FROM document_revisions WHERE document_id = ? AND revision_number = ?', id, rev);
  if (!row) return c.json({ error: 'Revision not found', code: 'DOC_REV_NOT_FOUND' }, 404);
  return c.json({ data: row });
});

lib.get('/:id/revisions', async (c) => {
  const db = getDb(c.env);
  const id = parseInt(c.req.param('id'), 10);
  const rows = await query(db,
    `SELECT id, revision_number, title, saved_by, saved_by_username, saved_at, change_note
     FROM document_revisions WHERE document_id = ? ORDER BY revision_number DESC`, id);
  return c.json({ data: rows });
});

lib.post('/:id/revisions/:rev/restore', async (c) => {
  try {
    const db = getDb(c.env);
    const actor = actorOf(c);
    const id = parseInt(c.req.param('id'), 10);
    const rev = parseInt(c.req.param('rev'), 10);
    const doc = await queryFirst<any>(db, 'SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL', id);
    if (!doc) return c.json({ error: 'Document not found', code: 'DOC_NOT_FOUND' }, 404);
    if (!canModify(doc, actor)) return c.json({ error: 'Forbidden', code: 'DOC_FORBIDDEN' }, 403);
    if (doc.status === 'finalized') return c.json({ error: 'Document is finalized; reopen to edit', code: 'DOC_FINALIZED' }, 409);
    const old = await queryFirst<any>(db, 'SELECT * FROM document_revisions WHERE document_id = ? AND revision_number = ?', id, rev);
    if (!old) return c.json({ error: 'Revision not found', code: 'DOC_REV_NOT_FOUND' }, 404);
    const nextRev = (doc.revision || 1) + 1;
    await execute(db,
      `UPDATE documents SET title = ?, body = ?, revision = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
      old.title, old.body, nextRev, id);
    await execute(db,
      `INSERT INTO document_revisions (document_id, revision_number, title, body, body_format, saved_by, saved_by_username, change_note)
       VALUES (?, ?, ?, ?, 'markdown', ?, ?, ?)`,
      id, nextRev, old.title, old.body, actor?.id ?? null, actor?.username ?? null, `restored from r${rev}`);
    await logActivity(c, 'RESTORE', id, { from: rev, to: nextRev });
    const updated = await queryFirst(db, 'SELECT * FROM documents WHERE id = ?', id);
    const links = await linksFor(c, id);
    return c.json({ success: true, data: { ...(updated as object), links } });
  } catch (err) {
    console.error('Restore revision error:', err);
    return c.json({ error: 'Failed to restore revision', code: 'DOC_RESTORE_ERROR' }, 500);
  }
});

// ── Finalize / Reopen ─────────────────────────────────────────
lib.post('/:id/finalize', async (c) => {
  const db = getDb(c.env);
  const actor = actorOf(c);
  const id = parseInt(c.req.param('id'), 10);
  const doc = await queryFirst<any>(db, 'SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL', id);
  if (!doc) return c.json({ error: 'Document not found', code: 'DOC_NOT_FOUND' }, 404);
  if (!canModify(doc, actor)) return c.json({ error: 'Forbidden', code: 'DOC_FORBIDDEN' }, 403);
  if (doc.status !== 'finalized') {
    await execute(db,
      `UPDATE documents SET status = 'finalized', finalized_at = datetime('now','localtime'), finalized_by = ? WHERE id = ?`,
      actor?.username ?? null, id);
    await logActivity(c, 'FINALIZE', id, {});
  }
  const updated = await queryFirst(db, 'SELECT * FROM documents WHERE id = ?', id);
  return c.json({ success: true, data: updated });
});

lib.post('/:id/reopen', async (c) => {
  const db = getDb(c.env);
  const actor = actorOf(c);
  const id = parseInt(c.req.param('id'), 10);
  const doc = await queryFirst<any>(db, 'SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL', id);
  if (!doc) return c.json({ error: 'Document not found', code: 'DOC_NOT_FOUND' }, 404);
  if (!canModify(doc, actor)) return c.json({ error: 'Forbidden', code: 'DOC_FORBIDDEN' }, 403);
  if (doc.status === 'finalized') {
    await execute(db,
      `UPDATE documents SET status = 'draft', reopened_at = datetime('now','localtime'), reopened_by = ? WHERE id = ?`,
      actor?.username ?? null, id);
    await logActivity(c, 'REOPEN', id, {});
  }
  const updated = await queryFirst(db, 'SELECT * FROM documents WHERE id = ?', id);
  return c.json({ success: true, data: updated });
});

// ── Links ─────────────────────────────────────────────────────
lib.post('/:id/links', async (c) => {
  const db = getDb(c.env);
  const actor = actorOf(c);
  const id = parseInt(c.req.param('id'), 10);
  const body = await c.req.json().catch(() => ({} as any));
  if (body.target_type !== 'call' && body.target_type !== 'incident') {
    return c.json({ error: 'target_type must be call|incident', code: 'DOC_BAD_TARGET' }, 400);
  }
  if (body.target_id == null) return c.json({ error: 'target_id required', code: 'DOC_BAD_TARGET' }, 400);
  const doc = await queryFirst<any>(db, 'SELECT id FROM documents WHERE id = ? AND deleted_at IS NULL', id);
  if (!doc) return c.json({ error: 'Document not found', code: 'DOC_NOT_FOUND' }, 404);
  await execute(db,
    `INSERT OR IGNORE INTO document_links (document_id, target_type, target_id, linked_by) VALUES (?, ?, ?, ?)`,
    id, body.target_type, Number(body.target_id), actor?.id ?? null);
  await logActivity(c, 'LINK', id, { target_type: body.target_type, target_id: Number(body.target_id) });
  return c.json({ success: true, data: await linksFor(c, id) });
});

lib.delete('/:id/links/:linkId', async (c) => {
  const db = getDb(c.env);
  const id = parseInt(c.req.param('id'), 10);
  const linkId = parseInt(c.req.param('linkId'), 10);
  await execute(db, 'DELETE FROM document_links WHERE id = ? AND document_id = ?', linkId, id);
  await logActivity(c, 'UNLINK', id, { linkId });
  return c.json({ success: true, data: await linksFor(c, id) });
});

// ── Get one ───────────────────────────────────────────────────
lib.get('/:id', async (c) => {
  const db = getDb(c.env);
  const id = parseInt(c.req.param('id'), 10);
  const doc = await queryFirst(db, 'SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL', id);
  if (!doc) return c.json({ error: 'Document not found', code: 'DOC_NOT_FOUND' }, 404);
  const links = await linksFor(c, id);
  return c.json({ data: { ...(doc as object), links } });
});

// ── Save ──────────────────────────────────────────────────────
lib.put('/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const actor = actorOf(c);
    const id = parseInt(c.req.param('id'), 10);
    const doc = await queryFirst<any>(db, 'SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL', id);
    if (!doc) return c.json({ error: 'Document not found', code: 'DOC_NOT_FOUND' }, 404);
    if (!canModify(doc, actor)) return c.json({ error: 'Forbidden', code: 'DOC_FORBIDDEN' }, 403);
    if (doc.status === 'finalized') return c.json({ error: 'Document is finalized; reopen to edit', code: 'DOC_FINALIZED' }, 409);

    const body = await c.req.json().catch(() => ({} as any));
    const nextTitle = body.title !== undefined ? String(body.title).trim() : doc.title;
    if (!nextTitle) return c.json({ error: 'Title is required', code: 'DOC_TITLE_REQUIRED' }, 400);
    const nextBody = body.body !== undefined ? String(body.body) : doc.body;
    const nextRev = (doc.revision || 1) + 1;

    await execute(db,
      `UPDATE documents SET title = ?, body = ?, revision = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
      nextTitle, nextBody, nextRev, id);
    await execute(db,
      `INSERT INTO document_revisions (document_id, revision_number, title, body, body_format, saved_by, saved_by_username, change_note)
       VALUES (?, ?, ?, ?, 'markdown', ?, ?, ?)`,
      id, nextRev, nextTitle, nextBody, actor?.id ?? null, actor?.username ?? null, body.change_note ?? null);
    await logActivity(c, 'UPDATE', id, { revision: nextRev });
    const updated = await queryFirst(db, 'SELECT * FROM documents WHERE id = ?', id);
    const links = await linksFor(c, id);
    return c.json({ success: true, data: { ...(updated as object), links } });
  } catch (err) {
    console.error('Save document error:', err);
    return c.json({ error: 'Failed to save document', code: 'DOC_SAVE_ERROR' }, 500);
  }
});

// ── Soft-delete (admin/manager only) ──────────────────────────
lib.delete('/:id', async (c) => {
  const db = getDb(c.env);
  const actor = actorOf(c);
  if (!actor || !ADMIN_ROLES.includes(actor.role)) return c.json({ error: 'Forbidden', code: 'DOC_FORBIDDEN' }, 403);
  const id = parseInt(c.req.param('id'), 10);
  const doc = await queryFirst<any>(db, 'SELECT id FROM documents WHERE id = ? AND deleted_at IS NULL', id);
  if (!doc) return c.json({ error: 'Document not found', code: 'DOC_NOT_FOUND' }, 404);
  await execute(db, `UPDATE documents SET deleted_at = datetime('now','localtime') WHERE id = ?`, id);
  await logActivity(c, 'DELETE', id, {});
  return c.json({ success: true });
});

export default lib;
```

- [ ] **Step 2: Register the router in `src/routesConfig.ts`**

Add the import next to the existing documents import (the file imports `documentFolders` from `./routes/documents/folders` around line 105). Add directly below it:

```ts
import documentsLibrary from './routes/documents/library';
```

In the `// ── Documents ──` section of the route table (around line 417, where `{ prefix: '/api/documents', router: documentFolders, auth: 'required' }` is), add directly below that entry:

```ts
  { prefix: '/api/docs', router: documentsLibrary, auth: 'required',
    note: 'Authored documents (Phase 2): rich-body, revisions, finalize-lock, call/incident links. Distinct from /api/documents (file folders).' },
```

- [ ] **Step 3: Typecheck the Worker**

Run: `npm run typecheck`
Expected: PASS (no errors). If `c.get('user')`/`Env` typing complains, confirm the `any` casts match `companyDocuments.ts`/`extensions.ts` usage.

- [ ] **Step 4: Smoke-test against local D1 (manual)**

Run the dev Worker in one shell: `npm run dev` (wrangler dev on :8787). In another shell, exercise the lifecycle (replace `<JWT>` with a token from a local login, or skip if no local auth — then rely on the create→save→finalize→reopen integration check after deploy):

```bash
# create
curl -s localhost:8787/api/docs -X POST -H "Authorization: Bearer <JWT>" \
  -H 'Content-Type: application/json' -d '{"title":"Test doc","body":"**bold** line\n- a\n- b"}'
# expect {"success":true,"data":{"id":1,"status":"draft","revision":1,...,"links":[]}}
```

If no local JWT is available, document that this step is deferred to post-deploy browser verification (CLAUDE.md notes the WAF blocks unauthenticated curl in prod; local dev has no WAF but still needs a valid JWT).

- [ ] **Step 5: Commit**

```bash
git add src/routes/documents/library.ts src/routesConfig.ts
git commit -m "feat(docs): /api/docs router — CRUD, revisions, finalize/reopen, links"
```

---

## Phase 2 — Shared browser renderer (lift from DispatchPage, TDD)

### Task 3: Lift `renderFormattedText` into `client/src/utils/renderFormatted.tsx`

**Files:**
- Create: `client/src/utils/renderFormatted.tsx`
- Create: `client/src/utils/renderFormatted.test.tsx`
- Modify: `client/src/pages/dispatch/DispatchPage.tsx` (remove the two local callbacks; import the shared renderer)

- [ ] **Step 1: Write the failing test**

Create `client/src/utils/renderFormatted.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { renderFormattedText } from './renderFormatted';

describe('renderFormattedText', () => {
  it('applies inline marks to spans', () => {
    const { container } = render(<>{renderFormattedText('**bold** and *italic* and ~~struck~~')}</>);
    expect(container.querySelector('.font-bold')?.textContent).toBe('bold');
    expect(container.querySelector('.italic')?.textContent).toBe('italic');
    expect(container.querySelector('.line-through')?.textContent).toBe('struck');
  });

  it('renders an outline list with computed numbers', () => {
    const { container } = render(<>{renderFormattedText('1. first\n  1. nested\n- bullet')}</>);
    const text = container.textContent || '';
    expect(text).toContain('1.');     // top-level ordered marker
    expect(text).toContain('1.1.');   // nested outline number
    expect(text).toContain('•');      // bullet glyph
  });

  it('returns the raw string for empty input', () => {
    expect(renderFormattedText('')).toBe('');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && npx vitest run src/utils/renderFormatted.test.tsx`
Expected: FAIL — `Failed to resolve import "./renderFormatted"`.

- [ ] **Step 3: Implement the shared renderer**

Create `client/src/utils/renderFormatted.tsx` (lifted verbatim from `DispatchPage.tsx:1714-1748`, converted from `useCallback` to pure functions):

```tsx
import React from 'react';
import { computeListLines, tokenizeInline } from './noteFormatting';

// Inline-only render: split a line into styled runs. Shared by the dispatch
// note list and the document preview so the two can't drift.
export function renderInline(text: string, keyBase: string): React.ReactNode[] {
  return tokenizeInline(text).map((t, i) => {
    const cls = [
      t.bold && 'font-bold',
      t.italic && 'italic',
      t.underline && 'underline',
      t.strike && 'line-through',
    ].filter(Boolean).join(' ');
    return cls
      ? <span key={`${keyBase}-${i}`} className={cls}>{t.text}</span>
      : t.text;
  });
}

// Block-aware render: inline marks for single-line text; a block of indented
// rows (bullets / outline numbers) when the text contains list lines.
export function renderFormattedText(text: string): React.ReactNode {
  if (!text) return text;
  const lines = computeListLines(text);
  const hasList = lines.some((l) => l.kind !== 'plain');
  if (!hasList) return renderInline(text, 'inl');
  return (
    <span className="block">
      {lines.map((l, idx) => (
        <span key={idx} className="flex items-start" style={{ paddingLeft: `${l.depth * 1.1}em` }}>
          {l.kind !== 'plain' && (
            <span className="inline-block shrink-0 text-[#9ca3af] mr-1" style={{ minWidth: '1.4em' }}>
              {l.kind === 'ordered' ? `${l.marker}.` : '•'}
            </span>
          )}
          <span className="flex-1 min-w-0">{renderInline(l.content, `l${idx}`)}</span>
        </span>
      ))}
    </span>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd client && npx vitest run src/utils/renderFormatted.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Rewire `DispatchPage.tsx` to use the shared renderer**

In `client/src/pages/dispatch/DispatchPage.tsx`:
1. **Delete** the local `renderInline` callback (lines ~1714-1725) and the local `renderFormattedText` callback (lines ~1727-1748).
2. Add an import near the other util imports (the file imports from `'../../utils/noteFormatting'` at line 75):

```ts
import { renderFormattedText } from '../../utils/renderFormatted';
```

3. If `computeListLines` / `tokenizeInline` (line 75 import) are now unused in `DispatchPage.tsx`, remove them from that import (typecheck in the next step will flag if they're still used elsewhere — keep whatever is still referenced).

- [ ] **Step 6: Typecheck + run the full client suite**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: PASS. tsc surfaces any leftover unused import or missed usage; the existing dispatch tests + the new renderer test pass.

- [ ] **Step 7: Commit**

```bash
git add client/src/utils/renderFormatted.tsx client/src/utils/renderFormatted.test.tsx client/src/pages/dispatch/DispatchPage.tsx
git commit -m "refactor(notes): lift renderFormattedText into shared renderFormatted helper"
```

---

## Phase 3 — Client types & data layer

### Task 4: Types + `useDocuments` data layer (TDD on pure helpers)

**Files:**
- Modify: `client/src/types/index.ts` (append interfaces)
- Create: `client/src/pages/docs/useDocuments.ts`
- Create: `client/src/pages/docs/useDocuments.test.ts`

- [ ] **Step 1: Append document types to `client/src/types/index.ts`**

Append at the end of the file:

```ts
// ── Document subsystem (Phase 2) ──────────────────────────────
// NOTE: named DocRecord, not Document — `Document` is a DOM global.
export interface DocLink {
  id: number;
  document_id: number;
  target_type: 'call' | 'incident';
  target_id: number;
  linked_by: number | null;
  linked_at: string;
}

export interface DocRevisionMeta {
  id: number;
  revision_number: number;
  title: string;
  saved_by: number | null;
  saved_by_username: string | null;
  saved_at: string;
  change_note: string | null;
}

export interface DocRecord {
  id: number;
  title: string;
  body: string;
  body_format: string;
  status: 'draft' | 'finalized';
  owner_id: number | null;
  owner_username: string | null;
  revision: number;
  created_at: string;
  updated_at: string | null;
  finalized_at: string | null;
  finalized_by: string | null;
  reopened_at: string | null;
  reopened_by: string | null;
  links?: DocLink[];
}

export interface DocListItem {
  id: number;
  title: string;
  status: 'draft' | 'finalized';
  body_format: string;
  owner_id: number | null;
  owner_username: string | null;
  revision: number;
  created_at: string;
  updated_at: string | null;
  finalized_at: string | null;
  finalized_by: string | null;
}
```

- [ ] **Step 2: Write the failing test for the pure helpers**

Create `client/src/pages/docs/useDocuments.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildDocsQuery, canEditDocument } from './useDocuments';

describe('buildDocsQuery', () => {
  it('returns bare path with no params', () => {
    expect(buildDocsQuery({})).toBe('/docs');
  });
  it('encodes filters', () => {
    expect(buildDocsQuery({ mine: true, status: 'draft', q: 'foo' }))
      .toBe('/docs?mine=true&status=draft&q=foo');
  });
  it('encodes a call target', () => {
    expect(buildDocsQuery({ targetType: 'call', targetId: 42 }))
      .toBe('/docs?target_type=call&target_id=42');
  });
  it('omits target when id is missing', () => {
    expect(buildDocsQuery({ targetType: 'call' })).toBe('/docs');
  });
});

describe('canEditDocument', () => {
  const draftMine = { status: 'draft' as const, owner_username: 'jdoe' };
  it('blocks when no user', () => {
    expect(canEditDocument(draftMine, null)).toBe(false);
  });
  it('blocks a finalized doc even for admins', () => {
    expect(canEditDocument({ status: 'finalized', owner_username: 'jdoe' }, { username: 'boss', role: 'admin' })).toBe(false);
  });
  it('allows the owner on a draft', () => {
    expect(canEditDocument(draftMine, { username: 'jdoe', role: 'officer' })).toBe(true);
  });
  it('blocks a non-owner non-admin', () => {
    expect(canEditDocument(draftMine, { username: 'other', role: 'officer' })).toBe(false);
  });
  it('allows an admin on a draft they do not own', () => {
    expect(canEditDocument(draftMine, { username: 'boss', role: 'manager' })).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd client && npx vitest run src/pages/docs/useDocuments.test.ts`
Expected: FAIL — cannot resolve `./useDocuments`.

- [ ] **Step 4: Implement `useDocuments.ts`**

Create `client/src/pages/docs/useDocuments.ts`:

```ts
import { apiFetch } from '../../hooks/useApi';
import type { DocRecord, DocListItem, DocRevisionMeta, DocLink } from '../../types';

export interface DocsQuery {
  mine?: boolean;
  status?: string;
  q?: string;
  targetType?: 'call' | 'incident';
  targetId?: number;
  limit?: number;
  offset?: number;
}

/** Pure: build the /docs query path from filters. */
export function buildDocsQuery(p: DocsQuery): string {
  const sp = new URLSearchParams();
  if (p.mine) sp.set('mine', 'true');
  if (p.status) sp.set('status', p.status);
  if (p.q) sp.set('q', p.q);
  if (p.targetType && p.targetId != null) {
    sp.set('target_type', p.targetType);
    sp.set('target_id', String(p.targetId));
  }
  if (p.limit != null) sp.set('limit', String(p.limit));
  if (p.offset != null) sp.set('offset', String(p.offset));
  const s = sp.toString();
  return s ? `/docs?${s}` : '/docs';
}

/** Pure: client-side mirror of the server edit gate (for button enablement). */
export function canEditDocument(
  doc: Pick<DocRecord, 'status' | 'owner_username'>,
  user?: { username?: string; role?: string } | null,
): boolean {
  if (!user) return false;
  if (doc.status === 'finalized') return false;
  if (user.role === 'admin' || user.role === 'manager') return true;
  return !!doc.owner_username && doc.owner_username === user.username;
}

export const docsApi = {
  list: (p: DocsQuery = {}) => apiFetch<{ data: DocListItem[] }>(buildDocsQuery(p)).then((r) => r.data),
  get: (id: number) => apiFetch<{ data: DocRecord }>(`/docs/${id}`).then((r) => r.data),
  create: (payload: { title: string; body?: string; links?: { target_type: 'call' | 'incident'; target_id: number }[] }) =>
    apiFetch<{ data: DocRecord }>('/docs', { method: 'POST', body: JSON.stringify(payload) }).then((r) => r.data),
  save: (id: number, payload: { title?: string; body?: string; change_note?: string }) =>
    apiFetch<{ data: DocRecord }>(`/docs/${id}`, { method: 'PUT', body: JSON.stringify(payload) }).then((r) => r.data),
  finalize: (id: number) => apiFetch<{ data: DocRecord }>(`/docs/${id}/finalize`, { method: 'POST' }).then((r) => r.data),
  reopen: (id: number) => apiFetch<{ data: DocRecord }>(`/docs/${id}/reopen`, { method: 'POST' }).then((r) => r.data),
  revisions: (id: number) => apiFetch<{ data: DocRevisionMeta[] }>(`/docs/${id}/revisions`).then((r) => r.data),
  revision: (id: number, rev: number) =>
    apiFetch<{ data: DocRecord & { revision_number: number } }>(`/docs/${id}/revisions/${rev}`).then((r) => r.data),
  restore: (id: number, rev: number) =>
    apiFetch<{ data: DocRecord }>(`/docs/${id}/revisions/${rev}/restore`, { method: 'POST' }).then((r) => r.data),
  link: (id: number, target_type: 'call' | 'incident', target_id: number) =>
    apiFetch<{ data: DocLink[] }>(`/docs/${id}/links`, { method: 'POST', body: JSON.stringify({ target_type, target_id }) }).then((r) => r.data),
  unlink: (id: number, linkId: number) =>
    apiFetch<{ data: DocLink[] }>(`/docs/${id}/links/${linkId}`, { method: 'DELETE' }).then((r) => r.data),
  remove: (id: number) => apiFetch<{ success: boolean }>(`/docs/${id}`, { method: 'DELETE' }),
};
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd client && npx vitest run src/pages/docs/useDocuments.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Typecheck + commit**

Run: `cd client && npx tsc --noEmit`
Expected: PASS.

```bash
git add client/src/types/index.ts client/src/pages/docs/useDocuments.ts client/src/pages/docs/useDocuments.test.ts
git commit -m "feat(docs): client types + useDocuments data layer (buildDocsQuery, docsApi, canEditDocument)"
```

---

## Phase 4 — Client UI

### Task 5: PDF export `client/src/utils/documentPdf.ts`

**Files:**
- Create: `client/src/utils/documentPdf.ts`

Models on `dossierPdfGenerator.ts` (portrait letter, Arial-only). Renders the body via the shared `addFormattedText`. Built **before** the editor (Task 6) so the editor's dynamic `import('../../utils/documentPdf')` resolves under `tsc --noEmit`.

- [ ] **Step 1: Write the generator**

Create `client/src/utils/documentPdf.ts`:

```ts
// Document PDF — portrait letter, Arial-only (registerArialFont per project rule).
// Body is rendered through the shared addFormattedText so markdown-marker
// formatting (bold/italic/underline/strike + bullet/outline lists) prints
// exactly as it shows on screen.
import jsPDF from 'jspdf';
import { registerArialFont } from './pdf/fonts/registerArial';
import { addFormattedText } from './pdfGenerator';
import type { DocRecord } from '../types';

export function generateDocumentPdf(doc: Pick<DocRecord, 'id' | 'title' | 'body' | 'status' | 'owner_username' | 'created_at' | 'updated_at' | 'finalized_by' | 'finalized_at' | 'revision' | 'links'>): void {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  registerArialFont(pdf);

  const pageW = pdf.internal.pageSize.getWidth();
  const margin = 18;
  const contentW = pageW - margin * 2;
  let y = margin;

  // Title
  pdf.setFontSize(15);
  pdf.setFont('Arial', 'bold');
  pdf.text(doc.title || 'Untitled document', margin, y);
  y += 7;

  // Metadata band
  pdf.setFontSize(8);
  pdf.setFont('Arial', 'normal');
  pdf.setTextColor(90);
  const meta: string[] = [
    `Status: ${(doc.status || 'draft').toUpperCase()}`,
    `Rev: ${doc.revision ?? 1}`,
    doc.owner_username ? `Owner: ${doc.owner_username}` : '',
    doc.created_at ? `Created: ${doc.created_at}` : '',
    doc.status === 'finalized' && doc.finalized_by ? `Finalized by ${doc.finalized_by} ${doc.finalized_at || ''}` : '',
  ].filter(Boolean);
  pdf.text(meta.join('   |   '), margin, y);
  y += 4;

  const linkLabels = (doc.links || []).map((l) => `${l.target_type} #${l.target_id}`);
  if (linkLabels.length) {
    pdf.text(`Linked: ${linkLabels.join(', ')}`, margin, y);
    y += 4;
  }

  // Divider
  pdf.setDrawColor(180);
  pdf.line(margin, y, pageW - margin, y);
  y += 6;
  pdf.setTextColor(20);

  // Body (page-break aware via addFormattedText's callback)
  y = addFormattedText(pdf, doc.body || '', margin, y, contentW, 10, (newY) => {
    pdf.addPage();
    return newY === undefined ? margin : margin;
  });

  const safe = (doc.title || 'document').replace(/[^\w.-]+/g, '_').slice(0, 60);
  pdf.save(`${safe}.pdf`);
}
```

> **`addFormattedText` page-break contract:** its 7th arg `onPageBreak?: (newY: number) => number` is called when content overflows; return the new top y. Confirm the exact behavior at `client/src/utils/pdfGenerator.ts:1700` and adapt the callback if it already calls `addPage()` internally (in that case return `margin`). The signature is fixed: `addFormattedText(doc, rawText, x, y, maxWidth, fontSize?, onPageBreak?): number`.

- [ ] **Step 2: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Visual verify (manual, after a build or in dev)**

After Task 6 exists, open a document in the editor → click the printer icon → a PDF downloads. Render it: `pdftoppm -png -r 100 <downloaded>.pdf /tmp/docpdf && open /tmp/docpdf-1.png`. Confirm title, metadata band, and a body with **bold**, *italic*, ~~strike~~, and a nested outline list all render (canvas/jsPDF draws aren't jsdom-testable — project memory).

- [ ] **Step 4: Commit**

```bash
git add client/src/utils/documentPdf.ts
git commit -m "feat(docs): generateDocumentPdf — Arial-only PDF via shared addFormattedText"
```

---

### Task 6: `DocumentEditor` component

**Files:**
- Create: `client/src/pages/docs/DocumentEditor.tsx`

This is the shared editor used by both the library and the call panel. It loads a document by id, edits the title + body (reusing `NoteComposer`), toggles Edit⇄Preview (preview uses the shared `renderFormattedText`), saves/finalizes/reopens, shows a revisions drawer, and exports a PDF.

- [ ] **Step 1: Write the component**

Create `client/src/pages/docs/DocumentEditor.tsx`:

```tsx
import { useEffect, useState, useCallback } from 'react';
import { X, Save, Lock, Unlock, History, Printer, Loader2, RotateCcw } from 'lucide-react';
import NoteComposer from '../dispatch/components/NoteComposer';
import { renderFormattedText } from '../../utils/renderFormatted';
import { docsApi, canEditDocument } from './useDocuments';
import type { DocRecord, DocRevisionMeta } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/ToastProvider';

interface Props {
  documentId: number;
  onClose: () => void;
  onChanged?: () => void; // fired after save/finalize/reopen/delete so lists can refresh
}

export default function DocumentEditor({ documentId, onClose, onChanged }: Props) {
  const { user } = useAuth();
  const { addToast } = useToast();
  const [doc, setDoc] = useState<DocRecord | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showRevisions, setShowRevisions] = useState(false);
  const [revisions, setRevisions] = useState<DocRevisionMeta[]>([]);

  const load = useCallback(async () => {
    try {
      const d = await docsApi.get(documentId);
      setDoc(d);
      setTitle(d.title);
      setBody(d.body || '');
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Failed to load document', 'error');
    }
  }, [documentId, addToast]);

  useEffect(() => { void load(); }, [load]);

  const editable = doc ? canEditDocument(doc, user) : false;
  const dirty = !!doc && (title !== doc.title || body !== (doc.body || ''));

  const save = async () => {
    if (!doc) return;
    setBusy(true);
    try {
      const updated = await docsApi.save(doc.id, { title: title.trim(), body });
      setDoc(updated);
      addToast('Saved', 'success');
      onChanged?.();
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Save failed', 'error');
    } finally { setBusy(false); }
  };

  const finalize = async () => {
    if (!doc) return;
    if (dirty) { addToast('Save before finalizing', 'error'); return; }
    setBusy(true);
    try { setDoc(await docsApi.finalize(doc.id)); addToast('Finalized', 'success'); onChanged?.(); }
    catch (e) { addToast(e instanceof Error ? e.message : 'Finalize failed', 'error'); }
    finally { setBusy(false); }
  };

  const reopen = async () => {
    if (!doc) return;
    setBusy(true);
    try { setDoc(await docsApi.reopen(doc.id)); addToast('Reopened', 'success'); onChanged?.(); }
    catch (e) { addToast(e instanceof Error ? e.message : 'Reopen failed', 'error'); }
    finally { setBusy(false); }
  };

  const openRevisions = async () => {
    if (!doc) return;
    try { setRevisions(await docsApi.revisions(doc.id)); setShowRevisions(true); }
    catch (e) { addToast(e instanceof Error ? e.message : 'Failed to load revisions', 'error'); }
  };

  const restore = async (rev: number) => {
    if (!doc) return;
    setBusy(true);
    try {
      const updated = await docsApi.restore(doc.id, rev);
      setDoc(updated); setTitle(updated.title); setBody(updated.body || '');
      setShowRevisions(false); addToast(`Restored r${rev}`, 'success'); onChanged?.();
    } catch (e) { addToast(e instanceof Error ? e.message : 'Restore failed', 'error'); }
    finally { setBusy(false); }
  };

  const exportPdf = async () => {
    if (!doc) return;
    const { generateDocumentPdf } = await import('../../utils/documentPdf');
    generateDocumentPdf({ ...doc, title, body });
  };

  if (!doc) {
    return (
      <div className="flex items-center justify-center p-8 text-[#888888]">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#000000]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#232323] flex-shrink-0">
        <input
          className="input-dark flex-1 text-sm font-semibold"
          value={title}
          disabled={!editable}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Document title"
        />
        <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm font-bold ${doc.status === 'finalized' ? 'text-[#000] bg-[#d4a017]' : 'text-[#d4a017] border border-[#d4a017]/40'}`}>
          {doc.status}
        </span>
        <span className="text-[9px] text-[#666] font-mono">r{doc.revision}</span>
        <button type="button" aria-label="Revisions" title="Revisions" className="toolbar-btn p-1" onClick={openRevisions}><History className="w-3.5 h-3.5" /></button>
        <button type="button" aria-label="Export PDF" title="Export PDF" className="toolbar-btn p-1" onClick={exportPdf}><Printer className="w-3.5 h-3.5" /></button>
        <button type="button" aria-label="Close" title="Close" className="toolbar-btn p-1" onClick={onClose}><X className="w-3.5 h-3.5" /></button>
      </div>

      {/* Toolbar row */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#232323] flex-shrink-0">
        <button type="button" className={`text-[10px] px-2 py-0.5 rounded-sm ${!preview ? 'bg-[#88888830] text-white' : 'text-[#888]'}`} onClick={() => setPreview(false)}>Edit</button>
        <button type="button" className={`text-[10px] px-2 py-0.5 rounded-sm ${preview ? 'bg-[#88888830] text-white' : 'text-[#888]'}`} onClick={() => setPreview(true)}>Preview</button>
        <div className="flex-1" />
        {editable && (
          <button type="button" disabled={busy || !dirty} className="toolbar-btn toolbar-btn-primary text-[10px] px-2 py-0.5 flex items-center gap-1 disabled:opacity-40" onClick={save}>
            <Save className="w-3 h-3" /> Save
          </button>
        )}
        {editable && doc.status === 'draft' && (
          <button type="button" disabled={busy} className="toolbar-btn text-[10px] px-2 py-0.5 flex items-center gap-1" onClick={finalize}>
            <Lock className="w-3 h-3" /> Finalize
          </button>
        )}
        {doc.status === 'finalized' && (user?.role === 'admin' || user?.role === 'manager' || doc.owner_username === user?.username) && (
          <button type="button" disabled={busy} className="toolbar-btn text-[10px] px-2 py-0.5 flex items-center gap-1" onClick={reopen}>
            <Unlock className="w-3 h-3" /> Reopen
          </button>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4">
        {preview ? (
          <div className="text-[#e5e7eb] text-sm leading-relaxed whitespace-pre-wrap max-w-[850px] mx-auto">
            {body ? renderFormattedText(body) : <span className="text-[#545454]">(empty)</span>}
          </div>
        ) : editable ? (
          <div className="max-w-[850px] mx-auto">
            <NoteComposer value={body} onChange={setBody} rows={24} maxLength={100000} placeholder="Write the document…" />
          </div>
        ) : (
          <div className="text-[#e5e7eb] text-sm leading-relaxed max-w-[850px] mx-auto">
            {body ? renderFormattedText(body) : <span className="text-[#545454]">(empty)</span>}
            <p className="text-[10px] text-[#666] mt-4">{doc.status === 'finalized' ? 'Finalized — reopen to edit.' : 'Read-only — you are not the owner.'}</p>
          </div>
        )}
      </div>

      {/* Revisions drawer */}
      {showRevisions && (
        <div className="absolute inset-0 bg-black/70 flex justify-end" onClick={() => setShowRevisions(false)}>
          <div className="w-[340px] h-full bg-[#0b0b0b] border-l border-[#232323] p-3 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-wider text-[#d4a017] font-semibold">Revision history</span>
              <button type="button" aria-label="Close revisions" className="toolbar-btn p-1" onClick={() => setShowRevisions(false)}><X className="w-3 h-3" /></button>
            </div>
            {revisions.map((r) => (
              <div key={r.id} className="flex items-center gap-2 py-1.5 border-b border-[#1a1a1a] text-[11px]">
                <span className="font-mono text-[#888] w-8">r{r.revision_number}</span>
                <span className="flex-1 min-w-0 truncate text-[#ccc]" title={r.change_note || ''}>{r.saved_by_username || 'system'} · {r.saved_at}</span>
                {editable && (
                  <button type="button" aria-label={`Restore r${r.revision_number}`} title="Restore this revision" className="toolbar-btn p-1" onClick={() => restore(r.revision_number)}><RotateCcw className="w-3 h-3" /></button>
                )}
              </div>
            ))}
            {revisions.length === 0 && <p className="text-[10px] text-[#666]">No revisions.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
```

> **`addToast` signature check:** confirm `useToast()` returns `{ addToast(message, type) }` with `type` ∈ `'success'|'error'|'info'`. If the project's signature differs (e.g. `addToast({ message, type })`), adapt the calls. Grep: `grep -n "addToast" client/src/components/ToastProvider.tsx`.

- [ ] **Step 2: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: PASS. Resolve any `addToast`/`useAuth` shape mismatches per the note above.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/docs/DocumentEditor.tsx
git commit -m "feat(docs): DocumentEditor — title+body editor, preview, finalize/reopen, revisions, PDF"
```

---

### Task 7: `DocsLibraryPage` + route + apps-shelf card

**Files:**
- Create: `client/src/pages/docs/DocsLibraryPage.tsx`
- Modify: `client/src/App.tsx` (lazy import + route)
- Modify: `client/src/pages/documents/DocumentsAppsShelf.tsx` (add a card)

- [ ] **Step 1: Write `DocsLibraryPage.tsx`**

Create `client/src/pages/docs/DocsLibraryPage.tsx`:

```tsx
import { useEffect, useState, useCallback } from 'react';
import { FileText, Plus, Search, Loader2 } from 'lucide-react';
import PanelTitleBar from '../../components/PanelTitleBar';
import DocumentEditor from './DocumentEditor';
import { docsApi } from './useDocuments';
import type { DocListItem } from '../../types';
import { useToast } from '../../components/ToastProvider';

export default function DocsLibraryPage() {
  const { addToast } = useToast();
  const [items, setItems] = useState<DocListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [mine, setMine] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'' | 'draft' | 'finalized'>('');
  const [openId, setOpenId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await docsApi.list({ q: q || undefined, mine, status: statusFilter || undefined }));
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Failed to load documents', 'error');
    } finally { setLoading(false); }
  }, [q, mine, statusFilter, addToast]);

  useEffect(() => { void refresh(); }, [refresh]);

  const createNew = async () => {
    try {
      const created = await docsApi.create({ title: 'Untitled document' });
      setOpenId(created.id);
    } catch (e) { addToast(e instanceof Error ? e.message : 'Create failed', 'error'); }
  };

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="DOCUMENTS LIBRARY" icon={FileText} />

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-[#666]" />
          <input className="input-dark w-full text-xs pl-7" placeholder="Search titles…" value={q}
            onChange={(e) => setQ(e.target.value)} />
        </div>
        <label className="flex items-center gap-1 text-[10px] text-[#888]">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Mine
        </label>
        <select className="input-dark text-xs" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as '' | 'draft' | 'finalized')}>
          <option value="">All</option>
          <option value="draft">Draft</option>
          <option value="finalized">Finalized</option>
        </select>
        <button type="button" className="toolbar-btn toolbar-btn-primary text-xs px-3 py-1 flex items-center gap-1" onClick={createNew}>
          <Plus className="w-3.5 h-3.5" /> New Document
        </button>
      </div>

      {loading ? (
        <div className="flex items-center text-[#888] text-xs"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-[#545454] text-xs py-8 text-center">No documents. Create one to get started.</div>
      ) : (
        <table className="w-full text-left">
          <thead>
            <tr className="text-[9px] uppercase tracking-wider text-[#888] border-b border-[#232323]">
              <th className="py-[3px] font-semibold">Title</th>
              <th className="py-[3px] font-semibold">Status</th>
              <th className="py-[3px] font-semibold">Owner</th>
              <th className="py-[3px] font-semibold">Updated</th>
            </tr>
          </thead>
          <tbody>
            {items.map((d) => (
              <tr key={d.id} className="text-[11px] border-b border-[#141414] hover:bg-[#0b0b0b] cursor-pointer" onClick={() => setOpenId(d.id)}>
                <td className="py-[2px] text-[#e5e7eb]">{d.title}</td>
                <td className="py-[2px]"><span className={d.status === 'finalized' ? 'text-[#d4a017]' : 'text-[#888]'}>{d.status}</span></td>
                <td className="py-[2px] text-[#888]">{d.owner_username || '—'}</td>
                <td className="py-[2px] text-[#666] font-mono">{d.updated_at || d.created_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {openId != null && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="relative w-full max-w-[1000px] h-[88vh] bg-[#000] border border-[#232323] rounded-[2px] overflow-hidden">
            <DocumentEditor documentId={openId} onClose={() => { setOpenId(null); void refresh(); }} onChanged={refresh} />
          </div>
        </div>
      )}
    </div>
  );
}
```

> **`PanelTitleBar` prop check:** confirm it accepts `{ title, icon }` (CLAUDE.md shows this usage). If `icon` expects a rendered element rather than a component, adapt (`icon={<FileText />}`). Grep: `grep -n "interface.*Props\|icon" client/src/components/PanelTitleBar.tsx`.

- [ ] **Step 2: Add the route in `client/src/App.tsx`**

Next to the other lazy imports (around line 164, near `DocumentsPage`/`DocumentWriterPage`), add:

```ts
const DocsLibraryPage = lazyRetry(() => import('./pages/docs/DocsLibraryPage'));
```

Next to the other routes (around line 507, near `/documents` and `/document-writer`), add:

```tsx
            <Route path="/docs" element={<RouteErrorBoundary><DocsLibraryPage /></RouteErrorBoundary>} />
```

- [ ] **Step 3: Add the apps-shelf card in `client/src/pages/documents/DocumentsAppsShelf.tsx`**

In the `<div className="flex flex-wrap gap-2">` card row (after the "Document Writer" card button), add:

```tsx
        <button type="button" onClick={() => navigate('/docs')} className={cardCls}>
          <FileText className="w-5 h-5 text-[#d4a017] flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-xs text-white font-semibold group-hover:text-[#d4a017]">Documents Library</div>
            <div className="text-[10px] text-rmpg-500">Authored narratives & reports — formatted, versioned, attachable to calls</div>
          </div>
        </button>
```

(`navigate` and `FileText` are already imported in that file.)

- [ ] **Step 4: Typecheck + build**

Run: `cd client && npx tsc --noEmit && npx vite build`
Expected: PASS (build succeeds; `/docs` chunk emitted).

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/docs/DocsLibraryPage.tsx client/src/App.tsx client/src/pages/documents/DocumentsAppsShelf.tsx
git commit -m "feat(docs): Documents Library page + /docs route + apps-shelf card"
```

---

### Task 8: `CallDocumentsPanel` + DispatchPage "Documents" tab

**Files:**
- Create: `client/src/pages/dispatch/components/CallDocumentsPanel.tsx`
- Modify: `client/src/pages/dispatch/DispatchPage.tsx` (tab union, tab strip array/labels/icons, tab panel)

- [ ] **Step 1: Write `CallDocumentsPanel.tsx`**

Create `client/src/pages/dispatch/components/CallDocumentsPanel.tsx`:

```tsx
import { useEffect, useState, useCallback } from 'react';
import { FileText, Plus, Link2, X, Loader2, Unlink } from 'lucide-react';
import DocumentEditor from '../../docs/DocumentEditor';
import { docsApi } from '../../docs/useDocuments';
import type { DocListItem } from '../../../types';
import { useToast } from '../../../components/ToastProvider';

interface Props {
  callId: number;
}

export default function CallDocumentsPanel({ callId }: Props) {
  const { addToast } = useToast();
  const [items, setItems] = useState<DocListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<number | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<DocListItem[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await docsApi.list({ targetType: 'call', targetId: callId }));
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Failed to load documents', 'error');
    } finally { setLoading(false); }
  }, [callId, addToast]);

  useEffect(() => { void refresh(); }, [refresh]);

  const createLinked = async () => {
    try {
      const created = await docsApi.create({ title: 'Untitled document', links: [{ target_type: 'call', target_id: callId }] });
      setOpenId(created.id);
    } catch (e) { addToast(e instanceof Error ? e.message : 'Create failed', 'error'); }
  };

  const runSearch = async () => {
    try { setResults(await docsApi.list({ q: search || undefined, limit: 20 })); }
    catch (e) { addToast(e instanceof Error ? e.message : 'Search failed', 'error'); }
  };

  const attach = async (docId: number) => {
    try { await docsApi.link(docId, 'call', callId); setAttaching(false); setSearch(''); setResults([]); await refresh(); addToast('Attached', 'success'); }
    catch (e) { addToast(e instanceof Error ? e.message : 'Attach failed', 'error'); }
  };

  const detach = async (docId: number) => {
    try {
      const d = await docsApi.get(docId);
      const link = (d.links || []).find((l) => l.target_type === 'call' && l.target_id === callId);
      if (link) { await docsApi.unlink(docId, link.id); await refresh(); addToast('Detached', 'success'); }
    } catch (e) { addToast(e instanceof Error ? e.message : 'Detach failed', 'error'); }
  };

  return (
    <div className="border-t border-[#2b2b2b] pt-3 flex-1 flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-2 flex-shrink-0">
        <label className="field-label !flex items-center gap-1.5" style={{ color: '#d4a017', fontSize: '9px', letterSpacing: '0.05em' }}>
          <FileText className="w-3 h-3" /> Documents
        </label>
        <div className="flex gap-1">
          <button type="button" className="toolbar-btn text-[9px] px-2 py-0.5 flex items-center gap-1" onClick={() => setAttaching(true)}><Link2 className="w-3 h-3" /> Attach</button>
          <button type="button" className="toolbar-btn toolbar-btn-primary text-[9px] px-2 py-0.5 flex items-center gap-1" onClick={createLinked}><Plus className="w-3 h-3" /> New</button>
        </div>
      </div>

      <div className="space-y-1 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center text-[#888] text-[10px]"><Loader2 className="w-3 h-3 animate-spin mr-1" /> Loading…</div>
        ) : items.length === 0 ? (
          <div className="text-[#545454] text-[10px] py-6 text-center">No documents linked to this call.</div>
        ) : items.map((d) => (
          <div key={d.id} className="group flex items-center gap-2 text-xs px-2 py-1.5 rounded-sm hover:bg-[#18181820]" style={{ borderLeft: '2px solid #88888840' }}>
            <FileText className="w-3 h-3 text-[#888] shrink-0" />
            <button type="button" className="flex-1 min-w-0 truncate text-left text-[#e5e7eb] hover:text-white" onClick={() => setOpenId(d.id)}>{d.title}</button>
            <span className={`text-[8px] uppercase ${d.status === 'finalized' ? 'text-[#d4a017]' : 'text-[#666]'}`}>{d.status}</span>
            <button type="button" aria-label="Detach document" title="Detach" className="opacity-0 group-hover:opacity-100 p-1 text-[#888] hover:text-[#ef4444]" onClick={() => detach(d.id)}><Unlink className="w-3 h-3" /></button>
          </div>
        ))}
      </div>

      {/* Attach existing */}
      {attaching && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setAttaching(false)}>
          <div className="w-full max-w-[480px] bg-[#0b0b0b] border border-[#232323] rounded-[2px] p-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-wider text-[#d4a017] font-semibold">Attach existing document</span>
              <button type="button" aria-label="Close" className="toolbar-btn p-1" onClick={() => setAttaching(false)}><X className="w-3 h-3" /></button>
            </div>
            <div className="flex gap-1 mb-2">
              <input className="input-dark flex-1 text-xs" placeholder="Search titles…" value={search}
                onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void runSearch(); }} />
              <button type="button" className="toolbar-btn text-xs px-2" onClick={runSearch}>Search</button>
            </div>
            <div className="max-h-[300px] overflow-y-auto space-y-1">
              {results.map((d) => (
                <button key={d.id} type="button" className="w-full flex items-center gap-2 text-xs px-2 py-1 rounded-sm hover:bg-[#18181820] text-left" onClick={() => attach(d.id)}>
                  <FileText className="w-3 h-3 text-[#888]" />
                  <span className="flex-1 min-w-0 truncate text-[#e5e7eb]">{d.title}</span>
                  <span className="text-[8px] text-[#666]">{d.status}</span>
                </button>
              ))}
              {results.length === 0 && <p className="text-[10px] text-[#545454] text-center py-4">Search to find a document.</p>}
            </div>
          </div>
        </div>
      )}

      {/* Editor overlay */}
      {openId != null && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="relative w-full max-w-[1000px] h-[88vh] bg-[#000] border border-[#232323] rounded-[2px] overflow-hidden">
            <DocumentEditor documentId={openId} onClose={() => { setOpenId(null); void refresh(); }} onChanged={refresh} />
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the "documents" value to the `detailTab` union (DispatchPage.tsx:343)**

Change line 343 from:

```ts
  const [detailTab, setDetailTab] = useState<'info' | 'persons' | 'timeline' | 'notes' | 'flags' | 'attachments' | 'audit'>('info');
```

to:

```ts
  const [detailTab, setDetailTab] = useState<'info' | 'persons' | 'timeline' | 'notes' | 'documents' | 'flags' | 'attachments' | 'audit'>('info');
```

- [ ] **Step 3: Add the tab to the tab strip (DispatchPage.tsx ~4031-4040)**

In the tab array (line ~4031), add `'documents'` after `'notes'`:

```ts
                {(['info', 'persons', 'timeline', 'notes', 'documents', 'attachments', 'flags', 'audit'] as const).map(tab => {
```

In the `labels` object (line ~4032), add `documents: 'Documents'`:

```ts
                  const labels: Record<string, string> = { info: 'Info', persons: 'Persons / Vehicles', timeline: 'Timeline', notes: 'Notes', documents: 'Documents', attachments: 'Files', flags: 'Flags', audit: 'Audit' };
```

In the `icons` object (line ~4033-4040), add a `documents` entry (uses `FileText`, already imported):

```ts
                    documents: <FileText style={{ width: 9, height: 9 }} />,
```

- [ ] **Step 4: Add the tab panel + import**

Add the import near the other dispatch component imports (e.g. next to `NoteComposer`'s import):

```ts
import CallDocumentsPanel from './components/CallDocumentsPanel';
```

Add the panel in the detail body, right after the attachments tab block (line ~5824, `{detailTab === 'attachments' && selectedCall.id && (`). Insert:

```tsx
                {detailTab === 'documents' && selectedCall.id && (
                  <CallDocumentsPanel callId={Number(selectedCall.id)} />
                )}
```

- [ ] **Step 5: Typecheck + build + full suite**

Run: `cd client && npx tsc --noEmit && npx vitest run && npx vite build`
Expected: PASS (all three).

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/dispatch/components/CallDocumentsPanel.tsx client/src/pages/dispatch/DispatchPage.tsx
git commit -m "feat(docs): per-call Documents tab (CallDocumentsPanel) in dispatch call detail"
```

---

## Phase 5 — Finalize

### Task 9: Service worker bump + full verification

**Files:**
- Modify: `client/public/sw.js` (bump `CACHE_NAME`)

- [ ] **Step 1: Bump the service worker cache name**

In `client/public/sw.js` (line ~605), change:

```js
const CACHE_NAME = 'rmpg-flex-v917';
```

to:

```js
const CACHE_NAME = 'rmpg-flex-v918';
```

> If the current value is not `v917` (the Phase 1 branch tip may have moved), read it first (`grep CACHE_NAME client/public/sw.js`) and increment by one. The bump must be strictly greater than the live value to invalidate caches.

- [ ] **Step 2: Full verification sweep**

Run the complete gate (mirrors CI `pr-tests.yml`):

```bash
# Worker
npm run typecheck
# Client
cd client && npx tsc --noEmit && npx vitest run && npx vite build
```

Expected: all PASS. Note the vitest count includes the 3 new renderer tests + 9 new useDocuments tests on top of the Phase 1 baseline (282).

- [ ] **Step 3: Commit**

```bash
git add client/public/sw.js
git commit -m "chore(sw): bump cache to v918 for document subsystem (Phase 2)"
```

- [ ] **Step 4: Push + open the stacked PR**

```bash
git push -u origin claude/angry-fermi-b6dde8
gh pr create --base claude/reverent-fermat-9b544e --head claude/angry-fermi-b6dde8 \
  --title "Document subsystem (Phase 2): documents model + per-call panel + library" \
  --body "$(cat <<'BODY'
Phase 2 of the dispatch-notes work. Stacked on Phase 1 (#1184).

New server-backed documents model (title, markdown-marker body, owner,
revisions, finalize-lock, many-to-many call/incident links). Surfaced as a
per-call **Documents** tab and a standalone **Documents Library** (/docs,
launched from the Documents apps shelf). Reuses Phase 1's grammar + the
addFormattedText PDF renderer (lifted the browser renderer into a shared helper).

- Migration 0104: `documents`, `document_revisions`, `document_links`
- Worker: `/api/docs` router (CRUD, revisions, finalize/reopen, links)
- Client: DocumentEditor, DocsLibraryPage, CallDocumentsPanel, documentPdf
- Lifecycle: draft → finalized (locked) → reopen → draft; every save snapshots a revision
- SW bumped to v918

**Post-merge:** apply migration 0104 directly to live D1 785de7ae (deploy
pipeline misses live — CLAUDE.md). Verify with pragma_table_info('documents').
After the #1184 → this chain merges, check out main and run typecheck/build
(stacked-merge squash races can drop hunks).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

Expected: PR opens with base = the Phase 1 branch. CI (`pr-tests.yml`) runs worker-typecheck, client-typecheck, client-tests, client-build, plus the column-cap check (passes — no ALTER against watched tables).

---

## Self-Review (completed by plan author)

**Spec coverage:** documents/revisions/links tables → Task 1. `/api/docs` CRUD + lifecycle + links + revisions → Task 2. Shared renderer reuse → Task 3. Types + data layer + permission mirror → Task 4. PDF generator → Task 5. Editor (title/body/preview/finalize/reopen/revisions/PDF) → Task 6. Library + route + shelf card → Task 7. Per-call panel + tab → Task 8. SW bump + verification + stacked PR → Task 9. All spec §4–§10 requirements map to a task.

**Placeholder scan:** No TBD/TODO. Every code step has complete code; the three "confirm signature" notes (`addToast`, `PanelTitleBar`, `addFormattedText` page-break) point at real files with grep commands and a fallback, not deferred work.

**Type consistency:** `DocRecord`/`DocListItem`/`DocRevisionMeta`/`DocLink` are defined in Task 4 and used identically in Tasks 5–8. `docsApi` method names (`list/get/create/save/finalize/reopen/revisions/revision/restore/link/unlink/remove`) are defined once in Task 4 and called consistently. **Ordering fix:** `generateDocumentPdf` is created in Task 5 (PDF) which now runs **before** Task 6 (`DocumentEditor`), so the editor's `await import('../../utils/documentPdf')` resolves under `tsc --noEmit` — TypeScript checks dynamic-import specifiers, so the PDF module must exist first. `canEditDocument`/`buildDocsQuery` signatures match their tests. Worker `canModify` mirrors client `canEditDocument` (admin/manager OR owner; finalized blocks edit).
