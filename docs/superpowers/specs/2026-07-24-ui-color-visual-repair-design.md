# UI Color & Visual Repair — Blue / Silver / Gold

**Date:** 2026-07-24
**Status:** Approved (design), pending implementation plan
**Scope:** `client/` presentation layer only. No Worker, D1, or API changes.

## Problem

Operators report black overlays and surfaces that visually contradict the Blue &
Silver theme on the live app (https://rmpgutah.us). A live computed-style audit
confirmed the theme system itself is healthy — the defects are downstream of the
token layer.

### Evidence (live audit, 2026-07-24, authenticated as `AUDIT1`)

A computed-style sweep was run in-page over every rendered element, flagging
backgrounds whose relative luminance falls below the navy ramp floor
(`--surface-overlay #142840`) while not being blue-dominant.

Dashboard route (`/`), 2,921 elements:

| Class | Defect | Blast radius |
|---|---|---|
| **A — black overlay** | `.toolbar-nav-btn.active` paints `rgba(0, 0, 0, 0.38)` | Global chrome, every route |
| **B — gold leak** | `.recharts-legend-item-text` = `rgb(212, 160, 23)` hardcoded, never re-themes | Every charted route |
| **C — structural** | `<html class="theme-dark dark theme-blue-silver">` — both palettes applied at once | Whole app; latent |
| **D — per-page hex** | 5,690 hex literals across 549 `.tsx`/`.ts` files; 274 files contain `bg-black` / `#000000` / `rgba(0,0,0,…)` | Long tail |

### Root causes traced to source (2026-07-24)

Tracing the live symptoms back to source found the dominant cause is **not** the
per-page hex long tail. It is a block of theme-invariant chrome variables in
`client/src/index.css` lines 13–33, which live *outside* the theme system
(`theme-palettes.css` is imported on line 1 and owns surfaces; this block does
not participate). The block still carries its original header comment: *"Pure
black shell / Black chrome, neutral gray surfaces, gold utility accents."*

| # | Source | Defect |
|---|---|---|
| **E1** | `index.css:25` | `--titlebar-gradient: linear-gradient(180deg, #0b0b0b, #060606, #0b0b0b)` — a **pure-black gradient on every panel title bar, in every theme**. Consumed at `index.css:1381`, `:8614`, `:9038`. `html.theme-light` overrides it at `:4302`; **Blue & Silver has no override**, so it inherits pure black. This is the single largest "black overlay" source. |
| **E2** | `index.css:22` | `--toolbar-nav-active: rgba(0, 0, 0, 0.38)` — Class A. Theme-invariant black on the active nav tile. |
| **E3** | `index.css:19` | `--toolbar-nav-text: #9a9a9a` — flat gray, never re-themes to silver. |
| **E4** | `index.css:24` | `--bevel-highlight: #3a3a3a` — flat gray; day theme overrides at `:4301`, Blue & Silver does not. |
| **E5** | `theme.ts:131` + `index.html:46` | `classList.add('theme-' + theme)` runs unconditionally, then `theme-blue-silver` is added after — producing the observed `class="theme-dark dark theme-blue-silver"`. Class C, duplicated in both the runtime and the pre-paint boot script. |
| **E6** | `theme.ts:76`, `index.html:52`, `index.html:81` | `BLUE_SILVER_CHROME = '#0c1a2b'` is **stale**: the 2026-07-07 navy repair moved `--surface-base` to `#22405f`. The page root, browser `theme-color`, and `#pre-splash` therefore paint a much darker navy than the app surfaces above them, reading as a dark band/flash. |

`--window-chrome-close/minimize/maximize` (`#ef4444` / `#d4a017` / `#22c55e`) are
in the same block but are a deliberate traffic-light triad, not brand chrome —
**leave them alone**.

E1–E6 are cheap, high-leverage, and cascade to all 139 routes. They are
sequenced before the Class D sweep for that reason.

Class C is the highest-severity finding despite not being visible today.
Blue & Silver wins over the night palette **only because its block appears later
in `theme-palettes.css`** (line 250 vs line 12). Correctness depends on CSS
source order, so any bundler reordering — or a `theme-dark`-scoped rule of equal
specificity declared after line 326 — silently reverts every surface in the app
to night steel-blue with no code change.

### Non-defects (must not be "fixed")

A substantial share of the 5,690 hex literals are correct and load-bearing:

- **PDF generators** — `dispatchGuidePdfGenerator.ts` (178 literals),
  `fleetPdfReports.ts`, `navTripPdf.ts`, `navBriefingPdf.ts`. jsPDF/pdf-lib take
  literal color arguments; CSS variables are meaningless here.
- **Mapbox GL paint properties** — the style spec rejects `var(--x)`; only
  resolved color strings work (see `mapboxBasemap.ts:11-13`).
- **`.tactical-dark` surfaces** — map / dashcam / body-cam HUD / MDT / nav are
  *intentionally* near-black so a bright UI never blinds a driver at night.
- **Fixed CAD palettes** — `--spm-pri-1..9` and `--spm-stat-*` are fixed by
  Spillman spec and theme-invariant by design.
- **Severity hues** — `--sev-*` / `--stat-accent-*` encode CAD semantics.

A blind hex→token sweep breaks all five categories. The work therefore requires
a **classifier**, not find-and-replace.

## Decisions

Confirmed with the operator during design:

1. **Discovery** — live browser audit first, then trace each confirmed symptom
   back to source. No speculative fixes.
2. **Scope** — all four classes, including full Class D across all 549 files.
3. **Map palette** — Blue + Silver + Gold, **fixed across every variant**
   (Dark, Tactical Dark, legacy-black, day/night), not derived from the active
   theme.
4. **Map accent split** — Gold on major arterials and major city labels; Silver
   on secondary/minor roads and minor labels; Blue on land/water/background.
5. **Gold returns app-wide** as a third brand color, amending the documented
   Blue & Silver rule in CLAUDE.md.
6. **Gold hue shifted cooler/deeper**; severity tokens untouched.
7. **Gold roles** — field labels and section/panel headers only. Everything else
   (borders, dividers, secondary text, icons, brand chrome, active/selected
   state) stays Silver.

## Design

### Section 1 — Token layer

The trap: under Blue & Silver, `--brand-gold` **is the silver token** — that swap
is the theme's identity — and ~500 files consume the `brand-gold-*` Tailwind ramp
*expecting silver*. Repointing `--brand-gold` at real gold would flip every one
of those surfaces to gold at once, contradicting decision 7.

Resolution: introduce **explicitly-named** tokens in `html.theme-blue-silver`
rather than overloading one.

| Token | Value | Role |
|---|---|---|
| `--accent-silver` + ramp + `-rgb` | `#c3ccd6` family (current values, unchanged) | Borders, dividers, secondary text, icons — all structural chrome |
| `--accent-gold` + ramp + `-rgb` | `#b8912f` family (deepened; **not** `#d4a017`) | Field labels, section/panel headers, map arterials |
| `--brand-gold` | aliased to `--accent-silver` | Compat shim — keeps ~500 existing consumers rendering silver |
| `--field-label-color` | → `--accent-gold` | Single line that delivers gold field labels app-wide |
| `--panel-header-color` (new) | → `--accent-gold` | Section / panel header text; consumed by `PanelTitleBar` and equivalent section headings |

Both gold roles from decision 7 are covered by exactly these two variables, which
is what keeps the blast radius auditable: any surface rendering gold that does
*not* resolve through `--field-label-color`, `--panel-header-color`, or the map
palette is a defect by definition, and the live audit can assert that mechanically.

Proposed ramps:

```
--accent-gold-300: #d9bd72   (217 189 114)
--accent-gold-400: #c9a74e   (201 167  78)
--accent-gold-500: #b8912f   (184 145  47)
--accent-gold-600: #977626   (151 118  38)
--accent-gold-700: #745a1d   (116  90  29)

--accent-silver-300: #e5e9ee (229 233 238)
--accent-silver-400: #d0d8e0 (208 216 224)
--accent-silver-500: #c3ccd6 (195 204 214)
--accent-silver-600: #a0adbd (160 173 189)
--accent-silver-700: #7c8b9e (124 139 158)
```

**Why `#b8912f` and not `#d4a017`.** Legacy gold `#d4a017` is a near-neighbour of
`--sev-warn #f59e0b` and `--sev-caution #facc15`. At 9–11px CAD type on navy,
decorative gold and "overdue / threshold breached" amber become hard to separate.
This is an operational risk, not a cosmetic one: an operator may misread chrome as
a warning, or habituate to gold and start ignoring genuine amber alerts. A prior
author already hit this and invented `--stat-accent-silver`
(`theme-palettes.css:38-42`) specifically so decorative accents would stop
impersonating `--stat-accent-amber`, which is documented as *"reserved for genuine
pending/overdue/threshold signals."*

Hue alone does not separate them — `#b8912f` sits ~43° vs amber ~38°. The
effective lever is **saturation and peak brightness**: amber is ~95% saturated
with a 245 peak channel and reads as a glow; `#b8912f` is ~74% saturated with a
184 peak channel and reads as metal.

**Assumption to validate:** these values are provisional. Implementation must run
a measured WCAG contrast check of `--accent-gold-*` against `--surface-base`,
`--surface-raised`, and `--surface-sunken`, plus a side-by-side render against
`--sev-warn`/`--sev-caution`. Values may be tuned; the *constraint* (dull, deep,
distinguishable from amber, ≥4.5:1 on navy for text roles) is fixed.

Severity, stat-accent, and Spillman fixed palettes are **not modified**, so no
existing warning changes meaning.

### Section 2 — Confirmed bug fixes

- **A** — `.toolbar-nav-btn.active`: replace `rgba(0, 0, 0, 0.38)` with
  `--surface-sunken` / `--surface-hover-step`.
- **B** — add `client/src/utils/chartPalette.ts` resolving chart series, axis,
  grid, and legend colors from CSS variables; remove hardcoded `#d4a017` from all
  recharts consumers.
- **C** — stop `<html>` carrying `theme-dark` and `theme-blue-silver`
  simultaneously. Fix in `client/src/utils/theme.ts` and the pre-paint boot script
  in `client/index.html` (both must resolve identically to avoid FOUC).
  Per CLAUDE.md, any test exercising day/night or legacy-kill-switch logic must
  set `BLUE_SILVER_FLAG_KEY = '0'` in setup or default-on Blue & Silver forces
  `dark` regardless.

### Section 3 — Map palette

Add fixed `MAP_PALETTE` constants to `client/src/utils/mapboxBasemap.ts`. These
are **literal values, not `getComputedStyle`-derived**, so every variant renders
identically regardless of active theme (decision 3). This intentionally supersedes
the 2026-07-07 "maps follow the active theme" decision recorded in that file's
header comment; the header must be rewritten, not left contradicting the code.

| Layer match | Color |
|---|---|
| `background`, `land*`, `landuse`, `national-park`, `park` | Blue — navy base / sunken step |
| `water`, `ocean`, `river`, `bathymetry` | Blue — darker navy step |
| `motorway`, `trunk`, `primary` (line) | **Gold** |
| `place-city`, `place-town`, `settlement-major` (symbol) | **Gold** |
| `secondary`, `tertiary`, minor roads (line) | Silver |
| `admin`, `boundary` (line) | Silver, subtle |
| all other symbol labels | Silver |
| `poi`, `transit`, `airport`, `natural-point` | hidden (unchanged) |

Also fixes the bright tan basemap observed on the dashboard mini-map: embedded
map surfaces that currently pass variant `'light'` or never call the restyler are
routed through the dark restyle. The `'light'` variant remains available for the
print path only.

The existing never-throw contract is preserved — every mutation stays wrapped in
guarded `setPaint`/`setLayout`, because a cosmetic restyle must never blank a map
an operator depends on.

### Section 4 — Class D sweep

A classifier drives the migration.

**Excluded** (breaking these is a regression): `*Pdf*.ts`, `pdf-editor/` canvas
rendering, jsPDF/pdf-lib color arguments, Mapbox paint literals, `.tactical-dark`
fixed values, `--spm-pri-*`/`--spm-stat-*`, `--sev-*`/`--stat-accent-*`, test
fixtures and snapshots.

**In scope**: Tailwind arbitrary values (`bg-[#…]`, `text-[#…]`, `border-[#…]`),
inline `style` chrome colors, and `bg-black` / `#000000` / `rgba(0,0,0,…)`
overlays on non-tactical surfaces.

Batched by directory. Each batch is gated on worker typecheck, client typecheck,
client vitest, `vite build`, and a live re-audit of the affected routes.

### Section 5 — Verification

**Baseline — measured 2026-07-24, and it is clean.**

| Gate | Result |
|---|---|
| Worker typecheck (`npm run typecheck`) | 0 errors |
| Worker vitest (`npm test`) | 246 files, 2004 passed, 1 skipped |
| Client typecheck (`npx tsc --noEmit`) | 0 errors |
| Client vitest (`npx vitest run`) | 443 files, 3101 passed |

CLAUDE.md's recorded "12 pre-existing client typecheck errors and 9 pre-existing
client test failures" is **stale** — both are now clean. CLAUDE.md should be
corrected as part of this work.

Because the baseline is clean, **any** failure appearing during implementation is
caused by this work. There is no pre-existing noise to disentangle, so a red gate
is a hard stop rather than a judgement call.

**Worktree prerequisite:** a fresh worktree has no `client/node_modules`, and
without it `tsc` reports ~97,000 phantom `Cannot find module` errors. Run
`npm install --legacy-peer-deps` in `client/` before any gate.

**Hook note:** a repo-wide pre-commit hook runs the Worker vitest suite (~17s) on
every commit, and `core.hooksPath` is shared across worktrees. Commits will fail
on a broken Worker test even though this work does not touch `/src/`.

Per-route acceptance, via the live computed-style audit:

- `blackOverlay` count `0` on non-tactical surfaces
- `goldLeak` count `0` for unintended gold (`rgb(212,160,23)` and the legacy ramp)
- `--accent-gold` appears only on field labels, section/panel headers, and map
  arterials/major labels
- measured contrast ≥ 4.5:1 for gold and silver text roles on all three navy
  surface steps
- before/after screenshots per route

Gates: worker typecheck, client typecheck, client vitest, `vite build`.

## Delivery shape

Sections 1–3 are one coherent PR, deliverable and verifiable end-to-end.

Section 4 across 549 files is a **stack of batch PRs**, not one diff. A
549-file single PR is not reviewable, and this repo's history shows why that
matters — CLAUDE.md documents that squash-merging long-lived branches makes later
diffs appear to revert concurrently-merged work. Each batch PR must be
independently reviewable, independently deployable, and cut from current
`origin/main`.

## Out of scope

- Worker (`/src/`), D1 schema, and API changes.
- Migrating the retired night/day/legacy-black palettes to the new token names.
  They remain selectable opt-outs and keep `--brand-gold` as real gold.
- Deleting the `--brand-gold` compat alias. It is removed only after Section 4
  migrates its consumers to `--accent-silver`.
- Any change to severity, priority, or unit-status hues.

## Risks

| Risk | Mitigation |
|---|---|
| Mass gold flip from repointing `--brand-gold` | Explicit `--accent-*` tokens + compat alias (Section 1) |
| Decorative gold misread as a warning | Deepened low-saturation gold + gold restricted to non-status roles + measured side-by-side check |
| Hex sweep breaks PDFs / Mapbox / tactical-dark | Classifier exclusion list; batch-level build + live re-audit |
| Pre-existing failures attributed to this work | Record baseline before first edit |
| Theme reverts via CSS source order | Section 2C removes the ordering dependency |
| Cosmetic restyle blanks a live map | Preserve guarded `setPaint`/`setLayout` never-throw contract |
