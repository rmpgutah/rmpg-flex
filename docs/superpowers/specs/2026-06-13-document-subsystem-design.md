# Document Subsystem — Word/Pages-style Documents (Phase 2)

**Date:** 2026-06-13
**Status:** Design approved (2026-06-13)
**Scope:** New server-backed `documents` model + revisions + many-to-many links; per-call
Document panel + standalone Documents Library; reuses Phase 1's grammar + PDF renderer.
**Sequencing:** Stacked on the **Phase 1** branch `claude/reverent-fermat-9b544e` (PR #1184, still
open). Phase 2 PR base = that branch; it retargets to `main` once #1184 merges.

> This is **Phase 2** of the dispatch-notes work. Phase 1 (PR #1184) fixed notes print
> formatting and added strikeout + bullet/outline lists + author-editable note entries, and
> introduced the shared grammar module [`noteFormatting.ts`](../../../client/src/utils/noteFormatting.ts).
> Phase 2 was explicitly deferred in the Phase 1 spec (§11 "Out of scope → Phase 2"). This spec
> realizes that target.

---

## 1. Problem / goal

The user wants two things that are really one model:

1. A **per-call narrative document** — a longer, formatted, reopenable write-up attached to a
   dispatch call (beyond the short timeline notes Phase 1 covers).
2. **Named standalone documents** — a Word/Pages-style library of authored documents (reports,
   memos, narratives) that can be created, saved, closed, reopened, and edited.

These are the **same entity** with an optional link. A unified `documents` model serves both: an
unlinked document is a library document; a document linked to a call shows in that call's Document
panel. Documents are **evidentiary**, so they support revision history and a finalize-lock.

## 2. What already exists (and why this is genuinely new)

The namespace is crowded; this model is distinct from all three existing systems:

| Existing | What it is | Why it's not this |
|----------|------------|-------------------|
| client `/documents` → `DocumentsPage` + Worker `/api/documents` (`documentFolders`) | R2 **file-cabinet** (folders + uploaded file bytes) | Stores *files*, not authored rich text |
| `company_documents` (`/api/company-documents`) | Admin-published **policy/SOP** docs (category, required-reading) | Reference library, not user-authored per-call narratives |
| `/document-writer` (`DocumentWriterPage`, TipTap) | Rich word processor | **localStorage-only** — no server persistence, no sharing, no per-call link; schema is lossy (project memory). Not a foundation to build on. |

There is **no `documents` table** today — the name is free. The new subsystem reuses the existing
extension seam: a **"Documents Library" card** on `DocumentsAppsShelf` (which is explicitly designed
for new document tools to "drop in alongside without restructuring the page").

## 3. Key decisions (settled in brainstorming)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Body format** | Phase 1 **lightweight markdown-marker grammar**, plus a `body_format` column defaulting to `'markdown'` | PDF export is **free** via `addFormattedText`; one shared grammar across notes + documents (can't drift); plain-text body is diff-able for revisions and fits a compact per-call panel. `body_format` leaves a zero-cost door open for a future TipTap/HTML body without a migration. |
| **Lifecycle** | **Versioned + finalize-lock**: `DRAFT → FINALIZED (locked) → reopen → DRAFT`; every save snapshots a revision | Evidentiary RMS norm — a finalized report shouldn't silently change, but the close→reopen→edit loop is preserved. |
| **Linking** | **Many-to-many**, polymorphic `document_links(target_type, target_id)` | One library doc (e.g. a BOLO) can attach to several calls; extends to `person`/`case` targets later with no new tables. Trade-off (no FK cascade) is acceptable — calls/incidents are soft-deleted and orphan links are hidden by the JOIN. |
| **Surface** | Per-call **Document panel** + standalone **Documents Library** launched from the apps-shelf card | Discoverable where users already go for documents; avoids a second top-level "Documents" nav item. |
| **Sequencing** | **Stack** Phase 2 on the Phase 1 branch | Phase 2 hard-depends on `noteFormatting.ts` + the PDF fix, which live only on that branch. |

## 4. Data model — migration `0104_documents_subsystem.sql`

Idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`). High-water is `0103`
(verified `ls migrations/`; CLAUDE.md's "0093" is stale). New tables only — **no `ALTER` against
`calls_for_service`/`persons`** (100-col cap is irrelevant here). Per CLAUDE.md, after merge the DDL
is **also applied directly to live D1 `785de7ae`** and verified with `pragma_table_info`.

```sql
-- The document itself. Body is markdown-marker text (Phase 1 grammar).
CREATE TABLE IF NOT EXISTS documents (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL DEFAULT '',
  body_format     TEXT NOT NULL DEFAULT 'markdown',  -- future: 'html'
  status          TEXT NOT NULL DEFAULT 'draft',     -- 'draft' | 'finalized'
  owner_id        INTEGER,
  owner_username  TEXT,                              -- authenticated owner key (not display name)
  revision        INTEGER NOT NULL DEFAULT 1,        -- current revision number
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at      TEXT,
  finalized_at    TEXT,
  finalized_by    TEXT,
  reopened_at     TEXT,
  reopened_by     TEXT,
  deleted_at      TEXT                               -- soft-delete (evidentiary)
);
CREATE INDEX IF NOT EXISTS idx_documents_owner   ON documents(owner_username);
CREATE INDEX IF NOT EXISTS idx_documents_status  ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_deleted ON documents(deleted_at);

-- Immutable snapshot per explicit save / finalize. Full history; never destroyed.
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

-- Polymorphic many-to-many link. No FK on target (polymorphic) — orphans hidden by JOIN.
CREATE TABLE IF NOT EXISTS document_links (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id  INTEGER NOT NULL,
  target_type  TEXT NOT NULL,        -- 'call' | 'incident'  (extensible: 'person','case',...)
  target_id    INTEGER NOT NULL,
  linked_by    INTEGER,
  linked_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  UNIQUE (document_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_doc_links_target ON document_links(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_doc_links_doc    ON document_links(document_id);
```

**Revision semantics:** a revision row = a *saved version of the content*. Create writes
`revision_number = 1`. Each `PUT` snapshots the **new** content with an incremented number and bumps
`documents.revision`. `documents` always holds the latest content; `document_revisions` holds the
full lineage. **Restore** copies an old revision's title/body into a *new* save (new revision) — it
never rewrites or deletes history.

## 5. API — `src/routes/documents/library.ts`, mounted `/api/docs`

New Hono router in a new file alongside `folders.ts` (same `documents/` domain folder). Registered in
[`src/routesConfig.ts`](../../../src/routesConfig.ts) as `{ prefix: '/api/docs', router: documentsLibrary, auth: 'required' }`.
Uses the `getDb`/`query`/`queryFirst`/`execute` helpers from [`utils/db`](../../../src/utils/db.ts).
All D1 calls are `await`ed.

> **Naming note:** `/api/docs` is deliberately distinct from the existing `/api/documents`
> (file-folders). The header comment in `library.ts` must state this so a future maintainer doesn't
> conflate the two.

| Method | Path | Purpose | Gate |
|--------|------|---------|------|
| `GET`  | `/api/docs` | List. Query: `mine`, `status`, `q` (title LIKE), `target_type`+`target_id` (a call's/incident's linked docs), `limit`/`offset`. Excludes `deleted_at`. | READ_ROLES |
| `POST` | `/api/docs` | Create `{ title, body?, change_note?, links?: [{target_type,target_id}] }`. Stamps owner; writes revision 1; creates any initial links. | READ_ROLES (incl. officer) |
| `GET`  | `/api/docs/:id` | Fetch one + its `links` array. | READ_ROLES |
| `PUT`  | `/api/docs/:id` | Save `{ title?, body?, change_note? }`. Bumps `revision`, snapshots a revision row, sets `updated_at`. **409 if `status='finalized'`.** | owner **or** ADMIN_ROLES |
| `POST` | `/api/docs/:id/finalize` | `draft → finalized`; sets `finalized_at/by`. | owner **or** ADMIN_ROLES |
| `POST` | `/api/docs/:id/reopen` | `finalized → draft`; sets `reopened_at/by`. | owner **or** ADMIN_ROLES |
| `GET`  | `/api/docs/:id/revisions` | List revision metadata (no bodies). | READ_ROLES |
| `GET`  | `/api/docs/:id/revisions/:rev` | One revision's full content. | READ_ROLES |
| `POST` | `/api/docs/:id/revisions/:rev/restore` | Restore old content as a new revision (blocked if finalized). | owner **or** ADMIN_ROLES |
| `POST` | `/api/docs/:id/links` | Attach `{ target_type, target_id }` (idempotent via UNIQUE). | READ_ROLES |
| `DELETE`| `/api/docs/:id/links/:linkId` | Detach. | READ_ROLES |
| `DELETE`| `/api/docs/:id` | **Soft-delete** (`deleted_at`). | ADMIN_ROLES |

**Permissions** (mirrors Phase 1's author-edit philosophy):
- `READ_ROLES = [admin, manager, supervisor, officer, dispatcher]` — read + create + link. **Officers
  can author documents** (they write narratives), unlike the dispatch `WRITE_ROLES` set.
- **Edit / finalize / reopen / restore:** owner (`owner_username === user.username`) **OR**
  admin/manager. Returns **403** otherwise.
- **Delete:** admin/manager only (evidentiary).
- Ownership keys on the **authenticated** `owner_username`, never the spoofable display name
  (same rule as Phase 1 notes).

## 6. Lifecycle (state machine)

```
(new) ──POST──▶ DRAFT ──PUT (N×)──▶ DRAFT       each PUT → revision snapshot, revision++
                DRAFT ──finalize──▶ FINALIZED    locked: PUT/restore → 409
            FINALIZED ──reopen────▶ DRAFT        reopened_at/by recorded
                any   ──DELETE────▶ (soft-deleted)   admin/manager only
```

## 7. Client components

| File | Role |
|------|------|
| `client/src/pages/docs/DocsLibraryPage.tsx` **(new)** | Route `/docs`. Searchable/filterable list (mine / all / status / linked). Create, open, status badges. Uses `apiFetch`, `PanelTitleBar`, design tokens. |
| `client/src/pages/docs/DocumentEditor.tsx` **(new)** | Title field + body editor (reuses **`NoteComposer`** with larger `rows`, no `onSubmit`) + **Edit ⇄ Preview** toggle (preview = block-aware `renderFormattedText`) + Save / Finalize / Reopen + **Revisions** drawer + **Print / Export PDF**. Used by both the library and the call panel (modal or full-page). |
| `client/src/pages/docs/useDocuments.ts` **(new)** | Thin `apiFetch` hooks: list/get/create/save/finalize/reopen/link/revisions. |
| `client/src/pages/dispatch/components/CallDocumentsPanel.tsx` **(new)** | In the call detail. Lists docs linked to this call (`GET /api/docs?target_type=call&target_id=ID`); **+ New** (pre-linked), **Attach existing** (library search → `POST /links`), open in `DocumentEditor`, unlink. |
| `client/src/pages/documents/DocumentsAppsShelf.tsx` | **Add a "Documents Library" card** → navigates to `/docs`. |
| `client/src/App.tsx` | Add lazy route `/docs` → `DocsLibraryPage`. |
| `client/src/utils/documentPdf.ts` **(new)** | `generateDocumentPdf(doc)` — title + metadata band (owner, status, dates, linked calls/incidents) + body via `addFormattedText`; `registerArialFont` per the PDF-Arial memory. |

**Reuse from Phase 1 (no new grammar/rendering):** `noteFormatting.ts` (grammar), `NoteComposer`
(editor toolbar + Tab/Enter/shortcuts), the block-aware browser renderer, and `addFormattedText` (PDF).

> The block-aware renderer (`renderFormattedText` + its `renderInline` helper) is currently a local
> `useCallback` in `DispatchPage.tsx` (line ~1729), not exported, and depends only on `renderInline`
> + `computeListLines` — i.e. it is pure and cleanly liftable. **Lift it into a shared helper**
> `client/src/utils/renderFormatted.tsx` and have both the note list and the document preview import
> it, so the browser rendering can't drift (a small, in-scope improvement that avoids a 2nd copy).
> Verify the dispatch note list renders identically after the lift.

## 8. Data flow

```
DocumentEditor (title + NoteComposer body) ──PUT /api/docs/:id {title,body}──▶ documents (latest)
                                                          └─ snapshot ─▶ document_revisions
Library list:   GET /api/docs?mine&q ─────────────▶ rows
Call panel:     GET /api/docs?target_type=call&target_id=ID ──via document_links──▶ rows
Browser view:   doc.body ──renderFormattedText(block-aware)──▶ React rows
PDF:            doc ──generateDocumentPdf→addFormattedText──▶ jsPDF (Arial)
Finalize/Reopen: POST /finalize|/reopen ──▶ status + audit columns
```

## 9. Files

| File | Change |
|------|--------|
| `migrations/0104_documents_subsystem.sql` | **new** — 3 tables + indexes |
| `src/routes/documents/library.ts` | **new** — `/api/docs` Hono router |
| `src/routesConfig.ts` | register `{ prefix: '/api/docs', router, auth: 'required' }` |
| `client/src/pages/docs/DocsLibraryPage.tsx` | **new** |
| `client/src/pages/docs/DocumentEditor.tsx` | **new** |
| `client/src/pages/docs/useDocuments.ts` | **new** |
| `client/src/pages/dispatch/components/CallDocumentsPanel.tsx` | **new** |
| `client/src/utils/documentPdf.ts` | **new** |
| `client/src/utils/renderFormatted.tsx` | **new** — lift the shared block-aware renderer out of `DispatchPage` |
| `client/src/pages/documents/DocumentsAppsShelf.tsx` | add "Documents Library" card |
| `client/src/pages/dispatch/DispatchPage.tsx` | mount `CallDocumentsPanel` in call detail; use shared renderer |
| `client/src/App.tsx` | lazy route `/docs` |
| `client/src/types/index.ts` | `Document`, `DocumentRevision`, `DocumentLink` types |
| `client/public/sw.js` | bump `CACHE_NAME` (currently `v914` on the Phase 1 branch → bump) |

## 10. Testing

- **Unit (vitest):** lifecycle reducer / guard logic (draft→finalize→reopen; finalized edit
  rejected); link add idempotency + dedup; revision-number monotonicity; the list/filter query
  builder. (Grammar/tokenizer already covered by Phase 1's `noteFormatting.test.ts`.)
- **Worker:** `npm run typecheck`. No Worker test harness yet (CLAUDE.md) — add a create→save→
  finalize→reopen smoke test if feasible, else document the manual check.
- **PDF:** `pdftoppm` visual check of a document containing every inline mark + a nested outline list
  (canvas/jsPDF draw calls aren't jsdom-testable — project memory).
- **Auth:** officer edits **own** doc → 200; edits another's → 403; PUT on a finalized doc → 409;
  admin can reopen + soft-delete.
- **Regression:** the per-call panel and library load against live `785de7ae` after the migration is
  applied (`pragma_table_info('documents')`).

## 11. Risks

- **Polymorphic links have no FK to calls/incidents.** A deleted target leaves an orphan link row.
  Mitigated: calls/incidents are soft-deleted (not removed), and the per-call query JOINs on
  `target_id` so orphans simply don't surface. A future cleanup pass can prune if needed. Documented.
- **Stacked-branch merge.** Per the project's stacked-merge memory, after #1184 then #1185 merge,
  **check out main's real content and run typecheck/build** — squash races can silently drop hunks.
  `sw.js` is the predictable conflict point; bump it last.
- **Shared renderer lift.** Extracting `renderFormattedText` from `DispatchPage` must preserve the
  exact block/inline output the note list renders today (verify the note list visually after the lift).
- **Live-D1 migration drift.** `0104` will not reach live via the deploy pipeline reliably — apply it
  directly to `785de7ae` and verify, per CLAUDE.md §"Schema changes".

## 12. Out of scope (YAGNI — deferred)

- TipTap/HTML body (only the `body_format` discriminator is added now).
- Real-time collaborative editing; comments / track-changes.
- Document-to-document linking; folder organization (library is a flat searchable list for v1).
- Per-document ACLs beyond owner/role (no sharing matrix, no client-viewer visibility rules).
- Templates for documents (the Doc Writer already has its own template system; not unified here).
- Attaching documents to `person`/`case`/`vehicle` targets (schema supports it; UI deferred).
