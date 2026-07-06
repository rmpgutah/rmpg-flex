# Map UI & Portal Redesign — Phase 2: Steel-Blue Theme Pass

**Date:** 2026-07-04
**Status:** Approved for planning

## Context

Phase 1 (structural refactor of `MapboxMapPage.tsx` into `useMapCore` + `utils/mapMarkers.ts`)
shipped in PR #2583. This is Phase 2 of the 4-phase Map UI/portal redesign program
(see `docs/superpowers/specs/2026-07-03-map-ui-portal-redesign-design.md`):
structural refactor → **theme pass** → UX declutter → feature wiring.

The Map page currently hardcodes the old pure-black Spillman palette
(`#0a0a0a`/`#141414`/`#222`/`#888`/`#d4a017`) directly in React classNames and in
raw HTML strings injected into Mapbox markers/popups. This predates the
app-wide day/night steel-blue theme system (`client/src/styles/theme-palettes.css`
+ `rmpg-*`/`brand-*`/`surface-*` Tailwind tokens) shipped in PR #1277/#1279.
~101 raw hex literals were found across `MapboxMapPage.tsx`, `utils/mapMarkers.ts`,
and `hooks/useMapStreetView.ts`.

## Goals

- Convert React/Tailwind-classed elements (toolbar buttons, sidebar, status bar,
  panels) in `MapboxMapPage.tsx` from raw hex/inline styles to the existing
  `rmpg-*`/`brand-*`/`surface-*` Tailwind tokens.
- Convert the raw HTML-string builders in `utils/mapMarkers.ts` (unit/call
  marker + popup HTML) and `hooks/useMapStreetView.ts` (SAT PEEK popup HTML) to
  read resolved theme CSS-variable values at build time via a small shared
  helper, instead of hardcoded hex.
- Wrap the Map page's tactical surfaces in the existing `.tactical-dark` class
  so they render on the night palette regardless of the day/night schedule,
  per the standing rule that tactical surfaces (Map/HUD/MDT/Nav) stay dark
  always.

## Non-goals

- No layout/panel reorganization (Phase 3).
- No new orphan panels wired in (Phase 4).
- Brand gold `#d4a017` and 2px border radius stay hardcoded where they're
  already correct token values, not legacy artifacts — no change needed there
  beyond expressing them via the `brand-400`/existing radius override where a
  Tailwind className context is available.
- No changes to map *behavior* — this is a pure visual/token pass.

## Design

### 1. `.tactical-dark` wrapper

Confirm (via `grep -rn "tactical-dark" client/src`) how `.tactical-dark` is
applied elsewhere (e.g. `NavigationPage.tsx`, MDT), and apply the same pattern
to the Map page's root container in `MapboxMapPage.tsx`, so its CSS variables
resolve to the night palette regardless of the current day/night schedule.

### 2. React/Tailwind className conversions

Grep-driven, mechanical, file by file:
- `MapboxMapPage.tsx`: replace literal `bg-[#0a0a0a]`/`text-[#d4a017]`-style
  Tailwind arbitrary-value classes and inline `style={{color: '#888'}}` with
  `bg-surface-base`, `text-brand-400`, `text-rmpg-500`, etc. — matched to the
  existing token definitions in `client/tailwind.config.js`.
- Icon buttons, sidebar tabs, status bar text, toolbar dropdowns.

### 3. Raw HTML-string builders (the hard part)

`utils/mapMarkers.ts` and `hooks/useMapStreetView.ts` build DOM strings via
template literals (`el.style.cssText = ...`, `popup.setHTML(...)`) — these
render *outside* React, so Tailwind classes don't apply. Since the Map page is
tactical-dark-forced (always night palette), these can safely hardcode the
**night palette's resolved values** as literals (documented with a comment
pointing at `theme-palettes.css`'s night block as the source of truth), rather
than doing a runtime `getComputedStyle` read on every marker build (which would
add per-marker DOM read overhead with no visual benefit, since the values never
change on a tactical surface). This is simpler and faster than the originally
discussed runtime-CSS-variable-read approach — revised after further thought:
tactical-dark never switches, so there's no re-theming case to handle at
runtime for these strings.

A small `client/src/pages/map/utils/tacticalPalette.ts` constants file holds
the named values (`TACTICAL_SURFACE_BASE`, `TACTICAL_SURFACE_RAISED`,
`TACTICAL_BORDER`, `TACTICAL_TEXT_MUTED`, `TACTICAL_BRAND`) sourced from the
night block in `theme-palettes.css`, so there's one place to update if the
night palette values ever change, instead of ~20 scattered hex literals.

## Testing

- `cd client && npx tsc --noEmit` after each file's conversion.
- `cd client && npx vitest run` for existing marker/popup tests
  (`mapMarkers.test.ts` — assertions on `el.className`/`textContent` are
  unaffected by style changes, but re-run to catch accidental structural
  breaks).
- Manual browser verification: toggle day/night (via the theme override in
  dev tools or `rmpg_theme_override` localStorage key) and confirm the Map
  page's chrome (sidebar, toolbar, status bar) follows the app's current
  theme, while the map canvas/markers/popups stay on the tactical-dark look
  in both cases.
