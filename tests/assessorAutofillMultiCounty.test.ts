import { describe, it, expect } from 'vitest';
import { applyParcelToRecord, AUTOFILL_FIELDS } from '../src/utils/sl-assessor/autofill';
import type { Parcel } from '../src/utils/parcel-lookup/types';

function makeTooeleParcel(overrides: Partial<Parcel> = {}): Parcel {
  return {
    parcel_number: '05-123-0-0045',
    source: 'tooele_county_recorder',
    source_url: 'https://erecording.tooeleco.gov/eaglesoftware/web/document/2021-004521',
    account_number: null, serial_number: null, tax_district: null,
    owner_of_record: 'DOE JANE', owner_type: 'unknown',
    owner_mailing_address: '47 S MAIN ST TOOELE UT 84074',
    situs_address: null, situs_city: null, situs_zip: null, subdivision: null,
    land_acres: null, land_sqft: null, land_value: null, zoning: null,
    year_built: null, effective_year_built: null, total_bldg_sqft: null,
    finished_sqft: null, basement_sqft: null, garage_sqft: null, stories: null,
    bedrooms: null, bathrooms: null, construction_type: null, improvement_class: null,
    improvement_value: null, market_value_total: null, market_value_land: null,
    market_value_improvement: null, taxable_value: null, assessed_value: null, tax_year: null,
    legal_description: 'LOT 3 BLOCK 2 TOOELE TOWNSITE', plat: null, lot: null, block: null,
    recorded_document_url: 'https://erecording.tooeleco.gov/eaglesoftware/web/document/2021-004521',
    recorded_document_type: 'WARRANTY DEED',
    photo_url: null, layout_url: null,
    sales: [], raw_data_json: {},
    ...overrides,
  };
}

describe('applyParcelToRecord — Tooele recorder-only source', () => {
  it('fills owner/mailing/legal fields but leaves value fields untouched (all null upstream)', () => {
    const { patch, skipped } = applyParcelToRecord({}, makeTooeleParcel());
    expect(patch.parcel_number).toBe('05-123-0-0045');
    expect(patch.owner_of_record).toBe('DOE JANE');
    expect(patch.owner_mailing_address).toBe('47 S MAIN ST TOOELE UT 84074');
    expect(patch.legal_description).toBe('LOT 3 BLOCK 2 TOOELE TOWNSITE');
    expect(patch.year_built).toBeUndefined();
    expect(patch.total_market_value).toBeUndefined();
    expect(skipped).toEqual([]);
  });

  it('never-clobber still holds for Tooele-sourced patches', () => {
    const existing = { owner_of_record: 'EXISTING OWNER ON FILE' };
    const { patch, skipped } = applyParcelToRecord(existing, makeTooeleParcel());
    expect(patch.owner_of_record).toBeUndefined();
    expect(skipped).toContain('owner_of_record');
  });

  it('AUTOFILL_FIELDS still lists all 11 shared columns (unchanged for full-data counties)', () => {
    expect(AUTOFILL_FIELDS).toHaveLength(11);
  });
});
