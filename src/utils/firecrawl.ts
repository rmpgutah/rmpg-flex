// src/utils/firecrawl.ts
// Worker-safe Firecrawl v1 REST client (no `firecrawl` npm SDK — it pulls
// node:* deps that break on Workers, same constraint as roboflowAlpr.ts).
// Verified live 2026-06-15: POST /v1/search → { success, data:[{url,title,
// description,markdown?}], id } — on the current API tier search does NOT inline
// markdown even with scrapeOptions, so callers backfill via /v1/scrape →
// { success, data:{ markdown, metadata } } (parseScrapeResponse reads data.markdown).

const FIRECRAWL_BASE = 'https://api.firecrawl.dev/v1';

export class FirecrawlConfigError extends Error {
  constructor(msg = 'FIRECRAWL_API_KEY not set') { super(msg); this.name = 'FirecrawlConfigError'; }
}
export class FirecrawlTimeoutError extends Error {
  constructor(msg: string) { super(msg); this.name = 'FirecrawlTimeoutError'; }
}
export class FirecrawlHttpError extends Error {
  constructor(public status: number, msg: string) { super(msg); this.name = 'FirecrawlHttpError'; }
}

export interface FirecrawlEnv { FIRECRAWL_API_KEY?: string; }
export interface FcSearchResult { url: string; title: string; description: string; markdown?: string; }

/** Pure: map a v1 /search envelope to typed results, dropping malformed rows. */
export function parseSearchResponse(json: any): FcSearchResult[] {
  const data = Array.isArray(json?.data) ? json.data : [];
  return data
    .filter((d: any) => d && typeof d.url === 'string')
    .map((d: any) => {
      const r: FcSearchResult = {
        url: d.url,
        title: typeof d.title === 'string' ? d.title : '',
        description: typeof d.description === 'string' ? d.description : '',
      };
      if (typeof d.markdown === 'string') r.markdown = d.markdown;
      return r;
    });
}

/** Pure: pull markdown out of a v1 /scrape envelope. */
export function parseScrapeResponse(json: any): string {
  const md = json?.data?.markdown;
  return typeof md === 'string' ? md : '';
}

function apiKey(env: FirecrawlEnv): string {
  const k = (env.FIRECRAWL_API_KEY || '').trim();
  if (!k) throw new FirecrawlConfigError();
  return k;
}

async function fcFetch(env: FirecrawlEnv, path: string, body: unknown, timeoutMs: number): Promise<any> {
  const key = apiKey(env);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${FIRECRAWL_BASE}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new FirecrawlHttpError(res.status, txt.slice(0, 200));
    }
    return await res.json();
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new FirecrawlTimeoutError(`Firecrawl timeout after ${timeoutMs}ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function withRetry<T>(fn: () => Promise<T>, retries = 2, backoffMs = 800): Promise<T> {
  let last: unknown;
  for (let i = 0; i <= retries; i++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      // Don't retry config errors or 4xx (client) HTTP errors.
      if (e instanceof FirecrawlConfigError) throw e;
      if (e instanceof FirecrawlHttpError && e.status < 500) throw e;
      if (i < retries) await new Promise((r) => setTimeout(r, backoffMs * (i + 1)));
    }
  }
  throw last;
}

export async function firecrawlSearch(
  env: FirecrawlEnv,
  query: string,
  opts: { limit?: number; scrape?: boolean; timeoutMs?: number } = {},
): Promise<FcSearchResult[]> {
  const { limit = 5, scrape = true, timeoutMs = 30000 } = opts;
  const body: any = { query, limit };
  if (scrape) body.scrapeOptions = { formats: ['markdown'] };
  const json = await withRetry(() => fcFetch(env, '/search', body, timeoutMs));
  return parseSearchResponse(json);
}

export async function firecrawlScrape(
  env: FirecrawlEnv,
  url: string,
  opts: { timeoutMs?: number } = {},
): Promise<string> {
  const { timeoutMs = 30000 } = opts;
  const json = await withRetry(() => fcFetch(env, '/scrape', { url, formats: ['markdown'] }, timeoutMs));
  return parseScrapeResponse(json);
}
