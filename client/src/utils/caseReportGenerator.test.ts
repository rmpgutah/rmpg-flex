import { describe, it, expect } from 'vitest';
import { buildCaseReportSections } from './caseReportGenerator';

describe('buildCaseReportSections', () => {
  it('omits empty/absent sections', () => {
    const s = buildCaseReportSections({ caseRow: {}, persons: [{ id: 1 }], evidence: [{ id: 1 }, { id: 2 }], calls: [] });
    expect(s.map((x) => x.key)).toEqual(['persons', 'evidence']);
    expect(s.find((x) => x.key === 'evidence')?.count).toBe(2);
  });

  it('returns nothing for a bare case', () => {
    expect(buildCaseReportSections({ caseRow: { case_number: 'X' } })).toEqual([]);
  });

  it('preserves the canonical section order regardless of input order', () => {
    const s = buildCaseReportSections({ caseRow: {}, activity: [{ action: 'x' }], calls: [{ id: 1 }], related: [{ id: 2 }] });
    expect(s.map((x) => x.key)).toEqual(['calls', 'related', 'activity']);
  });
});
