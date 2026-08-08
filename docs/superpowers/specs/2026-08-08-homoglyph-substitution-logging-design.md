# Homoglyph Substitution Logging (design)

**Date:** 2026-08-08
**Context:** Serve Intake OCR pre-clean (see `docs/superpowers/specs/2026-07-26-serve-intake-ocr-enhancement-design.md`)

## 1. Background

This work started as a broader request to evaluate OCR software for legal documents. Investigation found:

- RMPG Flex already has a working, tested OCR pipeline for legal process documents (`src/utils/visionExtract.ts`, `src/utils/serveIntakePreclean.ts`), using Claude vision → OpenAI → Cloudflare Workers AI, gated through `callAi()`.
- A binding operator decision (D-3, 2026-07-26-serve-intake-ocr-enhancement-design.md §2) rejects routing client legal-process documents to any third-party API not already operated by RMPG, specifically for data-handling reasons. No vendor currently integrated in this codebase (Roboflow, Fleet.io, CarsXE, Legal Data Hunter) has a documented DPA/BAA, so introducing a new uncontracted OCR vendor (AWS Textract, Google Document AI, Azure Form Recognizer) would widen this repo's existing compliance gap rather than close it. D-3 stays in force; no new vendor is introduced by this change.
- Of the two documented-but-unhandled OCR accuracy hazards in that spec (watermark bleed, Cyrillic/Greek homoglyphs), both are already implemented and tested in `src/utils/serveIntakePreclean.ts`. The one remaining gap: the homoglyph normalizer silently substitutes characters with no logging, so there's no audit trail of what the OCR pipeline altered in a legal document's text.

## 2. Problem

`normalizeHomoglyphs()` (`src/utils/serveIntakePreclean.ts:35-38`) silently replaces Cyrillic/Greek confusable characters with their Latin equivalents (e.g. Cyrillic С U+0421 → Latin C). For a legal process document, an unlogged character substitution is an invisible edit to case/court/address text that later informs a service attempt or court filing. There is currently no way to see, after the fact, that a substitution happened or what it changed.

## 3. Design

Add a new pure function, `detectHomoglyphs(s: string): HomoglyphSubstitution[]`, next to `normalizeHomoglyphs` in `serveIntakePreclean.ts`. It scans the same `HOMOGLYPHS` map and returns one entry per distinct confusable character found (character, Unicode code point, ASCII replacement, occurrence count) — it does not mutate the string and has no side effects, matching the existing pure/unit-testable style of this file.

```ts
export interface HomoglyphSubstitution {
  char: string;        // original confusable character, e.g. 'С'
  codePoint: string;   // e.g. 'U+0421'
  replacement: string; // e.g. 'C'
  count: number;       // occurrences in the input
}

export function detectHomoglyphs(s: string): HomoglyphSubstitution[] { ... }
```

The call site is `src/routes/serveIntake.ts`, in the `scan-document` handler, immediately after the existing pre-clean step. It calls `detectHomoglyphs()` on the raw (pre-normalization) text and, only when the result is non-empty, emits:

```ts
log.info('serve-intake: homoglyph substitutions detected', {
  traceId: c.get('traceId'),
  substitutions: result, // [{char, codePoint, replacement, count}, ...]
});
```

This matches the existing `log.info(action, { traceId, ...context })` pattern already used at `serveIntake.ts:336`. No new table, no `error_log` entry — per the earlier scoping decision, this is a structured log only (`src/utils/logger.ts`), consistent with how the rest of this route reports pipeline events.

## 4. Non-goals

- No new OCR vendor is introduced. D-3 is not reopened by this change.
- No durable/DB persistence of substitution events (log-only, per operator decision).
- No change to `normalizeHomoglyphs()`'s existing behavior or signature — `precleanText()`'s composition is untouched.

## 5. Testing

- `detectHomoglyphs()` is a pure function — unit-tested in `tests/serveIntakePreclean.test.ts` alongside the existing `normalizeHomoglyphs` tests: empty string, no-confusables input, single substitution, multiple distinct confusables, repeated occurrences of the same confusable (count aggregation).
- Route-level: confirm `log.info` fires with the expected shape when the scan-document handler processes text containing a known confusable, and does not fire when it doesn't (avoid log noise on the common case).
