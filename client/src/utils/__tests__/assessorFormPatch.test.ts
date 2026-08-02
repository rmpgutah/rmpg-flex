// Apply on an UNSAVED record used to be a bare `if (!recordId) return;`
// while the panel still rendered an enabled Apply button — no request, no
// error, no toast. Reported as "Cannot apply changes" and indistinguishable
// from a broken backend. These pin the client-side fill that replaced it.

import { describe, it, expect } from 'vitest';
import { buildAssessorFormPatch, type AssessorParcelDetail } from '../assessorFormPatch';

const PARCEL: AssessorParcelDetail = {
  parcel_number: '15-34-377-012-0000',
  owner_of_record: 'BIG 4000 REDWOOD UT, LLC',
  owner_type: 'entity',
  owner_mailing_address: 'PO BOX 1234',
  situs_address: '4000 S REDWOOD RD',
  situs_city: 'West Valley City',
  situs_zip: '84123',
  year_built: 1972,
  land_sqft: 712206,
  market_value_total: 54138800,
  legal_description: 'LOT 1, REDWOOD SUB',
  tax_district: '24',
  sales: [{ sale_date: '2019-06-01', sale_price: 41000000 }],
};

describe('buildAssessorFormPatch', () => {
  it('fills every mapped field on an empty form', () => {
    const { patch, skipped } = buildAssessorFormPatch(PARCEL, {});
    expect(patch).toMatchObject({
      parcel_number: '15-34-377-012-0000',
      owner_of_record: 'BIG 4000 REDWOOD UT, LLC',
      owner_type: 'entity',
      year_built: '1972',
      land_sqft: '712206',
      total_market_value: '54138800',
      tax_district: '24',
      last_sale_date: '2019-06-01',
      last_sale_price: '41000000',
      city: 'West Valley City',
      zip: '84123',
    });
    expect(skipped).toEqual([]);
  });

  it('NEVER overwrites something the operator already typed', () => {
    // This is authoritative county data merging with operator entry. The
    // operator wins — same contract as applyParcelToRecord() server-side.
    const { patch, skipped } = buildAssessorFormPatch(PARCEL, {
      owner_of_record: 'HAND ENTERED OWNER',
      city: 'Taylorsville',
    });
    expect(patch.owner_of_record).toBeUndefined();
    expect(patch.city).toBeUndefined();
    expect(skipped).toEqual(expect.arrayContaining(['owner_of_record', 'city']));
    // Untouched fields still fill.
    expect(patch.parcel_number).toBe('15-34-377-012-0000');
  });

  it('treats whitespace-only as empty, so a stray space does not block the fill', () => {
    const { patch } = buildAssessorFormPatch(PARCEL, { tax_district: '   ' });
    expect(patch.tax_district).toBe('24');
  });

  it('emits strings — a number would make a controlled input warn', () => {
    const { patch } = buildAssessorFormPatch(PARCEL, {});
    for (const v of Object.values(patch)) expect(typeof v).toBe('string');
  });

  it('skips fields the county has no value for', () => {
    const sparse: AssessorParcelDetail = {
      ...PARCEL, year_built: null, legal_description: null, sales: [],
    };
    const { patch } = buildAssessorFormPatch(sparse, {});
    expect(patch).not.toHaveProperty('year_built');
    expect(patch).not.toHaveProperty('legal_description');
    expect(patch).not.toHaveProperty('last_sale_date');
  });

  it('handles a parcel with no sales array at all', () => {
    const { patch } = buildAssessorFormPatch({ ...PARCEL, sales: undefined }, {});
    expect(patch).not.toHaveProperty('last_sale_price');
    expect(patch.parcel_number).toBe('15-34-377-012-0000');
  });

  it('keeps a legitimate zero value rather than treating it as empty', () => {
    const { patch } = buildAssessorFormPatch({ ...PARCEL, market_value_total: 0 }, {});
    expect(patch.total_market_value).toBe('0');
  });
});
