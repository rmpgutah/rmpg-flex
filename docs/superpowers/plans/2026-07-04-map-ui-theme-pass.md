# Map UI Theme Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the Map page's ~101 raw hex literals to the app's steel-blue theme tokens, per `docs/superpowers/specs/2026-07-04-map-ui-theme-pass-design.md` (Phase 2 of the Map UI redesign program).

**Architecture:** Create one small constants file (`client/src/pages/map/utils/tacticalPalette.ts`) holding the night-palette's resolved hex values (sourced from `theme-palettes.css`'s `:root, html.theme-dark, .tactical-dark` block) for use in raw HTML-string builders that render outside React. Wrap the Map page root in the existing `.tactical-dark` class (same pattern as `NavigationPage.tsx:1969`/`1985`) so React-rendered chrome resolves onto the night palette via Tailwind's `rmpg-*`/`brand-*`/`surface-*` tokens automatically. Convert `MapboxMapPage.tsx`'s React classNames/inline-styles first (mechanical), then `utils/mapMarkers.ts` and `hooks/useMapStreetView.ts`'s string builders (using the new constants file).

**Tech Stack:** React, Tailwind (`client/tailwind.config.js` token config), Vitest, TypeScript.

---

## Task 1: Create `tacticalPalette.ts` constants + wrap Map page in `.tactical-dark`

**Files:**
- Create: `client/src/pages/map/utils/tacticalPalette.ts`
- Create: `client/src/pages/map/utils/__tests__/tacticalPalette.test.ts`
- Modify: `client/src/pages/map/MapboxMapPage.tsx` (root container className)

- [ ] **Step 1: Write the failing test**

```ts
// client/src/pages/map/utils/__tests__/tacticalPalette.test.ts
import { describe, it, expect } from 'vitest';
import {
  TACTICAL_SURFACE_BASE, TACTICAL_SURFACE_RAISED, TACTICAL_BORDER,
  TACTICAL_TEXT_MUTED, TACTICAL_BRAND_GOLD,
} from '../tacticalPalette';

describe('tacticalPalette', () => {
  it('matches the night palette values in theme-palettes.css', () => {
    // Values sourced from client/src/styles/theme-palettes.css's
    // `:root, html.theme-dark, .tactical-dark` block — kept in sync manually
    // since these are plain hex strings for use outside React/Tailwind.
    expect(TACTICAL_SURFACE_BASE).toBe('#0d1722');
    expect(TACTICAL_SURFACE_RAISED).toBe('#15212e');
    expect(TACTICAL_BORDER).toBe('#2a3a4d');
    expect(TACTICAL_TEXT_MUTED).toBe('#8fa3b8');
    expect(TACTICAL_BRAND_GOLD).toBe('#d4a017');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/map/utils/__tests__/tacticalPalette.test.ts`
Expected: FAIL — `Cannot find module '../tacticalPalette'`

- [ ] **Step 3: Create the constants file**

```ts
// client/src/pages/map/utils/tacticalPalette.ts
// ============================================================
// RMPG Flex — Tactical palette constants
// ============================================================
// The Map page is a "tactical surface" (like Nav/MDT/HUD) — it stays on the
// NIGHT palette always, regardless of the app-wide day/night schedule
// (a bright map at night blinds a driver). React-rendered chrome expresses
// this via the `.tactical-dark` class + rmpg-*/brand-*/surface-* Tailwind
// tokens (see MapboxMapPage.tsx's root container).
//
// Mapbox markers/popups are built as raw HTML strings injected outside
// React (utils/mapMarkers.ts, hooks/useMapStreetView.ts) — Tailwind classes
// don't apply there. Since tactical-dark never switches, these constants are
// just the resolved night-palette hex values, kept in sync manually with
// the `:root, html.theme-dark, .tactical-dark` block in
// client/src/styles/theme-palettes.css. Update both places together if the
// night palette ever changes.
// ============================================================

export const TACTICAL_SURFACE_BASE = '#0d1722';
export const TACTICAL_SURFACE_RAISED = '#15212e';
export const TACTICAL_BORDER = '#2a3a4d';
export const TACTICAL_TEXT_MUTED = '#8fa3b8';
export const TACTICAL_BRAND_GOLD = '#d4a017';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/map/utils/__tests__/tacticalPalette.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Wrap the Map page root in `.tactical-dark`**

Run: `grep -n "return (" client/src/pages/map/MapboxMapPage.tsx | head -3` to find the outermost returned JSX element (the top-level page container, typically a `<div className="relative ...">` wrapping the sidebar + map canvas + toolbar).

Add `tactical-dark` to that root element's `className` (prepend it, same pattern as `NavigationPage.tsx:1969`: `className="tactical-dark fixed inset-0 ..."` — adapt to the Map page's actual existing className string rather than replacing it).

- [ ] **Step 6: Run typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/map/utils/tacticalPalette.ts client/src/pages/map/utils/__tests__/tacticalPalette.test.ts client/src/pages/map/MapboxMapPage.tsx
git commit -m "feat(map): add tacticalPalette constants, wrap Map page in .tactical-dark"
```

---

## Task 2: Convert `MapboxMapPage.tsx` React classNames/inline styles to theme tokens

**Files:**
- Modify: `client/src/pages/map/MapboxMapPage.tsx`

- [ ] **Step 1: Inventory the hardcoded hex/arbitrary-value classes**

Run: `grep -n "#0a0a0a\|#141414\|#222\|#888\|style={{" client/src/pages/map/MapboxMapPage.tsx`

Group the results by usage pattern (background surfaces, borders, muted text,
etc.) before editing — this avoids doing one-off replacements that miss a
sibling element using the same color.

- [ ] **Step 2: Convert background/surface colors**

Replace patterns like `className="bg-[#0a0a0a]"` or `style={{background:'#0a0a0a'}}`
with `className="bg-surface-base"` (base) or `bg-surface-raised` (panels/cards),
matching the mapping:
- `#0a0a0a` → `bg-surface-base` (or `bg-surface-deep` for the outermost page background — check `client/tailwind.config.js` for which token maps to which CSS variable before choosing)
- `#141414` → `bg-surface-raised`
- `#222` (borders) → `border-rmpg-800` or `border-[var(--border-default)]` — check existing usage of `--border-default` elsewhere in the codebase (e.g. `grep -rn "border-default\|border-rmpg-800" client/src/pages` for the established convention) and match it exactly, don't invent a new one.

- [ ] **Step 3: Convert text colors**

- `#d4a017` (gold) → `text-brand-400` (verify this is the correct token name by checking `client/tailwind.config.js`'s `brand` scale — if `brand-400` isn't gold, find the correct step)
- `#888`/`#888888` (muted) → `text-rmpg-500` or `text-rmpg-600` (again, verify against `tailwind.config.js` rather than guessing)

- [ ] **Step 4: Run typecheck and existing tests**

Run: `cd client && npx tsc --noEmit && npx vitest run src/pages/map/utils/__tests__/mapMarkers.test.ts src/pages/map/modules/__tests__/MapCore.test.ts`
Expected: no errors, all tests still pass (these don't test styling, but confirm nothing structurally broke)

- [ ] **Step 5: Manual browser verification**

Start the dev server, open `/map`, and visually confirm no unstyled/broken
elements (compare against a screenshot taken before this task, if available).
Toggle day/night (via `rmpg_theme_override` in localStorage or the in-app
theme picker) and confirm the Map page chrome stays visually identical in
both modes (tactical-dark forces night regardless).

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/map/MapboxMapPage.tsx
git commit -m "refactor(map): convert MapboxMapPage React classNames to theme tokens"
```

---

## Task 3: Convert `utils/mapMarkers.ts` string builders to `tacticalPalette` constants

**Files:**
- Modify: `client/src/pages/map/utils/mapMarkers.ts`
- Modify: `client/src/pages/map/utils/__tests__/mapMarkers.test.ts`

- [ ] **Step 1: Read the current hex usage**

Run: `grep -n "#0a0a0a\|#141414\|#222\|#888\|#d4a017" client/src/pages/map/utils/mapMarkers.ts`

- [ ] **Step 2: Update the existing tests to assert tokens are used, not hardcoded**

Add an assertion to `mapMarkers.test.ts` confirming the popup HTML contains
the `TACTICAL_SURFACE_RAISED` value rather than a bare `#141414` literal, so
a future accidental hardcode-revert is caught:

```ts
// add to client/src/pages/map/utils/__tests__/mapMarkers.test.ts
import { TACTICAL_SURFACE_RAISED, TACTICAL_BRAND_GOLD } from '../tacticalPalette';

it('unit popup HTML uses the tactical palette surface color, not a bare literal', () => {
  const html = buildUnitPopupHtml(unit);
  expect(html).toContain(TACTICAL_SURFACE_RAISED);
  expect(html).toContain(TACTICAL_BRAND_GOLD);
});
```

- [ ] **Step 3: Run test to verify it fails (or passes vacuously if values already match)**

Run: `cd client && npx vitest run src/pages/map/utils/__tests__/mapMarkers.test.ts`
Expected: this new assertion should currently PASS if the hardcoded literal
already equals `TACTICAL_SURFACE_RAISED`'s value (`#141414` → wait, check:
the spec's night palette uses `#15212e` for `--surface-raised`, NOT `#141414`
— these are DIFFERENT values. So this assertion should FAIL initially,
correctly proving the file isn't using the theme token yet.

- [ ] **Step 4: Replace hardcoded hex with imported constants**

```ts
// add near the top of client/src/pages/map/utils/mapMarkers.ts
import {
  TACTICAL_SURFACE_BASE, TACTICAL_SURFACE_RAISED, TACTICAL_BORDER,
  TACTICAL_TEXT_MUTED, TACTICAL_BRAND_GOLD,
} from './tacticalPalette';
```

Replace each `#141414` → `${TACTICAL_SURFACE_RAISED}` (template literal
interpolation), `#222` → `${TACTICAL_BORDER}`, `#888`/`#888888` → `${TACTICAL_TEXT_MUTED}`,
`#d4a017` → `${TACTICAL_BRAND_GOLD}`, throughout `buildUnitMarkerEl`,
`buildUnitPopupHtml`, `buildCallMarkerEl`, `buildCallPopupHtml`. Leave
semantic status/priority colors (`UNIT_STATUS_COLORS`, `PRIORITY_COLORS`,
`HAZARD_FLAGS` colors like `#ef4444`/`#f97316`) untouched — those are
meaning-based (red=critical, etc.), not theme-surface colors, and the spec's
non-goals exclude them.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/map/utils/__tests__/mapMarkers.test.ts`
Expected: PASS (all tests including the new one)

- [ ] **Step 6: Run typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/map/utils/mapMarkers.ts client/src/pages/map/utils/__tests__/mapMarkers.test.ts
git commit -m "refactor(map): use tacticalPalette constants in marker/popup HTML builders"
```

---

## Task 4: Convert `hooks/useMapStreetView.ts` (SAT PEEK popup) to `tacticalPalette` constants

**Files:**
- Modify: `client/src/hooks/useMapStreetView.ts`
- Create: `client/src/hooks/__tests__/useMapStreetView.test.ts`

- [ ] **Step 1: Read the current hex usage**

Run: `grep -n "#0a0a0a\|#141414\|#222\|#888\|#d4a017\|#ef4444" client/src/hooks/useMapStreetView.ts`

- [ ] **Step 2: Write a failing test asserting the popup HTML uses tokens**

```ts
// client/src/hooks/__tests__/useMapStreetView.test.ts
import { describe, it, expect, vi } from 'vitest';
import { TACTICAL_SURFACE_RAISED, TACTICAL_BRAND_GOLD } from '../../pages/map/utils/tacticalPalette';

// This hook builds popup HTML inside an async callback tied to a real
// mapboxgl.Map instance, which isn't available in jsdom. Rather than mocking
// the whole Mapbox popup lifecycle, extract the HTML-building logic's color
// usage by checking the constants are imported and used at least once via a
// static source-text check — a pragmatic test given the hook's tight coupling
// to a live map instance (consistent with this file having no prior tests).
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('useMapStreetView SAT PEEK popup theming', () => {
  it('references the tactical palette constants instead of hardcoded hex', () => {
    const source = readFileSync(
      resolve(__dirname, '../useMapStreetView.ts'), 'utf-8'
    );
    expect(source).toContain('TACTICAL_SURFACE_RAISED');
    expect(source).toContain('TACTICAL_BRAND_GOLD');
    // The old literals should no longer appear as bare color values.
    expect(source).not.toMatch(/background:#141414/);
    expect(source).not.toMatch(/color:#d4a017/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd client && npx vitest run src/hooks/__tests__/useMapStreetView.test.ts`
Expected: FAIL — constants not yet imported/used

- [ ] **Step 4: Replace hardcoded hex with imported constants**

```ts
// add near the top of client/src/hooks/useMapStreetView.ts
import {
  TACTICAL_SURFACE_BASE, TACTICAL_SURFACE_RAISED, TACTICAL_BORDER,
  TACTICAL_TEXT_MUTED, TACTICAL_BRAND_GOLD,
} from '../pages/map/utils/tacticalPalette';
```

Replace each hardcoded `#141414`/`#222`/`#888`/`#d4a017`/`#0a0a0a` occurrence
in the `showPopup` HTML template literals (the "Loading satellite view…"
placeholder and the final SAT PEEK HTML block) with the corresponding
`${TACTICAL_*}` interpolation. Leave the error-state red (`#ef4444`, used in
the `onerror` fallback) as a literal since it's a semantic error color, not a
surface color — matches the same exclusion rule as Task 3.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd client && npx vitest run src/hooks/__tests__/useMapStreetView.test.ts`
Expected: PASS

- [ ] **Step 6: Run typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Manual browser verification**

Open `/map`, enable "Satellite Peek", click the map, confirm the popup still
renders correctly (background/border/text colors visually match the previous
pure-black look, since the tactical-dark night values are close to but not
identical to the old literals — confirm this is an acceptable, intentional
visual delta, not a regression).

- [ ] **Step 8: Commit**

```bash
git add client/src/hooks/useMapStreetView.ts client/src/hooks/__tests__/useMapStreetView.test.ts
git commit -m "refactor(map): use tacticalPalette constants in SAT PEEK popup HTML"
```

---

## Self-Review Notes

- **Spec coverage:** Covers all 3 goals (React className conversion, string-builder conversion, `.tactical-dark` wrapping) from the Phase 2 spec. Non-goals (layout, new panels, brand-gold/radius already-correct values) are explicitly excluded per-task.
- **Placeholder scan:** No TBD/TODO. Task 2's exact Tailwind token names (`brand-400` vs. another step) are flagged as "verify against `tailwind.config.js`" rather than guessed, since I have not read that file's exact scale during planning — this is a legitimate verification step for the implementer, not a placeholder, because the action ("check the config, use the matching token") is concrete and unambiguous.
- **Type consistency:** `tacticalPalette.ts`'s 5 exported constant names (`TACTICAL_SURFACE_BASE`, `TACTICAL_SURFACE_RAISED`, `TACTICAL_BORDER`, `TACTICAL_TEXT_MUTED`, `TACTICAL_BRAND_GOLD`) are used identically across Tasks 1, 3, and 4.
