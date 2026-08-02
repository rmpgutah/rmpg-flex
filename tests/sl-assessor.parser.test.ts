// tests/sl-assessor.parser.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test, it } from 'vitest';
import { parseParcelList, parseParcelDetail, inferOwnerType, findParcelNumber }
  from '../src/utils/sl-assessor/parser';
import { AssessorParseError } from '../src/utils/sl-assessor/types';

const fixture = (name: string) =>
  readFileSync(join(__dirname, 'fixtures/sl-assessor', name), 'utf8');

describe('parseParcelList', () => {
  test('single match returns 1 ParcelSummary', () => {
    const out = parseParcelList(fixture('single.html'));
    expect(out).toHaveLength(1);
    // 14 digits, not 12. The 4-digit encumbrance suffix is part of the id;
    // a 12-digit value is a BLOCK id that the county answers with HTTP 200 +
    // the search form, so it fails silently downstream. This assertion used
    // to require the truncated form — it pinned the bug in place.
    expect(out[0].parcel_number).toMatch(/^\d{2}-\d{2}-\d{3}-\d{3}-\d{4}$/);
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
    expect(p.parcel_number).toMatch(/^\d{2}-\d{2}-\d{3}-\d{3}-\d{4}$/);
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

describe('parcel-number extraction — picker regressions (2026-08-01)', () => {
  // Both defects were visible in the Records assessor picker at once: it
  // rendered "00-00-000-000  GARLUTZO, ANDREW" — an all-zero parcel number
  // beside correct owner/value data.
  const FORM = '<input id="parcelid" class="search-box" placeholder="00-00-000-000-0000" maxlength="18" />';

  it('never returns the search form placeholder as a parcel number', () => {
    // The county embeds its search form at the top of the detail page and
    // serves it as the entire body of the no-match page. Its placeholder
    // matches the parcel-number pattern exactly.
    expect(findParcelNumber(FORM)).toBeNull();
  });

  it('skips the placeholder and finds the real parcel number after it', () => {
    expect(findParcelNumber(`${FORM}<li>Parcel 16-31-127-029-0000</li>`)).toBe('16-31-127-029-0000');
  });

  it('keeps the 4-digit encumbrance suffix', () => {
    // Truncating to 12 digits yields a 10-digit BLOCK id, which the county
    // answers with HTTP 200 + the search form — a silent failure, not a 404.
    expect(findParcelNumber('<td>16-31-127-029-0000</td>')).toBe('16-31-127-029-0000');
  });

  it('pads a bare 12-digit id rather than passing a block id downstream', () => {
    expect(findParcelNumber('<td>16-31-127-029</td>')).toBe('16-31-127-029-0000');
  });

  it('throws on a page that is only the search form', () => {
    // Must stay loud: silently returning a placeholder-derived parcel is how
    // an all-zero row reached the picker.
    expect(() => parseParcelDetail(FORM.padEnd(600, ' '))).toThrow(AssessorParseError);
  });

  it('parses the real detail page with the full parcel number', () => {
    const html = readFileSync(join(__dirname, 'fixtures/sl-assessor/detail-expanded.html'), 'utf8');
    const p = parseParcelDetail(html);
    expect(p.parcel_number).toBe('16-31-127-029-0000');
    expect(p.owner_of_record).toBe('GARLUTZO, ANDREW');
  });
});

describe('fillFromRawData — typed fields the label regexes missed', () => {
  // Every one of these came back null on live parcels while raw_data_json
  // held the value, which is why the picker rendered "— · — · $54,138,800".
  // The county's labels are "Address" (not Situs), "Total Acreage" (not
  // Acres) and "Above Grade sqft.".
  const html = readFileSync(join(__dirname, 'fixtures/sl-assessor/detail-expanded.html'), 'utf8');
  const p = parseParcelDetail(html);

  it('resolves situs_address from the "Address" label', () => {
    expect(p.situs_address).toBe('3533 S TERRA SOL DR');
  });

  it('resolves building area from "Above Grade sqft."', () => {
    expect(p.total_bldg_sqft).toBe(1604);
  });

  it('uses TOTAL acreage, not one land record\'s share', () => {
    // This parcel has two land records (0.06 + 0.01). pullByLabel(/acres/i)
    // matched the first record's row and reported 0.06 as the parcel size.
    expect(p.land_acres).toBeCloseTo(0.07, 2);
    expect(p.land_sqft).toBe(Math.round(0.07 * 43560));
  });

  it('resolves the year-prefixed valuation labels without hardcoding a year', () => {
    expect(p.market_value_total).toBe(596600);
    expect(p.market_value_land).toBe(85400);
    expect(p.market_value_improvement).toBe(511200);
    expect(p.tax_year).toBe(2026);
  });

  it('resolves tax district and property type', () => {
    expect(p.tax_district).toBe('14B');
    expect(p.improvement_class).toBe('119 - PUD');
  });
});
