import { describe, it, expect, vi } from 'vitest';
import { executeWebSearch, webSearchToolDefinition } from '../src/tools/webSearch';

describe('webSearchToolDefinition', () => {
  it('declares a function tool named web_search with a query parameter', () => {
    expect(webSearchToolDefinition.type).toBe('function');
    expect(webSearchToolDefinition.function.name).toBe('web_search');
    expect(webSearchToolDefinition.function.parameters).toMatchObject({
      type: 'object',
      properties: { query: expect.any(Object) },
      required: ['query'],
    });
  });
});

describe('executeWebSearch', () => {
  it('returns up to 5 mapped results on success', async () => {
    const braveResponse = {
      web: {
        results: Array.from({ length: 8 }, (_, i) => ({
          title: `Result ${i}`,
          url: `https://example.com/${i}`,
          description: `Snippet ${i}`,
        })),
      },
    };
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(braveResponse), { status: 200 })
    );
    const result = await executeWebSearch('test-key', 'kimi k3', fetchImpl);
    expect('results' in result && result.results).toHaveLength(5);
    expect('results' in result && result.results[0]).toEqual({
      title: 'Result 0',
      url: 'https://example.com/0',
      snippet: 'Snippet 0',
    });
  });

  it('sends the query and API key to Brave', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ web: { results: [] } }), { status: 200 })
    );
    await executeWebSearch('test-key', 'kimi k3', fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain('q=kimi%20k3');
    expect(init.headers['X-Subscription-Token']).toBe('test-key');
  });

  it('returns an error shape on a non-2xx response, never throws', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 }));
    const result = await executeWebSearch('test-key', 'kimi k3', fetchImpl);
    expect('error' in result).toBe(true);
  });

  it('returns an error shape on a network failure, never throws', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
    const result = await executeWebSearch('test-key', 'kimi k3', fetchImpl);
    expect('error' in result).toBe(true);
  });
});
