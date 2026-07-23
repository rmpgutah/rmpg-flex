# Map Tab Orphan Doc Re-Audit & ToolbarDropdownGroup Cleanup

**Date:** 2026-07-22
**Status:** Approved, pending implementation plan

## Context

`client/src/pages/map/_ORPHANS.md` (last edited 2026-07-21) lists 27 "orphan panels"
and 14 "orphan hooks" as fully-built, fully-tokenized, exported-but-never-imported
code sitting in the tree. A planned "orphan wave" sprint set out to research a
themed cluster (the 6 safety-related entries: `SafetyAlertModal`,
`SafetyDashboardPanel`, `SafetyZonesPanel`, `ThreatAssessmentPanel`,
`useMapSafetyZones`, `useMapThreatAssessment`) to decide what to wire in.

That research found none of the 6 files exist. All were deleted on 2026-05-31 in
commit `02546600e4` ("chore: remove 24 dysfunctional map hooks/components with
missing API endpoints (-15,620 lines)") — three weeks *before* `_ORPHANS.md` was
even created (2026-06-22) — for calling backend endpoints that never existed.
`_ORPHANS.md` was apparently compiled without checking `git ls-tree`, and every
edit since (2026-06-22, 2026-07-20, 2026-07-21) touched other rows without anyone
re-verifying these six still existed.

A full existence check across every row in the doc (`ls` against
`client/src/pages/map/components/` and `client/src/hooks/`) confirmed the doc is
almost entirely phantom:

- **Of 27 listed orphan panels, only 3 files actually exist**: `CoverageTimeline.tsx`,
  `DispatchToolPanel.tsx`, `ToolbarDropdownGroup.tsx`. The other 24 are gone
  (matching the "24 dysfunctional" commit exactly).
- **Of 14 listed orphan hooks, only 1 file actually exists**: `useMapboxSearchBox.ts`
  (already correctly tracked as genuinely orphaned, added in the prior small-fixes
  round). The other 13 are gone.

A follow-up deep-read of the 3 surviving panels found:

- **`CoverageTimeline.tsx` is not orphaned at all** — it's a false positive. It's
  imported and rendered inside `SpeedAnalyticsPanel.tsx`, which is itself imported
  and rendered in `MapboxMapPage.tsx` (toggled via the live "Speed Analytics Panel"
  dock item). Its data comes from `useSpeedZoneStats.ts` hitting live, existing
  `/dispatch/gps/coverage-timeline` and `/dispatch/gps/zone-speed-stats` endpoints.
- **`DispatchToolPanel.tsx` is genuinely orphaned**, but wiring it in is not a
  simple task. All 4 backend routes its 4 sub-tools need (geocode, isochrone,
  nearest-unit matrix, tilequery identify) already exist and are live — under
  *separate* existing UI (the search box, the "Response Zones" dock toggle,
  routing's closest-unit ranking, and the Identify click tool respectively).
  Wiring this component in as-is would either duplicate those 4 existing features
  under a second UI, or require a real product decision to consolidate them into
  one tabbed panel — a design decision, not a mechanical wiring task.
- **`ToolbarDropdownGroup.tsx` is genuinely orphaned and dead.** Its own code
  comment says it exists to deduplicate "the existing 'Advanced map tools'
  expand/collapse pattern" across five floating dropdown-group triggers in
  `MapboxMapPage.tsx` — but that pattern no longer exists; the dock UI migrated to
  the current Right Dock section/toggle-list architecture in an earlier sprint
  this session. Its shared style constant, `TOOLBAR_ITEM_CLASS`, is imported into
  `MapboxMapPage.tsx` (line 47) but never actually used there — confirming the
  pattern it served is fully gone from the live page, not just from this one
  component. Its only other reference anywhere in the repo is its own unit test
  file, which is not evidence of real integration.

## Design

### 1. Delete `ToolbarDropdownGroup.tsx` and its dead dependency

- Delete `client/src/pages/map/components/ToolbarDropdownGroup.tsx`.
- Delete its test file, `client/src/pages/map/components/__tests__/ToolbarDropdownGroup.test.tsx`.
- Remove the now-fully-dead `TOOLBAR_ITEM_CLASS` import from `MapboxMapPage.tsx:47`
  (confirmed unused anywhere else in that file — the import line is its only
  occurrence).

`DispatchToolPanel.tsx` is left untouched — it's real, working code with a real
(if not-yet-decided) future use, unlike `ToolbarDropdownGroup.tsx` which serves a
pattern that's fully gone.

### 2. Rewrite `_ORPHANS.md` to reflect reality

Replace the "Orphan panels" table's 27 rows with the 1 genuine remaining entry
(`DispatchToolPanel`, with an added note that wiring it requires a product
decision on whether to consolidate 4 already-live features, not just adapter
work). Replace the "Orphan hooks" table's 14 rows with the 1 genuine remaining
entry (`useMapboxSearchBox`, unchanged from its current row). Remove the
`ToolbarDropdownGroup` row entirely (it's deleted, not orphaned — deleted code
isn't tracked as an orphan). Remove the "Wired in PR #1584" sub-section's claims
only if they turn out to be similarly stale (verify `MapCompassRose`,
`MapScaleBar`, `KeyboardShortcutsHelp` still exist and are still wired before
touching that section — if they check out, leave that section as-is).

Add a short new note to the doc's header explaining what happened (the doc drifted
out of sync with a large deletion commit) and stating the corrected count, so a
future reader understands why the list shrank so drastically in one commit
without assuming data was silently discarded.

### 3. Remove the phantom "Wired in PR #1584" section

A follow-up existence check on this section's own 3 claimed wins —
`MapCompassRose`, `MapScaleBar`, `KeyboardShortcutsHelp` — found all 3 are also
completely absent from the codebase: no file at their expected path, and zero
references anywhere in `client/src` (via `grep -rln`) other than this doc. This
section is phantom in the same way the panel/hook tables were — either these
were never actually built past this doc entry, or they were removed at some
later point with no corresponding doc update. Either way there is nothing to
verify as "wired" and nothing to delete as code (no such files exist to delete).
Remove this sub-section entirely rather than leaving stale claims of a shipped
feature that isn't in the tree.

## Non-goals

- No decision made here on `DispatchToolPanel.tsx`'s future (wire vs. consolidate
  vs. leave) — that's explicitly deferred as a product-scoping question, not a
  mechanical task this spec covers.
- No changes to `CoverageTimeline.tsx` or `SpeedAnalyticsPanel.tsx` — confirmed
  already correctly live and wired, nothing to do.
- No re-creation of any of the 24+13 deleted files — they were removed
  deliberately for calling nonexistent backend endpoints; resurrecting any of
  them (safety alerts, threat assessment, etc.) is new ground-up feature work
  for a future sprint, not something this spec attempts.
- No re-creation of `MapCompassRose`/`MapScaleBar`/`KeyboardShortcutsHelp` — if a
  compass rose, scale bar, or keyboard-shortcuts-help overlay is genuinely
  wanted, that's new feature work for a future sprint, not something this spec
  attempts.
