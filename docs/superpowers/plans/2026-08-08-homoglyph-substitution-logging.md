# Homoglyph Substitution Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an audit-trail log line whenever the serve-intake OCR pre-clean pipeline substitutes a Cyrillic/Greek homoglyph character, so a later reviewer can see what the pipeline altered in a legal-process document's text.

**Architecture:** Add a new pure function `detectHomoglyphs()` next to the existing `normalizeHomoglyphs()` in `src/utils/serveIntakePreclean.ts`. It scans text and reports which confusable characters it found and what they'd be replaced with, without mutating anything — this keeps the pre-clean module's existing "pure, unit-tested with no model call" design intact. The one caller with a `traceId` in scope — the `/scan-document` handler in `src/routes/serveIntake.ts` — calls `detectHomoglyphs()` once after building `text` and logs the result via the existing structured logger, only when substitutions were found.

**Tech Stack:** TypeScript, Vitest, existing `src/utils/logger.ts` structured logger (`log.info`).

## Global Constraints

- No new OCR vendor is introduced; the existing Claude/OpenAI/Workers-AI pipeline is unchanged (per `docs/superpowers/specs/2026-08-08-homoglyph-substitution-logging-design.md` §4).
- No change to `normalizeHomoglyphs()`'s existing signature or behavior; `precleanText()`'s composition (`normalizeCheckboxes(normalizeTypography(normalizeHomoglyphs(scrubWatermarkBleed(s))))`) is untouched.
- Log-only — no new DB table, no `error_log` entry (per the design's non-goals).
- All D1/async patterns and existing test/lint gates in `CLAUDE.md` apply; run the full test suite before committing, not just the targeted file (per `[[full-suite-not-targeted-tests]]` project convention).

---

### Task 1: Add `detectHomoglyphs()` to the pre-clean module

**Files:**
- Modify: `src/utils/serveIntakePreclean.ts` (add new exported interface + function directly after the existing `normalizeHomoglyphs` function, i.e. after line 38)
- Test: `tests/serveIntakePreclean.test.ts` (add a new `describe('detectHomoglyphs', ...)` block after the existing `describe('normalizeHomoglyphs', ...)` block, i.e. after line 31)

**Interfaces:**
- Consumes: the existing `HOMOGLYPHS: Record<string, string>` map already defined at `src/utils/serveIntakePreclean.ts:21-33`.
- Produces: `export interface HomoglyphSubstitution { char: string; codePoint: string; replacement: string; count: number }` and `export function detectHomoglyphs(s: string): HomoglyphSubstitution[]`. Task 2 imports and calls `detectHomoglyphs` by this exact name and signature.

- [ ] **Step 1: Write the failing tests**

Insert into `tests/serveIntakePreclean.test.ts`, immediately after the closing `});` of the existing `describe('normalizeHomoglyphs', ...)` block (after line 31):

```ts
describe('detectHomoglyphs', () => {
  it('returns an empty array for text with no confusables', () => {
    expect(detectHomoglyphs('Salt Lake City, UT 84101')).toEqual([]);
  });

  it('returns an empty array for empty input', () => {
    expect(detectHomoglyphs('')).toEqual([]);
  });

  it('reports a single Cyrillic substitution with its code point and replacement', () => {
    // Real hazard: Court Docket rendered "CA" with a Cyrillic С (U+0421).
    const result = detectHomoglyphs('Palo Alto, СA 94304');
    expect(result).toEqual([
      { char: 'С', codePoint: 'U+0421', replacement: 'C', count: 1 },
    ]);
  });

  it('aggregates repeated occurrences of the same confusable into one entry with a count', () => {
    const result = detectHomoglyphs('СС are two Cyrillic Es: Е and Е');
    const entries = result.filter((r) => r.char === 'С');
    expect(entries).toEqual([{ char: 'С', codePoint: 'U+0421', replacement: 'C', count: 2 }]);
    const eEntries = result.filter((r) => r.char === 'Е');
    expect(eEntries).toEqual([{ char: 'Е', codePoint: 'U+0415', replacement: 'E', count: 2 }]);
  });

  it('reports multiple distinct confusables found in the same string', () => {
    // Greek Kappa (Κ, U+039A) alongside Cyrillic С (U+0421).
    const result = detectHomoglyphs('Κansas and СA');
    expect(result).toEqual(
      expect.arrayContaining([
        { char: 'Κ', codePoint: 'U+039A', replacement: 'K', count: 1 },
        { char: 'С', codePoint: 'U+0421', replacement: 'C', count: 1 },
      ]),
    );
    expect(result).toHaveLength(2);
  });

  it('does not report genuine non-Latin text with no mapping', () => {
    expect(detectHomoglyphs('中文')).toEqual([]);
  });
});
```

Also update the existing import line (line 10) to include the new symbol:

```ts
import { normalizeHomoglyphs, scrubWatermarkBleed, detectHomoglyphs } from '../src/utils/serveIntakePreclean';
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/serveIntakePreclean.test.ts`
Expected: FAIL — `detectHomoglyphs is not a function` (or a TypeScript import error), since the function does not exist yet.

- [ ] **Step 3: Implement `detectHomoglyphs()`**

In `src/utils/serveIntakePreclean.ts`, insert immediately after the existing `normalizeHomoglyphs` function (after line 38, before the `WATERMARK_STAMPS` comment on line 40):

```ts
export interface HomoglyphSubstitution {
  char: string;        // original confusable character, e.g. 'С'
  codePoint: string;   // e.g. 'U+0421'
  replacement: string; // e.g. 'C'
  count: number;       // occurrences in the input
}

// Pure detection counterpart to normalizeHomoglyphs — reports what WOULD be
// substituted without mutating the string, so a caller with logging context
// (traceId, document id) can record an audit trail of text the OCR pipeline
// altered. Order of the returned array is insertion order of first sighting.
export function detectHomoglyphs(s: string): HomoglyphSubstitution[] {
  if (!s) return [];
  const counts = new Map<string, number>();
  for (const ch of s) {
    if (HOMOGLYPHS[ch] !== undefined) {
      counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries()).map(([char, count]) => ({
    char,
    codePoint: `U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`,
    replacement: HOMOGLYPHS[char],
    count,
  }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/serveIntakePreclean.test.ts`
Expected: PASS — all tests in the file, including the new `detectHomoglyphs` block.

- [ ] **Step 5: Commit**

```bash
git add src/utils/serveIntakePreclean.ts tests/serveIntakePreclean.test.ts
git commit -m "feat(serve-intake): add pure detectHomoglyphs() for audit logging"
```

---

### Task 2: Log detected substitutions in the scan-document route

**Files:**
- Modify: `src/routes/serveIntake.ts:369` (immediately after the existing `text = precleanText(text);` line inside `scanDocumentHandler`)

**Interfaces:**
- Consumes: `detectHomoglyphs(s: string): HomoglyphSubstitution[]` from Task 1, imported from `../utils/serveIntakePreclean`; the existing `log` object from `../utils/logger` (already imported in this file); `c.get('traceId')` (already used at line 337 and 356 in this same handler).
- Produces: nothing consumed by later tasks — this is the final task in the plan.

**No route-level integration test for this task.** `test-workers/serveIntakeEncryption.test.ts:7-14` documents why: `/scan-document` and `/upload` both call AI-dependent extraction (`ocrImage`, `extractPdfMarkdown`) that hits real Claude/OpenAI/Workers-AI providers and is not mocked anywhere in this test harness — the existing test suite deliberately tests storage/encryption behavior directly against the underlying helper instead of driving it through the full route. The two-line change in this task (a call to the already-unit-tested `detectHomoglyphs` from Task 1, plus a conditional `log.info`) is exercised by Task 1's unit tests for correctness of the substitution data, and by the type checker + full test suite for wiring correctness (no route breakage). This matches the precedent in `serveIntakeEncryption.test.ts` of not attempting to drive AI-dependent routes end-to-end in this harness.

- [ ] **Step 1: Add the logging call site**

In `src/routes/serveIntake.ts`, update the import at line 61 from:

```ts
import { precleanText } from '../utils/serveIntakePreclean';
```

to:

```ts
import { precleanText, detectHomoglyphs } from '../utils/serveIntakePreclean';
```

Replace line 369 (`text = precleanText(text);`) with the following — note that `detectHomoglyphs` MUST run on the raw text *before* `precleanText` normalizes the homoglyphs away, or it will always find zero substitutions:

```ts
      const rawTextForHomoglyphCheck = text;
      text = precleanText(text);
      const homoglyphSubstitutions = detectHomoglyphs(rawTextForHomoglyphCheck);
      if (homoglyphSubstitutions.length > 0) {
        log.info('scan-document: homoglyph substitutions detected', {
          traceId: c.get('traceId'),
          substitutions: homoglyphSubstitutions,
        });
      }
```

- [ ] **Step 2: Run the full test suite**

Run: `npx vitest run && npm run test:worker`
Expected: PASS across both suites, no new failures. (Note: `tests/osmSpeedLimitLookup.test.ts` has a pre-existing, unrelated failure on this branch — `PbfWriter is not a constructor` — confirmed present before this work started; do not treat that file's failures as caused by this change.)

- [ ] **Step 3: Run worker typecheck**

Run: `npm run typecheck`
Expected: PASS, 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/serveIntake.ts
git commit -m "feat(serve-intake): log homoglyph substitutions detected in scan-document"
```
