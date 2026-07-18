import { describe, it, expect } from 'vitest';
import {
  resolveEffectiveCounty, buildManualUrl, isOverridableCounty, COUNTY_LABELS,
} from '../src/utils/parcel-lookup/lookup';

describe('resolveEffectiveCounty', () => {
  it('honors an explicit override over the address-derived county', () => {
    expect(resolveEffectiveCounty('100 Main St, Salt Lake City, UT', 'utah')).toBe('utah');
  });

  it('falls back to router resolution when no override is set', () => {
    expect(resolveEffectiveCounty('100 Main St, Salt Lake City, UT', null)).toBe('salt_lake');
    expect(resolveEffectiveCounty('100 Main St, Salt Lake City, UT')).toBe('salt_lake');
  });

  it('ignores an invalid/garbage override value', () => {
    expect(resolveEffectiveCounty('100 Main St, Salt Lake City, UT', 'not_a_county')).toBe('salt_lake');
  });
});

describe('isOverridableCounty', () => {
  it('accepts the four supported counties', () => {
    expect(isOverridableCounty('salt_lake')).toBe(true);
    expect(isOverridableCounty('utah')).toBe(true);
    expect(isOverridableCounty('summit')).toBe(true);
    expect(isOverridableCounty('tooele')).toBe(true);
  });

  it('rejects unsupported and garbage values', () => {
    expect(isOverridableCounty('unsupported')).toBe(false);
    expect(isOverridableCounty('davis')).toBe(false);
    expect(isOverridableCounty(null)).toBe(false);
    expect(isOverridableCounty(undefined)).toBe(false);
  });
});

describe('buildManualUrl', () => {
  it('builds a manual search URL per county', () => {
    expect(buildManualUrl('salt_lake', '100 Main St')).toContain('saltlakecounty.gov');
    expect(buildManualUrl('utah', '100 Main St')).toContain('utahcounty.gov');
    expect(buildManualUrl('summit', '100 Main St')).toContain('summitcounty.org');
    expect(buildManualUrl('tooele', '100 Main St')).toContain('tooeleco.gov');
  });

  it('returns empty string for unsupported county', () => {
    expect(buildManualUrl('unsupported', '100 Main St')).toBe('');
  });
});

describe('COUNTY_LABELS', () => {
  it('has a human label for every county', () => {
    expect(COUNTY_LABELS.salt_lake).toBe('Salt Lake County');
    expect(COUNTY_LABELS.utah).toBe('Utah County');
    expect(COUNTY_LABELS.summit).toBe('Summit County');
    expect(COUNTY_LABELS.tooele).toBe('Tooele County');
  });
});
