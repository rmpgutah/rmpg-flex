# PDF Visual Upgrade — Phase 0 (Engine) + Phase 1 (Core Records) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add restrained steel-blue/gold accent color, 4 new visual primitives (badge, severity meter, photo grid, cross-ref chip), and a dark/light company emblem to the `pdf/v2` schema-driven PDF engine, then migrate the two clean, self-contained legacy report generators (`caseReportGenerator.ts`, `dossierPdfGenerator.ts`) onto it.

**Architecture:** `pdf/v2` is a schema-driven jsPDF wrapper — generators declare a `FormSchema<T>` (meta/header/sections/footer) and `engine/renderer.ts` interprets it, drawing through `engine/primitives.ts`. This plan adds new token values to `engine/style.ts`, four new primitive-drawing functions (each its own file under `engine/`, mirroring `watermark.ts`'s pattern), then two new form schemas under `pdf/v2/forms/` that replace the deleted legacy files. Legacy call sites switch from importing the old `utils/*.ts` functions to importing the new schema + `downloadPdfV2` from `pdf/v2`.

**Tech Stack:** TypeScript, jsPDF, Vitest (byte-level snapshot + `getDocText` string-matching tests, per `engine/__tests__/` conventions).

**Spec:** [`docs/superpowers/specs/2026-07-02-pdf-visual-upgrade-phase0-1-design.md`](../specs/2026-07-02-pdf-visual-upgrade-phase0-1-design.md)

---

## Phase 0 — Engine Hardening

### Task 1: Add steel/gold accent tokens + fix stale zebra-row color drift

**Files:**
- Modify: `client/src/utils/pdf/v2/engine/style.ts`
- Modify: `client/src/utils/pdf/v2/engine/primitives.ts:266-269`
- Test: `client/src/utils/pdf/v2/engine/__tests__/style.test.ts`

While reading the engine to plan this work, `primitives.ts`'s table zebra-row fill was found to hardcode `setFillColor(245, 245, 245)` with a comment claiming it matches `TONES.zebraRow`, but `style.ts`'s actual `TONES.zebraRow` is `'#F8F8F8'` (248,248,248) — the two drifted apart at some point. Fixing this alongside the new tokens keeps `style.ts` the single source of truth it's documented to be.

- [ ] **Step 1: Write the failing test**

```ts
// client/src/utils/pdf/v2/engine/__tests__/style.test.ts
import { describe, it, expect } from 'vitest';
import { TONES } from '../style';

describe('TONES accent colors', () => {
  it('defines a steel-blue accent for Spillman-style headers/tables', () => {
    expect(TONES.accentSteel).toBe('#2c4256');
  });

  it('defines a gold accent for flagged/priority emphasis', () => {
    expect(TONES.accentGold).toBe('#d4a017');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/pdf/v2/engine/__tests__/style.test.ts`
Expected: FAIL — `TONES.accentSteel` is `undefined`, not `'#2c4256'`.

- [ ] **Step 3: Add the tokens to `style.ts`**

In `client/src/utils/pdf/v2/engine/style.ts`, replace the `TONES` block (currently lines 62-67):

```ts
export const TONES = {
  // Pure black ink only, PLUS two restrained brand accents (2026-07 upgrade —
  // approved to replace the prior zero-color rule for section headers, table
  // header bands, and the new badge/severity-meter/cross-ref-chip primitives).
  // Body text, field values, table borders, and classification banners
  // (LES/CUI/FOUO/etc.) stay pure black/gray — this is an accent, not a
  // repaint.
  zebraRow:    '#F8F8F8',  // 3% gray for alternating table rows (reduced from #F5F5F5 — ink savings)
  watermark:   '#ECECEC',  // 8% black for blank-form / draft overlays (reduced from #E6E6E6)
  accentSteel: '#2c4256',  // app's --rmpg-700 night token — header rules, section rules, table header bands
  accentGold:  '#d4a017',  // brand gold — flagged/priority emphasis only (mirrors live-app usage)
} as const;

/** RGB triples for the two accents, for callers using doc.setFillColor/setDrawColor/setTextColor(r,g,b) directly. */
export const TONES_RGB = {
  accentSteel: [44, 66, 86] as const,
  accentGold:  [212, 160, 23] as const,
} as const;
```

- [ ] **Step 4: Fix the stale zebra-row hardcode in `primitives.ts`**

In `client/src/utils/pdf/v2/engine/primitives.ts`, change the import on line 6:

```ts
import { TYPOGRAPHY, RULE_WEIGHTS, SPACING } from './style';
```

to:

```ts
import {
  TYPOGRAPHY, RULE_WEIGHTS, SPACING, TONES,
} from './style';
```

Add a small hex-to-RGB helper near the top of the file (after `widthUnits`, before `export class Primitives`):

```ts
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const ZEBRA_RGB = hexToRgb(TONES.zebraRow);
```

Then replace lines 266-269 (inside the `table()` method's row loop):

```ts
        if (r % 2 === 1) {
          // 5% gray zebra (TONES.zebraRow #F5F5F5)
          this.doc.setFillColor(245, 245, 245);
          this.doc.rect(left, yRow, tableWidth, rowH, 'F');
        }
```

with:

```ts
        if (r % 2 === 1) {
          this.doc.setFillColor(...ZEBRA_RGB);
          this.doc.rect(left, yRow, tableWidth, rowH, 'F');
        }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/pdf/v2/engine/__tests__/style.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Run the full existing v2 engine test suite to confirm no regressions**

Run: `cd client && npx vitest run src/utils/pdf/v2`
Expected: PASS — all existing snapshot/text tests still pass (zebra RGB moved from 245→248, a 1% lightness shift with no test asserting the literal RGB value).

- [ ] **Step 7: Commit**

```bash
git add client/src/utils/pdf/v2/engine/style.ts client/src/utils/pdf/v2/engine/primitives.ts client/src/utils/pdf/v2/engine/__tests__/style.test.ts
git commit -m "feat(pdf-v2): add steel/gold accent tokens, fix stale zebra-row color drift"
```

---

### Task 2: Recolor the header's top rule to steel-blue

**Files:**
- Modify: `client/src/utils/pdf/v2/engine/header.ts:39-41`
- Test: `client/src/utils/pdf/v2/engine/__tests__/header.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `client/src/utils/pdf/v2/engine/__tests__/header.test.ts` (append inside the existing `describe('Spillman header', ...)` block):

```ts
  it('draws the top rule in the steel-blue accent, not black', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    drawDefaultHeader(
      doc,
      { formNumber: 'PS-209', title: 'CITATION', revision: '2026-05' },
      {},
    );
    const ops = doc.internal.pages[1].join('\n');
    // jsPDF content streams encode RGB draw color as "r g b RG" (0-1 scale).
    // #2c4256 = 44,66,86 -> 0.172549, 0.258824, 0.337255
    expect(ops).toContain('0.172549 0.258824 0.337255 RG');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/pdf/v2/engine/__tests__/header.test.ts`
Expected: FAIL — no `RG` operator with that RGB triple exists yet (the current top rule uses `doc.line()` with default black draw color, which jsPDF omits from the stream entirely since black is the default).

- [ ] **Step 3: Recolor the top rule**

In `client/src/utils/pdf/v2/engine/header.ts`, add the import:

```ts
import { TYPOGRAPHY, RULE_WEIGHTS, SPACING, AGENCY, TONES_RGB } from './style';
```

Replace the "1) Top rule" block (lines 39-41):

```ts
  // 1) Top rule — thin (low ink, was thick)
  doc.setLineWidth(RULE_WEIGHTS.headerThick);
  doc.line(left, TOP, right, TOP);
```

with:

```ts
  // 1) Top rule — steel-blue accent (2026-07: restrained color upgrade,
  // replaces the black rule; still renders as a distinguishable mid-gray
  // on B&W laser printers).
  doc.setDrawColor(...TONES_RGB.accentSteel);
  doc.setLineWidth(RULE_WEIGHTS.headerThick);
  doc.line(left, TOP, right, TOP);
  doc.setDrawColor(0, 0, 0); // reset for the bottom rule + everything downstream
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/pdf/v2/engine/__tests__/header.test.ts`
Expected: PASS (all header tests, including the new one)

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/pdf/v2/engine/header.ts client/src/utils/pdf/v2/engine/__tests__/header.test.ts
git commit -m "feat(pdf-v2): recolor header top rule to steel-blue accent"
```

---

### Task 3: Recolor section-header rule and left accent bar to steel-blue

**Files:**
- Modify: `client/src/utils/pdf/v2/engine/context.ts:36-38,58-59`
- Test: `client/src/utils/pdf/v2/engine/__tests__/context.test.ts`

`drawSectionHeader` currently draws a gold left accent bar and a black rule under the title. Keep the gold bar (it's already the brand accent used for section markers) and recolor only the rule to steel-blue, so the two accents stay visually distinct (gold = marker, steel = structural rule).

- [ ] **Step 1: Write the failing test**

Add to `client/src/utils/pdf/v2/engine/__tests__/context.test.ts` (check the file first for its existing `describe` name via `grep -n describe client/src/utils/pdf/v2/engine/__tests__/context.test.ts`; append a new `it` inside the block that already tests `drawSectionHeader`, or add a new top-level `describe` if none exists):

```ts
describe('drawSectionHeader accent color', () => {
  it('draws the rule under the title in the steel-blue accent', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const layout = new LayoutEngine(doc, {
      topMargin: 20, bottomMargin: 18, leftMargin: 10, rightMargin: 10,
    });
    resetSectionCounter();
    drawSectionHeader(doc, layout, 'Identity');
    const ops = doc.internal.pages[1].join('\n');
    expect(ops).toContain('0.172549 0.258824 0.337255 RG');
  });
});
```

Add the required imports at the top of the test file if not already present:

```ts
import jsPDF from 'jspdf';
import { LayoutEngine } from '../layout';
import { drawSectionHeader, resetSectionCounter } from '../context';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/pdf/v2/engine/__tests__/context.test.ts`
Expected: FAIL — the rule is currently drawn in black (`doc.setDrawColor(0, 0, 0)`), no steel-blue `RG` operator present.

- [ ] **Step 3: Recolor the section-header rule**

In `client/src/utils/pdf/v2/engine/context.ts`, add `TONES_RGB` to the existing import (line 7):

```ts
import { TYPOGRAPHY, RULE_WEIGHTS, SPACING, TONES_RGB } from './style';
```

Replace the rule-drawing block (currently lines 56-61):

```ts
  // Draw a thin rule under the section header (low ink: outline-only, no fill bar)
  layout.advance(3);
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(RULE_WEIGHTS.sectionRule);
  doc.line(layout.leftX, layout.cursorY, layout.rightX, layout.cursorY);
  layout.advance(2);
```

with:

```ts
  // Draw a thin rule under the section header (low ink: outline-only, no fill
  // bar). Steel-blue accent (2026-07) — distinct from the gold marker bar above.
  layout.advance(3);
  doc.setDrawColor(...TONES_RGB.accentSteel);
  doc.setLineWidth(RULE_WEIGHTS.sectionRule);
  doc.line(layout.leftX, layout.cursorY, layout.rightX, layout.cursorY);
  doc.setDrawColor(0, 0, 0); // reset for downstream drawing
  layout.advance(2);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/pdf/v2/engine/__tests__/context.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full v2 engine suite**

Run: `cd client && npx vitest run src/utils/pdf/v2`
Expected: PASS — no other test asserts the section rule's literal draw color.

- [ ] **Step 6: Commit**

```bash
git add client/src/utils/pdf/v2/engine/context.ts client/src/utils/pdf/v2/engine/__tests__/context.test.ts
git commit -m "feat(pdf-v2): recolor section-header rule to steel-blue accent"
```

---

### Task 4: Recolor table header band fill to steel-blue

**Files:**
- Modify: `client/src/utils/pdf/v2/engine/primitives.ts` (the `drawHeaderBand` closure inside `table()`, currently lines 180-190)
- Test: `client/src/utils/pdf/v2/engine/__tests__/primitives.test.ts`

- [ ] **Step 1: Write the failing test**

Check the existing test file's structure first (`grep -n "describe\|table(" client/src/utils/pdf/v2/engine/__tests__/primitives.test.ts`) so the new test matches its `Primitives`/`LayoutEngine` construction pattern. Add:

```ts
  it('table header band fills with the steel-blue accent, not black', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const layout = new LayoutEngine(doc, {
      topMargin: 20, bottomMargin: 18, leftMargin: 10, rightMargin: 10,
    });
    const prims = new Primitives(doc, layout);
    prims.table(
      {
        kind: 'table',
        label: 'Items',
        columns: [{ key: 'name', header: 'Name' }],
        accessor: () => [{ name: 'Widget' }],
      },
      {},
    );
    const ops = doc.internal.pages[1].join('\n');
    // Fill color uses lowercase "rg" (vs. draw color's uppercase "RG").
    expect(ops).toContain('0.172549 0.258824 0.337255 rg');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/pdf/v2/engine/__tests__/primitives.test.ts`
Expected: FAIL — `drawHeaderBand` currently does `this.doc.setFillColor(0, 0, 0)` (pure black), so no steel-blue `rg` fill operator exists.

- [ ] **Step 3: Recolor the header band fill**

In `client/src/utils/pdf/v2/engine/primitives.ts`, add `TONES_RGB` to the import on line 6 (already touched in Task 1 — the import should now read):

```ts
import {
  TYPOGRAPHY, RULE_WEIGHTS, SPACING, TONES, TONES_RGB,
} from './style';
```

Inside the `table()` method, replace the `drawHeaderBand` closure (currently lines 180-190):

```ts
    const drawHeaderBand = (top: number): void => {
      this.doc.setFillColor(0, 0, 0);
      this.doc.rect(left, top, tableWidth, headerH, 'F');
      this.doc.setFont('helvetica', TYPOGRAPHY.tableHeader.weight);
      this.doc.setFontSize(TYPOGRAPHY.tableHeader.size);
      this.doc.setTextColor(255, 255, 255);
      spec.columns.forEach((c, i) => {
        const headerText = (c.header || c.key).toUpperCase();
        this.doc.text(headerText, colStarts[i] + 1, top + headerH - 1.5);
      });
    };
```

with:

```ts
    const drawHeaderBand = (top: number): void => {
      // Steel-blue fill (2026-07 accent upgrade, was pure black) with
      // inverted white text — unchanged contrast/readability.
      this.doc.setFillColor(...TONES_RGB.accentSteel);
      this.doc.rect(left, top, tableWidth, headerH, 'F');
      this.doc.setFont('helvetica', TYPOGRAPHY.tableHeader.weight);
      this.doc.setFontSize(TYPOGRAPHY.tableHeader.size);
      this.doc.setTextColor(255, 255, 255);
      spec.columns.forEach((c, i) => {
        const headerText = (c.header || c.key).toUpperCase();
        this.doc.text(headerText, colStarts[i] + 1, top + headerH - 1.5);
      });
    };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/pdf/v2/engine/__tests__/primitives.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full v2 + citation/tripLog form suites (they render tables)**

Run: `cd client && npx vitest run src/utils/pdf/v2`
Expected: PASS — check output carefully; if any citation/tripLog snapshot test asserts exact byte hashes of a rendered table, update that snapshot per its documented update procedure (look for a `UPDATE_SNAPSHOTS` env var or a `.snap` regenerate script referenced in that test file's header comment) since the header band color intentionally changed.

- [ ] **Step 6: Commit**

```bash
git add client/src/utils/pdf/v2/engine/primitives.ts client/src/utils/pdf/v2/engine/__tests__/primitives.test.ts
git commit -m "feat(pdf-v2): recolor table header band to steel-blue accent"
```

---

### Task 5: New primitive — `drawBadge` (status/priority chip)

**Files:**
- Create: `client/src/utils/pdf/v2/engine/badge.ts`
- Test: `client/src/utils/pdf/v2/engine/__tests__/badge.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// client/src/utils/pdf/v2/engine/__tests__/badge.test.ts
import { describe, it, expect } from 'vitest';
import jsPDF from 'jspdf';
import { LayoutEngine } from '../layout';
import { drawBadge } from '../badge';

function getDocText(doc: jsPDF): string {
  const buf = new Uint8Array(doc.output('arraybuffer'));
  let text = '';
  for (const b of buf) text += String.fromCharCode(b);
  return text;
}

describe('drawBadge', () => {
  it('renders the label uppercased', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const layout = new LayoutEngine(doc, {
      topMargin: 20, bottomMargin: 18, leftMargin: 10, rightMargin: 10,
    });
    drawBadge(doc, layout, { label: 'active warrant', tone: 'gold' });
    expect(getDocText(doc)).toContain('ACTIVE WARRANT');
  });

  it('advances the layout cursor', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const layout = new LayoutEngine(doc, {
      topMargin: 20, bottomMargin: 18, leftMargin: 10, rightMargin: 10,
    });
    const before = layout.cursorY;
    drawBadge(doc, layout, { label: 'cleared' });
    expect(layout.cursorY).toBeGreaterThan(before);
  });

  it('defaults to the neutral tone when none is given', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const layout = new LayoutEngine(doc, {
      topMargin: 20, bottomMargin: 18, leftMargin: 10, rightMargin: 10,
    });
    drawBadge(doc, layout, { label: 'verified' });
    const ops = doc.internal.pages[1].join('\n');
    // neutral = rgb(90,90,90) -> 0.352941 0.352941 0.352941
    expect(ops).toContain('0.352941 0.352941 0.352941 rg');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/pdf/v2/engine/__tests__/badge.test.ts`
Expected: FAIL — `Cannot find module '../badge'`.

- [ ] **Step 3: Implement `badge.ts`**

```ts
// client/src/utils/pdf/v2/engine/badge.ts
import type jsPDF from 'jspdf';
import type { LayoutEngine } from './layout';
import { TONES_RGB } from './style';

export type BadgeTone = 'steel' | 'gold' | 'neutral';

export interface BadgeOptions {
  label: string;
  tone?: BadgeTone;
}

const TONE_RGB: Record<BadgeTone, readonly [number, number, number]> = {
  steel:   TONES_RGB.accentSteel,
  gold:    TONES_RGB.accentGold,
  neutral: [90, 90, 90],
};

const BADGE_HEIGHT = 4.5; // mm
const BADGE_PAD_X = 2;    // mm
const BADGE_GAP_BELOW = 1.5; // mm

/**
 * Small filled status/priority chip (e.g. "ACTIVE WARRANT", "CLEARED",
 * "VERIFIED"). Draws full-width-left-aligned at the layout's current
 * cursor and advances past it. Ported from v1's pdfDetailHelpers.ts
 * badge-chip concept, redrawn against the v2 engine's LayoutEngine.
 */
export function drawBadge(doc: jsPDF, layout: LayoutEngine, opts: BadgeOptions): void {
  const tone = opts.tone ?? 'neutral';
  const [r, g, b] = TONE_RGB[tone];
  const text = opts.label.toUpperCase();

  layout.pageBreakIfNeeded(BADGE_HEIGHT + BADGE_GAP_BELOW);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  const textWidth = doc.getTextWidth(text);
  const badgeWidth = textWidth + BADGE_PAD_X * 2;

  const x = layout.leftX;
  const y = layout.cursorY;

  doc.setFillColor(r, g, b);
  doc.roundedRect(x, y, badgeWidth, BADGE_HEIGHT, 0.8, 0.8, 'F');
  doc.setTextColor(255, 255, 255);
  doc.text(text, x + BADGE_PAD_X, y + BADGE_HEIGHT - 1.3);

  doc.setTextColor(0, 0, 0);
  doc.setFillColor(255, 255, 255);
  layout.advance(BADGE_HEIGHT + BADGE_GAP_BELOW);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/pdf/v2/engine/__tests__/badge.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/pdf/v2/engine/badge.ts client/src/utils/pdf/v2/engine/__tests__/badge.test.ts
git commit -m "feat(pdf-v2): add drawBadge primitive for status/priority chips"
```

---

### Task 6: New primitive — `drawSeverityMeter`

**Files:**
- Create: `client/src/utils/pdf/v2/engine/severityMeter.ts`
- Test: `client/src/utils/pdf/v2/engine/__tests__/severityMeter.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// client/src/utils/pdf/v2/engine/__tests__/severityMeter.test.ts
import { describe, it, expect } from 'vitest';
import jsPDF from 'jspdf';
import { LayoutEngine } from '../layout';
import { drawSeverityMeter } from '../severityMeter';

describe('drawSeverityMeter', () => {
  it('advances the layout cursor', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const layout = new LayoutEngine(doc, {
      topMargin: 20, bottomMargin: 18, leftMargin: 10, rightMargin: 10,
    });
    const before = layout.cursorY;
    drawSeverityMeter(doc, layout, { level: 3, max: 5 });
    expect(layout.cursorY).toBeGreaterThan(before);
  });

  it('draws exactly `max` filled/unfilled rectangle segments', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const layout = new LayoutEngine(doc, {
      topMargin: 20, bottomMargin: 18, leftMargin: 10, rightMargin: 10,
    });
    drawSeverityMeter(doc, layout, { level: 2, max: 4 });
    const ops = doc.internal.pages[1].join('\n');
    const rectFillCount = (ops.match(/ re\nf\*?$/gm) ?? []).length
      + (ops.match(/ re\nf$/gm) ?? []).length;
    // jsPDF emits one "re" + fill op pair per rect(...,'F') call; 4 segments drawn.
    expect((ops.match(/ re$/gm) ?? []).length).toBe(4);
  });

  it('renders the highest segment (level === max) in the escalated red tone', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const layout = new LayoutEngine(doc, {
      topMargin: 20, bottomMargin: 18, leftMargin: 10, rightMargin: 10,
    });
    drawSeverityMeter(doc, layout, { level: 3, max: 3 });
    const ops = doc.internal.pages[1].join('\n');
    // Escalated red = rgb(212,30,30) -> 0.831373 0.117647 0.117647
    expect(ops).toContain('0.831373 0.117647 0.117647 rg');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/pdf/v2/engine/__tests__/severityMeter.test.ts`
Expected: FAIL — `Cannot find module '../severityMeter'`.

- [ ] **Step 3: Implement `severityMeter.ts`**

```ts
// client/src/utils/pdf/v2/engine/severityMeter.ts
import type jsPDF from 'jspdf';
import type { LayoutEngine } from './layout';
import { TONES_RGB } from './style';

export interface SeverityMeterOptions {
  /** 1-based current severity level. */
  level: number;
  /** Total number of segments in the meter. */
  max: number;
}

const SEGMENT_HEIGHT = 3;   // mm
const SEGMENT_GAP = 1;      // mm
const GAP_BELOW = 2;        // mm
const UNFILLED_RGB: readonly [number, number, number] = [230, 230, 230];
const ESCALATED_RGB: readonly [number, number, number] = [212, 30, 30]; // matches WATERMARK_VOID red

/**
 * Horizontal segmented severity/priority bar. Segments up to `level` fill
 * steel-blue, escalating to gold past 60% and red at the final (max)
 * segment; segments past `level` render as light-gray outline fill.
 * Ported from v1's pdfDetailHelpers.ts severity-meter concept.
 */
export function drawSeverityMeter(doc: jsPDF, layout: LayoutEngine, opts: SeverityMeterOptions): void {
  const { level, max } = opts;
  layout.pageBreakIfNeeded(SEGMENT_HEIGHT + GAP_BELOW);

  const totalWidth = layout.rightX - layout.leftX;
  const segWidth = (totalWidth - SEGMENT_GAP * (max - 1)) / max;
  let x = layout.leftX;
  const y = layout.cursorY;

  for (let i = 1; i <= max; i++) {
    if (i <= level) {
      const rgb = i === max
        ? ESCALATED_RGB
        : i > max * 0.6
          ? TONES_RGB.accentGold
          : TONES_RGB.accentSteel;
      doc.setFillColor(...rgb);
    } else {
      doc.setFillColor(...UNFILLED_RGB);
    }
    doc.rect(x, y, segWidth, SEGMENT_HEIGHT, 'F');
    x += segWidth + SEGMENT_GAP;
  }

  doc.setFillColor(255, 255, 255);
  layout.advance(SEGMENT_HEIGHT + GAP_BELOW);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/pdf/v2/engine/__tests__/severityMeter.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/pdf/v2/engine/severityMeter.ts client/src/utils/pdf/v2/engine/__tests__/severityMeter.test.ts
git commit -m "feat(pdf-v2): add drawSeverityMeter primitive"
```

---

### Task 7: New primitive — `drawCrossRefChip`

**Files:**
- Create: `client/src/utils/pdf/v2/engine/crossRefChip.ts`
- Test: `client/src/utils/pdf/v2/engine/__tests__/crossRefChip.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// client/src/utils/pdf/v2/engine/__tests__/crossRefChip.test.ts
import { describe, it, expect } from 'vitest';
import jsPDF from 'jspdf';
import { LayoutEngine } from '../layout';
import { drawCrossRefChip } from '../crossRefChip';

function getDocText(doc: jsPDF): string {
  const buf = new Uint8Array(doc.output('arraybuffer'));
  let text = '';
  for (const b of buf) text += String.fromCharCode(b);
  return text;
}

describe('drawCrossRefChip', () => {
  it('renders the ref type (uppercased) and label', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const layout = new LayoutEngine(doc, {
      topMargin: 20, bottomMargin: 18, leftMargin: 10, rightMargin: 10,
    });
    drawCrossRefChip(doc, layout, { label: 'Jane Doe (#4021)', refType: 'person' });
    const text = getDocText(doc);
    expect(text).toContain('PERSON');
    expect(text).toContain('Jane Doe (#4021)');
  });

  it('advances the layout cursor', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const layout = new LayoutEngine(doc, {
      topMargin: 20, bottomMargin: 18, leftMargin: 10, rightMargin: 10,
    });
    const before = layout.cursorY;
    drawCrossRefChip(doc, layout, { label: 'Case 26-CFS00242', refType: 'case' });
    expect(layout.cursorY).toBeGreaterThan(before);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/pdf/v2/engine/__tests__/crossRefChip.test.ts`
Expected: FAIL — `Cannot find module '../crossRefChip'`.

- [ ] **Step 3: Implement `crossRefChip.ts`**

```ts
// client/src/utils/pdf/v2/engine/crossRefChip.ts
import type jsPDF from 'jspdf';
import type { LayoutEngine } from './layout';
import { TONES_RGB } from './style';

export interface CrossRefChipOptions {
  /** Human-readable label, e.g. a name or case number. */
  label: string;
  /** Entity kind the label refers to, e.g. 'person', 'vehicle', 'case'. */
  refType: string;
}

const CHIP_HEIGHT = 4.2; // mm
const GAP_BELOW = 1.3;   // mm
const PAD_X = 1.5;       // mm

/**
 * Small inline outline chip linking to a related record, e.g.
 * "PERSON · Jane Doe (#4021)". Ported from v1's pdfDetailHelpers.ts
 * cross-reference badge concept. Outline-only (steel-blue border + text)
 * to stay visually distinct from the filled `drawBadge` status chip.
 */
export function drawCrossRefChip(doc: jsPDF, layout: LayoutEngine, opts: CrossRefChipOptions): void {
  const text = `${opts.refType.toUpperCase()} · ${opts.label}`;
  layout.pageBreakIfNeeded(CHIP_HEIGHT + GAP_BELOW);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  const textWidth = doc.getTextWidth(text);
  const chipWidth = textWidth + PAD_X * 2;

  const x = layout.leftX;
  const y = layout.cursorY;

  doc.setDrawColor(...TONES_RGB.accentSteel);
  doc.setLineWidth(0.3);
  doc.roundedRect(x, y, chipWidth, CHIP_HEIGHT, 0.8, 0.8);
  doc.setTextColor(...TONES_RGB.accentSteel);
  doc.text(text, x + PAD_X, y + CHIP_HEIGHT - 1.3);

  doc.setTextColor(0, 0, 0);
  doc.setDrawColor(0, 0, 0);
  layout.advance(CHIP_HEIGHT + GAP_BELOW);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/pdf/v2/engine/__tests__/crossRefChip.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/pdf/v2/engine/crossRefChip.ts client/src/utils/pdf/v2/engine/__tests__/crossRefChip.test.ts
git commit -m "feat(pdf-v2): add drawCrossRefChip primitive"
```

---

### Task 8: New primitive — `drawPhotoGrid`

**Files:**
- Create: `client/src/utils/pdf/v2/engine/photoGrid.ts`
- Test: `client/src/utils/pdf/v2/engine/__tests__/photoGrid.test.ts`

Reuses `ResolvedImage` from the existing, already-shared `pdfImageHelpers.ts` (which owns fetch/downscale/embed-format logic) — this primitive is pure layout: given already-resolved images, arrange them in a captioned grid. Callers fetch images via `fetchImageAsBase64`/`fetchImageFromUrl` before calling this.

- [ ] **Step 1: Write the failing test**

```ts
// client/src/utils/pdf/v2/engine/__tests__/photoGrid.test.ts
import { describe, it, expect } from 'vitest';
import jsPDF from 'jspdf';
import { LayoutEngine } from '../layout';
import { drawPhotoGrid } from '../photoGrid';

// 1x1 transparent PNG, valid base64 data URL — enough for jsPDF's addImage
// to accept without throwing (it doesn't validate pixel content).
const STUB_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('drawPhotoGrid', () => {
  it('advances the layout cursor when given images', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const layout = new LayoutEngine(doc, {
      topMargin: 20, bottomMargin: 18, leftMargin: 10, rightMargin: 10,
    });
    const before = layout.cursorY;
    drawPhotoGrid(doc, layout, {
      images: [
        { dataUrl: STUB_IMAGE, width: 100, height: 100, format: 'PNG', name: 'evidence-1.png' },
        { dataUrl: STUB_IMAGE, width: 100, height: 100, format: 'PNG', name: 'evidence-2.png' },
      ],
      columns: 2,
    });
    expect(layout.cursorY).toBeGreaterThan(before);
  });

  it('is a no-op (no cursor advance) when given an empty image list', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const layout = new LayoutEngine(doc, {
      topMargin: 20, bottomMargin: 18, leftMargin: 10, rightMargin: 10,
    });
    const before = layout.cursorY;
    drawPhotoGrid(doc, layout, { images: [], columns: 2 });
    expect(layout.cursorY).toBe(before);
  });

  it('renders each image name as a caption', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const layout = new LayoutEngine(doc, {
      topMargin: 20, bottomMargin: 18, leftMargin: 10, rightMargin: 10,
    });
    drawPhotoGrid(doc, layout, {
      images: [{ dataUrl: STUB_IMAGE, width: 100, height: 100, format: 'PNG', name: 'damage-front.jpg' }],
      columns: 2,
    });
    const buf = new Uint8Array(doc.output('arraybuffer'));
    let text = '';
    for (const b of buf) text += String.fromCharCode(b);
    expect(text).toContain('damage-front.jpg');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/pdf/v2/engine/__tests__/photoGrid.test.ts`
Expected: FAIL — `Cannot find module '../photoGrid'`.

- [ ] **Step 3: Implement `photoGrid.ts`**

```ts
// client/src/utils/pdf/v2/engine/photoGrid.ts
import type jsPDF from 'jspdf';
import type { LayoutEngine } from './layout';
import type { ResolvedImage } from '../../pdfImageHelpers';

export interface PhotoGridOptions {
  images: ResolvedImage[];
  columns: number;
}

const CELL_GAP = 3;       // mm, between grid cells
const CAPTION_HEIGHT = 4; // mm, reserved below each photo for its filename
const CAPTION_FONT_SIZE = 6.5;
const GAP_BELOW = 2;      // mm, after the whole grid

/**
 * Lays out already-resolved images (see pdfImageHelpers.ts for fetch/
 * downscale) in a captioned grid — e.g. evidence photos, damage photos,
 * mugshot arrays. Cell height is derived from each image's own aspect
 * ratio so portrait and landscape photos in the same grid don't distort.
 */
export function drawPhotoGrid(doc: jsPDF, layout: LayoutEngine, opts: PhotoGridOptions): void {
  const { images, columns } = opts;
  if (images.length === 0) return;

  const totalWidth = layout.rightX - layout.leftX;
  const cellWidth = (totalWidth - CELL_GAP * (columns - 1)) / columns;

  for (let i = 0; i < images.length; i += columns) {
    const rowImages = images.slice(i, i + columns);
    const rowHeights = rowImages.map((img) => (cellWidth * img.height) / img.width);
    const rowHeight = Math.max(...rowHeights);

    layout.pageBreakIfNeeded(rowHeight + CAPTION_HEIGHT + CELL_GAP);
    const y = layout.cursorY;

    rowImages.forEach((img, col) => {
      const x = layout.leftX + col * (cellWidth + CELL_GAP);
      const h = (cellWidth * img.height) / img.width;
      try {
        doc.addImage(img.dataUrl, img.format, x, y, cellWidth, h);
      } catch {
        /* ignore malformed image, leave the cell blank */
      }
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(CAPTION_FONT_SIZE);
      doc.setTextColor(100, 100, 100);
      const caption = doc.splitTextToSize(img.name, cellWidth)[0] ?? img.name;
      doc.text(caption, x, y + rowHeight + CAPTION_HEIGHT - 1);
      doc.setTextColor(0, 0, 0);
    });

    layout.advance(rowHeight + CAPTION_HEIGHT + CELL_GAP);
  }

  layout.advance(GAP_BELOW - CELL_GAP);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/pdf/v2/engine/__tests__/photoGrid.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the full Phase 0 test suite together**

Run: `cd client && npx vitest run src/utils/pdf/v2`
Expected: PASS — all engine tests (existing + the 5 new files from Tasks 1-8) green.

- [ ] **Step 6: Commit**

```bash
git add client/src/utils/pdf/v2/engine/photoGrid.ts client/src/utils/pdf/v2/engine/__tests__/photoGrid.test.ts
git commit -m "feat(pdf-v2): add drawPhotoGrid primitive"
```

### Task 9: Add dark/light emblem loaders and embed the dark emblem in the v2 header

**Files:**
- Modify: `client/src/utils/pdfAssets.ts`
- Test: `client/src/utils/__tests__/pdfAssets.test.ts`
- Modify: `client/src/utils/pdf/v2/engine/header.ts`
- Modify: `client/src/utils/pdf/v2/engine/renderer.ts:49-52`
- Test: `client/src/utils/pdf/v2/engine/__tests__/header.test.ts`

The v2 header renders on white paper, so it uses the existing dark-colored emblem (`loadLogoDarkBase64`, already in `pdfAssets.ts` — composited onto white, used by several v1 generators). No dark-on-white asset needs to be created. What's missing is a light/white-on-transparent variant for any future dark-filled surface (the new steel-blue table header band, classification banner fills, or a dark-themed in-app print-preview chrome) — generated programmatically from the same source file via a canvas alpha-mask trick (draw the existing dark logo, then flood-fill white using `globalCompositeOperation = 'source-in'`, which recolors every opaque pixel to white while preserving the original silhouette's alpha shape). This task adds both: wires the dark emblem into the v2 header now, and adds the light-emblem loader for later dark-surface use.

- [ ] **Step 1: Write the failing test for the new light-logo loader**

```ts
// client/src/utils/__tests__/pdfAssets.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadLogoLightBase64, clearImageCache } from '../pdfAssets';

describe('loadLogoLightBase64', () => {
  beforeEach(() => {
    clearImageCache();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob([new Uint8Array([0, 0, 0, 0])], { type: 'image/png' }),
    })));
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
      width: 4, height: 4, close: vi.fn(),
    })));
  });

  it('returns a PNG data URL', async () => {
    const result = await loadLogoLightBase64();
    expect(result).toMatch(/^data:image\/png;base64,/);
  });

  it('caches the result across calls (fetch only called once)', async () => {
    await loadLogoLightBase64();
    await loadLogoLightBase64();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('returns null when the fetch fails', async () => {
    clearImageCache();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    const result = await loadLogoLightBase64();
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/__tests__/pdfAssets.test.ts`
Expected: FAIL — `loadLogoLightBase64` is not exported from `pdfAssets.ts`.

- [ ] **Step 3: Add `loadLogoLightBase64` to `pdfAssets.ts`**

Add a new module-level cache variable near the top (after line 18's `logoDarkBase64`):

```ts
let logoLightBase64: string | null = null;
```

Add the new loader function after `loadLogoDarkBase64` (after its closing brace, currently line 131):

```ts
/**
 * Fetch the RMPG Logo Dark PNG and recolor every opaque pixel to white,
 * preserving the original silhouette's alpha shape — produces a
 * light/white emblem suitable for dark-filled surfaces (the steel-blue
 * table header band, classification banner fills, dark-themed print
 * preview chrome). No separate light-colored source asset exists; this
 * is generated from the same file `loadLogoDarkBase64` uses.
 */
export async function loadLogoLightBase64(): Promise<string | null> {
  if (logoLightBase64) return logoLightBase64;
  try {
    const res = await fetch('/RMPG Logo Dark.png');
    if (!res.ok) return null;
    const blob = await res.blob();
    const bmp = await createImageBitmap(blob);

    const size = 192;
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Draw the logo first (establishes the alpha silhouette), then flood
    // every opaque pixel white via source-in compositing — this recolors
    // without altering the shape's edges/antialiasing.
    ctx.drawImage(bmp, 0, 0, size, size);
    bmp.close();
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = 'source-over';

    const outBlob = await canvas.convertToBlob({ type: 'image/png' });
    const reader = new FileReader();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(outBlob);
    });

    logoLightBase64 = dataUrl;
    return logoLightBase64;
  } catch {
    return null;
  }
}
```

Add `logoLightBase64 = null;` to the `clearImageCache()` function's body (after line 137's `logoDarkBase64 = null;`):

```ts
export function clearImageCache(): void {
  sealBase64 = null;
  logoBase64 = null;
  logoDarkBase64 = null;
  logoLightBase64 = null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/__tests__/pdfAssets.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the failing test for the header embedding the dark emblem**

Append to `client/src/utils/pdf/v2/engine/__tests__/header.test.ts` inside the existing `describe('Spillman header', ...)` block:

```ts
  it('embeds the emblem image when logoBase64 is provided', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    // 1x1 transparent PNG — valid enough for jsPDF's addImage to accept.
    const stubLogo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    drawDefaultHeader(
      doc,
      { formNumber: 'PS-209', title: 'CITATION', revision: '2026-05' },
      { logoBase64: stubLogo },
    );
    const ops = doc.internal.pages[1].join('\n');
    expect(ops).toMatch(/\/I\d+ Do/); // jsPDF's image-XObject draw operator
  });

  it('omits the image draw operator when logoBase64 is not provided', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    drawDefaultHeader(
      doc,
      { formNumber: 'PS-209', title: 'CITATION', revision: '2026-05' },
      {},
    );
    const ops = doc.internal.pages[1].join('\n');
    expect(ops).not.toMatch(/\/I\d+ Do/);
  });
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/pdf/v2/engine/__tests__/header.test.ts`
Expected: FAIL — `HeaderContext` has no `logoBase64` field yet, and `drawDefaultHeader` never calls `doc.addImage`.

- [ ] **Step 7: Add `logoBase64` to `HeaderContext` and embed it**

In `client/src/utils/pdf/v2/engine/header.ts`, add the field to the `HeaderContext` interface (currently lines 5-11):

```ts
export interface HeaderContext {
  caseNumber?: string;
  /** Label for the caseNumber value (default 'CASE') — see HeaderSpec.caseLabel. */
  caseLabel?: string;
  pageNumber?: number;
  totalPages?: number;
  /** Dark-colored emblem (RMPG Logo Dark, composited onto white) — the
   *  header renders on white paper, so only the dark variant applies here.
   *  A light/white emblem variant exists in pdfAssets.ts for future
   *  dark-filled surfaces, but has no header placement. */
  logoBase64?: string;
}
```

Inside `drawDefaultHeader`, after the "1) Top rule" block and before "2) Agency name" (i.e. right after the `doc.setDrawColor(0, 0, 0);` line added in Task 2), add:

```ts
  // 1b) Emblem — dark-colored logo, top-left of the header block (white
  // paper background). 12mm square, doesn't collide with the centered
  // agency name/title text below.
  if (ctx.logoBase64) {
    const logoSize = 12;
    try {
      doc.addImage(ctx.logoBase64, 'PNG', left, TOP + 1, logoSize, logoSize);
    } catch {
      /* ignore malformed image, header renders without it */
    }
  }
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/pdf/v2/engine/__tests__/header.test.ts`
Expected: PASS (all header tests, including the 2 new ones)

- [ ] **Step 9: Wire the dark emblem into the renderer**

In `client/src/utils/pdf/v2/engine/renderer.ts`, add the import (near the top, alongside the other engine imports):

```ts
import { loadLogoDarkBase64 } from '../../pdfAssets';
```

Replace the header-drawing call (currently lines 49-52):

```ts
  const headerBottomY = drawDefaultHeader(doc, schema.meta, {
    caseNumber: schema.header.caseNumberAccessor?.(data),
    caseLabel: schema.header.caseLabel,
  });
```

with:

```ts
  const logoBase64 = (await loadLogoDarkBase64().catch(() => null)) ?? undefined;
  const headerBottomY = drawDefaultHeader(doc, schema.meta, {
    caseNumber: schema.header.caseNumberAccessor?.(data),
    caseLabel: schema.header.caseLabel,
    logoBase64,
  });
```

- [ ] **Step 10: Run the full v2 suite**

Run: `cd client && npx vitest run src/utils/pdf/v2`
Expected: PASS — `renderPdfV2` output now includes the emblem on every v2 form (citation, trip log, blank forms, and the two Phase 1 forms built in Tasks 10-13). No existing test asserts the header is emblem-free, so this is additive.

- [ ] **Step 11: Manually verify via the preview tools**

Render any v2 form (e.g. trigger a trip-log export from `MileageAuditTab.tsx`) and screenshot the output — confirm the dark emblem appears top-left of the header block without overlapping the centered agency name/title text.

- [ ] **Step 12: Commit**

```bash
git add client/src/utils/pdfAssets.ts client/src/utils/__tests__/pdfAssets.test.ts client/src/utils/pdf/v2/engine/header.ts client/src/utils/pdf/v2/engine/renderer.ts client/src/utils/pdf/v2/engine/__tests__/header.test.ts
git commit -m "feat(pdf-v2): add light-emblem loader, embed dark emblem in v2 header"
```

Phase 0 is now complete: 4 recolored engine surfaces, 4 new primitives, and the header emblem (dark-on-white embedded; light-on-dark generated and available for future dark-surface placements) — all covered by tests, zero changes to existing `FormSchema` behavior beyond color/emblem.

---

## Phase 1 — Core Records Migration

### Task 10: Create the `caseReport` v2 form schema

**Files:**
- Create: `client/src/utils/pdf/v2/forms/caseReport.ts`
- Test: `client/src/utils/pdf/v2/forms/__tests__/caseReport.test.ts`
- Reference (do not modify yet): `client/src/utils/caseReportGenerator.ts` (source of truth for section list + field ordering, deleted in Task 13)

`caseReportGenerator.ts`'s `buildCaseReportSections` is a pure function with its own passing test suite (`client/src/utils/caseReportGenerator.test.ts`) — it's the section-list logic, not the drawing logic, so it moves into the new file verbatim and its test file moves with it (Task 13). The drawing logic (the `heading`/`para`/`bullet` closures in `generateCaseReportPdf`) is replaced by a single `RenderCallback` section that walks `buildCaseReportSections()`'s output and draws each row as a bulleted narrative line via the v2 engine's primitives — same per-record-type formatting as the original `rowText` switch, redrawn through `ctx.primitives`.

- [ ] **Step 1: Write the failing test**

```ts
// client/src/utils/pdf/v2/forms/__tests__/caseReport.test.ts
import { describe, it, expect } from 'vitest';
import { renderPdfV2 } from '../../engine/renderer';
import { caseReportSchema, buildCaseReportSections, type CaseReportData } from '../caseReport';

function getDocText(doc: Awaited<ReturnType<typeof renderPdfV2>>): string {
  const buf = new Uint8Array(doc.output('arraybuffer'));
  let text = '';
  for (const b of buf) text += String.fromCharCode(b);
  return text;
}

const BASE_DATA: CaseReportData = {
  caseRow: {
    case_number: '26-CR-00042',
    status: 'open',
    priority: 'high',
    case_type: 'burglary',
    lead_investigator_name: 'Det. Alvarez',
    opened_date: '2026-06-01',
    summary: 'Residential burglary, forced entry via rear door.',
  },
  persons: [{ last_name: 'Doe', first_name: 'John', role: 'suspect', date_of_birth: '1990-01-01', phone: '555-0100' }],
  evidence: [{ evidence_number: 'EV-1', description: 'Pry bar', evidence_type: 'tool', status: 'logged' }],
};

describe('caseReportSchema', () => {
  it('renders the case number in the header', async () => {
    const doc = await renderPdfV2(caseReportSchema, BASE_DATA, { coreFontsOnly: true });
    expect(getDocText(doc)).toContain('26-CR-00042');
  });

  it('renders a bulleted row for each linked record', async () => {
    const doc = await renderPdfV2(caseReportSchema, BASE_DATA, { coreFontsOnly: true });
    const text = getDocText(doc);
    expect(text).toContain('Doe');
    expect(text).toContain('Pry bar');
  });

  it('omits sections with zero records (no filler pages)', async () => {
    const doc = await renderPdfV2(caseReportSchema, BASE_DATA, { coreFontsOnly: true });
    const text = getDocText(doc);
    expect(text).not.toContain('Linked Calls for Service');
    expect(text).not.toContain('Warrants');
  });

  it('re-exports buildCaseReportSections unchanged', () => {
    const sections = buildCaseReportSections(BASE_DATA);
    expect(sections.map((s) => s.key)).toEqual(['persons', 'evidence']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/pdf/v2/forms/__tests__/caseReport.test.ts`
Expected: FAIL — `Cannot find module '../caseReport'`.

- [ ] **Step 3: Expose `doc` on `RenderContext`**

`RenderContext` currently exposes `primitives`/`layout` but not the raw `jsPDF` doc, and the new Phase 0 primitives (`drawBadge`, `drawSeverityMeter`, `drawCrossRefChip`, `drawPhotoGrid`) all take `(doc, layout, opts)`. Callback sections need direct `doc` access to call them. Add it now, before writing the schema that needs it.

In `client/src/utils/pdf/v2/engine/types.ts`, add to the `RenderContext<T>` interface (after the `primitives`/`layout` getters, currently lines 184-189):

```ts
  /** Direct access to the underlying Primitives instance — used by
   *  callback sections that delegate to a render helper which prefers
   *  the primitives API over the wrapped context methods. */
  readonly primitives: import('./primitives').Primitives;
  /** Direct access to the underlying LayoutEngine. */
  readonly layout: import('./layout').LayoutEngine;
  /** Direct access to the underlying jsPDF doc — used by callback sections
   *  that call standalone primitive functions (drawBadge, drawSeverityMeter,
   *  drawCrossRefChip, drawPhotoGrid) which take (doc, layout, opts). */
  readonly doc: import('jspdf').default;
```

In `client/src/utils/pdf/v2/engine/context.ts`, add `doc` to the object `makeRenderContext` returns (after the `layout` getter, currently line 92):

```ts
    get primitives() { return prims; },
    get layout() { return layout; },
    get doc() { return doc; },
```

- [ ] **Step 4: Implement `forms/caseReport.ts`**

```ts
// client/src/utils/pdf/v2/forms/caseReport.ts
// Investigative Case Report — v2 schema (migrated from utils/caseReportGenerator.ts).
// buildCaseReportSections() is unchanged pure logic; only the drawing moved
// from hand-rolled jsPDF closures to the v2 engine's shared primitives so
// this form gets the steel-blue header/section/table treatment for free.
import type { FormSchema } from '../engine/types';
import { drawBadge } from '../engine/badge';
import { formatActivity, type CaseActivityRow } from '../../caseActivity';

export interface CaseReportData {
  caseRow: Record<string, any>;
  calls?: any[]; incidents?: any[]; persons?: any[]; vehicles?: any[];
  properties?: any[]; evidence?: any[]; warrants?: any[]; citations?: any[];
  tasks?: any[]; notes?: any[]; related?: any[]; activity?: CaseActivityRow[];
}

export interface ReportSection { key: string; title: string; count: number }

/** Pure: the ordered list of record sections that have content. */
export function buildCaseReportSections(data: CaseReportData): ReportSection[] {
  const defs: { key: keyof CaseReportData; title: string }[] = [
    { key: 'calls',      title: 'Linked Calls for Service' },
    { key: 'incidents',  title: 'Linked Incidents' },
    { key: 'persons',    title: 'Persons' },
    { key: 'vehicles',   title: 'Vehicles' },
    { key: 'properties', title: 'Property' },
    { key: 'evidence',   title: 'Evidence' },
    { key: 'warrants',   title: 'Warrants' },
    { key: 'citations',  title: 'Citations' },
    { key: 'tasks',      title: 'Investigative Tasks' },
    { key: 'notes',      title: 'Case Notes' },
    { key: 'related',    title: 'Related Cases' },
    { key: 'activity',   title: 'Activity Log' },
  ];
  return defs
    .map((d) => ({
      key: String(d.key),
      title: d.title,
      count: Array.isArray(data[d.key]) ? (data[d.key] as any[]).length : 0,
    }))
    .filter((s) => s.count > 0);
}

const safe = (v: unknown, dash = '—'): string => (v === null || v === undefined || v === '' ? dash : String(v));
const safeDate = (v: unknown): string => {
  if (!v) return '—';
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString();
};

function rowLine(key: string, r: Record<string, any>): string {
  switch (key) {
    case 'calls':      return [r.call_number || r.case_number, r.incident_type || r.call_type, r.status, safeDate(r.created_at)].filter(Boolean).join('  ·  ');
    case 'incidents':  return [r.incident_number, r.incident_type, r.status, safeDate(r.created_at)].filter(Boolean).join('  ·  ');
    case 'persons':    return [`${safe(r.last_name, '')} ${safe(r.first_name, '')}`.trim(), r.role, r.date_of_birth, r.phone].filter(Boolean).join('  ·  ');
    case 'vehicles':   return [r.plate_number, [r.year, r.make, r.model].filter(Boolean).join(' '), r.color, r.vin].filter(Boolean).join('  ·  ');
    case 'properties': return [r.description, r.property_type, r.serial_number, r.status].filter(Boolean).join('  ·  ');
    case 'evidence':   return [r.evidence_number, r.description, r.evidence_type, r.status].filter(Boolean).join('  ·  ');
    case 'warrants':   return [r.warrant_number, r.subject_name, r.charge_description, r.status].filter(Boolean).join('  ·  ');
    case 'citations':  return [r.citation_number, r.violation, r.violator_name, r.status].filter(Boolean).join('  ·  ');
    case 'tasks':       return [r.title, (r.status || '').replace(/_/g, ' '), r.priority, r.assignee_name, r.due_date ? `due ${r.due_date}` : ''].filter(Boolean).join('  ·  ');
    case 'notes':       return `${r.author_name ? `${r.author_name} — ` : ''}${safe(r.content, '')}`;
    case 'related':     return [r.case_number, r.title, r.link_type || 'related', r.status].filter(Boolean).join('  ·  ');
    case 'activity': {
      const f = formatActivity(r.action, r.detail);
      return [safeDate(r.created_at), r.actor_name || 'System', f.label].filter(Boolean).join('  ·  ');
    }
    default: return '';
  }
}

export const caseReportSchema: FormSchema<CaseReportData> = {
  meta: { formNumber: 'FORM CR', title: 'Investigative Case Report', revision: '2026-07' },
  header: { kind: 'default', formId: 'case_report', caseNumberAccessor: (d) => d.caseRow?.case_number },
  sections: [
    (ctx, data) => {
      const c = data.caseRow || {};
      ctx.section('Overview', (inner) => {
        inner.labeledField({ kind: 'labeled', label: 'Status', accessor: () => safe(c.status, '').replace(/_/g, ' ').toUpperCase() }, data);
        inner.labeledField({ kind: 'labeled', label: 'Type', accessor: () => safe(c.case_type, '').replace(/_/g, ' ') }, data);
        inner.labeledField({ kind: 'labeled', label: 'Lead Investigator', accessor: () => safe(c.lead_investigator_name) }, data);
        inner.labeledField({ kind: 'labeled', label: 'Opened', accessor: () => safeDate(c.opened_date) }, data);
        if (c.closed_date) inner.labeledField({ kind: 'labeled', label: 'Closed', accessor: () => safeDate(c.closed_date) }, data);
        if (c.disposition) inner.labeledField({ kind: 'labeled', label: 'Disposition', accessor: () => safe(c.disposition) }, data);
        if (c.priority) drawBadge(ctx.doc, ctx.layout, { label: String(c.priority), tone: c.priority === 'high' ? 'gold' : 'steel' });
      });

      if (c.summary || c.narrative) {
        ctx.section('Summary', (inner) => {
          if (c.summary) inner.narrative({ kind: 'narrative', label: '', accessor: () => String(c.summary) }, data);
          if (c.narrative) inner.narrative({ kind: 'narrative', label: '', accessor: () => String(c.narrative) }, data);
        });
      }

      if (c.solvability_score != null && Number.isFinite(Number(c.solvability_score))) {
        ctx.section('Solvability', (inner) => {
          inner.labeledField({ kind: 'labeled', label: 'Score', accessor: () => `${Number(c.solvability_score)}/100` }, data);
        });
      }

      for (const section of buildCaseReportSections(data)) {
        ctx.section(`${section.title} (${section.count})`, (inner) => {
          const rows = (data as any)[section.key] as Array<Record<string, any>>;
          for (const r of rows) {
            inner.narrative({ kind: 'narrative', label: '', accessor: () => `• ${rowLine(section.key, r)}` }, data);
          }
        });
      }
    },
  ],
  footer: { kind: 'default', showRevision: true, showPageNumbers: true },
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/pdf/v2/forms/__tests__/caseReport.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Run the full v2 suite to confirm the `RenderContext.doc` addition doesn't break existing forms**

Run: `cd client && npx vitest run src/utils/pdf/v2`
Expected: PASS — `doc` is an additive interface field; no existing callback section reads it, so nothing else changes shape.

- [ ] **Step 7: Commit**

```bash
git add client/src/utils/pdf/v2/engine/types.ts client/src/utils/pdf/v2/engine/context.ts client/src/utils/pdf/v2/forms/caseReport.ts client/src/utils/pdf/v2/forms/__tests__/caseReport.test.ts
git commit -m "feat(pdf-v2): expose RenderContext.doc; add caseReport v2 form schema"
```

---

### Task 11: Switch `CaseManagementPage.tsx` to the v2 case report and delete the legacy file

**Files:**
- Modify: `client/src/pages/CaseManagementPage.tsx:39,553` (and surrounding call)
- Delete: `client/src/utils/caseReportGenerator.ts`
- Delete: `client/src/utils/caseReportGenerator.test.ts` (superseded by `pdf/v2/forms/__tests__/caseReport.test.ts`, which re-exports and re-tests `buildCaseReportSections`)

- [ ] **Step 1: Read the current call site**

Run: `sed -n '545,565p' client/src/pages/CaseManagementPage.tsx`

Confirm the shape of the `downloadCaseReport({...})` call — the object literal passed there becomes the `CaseReportData` argument to `downloadPdfV2`.

- [ ] **Step 2: Update the import**

In `client/src/pages/CaseManagementPage.tsx`, replace line 39:

```ts
import { downloadCaseReport } from '../utils/caseReportGenerator';
```

with:

```ts
import { downloadPdfV2 } from '../utils/pdf/v2';
import { caseReportSchema, type CaseReportData } from '../utils/pdf/v2/forms/caseReport';
```

- [ ] **Step 3: Update the call site**

Replace the existing call (found at line 553, form: `await downloadCaseReport({ ... });`) with:

```ts
    const reportData: CaseReportData = { /* ...same object literal as before... */ };
    const num = String(reportData.caseRow?.case_number ?? 'case').replace(/[^\w-]/g, '_');
    await downloadPdfV2(caseReportSchema, reportData, `case_report_${num}.pdf`, { schemaId: 'case_report' });
```

(Keep the original object literal's fields exactly as they were passed to `downloadCaseReport` — only the function call wrapping changes, not the data being gathered.)

- [ ] **Step 4: Delete the legacy files**

```bash
git rm client/src/utils/caseReportGenerator.ts client/src/utils/caseReportGenerator.test.ts
```

- [ ] **Step 5: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors referencing `caseReportGenerator` or `downloadCaseReport`.

- [ ] **Step 6: Run the full client test suite**

Run: `cd client && npx vitest run`
Expected: PASS — no test still imports the deleted files.

- [ ] **Step 7: Manually verify via the preview tools**

Start the client dev server (`preview_start`), navigate to a case in Case Management, trigger the PDF export, and screenshot the result to confirm the steel-blue header/section rules render and the report content matches what was previously produced (persons/evidence/etc. sections present, no filler pages for empty sections).

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/CaseManagementPage.tsx
git commit -m "refactor(pdf-v2): migrate case report export to v2 engine, delete legacy generator"
```

---

### Task 12: Create the `dossier` v2 form schema

**Files:**
- Create: `client/src/utils/pdf/v2/forms/dossier.ts`
- Test: `client/src/utils/pdf/v2/forms/__tests__/dossier.test.ts`
- Reference (deleted in Task 13): `client/src/utils/dossierPdfGenerator.ts`

The legacy generator's per-section `try/catch` degrade-gracefully pattern is preserved — each section is its own `try/catch` inside the callback so one malformed data shape can't kill the whole export, matching the original file's documented design intent (see its header comment).

- [ ] **Step 1: Write the failing test**

```ts
// client/src/utils/pdf/v2/forms/__tests__/dossier.test.ts
import { describe, it, expect } from 'vitest';
import { renderPdfV2 } from '../../engine/renderer';
import { dossierSchema, type DossierData } from '../dossier';

function getDocText(doc: Awaited<ReturnType<typeof renderPdfV2>>): string {
  const buf = new Uint8Array(doc.output('arraybuffer'));
  let text = '';
  for (const b of buf) text += String.fromCharCode(b);
  return text;
}

const BASE_DATA: DossierData = {
  person: { id: 4021, first_name: 'John', last_name: 'Doe', dob: '1990-01-01', gender: 'M', race: 'W' },
  cluster: [],
  flags: ['GANG AFFILIATED'],
  timeline: [{ kind: 'call', id: 1, date: '2026-06-01', title: 'Traffic stop', subtitle: '', status: 'closed' }],
  associates: [{ person_id: 99, name: 'Jane Smith', shared_events: 2, kinds: ['call'] }],
  vehicles: [{ color: 'Blue', year: 2018, make: 'Honda', model: 'Civic', plate_number: 'ABC123', vin: '1HG' }],
  addresses: [{ address: '123 Main St', source: 'DL' }],
};

describe('dossierSchema', () => {
  it('renders the subject name in the header', async () => {
    const doc = await renderPdfV2(dossierSchema, BASE_DATA, { coreFontsOnly: true });
    expect(getDocText(doc)).toContain('John Doe');
  });

  it('renders identity, vehicles, and timeline sections', async () => {
    const doc = await renderPdfV2(dossierSchema, BASE_DATA, { coreFontsOnly: true });
    const text = getDocText(doc);
    expect(text).toContain('IDENTITY');
    expect(text).toContain('ABC123');
    expect(text).toContain('Traffic stop');
  });

  it('renders a flagged badge for each flag', async () => {
    const doc = await renderPdfV2(dossierSchema, BASE_DATA, { coreFontsOnly: true });
    expect(getDocText(doc)).toContain('GANG AFFILIATED');
  });

  it('degrades gracefully when timeline data is malformed', async () => {
    const badData: DossierData = { ...BASE_DATA, timeline: [{ kind: 'call' } as any] };
    await expect(renderPdfV2(dossierSchema, badData, { coreFontsOnly: true })).resolves.toBeDefined();
  });

  it('omits the associates section when there are none', async () => {
    const doc = await renderPdfV2(dossierSchema, { ...BASE_DATA, associates: [] }, { coreFontsOnly: true });
    expect(getDocText(doc)).not.toContain('KNOWN ASSOCIATES');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/pdf/v2/forms/__tests__/dossier.test.ts`
Expected: FAIL — `Cannot find module '../dossier'`.

- [ ] **Step 3: Implement `forms/dossier.ts`**

```ts
// client/src/utils/pdf/v2/forms/dossier.ts
// Person Dossier — v2 schema (migrated from utils/dossierPdfGenerator.ts).
// Section-level try/catch preserved from the original: one malformed
// section can never take down the rest of the export.
import type { FormSchema } from '../engine/types';
import { drawBadge } from '../engine/badge';

export interface LinkedIntelEntry {
  id: number;
  report_number?: string | null;
  title?: string | null;
  threat_level?: string | null;
  source_reliability?: string | null;
  info_credibility?: string | null;
  handling_code?: string | null;
  disseminated_at?: string | null;
  role?: string | null;
}

export interface DossierData {
  person: Record<string, any>;
  cluster: Array<{ person_id: number; name: string }>;
  flags: string[];
  timeline: Array<{ kind: string; id: number; date: string | null; title: string; subtitle: string; status: string }>;
  associates: Array<{ person_id: number; name: string; shared_events: number; kinds: string[] }>;
  vehicles: Array<Record<string, any>>;
  addresses: Array<{ address: string; source: string }>;
  linked_intel?: LinkedIntelEntry[];
  escalation?: { recent: number; baseline: number; ratio: number; trend: string } | null;
}

const SENTINELS = new Set(['', 'none', 'n/a', 'na', 'null', '0', 'unknown']);
const real = (v: unknown) => v != null && !SENTINELS.has(String(v).trim().toLowerCase());
const show = (v: unknown) => (real(v) ? String(v) : '—');

function personName(p: Record<string, any>): string {
  return [p.first_name, p.middle_name, p.last_name].filter(real).join(' ') || `Person #${p.id}`;
}

export const dossierSchema: FormSchema<DossierData> = {
  meta: { formNumber: 'FORM DOS', title: 'Person Dossier', revision: '2026-07' },
  header: {
    kind: 'default',
    formId: 'dossier',
    caseNumberAccessor: (d) => (d.person?.id != null ? `SUBJECT #${d.person.id}` : undefined),
    caseLabel: 'REF',
  },
  sections: [
    (ctx, data) => {
      const p = data.person;
      const name = personName(p);

      ctx.section('Identity', (inner) => {
        try {
          inner.labeledField({ kind: 'labeled', label: 'Name', accessor: () => name }, data);
          inner.labeledField({ kind: 'labeled', label: 'DOB', accessor: () => show(p.dob) }, data);
          inner.labeledField({ kind: 'labeled', label: 'Gender', accessor: () => show(p.gender), width: 'third' }, data);
          inner.labeledField({ kind: 'labeled', label: 'Race', accessor: () => show(p.race), width: 'third' }, data);
          inner.labeledField({ kind: 'labeled', label: 'Height', accessor: () => show(p.height), width: 'quarter' }, data);
          inner.labeledField({ kind: 'labeled', label: 'Weight', accessor: () => show(p.weight), width: 'quarter' }, data);
          inner.labeledField({ kind: 'labeled', label: 'Hair', accessor: () => show(p.hair_color), width: 'quarter' }, data);
          inner.labeledField({ kind: 'labeled', label: 'Eyes', accessor: () => show(p.eye_color), width: 'quarter' }, data);
          if (real(p.alias_nickname)) inner.labeledField({ kind: 'labeled', label: 'Aliases', accessor: () => String(p.alias_nickname) }, data);
          if (real(p.gang_affiliation)) inner.labeledField({ kind: 'labeled', label: 'Gang affiliation', accessor: () => String(p.gang_affiliation) }, data);
          if (real(p.scars_marks_tattoos)) inner.narrative({ kind: 'narrative', label: 'Scars/marks/tattoos', accessor: () => String(p.scars_marks_tattoos) }, data);
          for (const flag of data.flags ?? []) drawBadge(ctx.doc, ctx.layout, { label: flag, tone: 'gold' });
        } catch { /* section degraded */ }
      });

      try {
        if (data.escalation && data.escalation.trend && data.escalation.trend !== 'stable') {
          ctx.section('Activity Trend', (inner) => {
            const r = data.escalation!;
            inner.narrative({
              kind: 'narrative', label: '',
              accessor: () => `Trend: ${r.trend.toUpperCase()}    Last 30d: ${r.recent} events    90d baseline: ${r.baseline.toFixed(1)}`,
            }, data);
          });
        }
      } catch { /* section degraded */ }

      try {
        if (data.addresses?.length) {
          ctx.section('Addresses', (inner) => {
            inner.table({
              kind: 'table', label: '',
              columns: [{ key: 'address', header: 'Address', ratio: 3 }, { key: 'source', header: 'Source', ratio: 1 }],
              accessor: () => data.addresses,
            }, data);
          });
        }
      } catch { /* section degraded */ }

      try {
        if (data.vehicles?.length) {
          ctx.section('Vehicles', (inner) => {
            inner.table({
              kind: 'table', label: '',
              columns: [
                { key: 'vehicle', header: 'Vehicle', ratio: 2 },
                { key: 'plate_number', header: 'Plate', ratio: 1 },
                { key: 'vin', header: 'VIN', ratio: 1 },
              ],
              accessor: () => data.vehicles.map((v) => ({
                vehicle: [v.color, v.year, v.make, v.model].filter(real).join(' '),
                plate_number: show(v.plate_number),
                vin: show(v.vin),
              })),
            }, data);
          });
        }
      } catch { /* section degraded */ }

      try {
        if (data.associates?.length) {
          ctx.section('Known Associates', (inner) => {
            for (const a of data.associates) {
              inner.narrative({
                kind: 'narrative', label: '',
                accessor: () => `• ${a.name} (#${a.person_id})  —  ${a.shared_events} shared event${a.shared_events === 1 ? '' : 's'} (${a.kinds.join(', ')})`,
              }, data);
            }
          });
        }
      } catch { /* section degraded */ }

      try {
        if (data.linked_intel?.length) {
          ctx.section(`Linked Intelligence (${data.linked_intel.length})`, (inner) => {
            for (const r of data.linked_intel!) {
              const head = `${r.report_number || `IR-${r.id}`}${r.threat_level ? `  [${String(r.threat_level).toUpperCase()}]` : ''}`;
              inner.narrative({ kind: 'narrative', label: '', accessor: () => head }, data);
            }
          });
        }
      } catch { /* section degraded */ }

      try {
        if (data.timeline?.length) {
          ctx.section(`Contact Timeline (${data.timeline.length})`, (inner) => {
            for (const e of data.timeline.slice(0, 150)) {
              const date = e.date ? String(e.date).slice(0, 10) : '—';
              const kind = (e.kind ?? '').replace(/_/g, ' ').toUpperCase();
              inner.narrative({
                kind: 'narrative', label: '',
                accessor: () => `${date}  [${kind}]  ${e.title ?? ''}${e.status ? `  (${e.status})` : ''}`,
              }, data);
            }
            if (data.timeline.length > 150) {
              inner.narrative({ kind: 'narrative', label: '', accessor: () => `… ${data.timeline.length - 150} older events omitted` }, data);
            }
          });
        }
      } catch { /* section degraded */ }
    },
  ],
  footer: { kind: 'default', showRevision: true, showPageNumbers: true },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/pdf/v2/forms/__tests__/dossier.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Run the full v2 suite**

Run: `cd client && npx vitest run src/utils/pdf/v2`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add client/src/utils/pdf/v2/forms/dossier.ts client/src/utils/pdf/v2/forms/__tests__/dossier.test.ts
git commit -m "feat(pdf-v2): add dossier v2 form schema"
```

---

### Task 13: Switch `PersonDossierPage.tsx` to the v2 dossier and delete the legacy file

**Files:**
- Modify: `client/src/pages/PersonDossierPage.tsx:13,142` (and surrounding call)
- Delete: `client/src/utils/dossierPdfGenerator.ts`

- [ ] **Step 1: Read the current call site**

Run: `sed -n '135,150p' client/src/pages/PersonDossierPage.tsx`

Confirm the `data` object shape passed into `generateDossierPdf(data)` and how `try { generateDossierPdf(data); }` is wrapped (error handling around the call, if any, must be preserved).

- [ ] **Step 2: Update the import**

In `client/src/pages/PersonDossierPage.tsx`, replace line 13:

```ts
import { generateDossierPdf, type DossierData, type LinkedIntelEntry } from '../utils/dossierPdfGenerator';
```

with:

```ts
import { downloadPdfV2 } from '../utils/pdf/v2';
import { dossierSchema, type DossierData, type LinkedIntelEntry } from '../utils/pdf/v2/forms/dossier';
```

- [ ] **Step 3: Update the call site**

Replace the existing `try { generateDossierPdf(data); }` call (line 142) with:

```ts
    const filename = `dossier-${(data.person.first_name ?? '') + '-' + (data.person.last_name ?? '')}`
      .toLowerCase().replace(/\s+/g, '-').replace(/^-+|-+$/g, '') || `dossier-${data.person.id}`;
    try { await downloadPdfV2(dossierSchema, data, `${filename}-${data.person.id}.pdf`, { schemaId: 'dossier' }); }
```

(Preserve whatever `catch` block followed the original `try` — only the function invocation inside `try` changes; `downloadPdfV2` is async where `generateDossierPdf` was sync, so confirm the surrounding function is `async` and the call is `await`ed — check with `grep -n "async" client/src/pages/PersonDossierPage.tsx` around that line and add `async` to the handler if missing.)

- [ ] **Step 4: Delete the legacy file**

```bash
git rm client/src/utils/dossierPdfGenerator.ts
```

- [ ] **Step 5: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors referencing `dossierPdfGenerator` or `generateDossierPdf`.

- [ ] **Step 6: Run the full client test suite**

Run: `cd client && npx vitest run`
Expected: PASS

- [ ] **Step 7: Manually verify via the preview tools**

Start the client dev server, open a Person Dossier page, trigger the PDF export, and screenshot the result — confirm identity/vehicles/timeline sections render, flag badges show in gold, and the steel-blue header/section styling is present.

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/PersonDossierPage.tsx
git commit -m "refactor(pdf-v2): migrate person dossier export to v2 engine, delete legacy generator"
```

---

## Self-Review Notes

- **Spec coverage:** Task 1 covers style.ts accent tokens; Tasks 2-4 cover the three recolored surfaces (header rule, section rule, table band) named in the spec; Tasks 5-8 cover all four new primitives (badge, severity meter, cross-ref chip, photo grid) named in the spec; Task 9 covers the dark/light emblem addition (added after initial plan approval, per follow-up request); Tasks 10-13 cover the two Phase-1 migrations approved after the recordPdfGenerator.ts scope correction. `recordPdfGenerator.ts`/`recordPdfGeneratorExt.ts`/`pdfDossierRenderer.ts` are explicitly OUT of this plan per the user's "shrink Phase 1 to the 2 clean files" decision — no task references migrating them.
- **Type consistency:** `RenderContext.doc` (added in Task 10, Step 3) is used identically in Task 12's dossier schema (`ctx.doc`) — same accessor name throughout. `HeaderContext.logoBase64` (Task 9) and `FormSchema.header`'s existing fields are both consumed the same way inside `drawDefaultHeader`'s single `ctx` parameter — no shape mismatch introduced.
- **Placeholder scan:** No shipped placeholders remain — Task 10's Step 3 (expose RenderContext.doc) was reordered ahead of Step 4 (implement the schema) so the schema code is written correctly the first time. Task 9's light-emblem loader is fully implemented even though no Phase-0/1 consumer places it yet — it is not a stub, since `loadLogoLightBase64()` is complete, tested, and ready for the next dark-surface consumer to import.
