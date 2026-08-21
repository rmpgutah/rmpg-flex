# PDF Navy Letterhead Alignment — Design Spec
**Date:** 2026-08-20  
**Status:** Approved

## Problem

The RMPG Flex PDF system has two visual tiers:

1. **Token-system generators** (~40+ files) — use `addReportHeader()` from `pdfGenerator.ts`. Navy header (`#1a2f5c`), white agency name, gold accents. Current standard since the 2026-07-03 letterhead restoration.

2. **Standalone generators** (~30 files) — each defines `const RMPG_GOLD = '#d4a017'` and draws a gold-fill banner with dark text. The pre-July-2026 style. These look like documents from a different agency when printed alongside token-system documents.

**Goal:** Bring all standalone generators to the navy letterhead standard. Every RMPG PDF must use the same header chrome.

**Excludes:**
- `navBriefingPdf.ts` / `navTripPdf.ts` — tactical navigation, intentional black+gold
- `invoicePdfGenerator.ts` — already uses `brand.header_bg_color` = navy
- `pdfTokens.ts` / `pdfGenerator.ts` — source of truth, not targets

## Files to Update (30 total)

### 28 files with gold-fill banner → navy banner
```
utils/affairsComplaintPdf.ts
utils/auditLogPdf.ts
utils/bodycamVideoCustodyPdf.ts
utils/clearedSummaryPdf.ts
utils/codeEnforcementPdf.ts
utils/conversationTranscriptPdf.ts
utils/courtAppearancePdf.ts
utils/criminalHistoryPdf.ts
utils/dashcamReviewPdf.ts
utils/documentIntakePdf.ts
utils/emailThreadPdf.ts
utils/equipmentCustodyPdf.ts
utils/evidenceItemPdf.ts
utils/fiCardPdf.ts
utils/forensicCasePdf.ts
utils/intelProductPdf.ts
utils/jailBookingSheetPdf.ts
utils/knowledgeBaseSearchPdf.ts
utils/nationalWarrantPdf.ts
utils/ncicReferencePdf.ts
utils/offenderRegistrationCardPdf.ts
utils/plateCapturePdf.ts
utils/shiftPlanPdf.ts
utils/shiftReportPdf.ts
utils/skipTracerReportPdf.ts
utils/taskPdf.ts
utils/trainingCertificatePdf.ts
utils/trespassOrderPdf.ts
utils/useOfForceReportPdf.ts
utils/webResearchReportPdf.ts
```

### 2 files with non-standard headers → navy banner added
```
utils/darPdf.ts          — plain black header, no gold at all
utils/forensicReportPdf.ts — gold accent lines, no agency fill block
```

## Architecture

### New file: `utils/pdfStandaloneHeader.ts`

Single export: `drawNavyBanner(doc, opts): number`

Works in **pt units** (matching all standalone generators). Does NOT depend on `pdfTokens.ts` (which uses mm). Uses literal RGB values sourced from the token system for consistency.

```ts
interface NavyBannerOpts {
  title: string;        // "TRESPASS ORDER — TO-2026-001"
  subtitle?: string;    // optional 2nd line, e.g. "Rocky Mountain Protective Group · Records Division"
  rightLine1?: string;  // right-aligned, row 1 (e.g. date)
  rightLine2?: string;  // right-aligned, row 2 (e.g. issuing officer)
  y?: number;           // default 36pt (matches M in all generators)
  marginPt?: number;    // default 36pt
}

// Returns the new y cursor after header + gap
function drawNavyBanner(doc: jsPDF, opts: NavyBannerOpts): number
```

### Visual spec (pt coordinates, Letter 612×792)

```
y ┌─────────────────────────────────────────────────────────┐  navy fill RGB(26,47,92) 36pt tall
  │  ROCKY MOUNTAIN PROTECTIVE GROUP        [rightLine1]     │  white bold 9pt / white 8pt right
  │  [title / subtitle]                     [rightLine2]     │  RGB(190,200,215) 8pt / white 7.5pt
y+36 └──────────────────────────────────────────────────────┘
y+37 ─────────────────── gold rule 0.75pt RGB(212,160,23) ──────
```

Cursor returned: `opts.y + 36 + 1 + 9` = `opts.y + 46`

Previously generators advanced `y += 38` (28pt banner + 10pt gap). New: `y += 46` (36pt + 1pt rule + 9pt gap). **8pt net increase per page.** All downstream `checkPageBreak`/`newPageIfNeeded` calls absorb this because they check remaining space, not absolute y positions.

### Per-generator change

Each generator's banner block (~8 lines) becomes:

```ts
// BEFORE:
doc.setFillColor(RMPG_GOLD);
doc.rect(M, y, W - 2 * M, 28, 'F');
doc.setFont('Arial', 'bold');
doc.setFontSize(14);
doc.setTextColor(TEXT_DARK);
doc.text(`DOCUMENT TITLE — ${id}`, M + 10, y + 19);
doc.setFontSize(9);
doc.setFont('Arial', 'normal');
doc.text(fmtDateTime(new Date()), W - M - 10, y + 19, { align: 'right' });
y += 38;

// AFTER:
y = drawNavyBanner(doc, {
  title: `DOCUMENT TITLE — ${id}`,
  subtitle: 'Rocky Mountain Protective Group · Records Division',
  rightLine1: fmtDateTime(new Date()),
});
```

The agency strap lines that immediately follow the banner (e.g. `"Rocky Mountain Protective Group · Records Division"`) move INTO the banner as `subtitle`. The strap `y += 14` advance is removed — net y change per page is +8pt (same as stated above).

### Color invariants (sourced from pdfTokens.ts for reference)
| Role | Value |
|---|---|
| Banner fill | RGB(26, 47, 92) = `#1a2f5c` (BG_SECTION_HDR) |
| Agency name text | RGB(255, 255, 255) = white (TEXT_INVERTED) |
| Title/subtitle text | RGB(190, 200, 215) = pale steel-blue (TEXT_SUBHEAD_INVERTED) |
| Right-column text | RGB(255, 255, 255) = white |
| Gold rule | RGB(212, 160, 23) = `#d4a017` (ACCENT_GOLD) |

## Existing local constant cleanup

Each updated file's now-unused local constants are removed:
```ts
// REMOVE from each file:
const RMPG_GOLD = '#d4a017';
const TEXT_DARK = '#1a1a1a';
// Keep: TEXT_MUTED, BORDER, ROW_ALT, alert-color constants (still used in sections)
```

## Testing

- All 110 PDF test files (1,463 tests) must pass after changes — run via `npx vitest run --config vitest.pdf.config.ts`
- No new tests needed: existing smoke tests verify the generators don't throw and produce a non-empty PDF
- The `pdfTokens.test.ts` color pin tests continue to pass (no token changes)

## Non-goals

- Converting standalone generators from `unit: 'pt'` to `unit: 'mm'` — separate refactor
- Adding logo, classification bars, or case-number boxes to standalone generators — those require the full `addReportHeader()` port
- Changing section drawing code, field layout, or table rendering — header only
