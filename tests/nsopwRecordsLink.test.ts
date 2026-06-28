// Records-link unit tests — pure-function coverage of the address /
// location-type normalization + the "is this a real address" gate.
// The full materializeOffenderLinks path is integration-shaped (D1 +
// multiple table writes) and lives behind the live integration; this
// file pins the pure decisions that drive that path.

import { describe, it, expect } from 'vitest';
import {
  isRealAddress, normLocationType, normalizeAddress,
} from '../src/utils/nsopw/recordsLink';
import type { NsopwLocation } from '../src/utils/nsopw/types';

function loc(over: Partial<NsopwLocation>): NsopwLocation {
  return {
    type: 'R', name: null, streetAddress: null, city: null, county: null,
    state: null, zipCode: null, latitude: null, longitude: null,
    ...over,
  };
}

describe('isRealAddress', () => {
  it('accepts a normal street address', () => {
    expect(isRealAddress(loc({ streetAddress: '3506 S BLAIR CIR', type: 'R' }))).toBe(true);
  });

  it('rejects TRANSIENT placeholder addresses', () => {
    expect(isRealAddress(loc({ streetAddress: 'TRANSIENT', type: 'R' }))).toBe(false);
    expect(isRealAddress(loc({ streetAddress: 'transient', type: 'R' }))).toBe(false);
  });

  it('rejects INCARCERATED / UNKNOWN / N/A / NA', () => {
    for (const v of ['INCARCERATED', 'UNKNOWN', 'N/A', 'NA']) {
      expect(isRealAddress(loc({ streetAddress: v }))).toBe(false);
    }
  });

  it('rejects INCARCERATED type even with a real-looking street', () => {
    expect(isRealAddress(loc({
      streetAddress: '123 PRISON RD', type: 'INCARCERATED',
    }))).toBe(false);
  });

  it('rejects empty / whitespace street', () => {
    expect(isRealAddress(loc({ streetAddress: '' }))).toBe(false);
    expect(isRealAddress(loc({ streetAddress: '   ' }))).toBe(false);
    expect(isRealAddress(loc({ streetAddress: null }))).toBe(false);
  });
});

describe('normLocationType', () => {
  it('canonicalizes residence variants', () => {
    expect(normLocationType('R')).toBe('RESIDENCE');
    expect(normLocationType('RESIDENTIAL')).toBe('RESIDENCE');
    expect(normLocationType('Residence')).toBe('RESIDENCE');
  });

  it('canonicalizes work variants', () => {
    expect(normLocationType('W')).toBe('WORK');
    expect(normLocationType('WORK')).toBe('WORK');
    expect(normLocationType('Employment')).toBe('WORK');
  });

  it('canonicalizes student variants', () => {
    expect(normLocationType('E')).toBe('STUDENT');
    expect(normLocationType('STUDENT')).toBe('STUDENT');
    expect(normLocationType('Educational')).toBe('STUDENT');
    expect(normLocationType('SCHOOL')).toBe('STUDENT');
  });

  it('falls back to OTHER for unknown / empty', () => {
    expect(normLocationType(null)).toBe('OTHER');
    expect(normLocationType('')).toBe('OTHER');
    expect(normLocationType('weirdstring')).toBe('WEIRDSTRING');
  });
});

describe('normalizeAddress', () => {
  it('collapses equivalent address strings', () => {
    const a = normalizeAddress('3506 S Blair Cir');
    const b = normalizeAddress('3506 S BLAIR CIR.');
    const c = normalizeAddress('  3506   S, Blair, Cir  ');
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('preserves house-number # and hyphens', () => {
    expect(normalizeAddress('123 Main St #4B')).toContain('#4b');
    expect(normalizeAddress('123-A Main St')).toContain('123-a');
  });

  it('returns empty on empty input', () => {
    expect(normalizeAddress('')).toBe('');
    expect(normalizeAddress(null)).toBe('');
  });
});
