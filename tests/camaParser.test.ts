// tests/camaParser.test.ts
//
// Asserts the full CAMA column build against REAL captured HTML, not a
// synthetic approximation. The previous sl-assessor fixtures were invented
// (see tests/fixtures/sl-assessor/README.md) and the parser was written to
// match the invention, which is how ~45 residence fields came to parse as
// null on every live parcel without a single failing test.
//
// Reference parcel: 16-31-127-029-0000 (GARLUTZO, ANDREW — 3533 S TERRA SOL
// DR), captured 2026-08-01. Every expected value below was read off the
// county's own rendering.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseCamaDetail, parseLandRecords, parseValueHistory, mergeCama,
  normalizeParcelNumber, stripCodePrefix, coerce, extractLandRecordUrl,
  parseCoordinate, parseLegalDescription,
} from '../src/utils/sl-assessor/camaParser';
import {
  RESIDENCE_FIELDS, PARCEL_FIELDS, VALUATION_FIELDS, LAND_FIELDS, matchAlias,
} from '../src/utils/sl-assessor/camaFields';
import { AssessorParseError } from '../src/utils/sl-assessor/types';

const fx = (n: string) => readFileSync(join(__dirname, 'fixtures/sl-assessor', n), 'utf8');
const pubmore = fx('pubmore-detail.html');
// The expanded rendering is the ONLY source for coordinates, the legal
// description, and per-year taxable value. Verified 2026-08-01: PubMore
// contains no polyx/polyy vars and no Legal Description block at all.
const expanded = fx('detail-expanded.html');

describe('coerce', () => {
  it('reads the county currency rendering', () => {
    expect(coerce('$          85,400', 'int')).toBe(85400);
    expect(coerce('$ 0', 'int')).toBe(0);
    expect(coerce('0.07', 'real')).toBe(0.07);
  });

  it('maps the county placeholders to null rather than storing them as text', () => {
    // SQLite affinity would happily store these strings in an INTEGER
    // column, silently breaking every numeric comparison downstream.
    for (const p of ['', ' ', '-', 'not set', 'UnAv.', 'N/A']) {
      expect(coerce(p, 'int')).toBeNull();
    }
  });
});

describe('stripCodePrefix', () => {
  it('drops the raw code the land continuation page prepends', () => {
    expect(stripCodePrefix('R-RESIDENTIAL')).toBe('RESIDENTIAL');
    expect(stripCodePrefix('IN-INTERIOR')).toBe('INTERIOR');
    expect(stripCodePrefix('PL-PRIMARY-LOT')).toBe('PRIMARY-LOT');
  });

  it('strips exactly one prefix — RP-RES-PRIMARY keeps its RES-PRIMARY tail', () => {
    expect(stripCodePrefix('RP-RES-PRIMARY')).toBe('RES-PRIMARY');
  });

  it('leaves values with no short leading token alone', () => {
    expect(stripCodePrefix('EQUAL-IMPRVD')).toBe('EQUAL-IMPRVD');
    expect(stripCodePrefix('PRVATE/COURT')).toBe('PRVATE/COURT');
    expect(stripCodePrefix('10030-5248')).toBe('10030-5248');
  });

  it('IS unsafe on main-report values — which is why it is opt-in', () => {
    // No shape rule can separate a code prefix from a genuine short first
    // token. These two are indistinguishable to any such rule, so the
    // function is applied ONLY to landRecord2.cfm, where every value is
    // known to carry a prefix. parseCamaDetail deliberately does not call it.
    expect(stripCodePrefix('ROW-END-TOWN')).toBe('END-TOWN');   // would be wrong
    expect(stripCodePrefix('YES-FA DUCT')).toBe('FA DUCT');     // would be wrong
  });

  it('is never applied by the main-report parser', () => {
    // The guarantee that makes the above harmless.
    const p = parseCamaDetail(pubmore);
    expect(p.residence.building_style).toBe('ROW-END-TOWN');
    expect(p.residence.central_ac).toBe('YES-FA DUCT');
  });
});

describe('normalizeParcelNumber', () => {
  it('normalizes both renderings to the dashed 14-digit form', () => {
    expect(normalizeParcelNumber('16311270290000')).toBe('16-31-127-029-0000');
    expect(normalizeParcelNumber('16-31-127-029-0000')).toBe('16-31-127-029-0000');
  });

  it('pads a 10-digit block id rather than passing it through', () => {
    // A 10-digit id makes the county return HTTP 200 + the search form,
    // so passing it through fails silently instead of erroring.
    expect(normalizeParcelNumber('1631127029')).toBe('16-31-127-029-0000');
  });
});

describe('parseCamaDetail — real PubMore/detail.cfm', () => {
  const p = parseCamaDetail(pubmore);

  it('identifies the parcel and owner', () => {
    expect(p.parcel_number).toBe('16-31-127-029-0000');
    expect(p.owner_of_record).toBe('GARLUTZO, ANDREW');
    expect(p.situs_address).toBe('3533 S TERRA SOL DR');
  });

  it('has no coordinates of its own — they live on the expanded page', () => {
    // Documents a real asymmetry rather than papering over it: a complete
    // build REQUIRES both pages, which is what mergeCama() is for.
    expect(p.latitude).toBeNull();
    expect(p.longitude).toBeNull();
  });

  it('captures the whole residence record — the block that previously parsed as all-null', () => {
    expect(p.residence).toMatchObject({
      building_style: 'ROW-END-TOWN',
      assessment_classification: 'PRIMARY',
      exterior_wall_type: 'STUCCO',
      roofing: 'PERMANENT',
      central_ac: 'YES-FA DUCT',
      heating: 'PRIMRY-CNTRL',
      foundation: 'YES',
      msnry_trim: 'NO',
      number_of_stories: 2.0,
      total_rooms: 13,
      bedrooms: 4,
      full_baths: 3,
      half_baths: 1,
      number_of_kitchens: 1,
      year_built: 2012,
      effective_year_built: 2020,
      interior_grade: 'AVERAGE',
      interior_condition: 'EXCELLENT',
      exterior_condition: 'VERY-GOOD',
      overall_condition: 'VERY-GOOD',
      conformity: 'EQUAL-IMPRVD',
      primary_kitchen_quality: 'STANDARD',
      primary_bath_quality: 'BASIC',
      main_floor_area: 600,
      upper_floor_area: 1004,
      above_grade_area: 1604,
      basement_area: 605,
      finished_basement_area: 575,
      finished_basement_grade: 'A',
      builtin_garage_sqft: 460,
      rcn: 229343,
      rcnld: 217876,
      percent_complete: 100,
    });
  });

  it('distinguishes the three fields the county gives the SAME field code', () => {
    // heattype is reused for Heating, Foundation and Msnry Trim. A
    // code-keyed parser collapses these into one.
    expect(p.residence.heating).toBe('PRIMRY-CNTRL');
    expect(p.residence.foundation).toBe('YES');
    expect(p.residence.msnry_trim).toBe('NO');
  });

  it('leaves genuinely blank fields null instead of guessing', () => {
    expect(p.residence.three_quarter_baths).toBeNull();
    expect(p.residence.finished_attic_area).toBeNull();
    expect(p.residence.attached_garage_sqft).toBeNull();
  });

  it('captures the parcel record block', () => {
    expect(p.parcel).toMatchObject({
      par_total_acreage: 0.07,
      par_site_name: '3533 S TERRA SOL DR',
      par_property_type: '119 - PUD',
      par_tax_district: '14B',
      par_tax_district_location: 'SSALTLAKE/G',
      par_b_of_e: '12,13',
      par_detail_year: 6,
      par_update_year: 2019,
      par_mls_number: '1814734',
    });
  });

  it('captures the cost/sel valuation block absent from the expanded page', () => {
    expect(p.parcel).toMatchObject({
      val_land_value: 85400,
      val_building_value: 511200,
      val_final_value: 596600,
      val_cost_land: 85442,
      val_rcn: 229343,
      val_rcnld: 217876,
      val_cost_total: 303300,
      val_cost_date: '05/20/2026',
      val_sel_land_val: 85441,
      val_sel_bldg_val: 511166,
      val_sel_val: 596607,
      val_sel_source: 'AP',
    });
  });

  it('keeps land Land Value separate from valuation Land Value', () => {
    // Both blocks render a row literally labelled "Land Value"; the land
    // record's is $0 and the valuation's is $85,400. A section-blind label
    // match binds the wrong number.
    expect(p.parcel.val_land_value).toBe(85400);
    expect(p.land_records[0]?.land_value).toBe(0);
  });

  it('parses the 5-year value history the old parser never looked at', () => {
    const years = p.value_history.map((r) => r.tax_year);
    expect(years).toEqual([2025, 2024, 2023, 2022, 2021]);
    expect(p.value_history[0]).toMatchObject({
      tax_year: 2025, land_value: 82700, building_value: 482000, market_value: 564700,
    });
    expect(p.value_history[4]).toMatchObject({
      tax_year: 2021, land_value: 61300, building_value: 286000, market_value: 347300,
    });
  });

  it('records the CAMA as-of date so staleness is visible', () => {
    expect(p.cama_as_of).toBe('May 22, 2026');
  });

  it('has no legal description either — also expanded-page only', () => {
    expect(p.legal_description).toBeNull();
  });

  it('exposes the land-record continuation link', () => {
    expect(extractLandRecordUrl(pubmore)).toMatch(/^landRecord2\.cfm\?parcel_id=16311270290000/);
  });

  it('maps every field the page renders — no silent registry gaps', () => {
    // If the county adds a field, this fails and names it, rather than the
    // value disappearing unnoticed.
    expect(p.unmapped_labels).toEqual([]);
  });
});

describe('expanded rendering — the fields PubMore omits', () => {
  it('captures the coordinates the old parser ignored entirely', () => {
    // polyx holds LATITUDE despite the name, confirmed against the parcel's
    // own Google Maps link (q=40.69454,-111.88209). Swapping these would
    // place every Salt Lake County parcel in the Indian Ocean.
    expect(parseCoordinate(expanded, 'polyx')).toBeCloseTo(40.69454087, 6);
    expect(parseCoordinate(expanded, 'polyy')).toBeCloseTo(-111.88209092, 6);
  });

  it('reads the legal description out of its bare div', () => {
    expect(parseLegalDescription(expanded)).toContain('LOT 16, TERRA SOL PUD');
  });

  it('supplies per-year taxable value, which PubMore does not', () => {
    const hist = parseValueHistory(expanded);
    expect(hist.find((r) => r.tax_year === 2025)?.taxable_value).toBe(310585);
    expect(hist.find((r) => r.tax_year === 2021)?.taxable_value).toBe(171435);
  });
});

describe('full merged build — both pages together', () => {
  it('yields a parcel complete in every block', () => {
    const merged = mergeCama(parseCamaDetail(pubmore), {
      latitude: parseCoordinate(expanded, 'polyx'),
      longitude: parseCoordinate(expanded, 'polyy'),
      legal_description: parseLegalDescription(expanded),
      value_history: parseValueHistory(expanded),
    });
    expect(merged.latitude).toBeCloseTo(40.69454087, 6);
    expect(merged.longitude).toBeCloseTo(-111.88209092, 6);
    expect(merged.legal_description).toContain('LOT 16, TERRA SOL PUD');
    expect(merged.residence.building_style).toBe('ROW-END-TOWN');
    expect(merged.parcel.val_cost_total).toBe(303300);
    expect(merged.value_history.find((r) => r.tax_year === 2025)?.taxable_value).toBe(310585);
  });
});

describe('parseCamaDetail — failure modes', () => {
  it('throws on the search-form fallback instead of returning an empty parcel', () => {
    // The county answers an unknown or 10-digit parcel id with HTTP 200 and
    // the search form. Treating that as success is how a bad id becomes a
    // row of nulls in D1.
    const searchForm = '<html><body>' + '<form name="parcelsearch">'.padEnd(600, ' ') +
      '<input id="parcelid"></form></body></html>';
    expect(() => parseCamaDetail(searchForm)).toThrow(AssessorParseError);
  });

  it('throws on a truncated response', () => {
    expect(() => parseCamaDetail('<html></html>')).toThrow(AssessorParseError);
  });
});

describe('parseLandRecords — the continuation page', () => {
  // Second land record present only on landRecord2.cfm. The main report
  // shows "1 of 2" and renders record 1 alone.
  const land2 = `<table>
    <tr><td>Land Record</td><td></td><td></td></tr>
    <tr><td>Record ID</td><td>1</td><td>2</td></tr>
    <tr><td>Lot Use</td><td>R-RESIDENTIAL</td><td>R-RESIDENTIAL</td></tr>
    <tr><td>Lot Type</td><td>PL-PRIMARY-LOT</td><td>RA-RESIDUL-ACRE</td></tr>
    <tr><td>Acres</td><td>0.06</td><td>0.01</td></tr>
    <tr><td>Zone</td><td>1106</td><td>1106</td></tr>
    <tr><td>Std Lot Sz</td><td>0.11</td><td></td></tr>
  </table>`;

  it('returns BOTH land records, not just the first', () => {
    const recs = parseLandRecords(land2);
    expect(recs).toHaveLength(2);
    expect(recs[0]).toMatchObject({ record_id: 1, lot_type: 'PRIMARY-LOT', acres: 0.06 });
    expect(recs[1]).toMatchObject({ record_id: 2, lot_type: 'RESIDUL-ACRE', acres: 0.01 });
  });

  it('strips the code prefix so both sources write the same value', () => {
    expect(parseLandRecords(land2)[0].lot_use).toBe('RESIDENTIAL');
  });
});

describe('mergeCama', () => {
  it('is fill-only — a later source never overwrites a richer earlier one', () => {
    const primary = parseCamaDetail(pubmore);
    const merged = mergeCama(primary, {
      residence: { building_style: 'RE', three_quarter_baths: 2 } as any,
    });
    // Decoded value from the rich page survives...
    expect(merged.residence.building_style).toBe('ROW-END-TOWN');
    // ...but a genuine gap gets filled.
    expect(merged.residence.three_quarter_baths).toBe(2);
  });

  it('lets the continuation page raise the land-record COUNT', () => {
    const primary = parseCamaDetail(pubmore);
    expect(primary.land_records).toHaveLength(1);
    const merged = mergeCama(primary, {
      land_records: [{ record_id: 1 }, { record_id: 2, lot_type: 'RESIDUL-ACRE' }],
    });
    expect(merged.land_records).toHaveLength(2);
    // Record 1 keeps the decoded values from the main report.
    expect(merged.land_records[0].lot_type).toBe('PRIMARY-LOT');
    expect(merged.land_records[1].lot_type).toBe('RESIDUL-ACRE');
  });

  it('fills taxable value per year from the expanded page', () => {
    const primary = parseCamaDetail(pubmore);
    const merged = mergeCama(primary, {
      value_history: [{ tax_year: 2025, taxable_value: 310585 }],
    });
    expect(merged.value_history.find((r) => r.tax_year === 2025)?.taxable_value).toBe(310585);
  });
});

describe('field registry', () => {
  it('has unique column names within each section', () => {
    for (const [name, fields] of Object.entries({
      residence: RESIDENCE_FIELDS, parcel: PARCEL_FIELDS,
      valuation: VALUATION_FIELDS, land: LAND_FIELDS,
    })) {
      const cols = fields.map((f) => f.col);
      expect(new Set(cols).size, `${name} has duplicate columns`).toBe(cols.length);
    }
  });

  it('keeps parcel_records under the D1 100-column cap', () => {
    // 47 pre-existing, MEASURED on live D1 785de7ae after applying mig 0221
    // (pragma_table_info reported 95 total = 47 + 42 + 6). An earlier value
    // of 46 was derived by reading the migration files, which undercounted
    // by one — so this guard was reporting 6 columns of headroom when the
    // real figure is 5. Derive schema constants from the live schema, not
    // from what the migrations appear to say.
    const LIVE_PREEXISTING_COLS = 47;
    const total = LIVE_PREEXISTING_COLS + PARCEL_FIELDS.length + VALUATION_FIELDS.length + 6;
    expect(total).toBe(95);
    expect(total).toBeLessThan(100);
  });

  it('uses column names that are bare SQL identifiers', () => {
    for (const fields of [RESIDENCE_FIELDS, PARCEL_FIELDS, VALUATION_FIELDS, LAND_FIELDS]) {
      for (const f of fields) expect(f.col, f.label).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });
});

describe('cross-rendering label aliases', () => {
  // The same datum is labelled differently on each page. Without aliases the
  // expanded page alone leaves the whole valuation block empty, so a
  // PubMore outage degrades much further than it needs to. These add NO new
  // columns — every alias targets a field that already exists.
  const p = parseCamaDetail(expanded);

  it('populates the valuation block from the expanded page alone', () => {
    expect(p.parcel.val_land_value).toBe(85400);
    expect(p.parcel.val_building_value).toBe(511200);
    expect(p.parcel.val_final_value).toBe(596600);
    expect(p.parcel.val_taxable_value).toBe(328130);
  });

  it('maps "Above Grade sqft." to the residence Above Grade Area', () => {
    expect(p.residence.above_grade_area).toBe(1604);
  });

  it('matches the year-prefixed labels by suffix, not a hardcoded year', () => {
    // The labels read "2026 Market Value" today. Pinning the year would stop
    // matching in January and silently blank the whole block.
    expect(matchAlias('2027 Market Value')?.col).toBe('val_final_value');
    expect(matchAlias('1999 Land Value')?.col).toBe('val_land_value');
    expect(matchAlias('Market Value')).toBeNull();
  });

  it('leaves every label on both renderings mapped', () => {
    expect(p.unmapped_labels).toEqual([]);
  });
});

describe('coerce — malformed county cells', () => {
  it('recovers a number from a cell that swallowed trailing markup', () => {
    // Real cell text: unclosed <td>s make it absorb what follows.
    expect(coerce('$ 328,130 No images found 40.694540870 -111.882090920', 'int')).toBe(328130);
    expect(coerce('$ 171,435 * before Board of Equalization', 'int')).toBe(171435);
  });

  it('stays anchored — a digit appearing later does not become the value', () => {
    expect(coerce('No images found 40.694', 'int')).toBeNull();
    expect(coerce('not set', 'int')).toBeNull();
  });
});
