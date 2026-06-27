import { describe, expect, test } from 'vitest';
import { applyParcelToRecord, AUTOFILL_FIELDS }
  from '../src/utils/sl-assessor/autofill';
import type { Parcel } from '../src/utils/sl-assessor/types';

const parcel: Parcel = {
  parcel_number: '16-04-301-005',
  source: 'sl_county_assessor',
  source_url: 'https://apps.saltlakecounty.gov/assessor/new/query.cfm?parcel=16-04-301-005',
  account_number: null, serial_number: null, tax_district: 'SLC',
  owner_of_record: 'XYZ HOLDINGS LLC', owner_type: 'entity',
  owner_mailing_address: 'PO BOX 1, SLC UT 84106',
  situs_address: '2200 S 500 E', situs_city: 'SLC', situs_zip: '84106', subdivision: null,
  land_acres: 0.28, land_sqft: 12400, land_value: null, zoning: null,
  year_built: 1958, effective_year_built: 1980,
  total_bldg_sqft: null, finished_sqft: null, basement_sqft: null, garage_sqft: null,
  stories: null, bedrooms: null, bathrooms: null,
  construction_type: null, improvement_class: null, improvement_value: null,
  market_value_total: 1_840_000, market_value_land: null, market_value_improvement: null,
  taxable_value: null, assessed_value: null, tax_year: 2025,
  legal_description: 'LOT 5 BLK 3 ACME SUB',
  plat: null, lot: '5', block: '3',
  sales: [], raw_data_json: {},
};

describe('applyParcelToRecord', () => {
  test('fills empty fields', () => {
    const record = { address: '2200 S 500 E', owner_name: 'Bob\'s Diner' };
    const { patch, skipped } = applyParcelToRecord(record, parcel);
    expect(patch.parcel_number).toBe('16-04-301-005');
    expect(patch.owner_of_record).toBe('XYZ HOLDINGS LLC');
    expect(patch.year_built).toBe(1958);
    expect(patch.total_market_value).toBe(1_840_000);
    expect(patch.legal_description).toBe('LOT 5 BLK 3 ACME SUB');
    expect(patch).not.toHaveProperty('owner_name');  // not in AUTOFILL_FIELDS
    expect(skipped).toEqual([]);
  });

  test('never clobbers a non-empty user-typed field', () => {
    const record = {
      parcel_number: '99-99-999-999',
      owner_of_record: 'EXISTING OWNER',
      year_built: null,                  // empty → fillable
    };
    const { patch, skipped } = applyParcelToRecord(record, parcel);
    expect(patch.parcel_number).toBeUndefined();
    expect(patch.owner_of_record).toBeUndefined();
    expect(patch.year_built).toBe(1958);
    expect(skipped.sort()).toEqual(['owner_of_record', 'parcel_number'].sort());
  });

  test('skips Assessor field if null', () => {
    const sparse = { ...parcel, year_built: null, market_value_total: null };
    const record = {};
    const { patch } = applyParcelToRecord(record, sparse);
    expect(patch).not.toHaveProperty('year_built');
    expect(patch).not.toHaveProperty('total_market_value');
  });

  test('always stamps source_url + last_synced_at', () => {
    const record = {};
    const { patch } = applyParcelToRecord(record, parcel);
    expect(patch.assessor_source_url).toBe(parcel.source_url);
    expect(typeof patch.assessor_last_synced_at).toBe('string');
  });

  test('AUTOFILL_FIELDS covers every column we ALTERed onto businesses/properties', () => {
    expect([...AUTOFILL_FIELDS].sort()).toEqual([
      'parcel_number', 'owner_of_record', 'owner_type', 'owner_mailing_address',
      'year_built', 'total_market_value', 'land_sqft',
      'last_sale_date', 'last_sale_price', 'legal_description', 'tax_district',
    ].sort());
  });
});
