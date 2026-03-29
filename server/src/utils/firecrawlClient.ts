// ============================================================
// Firecrawl Client — HTTP wrapper for self-hosted Firecrawl API
// ============================================================
// Communicates with the local Firecrawl instance (Docker) for
// web scraping and search capabilities used by Overwatch CRM.
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

// ── Internal Helpers ─────────────────────────────────────────

export class FirecrawlUnavailableError extends Error {
  code = 'FIRECRAWL_UNAVAILABLE' as const;
  originalError?: Error;
  constructor(cause?: Error) {
    super('Firecrawl service unavailable — the Docker container is not running. Start it with: docker run -p 3003:3002 firecrawl');
    this.name = 'FirecrawlUnavailableError';
    if (cause) this.originalError = cause;
  }
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
    // Detect connection-level failures and wrap in a clear error
    if (err instanceof FirecrawlUnavailableError) throw err;
    if (err instanceof Error) {
      const msg = err.message.toLowerCase();
      if (msg.includes('econnrefused') || msg.includes('enotfound') ||
          msg.includes('fetch failed') || msg.includes('econnreset') ||
          msg.includes('socket hang up') || msg.includes('abort')) {
        throw new FirecrawlUnavailableError(err);
      }
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Public API ───────────────────────────────────────────────

/**
 * Scrape a single URL via Firecrawl /v1/scrape endpoint.
 */
export async function firecrawlScrape(
  options: FirecrawlScrapeOptions,
): Promise<FirecrawlScrapeResult> {
  return firecrawlFetch<FirecrawlScrapeResult>('/v1/scrape', {
    method: 'POST',
    body: JSON.stringify(options),
  });
}

/**
 * Search the web via Firecrawl /v1/search endpoint.
 */
export async function firecrawlSearch(
  options: FirecrawlSearchOptions,
): Promise<FirecrawlSearchResult> {
  return firecrawlFetch<FirecrawlSearchResult>('/v1/search', {
    method: 'POST',
    body: JSON.stringify(options),
  });
}

/**
 * Check if the Firecrawl service is reachable and healthy.
 */
export async function firecrawlHealthCheck(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);

    try {
      const res = await fetch(`${FIRECRAWL_BASE_URL}/`, {
        signal: controller.signal,
      });
      return res.ok;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return false;
  }
}
