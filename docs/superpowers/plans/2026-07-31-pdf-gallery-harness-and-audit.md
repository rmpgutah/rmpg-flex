# PDF Gallery Harness & Audit Corpus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the render-first verification harness for RMPG Flex's ~90 PDF document types and produce a ranked defect catalogue that determines the content of the six repair batches.

**Architecture:** A typed registry enumerates every PDF output type with three synthetic fixture variants each (typical / empty / maximal). A pure, Node-runnable assertion library cracks the generated PDF's text layer via `pdfjs-dist` (no canvas required) to catch correctness defects in CI. A development-only React route rasterizes the same outputs in a real browser with margin guides to catch layout defects that no assertion can see.

**Tech Stack:** TypeScript, React 18, Vite 6, `jspdf@4`, `pdfjs-dist@6`, Vitest 4.

## Global Constraints

- **This plan covers the spec's "First deliverable" only.** Batches 1–6 are not planned here; their content is determined by the catalogue this plan produces. Each batch gets its own plan afterward.
- **No PII.** Every fixture is synthetic. No real person, case, vehicle, client, address, or plate from live data enters the repository. Organization rule, non-negotiable.
- **US units** throughout all fixtures and output (miles, feet, pounds, °F).
- **Company name:** "Rocky Mountain Protective Group" in full; "RMPG" only where space genuinely forbids it.
- **The dev route must never reach production.** Gated on `import.meta.env.DEV` so Vite tree-shakes it from the production bundle.
- **Do not migrate anything to the v2 engine and do not un-park `facade.ts`.** Forms currently on v2 stay on v2.
- **Never hardcode hex** in app code. (Harness *chrome* — margin guides, rulers — is dev-only and exempt; it never ships.)
- **Run root and client vitest suites serially, never concurrently** — concurrent runs fabricate ~9 phantom failures.
- Working directory for all client commands: `client/`.

---

### Task 1: PDF text-layer assertion library

The correctness lens, made automatable. Pure functions, no React, no canvas.

**Files:**
- Create: `client/src/utils/pdf/audit/textLayer.ts`
- Test: `client/src/utils/pdf/audit/__tests__/textLayer.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `extractPdfText(doc: jsPDF): Promise<string[]>` — one string per page.
  - `PLACEHOLDER_LEAK_PATTERN: RegExp` — matches `undefined`, `NaN`, `null`, `Invalid Date`, `[object Object]`.
  - `findPlaceholderLeaks(pages: string[]): PlaceholderLeak[]` where `interface PlaceholderLeak { page: number; token: string; context: string }`.
  - `expectNoPlaceholderLeaks(doc: jsPDF): Promise<void>` — throws with a readable report listing page, token, and surrounding text.

- [ ] **Step 1: Write the failing test**

```ts
// client/src/utils/pdf/audit/__tests__/textLayer.test.ts
import { describe, it, expect } from 'vitest';
import { jsPDF } from 'jspdf';
import {
  extractPdfText,
  findPlaceholderLeaks,
  expectNoPlaceholderLeaks,
} from '../textLayer';

function docWith(lines: string[]): jsPDF {
  const doc = new jsPDF();
  lines.forEach((line, i) => doc.text(line, 20, 20 + i * 10));
  return doc;
}

describe('extractPdfText', () => {
  it('returns one entry per page', async () => {
    const doc = docWith(['Page one text']);
    doc.addPage();
    doc.text('Page two text', 20, 20);
    const pages = await extractPdfText(doc);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toContain('Page one text');
    expect(pages[1]).toContain('Page two text');
  });
});

describe('findPlaceholderLeaks', () => {
  it('finds undefined, NaN, null, Invalid Date and [object Object]', () => {
    const leaks = findPlaceholderLeaks([
      'Officer: undefined',
      'Mileage: NaN miles',
      'Supervisor: null',
      'Served: Invalid Date',
      'Vehicle: [object Object]',
    ]);
    expect(leaks.map((l) => l.token).sort()).toEqual(
      ['[object Object]', 'Invalid Date', 'NaN', 'null', 'undefined'].sort(),
    );
    expect(leaks[0].page).toBe(1);
  });

  it('does not flag legitimate words containing the tokens', () => {
    const leaks = findPlaceholderLeaks([
      'Annulled by court order',
      'Nullification hearing scheduled',
      'The undefinedness doctrine',
    ]);
    expect(leaks).toEqual([]);
  });

  it('returns surrounding context for each leak', () => {
    const leaks = findPlaceholderLeaks(['Issuing officer: undefined, badge 4417']);
    expect(leaks).toHaveLength(1);
    expect(leaks[0].context).toContain('Issuing officer');
  });

  it('returns empty for clean pages', () => {
    expect(findPlaceholderLeaks(['Rocky Mountain Protective Group'])).toEqual([]);
  });
});

describe('expectNoPlaceholderLeaks', () => {
  it('resolves for a clean document', async () => {
    await expect(
      expectNoPlaceholderLeaks(docWith(['Rocky Mountain Protective Group'])),
    ).resolves.toBeUndefined();
  });

  it('throws naming the page and token', async () => {
    await expect(
      expectNoPlaceholderLeaks(docWith(['Officer: undefined'])),
    ).rejects.toThrow(/page 1.*undefined/is);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/pdf/audit/__tests__/textLayer.test.ts`
Expected: FAIL — `Failed to resolve import "../textLayer"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// client/src/utils/pdf/audit/textLayer.ts
import type { jsPDF } from 'jspdf';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

// The legacy build's text extraction path needs no canvas — only
// rasterization does. That is what makes this assertion runnable in
// plain Node under vitest, and therefore usable as a CI gate.

export interface PlaceholderLeak {
  page: number;
  token: string;
  context: string;
}

// Word-bounded so "Annulled" does not match "null" and "undefinedness"
// does not match "undefined". `[object Object]` is bracket-delimited so
// it needs its own alternative rather than a \b guard.
export const PLACEHOLDER_LEAK_PATTERN =
  /\[object Object\]|\bInvalid Date\b|\bundefined\b|\bNaN\b|\bnull\b/g;

export async function extractPdfText(doc: jsPDF): Promise<string[]> {
  const data = new Uint8Array(doc.output('arraybuffer') as ArrayBuffer);
  const pdf = await pdfjs.getDocument({ data }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    pages.push(content.items.map((item: { str?: string }) => item.str ?? '').join(' '));
  }
  return pages;
}

const CONTEXT_RADIUS = 40;

export function findPlaceholderLeaks(pages: string[]): PlaceholderLeak[] {
  const leaks: PlaceholderLeak[] = [];
  pages.forEach((text, index) => {
    // Fresh lastIndex per page — the pattern is global and stateful.
    PLACEHOLDER_LEAK_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null = PLACEHOLDER_LEAK_PATTERN.exec(text);
    while (match !== null) {
      leaks.push({
        page: index + 1,
        token: match[0],
        context: text
          .slice(Math.max(0, match.index - CONTEXT_RADIUS), match.index + match[0].length + CONTEXT_RADIUS)
          .trim(),
      });
      match = PLACEHOLDER_LEAK_PATTERN.exec(text);
    }
  });
  return leaks;
}

export async function expectNoPlaceholderLeaks(doc: jsPDF): Promise<void> {
  const leaks = findPlaceholderLeaks(await extractPdfText(doc));
  if (leaks.length === 0) return;
  const report = leaks
    .map((l) => `  page ${l.page}: "${l.token}" in "…${l.context}…"`)
    .join('\n');
  throw new Error(`PDF text layer contains ${leaks.length} placeholder leak(s):\n${report}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/pdf/audit/__tests__/textLayer.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/pdf/audit/textLayer.ts client/src/utils/pdf/audit/__tests__/textLayer.test.ts
git commit -m "feat(pdf-audit): add Node-runnable PDF text-layer leak assertions"
```

---

### Task 2: Registry types and fixture contract

The inventory's type backbone. Pure types plus a validator, so a malformed entry fails a test rather than blanking a page at render time.

**Files:**
- Create: `client/src/devtools/pdfGallery/types.ts`
- Test: `client/src/devtools/pdfGallery/__tests__/types.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Criticality = 'court-legal' | 'evidence-custody' | 'use-of-force' | 'dispatch-patrol' | 'client-facing' | 'internal-reference'`
  - `type FixtureVariant = 'typical' | 'empty' | 'maximal'`
  - `interface PdfFixture<T> { variant: FixtureVariant; label: string; input: T }`
  - `interface PdfRegistryEntry<T = unknown> { id: string; label: string; criticality: Criticality; module: string; generate: (input: T) => jsPDF | Promise<jsPDF>; fixtures: PdfFixture<T>[] }`
  - `BATCH_ORDER: readonly Criticality[]` — batch 1 → 6 order from the spec.
  - `validateRegistry(entries: PdfRegistryEntry[]): string[]` — returns human-readable problems; empty array means valid.

- [ ] **Step 1: Write the failing test**

```ts
// client/src/devtools/pdfGallery/__tests__/types.test.ts
import { describe, it, expect } from 'vitest';
import { jsPDF } from 'jspdf';
import { validateRegistry, BATCH_ORDER, type PdfRegistryEntry } from '../types';

function entry(over: Partial<PdfRegistryEntry> = {}): PdfRegistryEntry {
  return {
    id: 'trespass-order',
    label: 'Trespass Order',
    criticality: 'court-legal',
    module: 'client/src/utils/trespassOrderPdf.ts',
    generate: () => new jsPDF(),
    fixtures: [
      { variant: 'typical', label: 'Standard order', input: {} },
      { variant: 'empty', label: 'All optional fields absent', input: {} },
      { variant: 'maximal', label: 'Long narrative, 40 rows', input: {} },
    ],
    ...over,
  } as PdfRegistryEntry;
}

describe('BATCH_ORDER', () => {
  it('lists the six batches in spec order', () => {
    expect(BATCH_ORDER).toEqual([
      'court-legal',
      'evidence-custody',
      'use-of-force',
      'dispatch-patrol',
      'client-facing',
      'internal-reference',
    ]);
  });
});

describe('validateRegistry', () => {
  it('accepts a well-formed entry', () => {
    expect(validateRegistry([entry()])).toEqual([]);
  });

  it('rejects duplicate ids', () => {
    const problems = validateRegistry([entry(), entry()]);
    expect(problems.join(' ')).toMatch(/duplicate id.*trespass-order/i);
  });

  it('requires all three fixture variants', () => {
    const problems = validateRegistry([
      entry({ fixtures: [{ variant: 'typical', label: 'Only one', input: {} }] }),
    ]);
    expect(problems.join(' ')).toMatch(/missing fixture variant.*empty.*maximal/is);
  });

  it('rejects an unknown criticality', () => {
    const problems = validateRegistry([entry({ criticality: 'nonsense' as never })]);
    expect(problems.join(' ')).toMatch(/unknown criticality.*nonsense/i);
  });

  it('reports every problem rather than only the first', () => {
    const problems = validateRegistry([
      entry({ id: 'a', fixtures: [] }),
      entry({ id: 'b', criticality: 'nope' as never }),
    ]);
    expect(problems.length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/devtools/pdfGallery/__tests__/types.test.ts`
Expected: FAIL — `Failed to resolve import "../types"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// client/src/devtools/pdfGallery/types.ts
import type { jsPDF } from 'jspdf';

export type Criticality =
  | 'court-legal'
  | 'evidence-custody'
  | 'use-of-force'
  | 'dispatch-patrol'
  | 'client-facing'
  | 'internal-reference';

export const BATCH_ORDER: readonly Criticality[] = [
  'court-legal',
  'evidence-custody',
  'use-of-force',
  'dispatch-patrol',
  'client-facing',
  'internal-reference',
] as const;

export type FixtureVariant = 'typical' | 'empty' | 'maximal';

export const REQUIRED_VARIANTS: readonly FixtureVariant[] = ['typical', 'empty', 'maximal'] as const;

export interface PdfFixture<T = unknown> {
  variant: FixtureVariant;
  /** Short human description shown in the gallery's fixture picker. */
  label: string;
  input: T;
}

export interface PdfRegistryEntry<T = unknown> {
  /** Stable kebab-case id; used in screenshot filenames and the catalogue. */
  id: string;
  label: string;
  criticality: Criticality;
  /** Repo-relative path of the generator, for the defect catalogue. */
  module: string;
  generate: (input: T) => jsPDF | Promise<jsPDF>;
  fixtures: PdfFixture<T>[];
}

export function validateRegistry(entries: PdfRegistryEntry[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const e of entries) {
    if (seen.has(e.id)) problems.push(`duplicate id: ${e.id}`);
    seen.add(e.id);

    if (!BATCH_ORDER.includes(e.criticality)) {
      problems.push(`${e.id}: unknown criticality "${e.criticality}"`);
    }

    const present = new Set(e.fixtures.map((f) => f.variant));
    const missing = REQUIRED_VARIANTS.filter((v) => !present.has(v));
    if (missing.length > 0) {
      problems.push(`${e.id}: missing fixture variant(s): ${missing.join(', ')}`);
    }
  }

  return problems;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/devtools/pdfGallery/__tests__/types.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add client/src/devtools/pdfGallery/types.ts client/src/devtools/pdfGallery/__tests__/types.test.ts
git commit -m "feat(pdf-gallery): add registry types, batch order, and validator"
```

---

### Task 3: Batch-1 registry entries and fixtures (court & legal)

Proves the registry pattern end to end on the highest-criticality batch before scaling to all ~90 types. Court and legal documents first, per the spec.

**Files:**
- Create: `client/src/devtools/pdfGallery/fixtures/courtLegal.ts`
- Create: `client/src/devtools/pdfGallery/registry.ts`
- Test: `client/src/devtools/pdfGallery/__tests__/registry.test.ts`

**Interfaces:**
- Consumes: `PdfRegistryEntry`, `validateRegistry`, `BATCH_ORDER` from Task 2; `expectNoPlaceholderLeaks` from Task 1.
- Produces:
  - `PDF_REGISTRY: PdfRegistryEntry[]` from `registry.ts`.
  - `getEntry(id: string): PdfRegistryEntry | undefined`
  - `entriesByCriticality(c: Criticality): PdfRegistryEntry[]`

**Fixture authoring rules** (apply to every fixture in this and later tasks):
- Synthetic names only. Use obviously-fake but realistic values: `Dana Whitlock`, `Marcus Reyes`, `1400 S State St, Salt Lake City, UT 84115`, plate `UT-7X4K21`, case `2026-004417`.
- `typical`: every commonly-populated field filled, one or two optional fields absent.
- `empty`: **only** the fields the TypeScript type marks required. Every optional field `undefined`, every array `[]`, every nested object absent. This variant exists to make `undefined` leaks reproducible.
- `maximal`: a 120-character subject name, a 2,000-character narrative, a 40-row table, and a date at year boundary (`2026-12-31T23:59:00Z`). This variant exists to make overflow reproducible.

- [ ] **Step 1: Write the failing test**

```ts
// client/src/devtools/pdfGallery/__tests__/registry.test.ts
import { describe, it, expect } from 'vitest';
import { PDF_REGISTRY, getEntry, entriesByCriticality } from '../registry';
import { validateRegistry, REQUIRED_VARIANTS } from '../types';
import { expectNoPlaceholderLeaks } from '../../../utils/pdf/audit/textLayer';

describe('PDF_REGISTRY', () => {
  it('is structurally valid', () => {
    expect(validateRegistry(PDF_REGISTRY)).toEqual([]);
  });

  it('contains the batch-1 court & legal entries', () => {
    const ids = entriesByCriticality('court-legal').map((e) => e.id).sort();
    expect(ids).toEqual(
      ['court-appearance', 'criminal-history', 'trespass-order'].sort(),
    );
  });

  it('looks up by id', () => {
    expect(getEntry('trespass-order')?.label).toBe('Trespass Order');
    expect(getEntry('does-not-exist')).toBeUndefined();
  });
});

// The audit gate. Every registered form must generate all three
// fixtures without throwing, and without leaking placeholder tokens
// into the text layer. Failures here ARE the defect catalogue's
// correctness lens.
describe.each(PDF_REGISTRY.map((e) => [e.id, e] as const))('%s', (_id, entry) => {
  it.each(REQUIRED_VARIANTS)('generates the %s fixture', async (variant) => {
    const fixture = entry.fixtures.find((f) => f.variant === variant);
    expect(fixture, `missing ${variant} fixture`).toBeDefined();
    const doc = await entry.generate(fixture!.input);
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it.each(REQUIRED_VARIANTS)('leaks no placeholders in the %s fixture', async (variant) => {
    const fixture = entry.fixtures.find((f) => f.variant === variant)!;
    await expectNoPlaceholderLeaks(await entry.generate(fixture.input));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/devtools/pdfGallery/__tests__/registry.test.ts`
Expected: FAIL — `Failed to resolve import "../registry"`.

- [ ] **Step 3: Write the fixtures**

Open each generator to read its exact input type before authoring — `generateTrespassOrderPdf(order: TrespassOrder)` at `client/src/utils/trespassOrderPdf.ts:138`, `generateCriminalHistoryPdf(input: CriminalHistoryInput)` at `client/src/utils/criminalHistoryPdf.ts:111`, `generateCourtAppearancePdf(input: CourtAppearanceInput)` at `client/src/utils/courtAppearancePdf.ts:142`. Type the fixtures against those imported types so `tsc` catches drift.

```ts
// client/src/devtools/pdfGallery/fixtures/courtLegal.ts
import type { TrespassOrder } from '../../../types/trespass';
import type { PdfFixture } from '../types';

// Synthetic data only. No real person, address, plate, or case number
// from live records may appear here — organization policy.

const LOREM_NARRATIVE = 'Subject was observed on the property after hours. '.repeat(40);
const LONG_NAME = 'Bartholomew Maximilian Fitzgerald-Whitlock III of the Wasatch Front Region';

export const trespassOrderFixtures: PdfFixture<TrespassOrder>[] = [
  {
    variant: 'typical',
    label: 'Active order, standard subject',
    input: {
      id: 'to_0001',
      subject_name: 'Dana Whitlock',
      property_address: '1400 S State St, Salt Lake City, UT 84115',
      issued_date: '2026-03-14',
      expiration_date: '2027-03-14',
      status: 'active',
      issuing_officer: 'Sgt. Marcus Reyes',
      narrative: 'Subject was advised of the trespass order and acknowledged receipt.',
    } as TrespassOrder,
  },
  {
    variant: 'empty',
    label: 'Required fields only — every optional absent',
    input: {
      id: 'to_0002',
      subject_name: 'Dana Whitlock',
      status: 'active',
    } as TrespassOrder,
  },
  {
    variant: 'maximal',
    label: 'Long name, 2000-char narrative, year-boundary date',
    input: {
      id: 'to_0003',
      subject_name: LONG_NAME,
      property_address:
        '1400 South State Street, Building C, Suite 2200, Salt Lake City, Utah 84115-2847',
      issued_date: '2026-12-31',
      expiration_date: '2027-12-31',
      status: 'active',
      issuing_officer: 'Sergeant Marcus Alexander Reyes, Badge 4417',
      narrative: LOREM_NARRATIVE,
    } as TrespassOrder,
  },
];
```

Author `criminalHistoryFixtures` and `courtAppearanceFixtures` in the same file following the identical three-variant shape, typed against `CriminalHistoryInput` and `CourtAppearanceInput` respectively. For `criminalHistoryFixtures`, the `maximal` variant's `history` array must contain 40 entries so the table-overflow case is exercised.

- [ ] **Step 4: Write the registry**

```ts
// client/src/devtools/pdfGallery/registry.ts
import { generateTrespassOrderPdf } from '../../utils/trespassOrderPdf';
import { generateCriminalHistoryPdf } from '../../utils/criminalHistoryPdf';
import { generateCourtAppearancePdf } from '../../utils/courtAppearancePdf';
import {
  trespassOrderFixtures,
  criminalHistoryFixtures,
  courtAppearanceFixtures,
} from './fixtures/courtLegal';
import type { Criticality, PdfRegistryEntry } from './types';

// One entry per PDF output type. This is the inventory: no complete
// list of RMPG Flex's PDF outputs existed before this file.
export const PDF_REGISTRY: PdfRegistryEntry[] = [
  {
    id: 'trespass-order',
    label: 'Trespass Order',
    criticality: 'court-legal',
    module: 'client/src/utils/trespassOrderPdf.ts',
    generate: generateTrespassOrderPdf,
    fixtures: trespassOrderFixtures,
  } as PdfRegistryEntry,
  {
    id: 'criminal-history',
    label: 'Criminal History',
    criticality: 'court-legal',
    module: 'client/src/utils/criminalHistoryPdf.ts',
    generate: generateCriminalHistoryPdf,
    fixtures: criminalHistoryFixtures,
  } as PdfRegistryEntry,
  {
    id: 'court-appearance',
    label: 'Court Appearance Notice',
    criticality: 'court-legal',
    module: 'client/src/utils/courtAppearancePdf.ts',
    generate: generateCourtAppearancePdf,
    fixtures: courtAppearanceFixtures,
  } as PdfRegistryEntry,
];

export function getEntry(id: string): PdfRegistryEntry | undefined {
  return PDF_REGISTRY.find((e) => e.id === id);
}

export function entriesByCriticality(c: Criticality): PdfRegistryEntry[] {
  return PDF_REGISTRY.filter((e) => e.criticality === c);
}
```

- [ ] **Step 5: Run test — expect real defects, not green**

Run: `cd client && npx vitest run src/devtools/pdfGallery/__tests__/registry.test.ts`

Expected: the three structural tests PASS. The generation and placeholder-leak tests **may legitimately FAIL** — that is the harness doing its job on the first real forms. **Do not fix the generators in this task.** Record each failure verbatim (form id, variant, token, context) for the catalogue in Task 6, then mark the failing leak assertions with `it.skip` and a `// AUDIT-DEFECT: <id>/<variant> — <token>` comment so the suite stays green while the defect stays visible and greppable.

Rationale: this plan's deliverable is the *catalogue*. Fixing a court-facing document is batch-1 work with its own review gate, and the spec's stop conditions may route some of these to the operator rather than to a diff.

- [ ] **Step 6: Verify types and commit**

```bash
cd client && npx tsc --noEmit
git add client/src/devtools/pdfGallery/
git commit -m "feat(pdf-gallery): register court & legal forms with three-variant fixtures"
```

---

### Task 4: The gallery page and DEV-only route

The layout lens. Rasterizes at print DPI with margin guides so clipping is visible rather than inferred.

**Files:**
- Create: `client/src/devtools/pdfGallery/PdfGalleryPage.tsx`
- Create: `client/src/devtools/pdfGallery/renderToCanvas.ts`
- Modify: `client/src/App.tsx` — add the gated route inside the public-routes block (near `client/src/App.tsx:506`)
- Test: `client/src/devtools/pdfGallery/__tests__/renderToCanvas.test.ts`

**Interfaces:**
- Consumes: `PDF_REGISTRY`, `getEntry` (Task 3); `PdfRegistryEntry`, `FixtureVariant` (Task 2).
- Produces: `renderPdfToCanvases(doc: jsPDF, scale: number): Promise<HTMLCanvasElement[]>`; default-exported `PdfGalleryPage`.

- [ ] **Step 1: Write the failing test**

Only the pure geometry is unit-tested; canvas rasterization itself is verified visually in the browser, which is the entire point of this task.

```ts
// client/src/devtools/pdfGallery/__tests__/renderToCanvas.test.ts
import { describe, it, expect } from 'vitest';
import { PRINT_SCALE, marginGuideRect } from '../renderToCanvas';

describe('PRINT_SCALE', () => {
  it('renders at 150 DPI relative to pdfjs 72-DPI baseline', () => {
    expect(PRINT_SCALE).toBeCloseTo(150 / 72, 5);
  });
});

describe('marginGuideRect', () => {
  it('insets by the margin on all sides, scaled', () => {
    // 612x792pt US Letter, 36pt (0.5in) margin, 2x scale
    expect(marginGuideRect(612, 792, 36, 2)).toEqual({
      x: 72,
      y: 72,
      width: 1080,
      height: 1440,
    });
  });

  it('clamps to a zero-size rect when margins exceed the page', () => {
    expect(marginGuideRect(100, 100, 60, 1)).toEqual({ x: 60, y: 60, width: 0, height: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/devtools/pdfGallery/__tests__/renderToCanvas.test.ts`
Expected: FAIL — `Failed to resolve import "../renderToCanvas"`.

- [ ] **Step 3: Implement the renderer**

```ts
// client/src/devtools/pdfGallery/renderToCanvas.ts
import type { jsPDF } from 'jspdf';
import * as pdfjs from 'pdfjs-dist';

// pdfjs measures at 72 DPI; 150 DPI is the lowest scale at which 6pt
// form-label text is legible enough to judge clipping by eye.
export const PRINT_SCALE = 150 / 72;

export interface GuideRect { x: number; y: number; width: number; height: number }

export function marginGuideRect(
  pageWidthPt: number,
  pageHeightPt: number,
  marginPt: number,
  scale: number,
): GuideRect {
  return {
    x: marginPt * scale,
    y: marginPt * scale,
    width: Math.max(0, (pageWidthPt - marginPt * 2) * scale),
    height: Math.max(0, (pageHeightPt - marginPt * 2) * scale),
  };
}

export async function renderPdfToCanvases(doc: jsPDF, scale = PRINT_SCALE): Promise<HTMLCanvasElement[]> {
  const data = new Uint8Array(doc.output('arraybuffer') as ArrayBuffer);
  const pdf = await pdfjs.getDocument({ data }).promise;
  const canvases: HTMLCanvasElement[] = [];

  for (let n = 1; n <= pdf.numPages; n += 1) {
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;

    // Margin guide, drawn after the page so it sits on top. Any glyph
    // crossing this line is an overflow defect.
    const base = page.getViewport({ scale: 1 });
    const guide = marginGuideRect(base.width, base.height, 36, scale);
    ctx.save();
    ctx.strokeStyle = '#e11d48';
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1;
    ctx.strokeRect(guide.x, guide.y, guide.width, guide.height);
    ctx.restore();

    canvases.push(canvas);
  }
  return canvases;
}
```

The pdfjs worker must be configured. Reuse whatever `client/src/lib/rmpg-pdf-engine/` already does for `GlobalWorkerOptions.workerSrc` against the vendored `client/public/pdfjs/` assets — grep for `workerSrc` and copy that line rather than inventing a second worker configuration.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/devtools/pdfGallery/__tests__/renderToCanvas.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Build the page**

`PdfGalleryPage.tsx` renders: a left sidebar listing `PDF_REGISTRY` grouped by `BATCH_ORDER`; a fixture-variant selector (typical / empty / maximal); the rendered canvases stacked vertically with a page number above each; and, above the canvases, the placeholder-leak report for the current selection obtained by calling `findPlaceholderLeaks(await extractPdfText(doc))` from Task 1. Wrap generation in try/catch and render the thrown error's message and stack in a visible red block — a generator that throws is itself a catalogue entry, and must not blank the page.

Harness chrome may use literal hex; it is dev-only and never ships.

- [ ] **Step 6: Wire the DEV-gated route**

In `client/src/App.tsx`, alongside the other lazy page imports:

```tsx
const PdfGalleryPage = lazy(() => import('./devtools/pdfGallery/PdfGalleryPage'));
```

Then inside the public `<Routes>` block near `client/src/App.tsx:506`:

```tsx
{/* Dev-only PDF audit harness. Gated on import.meta.env.DEV so Vite
    tree-shakes it out of the production bundle entirely — it must never
    reach Cloudflare Pages. See docs/superpowers/specs/
    2026-07-31-pdf-forms-audit-and-repair-design.md */}
{import.meta.env.DEV && (
  <Route path="/__pdf-gallery" element={<PdfGalleryPage />} />
)}
```

- [ ] **Step 7: Prove the production bundle excludes it**

```bash
cd client && npx vite build
grep -rl "__pdf-gallery" dist/assets/ || echo "ABSENT FROM BUNDLE — correct"
```

Expected: `ABSENT FROM BUNDLE — correct`. If the string appears in `dist/`, the gating failed and the route must not be committed as-is.

- [ ] **Step 8: Verify in the browser**

Start the dev server via `preview_start` (never `npm run dev` through Bash), navigate to `/__pdf-gallery`, select each of the three batch-1 forms across all three variants, and confirm pages rasterize with the margin guide visible. Check the browser console for errors.

- [ ] **Step 9: Commit**

```bash
cd client && npx tsc --noEmit
git add client/src/devtools/pdfGallery/ client/src/App.tsx
git commit -m "feat(pdf-gallery): add DEV-only /__pdf-gallery route with print-DPI render and margin guides"
```

---

### Task 5: Complete the inventory across all six batches

Scale the proven pattern from 3 forms to the full surface. This is the bulk of the effort and the spec's stated first deliverable.

**Files:**
- Create: `client/src/devtools/pdfGallery/fixtures/evidenceCustody.ts`, `useOfForce.ts`, `dispatchPatrol.ts`, `clientFacing.ts`, `internalReference.ts`
- Modify: `client/src/devtools/pdfGallery/registry.ts` — append entries
- Modify: `client/src/devtools/pdfGallery/__tests__/registry.test.ts` — update the batch-1 id assertion to cover all batches

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces: a `PDF_REGISTRY` covering every PDF output type in the codebase.

- [ ] **Step 1: Enumerate the true inventory**

```bash
cd "$(git rev-parse --show-toplevel)/client/src" && grep -rl "jspdf\|jsPDF" utils pages components | grep -v test | sort > /tmp/pdf-modules.txt && wc -l /tmp/pdf-modules.txt
```

For each module, list its exported `generate*Pdf` / `download*Pdf` / `open*Pdf` functions. A module may produce **more than one** document type (for example `recordPdfGenerator.ts` switches on a `formType`) — each distinct document gets its own registry entry, not one entry per file. Modules that only *parse* or *view* PDFs (`pdf417Decoder.ts`, `client/src/lib/rmpg-pdf-engine/`, the Worker's `warrantSources/parse/*`) are excluded; note the exclusion and why.

- [ ] **Step 2: Author fixtures batch by batch**

One fixture file per criticality group, following the Task 3 rules exactly: synthetic data, three variants, `empty` containing only type-required fields, `maximal` containing a 120-char name, a 2,000-char narrative, and a 40-row table. Type every fixture against the generator's imported input type so `tsc --noEmit` catches drift.

Commit after each batch's fixtures land, not once at the end:

```bash
git add client/src/devtools/pdfGallery/fixtures/evidenceCustody.ts client/src/devtools/pdfGallery/registry.ts
git commit -m "feat(pdf-gallery): register evidence & custody forms"
```

- [ ] **Step 3: Update the registry test's coverage assertion**

Add `BATCH_ORDER` to the existing `../types` import in the test file, then replace the batch-1-only id assertion with one asserting every `BATCH_ORDER` group is non-empty, plus a count assertion pinning the total number of registered document types so a silently-dropped entry fails CI:

```ts
it('covers every batch', () => {
  for (const c of BATCH_ORDER) {
    expect(entriesByCriticality(c).length, `no entries for ${c}`).toBeGreaterThan(0);
  }
});

it('registers the full known inventory', () => {
  // Update this number deliberately when a new PDF document type is added.
  expect(PDF_REGISTRY).toHaveLength(EXPECTED_TOTAL);
});
```

Substitute `EXPECTED_TOTAL` with the actual count from Step 1.

- [ ] **Step 4: Run the full audit suite**

Run: `cd client && npx vitest run src/devtools/pdfGallery/`

Every generation failure and placeholder leak is a catalogue entry. Apply the Task 3 Step 5 protocol: record verbatim, `it.skip` with an `// AUDIT-DEFECT:` comment, do **not** fix generators here.

- [ ] **Step 5: Gate and commit**

```bash
cd client && npx tsc --noEmit && npx vitest run
git add client/src/devtools/pdfGallery/
git commit -m "feat(pdf-gallery): complete PDF document inventory across all six batches"
```

---

### Task 6: Produce the ranked defect catalogue

The deliverable that determines batches 1–6.

**Files:**
- Create: `docs/superpowers/specs/2026-07-31-pdf-defect-catalogue.md`

**Interfaces:**
- Consumes: the `AUDIT-DEFECT` markers from Tasks 3 and 5, plus the browser screenshots.
- Produces: the catalogue document.

- [ ] **Step 1: Capture the screenshot corpus**

With the dev server running, walk every registry entry × three variants in `/__pdf-gallery`, screenshotting each. Save to `/tmp/pdf-audit/<id>-<variant>.png` — **outside the repo**, since these are large binaries and some may embed fixture content not worth versioning.

- [ ] **Step 2: Collect the automated findings**

```bash
cd client && grep -rn "AUDIT-DEFECT" src/devtools/pdfGallery/
```

- [ ] **Step 3: Write the catalogue**

One row per defect:

| Form | Module | Variant | Lens | Severity | Defect | Proposed fix | Stop condition? |
|---|---|---|---|---|---|---|---|

- **Lens** is one of correctness / layout / compliance / branding.
- **Severity**: `critical` (document is wrong or unusable in court), `major` (visibly broken but usable), `minor` (cosmetic).
- **Stop condition?** is `yes` when the fix would touch legal substance, or requires a schema/data-layer change — per the spec these return to the operator instead of being fixed inline.

Sort by criticality batch, then severity.

- [ ] **Step 4: Summarize for the operator**

Close the catalogue with: total defects by lens and severity; count of stop-condition items needing a decision; and a revised per-batch scope estimate. Explicitly list any registered form that turned out to be **clean** — those need no batch work at all, and saying so prevents wasted effort.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-07-31-pdf-defect-catalogue.md
git commit -m "docs(pdf): ranked defect catalogue from the render-first audit"
```

---

## After this plan

The catalogue drives six follow-on plans, one per batch, written after you review it. Do not begin generator repairs before that review: the spec's stop conditions mean some catalogued defects are operator decisions, not diffs.
