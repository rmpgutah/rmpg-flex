# Hex-Alpha Concatenation Bug Class — Design

**Date:** 2026-07-25
**Status:** Approved
**Scope:** `client/src` — 89 call sites across 38 files, 1 new util module, 0 palette changes

## Problem

Several modules synthesize a translucent color by concatenating a 2-digit hex
alpha suffix onto a color string:

```ts
background: `${color}22`      // template-literal spelling
backgroundColor: color + '20' // string-concat spelling
```

This is only valid when `color` is a raw 6-digit hex. When the value is a CSS
variable it produces `var(--rmpg-500)22` — invalid CSS — and the tint, glow, or
ring **silently does not render**. Nothing throws; the element just loses its
background.

### Measured inventory

Reproduce with:

```bash
grep -rnoE '\$\{[A-Za-z_$][A-Za-z0-9_.\[\]?$ |'"'"'-]*\}[0-9a-fA-F]{2}\b' client/src --include='*.tsx' --include='*.ts' | grep -v __tests__ | grep -vE '\}(px|em|ch|vh|vw)\b'
grep -rnE "\+ *'[0-9a-fA-F]{2}'" client/src --include='*.tsx' --include='*.ts' | grep -v __tests__
```

- **52** template-literal sites across ~30 files
- **29** string-concat sites across ~13 files

### Live breakage (not merely latent)

Two `var()` values already sit inside palette maps that feed concat sites. Both
landed in `37a603e1fc` (2026-06-16, "tokenize 300+ inline hex colors"):

| Source | Value | Dead at |
|---|---|---|
| `client/src/utils/statusColors.ts:19` | `off_duty: 'var(--rmpg-500)'` in `UNIT_STATUS_HEX` | `mapMarkers.ts:137/191/229` (accuracy ring, halo), `mapMarkers.ts:102/167` (`${ringColor}b3` glow), `MapboxMiniMap.tsx:69/96`, `DispatchMiniMap.tsx:91` |
| `client/src/pages/hr/utils/hrConstants.ts:31` | `cancelled: 'var(--rmpg-500)'` in `LEAVE_STATUS_COLORS` | `LeaveTab.tsx:95` (badge background + border) |

Plus three sites where the **fallback itself** is a `var()`:

- `client/src/pages/hr/tabs/PayrollTab.tsx:613`, `:849` — `(STATUS_COLORS[…] || 'var(--rmpg-500)') + '20'`
- `client/src/pages/ForensicLabPage.tsx:1356` — `(actionColors[…] || 'var(--rmpg-500)') + '20'`

Net effect today: off-duty unit markers render with no accuracy ring and no
glow; cancelled-leave badges render with no background tint or border; any
unmapped payroll/forensic status renders untinted.

A third input class exists but is not currently broken: `colorLookup.ts`
`hashToHsl()` returns `hsl(…)` strings, which would also break under concat.

## Corrections to prior assumptions

Two premises in the originating brief did not survive verification. Recording
them because both are load-bearing for the chosen approach.

**1. `mapMarkers.ts` is not a Mapbox GL paint consumer.** `hexClassifier.ts:16`
excludes it alongside genuine GL modules under the comment "Mapbox GL rejects
`var(--x)`". That rationale does not apply to this file: it contains no
`setPaintProperty`, no `paint:`, no `addLayer`. Every color site is
`style.cssText` on a `document.createElement('div')` (native `mapboxgl.Marker`
DOM elements — see the `map-marker-native-unification` decision) or an inline
`style=` attribute in popup HTML. Both are ordinary CSS contexts.

The same holds for `MapboxMiniMap.tsx:69/96`, `DispatchMiniMap.tsx:91`, and
`ServeIntakeMap.tsx:392` — all `box-shadow`/`background` in DOM CSS.
**Conclusion: `color-mix()` is safe at every one of the migrated sites.**

The `hexClassifier.ts` exclusion is left unchanged — it governs *literal→token
migration* and the audit tally, which this work does not touch. Narrowing it is
separate scope.

**2. `-rgb` triples are not the preferred mechanism here.**
`theme-palettes.css:61-63` states it directly: use `-rgb` "when you literally
need rgba()-style alpha — **prefer the color-mix pattern**". `color-mix()` is
already the established house pattern (~40+ uses, including dynamic
interpolation in `StatsCard.tsx:79-80`, `PriorityHeatmap`, `ReportsPage`,
`DispatchPage`).

## Approach

### The helper — `client/src/utils/withAlpha.ts` (new)

```ts
withAlpha(color: string, alpha: number | string): string
```

- **Raw 6-digit hex** (`/^#[0-9a-fA-F]{6}$/`) → `color + hexPair`.
  Byte-identical to the current expression.
- **Everything else** (`var()`, `hsl()`, `rgb()`, named) →
  `color-mix(in srgb, ${color} ${pct}%, transparent)`.

`alpha` accepts the original 2-digit hex string (`'22'`), making the migration
exact by construction, or a 0–1 float for new code.

Why the hex fast path matters: it is the regression proof. `#22c55e` + `'80'`
is string-identical to the old output, so the ~70 already-working sites are
provably unchanged and the diff's risk concentrates on the ~11 that were
already broken.

Why `color-mix` is exact rather than approximate: `transparent` is
`rgba(0,0,0,0)`, and srgb mixing premultiplies alpha, so the transparent side
contributes zero weight to the color channels and only pulls alpha to P.
`color-mix(in srgb, C P%, transparent)` is therefore equivalent to C at alpha
P/100 — not a visual approximation.

Placement: a new focused module. `statusColors.ts` is pure maps with no
helpers; `colorLookup.ts` is an unrelated hash-to-HSL generator.

### Palette: no changes

No `-rgb` triples are added. Under `color-mix` they are unnecessary, which
avoids ~28 new CSS lines across four theme blocks and the recurring "does a
triple exist for this token" maintenance burden — a missing triple would
silently re-create this exact bug class.

The two feeder-map `var()` entries **stay as `var()`**. They become correct
rather than requiring reversion to literals, preserving the 2026-06-16
tokenization intent. The brief's "those maps must remain raw 6-digit hex"
constraint dissolves rather than needing enforcement.

### Migration

Mechanical, every site:

- `${color}22` → `${withAlpha(color, '22')}`
- `color + '20'` → `withAlpha(color, '20')`

`DockSection.tsx:70`'s `.startsWith('#')` guard is deleted — the helper
subsumes it. Unlike the guard, the helper *keeps* the alpha instead of
discarding it.

## Testing

New `client/src/utils/__tests__/withAlpha.test.ts`:

- raw hex in → exact 8-digit hex out
- `var()` in → valid `color-mix(...)`, and specifically never `var(--x)22`
- `hsl()` / `rgb()` inputs
- both alpha spellings (hex-pair string and 0–1 float) agree
- edge cases per the policy below

Ratchet test asserting zero remaining raw concats in `client/src` (same shape
as the existing dead-CSS-var ratchet).

### One existing expectation must flip

`client/src/pages/map/components/__tests__/DockSection.test.tsx`:

- **`:55`** — *"produces a valid (non-concatenated) box-shadow when falling
  back to the var() default color"* asserts `boxShadow: '0 0 4px
  var(--brand-gold)'`. This **pins the alpha-discarding behavior as correct**.
  It must be updated to assert the `color-mix` form. The test is not wrong
  today; it codified "valid CSS" as the bar. This work raises the bar to
  "valid CSS *that renders the intended alpha*". Note it would pass both before
  and after a naive fix, so it would have silently preserved the alpha loss.
- **`:62`** — asserts `'0 0 4px #22c55e80'`. **Must stay green untouched.**
  This is the byte-identity proof for the hex path.

`mapMarkers.test.ts` asserts on labels, transforms, and transitions — not
alpha suffixes — and is unaffected.

## Edge-case policy

Decided and implemented:

| Case | Behavior | Rationale |
|---|---|---|
| Empty / nullish / non-string `color` | `'transparent'` | Fails invisible. On a dispatch map an absent marker halo is safer than a wrong-colored one; the alternative (return the input so it shows up loudly in devtools) can paint a misleading element on a live tactical surface. |
| Already 8-digit hex (`#22c55e80`) | Replace the existing alpha | Call sites pass the alpha they want the RESULT to carry, not a further reduction. Implemented as one-level recursion on `slice(0, 7)`. |
| Numeric alpha outside 0–1, or non-finite | Clamp to `[0,1]`; non-finite → opaque | — |
| String alpha that is not two hex digits | Opaque | `parseInt('zz', 16)` is `NaN`, which would emit `NaN%` — silently dropped by the browser, i.e. the exact invisible-failure mode this module removes. Opaque is wrong but *visible*. |
| 3-digit hex (`#2c5`) | Routed to `color-mix` | Valid CSS; no special case needed. |

## Outcome

**Sites migrated: 89 `withAlpha()` calls across 38 files** — more than the 81 first
measured, because the
ratchet test found 5 sites the discovery grep missed. The brief's regex (and the
first sweep's) used a character class that excluded parentheses, ternaries, and
`||` inside the interpolation, so these were invisible to it:

- `pages/FlexCamFootagePage.tsx` — `${pinColor(m)}44`, `${pinColor(m)}11` (function call)
- `pages/RouteBuilderPage.tsx` — `${PRIORITY_COLORS[wp.priority] || '#888'}20` (`||` fallback)
- `pages/map/MapboxMapPage.tsx` — `${isConnected ? '#22c55e' : '#ef4444'}80` (ternary)
- `pages/navigation/CallHistoryDrawer.tsx` — `${STATUS_COLOR[c.status] || '#888'}22` (`||` fallback)

Lesson worth keeping: the ratchet is a stricter detector than the grep that
motivated it. Its `\$\{[^{}]*\}` form matches any interpolation, so it should be
treated as the authoritative inventory, not the greps in this document.

Two further discoveries during the sweep:

- **`src/utils/mapMarkers.ts` is a second, distinct live module** (imported by
  `DispatchMiniMap`, `SightingsMap`, `ForensicTrackMap`, `ConnectionsMapPanel`),
  separate from `pages/map/utils/mapMarkers.ts`. It had its own site at line 111.
  Also pure DOM (`applyStyles`), per its own header comment.
- **`pages/IncidentsPage.tsx` had already hit this bug** and worked around it with
  two parallel color maps, leaving a comment recommending the `-rgb` companion
  tokens. The working code is left alone; the comment now points at `withAlpha`
  so the rejected approach does not propagate.

### Browser verification

Confirmed in a real browser (Chromium, computed styles) rather than inferred:

| Case | `getComputedStyle` result |
|---|---|
| Old idiom on a token — `var(--rmpg-500)22` | `rgba(0, 0, 0, 0)` — fully transparent, the bug reproduced |
| `withAlpha` on the same token | `color(srgb 0.360784 0.431373 0.517647 / 0.1333)` — rgb(92,110,132) = `#5c6e84` at exactly 0x22/255 |
| Hex fast path — `#22c55e80` | `rgba(34, 197, 94, 0.5)` — unchanged |
| `DockSection` fallback glow | `color(srgb 0.764706 0.8 0.839216 / 0.502)` — `--brand-gold` at 0x80/255; **previously fully opaque** |

## Gates

Baseline the suite before any edit, then:

```bash
cd client && npx tsc --noEmit && npx vitest run && npx vite build
```

Measured baseline on this tree before any edit: **457 test files / 3201 tests**
passing (the brief's 3194 was slightly stale). After the change:

- `client npx tsc --noEmit` — exit 0
- `client npx vitest run` — **459 files / 3222 tests passed**, 0 failed
  (+2 files, +21 tests: 19 in `withAlpha.test.ts`, 2 in the ratchet)
- `client npx vite build` — clean
- `npm run typecheck` (Worker) — exit 0

A fresh worktree requires `npm install --legacy-peer-deps` first or `tsc`
reports ~97,000 phantom module errors.

## Follow-up not taken

- `hexClassifier.ts:16` still excludes `mapMarkers` from literal→token migration
  under a "Mapbox GL rejects var(--x)" comment that is inaccurate for that file.
  Left alone: it governs the audit tally, which this work does not touch.
- `IncidentsPage.tsx`'s parallel color maps could collapse to one map plus
  `withAlpha`. Left alone: the code renders correctly today.
