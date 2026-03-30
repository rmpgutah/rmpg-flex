// ============================================================
// Firecrawl Client — with built-in fallback when Docker is down
// ============================================================
// Tries the local Firecrawl Docker instance first. If unavailable,
// falls back to direct HTTP fetching with HTML-to-text conversion.
// This ensures Overwatch tools always work, even without Docker.
// ============================================================

import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import { convert as htmlToPlainText } from 'html-to-text';
import robotsParser from 'robots-parser';

// ── Configuration ────────────────────────────────────────────

const FIRECRAWL_BASE_URL = process.env.FIRECRAWL_URL || 'http://localhost:3003';
const TIMEOUT_MS = 30_000;
const USER_AGENT = 'Mozilla/5.0 (RMPG Flex Overwatch Bot; +https://rmpgutah.us)';

// ── Turndown instance ────────────────────────────────────────

const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

// Remove script, style, nav, header, footer, aside for main content
turndownService.remove(['script', 'style', 'nav', 'header', 'footer', 'aside']);

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

// ── HTML parsing helpers (cheerio + turndown + html-to-text) ─

function htmlToMarkdown(rawHtml: string, mainContentOnly: boolean = true): string {
  try {
    const $ = cheerio.load(rawHtml);

    if (mainContentOnly) {
      // Remove non-content elements
      $('script, style, nav, header, footer, aside, iframe, noscript').remove();
    }

    // Get the main content area, or fall back to body
    const mainEl = $('main').length ? $('main') : $('article').length ? $('article') : $('body');
    const contentHtml = mainEl.html() || '';

    return turndownService.turndown(contentHtml);
  } catch {
    // Fallback to html-to-text if turndown fails
    return htmlToPlainText(rawHtml, {
      wordwrap: false,
      selectors: [
        { selector: 'a', options: { ignoreHref: false } },
        { selector: 'img', format: 'skip' },
      ],
    });
  }
}

function extractLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  try {
    const $ = cheerio.load(html);
    $('a[href]').each((_i, el) => {
      const href = $(el).attr('href')?.trim();
      if (!href || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('#')) return;
      try {
        const resolved = new URL(href, baseUrl).href;
        if (!links.includes(resolved)) links.push(resolved);
      } catch { /* skip invalid */ }
    });
  } catch { /* skip parse errors */ }
  return links.slice(0, 200);
}

function extractMetadata(html: string): {
  title: string;
  description: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
} {
  try {
    const $ = cheerio.load(html);
    return {
      title: $('title').first().text().trim(),
      description: $('meta[name="description"]').attr('content')?.trim() || '',
      ogTitle: $('meta[property="og:title"]').attr('content')?.trim() || '',
      ogDescription: $('meta[property="og:description"]').attr('content')?.trim() || '',
      ogImage: $('meta[property="og:image"]').attr('content')?.trim() || '',
    };
  } catch {
    return { title: '', description: '', ogTitle: '', ogDescription: '', ogImage: '' };
  }
}

// ── Robots.txt check ─────────────────────────────────────────

async function isAllowedByRobots(targetUrl: string): Promise<boolean> {
  try {
    const parsed = new URL(targetUrl);
    const robotsUrl = `${parsed.origin}/robots.txt`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const res = await fetch(robotsUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT },
      });
      if (!res.ok) return true; // No robots.txt = allowed
      const robotsTxt = await res.text();
      const robots = robotsParser(robotsUrl, robotsTxt);
      return robots.isAllowed(targetUrl, USER_AGENT) !== false;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return true; // On error, assume allowed
  }
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
    // Check robots.txt before scraping
    const allowed = await isAllowedByRobots(options.url);
    if (!allowed) {
      return { success: false, error: 'Blocked by robots.txt' };
    }

    const res = await fetch(options.url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      redirect: 'follow',
    });

    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}: ${res.statusText}` };
    }

    const rawHtml = await res.text();

    // Use cheerio + turndown for high-quality conversion
    const markdown = htmlToMarkdown(rawHtml, !!options.onlyMainContent);
    const links = extractLinks(rawHtml, options.url);
    const meta = extractMetadata(rawHtml);

    return {
      success: true,
      data: {
        markdown,
        html: options.onlyMainContent ? undefined : rawHtml.slice(0, 500_000),
        rawHtml: rawHtml.slice(0, 500_000),
        links,
        metadata: {
          title: meta.title,
          description: meta.description,
          ogTitle: meta.ogTitle,
          ogDescription: meta.ogDescription,
          ogImage: meta.ogImage,
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
        'User-Agent': USER_AGENT,
        'Accept': 'text/html',
      },
    });

    if (!res.ok) {
      return { success: false, error: `Search returned ${res.status}` };
    }

    const html = await res.text();
    const $ = cheerio.load(html);
    const results: FirecrawlSearchResultItem[] = [];

    $('.result').each((_i, el) => {
      if (results.length >= limit) return false; // break

      const $el = $(el);
      const linkEl = $el.find('.result__a');
      let url = linkEl.attr('href') || '';

      // DuckDuckGo wraps URLs in redirect — extract actual URL
      const uddgMatch = url.match(/uddg=([^&]*)/);
      if (uddgMatch) {
        try { url = decodeURIComponent(uddgMatch[1]); } catch { /* keep */ }
      }
      if (!url.startsWith('http')) return; // continue

      const title = linkEl.text().trim() || url;
      const description = $el.find('.result__snippet').text().trim();

      results.push({ url, title, description });
    });

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
