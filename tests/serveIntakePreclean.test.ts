// tests/serveIntakePreclean.test.ts
// ============================================================
// Serve Intake pre-clean — deterministic text hardening
// ============================================================
// Fixtures are SYNTHETIC derivatives of real ICU packets: the same
// layout hazards, fabricated identities. No real case data.
// ============================================================

import { describe, it, expect } from 'vitest';
import { normalizeHomoglyphs, scrubWatermarkBleed } from '../src/utils/serveIntakePreclean';
import { normalizeCheckboxes, normalizeTypography, precleanText } from '../src/utils/serveIntakePreclean';

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

  it('returns input unchanged when there are too few isolated letters to form a stamp', () => {
    const input = 'Exhibit\nA\nSchedule';
    expect(scrubWatermarkBleed(input)).toContain('A');
  });

  it('keeps isolated single letters whose sequence does not match any watermark stamp', () => {
    // Letters B, G, J, Q do not appear in any of the known stamps (RUSH, COPY,
    // FILED, DRAFT, VOID, SAMPLE), so no stamp matcher can ever consume them.
    // This exercises the negative path of the multiset-match logic.
    const input = [
      'Case File 123',
      'B',
      'Court XYZ',
      'G',
      'Plaintiff Name',
      'J',
      'Defendant Person',
      'Q',
      'Documents Listed',
    ].join('\n');
    const output = scrubWatermarkBleed(input);
    expect(output).toContain('B');
    expect(output).toContain('G');
    expect(output).toContain('J');
    expect(output).toContain('Q');
    expect(output).toContain('Case File 123');
    expect(output).toContain('Court XYZ');
    expect(output).toContain('Plaintiff Name');
    expect(output).toContain('Defendant Person');
    expect(output).toContain('Documents Listed');
  });

  it('keeps single letters that appear inline rather than alone on a line', () => {
    const input = 'Apt H, Salt Lake City';
    expect(scrubWatermarkBleed(input)).toContain('Apt H');
  });

  it('removes TWO interleaved stamps (RUSH and COPY) in a single call, and a second call is a no-op', () => {
    // Regression for the non-idempotence bug: the original implementation
    // returned on the FIRST matching stamp, so a document carrying two
    // stamps (a diagonal RUSH watermark plus a COPY stamp) needed two
    // precleanText() calls to fully clean — silently making the toMarkdown
    // extraction tier (which precleans internally, i.e. two passes) diverge
    // from the pdfjs-client/container tiers (one pass each).
    const input = [
      ' Case                     Plaintiff',
      '                    R',
      '                    C',
      ' Court                    Defendant',
      '                   U',
      '                   O',
      ' Documents   UT Subpoena',
      '                 S',
      '                 P',
      '                 H',
      '                 Y',
    ].join('\n');
    const once = scrubWatermarkBleed(input);
    expect(once).not.toMatch(/^\s*[RUSHCOPY]\s*$/m);
    expect(once).toContain('UT Subpoena');
    expect(once).toContain('Plaintiff');
    // A single call must remove BOTH stamps' letters, not just one.
    for (const ch of ['R', 'U', 'S', 'H', 'C', 'O', 'P', 'Y']) {
      expect(once).not.toMatch(new RegExp(`^\\s*${ch}\\s*$`, 'm'));
    }
    // Second call is a true no-op.
    expect(scrubWatermarkBleed(once)).toBe(once);
  });
});

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
    expect(normalizeTypography('afﬁdavit of ﬂing')).toBe('affidavit of fling');
  });

  it('removes soft hyphens and normalizes non-breaking spaces', () => {
    expect(normalizeTypography('Sub­poena Service')).toBe('Subpoena Service');
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
