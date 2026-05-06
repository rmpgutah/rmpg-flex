import { describe, it, expect } from 'vitest';
import { citationCanonicalData, type CitationData, type CitationViolation } from '../citation';

describe('citationCanonicalData', () => {
  it('includes violations array when present', () => {
    const v: CitationViolation = {
      statute_citation: 'UCA 41-6a-601',
      description: 'Speeding 15 over',
      offense_level: 'Infraction',
      fine_amount: 175,
    };
    const data: CitationData = { citation_number: 'C-1', violations: [v] };
    const bag = citationCanonicalData(data);
    expect(bag.violations).toEqual([v]);
  });

  it('omits violations when absent (back-compat)', () => {
    const data: CitationData = { citation_number: 'C-1' };
    const bag = citationCanonicalData(data);
    expect('violations' in bag).toBe(false);
  });
});
