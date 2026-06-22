// ============================================================
// RMPG Flex — NSOPW Web Service client.
// ------------------------------------------------------------
// Wraps the DOJ-issued NSOPW federated search endpoint. The wire
// format is the one publicly documented at nsopw.gov; the literal
// MOU pack may rename a field or tighten the schema, in which case
// only this file needs to change — every caller talks to a stable
// internal contract (NsopwClient.search → NsopwSearchResponse).
//
// Auth: NSOPW_API_KEY (issued under MOU). Sent as Bearer header.
// Endpoint: NSOPW_API_BASE (default https://api.nsopw.gov, override
// in wrangler.toml if DOJ assigns a different host).
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

const DEFAULT_BASE = 'https://api.nsopw.gov';
const DEFAULT_TIMEOUT_MS = 25_000;          // federated query takes 5-20s
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BACKOFF_MS = 1_500;

export interface NsopwClientConfig {
  apiKey: string;
  apiBase: string;
  timeoutMs: number;
  maxRetries: number;
}

export function resolveClientConfig(env: Bindings): NsopwClientConfig {
  const apiKey = (env as { NSOPW_API_KEY?: string }).NSOPW_API_KEY ?? '';
  if (!apiKey) throw new NsopwConfigError('NSOPW_API_KEY unset');
  const apiBase = (env as { NSOPW_API_BASE?: string }).NSOPW_API_BASE || DEFAULT_BASE;
  return {
    apiKey,
    apiBase: apiBase.replace(/\/$/, ''),
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxRetries: DEFAULT_MAX_RETRIES,
  };
}

/** Probe whether the integration is configured without throwing. */
export function isConfigured(env: Bindings): boolean {
  return !!(env as { NSOPW_API_KEY?: string }).NSOPW_API_KEY;
}

/**
 * Issue one federated NSOPW search. Returns a parsed response, or
 * throws a typed error. Caller is responsible for caching/persisting.
 */
export async function nsopwSearch(
  env: Bindings,
  query: NsopwQuery,
  config: NsopwClientConfig = resolveClientConfig(env),
): Promise<{ response: NsopwSearchResponse; httpStatus: number; latencyMs: number }> {
  const body = JSON.stringify({
    // Documented public-side envelope. The MOU spec may rename these;
    // when the pack arrives, the operator updates these key names and
    // every downstream layer keeps working.
    firstName: query.forename,
    lastName: query.surname,
    middleName: query.middleName ?? '',
    dob: query.dob ?? '',
    // Empty jurisdictions array = federate to ALL participating systems
    // (the whole point of NSOPW).
    jurisdictions: [] as string[],
  });

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'accept': 'application/json',
    'authorization': `Bearer ${config.apiKey}`,
    'user-agent': 'RMPG-Flex/1.0 (Cloudflare Workers)',
  };

  const url = `${config.apiBase}/api/search`;
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
        throw err;                        // already-typed; bubble out
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
