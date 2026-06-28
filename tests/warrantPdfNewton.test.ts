import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseNewtonPdf } from '../src/utils/warrantSources/parse/pdfNewton';

// ---------------------------------------------------------------------------
// Newton County, GA — "Warrant Outstanding Report by Defendant's Name".
// unpdf (lines mode) emits this report COLUMN-major: a block of all names, then
// a block of all DOBs, then warrant numbers, then offenses, then date-received,
// each block terminated by its column-header label. Rows are reconstructed by
// index-aligning the identity columns (name/DOB/warrant#/received-date).
// The offense column wraps without a per-row delimiter, so charge is omitted.
// Fixture captured 2026-06-13 from the myocv CDN (first 2 of 68 pages).
// ---------------------------------------------------------------------------
describe('parseNewtonPdf', () => {
  const text = readFileSync('tests/fixtures/warrants/newton-ga.txt', 'utf8');

  it('reconstructs both pages (~78 rows)', () => {
    const hits = parseNewtonPdf(text, 'pdf-newton-ga', 'GA');
    expect(hits.length).toBeGreaterThanOrEqual(70);
  });

  it('sets source_key, state, full_name, warrant_id AND date_of_birth on every hit', () => {
    const hits = parseNewtonPdf(text, 'pdf-newton-ga', 'GA');
    for (const h of hits) {
      expect(h.source_key).toBe('pdf-newton-ga');
      expect(h.state).toBe('GA');
      expect(h.full_name).toBeTruthy();
      expect(h.warrant_id).toBeTruthy();
      // DOB is Newton's distinguishing value — every aligned row must carry one.
      expect(h.date_of_birth).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('aligns the first row (AARON, KALEB) across columns', () => {
    const hits = parseNewtonPdf(text, 'pdf-newton-ga', 'GA');
    const aaron = hits.find(h => h.last_name === 'Aaron' && h.first_name === 'Kaleb');
    expect(aaron).toBeDefined();
    expect(aaron?.date_of_birth).toBe('2003-07-08'); // 07/08/2003
    expect(aaron?.case_number).toBe('23-898');        // warrant number
    expect(aaron?.issue_date).toBe('2023-04-19');     // date received 04/19/2023
  });

  it('reconstructs wrapped compound names (ABIOLA OKE, ABIMBOLA OYEKUNLE)', () => {
    const hits = parseNewtonPdf(text, 'pdf-newton-ga', 'GA');
    const abiola = hits.find(h => h.last_name === 'Abiola Oke');
    expect(abiola).toBeDefined();
    expect(abiola?.first_name).toBe('Abimbola');
    expect(abiola?.middle_name).toBe('Oyekunle');
  });

  it('returns [] for empty input', () => {
    expect(parseNewtonPdf('', 'pdf-newton-ga', 'GA')).toEqual([]);
  });

  it('returns [] for unrecognised input', () => {
    expect(parseNewtonPdf('hello world not a report', 'pdf-newton-ga', 'GA')).toEqual([]);
  });
});
