// tests/sl-assessor.parser.test.ts
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseParcelList, parseParcelDetail, inferOwnerType }
  from '../src/utils/sl-assessor/parser';

const fixture = (name: string) =>
  readFileSync(join(__dirname, 'fixtures/sl-assessor', name), 'utf8');

describe('parseParcelList', () => {
  test('single match returns 1 ParcelSummary', () => {
    const out = parseParcelList(fixture('single.html'));
    expect(out).toHaveLength(1);
    expect(out[0].parcel_number).toMatch(/^\d{2}-\d{2}-\d{3}-\d{3}$/);
    expect(out[0].owner_of_record).toBeTruthy();
    expect(out[0].detail_url).toContain('parcel');
  });
  test('multi match returns >1 ParcelSummary', () => {
    const out = parseParcelList(fixture('multi.html'));
    expect(out.length).toBeGreaterThanOrEqual(2);
  });
  test('no match returns []', () => {
    expect(parseParcelList(fixture('none.html'))).toEqual([]);
  });
});

describe('parseParcelDetail', () => {
  test('extracts core fields', () => {
    const p = parseParcelDetail(fixture('detail.html'));
    expect(p.parcel_number).toMatch(/^\d{2}-\d{2}-\d{3}-\d{3}$/);
    expect(p.owner_of_record).toBeTruthy();
    expect(p.year_built).toBeGreaterThan(1800);
    expect(p.year_built!).toBeLessThan(2100);
    expect(p.market_value_total).toBeGreaterThan(0);
    expect(p.raw_data_json).toBeTypeOf('object');
  });
  test('captures sale history list', () => {
    const p = parseParcelDetail(fixture('detail.html'));
    expect(Array.isArray(p.sales)).toBe(true);
    // detail.html may have 0+ sales; ensure shape if any present
    for (const s of p.sales) {
      expect(s).toHaveProperty('sale_date');
      expect(s).toHaveProperty('sale_price');
    }
  });
});

describe('inferOwnerType', () => {
  test('LLC / INC / CORP / TRUST → entity', () => {
    expect(inferOwnerType('XYZ HOLDINGS LLC')).toBe('entity');
    expect(inferOwnerType('ACME INC')).toBe('entity');
    expect(inferOwnerType('SMITH FAMILY TRUST')).toBe('entity');
    expect(inferOwnerType('FOO CORP')).toBe('entity');
    expect(inferOwnerType('BAR LP')).toBe('entity');
    expect(inferOwnerType('BAZ LLP')).toBe('entity');
  });
  test('plain personal names → individual', () => {
    expect(inferOwnerType('SMITH, JOHN')).toBe('individual');
    expect(inferOwnerType('SMITH, JOHN & SMITH, JANE')).toBe('individual');
  });
  test('mixed → mixed', () => {
    expect(inferOwnerType('SMITH, JOHN & ACME LLC')).toBe('mixed');
  });
  test('empty → unknown', () => {
    expect(inferOwnerType('')).toBe('unknown');
    expect(inferOwnerType(null)).toBe('unknown');
  });
});
