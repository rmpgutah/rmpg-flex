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

// ⚠️ NEVER LOG OR RETURN CREDENTIALS ⚠️
// `input.config.apiKey` and `input.config.accountToken` are secrets. They are
// passed to fetch() via headers and must never appear in:
//   • console.{log,warn,error} calls — not even during debugging
//   • error messages thrown from here (use fixed templates like `Fleet.io ${status}`)
//   • response bodies returned to clients (routes echo only err.name + err.message)
//   • audit_log rows or flex_events payloads
//
// FleetioHttpError carries a `detail` field that is Fleet.io's raw response body.
// That body CAN contain credentials if Fleet.io echoes the request back in an
// error. Routes MUST NOT return err.detail to clients — only err.message and
// err.name. Tests in `tests/fleetioClient.test.ts` ("secret-hygiene invariants")
// pin the message-side guarantee; the route-side guarantee is by code review.
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

      // 429 → throw immediately (NO in-band retry). Caller re-schedules using
      // retryAfterSeconds; in-band retry would block the Worker for the wait.
      if (resp.status === 429) {
        const ra = Number(resp.headers.get('retry-after'));
        const seconds = Number.isFinite(ra) && ra > 0 ? ra : Math.ceil(backoffBaseMs * (2 ** attempt) / 1000);
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
        await sleep(backoffBaseMs * 2 ** attempt);
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
          await sleep(backoffBaseMs * 2 ** attempt);
          attempt += 1;
          continue;
        }
        throw new FleetioTimeoutError(`Fleet.io request timed out after ${timeoutMs}ms`);
      }
      // NEVER add `console.error(err, built.headers)` here. Headers contain credentials.
      // If you need to debug, log built.url and err.message ONLY.
      // Network/other — retry if budget remains; otherwise rethrow.
      if (attempt < maxRetries) {
        lastErr = err;
        await sleep(backoffBaseMs * 2 ** attempt);
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

// ── Typed resource methods ───────────────────────────────────

export interface PingInput {
  config: FleetioConfig;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface PingResult {
  ok: boolean;
  account_id?: number;
  account_name?: string;
  error?: string;
}

/** Lightweight reachability + auth check. Hits `/accounts` (the only
 *  endpoint that doesn't require Account-Token, but works fine with one).
 *  Maps any failure to { ok:false, error } so the route doesn't have to
 *  classify exceptions itself. */
export async function ping(input: PingInput): Promise<PingResult> {
  try {
    const account = await fleetioFetch<{ id?: number; name?: string }>({
      method: 'GET', path: '/accounts', config: input.config,
      fetchImpl: input.fetchImpl, timeoutMs: input.timeoutMs ?? 10_000, maxRetries: 0,
    });
    return { ok: true, account_id: account?.id, account_name: account?.name };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface ListVehiclesInput {
  config: FleetioConfig;
  page?: number;
  perPage?: number;
  fetchImpl?: typeof fetch;
}

export async function listVehicles(input: ListVehiclesInput): Promise<FleetioListResponse<FleetioVehicle>> {
  return fleetioFetch<FleetioListResponse<FleetioVehicle>>({
    method: 'GET',
    path: '/vehicles',
    config: input.config,
    query: { page: input.page ?? 1, per_page: input.perPage ?? 50 },
    fetchImpl: input.fetchImpl,
  });
}

export interface CreateVehicleInput {
  config: FleetioConfig;
  payload: FleetioVehicleCreatePayload;
  fetchImpl?: typeof fetch;
}

export async function createVehicle(input: CreateVehicleInput): Promise<FleetioVehicle> {
  return fleetioFetch<FleetioVehicle>({
    method: 'POST',
    path: '/vehicles',
    config: input.config,
    body: input.payload,
    fetchImpl: input.fetchImpl,
  });
}

// ── PR 4 outbound dispatch — additional methods the sync engine calls ──

export interface UpdateVehicleInput {
  config: FleetioConfig;
  fleetioId: number;
  payload: Partial<FleetioVehicleCreatePayload> & Record<string, unknown>;
  fetchImpl?: typeof fetch;
}

export async function updateVehicle(input: UpdateVehicleInput): Promise<FleetioVehicle> {
  return fleetioFetch<FleetioVehicle>({
    method: 'PATCH',
    path: `/vehicles/${input.fleetioId}`,
    config: input.config,
    body: input.payload,
    fetchImpl: input.fetchImpl,
  });
}

export interface CreateFuelEntryInput {
  config: FleetioConfig;
  payload: Record<string, unknown>; // Fleet.io fuel_entries shape varies; pass through
  fetchImpl?: typeof fetch;
}

export interface FleetioFuelEntry {
  id: number;
  vehicle_id: number;
  date: string;
  liters: number | null;
  us_gallons: number | null;
  cost: number | null;
  [key: string]: unknown;
}

export async function createFuelEntry(input: CreateFuelEntryInput): Promise<FleetioFuelEntry> {
  return fleetioFetch<FleetioFuelEntry>({
    method: 'POST',
    path: '/fuel_entries',
    config: input.config,
    body: input.payload,
    fetchImpl: input.fetchImpl,
  });
}

/** Helper for routes: build a FleetioConfig from the env bindings, throwing
 *  FleetioConfigError if either secret is unset. */
export function configFromEnv(env: Record<string, unknown>): FleetioConfig {
  const apiKey = String(env.FLEETIO_API_KEY ?? '');
  const accountToken = String(env.FLEETIO_ACCOUNT_TOKEN ?? '');
  const apiBase = String(env.FLEETIO_API_BASE ?? FLEETIO_API_BASE_DEFAULT);
  if (!apiKey) throw new FleetioConfigError('FLEETIO_API_KEY is unset');
  if (!accountToken) throw new FleetioConfigError('FLEETIO_ACCOUNT_TOKEN is unset');
  return { apiKey, accountToken, apiBase };
}
