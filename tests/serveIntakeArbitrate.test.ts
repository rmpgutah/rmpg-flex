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
