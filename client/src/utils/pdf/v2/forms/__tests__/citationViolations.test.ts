import { describe, it, expect } from 'vitest';
import { selectViolationLayout, totalFine } from '../citationViolations';
import type { CitationViolation } from '../citation';

const v = (n: number): CitationViolation[] =>
  Array.from({ length: n }, (_, i) => ({
    statute_citation: `UCA-${i}`, description: `d${i}`,
    offense_level: 'Infraction' as const, fine_amount: 10 * (i + 1),
  }));

describe('selectViolationLayout', () => {
  it('returns "compact" for 0..3 violations', () => {
    expect(selectViolationLayout(v(0))).toBe('compact');
    expect(selectViolationLayout(v(1))).toBe('compact');
    expect(selectViolationLayout(v(3))).toBe('compact');
  });
  it('returns "stacked" for 4+ violations', () => {
    expect(selectViolationLayout(v(4))).toBe('stacked');
    expect(selectViolationLayout(v(10))).toBe('stacked');
  });
});

describe('totalFine', () => {
  it('sums fine_amount across violations', () => {
    expect(totalFine(v(3))).toBe(10 + 20 + 30);
    expect(totalFine([])).toBe(0);
  });
  it('treats non-finite fine_amount as 0', () => {
    expect(totalFine([{ ...v(1)[0], fine_amount: NaN }])).toBe(0);
    expect(totalFine([{ ...v(1)[0], fine_amount: Infinity }])).toBe(0);
  });
});
