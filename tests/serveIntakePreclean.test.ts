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
