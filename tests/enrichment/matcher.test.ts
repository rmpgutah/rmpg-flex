import { describe, it, expect } from 'vitest';
import { hardLock } from '../../src/utils/enrichment/matcher';
import type { EnrichmentSeed, EnrichedRecord } from '../../src/utils/enrichment/types';

const baseSeed: EnrichmentSeed = {
  first_name: 'John', last_name: 'Smith',
  dob: '1990-05-12', city: 'Salt Lake City', state: 'UT',
};

const baseRecord: EnrichedRecord = {
  dob: '1990-05-12',
  addresses: [{ city: 'Salt Lake City', state: 'UT', source: 'test' }],
  phones: [], emails: [], source: 'test',
};

describe('hardLock', () => {
  it('confirms when DOB matches and address anchor present', () => {
    const r = hardLock(baseSeed, baseRecord);
    expect(r.confirmed).toBe(true);
    expect(r.anchors).toContain('dob_match');
    expect(r.anchors).toContain('address_anchor');
  });

  it('confirms when DOB matches and dl_number anchor present', () => {
    const seed = { ...baseSeed, dl_number: 'UT123456' };
    const rec  = { ...baseRecord, addresses: [], dl_number: 'UT123456' };
    const r = hardLock(seed, rec);
    expect(r.confirmed).toBe(true);
    expect(r.anchors).toContain('dl_number');
  });

  it('confirms when DOB matches and ssn_last4 anchor present', () => {
    const seed = { ...baseSeed, ssn_last4: '4321' };
    const rec  = { ...baseRecord, addresses: [], ssn_last4: '4321' };
    const r = hardLock(seed, rec);
    expect(r.confirmed).toBe(true);
    expect(r.anchors).toContain('ssn_last4');
  });

  it('does NOT confirm when DOB matches but no secondary anchor', () => {
    const rec = { ...baseRecord, addresses: [] };
    const r = hardLock(baseSeed, rec);
    expect(r.confirmed).toBe(false);
    expect(r.anchors).toContain('dob_match');
  });

  it('does NOT confirm when DOB is missing from seed', () => {
    const seed = { ...baseSeed, dob: undefined };
    const r = hardLock(seed, baseRecord);
    expect(r.confirmed).toBe(false);
    expect(r.anchors).not.toContain('dob_match');
  });

  it('does NOT confirm when DOB is missing from record', () => {
    const rec = { ...baseRecord, dob: undefined };
    const r = hardLock(baseSeed, rec);
    expect(r.confirmed).toBe(false);
  });

  it('confirms when DOBs are within 366 days of each other', () => {
    // 365 days apart — within tolerance
    const seed = { ...baseSeed, dob: '1990-05-12', dl_number: 'UT9' };
    const rec  = { ...baseRecord, addresses: [], dob: '1991-05-11', dl_number: 'UT9' };
    const r = hardLock(seed, rec);
    expect(r.confirmed).toBe(true);
  });

  it('does NOT confirm when DOBs are more than 366 days apart', () => {
    const seed = { ...baseSeed, dob: '1990-05-12', dl_number: 'UT9' };
    const rec  = { ...baseRecord, addresses: [], dob: '1992-01-01', dl_number: 'UT9' };
    const r = hardLock(seed, rec);
    expect(r.confirmed).toBe(false);
  });

  it('records ALL passing anchors even after first confirms', () => {
    const seed = { ...baseSeed, ssn_last4: '1234', dl_number: 'UT999' };
    const rec  = { ...baseRecord, ssn_last4: '1234', dl_number: 'UT999' };
    const r = hardLock(seed, rec);
    expect(r.anchors).toContain('ssn_last4');
    expect(r.anchors).toContain('dl_number');
    expect(r.anchors).toContain('address_anchor');
  });

  it('uses knownCityStates for address anchor when seed city/state is absent', () => {
    const seed = { ...baseSeed, city: undefined, state: undefined };
    const rec  = { ...baseRecord };
    // record has SLC,UT — should match knownCityStates
    const r = hardLock(seed, rec, ['salt lake city|ut']);
    expect(r.confirmed).toBe(true);
    expect(r.anchors).toContain('address_anchor');
  });
});
