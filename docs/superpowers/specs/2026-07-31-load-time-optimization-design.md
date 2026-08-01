# Load-Time Optimization — Cold Boot + Route Navigation

**Date:** 2026-07-31
**Status:** Design approved, ready for planning
**Scope:** `client/` only. No Worker, D1, or API changes.

## Problem

Operators report the app "lagging" on load. Scoped with the operator to two
surfaces:

1. **Cold first load / login** — time from opening `rmpgutah.us` (or the
   desktop shell) to a usable Dashboard.
2. **Navigating between pages** — the "Loading module" splash when clicking
   into Dispatch, Records, Warrants, etc.

Explicitly NOT in scope: panels that paint then fill in slowly (API/D1
round-trip latency). The operator confirmed that is not the complaint.

## Measured baseline

Production build of this worktree (`npx vite build`), 2026-07-31:

| Artifact | Raw | gzip | brotli |
|---|---|---|---|
| `index-*.js` (entry) | 941.2 KB | 230.6 KB | 177.6 KB |
| `index-*.css` | 437.3 KB | 72.3 KB | 55.6 KB |

Total build: 18 MB of JS across 306 chunks. The entry chunk is what gates
first paint; everything else is already code-split.

**The raw byte count matters more than the compressed one.** The fleet runs
Panasonic FZ-55 toughbooks; ~1 MB of JS to parse and execute is the felt cost,
not the ~178 KB download.

### Entry chunk attribution

Method: build with `--sourcemap`, then sum `sourcesContent` byte length per
entry in `dist/assets/index-*.js.map`. Result: **1,971 KB of source across 186
eager modules.**

| Source KB | Module | Why eager |
|---|---|---|
| 167.9 | `pages/DashboardPage.tsx` | Deliberate static import in `App.tsx` (post-login landing) |
| 83.2 | `components/Layout.tsx` | Genuinely eager — wraps every authed route |
| 77.1 | `components/NewCallModal.tsx` | Static import from `DashboardPage.tsx:25` |
| 76.2 | `pages/LoginPage.tsx` | Genuinely eager |
| 75.7 | `components/IncidentFormModal.tsx` | Static import from `DashboardPage.tsx:26` |
| 71.4 | `hooks/useGpsTracking.ts` | `Layout.tsx:409` + `NavTripContext` — NOT recoverable |
| 69.5 | `components/MenuBar.tsx` | Layout |
| 66.6 | `components/UserProfileModal.tsx` | Static import from `Layout.tsx:110` |
| 47.8 | `App.tsx` | Genuinely eager |
| 45.6 | `utils/voiceChannel.ts` | via MenuBar |
| 39.9 | `hooks/useMapRouting.ts` | `useNavGuidanceEngine` → NavTripContext — NOT recoverable |
| 25.3 | `pages/DownloadsPage.tsx` | Not lazy in `App.tsx` |
| 25.0 | `hooks/useNavTripDetection.ts` | NavTripContext — NOT recoverable |
| 21.9 | `components/SignaturePad.tsx` | Static import |
| 18.3 | `pages/map/utils/mapMarkers.ts` | Mini-map components only — recoverable |
| 17.9 | `hooks/useNavGuidanceEngine.ts` | NavTripContext — NOT recoverable |
| 16.5 | `utils/mapboxLoader.ts` | Mini-map components only — recoverable |
| 15.5 | `components/install/KioskOsInstallGuide.tsx` | via DownloadsPage |

By directory: `src/components` 933.9 KB, `src/pages` 320.5 KB, `src/utils`
296.3 KB, `src/hooks` 253.5 KB.

### Secondary findings

- `main.tsx` calls `preloadSoundAssets()` three times at module top level,
  fetching and WebAudio-decoding 22 assets from a 1.3 MB `public/sounds/`
  before React renders. Audio cannot play before a user gesture anyway, so
  this work is pure first-paint contention.
- The build already prints `INEFFECTIVE_DYNAMIC_IMPORT` for
  `src/utils/mapboxLoader.ts`: it is dynamically imported by `useMapRouting`
  but statically imported by 5+ mini-map components, so Rollup keeps it in the
  entry. One static import defeats every dynamic import of the same module.
- `src/index.css` is 10,592 lines (307.9 KB source) and is the bulk of the
  437 KB stylesheet.

### Correction to an earlier estimate

An earlier draft of this design claimed the GPS/nav chain (~190 KB) could be
evicted by lazy-loading the mini-map components. **That is wrong.**
`Layout.tsx:409` calls `useGpsTracking()` directly and `NavTripContext`
(mounted in `App.tsx`) both calls it and re-exports its return type;
`useNavGuidanceEngine` statically imports from `useMapRouting`. Layout and
NavTripProvider wrap every authenticated route, so `useGpsTracking` (71 KB),
`useNavTripDetection` (25 KB), `useNavGuidanceEngine` (18 KB) and
`useMapRouting` (40 KB) — ~154 KB — are genuinely eager and stay.

Only `mapboxLoader` (16 KB) and `mapMarkers` (18 KB) arrive purely via
mini-map components and are recoverable.

**Generalizable rule: a hook consumed by a context provider is exactly as
eager as that provider.**

## Approach

Two coordinated halves, one per lag surface. Chosen over "prefetch only"
(fixes navigation, does nothing for cold load) and over "also rewrite
`index.css` + split `Layout`/`MenuBar`" (highest regression risk for the
smallest measured win).

### Half 1 — entry chunk diet (cold load)

**Lazy-loading cascades.** A lazy parent carries its entire static import
subtree out of the entry with it. Verified against the entry sourcemap
2026-07-31, this collapses what looked like six edits into three:

| Change | Files | Entry source removed |
|---|---|---|
| `lazy()` `DashboardPage`, prefetch on login success | `App.tsx` | ~355 KB — `DashboardPage` (168) + `NewCallModal` (77) + `IncidentFormModal` (76) + `DashboardMiniMap` + `mapMarkers` (18), all of which it statically imports |
| `lazy()` `UserProfileModal` | `Layout.tsx` | ~89 KB — `UserProfileModal` (67) + `SignaturePad` (22), whose only eager path is through it |
| `lazy()` `DownloadsPage` | `App.tsx` | ~41 KB — incl. `KioskOsInstallGuide` (16) |
| Defer `preloadSoundAssets()` to `requestIdleCallback` | `main.tsx` | 0 KB, removes 22 fetches + decodes from first paint |

The modals already render behind `{open && <Modal/>}`, so lazying them is a
pure win — the bundler cannot infer that conditionality from a static import.

Lazying `DashboardPage` is only free because of the login-success prefetch
(see below). Without it, this trades login speed for a post-login stall.

Two corrections to earlier drafts of this table, both from sourcemap
verification:

- **`DispatchMiniMap` is not in the entry chunk** — only `DashboardMiniMap`
  is, and it arrives via `DashboardPage`, so it needs no edit of its own.
- **`mapboxLoader` (16.5 KB) is NOT recoverable.** `useMapRouting.ts` imports
  it, and `useMapRouting` is eager via `NavTripContext → useNavGuidanceEngine`.
  This is precisely why the build's `INEFFECTIVE_DYNAMIC_IMPORT` warning for
  that module is irreducible without restructuring the nav engine, which is
  out of scope. Those bytes stay.

### Half 2 — intent-driven route prefetch (navigation)

**New: `client/src/routes/routeModules.ts`** — one exported record mapping
route path → `() => import(...)`. `App.tsx` builds its `lazy()` consts from
this map, so there is exactly one import factory per route rather than two.
This seam does not exist today: all 130+ `lazy()` calls are inline consts in
`App.tsx`, which is why prefetch is currently hardcoded to the two routes
(`importDispatch`, `importMap`) that happen to have named factories.

**New: `client/src/hooks/useRoutePrefetch.ts`** — exposes
`prefetchRoute(path)`. Dedupes (an `import()` in flight or resolved is a
no-op — `import()` is itself deduped by the module cache, so this just avoids
the call). Respects `navigator.connection.saveData` and
`slow-2g`/`2g` effective types, mirroring the existing guard in `AppRoutes`.
Swallows all rejections.

Prefetch triggers, in priority order:

1. **Login success** → `prefetchRoute('/')` immediately (not on idle). This is
   what makes lazying `DashboardPage` free.
2. **Idle after auth** → the current role's top routes, via a role→routes
   table. Replaces the hardcoded `DISPATCH_MAP_ROLES` block in `AppRoutes`.
3. **Nav hover or focus** → `prefetchRoute(path)`. `MenuBar.tsx` already has
   `onMouseEnter` wiring at lines 1054/1125. Focus as well as hover, so
   keyboard navigation benefits.

### Out of scope

- `src/index.css` — 55.6 KB brotli, ~455 consuming files per CLAUDE.md,
  encodes the theme invariants (the `!important` 2px radius override, four
  palette blocks). Highest regression risk on the table for the smallest
  measured win.
- Splitting `Layout.tsx` (1,810 lines) / `MenuBar.tsx` (1,353 lines).
- All API, Worker, and D1 work.

## Projected result

Entry chunk **941 KB → ~590–620 KB raw** (~178 KB → ~125 KB brotli), a ~35%
cut in parse/execute work on the login path. Hovered or role-prefetched routes
navigate with no "Loading module" splash.

These are projections from source-byte attribution, not measurements. The
implementation plan must re-measure after each batch and record actuals.

## Error handling

Prefetch is strictly best-effort. Every path ends in `.catch(() => {})`.
It must never affect correctness: real navigation continues to go through
`lazyRetry` in `App.tsx`, which owns the stale-chunk retry and bounded-reload
behavior. That logic is untouched by this work.

The one genuine hazard is the modals. `{open && <Modal/>}` becomes
`{open && <Suspense fallback={…}><Modal/></Suspense>}`. A modal that mounts
into a portal needs its Suspense boundary **outside** the portal, or the
fallback renders in the wrong place in the DOM. Each boundary goes at the
call site, not inside the modal component.

## Verification

1. **Numeric gate:** re-run the sourcemap attribution (build with
   `--sourcemap`, sum `sourcesContent` bytes per module in
   `dist/assets/index-*.js.map`) before and after each batch. Record actual
   entry-chunk raw and brotli bytes. This is the gate, not a subjective
   "feels faster."
2. **Full client vitest suite** after each batch — not targeted runs, per the
   `full-suite-not-targeted-tests` rule. The baseline is clean, so any failure
   is caused by the change.
3. **Client typecheck** (`cd client && npx tsc --noEmit`) — clean baseline.
4. **Real browser drive:** login → Dashboard → hover a nav entry → navigate.
   Confirm no "Loading module" splash on a prefetched route, no theme FOUC,
   and that the pre-splash hands off to React cleanly. jsdom has no layout
   engine, so this step cannot be replaced by a test.
5. **CI ratchet:** a check asserting the entry chunk stays under a committed
   byte ceiling, so this cannot silently regress the way the `modulePreload`
   issue did.

## Risks

- **Suspense boundary placement on portal-mounted modals** — see Error
  handling. Mitigated by putting boundaries at call sites and driving the real
  app.
- **Lazying `DashboardPage` regresses post-login** if the login-success
  prefetch does not land. Mitigation: implement the prefetch in the same batch
  as the lazy, never separately.
- **`routeModules.ts` is a large mechanical edit to `App.tsx`.** Per the
  `squash-drops-wiring-line` rule, re-run typecheck after any rebase or merge
  — a squash has dropped registry wiring while keeping the file four times in
  this repo's history.
