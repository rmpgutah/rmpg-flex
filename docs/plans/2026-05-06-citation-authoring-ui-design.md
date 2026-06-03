# Citation Authoring UI — Design

**Date:** 2026-05-06
**Author:** brainstormed via `/superpowers:brainstorming`
**Scope:** client/server upgrade to author multi-violation citations, with a typeahead statute picker, a live PDF preview, and a reusable Combobox primitive
**Sequencing:** PDF surface locked first (PR #418); this UI builds on it
**Out of scope:** signature pad capture, body-cam attachment, court-date auto-suggest, payment plan UI

## Background

The 3-copy hotdog-fold citation PDF (commit chain `0f137381` → `67350657`, PRs #417/#418) supports a `violations: CitationViolation[]` array. But `CitationsPage.tsx` (1641 lines) still authors **single-violation** citations through flat fields (`statute_citation`, `offense_level`, `fine_amount`, `violation_description`). Officers can't add a second violation to a citation without editing the database directly. The server has `citation_violations` rows + per-violation routes (`POST/PUT /citations/:id/violations`), but those aren't surfaced anywhere in the UI.

The user's brief (2026-05-06): build the missing authoring surface. Multi-violation stack, live PDF preview, statute typeahead picker, polished dropdowns across the page.

## Approved decisions

| Decision | Choice |
|---|---|
| **Gap to close** | Multi-violation authoring + live PDF preview + statute combobox + dropdown polish |
| **Multi-violation UX** | Stack list — inline cards, "+ Add Violation" button, running total at bottom |
| **PDF preview** | Tri-mode, officer-selectable (persisted to localStorage): modal (default), side-by-side, full-page toggle. Mobile forces modal. |
| **Statute picker** | Combobox (typeahead) backed by `GET /citations/statutes/lookup?q=`. Same generic component reused for vehicle_state, district fields, status filters |
| **Save semantics** | Extend `POST /citations` and `PUT /citations/:id` to accept optional `violations: CitationViolation[]`. Server inserts atomically in a transaction. PUT replaces all rows (delete-and-insert). |
| **Code layout** | Extract authoring into new `<CitationAuthor>` component. CitationsPage stays as list view + router into `<CitationAuthor>` for create/edit modes. |

## Component layout

```
client/src/pages/CitationsPage.tsx     [TRIMMED — list view + filters only;
                                        delegates create/edit to CitationAuthor]
client/src/components/
  Combobox.tsx                          NEW ~200 lines — generic typeahead
  ViolationStack.tsx                    NEW ~150 lines — multi-violation card list
  CitationAuthor.tsx                    NEW ~400 lines — form orchestrator
  CitationPdfPreview.tsx                NEW ~100 lines — tri-mode preview wrapper
client/src/hooks/
  useCitationPreview.ts                 NEW ~50 lines — preview render plumbing
server/src/routes/citations.ts          MODIFIED — POST + PUT accept violations[]
```

Component dependency:
```
CitationsPage
  └─ CitationAuthor
       ├─ <Combobox> (statute, vehicle_state, district, status fields)
       ├─ <ViolationStack>
       │    └─ <Combobox> (statute per row)
       └─ <CitationPdfPreview>
            └─ useCitationPreview(formState, mode)
                 └─ multiCopyPdfV2BlobUrl(...)  ← existing v2 engine
```

## `<Combobox>` API

```typescript
interface ComboboxProps<T> {
  value: T | null;
  onChange: (v: T | null) => void;

  // EITHER sync options...
  options?: T[];

  // ...OR async fetcher (debounced 250ms internally)
  fetcher?: (query: string) => Promise<T[]>;

  // Rendering hooks
  getLabel: (item: T) => string;
  getKey: (item: T) => string | number;
  renderOption?: (item: T) => React.ReactNode;  // default: getLabel

  // Behavior
  placeholder?: string;
  minQueryLength?: number;     // default 0 for sync, 2 for async
  disabled?: boolean;
  error?: string;              // surfaces under input
  allowFreeText?: boolean;     // when true, onChange gets a synthetic { label: typed } on Enter
}
```

Spillman dark styling (matches `input-dark` convention). Keyboard nav: ArrowDown/Up to walk results, Enter to select, Esc to close. Mobile-friendly 44px tap targets and touch-friendly tap-outside-to-close.

## `<ViolationStack>` API + state

```typescript
interface ViolationDraft {
  id: string;                  // client-side uuid (React key)
  statute_id?: number;         // server statute pk, undefined for hand-typed
  statute_citation: string;
  description: string;
  offense_level: 'Infraction' | 'Misdemeanor' | 'Felony';
  fine_amount: number;
}

interface ViolationStackProps {
  value: ViolationDraft[];
  onChange: (next: ViolationDraft[]) => void;
}
```

Each card: statute combobox, description input, offense_level segmented control, fine input. "× Remove" deletes immediately; toast "Removed Violation N — Undo" persists 5s. Running total renders below the last card via `violations.reduce((s, v) => s + (v.fine_amount || 0), 0)`.

Statute combobox auto-fill semantics: when a statute is picked, fill `description` + `offense_level` + `fine_amount` ONLY if the target field is currently empty/unset. If the officer typed something, leave it. If they later edit the fine to differ from the statute's `default_fine`, render a subtle pill "Differs from default ($X)".

## `<CitationPdfPreview>` + `useCitationPreview`

```typescript
type PreviewMode = 'modal' | 'side' | 'full';

function useCitationPreview(form: CitationFormState, mode: PreviewMode): {
  blobUrl: string | null;
  refresh: () => void;
  isRendering: boolean;
};
```

- `'modal'` and `'full'`: `refresh()` called on open. No background work.
- `'side'`: auto-refreshes via 500ms debounce on `form` changes.
- All three call `multiCopyPdfV2BlobUrl(citationSchema, formToData(form), CITATION_INSTRUCTIONS)` from `client/src/utils/pdf/v2/index.ts`.
- Blob URL revoked on next refresh (no leaks).

Toolbar in `CitationAuthor`:
```
[ Preview ▾ ] [ ◫ Side ] [ ⛶ Full ]
```
Active mode highlighted. Selection persists to `localStorage.setItem('rmpg.citation.preview_mode', mode)`.

Mobile (viewport ≤ 768px): forced to `'modal'` regardless of saved preference; the toggle buttons hide.

## Server changes

`server/src/routes/citations.ts`:

### POST /

Accept optional `violations: CitationViolationInput[]`. Insert the citation row, then loop-insert violations in the same transaction. `tx.lastInsertRowid` is the new citation id.

```typescript
interface CitationViolationInput {
  statute_id?: number;
  statute_citation: string;
  description: string;
  offense_level: 'Infraction' | 'Misdemeanor' | 'Felony';
  fine_amount: number;
}
```

If `violations` is missing/empty, behavior unchanged (single-violation flat fields).

### PUT /:id

Same `violations[]` accepted. Strategy = **replace**:
1. `DELETE FROM citation_violations WHERE citation_id = ?`
2. Loop-insert the new rows
3. Wrapped in same transaction as the citation row update

Simpler than diffing. Safe for the small N (typically 1–3 violations). The audit logger records the replacement as one update event.

## Behavior decisions

| Decision | Pick |
|---|---|
| Statute auto-fill | Combobox selection fills `description` + `offense_level` + `fine_amount` only when target field is empty/untouched |
| Fine override | Officer edits freely. Subtle "Differs from default ($X)" pill if fine ≠ statute.default_fine |
| Violation remove | Immediate, 5s undo toast |
| Min violations | 0 allowed (back-compat with v2 PDF flat-fields fallback) |
| Empty fine | Allowed. Renders `$0.00`. |
| Statute API errors | Inline error in Combobox; doesn't block submit (officer can hand-type) |
| Preview mode persistence | `localStorage['rmpg.citation.preview_mode']` |
| Mobile preview | Forced `'modal'` ≤768px |

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| `<Combobox>` complexity creep | Lock the props shape now. Defer multi-select, async-with-sync-fallback, custom-render-input until a 2nd consumer demands them. |
| Live-preview re-render perf | Render is client-side via `multiCopyPdfV2BlobUrl` (no network). 500ms debounce. Profile on a Toughbook (FZ-55) and bump debounce to 1000ms if frames drop. |
| PUT replace semantics losing history | The `audit_log` already records full before/after JSON; replacement is one diffable record. If forensic chain-of-custody requires per-violation deletion records, escalate to a Phase-2 follow-up. |
| Multi-tenant statute catalog | `/statutes/lookup` already filters by db. If RMPG ships to non-Utah agencies, the lookup result shape stays the same — only the catalog rows differ. |
| Existing `/violations` per-row routes | Keep them. They're useful for ad-hoc post-issuance corrections (e.g., a clerk amending one violation's disposition without re-submitting the whole citation). |

## Verification path

1. Unit tests for `<Combobox>` keyboard nav + selection + error rendering (~8 tests)
2. Unit tests for `<ViolationStack>` add/remove/reorder/total (~6 tests)
3. Unit tests for `useCitationPreview` render hook (~3 tests — mode switching + debounce)
4. Server integration tests for `POST /citations` with `violations[]` (~5 tests, supertest harness — single-violation back-compat, multi-violation atomic insert, partial-failure rollback)
5. Server integration tests for `PUT /citations/:id` with `violations[]` (~3 tests — replace semantics)
6. Visual smoke: run dev server, author a 2-violation citation, verify side-by-side preview reflects changes, save, reload, confirm both violations rehydrate
7. Production smoke after deploy: author a real 2-violation citation, print via View button, confirm hotdog-fold renders both violations

## Scope estimate

| | Lines |
|---|---|
| New components | ~850 |
| Hook | ~50 |
| CitationsPage refactor (extraction) | ~200 modified, ~600 removed |
| Server routes | ~80 modified |
| Tests | ~300 |
| **Total touch** | **~2080 lines** |

**Effort:** ~10-14 hours focused work, ~2 sessions if subagent-driven.

## Approval status

Brainstormed and approved 2026-05-06:
- Q1 (gap): A + C + D + dropdown polish
- Q2 (multi-violation UX): A — stack list
- Q3 (preview): C + A + D — tri-mode, officer-selectable
- Q4 (statute picker): A — combobox
- Q5 (save): A — extend POST/PUT with violations[]
- Architecture: 1 — extract `<CitationAuthor>` into a child component

Implementation plan to follow via `/superpowers:writing-plans`.
