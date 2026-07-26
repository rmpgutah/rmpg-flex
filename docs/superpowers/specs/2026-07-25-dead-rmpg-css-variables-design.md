# Dead `--rmpg-*` CSS Custom Properties — Design

**Date:** 2026-07-25
**Status:** Approved; implemented as the completion of PRs #3029 and #3031
**Base:** `4b6996244c` (`main`)

## Problem

The bare CSS custom properties `--rmpg-50` … `--rmpg-950` were **consumed but never
defined** — only the `--rmpg-NNN-rgb` triples existed in the four palette blocks of
[`client/src/styles/theme-palettes.css`](../../../client/src/styles/theme-palettes.css).

An unresolvable `var()` makes the whole declaration invalid at computed-value time, so each
site silently fell back to the **inherited** value. **441 occurrences across 124 files.**
Tailwind classes such as `text-rmpg-500` were never affected — they compile to
`rgb(var(--rmpg-500-rgb)/<alpha>)` and resolve normally.

## Why it stayed invisible — and why defining the alias is only half a fix

[`client/src/components/Layout.tsx`](../../../client/src/components/Layout.tsx) wraps the
entire app shell in `className="flex flex-col text-rmpg-100 …"`. That is a *Tailwind* class,
so it resolves. Every dead `color:` site therefore inherited `--rmpg-100` — near-white, at
**6.48–8.17:1** on the default theme.

The bug was invisible because its accidental fallback was a *passing* colour. That inverts
the naive fix: **defining the alias makes a wrong colour renderable.** A site that was
harmlessly inheriting near-white at 6.48:1 becomes `--rmpg-500` at **1.82:1**.

### Measured contrast

Worst case across all four palette blocks. Every worst case lands on **blue-silver /
`--surface-raised`** — the default theme, on the raised panels where field labels sit.

| Token | Worst ratio | Verdict |
|---|---|---|
| `--rmpg-300` | 3.77 | AA-large only |
| `--rmpg-400` | 2.75 | **FAIL** |
| `--rmpg-500` | 1.82 | **FAIL** |
| `--rmpg-600` | 1.18 | **FAIL** — effectively invisible |
| `--text-muted` | 3.81 | AA-large |
| `--text-secondary` | 5.88 | AA |
| `--text-primary` | 7.67 | AA |

The ramp encodes **surface elevation** and **inverts** between themes (day: low index = dark;
dark themes: low index = light), so `color: var(--rmpg-500)` only ever made sense under the
day theme. It is not a text scale.

**Corollary:** because these vars never resolved, nobody had ever *seen* these 441 colours.
They are unvalidated guesses, not "intended" values.

## What landed before this, and what it left

Three sessions worked this ramp concurrently on 2026-07-25:

| PR | Did | Left |
|---|---|---|
| **#3029** `6fad12930a` | Defined all 44 aliases (11 steps × 4 blocks), re-pointed ~111 text sites | 330 bare sites; 125 in a text context |
| **#3031** `1c6844e92f` | Re-pointed 129 more sites — explicitly **`--rmpg-500/600` only** | 204 bare sites; 114 in a text context |
| **this change** | The remaining 400/300/200 tier + the indirection the others could not see | 28 bare sites, all genuine non-text |

Measured on `main` at `4b6996244c` before this change: **204** bare `var(--rmpg-N)` sites,
**114** of them in a text context — overwhelmingly `--rmpg-400` at **2.75:1** (fails AA) and
`--rmpg-300` at 3.77:1.

That residue matters more now than it did originally. While the alias was undefined those
declarations were invalid and silently inherited near-white at 6.48:1. Now that the alias
resolves, the same sites paint the failing colour — **defining a dead var is only half a
fix.** This change finishes the text pass and adds the guardrail that stops the category
error recurring.

## Site classification

Every remaining occurrence classified by the CSS property it actually feeds:

| Role | Count | Fix |
|---|---|---|
| TEXT (`color:`, `.style.color =`, SVG text) | 168 | Re-point to semantic token |
| INDIRECT (colour maps, function returns) | 8 | Traced individually |
| SVG shape (`fill`/`stroke`/gradient stops) | 11 | Keep `var(--rmpg-N)` |
| BACKGROUND | 10 | Keep `var(--rmpg-N)` |
| BORDER | 5 | Keep `var(--rmpg-N)` |
| MISC (`accentColor`) | 1 | Keep `var(--rmpg-N)` |

## Design

### 1. Re-point text sites by step

| Ramp step | → token | Worst contrast |
|---|---|---|
| `50` / `100` / `200` | `--text-primary` | 7.67 AA |
| `300` / `400` | `--text-secondary` | 5.88 AA |
| `500` / `600` / `700`+ | `--text-muted` | 3.81 AA-large |

This preserves the author's intended three-level hierarchy (300 = prominent → 600 = dim),
which is the information the ramp step was actually carrying. It also preserves hover pairs
for free: `onMouseEnter → --text-secondary` (brighter) / `onMouseLeave → --text-muted`.

Applies to `color:`, `.style.color =`, `WebkitTextFillColor`, and SVG text. **SVG text
includes recharts axis ticks** — `tick={{ fill: 'var(--rmpg-500)', fontSize: 9 }}` renders as
a `<text>` element, so 14 such sites were 9 px at 1.82:1. A `fill` carrying `fontSize` /
`fontFamily` is text, not a graphic.

`--text-muted` at 3.81:1 is AA-large, which does not meet AA for 9–11 px dense CAD table
text. Accepted deliberately: `--text-muted` is already the app's muted-text token in
widespread use at those sizes, so re-pointing makes these sites *consistent with the existing
baseline* rather than worse than it. Raising `--text-muted` itself was considered and
rejected here — it would alter every existing consumer app-wide. It remains available as
separate follow-up work.

### 2. Leave background / border / SVG-shape sites alone

They keep `var(--rmpg-N)`, which now resolves. This is the ramp's real semantic — surface
elevation. Graphical objects need only 3:1 (WCAG 1.4.11); decorative fills need none.

### 3. Fixed operational palettes take a literal hex — landed upstream

Fourteen entries sat inside status/severity maps whose every other entry is a literal hex —
`UNIT_STATUS_HEX`, `STAGE_COLORS`, `STATUS_COLOR`, `LEAVE_*_COLORS`, `activityColor`,
`CATEGORY_COLORS`. CLAUDE.md holds these hues constant across every theme variant, so a
literal is correct there and the lone `var()` was the anomaly.

Several also feed **alpha concatenation** — `color + '22'`, `` `${color}80` `` — which a
`var()` can never satisfy: `var(--rmpg-500)22` is invalid regardless of whether the alias
exists. Those sites were broken before and would have stayed broken.

By the time this change rebased onto `4b6996244c`, #3029 and #3031 had converted all of
them, so **this change introduces no new hex literal.** The analysis is retained because the
reasoning is what justifies a literal in a themed component at all, and the `var() + '22'`
bug class is still live elsewhere (see Out of scope).

### Edge cases

- **`mapConstants.ts`** — `INCIDENT_CATEGORY_COLORS` and `getIncidentCategoryColor()` are
  **dead code**: the function's only reference is its own definition, and the map's only
  reference is that function. It is also a fixed-hex CAD palette inside a Mapbox module,
  which CLAUDE.md excludes from var migration because Mapbox GL cannot resolve `var()` in a
  paint property. The lone var becomes hex to match its 12 siblings.
- **`pdfGenerator.ts`** — its only match is a *comment* documenting this exact bug class
  (`hexToRgb()` cannot resolve CSS vars). No change.
- **Two `CrimeAnalysisPage` gradient stops** used `var(--rmpg-N, #hex)` and rendered the
  fallback forever. They now resolve to the ramp — a small, intentional, decorative change.

## Guardrail

PR #3029 already added block-completeness, hoist detection, and a general dead-var ratchet to
[`accentTokens.test.ts`](../../../client/src/utils/__tests__/accentTokens.test.ts). Those are
not duplicated here. This change adds the one guard none of the prior passes had — and its
absence is precisely why the ramp needed three passes and still was not finished:

**Text-context ban** — scan `client/src` and fail on any `var(--rmpg-N)` in a text-colour
context (`color:`, `.style.color =`, `WebkitTextFillColor`, and the `text:` object-literal
role key). This closes the root cause rather than this instance: the ramp *looks* like a text
scale (low number = light) while it encodes elevation and inverts between themes. The test
makes that category error mechanically impossible instead of relying on the next person
reading CLAUDE.md — the same enforcement shape CLAUDE.md already applies to gold via
`--field-label-color` / `--panel-header-color`.

The `text:` role key is in the ban list for a concrete reason: colour maps key by semantic
role rather than CSS property, and a neighbouring `border: string` type annotation makes an
automated classifier read them as borders. Five such sites were missed on the first pass.

## Verification

Full client gates, not targeted runs (CLAUDE.md: a red test hid behind green targeted runs
for four tasks in the 2026-07-24 sweep):

```bash
cd client && npx tsc --noEmit && npx vitest run && npx vite build
```

Runtime verification in a browser against the built output confirms the per-block alias
behaves as designed — a `.tactical-dark` descendant still overrides the root theme:

```
root             --rmpg-500 -> rgb(99 118 143)   (blue-silver)
.tactical-dark   --rmpg-500 -> rgb(92 110 132)   (night)
unresolvable var renders rgb(255,255,255)        (the original bug mechanism)
```

## Out of scope

- Raising `--text-muted` to clear AA at small sizes (systemic; affects all consumers).
- The `var(--x) + '22'` alpha-concatenation bug class where it involves tokens other than
  `--rmpg-*` (`ForensicLabPage`, `PayrollTab` against `--text-muted` / `--sev-warn`). Broken
  before and after this change; flagged rather than widened into.
- The 28 other dead vars already allowlisted by #3029's ratchet (`--rt-*`, `--brand-400`,
  raw `--green-*` / `--amber-*` / `--red-*` names, `--grid-*`, `--sev-warning`).
- `--accent-silver-*` being defined only in the blue-silver block.
