# PDF Navy Letterhead Alignment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the gold-fill banner in 30 standalone PDF generators with a shared navy letterhead helper that matches the token-system generators.

**Architecture:** Create `client/src/utils/pdfStandaloneHeader.ts` exporting `drawNavyBanner()`. Each standalone generator replaces ~10 lines of gold-banner code with one `drawNavyBanner()` call and removes the now-unused strap line below it. No unit changes, no layout changes below the header.

**Tech Stack:** jsPDF 4.x (pt units), TypeScript, Vitest

## Global Constraints

- All standalone generators use `unit: 'pt'` — do NOT switch to `mm` or call `addReportHeader()`
- Color literals in `pdfStandaloneHeader.ts` are intentional — jsPDF takes RGB arrays, not CSS variables
- Never hardcode hex elsewhere in the app; these RGB arrays are the exception and are labeled with their token source
- Run `npx vitest run --config vitest.pdf.config.ts` after each batch — all 1,463 tests must pass before proceeding
- `navBriefingPdf.ts`, `navTripPdf.ts`, `invoicePdfGenerator.ts` are NOT touched
- After updating a file, remove its local `const RMPG_GOLD` and `const TEXT_DARK` constants (but keep `TEXT_MUTED`, `BORDER`, `ROW_ALT`, alert-color constants — those are still used in sections)

---

### Task 1: Create `pdfStandaloneHeader.ts`

**Files:**
- Create: `client/src/utils/pdfStandaloneHeader.ts`

**Interfaces:**
- Produces: `drawNavyBanner(doc: jsPDF, opts: NavyBannerOpts): number`

- [ ] **Step 1: Write the file**

```ts
// client/src/utils/pdfStandaloneHeader.ts
import jsPDF from 'jspdf';

// RGB values sourced from pdfTokens.ts for visual consistency:
// BG_SECTION_HDR, TEXT_INVERTED, TEXT_SUBHEAD_INVERTED, ACCENT_GOLD
const NAVY: [number, number, number] = [26, 47, 92];
const WHITE: [number, number, number] = [255, 255, 255];
const SUBHEAD: [number, number, number] = [190, 200, 215];
const GOLD: [number, number, number] = [212, 160, 23];

const BANNER_H = 36; // pt — taller than old 28pt gold banner to fit 2 rows

export interface NavyBannerOpts {
  title: string;       // document type line, e.g. "TRESPASS ORDER — TO-2026-001"
  subtitle?: string;   // division strap, e.g. "Rocky Mountain Protective Group · Records Division"
  rightLine1?: string; // right-aligned row 1 (usually date/timestamp)
  rightLine2?: string; // right-aligned row 2 (usually officer/author name)
  y?: number;          // top-left y in pt, default 36
  marginPt?: number;   // left/right margin in pt, default 36
}

/**
 * Draws the RMPG navy letterhead banner for standalone (unit:'pt') PDF generators.
 * Returns the new y cursor after banner + gold rule + gap = opts.y + 46.
 *
 * Resets drawColor, lineWidth, and textColor to black/0.5pt before returning
 * so generators don't have to clean up.
 */
export function drawNavyBanner(doc: jsPDF, opts: NavyBannerOpts): number {
  const y = opts.y ?? 36;
  const M = opts.marginPt ?? 36;
  const W = doc.internal.pageSize.getWidth();
  const bannerW = W - 2 * M;

  // Navy fill
  doc.setFillColor(...NAVY);
  doc.rect(M, y, bannerW, BANNER_H, 'F');

  // Row 1: agency name (left, white bold 9pt) + rightLine1 (right, white 8pt)
  doc.setFont('Arial', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...WHITE);
  doc.text('ROCKY MOUNTAIN PROTECTIVE GROUP', M + 8, y + 12);

  if (opts.rightLine1) {
    doc.setFont('Arial', 'normal');
    doc.setFontSize(8);
    doc.text(opts.rightLine1, W - M - 8, y + 12, { align: 'right' });
  }

  // Row 2: title (left, pale steel-blue 8pt bold) + rightLine2 (right, white 7.5pt)
  doc.setFont('Arial', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...SUBHEAD);
  const titleText = opts.subtitle ? `${opts.title}  ·  ${opts.subtitle}` : opts.title;
  doc.text(titleText, M + 8, y + 26);

  if (opts.rightLine2) {
    doc.setFont('Arial', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...WHITE);
    doc.text(opts.rightLine2, W - M - 8, y + 26, { align: 'right' });
  }

  // Gold rule below banner (0.75pt)
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.75);
  doc.line(M, y + BANNER_H + 1, W - M, y + BANNER_H + 1);

  // Reset for subsequent rendering
  doc.setDrawColor(0);
  doc.setLineWidth(0.5);
  doc.setTextColor(0);
  doc.setFont('Arial', 'normal');
  doc.setFontSize(10);

  return y + BANNER_H + 1 + 9; // = y + 46
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/pdf-documents-output-00da33/client"
npx tsc --noEmit 2>&1 | head -20
```

Expected: 0 errors related to `pdfStandaloneHeader.ts`

- [ ] **Step 3: Commit**

```bash
git add client/src/utils/pdfStandaloneHeader.ts
git commit -m "feat(pdf): add drawNavyBanner() shared header helper for standalone generators"
```

---

### Task 2: Update Batch A — 10 simple-strap generators (no `rightLine2`)

These generators have a strap with no `Prepared by:` right side. The strap is absorbed into `subtitle`.

**Files to modify:**
- `client/src/utils/auditLogPdf.ts`
- `client/src/utils/clearedSummaryPdf.ts`
- `client/src/utils/conversationTranscriptPdf.ts`
- `client/src/utils/documentIntakePdf.ts`
- `client/src/utils/emailThreadPdf.ts`
- `client/src/utils/knowledgeBaseSearchPdf.ts`
- `client/src/utils/nationalWarrantPdf.ts`
- `client/src/utils/skipTracerReportPdf.ts`
- `client/src/utils/taskPdf.ts`
- `client/src/utils/webResearchReportPdf.ts`

**Pattern for each file:**

1. Add import at top: `import { drawNavyBanner } from './pdfStandaloneHeader';`
2. Remove `const RMPG_GOLD = '#d4a017';` and `const TEXT_DARK = '#1a1a1a';` (if present)
3. Replace the gold banner block + strap with `y = drawNavyBanner(...)` per the table below
4. Remove the old strap `y += 14` (or `y += 16`) advance that followed it

**Per-file call:**

| File | title | subtitle | rightLine1 |
|------|-------|----------|------------|
| `auditLogPdf.ts` | `'AUDIT LOG — CHAIN OF CUSTODY REPORT'` | `'Records Management System'` | `` `Generated ${fmtTimestamp(new Date().toISOString())}` `` |
| `clearedSummaryPdf.ts` | `'CLEARED CALLS SUMMARY'` | `'Dispatch Operations'` | `range` (existing variable) |
| `conversationTranscriptPdf.ts` | `` `CONVERSATION TRANSCRIPT — ${id}` `` (use existing title var) | `'Communications Center'` | `` `Generated ${fmtDateTime(new Date().toISOString())}` `` |
| `documentIntakePdf.ts` | `'DOCUMENT INTAKE RECORD'` | `'Records Intake'` | `` `Generated ${fmtTimestamp(new Date().toISOString())}` `` |
| `emailThreadPdf.ts` | `` `EMAIL THREAD — ${subject}` `` (use existing subject var) | `'Microsoft 365 Mailbox'` | `` `Generated ${fmtDateTime(new Date().toISOString())}` `` |
| `knowledgeBaseSearchPdf.ts` | `'KNOWLEDGE BASE SEARCH'` | `'System-Wide Records Search'` | `` `Generated ${generatedStamp}` `` (use existing var) |
| `nationalWarrantPdf.ts` | `'NATIONAL WARRANT SEARCH'` | `'National Warrant Search'` | `` `${fmtDateTime(new Date().toISOString())}` `` |
| `skipTracerReportPdf.ts` | `'SKIP TRACER REPORT'` | `'Investigations / Skip Trace'` | `` `Generated ${fmtDateTime(new Date())}` `` |
| `taskPdf.ts` | `'TASK RECORD'` | `'Task Management'` | `` `Generated ${fmtTimestamp(new Date().toISOString())}` `` |
| `webResearchReportPdf.ts` | `'WEB RESEARCH REPORT'` | `'Investigations / OSINT'` | `` `Generated ${fmtDateTime(new Date())}` `` |

**Note:** Preserve the variable names exactly as they appear in each file for `rightLine1` (check the file for the exact expression used in the old `doc.text(...)` call at `y + 19`).

- [ ] **Step 1: Update each of the 10 files** (open each, apply the import + removal + replacement)

Example — `auditLogPdf.ts` old block (starting at banner rect):
```ts
doc.setFillColor(RMPG_GOLD);
doc.rect(M, y, W - 2 * M, 28, 'F');
doc.setFont('Arial', 'bold');
doc.setFontSize(14);
doc.setTextColor(TEXT_DARK);
doc.text('AUDIT LOG — CHAIN OF CUSTODY REPORT', M + 10, y + 19);
doc.setFontSize(9);
doc.setFont('Arial', 'normal');
doc.text(`Generated ${fmtTimestamp(new Date().toISOString())}`, W - M - 10, y + 19, { align: 'right' });
y += 38;
// ... then strap:
doc.text('Rocky Mountain Protective Group  ·  Records Management System', M, y);
y += 14;
```

Becomes:
```ts
y = drawNavyBanner(doc, {
  title: 'AUDIT LOG — CHAIN OF CUSTODY REPORT',
  subtitle: 'Records Management System',
  rightLine1: `Generated ${fmtTimestamp(new Date().toISOString())}`,
});
```

Apply the same pattern to the other 9 files, substituting the title/subtitle/rightLine1 from the table above.

- [ ] **Step 2: Run the PDF test suite**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/pdf-documents-output-00da33/client"
npx vitest run --config vitest.pdf.config.ts 2>&1 | tail -20
```

Expected: all 1,463 tests pass (no new failures)

- [ ] **Step 3: Commit**

```bash
git add client/src/utils/auditLogPdf.ts client/src/utils/clearedSummaryPdf.ts \
  client/src/utils/conversationTranscriptPdf.ts client/src/utils/documentIntakePdf.ts \
  client/src/utils/emailThreadPdf.ts client/src/utils/knowledgeBaseSearchPdf.ts \
  client/src/utils/nationalWarrantPdf.ts client/src/utils/skipTracerReportPdf.ts \
  client/src/utils/taskPdf.ts client/src/utils/webResearchReportPdf.ts
git commit -m "feat(pdf): navy letterhead on 10 simple-strap generators (batch A)"
```

---

### Task 3: Update Batch B — 13 generators with `Prepared by:` right strap

These generators have a `Prepared by: ${preparedBy}` on the right side of the strap. It moves to `rightLine2`.

**Files to modify:**
- `client/src/utils/affairsComplaintPdf.ts`
- `client/src/utils/bodycamVideoCustodyPdf.ts`
- `client/src/utils/codeEnforcementPdf.ts`
- `client/src/utils/courtAppearancePdf.ts`
- `client/src/utils/criminalHistoryPdf.ts`
- `client/src/utils/dashcamReviewPdf.ts`
- `client/src/utils/equipmentCustodyPdf.ts`
- `client/src/utils/evidenceItemPdf.ts`
- `client/src/utils/forensicCasePdf.ts`
- `client/src/utils/jailBookingSheetPdf.ts`
- `client/src/utils/offenderRegistrationCardPdf.ts`
- `client/src/utils/plateCapturePdf.ts`
- `client/src/utils/shiftPlanPdf.ts`

**Pattern for each file:**

Same as Batch A plus `rightLine2: preparedBy ? \`Prepared by: ${preparedBy}\` : undefined`

**Per-file call:**

| File | title | subtitle | rightLine1 | rightLine2 |
|------|-------|----------|------------|------------|
| `affairsComplaintPdf.ts` | `'INTERNAL AFFAIRS COMPLAINT — …'` (use existing title var) | `'Office of Professional Standards'` | `` `${fmtTimestamp(new Date().toISOString())}` `` | `` preparedBy ? `Prepared by: ${preparedBy}` : undefined `` |
| `bodycamVideoCustodyPdf.ts` | `` `BWC VIDEO — ${label}` `` (ellipsized, use existing) | `'Body-Worn Camera / Evidence Custody'` | `` `${fmtDateTime(new Date().toISOString())}` `` | same pattern |
| `codeEnforcementPdf.ts` | `` `NOTICE OF VIOLATION — ${v.violation_number \|\| '—'}` `` | `'Code Enforcement'` | `` `Issued ${fmtDateTime(v.created_at)}` `` | same (check if `preparedBy` param exists; if not, omit) |
| `courtAppearancePdf.ts` | `'COURT APPEARANCE RECORD'` | `'Court / Legal Tracker'` | `` `${fmtDateTime(new Date().toISOString())}` `` | `` input.preparedBy ? `Prepared by: ${input.preparedBy}` : undefined `` |
| `criminalHistoryPdf.ts` | `'CRIMINAL HISTORY REPORT'` | `'Records Division'` | `` `${fmtDateTime(new Date().toISOString())}` `` | same pattern |
| `dashcamReviewPdf.ts` | `'DASHCAM REVIEW REPORT'` | `'Mobile Video Recorder / Dash Camera'` | `` `${fmtDateTime(new Date().toISOString())}` `` | same pattern |
| `equipmentCustodyPdf.ts` | `'EQUIPMENT CUSTODY RECORD'` | `'Personnel / Equipment Room'` | `` `${fmtDateTime(new Date().toISOString())}` `` | same pattern |
| `evidenceItemPdf.ts` | `'EVIDENCE / PROPERTY ITEM'` | `'Evidence / Property Room'` | `` `${fmtDateTime(new Date().toISOString())}` `` | same pattern |
| `forensicCasePdf.ts` | `'FORENSIC CASE FILE'` | `'Forensic Lab'` | `` `${fmtDateTime(new Date().toISOString())}` `` | same pattern |
| `jailBookingSheetPdf.ts` | `'JAIL BOOKING SHEET'` | `'Jail Management / Booking & Intake'` | `` `${fmtDateTime(new Date().toISOString())}` `` | same pattern |
| `offenderRegistrationCardPdf.ts` | `'SEX OFFENDER REGISTRATION CARD'` | `'Sex Offender Registry Cross-Reference'` | `` `${fmtDateTime(new Date().toISOString())}` `` | same pattern |
| `plateCapturePdf.ts` | `` `ALPR CAPTURE REPORT — #${cap.id ?? '?'}` `` | `'Automated Plate Reader'` | `` `${fmtDateTime(new Date().toISOString())}` `` | same pattern |
| `shiftPlanPdf.ts` | `'SHIFT BRIEFING — DEPLOYMENT PLAN'` | `'Patrol Operations'` | `` `${fmtDateTime(new Date().toISOString())}` `` | `` input.preparedBy ? `Prepared by: ${input.preparedBy}` : undefined `` |

**Notes:**
- For each file, check the exact variable names used in the existing banner/strap code before substituting
- `codeEnforcementPdf.ts` has a second interior strap (`Rocky Mountain Protective Group · Vehicle Impound`) at a later `rect` call for impound blocks — **leave that second strap alone**; only replace the top-of-document gold banner + its strap

Example — `equipmentCustodyPdf.ts` old block:
```ts
doc.setFillColor(RMPG_GOLD);
doc.rect(M, y, W - 2 * M, 28, 'F');
doc.setFont('Arial', 'bold');
doc.setFontSize(14);
doc.setTextColor(TEXT_DARK);
doc.text('EQUIPMENT CUSTODY RECORD', M + 10, y + 19);
doc.setFontSize(9);
doc.setFont('Arial', 'normal');
doc.text(fmtDateTime(new Date().toISOString()), W - M - 10, y + 19, { align: 'right' });
y += 38;
doc.text('Rocky Mountain Protective Group  ·  Personnel / Equipment Room', M, y);
if (preparedBy) doc.text(`Prepared by: ${preparedBy}`, W - M, y, { align: 'right' });
y += 16;
```

Becomes:
```ts
y = drawNavyBanner(doc, {
  title: 'EQUIPMENT CUSTODY RECORD',
  subtitle: 'Personnel / Equipment Room',
  rightLine1: fmtDateTime(new Date().toISOString()),
  rightLine2: preparedBy ? `Prepared by: ${preparedBy}` : undefined,
});
```

- [ ] **Step 1: Update each of the 13 files**

- [ ] **Step 2: Run the PDF test suite**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/pdf-documents-output-00da33/client"
npx vitest run --config vitest.pdf.config.ts 2>&1 | tail -20
```

Expected: all 1,463 tests pass

- [ ] **Step 3: Commit**

```bash
git add client/src/utils/affairsComplaintPdf.ts client/src/utils/bodycamVideoCustodyPdf.ts \
  client/src/utils/codeEnforcementPdf.ts client/src/utils/courtAppearancePdf.ts \
  client/src/utils/criminalHistoryPdf.ts client/src/utils/dashcamReviewPdf.ts \
  client/src/utils/equipmentCustodyPdf.ts client/src/utils/evidenceItemPdf.ts \
  client/src/utils/forensicCasePdf.ts client/src/utils/jailBookingSheetPdf.ts \
  client/src/utils/offenderRegistrationCardPdf.ts client/src/utils/plateCapturePdf.ts \
  client/src/utils/shiftPlanPdf.ts
git commit -m "feat(pdf): navy letterhead on 13 prepared-by generators (batch B)"
```

---

### Task 4: Update Batch C — 5 generators with officer-name variants

These generators use `officer_name`, `officerName`, or similar instead of `preparedBy`.

**Files to modify:**
- `client/src/utils/fiCardPdf.ts`
- `client/src/utils/shiftReportPdf.ts`
- `client/src/utils/trainingCertificatePdf.ts`
- `client/src/utils/trespassOrderPdf.ts`
- `client/src/utils/useOfForceReportPdf.ts`

**Per-file calls:**

`fiCardPdf.ts` — old strap: `Officer: ${fi.officer_name || fi.officer_display_name || '—'}` on right
```ts
y = drawNavyBanner(doc, {
  title: `FIELD INTERVIEW CARD — ${fi.fi_number || fi.id}`,
  subtitle: 'Field Operations',
  rightLine1: `Created ${fmtDateTime(fi.created_at)}`,
  rightLine2: `Officer: ${fi.officer_name || fi.officer_display_name || '—'}`,
});
```

`shiftReportPdf.ts` — old strap: `Officer: ${officerName}` on left, no right
```ts
y = drawNavyBanner(doc, {
  title: `SHIFT REPORT — ${shiftDate}`,  // use existing variable(s) for date
  subtitle: 'Dispatch Operations',
  rightLine1: fmtDateTime(new Date().toISOString()),  // or existing date var
  rightLine2: `Officer: ${officerName}`,
});
```
> Check the exact variable for officer name and shift date in the file before substituting.

`trainingCertificatePdf.ts` — strap: `Rocky Mountain Protective Group · Officer Training & Qualification Record`
```ts
y = drawNavyBanner(doc, {
  title: `TRAINING CERTIFICATE — ${cert.certificate_number || cert.id}`,
  subtitle: 'Officer Training & Qualification Record',
  rightLine1: fmtDateTime(new Date().toISOString()),
  rightLine2: preparedBy ? `Prepared by: ${preparedBy}` : undefined,
});
```
> Check that `cert` and `preparedBy` match actual variable names in the file.

`trespassOrderPdf.ts` — strap: `Rocky Mountain Protective Group · Records Division`, no right
```ts
y = drawNavyBanner(doc, {
  title: `TRESPASS ORDER — ${order.order_number}`,
  subtitle: 'Records Division',
  rightLine1: `Issued ${fmtDateTime(order.created_at)}`,
});
```

`useOfForceReportPdf.ts` — strap: `Rocky Mountain Protective Group · Use of Force / Internal Affairs / Utah POST Reporting`
```ts
y = drawNavyBanner(doc, {
  title: `USE OF FORCE REPORT — ${report.incident_number || report.id}`,
  subtitle: 'Use of Force / Internal Affairs / Utah POST',
  rightLine1: fmtDateTime(new Date().toISOString()),
  rightLine2: preparedBy ? `Prepared by: ${preparedBy}` : undefined,
});
```
> Check actual variable names; subtitle is intentionally shorter to fit row 2.

- [ ] **Step 1: Update each of the 5 files** (read each file, adapt variable names, apply the call)

- [ ] **Step 2: Run the PDF test suite**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/pdf-documents-output-00da33/client"
npx vitest run --config vitest.pdf.config.ts 2>&1 | tail -20
```

Expected: all 1,463 tests pass

- [ ] **Step 3: Commit**

```bash
git add client/src/utils/fiCardPdf.ts client/src/utils/shiftReportPdf.ts \
  client/src/utils/trainingCertificatePdf.ts client/src/utils/trespassOrderPdf.ts \
  client/src/utils/useOfForceReportPdf.ts
git commit -m "feat(pdf): navy letterhead on 5 officer-name generators (batch C)"
```

---

### Task 5: Update special-layout generators

These 4 generators have non-standard header structures requiring individual treatment.

**Files:**
- `client/src/utils/intelProductPdf.ts` — full-bleed GOLD top/bottom bars (22pt each); M=40
- `client/src/utils/ncicReferencePdf.ts` — centered gray section header, no gold fill banner
- `client/src/utils/darPdf.ts` — plain black header, no RMPG_GOLD at all
- `client/src/utils/forensicReportPdf.ts` — gold accent lines but no agency fill block

#### `intelProductPdf.ts`

Current: gold full-bleed top bar (`rect(0,0,W,22)`) + gold footer bar (`rect(0,H-22,W,22)`), then text starting at `y=36` with `INTELLIGENCE PRODUCT` header.

Replace top bar only (footer can stay for style continuity as a thin accent). The banner sits inside the content area (not at 0,0):

```ts
// Remove:
//   doc.setFillColor(GOLD); doc.rect(0, 0, W, 22, 'F');
//   doc.setFont...; doc.text('RMPG...', M, 14); (existing agency line in gold bar)

// Replace top section with:
y = drawNavyBanner(doc, {
  title: `INTELLIGENCE PRODUCT — ${show(d.report_number)}`,
  subtitle: `Grade: ${show(d.grade_label)}  ·  Threat: ${show(d.threat_level).toUpperCase()}`,
  rightLine1: `Disseminated: ${show(d.disseminated_at)}`,
  y: 10,
  marginPt: 0,  // full bleed like the original
});
// Then continue with the existing content starting at new y
```

> Read the file carefully before editing — the `stamp()` helper applies the gold bar on each new page; update it to call `drawNavyBanner` with the same opts.

#### `ncicReferencePdf.ts`

Current: centered gray section header `RMPG Flex · Rocky Mountain Protective Group · Utah` followed by centered `Generated ${stamp}`.

This generator uses `PAGE_W/2` for centering and has a different geometry. Apply `drawNavyBanner` at the very top:

```ts
// Before the existing first rect/text calls, add:
y = drawNavyBanner(doc, {
  title: 'NCIC CODE REFERENCE',
  subtitle: 'Rocky Mountain Protective Group · Utah',
  rightLine1: stamp,  // existing stamp var
});
// Then continue with existing content; adjust the first content y if needed
```

> Read `ncicReferencePdf.ts` starting from the function signature to understand the exact flow before editing.

#### `darPdf.ts`

Current: plain black text header, no gold banner. Add a navy banner where there is currently either blank space at the top or the first content section.

```ts
import { drawNavyBanner } from './pdfStandaloneHeader';
// ...at the top of the generator function, before any existing content:
y = drawNavyBanner(doc, {
  title: `DAILY ACTIVITY REPORT — ${dar.report_date || dar.id}`,
  subtitle: 'Patrol Operations',
  rightLine1: fmtDateTime(new Date().toISOString()),
  rightLine2: dar.officer_name ? `Officer: ${dar.officer_name}` : undefined,
});
```

> Read `darPdf.ts` first to find the correct variable names and confirm where `y` is initialized.

#### `forensicReportPdf.ts`

Current: gold accent lines (not a fill block). Add a navy banner before the existing first section:

```ts
import { drawNavyBanner } from './pdfStandaloneHeader';
// At top of generator, replace any existing header block or add before first content:
y = drawNavyBanner(doc, {
  title: `FORENSIC LAB REPORT — ${report.case_number || report.id}`,
  subtitle: 'Forensic Laboratory',
  rightLine1: fmtDateTime(new Date().toISOString()),
  rightLine2: preparedBy ? `Prepared by: ${preparedBy}` : undefined,
});
```

> Read `forensicReportPdf.ts` first to find the correct variable names and `y` initialization.

- [ ] **Step 1: Read each of the 4 files before editing**

- [ ] **Step 2: Apply the changes** (adapt variable names from what the file actually uses)

- [ ] **Step 3: Run the PDF test suite**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/pdf-documents-output-00da33/client"
npx vitest run --config vitest.pdf.config.ts 2>&1 | tail -20
```

Expected: all 1,463 tests pass

- [ ] **Step 4: Commit**

```bash
git add client/src/utils/intelProductPdf.ts client/src/utils/ncicReferencePdf.ts \
  client/src/utils/darPdf.ts client/src/utils/forensicReportPdf.ts
git commit -m "feat(pdf): navy letterhead on 4 special-layout generators (batch D)"
```

---

### Task 6: Final verification and PR

- [ ] **Step 1: Run full client suite to confirm no regressions**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/pdf-documents-output-00da33/client"
npx vitest run 2>&1 | tail -30
npx vitest run --config vitest.pdf.config.ts 2>&1 | tail -10
```

Expected: both pass cleanly (0 failures)

- [ ] **Step 2: Run client typecheck**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/pdf-documents-output-00da33/client"
npx tsc --noEmit 2>&1 | head -20
```

Expected: 0 errors

- [ ] **Step 3: Verify no stale `RMPG_GOLD` or `TEXT_DARK` constants remain in the 30 updated files**

```bash
grep -rn "const RMPG_GOLD\|const TEXT_DARK" \
  "/Users/rmpgutah/RMPG Flex/.claude/worktrees/pdf-documents-output-00da33/client/src/utils/"
```

Expected: 0 matches (if any remain, remove them)

- [ ] **Step 4: Open PR**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/pdf-documents-output-00da33"
gh pr create -R rmpgutah/rmpg-flex \
  --title "feat(pdf): align all standalone generators to navy letterhead standard" \
  --body "$(cat <<'EOF'
## Summary
- Creates `client/src/utils/pdfStandaloneHeader.ts` with `drawNavyBanner()` helper (pt units, no mm dependency)
- Replaces the legacy gold-fill banner in 30 standalone PDF generators with the navy letterhead style that token-system generators already use
- Visual change: navy fill RGB(26,47,92) with white agency name, pale-blue document title, gold rule below — matching the `addReportHeader()` standard
- No changes to page layout below the banner; all 1,463 PDF tests pass

## Files changed
- New: `client/src/utils/pdfStandaloneHeader.ts`
- Modified: 30 standalone PDF generator files (each ~10-line banner swap)

## Test plan
- [x] `npx vitest run --config vitest.pdf.config.ts` — all 1,463 tests pass
- [x] `npx tsc --noEmit` — 0 errors
- [x] `npx vitest run` — no regressions in main suite
- [ ] Visual spot-check: generate one PDF from each batch and confirm navy header renders
EOF
)"
```
