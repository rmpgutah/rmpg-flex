// ============================================================
// RMPG Flex — ServeManager integration: Worker-safe REST client
// ============================================================
// Mirrors the shape of src/utils/fleetio/client.ts. ServeManager API docs:
// https://servemanager.com/api
//
// Auth: HTTP Basic — the API key is the username, password is EMPTY.
// ("HTTP Basic: Access denied" / 401 almost always means the key was sent
// as a Bearer token, as the password instead of the username, or the
// colon delimiter was dropped before base64-encoding.)
//
// SECRET HYGIENE: never log or interpolate the raw API key. `err.detail`
// (the raw response body) may echo request data back — never return it to
// API clients, only `err.name` + `err.message`.
// ============================================================

import {
  ServeManagerConfigError,
  ServeManagerHttpError,
  ServeManagerRateLimitError,
  ServeManagerTimeoutError,
} from './errors';

export interface ServeManagerConfig {
  apiKey: string;
  apiBase: string; // e.g. https://www.servemanager.com/api
}

export interface ServeManagerEnvLike {
  SERVEMANAGER_API_KEY?: string;
  SERVEMANAGER_API_BASE?: string;
}

const DEFAULT_API_BASE = 'https://www.servemanager.com/api';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BACKOFF_BASE_MS = 500;
const MAX_PER_PAGE = 100;
const MAX_PAGES = 100;

export function configFromEnv(env: ServeManagerEnvLike): ServeManagerConfig {
  const apiKey = env.SERVEMANAGER_API_KEY;
  if (!apiKey) {
    throw new ServeManagerConfigError('SERVEMANAGER_API_KEY is not configured');
  }
  const apiBase = (env.SERVEMANAGER_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, '');
  return { apiKey, apiBase };
}

function isRetryableMethod(method: string): boolean {
  return method === 'GET' || method === 'PATCH' || method === 'PUT';
}

function buildAuthHeader(apiKey: string): string {
  // Username = API key, password = empty string, per ServeManager's Basic Auth contract.
  return `Basic ${btoa(`${apiKey}:`)}`;
}

interface RequestInput {
  method?: string;
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  timeoutMs?: number;
  maxRetries?: number;
  backoffBaseMs?: number;
}

async function serveManagerFetch<T>(config: ServeManagerConfig, input: RequestInput): Promise<T> {
  const method = input.method ?? 'GET';
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = input.maxRetries ?? DEFAULT_MAX_RETRIES;
  const backoffBaseMs = input.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;

  const path = input.path.startsWith('/') ? input.path : `/${input.path}`;
  const url = new URL(`${config.apiBase}${path}`);
  if (input.query) {
    for (const [key, value] of Object.entries(input.query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
  }

  const headers = new Headers({
    authorization: buildAuthHeader(config.apiKey),
    accept: 'application/json',
  });
  if (input.body !== undefined) headers.set('content-type', 'application/json');

  let attempt = 0;
  for (;;) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url.toString(), {
        method,
        headers,
        body: input.body !== undefined ? JSON.stringify(input.body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const detail = await res.text().catch(() => undefined);
        throw new ServeManagerRateLimitError(Number.isFinite(retryAfter) ? retryAfter : 60, detail);
      }

      if (!res.ok) {
        const detail = await res.text().catch(() => undefined);
        const retryable = res.status >= 500 && isRetryableMethod(method);
        if (retryable && attempt < maxRetries) {
          attempt += 1;
          await sleep(backoffBaseMs * 2 ** attempt);
          continue;
        }
        throw new ServeManagerHttpError(
          `ServeManager ${method} ${path} failed with ${res.status}`,
          res.status,
          detail
        );
      }

      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof ServeManagerHttpError || err instanceof ServeManagerRateLimitError) throw err;
      const isAbort = err instanceof Error && err.name === 'AbortError';
      if (isRetryableMethod(method) && attempt < maxRetries) {
        attempt += 1;
        await sleep(backoffBaseMs * 2 ** attempt);
        continue;
      }
      if (isAbort) throw new ServeManagerTimeoutError(`ServeManager ${method} ${path} timed out after ${timeoutMs}ms`);
      throw err;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ------------------------------------------------------------
// Pagination — ServeManager returns { links: {self,first,last,prev,next}, data: [...] }
// ------------------------------------------------------------

interface ServeManagerListResponse<T> {
  links: { self: string; first: string; last: string; prev: string | null; next: string | null };
  data: T[];
}

export async function fetchListPage<T>(
  config: ServeManagerConfig,
  path: string,
  query?: Record<string, string | number | undefined>
): Promise<ServeManagerListResponse<T>> {
  return serveManagerFetch<ServeManagerListResponse<T>>(config, {
    method: 'GET',
    path,
    query: { per_page: MAX_PER_PAGE, ...query },
  });
}

/** Walks every page of an index endpoint via the `links.next` cursor URL.
 *  Hard-capped at MAX_PAGES; truncation is surfaced, never silently dropped. */
export async function iterateList<T>(
  config: ServeManagerConfig,
  path: string,
  query?: Record<string, string | number | undefined>,
  onPage?: (pageIndex: number) => void
): Promise<{ records: T[]; truncated: boolean }> {
  const records: T[] = [];
  let page = await fetchListPage<T>(config, path, query);
  records.push(...page.data);
  let pageIndex = 1;
  onPage?.(pageIndex);

  while (page.links.next && pageIndex < MAX_PAGES) {
    const nextUrl = new URL(page.links.next);
    const pageParam = nextUrl.searchParams.get('page');
    page = await fetchListPage<T>(config, path, { ...query, page: pageParam ?? undefined });
    records.push(...page.data);
    pageIndex += 1;
    onPage?.(pageIndex);
  }

  return { records, truncated: Boolean(page.links.next) && pageIndex >= MAX_PAGES };
}

// ------------------------------------------------------------
// Resource helpers
// ------------------------------------------------------------

export interface ServeManagerAccount {
  type: 'account';
  id: number;
  company_name: string;
  email?: string;
  [key: string]: unknown;
}

export interface ServeManagerJob {
  type: 'job';
  id: number;
  servemanager_job_number?: number;
  job_status?: string;
  [key: string]: unknown;
}

/** GET /api/account — never throws; returns {ok:false, error} on failure. */
export async function ping(
  config: ServeManagerConfig
): Promise<{ ok: true; account_id: number; company_name: string } | { ok: false; error: string }> {
  try {
    const res = await serveManagerFetch<{ data: ServeManagerAccount }>(config, {
      method: 'GET',
      path: '/account',
      maxRetries: 0,
    });
    return { ok: true, account_id: res.data.id, company_name: res.data.company_name };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function listAllJobs(config: ServeManagerConfig, onPage?: (pageIndex: number) => void) {
  return iterateList<ServeManagerJob>(config, '/jobs', undefined, onPage);
}

export async function createJob(config: ServeManagerConfig, payload: Record<string, unknown>): Promise<ServeManagerJob> {
  const res = await serveManagerFetch<{ data: ServeManagerJob }>(config, {
    method: 'POST',
    path: '/jobs',
    body: payload,
    maxRetries: 0, // POST is not idempotent — no retry, mirrors Fleet.io's isRetryableMethod policy
  });
  return res.data;
}

export async function updateJob(
  config: ServeManagerConfig,
  jobId: number,
  payload: Record<string, unknown>
): Promise<ServeManagerJob> {
  const res = await serveManagerFetch<{ data: ServeManagerJob }>(config, {
    method: 'PUT',
    path: `/jobs/${jobId}`,
    body: payload,
  });
  return res.data;
}

export async function getJob(config: ServeManagerConfig, jobId: number): Promise<ServeManagerJob> {
  const res = await serveManagerFetch<{ data: ServeManagerJob }>(config, { method: 'GET', path: `/jobs/${jobId}` });
  return res.data;
}
