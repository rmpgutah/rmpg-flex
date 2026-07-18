import { describe, it, expect, vi } from 'vitest';
import { scanPersonAgainstAdapter } from '../src/utils/screening/runScreeningScans';
import { makeFakeDb } from './helpers/fakeD1';
import type { ScreeningAdapter, PersonRow, NormalizedCandidate, MatchResult } from '../src/utils/screening/types';

function makeAdapter(overrides: Partial<ScreeningAdapter> = {}): ScreeningAdapter {
  return {
    sourceKey: 'test-source',
    kind: 'sanction',
    label: 'Test Source',
    supportsSearch: false,
    supportsWatch: true,
    searchAdHoc: vi.fn().mockResolvedValue([]),
    fetchForPerson: vi.fn().mockResolvedValue([]),
    scoreMatch: vi.fn().mockReturnValue({ score: 0, matchedFields: [], isConfident: false } as MatchResult),
    normalize: vi.fn(),
    confirmHit: vi.fn(),
    ...overrides,
  } as ScreeningAdapter;
}

const person: PersonRow = { id: 42, first_name: 'John', middle_name: null, last_name: 'Smith', dob: '1980-01-01' };

const candidate: NormalizedCandidate = {
  sourceKey: 'test-source',
  externalId: 'ext-1',
  displayName: 'John Smith',
  summary: 'Sanctioned entity',
  raw: { foo: 'bar' },
};

describe('scanPersonAgainstAdapter', () => {
  it('inserts a new screening_hits row when a candidate scores above threshold', async () => {
    const adapter = makeAdapter({
      fetchForPerson: vi.fn().mockResolvedValue([candidate]),
      scoreMatch: vi.fn().mockReturnValue({ score: 0.9, matchedFields: ['name'], isConfident: true }),
    });
    const db = makeFakeDb([{ match: /SELECT id, status FROM screening_hits/, rows: [] }]);

    const result = await scanPersonAgainstAdapter({ DB: db } as any, adapter, person, { threshold: 0.8 });

    expect(result).toEqual({ checked: 1, newHits: 1, errors: 0 });
  });

  it('skips a candidate scoring below threshold', async () => {
    const adapter = makeAdapter({
      fetchForPerson: vi.fn().mockResolvedValue([candidate]),
      scoreMatch: vi.fn().mockReturnValue({ score: 0.5, matchedFields: [], isConfident: false }),
    });
    const db = makeFakeDb([{ match: /SELECT id, status FROM screening_hits/, rows: [] }]);

    const result = await scanPersonAgainstAdapter({ DB: db } as any, adapter, person, { threshold: 0.8 });

    expect(result).toEqual({ checked: 1, newHits: 0, errors: 0 });
  });

  it('updates (not re-inserts) an existing hit and does not count it as new', async () => {
    const adapter = makeAdapter({
      fetchForPerson: vi.fn().mockResolvedValue([candidate]),
      scoreMatch: vi.fn().mockReturnValue({ score: 0.9, matchedFields: ['name'], isConfident: true }),
    });
    const db = makeFakeDb([{ match: /SELECT id, status FROM screening_hits/, rows: [{ id: 7, status: 'pending' }] }]);

    const result = await scanPersonAgainstAdapter({ DB: db } as any, adapter, person, { threshold: 0.8 });

    expect(result).toEqual({ checked: 1, newHits: 0, errors: 0 });
  });

  it('skips candidates with no externalId', async () => {
    const adapter = makeAdapter({
      fetchForPerson: vi.fn().mockResolvedValue([{ ...candidate, externalId: '' }]),
      scoreMatch: vi.fn().mockReturnValue({ score: 0.9, matchedFields: [], isConfident: true }),
    });
    const db = makeFakeDb([]);

    const result = await scanPersonAgainstAdapter({ DB: db } as any, adapter, person, { threshold: 0.8 });

    expect(result).toEqual({ checked: 1, newHits: 0, errors: 0 });
  });

  it('isolates an adapter error into the errors count instead of throwing', async () => {
    const adapter = makeAdapter({
      fetchForPerson: vi.fn().mockRejectedValue(new Error('upstream down')),
    });
    const db = makeFakeDb([]);

    const result = await scanPersonAgainstAdapter({ DB: db } as any, adapter, person, { threshold: 0.8 });

    expect(result).toEqual({ checked: 1, newHits: 0, errors: 1 });
  });
});
