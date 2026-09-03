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
  FleetioListPage,
  FleetioVendor,
  FleetioPart,
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

/**
 * Whether a failed attempt with this method may be retried when we DON'T KNOW
 * whether the server processed it (network error, or a timeout where the
 * request may well have landed).
 *
 * GET/PATCH/PUT are idempotent by HTTP definition — replaying them converges
 * on the same state. POST and DELETE are not safe to replay blind:
 *   • POST — a timed-out `POST /vehicles` that actually committed creates a
 *     SECOND remote vehicle on replay, and the duplicate is invisible to us
 *     because the first response never arrived. Fleet.io exposes no
 *     idempotency-key header, so there is no way to make the replay safe.
 *   • DELETE — a replay after a successful hard delete returns 404, which the
 *     sync engine records as a failure and dead-letters, paging an operator
 *     about a delete that in fact succeeded.
 * Both are therefore single-attempt. 5xx is treated the same way: the server
 * responded, but for a POST it may still have committed before failing.
 */
export function isRetryableMethod(method: string): boolean {
  return method === 'GET' || method === 'PATCH' || method === 'PUT';
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
  return (await fleetioFetchWithHeaders<T>(input)).data;
}

/** What `fleetioFetchWithHeaders` returns — the parsed body plus the response
 *  headers, which legacy-paginated Fleet.io endpoints need (`X-Pagination-*`
 *  carries the page counts that the cursor-era API puts in the body instead). */
export interface FleetioResponse<T> {
  data: T;
  headers: Headers;
  status: number;
}

/** Same contract as `fleetioFetch`, but also surfaces the response headers.
 *  Split out rather than changing `fleetioFetch`'s return type so the ~20
 *  existing single-resource callers stay untouched. */
export async function fleetioFetchWithHeaders<T>(input: FleetioFetchInput): Promise<FleetioResponse<T>> {
  if (!input.config.apiKey) throw new FleetioConfigError('FLEETIO_API_KEY is unset');
  if (!input.config.accountToken) throw new FleetioConfigError('FLEETIO_ACCOUNT_TOKEN is unset');

  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // Non-idempotent verbs get exactly one attempt regardless of the caller's
  // maxRetries — see isRetryableMethod for why replay is unsafe there.
  const maxRetries = isRetryableMethod(input.method) ? (input.maxRetries ?? DEFAULT_MAX_RETRIES) : 0;
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
        if (resp.status === 204) return { data: undefined as T, headers: resp.headers, status: resp.status };
        return { data: (await resp.json()) as T, headers: resp.headers, status: resp.status };
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
    // `GET /accounts` is "List Accounts" — a COLLECTION endpoint. It was typed
    // here as a bare `{ id, name }` object, so `account?.id` was always
    // undefined and /test-connection could only ever report `ok: true` with no
    // account identity, which is exactly the detail an operator uses to confirm
    // the key points at the right Fleet.io account. Reuse parseListPage so all
    // three envelope shapes (bare array, cursor `{records}`, or a single object
    // on a version that returns one) resolve to the same first record.
    const resp = await fleetioFetchWithHeaders<unknown>({
      method: 'GET', path: '/accounts', config: input.config,
      fetchImpl: input.fetchImpl, timeoutMs: input.timeoutMs ?? 10_000, maxRetries: 0,
    });
    const page = parseListPage<{ id?: number; name?: string }>(resp.data, resp.headers);
    const account = page.records[0]
      ?? (resp.data && typeof resp.data === 'object' && !Array.isArray(resp.data)
        ? (resp.data as { id?: number; name?: string })
        : undefined);
    return { ok: true, account_id: account?.id, account_name: account?.name };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Pagination (see the FleetioListPage doc block in types.ts) ─────

/** Fleet.io caps `per_page` at 100 on both pagination contracts. */
export const FLEETIO_MAX_PER_PAGE = 100;

/**
 * Normalizes either pagination contract into a `FleetioListPage`. Pure — the
 * caller supplies the already-parsed body and the response headers.
 *
 * Detection is by SHAPE, not by configured version, because the version is a
 * property of the API key and we can't read it:
 *   • bare array          → legacy; counts come from X-Pagination-Total-Pages
 *   • { records: [...] }  → cursor era; `next_cursor` drives the walk
 * A `pagination.total_pages` body field is also honored if some version ever
 * emits one, so recognizing a third shape later costs nothing.
 */
export function parseListPage<T>(body: unknown, headers?: Headers): FleetioListPage<T> {
  const headerTotalPages = numOrNull(headers?.get('x-pagination-total-pages'));

  if (Array.isArray(body)) {
    return {
      records: body as T[],
      next_cursor: null,
      total_pages: headerTotalPages,
      estimated_remaining_count: null,
    };
  }
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    const records = Array.isArray(obj.records) ? (obj.records as T[]) : [];
    const pagination = obj.pagination && typeof obj.pagination === 'object'
      ? (obj.pagination as Record<string, unknown>)
      : null;
    return {
      records,
      next_cursor: typeof obj.next_cursor === 'string' && obj.next_cursor.length > 0 ? obj.next_cursor : null,
      total_pages: numOrNull(pagination?.total_pages) ?? headerTotalPages,
      estimated_remaining_count: numOrNull(obj.estimated_remaining_count),
    };
  }
  return { records: [], next_cursor: null, total_pages: headerTotalPages, estimated_remaining_count: null };
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export interface FleetioListPageInput {
  config: FleetioConfig;
  /** Cursor-era walk position. Omit for the first page. */
  startCursor?: string | null;
  /** Legacy page-number walk position. Omit for the first page. */
  page?: number | null;
  perPage?: number;
  /** Extra query params (filters). */
  query?: Record<string, string | number | boolean | null | undefined>;
  fetchImpl?: typeof fetch;
}

/**
 * One page of any Fleet.io list endpoint, contract-agnostic.
 *
 * The FIRST request deliberately sends neither `start_cursor` nor `page`/`per`
 * — only `per_page`, which both contracts accept. That keeps us from
 * speculatively sending a param the live version might reject, and the
 * response itself then tells us which walk to use (`next_cursor` present →
 * cursor; `X-Pagination-Total-Pages` > 1 → legacy). `per` is sent alongside
 * `page` only once we've committed to the legacy walk, since that's the only
 * contract where `per` is the recognized spelling.
 */
export async function fetchListPage<T>(
  path: string,
  input: FleetioListPageInput,
): Promise<FleetioListPage<T>> {
  const perPage = Math.min(input.perPage ?? FLEETIO_MAX_PER_PAGE, FLEETIO_MAX_PER_PAGE);
  const query: Record<string, string | number | boolean | null | undefined> = {
    ...(input.query ?? {}),
    per_page: perPage,
  };
  if (input.startCursor) {
    query.start_cursor = input.startCursor;
  } else if (input.page && input.page > 1) {
    query.page = input.page;
    query.per = perPage;
  }
  const resp = await fleetioFetchWithHeaders<unknown>({
    method: 'GET', path, config: input.config, query, fetchImpl: input.fetchImpl,
  });
  return parseListPage<T>(resp.data, resp.headers);
}

/** Hard ceiling on pages walked per iteration, so a server that always
 *  advertises "more" can't spin a Worker until it's killed mid-write. 100
 *  pages × 100 records = 10,000 records — far above RMPG's fleet size, and
 *  `truncated` is surfaced rather than swallowed (a silent cap reads as
 *  "imported everything" when it didn't). */
export const FLEETIO_MAX_PAGES = 100;

export interface IterateListResult<T> {
  records: T[];
  pagesFetched: number;
  /** True when FLEETIO_MAX_PAGES stopped the walk before the source ran out. */
  truncated: boolean;
}

/**
 * Walks every page of a list endpoint under whichever pagination contract is
 * live, returning the accumulated records.
 *
 * `onPage` runs between requests — the caller uses it for self-imposed pacing
 * (Fleet.io limits are plan-dependent; no fixed published number). Any error propagates (a mid-walk 429
 * must not look like "the list ended"), so callers get a partial-vs-failed
 * distinction instead of a silently short list.
 */
export async function iterateList<T>(
  path: string,
  input: FleetioListPageInput & { onPage?: (pageIndex: number) => Promise<void> | void },
): Promise<IterateListResult<T>> {
  const all: T[] = [];
  let cursor: string | null = null;
  let page = 1;
  let totalPages: number | null = null;
  let pagesFetched = 0;

  for (;;) {
    if (pagesFetched > 0 && input.onPage) await input.onPage(pagesFetched);
    const result: FleetioListPage<T> = await fetchListPage<T>(path, {
      ...input,
      startCursor: cursor,
      page: cursor ? null : page,
    });
    pagesFetched++;
    all.push(...result.records);
    if (totalPages === null) totalPages = result.total_pages;

    if (result.next_cursor) {
      cursor = result.next_cursor;
    } else if (cursor) {
      break;                                   // cursor walk exhausted
    } else if (totalPages !== null && page < totalPages && result.records.length > 0) {
      page++;                                  // legacy header-driven walk
    } else {
      break;
    }
    if (pagesFetched >= FLEETIO_MAX_PAGES) {
      return { records: all, pagesFetched, truncated: true };
    }
  }
  return { records: all, pagesFetched, truncated: false };
}

export interface ListVehiclesInput {
  config: FleetioConfig;
  startCursor?: string | null;
  page?: number | null;
  perPage?: number;
  fetchImpl?: typeof fetch;
}

/** Single page of `/vehicles`. Most callers want `listAllVehicles`. */
export async function listVehicles(input: ListVehiclesInput): Promise<FleetioListPage<FleetioVehicle>> {
  return fetchListPage<FleetioVehicle>('/vehicles', input);
}

/** Every non-archived-or-not vehicle in the account, across all pages. */
export async function listAllVehicles(
  input: { config: FleetioConfig; perPage?: number; fetchImpl?: typeof fetch; onPage?: (i: number) => Promise<void> | void },
): Promise<IterateListResult<FleetioVehicle>> {
  return iterateList<FleetioVehicle>('/vehicles', input);
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

export interface ListFuelEntriesInput {
  config: FleetioConfig;
  /** Fleet.io's own vehicle id (not RMPG's) — the caller resolves this via
   *  fleetio_links before calling. */
  vehicleId: number;
  startCursor?: string | null;
  page?: number | null;
  perPage?: number;
  fetchImpl?: typeof fetch;
}

export async function listFuelEntries(input: ListFuelEntriesInput): Promise<FleetioListPage<FleetioFuelEntry>> {
  return fetchListPage<FleetioFuelEntry>('/fuel_entries', {
    ...input,
    query: { vehicle_id: input.vehicleId },
  });
}

/**
 * Every fuel entry for one Fleet.io vehicle, across all pages.
 *
 * ⚠️ The returned records are RE-FILTERED on `vehicle_id` client-side. The
 * `?vehicle_id=` filter spelling is not documented for the cursor-era API
 * (which uses a `filter[...]` convention for some resources), and an ignored
 * filter would silently return the WHOLE ACCOUNT's fuel history — which the
 * caller then attributes to this one vehicle, fabricating fuel records against
 * the wrong unit. Filtering locally makes an ignored filter degrade to "fetched
 * more than we needed" instead of "imported wrong data", and `filtered_out`
 * makes the situation visible rather than silent.
 */
export async function listAllFuelEntries(
  input: { config: FleetioConfig; vehicleId: number; perPage?: number; fetchImpl?: typeof fetch; onPage?: (i: number) => Promise<void> | void },
): Promise<IterateListResult<FleetioFuelEntry> & { filteredOut: number }> {
  const page = await iterateList<FleetioFuelEntry>('/fuel_entries', {
    ...input,
    query: { vehicle_id: input.vehicleId },
  });
  const kept = page.records.filter((r) => Number(r.vehicle_id) === input.vehicleId);
  return { ...page, records: kept, filteredOut: page.records.length - kept.length };
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

// ── PR 4 hotfix — handlers stubbed in PR 4 but never implemented ──
// These were left as 501 in dispatchOutbound when PR 4 shipped because
// no vehicle had been seeded yet, so no outbound events for delete /
// work-order creation were exercised. Production diagnostic 2026-06-21
// found 2 stuck events (vehicle/delete id=2, work_order/create id=3) —
// adding the missing client + dispatch wiring unblocks them.

export interface ArchiveVehicleInput {
  config: FleetioConfig;
  fleetioId: number;
  /** ISO-8601 archive timestamp. Caller provides — sync engine injects
   *  from its `now()` so tests stay deterministic and we don't reach for
   *  `new Date()` in module scope (CLAUDE.md guidance). */
  archivedAtIso: string;
  fetchImpl?: typeof fetch;
}

/** Fleet.io has no DELETE on /vehicles — archiving = PATCH with archived_at.
 *  Same row, retained for history; just removed from active filters. */
export async function archiveVehicle(input: ArchiveVehicleInput): Promise<FleetioVehicle> {
  return fleetioFetch<FleetioVehicle>({
    method: 'PATCH',
    path: `/vehicles/${input.fleetioId}`,
    config: input.config,
    body: { archived_at: input.archivedAtIso },
    fetchImpl: input.fetchImpl,
  });
}

export interface FleetioWorkOrder {
  id: number;
  vehicle_id: number;
  state: string;
  number: string | null;
  [key: string]: unknown;
}

export interface CreateWorkOrderInput {
  config: FleetioConfig;
  payload: Record<string, unknown>;  // Fleet.io work_orders shape — pass through
  fetchImpl?: typeof fetch;
}

export async function createWorkOrder(input: CreateWorkOrderInput): Promise<FleetioWorkOrder> {
  return fleetioFetch<FleetioWorkOrder>({
    method: 'POST',
    path: '/work_orders',
    config: input.config,
    body: input.payload,
    fetchImpl: input.fetchImpl,
  });
}

// ── PR after #1545: update verbs ──────────────────────────────
// Closes the remaining 501 holes in the sync engine. PR #1540 added
// create/delete; PR #1545 added FK translation; this set adds the
// matching update verbs so a RMPG-side PATCH to fuel_entries or
// work_orders no longer leaves a stuck 'pending' event.

export interface UpdateFuelEntryInput {
  config: FleetioConfig;
  fleetioId: number;
  payload: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}

export async function updateFuelEntry(input: UpdateFuelEntryInput): Promise<FleetioFuelEntry> {
  return fleetioFetch<FleetioFuelEntry>({
    method: 'PATCH',
    path: `/fuel_entries/${input.fleetioId}`,
    config: input.config,
    body: input.payload,
    fetchImpl: input.fetchImpl,
  });
}

export interface DeleteFuelEntryInput {
  config: FleetioConfig;
  fleetioId: number;
  fetchImpl?: typeof fetch;
}

/**
 * `DELETE /fuel_entries/:id` — Fleet.io supports a hard delete here (confirmed
 * against developer.fleetio.com/docs/api/fuel-entries, 2026-07-26), and it is
 * the symmetric verb: RMPG's `DELETE /fleet/fuel/:id` hard-deletes the local
 * `fleet_fuel_log` row too.
 *
 * Missing before, while `src/routes/fleet.ts` has emitted `fuel.delete` events
 * all along — so dispatchOutbound fell through to its unsupported-verb branch,
 * threw 501, burned all 7 retries, dead-lettered, and fired a
 * `fleetio_event_dead_lettered` alert for every single fuel-log deletion.
 */
export async function deleteFuelEntry(input: DeleteFuelEntryInput): Promise<void> {
  await fleetioFetch<undefined>({
    method: 'DELETE', path: `/fuel_entries/${input.fleetioId}`, config: input.config, fetchImpl: input.fetchImpl,
  });
}

export interface UpdateWorkOrderInput {
  config: FleetioConfig;
  fleetioId: number;
  payload: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}

export async function updateWorkOrder(input: UpdateWorkOrderInput): Promise<FleetioWorkOrder> {
  return fleetioFetch<FleetioWorkOrder>({
    method: 'PATCH',
    path: `/work_orders/${input.fleetioId}`,
    config: input.config,
    body: input.payload,
    fetchImpl: input.fetchImpl,
  });
}

// ── Resource-parity extension: vendors + parts ──────────────────────
// Same shape as the vehicle/work-order methods above. Fleet.io's REST
// resources for these are `/vendors` and `/parts`; neither exposes a hard
// DELETE for vendors (archive via PATCH archived_at, like vehicles), but
// parts DO support DELETE (no soft-delete concept on Fleet.io's side).

export interface CreateVendorInput {
  config: FleetioConfig;
  payload: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}

export async function createVendor(input: CreateVendorInput): Promise<FleetioVendor> {
  return fleetioFetch<FleetioVendor>({
    method: 'POST', path: '/vendors', config: input.config, body: input.payload, fetchImpl: input.fetchImpl,
  });
}

export interface UpdateVendorInput {
  config: FleetioConfig;
  fleetioId: number;
  payload: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}

export async function updateVendor(input: UpdateVendorInput): Promise<FleetioVendor> {
  return fleetioFetch<FleetioVendor>({
    method: 'PATCH', path: `/vendors/${input.fleetioId}`, config: input.config, body: input.payload, fetchImpl: input.fetchImpl,
  });
}

export interface ArchiveVendorInput {
  config: FleetioConfig;
  fleetioId: number;
  fetchImpl?: typeof fetch;
}

/**
 * `PATCH /vendors/:id/archive` — archive, NOT destroy.
 *
 * This previously called `DELETE /vendors/:id`, then (PR #3162) `POST
 * /vendors/:id/archive` — the path fix was right but the verb still wasn't:
 * Fleet.io's live reference (developer.fleetio.com/reference/archive-vendor,
 * confirmed 2026-07-29) documents this endpoint as PATCH, not POST. Every
 * archive call was 404ing on the wrong verb, and because the vendor/delete
 * dispatch branch in sync.ts treats a 404 as "already archived" and drops
 * the link, the failure was silent and unrecoverable — never surfaced as a
 * dead letter. PATCH is also retryable (POST is not, per isRetryableMethod
 * below), restoring the normal retry budget for transient 5xxs.
 */
export async function archiveVendor(input: ArchiveVendorInput): Promise<FleetioVendor> {
  return fleetioFetch<FleetioVendor>({
    method: 'PATCH', path: `/vendors/${input.fleetioId}/archive`, config: input.config, fetchImpl: input.fetchImpl,
  });
}

export interface CreatePartInput {
  config: FleetioConfig;
  payload: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}

export async function createPart(input: CreatePartInput): Promise<FleetioPart> {
  return fleetioFetch<FleetioPart>({
    method: 'POST', path: '/parts', config: input.config, body: input.payload, fetchImpl: input.fetchImpl,
  });
}

export interface UpdatePartInput {
  config: FleetioConfig;
  fleetioId: number;
  payload: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}

export async function updatePart(input: UpdatePartInput): Promise<FleetioPart> {
  return fleetioFetch<FleetioPart>({
    method: 'PATCH', path: `/parts/${input.fleetioId}`, config: input.config, body: input.payload, fetchImpl: input.fetchImpl,
  });
}

export interface DeletePartInput {
  config: FleetioConfig;
  fleetioId: number;
  fetchImpl?: typeof fetch;
}

export async function deletePart(input: DeletePartInput): Promise<void> {
  await fleetioFetch<undefined>({
    method: 'DELETE', path: `/parts/${input.fleetioId}`, config: input.config, fetchImpl: input.fetchImpl,
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
