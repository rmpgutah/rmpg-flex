import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseIncodePdf } from '../src/utils/warrantSources/parse/pdfIncode';

// ---------------------------------------------------------------------------
// INCODE / Tyler "WRNTLST" municipal-court warrant report. Per-person blocks:
//   primary line   = NAME  WARRANT#  R/S  DOB(slashes)  Issued(dashes)  Offense  CODE
//   secondary line = WARRANT#  Issued(dashes)  Offense  CODE   (same person, +warrant)
//   "Docket No: X"  = the case/docket number for the preceding warrant
//   dashed line     = end of a person block
// Carries DOB + race/sex. Fixtures captured 2026-06-13 (first ~2 pages).
// ---------------------------------------------------------------------------
describe('parseIncodePdf — Beaumont TX (INCODE WRNTLST)', () => {
  const text = readFileSync('tests/fixtures/warrants/incode-beaumont.txt', 'utf8');

  it('returns at least 30 hits across the page break', () => {
    const hits = parseIncodePdf(text, 'pdf-incode-beaumont-tx', 'TX');
    expect(hits.length).toBeGreaterThanOrEqual(30);
  });

  it('sets source_key, state, full_name and warrant_id on every hit', () => {
    const hits = parseIncodePdf(text, 'pdf-incode-beaumont-tx', 'TX');
    for (const h of hits) {
      expect(h.source_key).toBe('pdf-incode-beaumont-tx');
      expect(h.state).toBe('TX');
      expect(h.full_name).toBeTruthy();
      expect(h.warrant_id).toBeTruthy();
    }
  });

  it('parses the first record (AARON, JADA RENEE) with DOB + docket + issue date', () => {
    const hits = parseIncodePdf(text, 'pdf-incode-beaumont-tx', 'TX');
    const aaron = hits.find(h => h.last_name === 'Aaron' && h.first_name === 'Jada');
    expect(aaron).toBeDefined();
    expect(aaron?.date_of_birth).toBe('1996-08-30');      // 8/30/1996
    expect(aaron?.issue_date).toBe('2019-06-17');         // 6-17-2019
    expect(aaron?.case_number).toBe('E200658351');        // Docket No
    expect(aaron?.charge_description).toContain('SPEEDING');
    expect(aaron?.charge_description).not.toMatch(/\bRW\b\s*$/); // trailing disposition code stripped
  });

  it('carries the person identity onto SECONDARY warrant lines (multi-warrant person)', () => {
    const hits = parseIncodePdf(text, 'pdf-incode-beaumont-tx', 'TX');
    // ABADOM, BRANDON has 2 warrants (E20120666-01 + E20120666-03); the 2nd line has no name/DOB.
    const abadom = hits.filter(h => h.last_name === 'Abadom');
    expect(abadom.length).toBe(2);
    for (const h of abadom) {
      expect(h.first_name).toBe('Brandon');
      expect(h.date_of_birth).toBe('1996-01-10');         // carried from the primary line
    }
    expect(abadom.map(h => h.charge_description).join(' ')).toMatch(/SAFETY BELT/);
    expect(abadom.map(h => h.charge_description).join(' ')).toMatch(/FTMFR|FIN RESP/);
  });

  it('handles a person with 4 warrants (ABBOTS, TIMANIQ), all carrying the same DOB', () => {
    const hits = parseIncodePdf(text, 'pdf-incode-beaumont-tx', 'TX');
    const abbots = hits.filter(h => h.last_name === 'Abbots');
    expect(abbots.length).toBe(4);
    for (const h of abbots) expect(h.date_of_birth).toBe('2005-10-08');
    expect(new Set(abbots.map(h => h.warrant_id)).size).toBe(4); // distinct warrants
  });

  it('attaches a Docket No that spills past a page break to the right warrant', () => {
    const hits = parseIncodePdf(text, 'pdf-incode-beaumont-tx', 'TX');
    // ABRAHAM, LAKEISHA's 2nd warrant (SPEEDING 90) is the last entry on page 1;
    // its "Docket No: E200483832" lands on page 2, after the page header + decoration dashes.
    const speeding90 = hits.find(h => h.last_name === 'Abraham' && /SPEEDING 90/.test(h.charge_description ?? ''));
    expect(speeding90).toBeDefined();
    expect(speeding90?.case_number).toBe('E200483832'); // not dropped by the page-break reset
  });

  it('does not leak the WRNTLST page header into a charge or name', () => {
    const hits = parseIncodePdf(text, 'pdf-incode-beaumont-tx', 'TX');
    for (const h of hits) {
      const blob = `${h.charge_description ?? ''} ${h.full_name ?? ''}`;
      expect(blob).not.toMatch(/WRNTLST|Warrant Listing|Active Warrants|Docket No/i);
    }
  });

  it('returns [] for empty / unrecognised input', () => {
    expect(parseIncodePdf('', 'pdf-incode-beaumont-tx', 'TX')).toEqual([]);
    expect(parseIncodePdf('nope not a warrant report', 'x', 'TX')).toEqual([]);
  });
});

describe('parseIncodePdf — Harlingen TX', () => {
  const text = readFileSync('tests/fixtures/warrants/incode-harlingen.txt', 'utf8');

  it('parses Harlingen with the same parser', () => {
    const hits = parseIncodePdf(text, 'pdf-incode-harlingen-tx', 'TX');
    expect(hits.length).toBeGreaterThanOrEqual(30);
    const ab = hits.find(h => h.last_name === 'Abernathy' && h.first_name === 'Jasper');
    expect(ab).toBeDefined();
    expect(ab?.date_of_birth).toBe('2000-07-07');
  });

  it('nulls the DOB for org rows ("0/00/0000") instead of emitting 0000-00-00', () => {
    const hits = parseIncodePdf(text, 'pdf-incode-harlingen-tx', 'TX');
    // "7, ELEVEN INC ... / 0/00/0000 ..." — a business with a blank R/S and zero DOB.
    for (const h of hits) {
      if (h.date_of_birth != null) expect(h.date_of_birth).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (h.date_of_birth != null) expect(h.date_of_birth.startsWith('0000')).toBe(false);
    }
  });
});
