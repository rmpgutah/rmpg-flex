# v1 Report Color Restoration — Foundation + Records Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore navy (#1a2f5c) + gold (#d4a017) color to the v1 PDF report engine (currently pure grayscale by a 2026-05/06 decision), ship the new left-aligned letterhead header with the real seal, and sweep the Records domain batch (persons/vehicles/businesses/properties/warrants/evidence/citations, all served by `recordPdfGenerator.ts`) for color-token drift.

**Architecture:** Two color sources feed the v1 header: `pdfTokens.ts`'s `COLOR` constants (used by section headers, tables, flags, priority bars, classification banners across all generators) and a separate `PdfBranding` config object in `pdfGenerator.ts` (`DEFAULT_PDF_BRANDING`, read by `addReportHeader()` for the agency-header bar, case-number box, and accent lines). Both must change together — a token-only fix would leave the header itself gray. This plan restores both, rewrites `addReportHeader()` to the new letterhead layout, swaps in the real seal asset, and sweeps one domain batch (Records) as the first proof that the new palette is consistent end-to-end. Batches 2–6 (law-enforcement forms, evidence/custody, dispatch/patrol, fleet, business/admin) are out of scope for this plan and get their own follow-up plans once this one lands and is verified — see the Scope note in the spec.

**Tech Stack:** jsPDF (v1 report engine), Vitest (existing smoke-test pattern: `(doc.internal.pages[1] as unknown as string[]).join('\n')` to assert on rendered text).

**Spec:** [`docs/superpowers/specs/2026-07-03-v1-report-color-restoration-letterhead-design.md`](../specs/2026-07-03-v1-report-color-restoration-letterhead-design.md)

---

## File Structure

- Modify: `client/src/utils/pdfTokens.ts` — color token values only, no new tokens, no signature changes.
- Modify: `client/src/utils/pdfGenerator.ts` — `DEFAULT_PDF_BRANDING` (line 133), `addReportHeader()` (lines 559–705).
- Replace: `client/src/assets/rmpg-seal.png` — binary asset swap, no code change (existing `loadSealBase64()` in `pdfAssets.ts` already reads this exact path).
- Modify: `client/src/utils/recordPdfGenerator.ts`, `client/src/utils/recordPdfGeneratorExt.ts` — drift fixes only (replace hardcoded color literals with `COLOR.*` token imports), no structural changes.
- Test: `client/src/utils/__tests__/pdfTokens.test.ts` (new) — asserts the restored token values.
- Test: `client/src/utils/__tests__/pdfGenerator.smoke.test.ts` (existing, extend) — asserts the new header renders the tagline and doesn't throw.

---

### Task 1: Restore color tokens in `pdfTokens.ts`

**Files:**
- Modify: `client/src/utils/pdfTokens.ts`
- Test: `client/src/utils/__tests__/pdfTokens.test.ts`

- [ ] **Step 1: Write the failing test**

Create `client/src/utils/__tests__/pdfTokens.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { COLOR, CLASSIFICATION } from '../pdfTokens';

describe('pdfTokens color restoration (navy + gold baseline)', () => {
  it('ACCENT_GOLD is the canonical brand gold, not black', () => {
    expect(COLOR.ACCENT_GOLD).toEqual([212, 160, 23]); // #d4a017
  });

  it('RULE_GOLD matches ACCENT_GOLD', () => {
    expect(COLOR.RULE_GOLD).toEqual([212, 160, 23]);
  });

  it('BG_SECTION_HDR is letterhead navy, not charcoal', () => {
    expect(COLOR.BG_SECTION_HDR).toEqual([26, 47, 92]); // #1a2f5c
  });

  it('BG_SIDEBAR_TAB matches BG_SECTION_HDR (navy)', () => {
    expect(COLOR.BG_SIDEBAR_TAB).toEqual([26, 47, 92]);
  });

  it('PRIO_1_BG (most urgent) is navy, PRIO_4_BG (least urgent) is pale gold', () => {
    expect(COLOR.PRIO_1_BG).toEqual([26, 47, 92]);
    expect(COLOR.PRIO_4_BG).toEqual([230, 210, 160]);
  });

  it('CLASSIFICATION bars use the navy family, not gray', () => {
    expect(CLASSIFICATION.LES.bg).toEqual([26, 47, 92]);
    expect(CLASSIFICATION.CONFIDENTIAL.bg).toEqual([15, 28, 56]);
  });

  it('BG_TABLE_HDR stays the 2026-07-03 light-gray tone-reconfig value (not reverted)', () => {
    expect(COLOR.BG_TABLE_HDR).toEqual([224, 224, 224]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/__tests__/pdfTokens.test.ts`
Expected: FAIL — `COLOR.ACCENT_GOLD` is currently `[0, 0, 0]`, not `[212, 160, 23]`.

- [ ] **Step 3: Update the token values in `pdfTokens.ts`**

Edit `client/src/utils/pdfTokens.ts`. Replace the `ACCENT_GOLD` block (around line 76-83):

```ts
  // Brand accent — restored to color 2026-07-03 (navy letterhead program,
  // supersedes the 2026-05-04 grayscale pivot). Real gold, used for the
  // header tagline, section-close rule, and priority-bar high end.
  ACCENT_GOLD:     [212, 160, 23]   as const,  // #d4a017 — canonical brand gold
```

Replace `RULE_GOLD` (around line 118):

```ts
  RULE_GOLD:           [212, 160, 23]   as const,  // #d4a017 — restored 2026-07-03
```

Replace `BG_SECTION_HDR` and `BG_SIDEBAR_TAB` (around lines 63-71 and 113):

```ts
  BG_SECTION_HDR: [26, 47, 92]    as const,  // #1a2f5c navy — restored 2026-07-03 (was #333 charcoal)
```

```ts
  BG_SIDEBAR_TAB:      [26, 47, 92]     as const,  // #1a2f5c navy — restored 2026-07-03
```

Replace the priority bar ramp (around lines 136-140) — darkest/most urgent is navy, lightest/least urgent is pale gold:

```ts
  PRIO_1_BG:           [26, 47, 92]     as const,  // #1a2f5c navy — most urgent
  PRIO_2_BG:           [58, 84, 138]    as const,  // mid navy
  PRIO_3_BG:           [140, 130, 90]   as const,  // navy-to-gold transition
  PRIO_4_BG:           [230, 210, 160]  as const,  // pale gold — least urgent
```

Replace the `CLASSIFICATION` bars (around lines 160-166) — navy family, darkest = most restrictive:

```ts
  LES:          { bg: [26, 47, 92],   fg: [255, 255, 255], label: 'LAW ENFORCEMENT SENSITIVE // CJIS' },
  CUI:          { bg: [40, 62, 112],  fg: [255, 255, 255], label: 'CONTROLLED UNCLASSIFIED INFORMATION // LE' },
  FOUO:         { bg: [58, 84, 138],  fg: [255, 255, 255], label: 'FOR OFFICIAL USE ONLY' },
  UNCLAS:       { bg: [90, 110, 150], fg: [255, 255, 255], label: 'UNCLASSIFIED' },
  CONFIDENTIAL: { bg: [15, 28, 56],   fg: [255, 255, 255], label: 'CONFIDENTIAL // NOFORN' },
  SEALED:       { bg: [10, 18, 38],   fg: [212, 160, 23],  label: 'SEALED BY COURT ORDER -- DO NOT DISSEMINATE' },
  DRAFT:        { bg: [110, 110, 110], fg: [255, 255, 255], label: 'DRAFT -- UNOFFICIAL -- NOT FOR DISTRIBUTION' },
```

(`DRAFT` stays gray deliberately — it's a workflow-state marker, not a classification level, and doesn't fit the navy/gold semantic palette.)

Do **not** touch `BG_TABLE_HDR`, `BG_TABLE_HDR_LIGHT`, or `TEXT_TABLE_HDR_LIGHT` — those were changed in the 2026-07-03 tone-reconfig work earlier today and the spec keeps them as-is.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/__tests__/pdfTokens.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Run the full client test suite to check for regressions**

Run: `cd client && npx vitest run`
Expected: PASS. Any failing snapshot/assertion test that hardcodes an old gray RGB tuple for one of the changed tokens needs its expected value updated to match — update the test, not the token (the token change is the intended behavior).

- [ ] **Step 6: Commit**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/charming-tesla-0fc9dd"
git add client/src/utils/pdfTokens.ts client/src/utils/__tests__/pdfTokens.test.ts
git commit -m "feat(pdf-v1): restore navy+gold color tokens (reverses 2026-05 grayscale pivot)"
```

---

### Task 2: Restore branding defaults in `pdfGenerator.ts`

**Files:**
- Modify: `client/src/utils/pdfGenerator.ts:133-138`
- Test: `client/src/utils/__tests__/pdfGenerator.smoke.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Add to `client/src/utils/__tests__/pdfGenerator.smoke.test.ts` (inside the existing `describe('pdfGenerator smoke tests', ...)` block):

```ts
  it('DEFAULT_PDF_BRANDING uses navy/gold, not the neutralized grays', async () => {
    const { DEFAULT_PDF_BRANDING } = await import('../pdfGenerator');
    expect(DEFAULT_PDF_BRANDING.primary_color).toBe('#1a2f5c');
    expect(DEFAULT_PDF_BRANDING.accent_color).toBe('#d4a017');
    expect(DEFAULT_PDF_BRANDING.header_bg_color).toBe('#1a2f5c');
  });
```

Note: `DEFAULT_PDF_BRANDING` must be exported from `pdfGenerator.ts` for this import to work — check line 133; if it's not already `export const`, add `export` as part of Step 3 below.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/__tests__/pdfGenerator.smoke.test.ts -t "DEFAULT_PDF_BRANDING"`
Expected: FAIL — current values are `primary_color: '#888888'`, `accent_color: 'var(--rmpg-500)'`, `header_bg_color: '#333333'`.

- [ ] **Step 3: Update `DEFAULT_PDF_BRANDING` in `pdfGenerator.ts`**

Edit lines 133-138:

```ts
export const DEFAULT_PDF_BRANDING: PdfBranding = {
  report_header_text: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
  report_subheader_text: 'PRIVATE SECURITY & LAW ENFORCEMENT',
  primary_color: '#1a2f5c',   // navy — restored 2026-07-03 (was #888888 gray)
  accent_color: '#d4a017',    // gold — restored 2026-07-03 (was the broken CSS-var string 'var(--rmpg-500)', which hexToRgb() cannot parse)
  header_bg_color: '#1a2f5c', // navy — restored 2026-07-03 (was #333333 charcoal)
```

The `accent_color: 'var(--rmpg-500)'` value being replaced was itself a latent bug independent of the grayscale decision — `hexToRgb()` in this file expects a `#rrggbb` string, not a CSS custom-property reference, so every call site reading `brand.accent_color` (the header subheader-text color, the footer accent line, `closeAutoSection`'s fallback) was silently getting `hexToRgb()`'s NaN/undefined-input fallback rather than an actual gold. Confirm `hexToRgb()`'s fallback behavior (grep for `function hexToRgb` in this file) before assuming what color was actually rendering — document the finding as a comment if it differs from "silently broken."

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/__tests__/pdfGenerator.smoke.test.ts -t "DEFAULT_PDF_BRANDING"`
Expected: PASS.

- [ ] **Step 5: Run the full pdfGenerator smoke suite**

Run: `cd client && npx vitest run src/utils/__tests__/pdfGenerator.smoke.test.ts`
Expected: PASS — all 8 report-type generation tests plus the new one.

- [ ] **Step 6: Commit**

```bash
git add client/src/utils/pdfGenerator.ts client/src/utils/__tests__/pdfGenerator.smoke.test.ts
git commit -m "fix(pdf-v1): restore navy+gold PDF branding defaults, fix unparseable accent_color CSS-var string"
```

---

### Task 3: Swap in the real navy seal asset

**Files:**
- Replace: `client/src/assets/rmpg-seal.png`

- [ ] **Step 1: Convert and stage the navy seal PNG**

The navy seal was saved to the repo as `client/public/rmpg-seal-navy.jpg` earlier in this session. Convert it to PNG and verify dimensions:

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/charming-tesla-0fc9dd"
sips -s format png client/public/rmpg-seal-navy.jpg --out /tmp/rmpg-seal-navy.png
sips -g pixelWidth -g pixelHeight /tmp/rmpg-seal-navy.png
```

Expected: PNG, roughly 826×835px (near-square — the loader in `pdfAssets.ts`'s `loadSealBase64()` downscales to a 192×192 canvas regardless, so a few px of aspect mismatch is invisible at that size).

- [ ] **Step 2: Replace the asset file**

```bash
cp /tmp/rmpg-seal-navy.png "client/src/assets/rmpg-seal.png"
```

This is the exact path `loadSealBase64()` imports via `import sealUrl from '../assets/rmpg-seal.png?url'` (`client/src/utils/pdfAssets.ts:12`) — no code change needed, the Vite asset pipeline picks up the new file content on next build.

- [ ] **Step 3: Verify no test hardcodes the old file's byte size or hash**

```bash
grep -rn "rmpg-seal" client/src/utils/__tests__/ client/src/**/__tests__/ 2>/dev/null
```

Expected: no matches, or only matches referencing the import path (not file content) — the loader is tested via mocked `fetch`/`createImageBitmap`, not real file bytes. If a test does assert on file bytes, that test needs updating to match the new asset — do not revert the asset swap to make a stale test pass.

- [ ] **Step 4: Commit**

```bash
git add client/src/assets/rmpg-seal.png
git commit -m "feat(pdf-v1): swap in the real navy RMPG seal for PDF header embedding"
```

Note: binary asset diffs don't get a meaningful code review in GitHub's UI — mention in the PR description that this is a visual swap and link back to the spec's reference image discussion so a reviewer knows what to expect.

---

### Task 4: Rewrite `addReportHeader()` to the new letterhead layout

**Files:**
- Modify: `client/src/utils/pdfGenerator.ts:559-705`
- Test: `client/src/utils/__tests__/pdfGenerator.smoke.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Add to `client/src/utils/__tests__/pdfGenerator.smoke.test.ts`:

```ts
  it('header includes the gold tagline text', () => {
    const doc = generatePdfReport('incident', baseIncident as any);
    const pageText = (doc.internal.pages[1] as unknown as string[]).join('\n');
    expect(pageText).toContain('TO SERVE, CONSULT, AND PROTECT THE UTAH WASATCH FRONTIER.');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/__tests__/pdfGenerator.smoke.test.ts -t "gold tagline"`
Expected: FAIL — the tagline text doesn't exist yet in `addReportHeader()`.

- [ ] **Step 3: Rewrite `addReportHeader()`**

Replace the function body (`client/src/utils/pdfGenerator.ts:559-705`) with the letterhead layout — left-aligned seal + agency/subtitle/tagline block, right-aligned case-number box (existing box logic kept), double rule beneath:

```ts
export function addReportHeader(
  doc: jsPDF,
  caseNumber: string,
  reportType: string,
  priority: string,
  agencyName?: string,
  headerOptions?: { caseBoxLabel?: string; useLogo?: boolean },
): number {
  const brand = activeBranding;
  const pageWidth = doc.internal.pageSize.getWidth();
  const cw = getContentWidth(doc);
  const primaryRgb = hexToRgb(brand.primary_color);   // navy
  const accentRgb = hexToRgb(brand.accent_color);      // gold
  const caseBoxLabel = headerOptions?.caseBoxLabel || 'CASE NUMBER';
  const useLogo = headerOptions?.useLogo ?? true;
  const headerY = topHeaderY(doc);

  activeCaseNumber = caseNumber;

  // @ts-expect-error jsPDF GState
  doc.setGState(new doc.GState({ opacity: 1.0 }));

  // ── Seal (left) ─────────────────────────────────────────
  const sealX = LAYOUT.PAGE_MARGIN;
  const sealY = headerY;
  let textStartX = LAYOUT.PAGE_MARGIN;

  const imageToUse = useLogo && cachedLogoDark ? cachedLogoDark : cachedSeal;
  if (imageToUse) {
    try {
      doc.addImage(imageToUse, 'PNG', sealX, sealY, LAYOUT.SEAL_SIZE, LAYOUT.SEAL_SIZE);
      textStartX = sealX + LAYOUT.SEAL_SIZE + SPACING.MD;
    } catch {
      textStartX = LAYOUT.PAGE_MARGIN;
    }
  }

  // ── Agency name (line 1, navy, bold) ───────────────────
  doc.setFont(PDF_VALUE_FONT, 'bold');
  doc.setFontSize(FONT.SIZE_HEADER_TITLE);
  doc.setTextColor(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
  doc.text(agencyName || brand.report_header_text, textStartX, headerY + 5.5);

  // ── Subtitle (line 2, navy, bold, letter-spaced feel via caps) ─
  doc.setFont(PDF_VALUE_FONT, 'bold');
  doc.setFontSize(FONT.SIZE_SUBHEADER);
  doc.setTextColor(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
  doc.text(brand.report_subheader_text.toUpperCase(), textStartX, headerY + 9.5);

  // ── Gold italic tagline (line 3) ────────────────────────
  doc.setFont('times', 'italic');
  doc.setFontSize(FONT.SIZE_SMALL_META);
  doc.setTextColor(accentRgb[0], accentRgb[1], accentRgb[2]);
  doc.text('TO SERVE, CONSULT, AND PROTECT THE UTAH WASATCH FRONTIER.', textStartX, headerY + 13);

  // ── Case number box (right) ─────────────────────────────
  const caseBoxH = LAYOUT.HEADER_HEIGHT - 2;
  const caseBoxX = pageWidth - LAYOUT.PAGE_MARGIN - LAYOUT.CASE_BOX_W;
  const caseBoxY = headerY;

  doc.setDrawColor(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
  doc.setLineWidth(0.4);
  doc.rect(caseBoxX, caseBoxY, LAYOUT.CASE_BOX_W, caseBoxH);

  doc.setFontSize(FONT.SIZE_SMALL_META);
  doc.setFont(PDF_VALUE_FONT, 'bold');
  doc.setTextColor(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
  doc.text(fitPdfText(doc, caseBoxLabel, LAYOUT.CASE_BOX_W - 4), caseBoxX + LAYOUT.CASE_BOX_W / 2, caseBoxY + 5, { align: 'center' });

  doc.setFontSize(FONT.SIZE_CASE_NUMBER);
  doc.setFont(PDF_VALUE_FONT, 'bold');
  doc.text(caseNumber, caseBoxX + LAYOUT.CASE_BOX_W / 2, caseBoxY + 12, { align: 'center' });

  const reportDate = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
  doc.setFont(PDF_VALUE_FONT, 'normal');
  doc.setFontSize(FONT.SIZE_FOOTER_SECONDARY);
  doc.setTextColor(120, 120, 120);
  doc.text(`PRINTED ${reportDate}`, caseBoxX + LAYOUT.CASE_BOX_W / 2, caseBoxY + caseBoxH - 2, { align: 'center' });

  // ── Double rule beneath header (thick navy + thin navy) ──
  const headerBottom = headerY + LAYOUT.HEADER_HEIGHT;
  doc.setDrawColor(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
  doc.setLineWidth(0.8);
  doc.line(LAYOUT.PAGE_MARGIN, headerBottom, LAYOUT.PAGE_MARGIN + cw, headerBottom);
  doc.setLineWidth(0.3);
  doc.line(LAYOUT.PAGE_MARGIN, headerBottom + 1.2, LAYOUT.PAGE_MARGIN + cw, headerBottom + 1.2);

  // ── Reset drawing state ──────────────────────────────────
  doc.setFont(PDF_VALUE_FONT, 'normal');
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  doc.setDrawColor(...COLOR.TEXT_PRIMARY);

  return headerBottom + 1.2 + SPACING.SM;
}
```

Notes on what was dropped versus the old implementation: the `reportType`/`formNum`/`FORM_REVISION` meta line and the inline priority badge that the old header drew are removed from the header itself in this rewrite — the letterhead reference has no room for them alongside the tagline. Before finalizing this step, grep every call site of `addReportHeader` (`grep -rn "addReportHeader(" client/src`) and confirm none of them depend on that meta line or priority badge being visible only in the header (i.e. confirm the report body or another section already surfaces report type / priority elsewhere, per the existing `PersonPdfData`/`CallPdfData` field sections). If any report type has no other place priority is shown, add it back as a small badge under the case-number box rather than silently dropping the information — do not ship a report where priority becomes unprintable.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/__tests__/pdfGenerator.smoke.test.ts`
Expected: PASS — all existing report-type tests plus the new tagline test.

- [ ] **Step 5: Run the full client test suite**

Run: `cd client && npx vitest run`
Expected: PASS. Watch specifically for failures in `recordPdfGenerator.smoke.test.ts`, `dispatchGuidePdfGenerator.smoke.test.ts`, `psoNoticePdfGenerator.smoke.test.ts`, `statutePdfGenerator.test.ts` — all consume `addReportHeader` indirectly. A failure asserting on the old meta line or priority badge text is expected per the Step 3 note above; fix by relocating that content per the same note, not by reverting the header layout.

- [ ] **Step 6: Commit**

```bash
git add client/src/utils/pdfGenerator.ts client/src/utils/__tests__/pdfGenerator.smoke.test.ts
git commit -m "feat(pdf-v1): rewrite addReportHeader to the navy letterhead layout with gold tagline"
```

---

### Task 5: Sweep the Records batch (`recordPdfGenerator.ts`, `recordPdfGeneratorExt.ts`) for color-token drift

**Files:**
- Modify: `client/src/utils/recordPdfGenerator.ts` (7592 lines — person/vehicle/business/property/warrant/evidence/citation/personnel types, all through `generateRecordPdf<T>`)
- Modify: `client/src/utils/recordPdfGeneratorExt.ts`
- Test: existing `client/src/utils/__tests__/recordPdfGenerator.smoke.test.ts`

- [ ] **Step 1: Find hardcoded color literals that bypass `pdfTokens.ts`**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/charming-tesla-0fc9dd"
grep -n "setTextColor([0-9]\|setFillColor([0-9]\|setDrawColor([0-9]" client/src/utils/recordPdfGenerator.ts client/src/utils/recordPdfGeneratorExt.ts
```

This finds every `setTextColor`/`setFillColor`/`setDrawColor` call passing literal numbers instead of a spread `COLOR.*` token (a token spread looks like `setTextColor(...COLOR.TEXT_PRIMARY)` and won't match this grep because it starts with `...`, not a digit).

- [ ] **Step 2: For each match, classify and fix**

For each hit, read the surrounding 5 lines to determine intent, then either:
- **It's meant to track a token** (e.g. it's drawing navy/gold/gray matching an existing `COLOR.*` value) → replace the literal with the token: `doc.setTextColor(50, 50, 50)` → `doc.setTextColor(...COLOR.TEXT_SECONDARY)` (pick the token whose current value matches, confirmed via `grep "TEXT_SECONDARY" client/src/utils/pdfTokens.ts`).
- **It's a genuinely one-off literal with no matching token** (e.g. a specific semantic color used nowhere else) — leave it, but add a one-line comment noting it's intentionally local, so a future audit doesn't re-flag it.

Do not invent new tokens for one-off cases — that's out of scope per the spec ("no new tokens" wasn't stated explicitly, but the spec's "audit + fix, no new features" scope means: fix drift onto *existing* tokens, don't grow the token surface here).

- [ ] **Step 3: Run the existing smoke test after each file's fixes**

```bash
cd client && npx vitest run src/utils/__tests__/recordPdfGenerator.smoke.test.ts
```

Expected: PASS after each file. If a fix changes rendered color in a way the smoke test doesn't cover (these tests check structure/text, not pixel color, per the existing `truncatePostureChip` test pattern), that's expected — there's no pixel-level test for this codebase; visual confirmation happens via Step 4.

- [ ] **Step 4: Generate one sample PDF per record type for manual visual check**

There's no browser-preview path for jsPDF output (documented limitation — same one hit earlier this session for the CFS/person formatting fixes). Use the existing in-app print flow instead: `npm run dev` in `client/`, log in, open a person record / vehicle record / business record / property record in the app, and use the existing "Print" / "Export PDF" action for each. Confirm: navy header with the real seal renders, gold tagline is legible, case-number box still shows the correct case/record number, and no field-body text overlaps the new header layout (the header's vertical footprint may have changed between Task 4's rewrite and the previous version — check the first content row isn't clipped).

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/recordPdfGenerator.ts client/src/utils/recordPdfGeneratorExt.ts
git commit -m "fix(pdf-v1): sweep Records batch for hardcoded colors bypassing pdfTokens"
```

---

## What's Next (not in this plan)

Batches 2–6 from the spec (law-enforcement forms, evidence/custody, dispatch/patrol, fleet, business/admin) repeat Task 5's pattern — grep for literal color calls, classify, fix, verify, manual-check — against their own file lists:

- **Law-enforcement forms:** `warrantPacket.ts`, `useOfForceReportPdf.ts`, `fiCardPdf.ts`, `criminalHistoryPdf.ts`, `offenderRegistrationCardPdf.ts`, `trespassOrderPdf.ts`
- **Evidence/custody:** `evidenceItemPdf.ts`, `equipmentCustodyPdf.ts`, `bodycamVideoCustodyPdf.ts`, `forensicCasePdf.ts`, `forensicReportPdf.ts`
- **Dispatch/patrol:** `patrolTrackingPdfGenerator.ts`, `navTripPdf.ts`, `darPdf.ts`, `dispatchGuidePdfGenerator.ts`
- **Fleet:** all 10 files under `client/src/pages/fleet/utils/*Pdf*.ts`
- **Business/admin:** `invoicePdfGenerator.ts`, `proposalPdf.ts`

Each should be its own plan (per the writing-plans Scope Check) once this foundation plan has landed and been manually verified in the app — later batches may surface header-layout edge cases (long agency-name overrides, missing seal fallback) that this plan's Task 4 rewrite didn't anticipate, and those should feed back into `addReportHeader()` before being repeated 60+ more times.

**Continuation-page (page 2+) compact header, deferred:** the spec calls for a smaller variant on continuation pages (no tagline, smaller seal). Grepping `pdfGenerator.ts` for an existing continuation-header function found none — every `-- CONTINUED` label found is a mid-content section/narrative continuation marker, not a page-level letterhead repeat. That means either `addReportHeader()` is currently called once per report (no repeat on later pages) or a repeat path exists elsewhere not yet located. Before building the compact variant, the next plan needs to trace how/whether the header repeats across pages today (check callers of `addReportHeader` for a page-2+ conditional) — that's real investigation, not a copy-paste task, so it's left out of this plan rather than guessed at.
