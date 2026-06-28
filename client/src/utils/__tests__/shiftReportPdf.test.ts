import { describe, it, expect } from 'vitest';
import { totalActivityCount, ellipsize } from '../shiftReportPdf';

describe('totalActivityCount', () => {
  it('sums every category', () => {
    expect(totalActivityCount({
      totalCalls: 3, totalIncidents: 2, totalScans: 5,
      totalCitations: 1, totalFieldInterviews: 4,
    })).toBe(15);
  });
  it('treats missing fields as zero', () => {
    expect(totalActivityCount({ totalCalls: 2 })).toBe(2);
  });
  it('returns 0 when undefined', () => {
    expect(totalActivityCount(undefined)).toBe(0);
  });
});

describe('ellipsize', () => {
  it('returns the string unchanged if within budget', () => {
    expect(ellipsize('short', 10)).toBe('short');
  });
  it('truncates with a trailing ellipsis when over budget', () => {
    expect(ellipsize('1234567890', 6)).toBe('12345…');
  });
  it('handles undefined / null gracefully', () => {
    expect(ellipsize(undefined, 5)).toBe('');
  });
  it('treats an exactly-at-budget string as no-op', () => {
    expect(ellipsize('abcde', 5)).toBe('abcde');
  });
});
