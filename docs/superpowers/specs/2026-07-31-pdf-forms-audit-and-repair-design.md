# PDF Forms & Documents — Render-First Audit, then v2 Migration

**Date:** 2026-07-31
**Status:** Approved. Revised 2026-07-31 — v2 migration reinstated as stage 2.
**Scope:** Every PDF document RMPG Flex produces, whichever engine renders it
today. Stage 1 (this spec's deliverable) audits them all; stage 2 migrates them
onto v2 and is speced separately.

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

**REVISED 2026-07-31 (operator decision): v2 IS the destination.** The original
revision of this spec listed migration as a non-goal and kept v2 parked. The
operator reversed that after review, having been shown that it contradicts the
non-goal as written. The program is therefore two-stage:

1. **Audit first** (this spec's first deliverable, unchanged) — inventory every
   document type, render it, catalogue its defects. Engine-agnostic.
2. **Then migrate** — move document types onto the v2 engine, using the audit
   harness as the verification gate for each one.

Sequencing is not optional. Migrating a renderer before you know what its
current output is wrong about means you cannot tell a migration regression from
a pre-existing defect. The catalogue is what makes the migration reviewable: for
each form it says what v2 must reproduce, what it must fix, and what was already
broken.

The v2 engine is a genuine target, not a stub — 2,032 lines across seven engine
modules (`renderer`, `primitives`, `types`, `style`, `sidecar`, `watermark`,
`severityMeter`), with 8 forms and 11 blank government forms already on it.

Migration phases are **not speced here.** They follow the 2026-07-02 roadmap's
shape (`docs/superpowers/specs/2026-07-02-pdf-visual-upgrade-phase0-1-design.md`
— Phase 0 engine hardening, then phased form groups) and each gets its own
brainstorm and spec once the catalogue exists.

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

- ~~Migrating any form to the v2 engine~~ — **reversed 2026-07-31**, see the
  Engine decision above. Migration is now the program's second stage; it is
  still out of scope for *this spec's* deliverable, which is the audit.
- Changing what a document legally asserts. See "Stop conditions". This
  constraint survives the reversal and binds the migration too: a form rendered
  by v2 must assert exactly what the v1 form asserted, minus catalogued defects.
- Bumping the printed revision marker (`FORM_REVISION`, currently `'Rev. 2026-03'`
  in `pdfAssets.ts:242`) or the `FORM_NUMBERS` catalogue. Held until the audit
  and migration land, per operator decision 2026-07-31, so that a version bump
  designates genuinely corrected forms rather than preceding them. Archived
  copies already in court and client hands carry the current markers.
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

## Stage 2 — migration (shape only; speced separately)

Recorded here so the audit is built to serve it, not re-derived later.

- **The harness gains a side-by-side mode.** `/__pdf-gallery` renders the same
  fixture through v1 and v2 simultaneously. A migration is reviewable when a
  human can see both outputs at once; it is not reviewable from a diff of
  renderer code.
- **The text-layer assertion library is the automated half.** It is
  engine-agnostic — it reads any jsPDF output — so the same
  `expectNoPlaceholderLeaks` gate applies to a v2 form unchanged. A migrated
  form must pass it at least as well as the v1 form did.
- **The catalogue is the per-form acceptance criteria.** For each document:
  what v2 must reproduce exactly, what it must fix (a catalogued defect), and
  what was already broken and stays out of scope.
- **Per-form, behind the facade, one PR each** — the routing point is
  `client/src/utils/pdf/facade.ts`, which is the single seam that decides engine
  per form type. The 2026-07-02 spec's warning stands: do this as scoped PRs
  with side-by-side review, never a global flip.
- **Forms already on v2** (citation, dossier, case report, trip log, and the 11
  blank government forms) are audited like any other and need no migration.

## First deliverable

The registry and fixture scaffolding, plus the rendered audit corpus: every PDF
output type × three fixtures, screenshotted, with a ranked defect catalogue.
That catalogue determines the real content of batches 1–6, which are then
executed and reviewed one PR at a time.
