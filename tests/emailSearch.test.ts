import { describe, it, expect } from 'vitest';
import { buildSearchLikePattern } from '../src/routes/email';

describe('buildSearchLikePattern', () => {
  it('wraps a short query in % wildcards', () => {
    expect(buildSearchLikePattern('acme')).toBe('%acme%');
  });

  it('replaces % and _ with spaces so they are treated as literals, not wildcards', () => {
    expect(buildSearchLikePattern('100%_off')).toBe('%100  off%');
  });

  it('truncates queries longer than 40 chars before wrapping, to stay under the D1 LIKE pattern cap', () => {
    const longQuery = 'a'.repeat(60);
    const result = buildSearchLikePattern(longQuery);
    // 40 chars of query + 2 wildcard chars = 42
    expect(result.length).toBeLessThanOrEqual(42);
    expect(result).toBe(`%${'a'.repeat(40)}%`);
  });

  it('leaves a 40-char query untruncated', () => {
    const q = 'b'.repeat(40);
    expect(buildSearchLikePattern(q)).toBe(`%${q}%`);
  });
});
