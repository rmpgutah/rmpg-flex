// src/utils/sl-assessor/lookup.ts
// Fallback orchestrator for the SLCo Assessor lookup. Order:
//   1. Firecrawl scrape → structural parser
//   2. Direct fetch (no scraper) → structural parser
//   3. AI extract over whichever HTML we managed to grab
//   4. Stale durable cache (last-known-good from any prior success)
//
// Always returns a structured result — never throws. Routes use this so the
// UI gets one consistent shape regardless of which layer (if any) succeeded.

import { buildQueryUrl } from './client';
import { parseParcelList, parseParcelDetail } from './parser';
import { extractParcelsViaAi } from './aiExtract';
import {
  cacheKeyParcels, cacheKeyParcel,
  durableKeyParcels, durableKeyParcel,
  getCached, putCached, putCachedDurable,
} from './cache';
import type { Parcel, ParcelSummary } from './types';

export type LookupSource =
  | 'firecrawl'      // structural parser on Firecrawl-rendered HTML
  | 'direct'         // structural parser on a direct fetch
  | 'ai'             // AI router extracted parcels from raw HTML
  | 'stale_cache'    // last-known-good served because every live source failed
  | 'cache'          // fresh 30d-TTL cache hit (no upstream call needed)
  | 'none';          // nothing returned a result

export type LookupCode =
  | 'ok'
  | 'not_configured'   // no Firecrawl key AND no AI key — cannot try anything
  | 'no_match'         // chain ran, found nothing
  | 'upstream_error'   // every live source threw; stale cache also missing
  | 'timeout';

export interface LookupEnv {
  FIRECRAWL_API_KEY?: string;
  KV: KVNamespace;
  DB?: D1Database;
  AI?: Ai;
}

export interface LookupResult {
  parcels: ParcelSummary[];
  source: LookupSource;
  code: LookupCode;
  /** True when source !== 'firecrawl' && source !== 'direct' — i.e. the user is
   *  looking at AI-derived or stale data and should be told. */
  degraded: boolean;
  /** Deep link to the manual SLCo Assessor search page — always populated so
   *  the UI can offer a "search yourself" fallback even on total failure. */
  manual_url: string;
  /** Short diagnostic for operators / logs. Safe to surface in dev tools. */
  diagnostic?: string;
}

const FC_SCRAPE = 'https://api.firecrawl.dev/v1/scrape';
const ASSESSOR_BASE = 'https://apps.saltlakecounty.gov/assessor/new/query.cfm';
const FETCH_TIMEOUT_MS = 25_000;
const DIRECT_TIMEOUT_MS = 10_000;

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(`${label} timed out`), ms);
  try { return await p; }
  finally { clearTimeout(timer); }
}

async function firecrawlScrape(apiKey: string, url: string): Promise<string> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(FC_SCRAPE, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url, formats: ['html'] }),
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`firecrawl ${res.status}`);
    const json = await res.json() as any;
    const html = json?.data?.html;
    if (typeof html !== 'string') throw new Error('firecrawl returned no html');
    return html;
  } finally {
    clearTimeout(t);
  }
}

async function directFetch(url: string): Promise<string> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), DIRECT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        // Mimic a desktop browser — SLCo's CF in front of query.cfm 403s pure
        // curl-like UAs intermittently. Direct fetch is the cheap secondary
        // path; if it 4xxs we just move on to the AI step.
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`direct ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

/**
 * Look up parcels for an address through the full fallback chain.
 *
 * Cache strategy:
 * - Fresh (30d TTL) and durable (no TTL) keys are written on every success.
 * - We consult the fresh key BEFORE any network call.
 * - We consult the durable key ONLY when every live source failed.
 *
 * @returns A LookupResult — never throws.
 */
export async function lookupParcelsWithFallback(
  env: LookupEnv,
  address: string,
): Promise<LookupResult> {
  const manual_url = buildQueryUrl(address);
  const errs: string[] = [];

  // 0. Fresh cache hit — shortest path, no upstream calls.
  const fresh = await getCached<ParcelSummary[]>({ KV: env.KV }, cacheKeyParcels(address));
  if (fresh && Array.isArray(fresh) && fresh.length > 0) {
    return { parcels: fresh, source: 'cache', code: 'ok', degraded: false, manual_url };
  }

  // 1. Firecrawl — rendered HTML, then structural parse.
  let firecrawlHtml = '';
  if (env.FIRECRAWL_API_KEY) {
    try {
      firecrawlHtml = await firecrawlScrape(env.FIRECRAWL_API_KEY, manual_url);
      const parsed = parseParcelList(firecrawlHtml);
      if (parsed.length > 0) {
        await putCached({ KV: env.KV }, cacheKeyParcels(address), parsed);
        await putCachedDurable({ KV: env.KV }, durableKeyParcels(address), parsed);
        return { parcels: parsed, source: 'firecrawl', code: 'ok', degraded: false, manual_url };
      }
    } catch (e) {
      errs.push(`firecrawl: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    errs.push('firecrawl: no api key');
  }

  // 2. Direct fetch — free, sometimes works for non-JS-rendered pages.
  let directHtml = '';
  try {
    directHtml = await directFetch(manual_url);
    const parsed = parseParcelList(directHtml);
    if (parsed.length > 0) {
      await putCached({ KV: env.KV }, cacheKeyParcels(address), parsed);
      await putCachedDurable({ KV: env.KV }, durableKeyParcels(address), parsed);
      return { parcels: parsed, source: 'direct', code: 'ok', degraded: false, manual_url };
    }
  } catch (e) {
    errs.push(`direct: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 3. AI extract — pricey, only fires if we have HTML AND an AI router.
  const html = firecrawlHtml || directHtml;
  if (html && env.AI && env.DB) {
    try {
      const parsed = await extractParcelsViaAi({ DB: env.DB, AI: env.AI }, html, address);
      if (parsed.length > 0) {
        await putCached({ KV: env.KV }, cacheKeyParcels(address), parsed);
        await putCachedDurable({ KV: env.KV }, durableKeyParcels(address), parsed);
        return { parcels: parsed, source: 'ai', code: 'ok', degraded: true, manual_url, diagnostic: errs.join(' | ') || undefined };
      }
    } catch (e) {
      errs.push(`ai: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 4. Stale durable cache — last-known-good from any prior success.
  const stale = await getCached<ParcelSummary[]>({ KV: env.KV }, durableKeyParcels(address));
  if (stale && Array.isArray(stale) && stale.length > 0) {
    return {
      parcels: stale,
      source: 'stale_cache',
      code: 'ok',
      degraded: true,
      manual_url,
      diagnostic: errs.join(' | ') || undefined,
    };
  }

  // 5. Nothing worked.
  const noKey = !env.FIRECRAWL_API_KEY && !env.AI;
  return {
    parcels: [],
    source: 'none',
    code: noKey ? 'not_configured' : (html ? 'no_match' : 'upstream_error'),
    degraded: false,
    manual_url,
    diagnostic: errs.join(' | ') || undefined,
  };
}

// ----------------------------------------------------------------------------
// Single-parcel detail variant. Same chain shape, but parses the detail page.
// ----------------------------------------------------------------------------

export interface ParcelLookupResult {
  parcel: Parcel | null;
  source: LookupSource;
  code: LookupCode;
  degraded: boolean;
  manual_url: string;
  diagnostic?: string;
}

export async function lookupParcelWithFallback(
  env: LookupEnv,
  parcelNo: string,
): Promise<ParcelLookupResult> {
  const url = `${ASSESSOR_BASE}?parcel=${encodeURIComponent(parcelNo)}`;
  const errs: string[] = [];

  const fresh = await getCached<Parcel>({ KV: env.KV }, cacheKeyParcel(parcelNo));
  if (fresh && fresh.parcel_number) {
    return { parcel: fresh, source: 'cache', code: 'ok', degraded: false, manual_url: url };
  }

  // Firecrawl + structural parse.
  let firecrawlHtml = '';
  if (env.FIRECRAWL_API_KEY) {
    try {
      firecrawlHtml = await firecrawlScrape(env.FIRECRAWL_API_KEY, url);
      try {
        const parsed = parseParcelDetail(firecrawlHtml);
        parsed.source_url = url;
        await putCached({ KV: env.KV }, cacheKeyParcel(parcelNo), parsed);
        await putCachedDurable({ KV: env.KV }, durableKeyParcel(parcelNo), parsed);
        return { parcel: parsed, source: 'firecrawl', code: 'ok', degraded: false, manual_url: url };
      } catch (e) {
        errs.push(`parse: ${e instanceof Error ? e.message : String(e)}`);
      }
    } catch (e) {
      errs.push(`firecrawl: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    errs.push('firecrawl: no api key');
  }

  // Direct fetch fallback.
  let directHtml = '';
  try {
    directHtml = await directFetch(url);
    try {
      const parsed = parseParcelDetail(directHtml);
      parsed.source_url = url;
      await putCached({ KV: env.KV }, cacheKeyParcel(parcelNo), parsed);
      await putCachedDurable({ KV: env.KV }, durableKeyParcel(parcelNo), parsed);
      return { parcel: parsed, source: 'direct', code: 'ok', degraded: false, manual_url: url };
    } catch (e) {
      errs.push(`parse-direct: ${e instanceof Error ? e.message : String(e)}`);
    }
  } catch (e) {
    errs.push(`direct: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Stale cache — last-known-good.
  const stale = await getCached<Parcel>({ KV: env.KV }, durableKeyParcel(parcelNo));
  if (stale && stale.parcel_number) {
    return {
      parcel: stale,
      source: 'stale_cache',
      code: 'ok',
      degraded: true,
      manual_url: url,
      diagnostic: errs.join(' | ') || undefined,
    };
  }

  const noKey = !env.FIRECRAWL_API_KEY;
  return {
    parcel: null,
    source: 'none',
    code: noKey ? 'not_configured' : ((firecrawlHtml || directHtml) ? 'no_match' : 'upstream_error'),
    degraded: false,
    manual_url: url,
    diagnostic: errs.join(' | ') || undefined,
  };
}

// Re-export withTimeout in case other callers want it — currently unused
// externally but the symbol is useful for future fallback layers.
export { withTimeout };
