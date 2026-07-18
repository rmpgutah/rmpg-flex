import { describe, it, expect, vi } from 'vitest';
import {
  configFromEnv,
  resolveCitation,
  searchLegislation,
} from '../src/utils/legalDataHunter/client';
import {
  LdhConfigError,
  LdhTimeoutError,
  LdhHttpError,
  LdhRateLimitError,
} from '../src/utils/legalDataHunter/errors';

describe('configFromEnv', () => {
  it('throws LdhConfigError when the key is missing', () => {
    expect(() => configFromEnv({})).toThrow(LdhConfigError);
  });

  it('throws LdhConfigError when the key is blank', () => {
    expect(() => configFromEnv({ LEGAL_DATA_HUNTER_API_KEY: '   ' })).toThrow(LdhConfigError);
  });

  it('returns a config with the trimmed key', () => {
    const cfg = configFromEnv({ LEGAL_DATA_HUNTER_API_KEY: ' sk-test-123 ' });
    expect(cfg.apiKey).toBe('sk-test-123');
  });
});

describe('resolveCitation', () => {
  const config = { apiKey: 'sk-test-123' };

  it('posts to /v1/resolve with the bearer header and returns the parsed body', async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe('https://legaldatahunter.com/v1/resolve');
      expect(init?.method).toBe('POST');
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe('Bearer sk-test-123');
      expect(headers.get('content-type')).toBe('application/json');
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({ reference: 'Utah Code 76-6-404', hint_country: 'US', hint_type: 'legislation' });
      return new Response(JSON.stringify({
        reference: 'Utah Code 76-6-404',
        resolved: true,
        match_type: 'exact',
        documents: [{ source: 'US/Utah', source_id: '76-6-404', title: 'Theft', data_type: 'legislation' }],
        elapsed_ms: 42,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const result = await resolveCitation({
      config,
      reference: 'Utah Code 76-6-404',
      hintCountry: 'US',
      hintType: 'legislation',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.resolved).toBe(true);
    expect(result.documents[0].title).toBe('Theft');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('throws LdhHttpError on a non-2xx, non-429 response', async () => {
    const fetchImpl = vi.fn(async () => new Response('bad request', { status: 400 }));
    await expect(resolveCitation({
      config,
      reference: 'garbage',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })).rejects.toBeInstanceOf(LdhHttpError);
  });

  it('throws LdhRateLimitError on 429 with Retry-After', async () => {
    const fetchImpl = vi.fn(async () => new Response('rate limited', {
      status: 429,
      headers: { 'retry-after': '30' },
    }));
    await expect(resolveCitation({
      config,
      reference: 'Utah Code 76-6-404',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })).rejects.toBeInstanceOf(LdhRateLimitError);
  });

  it('throws LdhTimeoutError when fetch never resolves before the timeout', async () => {
    const fetchImpl = vi.fn(() => new Promise<Response>(() => { /* never resolves */ }));
    await expect(resolveCitation({
      config,
      reference: 'Utah Code 76-6-404',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 10,
    })).rejects.toBeInstanceOf(LdhTimeoutError);
  });
});

describe('searchLegislation', () => {
  const config = { apiKey: 'sk-test-123' };

  it('posts to /v1/search with namespace=legislation and returns hits', async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe('https://legaldatahunter.com/v1/search');
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({ q: 'theft third degree felony', namespace: 'legislation', top_k: 3, country: ['US'] });
      return new Response(JSON.stringify({
        query: 'theft third degree felony',
        hits: [{ source: 'US/Utah', source_id: '76-6-404', score: 0.91, title: 'Theft', snippet: '...', url: 'https://le.utah.gov/xcode/Title76/Chapter6/76-6-S404.html', country: 'US' }],
        total_hits: 1,
        namespace: 'legislation',
        elapsed_ms: 88,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const result = await searchLegislation({
      config,
      query: 'theft third degree felony',
      country: ['US'],
      topK: 3,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.total_hits).toBe(1);
    expect(result.hits[0].title).toBe('Theft');
  });
});
