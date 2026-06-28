// tests/firecrawl.test.ts
import { describe, it, expect } from 'vitest';
import { parseSearchResponse, parseScrapeResponse } from '../src/utils/firecrawl';

describe('parseSearchResponse', () => {
  it('maps v1 data items and keeps inline markdown', () => {
    const json = { success: true, data: [
      { url: 'https://a.com', title: 'A', description: 'da', markdown: '# A' },
      { url: 'https://b.com', title: 'B', description: 'db' },
    ] };
    const out = parseSearchResponse(json);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ url: 'https://a.com', title: 'A', description: 'da', markdown: '# A' });
    expect(out[1].markdown).toBeUndefined();
  });
  it('drops malformed items and tolerates missing data', () => {
    expect(parseSearchResponse({})).toEqual([]);
    expect(parseSearchResponse({ data: [{ title: 'no url' }, null, 5] })).toEqual([]);
  });
});

describe('parseScrapeResponse', () => {
  it('pulls data.markdown, empty string otherwise', () => {
    expect(parseScrapeResponse({ data: { markdown: 'hi' } })).toBe('hi');
    expect(parseScrapeResponse({ data: {} })).toBe('');
    expect(parseScrapeResponse(null)).toBe('');
  });
});
