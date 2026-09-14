import { describe, expect, it } from 'vitest';
import { familyFromFileName } from '../src/utils/serveIntakeExtract';

describe('familyFromFileName', () => {
  it('classifies field sheets', () => {
    expect(familyFromFileName('16788030 Field Sheet.pdf')).toBe('field_sheet');
    expect(familyFromFileName('12345 field_sheet.pdf')).toBe('field_sheet');
  });

  it('classifies court filings', () => {
    expect(familyFromFileName('16788030 Court Docket.pdf')).toBe('court_filing');
    expect(familyFromFileName('docket.pdf')).toBe('court_filing');
  });

  it('classifies information pages', () => {
    expect(familyFromFileName('16788030 Information Form.pdf')).toBe('info_page');
    expect(familyFromFileName('16788030 Information Page.pdf')).toBe('info_page');
  });

  it('classifies attempt records — the regression case shown in screenshot', () => {
    expect(familyFromFileName('16788030 First Attempt.pdf')).toBe('attempt_sheet');
    expect(familyFromFileName('16788030 Second Attempt.pdf')).toBe('attempt_sheet');
    expect(familyFromFileName('16788030 Third Attempt.pdf')).toBe('attempt_sheet');
    expect(familyFromFileName('16788030 1st Attempt.pdf')).toBe('attempt_sheet');
    expect(familyFromFileName('16788030 2nd Attempt.pdf')).toBe('attempt_sheet');
    expect(familyFromFileName('Attempt 3.pdf')).toBe('attempt_sheet');
  });

  it('returns undefined for unrecognized filenames', () => {
    expect(familyFromFileName('16788030 Summons & Complaint.pdf')).toBeUndefined();
    expect(familyFromFileName('unknown.pdf')).toBeUndefined();
    expect(familyFromFileName('')).toBeUndefined();
  });

  it('attempt_sheet does not match plain field sheet (field_sheet wins by ordering)', () => {
    // "field sheet" should never be misclassified as attempt_sheet
    expect(familyFromFileName('Field Sheet.pdf')).toBe('field_sheet');
  });
});
