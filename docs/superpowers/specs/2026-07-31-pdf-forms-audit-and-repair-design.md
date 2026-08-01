# PDF Forms & Documents — Render-First Audit and Repair

**Date:** 2026-07-31
**Status:** Approved for spec review.
**Scope:** Every PDF document RMPG Flex produces, on the existing v1 engine.

## Background

RMPG Flex generates roughly 90 distinct PDF document types from 114 client
modules that import `jsPDF`. A shared design system already exists and is
mature:

- `client/src/utils/pdfTokens.ts` — colors, classification levels, fonts,
  borders, spacing, a layout grid, and page-break math.
- `client/src/utils/pdfFormHelpers.ts` — form cells and grids, NIBRS header,
  classification bar, caution-flag strip, chain-of-custody table.
- `pdfAssets.ts`, `pdfDetailHelpers.ts`, `pdfImageHelpers.ts` — seals, logos,
  form numbers, detail blocks, image embedding.

**The problem is adoption, not the absence of a standard.** Measured
2026-07-31 across the 114 generator files:

| Helper | Files importing it |
|---|---|
| `pdfTokens` | 19 |
| `pdfAssets` | 11 |
| `pdfFormHelpers` | 9 |
| `pdfImageHelpers` | 7 |
| `pdfDetailHelpers` | 6 |

38 of 114 use `splitTextToSize`, the primary overflow guard. The remaining
majority hand-draw their pages with literal coordinates.

### Why current tests do not detect this

There are 98 PDF-related test files. They are smoke tests: they assert the
generator returns a non-empty document, does not throw on awkward input, and
reports at least one page. By construction they cannot detect text overflow, a
clipped table, an `undefined` rendered into a field, or wrong branding. This
matches the prior finding recorded in `reference-serve-pdf-layout-traps`: jsPDF
layout traps are invisible without rendering the output and looking at it.

A sweep that edits code and re-runs vitest would therefore report success while
shipping the exact defects this program exists to fix. **The verification
harness is the load-bearing component of this design, not the edits.**

### Engine decision (settled)

The repo contains a second, schema-driven engine at `client/src/utils/pdf/v2/`
and a spec (`2026-07-02-pdf-visual-upgrade-phase0-1-design.md`) planning a
~90-file migration onto it. A later commit (`6fc1a06eb2`) deliberately parked
v2 and routed `client/src/utils/pdf/facade.ts` entirely to v1.

Note that the "single engine" claim is true only of the facade. `pdf/v2` is
still imported directly — bypassing the facade — by `PrintRecordButton.tsx`,
`useCitationPreview.ts`, `PdfReviewModal.tsx`, `citationFormAdapter.ts`,
`PersonDossierPage.tsx`, `CaseManagementPage.tsx`, and `MileageAuditTab.tsx`,
plus the 11 blank government forms under `v2/blankForms/`.

**This program does not migrate anything onto v2 and does not un-park it.**
Forms currently rendered by v2 are audited and fixed in place on v2; forms on
v1 are fixed in place on v1. Engine consolidation is out of scope.

## Goals

Audit and repair every PDF output type against four defect lenses:

1. **Correctness** — wrong or missing data, fields reading nonexistent columns,
   `undefined`/`NaN`/`Invalid Date` rendering, silently empty sections.
2. **Layout** — text overflow, clipped content, overlapping elements, tables
   past the margin, fields split across a page break.
3. **Compliance / legal** — classification banners, signature blocks, statute
   citations, retention language, court-acceptable formatting.
4. **Visual / branding** — consistent headers and titles, Rocky Mountain
   Protective Group identity, adherence to the shared token system.

## Non-goals

- Migrating any form to the v2 engine, or reviving the parked v2 facade route.
- Changing what a document legally asserts. See "Stop conditions".
- Altering the fixed CAD severity palette or the classification banner content.
- Refactoring generators that render correctly, purely for consistency.

## Architecture

### The harness

A development-only route, `/__pdf-gallery`, registered **only** under
`import.meta.env.DEV` so it cannot enter the production bundle or reach
Cloudflare Pages.

Rendering happens **in the browser**, not in Node. Rationale:

- Node rasterization requires a new native canvas dependency
  (`@napi-rs/canvas` or `canvas`); the browser supplies one.
- The generators are client modules importing client hooks and types; the Vite
  module graph resolves them, bare Node resolution would not.
- `pdfjs-dist@6` is already a dependency and `client/public/pdfjs/` is already
  vendored.
- Most importantly, browser output is byte-identical to what an officer's
  browser produces. A Node rasterization would not be.

The trade-off accepted: a dev route cannot fail a build on its own. CI
enforcement would require a later Playwright step layered on top. That is not
part of this program.

**Components:**

- `client/src/devtools/pdfGallery/registry.ts` — one entry per PDF output type:
  `{ id, label, criticality, generate(fixture), fixtures[] }`. No complete
  inventory of PDF output types currently exists in the repo; **building this
  registry is the audit's first deliverable.**
- `client/src/devtools/pdfGallery/fixtures/` — input data per form, three
  variants each:
  - **typical** — an ordinary, fully populated record.
  - **empty/minimal** — every optional field absent. Surfaces the
    `undefined`-rendering trap.
  - **maximal** — long names, 40-row tables, 2000-character narratives.
    Surfaces the overflow trap.

  All fixtures are synthetic. No real person, case, vehicle, or client data
  enters the repository, per the organization's no-PII rule.
- `client/src/devtools/pdfGallery/PdfGalleryPage.tsx` — renders the selected
  form to canvas at print DPI via pdfjs, page by page, with page-boundary
  rulers and margin guides overlaid so clipping and overflow are visible rather
  than inferred.

The harness is retained after the program as the standing gate: any future PDF
change is re-rendered and inspected before it lands.

### Batches

Six batches, ordered by operational criticality. Each is an independent PR
against `main`. Court and legal documents go first: they carry the highest cost
of a silent regression, and they also have the thickest existing test coverage
(`criminalHistoryPdf`, `trespassOrderPdf`, `useOfForceReportPdf`,
`acknowledgementOfService.layout`, `servePdfZone`), so the riskiest edits happen
where the safety net is strongest and the harness is freshest.

| # | Batch | Representative modules |
|---|---|---|
| 1 | Court & legal | serve/proof-of-service, acknowledgement-of-service, notice-of-attempt, trespass order, court appearance, citation, criminal history, offender registration |
| 2 | Evidence & custody | equipment custody, evidence item, bodycam/dashcam video custody, forensic case/report, jail booking sheet |
| 3 | Use-of-force & internal affairs | use-of-force report, affairs complaint, DAR, cleared summary |
| 4 | Dispatch & patrol | shift report/plan, patrol tracking, PSO notice, nav briefing/trip, plate capture, FI card, map situation report |
| 5 | Client-facing | invoice, proposal, document intake, training certificate, skip-tracer report |
| 6 | Internal & reference | audit log, knowledge base, help quick reference, NCIC/statute reference, email/transcript, task, graph |

The registry (first deliverable) is authoritative for batch membership; the
table above is the initial assignment and may gain modules the inventory
surfaces.

### Per-module fix pattern

1. Render all three fixtures; screenshot; record defects against the four
   lenses.
2. Fix **correctness first**. A field reading a nonexistent column is a worse
   defect than an ugly header, and per `project_schema_ref_bug_class` these
   exist in this codebase and are invisible at runtime.
3. Converge onto `pdfTokens` + `pdfFormHelpers` **only where the render showed a
   real problem.** Cosmetic-only rewrites of correctly-rendering files are
   prohibited: they carry the full regression risk of a rewrite and buy nothing.
4. Standardize identity: **Rocky Mountain Protective Group** in full on document
   headers and footers; "RMPG" only where space genuinely forbids it. US units
   throughout.
5. Re-render, compare against the before-screenshot, land.

## Verification

A module is fixed only when all of the following hold:

- All three fixtures render without throwing.
- A before/after screenshot pair exists and is attached to the PR body.
- The after-shot shows no text crossing a margin guide, no `undefined`, `NaN`,
  `null`, or `Invalid Date` glyphs, and a correct Rocky Mountain Protective
  Group header.

**No module is claimed fixed on a passing vitest run alone.** That is precisely
the failure mode the existing 98 smoke tests demonstrate.

### Test changes

Existing smoke tests are retained; they catch throws cheaply. Per fixed module,
targeted assertions are added for the specific defect found — not blanket new
suites.

One generic assertion is applied across the sweep: **the rendered text layer
contains no `undefined`, `NaN`, `null`, or `Invalid Date` token.** This is
extractable from the jsPDF output without rasterizing, so it runs in CI and
closes the correctness lens permanently.

### Gates

Before every batch lands:

- `cd client && npx tsc --noEmit`
- `cd client && npx vitest run` — the **full** suite, not targeted runs, per
  `feedback_full_suite_not_targeted_tests`.
- `npm run typecheck` (Worker) if the batch touches `src/`.
- Never run the root and client vitest suites concurrently; per
  `feedback_test_timeout_flakes_not_bugs` that fabricates roughly nine
  failures. Run serially.

## Stop conditions

Work halts and returns to the operator, rather than proceeding, when:

- A fix would change what a document legally asserts — signature blocks,
  statute citations, retention or records language, classification banners.
  Classification banner content is treated as correct unless stated otherwise.
- A module's defects require a data-layer or schema change rather than a
  rendering change. These are filed and reported in the batch summary; the PR
  is not expanded to absorb them.
- A defect implicates the v2 engine's architecture rather than a specific form.

## Risks

- **These documents go to courts and clients.** A rendering fix that silently
  changes an assertion is the worst available outcome. Correctness fixes are
  therefore scoped to *display* defects — wrong column, missing fallback, bad
  format. Anything touching legal substance triggers a stop condition.
- **Fixture realism bounds audit quality.** A defect only reproducible with a
  data shape no fixture covers will be missed. Mitigated by the three-variant
  scheme, not eliminated.
- **The dev route is not a CI gate.** It relies on a human looking. Layering
  Playwright on top later would close this; it is out of scope here.

## First deliverable

The registry and fixture scaffolding, plus the rendered audit corpus: every PDF
output type × three fixtures, screenshotted, with a ranked defect catalogue.
That catalogue determines the real content of batches 1–6, which are then
executed and reviewed one PR at a time.
