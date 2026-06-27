import type { Bindings } from '../types';

export class FirecrawlConfigError extends Error { constructor(m: string) { super(m); this.name = 'FirecrawlConfigError'; } }
export class FirecrawlHttpError extends Error { constructor(public status: number, m: string) { super(m); this.name = 'FirecrawlHttpError'; } }

const DEFAULT_BASE = 'https://api.firecrawl.dev';
const TIMEOUT_MS = 60_000;

export interface ScrapeOpts { waitFor?: number; actions?: unknown[] }

export interface ScrapePayload {
  url: string;
  formats: string[];
  proxy: 'stealth';
  waitFor?: number;
  actions?: unknown[];
}

/** Pure: build the Firecrawl /v2/scrape request body. */
export function buildScrapePayload(url: string, opts: ScrapeOpts = {}): ScrapePayload {
  const p: ScrapePayload = { url, formats: ['html'], proxy: 'stealth' };
  if (opts.waitFor != null) p.waitFor = opts.waitFor;
  if (opts.actions) p.actions = opts.actions;
  return p;
}

/**
 * Scrape a URL through Firecrawl's stealth proxy (handles DataDome) and return
 * rendered HTML. Throws FirecrawlConfigError when the key is unset so callers
 * can return 503; FirecrawlHttpError on a non-2xx Firecrawl response.
 */
export async function firecrawlScrapeHtml(env: Bindings, url: string, opts: ScrapeOpts = {}): Promise<string> {
  const key = env.FIRECRAWL_API_KEY;
  if (!key) throw new FirecrawlConfigError('FIRECRAWL_API_KEY is not set');
  const base = (env.FIRECRAWL_API_URL || DEFAULT_BASE).replace(/\/+$/, '');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(`${base}/v2/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(buildScrapePayload(url, opts)),
      signal: ctrl.signal,
    });
    if (!resp.ok) throw new FirecrawlHttpError(resp.status, `Firecrawl HTTP ${resp.status}`);
    const json = (await resp.json()) as { data?: { html?: string } };
    return json?.data?.html ?? '';
  } finally { clearTimeout(t); }
}
