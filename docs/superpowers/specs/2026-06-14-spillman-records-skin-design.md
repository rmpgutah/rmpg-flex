# Spillman Flex Records Skin — Design

**Date:** 2026-06-14
**Status:** Approved (design)
**Scope:** `client/src/pages/RecordsPage.tsx` + `client/src/pages/records/**` (presentation only)

## Goal

Re-skin the Records page to the literal Motorola **Spillman Flex** grey/steel-blue
enterprise look (per the approved visual-companion mockup), scoped to the Records
page, and built as a reusable layer so the skin can be rolled out app-wide in
follow-up work.

This is a deliberate departure from the app's pure-black/`#d4a017`-gold design
system (CLAUDE.md) **for the Records page only**. The rest of the app
(Dashboard, Dispatch, etc.) stays black/gold in v1. The visual disconnect
between Records and the rest of the shell is an accepted, explicitly-chosen
tradeoff.

## Decisions (locked during brainstorming)

- **Visual target:** literal Spillman grey/steel-blue chrome, worked from
  documented Spillman conventions (no reference screenshots provided).
- **Implementation path:** **Hybrid (C)** — scoped CSS recolor of the existing
  dense detail panels + purpose-built Spillman chrome where fidelity matters
  most (title bar, menu bar, toolbar, record-type tab strip, grouped field
  boxes, identity strip, caution banner).
- **Scope:** Records now, built as a reusable `--spm-*` layer for later
  app-wide rollout.
- **v1 list:** existing row structure recolored to Spillman silver; true
  columnar sortable grids deferred.
- **v1 record-form tabs:** scroll-to-section anchors; real per-tab paneling
  deferred.

## Key technical findings (grounding)

1. **Color tokens are hardcoded hex**, not CSS variables. `rmpg-*`, `brand-*`,
   `blue-*` are literal hex in `client/tailwind.config.js`. Only `surface-*` is
   CSS-variable-backed. Therefore Records cannot be recolored by flipping a
   variable — it requires scoped utility overrides under a wrapper class.
2. **Every detail section renders through one shared component**,
   `client/src/components/CollapsibleSection.tsx` (markup: outer
   `border border-[#2b2b2b]`, a header `<button>`, a `2px` accent stripe).
   Restyling this single component under `.spillman-theme` converts every
   section (Physical Description, Identification, Contact & Address, Legal &
   Associations, …) into a Spillman group-box across **all five tabs** at once.
3. **The Records page is a master-detail `SplitPanel`** (`RecordsPage.tsx`):
   left = `PanelTitleBar` + tab row + stats strip + `<Tab>List`; right =
   `PanelTitleBar` + `<Tab>Detail`. Tabs: Persons / Vehicles / Properties /
   Business / Evidence. All data hooks (`usePersonsTab`, `useVehiclesTab`,
   `usePropertiesTab`, `useEvidenceTab`, `useBusinessTab`) and actions
   (link/delete/archive/export/duplicates, live-sync) remain untouched.

## Architecture

A single wrapper class `.spillman-theme` on the Records page root + a scoped CSS
layer + a small set of new chrome components. Nothing outside
`client/src/pages/records/` (and the one shared CSS file) changes appearance.

### 1. Theme layer — `client/src/styles/spillman.css` (imported once)

Spillman CSS custom properties (reusable, app-wide-ready):

| Token | Value | Use |
|-------|-------|-----|
| `--spm-chrome` | `#d6d3c8` | window/tab silver |
| `--spm-form` | `#ece9dd` | form background |
| `--spm-field` | `#f7f9fb` | sunken field cell |
| `--spm-border` | `#9a958a` | structural borders |
| `--spm-field-border` | `#c3cdd8` | field cell borders |
| `--spm-accent` | `#2e4a66` | steel-blue accent/text |
| `--spm-select` | `#316ac5` | row selection (white text) |
| `--spm-group-head` | `linear-gradient(#eef3f9,#cfdcec)` | group-box header bar |
| `--spm-caution` | `linear-gradient(#fff4d6,#ffe9ad)` | caution banner |
| `--spm-title` | `linear-gradient(#5a7ea6,#2e4a66)` | window title bar |

Scoped overrides under `.spillman-theme`, limited to utilities the Records
subtree actually uses:
- `bg-rmpg-700/800/900/950` → light Spillman surfaces (`--spm-form`/`#fff`/`--spm-chrome`).
- `border-rmpg-600/700` (+ `/NN` alpha variants) → `--spm-border`.
- `text-brand-400`, `text-amber-400` accents → `--spm-accent` where appropriate; base text → `#1a1a1a`.
- `bg-surface-base/raised/sunken` → light surfaces.
- Dark scrollbars (`scrollbar-dark`) → light.
- `CollapsibleSection` restyle → group-box: header gets `--spm-group-head` bar +
  `--spm-accent` bold text, square corners, body uses sunken field cells.

All overrides are scoped under `.spillman-theme` (specificity confined; any
`!important` used only inside that scope) so the rest of the app is unaffected.

### 2. New chrome components — `client/src/pages/records/spillman/`

- `SpillmanTitleBar.tsx` — steel-blue gradient window title bar; reuses
  `PanelTitleBar`'s children/actions API so existing toolbar buttons still mount.
- `SpillmanMenuBar.tsx` — `File / Edit / View / Record / Tools / Window / Help`.
  Mostly cosmetic; a few items wired to existing actions (New, Print, Export, Find/focus search).
- `SpillmanToolbar.tsx` — classic raised buttons wrapping the **existing**
  actions (New <type>, Print, Export, Duplicates, Link, Archive toggle).
  Behavior unchanged — only presentation.
- `SpillmanRecordTabs.tsx` — silver record-type tab strip replacing the current
  pill tab row; same `activeTab`/`setActiveTab` contract and counts.
- `SpillmanIdentityStrip.tsx` — photo + name + DOB/sex/race line + badge chips
  (HIGH RISK / VETERAN / status) for the detail header.
- `SpillmanCautionBanner.tsx` — gold caution bar (officer-safety / supervision flags).

### 3. Record-form tabs (Summary / Physical / Identification / Contact / Cautions / Associations / Involvements)

A thin tab strip in the detail panel whose tabs **scroll to** the matching
`CollapsibleSection`. No rewrite of the large tab files. Real per-tab paneling
is deferred.

## What v1 delivers

- Spillman window chrome: title bar, menu bar, toolbar, status context.
- Silver record-type tabs + left list recolored to silver/white rows with
  **blue row-selection**.
- Detail panel: identity strip, caution banner, and every section as a
  steel-blue **group-box** with sunken field cells — across all five tabs via
  the `CollapsibleSection` restyle.
- One scoped CSS layer; **zero appearance changes** to the rest of the app.

## Explicitly deferred (expand-later)

- True columnar sortable grids per tab (v1 keeps the current row structure,
  recolored).
- Real tabbed record forms (v1 uses scroll-to-section anchors).
- App-wide Spillman rollout (the `--spm-*` layer is built to support it).

## Data flow / behavior

Unchanged. All existing hooks, fetchers, link/delete/archive/export/duplicates,
live-sync, routing, and persisted tab/split state stay exactly as-is. This is a
**presentation-only** change: new components wrap existing actions; CSS recolors
existing markup.

## Risk & testing

- Risk is contained to (a) CSS specificity within the `.spillman-theme` scope and
  (b) the swapped chrome components. No API, no data, no migrations, no other pages.
- Verification (per CLAUDE.md CI gates):
  - `cd client && npx tsc --noEmit`
  - `cd client && npx vitest run`
  - `cd client && npx vite build`
  - Visual pass on each of the five tabs (list + detail) at desktop and mobile widths.
- Bump `CACHE_NAME` in `client/public/sw.js` (client change → cache invalidation).
- Ship via feature branch + PR (per project convention), not direct push.

## Out of scope

- Worker/API changes, D1 migrations.
- Any behavioral change to record CRUD, linking, archiving, exporting.
- Reskinning Dashboard/Dispatch/MDT/etc. (deferred to app-wide rollout).
