import { describe, it, expect } from 'vitest';
import { buildSearchQueries, extractDataPointsFromMarkdown } from '../src/utils/personIntel/phase3';
import type { IntelSeed } from '../src/utils/personIntel/types';

describe('buildSearchQueries', () => {
  it('generates name-based queries', () => {
    const seed: IntelSeed = { name: 'John Doe', dob: '1985-03-15' };
    const queries = buildSearchQueries(seed);
    expect(queries.length).toBeGreaterThanOrEqual(2);
    expect(queries.some(q => q.includes('John Doe'))).toBe(true);
  });
  it('generates plate query when plate provided', () => {
    const seed: IntelSeed = { plate: 'ABC123' };
    const queries = buildSearchQueries(seed);
    expect(queries.some(q => q.includes('ABC123'))).toBe(true);
  });
});

describe('extractDataPointsFromMarkdown', () => {
  it('parses LLM JSON output of data points', () => {
    const mockLlmOutput = JSON.stringify([
      { category: 'address', field: 'street', value: '456 Oak Ave' },
      { category: 'phone', field: 'number', value: '8015551234' },
    ]);
    const pts = extractDataPointsFromMarkdown(mockLlmOutput, 'Firecrawl');
    expect(pts).toHaveLength(2);
    expect(pts[0].source).toBe('Firecrawl');
    expect(pts[0].category).toBe('address');
  });
  it('returns empty array on invalid JSON', () => {
    expect(extractDataPointsFromMarkdown('not json', 'Firecrawl')).toHaveLength(0);
  });
});
