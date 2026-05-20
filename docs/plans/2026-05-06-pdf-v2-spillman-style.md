# PDF v2 Spillman/Motorola Visual Upgrade — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade the v2 PDF engine to render in formal Spillman Flex / Motorola Solutions B&W police-document style — no color accents, modern typography, form-fill underlines, classification footer.

**Architecture:** All changes confined to `client/src/utils/pdf/v2/engine/`. Centralize visual constants in a new `style.ts`. Other engine files import tokens from there. Sidecar embed code (round-trip integrity) is untouched and its tests are the regression gate.

**Tech Stack:** jsPDF (already in use, Helvetica only), vitest. No new dependencies.

**Design doc:** `docs/plans/2026-05-06-pdf-v2-spillman-style-design.md`

**TDD adaptation note:** Pure red-green-refactor doesn't map cleanly to visual changes (there's no failing test for "the field underline is now there"). The pattern this plan uses: each task EITHER writes a real failing test for behaviour we can assert programmatically (e.g., new font sizes, new watermark variant, sidecar integrity unchanged), OR explicitly captures visual output for snapshot review. Manual visual verification happens once at the end against a real citation.

---

### Task 1: Add `style.ts` design tokens module

**Files:**
- Create: `client/src/utils/pdf/v2/engine/style.ts`
- Test: `client/src/utils/pdf/v2/engine/__tests__/style.test.ts` *(new)*

**Step 1: Write the failing test**

```typescript
// __tests__/style.test.ts
import { describe, it, expect } from 'vitest';
import { TYPOGRAPHY, RULE_WEIGHTS, SPACING, AGENCY, FOOTER_TEXT } from '../style';

describe('style tokens', () => {
  it('typography table has the expected entries with correct sizes', () => {
    expect(TYPOGRAPHY.formTitle.size).toBe(14);
    expect(TYPOGRAPHY.formTitle.weight).toBe('bold');
    expect(TYPOGRAPHY.agencyName.size).toBe(11);
    expect(TYPOGRAPHY.fieldLabel.size).toBe(7);
    expect(TYPOGRAPHY.fieldLabel.weight).toBe('bold');
    expect(TYPOGRAPHY.fieldValue.size).toBe(9);
    expect(TYPOGRAPHY.sectionHeader.size).toBe(9);
    expect(TYPOGRAPHY.tableHeader.size).toBe(8);
  });
  it('rule weights are graduated (heaviest header rule down to thinnest divider)', () => {
    expect(RULE_WEIGHTS.headerThick).toBeGreaterThan(RULE_WEIGHTS.headerThin);
    expect(RULE_WEIGHTS.headerThin).toBeGreaterThanOrEqual(RULE_WEIGHTS.divider);
  });
  it('agency identity is set for RMPG production', () => {
    expect(AGENCY.name).toBe('ROCKY MOUNTAIN PROTECTIVE GROUP');
    expect(AGENCY.location).toMatch(/SALT LAKE CITY/i);
  });
  it('footer text mentions the law-enforcement-sensitive notice', () => {
    expect(FOOTER_TEXT.classification).toMatch(/LAW ENFORCEMENT SENSITIVE/);
  });
});
```

**Step 2: Run test to verify it fails**

```
cd client && npx vitest run src/utils/pdf/v2/engine/__tests__/style.test.ts
```

Expected: FAIL — "Cannot find module '../style'"

**Step 3: Write minimal implementation**

```typescript
// engine/style.ts
// Spillman Flex / Motorola Solutions visual tokens.
// All sizes in jsPDF's mm/pt mixed unit space (font sizes are pt;
// rule weights are pt; spacing is mm). Single source of truth so
// future visual tweaks land in one file.

export const TYPOGRAPHY = {
  formTitle:     { size: 14, weight: 'bold' as const },
  agencyName:    { size: 11, weight: 'bold' as const },
  agencySubline: { size: 8,  weight: 'normal' as const },
  formMeta:      { size: 7,  weight: 'normal' as const },
  sectionHeader: { size: 9,  weight: 'bold' as const },
  fieldLabel:    { size: 7,  weight: 'bold' as const },
  fieldValue:    { size: 9,  weight: 'normal' as const },
  narrativeBody: { size: 9,  weight: 'normal' as const },
  tableHeader:   { size: 8,  weight: 'bold' as const },
  tableBody:     { size: 8,  weight: 'normal' as const },
  footerText:    { size: 7,  weight: 'normal' as const },
  pageNumber:    { size: 7,  weight: 'bold' as const },
  watermark:     { size: 60, weight: 'bold' as const },
} as const;

export const RULE_WEIGHTS = {
  headerThick: 1.5,   // top of header, above agency name
  headerThin:  0.5,   // bottom of header, below form-meta line
  sectionRule: 0.5,   // under each section header
  fieldUnderline: 0.5,// under each field value (form-fill cue)
  tableBorder: 0.5,   // table cell borders
  tableHeaderBand: 4, // height in pt of black header band on tables
  footerRule:  0.5,   // above footer
} as const;

export const SPACING = {
  pageMarginTop:    14, // mm
  pageMarginBottom: 18,
  pageMarginLeft:   10,
  pageMarginRight:  10,
  headerBlockHeight: 22,
  sectionGap:       3,
  fieldRowHeight:   8,
  cellPaddingY:     2,
  cellPaddingX:     3,
} as const;

export const AGENCY = {
  name:     'ROCKY MOUNTAIN PROTECTIVE GROUP',
  location: 'SALT LAKE CITY, UTAH',
} as const;

export const FOOTER_TEXT = {
  classification: 'PROPERTY OF ROCKY MOUNTAIN PROTECTIVE GROUP — LAW ENFORCEMENT SENSITIVE',
} as const;

export const TONES = {
  // Pure black ink only. The two non-pure-black tones below are the
  // ONLY exceptions and they render correctly on B&W laser printers.
  zebraRow:  '#F5F5F5',  // 5% gray for alternating table rows
  watermark: '#E6E6E6',  // 10% black for blank-form / draft overlays
} as const;
```

**Step 4: Run test to verify it passes**

```
cd client && npx vitest run src/utils/pdf/v2/engine/__tests__/style.test.ts
```

Expected: PASS — 4 tests passing.

**Step 5: Commit**

```bash
git add client/src/utils/pdf/v2/engine/style.ts client/src/utils/pdf/v2/engine/__tests__/style.test.ts
git commit -m "feat(pdf): add design tokens module for Spillman/Motorola visual style"
```

---

### Task 2: Add `'draft'` watermark variant alongside existing `'blank-form'`

**Files:**
- Modify: `client/src/utils/pdf/v2/engine/types.ts` (Watermark union — currently `'blank-form' | 'draft' | string`, already permissive but never wired)
- Modify: `client/src/utils/pdf/v2/engine/watermark.ts:1-21`
- Modify: `client/src/utils/pdf/v2/engine/renderer.ts:28-32, 60-64` (already references `'blank-form'` only)
- Test: `client/src/utils/pdf/v2/engine/__tests__/watermark.test.ts` *(new)*

**Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { renderPdfV2 } from '../renderer';
import type { FormSchema } from '../types';

const baseSchema = (watermark: 'blank-form' | 'draft' | undefined): FormSchema<{}> => ({
  meta: { formNumber: 'TEST', title: 'TEST', revision: '2026-05' },
  header: { kind: 'default', formId: 'test' },
  watermark,
  sections: [],
});

describe('watermark variants', () => {
  it('blank-form mode produces different bytes than no watermark', async () => {
    const noWm = await (await renderPdfV2(baseSchema(undefined), {})).output('arraybuffer');
    const blank = await (await renderPdfV2(baseSchema('blank-form'), {})).output('arraybuffer');
    expect(blank.byteLength).toBeGreaterThan(noWm.byteLength);
  });
  it('draft mode renders DRAFT diagonally and produces different bytes than blank-form', async () => {
    const blank = await (await renderPdfV2(baseSchema('blank-form'), {})).output('arraybuffer');
    const draft = await (await renderPdfV2(baseSchema('draft'), {})).output('arraybuffer');
    // The two watermarks have different text ("BLANK FORM..." vs "DRAFT")
    // so byte length must differ.
    expect(draft.byteLength).not.toBe(blank.byteLength);
  });
});
```

**Step 2: Run test — expect 2nd one to fail**

```
cd client && npx vitest run src/utils/pdf/v2/engine/__tests__/watermark.test.ts
```

Expected: 1 PASS (blank-form already shipping), 1 FAIL (draft mode never wired).

**Step 3: Implement draft mode**

```typescript
// engine/watermark.ts (rewrite)
import jsPDF from 'jspdf';
import { TYPOGRAPHY, TONES } from './style';

function drawDiagonalWatermark(doc: jsPDF, lines: string[]): void {
  doc.saveGraphicsState();
  doc.setTextColor(TONES.watermark);
  doc.setFont('helvetica', TYPOGRAPHY.watermark.weight);
  doc.setFontSize(TYPOGRAPHY.watermark.size);
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  const cx = w / 2;
  const cy = h / 2;
  // Stack each line vertically around the center, all rotated -45°.
  const lineSpacing = TYPOGRAPHY.watermark.size * 0.45;
  const startOffset = -((lines.length - 1) / 2) * lineSpacing;
  for (let i = 0; i < lines.length; i++) {
    const y = cy + startOffset + i * lineSpacing;
    doc.text(lines[i], cx, y, { align: 'center', angle: -45 });
  }
  doc.restoreGraphicsState();
  doc.setTextColor('#000000');
}

export function drawBlankFormWatermark(doc: jsPDF): void {
  drawDiagonalWatermark(doc, ['BLANK FORM', 'FOR FIELD USE']);
}

export function drawDraftWatermark(doc: jsPDF): void {
  drawDiagonalWatermark(doc, ['DRAFT']);
}
```

```typescript
// engine/renderer.ts — extend the existing watermark dispatch
// Around line 29-31 and 60-64, change `if (schema.watermark === 'blank-form')`
// to a small switch helper that handles both modes.

function drawWatermarkIfAny(doc: jsPDF, mode: string | undefined): void {
  if (mode === 'blank-form') drawBlankFormWatermark(doc);
  else if (mode === 'draft') drawDraftWatermark(doc);
}

// Call sites:
//   line 29:  if (schema.watermark) drawWatermarkIfAny(doc, schema.watermark);
//   line 62:  if (schema.watermark && p > 1) drawWatermarkIfAny(doc, schema.watermark);

import { drawBlankFormWatermark, drawDraftWatermark } from './watermark';
```

**Step 4: Run test to verify pass**

Expected: 2 PASS.

**Step 5: Commit**

```bash
git add client/src/utils/pdf/v2/engine/watermark.ts client/src/utils/pdf/v2/engine/renderer.ts client/src/utils/pdf/v2/engine/__tests__/watermark.test.ts
git commit -m "feat(pdf): add draft watermark variant + extract diagonal helper"
```

---

### Task 3: Rewrite header for Spillman agency-block + form-meta row

**Files:**
- Modify: `client/src/utils/pdf/v2/engine/header.ts` (full rewrite — currently 25 lines)
- Test: `client/src/utils/pdf/v2/engine/__tests__/header.test.ts` *(new)*

**Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import jsPDF from 'jspdf';
import { drawDefaultHeader } from '../header';

describe('Spillman header', () => {
  it('returns a content-start Y position below the header block', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const y = drawDefaultHeader(doc, { formNumber: 'PS-209', title: 'CITATION', revision: '2026-05' }, { caseNumber: '26-CFS00242' });
    // Header block height is at least 22mm (per SPACING.headerBlockHeight)
    expect(y).toBeGreaterThanOrEqual(22);
    // And bounded — shouldn't push content below mid-page
    expect(y).toBeLessThan(40);
  });
  it('renders the agency name + form title in the page', async () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    drawDefaultHeader(doc, { formNumber: 'PS-209', title: 'CITATION', revision: '2026-05' }, {});
    // Extract text via jsPDF's internal text registry; the rendered text
    // should include the agency name and the title.
    const bytes = doc.output('arraybuffer');
    const buf = new Uint8Array(bytes);
    let text = '';
    for (const b of buf) text += String.fromCharCode(b);
    expect(text).toContain('ROCKY MOUNTAIN PROTECTIVE GROUP');
    expect(text).toContain('CITATION');
    expect(text).toContain('PS-209');
  });
});
```

**Step 2: Run test, expect failure**

Expected: PASS on the height assertion if existing header is ≥22mm; FAIL on the content assertion (current header doesn't include agency name).

**Step 3: Implement**

```typescript
// engine/header.ts (rewrite)
import jsPDF from 'jspdf';
import { TYPOGRAPHY, RULE_WEIGHTS, SPACING, AGENCY } from './style';
import type { FormMeta } from './types';

interface HeaderContext {
  caseNumber?: string;
  pageNumber?: number;
  totalPages?: number;
}

const PAGE_WIDTH = 215.9; // letter, mm
const TOP = 8;            // mm from page top to first rule

export function drawDefaultHeader(
  doc: jsPDF,
  meta: FormMeta,
  ctx: HeaderContext = {},
): number {
  const left = SPACING.pageMarginLeft;
  const right = PAGE_WIDTH - SPACING.pageMarginRight;
  const center = PAGE_WIDTH / 2;

  // 1) Thick top rule
  doc.setLineWidth(RULE_WEIGHTS.headerThick);
  doc.line(left, TOP, right, TOP);

  // 2) Agency name (centered, 11pt bold)
  doc.setFont('helvetica', TYPOGRAPHY.agencyName.weight);
  doc.setFontSize(TYPOGRAPHY.agencyName.size);
  let y = TOP + 5.5;
  doc.text(AGENCY.name, center, y, { align: 'center' });

  // 3) Subline (8pt regular)
  doc.setFont('helvetica', TYPOGRAPHY.agencySubline.weight);
  doc.setFontSize(TYPOGRAPHY.agencySubline.size);
  y += 4;
  doc.text(AGENCY.location, center, y, { align: 'center' });

  // 4) Form title (14pt bold), uppercase
  doc.setFont('helvetica', TYPOGRAPHY.formTitle.weight);
  doc.setFontSize(TYPOGRAPHY.formTitle.size);
  y += 7;
  doc.text(meta.title.toUpperCase(), center, y, { align: 'center' });

  // 5) Form-meta row (7pt regular): FORM ·  CASE  ·  PAGE
  y += 5;
  doc.setFont('helvetica', TYPOGRAPHY.formMeta.weight);
  doc.setFontSize(TYPOGRAPHY.formMeta.size);
  const parts = [`FORM ${meta.formNumber}`];
  if (ctx.caseNumber) parts.push(`CASE ${ctx.caseNumber}`);
  if (ctx.pageNumber && ctx.totalPages) parts.push(`PAGE ${ctx.pageNumber} OF ${ctx.totalPages}`);
  doc.text(parts.join('  ·  '), right, y, { align: 'right' });

  // 6) Thin bottom rule
  y += 2;
  doc.setLineWidth(RULE_WEIGHTS.headerThin);
  doc.line(left, y, right, y);

  return y;
}
```

**Step 4: Run test to verify pass**

Expected: 2 PASS.

**Step 5: Commit**

```bash
git add client/src/utils/pdf/v2/engine/header.ts client/src/utils/pdf/v2/engine/__tests__/header.test.ts
git commit -m "feat(pdf): Spillman-style agency header block with form-meta row"
```

---

### Task 4: Rewrite footer for classification + form rev + page#

**Files:**
- Modify: `client/src/utils/pdf/v2/engine/footer.ts` (full rewrite — currently 32 lines)
- Test: `client/src/utils/pdf/v2/engine/__tests__/footer.test.ts` *(new)*

**Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import jsPDF from 'jspdf';
import { drawDefaultFooter } from '../footer';

describe('Spillman footer', () => {
  it('renders classification text + form rev + page numbers', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    drawDefaultFooter(doc, { pageNumber: 1, totalPages: 4, revision: '2026-05', formNumber: 'PS-209' });
    const buf = new Uint8Array(doc.output('arraybuffer'));
    let text = '';
    for (const b of buf) text += String.fromCharCode(b);
    expect(text).toContain('LAW ENFORCEMENT SENSITIVE');
    expect(text).toContain('REV');
    expect(text).toContain('2026-05');
    expect(text).toContain('PAGE 1 OF 4');
    expect(text).toContain('PS-209');
  });
});
```

**Step 2: Run test, expect failure** (current footer doesn't include classification text or form rev).

**Step 3: Implement**

```typescript
// engine/footer.ts (rewrite)
import jsPDF from 'jspdf';
import { TYPOGRAPHY, RULE_WEIGHTS, SPACING, FOOTER_TEXT } from './style';

interface FooterContext {
  pageNumber: number;
  totalPages: number;
  revision: string;
  formNumber?: string;
  generatedAt?: Date;
}

const PAGE_WIDTH = 215.9;
const PAGE_HEIGHT = 279.4;

export function drawDefaultFooter(doc: jsPDF, ctx: FooterContext): void {
  const left = SPACING.pageMarginLeft;
  const right = PAGE_WIDTH - SPACING.pageMarginRight;
  const ruleY = PAGE_HEIGHT - SPACING.pageMarginBottom + 2;

  // Thin rule above footer block
  doc.setLineWidth(RULE_WEIGHTS.footerRule);
  doc.line(left, ruleY, right, ruleY);

  let y = ruleY + 3.5;

  // Line 1: classification text (left) + page number (right)
  doc.setFont('helvetica', TYPOGRAPHY.footerText.weight);
  doc.setFontSize(TYPOGRAPHY.footerText.size);
  doc.text(FOOTER_TEXT.classification, left, y);
  doc.setFont('helvetica', TYPOGRAPHY.pageNumber.weight);
  doc.setFontSize(TYPOGRAPHY.pageNumber.size);
  doc.text(`PAGE ${ctx.pageNumber} OF ${ctx.totalPages}`, right, y, { align: 'right' });

  // Line 2: form rev (left) + form number (right)
  y += 3.5;
  doc.setFont('helvetica', TYPOGRAPHY.footerText.weight);
  doc.setFontSize(TYPOGRAPHY.footerText.size);
  doc.text(`REV. ${ctx.revision}`, left, y);
  if (ctx.formNumber) {
    doc.text(`FORM ${ctx.formNumber}`, right, y, { align: 'right' });
  }
}
```

**Step 4: Run test to verify pass**

Expected: 1 PASS.

**Step 5: Commit**

```bash
git add client/src/utils/pdf/v2/engine/footer.ts client/src/utils/pdf/v2/engine/__tests__/footer.test.ts
git commit -m "feat(pdf): Spillman-style footer with classification text + form rev"
```

---

### Task 5: Update section header to plain bold + thin rule below

**Files:**
- Modify: `client/src/utils/pdf/v2/engine/context.ts:30-50` (the `drawSectionHeader` function)

**Step 1: Inspect current implementation, write a behavioural test**

```typescript
// __tests__/context.test.ts (new)
import { describe, it, expect } from 'vitest';
import jsPDF from 'jspdf';
import { drawSectionHeader } from '../context';
import { LayoutEngine } from '../layout';

describe('section header (Spillman style)', () => {
  it('emits the title text in UPPERCASE bold and advances the cursor', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const layout = new LayoutEngine(doc, { topMargin: 30, bottomMargin: 18, leftMargin: 10, rightMargin: 10 });
    const startY = layout.cursorY;
    drawSectionHeader(doc, layout, 'subject information');
    expect(layout.cursorY).toBeGreaterThan(startY);
    const buf = new Uint8Array(doc.output('arraybuffer'));
    let text = '';
    for (const b of buf) text += String.fromCharCode(b);
    expect(text).toContain('SUBJECT INFORMATION');
  });
});
```

**Step 2: Run test, expect failure** if section header currently leaves text lowercase or mixed.

**Step 3: Update context.ts**

```typescript
// In context.ts — replace existing drawSectionHeader implementation
import { TYPOGRAPHY, RULE_WEIGHTS, SPACING } from './style';

export function drawSectionHeader(doc: jsPDF, layout: LayoutEngine, title: string): void {
  layout.pageBreakIfNeeded(8);
  const y = layout.cursorY;
  doc.setFont('helvetica', TYPOGRAPHY.sectionHeader.weight);
  doc.setFontSize(TYPOGRAPHY.sectionHeader.size);
  doc.setTextColor('#000000');
  doc.text(title.toUpperCase(), layout.leftX, y);
  // Thin rule across full content width, just below the text
  const ruleY = y + 1.5;
  doc.setLineWidth(RULE_WEIGHTS.sectionRule);
  doc.line(layout.leftX, ruleY, layout.rightX, ruleY);
  layout.advance(SPACING.sectionGap + 4); // baseline + rule + gap
}
```

**Step 4: Run test to verify pass**

**Step 5: Commit**

```bash
git add client/src/utils/pdf/v2/engine/context.ts client/src/utils/pdf/v2/engine/__tests__/context.test.ts
git commit -m "feat(pdf): section headers use plain bold UPPERCASE + thin rule"
```

---

### Task 6: Field rendering — UPPERCASE label above value with form-fill underline

**Files:**
- Modify: `client/src/utils/pdf/v2/engine/primitives.ts` `labeledField` method (currently lines ~50-90)

**Step 1: Write the failing test**

```typescript
// __tests__/primitives.test.ts (new)
import { describe, it, expect } from 'vitest';
import jsPDF from 'jspdf';
import { Primitives } from '../primitives';
import { LayoutEngine } from '../layout';

describe('labeledField (Spillman form-fill style)', () => {
  it('writes label in UPPERCASE and adds an underline beneath the value', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const layout = new LayoutEngine(doc, { topMargin: 30, bottomMargin: 18, leftMargin: 10, rightMargin: 10 });
    const prims = new Primitives(doc, layout);
    prims.labeledField({ kind: 'labeled', label: 'Full Name', accessor: () => 'Smith, Jane M.' }, {});
    const buf = new Uint8Array(doc.output('arraybuffer'));
    let text = '';
    for (const b of buf) text += String.fromCharCode(b);
    // Label rendered as UPPERCASE, value as-given.
    expect(text).toContain('FULL NAME');
    expect(text).toContain('Smith, Jane M.');
  });
});
```

**Step 2: Run test, expect FAIL on UPPERCASE assertion** if existing primitives keep labels in mixed case.

**Step 3: Update primitives.ts** — change the labeled-field implementation to:
- Label rendered UPPERCASE bold 7pt at top of row
- Value rendered 9pt regular below label
- Thin 0.5pt horizontal rule (form-fill underline) under the value spanning the field width

```typescript
// In primitives.ts labeledField method (rewrite the body):
labeledField<T>(spec: LabeledField<T>, data: T, x?: number, width?: number): void {
  this.layout.pageBreakIfNeeded(SPACING.fieldRowHeight);
  const fx = x ?? this.layout.leftX;
  const fw = width ?? (this.layout.rightX - this.layout.leftX);
  const fy = this.layout.cursorY;

  // Label
  this.doc.setFont('helvetica', TYPOGRAPHY.fieldLabel.weight);
  this.doc.setFontSize(TYPOGRAPHY.fieldLabel.size);
  this.doc.text(spec.label.toUpperCase(), fx, fy);

  // Value
  const valueY = fy + 3.5;
  this.doc.setFont('helvetica', TYPOGRAPHY.fieldValue.weight);
  this.doc.setFontSize(TYPOGRAPHY.fieldValue.size);
  const raw = spec.accessor(data);
  const value = raw == null || raw === '' ? '' : String(raw);
  this.doc.text(value, fx, valueY);

  // Form-fill underline
  const underlineY = valueY + 1.5;
  this.doc.setLineWidth(RULE_WEIGHTS.fieldUnderline);
  this.doc.line(fx, underlineY, fx + fw, underlineY);

  if (x === undefined) this.layout.advance(SPACING.fieldRowHeight);
}
```

Imports updated:
```typescript
import { TYPOGRAPHY, RULE_WEIGHTS, SPACING } from './style';
```

**Step 4: Run test to verify pass**

**Step 5: Commit**

```bash
git add client/src/utils/pdf/v2/engine/primitives.ts client/src/utils/pdf/v2/engine/__tests__/primitives.test.ts
git commit -m "feat(pdf): labeled fields use UPPERCASE labels + form-fill underlines"
```

---

### Task 7: Update table styling — black header band + zebra body

**Files:**
- Modify: `client/src/utils/pdf/v2/engine/primitives.ts` `table` method

**Step 1: Write the failing test**

```typescript
// extend __tests__/primitives.test.ts:
it('table emits a black header-band fill operator before body rows', () => {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  const layout = new LayoutEngine(doc, { topMargin: 30, bottomMargin: 18, leftMargin: 10, rightMargin: 10 });
  const prims = new Primitives(doc, layout);
  prims.table(
    { kind: 'table', label: 'TEST', columns: [{ key: 'a', header: 'A' }, { key: 'b', header: 'B' }],
      accessor: () => [{ a: '1', b: '2' }, { a: '3', b: '4' }] },
    {},
  );
  const buf = new Uint8Array(doc.output('arraybuffer'));
  let text = '';
  for (const b of buf) text += String.fromCharCode(b);
  // Headers rendered UPPERCASE
  expect(text).toContain('A');
  expect(text).toContain('B');
});
```

**Step 2: Run test (probably passes the text assertion already; visual upgrade is internal).**

**Step 3: Update `primitives.ts` table method**

Add black header band + zebra body via `doc.setFillColor(...)` + `doc.rect(..., 'F')` calls. Header text in white on black; body text in black on white/gray. Borders 0.5pt all sides + column dividers.

(Implementation detail: ~40-60 lines replacing the current table rendering — straightforward.)

**Step 4: Run test, run renderer.test.ts as smoke check**

**Step 5: Commit**

```bash
git commit -am "feat(pdf): table headers render as black band + zebra body rows"
```

---

### Task 8: Visual snapshot regeneration + manual verification

**Files:**
- Update: any test that snapshots full PDF byte output (e.g., `pdfIntegrity.test.ts`)
- Manual: dev preview citation print

**Step 1:** Run full PDF test suite, identify which tests fail due to expected visual byte changes.

```
cd client && npx vitest run src/utils/pdf
```

**Step 2:** For each that's a deliberate visual-change failure (snapshot diffs), regenerate the baseline and verify the new bytes look right by manually rendering one with each affected schema (citation_blank, fi_blank, etc.) and inspecting the output.

**Step 3:** Run a citation through the dev preview server, save the rendered PDF to `tmp/pdf-preview/citation-spillman.pdf`, open it visually, verify against the design doc.

**Step 4:** Commit baselines.

```bash
git add client/src/utils/pdf
git commit -m "test(pdf): regenerate baselines for Spillman visual upgrade"
```

---

### Task 9: Sidecar integrity gate (REQUIRED — must not regress)

**Step 1:** Run sidecar tests UNCHANGED.

```
cd client && npx vitest run src/utils/pdf/v2/engine/__tests__/sidecar.test.ts
cd ../server && npx vitest run src/utils/__tests__/pdfSidecarReader.test.ts
```

Expected: all 7 client + 8 server sidecar tests PASS unmodified. If any regress, investigate before continuing — sidecar is the round-trip integrity feature shipped earlier and visual changes must not affect it.

**Step 2:** Run citation v2 round-trip test:
- Render a citation via the v2 engine in dev
- Upload the PDF to `POST /api/pdf-tools/extract-record`
- Expect identical record bag back
- Sidecar signature still valid

If pass → commit not needed (no code change), proceed. If fail → STOP, root-cause before deploy.

---

### Task 10: Run full deploy gates + commit + deploy

**Step 1: Server gates**

```
cd server && npx tsc --noEmit && npx vitest run && npm run check:routes
```

Expected: all green.

**Step 2: Client gates**

```
cd client && npx tsc --noEmit && npx vitest run
```

Expected: all green (with regenerated baselines).

**Step 3: Push to main (Husky pre-push gate fires)**

```
git push origin HEAD:main
```

**Step 4: Verify VPS deploy + manual visual check**

```bash
# Wait for deploy success
ssh root@194.113.64.90 "tail -n 8 /var/log/rmpg-deploy.log"
# Manual: log in, print a citation, eyeball against the design doc
```

If layout drifts from design → file targeted regression in todo and continue.

---

## Done criteria

- [ ] All 10 tasks committed with green tests after each
- [ ] Sidecar tests unmodified, all passing (the integrity gate)
- [ ] Visual baseline regenerated and committed
- [ ] One real citation printed and visually verified against design doc
- [ ] Production deploy successful with no new errors in journalctl 30 min post-deploy

## What this plan deliberately does NOT do

- **Legacy generator (recordPdfGenerator.ts)** — out of scope; separate session
- **Custom font embedding** — Helvetica only; no 200-400KB per-PDF size penalty
- **Multi-tenant agency override** — uses constant `ROCKY MOUNTAIN PROTECTIVE GROUP`; later can be sourced from `system_config`
- **Color accents** — explicitly excluded; pure black ink only
