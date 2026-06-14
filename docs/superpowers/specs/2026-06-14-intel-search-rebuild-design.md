# Intel Search & Dossier — Repair + Rebuild (one focused PR)

**Date:** 2026-06-14
**Author:** Claude (with Christopher Zamora)
**Scope:** One PR. Repairs the search→dossier core, rebuilds its UI to
command-center grade, and advances the deepen-search→dossier workflow.
**Deferred (named fast-follows, NOT dropped):** Map/geospatial phase,
full report-development loop UI, AI-analyst-central.

---

## 1. Diagnosis (verified against live D1 `785de7ae`)

The subsystem is **wired end-to-end** — every client `apiFetch` maps to a real
Worker endpoint; all migrations (0098/0099/0100/0104/0107) are present on live.
"Broken" decomposes into three distinct things:

| Symptom | Real cause | Evidence |
|---|---|---|
| Weak / "messy" search | **Thin presentation**, NOT bad data. Both search endpoints already collapse duplicates. | `/query` (intelQuery.ts:27-28, 93) and `/search` (intel.ts:70) both key hits by `${type}:${id}` in a `Map` and compute facets from the deduped set. The stale index dupes (`carlos*` returns id 64/65 twice in raw SQL) are **invisible** to the UI. Results look weak because cards are flat/ungrouped with no relevance cue. |
| "Blank panes" | Thin sections + a **dead associates path** | `IntelContextPanel` fetches `DossierLite.associates` (IntelContextPanel.tsx:17) but **never renders it**. `WatchlistSection` is bare. |
| Thin / placeholder feel | Surfaces are 13–72 lines; result cards lack grouping, score, date, keyboard nav | IntelSearch.tsx (72), Dashboard (47), sections (13–25). |

**Backend is healthy and already de-dupes** — no endpoint rebuild, no read-path
dedupe needed. Fixes are UI + workflow, plus one optional hygiene reindex.

## 2. Architecture (unchanged backbone)

Keep the tri-pane portal: `IntelPortalLayout` (rail · `<Outlet/>` · `IntelContextPanel`)
with `IntelContext` as the single selection seam. All new interactions flow
through `selectEntity()` — surfaces never reach into the panel directly. This
is the contract; the rebuild respects it.

## 3. Work items

### A. Repair (root causes)

**A1 — (Already done — no work.)** Read-path de-dupe is implemented in BOTH
`/query` (intelQuery.ts:27) and `/search` (intel.ts:70). No task. Verified during
planning; documented here so a future reader doesn't re-add it.

**A2 — Purge stale index dupes (operational hygiene, optional).**
After merge, trigger `POST /api/intel/reindex` (admin) on live to rebuild the
index cleanly and verify person index rows == persons table. Cosmetic only
(users never see the dupes); listed as a post-merge step in the PR body.

**A3 — Non-blank sections.**
`WatchlistSection` and any overview-fed section get an explicit, branded
empty-state ("All clear — no active watches") and a consistent card frame, so a
quiet feed reads as *calm*, never *broken*.

### B. Rebuild UI (command-center grade)

**B1 — `IntelSearch` results.** Group clustered hits under entity-type section
headers (PERSONS / VEHICLES / WARRANTS …) using existing `TYPE_LABELS`. Add a
live result count, a compact bm25-derived relevance bar, and a `date` line where
present. Keyboard nav: ↑/↓ move a highlighted card, Enter selects (drives panel),
Cmd/Ctrl+Enter opens the record. Surface recent + saved searches as chips under
the bar (data already exists via `useSavedSearches`).

**B2 — `IntelContextPanel` dossier peek.** Add person photo (via
`authedImageUrl`), keep escalation gauge + timeline, and **render associates**
(B-advance below). Add an inline action row: Watchlist toggle, Start report.

### C. Advance — deepen search→dossier

**C1 — Associate navigation.** Render `dossier.associates` as clickable rows
(name + shared-incident count). Click → `selectEntity('person', associate.id, name)`
→ panel re-loads that associate's dossier. Walk the network without leaving the
panel. Pure client; data already returned by `GET /intel/dossier/person/:id`.

**C2 — Watchlist toggle from anywhere.** A reusable `useWatchToggle` hook
(POST `/intel/watchlist`, DELETE `/intel/watchlist/:type/:id`) wired into the
dossier action row and the search result card. Optimistic state; reflects
`dossier.watched`.

**C3 — "Start intel report from this entity" seam.** Action button in the
dossier panel that navigates to `/intel/reports` with the entity prefilled
(query param `?from=person:ID&label=…`), and `IntelReportsPage`'s create modal
reads it to pre-populate title/source. One real foothold into the report loop
without rebuilding the whole development cycle.

## 4. Data flow (after changes)

```
type query → useQueryParser → useIntelQuery → GET /intel/query
  → runIntelQuery (FTS5 MATCH + identifier sniff; already dedupes by type:id)
  → { results, facets }
→ IntelSearch groups by type, keyboard-navigable cards
→ select → IntelContext.selectEntity → IntelContextPanel
  → GET /intel/dossier/person/:id → photo + escalation + timeline + ASSOCIATES
  → click associate → selectEntity(associate) → loop
  → Watchlist toggle (useWatchToggle) / Start report (→ /intel/reports?from=)
```

## 5. Error handling

- De-dupe is pure/total — no new failure modes.
- `useWatchToggle` rolls back optimistic state on rejection and surfaces a small
  inline error; never throws into render.
- Associate rows guard missing `id`/`name` (skip un-navigable associates).
- All new fetches `.catch` to a quiet empty-state, matching existing pattern.

## 6. Testing

- **Worker:** no new worker tests required (no worker logic changes; existing
  `tests/intelQuery.test.ts` stays green). The "Start report" prefill is read
  client-side from query params.
- **Client (vitest):**
  - `useQueryParser` unchanged (existing tests stay green).
  - New: associate-row render + click calls `selectEntity` with associate id.
  - New: `useWatchToggle` optimistic add/remove + rollback on error.
  - New: result grouping puts hits under correct type headers; keyboard ↑/↓/Enter.
- **Typecheck:** worker `npm run typecheck`; client `tsc --noEmit`.
- **Build:** `vite build`. Bump `client/public/sw.js` `CACHE_NAME`.

## 7. Out of scope (this PR)

Map phase, full report development UI, AI-analyst-central, entity resolution
review UX changes, jail-roster ingest UI. Each is its own spec→PR.

## 8. Definition of done

1. Search results are grouped by entity type with a relevance cue and keyboard nav (no longer "thin").
2. Dossier panel shows photo, escalation, timeline, and clickable associates.
3. Watchlist toggle works from search card and dossier panel.
4. "Start report" pre-fills the report create modal.
5. No blank-looking panes — every quiet feed has a branded empty-state.
6. Worker + client typecheck pass; new + existing vitest green; build clean; SW bumped.
7. Shipped via feature branch → PR (pr-tests.yml), per project flow.
