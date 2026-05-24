import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { splitName, expectedAge, matchesAge, WarrantsUtahGovSource } from '../sources/warrants-utah-gov.ts';

describe('splitName', () => {
  it('parses canonical "LAST, FIRST MIDDLE" form', () => {
    expect(splitName('SMITH, JOHN Q')).toEqual({ first: 'JOHN', last: 'SMITH' });
  });

  it('parses "FIRST LAST" form', () => {
    expect(splitName('John Smith')).toEqual({ first: 'John', last: 'Smith' });
  });

  it('treats last token as surname for "FIRST MIDDLE LAST"', () => {
    expect(splitName('John Quincy Adams')).toEqual({ first: 'John', last: 'Adams' });
  });

  it('rejects mononyms (empty first or last)', () => {
    expect(splitName('Cher')).toEqual({ first: '', last: '' });
    expect(splitName('')).toEqual({ first: '', last: '' });
    expect(splitName('   ')).toEqual({ first: '', last: '' });
  });

  it('handles only-comma form gracefully', () => {
    const r = splitName('SMITH,');
    expect(r.last).toBe('SMITH');
    expect(r.first).toBe('');
  });
});

describe('expectedAge', () => {
  // Freeze time so DOB->age math is deterministic.
  beforeEach(() => vi.useFakeTimers().setSystemTime(new Date('2026-05-24T12:00:00Z')));
  afterEach(() => vi.useRealTimers());

  it('returns age directly when provided', () => {
    expect(expectedAge({ age: 47 })).toBe(47);
  });

  it('floors fractional age (defensive against systems storing years.months)', () => {
    expect(expectedAge({ age: 47.9 })).toBe(47);
  });

  it('prefers age over dob when both supplied', () => {
    expect(expectedAge({ age: 30, dob: '1900-01-01' })).toBe(30);
  });

  it('derives age from dob when only dob supplied', () => {
    expect(expectedAge({ dob: '1985-03-14' })).toBe(41); // 2026 - 1985, birthday already passed
  });

  it('handles birthday-not-yet-this-year case (subtracts one)', () => {
    // Today is 2026-05-24. Birthday 2026-12-31 hasn't happened yet.
    expect(expectedAge({ dob: '1985-12-31' })).toBe(40);
  });

  it('handles birthday-today edge case (age increments on the day)', () => {
    expect(expectedAge({ dob: '1985-05-24' })).toBe(41);
  });

  it('returns undefined when neither field supplied', () => {
    expect(expectedAge({})).toBeUndefined();
  });

  it('returns undefined for unparseable dob', () => {
    expect(expectedAge({ dob: 'not-a-date' })).toBeUndefined();
  });

  it('rejects negative age', () => {
    expect(expectedAge({ age: -5 })).toBeUndefined();
  });
});

describe('matchesAge', () => {
  it('accepts exact match', () => {
    expect(matchesAge('47', 47)).toBe(true);
  });

  it('accepts +1 (just had birthday on portal side)', () => {
    expect(matchesAge('48', 47)).toBe(true);
  });

  it('accepts -1 (just had birthday on system side)', () => {
    expect(matchesAge('46', 47)).toBe(true);
  });

  it('rejects ±2', () => {
    expect(matchesAge('49', 47)).toBe(false);
    expect(matchesAge('45', 47)).toBe(false);
  });

  it('accepts missing api age (cannot reject on missing data)', () => {
    expect(matchesAge(undefined, 47)).toBe(true);
  });

  it('accepts unparseable api age (cannot reject on bad data)', () => {
    expect(matchesAge('unknown', 47)).toBe(true);
  });
});

// Behavioral tests for lookup() — exercise the multi-match disambiguation
// rule. We mock global fetch to return canned API responses, so these run
// without network access.
describe('WarrantsUtahGovSource.lookup() disambiguation', () => {
  const originalFetch = globalThis.fetch;

  function mockApi(personsResponse: any, warrantsByPersonId: Record<string, any>) {
    globalThis.fetch = vi.fn(async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.endsWith('/api/v1/persons') && init?.method === 'POST') {
        return new Response(JSON.stringify(personsResponse), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      }
      const m = url.match(/\/api\/v1\/persons\/([^/]+)\/warrants$/);
      if (m) {
        const body = warrantsByPersonId[m[1]] ?? { warrants: [] };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as any;
  }

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns warrants for single-match without filtering on age (trust the API)', async () => {
    mockApi(
      { persons: [{ id: '100', name: { first: 'JANE', last: 'DOE' }, age: '50' }] },
      { '100': { warrants: [{ id: 'W1', issueDate: '2020-01-01', charges: ['THEFT'] }] } },
    );
    const src = new WarrantsUtahGovSource({ minIntervalMs: 0 });
    // Caller supplies age 47, portal has age 50 — ±3y mismatch. Single match,
    // so we trust the name match and DO NOT drop the warrant.
    const result = await src.lookup({ name: 'JANE DOE', age: 47 });
    expect(result).toHaveLength(1);
    expect(result[0].sourceWarrantId).toBe('W1');
  });

  it('disambiguates by age when multiple persons returned', async () => {
    mockApi(
      {
        persons: [
          { id: '100', name: { first: 'JOHN', last: 'SMITH' }, age: '47' },
          { id: '101', name: { first: 'JOHN', last: 'SMITH' }, age: '64' },
          { id: '102', name: { first: 'JOHN', last: 'SMITH' }, age: '30' },
        ],
      },
      {
        '100': { warrants: [{ id: 'W47', charges: ['A'] }] },
        '101': { warrants: [{ id: 'W64', charges: ['B'] }] },
        '102': { warrants: [{ id: 'W30', charges: ['C'] }] },
      },
    );
    const src = new WarrantsUtahGovSource({ minIntervalMs: 0 });
    const result = await src.lookup({ name: 'JOHN SMITH', age: 47 });
    const ids = result.map((w) => w.sourceWarrantId).sort();
    expect(ids).toEqual(['W47']); // only the 47-year-old, not 64 or 30
  });

  it('returns all when multi-match but no disambiguator supplied', async () => {
    mockApi(
      {
        persons: [
          { id: '100', name: { first: 'JOHN', last: 'SMITH' }, age: '47' },
          { id: '101', name: { first: 'JOHN', last: 'SMITH' }, age: '64' },
        ],
      },
      {
        '100': { warrants: [{ id: 'W47', charges: ['A'] }] },
        '101': { warrants: [{ id: 'W64', charges: ['B'] }] },
      },
    );
    const src = new WarrantsUtahGovSource({ minIntervalMs: 0 });
    const result = await src.lookup({ name: 'JOHN SMITH' });
    expect(result.map((w) => w.sourceWarrantId).sort()).toEqual(['W47', 'W64']);
  });

  it('returns empty when caller refuses ambiguous name without disambiguator', async () => {
    // (Covers: caller provides only first OR only last → empty before API hit.)
    mockApi({ persons: [] }, {});
    const src = new WarrantsUtahGovSource({ minIntervalMs: 0 });
    expect(await src.lookup({ name: 'Cher' })).toEqual([]);
    // fetch never called because splitName rejected mononym
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('returns empty when multi-match and zero candidates fit age filter', async () => {
    mockApi(
      {
        persons: [
          { id: '100', name: { first: 'X', last: 'Y' }, age: '20' },
          { id: '101', name: { first: 'X', last: 'Y' }, age: '80' },
        ],
      },
      { '100': { warrants: [{ id: 'A', charges: [] }] }, '101': { warrants: [{ id: 'B', charges: [] }] } },
    );
    const src = new WarrantsUtahGovSource({ minIntervalMs: 0 });
    expect(await src.lookup({ name: 'X Y', age: 47 })).toEqual([]);
  });
});
