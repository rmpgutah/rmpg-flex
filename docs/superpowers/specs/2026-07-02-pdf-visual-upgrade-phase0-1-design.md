# PDF Printout Visual Upgrade — Phase 0 (Engine) + Phase 1 (Core Records)

**Status:** Approved for spec review. First two phases of a larger ~90-file migration program (see Program Roadmap below).

## Background

RMPG Flex has two parallel PDF-generation systems:

1. **v1 (legacy, ~67 files)** — every `client/src/utils/*Pdf*.ts` and
   `client/src/pages/fleet/utils/*Pdf.ts` file imports `jsPDF` directly and
   hand-draws the page, optionally using shared helpers (`pdfTokens.ts`,
   `pdfFormHelpers.ts`, `pdfDetailHelpers.ts`, `pdfAssets.ts`,
   `pdfImageHelpers.ts`, `pdfGenerator.ts`). Grayscale-only ink (a 2026-05-30
   "zero-color" pass), inconsistent title conventions (em-dash vs hyphen),
   inconsistent use of the shared helpers.
2. **v2 (new, schema-driven)** — `client/src/utils/pdf/v2/`. Generators
   declare a `FormSchema<T>` (meta + typed field sections) and
   `engine/renderer.ts` interprets it. Has its own token file
   (`engine/style.ts`, "Spillman Flex / Motorola Solutions, low-ink"),
   multi-copy rendering, an Ed25519-signed JSON sidecar for round-trip
   verification, and watermarking. Only **citation** and **trip log** (plus
   11 blank government forms) have migrated — roughly 3% of report types.

v2 is the intended target architecture. This program migrates the remaining
report types onto it, upgrading their visual design in the process to match
the app's authentic Spillman Flex look — restrained steel-blue accents
layered onto the existing print-safe black/white base (not a full-color
redesign; see Visual Direction below).

A third system, `client/src/lib/rmpg-pdf-engine/`, is a PDF **viewer/reader**
(native parser + PDF.js fallback) used by the in-app PDF editor and document
viewer. It does not generate reports and is out of scope for this program.

## Program Roadmap (informational — only Phase 0/1 are speced here)

| Phase | Scope |
|---|---|
| **0** | Harden the v2 engine's visual system: color tokens, missing primitives (photo grid, badge chips, severity meter, cross-reference chip) |
| **1** | Migrate core records: `caseReportGenerator.ts`, `recordPdfGenerator.ts`, `recordPdfGeneratorExt.ts`, `dossierPdfGenerator.ts`, `pdfDossierRenderer.ts` |
| 2 | Law-enforcement forms (warrant packet, use-of-force, FI card, criminal history, offender registration, trespass order) |
| 3 | Evidence/custody chain (equipment custody, evidence item, bodycam/dashcam custody) |
| 4 | Dispatch/patrol (DAR, shift report/plan, patrol tracking, PSO notice) |
| 5 | Fleet reports (9 files) |
| 6 | Business/admin/comms (invoices, proposals, intake, training certs, transcripts, etc.) |

Each later phase gets its own brainstorming pass and spec once Phase 0/1 ship
and validate the pattern.

## Visual Direction

- **Base stays print-safe black/white/gray** — body text, field values,
  table borders, and the existing classification banners (LES/CUI/FOUO/
  CONFIDENTIAL/SEALED/DRAFT) remain grayscale. These banners are a
  regulatory/legal convention, not a branding choice — untouched.
- **New restrained steel-blue accent** (`#2c4256`, sampled from the app's
  `--rmpg-700` night token) used for: the header's top rule, section-header
  underline rule, table header band fill, and badge/status chip fills.
  Brand gold `#d4a017` is reserved for one-off "flagged/priority" emphasis
  (e.g. active-warrant caution banners), mirroring its use in the live UI.
  `WATERMARK_VOID` red stays as-is.
- Everything renders at 100% on a color printer and degrades gracefully to
  gray screening on a B&W laser printer (steel-blue and gold both print as
  distinguishable mid-gray).

## Phase 0 — Engine Hardening

**Token changes (`engine/style.ts`):**
- Add `TONES.accentSteel = '#2c4256'` and `TONES.accentGold = '#d4a017'`.
- `RULE_WEIGHTS.headerThick` and `sectionRule` render in `accentSteel`
  instead of black; `tableHeaderBand` fill becomes `accentSteel` with white
  header text (inverted, matching the in-app Spillman table header style).
- Everything else (body text, field labels/values, borders) stays black —
  no change to `TYPOGRAPHY`.

**New primitives (`engine/primitives.ts` + new `engine/badge.ts`):**
- `drawBadge(doc, layout, {label, tone: 'steel'|'gold'|'neutral'})` — small
  rounded-rect status chip (e.g. "ACTIVE WARRANT", "CLEARED", "VERIFIED"),
  ported from v1's `pdfDetailHelpers.ts` badge-chip concept.
- `drawSeverityMeter(doc, layout, {level, max})` — horizontal segmented bar
  (ported from v1's severity meter), steel/gold/red segments by severity.
- `drawPhotoGrid(doc, layout, {images, columns})` — lays out embedded
  photos (evidence/mugshot/damage photos) in a grid with captions, reusing
  `pdfImageHelpers.ts`'s existing fetch/downscale/embed logic (that file is
  shared, not duplicated).
- `drawCrossRefChip(doc, layout, {label, refType})` — small inline
  reference badge (e.g. linking to a related case/person), ported from
  v1's cross-reference badge chip.

These are pure additions — no existing `FormSchema`/renderer behavior
changes, so citation/trip-log/blank-forms output is unaffected except for
the header/section-rule/table-header recoloring (verified via updated
snapshot tests).

**Testing:** update existing `__tests__/` snapshot hashes for the 3 files
that change visually (header.ts, renderer table rendering, existing
snapshot suite already in place); add new unit tests for the 4 new
primitives (`badge.test.ts`, `photoGrid.test.ts`, etc.), following the
existing test patterns in `engine/__tests__/`.

## Phase 1 — Core Records Migration

Migrate the 5 highest-visibility record/case report generators from v1 to
v2 `FormSchema` definitions, using Phase 0's new steel-blue tokens and
primitives:

- `caseReportGenerator.ts` → `pdf/v2/forms/caseReport.ts`
- `recordPdfGenerator.ts` + `recordPdfGeneratorExt.ts` → `pdf/v2/forms/record.ts`
  (merge the two — `Ext` was a follow-on for billing/PS-301 fields that
  belong as an optional schema section, not a separate file)
- `dossierPdfGenerator.ts` + `pdfDossierRenderer.ts` → `pdf/v2/forms/dossier.ts`
  (same merge rationale)

**Pattern (mirrors the existing citation migration):**
1. Define the `FormSchema<T>` for each report type in `pdf/v2/forms/`.
2. Keep the existing public function signature (e.g.
   `generateCaseReportPdf(data): Promise<Blob>`) as a thin adapter — same
   approach as `citationFormAdapter.ts` — so every call site
   (`PrintRecordButton.tsx`, page components, etc.) needs zero changes.
3. Delete the old v1 file once its v2 replacement is verified end-to-end
   (byte-snapshot test + one real browser-rendered PDF check per report
   type via the preview tools).
4. Preserve existing `FORM_NUMBERS` registry entries, filenames, and any
   sidecar/signature behavior already relied upon downstream.

**Out of scope for Phase 1:** any field/data changes to the reports
themselves — this is a visual/architecture migration only, not a
content redesign. If a report is missing data it should have, that's a
separate bug ticket.

**Testing:** new snapshot tests per form (following `engine/__tests__/`
conventions), plus manual verification via the preview tools (render each
of the 3 merged report types with representative data and screenshot the
output) since these are the most-viewed report types in the app.

## Risks / Open Questions

- `recordPdfGenerator`/`Ext` and `dossierPdfGenerator`/`pdfDossierRenderer`
  merges assume the split was purely historical (data-availability driven)
  rather than intentional separation of concerns — confirm during
  implementation by diffing what each pair actually renders.
- Deleting v1 files requires confirming no other code path (e.g. a cron
  job, an export-all-records batch feature) calls them directly instead of
  through the page-level call sites already identified.
