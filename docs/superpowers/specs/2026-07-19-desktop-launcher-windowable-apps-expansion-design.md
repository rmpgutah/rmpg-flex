# Desktop Launcher — Windowable Apps Expansion (Phase 1 of 5) Design Spec

**Date**: 2026-07-19
**Status**: Approved for planning
**Builds on**: [2026-07-18-desktop-launcher-design.md](2026-07-18-desktop-launcher-design.md) (v1) and
[2026-07-18-desktop-launcher-v2-design.md](2026-07-18-desktop-launcher-v2-design.md) (v2), both shipped.

## Purpose

v1/v2 deliberately capped the `/desktop` launcher's in-page windowing at a
curated ~18-module `POPOUT_PAGES` subset "to avoid auditing all 142 routes
for iframe-safety." This is Phase 1 of a 5-phase program to make `/desktop`
feel like a full-scale Windows-style system rather than a launcher with a
narrow windowing allowlist:

- **Phase 1 (this spec)**: expand the windowable-apps set.
- Phase 2: window management polish (Alt+Tab cycling, multi-monitor-aware
  placement).
- Phase 3: personalization (custom wallpaper upload via R2, weather widget).
- Phase 4: layout portability & admin control (export/import layout JSON,
  per-role default templates).
- Phase 5: an advanced Settings app that surfaces controls for everything
  built in Phases 1–4.

Phase 1 does the audit v1/v2 deferred and fixes the data-model split that
caused it to silently rot: `navCatalog.ts` (85 `NavFunction` entries, the
source for desktop icons) and `windowManager.ts`'s `POPOUT_PAGES` (18
entries, the source for windowing) are two independent lists that have
already drifted apart in production — `/national-warrants` points at a path
that no longer matches its live route, and `/law-book` has no catalog entry
at all and is unreachable from the desktop today.

## Non-goals (this pass)

- Phases 2–5 (window cycling, wallpaper upload, weather widget, layout
  export/import, per-role templates, Settings app) — separate specs.
- Auditing/windowing routes with **no `navCatalog.ts` entry** — of the 142
  total `<Route>`s in `App.tsx`, only the 85 catalog entries have the
  icon/label/description metadata a desktop icon needs. Redirects,
  `/intel/*` sub-routes, detail routes (`:id`), and pages intentionally kept
  off the catalog (e.g. `/navigation`, `/detached/*`, mobile-only pages like
  `/field-camera`) are out of scope for icons entirely, windowable or not.
- Redesigning any page's internals to be "more iframe-friendly" beyond a
  targeted one-line fix if the audit finds a genuine blocker (e.g. a
  top-level redirect). The architecture's working premise — each window is
  an isolated same-origin iframe, so most pages work with zero changes —
  stays intact.
- Changing `openDetachedWindow()` / real `window.open()` pop-outs — that's a
  separate, already-working mechanism, untouched by this spec.

## Data Model

Replace the two-source-of-truth split with one. `NavFunction` in
`client/src/data/navCatalog.ts` gains two optional fields:

```ts
export interface NavFunction {
  path: string;
  label: string;
  icon: React.ElementType;
  shortcut?: string;
  description: string;
  adminOnly?: boolean;
  badgeKey?: string;
  windowSize?: { width: number; height: number }; // default 1050x800 if omitted
  notWindowable?: string; // reason, e.g. "getUserMedia camera preview"
}
```

- No `windowSize` + no `notWindowable` → windowable at the default
  1050×800.
- `windowSize` present → windowable at that curated size (used to preserve
  the 18 existing curated sizes, e.g. Dispatch stays 1200×900).
- `notWindowable` present (a non-empty reason string, not a bare boolean, so
  the exclusion is self-documenting in place) → clicking the icon navigates
  the desktop tab away instead, exactly like today's non-`POPOUT_PAGES`
  behavior.

`client/src/utils/windowManager.ts`'s `POPOUT_PAGES` map is deleted. A new
`getWindowConfig(fn: NavFunction): { title: string; width: number; height:
number } | null` helper replaces every read site (`DesktopIconGrid.tsx`'s
`handleActivate`, its "Open in new browser tab" context-menu item, and the
new taskbar wiring below).

## Audit

Every catalog entry not already in the current 18 (67 entries) plus the 2
already-broken ones gets its source read for these disqualifying patterns
before being left windowable:

1. `navigator.mediaDevices.getUserMedia` / continuous `watchPosition` used
   for a live camera/GPS HUD (full-viewport assumption).
2. Top-level `window.location.href =` / `window.top` comparisons — would
   trap the window on a redirect or behave incorrectly when not the real
   top-level tab.
3. File-header or component comments indicating a full-screen/kiosk design
   (mirrors how `/navigation` is already documented and rendered outside
   `<Layout>` in `App.tsx`).
4. `sessionStorage`/`localStorage`-keyed "single instance" locking or
   `BroadcastChannel` usage that assumes it's the only tab — since the
   iframe shares storage with the parent `/desktop` tab (same top-level
   browsing context), this is a real collision risk, not merely theoretical.

Any entry tripping one of these gets `notWindowable: "<specific reason>"`.
Everything else defaults to windowable. This is expected to exclude a small
minority of the 85 — the design's premise (iframe isolation makes most pages
safe by default) is why v1/v2 already shipped 18 of the riskier-looking
pages (Dispatch, MDT, Records) successfully with zero page changes.

Two fixes ride along with the audit:

- `/national-warrants` → corrected to the live route path
  `/national-warrant-search`.
- `/law-book` → gets a new `NavFunction` entry added to the catalog (an
  appropriate category, icon, label "Law Book", and description), making it
  reachable from the desktop for the first time.

## Taskbar Consistency

`DesktopTaskbar.tsx`'s Ctrl+K/⌘K launcher currently always calls
`navigate(fn.path)` on a search result, regardless of windowability —
inconsistent with the icon grid and about to get more inconsistent as the
windowable set grows from 18 to ~80. Both `DesktopIconGrid.tsx`'s
`handleActivate` and the taskbar's result-select handler are refactored to
call one shared `activateNavFunction(fn, { openWindow, navigate })` helper
(new small function, colocated with `getWindowConfig` in
`windowManager.ts`): windowable → `openWindow`, else → `navigate`.

## Window Cap

`MAX_OPEN_WINDOWS` (in `DesktopWindowManager.tsx`) increases from 6 to 10.
Hitting the cap currently no-ops silently; it now surfaces a toast ("Close a
window to open another") via the app's existing toast system, matching the
error-toast pattern already used for failed preference saves.

## Role Visibility

Unchanged — windowability is orthogonal to visibility. The existing
`CLIENT_VIEWER_BLOCKED` / `CONTRACT_MANAGER_BLOCKED` / `adminOnly` filtering
in `DesktopPage.tsx`'s `allFunctions` memo still runs first; a function
never reaches the icon grid or taskbar search at all if the current user
can't see it, regardless of its `notWindowable` status.

## Error Handling

- A windowable page that fails to load inside its iframe (network error, 4xx
  from a stale deep link) uses `FloatingWindow`'s existing inline retry
  affordance — unchanged from today's behavior for the current 18.
- If `getWindowConfig` is ever called with a path that has no matching
  `NavFunction` (shouldn't happen since both call sites source from the same
  catalog, but defensively): treat as `notWindowable` and fall back to
  `navigate`, never throw.
- Window-cap toast failure mode: none — it's a local UI toast, no network
  call involved.

## Testing

- **Client** (Vitest): unit tests for `getWindowConfig` (default size,
  curated size, `notWindowable` → null) and `activateNavFunction` (routes to
  `openWindow` vs `navigate` correctly). Update/extend existing
  `DesktopIconGrid`/`DesktopTaskbar` component tests for the shared-helper
  refactor. Regression test locking in the `/national-warrants` →
  `/national-warrant-search` fix and the new `/law-book` catalog entry.
- **Manual** (dev server): smoke-test one newly-windowed page per nav
  category (12 categories) plus both fixed entries, confirming each opens,
  renders, and is interactively usable inside a floating window at its
  configured size. Re-verify the 18 already-shipped pages still open
  correctly post-refactor (data model changed under them even though their
  behavior shouldn't). Confirm the window-cap toast fires at 11 open
  attempts and the taskbar search opens a window for a windowable result.
- **No Worker/D1 changes** — this phase is entirely client-side data
  (`navCatalog.ts`) and component logic; no migration, no new endpoint.

## Sequencing Note

The audit (67 pages to individually check) is the bulk of the work and is
naturally parallelizable by nav category — the implementation plan should
split it that way (one task per category, each independently committable),
followed by the taskbar-consistency and window-cap tasks last since those
touch shared code the per-category audit doesn't depend on.
