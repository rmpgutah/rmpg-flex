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
