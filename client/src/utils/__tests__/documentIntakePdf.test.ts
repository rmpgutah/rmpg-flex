import { describe, it, expect } from 'vitest';
import {
  wrapText,
  confidenceBand,
  fmtTimestamp,
  suggestFilename,
  generateDocumentIntakePdf,
  type IntakeFieldForPdf,
} from '../documentIntakePdf';

function mkField(overrides: Partial<IntakeFieldForPdf> = {}): IntakeFieldForPdf {
  return {
    key: 'defendant_name',
    value: 'SMITH, JOHN A',
    confidence: 0.92,
    matchedAnchor: 'Defendant',
    originalValue: 'SMITH, JOHN A',
    ...overrides,
  };
}

describe('wrapText (document intake pdf)', () => {
  it('returns a single empty entry for empty input', () => {
    expect(wrapText('', 20)).toEqual(['']);
  });
  it('keeps short strings as one line', () => {
    expect(wrapText('john smith', 30)).toEqual(['john smith']);
  });
  it('wraps at word boundaries', () => {
    expect(wrapText('one two three four', 10)).toEqual(['one two', 'three four']);
  });
  it('preserves explicit newlines as paragraph breaks', () => {
    expect(wrapText('first\nsecond', 50)).toEqual(['first', 'second']);
  });
});

describe('confidenceBand (document intake pdf)', () => {
  it('classifies a high-confidence read', () => {
    expect(confidenceBand(0.91)).toMatchObject({ label: 'HIGH', pct: '91%' });
  });
  it('classifies a mid-confidence read', () => {
    expect(confidenceBand(0.6)).toMatchObject({ label: 'MEDIUM', pct: '60%' });
  });
  it('classifies a low-confidence read', () => {
    expect(confidenceBand(0.2)).toMatchObject({ label: 'LOW', pct: '20%' });
  });
  it('marks zero as not-found with an em-dash percent', () => {
    expect(confidenceBand(0)).toMatchObject({ label: 'NOT FOUND', pct: '—' });
  });
  it('uses 0.80 as the inclusive HIGH boundary', () => {
    expect(confidenceBand(0.80).label).toBe('HIGH');
    expect(confidenceBand(0.7999).label).toBe('MEDIUM');
  });
  it('uses 0.50 as the inclusive MEDIUM boundary', () => {
    expect(confidenceBand(0.50).label).toBe('MEDIUM');
    expect(confidenceBand(0.4999).label).toBe('LOW');
  });
});

describe('fmtTimestamp (document intake pdf)', () => {
  it('returns em-dash for empty input', () => {
    expect(fmtTimestamp(null)).toBe('—');
    expect(fmtTimestamp(undefined)).toBe('—');
    expect(fmtTimestamp('')).toBe('—');
  });
  it('formats an ISO timestamp in Mountain time', () => {
    // 2026-06-22 14:23:05 UTC == 2026-06-22 08:23 MT (MDT).
    const out = fmtTimestamp('2026-06-22T14:23:05Z');
    expect(out).toMatch(/^2026-06-22 08:23 MT$/);
  });
  it('does not throw on garbage input and returns either the raw string or a stamp', () => {
    // The formatter intentionally try/catches around parseTimestamp +
    // Intl.DateTimeFormat. In some environments parseTimestamp coerces
    // garbage into Date(NaN) and the format pipeline ends up falling
    // through to the catch (returning the raw string); in others the
    // pipeline succeeds with a "now" stamp. Either is acceptable —
    // what matters is we never throw out of the PDF generator path.
    const out = fmtTimestamp('not a real date');
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });
});

describe('suggestFilename (document intake pdf)', () => {
  it('builds a filename of intake-<kind>-<stem>-<ymd>.pdf', () => {
    const out = suggestFilename('court_warrant', 'WarrantPacket.pdf');
    expect(out).toMatch(/^intake-court_warrant-WarrantPacket-\d{4}-\d{2}-\d{2}\.pdf$/);
  });
  it('sanitizes unsafe characters in both segments', () => {
    const out = suggestFilename('weird/kind', 'A B & C !.pdf');
    expect(out).toMatch(/^intake-weird_kind-A_B_C_-\d{4}-\d{2}-\d{2}\.pdf$/);
  });
  it('caps the kind and stem at 24 chars each', () => {
    const longKind = 'a'.repeat(40);
    const longStem = 'b'.repeat(40) + '.pdf';
    const out = suggestFilename(longKind, longStem);
    const m = out.match(/^intake-(.+)-(.+)-\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(m).not.toBeNull();
    expect(m![1].length).toBeLessThanOrEqual(24);
    expect(m![2].length).toBeLessThanOrEqual(24);
  });
  it('falls back to "unknown"/"document" when given empty inputs', () => {
    expect(suggestFilename('', '')).toMatch(/^intake-unknown-document-\d{4}-\d{2}-\d{2}\.pdf$/);
  });
});

describe('generateDocumentIntakePdf', () => {
  it('produces a non-empty PDF buffer for a typical extraction', () => {
    const doc = generateDocumentIntakePdf({
      filename: 'WarrantPacket.pdf',
      kind: 'court_warrant',
      tier: 'implemented',
      confidence: 0.78,
      pageCount: 3,
      usedOcr: false,
      fields: [
        mkField(),
        mkField({ key: 'docket_number', value: '24-CR-1234', confidence: 0.84, matchedAnchor: 'Docket' }),
        mkField({ key: 'bond_amount', value: '$5,000', confidence: 0.45, matchedAnchor: 'Bond' }),
        mkField({ key: 'issued_date', value: '', confidence: 0, matchedAnchor: null, originalValue: '' }),
      ],
      rawTextPreview: 'STATE OF UTAH vs. SMITH, JOHN A  Docket: 24-CR-1234  Bond: $5,000.00',
      courtCategory: 'criminal',
      state: 'UT',
      exportedBy: 'Clerk Alpha',
    });
    const buf = doc.output('arraybuffer');
    expect(buf.byteLength).toBeGreaterThan(2000);
  });

  it('renders without crashing when fields is empty', () => {
    const doc = generateDocumentIntakePdf({
      filename: 'unknown.pdf',
      kind: 'stub_kind',
      tier: 'stub',
      confidence: 0,
      pageCount: 0,
      usedOcr: false,
      fields: [],
    });
    const buf = doc.output('arraybuffer');
    expect(buf.byteLength).toBeGreaterThan(1000);
  });

  it('renders without crashing when rawTextPreview is omitted', () => {
    const doc = generateDocumentIntakePdf({
      filename: 'fi.pdf',
      kind: 'fi_card',
      tier: 'implemented',
      confidence: 0.6,
      pageCount: 1,
      usedOcr: true,
      fields: [mkField()],
    });
    const buf = doc.output('arraybuffer');
    expect(buf.byteLength).toBeGreaterThan(1000);
  });

  it('handles a long raw-text preview without throwing', () => {
    const longText = 'word '.repeat(8000);
    const doc = generateDocumentIntakePdf({
      filename: 'big.pdf',
      kind: 'court_warrant',
      tier: 'implemented',
      confidence: 0.6,
      pageCount: 12,
      usedOcr: false,
      fields: [mkField()],
      rawTextPreview: longText,
    });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });
});
