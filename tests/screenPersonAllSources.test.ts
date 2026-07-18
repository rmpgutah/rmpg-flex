import { describe, it, expect, vi, afterEach } from 'vitest';
import * as orchestrator from '../src/utils/screening/runScreeningScans';
import * as registry from '../src/utils/screening/registry';
import { screenPersonAllSources } from '../src/utils/screening/screenPerson';
import { makeFakeDb } from './helpers/fakeD1';
import type { ScreeningAdapter } from '../src/utils/screening/types';

function makeAdapter(sourceKey: string, overrides: Partial<ScreeningAdapter> = {}): ScreeningAdapter {
  return {
    sourceKey,
    kind: 'sanction',
    label: sourceKey,
    supportsSearch: false,
    supportsWatch: true,
    searchAdHoc: vi.fn(),
    fetchForPerson: vi.fn().mockResolvedValue([]),
    scoreMatch: vi.fn(),
    normalize: vi.fn(),
    confirmHit: vi.fn(),
    ...overrides,
  } as ScreeningAdapter;
}

describe('screenPersonAllSources', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns zeroed result when the person does not exist', async () => {
    const db = makeFakeDb([{ match: /FROM persons WHERE id/, rows: [] }]);
    const result = await screenPersonAllSources({ DB: db } as any, 999);
    expect(result).toEqual({ sourcesRun: 0, newHits: 0, errors: 0 });
  });

  it('runs every supportsWatch adapter for the person and sums results', async () => {
    const personRow = { id: 1, first_name: 'John', middle_name: null, last_name: 'Smith', dob: '1980-01-01', citizenship: null };
    vi.spyOn(registry, 'getAdapters').mockReturnValue([
      makeAdapter('source-a'),
      makeAdapter('source-b'),
    ]);
    vi.spyOn(orchestrator, 'scanPersonAgainstAdapter')
      .mockResolvedValueOnce({ checked: 1, newHits: 2, errors: 0 })
      .mockResolvedValueOnce({ checked: 1, newHits: 1, errors: 1 });

    const db = makeFakeDb([
      { match: /FROM persons WHERE id/, rows: [personRow] },
      { match: /FROM screening_source_state WHERE source_key/, rows: [{ enabled: 1, circuit_broken: 0, hours_since_run: 100 }] },
      { match: /FROM system_config/, rows: [] },
    ]);

    const result = await screenPersonAllSources({ DB: db } as any, 1, { triggeredBy: 'test' });

    expect(result).toEqual({ sourcesRun: 2, newHits: 3, errors: 1 });
  });

  it('skips an adapter whose supportsWatch is false', async () => {
    const personRow = { id: 1, first_name: 'John', middle_name: null, last_name: 'Smith', dob: null, citizenship: null };
    vi.spyOn(registry, 'getAdapters').mockReturnValue([
      makeAdapter('search-only', { supportsWatch: false }),
    ]);
    const scanSpy = vi.spyOn(orchestrator, 'scanPersonAgainstAdapter');

    const db = makeFakeDb([{ match: /FROM persons WHERE id/, rows: [personRow] }]);
    const result = await screenPersonAllSources({ DB: db } as any, 1);

    expect(scanSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ sourcesRun: 0, newHits: 0, errors: 0 });
  });

  it('skips a deliberately disabled source', async () => {
    const personRow = { id: 1, first_name: 'John', middle_name: null, last_name: 'Smith', dob: null, citizenship: null };
    vi.spyOn(registry, 'getAdapters').mockReturnValue([makeAdapter('disabled-source')]);
    const scanSpy = vi.spyOn(orchestrator, 'scanPersonAgainstAdapter');

    const db = makeFakeDb([
      { match: /FROM persons WHERE id/, rows: [personRow] },
      { match: /FROM screening_source_state WHERE source_key/, rows: [{ enabled: 0, circuit_broken: 0, hours_since_run: 0 }] },
    ]);
    const result = await screenPersonAllSources({ DB: db } as any, 1);

    expect(scanSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ sourcesRun: 0, newHits: 0, errors: 0 });
  });

  it('isolates a thrown error from one adapter without aborting the others', async () => {
    const personRow = { id: 1, first_name: 'John', middle_name: null, last_name: 'Smith', dob: null, citizenship: null };
    vi.spyOn(registry, 'getAdapters').mockReturnValue([
      makeAdapter('bad-source'),
      makeAdapter('good-source'),
    ]);
    vi.spyOn(orchestrator, 'scanPersonAgainstAdapter')
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ checked: 1, newHits: 1, errors: 0 });

    const db = makeFakeDb([
      { match: /FROM persons WHERE id/, rows: [personRow] },
      { match: /FROM screening_source_state WHERE source_key/, rows: [{ enabled: 1, circuit_broken: 0, hours_since_run: 100 }] },
      { match: /FROM system_config/, rows: [] },
    ]);

    const result = await screenPersonAllSources({ DB: db } as any, 1);

    expect(result).toEqual({ sourcesRun: 1, newHits: 1, errors: 1 });
  });
});
