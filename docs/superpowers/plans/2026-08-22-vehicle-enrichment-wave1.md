# Vehicle Enrichment Wave 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate three free RapidAPI vehicle data APIs (Plate→VIN, VIN Decoder, Plate Decoder) into a sequential enrichment chain that auto-fires on new ALPR captures and is manually triggerable from the Vehicle Dossier.

**Architecture:** A new `src/utils/vehicleEnrichment/` module holds the three API clients, rate limiters, and chain orchestrator. All vehicle record writes flow exclusively through the existing `upsertVehicleFromCarxe` seam in `src/utils/carxe/vehicleRecords.ts` — no direct `UPDATE vehicles_records` anywhere in new code. A permanent D1 cache table avoids re-billing API credits on repeat lookups.

**Tech Stack:** Hono (Worker route), Cloudflare D1 (cache), Cloudflare KV (rate limit counters), RapidAPI (three external APIs), React + Tailwind + Lucide (UI button), Vitest (tests).

## Global Constraints

- All D1 queries are `async` — always `await` `.first()` / `.all()` / `.run()`
- Never `SELECT *` from `vehicles_records` (100-column D1 cap) — always name columns
- Never write directly to `vehicles_records` — use `upsertVehicleFromCarxe` or `fillVehicleFields` from `src/utils/carxe/vehicleRecords.ts`
- Fill-only writes: never overwrite officer-entered data — enforced by COALESCE pattern in `fillVehicleFields`
- Unset API key → skip that chain step silently; log via `log.warn` from `src/utils/logger.ts`
- Rate limit exhaustion → skip step silently; no officer-visible error
- Worker-safe only — no `node:*` imports, no `fs`, no `path`
- Secrets via `wrangler secret put`; never hardcode keys
- Route returns `200 { ok: false, code: 'not_configured' }` pattern when ALL three keys are unset
- All new Tailwind classes must resolve to actual `dist/assets/*.css` output — verify before trusting
- Never use `rounded-lg` — 2px radius enforced globally; use `rounded-sm` or no rounding class
- No hardcoded hex colors — use CSS variable tokens (`text-rmpg-100`, `bg-surface-sunken`, etc.)
- `IconButton` requires `aria-label` prop (TypeScript enforced)
- D1 bound-parameter cap is 100 — never build an IN-list from an unbounded array

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `migrations/0263_vehicle_enrichment_cache.sql` | Create | `vehicle_enrichment_cache` table + unique index |
| `src/utils/vehicleEnrichment/types.ts` | Create | `EnrichmentResult`, `VehicleEnrichData`, typed errors |
| `src/utils/vehicleEnrichment/rateLimit.ts` | Create | KV rate limiters for all three APIs |
| `src/utils/vehicleEnrichment/client.ts` | Create | Three Worker-safe fetch wrappers |
| `src/utils/vehicleEnrichment/enrichChain.ts` | Create | `enrichVehicleRecord()` orchestrator |
| `src/routes/vehicleEnrichment.ts` | Create | Hono route at `/api/vehicle-enrichment` |
| `src/types.ts` | Modify | Add `PLATE_TO_VIN_API_KEY?`, `VIN_DECODER_API_KEY?`, `PLATE_DECODER_API_KEY?` to `Bindings` |
| `src/routesConfig.ts` | Modify | Mount `/api/vehicle-enrichment` |
| `src/routes/alpr.ts` | Modify | Auto-trigger enrichment via `waitUntil` on new plate row |
| `client/src/components/VehicleDossier.tsx` | Modify | Add "Enrich ↻" `IconButton` |
| `tests/vehicleEnrichmentClient.test.ts` | Create | Unit tests for three API clients |
| `tests/vehicleEnrichment.test.ts` | Create | Unit tests for chain orchestrator |

---

## Task 1: Migration — `vehicle_enrichment_cache` table

**Files:**
- Create: `migrations/0263_vehicle_enrichment_cache.sql`

**Interfaces:**
- Produces: `vehicle_enrichment_cache` table, `idx_vehicle_enrichment_cache_plate_key` unique index

- [ ] **Step 1: Create the migration file**

```sql
-- migrations/0263_vehicle_enrichment_cache.sql
CREATE TABLE IF NOT EXISTS vehicle_enrichment_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plate_key TEXT NOT NULL,
  plate_number TEXT NOT NULL,
  state TEXT,
  vin TEXT,
  make TEXT,
  model TEXT,
  year INTEGER,
  trim TEXT,
  color TEXT,
  vehicle_type TEXT,
  raw_plate_to_vin TEXT,
  raw_vin_decoder TEXT,
  raw_plate_decoder TEXT,
  enriched_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_enrichment_cache_plate_key
  ON vehicle_enrichment_cache(plate_key);
```

- [ ] **Step 2: Apply locally**

```bash
npm run migrate:local
```

Expected: `✅  Applied migration 0263_vehicle_enrichment_cache.sql` (or "already applied")

- [ ] **Step 3: Verify table exists**

```bash
npx wrangler d1 execute rmpg-flex --local --command "SELECT name FROM sqlite_master WHERE name='vehicle_enrichment_cache'"
```

Expected: one row with `name = vehicle_enrichment_cache`

- [ ] **Step 4: Commit**

```bash
git add migrations/0263_vehicle_enrichment_cache.sql
git commit -m "feat(vehicle-enrichment): add vehicle_enrichment_cache migration"
```

---

## Task 2: Types & Errors

**Files:**
- Create: `src/utils/vehicleEnrichment/types.ts`

**Interfaces:**
- Produces:
  - `VehicleEnrichData` — fields shape for `upsertVehicleFromCarxe` call
  - `EnrichmentResult` — return type of `enrichVehicleRecord`
  - `VehicleEnrichConfigError`, `VehicleEnrichTimeoutError`, `VehicleEnrichHttpError`

- [ ] **Step 1: Write the failing test**

Create `tests/vehicleEnrichmentClient.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  VehicleEnrichConfigError,
  VehicleEnrichTimeoutError,
  VehicleEnrichHttpError,
} from '../src/utils/vehicleEnrichment/types';

describe('VehicleEnrich error types', () => {
  it('VehicleEnrichConfigError is an Error with correct name', () => {
    const err = new VehicleEnrichConfigError('PLATE_TO_VIN_API_KEY');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('VehicleEnrichConfigError');
    expect(err.apiKey).toBe('PLATE_TO_VIN_API_KEY');
  });

  it('VehicleEnrichTimeoutError is an Error with correct name', () => {
    const err = new VehicleEnrichTimeoutError('plateToVin', 10000);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('VehicleEnrichTimeoutError');
    expect(err.step).toBe('plateToVin');
    expect(err.timeoutMs).toBe(10000);
  });

  it('VehicleEnrichHttpError carries status and step', () => {
    const err = new VehicleEnrichHttpError('decodeVin', 429, 'Too Many Requests');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('VehicleEnrichHttpError');
    expect(err.step).toBe('decodeVin');
    expect(err.status).toBe(429);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/vehicleEnrichmentClient.test.ts
```

Expected: FAIL — `Cannot find module '../src/utils/vehicleEnrichment/types'`

- [ ] **Step 3: Create types file**

Create `src/utils/vehicleEnrichment/types.ts`:

```ts
// src/utils/vehicleEnrichment/types.ts

/** Fields that can be written to vehicles_records via upsertVehicleFromCarxe.
 *  Matches the VehicleFields interface in src/utils/carxe/vehicleRecords.ts. */
export interface VehicleEnrichData {
  vin?: string | null;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  color?: string | null;
  trim?: string | null;
  body_style?: string | null;
  vehicle_type?: string | null;
}

export interface EnrichmentResult {
  vehicleId: number;
  fromCache: boolean;
  data: VehicleEnrichData;
  stepsRun: ('plateToVin' | 'decodeVin' | 'decodePlate')[];
  stepErrors: Record<string, string>;
}

export class VehicleEnrichConfigError extends Error {
  readonly name = 'VehicleEnrichConfigError';
  constructor(public readonly apiKey: string) {
    super(`API key not configured: ${apiKey}`);
  }
}

export class VehicleEnrichTimeoutError extends Error {
  readonly name = 'VehicleEnrichTimeoutError';
  constructor(
    public readonly step: string,
    public readonly timeoutMs: number,
  ) {
    super(`${step} timed out after ${timeoutMs}ms`);
  }
}

export class VehicleEnrichHttpError extends Error {
  readonly name = 'VehicleEnrichHttpError';
  constructor(
    public readonly step: string,
    public readonly status: number,
    message: string,
  ) {
    super(`${step} HTTP ${status}: ${message}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/vehicleEnrichmentClient.test.ts
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/utils/vehicleEnrichment/types.ts tests/vehicleEnrichmentClient.test.ts
git commit -m "feat(vehicle-enrichment): add typed errors and EnrichmentResult"
```

---

## Task 3: Rate Limiters

**Files:**
- Create: `src/utils/vehicleEnrichment/rateLimit.ts`

**Interfaces:**
- Consumes: `LdhKvLike` pattern from `src/utils/legalDataHunter/rateLimit.ts` (same KV interface shape)
- Produces:
  - `checkAndReservePlateToVin(kv, nowMs)` → `{ allowed: boolean; reason?: string }`
  - `checkAndReserveVinDecoder(kv, nowMs)` → `{ allowed: boolean; reason?: string }`
  - `checkAndReservePlateDecoder(kv, nowMs)` → `{ allowed: boolean; reason?: string }`
  - `ENRICH_RATE_LIMITS` constant

- [ ] **Step 1: Add rate limit tests to `tests/vehicleEnrichmentClient.test.ts`**

Append to the existing test file:

```ts
import {
  checkAndReservePlateToVin,
  checkAndReserveVinDecoder,
  checkAndReservePlateDecoder,
  ENRICH_RATE_LIMITS,
} from '../src/utils/vehicleEnrichment/rateLimit';

describe('vehicle enrichment rate limits', () => {
  const makeKv = (stored: Record<string, string>) => ({
    get: async (k: string) => stored[k] ?? null,
    put: async (k: string, v: string) => { stored[k] = v; },
  });

  it('allows call when under daily limit (plateToVin)', async () => {
    const kv = makeKv({});
    const result = await checkAndReservePlateToVin(kv, Date.now());
    expect(result.allowed).toBe(true);
  });

  it('blocks when daily budget exhausted (plateToVin)', async () => {
    const kv = makeKv({});
    const now = Date.now();
    const day = new Date(now).toISOString().slice(0, 10);
    // Pre-fill to the limit
    await kv.put(`vehicle_enrich:plate_to_vin:day:${day}`, String(ENRICH_RATE_LIMITS.plateToVin.daily));
    const result = await checkAndReservePlateToVin(kv, now);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('daily_limit');
  });

  it('allows vinDecoder call when under monthly limit', async () => {
    const kv = makeKv({});
    const result = await checkAndReserveVinDecoder(kv, Date.now());
    expect(result.allowed).toBe(true);
  });

  it('blocks vinDecoder when monthly budget exhausted', async () => {
    const kv = makeKv({});
    const now = Date.now();
    const month = new Date(now).toISOString().slice(0, 7);
    await kv.put(`vehicle_enrich:vin_decoder:month:${month}`, String(ENRICH_RATE_LIMITS.vinDecoder.monthly));
    const result = await checkAndReserveVinDecoder(kv, now);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('monthly_limit');
  });

  it('allows plateDecoder call when under daily limit', async () => {
    const kv = makeKv({});
    const result = await checkAndReservePlateDecoder(kv, Date.now());
    expect(result.allowed).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
npx vitest run tests/vehicleEnrichmentClient.test.ts
```

Expected: FAIL — `Cannot find module '../src/utils/vehicleEnrichment/rateLimit'`

- [ ] **Step 3: Create rateLimit.ts**

Create `src/utils/vehicleEnrichment/rateLimit.ts`:

```ts
// src/utils/vehicleEnrichment/rateLimit.ts

export interface EnrichKvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

export const ENRICH_RATE_LIMITS = {
  plateToVin:   { daily: 80 },
  vinDecoder:   { monthly: 80 },
  plateDecoder: { daily: 80 },
} as const;

type AllowResult = { allowed: true } | { allowed: false; reason: string };

async function checkDaily(
  kv: EnrichKvLike,
  prefix: string,
  budget: number,
  nowMs: number,
): Promise<AllowResult> {
  const day = new Date(nowMs).toISOString().slice(0, 10);
  const key = `vehicle_enrich:${prefix}:day:${day}`;
  const raw = await kv.get(key);
  const count = raw ? parseInt(raw, 10) || 0 : 0;
  if (count >= budget) return { allowed: false, reason: 'daily_limit' };
  await kv.put(key, String(count + 1), { expirationTtl: 25 * 60 * 60 });
  return { allowed: true };
}

async function checkMonthly(
  kv: EnrichKvLike,
  prefix: string,
  budget: number,
  nowMs: number,
): Promise<AllowResult> {
  const month = new Date(nowMs).toISOString().slice(0, 7);
  const key = `vehicle_enrich:${prefix}:month:${month}`;
  const raw = await kv.get(key);
  const count = raw ? parseInt(raw, 10) || 0 : 0;
  if (count >= budget) return { allowed: false, reason: 'monthly_limit' };
  await kv.put(key, String(count + 1), { expirationTtl: 32 * 24 * 60 * 60 });
  return { allowed: true };
}

export function checkAndReservePlateToVin(kv: EnrichKvLike, nowMs: number): Promise<AllowResult> {
  return checkDaily(kv, 'plate_to_vin', ENRICH_RATE_LIMITS.plateToVin.daily, nowMs);
}

export function checkAndReserveVinDecoder(kv: EnrichKvLike, nowMs: number): Promise<AllowResult> {
  return checkMonthly(kv, 'vin_decoder', ENRICH_RATE_LIMITS.vinDecoder.monthly, nowMs);
}

export function checkAndReservePlateDecoder(kv: EnrichKvLike, nowMs: number): Promise<AllowResult> {
  return checkDaily(kv, 'plate_decoder', ENRICH_RATE_LIMITS.plateDecoder.daily, nowMs);
}
```

- [ ] **Step 4: Run tests to verify all pass**

```bash
npx vitest run tests/vehicleEnrichmentClient.test.ts
```

Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/utils/vehicleEnrichment/rateLimit.ts tests/vehicleEnrichmentClient.test.ts
git commit -m "feat(vehicle-enrichment): add KV rate limiters for all three APIs"
```

---

## Task 4: API Clients

**Files:**
- Create: `src/utils/vehicleEnrichment/client.ts`

**Interfaces:**
- Consumes: `VehicleEnrichConfigError`, `VehicleEnrichTimeoutError`, `VehicleEnrichHttpError` from `./types`
- Produces:
  - `plateToVin(plate: string, state: string, apiKey: string): Promise<{ vin: string | null }>`
  - `decodeVin(vin: string, apiKey: string): Promise<{ make: string | null; model: string | null; year: number | null; trim: string | null; color: string | null; vehicle_type: string | null }>`
  - `decodePlate(plate: string, state: string, apiKey: string): Promise<{ make: string | null; model: string | null; year: number | null; vehicle_type: string | null }>`

- [ ] **Step 1: Add client tests to `tests/vehicleEnrichmentClient.test.ts`**

Append to the existing test file:

```ts
import { plateToVin, decodeVin, decodePlate } from '../src/utils/vehicleEnrichment/client';

describe('plateToVin client', () => {
  it('throws VehicleEnrichConfigError when apiKey is empty', async () => {
    await expect(plateToVin('ABC123', 'UT', '')).rejects.toBeInstanceOf(VehicleEnrichConfigError);
  });

  it('returns vin from successful response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ vin: '1HGBH41JXMN109186' }),
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    const result = await plateToVin('ABC123', 'UT', 'test-key');
    expect(result.vin).toBe('1HGBH41JXMN109186');
  });

  it('throws VehicleEnrichHttpError on 401', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 401, text: async () => 'Unauthorized',
    }) as unknown as typeof fetch;
    await expect(plateToVin('ABC123', 'UT', 'bad-key')).rejects.toBeInstanceOf(VehicleEnrichHttpError);
  });

  it('returns null vin when API returns no match', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ vin: null }),
    }) as unknown as typeof fetch;
    const result = await plateToVin('ZZZNONE', 'UT', 'test-key');
    expect(result.vin).toBeNull();
  });
});

describe('decodeVin client', () => {
  it('throws VehicleEnrichConfigError when apiKey is empty', async () => {
    await expect(decodeVin('1HGBH41JXMN109186', '')).rejects.toBeInstanceOf(VehicleEnrichConfigError);
  });

  it('returns decoded fields from successful response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({
        make: 'Honda', model: 'Civic', year: 2021,
        trim: 'EX', color: 'Blue', vehicle_type: 'Passenger',
      }),
    }) as unknown as typeof fetch;
    const result = await decodeVin('1HGBH41JXMN109186', 'test-key');
    expect(result.make).toBe('Honda');
    expect(result.year).toBe(2021);
  });

  it('throws VehicleEnrichHttpError on 400', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 400, text: async () => 'Bad Request',
    }) as unknown as typeof fetch;
    await expect(decodeVin('BADINPUT', 'test-key')).rejects.toBeInstanceOf(VehicleEnrichHttpError);
  });
});

describe('decodePlate client', () => {
  it('throws VehicleEnrichConfigError when apiKey is empty', async () => {
    await expect(decodePlate('ABC123', 'UT', '')).rejects.toBeInstanceOf(VehicleEnrichConfigError);
  });

  it('throws VehicleEnrichHttpError on 500', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 500, text: async () => 'Internal Server Error',
    }) as unknown as typeof fetch;
    await expect(decodePlate('ABC123', 'UT', 'test-key')).rejects.toBeInstanceOf(VehicleEnrichHttpError);
  });
});
```

- [ ] **Step 2: Run to verify new tests fail**

```bash
npx vitest run tests/vehicleEnrichmentClient.test.ts
```

Expected: FAIL — `Cannot find module '../src/utils/vehicleEnrichment/client'`

- [ ] **Step 3: Create client.ts**

Create `src/utils/vehicleEnrichment/client.ts`:

```ts
// src/utils/vehicleEnrichment/client.ts
import {
  VehicleEnrichConfigError,
  VehicleEnrichTimeoutError,
  VehicleEnrichHttpError,
} from './types';

const TIMEOUT_MS = 10_000;

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      throw new VehicleEnrichTimeoutError(String(init.headers ?? ''), TIMEOUT_MS);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Step 1: Plate + state → VIN via RapidAPI US License Plate to VIN */
export async function plateToVin(
  plate: string,
  state: string,
  apiKey: string,
): Promise<{ vin: string | null }> {
  if (!apiKey) throw new VehicleEnrichConfigError('PLATE_TO_VIN_API_KEY');
  const url = `https://us-license-plate-to-vin.p.rapidapi.com/licenseplate/${encodeURIComponent(plate)}?state=${encodeURIComponent(state)}`;
  const res = await fetchWithTimeout(url, {
    headers: {
      'X-RapidAPI-Key': apiKey,
      'X-RapidAPI-Host': 'us-license-plate-to-vin.p.rapidapi.com',
    },
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => String(res.status));
    throw new VehicleEnrichHttpError('plateToVin', res.status, msg);
  }
  const json = await res.json() as Record<string, unknown>;
  const vin = typeof json.vin === 'string' && json.vin ? json.vin : null;
  return { vin };
}

/** Step 2: VIN → make/model/year/trim/color/vehicle_type via RapidAPI VIN Decoder */
export async function decodeVin(
  vin: string,
  apiKey: string,
): Promise<{
  make: string | null;
  model: string | null;
  year: number | null;
  trim: string | null;
  color: string | null;
  vehicle_type: string | null;
}> {
  if (!apiKey) throw new VehicleEnrichConfigError('VIN_DECODER_API_KEY');
  const url = `https://vin-decoder7.p.rapidapi.com/vin?vin=${encodeURIComponent(vin)}`;
  const res = await fetchWithTimeout(url, {
    headers: {
      'X-RapidAPI-Key': apiKey,
      'X-RapidAPI-Host': 'vin-decoder7.p.rapidapi.com',
    },
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => String(res.status));
    throw new VehicleEnrichHttpError('decodeVin', res.status, msg);
  }
  const json = await res.json() as Record<string, unknown>;
  const yearRaw = json.year;
  let year: number | null = null;
  if (typeof yearRaw === 'number' && yearRaw >= 1900 && yearRaw <= 2100) year = yearRaw;
  else if (typeof yearRaw === 'string') {
    const n = parseInt(yearRaw, 10);
    if (!isNaN(n) && n >= 1900 && n <= 2100) year = n;
  }
  return {
    make: typeof json.make === 'string' ? json.make : null,
    model: typeof json.model === 'string' ? json.model : null,
    year,
    trim: typeof json.trim === 'string' ? json.trim : null,
    color: typeof json.color === 'string' ? json.color : null,
    vehicle_type: typeof json.vehicle_type === 'string' ? json.vehicle_type : null,
  };
}

/** Step 3 (fallback): Plate → format/state/metadata via RapidAPI License Plate Decoder */
export async function decodePlate(
  plate: string,
  state: string,
  apiKey: string,
): Promise<{
  make: string | null;
  model: string | null;
  year: number | null;
  vehicle_type: string | null;
}> {
  if (!apiKey) throw new VehicleEnrichConfigError('PLATE_DECODER_API_KEY');
  const url = `https://license-plate-decoder.p.rapidapi.com/v1/plates?plate=${encodeURIComponent(plate)}&state=${encodeURIComponent(state)}`;
  const res = await fetchWithTimeout(url, {
    headers: {
      'X-RapidAPI-Key': apiKey,
      'X-RapidAPI-Host': 'license-plate-decoder.p.rapidapi.com',
    },
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => String(res.status));
    throw new VehicleEnrichHttpError('decodePlate', res.status, msg);
  }
  const json = await res.json() as Record<string, unknown>;
  const yearRaw = json.year;
  let year: number | null = null;
  if (typeof yearRaw === 'number' && yearRaw >= 1900 && yearRaw <= 2100) year = yearRaw;
  return {
    make: typeof json.make === 'string' ? json.make : null,
    model: typeof json.model === 'string' ? json.model : null,
    year,
    vehicle_type: typeof json.vehicle_type === 'string' ? json.vehicle_type : null,
  };
}
```

- [ ] **Step 4: Run all client tests**

```bash
npx vitest run tests/vehicleEnrichmentClient.test.ts
```

Expected: PASS (all tests — 3 error type + 5 rate limit + 9 client)

- [ ] **Step 5: Commit**

```bash
git add src/utils/vehicleEnrichment/client.ts tests/vehicleEnrichmentClient.test.ts
git commit -m "feat(vehicle-enrichment): add three API client wrappers with typed errors"
```

---

## Task 5: Chain Orchestrator

**Files:**
- Create: `src/utils/vehicleEnrichment/enrichChain.ts`
- Create: `tests/vehicleEnrichment.test.ts`

**Interfaces:**
- Consumes:
  - `plateToVin`, `decodeVin`, `decodePlate` from `./client`
  - `checkAndReservePlateToVin`, `checkAndReserveVinDecoder`, `checkAndReservePlateDecoder` from `./rateLimit`
  - `upsertVehicleFromCarxe`, `resolveVehicleRecord` from `../carxe/vehicleRecords`
  - `log` from `../logger`
- Produces:
  - `enrichVehicleRecord(plate, state, db, env, ctx?, opts?) → Promise<EnrichmentResult>`
  - `buildPlateKey(plate, state) → string`

- [ ] **Step 1: Write failing chain tests**

Create `tests/vehicleEnrichment.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildPlateKey } from '../src/utils/vehicleEnrichment/enrichChain';

// We test the pure helper synchronously; enrichVehicleRecord requires
// a D1 mock which is tested below via the integration harness pattern.

describe('buildPlateKey', () => {
  it('normalizes plate and state to uppercase', () => {
    expect(buildPlateKey('abc123', 'ut')).toBe('ABC123|UT');
  });

  it('trims whitespace', () => {
    expect(buildPlateKey(' ABC 123 ', ' UT ')).toBe('ABC 123|UT');
  });

  it('handles missing state', () => {
    expect(buildPlateKey('ABC123', '')).toBe('ABC123|');
  });
});

describe('enrichVehicleRecord cache hit', () => {
  it('returns fromCache=true and skips API calls when cache row exists', async () => {
    const { enrichVehicleRecord } = await import('../src/utils/vehicleEnrichment/enrichChain');

    const mockDb = {
      prepare: vi.fn().mockReturnThis(),
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue({
        id: 42,
        plate_number: 'ABC123',
        state: 'UT',
        vin: '1HGBH41JXMN109186',
        make: 'Honda',
        model: 'Civic',
        year: 2021,
        trim: 'EX',
        color: 'Blue',
        vehicle_type: 'Passenger',
      }),
      run: vi.fn().mockResolvedValue({ meta: { last_row_id: 0 } }),
      all: vi.fn().mockResolvedValue({ results: [] }),
    } as unknown as D1Database;

    const mockEnv = {
      KV: {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(undefined),
      },
      PLATE_TO_VIN_API_KEY: 'key1',
      VIN_DECODER_API_KEY: 'key2',
      PLATE_DECODER_API_KEY: 'key3',
    };

    const result = await enrichVehicleRecord('ABC123', 'UT', mockDb, mockEnv as never);
    expect(result.fromCache).toBe(true);
    expect(result.data.vin).toBe('1HGBH41JXMN109186');
    expect(result.stepsRun).toHaveLength(0);
  });
});

describe('enrichVehicleRecord all-steps-fail', () => {
  it('returns empty data and does not throw when all API steps fail', async () => {
    vi.resetModules();
    vi.mock('../src/utils/vehicleEnrichment/client', () => ({
      plateToVin: vi.fn().mockRejectedValue(new Error('network')),
      decodeVin: vi.fn().mockRejectedValue(new Error('network')),
      decodePlate: vi.fn().mockRejectedValue(new Error('network')),
    }));

    const { enrichVehicleRecord } = await import('../src/utils/vehicleEnrichment/enrichChain');

    const mockDb = {
      prepare: vi.fn().mockReturnThis(),
      bind: vi.fn().mockReturnThis(),
      // Cache miss
      first: vi.fn()
        .mockResolvedValueOnce(null)   // cache lookup
        .mockResolvedValueOnce({ id: 5, plate_number: 'XYZ999', state: 'UT', vin: null }), // vehicles_records
      run: vi.fn().mockResolvedValue({ meta: { last_row_id: 5 } }),
      all: vi.fn().mockResolvedValue({ results: [] }),
    } as unknown as D1Database;

    const mockEnv = {
      KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
      PLATE_TO_VIN_API_KEY: 'k', VIN_DECODER_API_KEY: 'k', PLATE_DECODER_API_KEY: 'k',
    };

    const result = await enrichVehicleRecord('XYZ999', 'UT', mockDb, mockEnv as never);
    expect(result.fromCache).toBe(false);
    expect(Object.keys(result.stepErrors).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
npx vitest run tests/vehicleEnrichment.test.ts
```

Expected: FAIL — `Cannot find module '../src/utils/vehicleEnrichment/enrichChain'`

- [ ] **Step 3: Create enrichChain.ts**

Create `src/utils/vehicleEnrichment/enrichChain.ts`:

```ts
// src/utils/vehicleEnrichment/enrichChain.ts
import { log } from '../logger';
import { queryFirst, execute } from '../db';
import { upsertVehicleFromCarxe } from '../carxe/vehicleRecords';
import { plateToVin, decodeVin, decodePlate } from './client';
import {
  checkAndReservePlateToVin,
  checkAndReserveVinDecoder,
  checkAndReservePlateDecoder,
} from './rateLimit';
import type { EnrichmentResult, VehicleEnrichData } from './types';

export function buildPlateKey(plate: string, state: string): string {
  return `${plate.trim().toUpperCase()}|${state.trim().toUpperCase()}`;
}

export interface EnrichEnv {
  KV: KVNamespace;
  PLATE_TO_VIN_API_KEY?: string;
  VIN_DECODER_API_KEY?: string;
  PLATE_DECODER_API_KEY?: string;
  [key: string]: unknown;
}

export interface EnrichOptions {
  force?: boolean;
}

export async function enrichVehicleRecord(
  plate: string,
  state: string,
  db: D1Database,
  env: EnrichEnv,
  _ctx?: ExecutionContext,
  opts: EnrichOptions = {},
): Promise<EnrichmentResult> {
  const plateKey = buildPlateKey(plate, state);

  // 1. Cache check
  if (!opts.force) {
    const cached = await queryFirst<{
      id: number; plate_number: string; state: string | null;
      vin: string | null; make: string | null; model: string | null;
      year: number | null; trim: string | null; color: string | null;
      vehicle_type: string | null;
    }>(
      db,
      'SELECT id, plate_number, state, vin, make, model, year, trim, color, vehicle_type FROM vehicle_enrichment_cache WHERE plate_key = ?',
      plateKey,
    );
    if (cached) {
      // Resolve the vehicleId from vehicles_records
      const vRow = await queryFirst<{ id: number }>(
        db,
        "SELECT id FROM vehicles_records WHERE UPPER(TRIM(plate_number)) = ? LIMIT 1",
        plate.trim().toUpperCase(),
      );
      return {
        vehicleId: vRow?.id ?? 0,
        fromCache: true,
        data: {
          vin: cached.vin, make: cached.make, model: cached.model,
          year: cached.year, trim: cached.trim, color: cached.color,
          vehicle_type: cached.vehicle_type,
        },
        stepsRun: [],
        stepErrors: {},
      };
    }
  }

  const stepsRun: EnrichmentResult['stepsRun'] = [];
  const stepErrors: Record<string, string> = {};
  const data: VehicleEnrichData = {};
  const now = Date.now();

  // 2. Step 1: Plate → VIN
  let resolvedVin: string | null = null;
  const p2vKey = env.PLATE_TO_VIN_API_KEY ?? '';
  if (p2vKey) {
    const budget = await checkAndReservePlateToVin(env.KV, now);
    if (budget.allowed) {
      try {
        const r = await plateToVin(plate, state, p2vKey);
        if (r.vin) { resolvedVin = r.vin; data.vin = r.vin; }
        stepsRun.push('plateToVin');
      } catch (err) {
        const msg = (err as Error).message;
        stepErrors['plateToVin'] = msg;
        log.warn('vehicle-enrichment plateToVin failed', { plate, state }, err as Error);
      }
    } else {
      stepErrors['plateToVin'] = `rate_limit:${budget.reason}`;
      log.warn('vehicle-enrichment plateToVin rate limited', { plate, reason: budget.reason });
    }
  }

  // 3. Step 2: VIN → specs (only if we have a VIN)
  const vinKey = env.VIN_DECODER_API_KEY ?? '';
  if (resolvedVin && vinKey) {
    const budget = await checkAndReserveVinDecoder(env.KV, now);
    if (budget.allowed) {
      try {
        const r = await decodeVin(resolvedVin, vinKey);
        Object.assign(data, r);
        stepsRun.push('decodeVin');
      } catch (err) {
        stepErrors['decodeVin'] = (err as Error).message;
        log.warn('vehicle-enrichment decodeVin failed', { vin: resolvedVin }, err as Error);
      }
    } else {
      stepErrors['decodeVin'] = `rate_limit:${budget.reason}`;
    }
  }

  // 4. Step 3: Plate decoder fallback (when we still lack make/model)
  const pdKey = env.PLATE_DECODER_API_KEY ?? '';
  if (!data.make && pdKey) {
    const budget = await checkAndReservePlateDecoder(env.KV, now);
    if (budget.allowed) {
      try {
        const r = await decodePlate(plate, state, pdKey);
        if (!data.make) data.make = r.make;
        if (!data.model) data.model = r.model;
        if (!data.year) data.year = r.year;
        if (!data.vehicle_type) data.vehicle_type = r.vehicle_type;
        stepsRun.push('decodePlate');
      } catch (err) {
        stepErrors['decodePlate'] = (err as Error).message;
        log.warn('vehicle-enrichment decodePlate failed', { plate }, err as Error);
      }
    } else {
      stepErrors['decodePlate'] = `rate_limit:${budget.reason}`;
    }
  }

  // 5. Write to vehicles_records via the canonical seam
  const { vehicleId } = await upsertVehicleFromCarxe(
    db,
    { plate, state },
    { vin: data.vin, make: data.make, model: data.model, year: data.year,
      trim: data.trim, color: data.color, body_style: null },
    'vehicle-enrichment-api',
  );

  // 6. Upsert cache row
  const rawFields = {
    raw_plate_to_vin: stepsRun.includes('plateToVin') ? JSON.stringify({ vin: resolvedVin }) : null,
    raw_vin_decoder: stepsRun.includes('decodeVin') ? JSON.stringify(data) : null,
    raw_plate_decoder: stepsRun.includes('decodePlate') ? JSON.stringify(data) : null,
  };
  await execute(
    db,
    `INSERT INTO vehicle_enrichment_cache
       (plate_key, plate_number, state, vin, make, model, year, trim, color, vehicle_type,
        raw_plate_to_vin, raw_vin_decoder, raw_plate_decoder, enriched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(plate_key) DO UPDATE SET
       vin=excluded.vin, make=excluded.make, model=excluded.model, year=excluded.year,
       trim=excluded.trim, color=excluded.color, vehicle_type=excluded.vehicle_type,
       raw_plate_to_vin=excluded.raw_plate_to_vin, raw_vin_decoder=excluded.raw_vin_decoder,
       raw_plate_decoder=excluded.raw_plate_decoder, enriched_at=excluded.enriched_at`,
    plateKey, plate.trim().toUpperCase(), state.trim().toUpperCase(),
    data.vin ?? null, data.make ?? null, data.model ?? null, data.year ?? null,
    data.trim ?? null, data.color ?? null, data.vehicle_type ?? null,
    rawFields.raw_plate_to_vin, rawFields.raw_vin_decoder, rawFields.raw_plate_decoder,
  );

  return { vehicleId, fromCache: false, data, stepsRun, stepErrors };
}
```

- [ ] **Step 4: Run all enrichment tests**

```bash
npx vitest run tests/vehicleEnrichment.test.ts
```

Expected: PASS (all tests)

- [ ] **Step 5: Run full Worker suite**

```bash
npx vitest run
```

Expected: all previously-passing tests still PASS

- [ ] **Step 6: Commit**

```bash
git add src/utils/vehicleEnrichment/enrichChain.ts tests/vehicleEnrichment.test.ts
git commit -m "feat(vehicle-enrichment): add enrichVehicleRecord chain orchestrator"
```

---

## Task 6: Bindings + Route

**Files:**
- Modify: `src/types.ts`
- Create: `src/routes/vehicleEnrichment.ts`
- Modify: `src/routesConfig.ts`

**Interfaces:**
- Consumes: `enrichVehicleRecord` from `../utils/vehicleEnrichment/enrichChain`
- Produces: Hono route at `/api/vehicle-enrichment` with `POST /enrich/:vehicleId`, `GET /cache/:plate`, `GET /health`

- [ ] **Step 1: Add API key bindings to `src/types.ts`**

Open `src/types.ts`. After the existing `PLATE_DECODER_API_KEY` entry (or after `LEGAL_DATA_HUNTER_API_KEY` if those are the most recent optional string keys), add:

```ts
  PLATE_TO_VIN_API_KEY?: string;
  VIN_DECODER_API_KEY?: string;
  PLATE_DECODER_API_KEY?: string;
```

- [ ] **Step 2: Create the route**

Create `src/routes/vehicleEnrichment.ts`:

```ts
// src/routes/vehicleEnrichment.ts
import { Hono } from 'hono';
import type { Env } from '../types';
import { enrichVehicleRecord } from '../utils/vehicleEnrichment/enrichChain';
import { queryFirst } from '../utils/db';
import { log } from '../utils/logger';
import { logErrorToDb } from '../utils/logger';

const app = new Hono<Env>();

app.get('/health', async (c) => {
  return c.json({
    ok: true,
    apis: {
      plateToVin: !!c.env.PLATE_TO_VIN_API_KEY,
      vinDecoder: !!c.env.VIN_DECODER_API_KEY,
      plateDecoder: !!c.env.PLATE_DECODER_API_KEY,
    },
  });
});

app.get('/cache/:plate', async (c) => {
  const plate = c.req.param('plate').trim().toUpperCase();
  const row = await queryFirst<{
    plate_number: string; state: string | null; vin: string | null;
    make: string | null; model: string | null; year: number | null;
    trim: string | null; color: string | null; vehicle_type: string | null;
    enriched_at: string;
  }>(
    c.env.DB,
    'SELECT plate_number, state, vin, make, model, year, trim, color, vehicle_type, enriched_at FROM vehicle_enrichment_cache WHERE plate_key = ?',
    `${plate}|`,
  );
  if (!row) return c.json({ ok: false, code: 'not_found' }, 404);
  return c.json({ ok: true, cached: row });
});

app.post('/enrich/:vehicleId', async (c) => {
  const vehicleId = Number(c.req.param('vehicleId'));
  if (!vehicleId) return c.json({ ok: false, code: 'invalid_id' }, 400);

  const allUnset = !c.env.PLATE_TO_VIN_API_KEY && !c.env.VIN_DECODER_API_KEY && !c.env.PLATE_DECODER_API_KEY;
  if (allUnset) {
    return c.json({ ok: false, code: 'not_configured', missing: ['PLATE_TO_VIN_API_KEY', 'VIN_DECODER_API_KEY', 'PLATE_DECODER_API_KEY'] });
  }

  const vehicle = await queryFirst<{ plate_number: string; state: string | null }>(
    c.env.DB,
    'SELECT plate_number, state FROM vehicles_records WHERE id = ?',
    vehicleId,
  );
  if (!vehicle?.plate_number) {
    return c.json({ ok: false, code: 'vehicle_not_found' }, 404);
  }

  const force = c.req.query('force') === 'true';
  try {
    const result = await enrichVehicleRecord(
      vehicle.plate_number,
      vehicle.state ?? '',
      c.env.DB,
      c.env,
      c.executionCtx,
      { force },
    );
    return c.json({ ok: true, enriched: result, fromCache: result.fromCache });
  } catch (err) {
    log.error('vehicle-enrichment route error', { vehicleId }, err as Error);
    logErrorToDb(c.env.DB, {
      severity: 'error', category: 'enrichment',
      message: (err as Error).message,
      details: { vehicleId },
      traceId: c.get('traceId'),
      source: '/api/vehicle-enrichment',
      statusCode: 500,
    }, c.executionCtx);
    return c.json({ ok: false, code: 'enrichment_failed', error: (err as Error).message }, 500);
  }
});

export default app;
```

- [ ] **Step 3: Mount the route in `src/routesConfig.ts`**

Find the import block near `carxe` and add:

```ts
import vehicleEnrichment from './routes/vehicleEnrichment';
```

Then find the block where `carxe` is mounted (look for `{ prefix: '/api/carxe', ...`) and add immediately after:

```ts
  { prefix: '/api/vehicle-enrichment', router: vehicleEnrichment, auth: 'required',
    excludeRoles: ['client_viewer'] },
```

- [ ] **Step 4: Run worker typecheck**

```bash
npm run typecheck
```

Expected: 0 errors

- [ ] **Step 5: Run full suite**

```bash
npx vitest run
```

Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/routes/vehicleEnrichment.ts src/routesConfig.ts
git commit -m "feat(vehicle-enrichment): add route POST /enrich, GET /cache, GET /health"
```

---

## Task 7: Auto-Trigger in ALPR Route

**Files:**
- Modify: `src/routes/alpr.ts`

**Interfaces:**
- Consumes: `enrichVehicleRecord` from `../utils/vehicleEnrichment/enrichChain`
- The auto-trigger fires only when `upsertVehicleFromCarxe` returns `created: true` AND the row has no VIN

- [ ] **Step 1: Find the new-plate insertion point in alpr.ts**

```bash
grep -n "upsertVehicleFromCarxe\|created.*true\|waitUntil" src/routes/alpr.ts | head -20
```

Note the line numbers where `upsertVehicleFromCarxe` is called and where `created` is checked.

- [ ] **Step 2: Add the import at the top of alpr.ts**

Find the block of utility imports at the top of `src/routes/alpr.ts` and add:

```ts
import { enrichVehicleRecord } from '../utils/vehicleEnrichment/enrichChain';
```

- [ ] **Step 3: Add the waitUntil trigger after each upsertVehicleFromCarxe call that can return created:true**

After each call that looks like:
```ts
const { vehicleId, created } = await upsertVehicleFromCarxe(...);
```

Add immediately after (within the same scope where `c.executionCtx` is available):

```ts
if (created) {
  c.executionCtx.waitUntil(
    enrichVehicleRecord(plateString, stateString, c.env.DB, c.env, c.executionCtx)
      .catch((err: Error) => log.warn('auto-enrich failed', { plate: plateString }, err)),
  );
}
```

Where `plateString` and `stateString` are the plate and state values already in scope at that call site. Check the existing variable names — they vary per call site. Use `''` for state if it's not in scope.

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: 0 errors

- [ ] **Step 5: Run full suite**

```bash
npx vitest run
```

Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/routes/alpr.ts
git commit -m "feat(vehicle-enrichment): auto-trigger enrichment via waitUntil on new plate capture"
```

---

## Task 8: UI — Enrich Button in VehicleDossier

**Files:**
- Modify: `client/src/components/VehicleDossier.tsx`

**Interfaces:**
- Consumes: `apiFetch` from `../hooks/useApi`, `IconButton` from `./IconButton`
- The button POSTs to `/api/vehicle-enrichment/enrich/:vehicleId` — but `VehicleDossier` is keyed by `plate`, not `vehicleId`. Resolve `vehicleId` from the dossier's existing data fetch response, or add a separate lookup.

- [ ] **Step 1: Check what `DossierResponse` already contains**

```bash
grep -n "vehicleId\|vehicle_id\|DossierResponse\|interface Dossier" client/src/components/VehicleDossier.tsx | head -20
```

Note whether `vehicleId` / `vehicle_id` is already in the response. If not, we'll pass `?plate=` to the enrich endpoint instead and have the route do the lookup (it already queries `vehicles_records WHERE plate_number = ?` internally via `queryFirst`).

- [ ] **Step 2: Add enrichment state and handler to VehicleDossier**

Find the existing `useState` declarations at the top of the `VehicleDossier` component and add:

```tsx
const [enriching, setEnriching] = useState(false);
const [enrichMsg, setEnrichMsg] = useState<string | null>(null);
```

Then add the handler function inside the component (before the `return`):

```tsx
const handleEnrich = async () => {
  if (!data) return;
  // Use the first package's vehicle record id if available, otherwise
  // fall back to a plate-based lookup via the cache endpoint
  const vehicleId = (data as { vehicleId?: number }).vehicleId;
  if (!vehicleId) {
    setEnrichMsg('No vehicle record ID available');
    return;
  }
  setEnriching(true);
  setEnrichMsg(null);
  try {
    await apiFetch(`/vehicle-enrichment/enrich/${vehicleId}`, { method: 'POST' });
    setEnrichMsg('Enriched');
    // Refetch the dossier to reflect updated fields
    setLoading(true);
    apiFetch<DossierResponse>(`/alpr/vehicle/${encodeURIComponent(plate)}/dossier`)
      .then((r) => setData(r))
      .catch((e) => setErr(e?.message || 'Failed to reload'))
      .finally(() => setLoading(false));
  } catch {
    setEnrichMsg('Enrichment failed');
  } finally {
    setEnriching(false);
  }
};
```

- [ ] **Step 3: Add the Enrich button to the dossier header**

Find the header section containing `aria-label="Close dossier"` and add the enrich button next to the close button:

```tsx
<IconButton
  aria-label="Re-enrich vehicle data"
  onClick={handleEnrich}
  disabled={enriching}
  className="text-[#888] hover:text-rmpg-100 mr-1">
  {enriching
    ? <Loader2 className="w-4 h-4 animate-spin" />
    : <RefreshCw className="w-4 h-4" />}
</IconButton>
```

Add `Loader2` and `RefreshCw` to the existing Lucide imports at the top of the file.

If `enrichMsg` is set, show it as a small inline status line below the header:

```tsx
{enrichMsg && (
  <div className="px-3 py-1 text-[10px] text-rmpg-400 border-b border-border-default">
    {enrichMsg}
  </div>
)}
```

- [ ] **Step 4: Run client typecheck**

```bash
cd client && npx tsc --noEmit
```

Expected: 0 errors from new code

- [ ] **Step 5: Run client tests**

```bash
cd client && npx vitest run
```

Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add client/src/components/VehicleDossier.tsx
git commit -m "feat(vehicle-enrichment): add Enrich button to VehicleDossier"
```

---

## Task 9: Final Verification & Post-Deploy Prep

**Files:**
- No new files

- [ ] **Step 1: Run full Worker suite**

```bash
npx vitest run
```

Expected: all tests PASS

- [ ] **Step 2: Run Worker typecheck**

```bash
npm run typecheck
```

Expected: 0 errors

- [ ] **Step 3: Run client typecheck**

```bash
cd client && npx tsc --noEmit
```

Expected: 0 errors

- [ ] **Step 4: Run client tests**

```bash
cd client && npx vitest run
```

Expected: all tests PASS

- [ ] **Step 5: Apply migration to live D1**

```bash
scripts/apply-migration.sh 0263_vehicle_enrichment_cache.sql
```

Expected: migration applied + tracked in `d1_migrations`

- [ ] **Step 6: Verify table on live D1**

```bash
npx wrangler d1 execute rmpg-flex --remote --command "SELECT name FROM sqlite_master WHERE name='vehicle_enrichment_cache'"
```

Expected: one row

- [ ] **Step 7: Set production secrets**

```bash
npx wrangler secret put PLATE_TO_VIN_API_KEY
npx wrangler secret put VIN_DECODER_API_KEY
npx wrangler secret put PLATE_DECODER_API_KEY
```

(Enter each key from your RapidAPI dashboard when prompted.)

- [ ] **Step 8: Open PR**

```bash
gh pr create -R rmpgutah/rmpg-flex \
  --title "feat(vehicle-enrichment): Wave 1 — plate→VIN→decode enrichment chain" \
  --body "$(cat <<'EOF'
## Summary
- Three RapidAPI vehicle data APIs integrated as a sequential enrichment chain
- Auto-fires via `waitUntil` on new ALPR plate captures (no response delay)
- Manual re-enrich button added to VehicleDossier
- Permanent D1 cache; KV rate limiters protect all three free tiers
- All writes through existing `upsertVehicleFromCarxe` seam (fill-only, never overwrites officer data)

## Post-merge
1. `scripts/apply-migration.sh 0263_vehicle_enrichment_cache.sql`
2. `npx wrangler secret put PLATE_TO_VIN_API_KEY` (+ VIN_DECODER + PLATE_DECODER)
3. `GET /api/vehicle-enrichment/health` — confirm at least one API shows `true`
4. Trigger manual enrich on any vehicle in the Dossier to verify end-to-end

## Test plan
- [ ] `npx vitest run` — all tests pass
- [ ] `npm run typecheck` — 0 errors
- [ ] `cd client && npx tsc --noEmit` — 0 errors
- [ ] `cd client && npx vitest run` — all tests pass

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Notes

**Spec coverage check:**
- ✅ Three API clients (Task 4)
- ✅ Chain orchestrator with cache check (Task 5)
- ✅ Permanent cache table (Task 1)
- ✅ Rate limiters per API (Task 3)
- ✅ `POST /enrich/:vehicleId`, `GET /cache/:plate`, `GET /health` (Task 6)
- ✅ Auto-trigger via `waitUntil` (Task 7)
- ✅ Fill-only write through `upsertVehicleFromCarxe` (Task 5)
- ✅ `VehicleDossier` Enrich button (Task 8)
- ✅ `not_configured` pattern (Task 6)
- ✅ Typed errors (Task 2)
- ✅ `logErrorToDb` on failures (Task 6)
- ✅ Post-deploy checklist (Task 9)

**Type consistency:** `VehicleEnrichData` defined in Task 2, consumed in Tasks 4, 5, 6 — names match throughout. `EnrichmentResult` defined in Task 2, returned by `enrichVehicleRecord` in Task 5, consumed by route in Task 6.
