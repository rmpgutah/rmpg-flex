# Serve Intake OCR — PR 1: Extraction Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden Serve Intake extraction against real-world document hazards, add the nine fields the briefing engine needs, and land a golden-fixture harness that makes every later PR measurable.

**Architecture:** A new pure `serveIntakePreclean.ts` module normalizes text before any model sees it. `env.AI.toMarkdown()` replaces the container text path for PDFs (structured, zero neurons). Model selection moves behind a measured A/B rather than a config edit. All new extraction fields flow through the existing `normalizeFields` dispatcher so typed columns stay protected.

**Tech Stack:** Cloudflare Workers, Hono, Workers AI (`toMarkdown`, Llama 4 Scout, Moondream 3.1), D1, Vitest.

**Spec:** [`docs/superpowers/specs/2026-07-26-serve-intake-ocr-enhancement-design.md`](../specs/2026-07-26-serve-intake-ocr-enhancement-design.md)

## Global Constraints

- **No real case data in the repo.** `tests/serveIntakeExtract.test.ts` establishes this norm ("No real case data"). Every fixture is a synthetic derivative: real *layout and hazards*, fabricated names, case numbers, addresses, and phone numbers.
- **All D1 access is async** — always `await db.prepare(...).first()/.all()/.run()`.
- **Never build an IN-list from an unbounded array** — use `queryInChunks` / `executeInChunks` from `src/utils/db.ts` (D1 caps bound parameters at 100).
- **New fields land in `serve_queue.parsed_data` JSON** where possible, to avoid schema churn.
- **Structured logging** via `src/utils/logger.ts` (`log.info/warn/error`), never raw `console.*`.
- **Worker tests:** `npx vitest run tests/<file>` — full suite `npx vitest run`.
- **Baseline is clean** (261 files / 2193 tests passing as of 2026-07-26). Any red is caused by this work.
- **Free-tier budget:** 10,000 Neurons/day. No task may add an unconditional second model call.

---

### Task 1: Text pre-clean module — homoglyphs and watermark bleed

Spec items 1–2. Pure functions, no model, no I/O.

**Files:**
- Create: `src/utils/serveIntakePreclean.ts`
- Test: `tests/serveIntakePreclean.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces: `normalizeHomoglyphs(s: string): string`, `scrubWatermarkBleed(s: string): string`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/serveIntakePreclean.test.ts
// ============================================================
// Serve Intake pre-clean — deterministic text hardening
// ============================================================
// Fixtures are SYNTHETIC derivatives of real ICU packets: the same
// layout hazards, fabricated identities. No real case data.
// ============================================================

import { describe, it, expect } from 'vitest';
import { normalizeHomoglyphs, scrubWatermarkBleed } from '../src/utils/serveIntakePreclean';

describe('normalizeHomoglyphs', () => {
  it('maps Cyrillic look-alikes to Latin', () => {
    // Real hazard: Court Docket rendered "CA" with a Cyrillic С (U+0421).
    expect(normalizeHomoglyphs('Palo Alto, СA 94304')).toBe('Palo Alto, CA 94304');
  });

  it('maps Greek look-alikes to Latin', () => {
    expect(normalizeHomoglyphs('Κansas')).toBe('Kansas');   // Greek Kappa
  });

  it('leaves genuine non-Latin text alone when no mapping exists', () => {
    expect(normalizeHomoglyphs('中文')).toBe('中文');
  });

  it('is idempotent', () => {
    const once = normalizeHomoglyphs('Palo Alto, СA 94304');
    expect(normalizeHomoglyphs(once)).toBe(once);
  });
});

describe('scrubWatermarkBleed', () => {
  it('removes a RUSH stamp scattered as isolated letters across lines', () => {
    // Real hazard: the Field Sheet's diagonal "RUSH" watermark lands in the
    // text layer as lone letters inside the Case/Court/Plaintiff cells.
    const input = [
      ' Case                     Plaintiff',
      '                    H',
      ' Court                    Defendant',
      '                   S',
      '                  U',
      ' Documents   UT Subpoena',
      '                 R',
    ].join('\n');
    const out = scrubWatermarkBleed(input);
    expect(out).not.toMatch(/^\s*[HSUR]\s*$/m);
    expect(out).toContain('UT Subpoena');
    expect(out).toContain('Plaintiff');
  });

  it('keeps single-letter lines that are not part of a known stamp', () => {
    const input = 'Exhibit\nA\nSchedule';
    expect(scrubWatermarkBleed(input)).toContain('A');
  });

  it('keeps single letters that appear inline rather than alone on a line', () => {
    const input = 'Apt H, Salt Lake City';
    expect(scrubWatermarkBleed(input)).toContain('Apt H');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/serveIntakePreclean.test.ts`
Expected: FAIL — `Failed to resolve import "../src/utils/serveIntakePreclean"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/utils/serveIntakePreclean.ts
// ============================================================
// RMPG Flex — Serve Intake text pre-clean
// ============================================================
// Deterministic text hardening applied BEFORE any model sees a
// document. Every function here is pure and unit-tested offline —
// the model is the expensive, non-deterministic part, so anything
// that can be fixed without it is fixed here.
//
// Hazards addressed (observed in live ICU packets, 2026-07-26):
//   • Cyrillic/Greek homoglyphs from the docket's PDF font encoding
//     ("Palo Alto, СA 94304" — U+0421, not U+0043)
//   • Diagonal watermark stamps ("RUSH") whose glyphs land in the
//     text layer as isolated letters INSIDE table cells, corrupting
//     the Case / Court / Plaintiff / Defendant fields
// ============================================================

// Confusable → ASCII. Only characters that are visually identical to a
// Latin letter in common document fonts. Deliberately narrow: a wide
// map would corrupt genuine non-Latin names.
const HOMOGLYPHS: Record<string, string> = {
  // Cyrillic uppercase
  'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M',
  'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T',
  'У': 'Y', 'Х': 'X',
  // Cyrillic lowercase
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c',
  'у': 'y', 'х': 'x',
  // Greek uppercase
  'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'H',
  'Ι': 'I', 'Κ': 'K', 'Μ': 'M', 'Ν': 'N', 'Ο': 'O',
  'Ρ': 'P', 'Τ': 'T', 'Χ': 'X',
};

export function normalizeHomoglyphs(s: string): string {
  if (!s) return '';
  return s.replace(/[Ͱ-ӿ]/g, (ch) => HOMOGLYPHS[ch] ?? ch);
}

// Stamps we expect to see rendered as scattered glyphs. Matching is done
// on the MULTISET of isolated letters, so the order the PDF emits them in
// (which follows the diagonal, not reading order) does not matter.
const WATERMARK_STAMPS = ['RUSH', 'COPY', 'FILED', 'DRAFT', 'VOID', 'SAMPLE'];

// A line is "isolated glyph" material when, after trimming, it is exactly
// one A-Z letter. Inline single letters ("Apt H") are never touched.
const ISOLATED_LETTER = /^\s*([A-Za-z])\s*$/;

export function scrubWatermarkBleed(s: string): string {
  if (!s) return '';
  const lines = s.split('\n');

  const candidates: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (ISOLATED_LETTER.test(lines[i])) candidates.push(i);
  }
  if (candidates.length < 3) return s;   // too few to reconstruct a stamp

  const letters = candidates.map((i) => lines[i].trim().toUpperCase());

  // A stamp is present when every one of its letters is available among the
  // isolated candidates (counting duplicates). We then drop exactly those.
  for (const stamp of WATERMARK_STAMPS) {
    const pool = new Map<string, number>();
    for (const l of letters) pool.set(l, (pool.get(l) ?? 0) + 1);

    let matches = true;
    for (const ch of stamp) {
      const have = pool.get(ch) ?? 0;
      if (have === 0) { matches = false; break; }
      pool.set(ch, have - 1);
    }
    if (!matches) continue;

    // Drop one candidate line per stamp letter, earliest first.
    const toDrop = new Set<number>();
    for (const ch of stamp) {
      const idx = candidates.find((i) => !toDrop.has(i) && lines[i].trim().toUpperCase() === ch);
      if (idx !== undefined) toDrop.add(idx);
    }
    return lines.filter((_, i) => !toDrop.has(i)).join('\n');
  }

  return s;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/serveIntakePreclean.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/utils/serveIntakePreclean.ts tests/serveIntakePreclean.test.ts
git commit -m "feat(serve-intake): homoglyph + watermark-bleed pre-clean"
```

---

### Task 2: Pre-clean — bracket noise, ligatures, hyphenation

Spec items 3–4.

**Files:**
- Modify: `src/utils/serveIntakePreclean.ts`
- Test: `tests/serveIntakePreclean.test.ts`

**Interfaces:**
- Consumes: Task 1's module.
- Produces: `normalizeCheckboxes(s: string): string`, `normalizeTypography(s: string): string`, `precleanText(s: string): string`.

- [ ] **Step 1: Write the failing test**

```ts
// Append to tests/serveIntakePreclean.test.ts
import { normalizeCheckboxes, normalizeTypography, precleanText } from '../src/utils/serveIntakePreclean';

describe('normalizeCheckboxes', () => {
  it('canonicalizes mismatched checkbox brackets', () => {
    // Real hazard: docket OCR emitted "[X)" and "[)" for checked/unchecked.
    expect(normalizeCheckboxes('I am [X) Plaintiff [ ) Defendant'))
      .toBe('I am [X] Plaintiff [ ] Defendant');
  });

  it('normalizes empty double-brackets to a spaced unchecked box', () => {
    expect(normalizeCheckboxes('[] Respondent')).toBe('[ ] Respondent');
  });

  it('accepts lowercase x as checked', () => {
    expect(normalizeCheckboxes('[x] District')).toBe('[X] District');
  });
});

describe('normalizeTypography', () => {
  it('expands ligatures', () => {
    expect(normalizeTypography('afﬁdavit of ﬂling')).toBe('affidavit of fling');
  });

  it('removes soft hyphens and normalizes non-breaking spaces', () => {
    expect(normalizeTypography('Sub­poena Service')).toBe('Subpoena Service');
  });

  it('rejoins words broken across a line by a hyphen', () => {
    expect(normalizeTypography('unlawful de-\ntainer')).toBe('unlawful detainer');
  });

  it('does not rejoin a genuine hyphenated compound at a line end', () => {
    expect(normalizeTypography('Salt Lake City-\nCounty Building'))
      .toBe('Salt Lake City-County Building');
  });
});

describe('precleanText', () => {
  it('applies every pass and is idempotent', () => {
    const raw = 'Palo Alto, СA 94304\n[X) Plaintiff\nafﬁdavit';
    const once = precleanText(raw);
    expect(once).toContain('CA 94304');
    expect(once).toContain('[X] Plaintiff');
    expect(once).toContain('affidavit');
    expect(precleanText(once)).toBe(once);
  });

  it('returns empty string for empty input', () => {
    expect(precleanText('')).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/serveIntakePreclean.test.ts`
Expected: FAIL — `normalizeCheckboxes is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// Append to src/utils/serveIntakePreclean.ts

// Court forms use checkbox glyphs that OCR mangles into mismatched
// bracket pairs ("[X)", "[)"). The extraction prompt keys off "[X]" to
// decide which party box was ticked, so canonicalizing this is a
// correctness fix, not cosmetics.
export function normalizeCheckboxes(s: string): string {
  if (!s) return '';
  return s
    .replace(/\[\s*[xX]\s*[\])}]/g, '[X]')      // [X) [x} [ X ] → [X]
    .replace(/\[\s*[\])}]/g, '[ ]')             // [) [} []      → [ ]
    .replace(/\[\s{2,}\]/g, '[ ]');             // collapse padding
}

const LIGATURES: Record<string, string> = {
  'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl',
  'ﬅ': 'st', 'ﬆ': 'st',
};

// A line-ending hyphen is a word break only when the next line starts
// lowercase — "de-\ntainer" rejoins, "City-\nCounty" does not.
export function normalizeTypography(s: string): string {
  if (!s) return '';
  let out = s.replace(/[ﬀ-ﬆ]/g, (ch) => LIGATURES[ch] ?? ch);
  out = out.replace(/­/g, '');                   // soft hyphen
  out = out.replace(/[   ]/g, ' ');    // non-breaking spaces
  out = out.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  out = out.replace(/-\n([a-z])/g, '$1');             // broken word → rejoin
  out = out.replace(/-\n([A-Z])/g, '-$1');            // compound → keep hyphen
  return out;
}

// The full pre-clean pipeline. Order matters: homoglyphs first (so later
// passes see ASCII), typography before checkbox repair (ligatures can sit
// inside a bracketed label).
export function precleanText(s: string): string {
  if (!s) return '';
  return normalizeCheckboxes(normalizeTypography(normalizeHomoglyphs(scrubWatermarkBleed(s))));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/serveIntakePreclean.test.ts`
Expected: PASS — 16 tests.

- [ ] **Step 5: Commit**

```bash
git add src/utils/serveIntakePreclean.ts tests/serveIntakePreclean.test.ts
git commit -m "feat(serve-intake): checkbox, ligature, and hyphenation pre-clean"
```

---

### Task 3: Golden-fixture harness

Spec item 68. This is the measurement spine — every later task and PR is graded against it.

**Files:**
- Create: `tests/fixtures/serve-intake/README.md`
- Create: `tests/fixtures/serve-intake/business-subpoena.txt`
- Create: `tests/fixtures/serve-intake/individual-employment.txt`
- Create: `tests/fixtures/serve-intake/expected.json`
- Create: `tests/serveIntakeFixtures.test.ts`

**Interfaces:**
- Consumes: `precleanText` (Task 2).
- Produces: the fixture corpus on disk, plus `loadFixture(name: string): string` and
  `loadExpected(): Record<string, Record<string, string>>` exported from the test file. The
  corpus files are read directly by `scripts/serve-intake-model-ab.ts` (Task 5); the two
  helpers are for future suites that want the same fixtures without re-reading paths.

- [ ] **Step 1: Write the fixture README (the privacy contract)**

```markdown
<!-- tests/fixtures/serve-intake/README.md -->
# Serve Intake golden fixtures

These are **synthetic derivatives** of real ICU Investigations packets.

They reproduce the *layout and hazards* of production documents — watermark
bleed, homoglyphs, two-column Information Forms, witness-fee lines,
place-of-employment service language — with entirely fabricated parties,
case numbers, addresses, and phone numbers.

**Never check a real client packet into this repo.** Real packets contain
identifiable parties in active civil litigation. `tests/serveIntakeExtract.test.ts`
has enforced this norm since the suite was written; these fixtures follow it.

To add a fixture: copy the layout, replace every identity, and record the
expected extraction in `expected.json`.
```

- [ ] **Step 2: Write the business-subpoena fixture**

Reproduces the Telarus hazard set: RUSH watermark bleed into empty Case/Court cells, corporate service language, registered-agent address distinct from the entity.

```text
<!-- tests/fixtures/serve-intake/business-subpoena.txt -->
ICU Investigations, LLC                     Job:  90000001 (90000002)   Due:  06/26/2026
250 N Red Cliffs Dr, #4B-275             Party to Serve:  Northgate Logistics, LLC
Saint George, UT 84790
                                      Agent for Service:  Authorized person
Phone 435-986-1200
                                                 Server:  Jordan Reyes    Fee:

                                                  H
 Case                                             Plaintiff

                                                 S
 Court                                            Defendant

                                                U
 Documents      UT Subpoena; UT Application for Subpoena; Notice to Persons Served with a Subpoena

                                               R
 Instructions
 RUSH - SERVE ON FRIDAY AT THIS BUSINESS ADDRESS BETWEEN 9AM AND 3:30PM.
 UTAH CORPORATE - May serve any person authorized to accept service at a business location who is
 18 years of age or older.

Registered Agent Address                   Party to Serve: Northgate Logistics, LLC
1400 West Confluence Ave Ste 310, Salt Lake City, UT 84104
                                           Agent For Service: Authorized person
```

- [ ] **Step 3: Write the individual-employment fixture**

Reproduces the Anderson hazard set: witness-fee instrument, place-of-employment service rule, an explicit client diligence schedule, and a start-date bar.

```text
<!-- tests/fixtures/serve-intake/individual-employment.txt -->
ICU Investigations, LLC                     Job:  90000003 (AZ900001E)  Due:  06/30/2026
250 N Red Cliffs Dr, #4B-275             Party to Serve:  Dana Whitfield
Saint George, UT 84790
                                                 Server:  Jordan Reyes    Fee:
Phone 435-986-1200

 Case     900904528                     Plaintiff     AVERY LANE HOLT
 Court    THIRD JUDICIAL DISTRICT COURT,  Defendant   NORTHGATE LOGISTICS, LLC et. al.
          STATE OF UTAH - MATHESON
 Documents      UT Subpoena; Notice to Persons Served with a Subpoena; Check VV787 $18.50
 Instructions
 Start attempts on or after June 26. BUSINESS ADDRESS.
 UTAH SUBPOENA - Attempt to personally serve; however if unable, may be sub-served on the 1st
 attempt to any resident of the abode who is 18 years of age or older. Individuals must be
 personally served at their place of employment. Service allowed 7 days a week.

 Diligence is 1 between 6AM-9AM, 1 between 9AM-6PM and 1 between 6PM-9PM.
 One attempt must be on Saturday or Sunday.

Address                                    Dana Whitfield
1180 East Vine Street STE 105, Salt Lake City, UT 84121
```

- [ ] **Step 4: Write the expected-extraction file**

```json
{
  "business-subpoena": {
    "recipient_type": "business",
    "recipient_business_name": "Northgate Logistics, LLC",
    "recipient_address": "1400 West Confluence Ave Ste 310",
    "recipient_city": "Salt Lake City",
    "recipient_state": "UT",
    "recipient_zip": "84104",
    "job_number": "90000001",
    "client_reference": "90000002",
    "service_deadline": "2026-06-26",
    "priority": "rush",
    "document_type": "subpoena",
    "address_class": "business",
    "service_days_allowed": "friday",
    "client_attempt_schedule": "09:00-15:30",
    "witness_fee_instrument": "",
    "registered_agent_address": "1400 West Confluence Ave Ste 310, Salt Lake City, UT 84104"
  },
  "individual-employment": {
    "recipient_type": "person",
    "recipient_first_name": "Dana",
    "recipient_last_name": "Whitfield",
    "recipient_address": "1180 East Vine Street STE 105",
    "recipient_city": "Salt Lake City",
    "recipient_state": "UT",
    "recipient_zip": "84121",
    "job_number": "90000003",
    "client_reference": "AZ900001E",
    "case_number": "900904528",
    "plaintiff": "AVERY LANE HOLT",
    "defendant": "NORTHGATE LOGISTICS, LLC",
    "service_deadline": "2026-06-30",
    "document_type": "subpoena",
    "address_class": "business",
    "attempt_start_not_before": "2026-06-26",
    "witness_fee_instrument": "Check VV787 $18.50",
    "witness_fee_tendered": "yes",
    "client_attempt_schedule": "06:00-09:00;09:00-18:00;18:00-21:00",
    "service_days_allowed": "all",
    "sub_service_authorized_first_attempt": "yes"
  }
}
```

- [ ] **Step 5: Write the harness test**

```ts
// tests/serveIntakeFixtures.test.ts
// ============================================================
// Serve Intake golden-fixture harness
// ============================================================
// Fixtures are SYNTHETIC derivatives — see tests/fixtures/serve-intake/README.md.
// This suite pins the DETERMINISTIC layer only (pre-clean + normalization).
// Model-dependent extraction accuracy is measured by the A/B harness in
// Task 5, which is opt-in because it spends neurons.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { precleanText } from '../src/utils/serveIntakePreclean';

const FIXTURE_DIR = join(__dirname, 'fixtures', 'serve-intake');

export function loadFixture(name: string): string {
  return readFileSync(join(FIXTURE_DIR, `${name}.txt`), 'utf8');
}

export function loadExpected(): Record<string, Record<string, string>> {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, 'expected.json'), 'utf8'));
}

describe('fixture corpus integrity', () => {
  it('carries no real client identities', () => {
    // Guard against a real packet being pasted in later. These are the
    // parties in the live packets this corpus was derived from.
    const forbidden = ['Telarus', 'Anderson', 'Clough', 'Foothill', 'Telarus, LLC', 'Currie'];
    for (const name of ['business-subpoena', 'individual-employment']) {
      const text = loadFixture(name);
      for (const f of forbidden) {
        expect(text.toLowerCase()).not.toContain(f.toLowerCase());
      }
    }
  });

  it('every fixture has an expected block', () => {
    const expected = loadExpected();
    expect(Object.keys(expected).sort()).toEqual(['business-subpoena', 'individual-employment']);
  });
});

describe('pre-clean against real hazards', () => {
  it('removes the RUSH watermark bleed from the business fixture', () => {
    const cleaned = precleanText(loadFixture('business-subpoena'));
    expect(cleaned).not.toMatch(/^\s*[HSUR]\s*$/m);
    // The real content around the bleed must survive.
    expect(cleaned).toContain('UT Subpoena');
    expect(cleaned).toContain('Northgate Logistics, LLC');
  });

  it('preserves the witness-fee instrument in the individual fixture', () => {
    const cleaned = precleanText(loadFixture('individual-employment'));
    expect(cleaned).toContain('Check VV787 $18.50');
  });

  it('preserves the client diligence schedule verbatim', () => {
    const cleaned = precleanText(loadFixture('individual-employment'));
    expect(cleaned).toContain('1 between 6AM-9AM');
    expect(cleaned).toContain('One attempt must be on Saturday or Sunday');
  });

  it('is idempotent across the whole corpus', () => {
    for (const name of ['business-subpoena', 'individual-employment']) {
      const once = precleanText(loadFixture(name));
      expect(precleanText(once)).toBe(once);
    }
  });
});
```

- [ ] **Step 6: Run the harness**

Run: `npx vitest run tests/serveIntakeFixtures.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 7: Commit**

```bash
git add tests/fixtures/serve-intake tests/serveIntakeFixtures.test.ts
git commit -m "test(serve-intake): golden-fixture harness with synthetic packets"
```

---

### Task 4: Adopt `env.AI.toMarkdown()` for PDF text

Spec items 5–6. Replaces the container round-trip with a structured, zero-neuron conversion.

**Files:**
- Modify: `src/utils/serveIntakeExtract.ts` (add beside `extractTextFromPdf`, line 558)
- Test: `tests/serveIntakePdfText.test.ts`

**Interfaces:**
- Consumes: `precleanText` (Task 2).
- Produces: `extractPdfMarkdown(ai, bytes, fileName): Promise<PdfTextResult>` where
  `PdfTextResult = { text: string; source: 'tomarkdown' | 'container' | 'empty'; structured: boolean; page_count: number }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/serveIntakePdfText.test.ts
import { describe, it, expect, vi } from 'vitest';
import { extractPdfMarkdown, isScanStub } from '../src/utils/serveIntakeExtract';

const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);   // "%PDF"

function fakeAi(result: unknown) {
  return { toMarkdown: vi.fn().mockResolvedValue(result) } as any;
}

describe('extractPdfMarkdown', () => {
  it('returns pre-cleaned markdown when toMarkdown succeeds', async () => {
    const ai = fakeAi({
      name: 'doc.pdf', format: 'markdown', mimetype: 'application/pdf',
      data: '## Contents\n### Page 1\nPalo Alto, СA 94304',
    });
    const out = await extractPdfMarkdown(ai, bytes, 'doc.pdf');
    expect(out.source).toBe('tomarkdown');
    expect(out.structured).toBe(true);
    expect(out.text).toContain('CA 94304');   // homoglyph fixed by pre-clean
  });

  it('reports unstructured when toMarkdown returns no heading structure', async () => {
    const ai = fakeAi({ name: 'doc.pdf', format: 'markdown', data: 'flat text only' });
    const out = await extractPdfMarkdown(ai, bytes, 'doc.pdf');
    expect(out.structured).toBe(false);
  });

  it('returns empty rather than throwing when toMarkdown reports an error format', async () => {
    const ai = fakeAi({ name: 'doc.pdf', format: 'error', error: 'unsupported' });
    const out = await extractPdfMarkdown(ai, bytes, 'doc.pdf');
    expect(out.source).toBe('empty');
    expect(out.text).toBe('');
  });

  it('returns empty when the binding throws, so the caller can fall back', async () => {
    const ai = { toMarkdown: vi.fn().mockRejectedValue(new Error('boom')) } as any;
    const out = await extractPdfMarkdown(ai, bytes, 'doc.pdf');
    expect(out.source).toBe('empty');
  });

  it('accepts an array response and picks the matching document', async () => {
    const ai = fakeAi([{ name: 'doc.pdf', format: 'markdown', data: '# A\ncontent here' }]);
    const out = await extractPdfMarkdown(ai, bytes, 'doc.pdf');
    expect(out.text).toContain('content here');
  });
});

describe('isScanStub', () => {
  it('flags a page with almost no extractable text', () => {
    expect(isScanStub('', 1)).toBe(true);
    expect(isScanStub('  \n \n', 1)).toBe(true);
  });

  it('does not flag a page with real content', () => {
    expect(isScanStub('Case 900904528 Plaintiff AVERY LANE HOLT', 1)).toBe(false);
  });

  it('scales the threshold with page count', () => {
    const thin = 'x'.repeat(100);
    expect(isScanStub(thin, 10)).toBe(true);    // 10 chars/page — a scan
    expect(isScanStub(thin, 1)).toBe(false);    // 100 chars on 1 page — thin but real
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/serveIntakePdfText.test.ts`
Expected: FAIL — `extractPdfMarkdown is not exported`.

- [ ] **Step 3: Write minimal implementation**

```ts
// Add to src/utils/serveIntakeExtract.ts, directly ABOVE extractTextFromPdf (line 558).
// Also add at the top of the file:  import { precleanText } from './serveIntakePreclean';

// ── Structured PDF text via Workers AI Markdown Conversion ────
// env.AI.toMarkdown() converts PDFs WITHOUT invoking a model: it walks
// the PDF StructTree (ISO 14289 / PDF-UA) and emits semantic Markdown,
// falling back to raw text extraction when no structure tree exists.
// That means it costs ZERO neurons and — critically — it does not
// interleave the two-column Information Form the way positional text
// extraction does.
//
// Verified against the Cloudflare docs 2026-07-26. Prefer this over the
// container /extract-text round-trip; keep the container as fallback for
// documents toMarkdown cannot read.

export interface PdfTextResult {
  text: string;
  source: 'tomarkdown' | 'container' | 'empty';
  structured: boolean;     // true when the converter produced heading structure
  page_count: number;
}

interface ConversionResult {
  name?: string;
  format?: 'markdown' | 'text' | 'error';
  data?: string;
  error?: string;
}

// A "### Page N" or any ATX heading indicates the StructTree path ran.
const HAS_STRUCTURE = /^#{1,6}\s+\S/m;

export async function extractPdfMarkdown(
  ai: { toMarkdown: (files: unknown) => Promise<unknown> },
  pdfBytes: Uint8Array,
  fileName: string,
): Promise<PdfTextResult> {
  const empty: PdfTextResult = { text: '', source: 'empty', structured: false, page_count: 0 };
  try {
    const raw = await ai.toMarkdown({
      name: fileName,
      blob: new Blob([pdfBytes], { type: 'application/pdf' }),
    });
    const list: ConversionResult[] = Array.isArray(raw) ? raw as ConversionResult[] : [raw as ConversionResult];
    const doc = list.find((d) => d?.name === fileName) ?? list[0];
    if (!doc || doc.format === 'error' || !doc.data) return empty;

    const structured = HAS_STRUCTURE.test(doc.data);
    // Page count is derivable from the converter's own page headings.
    const page_count = (doc.data.match(/^#{2,4}\s+Page\s+\d+/gim) || []).length;
    return {
      text: precleanText(doc.data),
      source: 'tomarkdown',
      structured,
      page_count,
    };
  } catch {
    // Binding unavailable or conversion blew up — the caller falls back to
    // the container path. Never throw: a single unreadable document must
    // not fail the whole packet.
    return empty;
  }
}

// A document whose text layer is a scan stub needs vision OCR. Threshold
// is per-page so a 10-page scan isn't rescued by one page of metadata.
const MIN_CHARS_PER_PAGE = 40;

export function isScanStub(text: string, pageCount: number): boolean {
  const len = (text || '').trim().length;
  if (len === 0) return true;
  const pages = Math.max(1, pageCount || 1);
  return len / pages < MIN_CHARS_PER_PAGE;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/serveIntakePdfText.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Wire it into the upload route ahead of the container**

In `src/routes/serveIntake.ts`, at both container call sites (lines ~352 and ~506), try `extractPdfMarkdown` first and fall back:

```ts
// Replace:  const { text, page_count } = await extractTextFromPdf(container, bytes, file.name || 'doc.pdf');
// With:
const md = await extractPdfMarkdown(c.env.AI, bytes, file.name || 'doc.pdf');
let text = md.text;
let page_count = md.page_count;
let textSource: string = md.source;
if (!text || isScanStub(text, page_count)) {
  const fallback = await extractTextFromPdf(container, bytes, file.name || 'doc.pdf');
  text = precleanText(fallback.text);
  page_count = fallback.page_count;
  textSource = 'container';
}
log.info('serve-intake pdf text', {
  file: file.name, source: textSource, structured: md.structured, chars: text.length, page_count,
});
```

Add `extractPdfMarkdown, isScanStub` to the import block at `src/routes/serveIntake.ts:43-47`, and `import { precleanText } from '../utils/serveIntakePreclean';`.

- [ ] **Step 6: Verify the worker still typechecks and the suite is green**

Run: `npm run typecheck && npx vitest run`
Expected: 0 type errors; 262 test files passing (261 baseline + the new file).

- [ ] **Step 7: Commit**

```bash
git add src/utils/serveIntakeExtract.ts src/routes/serveIntake.ts tests/serveIntakePdfText.test.ts
git commit -m "feat(serve-intake): structured PDF text via toMarkdown, container as fallback"
```

---

### Task 5: Model A/B harness — resolve the LoRA question before swapping

Spec items 7–8 plus the §6 model-recency risk. **This task decides whether the model swap happens at all.** Do not skip it.

**Files:**
- Create: `scripts/serve-intake-model-ab.ts`
- Modify: `src/utils/serveIntakeExtract.ts` (model constants only)

**Interfaces:**
- Consumes: fixtures from Task 3, `precleanText` from Task 2.
- Produces: `EXTRACTION_MODELS` constant map; a printed accuracy table.

- [ ] **Step 1: Determine whether the LoRA is actually configured**

```bash
npx wrangler secret list 2>/dev/null | grep -i lora || echo "SERVE_INTAKE_LORA not set as a secret"
grep -rn "SERVE_INTAKE_LORA" wrangler.toml src/types.ts
```

Expected: one of two outcomes, and they lead to different steps.
- **Not set** → the stock 70B runs today. The swap is clean; record this in the commit message and continue to Step 2.
- **Set** → a fine-tune is live. The adapter is bound to `@cf/meta/llama-3.3-70b-instruct-fp8-fast`; Llama 4 Scout cannot use it. Continue to Step 2, but the A/B must compare **Scout-without-LoRA against 70B-with-LoRA**, and a Scout win must exceed the LoRA's contribution to justify the swap.

- [ ] **Step 2: Add the model constant map**

```ts
// Replace lines 24-25 of src/utils/serveIntakeExtract.ts
// ── Model selection ───────────────────────────────────────────
// Catalog + neuron costs verified against the live Cloudflare pricing
// page 2026-07-26. Llama 4 Scout bills 77,273 neurons/M output against
// Llama 3.3 70B's 204,805 — the upgrade REDUCES spend (~312 vs ~520
// neurons for a 3-document packet) while adding native multimodality
// and a 10M-token context.
//
// ⚠️ SERVE_INTAKE_LORA is bound to TEXT_MODEL_LEGACY. A LoRA adapter
// cannot transfer to a different base model. If the LoRA is configured,
// selecting TEXT_MODEL_SCOUT silently drops the fine-tune — which is why
// scripts/serve-intake-model-ab.ts must run before the default changes.
export const TEXT_MODEL_LEGACY = '@cf/meta/llama-3.3-70b-instruct-fp8-fast' as const;
export const TEXT_MODEL_SCOUT = '@cf/meta/llama-4-scout-17b-16e-instruct' as const;
export const VISION_MODEL_LEGACY = '@cf/meta/llama-3.2-11b-vision-instruct' as const;
export const VISION_MODEL_MOONDREAM = '@cf/moondream/moondream3.1-9B-A2B' as const;

// Defaults stay on the incumbents until the A/B says otherwise (Task 5).
const TEXT_MODEL = TEXT_MODEL_LEGACY;
const VISION_MODEL = VISION_MODEL_LEGACY;
```

- [ ] **Step 3: Write the A/B script**

```ts
// scripts/serve-intake-model-ab.ts
// ============================================================
// Serve Intake — extraction model A/B
// ============================================================
// Spends neurons. Run deliberately, not in CI.
//
//   npx tsx scripts/serve-intake-model-ab.ts
//
// Grades each candidate model against tests/fixtures/serve-intake/expected.json
// and prints a per-field accuracy table. The winner becomes the default in
// serveIntakeExtract.ts — this script is the evidence for that edit.
// ============================================================

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURE_DIR = join(process.cwd(), 'tests', 'fixtures', 'serve-intake');
const API = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run`;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;

const CANDIDATES = [
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/meta/llama-4-scout-17b-16e-instruct',
  '@cf/mistralai/mistral-small-3.1-24b-instruct',
];

if (!TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
  console.error('Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.');
  process.exit(1);
}

async function runModel(model: string, text: string): Promise<Record<string, string>> {
  const { buildExtractionMessages } = await import('../src/utils/serveIntakeExtract');
  const res = await fetch(`${API}/${model}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: buildExtractionMessages(text),
      temperature: 0.1,
      max_tokens: 2048,
    }),
  });
  if (!res.ok) {
    console.error(`  ${model}: HTTP ${res.status}`);
    return {};
  }
  const body = await res.json() as { result?: { response?: string } };
  const raw = body.result?.response ?? '';
  try {
    const jsonStart = raw.indexOf('{');
    return JSON.parse(raw.slice(jsonStart)).fields ?? JSON.parse(raw.slice(jsonStart));
  } catch {
    console.error(`  ${model}: unparseable response`);
    return {};
  }
}

function scoreOne(got: Record<string, unknown>, want: Record<string, string>) {
  let hit = 0;
  const misses: string[] = [];
  for (const [k, expected] of Object.entries(want)) {
    if (!expected) continue;
    const actual = String((got as any)?.[k]?.value ?? (got as any)?.[k] ?? '').trim();
    if (actual.toLowerCase() === expected.toLowerCase()) hit++;
    else misses.push(`${k}: want "${expected}", got "${actual}"`);
  }
  const total = Object.values(want).filter(Boolean).length;
  return { hit, total, misses };
}

async function main() {
  const expected = JSON.parse(readFileSync(join(FIXTURE_DIR, 'expected.json'), 'utf8'));
  const fixtures = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.txt'));

  for (const model of CANDIDATES) {
    let hit = 0, total = 0;
    console.log(`\n=== ${model}`);
    for (const file of fixtures) {
      const name = file.replace(/\.txt$/, '');
      const want = expected[name];
      if (!want) continue;
      const text = readFileSync(join(FIXTURE_DIR, file), 'utf8');
      const got = await runModel(model, text);
      const s = scoreOne(got, want);
      hit += s.hit; total += s.total;
      console.log(`  ${name}: ${s.hit}/${s.total}`);
      for (const m of s.misses) console.log(`      ${m}`);
    }
    console.log(`  TOTAL: ${hit}/${total} (${total ? Math.round((hit / total) * 100) : 0}%)`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: Run the A/B**

Run: `npx tsx scripts/serve-intake-model-ab.ts`
Expected: a per-model accuracy table. Record the numbers in the commit message.

- [ ] **Step 5: Set the default from the evidence**

If a candidate beats the incumbent, change the two default lines in `src/utils/serveIntakeExtract.ts`:

```ts
const TEXT_MODEL = TEXT_MODEL_SCOUT;
```

If the incumbent wins (or the LoRA's contribution exceeds Scout's margin), **leave the defaults alone** and record why in the commit. A model swap that loses accuracy is a regression regardless of cost.

- [ ] **Step 6: Run the full suite**

Run: `npm run typecheck && npx vitest run`
Expected: 0 type errors, all tests passing.

- [ ] **Step 7: Commit**

```bash
git add scripts/serve-intake-model-ab.ts src/utils/serveIntakeExtract.ts
git commit -m "feat(serve-intake): model A/B harness; default set from measured accuracy"
```

---

### Task 6: New extraction fields — timing and service constraints

Spec items 13–16.

**Files:**
- Modify: `src/utils/serveIntakeExtract.ts` (`TARGET_FIELDS`, `SYSTEM_PROMPT`, normalizer sets)
- Test: `tests/serveIntakeExtract.test.ts`

**Interfaces:**
- Consumes: existing `normalizeFields` dispatcher.
- Produces: four new `TargetField` members — `address_class`, `service_days_allowed`, `client_attempt_schedule`, `attempt_start_not_before` — plus `normalizeAddressClass(raw): string`.

- [ ] **Step 1: Write the failing test**

```ts
// Append to tests/serveIntakeExtract.test.ts
import { normalizeAddressClass } from '../src/utils/serveIntakeExtract';

describe('normalizeAddressClass', () => {
  it('recognizes explicit business language', () => {
    expect(normalizeAddressClass('BUSINESS ADDRESS')).toBe('business');
    expect(normalizeAddressClass('place of employment')).toBe('business');
  });

  it('recognizes residential language', () => {
    expect(normalizeAddressClass('residence')).toBe('residential');
    expect(normalizeAddressClass('abode')).toBe('residential');
  });

  it('returns unknown for anything it cannot confirm', () => {
    expect(normalizeAddressClass('')).toBe('unknown');
    expect(normalizeAddressClass('see instructions')).toBe('unknown');
  });

  it('does NOT infer business from a registered-agent mention', () => {
    // Operator decision D-2: class is a property of the LOCATION, and a
    // registered agent may sit at a residence.
    expect(normalizeAddressClass('registered agent')).toBe('unknown');
  });
});

describe('new timing fields flow through normalizeFields', () => {
  it('normalizes the start-date bar to ISO', () => {
    const out = normalizeFields(fieldsFrom({ attempt_start_not_before: '6/26/2026' }));
    expect(out.attempt_start_not_before.value).toBe('2026-06-26');
  });

  it('drops an unparseable start-date rather than guessing', () => {
    const out = normalizeFields(fieldsFrom({ attempt_start_not_before: 'after the holiday' }));
    expect(out.attempt_start_not_before.value).toBe('');
    expect(out.attempt_start_not_before.confidence).toBe(0);
  });

  it('canonicalizes address_class', () => {
    const out = normalizeFields(fieldsFrom({ address_class: 'BUSINESS ADDRESS' }));
    expect(out.address_class.value).toBe('business');
  });

  it('preserves the client attempt schedule verbatim', () => {
    const out = normalizeFields(fieldsFrom({ client_attempt_schedule: '06:00-09:00;09:00-18:00' }));
    expect(out.client_attempt_schedule.value).toBe('06:00-09:00;09:00-18:00');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/serveIntakeExtract.test.ts`
Expected: FAIL — `normalizeAddressClass is not exported`.

- [ ] **Step 3: Write minimal implementation**

Add to `TARGET_FIELDS` (after `'process_type', 'service_windows', 'service_instructions',`):

```ts
  // ── Timing & service constraints (PR 1, 2026-07-26) ───────
  // address_class is a property of the LOCATION, never the recipient —
  // a registered agent may sit at a residence and must then get
  // residential attempt windows (operator decision D-2).
  'address_class',                  // residential | business | unknown
  'service_days_allowed',           // 'all' | 'weekdays' | 'friday' | 'no_sunday' | free text
  'client_attempt_schedule',        // 'HH:MM-HH:MM;HH:MM-HH:MM' verbatim bands
  'attempt_start_not_before',       // ISO date — "start attempts on or after X"
```

Add the normalizer:

```ts
// Address class drives which attempt-window defaults apply. Only
// CONFIRMED business language yields 'business'; everything else falls to
// 'unknown', which the planner treats as residential (wider windows —
// being wrong that way costs a wasted window, not a missed service).
const BUSINESS_HINTS = /\b(business address|place of employment|commercial|office|suite|corporate address)\b/i;
const RESIDENTIAL_HINTS = /\b(residen\w*|abode|dwelling|home address|apartment|apt\b)/i;

export function normalizeAddressClass(raw: string): string {
  const s = (raw || '').trim();
  if (!s) return 'unknown';
  const lower = s.toLowerCase();
  if (lower === 'business' || lower === 'residential' || lower === 'unknown') return lower;
  if (BUSINESS_HINTS.test(s)) return 'business';
  if (RESIDENTIAL_HINTS.test(s)) return 'residential';
  return 'unknown';
}
```

Register it in the dispatcher — add above `normalizeFields`:

```ts
const ADDRESS_CLASS_FIELDS = new Set<TargetField>(['address_class']);
```

and add `'attempt_start_not_before'` to the existing `DATE_FIELDS` set, then inside `normalizeFields`'s `if (value) { ... }` chain, before the `NAME_FIELDS` branch:

```ts
      else if (ADDRESS_CLASS_FIELDS.has(key)) next = normalizeAddressClass(value);
```

Extend `SYSTEM_PROMPT` with the field guidance (append before the closing backtick):

```
TIMING & SERVICE CONSTRAINTS — read the Instructions block carefully:
• address_class — 'business' ONLY when the document says the service address is a business,
  office, suite, or place of employment. 'residential' for a residence/abode/dwelling.
  'unknown' otherwise. A "registered agent" mention is NOT evidence of a business address —
  agents are frequently at residences.
• service_days_allowed — e.g. "Service allowed 7 days a week" → 'all';
  "NO SERVICE ON SUNDAY" → 'no_sunday'; "SERVE ON FRIDAY" → 'friday'.
• client_attempt_schedule — when the client dictates attempt bands ("1 between 6AM-9AM,
  1 between 9AM-6PM and 1 between 6PM-9PM"), emit them as 24h ranges joined by semicolons:
  "06:00-09:00;09:00-18:00;18:00-21:00". Empty when the client dictates nothing.
• attempt_start_not_before — "Start attempts on or after June 26" → the ISO date.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/serveIntakeExtract.test.ts`
Expected: PASS — existing tests plus 8 new.

- [ ] **Step 5: Commit**

```bash
git add src/utils/serveIntakeExtract.ts tests/serveIntakeExtract.test.ts
git commit -m "feat(serve-intake): extract address class and client timing constraints"
```

---

### Task 7: New extraction fields — witness fee, agent address, sub-service

Spec items 17–19.

**Files:**
- Modify: `src/utils/serveIntakeExtract.ts`
- Test: `tests/serveIntakeExtract.test.ts`

**Interfaces:**
- Consumes: Task 6's field additions.
- Produces: `witness_fee_tendered`, `witness_fee_instrument`, `registered_agent_address`, `sub_service_authorized_first_attempt` as `TargetField` members; `normalizeYesNo(raw): string`.

- [ ] **Step 1: Write the failing test**

```ts
// Append to tests/serveIntakeExtract.test.ts
import { normalizeYesNo } from '../src/utils/serveIntakeExtract';

describe('normalizeYesNo', () => {
  it('maps affirmative forms to yes', () => {
    expect(normalizeYesNo('Yes')).toBe('yes');
    expect(normalizeYesNo('TRUE')).toBe('yes');
    expect(normalizeYesNo('y')).toBe('yes');
  });

  it('maps negative forms to no', () => {
    expect(normalizeYesNo('No')).toBe('no');
    expect(normalizeYesNo('false')).toBe('no');
  });

  it('returns empty for anything ambiguous', () => {
    expect(normalizeYesNo('maybe')).toBe('');
    expect(normalizeYesNo('')).toBe('');
  });
});

describe('witness fee and agent address fields', () => {
  it('keeps the witness-fee instrument verbatim', () => {
    const out = normalizeFields(fieldsFrom({ witness_fee_instrument: 'Check VV787 $18.50' }));
    expect(out.witness_fee_instrument.value).toBe('Check VV787 $18.50');
  });

  it('canonicalizes the tendered flag', () => {
    const out = normalizeFields(fieldsFrom({ witness_fee_tendered: 'TRUE' }));
    expect(out.witness_fee_tendered.value).toBe('yes');
  });

  it('de-noises the registered agent address like other name fields', () => {
    const out = normalizeFields(fieldsFrom({
      registered_agent_address: '1400 West Confluence Ave Ste 310, Salt Lake City, UT 84104',
    }));
    expect(out.registered_agent_address.value).toContain('1400 West Confluence Ave');
  });

  it('canonicalizes the first-attempt sub-service authorization', () => {
    const out = normalizeFields(fieldsFrom({ sub_service_authorized_first_attempt: 'yes' }));
    expect(out.sub_service_authorized_first_attempt.value).toBe('yes');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/serveIntakeExtract.test.ts`
Expected: FAIL — `normalizeYesNo is not exported`.

- [ ] **Step 3: Write minimal implementation**

Add to `TARGET_FIELDS`, after the Task 6 block:

```ts
  // ── Physical items & service authority (PR 1, 2026-07-26) ──
  // A witness fee is a THING the server must carry. It appears inside the
  // Documents list ("Check VV787 $18.50") and was previously invisible to
  // the officer until they opened the packet.
  'witness_fee_tendered',                    // yes | no | ''
  'witness_fee_instrument',                  // verbatim, e.g. 'Check VV787 $18.50'
  'registered_agent_address',                // distinct from recipient_address
  'sub_service_authorized_first_attempt',    // yes | no | ''
```

Add the normalizer:

```ts
// Tri-state: 'yes' | 'no' | '' (unknown). Never guess — an unknown
// sub-service authorization must read as unknown, not as permission.
export function normalizeYesNo(raw: string): string {
  const s = (raw || '').trim().toLowerCase();
  if (!s) return '';
  if (/^(y|yes|true|1|authorized|permitted|allowed)$/.test(s)) return 'yes';
  if (/^(n|no|false|0|not authorized|prohibited|denied)$/.test(s)) return 'no';
  return '';
}
```

Register in the dispatcher:

```ts
const YES_NO_FIELDS = new Set<TargetField>([
  'witness_fee_tendered', 'sub_service_authorized_first_attempt',
]);
```

Add `'registered_agent_address'` to the existing `NAME_FIELDS` set, and add this branch inside `normalizeFields` before `NAME_FIELDS`:

```ts
      else if (YES_NO_FIELDS.has(key)) next = normalizeYesNo(value);
```

Extend `SYSTEM_PROMPT`:

```
PHYSICAL ITEMS & SERVICE AUTHORITY:
• witness_fee_instrument — a subpoena packet often lists a witness-fee check inside the
  documents line ("Check VV787 $18.50"). Copy it VERBATIM. Set witness_fee_tendered='yes'
  when such an instrument is listed, 'no' when the document says no fee is tendered, else ''.
• registered_agent_address — the agent's service address when it differs from the entity's
  own address (e.g. a corporate-agent service company). Empty when they are the same.
• sub_service_authorized_first_attempt — 'yes' when the client expressly permits substitute
  service on the FIRST attempt ("may be sub-served on the 1st attempt"), else ''.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/serveIntakeExtract.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/serveIntakeExtract.ts tests/serveIntakeExtract.test.ts
git commit -m "feat(serve-intake): extract witness fee, agent address, sub-service authority"
```

---

### Task 8: Deterministic post-validator and confidence recalibration

Spec items 11–12.

**Files:**
- Create: `src/utils/serveIntakeValidate.ts`
- Test: `tests/serveIntakeValidate.test.ts`

**Interfaces:**
- Consumes: `ExtractedField`, `TargetField` from `serveIntakeExtract`.
- Produces: `validateFields(fields): ValidationReport` where
  `ValidationReport = { issues: ValidationIssue[]; adjusted: Record<string, ExtractedField> }`
  and `ValidationIssue = { field: string; severity: 'warn' | 'error'; message: string }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/serveIntakeValidate.test.ts
import { describe, it, expect } from 'vitest';
import { validateFields } from '../src/utils/serveIntakeValidate';
import { TARGET_FIELDS, type ExtractedField } from '../src/utils/serveIntakeExtract';

function fieldsFrom(values: Record<string, string>, conf = 0.9): Record<string, ExtractedField> {
  const out: Record<string, ExtractedField> = {};
  for (const f of TARGET_FIELDS) out[f] = { value: values[f] ?? '', confidence: values[f] ? conf : 0 };
  return out;
}

describe('validateFields', () => {
  it('flags a ZIP that does not belong to the stated state', () => {
    const r = validateFields(fieldsFrom({ recipient_state: 'UT', recipient_zip: '94304' }));
    expect(r.issues.some((i) => i.field === 'recipient_zip' && i.severity === 'error')).toBe(true);
  });

  it('accepts a ZIP consistent with the state', () => {
    const r = validateFields(fieldsFrom({ recipient_state: 'UT', recipient_zip: '84121' }));
    expect(r.issues.filter((i) => i.field === 'recipient_zip')).toHaveLength(0);
  });

  it('flags a phone without 10 digits', () => {
    const r = validateFields(fieldsFrom({ recipient_phone: '43598612' }));
    expect(r.issues.some((i) => i.field === 'recipient_phone')).toBe(true);
  });

  it('flags a service deadline in the past relative to the reference date', () => {
    const r = validateFields(fieldsFrom({ service_deadline: '2020-01-01' }), '2026-07-26T00:00:00Z');
    expect(r.issues.some((i) => i.field === 'service_deadline')).toBe(true);
  });

  it('lowers confidence on a field that failed validation', () => {
    const r = validateFields(fieldsFrom({ recipient_state: 'UT', recipient_zip: '94304' }));
    expect(r.adjusted.recipient_zip.confidence).toBeLessThan(0.9);
  });

  it('raises confidence on a field that passed every applicable check', () => {
    const r = validateFields(fieldsFrom({ recipient_state: 'UT', recipient_zip: '84121' }));
    expect(r.adjusted.recipient_zip.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('reports no issues for an empty field map', () => {
    const r = validateFields(fieldsFrom({}));
    expect(r.issues).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/serveIntakeValidate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/utils/serveIntakeValidate.ts
// ============================================================
// RMPG Flex — Serve Intake deterministic validation
// ============================================================
// The model self-reports confidence, and it is optimistic. This module
// checks what can be checked WITHOUT a model and folds the result back
// into the score, so a field that contradicts itself ("UT" + a 943xx ZIP)
// cannot present as high-confidence on the review screen.
//
// Pure — no I/O, no clock read (the caller passes nowIso).
// ============================================================

import type { ExtractedField } from './serveIntakeExtract';

export interface ValidationIssue {
  field: string;
  severity: 'warn' | 'error';
  message: string;
}

export interface ValidationReport {
  issues: ValidationIssue[];
  adjusted: Record<string, ExtractedField>;
}

// First three ZIP digits by state — enough to catch a cross-state paste
// without shipping a full ZIP database into the Worker bundle.
const STATE_ZIP_PREFIX: Record<string, RegExp> = {
  UT: /^84[0-7]/,
  CA: /^9[0-5]/,
  AZ: /^85|^86/,
  NV: /^89/,
  ID: /^83/,
  WY: /^82|^83[01]/,
  CO: /^80|^81/,
  NY: /^1[0-4]/,
  TX: /^7[5-9]/,
};

const CONFIDENCE_PENALTY = 0.4;   // multiplicative on a failed check
const CONFIDENCE_BONUS = 1.05;    // small lift when a check actively passed

export function validateFields(
  fields: Record<string, ExtractedField>,
  nowIso = '2026-01-01T00:00:00Z',
): ValidationReport {
  const issues: ValidationIssue[] = [];
  const adjusted: Record<string, ExtractedField> = {};
  for (const [k, v] of Object.entries(fields)) adjusted[k] = { ...v };

  const val = (k: string) => (fields[k]?.value || '').trim();

  const penalize = (field: string, severity: 'warn' | 'error', message: string) => {
    issues.push({ field, severity, message });
    if (adjusted[field]) {
      adjusted[field].confidence = Math.max(0, adjusted[field].confidence * CONFIDENCE_PENALTY);
    }
  };
  const reward = (field: string) => {
    if (adjusted[field]) {
      adjusted[field].confidence = Math.min(1, adjusted[field].confidence * CONFIDENCE_BONUS);
    }
  };

  // ZIP ↔ state agreement
  const state = val('recipient_state');
  const zip = val('recipient_zip');
  if (state && zip && STATE_ZIP_PREFIX[state]) {
    if (STATE_ZIP_PREFIX[state].test(zip)) reward('recipient_zip');
    else penalize('recipient_zip', 'error', `ZIP ${zip} is not consistent with state ${state}`);
  }

  // Phone digit count — normalizePhone already stripped punctuation.
  for (const f of ['recipient_phone', 'attorney_phone']) {
    const p = val(f);
    if (!p) continue;
    if (/^\d{10}$/.test(p)) reward(f);
    else penalize(f, 'warn', `Phone "${p}" is not 10 digits`);
  }

  // Dates must be real and, for the deadline, not already past.
  const nowMs = Date.parse(nowIso);
  for (const f of ['service_deadline', 'hearing_date', 'filing_date', 'attempt_start_not_before']) {
    const d = val(f);
    if (!d) continue;
    const ms = Date.parse(`${d}T00:00:00Z`);
    if (Number.isNaN(ms)) {
      penalize(f, 'error', `"${d}" is not a parseable date`);
      continue;
    }
    if (f === 'service_deadline' && ms < nowMs) {
      penalize(f, 'error', `Service deadline ${d} is already past`);
      continue;
    }
    reward(f);
  }

  return { issues, adjusted };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/serveIntakeValidate.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Wire it into the commit path**

In `src/routes/serveIntake.ts` at line ~602, after `const normalizedFields = normalizeFields(mergedFields);`:

```ts
const validation = validateFields(normalizedFields, new Date().toISOString());
if (validation.issues.length) {
  log.warn('serve-intake validation issues', {
    count: validation.issues.length,
    issues: validation.issues.slice(0, 10),
  });
}
const validatedFields = validation.adjusted;
```

Then replace downstream uses of `normalizedFields` with `validatedFields` in that handler, and add `import { validateFields } from '../utils/serveIntakeValidate';`.

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npx vitest run`
Expected: 0 type errors, all green.

- [ ] **Step 7: Commit**

```bash
git add src/utils/serveIntakeValidate.ts tests/serveIntakeValidate.test.ts src/routes/serveIntake.ts
git commit -m "feat(serve-intake): deterministic validation with confidence recalibration"
```

---

### Task 9: Cross-document arbitration

Spec item 20.

**Files:**
- Create: `src/utils/serveIntakeArbitrate.ts`
- Test: `tests/serveIntakeArbitrate.test.ts`

**Interfaces:**
- Consumes: `ExtractedField` from `serveIntakeExtract`.
- Produces: `arbitrateFields(candidates: DocCandidate[]): ArbitrationResult` where
  `DocCandidate = { docType: string; fields: Record<string, ExtractedField> }` and
  `ArbitrationResult = { merged: Record<string, ExtractedField>; conflicts: FieldConflict[] }`,
  `FieldConflict = { field: string; chosen: string; chosenSource: string; rejected: Array<{ value: string; source: string }> }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/serveIntakeArbitrate.test.ts
import { describe, it, expect } from 'vitest';
import { arbitrateFields } from '../src/utils/serveIntakeArbitrate';

const f = (value: string, confidence = 0.9) => ({ value, confidence });

describe('arbitrateFields', () => {
  it('prefers the Information Form for service mechanics', () => {
    const r = arbitrateFields([
      { docType: 'field_sheet', fields: { service_instructions: f('OLD TEXT') } },
      { docType: 'info_page', fields: { service_instructions: f('NEW TEXT') } },
    ]);
    expect(r.merged.service_instructions.value).toBe('NEW TEXT');
  });

  it('prefers the Court Docket for the case caption', () => {
    const r = arbitrateFields([
      { docType: 'info_page', fields: { case_number: f('GUESS-1') } },
      { docType: 'court_filing', fields: { case_number: f('900904528') } },
    ]);
    expect(r.merged.case_number.value).toBe('900904528');
  });

  it('records the rejected candidate so the review UI can offer it', () => {
    const r = arbitrateFields([
      { docType: 'field_sheet', fields: { recipient_phone: f('4359861200') } },
      { docType: 'info_page', fields: { recipient_phone: f('8015551234') } },
    ]);
    const conflict = r.conflicts.find((c) => c.field === 'recipient_phone');
    expect(conflict?.chosen).toBe('8015551234');
    expect(conflict?.rejected.map((x) => x.value)).toContain('4359861200');
  });

  it('does not report a conflict when documents agree', () => {
    const r = arbitrateFields([
      { docType: 'field_sheet', fields: { recipient_state: f('UT') } },
      { docType: 'info_page', fields: { recipient_state: f('UT') } },
    ]);
    expect(r.conflicts).toHaveLength(0);
  });

  it('falls back to the highest-confidence value when no source outranks another', () => {
    const r = arbitrateFields([
      { docType: 'other', fields: { plaintiff: f('LOW', 0.2) } },
      { docType: 'other', fields: { plaintiff: f('HIGH', 0.95) } },
    ]);
    expect(r.merged.plaintiff.value).toBe('HIGH');
  });

  it('ignores empty candidates entirely', () => {
    const r = arbitrateFields([
      { docType: 'info_page', fields: { case_number: f('', 0) } },
      { docType: 'court_filing', fields: { case_number: f('900904528') } },
    ]);
    expect(r.merged.case_number.value).toBe('900904528');
    expect(r.conflicts).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/serveIntakeArbitrate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/utils/serveIntakeArbitrate.ts
// ============================================================
// RMPG Flex — Serve Intake cross-document arbitration
// ============================================================
// A packet is three documents that disagree. The Field Sheet's Case and
// Court cells are frequently blank (or watermark-corrupted) while the
// Court Docket has them authoritatively; the Information Form is the
// operational record for service mechanics.
//
// Rather than "last write wins", each field has a source precedence, and
// the LOSING candidate is retained so the review UI can offer it instead
// of silently discarding a value a human might prefer.
// ============================================================

import type { ExtractedField } from './serveIntakeExtract';

export interface DocCandidate {
  docType: string;                              // 'info_page' | 'field_sheet' | 'court_filing' | ...
  fields: Record<string, ExtractedField>;
}

export interface FieldConflict {
  field: string;
  chosen: string;
  chosenSource: string;
  rejected: Array<{ value: string; source: string }>;
}

export interface ArbitrationResult {
  merged: Record<string, ExtractedField>;
  conflicts: FieldConflict[];
}

// Higher wins. Service mechanics come from the operational record; the
// case caption comes from the court's own filing.
const MECHANICS_RANK: Record<string, number> = { info_page: 3, field_sheet: 2, court_filing: 1 };
const CAPTION_RANK: Record<string, number> = { court_filing: 3, info_page: 2, field_sheet: 1 };

const CAPTION_FIELDS = new Set([
  'case_number', 'court_name', 'jurisdiction', 'plaintiff', 'defendant',
  'filing_date', 'hearing_date', 'attorney_name', 'attorney_bar_number',
]);

function rankFor(field: string, docType: string): number {
  const table = CAPTION_FIELDS.has(field) ? CAPTION_RANK : MECHANICS_RANK;
  return table[docType] ?? 0;
}

export function arbitrateFields(candidates: DocCandidate[]): ArbitrationResult {
  const byField = new Map<string, Array<{ value: string; confidence: number; source: string }>>();

  for (const c of candidates) {
    for (const [field, ef] of Object.entries(c.fields)) {
      const value = (ef?.value || '').trim();
      if (!value) continue;                    // empty candidates never compete
      if (!byField.has(field)) byField.set(field, []);
      byField.get(field)!.push({ value, confidence: ef.confidence ?? 0, source: c.docType });
    }
  }

  const merged: Record<string, ExtractedField> = {};
  const conflicts: FieldConflict[] = [];

  for (const [field, entries] of byField) {
    // Sort by source precedence, then by model confidence as the tiebreak.
    const sorted = [...entries].sort((a, b) => {
      const r = rankFor(field, b.source) - rankFor(field, a.source);
      return r !== 0 ? r : b.confidence - a.confidence;
    });

    const winner = sorted[0];
    merged[field] = { value: winner.value, confidence: winner.confidence };

    const disagreeing = sorted.slice(1).filter(
      (e) => e.value.toLowerCase() !== winner.value.toLowerCase(),
    );
    if (disagreeing.length) {
      conflicts.push({
        field,
        chosen: winner.value,
        chosenSource: winner.source,
        rejected: disagreeing.map((e) => ({ value: e.value, source: e.source })),
      });
    }
  }

  return { merged, conflicts };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/serveIntakeArbitrate.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Persist conflicts for the PR 4 review UI**

In `src/routes/serveIntake.ts`, where `parsed_data._intake` is assembled, add:

```ts
_intake: {
  ...existingIntakeBlock,
  conflicts: arbitration.conflicts,     // consumed by the PR 4 conflict resolver
},
```

- [ ] **Step 6: Commit**

```bash
git add src/utils/serveIntakeArbitrate.ts tests/serveIntakeArbitrate.test.ts src/routes/serveIntake.ts
git commit -m "feat(serve-intake): cross-document arbitration retaining rejected candidates"
```

---

### Task 10: Document-family prompts and the bounded critic pass

Spec items 9–10.

**Files:**
- Modify: `src/utils/serveIntakeExtract.ts`
- Test: `tests/serveIntakeExtract.test.ts`

**Interfaces:**
- Consumes: `buildExtractionMessages` (existing), `validateFields` (Task 8).
- Produces: `buildFamilyPrompt(docType: string): string`, `needsCriticPass(fields, issues): string[]`.

- [ ] **Step 1: Write the failing test**

```ts
// Append to tests/serveIntakeExtract.test.ts
import { buildFamilyPrompt, needsCriticPass } from '../src/utils/serveIntakeExtract';

describe('buildFamilyPrompt', () => {
  it('gives the field sheet its own guidance', () => {
    const p = buildFamilyPrompt('field_sheet');
    expect(p).toMatch(/watermark/i);
    expect(p).toMatch(/Instructions/);
  });

  it('gives the court filing caption guidance', () => {
    const p = buildFamilyPrompt('court_filing');
    expect(p).toMatch(/caption/i);
  });

  it('returns a non-empty generic prompt for unknown families', () => {
    expect(buildFamilyPrompt('other').length).toBeGreaterThan(0);
  });
});

describe('needsCriticPass', () => {
  it('selects only low-confidence critical fields', () => {
    const fields = fieldsFrom({ case_number: 'X', recipient_address: 'Y' });
    fields.case_number.confidence = 0.3;
    fields.recipient_address.confidence = 0.95;
    expect(needsCriticPass(fields, [])).toEqual(['case_number']);
  });

  it('includes fields the validator flagged as errors', () => {
    const fields = fieldsFrom({ recipient_zip: '94304' });
    const issues = [{ field: 'recipient_zip', severity: 'error' as const, message: 'mismatch' }];
    expect(needsCriticPass(fields, issues)).toContain('recipient_zip');
  });

  it('returns an empty list when everything is confident and clean', () => {
    const fields = fieldsFrom({ case_number: 'X' });
    fields.case_number.confidence = 0.95;
    expect(needsCriticPass(fields, [])).toEqual([]);
  });

  it('never returns more than the cap, to bound neuron spend', () => {
    const fields = fieldsFrom({
      case_number: 'a', recipient_address: 'b', court_name: 'c',
      service_deadline: 'd', recipient_dob: 'e', recipient_phone: 'f',
    });
    for (const k of Object.keys(fields)) fields[k].confidence = 0.1;
    expect(needsCriticPass(fields, []).length).toBeLessThanOrEqual(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/serveIntakeExtract.test.ts`
Expected: FAIL — `buildFamilyPrompt is not exported`.

- [ ] **Step 3: Write minimal implementation**

```ts
// Add to src/utils/serveIntakeExtract.ts

// ── Document-family prompts ───────────────────────────────────
// One universal prompt makes the model hedge across layouts it isn't
// looking at. Each family gets guidance for ITS hazards.
const FAMILY_PROMPTS: Record<string, string> = {
  field_sheet: `This is an ICU Investigations FIELD SHEET.
Layout: a header with Job / Party to Serve / Due date; a table of Case, Court, Plaintiff,
Defendant; a Documents line; and a free-text Instructions block.
HAZARD: a diagonal watermark ("RUSH") can leave stray single letters inside the table cells.
Ignore isolated single letters that do not form a word.
The Instructions block is the richest source of timing constraints, address class, and
substitute-service authorization — read it in full.`,

  court_filing: `This is a COURT FILING (summons, subpoena, complaint, or docket).
The caption is authoritative for case_number, court_name, plaintiff, and defendant — prefer it
over any other document. "In the District Court of Utah, <N> Judicial District, <County> County"
is the court_name. Do NOT treat the party being served as a case party: on a subpoena the
recipient is usually a non-party witness.`,

  info_page: `This is a ServeManager INFORMATION FORM — the authoritative operational record.
Prefer it for recipient, service address, service instructions, job numbers, and due date.
The JOB header carries two numbers: the larger is job_number, the second is client_reference.
An embedded "Imported CSV Row" JSON block, when present, is the single most reliable source.`,
};

const GENERIC_FAMILY_PROMPT =
  'Extract every field you can locate. Return empty strings for fields not present.';

export function buildFamilyPrompt(docType: string): string {
  return FAMILY_PROMPTS[docType] ?? GENERIC_FAMILY_PROMPT;
}

// ── Bounded critic pass ───────────────────────────────────────
// Re-asking the model about EVERY field would double neuron spend on
// every packet. Only genuinely doubtful critical fields qualify, capped
// so a badly-scanned document cannot blow the daily free allocation.
const CRITIC_FIELDS: TargetField[] = [
  'case_number', 'court_name', 'recipient_address', 'service_deadline',
  'recipient_dob', 'recipient_phone', 'address_class',
];
const CRITIC_CONFIDENCE_FLOOR = 0.6;
const CRITIC_MAX_FIELDS = 5;

export function needsCriticPass(
  fields: Record<string, ExtractedField>,
  issues: Array<{ field: string; severity: 'warn' | 'error' }>,
): string[] {
  const flagged = new Set(
    issues.filter((i) => i.severity === 'error').map((i) => i.field),
  );
  const out: string[] = [];
  for (const f of CRITIC_FIELDS) {
    const ef = fields[f];
    if (!ef) continue;
    const doubtful = !!ef.value && ef.confidence < CRITIC_CONFIDENCE_FLOOR;
    if (doubtful || flagged.has(f)) out.push(f);
    if (out.length >= CRITIC_MAX_FIELDS) break;
  }
  return out;
}
```

Then in `buildExtractionMessages`, thread the family prompt in by appending `buildFamilyPrompt(docType)` to the system message when a `docType` is known.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/serveIntakeExtract.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/serveIntakeExtract.ts tests/serveIntakeExtract.test.ts
git commit -m "feat(serve-intake): per-family prompts and bounded critic-pass selection"
```

---

### Task 11: Neuron accounting

Spec §6 free-tier risk. Makes the 10,000/day ceiling observable before it is hit.

**Files:**
- Create: `src/utils/serveIntakeNeurons.ts`
- Test: `tests/serveIntakeNeurons.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `estimateNeurons(model: string, inTokens: number, outTokens: number): number`,
  `MODEL_NEURON_RATES: Record<string, { inPerM: number; outPerM: number }>`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/serveIntakeNeurons.test.ts
import { describe, it, expect } from 'vitest';
import { estimateNeurons, MODEL_NEURON_RATES } from '../src/utils/serveIntakeNeurons';

describe('estimateNeurons', () => {
  it('computes cost from the published per-million rates', () => {
    // Scout: 24,545/M in, 77,273/M out. 8000 in + 1500 out.
    const n = estimateNeurons('@cf/meta/llama-4-scout-17b-16e-instruct', 8000, 1500);
    expect(n).toBeGreaterThan(280);
    expect(n).toBeLessThan(340);
  });

  it('shows the legacy 70B costing more for the same packet', () => {
    const scout = estimateNeurons('@cf/meta/llama-4-scout-17b-16e-instruct', 8000, 1500);
    const legacy = estimateNeurons('@cf/meta/llama-3.3-70b-instruct-fp8-fast', 8000, 1500);
    expect(legacy).toBeGreaterThan(scout);
  });

  it('returns 0 for an unknown model rather than throwing', () => {
    expect(estimateNeurons('@cf/unknown/model', 1000, 100)).toBe(0);
  });

  it('publishes rates for every model the pipeline can select', () => {
    for (const m of [
      '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      '@cf/meta/llama-4-scout-17b-16e-instruct',
      '@cf/meta/llama-3.2-11b-vision-instruct',
      '@cf/moondream/moondream3.1-9B-A2B',
      '@cf/mistralai/mistral-small-3.1-24b-instruct',
    ]) {
      expect(MODEL_NEURON_RATES[m]).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/serveIntakeNeurons.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/utils/serveIntakeNeurons.ts
// ============================================================
// RMPG Flex — Serve Intake neuron accounting
// ============================================================
// Workers AI includes 10,000 Neurons/day free. Above that, Workers Paid
// bills $0.011/1,000 Neurons. That is cents per packet, but it must be a
// conscious decision rather than a surprise — so every intake logs its
// estimated consumption.
//
// Rates verified against https://developers.cloudflare.com/workers-ai/platform/pricing/
// on 2026-07-26. Re-verify when adding a model; Cloudflare revises these.
// ============================================================

export const MODEL_NEURON_RATES: Record<string, { inPerM: number; outPerM: number }> = {
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': { inPerM: 26668, outPerM: 204805 },
  '@cf/meta/llama-4-scout-17b-16e-instruct': { inPerM: 24545, outPerM: 77273 },
  '@cf/meta/llama-3.2-11b-vision-instruct': { inPerM: 4410, outPerM: 61493 },
  '@cf/moondream/moondream3.1-9B-A2B': { inPerM: 27273, outPerM: 90909 },
  '@cf/mistralai/mistral-small-3.1-24b-instruct': { inPerM: 31876, outPerM: 50488 },
  '@cf/google/gemma-3-12b-it': { inPerM: 31371, outPerM: 50560 },
};

export const FREE_NEURONS_PER_DAY = 10_000;

export function estimateNeurons(model: string, inTokens: number, outTokens: number): number {
  const rate = MODEL_NEURON_RATES[model];
  if (!rate) return 0;
  return Math.round(
    (inTokens / 1_000_000) * rate.inPerM + (outTokens / 1_000_000) * rate.outPerM,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/serveIntakeNeurons.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Log consumption per intake**

In `src/routes/serveIntake.ts`, after extraction completes:

```ts
const neurons = estimateNeurons(extraction.model, Math.ceil(combined.length / 4), 512);
log.info('serve-intake neurons', {
  model: extraction.model,
  neurons,
  free_daily: FREE_NEURONS_PER_DAY,
  docs: docs.length,
});
```

- [ ] **Step 6: Run the full suite**

Run: `npm run typecheck && npx vitest run`
Expected: 0 type errors; all files green.

- [ ] **Step 7: Commit**

```bash
git add src/utils/serveIntakeNeurons.ts tests/serveIntakeNeurons.test.ts src/routes/serveIntake.ts
git commit -m "feat(serve-intake): neuron accounting so the free-tier ceiling is observable"
```

---

## Final verification

- [ ] **Run every gate**

```bash
npm run typecheck && npx vitest run && cd client && npx tsc --noEmit && npx vitest run
```

Expected: worker typecheck 0 errors; worker suite green (261 baseline files + 5 new); client unchanged and green. The baseline was clean on 2026-07-26, so any failure is caused by this PR.

- [ ] **Open the PR**

```bash
git push -u origin claude/serve-intake-ocr-enhancement-167d8d
gh pr create -R rmpgutah/rmpg-flex --base main \
  --title "feat(serve-intake): PR 1 — extraction hardening, new fields, fixture harness" \
  --body "Implements spec items 1-20 and 68. See docs/superpowers/specs/2026-07-26-serve-intake-ocr-enhancement-design.md"
```

---

## Deferred to later plans

- **PR 2** (spec items 21–40) — briefing intelligence and the address-class timing engine.
- **PR 3** (spec items 41–58) — PDF render and visual fixes.
- **PR 4** (spec items 59–67) — Serve Intake review UI.

Each gets its own plan written immediately before execution, so it can incorporate what PR 1 measured — specifically the model A/B result (Task 5) and the LoRA determination, both of which change what those PRs build against.
