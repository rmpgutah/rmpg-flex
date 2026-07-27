import { describe, it, expect } from 'vitest';
import { clientWindowText, assessOfficerSafety } from '../src/utils/serveIntakeBriefing';

const baseRow = {
  recipient_name: 'DANA WHITFIELD', recipient_address: '1180 E VINE ST',
  recipient_city: 'SALT LAKE CITY', recipient_state: 'UT', recipient_zip: '84121',
  document_type: 'subpoena', case_number: '900904528', court_name: 'THIRD DISTRICT',
  jurisdiction: 'UT', client_name: 'ICU', attorney_name: null,
  priority: 'rush' as const, deadline: '2026-06-30', service_instructions: null,
  notes: null, plaintiff: 'AVERY HOLT', defendant: 'NORTHGATE LOGISTICS, LLC',
  court_date: null,
};

describe('D2: client windows are read from service_instructions, not just notes', () => {
  it('finds a client restriction stated in service_instructions', () => {
    const row = { ...baseRow, service_instructions: 'Diligence is 1 between 6AM-9AM, 1 between 9AM-6PM.' };
    expect(clientWindowText(row)).toContain('6AM-9AM');
  });

  it('still finds one stated in notes', () => {
    const row = { ...baseRow, notes: 'SERVE ON FRIDAY BETWEEN 9AM AND 3:30PM' };
    expect(clientWindowText(row)).toContain('FRIDAY');
  });

  it('ignores the OCR provenance line that notes carries', () => {
    const row = { ...baseRow, notes: '[OCR intake 2026-07-27: 3/3 docs read, 92% confidence]' };
    expect(clientWindowText(row)).toBeNull();
  });

  it('returns null when the client genuinely specified nothing', () => {
    expect(clientWindowText(baseRow)).toBeNull();
  });
});

describe('officer safety remains unchanged by this task', () => {
  it('still returns a baseline caution for a routine civil paper', () => {
    const a = assessOfficerSafety({}, baseRow);
    expect(a.caution).toBe(true);
    expect(a.severity).toBe('baseline');
  });
});
