import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkBankruptcy, _clearBkCacheForTests } from '../bankruptcyCheck';

vi.mock('../../models/database', () => ({
  // Default: no token row in system_config. Individual tests override the
  // prepare().get() return via vi.mocked re-mock if they need a token.
  getDb: vi.fn(() => ({
    prepare: () => ({ get: () => null }),
  })),
}));

describe('checkBankruptcy', () => {
  beforeEach(() => {
    _clearBkCacheForTests();
    delete process.env.COURTLISTENER_API_TOKEN;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns skipped when no token is configured', async () => {
    const r = await checkBankruptcy('Abbey', 'Armstrong');
    expect(r.source).toBe('skipped');
    expect(r.found).toBe(false);
    expect(r.cases).toEqual([]);
  });

  it('returns skipped when either name is empty', async () => {
    process.env.COURTLISTENER_API_TOKEN = 'dummy-token';
    const r = await checkBankruptcy('', 'Armstrong');
    expect(r.source).toBe('skipped');
    const r2 = await checkBankruptcy('Abbey', '');
    expect(r2.source).toBe('skipped');
  });

  it('calls CourtListener and maps results when token is set via env', async () => {
    process.env.COURTLISTENER_API_TOKEN = 'test-token';
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({
        results: [
          { docketNumber: '22-20001', dateFiled: '2022-03-15', court: 'utb', status: 'Open' },
        ],
      }),
      { status: 200 },
    ));
    vi.stubGlobal('fetch', fetchMock);
    const r = await checkBankruptcy('John', 'Doe');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(r.source).toBe('courtlistener');
    expect(r.found).toBe(true);
    expect(r.cases[0].caseNumber).toBe('22-20001');
  });

  it('caches results across back-to-back calls for the same name', async () => {
    process.env.COURTLISTENER_API_TOKEN = 'test-token';
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ results: [] }),
      { status: 200 },
    ));
    vi.stubGlobal('fetch', fetchMock);
    const a = await checkBankruptcy('Jane', 'Smith');
    const b = await checkBankruptcy('Jane', 'Smith');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(a.source).toBe('courtlistener');
    expect(b.source).toBe('cache');
  });
});
