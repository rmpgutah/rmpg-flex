# CarsXE API Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manual, officer-triggered CarsXE vehicle-data lookup (plate decode, VIN specs, lien/theft, history) as a new Worker integration, cached in D1, surfaced on `PlateLogPage` and `VehicleDossier`.

**Architecture:** A Worker-safe HTTP adapter (`src/utils/carxe/client.ts`) following the Fleet.io adapter shape exactly (typed errors, timeout/retry, pure request builder). A Hono route (`src/routes/carxe.ts`) mounted via `ROUTE_REGISTRY` that checks a D1 cache table before calling out, and wires lien/theft hits into the existing `screenVehicle()` critical-notification path. Two small React UI additions call the new routes through `apiFetch`.

**Tech Stack:** Hono, Cloudflare D1, Cloudflare KV (rate-limit budget), React/TypeScript client, Vitest.

## Global Constraints

- D1 queries are async — every `.first()/.all()/.run()` call must be `await`ed (CLAUDE.md "Common Gotchas" #3).
- New route auth/role gating goes through `ROUTE_REGISTRY` in `src/routesConfig.ts`, **not** inline `app.route()` calls in `src/index.ts` — that file explicitly forbids new mounts (CLAUDE.md "squash-drops-wiring-line" trap).
- Migration file uses the next free integer prefix. Current high-water is `0212` — this plan uses `0213`.
- Unset `CARXE_API_KEY` → `200 { ok:false, code:'not_configured' }` via the existing `notConfigured()` helper (`src/utils/notConfigured.ts`) — never a 503.
- Never log or interpolate `CARXE_API_KEY` into error messages, thrown errors, or response bodies (mirrors the Fleet.io secret-hygiene rule in `src/utils/fleetio/client.ts`).
- Role gate for all `/api/carxe/*` routes: `requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher')` (excludes `client_viewer`, `contract_manager`, `human_resources`) — same set as `src/routes/alpr.ts`.
- Full test suite is the gate, not targeted runs (CLAUDE.md "full-suite-not-targeted-tests").
- Run `cd client && npm install --legacy-peer-deps` first if `client/node_modules` is missing (fresh-worktree prerequisite).

---

### Task 1: Migration — `carxe_lookups` cache table

**Files:**
- Create: `migrations/0213_carxe_lookups.sql`

**Interfaces:**
- Produces: table `carxe_lookups(id, lookup_type, plate, state, vin, response_json, requested_by_user_id, created_at)` + two indexes, consumed by Task 4 (route).

- [ ] **Step 1: Write the migration file**

```sql
-- 0213_carxe_lookups.sql
-- Cache table for CarsXE API lookups (plate decode, VIN specs, lien/theft,
-- history). Avoids re-billing CarsXE credits on repeat lookups and gives
-- an audit trail of who looked up what. See
-- docs/superpowers/specs/2026-07-30-carxe-api-integration-design.md
CREATE TABLE IF NOT EXISTS carxe_lookups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lookup_type TEXT NOT NULL,        -- 'plate' | 'vin_specs' | 'lien_theft' | 'history'
  plate TEXT,
  state TEXT,
  vin TEXT,
  response_json TEXT NOT NULL,
  requested_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (requested_by_user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_carxe_lookups_plate ON carxe_lookups(plate, state);
CREATE INDEX IF NOT EXISTS idx_carxe_lookups_vin ON carxe_lookups(vin, lookup_type);
```

- [ ] **Step 2: Apply locally and verify**

Run: `npm run migrate:local`
Then: `npx wrangler d1 execute rmpg-flex --local --command "SELECT name FROM sqlite_master WHERE name='carxe_lookups'"`
Expected: one row returned (`carxe_lookups`).

- [ ] **Step 3: Commit**

```bash
git add migrations/0213_carxe_lookups.sql
git commit -m "feat(carxe): add carxe_lookups cache table (migration 0213)"
```

---

### Task 2: Typed errors — `src/utils/carxe/errors.ts`

**Files:**
- Create: `src/utils/carxe/errors.ts`
- Test: `tests/carxeClient.test.ts` (error classes exercised in Task 3's tests — no standalone test file needed here since these are plain classes with no logic to unit test in isolation)

**Interfaces:**
- Produces: `CarxeError`, `CarxeConfigError`, `CarxeTimeoutError`, `CarxeHttpError`, `CarxeRateLimitError` — consumed by Task 3 (client) and Task 4 (route).

- [ ] **Step 1: Write the errors module**

```typescript
// ============================================================
// RMPG Flex — CarsXE integration: typed errors
// ============================================================
// Mirrors src/utils/fleetio/errors.ts so the codebase has one consistent
// integration-error idiom. Callers `instanceof`-discriminate to map
// failures to HTTP codes or retry policy.
// ============================================================

export class CarxeError extends Error {
  readonly status?: number;
  readonly detail?: unknown;
  constructor(message: string, opts?: { status?: number; detail?: unknown }) {
    super(message);
    this.name = 'CarxeError';
    this.status = opts?.status;
    this.detail = opts?.detail;
  }
}

/** Bad/missing config: API key unset. Not retried. */
export class CarxeConfigError extends CarxeError {
  constructor(message: string, detail?: unknown) {
    super(message, { detail });
    this.name = 'CarxeConfigError';
  }
}

/** Request exceeded the timeout across all retry attempts. */
export class CarxeTimeoutError extends CarxeError {
  constructor(message: string) {
    super(message);
    this.name = 'CarxeTimeoutError';
  }
}

/** CarsXE returned a non-2xx, non-429 response. `status` carries the HTTP code. */
export class CarxeHttpError extends CarxeError {
  constructor(message: string, status: number, detail?: unknown) {
    super(message, { status, detail });
    this.name = 'CarxeHttpError';
  }
}

/** CarsXE returned 429. `retryAfterSeconds` reflects the Retry-After header or
 *  the adapter's default backoff if the header was absent/non-numeric. */
export class CarxeRateLimitError extends CarxeError {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number, detail?: unknown) {
    super(`CarsXE rate limit hit; retry after ${retryAfterSeconds}s`, { status: 429, detail });
    this.name = 'CarxeRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/utils/carxe/errors.ts
git commit -m "feat(carxe): add typed error classes"
```

---

### Task 3: HTTP client — `src/utils/carxe/client.ts`

**Files:**
- Create: `src/utils/carxe/client.ts`
- Create: `src/utils/carxe/types.ts`
- Test: `tests/carxeClient.test.ts`

**Interfaces:**
- Consumes: `CarxeConfigError | CarxeTimeoutError | CarxeHttpError | CarxeRateLimitError` from Task 2.
- Produces (consumed by Task 4 — route):
  - `CARXE_API_BASE_DEFAULT: string`
  - `interface CarxeConfig { apiKey: string; apiBase: string }`
  - `configFromEnv(env: { CARXE_API_KEY?: string; CARXE_API_BASE?: string }): CarxeConfig`
  - `decodePlate(config: CarxeConfig, input: { plate: string; state?: string; country?: string }): Promise<CarxePlateResult>`
  - `getSpecifications(config: CarxeConfig, input: { vin: string }): Promise<CarxeSpecsResult>`
  - `getLienTheft(config: CarxeConfig, input: { vin: string }): Promise<CarxeLienTheftResult>`
  - `getHistory(config: CarxeConfig, input: { vin: string }): Promise<CarxeHistoryResult>`
  - Types: `CarxePlateResult`, `CarxeSpecsResult`, `CarxeLienTheftEvent`, `CarxeLienTheftResult`, `CarxeHistoryResult` (all from `types.ts`)

- [ ] **Step 1: Write the types file**

```typescript
// src/utils/carxe/types.ts
// ============================================================
// RMPG Flex — CarsXE integration: response types
// ============================================================
// Shapes confirmed against carsxe.com/docs (2026-07-30). Fields not used
// by this integration are typed loosely (Record<string, unknown>) rather
// than exhaustively modeled — CarsXE's response shape varies by country
// for plate-decoder and by data availability for the others.
// ============================================================

export interface CarxePlateResult {
  success: boolean;
  input: { plate: string; country?: string; state?: string };
  description?: string;
  make?: string;
  model?: string;
  trim?: string;
  vin?: string;
  style?: string;
  year?: string;
  color?: string;
  body_style?: string;
  [key: string]: unknown;
}

export interface CarxeSpecsResult {
  success: boolean;
  input: { vin: string };
  attributes?: Record<string, unknown>;
  colors?: Array<Record<string, unknown>>;
  equipment?: Record<string, unknown>;
  warranties?: Array<Record<string, unknown>>;
  timestamp?: string;
  [key: string]: unknown;
}

export interface CarxeLienTheftEvent {
  event: string;
  location?: string;
  lienholder?: string;
  date?: string;
  details_list?: string[];
}

export interface CarxeLienTheftResult {
  success: boolean;
  input: { vin: string };
  year?: number;
  make?: string;
  model?: string;
  type?: string;
  events: CarxeLienTheftEvent[];
  [key: string]: unknown;
}

export interface CarxeHistoryResult {
  vin: string;
  success: boolean;
  junkAndSalvageInformation?: unknown[];
  insuranceInformation?: unknown[];
  brandsRecordCount?: number;
  brandsInformation?: unknown[];
  vinChanged?: boolean;
  currentTitleInformation?: unknown[];
  historyInformation?: unknown[];
  status?: string;
  error?: unknown;
  [key: string]: unknown;
}
```

- [ ] **Step 2: Write the failing client tests**

```typescript
// tests/carxeClient.test.ts
import { describe, it, expect, vi } from 'vitest';
import {
  CARXE_API_BASE_DEFAULT,
  configFromEnv,
  decodePlate,
  getSpecifications,
  getLienTheft,
  getHistory,
} from '../src/utils/carxe/client';
import { CarxeConfigError, CarxeHttpError, CarxeRateLimitError, CarxeTimeoutError } from '../src/utils/carxe/errors';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

describe('carxe/client — configFromEnv', () => {
  it('throws CarxeConfigError when CARXE_API_KEY is unset', () => {
    expect(() => configFromEnv({})).toThrow(CarxeConfigError);
  });

  it('builds config with default base when CARXE_API_BASE is unset', () => {
    const config = configFromEnv({ CARXE_API_KEY: 'test-key' });
    expect(config.apiKey).toBe('test-key');
    expect(config.apiBase).toBe(CARXE_API_BASE_DEFAULT);
  });

  it('uses CARXE_API_BASE override when set', () => {
    const config = configFromEnv({ CARXE_API_KEY: 'test-key', CARXE_API_BASE: 'https://sandbox.example.com' });
    expect(config.apiBase).toBe('https://sandbox.example.com');
  });
});

describe('carxe/client — decodePlate', () => {
  const config = { apiKey: 'test-key', apiBase: CARXE_API_BASE_DEFAULT };

  it('sends key/plate/state as query params on a GET request', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ success: true, input: { plate: '7XER187' }, make: 'Kia' }));
    await decodePlate(config, { plate: '7XER187', state: 'CA' }, { fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(init.method).toBe('GET');
    expect(url).toContain('/v2/platedecoder');
    expect(url).toContain('key=test-key');
    expect(url).toContain('plate=7XER187');
    expect(url).toContain('state=CA');
  });

  it('parses a successful response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ success: true, input: { plate: '7XER187' }, make: 'Kia', model: 'Forte' }));
    const result = await decodePlate(config, { plate: '7XER187', state: 'CA' }, { fetchImpl });
    expect(result.make).toBe('Kia');
    expect(result.model).toBe('Forte');
  });

  it('throws CarxeHttpError on a 4xx response and does not retry', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ success: false, error: 'bad request' }, 400));
    await expect(decodePlate(config, { plate: 'BAD' }, { fetchImpl })).rejects.toBeInstanceOf(CarxeHttpError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries a 5xx up to maxRetries then throws CarxeHttpError', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'upstream down' }, 502));
    await expect(
      decodePlate(config, { plate: '7XER187' }, { fetchImpl, maxRetries: 2, backoffBaseMs: 1 }),
    ).rejects.toBeInstanceOf(CarxeHttpError);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('throws CarxeRateLimitError on 429 without retrying in-band', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'rate limited' }, 429, { 'retry-after': '5' }));
    await expect(decodePlate(config, { plate: '7XER187' }, { fetchImpl })).rejects.toBeInstanceOf(CarxeRateLimitError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('throws CarxeTimeoutError when the request aborts', async () => {
    const fetchImpl = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    });
    await expect(
      decodePlate(config, { plate: '7XER187' }, { fetchImpl, timeoutMs: 5 }),
    ).rejects.toBeInstanceOf(CarxeTimeoutError);
  });

  it('never includes the api key in a thrown error message', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'bad' }, 400));
    try {
      await decodePlate(config, { plate: '7XER187' }, { fetchImpl });
      throw new Error('expected rejection');
    } catch (err: any) {
      expect(String(err.message)).not.toContain('test-key');
    }
  });
});

describe('carxe/client — getSpecifications', () => {
  const config = { apiKey: 'test-key', apiBase: CARXE_API_BASE_DEFAULT };

  it('calls /specs with key/vin params', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ success: true, input: { vin: 'WBAFR7C57CC811956' }, attributes: { make: 'BMW' } }));
    const result = await getSpecifications(config, { vin: 'WBAFR7C57CC811956' }, { fetchImpl });
    const [url] = fetchImpl.mock.calls[0];
    expect(url).toContain('/specs');
    expect(url).toContain('vin=WBAFR7C57CC811956');
    expect(result.attributes?.make).toBe('BMW');
  });
});

describe('carxe/client — getLienTheft', () => {
  const config = { apiKey: 'test-key', apiBase: CARXE_API_BASE_DEFAULT };

  it('calls /v1/lien-theft and returns events', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        input: { vin: '2C3CDXFG1FH762860' },
        events: [{ event: 'Active Theft', location: 'OH', details_list: ['stolen'] }],
      }),
    );
    const result = await getLienTheft(config, { vin: '2C3CDXFG1FH762860' }, { fetchImpl });
    const [url] = fetchImpl.mock.calls[0];
    expect(url).toContain('/v1/lien-theft');
    expect(result.events).toHaveLength(1);
    expect(result.events[0].event).toBe('Active Theft');
  });
});

describe('carxe/client — getHistory', () => {
  const config = { apiKey: 'test-key', apiBase: CARXE_API_BASE_DEFAULT };

  it('calls /history and returns the report shape', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ vin: 'WBAFR7C57CC811956', success: true, status: 'ok' }));
    const result = await getHistory(config, { vin: 'WBAFR7C57CC811956' }, { fetchImpl });
    const [url] = fetchImpl.mock.calls[0];
    expect(url).toContain('/history');
    expect(result.status).toBe('ok');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/carxeClient.test.ts`
Expected: FAIL — `Cannot find module '../src/utils/carxe/client'`

- [ ] **Step 4: Implement the client**

```typescript
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/carxeClient.test.ts`
Expected: PASS (all cases)

- [ ] **Step 6: Commit**

```bash
git add src/utils/carxe/client.ts src/utils/carxe/types.ts tests/carxeClient.test.ts
git commit -m "feat(carxe): add HTTP client for plate decode, specs, lien/theft, history"
```

---

### Task 4: Rate-limit budget — `src/utils/carxe/rateLimit.ts`

**Files:**
- Create: `src/utils/carxe/rateLimit.ts`
- Test: `tests/carxeRateLimit.test.ts`

**Interfaces:**
- Produces: `CARXE_MINUTE_BUDGET: number`, `CarxeKvLike` interface, `checkAndReserveCarxeCall(kv: CarxeKvLike, nowMs: number): Promise<{allowed: true} | {allowed: false; reason: 'minute_limit'}>` — consumed by Task 5 (route).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/carxeRateLimit.test.ts
import { describe, it, expect } from 'vitest';
import { checkAndReserveCarxeCall, CARXE_MINUTE_BUDGET, type CarxeKvLike } from '../src/utils/carxe/rateLimit';

function makeMemoryKv(): CarxeKvLike {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
  };
}

describe('carxe/rateLimit', () => {
  it('allows calls under the per-minute budget', async () => {
    const kv = makeMemoryKv();
    const now = 1_000_000;
    for (let i = 0; i < CARXE_MINUTE_BUDGET; i++) {
      const result = await checkAndReserveCarxeCall(kv, now);
      expect(result.allowed).toBe(true);
    }
  });

  it('rejects the call once the per-minute budget is exhausted', async () => {
    const kv = makeMemoryKv();
    const now = 2_000_000;
    for (let i = 0; i < CARXE_MINUTE_BUDGET; i++) {
      await checkAndReserveCarxeCall(kv, now);
    }
    const result = await checkAndReserveCarxeCall(kv, now);
    expect(result).toEqual({ allowed: false, reason: 'minute_limit' });
  });

  it('resets the budget in a new minute window', async () => {
    const kv = makeMemoryKv();
    const minuteOne = 3_000_000;
    for (let i = 0; i < CARXE_MINUTE_BUDGET; i++) {
      await checkAndReserveCarxeCall(kv, minuteOne);
    }
    const minuteTwo = minuteOne + 60_000;
    const result = await checkAndReserveCarxeCall(kv, minuteTwo);
    expect(result.allowed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/carxeRateLimit.test.ts`
Expected: FAIL — `Cannot find module '../src/utils/carxe/rateLimit'`

- [ ] **Step 3: Implement the rate limiter**

```typescript
// src/utils/carxe/rateLimit.ts
// ============================================================
// RMPG Flex — CarsXE integration: self-imposed rate-limit budget
// ============================================================
// CarsXE's actual per-account limit isn't confirmed yet (open question in
// the design spec) — this enforces a conservative default (30/min) via a
// KV counter so a burst of "Run Lookup" clicks can never trip whatever
// CarsXE's real limiter turns out to be. Same shape as
// src/utils/legalDataHunter/rateLimit.ts. Soft/best-effort: KV reads+writes
// below aren't atomic, but the margin absorbs the rare race under this
// feature's low, human-click-driven call volume.
// ============================================================

export const CARXE_MINUTE_BUDGET = 30;

export interface CarxeKvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

function minuteKey(nowMs: number): string {
  const flooredMinute = Math.floor(nowMs / 60_000) * 60_000;
  return `carxe:usage:minute:${flooredMinute}`;
}

export async function checkAndReserveCarxeCall(
  kv: CarxeKvLike,
  nowMs: number,
): Promise<{ allowed: true } | { allowed: false; reason: 'minute_limit' }> {
  const mKey = minuteKey(nowMs);
  const countRaw = await kv.get(mKey);
  const count = countRaw ? parseInt(countRaw, 10) || 0 : 0;
  if (count >= CARXE_MINUTE_BUDGET) {
    return { allowed: false, reason: 'minute_limit' };
  }
  await kv.put(mKey, String(count + 1), { expirationTtl: 120 });
  return { allowed: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/carxeRateLimit.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/carxe/rateLimit.ts tests/carxeRateLimit.test.ts
git commit -m "feat(carxe): add self-imposed per-minute rate-limit budget"
```

---

### Task 5: Route — `src/routes/carxe.ts` + registry wiring

**Files:**
- Create: `src/routes/carxe.ts`
- Modify: `src/routesConfig.ts` (add import + `ROUTE_REGISTRY` entry)
- Modify: `src/types.ts` (add `CARXE_API_KEY?: string; CARXE_API_BASE?: string;` to `Bindings`)
- Test: `test-workers/carxe.test.ts` (Miniflare route smoke test)

**Interfaces:**
- Consumes:
  - `configFromEnv`, `decodePlate`, `getSpecifications`, `getLienTheft`, `getHistory` from Task 3 (`src/utils/carxe/client.ts`)
  - `CarxeConfigError`, `CarxeHttpError`, `CarxeRateLimitError`, `CarxeTimeoutError` from Task 2 (`src/utils/carxe/errors.ts`)
  - `checkAndReserveCarxeCall` from Task 4 (`src/utils/carxe/rateLimit.ts`)
  - `notConfigured(c, reason)` from `src/utils/notConfigured.ts`
  - `requireRole(...roles)` from `src/middleware/auth.ts`
  - `getDb`, `query`, `queryFirst`, `execute` from `src/utils/db.ts`
  - `screenVehicle(db, ref)` from `src/utils/intelScreen.ts` — signature: `(db: D1Database, ref: { vehicleId?: number; plate?: string }) => Promise<{ vehicleId: number | null; hits: ScreenHit[] }>`
  - `recordAudit` from `src/utils/auditLog.ts` (check exact signature in that file before use)
- Produces (consumed by Task 6 — UI):
  - `POST /api/carxe/plate-lookup` — body `{ plate: string; state?: string }` → `{ ok: true, cached: boolean, result: CarxePlateResult }` | `{ ok:false, code:'not_configured' }` | `{ ok:false, code:'rate_limited' }`
  - `POST /api/carxe/vin-specs` — body `{ vin: string }` → `{ ok: true, cached: boolean, result: CarxeSpecsResult }`
  - `POST /api/carxe/lien-theft` — body `{ vin: string }` → `{ ok: true, cached: boolean, result: CarxeLienTheftResult, screening?: { vehicleId: number | null; hits: ScreenHit[] } }`
  - `POST /api/carxe/history` — body `{ vin: string }` → `{ ok: true, cached: boolean, result: CarxeHistoryResult }`
  - `GET /api/carxe/lookups?plate=&state=` or `?vin=&lookup_type=` → `{ ok: true, lookups: Array<{ id, lookup_type, plate, state, vin, response_json, created_at }> }`

- [ ] **Step 1: Add CarXE bindings to `src/types.ts`**

Find the `Bindings` type (near `ROBOFLOW_API_KEY?: string;` at line 101) and add directly below it:

```typescript
  CARXE_API_KEY?: string;
  CARXE_API_BASE?: string;
```

- [ ] **Step 2: Write the route file**

```typescript
// src/routes/carxe.ts
// ============================================================
// RMPG Flex — CarsXE vehicle-data lookup routes
// ============================================================
// Mounted at /api/carxe (auth: 'required'). Manual, officer-triggered
// lookups only — never runs automatically. Checks a D1 cache
// (carxe_lookups) before calling out to avoid re-billing CarsXE credits
// on repeat lookups. Lien & Theft results with an active theft flag are
// wired into the existing screenVehicle() critical-hit notification path
// (same one Roboflow ALPR uses).
//
// Spec: docs/superpowers/specs/2026-07-30-carxe-api-integration-design.md
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { notConfigured } from '../utils/notConfigured';
import {
  configFromEnv,
  decodePlate,
  getSpecifications,
  getLienTheft,
  getHistory,
} from '../utils/carxe/client';
import { CarxeConfigError, CarxeError, CarxeHttpError, CarxeRateLimitError, CarxeTimeoutError } from '../utils/carxe/errors';
import { checkAndReserveCarxeCall } from '../utils/carxe/rateLimit';
import { screenVehicle } from '../utils/intelScreen';
import { recordAudit } from '../utils/auditLog';
import { log } from '../utils/logger';

const carxe = new Hono<Env>();

// Field-operational roles; client_viewer / contract_manager / human_resources
// excluded — mirrors the alpr.ts / intel.ts gate.
const operational = requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher');

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CachedLookupRow {
  id: number;
  response_json: string;
  created_at: string;
}

async function findFreshCache(
  db: D1Database,
  lookupType: string,
  key: { plate?: string; state?: string; vin?: string },
): Promise<CachedLookupRow | null> {
  const row = key.vin
    ? await queryFirst<CachedLookupRow>(
        db,
        'SELECT id, response_json, created_at FROM carxe_lookups WHERE lookup_type = ? AND vin = ? ORDER BY created_at DESC LIMIT 1',
        lookupType,
        key.vin,
      )
    : await queryFirst<CachedLookupRow>(
        db,
        'SELECT id, response_json, created_at FROM carxe_lookups WHERE lookup_type = ? AND plate = ? AND state = ? ORDER BY created_at DESC LIMIT 1',
        lookupType,
        key.plate ?? null,
        key.state ?? null,
      );
  if (!row) return null;
  const ageMs = Date.now() - new Date(row.created_at + 'Z').getTime();
  return ageMs <= CACHE_TTL_MS ? row : null;
}

async function persistLookup(
  db: D1Database,
  lookupType: string,
  key: { plate?: string; state?: string; vin?: string },
  response: unknown,
  userId: number | undefined,
): Promise<void> {
  await execute(
    db,
    'INSERT INTO carxe_lookups (lookup_type, plate, state, vin, response_json, requested_by_user_id) VALUES (?, ?, ?, ?, ?, ?)',
    lookupType,
    key.plate ?? null,
    key.state ?? null,
    key.vin ?? null,
    JSON.stringify(response),
    userId ?? null,
  );
}

/** Maps a CarxeError subclass to an HTTP status + client-safe body.
 *  NEVER echoes err.detail — it may carry the raw CarsXE response, which
 *  (like Fleet.io's) could theoretically echo request params back. */
function errorResponse(c: any, err: unknown) {
  if (err instanceof CarxeRateLimitError) {
    return c.json({ ok: false, code: 'rate_limited', message: err.message }, 429);
  }
  if (err instanceof CarxeTimeoutError) {
    return c.json({ ok: false, code: 'timeout', message: err.message }, 504);
  }
  if (err instanceof CarxeHttpError) {
    return c.json({ ok: false, code: 'upstream_error', message: err.message }, 502);
  }
  if (err instanceof CarxeError) {
    return c.json({ ok: false, code: 'carxe_error', message: err.message }, 500);
  }
  log.error('[carxe] unexpected error', { error: (err as any)?.message });
  return c.json({ ok: false, code: 'internal_error' }, 500);
}

carxe.post('/plate-lookup', operational, async (c) => {
  const env = c.env as Record<string, unknown> as { CARXE_API_KEY?: string; CARXE_API_BASE?: string; DB: D1Database; CARXE_RATE_KV?: KVNamespace };
  let config;
  try {
    config = configFromEnv(env);
  } catch (err) {
    if (err instanceof CarxeConfigError) return notConfigured(c, 'CARXE_API_KEY is unset');
    throw err;
  }

  const body = await c.req.json<{ plate?: string; state?: string }>().catch(() => ({}));
  const plate = (body.plate || '').trim().toUpperCase();
  const state = (body.state || '').trim().toUpperCase() || undefined;
  if (!plate) return c.json({ ok: false, code: 'invalid_input', message: 'plate is required' }, 400);

  const db = getDb(env);
  const cached = await findFreshCache(db, 'plate', { plate, state });
  if (cached) {
    return c.json({ ok: true, cached: true, result: JSON.parse(cached.response_json) });
  }

  const rateKv = (env.CARXE_RATE_KV ?? env.KV) as KVNamespace | undefined;
  if (rateKv) {
    const budget = await checkAndReserveCarxeCall(rateKv, Date.now());
    if (!budget.allowed) return c.json({ ok: false, code: 'rate_limited' }, 429);
  }

  try {
    const result = await decodePlate(config, { plate, state });
    const user = c.get('user') as { id?: number } | undefined;
    await persistLookup(db, 'plate', { plate, state }, result, user?.id);
    return c.json({ ok: true, cached: false, result });
  } catch (err) {
    return errorResponse(c, err);
  }
});

carxe.post('/vin-specs', operational, async (c) => {
  const env = c.env as Record<string, unknown> as { CARXE_API_KEY?: string; CARXE_API_BASE?: string; DB: D1Database; CARXE_RATE_KV?: KVNamespace; KV?: KVNamespace };
  let config;
  try {
    config = configFromEnv(env);
  } catch (err) {
    if (err instanceof CarxeConfigError) return notConfigured(c, 'CARXE_API_KEY is unset');
    throw err;
  }

  const body = await c.req.json<{ vin?: string }>().catch(() => ({}));
  const vin = (body.vin || '').trim().toUpperCase();
  if (!vin) return c.json({ ok: false, code: 'invalid_input', message: 'vin is required' }, 400);

  const db = getDb(env);
  const cached = await findFreshCache(db, 'vin_specs', { vin });
  if (cached) {
    return c.json({ ok: true, cached: true, result: JSON.parse(cached.response_json) });
  }

  const rateKv = (env.CARXE_RATE_KV ?? env.KV) as KVNamespace | undefined;
  if (rateKv) {
    const budget = await checkAndReserveCarxeCall(rateKv, Date.now());
    if (!budget.allowed) return c.json({ ok: false, code: 'rate_limited' }, 429);
  }

  try {
    const result = await getSpecifications(config, { vin });
    const user = c.get('user') as { id?: number } | undefined;
    await persistLookup(db, 'vin_specs', { vin }, result, user?.id);
    return c.json({ ok: true, cached: false, result });
  } catch (err) {
    return errorResponse(c, err);
  }
});

carxe.post('/lien-theft', operational, async (c) => {
  const env = c.env as Record<string, unknown> as { CARXE_API_KEY?: string; CARXE_API_BASE?: string; DB: D1Database; CARXE_RATE_KV?: KVNamespace; KV?: KVNamespace };
  let config;
  try {
    config = configFromEnv(env);
  } catch (err) {
    if (err instanceof CarxeConfigError) return notConfigured(c, 'CARXE_API_KEY is unset');
    throw err;
  }

  const body = await c.req.json<{ vin?: string }>().catch(() => ({}));
  const vin = (body.vin || '').trim().toUpperCase();
  if (!vin) return c.json({ ok: false, code: 'invalid_input', message: 'vin is required' }, 400);

  const db = getDb(env);
  let result;
  let fromCache = false;
  const cached = await findFreshCache(db, 'lien_theft', { vin });
  if (cached) {
    result = JSON.parse(cached.response_json);
    fromCache = true;
  } else {
    const rateKv = (env.CARXE_RATE_KV ?? env.KV) as KVNamespace | undefined;
    if (rateKv) {
      const budget = await checkAndReserveCarxeCall(rateKv, Date.now());
      if (!budget.allowed) return c.json({ ok: false, code: 'rate_limited' }, 429);
    }
    try {
      result = await getLienTheft(config, { vin });
    } catch (err) {
      return errorResponse(c, err);
    }
    const user = c.get('user') as { id?: number } | undefined;
    await persistLookup(db, 'lien_theft', { vin }, result, user?.id);
  }

  // Wire an active theft flag into the same officer-safety screening path
  // Roboflow ALPR uses. Non-theft liens are informational only — no alert.
  const hasActiveTheft = (result.events ?? []).some((e: { event?: string }) =>
    (e.event || '').toLowerCase().includes('theft'),
  );
  let screening: { vehicleId: number | null; hits: unknown[] } | undefined;
  if (hasActiveTheft) {
    const vehicleRow = await queryFirst<{ id: number }>(db, 'SELECT id FROM vehicles_records WHERE UPPER(vin) = ?', vin);
    if (vehicleRow) {
      screening = await screenVehicle(db, { vehicleId: vehicleRow.id });
    }
  }

  return c.json({ ok: true, cached: fromCache, result, ...(screening ? { screening } : {}) });
});

carxe.post('/history', operational, async (c) => {
  const env = c.env as Record<string, unknown> as { CARXE_API_KEY?: string; CARXE_API_BASE?: string; DB: D1Database; CARXE_RATE_KV?: KVNamespace; KV?: KVNamespace };
  let config;
  try {
    config = configFromEnv(env);
  } catch (err) {
    if (err instanceof CarxeConfigError) return notConfigured(c, 'CARXE_API_KEY is unset');
    throw err;
  }

  const body = await c.req.json<{ vin?: string }>().catch(() => ({}));
  const vin = (body.vin || '').trim().toUpperCase();
  if (!vin) return c.json({ ok: false, code: 'invalid_input', message: 'vin is required' }, 400);

  const db = getDb(env);
  const cached = await findFreshCache(db, 'history', { vin });
  if (cached) {
    return c.json({ ok: true, cached: true, result: JSON.parse(cached.response_json) });
  }

  const rateKv = (env.CARXE_RATE_KV ?? env.KV) as KVNamespace | undefined;
  if (rateKv) {
    const budget = await checkAndReserveCarxeCall(rateKv, Date.now());
    if (!budget.allowed) return c.json({ ok: false, code: 'rate_limited' }, 429);
  }

  try {
    const result = await getHistory(config, { vin });
    const user = c.get('user') as { id?: number } | undefined;
    await persistLookup(db, 'history', { vin }, result, user?.id);
    return c.json({ ok: true, cached: false, result });
  } catch (err) {
    return errorResponse(c, err);
  }
});

carxe.get('/lookups', operational, async (c) => {
  const env = c.env as Record<string, unknown> as { DB: D1Database };
  const db = getDb(env);
  const plate = c.req.query('plate');
  const state = c.req.query('state');
  const vin = c.req.query('vin');
  const lookupType = c.req.query('lookup_type');

  let rows;
  if (vin) {
    rows = lookupType
      ? await query(db, 'SELECT id, lookup_type, plate, state, vin, response_json, created_at FROM carxe_lookups WHERE vin = ? AND lookup_type = ? ORDER BY created_at DESC LIMIT 20', vin.toUpperCase(), lookupType)
      : await query(db, 'SELECT id, lookup_type, plate, state, vin, response_json, created_at FROM carxe_lookups WHERE vin = ? ORDER BY created_at DESC LIMIT 20', vin.toUpperCase());
  } else if (plate) {
    rows = await query(
      db,
      'SELECT id, lookup_type, plate, state, vin, response_json, created_at FROM carxe_lookups WHERE plate = ? AND state = ? ORDER BY created_at DESC LIMIT 20',
      plate.toUpperCase(),
      (state || '').toUpperCase() || null,
    );
  } else {
    return c.json({ ok: false, code: 'invalid_input', message: 'plate or vin is required' }, 400);
  }

  return c.json({ ok: true, lookups: rows });
});

export default carxe;
```

- [ ] **Step 3: Wire into `src/routesConfig.ts`**

Find the import block near line 119 (`import alpr from './routes/alpr';`) and add alphabetically:

```typescript
import carxe from './routes/carxe';
```

Find the `ROUTE_REGISTRY` entry for `/api/fleetio` (around line 457) and add a new entry directly after it, alphabetically consistent with the surrounding entries:

```typescript
  { prefix: '/api/carxe', router: carxe, auth: 'required',
    note: 'CarsXE vehicle-data lookups: plate decode, VIN specs, lien/theft, history. Manual/officer-triggered only, cached in carxe_lookups (24h TTL). 200 {ok:false,code:\'not_configured\'} when CARXE_API_KEY is unset.' },
```

- [ ] **Step 4: Check `recordAudit`'s exact signature and `screenVehicle`'s `ScreenHit` type before finalizing**

Run: `grep -n "export.*recordAudit\|export interface ScreenHit\|export type ScreenHit" src/utils/auditLog.ts src/utils/intelScreen.ts`

If `recordAudit` requires a call (it wasn't used above — this route relies on the `carxe_lookups` table itself as the audit trail, matching the Legal Data Hunter route's approach, which also skips `recordAudit`). Confirm this by checking whether `src/routes/legalDataHunter.ts` calls `recordAudit` — if it doesn't, this route's omission is consistent and no change is needed. If it does, add an equivalent call after each successful live lookup.

- [ ] **Step 5: Write the Miniflare route smoke test**

```typescript
// test-workers/carxe.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unstable_dev } from 'wrangler';
import type { UnstableDevWorker } from 'wrangler';

describe('carxe routes', () => {
  let worker: UnstableDevWorker;

  beforeAll(async () => {
    worker = await unstable_dev('src/index.ts', {
      experimental: { disableExperimentalWarning: true },
      vars: { JWT_SECRET: 'test-secret' },
    });
  });

  afterAll(async () => {
    await worker.stop();
  });

  it('returns not_configured when CARXE_API_KEY is unset', async () => {
    // Uses the module's own auth test-token convention — see
    // test-workers/auth.test.ts for how other suites mint a valid JWT
    // for an operational-role user; reuse that helper here.
    const resp = await worker.fetch('/api/carxe/plate-lookup', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer <valid-test-token>' },
      body: JSON.stringify({ plate: '7XER187', state: 'CA' }),
    });
    const body = await resp.json();
    expect(resp.status).toBe(200);
    expect(body).toMatchObject({ ok: false, code: 'not_configured' });
  });

  it('rejects unauthenticated requests', async () => {
    const resp = await worker.fetch('/api/carxe/plate-lookup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plate: '7XER187' }),
    });
    expect(resp.status).toBe(401);
  });
});
```

Before finalizing this test, read `test-workers/auth.test.ts` to copy its exact pattern for minting a valid test JWT for an `officer`-role user — do not invent a different auth-stubbing approach.

- [ ] **Step 6: Run the worker typecheck and both test suites**

Run: `npm run typecheck`
Expected: 0 errors

Run: `npx vitest run` (root suite — exercises `tests/carxeClient.test.ts` and `tests/carxeRateLimit.test.ts`)
Expected: all pass, no new failures

Run: `npm run test:worker` (Miniflare — exercises `test-workers/carxe.test.ts`)
Expected: all pass, no new failures

- [ ] **Step 7: Commit**

```bash
git add src/routes/carxe.ts src/routesConfig.ts src/types.ts test-workers/carxe.test.ts
git commit -m "feat(carxe): add /api/carxe routes with D1 caching and lien/theft screening"
```

---

### Task 6: UI — PlateLogPage lookup action + VehicleDossier lookup panel

**Files:**
- Modify: `client/src/pages/PlateLogPage.tsx`
- Modify: `client/src/components/VehicleDossier.tsx`
- Create: `client/src/components/CarxeLookupPanel.tsx`
- Test: `client/src/components/__tests__/CarxeLookupPanel.test.tsx`

**Interfaces:**
- Consumes: `apiFetch<T>(endpoint, options)` from `client/src/hooks/useApi.ts`; route response shapes from Task 5 (`/api/carxe/plate-lookup`, `/api/carxe/vin-specs`, `/api/carxe/lien-theft`, `/api/carxe/history`, `/api/carxe/lookups`).
- Produces: `<CarxeLookupPanel mode="plate" plate={string} state={string} />` and `<CarxeLookupPanel mode="vin" vin={string} />` — a single reusable component, consumed by both `PlateLogPage.tsx` and `VehicleDossier.tsx`.

- [ ] **Step 1: Write the shared lookup panel component**

```tsx
// client/src/components/CarxeLookupPanel.tsx
// Manual CarsXE lookup trigger + result display. Two modes:
//   - mode="plate": decodes a plate/state via /api/carxe/plate-lookup
//   - mode="vin": offers Specifications / Lien & Theft / History buttons
//     against a single VIN via /api/carxe/vin-specs, /lien-theft, /history
// Results are cached server-side (carxe_lookups, 24h TTL) — this component
// just renders whatever the route returns; it does not itself cache.
import { useState } from 'react';
import { Search, AlertTriangle, Loader2 } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';

type PlateResult = { success: boolean; make?: string; model?: string; trim?: string; year?: string; vin?: string; color?: string; [key: string]: unknown };
type SpecsResult = { attributes?: Record<string, unknown>; [key: string]: unknown };
type LienTheftEvent = { event: string; location?: string; lienholder?: string; date?: string; details_list?: string[] };
type LienTheftResult = { events: LienTheftEvent[]; [key: string]: unknown };
type HistoryResult = { status?: string; brandsRecordCount?: number; [key: string]: unknown };

interface CarxeResponse<T> {
  ok: boolean;
  code?: string;
  cached?: boolean;
  result?: T;
  screening?: { hits: Array<{ kind: string; severity: string; detail: string }> };
}

interface PlateProps { mode: 'plate'; plate: string; state?: string }
interface VinProps { mode: 'vin'; vin: string }

export default function CarxeLookupPanel(props: PlateProps | VinProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plateResult, setPlateResult] = useState<PlateResult | null>(null);
  const [specsResult, setSpecsResult] = useState<SpecsResult | null>(null);
  const [lienResult, setLienResult] = useState<LienTheftResult | null>(null);
  const [lienHits, setLienHits] = useState<Array<{ kind: string; severity: string; detail: string }>>([]);
  const [historyResult, setHistoryResult] = useState<HistoryResult | null>(null);

  async function runLookup(kind: 'plate' | 'vin-specs' | 'lien-theft' | 'history') {
    setLoading(kind);
    setError(null);
    try {
      const body = kind === 'plate'
        ? { plate: (props as PlateProps).plate, state: (props as PlateProps).state }
        : { vin: (props as VinProps).vin };
      const resp = await apiFetch<CarxeResponse<any>>(`/carxe/${kind}`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        setError(resp.code === 'not_configured' ? 'CarsXE lookup is not configured' : (resp.code || 'Lookup failed'));
        return;
      }
      if (kind === 'plate') setPlateResult(resp.result);
      if (kind === 'vin-specs') setSpecsResult(resp.result);
      if (kind === 'lien-theft') {
        setLienResult(resp.result);
        setLienHits(resp.screening?.hits ?? []);
      }
      if (kind === 'history') setHistoryResult(resp.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lookup failed');
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-2">
      {error && (
        <div className="text-[11px] text-sev-critical flex items-center gap-1">
          <AlertTriangle size={12} /> {error}
        </div>
      )}
      {props.mode === 'plate' && (
        <button
          onClick={() => runLookup('plate')}
          disabled={loading === 'plate'}
          className="flex items-center gap-1 text-[11px] px-2 py-1 bg-surface-raised hover:bg-surface-hover border border-rmpg-700 disabled:opacity-50"
        >
          {loading === 'plate' ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
          Run CarsXE Lookup
        </button>
      )}
      {plateResult && (
        <div className="text-[11px] text-rmpg-100">
          {plateResult.description || `${plateResult.year ?? ''} ${plateResult.make ?? ''} ${plateResult.model ?? ''} ${plateResult.trim ?? ''}`.trim()}
          {plateResult.vin ? ` · VIN ${plateResult.vin}` : ''}
        </div>
      )}

      {props.mode === 'vin' && (
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => runLookup('vin-specs')} disabled={loading === 'vin-specs'} className="text-[11px] px-2 py-1 bg-surface-raised hover:bg-surface-hover border border-rmpg-700 disabled:opacity-50">
            {loading === 'vin-specs' ? <Loader2 size={12} className="animate-spin inline" /> : null} Specifications
          </button>
          <button onClick={() => runLookup('lien-theft')} disabled={loading === 'lien-theft'} className="text-[11px] px-2 py-1 bg-surface-raised hover:bg-surface-hover border border-rmpg-700 disabled:opacity-50">
            {loading === 'lien-theft' ? <Loader2 size={12} className="animate-spin inline" /> : null} Lien &amp; Theft
          </button>
          <button onClick={() => runLookup('history')} disabled={loading === 'history'} className="text-[11px] px-2 py-1 bg-surface-raised hover:bg-surface-hover border border-rmpg-700 disabled:opacity-50">
            {loading === 'history' ? <Loader2 size={12} className="animate-spin inline" /> : null} History
          </button>
        </div>
      )}

      {specsResult?.attributes && (
        <div className="text-[11px] text-rmpg-100">
          {Object.entries(specsResult.attributes).slice(0, 6).map(([k, v]) => (
            <div key={k}>{k}: {String(v)}</div>
          ))}
        </div>
      )}

      {lienResult && (
        <div className="text-[11px]">
          {lienHits.length > 0 && (
            <div className="text-sev-critical font-semibold mb-1">
              {lienHits.map((h, i) => <div key={i}>⚠ {h.detail}</div>)}
            </div>
          )}
          {lienResult.events.length === 0 && <div className="text-rmpg-300">No lien or theft records found</div>}
          {lienResult.events.map((e, i) => (
            <div key={i} className={e.event.toLowerCase().includes('theft') ? 'text-sev-critical' : 'text-rmpg-100'}>
              {e.event}{e.lienholder ? ` — ${e.lienholder}` : ''}{e.location ? ` (${e.location})` : ''}
            </div>
          ))}
        </div>
      )}

      {historyResult && (
        <div className="text-[11px] text-rmpg-100">
          Status: {historyResult.status ?? 'unknown'} · Brand records: {historyResult.brandsRecordCount ?? 0}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write the failing component test**

```tsx
// client/src/components/__tests__/CarxeLookupPanel.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CarxeLookupPanel from '../CarxeLookupPanel';
import * as useApiModule from '../../hooks/useApi';

describe('CarxeLookupPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a plate decode result after clicking the lookup button', async () => {
    vi.spyOn(useApiModule, 'apiFetch').mockResolvedValue({
      ok: true,
      cached: false,
      result: { success: true, make: 'Kia', model: 'Forte', year: '2017' },
    });

    render(<CarxeLookupPanel mode="plate" plate="7XER187" state="CA" />);
    fireEvent.click(screen.getByText('Run CarsXE Lookup'));

    await waitFor(() => {
      expect(screen.getByText(/Kia/)).toBeInTheDocument();
    });
  });

  it('shows a not_configured message without crashing', async () => {
    vi.spyOn(useApiModule, 'apiFetch').mockResolvedValue({ ok: false, code: 'not_configured' });

    render(<CarxeLookupPanel mode="plate" plate="7XER187" />);
    fireEvent.click(screen.getByText('Run CarsXE Lookup'));

    await waitFor(() => {
      expect(screen.getByText('CarsXE lookup is not configured')).toBeInTheDocument();
    });
  });

  it('renders lien/theft events and highlights active theft hits', async () => {
    vi.spyOn(useApiModule, 'apiFetch').mockResolvedValue({
      ok: true,
      cached: false,
      result: { events: [{ event: 'Active Theft', location: 'OH' }] },
      screening: { hits: [{ kind: 'stolen', severity: 'critical', detail: 'Vehicle reported stolen' }] },
    });

    render(<CarxeLookupPanel mode="vin" vin="2C3CDXFG1FH762860" />);
    fireEvent.click(screen.getByText(/Lien & Theft/));

    await waitFor(() => {
      expect(screen.getByText(/Vehicle reported stolen/)).toBeInTheDocument();
      expect(screen.getByText(/Active Theft/)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd client && npx vitest run src/components/__tests__/CarxeLookupPanel.test.tsx`
Expected: FAIL — `Cannot find module '../CarxeLookupPanel'`

- [ ] **Step 4: Run test again after Step 1's component exists**

Run: `cd client && npx vitest run src/components/__tests__/CarxeLookupPanel.test.tsx`
Expected: PASS (all three cases)

- [ ] **Step 5: Wire into `PlateLogPage.tsx`**

Read the section of `PlateLogPage.tsx` around the manual plate-entry form (search for the manual entry input/submit handler) and add, directly below the manual-entry result display:

```tsx
import CarxeLookupPanel from '../components/CarxeLookupPanel';
```

Then, wherever the current sighting/plate result is rendered (near the `SightResult` display), add:

```tsx
{sightResult?.plate && (
  <CarxeLookupPanel mode="plate" plate={sightResult.plate} />
)}
```

Adjust the exact insertion point and prop wiring to match the actual state variable holding the current plate — read the surrounding ~40 lines of `PlateLogPage.tsx` before inserting, since the file is large (767 lines) and state variable names must match exactly.

- [ ] **Step 6: Wire into `VehicleDossier.tsx`**

Read `VehicleDossier.tsx` in full (it's short) to find where the vehicle's plate/VIN props are available, then add near the top of the dossier panel, below the header:

```tsx
import CarxeLookupPanel from './CarxeLookupPanel';
```

```tsx
{vin && <CarxeLookupPanel mode="vin" vin={vin} />}
```

Match the actual prop name the component receives for the vehicle's VIN — confirm by reading the component's props interface first; it may need threading a `vin` prop from the parent if not already present.

- [ ] **Step 7: Run the client build and full client test suite**

Run: `cd client && npx tsc --noEmit`
Expected: 0 errors

Run: `cd client && npx vitest run`
Expected: all pass, no new failures

Run: `cd client && npx vite build`
Expected: build succeeds

- [ ] **Step 8: Commit**

```bash
git add client/src/components/CarxeLookupPanel.tsx client/src/components/__tests__/CarxeLookupPanel.test.tsx client/src/pages/PlateLogPage.tsx client/src/components/VehicleDossier.tsx
git commit -m "feat(carxe): add CarsXE lookup UI to PlateLogPage and VehicleDossier"
```

---

### Task 7: Post-merge live setup (manual, not code)

**Files:** None — operational steps only.

- [ ] **Step 1: Rotate both CarsXE keys**

In the CarsXE dashboard (carsxe.com/dashboard), regenerate both the production ("Company API") and sandbox keys shared during this integration's design conversation — they were pasted in plain chat text and must be treated as compromised regardless of intent.

- [ ] **Step 2: Set the production secret**

```bash
npx wrangler secret put CARXE_API_KEY
```
Paste the newly rotated production key when prompted.

- [ ] **Step 3: Set the local dev key**

Add to `.dev.vars` (gitignored):
```
CARXE_API_KEY=<rotated-sandbox-key>
```

- [ ] **Step 4: Apply the migration to live D1 and verify**

```bash
scripts/apply-migration.sh 0213_carxe_lookups.sql
```
Then verify:
```bash
npx wrangler d1 execute rmpg-flex --remote --command "SELECT name FROM sqlite_master WHERE name='carxe_lookups'"
```
Expected: one row returned.

- [ ] **Step 5: Confirm the route is live**

After the next deploy, confirm the API key was picked up:
```bash
curl -s https://api.rmpgutah.us/api/carxe/plate-lookup -X POST -H "content-type: application/json" -H "authorization: Bearer <valid-token>" -d '{"plate":"7XER187","state":"CA"}'
```
Expected: either a real decode result, or (if the deploy hasn't picked up the secret yet) `{"ok":false,"code":"not_configured"}` — not a 500.

This task has no commit — it's operational/manual only.
