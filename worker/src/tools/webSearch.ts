import type { ToolDefinition } from '../openrouter';

export const webSearchToolDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'web_search',
    description: 'Search the web for current information and return the top results.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query' },
      },
      required: ['query'],
    },
  },
};

export type WebSearchResult =
  | { results: Array<{ title: string; url: string; snippet: string }> }
  | { error: string };

type BraveResponse = {
  web?: { results?: Array<{ title: string; url: string; description: string }> };
};

export async function executeWebSearch(
  apiKey: string,
  query: string,
  fetchImpl: typeof fetch = fetch
): Promise<WebSearchResult> {
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`;
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey },
    });

    if (!response.ok) {
      return { error: `Brave Search API returned status ${response.status}` };
    }

    const data = (await response.json()) as BraveResponse;
    const results = (data.web?.results ?? []).slice(0, 5).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.description,
    }));
    return { results };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'unknown error calling Brave Search' };
  }
}
