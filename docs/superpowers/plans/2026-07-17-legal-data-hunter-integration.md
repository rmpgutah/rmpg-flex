# Legal Data Hunter Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an officer manually validate a warrant's charge text against the Legal Data Hunter (LDH) REST API and see whether it resolves to a real statute/citation, with zero impact on warrant ingest/create/serve flows.

**Architecture:** A Worker-safe LDH HTTP client (`src/utils/legalDataHunter/`) mirrors the existing Fleet.io/Roboflow client pattern (typed errors, timeout+retry, no D1 access). A new route `/api/legal-data-hunter` short-circuits to the local `utah_statutes` table when possible, otherwise checks a D1 cache table, otherwise calls LDH under a KV-backed rate budget (18/day, 8/min soft caps under LDH's 20/day, 10/min limits) and caches the result. The client adds a "Validate Charge" button to the warrant detail view in `WarrantsPage.tsx` that calls this route on click — no background jobs, no cron, no auto-triggers.

**Tech Stack:** Hono route on Cloudflare Workers, D1 (`legal_charge_validations` table), KV (`c.env.KV`) for rate-limit counters, React + `apiFetch` on the client.

## Global Constraints

- Base URL: `https://legaldatahunter.com`. Auth: `Authorization: Bearer <LEGAL_DATA_HUNTER_API_KEY>`.
- Endpoints used: `POST /v1/resolve` (`{ reference, hint_country?, hint_type? }`) and `POST /v1/search` (`{ q, namespace: "legislation", top_k, country? }`).
- Rate limits (LDH-side): 10 req/min, 20 req/day, 600/period. This integration must never exceed a self-imposed 8/min and 18/day budget.
- Unset `LEGAL_DATA_HUNTER_API_KEY` → route returns `200 { ok: false, code: 'not_configured' }`, never 503 (see `feedback-503-not-configured-anti-pattern` memory).
- `client_viewer` role is excluded from `/api/legal-data-hunter/*` (matches `warrants.ts`'s existing role gate — this touches sworn-side charge data).
- No new columns on the `warrants` table (100-column D1 cap — see CLAUDE.md gotcha #13). All warrant linkage goes through `legal_charge_validations.warrant_id`.
- D1 `.prepare().bind().all()/.first()/.run()` calls must always be `await`ed.
- Migration file: next free integer prefix is `0191` (highest existing is `0190_accreditations.sql`).

---

### Task 1: LDH typed errors + HTTP client (pure, unit-tested)

**Files:**
- Create: `src/utils/legalDataHunter/errors.ts`
- Create: `src/utils/legalDataHunter/client.ts`
- Test: `tests/legalDataHunterClient.test.ts`

**Interfaces:**
- Produces: `LdhConfigError`, `LdhTimeoutError`, `LdhHttpError`, `LdhRateLimitError` (all extend `LdhError`, exported from `./errors`).
- Produces: `configFromEnv(env: Record<string, unknown>): LdhConfig` — throws `LdhConfigError` if `LEGAL_DATA_HUNTER_API_KEY` is unset/blank.
- Produces: `resolveCitation(input: { config: LdhConfig; reference: string; hintCountry?: string; hintType?: 'case_law' | 'legislation' | 'doctrine'; fetchImpl?: typeof fetch }): Promise<LdhResolveResponse>`
- Produces: `searchLegislation(input: { config: LdhConfig; query: string; country?: string[]; topK?: number; fetchImpl?: typeof fetch }): Promise<LdhSearchResponse>`
- Produces types: `LdhConfig { apiKey: string }`, `LdhResolveResponse { reference: string; resolved: boolean; match_type?: string; documents: LdhDocument[]; elapsed_ms: number }`, `LdhSearchResponse { query: string; hits: LdhSearchHit[]; total_hits: number; namespace: string; elapsed_ms: number }`, `LdhDocument { source: string; source_id: string; title: string; text?: string; data_type: string }`, `LdhSearchHit { source: string; source_id: string; score: number; title: string; snippet: string; url?: string; country?: string; jurisdiction?: string; date?: string }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/legalDataHunterClient.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import {
  configFromEnv,
  resolveCitation,
  searchLegislation,
} from '../src/utils/legalDataHunter/client';
import {
  LdhConfigError,
  LdhTimeoutError,
  LdhHttpError,
  LdhRateLimitError,
} from '../src/utils/legalDataHunter/errors';

describe('configFromEnv', () => {
  it('throws LdhConfigError when the key is missing', () => {
    expect(() => configFromEnv({})).toThrow(LdhConfigError);
  });

  it('throws LdhConfigError when the key is blank', () => {
    expect(() => configFromEnv({ LEGAL_DATA_HUNTER_API_KEY: '   ' })).toThrow(LdhConfigError);
  });

  it('returns a config with the trimmed key', () => {
    const cfg = configFromEnv({ LEGAL_DATA_HUNTER_API_KEY: ' sk-test-123 ' });
    expect(cfg.apiKey).toBe('sk-test-123');
  });
});

describe('resolveCitation', () => {
  const config = { apiKey: 'sk-test-123' };

  it('posts to /v1/resolve with the bearer header and returns the parsed body', async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe('https://legaldatahunter.com/v1/resolve');
      expect(init?.method).toBe('POST');
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe('Bearer sk-test-123');
      expect(headers.get('content-type')).toBe('application/json');
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({ reference: 'Utah Code 76-6-404', hint_country: 'US', hint_type: 'legislation' });
      return new Response(JSON.stringify({
        reference: 'Utah Code 76-6-404',
        resolved: true,
        match_type: 'exact',
        documents: [{ source: 'US/Utah', source_id: '76-6-404', title: 'Theft', data_type: 'legislation' }],
        elapsed_ms: 42,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const result = await resolveCitation({
      config,
      reference: 'Utah Code 76-6-404',
      hintCountry: 'US',
      hintType: 'legislation',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.resolved).toBe(true);
    expect(result.documents[0].title).toBe('Theft');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('throws LdhHttpError on a non-2xx, non-429 response', async () => {
    const fetchImpl = vi.fn(async () => new Response('bad request', { status: 400 }));
    await expect(resolveCitation({
      config,
      reference: 'garbage',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })).rejects.toBeInstanceOf(LdhHttpError);
  });

  it('throws LdhRateLimitError on 429 with Retry-After', async () => {
    const fetchImpl = vi.fn(async () => new Response('rate limited', {
      status: 429,
      headers: { 'retry-after': '30' },
    }));
    await expect(resolveCitation({
      config,
      reference: 'Utah Code 76-6-404',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })).rejects.toBeInstanceOf(LdhRateLimitError);
  });

  it('throws LdhTimeoutError when fetch never resolves before the timeout', async () => {
    const fetchImpl = vi.fn(() => new Promise<Response>(() => { /* never resolves */ }));
    await expect(resolveCitation({
      config,
      reference: 'Utah Code 76-6-404',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 10,
    })).rejects.toBeInstanceOf(LdhTimeoutError);
  });
});

describe('searchLegislation', () => {
  const config = { apiKey: 'sk-test-123' };

  it('posts to /v1/search with namespace=legislation and returns hits', async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe('https://legaldatahunter.com/v1/search');
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({ q: 'theft third degree felony', namespace: 'legislation', top_k: 3, country: ['US'] });
      return new Response(JSON.stringify({
        query: 'theft third degree felony',
        hits: [{ source: 'US/Utah', source_id: '76-6-404', score: 0.91, title: 'Theft', snippet: '...', url: 'https://le.utah.gov/xcode/Title76/Chapter6/76-6-S404.html', country: 'US' }],
        total_hits: 1,
        namespace: 'legislation',
        elapsed_ms: 88,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const result = await searchLegislation({
      config,
      query: 'theft third degree felony',
      country: ['US'],
      topK: 3,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.total_hits).toBe(1);
    expect(result.hits[0].title).toBe('Theft');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/legalDataHunterClient.test.ts`
Expected: FAIL — `Cannot find module '../src/utils/legalDataHunter/client'`

- [ ] **Step 3: Write `src/utils/legalDataHunter/errors.ts`**

```typescript
// ============================================================
// RMPG Flex — Legal Data Hunter integration: typed errors
// ============================================================
// Mirrors src/utils/fleetio/errors.ts so the codebase keeps one
// consistent integration-error idiom across external HTTP adapters.
// ============================================================

export class LdhError extends Error {
  readonly status?: number;
  readonly detail?: unknown;
  constructor(message: string, opts?: { status?: number; detail?: unknown }) {
    super(message);
    this.name = 'LdhError';
    this.status = opts?.status;
    this.detail = opts?.detail;
  }
}

/** Missing/blank LEGAL_DATA_HUNTER_API_KEY. Not retried. */
export class LdhConfigError extends LdhError {
  constructor(message: string, detail?: unknown) {
    super(message, { detail });
    this.name = 'LdhConfigError';
  }
}

/** Request exceeded the timeout. */
export class LdhTimeoutError extends LdhError {
  constructor(message: string) {
    super(message);
    this.name = 'LdhTimeoutError';
  }
}

/** Non-2xx, non-429 response. `status` carries the HTTP code. */
export class LdhHttpError extends LdhError {
  constructor(message: string, status: number, detail?: unknown) {
    super(message, { status, detail });
    this.name = 'LdhHttpError';
  }
}

/** LDH returned 429. `retryAfterSeconds` reflects the Retry-After header. */
export class LdhRateLimitError extends LdhError {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number, detail?: unknown) {
    super(`Legal Data Hunter rate limit hit; retry after ${retryAfterSeconds}s`, { status: 429, detail });
    this.name = 'LdhRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
```

- [ ] **Step 4: Write `src/utils/legalDataHunter/client.ts`**

```typescript
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
}

export function configFromEnv(env: Record<string, unknown>): LdhConfig {
  const raw = env.LEGAL_DATA_HUNTER_API_KEY;
  const apiKey = typeof raw === 'string' ? raw.trim() : '';
  if (!apiKey) {
    throw new LdhConfigError('LEGAL_DATA_HUNTER_API_KEY is not configured');
  }
  return { apiKey };
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

async function postJson<T>(input: {
  config: LdhConfig;
  path: string;
  body: Record<string, unknown>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<T> {
  const { config, path, body, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch } = input;
  const url = `${LDH_API_BASE}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') {
      throw new LdhTimeoutError(`Legal Data Hunter request to ${path} timed out after ${timeoutMs}ms`);
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
    const detail = await response.text().catch(() => undefined);
    throw new LdhHttpError(`Legal Data Hunter ${path} returned ${response.status}`, response.status, detail);
  }

  return (await response.json()) as T;
}

export async function resolveCitation(input: {
  config: LdhConfig;
  reference: string;
  hintCountry?: string;
  hintType?: 'case_law' | 'legislation' | 'doctrine';
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<LdhResolveResponse> {
  const { config, reference, hintCountry, hintType, timeoutMs, fetchImpl } = input;
  const body: Record<string, unknown> = { reference };
  if (hintCountry) body.hint_country = hintCountry;
  if (hintType) body.hint_type = hintType;
  return postJson<LdhResolveResponse>({ config, path: '/v1/resolve', body, timeoutMs, fetchImpl });
}

export async function searchLegislation(input: {
  config: LdhConfig;
  query: string;
  country?: string[];
  topK?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<LdhSearchResponse> {
  const { config, query, country, topK = 3, timeoutMs, fetchImpl } = input;
  const body: Record<string, unknown> = { q: query, namespace: 'legislation', top_k: topK };
  if (country?.length) body.country = country;
  return postJson<LdhSearchResponse>({ config, path: '/v1/search', body, timeoutMs, fetchImpl });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/legalDataHunterClient.test.ts`
Expected: PASS — all 8 tests green.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add src/utils/legalDataHunter/errors.ts src/utils/legalDataHunter/client.ts tests/legalDataHunterClient.test.ts
git commit -m "feat(legal-data-hunter): add typed HTTP client for resolve/search"
```

---

### Task 2: Migration — `legal_charge_validations` cache table

**Files:**
- Create: `migrations/0191_legal_data_hunter.sql`

**Interfaces:**
- Produces table `legal_charge_validations` with columns used by Task 3's route: `id, charge_text, charge_text_normalized, state, warrant_id, source, match_found, matched_title, matched_citation, matched_source_url, raw_response, created_at`. Unique on `(charge_text_normalized, state)`.

- [ ] **Step 1: Write the migration**

```sql
-- 0191_legal_data_hunter.sql
-- Legal Data Hunter integration: caches manual "Validate Charge" lookups so
-- re-clicking the same charge text never re-spends the LDH rate budget.
-- See docs/superpowers/specs/2026-07-17-legal-data-hunter-integration-design.md
--
-- No new columns on `warrants` (100-column D1 cap, CLAUDE.md gotcha #13) —
-- linkage is via warrant_id on this table instead.

CREATE TABLE IF NOT EXISTS legal_charge_validations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  charge_text TEXT NOT NULL,
  charge_text_normalized TEXT NOT NULL,
  state TEXT,
  warrant_id INTEGER,
  source TEXT NOT NULL,           -- 'local_statute' | 'ldh_resolve' | 'ldh_search'
  match_found INTEGER NOT NULL,   -- 0/1
  matched_title TEXT,
  matched_citation TEXT,
  matched_source_url TEXT,
  raw_response TEXT,              -- JSON, for debugging/audit
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(charge_text_normalized, state)
);

CREATE INDEX IF NOT EXISTS idx_lcv_warrant ON legal_charge_validations(warrant_id);
CREATE INDEX IF NOT EXISTS idx_lcv_created ON legal_charge_validations(created_at);
```

- [ ] **Step 2: Apply locally**

Run: `npm run migrate:local`
Expected: migration `0191_legal_data_hunter.sql` applies without error.

- [ ] **Step 3: Verify the table exists**

Run: `npx wrangler d1 execute rmpg-flex --local --command "SELECT name FROM sqlite_master WHERE type='table' AND name='legal_charge_validations'"`
Expected: one row returned.

- [ ] **Step 4: Commit**

```bash
git add migrations/0191_legal_data_hunter.sql
git commit -m "feat(legal-data-hunter): add legal_charge_validations cache table"
```

---

### Task 3: Rate-limit budget helper (KV-backed, pure logic unit-tested)

**Files:**
- Create: `src/utils/legalDataHunter/rateLimit.ts`
- Test: `tests/legalDataHunterRateLimit.test.ts`

**Interfaces:**
- Consumes: a minimal KV-shaped interface so tests can use an in-memory fake (`{ get(key: string): Promise<string | null>; put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void> }`).
- Produces: `checkAndReserveLdhCall(kv: LdhKvLike, nowMs: number): Promise<{ allowed: true } | { allowed: false; reason: 'daily_limit' | 'minute_limit' }>` — call this **before** making an LDH request; if it returns `allowed: true` it has already incremented both counters (reservation happens atomically from the caller's perspective, not truly atomic in KV, but acceptable for a soft buffer per the spec).
- Constants exported: `LDH_DAILY_BUDGET = 18`, `LDH_MINUTE_BUDGET = 8`.

- [ ] **Step 1: Write the failing tests**

Create `tests/legalDataHunterRateLimit.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { checkAndReserveLdhCall, LDH_DAILY_BUDGET, LDH_MINUTE_BUDGET } from '../src/utils/legalDataHunter/rateLimit';

function makeFakeKv() {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    _store: store,
  };
}

describe('checkAndReserveLdhCall', () => {
  it('allows a call when under both budgets', async () => {
    const kv = makeFakeKv();
    const result = await checkAndReserveLdhCall(kv, Date.parse('2026-07-17T12:00:00Z'));
    expect(result).toEqual({ allowed: true });
  });

  it('blocks once the per-minute budget is exhausted', async () => {
    const kv = makeFakeKv();
    const now = Date.parse('2026-07-17T12:00:00Z');
    for (let i = 0; i < LDH_MINUTE_BUDGET; i++) {
      const r = await checkAndReserveLdhCall(kv, now + i);
      expect(r.allowed).toBe(true);
    }
    const blocked = await checkAndReserveLdhCall(kv, now + LDH_MINUTE_BUDGET);
    expect(blocked).toEqual({ allowed: false, reason: 'minute_limit' });
  });

  it('blocks once the daily budget is exhausted even across different minutes', async () => {
    const kv = makeFakeKv();
    const dayStart = Date.parse('2026-07-17T00:00:00Z');
    let allowedCount = 0;
    for (let i = 0; i < LDH_DAILY_BUDGET + 5; i++) {
      // Spread calls one full minute apart so the per-minute budget never trips.
      const r = await checkAndReserveLdhCall(kv, dayStart + i * 60_000);
      if (r.allowed) allowedCount++;
      else expect(r.reason).toBe('daily_limit');
    }
    expect(allowedCount).toBe(LDH_DAILY_BUDGET);
  });

  it('resets the minute budget on the next minute window', async () => {
    const kv = makeFakeKv();
    const now = Date.parse('2026-07-17T12:00:00Z');
    for (let i = 0; i < LDH_MINUTE_BUDGET; i++) {
      await checkAndReserveLdhCall(kv, now);
    }
    const nextMinute = now + 60_000;
    const r = await checkAndReserveLdhCall(kv, nextMinute);
    expect(r).toEqual({ allowed: true });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/legalDataHunterRateLimit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/utils/legalDataHunter/rateLimit.ts`**

```typescript
// ============================================================
// RMPG Flex — Legal Data Hunter integration: rate-limit budget
// ============================================================
// LDH's own limits are 10 req/min, 20 req/day, 600/period. This
// enforces a self-imposed buffer (8/min, 18/day) using KV counters
// so a burst of "Validate Charge" clicks can never trip LDH's own
// limiter. Soft/best-effort: KV reads+writes below aren't atomic,
// but the buffer margin absorbs the rare race under this feature's
// low, human-click-driven call volume.
// ============================================================

export const LDH_DAILY_BUDGET = 18;
export const LDH_MINUTE_BUDGET = 8;

export interface LdhKvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

function dayKey(nowMs: number): string {
  const iso = new Date(nowMs).toISOString();
  return `legal_data_hunter:usage:day:${iso.slice(0, 10)}`; // YYYY-MM-DD
}

function minuteKey(nowMs: number): string {
  const flooredMinute = Math.floor(nowMs / 60_000) * 60_000;
  return `legal_data_hunter:usage:minute:${flooredMinute}`;
}

export async function checkAndReserveLdhCall(
  kv: LdhKvLike,
  nowMs: number,
): Promise<{ allowed: true } | { allowed: false; reason: 'daily_limit' | 'minute_limit' }> {
  const dKey = dayKey(nowMs);
  const mKey = minuteKey(nowMs);

  const dayCountRaw = await kv.get(dKey);
  const dayCount = dayCountRaw ? parseInt(dayCountRaw, 10) || 0 : 0;
  if (dayCount >= LDH_DAILY_BUDGET) {
    return { allowed: false, reason: 'daily_limit' };
  }

  const minuteCountRaw = await kv.get(mKey);
  const minuteCount = minuteCountRaw ? parseInt(minuteCountRaw, 10) || 0 : 0;
  if (minuteCount >= LDH_MINUTE_BUDGET) {
    return { allowed: false, reason: 'minute_limit' };
  }

  // TTLs: a day key outlives the day (25h buffer for clock skew), a minute
  // key outlives the minute (2m buffer).
  await kv.put(dKey, String(dayCount + 1), { expirationTtl: 25 * 60 * 60 });
  await kv.put(mKey, String(minuteCount + 1), { expirationTtl: 120 });

  return { allowed: true };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/legalDataHunterRateLimit.test.ts`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/utils/legalDataHunter/rateLimit.ts tests/legalDataHunterRateLimit.test.ts
git commit -m "feat(legal-data-hunter): add KV-backed rate-limit budget helper"
```

---

### Task 4: Route `/api/legal-data-hunter` (local-statute short-circuit → cache → LDH)

**Files:**
- Create: `src/routes/legalDataHunter.ts`
- Modify: `src/routesConfig.ts` (mount the route)
- Test: `test-workers/legalDataHunter.test.ts`

**Interfaces:**
- Consumes: `configFromEnv`, `resolveCitation`, `searchLegislation` from `../utils/legalDataHunter/client` (Task 1); `checkAndReserveLdhCall` from `../utils/legalDataHunter/rateLimit` (Task 3); `getDb, query, queryFirst, execute` from `../utils/db`; `requireRole` from `../middleware/auth` (used only for `GET /usage`, not `/validate` — any authed non-`client_viewer` user can validate).
- Produces (HTTP contract):
  - `POST /api/legal-data-hunter/validate` — body `{ charge: string; state?: string; warrant_id?: number }`. Responses:
    - `200 { ok: true, source: 'local_statute'|'ldh_resolve'|'ldh_search'|'cache', match_found: boolean, matched_title?: string, matched_citation?: string, matched_source_url?: string }`
    - `200 { ok: false, code: 'not_configured' }`
    - `200 { ok: false, code: 'rate_limited', reason: 'daily_limit'|'minute_limit' }`
    - `400 { ok: false, code: 'bad_request', error: string }` when `charge` is missing/blank.
  - `GET /api/legal-data-hunter/usage` — admin/manager only. `200 { ok: true, day_count: number, budget: number }`.

- [ ] **Step 1: Write the failing route test**

Create `test-workers/legalDataHunter.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';

describe('POST /api/legal-data-hunter/validate', () => {
  beforeEach(async () => {
    // Clean cache table between tests.
    await env.DB.prepare('DELETE FROM legal_charge_validations').run();
  });

  it('returns not_configured when LEGAL_DATA_HUNTER_API_KEY is unset', async () => {
    const res = await SELF.fetch('https://api.rmpgutah.us/api/legal-data-hunter/validate', {
      method: 'POST',
      headers: { authorization: `Bearer ${globalThis.__TEST_JWT__}`, 'content-type': 'application/json' },
      body: JSON.stringify({ charge: 'Assault by a Prisoner', state: 'NV' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: false, code: 'not_configured' });
  });

  it('returns bad_request when charge is missing', async () => {
    const res = await SELF.fetch('https://api.rmpgutah.us/api/legal-data-hunter/validate', {
      method: 'POST',
      headers: { authorization: `Bearer ${globalThis.__TEST_JWT__}`, 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'UT' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects client_viewer role', async () => {
    const res = await SELF.fetch('https://api.rmpgutah.us/api/legal-data-hunter/validate', {
      method: 'POST',
      headers: { authorization: `Bearer ${globalThis.__TEST_CLIENT_VIEWER_JWT__}`, 'content-type': 'application/json' },
      body: JSON.stringify({ charge: 'Theft', state: 'UT' }),
    });
    expect(res.status).toBe(403);
  });
});
```

Note: this test file follows the existing Miniflare pattern in `test-workers/health.test.ts` / `test-workers/auth.test.ts` (JWT test fixtures via `globalThis.__TEST_JWT__` etc. — reuse whatever fixture helper those files already set up; do not invent a new one).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/legalDataHunter.test.ts`
Expected: FAIL — route not mounted / 404.

- [ ] **Step 3: Write `src/routes/legalDataHunter.ts`**

```typescript
// ============================================================
// RMPG Flex — Legal Data Hunter integration routes
// ============================================================
// Mounted at /api/legal-data-hunter (auth: 'required'). Manual,
// officer-initiated charge validation only — never called from
// warrant ingest/create/update. See
// docs/superpowers/specs/2026-07-17-legal-data-hunter-integration-design.md
//
//   POST /validate   Any authed user except client_viewer. Resolves a
//                     warrant charge string against (in order): the local
//                     utah_statutes table, the legal_charge_validations
//                     cache, then the live Legal Data Hunter API under a
//                     rate-limit budget.
//   GET  /usage       admin/manager. Today's LDH call count vs budget.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { configFromEnv, resolveCitation, searchLegislation } from '../utils/legalDataHunter/client';
import { LdhConfigError, LdhError } from '../utils/legalDataHunter/errors';
import { checkAndReserveLdhCall, LDH_DAILY_BUDGET } from '../utils/legalDataHunter/rateLimit';
import { dbErrorResponse } from '../utils/dbErrors';
import { log } from '../utils/logger';

const legalDataHunter = new Hono<Env>();

legalDataHunter.use('*', async (c, next) => {
  const user = c.get('user') as { role: string } | undefined;
  if (user?.role === 'client_viewer') return c.json({ error: 'Forbidden' }, 403);
  await next();
});

function normalizeCharge(charge: string): string {
  return charge.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** A charge string that looks like it already embeds a citation
 *  (e.g. "Theft (76-6-404)" or "Utah Code 76-6-404") gets tried
 *  against /v1/resolve first — it's a cheaper, more precise match
 *  than a fuzzy /v1/search. */
function extractCitationLike(charge: string): string | null {
  const match = charge.match(/\b\d{1,4}[A-Za-z]?[-.]\d{1,4}(?:[-.]\d{1,4})?\b/);
  return match ? match[0] : null;
}

async function tryLocalStatute(db: ReturnType<typeof getDb>, charge: string, state?: string) {
  if (state && state.toUpperCase() !== 'UT' && state.toUpperCase() !== 'UTAH') return null;
  const q = charge.trim();
  if (q.length < 3) return null;
  const row = await queryFirst<{ citation: string; short_title: string; source_url: string | null }>(
    db,
    `SELECT citation, short_title, source_url FROM utah_statutes
     WHERE is_active = 1 AND (short_title LIKE ? OR description LIKE ?)
     ORDER BY LENGTH(short_title) ASC LIMIT 1`,
    `%${q}%`, `%${q}%`,
  );
  return row;
}

legalDataHunter.post('/validate', async (c) => {
  let payload: { charge?: string; state?: string; warrant_id?: number };
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ ok: false, code: 'bad_request', error: 'Invalid JSON body' }, 400);
  }
  const charge = (payload.charge || '').trim();
  if (!charge) {
    return c.json({ ok: false, code: 'bad_request', error: 'charge is required' }, 400);
  }
  const state = payload.state?.trim() || undefined;
  const warrantId = typeof payload.warrant_id === 'number' ? payload.warrant_id : undefined;
  const db = getDb(c.env);
  const normalized = normalizeCharge(charge);

  try {
    // 1. Local statute short-circuit (free, Utah-only).
    const local = await tryLocalStatute(db, charge, state);
    if (local) {
      await execute(db,
        `INSERT INTO legal_charge_validations
           (charge_text, charge_text_normalized, state, warrant_id, source, match_found, matched_title, matched_citation, matched_source_url, raw_response)
         VALUES (?, ?, ?, ?, 'local_statute', 1, ?, ?, ?, ?)
         ON CONFLICT(charge_text_normalized, state) DO UPDATE SET
           warrant_id = excluded.warrant_id, source = excluded.source, match_found = excluded.match_found,
           matched_title = excluded.matched_title, matched_citation = excluded.matched_citation,
           matched_source_url = excluded.matched_source_url, raw_response = excluded.raw_response`,
        charge, normalized, state ?? null, warrantId ?? null,
        local.short_title, local.citation, local.source_url ?? null, JSON.stringify(local),
      );
      return c.json({
        ok: true, source: 'local_statute', match_found: true,
        matched_title: local.short_title, matched_citation: local.citation, matched_source_url: local.source_url,
      });
    }

    // 2. Cache lookup.
    const cached = await queryFirst<{
      source: string; match_found: number; matched_title: string | null;
      matched_citation: string | null; matched_source_url: string | null;
    }>(db,
      `SELECT source, match_found, matched_title, matched_citation, matched_source_url
       FROM legal_charge_validations WHERE charge_text_normalized = ? AND (state IS ? OR state = ?)`,
      normalized, state ?? null, state ?? '',
    );
    if (cached) {
      if (warrantId) {
        await execute(db,
          `UPDATE legal_charge_validations SET warrant_id = ? WHERE charge_text_normalized = ? AND (state IS ? OR state = ?)`,
          warrantId, normalized, state ?? null, state ?? '',
        );
      }
      return c.json({
        ok: true, source: 'cache', match_found: !!cached.match_found,
        matched_title: cached.matched_title, matched_citation: cached.matched_citation, matched_source_url: cached.matched_source_url,
      });
    }

    // 3. Live Legal Data Hunter call, under the rate budget.
    let config;
    try {
      config = configFromEnv(c.env as unknown as Record<string, unknown>);
    } catch (err) {
      if (err instanceof LdhConfigError) return c.json({ ok: false, code: 'not_configured' });
      throw err;
    }

    const reservation = await checkAndReserveLdhCall(c.env.KV as unknown as { get: (k: string) => Promise<string | null>; put: (k: string, v: string, o?: { expirationTtl?: number }) => Promise<void> }, Date.now());
    if (!reservation.allowed) {
      return c.json({ ok: false, code: 'rate_limited', reason: reservation.reason });
    }

    const countryHint = state ? 'US' : undefined;
    const citationLike = extractCitationLike(charge);
    let source: 'ldh_resolve' | 'ldh_search';
    let matchFound = false;
    let matchedTitle: string | null = null;
    let matchedCitation: string | null = null;
    let matchedUrl: string | null = null;
    let raw: unknown;

    if (citationLike) {
      source = 'ldh_resolve';
      const resolved = await resolveCitation({ config, reference: citationLike, hintCountry: countryHint, hintType: 'legislation' });
      raw = resolved;
      const doc = resolved.documents[0];
      if (resolved.resolved && doc) {
        matchFound = true;
        matchedTitle = doc.title;
        matchedCitation = doc.source_id;
      }
    } else {
      source = 'ldh_search';
      const searched = await searchLegislation({ config, query: charge, country: countryHint ? [countryHint] : undefined, topK: 3 });
      raw = searched;
      const hit = searched.hits[0];
      if (hit && hit.score >= 0.6) {
        matchFound = true;
        matchedTitle = hit.title;
        matchedCitation = hit.source_id;
        matchedUrl = hit.url ?? null;
      }
    }

    await execute(db,
      `INSERT INTO legal_charge_validations
         (charge_text, charge_text_normalized, state, warrant_id, source, match_found, matched_title, matched_citation, matched_source_url, raw_response)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(charge_text_normalized, state) DO UPDATE SET
         warrant_id = excluded.warrant_id, source = excluded.source, match_found = excluded.match_found,
         matched_title = excluded.matched_title, matched_citation = excluded.matched_citation,
         matched_source_url = excluded.matched_source_url, raw_response = excluded.raw_response`,
      charge, normalized, state ?? null, warrantId ?? null,
      source, matchFound ? 1 : 0, matchedTitle, matchedCitation, matchedUrl, JSON.stringify(raw),
    );

    return c.json({ ok: true, source, match_found: matchFound, matched_title: matchedTitle, matched_citation: matchedCitation, matched_source_url: matchedUrl });
  } catch (err) {
    if (err instanceof LdhError) {
      log.warn('Legal Data Hunter call failed', { name: err.name, message: err.message });
      return c.json({ ok: false, code: 'upstream_error', error: err.message }, 502);
    }
    return dbErrorResponse(c, err, 'Failed to validate charge against Legal Data Hunter');
  }
});

legalDataHunter.get('/usage', requireRole('admin', 'manager'), async (c) => {
  const kv = c.env.KV as unknown as { get: (k: string) => Promise<string | null> };
  const today = new Date().toISOString().slice(0, 10);
  const raw = await kv.get(`legal_data_hunter:usage:day:${today}`);
  const dayCount = raw ? parseInt(raw, 10) || 0 : 0;
  return c.json({ ok: true, day_count: dayCount, budget: LDH_DAILY_BUDGET });
});

export default legalDataHunter;
```

- [ ] **Step 4: Mount the route in `src/routesConfig.ts`**

Add the import near the other route imports (alphabetically, near `alpr`/`fleetio` imports around line 117-130):

```typescript
import legalDataHunter from './routes/legalDataHunter';
```

Add the mount entry near the `/api/fleetio` entry (around line 437):

```typescript
  { prefix: '/api/legal-data-hunter', router: legalDataHunter, auth: 'required',
    note: 'Legal Data Hunter integration: manual, officer-initiated warrant-charge validation only. POST /validate (any authed non-client_viewer user), GET /usage (admin/manager). 200 {ok:false,code:\'not_configured\'} when LEGAL_DATA_HUNTER_API_KEY is unset.' },
```

- [ ] **Step 5: Run the route test to verify it passes**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/legalDataHunter.test.ts`
Expected: PASS — all 3 tests green. (If the JWT test-fixture globals referenced in Step 1 don't exist yet under those exact names, inspect `test-workers/auth.test.ts` for the actual fixture helper in this codebase and adjust the test to use it — do not invent new fixture plumbing.)

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add src/routes/legalDataHunter.ts src/routesConfig.ts test-workers/legalDataHunter.test.ts
git commit -m "feat(legal-data-hunter): add /api/legal-data-hunter validate+usage routes"
```

---

### Task 5: Client UI — "Validate Charge" button on warrant detail

**Files:**
- Create: `client/src/components/LegalDataHunterValidateButton.tsx`
- Modify: `client/src/pages/WarrantsPage.tsx` (insert next to the "Offense / Charges" block, ~line 3086-3091)

**Interfaces:**
- Consumes: `apiFetch<T>(endpoint: string, options?: RequestInit)` from `../hooks/useApi` (existing).
- Produces: `<LegalDataHunterValidateButton charge={string} state={string | undefined} warrantId={number | undefined} />` — self-contained, no props flow back up.

- [ ] **Step 1: Write `client/src/components/LegalDataHunterValidateButton.tsx`**

```tsx
// ============================================================
// RMPG Flex — "Validate Charge" button (Legal Data Hunter)
// ------------------------------------------------------------
// Manual, officer-initiated charge validation. Embedded on
// WarrantsPage's warrant-detail "Offense / Charges" block. Calls
// POST /api/legal-data-hunter/validate on click; no background
// polling, no auto-trigger. Result renders inline and is cached
// server-side, so repeat clicks on the same charge are free.
// ============================================================

import { useState } from 'react';
import { Scale, Loader2, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';

interface ValidateResponse {
  ok: boolean;
  code?: 'not_configured' | 'rate_limited' | 'bad_request' | 'upstream_error';
  reason?: 'daily_limit' | 'minute_limit';
  source?: string;
  match_found?: boolean;
  matched_title?: string | null;
  matched_citation?: string | null;
  matched_source_url?: string | null;
}

interface Props {
  charge: string;
  state?: string;
  warrantId?: number;
}

export default function LegalDataHunterValidateButton({ charge, state, warrantId }: Props) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ValidateResponse | null>(null);

  async function handleValidate() {
    if (!charge.trim() || loading) return;
    setLoading(true);
    setResult(null);
    try {
      const r = await apiFetch<ValidateResponse>('/legal-data-hunter/validate', {
        method: 'POST',
        body: JSON.stringify({ charge, state, warrant_id: warrantId }),
      });
      setResult(r);
    } catch (err) {
      console.warn('[legal-data-hunter] validate failed:', err);
      setResult({ ok: false, code: 'upstream_error' });
    } finally {
      setLoading(false);
    }
  }

  if (!charge.trim()) return null;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={handleValidate}
        disabled={loading}
        className="inline-flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-sm border border-rmpg-600/50 bg-surface-overlay hover:bg-surface-raised text-rmpg-200 disabled:opacity-50"
      >
        {loading ? <Loader2 size={11} className="animate-spin" /> : <Scale size={11} />}
        Validate Charge
      </button>

      {result && !loading && (
        <div className="mt-1.5 text-[10px]">
          {result.ok && result.match_found && (
            <div className="flex items-start gap-1.5 text-green-400">
              <CheckCircle2 size={12} className="mt-0.5 shrink-0" />
              <span>
                Matched: <strong>{result.matched_title}</strong>
                {result.matched_citation ? ` (${result.matched_citation})` : ''}
                {result.matched_source_url && (
                  <>
                    {' — '}
                    <a href={result.matched_source_url} target="_blank" rel="noreferrer" className="underline">
                      source
                    </a>
                  </>
                )}
              </span>
            </div>
          )}
          {result.ok && !result.match_found && (
            <div className="flex items-center gap-1.5 text-amber-400">
              <AlertTriangle size={12} className="shrink-0" />
              <span>No matching statute/citation found.</span>
            </div>
          )}
          {!result.ok && result.code === 'rate_limited' && (
            <div className="flex items-center gap-1.5 text-amber-400">
              <Info size={12} className="shrink-0" />
              <span>Lookup limit reached — try again {result.reason === 'daily_limit' ? 'tomorrow' : 'in a minute'}.</span>
            </div>
          )}
          {!result.ok && result.code === 'not_configured' && (
            <div className="flex items-center gap-1.5 text-rmpg-400">
              <Info size={12} className="shrink-0" />
              <span>Legal Data Hunter is not configured.</span>
            </div>
          )}
          {!result.ok && (result.code === 'upstream_error' || result.code === 'bad_request') && (
            <div className="flex items-center gap-1.5 text-red-400">
              <AlertTriangle size={12} className="shrink-0" />
              <span>Validation failed — try again later.</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `WarrantsPage.tsx`**

In `client/src/pages/WarrantsPage.tsx`, add the import near the top with the other component imports:

```tsx
import LegalDataHunterValidateButton from '../components/LegalDataHunterValidateButton';
```

Find the existing "Charges - full width" block (around line 3086-3091):

```tsx
                  {/* Charges - full width */}
                  {(utahDetailWarrant.charges || utahDetailWarrant.charge_description) && (
                    <div className="mt-3">
                      <span className="text-[10px] font-bold text-[var(--brand-gold)] uppercase tracking-wider">Offense / Charges</span>
                      <div className="font-mono text-rmpg-100 mt-0.5 text-xs whitespace-pre-wrap">{chargesFromJson(utahDetailWarrant.charges || utahDetailWarrant.charge_description) || '—'}</div>
                    </div>
                  )}
```

Replace it with:

```tsx
                  {/* Charges - full width */}
                  {(utahDetailWarrant.charges || utahDetailWarrant.charge_description) && (
                    <div className="mt-3">
                      <span className="text-[10px] font-bold text-[var(--brand-gold)] uppercase tracking-wider">Offense / Charges</span>
                      <div className="font-mono text-rmpg-100 mt-0.5 text-xs whitespace-pre-wrap">{chargesFromJson(utahDetailWarrant.charges || utahDetailWarrant.charge_description) || '—'}</div>
                      <LegalDataHunterValidateButton
                        charge={chargesFromJson(utahDetailWarrant.charges || utahDetailWarrant.charge_description) || ''}
                        state={utahDetailWarrant.state}
                        warrantId={typeof utahDetailWarrant.id === 'number' ? utahDetailWarrant.id : undefined}
                      />
                    </div>
                  )}
```

Note: check the actual `utahDetailWarrant` type in this file for the exact `state`/`id` field names before applying this edit — if `state` isn't present on that particular object shape, omit the prop (it's optional) rather than inventing a field.

- [ ] **Step 3: Typecheck the client**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Manual verification**

Run: `cd client && npm run dev`, open the app, navigate to Warrants, open a warrant with a charge description, click "Validate Charge", confirm the button shows a loading spinner then either a match/no-match/rate-limited/not-configured message inline (with `LEGAL_DATA_HUNTER_API_KEY` unset locally, expect the "not configured" message — this confirms the full request/response wiring works end to end even without a live key).

- [ ] **Step 5: Commit**

```bash
git add client/src/components/LegalDataHunterValidateButton.tsx client/src/pages/WarrantsPage.tsx
git commit -m "feat(legal-data-hunter): add Validate Charge button to warrant detail"
```

---

### Task 6: CLAUDE.md documentation + secret setup note

**Files:**
- Modify: `CLAUDE.md` (append a new subsection under "External integrations")

**Interfaces:** None — documentation only.

- [ ] **Step 1: Add the integration writeup**

In `CLAUDE.md`, under the `## External integrations` heading, after the existing Fleet.io subsection, add:

```markdown
### Legal Data Hunter (manual warrant-charge validation)

Manual, officer-initiated cross-reference of a warrant's charge text against the Legal Data
Hunter API (230+ jurisdictions). **Not** an auto-screen — never runs on warrant create/update,
never blocks any warrant workflow. Full design:
[`docs/superpowers/specs/2026-07-17-legal-data-hunter-integration-design.md`](docs/superpowers/specs/2026-07-17-legal-data-hunter-integration-design.md).

- **Client**: [`src/utils/legalDataHunter/client.ts`](src/utils/legalDataHunter/client.ts) —
  Worker-safe `fetch` wrapper for `POST /v1/resolve` and `POST /v1/search`
  (`https://legaldatahunter.com`). Typed errors (`LdhConfigError|LdhTimeoutError|LdhHttpError|LdhRateLimitError`).
  Unit-tested in [`tests/legalDataHunterClient.test.ts`](tests/legalDataHunterClient.test.ts).
- **Rate limiting**: LDH's own limits are 10 req/min / 20 req/day / 600/period — far too low for
  any automated pipeline. [`src/utils/legalDataHunter/rateLimit.ts`](src/utils/legalDataHunter/rateLimit.ts)
  enforces a self-imposed buffer (8/min, 18/day) via KV counters before any live call is made.
- **Route**: [`src/routes/legalDataHunter.ts`](src/routes/legalDataHunter.ts) at
  `/api/legal-data-hunter` (auth required, `client_viewer` excluded). `POST /validate` tries, in
  order: the local `utah_statutes` table (free, Utah-only) → the `legal_charge_validations` D1
  cache → a live LDH call under the rate budget. `GET /usage` (admin/manager) reports today's
  call count.
- **Schema**: migration `0191_legal_data_hunter.sql` — `legal_charge_validations`
  (charge text/state → cached match, unique per normalized charge+state). No new columns on
  `warrants` (100-col cap).
- **UI**: [`LegalDataHunterValidateButton`](client/src/components/LegalDataHunterValidateButton.tsx),
  embedded on `WarrantsPage.tsx`'s warrant-detail "Offense / Charges" block. Click-to-validate
  only — no polling, no background state.
- **Config**: secret `LEGAL_DATA_HUNTER_API_KEY` via `wrangler secret put` (prod) / `.dev.vars`
  (local, gitignored). Unset → `/api/legal-data-hunter/validate` returns
  `200 { ok: false, code: 'not_configured' }`.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document Legal Data Hunter integration in CLAUDE.md"
```

---

## Post-plan manual step (not automatable)

Rotate the Legal Data Hunter API key shared earlier in this session (it was pasted into chat,
not a secrets manager, so treat it as compromised) before running:

```bash
npx wrangler secret put LEGAL_DATA_HUNTER_API_KEY
```

Apply the migration to live D1 per CLAUDE.md's schema-change process:

```bash
scripts/apply-migration.sh 0191_legal_data_hunter.sql
```
