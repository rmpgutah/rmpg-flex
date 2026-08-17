import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const CLOUD = 'https://api.rmpgutah.us';
const LOCAL = 'http://fz55:8787';

function makeResponse(body: object, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
    clone: function() { return this; },
  } as unknown as Response;
}

describe('dualWrite', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('returns local response when both succeed', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockResolvedValueOnce(makeResponse({ source: 'local' }))
      .mockResolvedValueOnce(makeResponse({ source: 'cloud' }));

    const { dualWrite } = await import('../useApi');
    const result = await dualWrite<{ source: string }>('/api/test', {}, LOCAL, CLOUD);
    expect(result).toEqual({ source: 'local' });
  });

  it('returns cloud response when local fails', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(makeResponse({ source: 'cloud' }));

    const { dualWrite } = await import('../useApi');
    const result = await dualWrite<{ source: string }>('/api/test', {}, LOCAL, CLOUD);
    expect(result).toEqual({ source: 'cloud' });
  });

  it('returns local response when cloud fails', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockResolvedValueOnce(makeResponse({ source: 'local' }))
      .mockRejectedValueOnce(new Error('timeout'));

    const { dualWrite } = await import('../useApi');
    const result = await dualWrite<{ source: string }>('/api/test', {}, LOCAL, CLOUD);
    expect(result).toEqual({ source: 'local' });
  });

  it('throws when both fail', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('timeout'));

    const { dualWrite } = await import('../useApi');
    await expect(dualWrite('/api/test', {}, LOCAL, CLOUD)).rejects.toThrow('No connectivity');
  });

  it('falls back to cloud-only when no localBase', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(makeResponse({ source: 'cloud' }));

    const { dualWrite } = await import('../useApi');
    const result = await dualWrite<{ source: string }>('/api/test', {}, null, CLOUD);
    expect(result).toEqual({ source: 'cloud' });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
