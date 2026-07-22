# Map Tab Orphan Doc Re-Audit & ToolbarDropdownGroup Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the dead `ToolbarDropdownGroup.tsx` component (and its now-fully-dead `TOOLBAR_ITEM_CLASS` dependency), and rewrite `_ORPHANS.md` to reflect what's actually in the tree instead of 24+13+3 phantom rows for files deleted months ago.

**Architecture:** Two independent tasks — a dead-code deletion, and a documentation rewrite — plus a final verification sweep.

**Tech Stack:** React 18 + TypeScript, Vitest.

## Global Constraints

- `DispatchToolPanel.tsx` is left untouched — it's real, working code with a real (if not-yet-decided) future use, unlike `ToolbarDropdownGroup.tsx`.
- No re-creation of any of the 24+13 deleted files, nor `MapCompassRose`/`MapScaleBar`/`KeyboardShortcutsHelp` — all confirmed gone from the tree; resurrecting any of them is new ground-up feature work for a future sprint.
- `CoverageTimeline.tsx` and `SpeedAnalyticsPanel.tsx` are untouched — confirmed already correctly live and wired.

---

### Task 1: Delete `ToolbarDropdownGroup.tsx` and its dead dependency

**Files:**
- Delete: `client/src/pages/map/components/ToolbarDropdownGroup.tsx`
- Delete: `client/src/pages/map/components/__tests__/ToolbarDropdownGroup.test.tsx`
- Modify: `client/src/pages/map/MapboxMapPage.tsx:38-48` (remove the `TOOLBAR_ITEM_CLASS` import line)
- Modify: `client/src/pages/map/utils/mapConstants.ts:262` (remove the now-fully-unused export)

**Interfaces:**
- None — this is a pure deletion with no other consumers (confirmed: `TOOLBAR_ITEM_CLASS`'s only 3 occurrences repo-wide are the `mapConstants.ts` definition, the dead `MapboxMapPage.tsx` import, and `ToolbarDropdownGroup.tsx`'s own usage — all three go away together).

- [ ] **Step 1: Delete the component and its test file**

```bash
git rm client/src/pages/map/components/ToolbarDropdownGroup.tsx client/src/pages/map/components/__tests__/ToolbarDropdownGroup.test.tsx
```

- [ ] **Step 2: Remove the dead `TOOLBAR_ITEM_CLASS` import from `MapboxMapPage.tsx`**

Change:
```tsx
import {
  MapUnit as Unit, ActiveCall, MapProperty as Property,
  UNIT_STATUS_COLORS, UNIT_STATUS_LABELS, PRIORITY_COLORS,
  MAP_STYLE_LABELS,
  TOOLBAR_ITEM_CLASS,
  type MapStyleId,
} from './utils/mapConstants';
```
to:
```tsx
import {
  MapUnit as Unit, ActiveCall, MapProperty as Property,
  UNIT_STATUS_COLORS, UNIT_STATUS_LABELS, PRIORITY_COLORS,
  MAP_STYLE_LABELS,
  type MapStyleId,
} from './utils/mapConstants';
```

- [ ] **Step 3: Remove the now-fully-unused export from `mapConstants.ts`**

In `client/src/pages/map/utils/mapConstants.ts`, delete this line (line 262):
```ts
export const TOOLBAR_ITEM_CLASS = 'bg-surface-raised/95 border border-border-default p-2 backdrop-blur-sm';
```

- [ ] **Step 4: Grep-confirm no remaining references**

Run: `grep -rn "TOOLBAR_ITEM_CLASS\|ToolbarDropdownGroup" client/src`
Expected: no output (both fully removed).

- [ ] **Step 5: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors (both the import and export were confirmed unused elsewhere, so no other file breaks).

- [ ] **Step 6: Run the client test suite**

Run: `cd client && npx vitest run`
Expected: the deleted test file no longer runs (test file count drops by 1); no other test references `ToolbarDropdownGroup` or `TOOLBAR_ITEM_CLASS` (confirmed by the Step 4 grep), so no other test breaks.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/map/MapboxMapPage.tsx client/src/pages/map/utils/mapConstants.ts
git commit -m "chore(map): delete dead ToolbarDropdownGroup.tsx and its TOOLBAR_ITEM_CLASS dependency"
```

(The `git rm` from Step 1 stages the two deletions; this commit picks those up alongside the two modified files.)

---

### Task 2: Rewrite `_ORPHANS.md` to reflect reality

**Files:**
- Modify: `client/src/pages/map/_ORPHANS.md` (full rewrite of the panel table, hook table, and the "Wired in PR #1584" section; header note added)

**Interfaces:**
- None — documentation-only change.

- [ ] **Step 1: Replace the entire file content**

Replace the full current content of `client/src/pages/map/_ORPHANS.md` with:

```markdown
# Map Module — Orphan Inventory

**Re-audited 2026-07-22.** A full existence check (`ls` against every row's file
path) found this doc had drifted badly out of sync with the actual tree: of the
27 panels and 14 hooks previously listed, only 3 panels and 1 hook still exist —
the other 24 panels + 13 hooks were deleted on 2026-05-31 in commit `02546600e4`
("chore: remove 24 dysfunctional map hooks/components with missing API
endpoints"), three weeks *before* this doc was even created (2026-06-22), and
every edit since then touched other rows without anyone re-checking these still
existed. The "Wired in PR #1584" section below was also phantom — all 3 claimed
components (`MapCompassRose`, `MapScaleBar`, `KeyboardShortcutsHelp`) are
likewise absent from the tree with zero references anywhere in `client/src`.
This doc has been rewritten to list only what's genuinely still true today.

The following components and hooks in `client/src/pages/map/` are **fully built,
fully tokenized, and exported — but never imported anywhere in the live app**.

**Disposition:** Keep in tree for now — they're a parked design library. A
future operator-driven sprint can wire any of these up rather than rebuilding
from scratch. **Do not import without first reading the file and confirming
the feature is actually wanted.** If a component here has visibly broken
contracts after schema drift, file an issue rather than silently fixing it.

---

## Orphan panels (`components/`)

These have **zero `import` statements anywhere in `client/src/`** outside their
own file. Verified 2026-07-22 via direct `ls`/`grep` existence + reference checks.

| Component | Likely intent | Notes |
|-----------|----------------|-------|
| `DispatchToolPanel` | Tabbed one-stop dispatch panel (geocode search, isochrone, nearest-unit matrix, tilequery identify) | All 4 backend routes it needs already exist and are live under *separate* existing UI (search box, "Response Zones" dock toggle, routing's closest-unit ranking, the Identify click tool). Wiring this in would either duplicate those 4 features under a second UI or require a real product decision to consolidate them into one panel — not a mechanical wiring task. |

## Orphan hooks (`hooks/`)

| Hook | Likely intent |
|------|---------------|
| `useMapboxSearchBox` | Headless programmatic search (wraps Mapbox Search Box), never mounted anywhere |

## Rules going forward

1. **No silent edits.** Touching an orphan file requires a PR comment
   acknowledging it's orphan + the intent (wire, delete, or refactor).
2. **No reverse-imports.** A live file must never import an orphan (one rogue
   import resurrects the entire dead-code subtree).
3. **Delete or wire batches.** If a sprint wires N of these, audit + delete
   the rest in the same PR so the orphan list shrinks monotonically.
4. **Verify existence before trusting this doc.** This doc has drifted out of
   sync with the actual tree before (see the 2026-07-22 re-audit note above) —
   a quick `ls`/`grep` check on a row costs seconds and prevents research time
   being spent on files that no longer exist.
```

- [ ] **Step 2: Grep-confirm the doc's own claims are accurate**

Run:
```bash
ls client/src/pages/map/components/DispatchToolPanel.tsx client/src/hooks/useMapboxSearchBox.ts
grep -rln "useMapboxSearchBox" client/src
```
Expected: both files exist (first command lists both paths with no error); the second command's output is exactly `client/src/hooks/useMapboxSearchBox.ts` and `client/src/pages/map/_ORPHANS.md` (the hook file itself plus this doc referencing it — no other consumer).

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/map/_ORPHANS.md
git commit -m "docs(map): rewrite _ORPHANS.md to reflect the actual tree after a 2026-07-22 re-audit"
```

---

### Task 3: Final verification sweep

**Files:**
- None (verification only).

- [ ] **Step 1: Full Worker typecheck**

Run: `npm run typecheck`
Expected: passes (no Worker files touched by this plan).

- [ ] **Step 2: Full client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: passes with no new errors versus the pre-branch baseline.

- [ ] **Step 3: Full client vitest suite**

Run: `cd client && npx vitest run`
Expected: passes, one fewer test file than the pre-branch baseline (the deleted `ToolbarDropdownGroup.test.tsx`), no other regressions.

- [ ] **Step 4: Final grep sweep**

Run:
```bash
grep -rn "TOOLBAR_ITEM_CLASS\|ToolbarDropdownGroup\|MapCompassRose\|MapScaleBar\|KeyboardShortcutsHelp" client/src
```
Expected: no output — confirms the deleted component, its dependency, and the three phantom "PR #1584" names have zero remaining references anywhere (including the doc itself, which no longer mentions any of them by those names outside the historical explanation prose already committed in Task 2).

- [ ] **Step 5: Commit (if any fixes were needed)**

Only commit if Steps 1-4 surfaced something to fix. If everything passes cleanly, no commit is needed for this task.
