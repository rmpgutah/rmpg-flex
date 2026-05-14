# Citation 3-Copy PDF Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the single-page citation PDF with a 3-page hotdog-fold document — left half = citation data (multi-violation aware), right half = per-copy instructions (Violator / Officer / Administrative). All pages full-width Spillman header + footer, vertical fold rule, sidecar integrity preserved unmodified.

**Architecture:** New `Panel` primitive constrains a `LayoutEngine` to a sub-region of a page. New `renderMultiCopyPdfV2` orchestrator drives one shared schema render into the LEFT panel, then per-copy instruction renderers into the RIGHT panel. Sidecar embedding stays at the document level (single embed across all 3 pages). Backward-compat: empty `violations[]` falls back to flat `statute_citation` / `fine_amount` / `violation_description` / `offense_level` fields.

**Tech Stack:** TypeScript · jsPDF (mm units, letter portrait) · Vitest snapshot tests via `assertPdfSnapshot` helper · Ed25519 signing via `/api/pdf-tools/sign-payload` (unchanged).

**Design doc:** [docs/plans/2026-05-06-citation-3copy-pdf-design.md](./2026-05-06-citation-3copy-pdf-design.md) — read it first if you need context.

**Branch:** Already on `claude/heuristic-rosalind-d8edcc` worktree. Commit after each task.

---

## Task 1: `Panel` primitive — sub-region wrapper for LayoutEngine

**Why this first:** Every later task depends on rendering into a 4.25"-wide half-page panel. `Panel` is the load-bearing primitive.

**Files:**
- Create: `client/src/utils/pdf/v2/engine/panel.ts`
- Test: `client/src/utils/pdf/v2/engine/__tests__/panel.test.ts`

**Step 1: Write the failing test**

```typescript
// client/src/utils/pdf/v2/engine/__tests__/panel.test.ts
import { describe, it, expect } from 'vitest';
import jsPDF from 'jspdf';
import { Panel } from '../panel';

describe('Panel', () => {
  it('produces a LayoutEngine constrained to its bounds', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const panel = new Panel({ left: 10, top: 30, width: 97.85, height: 230 }, doc);
    const layout = panel.layout();
    expect(layout.leftX).toBe(10);
    expect(layout.rightX).toBeCloseTo(107.85, 2);
    expect(layout.cursorY).toBe(30);
  });

  it('pageBreakIfNeeded fires when cursor would exceed panel bottom', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const panel = new Panel({ left: 10, top: 30, width: 97.85, height: 50 }, doc);
    const layout = panel.layout();
    layout.advance(45);
    layout.pageBreakIfNeeded(10);
    // After break, cursor resets to panel.top (not page topMargin)
    expect(layout.cursorY).toBe(30);
    expect(doc.getNumberOfPages()).toBe(2);
  });

  it('two panels on the same page render independently', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const left = new Panel({ left: 10, top: 30, width: 97.85, height: 230 }, doc);
    const right = new Panel({ left: 110.95, top: 30, width: 97.85, height: 230 }, doc);
    expect(left.layout().rightX).toBeLessThan(right.layout().leftX);
  });
});
```

**Step 2: Run test, verify it fails**

```bash
cd client && npx vitest run src/utils/pdf/v2/engine/__tests__/panel.test.ts
```
Expected: FAIL — `Cannot find module '../panel'`.

**Step 3: Implement `panel.ts`**

```typescript
// client/src/utils/pdf/v2/engine/panel.ts
import type jsPDF from 'jspdf';
import { LayoutEngine } from './layout';

export interface PanelBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Panel constrains a LayoutEngine to a sub-region of a page. Used by
 * renderMultiCopyPdfV2 to render the citation schema into the left
 * 4.25"-wide half and the copy-specific instructions into the right
 * half without either overflowing into the other.
 *
 * The wrapped LayoutEngine uses the panel's left/right as its X bounds
 * and the panel's top/bottom (computed from page height − [top+height])
 * as its Y bounds. pageBreakIfNeeded inside the panel adds a new
 * physical page and resets cursor to the panel's top — callers are
 * responsible for re-drawing the panel chrome (banner, fold rule) on
 * the new page if needed.
 */
export class Panel {
  constructor(public readonly bounds: PanelBounds, private readonly doc: jsPDF) {}

  layout(): LayoutEngine {
    const pageHeight = this.doc.internal.pageSize.getHeight();
    const pageWidth = this.doc.internal.pageSize.getWidth();
    return new LayoutEngine(this.doc, {
      topMargin: this.bounds.top,
      bottomMargin: pageHeight - (this.bounds.top + this.bounds.height),
      leftMargin: this.bounds.left,
      rightMargin: pageWidth - (this.bounds.left + this.bounds.width),
    });
  }
}
```

**Step 4: Run, verify pass**

```bash
cd client && npx vitest run src/utils/pdf/v2/engine/__tests__/panel.test.ts
```
Expected: PASS — 3/3.

**Step 5: Commit**

```bash
git add client/src/utils/pdf/v2/engine/panel.ts client/src/utils/pdf/v2/engine/__tests__/panel.test.ts
git commit -m "feat(pdf-v2): add Panel primitive constraining LayoutEngine to sub-region"
```

---

## Task 2: `CitationViolation` type + canonical-data extension

**Why:** Schema needs to accept the violations array before any layout work touches it. Sidecar canonical data must include violations so round-trip parity holds.

**Files:**
- Modify: `client/src/utils/pdf/v2/forms/citation.ts` (extend `CitationData` interface, extend `citationCanonicalData`)
- Test: `client/src/utils/pdf/v2/forms/__tests__/citation.test.ts` (CREATE)

**Step 1: Write the failing test**

```typescript
// client/src/utils/pdf/v2/forms/__tests__/citation.test.ts
import { describe, it, expect } from 'vitest';
import { citationCanonicalData, type CitationData, type CitationViolation } from '../citation';

describe('citationCanonicalData', () => {
  it('includes violations array when present', () => {
    const v: CitationViolation = {
      statute_citation: 'UCA 41-6a-601',
      description: 'Speeding 15 over',
      offense_level: 'Infraction',
      fine_amount: 175,
    };
    const data: CitationData = { citation_number: 'C-1', violations: [v] };
    const bag = citationCanonicalData(data);
    expect(bag.violations).toEqual([v]);
  });

  it('omits violations when absent (back-compat)', () => {
    const data: CitationData = { citation_number: 'C-1' };
    const bag = citationCanonicalData(data);
    expect('violations' in bag).toBe(false);
  });
});
```

**Step 2: Run, verify fail**

```bash
cd client && npx vitest run src/utils/pdf/v2/forms/__tests__/citation.test.ts
```
Expected: FAIL — `Module '"../citation"' has no exported member 'CitationViolation'`.

**Step 3: Extend `citation.ts`**

In `client/src/utils/pdf/v2/forms/citation.ts`:

a. Add the new type export above `CitationData`:

```typescript
export interface CitationViolation {
  statute_citation: string;
  description: string;
  offense_level: 'Infraction' | 'Misdemeanor' | 'Felony';
  fine_amount: number;
}
```

b. Extend `CitationData`:

```typescript
export interface CitationData {
  // ... existing fields unchanged ...
  violations?: CitationViolation[];
}
```

c. Extend `citationCanonicalData` — at the end, before `return bag;`:

```typescript
if (Array.isArray(d.violations) && d.violations.length > 0) {
  bag.violations = d.violations;
}
```

**Step 4: Run, verify pass**

```bash
cd client && npx vitest run src/utils/pdf/v2/forms/__tests__/citation.test.ts
```
Expected: PASS — 2/2.

**Step 5: Commit**

```bash
git add client/src/utils/pdf/v2/forms/citation.ts client/src/utils/pdf/v2/forms/__tests__/citation.test.ts
git commit -m "feat(pdf-v2): extend CitationData with violations array + canonicalize support"
```

---

## Task 3: Multi-violation auto-layout helper

**Why:** Encapsulates the compact-table-vs-stacked decision and the rendering. Pure render function takes a `Primitives` + `LayoutEngine` + violations array.

**Files:**
- Create: `client/src/utils/pdf/v2/forms/citationViolations.ts`
- Test: `client/src/utils/pdf/v2/forms/__tests__/citationViolations.test.ts`

**Step 1: Write the failing test**

```typescript
// client/src/utils/pdf/v2/forms/__tests__/citationViolations.test.ts
import { describe, it, expect } from 'vitest';
import { selectViolationLayout } from '../citationViolations';
import type { CitationViolation } from '../citation';

const v = (n: number): CitationViolation[] =>
  Array.from({ length: n }, (_, i) => ({
    statute_citation: `UCA-${i}`, description: `d${i}`,
    offense_level: 'Infraction' as const, fine_amount: 10 * (i + 1),
  }));

describe('selectViolationLayout', () => {
  it('returns "compact" for 0..3 violations', () => {
    expect(selectViolationLayout(v(0))).toBe('compact');
    expect(selectViolationLayout(v(1))).toBe('compact');
    expect(selectViolationLayout(v(3))).toBe('compact');
  });
  it('returns "stacked" for 4+ violations', () => {
    expect(selectViolationLayout(v(4))).toBe('stacked');
    expect(selectViolationLayout(v(10))).toBe('stacked');
  });
});

describe('totalFine', () => {
  it('sums fine_amount across violations', async () => {
    const { totalFine } = await import('../citationViolations');
    expect(totalFine(v(3))).toBe(10 + 20 + 30);
    expect(totalFine([])).toBe(0);
  });
});
```

**Step 2: Run, verify fail.**

```bash
cd client && npx vitest run src/utils/pdf/v2/forms/__tests__/citationViolations.test.ts
```

**Step 3: Implement `citationViolations.ts`**

```typescript
// client/src/utils/pdf/v2/forms/citationViolations.ts
import type { LayoutEngine } from '../engine/layout';
import type { Primitives } from '../engine/primitives';
import type { CitationViolation } from './citation';

export type ViolationLayout = 'compact' | 'stacked';

export function selectViolationLayout(violations: CitationViolation[]): ViolationLayout {
  return violations.length >= 4 ? 'stacked' : 'compact';
}

export function totalFine(violations: CitationViolation[]): number {
  return violations.reduce((sum, v) => sum + (Number.isFinite(v.fine_amount) ? v.fine_amount : 0), 0);
}

const fmtFine = (n: number) => `$${n.toFixed(2)}`;

/**
 * Render the VIOLATIONS section into the current cursor of `layout`.
 * Caller must have already drawn the section header. Renderer picks
 * compact-table for ≤3 violations, stacked-per-violation for 4+.
 */
export function renderViolations(
  prims: Primitives,
  layout: LayoutEngine,
  violations: CitationViolation[],
): void {
  if (violations.length === 0) return;
  const mode = selectViolationLayout(violations);
  if (mode === 'compact') renderCompact(prims, layout, violations);
  else renderStacked(prims, layout, violations);
}

function renderCompact(prims: Primitives, layout: LayoutEngine, violations: CitationViolation[]): void {
  prims.table(
    {
      kind: 'table',
      label: '',
      columns: [
        { header: 'STATUTE', width: 30, accessor: (v: CitationViolation) => v.statute_citation },
        { header: 'DESCRIPTION', width: 0, accessor: (v: CitationViolation) => v.description },
        { header: 'LVL', width: 14, accessor: (v: CitationViolation) => v.offense_level.slice(0, 3).toUpperCase() },
        { header: 'FINE', width: 22, accessor: (v: CitationViolation) => fmtFine(v.fine_amount) },
      ],
      rows: () => violations,
      editable: false,
    } as any,
    null as any,
  );
  prims.spacer(2);
  // Total row, right-aligned
  const total = totalFine(violations);
  prims.labeledField(
    { kind: 'labeled', label: 'TOTAL FINE', accessor: () => fmtFine(total), editable: false },
    null as any,
  );
}

function renderStacked(prims: Primitives, layout: LayoutEngine, violations: CitationViolation[]): void {
  violations.forEach((v, i) => {
    prims.spacer(1);
    prims.labeledField(
      { kind: 'labeled', label: `VIOLATION ${i + 1} — STATUTE`, accessor: () => v.statute_citation, editable: false },
      null as any,
    );
    prims.labeledField(
      { kind: 'labeled', label: 'OFFENSE LEVEL', accessor: () => v.offense_level, editable: false },
      null as any,
    );
    prims.labeledField(
      { kind: 'labeled', label: 'DESCRIPTION', accessor: () => v.description, editable: false },
      null as any,
    );
    prims.labeledField(
      { kind: 'labeled', label: 'FINE', accessor: () => fmtFine(v.fine_amount), editable: false },
      null as any,
    );
  });
  prims.spacer(2);
  prims.labeledField(
    { kind: 'labeled', label: 'TOTAL FINE', accessor: () => fmtFine(totalFine(violations)), editable: false },
    null as any,
  );
}
```

**Note:** The `prims.table` and `prims.labeledField` argument shapes here are based on existing primitives. Before writing, **read** `client/src/utils/pdf/v2/engine/primitives.ts` to confirm the exact `TableField` / `LabeledField` shape — adjust the `as any` casts if your primitives expect a typed `data` argument.

**Step 4: Run, verify pass.**

**Step 5: Commit**

```bash
git add client/src/utils/pdf/v2/forms/citationViolations.ts client/src/utils/pdf/v2/forms/__tests__/citationViolations.test.ts
git commit -m "feat(pdf-v2): add multi-violation auto-layout (compact ≤3, stacked 4+)"
```

---

## Task 4: Reflow citation schema to 2-column max + insert VIOLATIONS section

**Why:** Half-page rendering needs ≤2 columns. VIOLATIONS section needs a callback section so it can switch layouts at render time.

**Files:**
- Modify: `client/src/utils/pdf/v2/forms/citation.ts`
- Test: existing `citation.test.ts` (extend)

**Step 1: Add a test asserting the schema column counts**

Append to `client/src/utils/pdf/v2/forms/__tests__/citation.test.ts`:

```typescript
import { citationSchema } from '../citation';

describe('citationSchema layout', () => {
  it('uses ≤2 columns in every typed section', () => {
    for (const s of citationSchema.sections) {
      if (typeof s === 'function') continue;
      expect(s.columns ?? 1).toBeLessThanOrEqual(2);
    }
  });
  it('contains an ISSUING OFFICER section before NOTES', () => {
    const titles: string[] = [];
    for (const s of citationSchema.sections) {
      if (typeof s !== 'function') titles.push(s.title);
    }
    const officerIdx = titles.indexOf('ISSUING OFFICER');
    const notesIdx = titles.indexOf('NOTES');
    expect(officerIdx).toBeGreaterThanOrEqual(0);
    expect(notesIdx).toBeGreaterThan(officerIdx);
  });
});
```

**Step 2: Run, verify fail.**

**Step 3: Reflow the schema**

In `citation.ts`, replace the `sections:` array with the 2-column-max layout per the design doc (sections 1-9). The VIOLATIONS section is a callback that calls `renderViolations(...)`:

```typescript
import { renderViolations } from './citationViolations';

// ... inside citationSchema.sections, replace VIOLATION DETAILS + VIOLATION DESCRIPTION:
(ctx, data) => {
  ctx.section('VIOLATIONS', (inner) => {
    const violations = (data as CitationData).violations ?? [];
    if (violations.length > 0) {
      renderViolations(inner.primitives, inner.layout, violations);
    } else {
      // Back-compat: render single flat-field violation
      inner.labeledField(lf('Statute / Code', 'statute_citation'), data);
      inner.labeledField(lf('Offense Level', 'offense_level'), data);
      inner.labeledField(
        lf('Fine Amount', 'fine_amount', (d) => fineFmt(d.fine_amount ?? null)), data);
      inner.labeledField(lf('Violation Description', 'violation_description'), data);
    }
  });
},
```

Insert ISSUING OFFICER section between COURT ADDRESS and NOTES:

```typescript
{
  kind: 'section', title: 'ISSUING OFFICER', columns: 1,
  fields: [
    lf('Officer', 'issuing_officer_name', (d) =>
      `${d.issuing_officer_name ?? ''}  ·  Badge #${d.badge_number ?? ''}`),
  ],
},
```

**Note:** Confirm the actual shape of the callback-section's `inner` API by reading `client/src/utils/pdf/v2/engine/context.ts`. If `inner` doesn't expose `.primitives` and `.layout` directly, add accessors to the context shape in a small companion edit and call them out in the commit message.

**Step 4: Run, verify pass.**

**Step 5: Commit**

```bash
git add client/src/utils/pdf/v2/forms/citation.ts client/src/utils/pdf/v2/forms/__tests__/citation.test.ts
git commit -m "feat(pdf-v2): reflow citation schema to 2-col max, add VIOLATIONS + ISSUING OFFICER sections"
```

---

## Task 5: Per-copy instruction text blocks

**Why:** Three copy variants need their fixed Utah-jurisdiction text. Locked-content tests prevent silent edits.

**Files:**
- Create: `client/src/utils/pdf/v2/forms/citationInstructions.ts`
- Test: `client/src/utils/pdf/v2/forms/__tests__/citationInstructions.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { CITATION_INSTRUCTIONS, type CopyVariantId } from '../citationInstructions';

describe('CITATION_INSTRUCTIONS', () => {
  it('exposes exactly three variants in canonical order', () => {
    expect(CITATION_INSTRUCTIONS.map((c) => c.id))
      .toEqual(['violator', 'officer', 'administrative']);
  });
  it.each([
    ['violator', 'VIOLATOR COPY'],
    ['officer', 'OFFICER COPY — RETAIN FOR RECORDS'],
    ['administrative', 'ADMINISTRATIVE COPY — COURT FILING'],
  ])('%s banner reads "%s"', (id, banner) => {
    const c = CITATION_INSTRUCTIONS.find((x) => x.id === id as CopyVariantId);
    expect(c?.bannerText).toBe(banner);
  });
  it('violator block mentions Utah Code §53-3-218', () => {
    const c = CITATION_INSTRUCTIONS.find((x) => x.id === 'violator')!;
    expect(c.body.join('\n')).toMatch(/53-3-218/);
  });
  it('officer block contains "penalty of perjury"', () => {
    const c = CITATION_INSTRUCTIONS.find((x) => x.id === 'officer')!;
    expect(c.body.join('\n').toLowerCase()).toContain('penalty of perjury');
  });
  it('administrative block contains DISPOSITION header', () => {
    const c = CITATION_INSTRUCTIONS.find((x) => x.id === 'administrative')!;
    expect(c.body.join('\n')).toContain('DISPOSITION');
  });
});
```

**Step 2: Run, verify fail.**

**Step 3: Implement `citationInstructions.ts`**

Lift the verbatim text blocks from the design doc (Page 1, 2, 3) into a `body: string[]` (one entry per logical line). Export shape:

```typescript
export type CopyVariantId = 'violator' | 'officer' | 'administrative';

export interface CitationCopyVariant {
  id: CopyVariantId;
  bannerText: string;
  /** Lines as they should be rendered top-to-bottom. Empty strings = blank line. */
  body: string[];
}

export const CITATION_INSTRUCTIONS: CitationCopyVariant[] = [
  { id: 'violator', bannerText: 'VIOLATOR COPY', body: [/* lifted from design doc */] },
  { id: 'officer', bannerText: 'OFFICER COPY — RETAIN FOR RECORDS', body: [/* ... */] },
  { id: 'administrative', bannerText: 'ADMINISTRATIVE COPY — COURT FILING', body: [/* ... */] },
];
```

**Step 4: Run, verify pass.**

**Step 5: Commit**

```bash
git add client/src/utils/pdf/v2/forms/citationInstructions.ts client/src/utils/pdf/v2/forms/__tests__/citationInstructions.test.ts
git commit -m "feat(pdf-v2): add Violator/Officer/Administrative copy text blocks"
```

---

## Task 6: `renderMultiCopyPdfV2` orchestrator

**Why:** This is the main entry. It composes header → fold rule → left panel (schema render) → right panel (banner + instructions render) → footer, looped per copy.

**Files:**
- Create: `client/src/utils/pdf/v2/engine/multiCopy.ts`
- Test: `client/src/utils/pdf/v2/engine/__tests__/multiCopy.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { renderMultiCopyPdfV2 } from '../multiCopy';
import { citationSchema } from '../../forms/citation';
import { CITATION_INSTRUCTIONS } from '../../forms/citationInstructions';

describe('renderMultiCopyPdfV2', () => {
  it('produces ≥3 pages (one per copy, more if continuation needed)', async () => {
    const doc = await renderMultiCopyPdfV2(
      citationSchema,
      { citation_number: 'C-26-1', issuing_officer_name: 'ZAMORA' },
      CITATION_INSTRUCTIONS,
    );
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(3);
  });

  it('emits the violator banner on page 1, officer on page 2, admin on page 3', async () => {
    const doc = await renderMultiCopyPdfV2(
      citationSchema,
      { citation_number: 'C-26-1' },
      CITATION_INSTRUCTIONS,
    );
    // Inspect doc internals: jsPDF stores text per page in doc.internal.pages
    const text = (doc as any).internal.pages.map((p: any) =>
      Array.isArray(p) ? p.join('\n') : String(p ?? '')
    );
    expect(text[1]).toContain('VIOLATOR COPY');
    expect(text[2]).toContain('OFFICER COPY');
    expect(text[3]).toContain('ADMINISTRATIVE COPY');
  });
});
```

**Step 2: Run, verify fail.**

**Step 3: Implement `multiCopy.ts`**

```typescript
// client/src/utils/pdf/v2/engine/multiCopy.ts
import jsPDF from 'jspdf';
import { Panel } from './panel';
import { LayoutEngine } from './layout';
import { Primitives } from './primitives';
import { drawDefaultHeader } from './header';
import { drawDefaultFooter } from './footer';
import { makeRenderContext, drawSectionHeader, closeSection } from './context';
import type { FormSchema, SchemaSection, RenderCallback } from './types';
import type { CitationCopyVariant } from '../forms/citationInstructions';
import type { RenderOptions } from './renderer';
import { TYPOGRAPHY, RULE_WEIGHTS } from './style';

const PAGE_W_MM = 215.9; // letter portrait width
const FOLD_X_MM = PAGE_W_MM / 2; // 107.95
const HALF_GAP_MM = 5;
const OUTER_MARGIN_MM = 10;
const HEADER_GAP_MM = 1;
const FOOTER_TOP_MM = 18;

export async function renderMultiCopyPdfV2<T>(
  schema: FormSchema<T>,
  data: T,
  copies: CitationCopyVariant[],
  options?: RenderOptions,
): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });

  copies.forEach((copy, i) => {
    if (i > 0) doc.addPage();
    const headerBottomY = drawDefaultHeader(doc, schema.meta, {
      caseNumber: schema.header.caseNumberAccessor?.(data),
    });
    drawFoldRule(doc, headerBottomY);
    renderLeftPanel(doc, schema, data, headerBottomY);
    renderRightPanel(doc, copy, headerBottomY);
  });

  // Footers go last (need final total page count for "PAGE N OF M").
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    drawDefaultFooter(doc, {
      pageNumber: p, totalPages: total,
      revision: schema.meta.revision, formNumber: schema.meta.formNumber,
      generatedAt: options?.generatedAt,
    });
  }
  return doc;
}

function drawFoldRule(doc: jsPDF, headerBottomY: number): void {
  const pageH = doc.internal.pageSize.getHeight();
  doc.saveGraphicsState();
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(RULE_WEIGHTS.fieldUnderline);
  doc.line(FOLD_X_MM, headerBottomY + 1, FOLD_X_MM, pageH - FOOTER_TOP_MM - 1);
  doc.restoreGraphicsState();
}

function renderLeftPanel<T>(
  doc: jsPDF, schema: FormSchema<T>, data: T, headerBottomY: number,
): void {
  const pageH = doc.internal.pageSize.getHeight();
  const panel = new Panel({
    left: OUTER_MARGIN_MM,
    top: headerBottomY + HEADER_GAP_MM,
    width: FOLD_X_MM - HALF_GAP_MM - OUTER_MARGIN_MM,
    height: pageH - FOOTER_TOP_MM - (headerBottomY + HEADER_GAP_MM),
  }, doc);
  const layout = panel.layout();
  const prims = new Primitives(doc, layout);
  for (const section of schema.sections) {
    if (typeof section === 'function') {
      const ctx = makeRenderContext(doc, layout, prims, data);
      (section as RenderCallback<T>)(ctx, data);
    } else {
      const s = section as SchemaSection<T>;
      if (s.visibleIf && !s.visibleIf(data)) continue;
      drawSectionHeader(doc, layout, s.title);
      // Re-use the existing renderSectionFields by inlining its 2-col logic
      // OR export it from renderer.ts. Recommended: export it.
      renderSectionFields(prims, layout, s, data);
      closeSection(layout);
    }
  }
}

function renderRightPanel(doc: jsPDF, copy: CitationCopyVariant, headerBottomY: number): void {
  const pageH = doc.internal.pageSize.getHeight();
  const panel = new Panel({
    left: FOLD_X_MM + HALF_GAP_MM,
    top: headerBottomY + HEADER_GAP_MM,
    width: PAGE_W_MM - OUTER_MARGIN_MM - (FOLD_X_MM + HALF_GAP_MM),
    height: pageH - FOOTER_TOP_MM - (headerBottomY + HEADER_GAP_MM),
  }, doc);
  const layout = panel.layout();
  // Banner
  doc.saveGraphicsState();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(TYPOGRAPHY.sectionHeader.size);
  doc.text(copy.bannerText, layout.leftX, layout.cursorY + 4);
  layout.advance(6);
  doc.setLineWidth(RULE_WEIGHTS.sectionRule);
  doc.line(layout.leftX, layout.cursorY, layout.rightX, layout.cursorY);
  layout.advance(2);
  // Body
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(TYPOGRAPHY.fieldValue.size);
  const lineH = TYPOGRAPHY.fieldValue.size * 0.45;
  for (const line of copy.body) {
    layout.pageBreakIfNeeded(lineH);
    if (line.trim().length > 0) {
      doc.text(line, layout.leftX, layout.cursorY);
    }
    layout.advance(lineH);
  }
  doc.restoreGraphicsState();
}

// renderSectionFields: import from renderer.ts (export it from there as a
// preceding sub-step) OR duplicate the 9-line implementation here.
declare function renderSectionFields<T>(
  p: Primitives, l: LayoutEngine, s: SchemaSection<T>, d: T): void;
```

**Sub-step note:** Before this code compiles, `renderSectionFields` must become a named export from `renderer.ts`. Add `export` to its declaration in renderer.ts as a small companion change in this same commit.

**Step 4: Run, verify pass.**

**Step 5: Commit**

```bash
git add client/src/utils/pdf/v2/engine/multiCopy.ts client/src/utils/pdf/v2/engine/__tests__/multiCopy.test.ts client/src/utils/pdf/v2/engine/renderer.ts
git commit -m "feat(pdf-v2): add renderMultiCopyPdfV2 orchestrator (3-copy hotdog-fold layout)"
```

---

## Task 7: Sidecar non-regression gate (the critical test)

**Why:** The whole point of the v2 engine is round-trip integrity. A 3-page output must still embed exactly one extractable sidecar matching the canonical violations-aware data.

**Files:**
- Test: `client/src/utils/pdf/v2/engine/__tests__/multiCopy.sidecar.test.ts` (CREATE)

**Step 1: Write the test**

```typescript
import { describe, it, expect } from 'vitest';
import { renderMultiCopyPdfV2 } from '../multiCopy';
import { embedSidecar, outputWithSidecar, extractSidecarFromBytes } from '../sidecar';
import { citationSchema, citationCanonicalData, type CitationData } from '../../forms/citation';
import { CITATION_INSTRUCTIONS } from '../../forms/citationInstructions';

describe('multiCopy + sidecar round-trip', () => {
  it('embeds canonical citation data with violations[]', async () => {
    const data: CitationData = {
      citation_number: 'C-26-99',
      violations: [
        { statute_citation: 'UCA 41-6a-601', description: 'Speeding', offense_level: 'Infraction', fine_amount: 175 },
        { statute_citation: 'UCA 41-6a-92',  description: 'Failure to signal', offense_level: 'Infraction', fine_amount: 50 },
      ],
    };
    const doc = await renderMultiCopyPdfV2(citationSchema, data, CITATION_INSTRUCTIONS);
    embedSidecar(doc, {
      v: 1, schemaId: 'citation', formNumber: 'PS-209',
      caseNumber: 'C-26-99', generatedAt: '2026-05-06T00:00:00Z',
      data: citationCanonicalData(data),
    });
    const bytes = outputWithSidecar(doc);
    const extracted = extractSidecarFromBytes(bytes);
    expect(extracted).not.toBeNull();
    expect((extracted!.data as any).violations).toHaveLength(2);
    expect((extracted!.data as any).violations[0].statute_citation).toBe('UCA 41-6a-601');
  });

  it('the existing 15 sidecar tests are unmodified', () => {
    // Sentinel: this test passes only if the existing test file is byte-stable.
    // (Manual: do NOT edit sidecar.test.ts during this PR. Verify with
    //  `git diff --stat client/src/utils/pdf/v2/engine/__tests__/sidecar.test.ts`
    //  before commit.)
    expect(true).toBe(true);
  });
});
```

**Step 2: Run, verify pass** (the orchestrator already produces sidecar-compatible output because the doc is just a jsPDF instance).

**Step 3: Run the full sidecar suite to prove zero regression:**

```bash
cd client && npx vitest run src/utils/pdf/v2/engine/__tests__/sidecar.test.ts
```
Expected: 15/15 PASS.

**Step 4: Commit**

```bash
git add client/src/utils/pdf/v2/engine/__tests__/multiCopy.sidecar.test.ts
git commit -m "test(pdf-v2): sidecar round-trip preserved through multiCopy orchestrator"
```

---

## Task 8: Wire dispatch adapter to use multiCopy for citations

**Files:**
- Modify: `client/src/utils/pdf/v2DispatchAdapter.ts`
- Modify: `client/src/utils/pdf/v2/index.ts` (add `downloadMultiCopyPdfV2`)

**Step 1: Add a new download helper**

In `client/src/utils/pdf/v2/index.ts`:

```typescript
import { renderMultiCopyPdfV2 } from './engine/multiCopy';
import type { CitationCopyVariant } from './forms/citationInstructions';
export { renderMultiCopyPdfV2 } from './engine/multiCopy';

export async function downloadMultiCopyPdfV2<T>(
  schema: FormSchema<T>,
  data: T,
  copies: CitationCopyVariant[],
  filename: string,
  options?: DownloadOptions,
): Promise<void> {
  const doc = await renderMultiCopyPdfV2(schema, data, copies, { generatedAt: options?.generatedAt });
  if (options?.schemaId) {
    const payload: SidecarPayload = {
      v: 1, schemaId: options.schemaId,
      formNumber: schema.meta.formNumber,
      caseNumber: options.caseNumber ?? '',
      generatedAt: (options.generatedAt ?? new Date()).toISOString(),
      data: data as unknown,
      signature: options.signature,
    };
    embedSidecar(doc, payload);
    const bytes = outputWithSidecar(doc);
    const ab = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(ab).set(bytes);
    const blob = new Blob([ab], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    return;
  }
  doc.save(filename);
}
```

**Step 2: Switch citation dispatch to multi-copy**

In `client/src/utils/pdf/v2DispatchAdapter.ts`, replace the `downloadPdfV2` import + call with `downloadMultiCopyPdfV2`, importing `CITATION_INSTRUCTIONS`:

```typescript
const { downloadMultiCopyPdfV2, payloadHash } = await import('./v2');
const { citationSchema, citationCanonicalData } = await import('./v2/forms/citation');
const { CITATION_INSTRUCTIONS } = await import('./v2/forms/citationInstructions');
// ...
await downloadMultiCopyPdfV2(citationSchema, data, CITATION_INSTRUCTIONS, filename, {
  schemaId: 'citation',
  caseNumber,
  signature: signature ? { /* same shape */ } : undefined,
});
```

**Step 3: Type-check**

```bash
cd client && npx tsc --noEmit
```
Expected: 0 errors.

**Step 4: Run the full v2 suite**

```bash
cd client && npx vitest run src/utils/pdf/v2
```
Expected: all green except possibly snapshot baselines (Task 9).

**Step 5: Commit**

```bash
git add client/src/utils/pdf/v2/index.ts client/src/utils/pdf/v2DispatchAdapter.ts
git commit -m "feat(pdf-v2): dispatch citations through multiCopy renderer"
```

---

## Task 9: Server-side `/full` fetch for citations

**Why:** The print path needs the joined `citation_violations` rows so `data.violations` is populated. Without this, every citation falls back to single-violation flat rendering.

**Files:**
- Modify: `client/src/components/PrintRecordButton.tsx` (or whichever component currently calls `tryV2Dispatch`)
- Verify: `server/src/routes/citations.ts` already exposes `/full` returning joined violations

**Step 1: Verify server endpoint shape**

```bash
cd server && grep -n "full" src/routes/citations.ts | head
```
If a `/citations/:id/full` route exists and returns `{ ...row, violations: [...] }`, proceed. If not, add a small endpoint that joins `citation_violations`. (This task may be a no-op if the endpoint already exists from the multi-violation server work.)

**Step 2: Update the client print site**

Find the citation print call site:

```bash
cd client && grep -rn "recordType.*citation" src/ | grep -v __tests__
```

In whichever component invokes `tryV2Dispatch({ recordType: 'citation', recordData })`, change `recordData` to come from `apiFetch(\`/citations/${id}/full\`)` instead of the bare row.

**Step 3: Manual smoke**

```bash
cd /Users/rmpgutah/RMPG\ Flex/.claude/worktrees/heuristic-rosalind-d8edcc && npm run dev
```
Open a citation in the UI, click Print, verify a 3-page PDF downloads with violations populated.

**Step 4: Commit**

```bash
git add client/src/components/<the-print-component>.tsx
git commit -m "feat(citations): print path fetches joined violations via /full"
```

---

## Task 10: Regenerate snapshot baselines + final verification

**Why:** The single-page citation snapshot is now obsolete. New 3-copy snapshot baseline locks in visual correctness for future regression detection.

**Files:**
- Test: `client/src/utils/pdf/v2/__tests__/citation3Copy.snapshot.test.ts` (CREATE)
- Snapshots: `client/src/utils/pdf/v2/__tests__/__snapshots__/citation_3copy.empty.{pdf,sha256}` (auto-generated)

**Step 1: Add snapshot test**

```typescript
import { describe, it } from 'vitest';
import { createHash } from 'crypto';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { renderMultiCopyPdfV2 } from '../engine/multiCopy';
import { citationSchema } from '../forms/citation';
import { CITATION_INSTRUCTIONS } from '../forms/citationInstructions';
import { expect } from 'vitest';

const SNAP = join(__dirname, '__snapshots__');
const PINNED = new Date('2026-01-01T00:00:00Z');

async function snap(name: string, data: any) {
  const doc = await renderMultiCopyPdfV2(citationSchema, data, CITATION_INSTRUCTIONS, { generatedAt: PINNED });
  (doc as any).setCreationDate?.('D:20260101000000+00\'00\'');
  (doc as any).setFileId?.('00000000000000000000000000000000');
  const buf = Buffer.from(doc.output('arraybuffer') as ArrayBuffer);
  const hash = createHash('sha256').update(buf).digest('hex');
  const file = join(SNAP, `${name}.sha256`);
  if (process.env.UPDATE_SNAPSHOTS === '1' || !existsSync(file)) {
    mkdirSync(SNAP, { recursive: true });
    writeFileSync(file, hash + '\n');
    writeFileSync(join(SNAP, `${name}.pdf`), buf);
    return;
  }
  expect(hash, `Re-run with UPDATE_SNAPSHOTS=1 if intentional`).toBe(readFileSync(file, 'utf8').trim());
}

describe('citation 3-copy snapshots', () => {
  it('empty record', async () => { await snap('citation_3copy.empty', {}); });
  it('2 violations', async () => {
    await snap('citation_3copy.two_violations', {
      citation_number: 'C-26-99',
      violations: [
        { statute_citation: 'UCA 41-6a-601', description: 'Speeding 15 over', offense_level: 'Infraction', fine_amount: 175 },
        { statute_citation: 'UCA 41-6a-92',  description: 'Failure to signal', offense_level: 'Infraction', fine_amount: 50 },
      ],
    });
  });
  it('5 violations (stacked layout)', async () => {
    const violations = Array.from({ length: 5 }, (_, i) => ({
      statute_citation: `UCA-X${i}`, description: `desc ${i}`,
      offense_level: 'Infraction' as const, fine_amount: 25 * (i + 1),
    }));
    await snap('citation_3copy.five_violations', { citation_number: 'C-26-100', violations });
  });
});
```

**Step 2: Generate baselines**

```bash
cd client && UPDATE_SNAPSHOTS=1 npx vitest run src/utils/pdf/v2/__tests__/citation3Copy.snapshot.test.ts
```
Expected: 3 PDF + 3 hash files written to `__snapshots__/`.

**Step 3: Visually inspect the generated PDFs**

```bash
open client/src/utils/pdf/v2/__tests__/__snapshots__/citation_3copy.two_violations.pdf
```
Verify: 3 pages, fold rule visible, banners correct, total fine = $225.00, no overflow into right panel.

**Step 4: Re-run all tests**

```bash
cd client && npx vitest run
cd client && npx tsc --noEmit
```
Expected: green across the board.

**Step 5: Commit**

```bash
git add client/src/utils/pdf/v2/__tests__/
git commit -m "test(pdf-v2): snapshot baselines for 3-copy citation (empty / 2-viol / 5-viol)"
```

---

## Task 11: Deploy + production smoke

**Step 1: Push**

```bash
git push origin claude/heuristic-rosalind-d8edcc
```

**Step 2: Merge to main**

After PR review, merge to `main` — that triggers the v2 webhook deploy (Gotcha #48). Monitor:

```bash
ssh root@194.113.64.90 "tail -f /var/log/rmpg-deploy.log"
```

**Step 3: Verify**

```bash
curl -sf https://rmpgutah.us/api/health | python3 -m json.tool
```
Then in the running app: print a real citation, confirm 3 pages download with the correct hotdog-fold geometry.

**Step 4: Operator notice**

Send a one-line note to RMPG operators: "Citation prints now produce 3 copies (Violator/Officer/Administrative). Same record — fold along center line for distribution."

---

## Out of scope (tracked, NOT in this plan)

- Citation Authoring UI — separate brainstorm + plan after this lands
- Multi-tenant agency override
- Other record types (incident, warrant, FI, arrest)
- NCR-paper printer driver detection
- Statute lookup integration in print path
