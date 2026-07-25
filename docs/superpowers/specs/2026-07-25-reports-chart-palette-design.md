# ReportsPage chart palette rebuild — design

**Date:** 2026-07-25
**Status:** approved (design), pending implementation plan
**Scope:** `client/src/pages/ReportsPage.tsx`, `client/src/styles/theme-palettes.css`,
`client/src/utils/chartPalette.ts`, `client/src/utils/statusColors.ts`,
`client/src/pages/map/utils/mapMarkers.ts`

---

## 1. Problem

Two local palettes in `ReportsPage.tsx` are degenerate and partly fail WCAG
non-text contrast (1.4.11, 3:1 floor) against the chart background.

`PRIORITY_COLORS` (≈line 109):

| slot | value | resolves to (Blue & Silver) | contrast on `--surface-base` |
|------|-------|------------------------------|------------------------------|
| P1 | `#dc2626` | `#dc2626` | **2.21 — FAIL** |
| P2 | `var(--brand-gold)` | `#c3ccd6` (silver) | 6.57 |
| P3 | `var(--text-muted)` | `#9bb0c7` | 4.79 |
| P4 | `var(--rmpg-500)` | `#63768f` | **2.30 — FAIL** |

`PIE_COLORS` (≈line 107) — 9 entries with two pre-existing duplicate pairs
(indices 0/2 both `--text-muted`; 4/5 both `#22c55e`) and one failing entry
(index 6, `--rmpg-500`).

The brief flagged P4. Measurement found **P1 also fails** (2.21) on the default
theme, which had not been identified.

### 1.1 The core tension

P4 must clear 3:1 yet still recede, and P3 already occupies `--text-muted`.
`statusColors.ts` additionally documents that P3/P4 must avoid the unit-status
grays, because "a gray dot was ambiguous between a low-priority call and an
en-route/off-duty unit."

Root cause: on Blue & Silver the chart draws on `--surface-base #22405f`, a
**mid-tone**. A 3:1 floor there requires relative luminance ≥ 0.245, which pins
every mark into OKLCH L ∈ [0.67, 1.0]. Four steps cannot achieve the 0.06
lightness separation an ordinal ramp needs inside that band. **The background,
not the palette, was the binding constraint.**

---

## 2. Rejected alternatives (measured, not assumed)

### 2.1 Reuse `PRIORITY_HEX` from `statusColors.ts`

Rejected — measurably worse. Contrast of the existing values:

| theme | P1 | P2 | P3 | P4 |
|-------|----|----|----|----|
| Night (base/raised) | 3.74 / 3.37 | 8.41 / 7.59 | 5.74 / 5.18 | 3.41 / 3.07 |
| Day | 3.97 / 4.83 | **1.77 / 2.15** | **2.59** / 3.14 | 4.36 / 5.30 |
| Legacy | 4.35 / 4.08 | 9.78 / 9.16 | 6.68 / 6.26 | 3.96 / 3.71 |
| Blue & Silver | **2.21 / 1.76** | 4.97 / 3.95 | 3.40 / **2.70** | **2.01 / 1.60** |

`PRIORITY_HEX` is tuned for a dark map canvas. Amber-on-cream collapses to 1.77
on the Day theme. It also cannot be made theme-aware: `mapMarkers.ts` builds
`${color}22`, `${color}55`, `${color}99`, `${color}b3` by string concatenation,
and `var(--x)22` is invalid CSS that fails silently.

### 2.2 A 4-hue categorical priority set

Rejected — fails colorblind separation catastrophically. Validated with the
`dataviz` skill's `validate_palette.js` (Machado-Oliveira-Fernandes severity-1.0
simulation), all-pairs:

- All-warm candidate: worst deutan ΔE **1.2–2.0** (target ≥ 8).
- Also fails the hard normal-vision floor: worst pair ΔE ≈ 7 (floor 15).
- The current shipped `PRIORITY_HEX` already fails this too: protan ΔE 5.8,
  normal-vision worst 12.2.

An adequate categorical set needs warm↔cool hue spread, but a cool/gray P4 is
exactly the map ambiguity `statusColors.ts` warns about
(`enroute #888888`, `off_duty var(--rmpg-500)`).

### 2.3 Keeping charts flat on `--surface-base`

Rejected by explicit approval of the recessed well (§3.1). Flat would force
either P4 at ~3.0 with adjacent ΔL ≈ 0.04 (reads as three steps plus a
near-duplicate) or a desaturated pink P1.

---

## 3. Design

### 3.1 Recessed plot well

Chart plot areas move from `--surface-base` onto `--surface-deep`, which is
already defined in all four theme blocks:

| theme | `--surface-base` | `--surface-deep` (new plot well) |
|-------|------------------|----------------------------------|
| Night | `#0d1722` | `#060b10` |
| Day | `#ece9dd` | `#c9c5b8` |
| Legacy black | `#000000` | `#000000` |
| Blue & Silver | `#22405f` | `#142840` |

This roughly doubles the legal lightness band on Blue & Silver and is the single
change that makes a compliant 4-step ramp possible.

### 3.2 Priority = ordinal ramp, not a categorical set

**This is the key decision.** Priority is ordered, so it is a sequential ramp,
and a sequential ramp is colorblind-safe *by construction*: under
deuteranopia/protanopia the hues collapse and the scale degrades to a pure
lightness ramp, which remains readable. That is why the ramp passes where the
categorical set scored deutan ΔE 1.2.

Construction (OKLCH), identical in every context:

- **Hues** 30° → 46° → 60° → 64° (spread ≤ 40°, one warm arc: red → orange →
  bronze → warm taupe).
- **Chroma** 0.200 → 0.130 → 0.072 → 0.028, monotonically descending. **Recession
  is carried by desaturation, not by luminance collapse** — this is what lets P4
  recede without approaching the surface.
- **Lightness** evenly spaced, gap 0.075 (ordinal floor is 0.06), anchored so the
  most recessive step lands just above a 3.05:1 contrast floor.

Generated values (each solved against its own theme's plot well):

| theme | P1 EMER | P2 URG | P3 RTN | P4 SCHED | min contrast |
|-------|---------|--------|--------|----------|--------------|
| Night | `#ff6b57` | `#c96e40` | `#936a48` | `#6a5c4e` | 3.06 |
| Day | `#600200` | `#6f2c00` | `#754d2c` | `#78695c` | 3.06 |
| Legacy black | `#ff614d` | `#c46a3c` | `#8f6644` | `#66584a` | 3.06 |
| Blue & Silver | `#ff9483` | `#e08355` | `#a87e5b` | `#7e6f61` | 3.08 |
| Map (fixed navy) | `#ffbeb2` | `#fc9c6e` | `#c29673` | `#968778` | 3.07 |

All five pass every `validate_palette.js --ordinal` check: lightness monotone,
adjacent ΔL ≥ 0.06, light-end contrast, single-hue spread ≤ 40°.

P4 stays warm (hue ~64–67°, not neutral gray), preserving the `statusColors.ts`
disambiguation from the unit-status grays.

### 3.3 Token surface

New role variables, defined in **all four** theme blocks of
`theme-palettes.css` (`:root`/`theme-dark`, `theme-light`, `theme-legacy-black`,
`theme-blue-silver`):

```
--chart-pri-1 … --chart-pri-4     ordinal priority ramp
--chart-plot-surface              alias of that theme's --surface-deep
```

`--accent-silver-*` and `--accent-gold-*` are **not** used: they exist only in
the blue-silver block and render nothing under the other three themes.

Consumed through `chartPalette.ts` (`chartPriorityColors()`), which resolves via
`getComputedStyle` at render time. Note: `var()` **does** resolve in SVG
presentation attributes in current Chrome (verified, Chrome 148) — the comment in
`chartPalette.ts` claiming otherwise is inaccurate and should be corrected. The
resolver is still preferred, for single-ownership and non-Chromium safety.

### 3.4 Pie chart → sorted horizontal bars

Incident types are **nominal** (no natural order), so a value-keyed ramp is the
documented anti-pattern: it double-encodes bar length as hue. The prescribed form
is one series → one color.

- Replace the `PieChart` + adjacent legend list with a sorted horizontal
  `BarChart` (`layout="vertical"`), category name on the Y axis, count as a
  direct label. The bars carry name and value, so the separate legend list is
  removed rather than reproduced.
- `PIE_COLORS` is **deleted**. All bars take one color, `--brand-blue`
  (`chartSeriesColors()[0]`), which measures ≥ 5.07:1 against the plot well in
  every theme.
- This also removes the `i % PIE_COLORS.length` cycling, which silently reused
  colors past 9 categories.

### 3.5 Map fix

`PRIORITY_HEX` keeps raw 6-digit hex — the `${color}NN` concat contract is
preserved — and takes the Map row from §3.2.

One further fix is required. `buildCallMarkerEl` hardcodes white `P{n}` text on
the fill (`color:#fff`), which over-constrains the fill:

- 3:1 against navy land requires fill luminance **≥ 0.245**
- 4.5:1 for **white** text requires fill luminance **≤ 0.183**

These are mutually unsatisfiable — with white ink, no fill color can satisfy
both, which is why the shipped P1 (`#dc2626`, 2.21 vs land) fails today.

Resolution: **invert the ink, not the geometry.** Change `color:#fff` to a dark
ink. The §3.2 map fills are all light, so a dark ink clears text contrast
comfortably while the fills keep carrying figure-ground themselves:

| ink | min contrast vs the 4 map fills | verdict |
|-----|-------------------------------|---------|
| `#0d1520` (tactical deep) | 5.27 | **PASS** (≥ 4.5) |
| `#000000` | 6.03 | PASS |
| `#142840` (map water) | 4.29 | fail |

Use `#0d1520`, matching the outline already used on unit badges. The existing
`border:2px solid ${color}` and the `${color}99` glow are unchanged — the fills
clear 3:1 against the land on their own (3.07 minimum), so no outline redesign
is needed.

### 3.6 Validation test

New test parsing `theme-palettes.css` and recomputing contrast — it must not
hardcode surface constants.

Rationale: the existing `themeContrast.test.ts` pins
`BLUE_SILVER.surfaceBase = [12, 26, 43]` (`#0c1a2b`) while the CSS actually
defines `#22405f`. It is asserting against a stale literal and would stay green
regardless of the CSS. Follow the `accentTokens.test.ts` pattern (read the file,
slice the block) instead.

Assertions:
1. `--chart-pri-1..4` and `--chart-plot-surface` exist in all four theme blocks.
2. Every step clears 3:1 against its own theme's plot well.
3. Lightness is monotone and adjacent ΔL ≥ 0.06 per theme.
4. `PRIORITY_HEX` values are raw 6-digit hex (guards the concat contract).
5. `PRIORITY_HEX` clears 3:1 against `MAP_PALETTE.land`.
6. The call-marker `P{n}` ink clears 4.5:1 against every `PRIORITY_HEX` fill
   (guards against a future fill change silently reintroducing the §3.5 conflict).

---

## 4. Out of scope (found while measuring; not fixed here)

1. **`UNIT_STATUS_HEX.off_duty = 'var(--rmpg-500)'`** — at the concat sites this
   yields `var(--rmpg-500)22` / `...b3`, invalid CSS that silently drops the
   accuracy ring and badge glow for off-duty units. Same class of bug as the
   contract this spec protects.
2. **`themeContrast.test.ts` stale constant** (§3.6) — the new test does not
   remove it; correcting it is a separate change.

---

## 5. Verification

```bash
cd client && npx tsc --noEmit && npx vitest run && npx vite build
```

Baseline on this tree: 457 test files / 3194 tests passing. Baseline is clean, so
any failure is caused by this change.
