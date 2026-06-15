# Spillman Flex structural replica — Records + Dispatch

**Date:** 2026-06-15
**Status:** Design approved (pending spec review)
**Scope:** Re-format the Records tab and the Dispatch tab so their UI is a faithful
structural replica of Spillman Flex (Motorola Solutions), as the **default** look in
both day and night themes. Presentation/relayout only — no API, schema, or
dispatch-engine changes.

## Goal

Make Records and Dispatch look and behave like Spillman Flex's RMS and CAD screens:
the grey window chrome, two-row toolbars, titled group-box forms, and the black,
color-coded CAD status board with a live AVL map. Interactions are **click/drag-first**
(a dispatcher clicks calls/units and drags a unit onto a call to dispatch), with an
optional command line wired to the functions the app already has.

This is explicitly a **reskin + relayout over existing logic**, not a rewrite. All
current data-entry forms, fields, lookups, save paths, and dispatch behavior are
preserved.

## Visual reference (authoritative)

Pulled from Motorola's official, publicly archived manuals:

- Spillman Flex **RMS User Manual** — record screens (Names/Vehicle/Property), chrome,
  group-box forms, selection styling.
  https://archive.org/details/5625238-Manual-Flex-RMS-User-pdf
- Spillman Flex **CAD Administrator Manual** — the live CAD status board (Undispatched
  Calls / Dispatched Calls / Unit Status), priority color codes, command center.
  https://archive.org/download/5625218-Manual-Flex-CAD-Admin-pdf/5625218-Manual-Flex-CAD-Admin-pdf.pdf

### Extracted design language

**RMS / Records screen**
- Grey title bar: record name (left) · screen name (center) · min/max/✕ (right).
- Menu bar: File / Edit / Search / Reports / Tools / Help.
- Two toolbar rows of small icon+label buttons (Exit, Srch, Mod, Add, Del, View, List,
  Prt, Back, Fwd …), with a round photo/avatar at the row's left and a module label.
- Form body: light grey-blue surface, titled **group boxes** ("Name and Address",
  "Personal Identification", "Physical Description", "Traits"), each a faint blue header
  band + dense multi-column label-left / white-field grids, ~11px.
- Selection: list rows highlight steel-blue (white text); involvement grids highlight
  amber. Caution flags = red rounded pill.
- Grey status bar: `User: … · OVR · Rec`.

**CAD / Dispatch board**
- Same title bar; menu File / View / Message Center / CAD Reports / Help.
- Steel-blue **command center band**: module quick-launch buttons (names/law/fire/ems/
  property, each a tiny colored icon) + a live digital clock (right).
- A dense **tool-glyph row**.
- `Command:` combo input with an "All zones" sub-label.
- **Three black-background, monospace, color-coded status windows**:
  - Undispatched Calls — `Call T P Nature R S Address City Zone Stat Time`
  - Dispatched Calls — adds a `Units` column
  - Unit Status — `Unit Zone Time Stat Location`
- **AVL map** window (units + calls plotted; drag a unit onto a call to dispatch).
- Fixed **call priority palette** (cannot be changed): 1 Red · 2 Orange · 3 Yellow ·
  4 Light-green · 5 Med-green · 6 Light-blue · 7 Med-blue · 8 Dark-blue · 9 Purple.

## Current state (what we build on)

- Records already has a partial Spillman skin scoped to `.records-page`
  (`client/src/styles/spillman.css`, tokens in `theme-palettes.css`) plus chrome
  components in `client/src/pages/records/spillman/` (`SpillmanMenuBar`,
  `SpillmanFormTabs`, `SpillmanRecordTabs`). Record tabs:
  `PersonsTab`, `VehiclesTab`, `BusinessTab`, `PropertiesTab`, `EvidenceTab`.
- Dispatch has **no** Spillman skin. `client/src/pages/dispatch/DispatchPage.tsx`
  (~431KB) already holds the full dispatch logic and the handlers we reuse:
  - `handleNewCall`, `handleStatusChange`, `handleClearWithDisposition`
  - `handleAssignUnit`, `handleDragAssignUnit` (drag-to-dispatch already exists),
    `handleUnassignUnit`
  - `calls` / `units` state arrays, `selectedCall` selection, `playTone` for alerts.
- Map assets to reuse: `client/src/components/DispatchMiniMap.tsx`, the
  `applyRmpgBasemap` / marker-builder seam (`mapboxBasemap.ts` / `mapMarkers.ts`),
  and `.tactical-dark` (Map/HUD/MDT stay dark always).
- Theme engine: day/night var-backed tokens + `rmpg_theme_legacy=1` kill-switch
  (unchanged by this work).

## Architecture

### 1. Shared chrome primitives — `client/src/components/spillman/`

A small composable kit so neither page grows and both stay consistent:

- `SpillmanWindow` — grey title bar (title/screen-name/window-controls) + optional
  status bar. Wraps any screen.
- `SpillmanToolbar` — a row of icon+label buttons; supports the two-row Records layout
  and the CAD tool-glyph row. Buttons are declarative (`{icon, label, onClick, disabled}`).
- `SpillmanMenuBar` — generalized from the existing Records `SpillmanMenuBar`.
- `SpillmanGroupBox` — titled field group with the faint-blue header band; children
  laid out in a label-left / white-field grid.
- `SpillmanStatusGrid` — the black, monospace, color-coded data grid. Generic over
  `columns` + `rows` + a `rowColor`/`cellColor` mapper. Used for both Undispatched/
  Dispatched calls and Unit Status. Supports click-select, double-click, right-click
  context menu, and drop targets (for drag-to-dispatch).
- Pure helpers (unit-tested) in `client/src/components/spillman/`:
  - `priorityColor(priority): token` — fixed 1–9 palette.
  - `unitStatusColor(status): token` — ENRT/BUSY/AVAIL/OMDT/XBSY → color.
  - `sortGridRows(rows, sortKey, dir)` — column sort used by the grids.

Tokens: extend `theme-palettes.css` with `--spm-pri-1..9` and `--spm-stat-*`
variables (dark-console values; reused by the grids under `.tactical-dark`).

### 2. Dispatch CAD board — `client/src/pages/dispatch/spillman/`

A new presentation shell that **binds to existing DispatchPage state/handlers** and
arranges existing widgets. It does not duplicate dispatch logic.

Layout under the command bar / tool row / `Command:` line:

```
┌───────────── command center band (modules + live clock) ─────────────┐
├──────────────────────── tool-glyph row ──────────────────────────────┤
├──────────────────────── Command: ____________  [All zones] ──────────┤
│ Undispatched Calls │                          │                       │
│ (status grid)      │       AVL Map            │   Unit Status         │
├────────────────────┤   (Mapbox, tactical-dark │   (status grid)       │
│ Dispatched Calls   │    units + calls,        │                       │
│ (status grid)      │    drag unit → call)     │                       │
└────────────────────┴──────────────────────────┴───────────────────────┘
                         status bar: User: … · zone · OVR Rec
```

Interactions (all bound to existing handlers; click/drag-first):
- Click a call/unit row → select (mirrors `selectedCall`).
- Toolbar buttons + right-click context menu: Dispatch, En-route, On-scene, Available,
  Close → `handleStatusChange` / `handleClearWithDisposition` / `handleAssignUnit`.
- Drag a unit (row or map marker) onto a call (row or map marker) → `handleDragAssignUnit`.
- Double-click a call/unit → open its **data-entry form** (reskinned, fully functional).
- `Command:` line: optional. A thin parser maps Spillman mnemonics (e.g. `ac`, `dc`,
  `uc`, `query …`) to the same handlers. **No** full Spillman command grammar.

Data entry preserved: add-call / modify-call / call-detail forms keep every field,
lookup, and save path; they are re-housed into `SpillmanGroupBox` grids and still call
the existing handlers.

Theming: the board is **dark-always** via `.tactical-dark` (matches Map/MDT/HUD).

### 3. Records structural replica — `client/src/pages/records/spillman/` (+ existing skin)

Wrap the record tabs in `SpillmanWindow` + two `SpillmanToolbar` rows
(Exit/Srch/Mod/Add/Del/View/List/Prt/Back/Fwd + a module row), and lay each record
form's fields into `SpillmanGroupBox` grids (label-left / white-field, ~11px). Reuse
the existing steel-blue row selection and red caution pills. All existing fields,
lookups, and save paths remain.

### 4. Theming & coexistence

Spillman is the **default** look for Records and Dispatch in both day and night (CAD
board dark-always). The day/night engine and `rmpg_theme_legacy=1` kill-switch are
unchanged.

## Phasing (three independently shippable PRs)

- **P0 — Chrome primitives + tokens.** `components/spillman/*` + `--spm-pri-*` /
  `--spm-stat-*` tokens + vitest for the pure helpers. No page wired yet.
- **P1 — Dispatch CAD board.** New `dispatch/spillman/` shell binding to existing
  state/handlers; three status grids + AVL map + command bar/tool row/command line;
  click/drag interactions; data-entry forms re-housed. Replaces the DispatchPage layout.
- **P2 — Records replica.** `SpillmanWindow` + two-toolbar shell + `SpillmanGroupBox`
  forms over the existing record tabs.

Each PR: standard CI gates (worker typecheck, client typecheck, client vitest, client
build) + new vitest for added pure helpers + a `client/public/sw.js` `CACHE_NAME` bump.
Ship via feature branch → `gh pr create` (PR-flow, not direct push).

## Verification

- Pure helpers (`priorityColor`, `unitStatusColor`, `sortGridRows`, command-mnemonic
  parser) covered by vitest.
- Because every form and action still calls the existing handlers, dispatch behavior is
  unchanged — the change is provably presentation-only. Manual browser eyeball of the
  board + a record screen after each deploy (WAF + auth block headless curl).

## Out of scope (YAGNI)

- Full Spillman typed command grammar (we wire mnemonics to existing actions only).
- Freely movable/resizable MDI windows (ship the fixed Spillman default tiling first;
  resizable panels are a later nice-to-have).
- Any data-model, migration, or API change.
- Motorola logos / proprietary marketing assets (look-and-feel only; RMPG branding).

## Risks

- `DispatchPage.tsx` is ~431KB. Mitigation: the board is a **new** shell in
  `dispatch/spillman/` that imports the existing state/handlers via props or a small
  context, rather than editing the megafile in place. Opportunistic extraction only.
- Map perf with many markers: reuse the existing marker-builder seam; no new map engine.
