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

import { citationSchema } from '../citation';

describe('citationSchema layout', () => {
  it('uses ≤2 columns in every typed section', () => {
    for (const s of citationSchema.sections) {
      if (typeof s === 'function') continue;
      expect(s.columns ?? 1).toBeLessThanOrEqual(2);
    }
  });

  it('contains an ISSUING OFFICER section before NOTES', () => {
    const titles: string[] = [];
    for (const s of citationSchema.sections) {
      if (typeof s !== 'function') titles.push(s.title);
    }
    const officerIdx = titles.indexOf('ISSUING OFFICER');
    const notesIdx = titles.indexOf('NOTES');
    expect(officerIdx).toBeGreaterThanOrEqual(0);
    expect(notesIdx).toBeGreaterThan(officerIdx);
  });

  it('VIOLATIONS section is a callback (multi-violation aware)', () => {
    const callbacks = citationSchema.sections.filter((s) => typeof s === 'function');
    expect(callbacks.length).toBeGreaterThanOrEqual(1);
  });
});
