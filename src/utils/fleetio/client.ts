// ============================================================
// RMPG Flex — Fleet.io integration: HTTP adapter
// ============================================================
// Worker-safe (no node:*) thin client for the Fleet.io REST API v1.
// Base: https://secure.fleetio.com/api/v1
// Auth: dual headers — `Authorization: Token <API_KEY>` and `Account-Token: <ACCOUNT_TOKEN>`.
// Spec: docs/superpowers/specs/2026-06-21-fleetio-integration-design.md
//
// This module NEVER touches D1. Routes (src/routes/fleetio.ts) and the
// sync engine (PR 4) are the only callers. Unit tests stub `fetch`.
// ============================================================

import {
  FleetioConfigError,
  FleetioHttpError,
  FleetioRateLimitError,
  FleetioTimeoutError,
} from './errors';
import type {
  FleetioVehicle,
  FleetioVehicleCreatePayload,
  FleetioListResponse,
} from './types';

export const FLEETIO_API_BASE_DEFAULT = 'https://secure.fleetio.com/api/v1';

export interface FleetioConfig {
  apiKey: string;
  accountToken: string;
  apiBase: string;
}

export interface BuildRequestInput {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  config: FleetioConfig;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
}

export interface BuiltRequest {
  url: string;
  headers: Headers;
  body?: string;
  method: string;
}

/** Pure: builds the URL + headers + body. No I/O. */
export function buildFleetioRequest(input: BuildRequestInput): BuiltRequest {
  const { method, path, config, query, body } = input;
  const base = config.apiBase.replace(/\/+$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  let url = `${base}${cleanPath}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      params.append(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }
  const headers = new Headers({
    'authorization': `Token ${config.apiKey}`,
    'account-token': config.accountToken,
    'accept': 'application/json',
  });
  let serialized: string | undefined;
  if (body !== undefined) {
    headers.set('content-type', 'application/json');
    serialized = JSON.stringify(body);
  }
  return { url, headers, body: serialized, method };
}

// ── Core fetch wrapper ───────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BACKOFF_BASE_MS = 500;

export interface FleetioFetchInput extends BuildRequestInput {
  timeoutMs?: number;
  maxRetries?: number;
  backoffBaseMs?: number;
  /** Inject a stub for tests; defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
}

/** Validates config, dispatches the HTTP call with retry/backoff/timeout,
 *  parses JSON responses, and maps failures to typed errors.
 *  NEVER logs or interpolates apiKey/accountToken into error messages. */
export async function fleetioFetch<T>(input: FleetioFetchInput): Promise<T> {
  if (!input.config.apiKey) throw new FleetioConfigError('FLEETIO_API_KEY is unset');
  if (!input.config.accountToken) throw new FleetioConfigError('FLEETIO_ACCOUNT_TOKEN is unset');

  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = input.maxRetries ?? DEFAULT_MAX_RETRIES;
  const backoffBaseMs = input.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;

  const built = buildFleetioRequest(input);

  let attempt = 0;
  let lastErr: unknown;
  while (attempt <= maxRetries) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetchImpl(built.url, {
        method: built.method,
        headers: built.headers,
        body: built.body,
        signal: controller.signal,
      });
      clearTimeout(timer);

      // 429 — read Retry-After; throw a typed error the caller can wait on.
      if (resp.status === 429) {
        const ra = Number(resp.headers.get('retry-after'));
        const seconds = Number.isFinite(ra) && ra > 0 ? ra : Math.ceil(backoffBaseMs * Math.pow(2, attempt) / 1000);
        throw new FleetioRateLimitError(seconds, await safeReadJson(resp));
      }

      if (resp.ok) {
        // Empty 204 → undefined; otherwise parse JSON.
        if (resp.status === 204) return undefined as T;
        return (await resp.json()) as T;
      }

      // 5xx — retry; 4xx — fail immediately.
      const detail = await safeReadJson(resp);
      if (resp.status >= 500 && attempt < maxRetries) {
        lastErr = new FleetioHttpError(`Fleet.io ${resp.status}`, resp.status, detail);
        await sleep(backoffBaseMs * Math.pow(2, attempt));
        attempt += 1;
        continue;
      }
      throw new FleetioHttpError(`Fleet.io ${resp.status}`, resp.status, detail);
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof FleetioRateLimitError || err instanceof FleetioHttpError || err instanceof FleetioConfigError) {
        throw err;
      }
      // AbortError → timeout
      if (err && typeof err === 'object' && 'name' in err && (err as { name: string }).name === 'AbortError') {
        if (attempt < maxRetries) {
          lastErr = new FleetioTimeoutError(`Fleet.io request timed out after ${timeoutMs}ms`);
          await sleep(backoffBaseMs * Math.pow(2, attempt));
          attempt += 1;
          continue;
        }
        throw new FleetioTimeoutError(`Fleet.io request timed out after ${timeoutMs}ms`);
      }
      // Network/other — retry if budget remains; otherwise rethrow.
      if (attempt < maxRetries) {
        lastErr = err;
        await sleep(backoffBaseMs * Math.pow(2, attempt));
        attempt += 1;
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new FleetioHttpError('Fleet.io request failed', 0);
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

async function safeReadJson(resp: Response): Promise<unknown> {
  try {
    const text = await resp.text();
    if (!text) return undefined;
    try { return JSON.parse(text); } catch { return text; }
  } catch {
    return undefined;
  }
}
