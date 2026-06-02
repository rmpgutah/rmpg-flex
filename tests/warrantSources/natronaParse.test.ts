import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { parseNatrona } from '../../src/utils/warrantSources/parse/natrona';

const html = readFileSync(new URL('./fixtures/natrona.html', import.meta.url), 'utf8');

describe('parseNatrona', () => {
  it('extracts person rows with a stable warrant_id + name', () => {
    const hits = parseNatrona(html);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].warrant_id).toBeTruthy();
    expect(hits[0].last_name || hits[0].full_name).toBeTruthy();
    expect(hits[0].source_key).toBe('natrona-county-wy');
    expect(hits[0].state).toBe('WY');
  });

  it('parses age where present', () => {
    const hits = parseNatrona(html);
    expect(hits.some((h) => typeof h.age === 'number')).toBe(true);
  });

  it('does not include the header row', () => {
    const hits = parseNatrona(html);
    // header has Name/Race/Gender/Age literally — no hit should be named "Name"
    expect(hits.every((h) => (h.full_name || '').toLowerCase() !== 'name')).toBe(true);
  });

  it('produces unique warrant_ids', () => {
    const hits = parseNatrona(html);
    const ids = hits.map((h) => h.warrant_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('returns [] when no results', () => {
    expect(parseNatrona('<html><body>Found 0 Warrants</body></html>')).toEqual([]);
  });

  it('extracts the 10 person rows visible on the page (header excluded)', () => {
    const hits = parseNatrona(html);
    expect(hits.length).toBe(10);
  });

  it('parses FIRST LAST name format and a synthetic natrona: warrant_id', () => {
    const hits = parseNatrona(html);
    const anthony = hits.find((h) => h.full_name === 'Anthony Smith');
    expect(anthony).toBeDefined();
    expect(anthony!.first_name).toBe('Anthony');
    expect(anthony!.last_name).toBe('Smith');
    expect(anthony!.age).toBe(63);
    expect(anthony!.warrant_id).toBe('natrona:smith-anthony-63');
    // List-view-only source: charge/court/case/bail/issue all null in Phase 1.
    expect(anthony!.charge_description ?? null).toBeNull();
    expect(anthony!.bail_amount ?? null).toBeNull();
  });
});
