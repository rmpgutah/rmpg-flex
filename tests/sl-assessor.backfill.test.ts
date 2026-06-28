import { describe, expect, test } from 'vitest';
import { decideOutcome, BACKFILL_RATE_PER_MIN }
  from '../src/utils/sl-assessor/backfill';
import type { ParcelSummary } from '../src/utils/sl-assessor/types';

const one: ParcelSummary = {
  parcel_number: '16-04-301-005', owner_of_record: 'XYZ HOLDINGS LLC',
  situs_address: '2200 S 500 E', land_sqft: 12400, total_market_value: 1_840_000,
  detail_url: '',
};
const two: ParcelSummary = { ...one, parcel_number: '16-04-301-006' };

describe('decideOutcome', () => {
  test('0 matches → no_match', () => {
    expect(decideOutcome([]).status).toBe('no_match');
  });
  test('1 match → applied + parcel_number set', () => {
    const r = decideOutcome([one]);
    expect(r.status).toBe('applied');
    if (r.status !== 'applied') throw new Error('narrowing');
    expect(r.applied_parcel_number).toBe('16-04-301-005');
  });
  test('N matches → ambiguous + matches_json', () => {
    const r = decideOutcome([one, two]);
    expect(r.status).toBe('ambiguous');
    if (r.status !== 'ambiguous') throw new Error('narrowing');
    expect(JSON.parse(r.matches_json).length).toBe(2);
  });
});

describe('rate cap', () => {
  test('BACKFILL_RATE_PER_MIN is 30', () => {
    expect(BACKFILL_RATE_PER_MIN).toBe(30);
  });
});
