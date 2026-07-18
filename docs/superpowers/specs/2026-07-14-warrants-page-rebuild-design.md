# Warrants Page Rebuild — Design

**Date:** 2026-07-14
**Status:** Approved, ready for implementation planning

## Problem

`client/src/pages/WarrantsPage.tsx` is a 4,503-line megafile (CLAUDE.md already
flags it as one of the client's known megafiles). It owns four tabs
(Dashboard, Warrants list, Search-All, Sources), a person-profile drawer, a
new/edit warrant form, a serve modal, BOLO/PDF export flows, and every piece
of state and data-fetching for all of it — with no internal component
boundaries. This makes the file hard to navigate, hard to reason about, and
risky to change (a fix to one tab's logic can accidentally touch unrelated
state declared nearby).

Separately, the visual styling within each tab is dense/tight and
inconsistent with the app's current design-token discipline (spacing,
badge/pill treatment, hierarchy) relative to newer pages built against the
Blue & Silver theme.

## Goals

1. Split `WarrantsPage.tsx` into a thin shell + one container component per
   tab + shared presentational components, so each piece is small enough to
   hold in context and reason about independently.
2. Apply a **moderate visual polish pass** to each tab as it's migrated —
   more breathing room, pill-style status badges, clearer toolbar hierarchy —
   using the existing Blue & Silver CSS-variable-backed Tailwind tokens.
   Approved direction: see "Visual direction" below.
3. **Preserve behavior exactly.** Same tabs, same filters, same workflows,
   same API calls. This is a structural + visual rebuild, not an IA redesign.
4. Ship incrementally, one tab at a time, each verified live before moving to
   the next — not a single big-bang PR.

## Non-goals

- No new features, no new tabs, no new API routes.
- No change to navigation structure, filter placement, or workflow order.
- No new global state management layer — each tab keeps its own local
  data-fetching state via hooks, matching the current pattern.

## Visual direction (approved)

Moderate polish, same layout skeleton. Concretely, relative to today's dense
table styling:

- More padding/breathing room in table rows and toolbars (`py-2`/`py-3`
  instead of `py-[2px]`/`py-[3px]` density where it doesn't fight the
  CLAUDE.md-mandated table density rule — see Open Question below).
- Status badges become pill-shaped with a colored dot + soft background tint
  (`bg-{sev}/15` + `border-{sev}/40`) instead of a bare outlined text badge.
- Subject name cells get a secondary line (e.g. DOB) under the primary name
  for scannability.
- Toolbar buttons get clearer visual weight — a primary action (e.g. "+ New
  Warrant") styled with `bg-brand-blue`, secondary actions styled as outlined
  buttons.
- All colors/spacing come from the existing Blue & Silver CSS-variable
  tokens (`surface-*`, `border-*`, `text-*`, `sev-*`) — no new hex values.

A live mockup comparing current vs. proposed table styling was reviewed and
approved during brainstorming (Option B — "moderate polish").

**Resolved:** CLAUDE.md's global style rule states table rows should be
`11px`/`py-[2px]` dense with no pill badges. The approved visual direction
above conflicts with that rule on two points (padding, pill badges). Decision
(2026-07-14): Warrants is a deliberate, scoped exception — ship the mockup's
looser padding and pill badges as-is. CLAUDE.md has been updated with an
explicit exception note under the Tables rule so this isn't mistaken for
drift in a future audit.

## Architecture

### Shell

`WarrantsPage.tsx` becomes a thin shell: owns `activeTab` state, the
top-level page layout/header, and the tab navigation. It renders exactly one
of the four tab containers based on `activeTab`, passing down only the
cross-cutting context each tab needs (current user, `isAdminOrManager`,
`isGodMode`, `isMobile`) as props — computed once in the shell, not
re-derived per tab.

### Tab containers (one file each, migrated one at a time)

1. `WarrantsDashboardTab.tsx`
2. `WarrantsListTab.tsx` — the primary/highest-traffic tab; migrated **first**
3. `WarrantsSearchAllTab.tsx`
4. `WarrantsSourcesTab.tsx`

Each owns its own data-fetching state (list data, loading, error, filters,
pagination) locally via hooks colocated in that file — no prop-drilling of
warrant data between tabs, matching current behavior (tabs don't share live
state today).

### Shared modals/drawers (extracted once, used by whichever tab needs them)

- `PersonProfileDrawer.tsx`
- `WarrantFormModal.tsx` (new/edit warrant)
- `WarrantServeModal.tsx`

Invoked via `isOpen`/`onClose`/`onSaved`-style props, matching the existing
`ConfirmDialog`/`FormModal` pattern already used elsewhere in the app.

### Shared presentational components (extracted opportunistically, not upfront)

- `StatusPill` — pure, takes a status string + variant, renders the pill
  treatment from the Visual direction section. Used by List, Search-All, and
  Dashboard so all three pick up the same look from one implementation
  instead of three copies of styled JSX.
- `WarrantTable` — pure row/table renderer, takes warrant rows + column
  config, no fetching.

These get pulled out the first time two tabs need the same rendering, not
speculatively before that's proven true.

## Migration order

1. **Warrants list tab** (`WarrantsListTab.tsx`) — establishes `StatusPill`
   and `WarrantTable`, the components everything else reuses. Also covers
   the toolbar, filters, and bulk-action bar.
2. Dashboard tab
3. Search-All tab
4. Sources tab
5. Shared modals/drawers (Person Profile, Warrant Form, Serve modal) —
   extracted last, once all four tabs that invoke them are already split out
   of the megafile.

Each step is its own PR/commit, verified before moving to the next.

## Verification (per tab)

For each tab's migration:

1. `npm run typecheck` (client) — must stay clean.
2. Existing test suite must stay green.
3. Live browser pass: log into the app, open that tab, exercise its actual
   actions (filters, search, sort, pagination, bulk actions, drawers/modals
   it opens) against the real API. Confirm no behavior changed.
4. Add lightweight smoke tests for the migrated tab: renders without
   crashing, and its key interactions (e.g. typing in the search box
   debounces and calls the right endpoint, clicking a filter chip updates
   the query, a bulk action posts the right payload) are covered. Not
   exhaustive — proportionate to a page with almost no existing coverage,
   added as we're already touching every line of it.

No new automated tests are required beyond what's naturally added per tab
above — this is a refactor+restyle pass, not a test-coverage initiative.

## Risks

- **Schema/behavior drift while refactoring**: easy to accidentally change a
  filter's query-param name or an API call's shape while moving code between
  files. Mitigation: the live browser verification step per tab, plus
  keeping data-fetching logic copy-pasted-then-adjusted rather than
  rewritten from scratch where behavior must stay identical.
- **Density rule conflict** (see Open Question above) — needs resolution
  before/during the first tab so the rest of the rebuild has a settled
  answer to follow consistently.
- **4,503 lines is a lot of surface area** — even split into 4 tabs + 3
  modals + 2 shared components, each individual file will still be
  substantial (the List tab alone is likely 800–1,200 lines). This is
  expected and acceptable; the goal is "no longer one unmanageable file,"
  not "every file is tiny."
