// ============================================================
// RMPG Flex — NSOPW Web Service client (the REAL one).
// ------------------------------------------------------------
// Wire format reverse-engineered by reconnaissance on the live
// nsopw.gov search form on 2026-06-22. Ground truth fixtures:
//   tests/fixtures/nsopw/john-smith-search.real.json
//   tests/fixtures/nsopw/jurisdictions-offline.real.json
//
// Endpoint: POST https://nsopw-api.ojp.gov/nsopw/v1/v1.0/search
// Auth:     NONE. This is the public CORS-restricted endpoint
//           the official nsopw.gov form calls. Anyone with the
//           right headers + body can call it server-side.
//
// ⚠️  TERMS OF USE caveat: nsopw.gov's Conditions of Use page
// likely prohibits automated/programmatic access to the public
// endpoint, regardless of CORS allowing it technically. For
// formal sanctioned LE use, the DOJ MOU path is the clean
// option. This adapter is gated by NSOPW_ENABLED — set it
// explicitly to opt in. Without the flag, every NSOPW call
// returns `configured: false` and surfaces the disabled state
// as a coverage gap (NOT a clearance) via the false-clear
// guard in the screening framework.
//
// Headers required by the endpoint (browser CORS dance):
//   Content-Type: application/x-www-form-urlencoded; charset=UTF-8
//     (despite the body being literal JSON — this is what the
//      official nsopw.gov form sends)
//   Origin: https://www.nsopw.gov
//   Accept: application/json
//
// Worker-safe: no node:* imports. AbortController-based timeout,
// bounded retry on transient 5xx / 429, typed errors.
// ============================================================

import type { Bindings } from '../../types';
import {
  type NsopwQuery, type NsopwSearchResponse,
  NsopwConfigError, NsopwTimeoutError, NsopwHttpError, NsopwRateLimitError,
} from './types';
import { parseSearchResponse } from './parse';
import { NSOPW_ALL_JURISDICTIONS } from './jurisdictions';

const DEFAULT_BASE = 'https://nsopw-api.ojp.gov';
const SEARCH_PATH = '/nsopw/v1/v1.0/search';
const OFFLINE_PATH = '/nsopw/v1/v1.0/jurisdictions/offline';
const DEFAULT_TIMEOUT_MS = 25_000;          // federated query takes 5-20s
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BACKOFF_MS = 1_500;

export interface NsopwClientConfig {
  enabled: boolean;
  apiBase: string;
  timeoutMs: number;
  maxRetries: number;
  /** Optional MOU-issued key. When set, sent as Authorization: Bearer.
   *  Not required by the public endpoint but useful when the MOU sanctions
   *  higher rate limits or formal attribution. */
  apiKey?: string;
}

export function resolveClientConfig(env: Bindings): NsopwClientConfig {
  // The endpoint is technically public, but we still gate the integration
  // behind an explicit env flag so deployments must opt in to programmatic
  // calls. This is the operator's "yes, our ToU posture is settled" switch.
  const enabledFlag = (env as { NSOPW_ENABLED?: string }).NSOPW_ENABLED;
  const enabled = enabledFlag === '1' || enabledFlag === 'true';
  const apiKey = (env as { NSOPW_API_KEY?: string }).NSOPW_API_KEY;
  const apiBase = (env as { NSOPW_API_BASE?: string }).NSOPW_API_BASE || DEFAULT_BASE;
  return {
    enabled,
    apiBase: apiBase.replace(/\/$/, ''),
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxRetries: DEFAULT_MAX_RETRIES,
    apiKey: apiKey?.trim() || undefined,
  };
}

/** Probe whether the integration is enabled without throwing. */
export function isConfigured(env: Bindings): boolean {
  const cfg = resolveClientConfig(env);
  return cfg.enabled;
}

/**
 * Issue one federated NSOPW search against the live public endpoint.
 * Returns a parsed response, or throws a typed error.
 *
 * NSOPW does NOT accept a DOB in the search form. The query.dob field
 * on the input is intentionally NOT sent; matching is post-response.
 */
export async function nsopwSearch(
  env: Bindings,
  query: NsopwQuery,
  config: NsopwClientConfig = resolveClientConfig(env),
): Promise<{ response: NsopwSearchResponse; httpStatus: number; latencyMs: number }> {
  if (!config.enabled) throw new NsopwConfigError('NSOPW_ENABLED is not set');

  const body = JSON.stringify({
    firstName: query.forename ?? '',
    lastName: query.surname ?? '',
    city: query.city ?? '',
    county: query.county ?? '',
    // zips is plural in the real wire shape, accepts a space-separated string
    // OR a single zip; null is valid for "no zip filter".
    zips: query.zip ?? null,
    longitude: null,
    latitude: null,
    distance: null,
    // Empty array = federate to NOTHING. Always send the full known list.
    jurisdictions: [...NSOPW_ALL_JURISDICTIONS],
    clientIp: '',
  });

  // CONTENT-TYPE: the official site posts JSON with Content-Type
  // application/x-www-form-urlencoded. That's unusual but it's what
  // their backend accepts — they parse the raw body as JSON regardless.
  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'accept': 'application/json, text/javascript, */*; q=0.01',
    // Origin matching the official site — server-side calls bypass CORS,
    // but the Origin header may be inspected by upstream filters.
    'origin': 'https://www.nsopw.gov',
    'referer': 'https://www.nsopw.gov/',
    'user-agent': 'RMPG-Flex/1.0 (Cloudflare Workers; sworn LE)',
  };
  if (config.apiKey) {
    headers['authorization'] = `Bearer ${config.apiKey}`;
  }

  const url = `${config.apiBase}${SEARCH_PATH}`;
  const start = Date.now();
  let lastErr: Error | undefined;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), config.timeoutMs);
    try {
      const res = await fetch(url, { method: 'POST', headers, body, signal: ctrl.signal });
      const status = res.status;
      const text = await res.text();
      if (status === 429) {
        const ra = parseInt(res.headers.get('retry-after') ?? '0', 10) || undefined;
        if (attempt < config.maxRetries) {
          await sleep(DEFAULT_BACKOFF_MS * (attempt + 1));
          continue;
        }
        throw new NsopwRateLimitError(ra);
      }
      if (status >= 500 && status < 600) {
        if (attempt < config.maxRetries) {
          await sleep(DEFAULT_BACKOFF_MS * (attempt + 1));
          continue;
        }
        throw new NsopwHttpError(status, text);
      }
      if (status < 200 || status >= 300) {
        throw new NsopwHttpError(status, text);
      }
      let parsedJson: unknown;
      try { parsedJson = JSON.parse(text); }
      catch { throw new NsopwHttpError(status, `non-JSON response: ${text.slice(0, 200)}`); }
      const response = parseSearchResponse(parsedJson);
      return { response, httpStatus: status, latencyMs: Date.now() - start };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        lastErr = new NsopwTimeoutError();
      } else if (err instanceof NsopwRateLimitError || err instanceof NsopwHttpError) {
        throw err;
      } else {
        lastErr = err instanceof Error ? err : new Error(String(err));
      }
      if (attempt >= config.maxRetries) break;
      await sleep(DEFAULT_BACKOFF_MS * (attempt + 1));
    } finally {
      clearTimeout(t);
    }
  }

  throw lastErr ?? new NsopwHttpError(0, 'unknown failure');
}

/**
 * Fetch the offline-jurisdictions list. Powers the coverage banner:
 * when MN is in the offline list, a 0-record response from MN means
 * "the state's API was down", not "no offenders match in MN".
 */
export async function nsopwOfflineJurisdictions(
  env: Bindings,
  config: NsopwClientConfig = resolveClientConfig(env),
): Promise<string[]> {
  if (!config.enabled) return [];
  const url = `${config.apiBase}${OFFLINE_PATH}`;
  const headers: Record<string, string> = {
    'accept': 'application/json',
    'origin': 'https://www.nsopw.gov',
    'referer': 'https://www.nsopw.gov/',
    'user-agent': 'RMPG-Flex/1.0 (Cloudflare Workers; sworn LE)',
  };
  if (config.apiKey) headers['authorization'] = `Bearer ${config.apiKey}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), config.timeoutMs);
  try {
    const res = await fetch(url, { method: 'GET', headers, signal: ctrl.signal });
    if (!res.ok) return [];
    const data = await res.json().catch(() => []);
    return Array.isArray(data) ? data.map(String) : [];
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
