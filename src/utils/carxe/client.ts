// src/utils/carxe/client.ts
// ============================================================
// RMPG Flex — CarsXE integration: HTTP adapter
// ============================================================
// Worker-safe (no node:*) thin client for the CarsXE API.
// Auth: `key` query/form param carrying the API key (confirmed against
// carsxe.com/docs 2026-07-30 — CarsXE does NOT use a bearer header).
// Spec: docs/superpowers/specs/2026-07-30-carxe-api-integration-design.md
//
// This module NEVER touches D1. src/routes/carxe.ts is the only caller.
// Unit tests stub `fetch` (see tests/carxeClient.test.ts).
// ============================================================

import { CarxeConfigError, CarxeHttpError, CarxeRateLimitError, CarxeTimeoutError } from './errors';
import type { CarxePlateResult, CarxeSpecsResult, CarxeLienTheftResult, CarxeHistoryResult } from './types';

export const CARXE_API_BASE_DEFAULT = 'https://api.carsxe.com';

export interface CarxeConfig {
  apiKey: string;
  apiBase: string;
}

export function configFromEnv(env: { CARXE_API_KEY?: string; CARXE_API_BASE?: string }): CarxeConfig {
  if (!env.CARXE_API_KEY) throw new CarxeConfigError('CARXE_API_KEY is unset');
  return { apiKey: env.CARXE_API_KEY, apiBase: env.CARXE_API_BASE || CARXE_API_BASE_DEFAULT };
}

interface CarxeFetchOptions {
  timeoutMs?: number;
  maxRetries?: number;
  backoffBaseMs?: number;
  /** Inject a stub for tests; defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BACKOFF_BASE_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeReadJson(resp: Response): Promise<unknown> {
  try {
    return await resp.json();
  } catch {
    return undefined;
  }
}

/** GET requests only — every CarsXE endpoint used here is read-only, so every
 *  call is naturally retryable (no idempotency concerns, unlike Fleet.io's
 *  POST/DELETE distinction). */
async function carxeGet<T>(
  path: string,
  params: Record<string, string | undefined>,
  config: CarxeConfig,
  opts: CarxeFetchOptions = {},
): Promise<T> {
  // ⚠️ NEVER LOG OR RETURN THE API KEY ⚠️
  // config.apiKey is a secret, sent only via the URL query string to CarsXE
  // itself. It must never appear in a thrown error message (use fixed
  // templates like `CarsXE ${status}`) or in a response echoed to clients.
  const base = config.apiBase.replace(/\/+$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const qs = new URLSearchParams({ key: config.apiKey });
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, v);
  }
  const url = `${base}${cleanPath}?${qs.toString()}`;

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const backoffBaseMs = opts.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;

  let attempt = 0;
  while (true) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetchImpl(url, { method: 'GET', signal: controller.signal });
      clearTimeout(timer);

      if (resp.status === 429) {
        const ra = Number(resp.headers.get('retry-after'));
        const seconds = Number.isFinite(ra) && ra > 0 ? ra : Math.ceil((backoffBaseMs * 2 ** attempt) / 1000);
        throw new CarxeRateLimitError(seconds, await safeReadJson(resp));
      }

      if (resp.ok) {
        return (await resp.json()) as T;
      }

      const detail = await safeReadJson(resp);
      if (resp.status >= 500 && attempt < maxRetries) {
        await sleep(backoffBaseMs * 2 ** attempt);
        attempt += 1;
        continue;
      }
      throw new CarxeHttpError(`CarsXE ${resp.status}`, resp.status, detail);
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof CarxeRateLimitError || err instanceof CarxeHttpError || err instanceof CarxeConfigError) {
        throw err;
      }
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new CarxeTimeoutError(`CarsXE request timed out after ${timeoutMs}ms`);
      }
      if (attempt < maxRetries) {
        await sleep(backoffBaseMs * 2 ** attempt);
        attempt += 1;
        continue;
      }
      throw err;
    }
  }
}

export async function decodePlate(
  config: CarxeConfig,
  input: { plate: string; state?: string; country?: string },
  opts?: CarxeFetchOptions,
): Promise<CarxePlateResult> {
  return carxeGet<CarxePlateResult>(
    '/v2/platedecoder',
    { plate: input.plate, state: input.state, country: input.country ?? (input.state ? 'US' : undefined) },
    config,
    opts,
  );
}

export async function getSpecifications(
  config: CarxeConfig,
  input: { vin: string },
  opts?: CarxeFetchOptions,
): Promise<CarxeSpecsResult> {
  return carxeGet<CarxeSpecsResult>('/specs', { vin: input.vin }, config, opts);
}

export async function getLienTheft(
  config: CarxeConfig,
  input: { vin: string },
  opts?: CarxeFetchOptions,
): Promise<CarxeLienTheftResult> {
  const result = await carxeGet<CarxeLienTheftResult>('/v1/lien-theft', { vin: input.vin }, config, opts);
  return { ...result, events: result.events ?? [] };
}

export async function getHistory(
  config: CarxeConfig,
  input: { vin: string },
  opts?: CarxeFetchOptions,
): Promise<CarxeHistoryResult> {
  return carxeGet<CarxeHistoryResult>('/history', { vin: input.vin }, config, opts);
}
