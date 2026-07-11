# v1 Report System — Color Restoration + Navy Letterhead

**Status:** Approved for spec review. Sibling program to
[`2026-07-02-pdf-visual-upgrade-phase0-1-design.md`](2026-07-02-pdf-visual-upgrade-phase0-1-design.md)
— that program migrates report types from v1 → v2. This program stays
entirely inside **v1** (`client/src/utils/*Pdf*.ts`,
`client/src/pages/fleet/utils/*Pdf.ts`) and does not touch or depend on the
v2 engine.

## Background

`pdfTokens.ts` — the single shared design-token file imported by all ~90 v1
report generators — is currently **pure grayscale by deliberate past
decision**: `ACCENT_GOLD` is `[0,0,0]`, every flag/priority/classification
color was neutralized to a gray ramp on 2026-05-30 under a documented
"zero-blue rule," following an even earlier grayscale pivot on 2026-05-04.
The stated reasons were print-toner cost and a company preference at the
time for zero color splash.

The user has since supplied the real RMPG letterhead reference: a navy
(`#1a2f5c`) agency letterhead with the actual eagle/mountain seal, a gold
italic tagline, and a bordered case/report-number box with a barcode. Two
seal image files now live in the repo:
`client/public/rmpg-seal-navy.jpg` and `client/public/rmpg-seal-bw.jpg`.

**Decision: this reverses the 2026-05/06 grayscale decision.** Navy + gold
become the new color baseline for the entire v1 report system, not just the
header. This is a deliberate, explicit supersession — call sites that
currently read "grayscale (was gold/red/blue), neutralized 2026-05-30" in
`pdfTokens.ts` comments are the ones this program restores to color.

## Scope

**In scope:**
- Rewrite `pdfTokens.ts` color tokens: `ACCENT_GOLD` → real gold, the neutralized
  flag/priority/classification/caution grays → their pre-2026-05-30 semantic
  colors reinterpreted through the navy/gold palette (see Token Changes),
  `BG_SECTION_HDR` → navy.
- New letterhead header treatment (see Header Design) applied to every v1
  report's page-1 header via the shared header-drawing code path in
  `recordPdfGenerator.ts` / `pdfFormHelpers.ts` (wherever the header is
  currently drawn once and reused — confirm the actual shared function name
  during planning, don't assume).
- Audit + fix visual inconsistencies **within the existing v1 layout system**
  across all ~90 report types, batched by domain (see Batching below):
  drifted spacing, mismatched title casing/punctuation, tables not using the
  shared `drawFormRow`/`drawFormCell` primitives, stale color literals that
  bypass `pdfTokens.ts` entirely.
- Continuation-page (page 2+) header: compact variant of the new letterhead
  (smaller seal, no tagline, agency name + case number strip only) —
  mirrors the distinction already sketched in the `advanced-full-build.html`
  mockup.

**Out of scope (explicitly):**
- No v1 → v2 migration. That is the separate, already-approved
  `2026-07-02-pdf-visual-upgrade-phase0-1-design.md` program.
- No new visual features beyond what's needed to apply the new palette and
  letterhead consistently (no new primitives, no new report sections).
- No changes to report *content* — field lists, computed values, business
  logic are untouched.

## Token Changes (`pdfTokens.ts`)

| Token | Current (grayscale) | New |
|---|---|---|
| `ACCENT_GOLD` | `[0,0,0]` | `[212,160,23]` (`#d4a017`, canonical brand gold) |
| `BG_SECTION_HDR` | `[51,51,51]` | `[26,47,92]` (`#1a2f5c`, letterhead navy) |
| `BG_SIDEBAR_TAB` | `[0,0,0]` | `[26,47,92]` (navy, matches section header) |
| `RULE_GOLD` | `[80,80,80]` (was gold) | `[212,160,23]` (restored) |
| `FLAG_ARMED` / `FLAG_WARRANT` / `FLAG_GANG` / `FLAG_MENTAL` / `FLAG_MEDICAL` | gray ramp | restore pre-neutralization hues, reinterpreted as navy-family + gold for high-severity (exact mapping decided during planning — this spec fixes the *direction*, not every hex) |
| `PRIO_1_BG`…`PRIO_4_BG` | gray ramp (darkest→lightest) | navy→gold severity ramp (darkest/most urgent = navy, lightest = pale gold) |
| `CLASSIFICATION.*` bars | gray ramp | navy-family, `SEALED`/`DRAFT` keep a distinct treatment (not gold — these are warnings, gold is reserved for accent use) |
| `TEXT_TABLE_HDR_LIGHT` / `BG_TABLE_HDR` | `[54,54,54]` / `#e0e0e0` light gray (2026-07-03 tone reconfig, this session) | **kept as-is** — the light-gray table header from today's earlier tone-reconfig work is compatible with the navy system and is not being reverted |

Every token change lands as an edit to the existing named constant in
`pdfTokens.ts` — no new tokens, no call-site changes required for anything
that already imports from `COLOR`/`CLASSIFICATION`. Call sites that
currently hardcode a color literal instead of importing the token (the
"drift" this audit is partly about) are fixed to import the token instead,
which is how they pick up the new palette automatically.

## Header Design (Letterhead)

Page-1 header, left-to-right:
- Real seal image (`rmpg-seal-navy.jpg`), circular, left-aligned — replaces
  today's centered/absent-by-default header treatment.
- Agency name "ROCKY MOUNTAIN PROTECTIVE GROUP, LLC," navy, bold, next to
  the seal (not centered under it).
- Subtitle line: report-type-specific (e.g. "INCIDENT / OFFENSE REPORT —
  CASE FACE SHEET" for case reports; each report type gets its own subtitle
  matching its existing FORM number/title).
- Italic gold tagline beneath the subtitle: "TO SERVE, CONSULT, AND PROTECT
  THE UTAH WASATCH FRONTIER." — new element, static text, same on every
  report.
- Right-aligned bordered box: "CASE / REPORT NO." label, the case/report
  number, the existing Code 39 barcode (already drawn elsewhere in the v1
  system — reused, not reimplemented), "PAGE N OF M · PRINTED <date>."
- Double rule beneath the full header band (thick navy + thin navy hairline)
  — replaces the current single thick+thin combo.

Continuation pages (2+) get a compact variant: smaller seal, agency name
only (no subtitle/tagline), case-number strip on the right, single rule.

`rmpg-seal-bw.jpg` is kept as a fallback asset for any future single-color/
high-contrast printing context but is not wired into the default color path
by this program.

## Batching (audit + fix sweep)

Same domain groupings as the original v2-migration roadmap, applied here to
v1 files directly:

1. Records (persons, businesses, properties, cases)
2. Law-enforcement forms (warrant packet, use-of-force, FI card, criminal
   history, offender registration, trespass order)
3. Evidence / custody
4. Dispatch / patrol (CFS, patrol logs, timeline strips)
5. Fleet
6. Business / admin (invoices, contracts, proposals)

Each batch: apply the new letterhead header, sweep for hardcoded color
literals that bypass `pdfTokens.ts`, verify shared primitives
(`drawFormRow`/`drawFormCell`, posture band, timeline strip) render
correctly against the new palette, confirm no regressions in existing
vitest smoke tests for that batch's generators.

## Verification

- Existing `*.smoke.test.ts` files per generator continue to assert
  structural output (page count, text presence) — not pixel color, so token
  changes don't break them, but they still catch drawing-order regressions.
- Manual visual check (jsPDF output has no browser preview path) via
  generating one sample PDF per batch and reviewing it directly, same
  verification method already used earlier this session for the CFS/person
  formatting fixes.
