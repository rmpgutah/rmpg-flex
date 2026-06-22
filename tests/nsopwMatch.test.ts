import { describe, it, expect } from 'vitest';
import { classifyCandidate, classifyAll, levenshtein } from '../src/utils/nsopw/match';
import type { NsopwOffender, NsopwQuery } from '../src/utils/nsopw/types';

function offender(over: Partial<NsopwOffender> = {}): NsopwOffender {
  return {
    nsopwOffenderId: 'X1', jurisdiction: 'UT', jurisdictionLabel: 'Utah',
    firstName: '', middleName: null, lastName: '', suffix: null, aliases: [],
    dateOfBirth: null, age: null, sex: null, race: null,
    height: null, weight: null,
    hairColor: null, eyeColor: null, scarsMarks: null,
    address: null, city: null, county: null, state: null, zip: null,
    latitude: null, longitude: null, locations: [], absconder: false,
    offense: null, riskLevel: null, tier: null,
    registrationStatus: null, complianceStatus: null,
    photoUrl: null, localPhotoUrl: null, rowId: null, detailUrl: null, raw: {},
    ...over,
  };
}

describe('NSOPW classifyCandidate — strict + officer confirms', () => {
  const q: NsopwQuery = { surname: 'Smith', forename: 'John', dob: '1985-06-12' };

  it('exact name + exact DOB → confirmed', () => {
    const c = classifyCandidate(q, offender({
      firstName: 'John', lastName: 'Smith', dateOfBirth: '1985-06-12',
    }));
    expect(c.classification).toBe('confirmed');
    expect(c.matchedFields).toContain('dob');
    expect(c.score).toBeGreaterThanOrEqual(1.0);
  });

  it('exact name, no DOB on candidate → possible (cant auto-confirm without DOB cross-ref)', () => {
    const c = classifyCandidate(q, offender({
      firstName: 'John', lastName: 'Smith', dateOfBirth: null,
    }));
    expect(c.classification).toBe('possible');
  });

  it('exact name, DOB mismatch → excluded (cannot be the same person)', () => {
    const c = classifyCandidate(q, offender({
      firstName: 'John', lastName: 'Smith', dateOfBirth: '1990-01-01',
    }));
    expect(c.classification).toBe('excluded');
  });

  it('surname mismatch → excluded immediately', () => {
    const c = classifyCandidate(q, offender({
      firstName: 'John', lastName: 'Jones', dateOfBirth: '1985-06-12',
    }));
    expect(c.classification).toBe('excluded');
  });

  it('surname-only match (first initial only) → possible', () => {
    const c = classifyCandidate(q, offender({
      firstName: 'James', lastName: 'Smith', dateOfBirth: null,
    }));
    expect(c.classification).toBe('possible');
    expect(c.matchedFields).toContain('forename-initial');
  });

  it('phonetic forename (Stephen/Steven) → possible, not confirmed', () => {
    const c = classifyCandidate(
      { surname: 'Smith', forename: 'Stephen' },
      offender({ firstName: 'Steven', lastName: 'Smith' }),
    );
    expect(c.classification).toBe('possible');
    expect(c.matchedFields).toContain('forename-phonetic');
  });

  it('alias-only surname match → possible (never confirmed)', () => {
    const c = classifyCandidate(
      { surname: 'Garcia', forename: 'Carlos', dob: '1985-06-12' },
      offender({
        firstName: 'Carlos', lastName: 'Rodriguez', dateOfBirth: '1985-06-12',
        aliases: [
          { firstName: 'Carlos', middleName: null, lastName: 'Garcia' },
          { firstName: 'C', middleName: null, lastName: 'Garcia' },
        ],
      }),
    );
    // Still a possible because alias-only surname can never reach the
    // strict-confirm 1.0 threshold (surname-alias caps at 0.2).
    expect(['possible', 'excluded']).toContain(c.classification);
  });

  it('no DOB on either side → possible at most, never confirmed', () => {
    const c = classifyCandidate(
      { surname: 'Smith', forename: 'John' },
      offender({ firstName: 'John', lastName: 'Smith', dateOfBirth: null }),
    );
    expect(c.classification).toBe('possible');
    expect(c.matchedFields).not.toContain('dob');
  });
});

describe('NSOPW classifyAll', () => {
  const q: NsopwQuery = { surname: 'Smith', forename: 'John', dob: '1985-06-12' };

  it('sorts confirmed before possible before excluded by score', () => {
    const candidates = [
      offender({ firstName: 'James', lastName: 'Smith', dateOfBirth: null }),    // possible
      offender({ firstName: 'John', lastName: 'Smith', dateOfBirth: '1985-06-12' }), // confirmed
      offender({ firstName: 'Mary', lastName: 'Jones', dateOfBirth: '1985-06-12' }), // excluded
    ];
    const ranked = classifyAll(q, candidates);
    expect(ranked[0].classification).toBe('confirmed');
    expect(ranked[ranked.length - 1].score).toBeLessThanOrEqual(ranked[0].score);
  });
});

describe('Levenshtein', () => {
  it('handles common cases', () => {
    expect(levenshtein('', '')).toBe(0);
    expect(levenshtein('abc', 'abc')).toBe(0);
    expect(levenshtein('abc', 'abd')).toBe(1);
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('stephen', 'steven')).toBe(2);
  });
});
