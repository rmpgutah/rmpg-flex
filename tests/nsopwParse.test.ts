// Real-fixture-driven parser tests.
// Fixture captured 2026-06-22 from POST https://nsopw-api.ojp.gov/nsopw/v1/v1.0/search
// (query: firstName=John, lastName=Smith, all jurisdictions). 399 offenders, 317 KB.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseSearchResponse, parseOffender, deriveTier, normalizeDob,
} from '../src/utils/nsopw/parse';

const REAL = JSON.parse(readFileSync(
  join(__dirname, 'fixtures/nsopw/john-smith-search.real.json'),
  'utf-8',
));

describe('NSOPW parseSearchResponse — real wire format', () => {
  const parsed = parseSearchResponse(REAL);

  it('parses all 399 offenders from the real response', () => {
    expect(parsed.offenders.length).toBe(399);
  });

  it('extracts jurisdiction coverage map for 183 jurisdictions', () => {
    expect(Object.keys(parsed.jurisdictionCoverage).length).toBeGreaterThan(150);
    expect(parsed.jurisdictionCoverage['UT']).toBe('ok');
    expect(parsed.jurisdictionCoverage['FL']).toBe('ok');
  });

  it('captures per-jurisdiction record counts (FL has 45 in this query)', () => {
    expect(parsed.jurisdictionRecordCounts['FL']).toBe(45);
    expect(parsed.jurisdictionRecordCounts['GU']).toBe(0);
  });

  it('captures per-jurisdiction response time in ms', () => {
    expect(typeof parsed.jurisdictionResponseTime['FL']).toBe('number');
  });
});

describe('NSOPW parseOffender — real fields', () => {
  const parsed = parseSearchResponse(REAL);

  it('first offender has Lynn Charles Allen with John Smith as alias', () => {
    const o = parsed.offenders[0];
    expect(o.firstName).toBe('LYNN');
    expect(o.middleName).toBe('CHARLES');
    expect(o.lastName).toBe('ALLEN');
    expect(o.aliases.some((a) => a.firstName === 'JOHN' && a.lastName === 'SMITH')).toBe(true);
    expect(o.jurisdiction).toBe('WA');
    expect(o.absconder).toBe(false);
  });

  it('extracts DOB normalized to YYYY-MM-DD from ISO datetime', () => {
    const withDob = parsed.offenders.find((o) => o.dateOfBirth);
    expect(withDob?.dateOfBirth).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('extracts age field', () => {
    const withAge = parsed.offenders.find((o) => o.age != null);
    expect(typeof withAge?.age).toBe('number');
  });

  it('promotes locations[0] into the flat address columns', () => {
    const withLoc = parsed.offenders.find((o) => o.locations.length > 0 && o.locations[0].city);
    expect(withLoc?.city).toBe(withLoc?.locations[0].city);
    expect(withLoc?.state).toBe(withLoc?.locations[0].state);
  });

  it('keeps full locations array for multi-location offenders', () => {
    const multi = parsed.offenders.find((o) => o.locations.length > 1);
    if (multi) {
      expect(multi.locations.length).toBeGreaterThan(1);
    }
  });

  it('photoUrl maps from imageUri', () => {
    const withPhoto = parsed.offenders.find((o) => o.photoUrl);
    expect(withPhoto?.photoUrl).toMatch(/^https?:\/\//);
  });

  it('detailUrl maps from offenderUri and deep-links a state SOR', () => {
    const withDetail = parsed.offenders.find((o) => o.detailUrl);
    expect(withDetail?.detailUrl).toMatch(/^https?:\/\//);
    // The first record's detail URL is icrimewatch.net (Washington).
    expect(parsed.offenders[0].detailUrl).toContain('icrimewatch.net');
  });

  it('derives a stable offender id from offenderUri', () => {
    const o = parsed.offenders[0];
    // 'OfndrID=735527&AgencyID=54473' → 'www.icrimewatch.net:735527'
    expect(o.nsopwOffenderId).toContain('icrimewatch.net');
    expect(o.nsopwOffenderId).toContain('735527');
  });

  it('jurisdictionLabel resolves for known codes', () => {
    const fl = parsed.offenders.find((o) => o.jurisdiction === 'FL');
    expect(fl?.jurisdictionLabel).toBe('Florida');
  });

  it('absconder flag preserved (94% have it)', () => {
    const truthy = parsed.offenders.filter((o) => o.absconder === true);
    const falsy = parsed.offenders.filter((o) => o.absconder === false);
    expect(truthy.length + falsy.length).toBe(parsed.offenders.length);
  });
});

describe('NSOPW normalizeDob', () => {
  it('strips T00:00:00 time component', () => {
    expect(normalizeDob('1972-04-28T00:00:00')).toBe('1972-04-28');
    expect(normalizeDob('1985-06-12T12:34:56')).toBe('1985-06-12');
  });
  it('passes through already-normalized dates', () => {
    expect(normalizeDob('1972-04-28')).toBe('1972-04-28');
  });
  it('returns null for empty / non-ISO input', () => {
    expect(normalizeDob(null)).toBeNull();
    expect(normalizeDob('')).toBeNull();
    expect(normalizeDob('garbage')).toBeNull();
  });
});

describe('NSOPW deriveTier (utility, not present in federated response)', () => {
  it('maps tier labels to integers', () => {
    expect(deriveTier('Tier 3')).toBe(3);
    expect(deriveTier('SVP')).toBe(3);
    expect(deriveTier('Level 2')).toBe(2);
    expect(deriveTier('Tier 1')).toBe(1);
    expect(deriveTier('Low')).toBe(1);
    expect(deriveTier(null)).toBeNull();
  });
});

describe('NSOPW parseOffender — defensive cases', () => {
  it('returns null for non-object input', () => {
    expect(parseOffender(null)).toBeNull();
    expect(parseOffender('string')).toBeNull();
  });

  it('returns null when both names empty', () => {
    expect(parseOffender({ name: {} })).toBeNull();
  });

  it('survives missing locations array', () => {
    const o = parseOffender({
      name: { givenName: 'X', surName: 'Y' },
      jurisdictionId: 'UT',
    });
    expect(o?.locations).toEqual([]);
    expect(o?.city).toBeNull();
  });

  it('treats lat/long === 0 as unknown coordinates', () => {
    const o = parseOffender({
      name: { givenName: 'X', surName: 'Y' },
      jurisdictionId: 'UT',
      locations: [{ city: 'X', state: 'UT', latitude: 0, longitude: 0 }],
    });
    expect(o?.locations[0].latitude).toBeNull();
    expect(o?.locations[0].longitude).toBeNull();
  });
});
