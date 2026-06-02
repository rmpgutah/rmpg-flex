import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { parseAdaCounty } from '../../src/utils/warrantSources/parse/adaCounty';

const html = readFileSync(new URL('./fixtures/ada-county.html', import.meta.url), 'utf8');

describe('parseAdaCounty', () => {
  it('extracts warrant rows with names + ids', () => {
    const hits = parseAdaCounty(html);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].warrant_id).toBeTruthy();
    expect(hits[0].last_name || hits[0].full_name).toBeTruthy();
    expect(hits[0].source_key).toBe('ada-county-id');
  });
  it('parses age + bond where present', () => {
    const hits = parseAdaCounty(html);
    // at least one hit should have a numeric age and at least one a numeric bail
    expect(hits.some(h => typeof h.age === 'number')).toBe(true);
    expect(hits.some(h => typeof h.bail_amount === 'number')).toBe(true);
  });
  it('does not double-count responsive-duplicated rows', () => {
    const hits = parseAdaCounty(html);
    const ids = hits.map(h => h.warrant_id);
    expect(new Set(ids).size).toBe(ids.length); // unique warrant ids
  });
  it('returns [] when no results', () => {
    expect(parseAdaCounty('<html><body>No records found</body></html>')).toEqual([]);
  });
});
