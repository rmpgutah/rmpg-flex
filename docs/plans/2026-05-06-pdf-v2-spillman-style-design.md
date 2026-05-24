# PDF v2 Engine — Spillman Flex / Motorola Solutions Visual Upgrade

**Date:** 2026-05-06  
**Author:** brainstormed via /superpowers:brainstorming  
**Scope:** v2 engine only (`client/src/utils/pdf/v2/engine/`)  
**Out of scope:** legacy `recordPdfGenerator.ts` (~5,890 lines, 9 record types still on it; deferred to a second pass after this lands)

## Background

The v2 PDF engine currently renders citation PDFs (and any future `FormSchema`-based record type) using bare `helvetica` Helvetica with default jsPDF spacing. The output is functional but visually generic — lacks the formal black-ink police-document gravitas of Spillman Flex / Motorola Solutions reports that operators expect.

The user's brief (2026-05-06): *"Enhance the visual output to be more formal police report style with modern visuals and fonts. No gold accent. Use the modern Spillman Flex / Motorola Solutions citation, report, and document styles exactly as they are."*

Brainstorming converged on:
- **Scope: A** (v2 engine only — small surface, future migrations inherit)
- **Direction: Spillman/Motorola B&W** (no color accents, classic black-ink formal-document look)

## Visual contract

### Typography (Helvetica throughout — no font embedding required)

| Element | Size | Weight | Case |
|---|---|---|---|
| Form title | 14pt | Bold | UPPERCASE |
| Agency name | 11pt | Bold | UPPERCASE |
| City/state subline | 8pt | Regular | UPPERCASE |
| Section header | 9pt | Bold | UPPERCASE |
| Field label | 7pt | Bold | UPPERCASE |
| Field value | 9pt | Regular | mixed |
| Footer text | 7pt | Regular | mixed |
| Page numbers | 7pt | Bold | mixed |
| Table header row | 8pt | Bold | UPPERCASE |
| Table body row | 8pt | Regular | mixed |
| Watermark | 60pt | Bold | UPPERCASE |

### Color palette

**Pure black ink only.** No gold, no navy, no accent. The 5%-gray zebra row fill on tables and 10%-black "DRAFT" watermark are the only non-pure-black tones, and both render correctly on B&W laser printers.

### Page header (every page)

```
══════════════════════════════════════════════════════════  (1.5pt black rule)
              ROCKY MOUNTAIN PROTECTIVE GROUP                  ← 11pt bold
                  SALT LAKE CITY, UTAH                          ← 8pt regular
                                                                
                       CITATION                                 ← 14pt bold
                                                                
   FORM PS-209  ·  CASE 26-CFS00242  ·  PAGE 1 OF 4              ← 7pt right-aligned
──────────────────────────────────────────────────────────  (0.5pt black rule)
```

Agency name + city/state come from a constant for now; later sourced from `system_config` so multi-tenant deploys can override.

### Section headers (between sections)

Plain bold UPPERCASE text with thin rule below. No filled bar, no gray fill — the Spillman convention.

```
SUBJECT INFORMATION
──────────────────────────────────────────────  (0.5pt rule, full content width)
```

### Field rendering

Label above value, with a form-fill underline beneath the value spanning the full field width. Multi-column rows align values to a grid.

```
  FULL NAME                  DATE OF BIRTH         DL NUMBER
  SMITH, JANE M.             03/15/1985            UT 1234567
  ────────────────────       ─────────────         ─────────────  (0.5pt underlines)
```

### Tables

- **Header row:** bold 8pt, white text on solid black 4pt-tall band
- **Body rows:** 8pt regular, alternating `#FFFFFF` / `#F5F5F5` (5% gray) zebra
- **Borders:** thin 0.5pt black on all cell edges + column dividers
- **Cell padding:** 2pt vertical, 3pt horizontal

### Footer (every page)

```
──────────────────────────────────────────────────────────  (0.5pt rule)
PROPERTY OF ROCKY MOUNTAIN PROTECTIVE GROUP — LAW ENFORCEMENT SENSITIVE
REV. 2026-04                                              PAGE 1 OF 4
                                                          FORM PS-209
```

### Watermarks

- `'blank-form'` (existing): "BLANK FORM / FOR FIELD USE" diagonal, 10% black, every page
- `'draft'` (new): "DRAFT" diagonal, 10% black, every page

## Architecture

All visual constants live in a new `engine/style.ts` module so future tweaks happen in one place. Other engine files import tokens from there. No new third-party dependencies.

```
client/src/utils/pdf/v2/engine/
├── style.ts          ← NEW: design tokens (font sizes, rule weights, spacing, copy)
├── header.ts         ← rewritten: agency + title + form-number row
├── footer.ts         ← rewritten: classification + form rev + page #
├── context.ts        ← edited: section header now plain bold + rule below (was filled bar)
├── primitives.ts     ← edited: label-above-value with form-fill underline; table zebra + black header band
├── watermark.ts      ← edited: add `'draft'` mode alongside existing `'blank-form'`
├── types.ts          ← edited: extend Watermark union with `'draft'`
├── renderer.ts       ← unchanged
├── sidecar.ts        ← unchanged
└── __tests__/
    ├── renderer.test.ts   ← snapshot baselines regenerated
    └── sidecar.test.ts    ← unchanged (visual changes don't affect sidecar bytes)
```

## Risk + mitigations

| Risk | Mitigation |
|---|---|
| Existing 41 client-side PDF tests fail on snapshot diff | Expected — regenerate baselines as part of the change. The diff IS the visual upgrade. |
| Sidecar byte stability could regress (round-trip integrity) | Visual layer is independent of sidecar embed; existing 7 sidecar tests must pass unmodified — that's the regression gate. |
| Citation print site sees broken layout in production | Run preview server, render a test citation, eyeball before deploy. |
| `pdfIntegrity` byte-count tests | Update baselines; document that visual changes will require this on future tweaks. |
| Watermark `'draft'` may not render correctly across all jsPDF versions | Reuse the same primitive used by `'blank-form'` (already shipping). |

## Out of scope (deliberate)

- Legacy `recordPdfGenerator.ts` styling — separate ~6-8hr session per the brainstorming
- Custom font embedding (Inter, IBM Plex) — Helvetica is universally available; embedding would add 200-400KB to every generated PDF for marginal aesthetic gain
- Color-accent variants — explicitly excluded per user direction
- Tenant-aware agency name/city sourcing — uses constant for now; later can read from `system_config`

## Verification path

1. All 41 PDF-related client tests pass (with regenerated baselines)
2. All 7 sidecar tests pass UNCHANGED — this is the integrity gate
3. Server-side `extractSidecar` + `verify-roundtrip` endpoints behave identically (no API contract change)
4. Manual: render a citation in dev preview, compare against the previously-printed one in `tmp/pdf-preview/citation-preview.pdf`
5. Production smoke: print a citation post-deploy; visual conforms to the design above

## Scope size

| | Lines of new/changed code |
|---|---|
| New `style.ts` | ~80 |
| Header rewrite | ~50 (was 25) |
| Footer rewrite | ~50 (was 32) |
| Section header edit | ~15 |
| Field/table primitives edit | ~80 |
| Watermark draft mode | ~15 |
| Test baseline regeneration | mechanical |
| **Total estimate** | ~300 lines, ~3-4 hours focused work, single session |
