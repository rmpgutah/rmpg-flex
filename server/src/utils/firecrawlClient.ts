// ============================================================
// Firecrawl Client — with built-in fallback when Docker is down
// ============================================================
// Tries the local Firecrawl Docker instance first. If unavailable,
// falls back to direct HTTP fetching with HTML-to-text conversion.
// This ensures Overwatch tools always work, even without Docker.
// ============================================================

// ── Configuration ────────────────────────────────────────────

const FIRECRAWL_BASE_URL = process.env.FIRECRAWL_URL || 'http://localhost:3003';
const TIMEOUT_MS = 30_000;

// ── Types ────────────────────────────────────────────────────

export interface FirecrawlScrapeOptions {
  url: string;
  formats?: ('markdown' | 'html' | 'rawHtml' | 'links' | 'screenshot')[];
  onlyMainContent?: boolean;
  waitFor?: number;
  timeout?: number;
  extract?: {
    schema?: Record<string, unknown>;
    systemPrompt?: string;
    prompt?: string;
  };
}

export interface FirecrawlScrapeResult {
  success: boolean;
  data?: {
    markdown?: string;
    html?: string;
    rawHtml?: string;
    links?: string[];
    metadata?: Record<string, unknown>;
    extract?: Record<string, unknown>;
  };
  error?: string;
}

export interface FirecrawlSearchOptions {
  query: string;
  limit?: number;
  lang?: string;
  country?: string;
  scrapeOptions?: {
    formats?: ('markdown' | 'html')[];
    onlyMainContent?: boolean;
  };
}

export interface FirecrawlSearchResultItem {
  url: string;
  title?: string;
  description?: string;
  markdown?: string;
  html?: string;
  metadata?: Record<string, unknown>;
}

export interface FirecrawlSearchResult {
  success: boolean;
  data?: FirecrawlSearchResultItem[];
  error?: string;
}

// ── Error Class ──────────────────────────────────────────────

export class FirecrawlUnavailableError extends Error {
  code = 'FIRECRAWL_UNAVAILABLE' as const;
  originalError?: Error;
  constructor(cause?: Error) {
    super('Firecrawl Docker unavailable — using built-in fallback');
    this.name = 'FirecrawlUnavailableError';
    if (cause) this.originalError = cause;
  }
}

// ── HTML to Text/Markdown helpers ────────────────────────────

function htmlToText(html: string): string {
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  text = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<h1[^>]*>/gi, '# ')
    .replace(/<h2[^>]*>/gi, '## ')
    .replace(/<h3[^>]*>/gi, '### ')
    .replace(/<h4[^>]*>/gi, '#### ')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<a[^>]*href="([^"]*)"[^>]*>/gi, '[$1](')
    .replace(/<\/a>/gi, ')')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text;
}

function extractLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  const regex = /<a[^>]*href="([^"#]*)"[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    let href = match[1].trim();
    if (!href || href.startsWith('javascript:') || href.startsWith('mailto:')) continue;
    try {
      const resolved = new URL(href, baseUrl).href;
      if (!links.includes(resolved)) links.push(resolved);
    } catch { /* skip invalid */ }
  }
  return links.slice(0, 200);
}

function extractTitle(html: string): string {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';
}

function extractMetaDescription(html: string): string {
  const match = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i)
    || html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i);
  return match ? match[1].trim() : '';
}

// ── Docker Firecrawl availability check ──────────────────────

let _firecrawlAvailable: boolean | null = null;
let _firecrawlLastCheck = 0;

async function isFirecrawlAvailable(): Promise<boolean> {
  if (_firecrawlAvailable !== null && Date.now() - _firecrawlLastCheck < 60_000) {
    return _firecrawlAvailable;
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);
    try {
      const res = await fetch(`${FIRECRAWL_BASE_URL}/`, { signal: controller.signal });
      _firecrawlAvailable = res.ok;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    _firecrawlAvailable = false;
  }
  _firecrawlLastCheck = Date.now();
  return _firecrawlAvailable;
}

async function firecrawlFetch<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${FIRECRAWL_BASE_URL}${endpoint}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Firecrawl ${endpoint} returned ${res.status}: ${body}`);
    }

    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof FirecrawlUnavailableError) throw err;
    if (err instanceof Error) {
      const msg = err.message.toLowerCase();
      if (msg.includes('econnrefused') || msg.includes('enotfound') ||
          msg.includes('fetch failed') || msg.includes('econnreset') ||
          msg.includes('socket hang up') || msg.includes('abort')) {
        _firecrawlAvailable = false;
        _firecrawlLastCheck = Date.now();
        throw new FirecrawlUnavailableError(err);
      }
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Fallback: Direct HTTP Scrape ─────────────────────────────

async function fallbackScrape(options: FirecrawlScrapeOptions): Promise<FirecrawlScrapeResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(options.url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (RMPG Flex Overwatch Bot; +https://rmpgutah.us)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      redirect: 'follow',
    });

    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}: ${res.statusText}` };
    }

    const rawHtml = await res.text();
    const markdown = htmlToText(rawHtml);
    const links = extractLinks(rawHtml, options.url);
    const title = extractTitle(rawHtml);
    const description = extractMetaDescription(rawHtml);

    return {
      success: true,
      data: {
        markdown,
        html: options.onlyMainContent ? undefined : rawHtml.slice(0, 500_000),
        rawHtml: rawHtml.slice(0, 500_000),
        links,
        metadata: {
          title,
          description,
          sourceURL: options.url,
          statusCode: res.status,
        },
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Fetch failed',
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ── Fallback: Web Search via DuckDuckGo HTML ─────────────────

async function fallbackSearch(options: FirecrawlSearchOptions): Promise<FirecrawlSearchResult> {
  const limit = Math.min(options.limit || 10, 20);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const params = new URLSearchParams({ q: options.query, kl: 'us-en' });
    const res = await fetch(`https://html.duckduckgo.com/html/?${params.toString()}`, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (RMPG Flex Overwatch Bot; +https://rmpgutah.us)',
        'Accept': 'text/html',
      },
    });

    if (!res.ok) {
      return { success: false, error: `Search returned ${res.status}` };
    }

    const html = await res.text();
    const results: FirecrawlSearchResultItem[] = [];
    const resultBlocks = html.split(/class="result\s/);

    for (let i = 1; i < resultBlocks.length && results.length < limit; i++) {
      const block = resultBlocks[i];

      const urlMatch = block.match(/class="result__a"[^>]*href="([^"]*)"/);
      if (!urlMatch) continue;
      let url = urlMatch[1];

      // DuckDuckGo wraps URLs in redirect — extract actual URL
      const uddgMatch = url.match(/uddg=([^&]*)/);
      if (uddgMatch) {
        try { url = decodeURIComponent(uddgMatch[1]); } catch { /* keep */ }
      }
      if (!url.startsWith('http')) continue;

      const titleMatch = block.match(/class="result__a"[^>]*>([\s\S]*?)<\/a>/);
      const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : url;

      const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
      const description = snippetMatch
        ? snippetMatch[1].replace(/<[^>]+>/g, '').trim()
        : '';

      results.push({ url, title, description });
    }

    // Optionally scrape top results for markdown content
    if (options.scrapeOptions?.formats?.includes('markdown')) {
      const scrapePromises = results.slice(0, Math.min(5, limit)).map(async (r) => {
        try {
          const scrapeResult = await fallbackScrape({ url: r.url, onlyMainContent: true });
          if (scrapeResult.success && scrapeResult.data?.markdown) {
            r.markdown = scrapeResult.data.markdown.slice(0, 10_000);
          }
        } catch { /* skip */ }
      });
      await Promise.allSettled(scrapePromises);
    }

    return { success: true, data: results };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Search failed',
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ── Public API ───────────────────────────────────────────────

/**
 * Scrape a single URL. Tries Firecrawl Docker first, falls back to direct HTTP.
 */
export async function firecrawlScrape(
  options: FirecrawlScrapeOptions,
): Promise<FirecrawlScrapeResult> {
  if (await isFirecrawlAvailable()) {
    try {
      return await firecrawlFetch<FirecrawlScrapeResult>('/v1/scrape', {
        method: 'POST',
        body: JSON.stringify(options),
      });
    } catch (err) {
      if (!(err instanceof FirecrawlUnavailableError)) throw err;
    }
  }
  console.log('[Firecrawl] Using built-in scraper for:', options.url);
  return fallbackScrape(options);
}

/**
 * Search the web. Tries Firecrawl Docker first, falls back to DuckDuckGo.
 */
export async function firecrawlSearch(
  options: FirecrawlSearchOptions,
): Promise<FirecrawlSearchResult> {
  if (await isFirecrawlAvailable()) {
    try {
      return await firecrawlFetch<FirecrawlSearchResult>('/v1/search', {
        method: 'POST',
        body: JSON.stringify(options),
      });
    } catch (err) {
      if (!(err instanceof FirecrawlUnavailableError)) throw err;
    }
  }
  console.log('[Firecrawl] Using DuckDuckGo fallback for:', options.query);
  return fallbackSearch(options);
}

/**
 * Check if the Firecrawl Docker service is reachable.
 */
export async function firecrawlHealthCheck(): Promise<boolean> {
  return isFirecrawlAvailable();
}
