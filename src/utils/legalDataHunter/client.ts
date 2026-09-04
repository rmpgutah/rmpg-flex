// ============================================================
// RMPG Flex — Legal Data Hunter integration: HTTP adapter
// ============================================================
// Worker-safe (no node:*) thin client for the Legal Data Hunter REST API.
// Base: https://legaldatahunter.com
// Auth: `Authorization: Bearer <LEGAL_DATA_HUNTER_API_KEY>`.
// Spec: docs/superpowers/specs/2026-07-17-legal-data-hunter-integration-design.md
//
// This module NEVER touches D1 or KV. src/routes/legalDataHunter.ts owns
// caching + rate-limit budget enforcement; this file only knows how to make
// one HTTP call. Unit tests stub `fetch` (see tests/legalDataHunterClient.test.ts).
// ============================================================

import { LdhConfigError, LdhHttpError, LdhRateLimitError, LdhTimeoutError } from './errors';

export const LDH_API_BASE = 'https://legaldatahunter.com';

export interface LdhConfig {
  apiKey: string;
  /** Override the API base URL (e.g. for integration testing). Defaults to LDH_API_BASE. */
  apiBase?: string;
}

export function configFromEnv(env: Record<string, unknown>): LdhConfig {
  const raw = env.LEGAL_DATA_HUNTER_API_KEY;
  const apiKey = typeof raw === 'string' ? raw.trim() : '';
  if (!apiKey) {
    throw new LdhConfigError('LEGAL_DATA_HUNTER_API_KEY is not configured');
  }
  const rawBase = env.LEGAL_DATA_HUNTER_API_URL;
  const apiBase = typeof rawBase === 'string' && rawBase.trim() ? rawBase.trim() : LDH_API_BASE;
  return { apiKey, apiBase };
}

export interface LdhDocument {
  source: string;
  source_id: string;
  title: string;
  text?: string;
  data_type: string;
}

export interface LdhResolveResponse {
  reference: string;
  resolved: boolean;
  match_type?: string;
  documents: LdhDocument[];
  elapsed_ms: number;
}

export interface LdhSearchHit {
  source: string;
  source_id: string;
  score: number;
  title: string;
  snippet: string;
  url?: string;
  country?: string;
  jurisdiction?: string;
  date?: string;
}

export interface LdhSearchResponse {
  query: string;
  hits: LdhSearchHit[];
  total_hits: number;
  namespace: string;
  elapsed_ms: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 2;
const BASE_BACKOFF_MS = 500;

/** Returns true for status codes that are safe to retry (transient server errors). */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status >= 500;
}

async function postJson<T>(input: {
  config: LdhConfig;
  path: string;
  body: Record<string, unknown>;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
}): Promise<T> {
  const {
    config,
    path,
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    fetchImpl = fetch,
  } = input;
  const apiBase = config.apiBase ?? LDH_API_BASE;
  const url = `${apiBase}${path}`;

  let attempt = 0;
  while (true) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await Promise.race([
        fetchImpl(url, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        }),
        new Promise<Response>((_, reject) => {
          controller.signal.addEventListener('abort', () => {
            reject(new LdhTimeoutError(`Legal Data Hunter request to ${path} timed out after ${timeoutMs}ms`));
          });
        }),
      ]);
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof LdhTimeoutError) {
        throw err;
      }
      if ((err as { name?: string })?.name === 'AbortError') {
        throw new LdhTimeoutError(`Legal Data Hunter request to ${path} timed out after ${timeoutMs}ms`);
      }
      // Network error — retry if attempts remain
      if (attempt < maxRetries) {
        attempt++;
        await new Promise((r) => setTimeout(r, BASE_BACKOFF_MS * Math.pow(2, attempt - 1)));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 429) {
      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfterSeconds = Number.isFinite(Number(retryAfterHeader)) ? Number(retryAfterHeader) : 60;
      throw new LdhRateLimitError(retryAfterSeconds, await response.text().catch(() => undefined));
    }

    if (!response.ok) {
      if (isRetryableStatus(response.status) && attempt < maxRetries) {
        attempt++;
        await new Promise((r) => setTimeout(r, BASE_BACKOFF_MS * Math.pow(2, attempt - 1)));
        continue;
      }
      const detail = await response.text().catch(() => undefined);
      throw new LdhHttpError(`Legal Data Hunter ${path} returned ${response.status}`, response.status, detail);
    }

    return (await response.json()) as T;
  }
}

export async function resolveCitation(input: {
  config: LdhConfig;
  reference: string;
  hintCountry?: string;
  hintType?: 'case_law' | 'legislation' | 'doctrine';
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
}): Promise<LdhResolveResponse> {
  const { config, reference, hintCountry, hintType, timeoutMs, maxRetries, fetchImpl } = input;
  const body: Record<string, unknown> = { reference };
  if (hintCountry) body.hint_country = hintCountry;
  if (hintType) body.hint_type = hintType;
  return postJson<LdhResolveResponse>({ config, path: '/v1/resolve', body, timeoutMs, maxRetries, fetchImpl });
}

export async function searchLegislation(input: {
  config: LdhConfig;
  query: string;
  country?: string[];
  topK?: number;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
}): Promise<LdhSearchResponse> {
  const { config, query, country, topK = 3, timeoutMs, maxRetries, fetchImpl } = input;
  const body: Record<string, unknown> = { q: query, namespace: 'legislation', top_k: topK };
  if (country?.length) body.country = country;
  return postJson<LdhSearchResponse>({ config, path: '/v1/search', body, timeoutMs, maxRetries, fetchImpl });
}
