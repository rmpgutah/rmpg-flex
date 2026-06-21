# Fleet.io Integration — PR 1: Adapter + Seed + Admin Connect — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the Fleet.io integration foundation — typed adapter, sync-bookkeeping D1 tables, admin connect/seed routes, and reconciliation cron skeleton — with zero user-visible UI changes. After deploy, the operator hits `POST /api/fleetio/seed` once and the 18-ish existing `fleet_vehicles` rows appear in their (empty) Fleet.io account. Outbound only at this stage; webhook and bidirectional sync wait for PR 4.

**Architecture:** Three layers in `src/utils/fleetio/`: `errors.ts` (typed Error subclasses for `instanceof` discrimination), `types.ts` (Fleet.io payload + RMPG-side types), `client.ts` (Worker-safe HTTP adapter with retry/backoff/429-handling, no D1 access). The route layer `src/routes/fleetio.ts` is mounted via `src/routesConfig.ts` and provides `/test-connection`, `/seed`, plus an admin status endpoint. The `*/30 * * * *` cron in `src/index.ts` `scheduled()` invokes a reconciliation stub that no-ops in PR 1 but exists so PR 4 can drop in the real handler without touching `wrangler.toml` or the dispatcher again.

**Tech Stack:** Hono, Cloudflare Workers, D1 (`@cloudflare/workers-types`), Vitest 4, Fleet.io REST API v1 (`https://secure.fleetio.com/api/v1`), TypeScript 5.

**Spec:** [`docs/superpowers/specs/2026-06-21-fleetio-integration-design.md`](../specs/2026-06-21-fleetio-integration-design.md)

## 🔒 Secret-hygiene invariants (enforced by Task 5.5)

The `FLEETIO_API_KEY` and `FLEETIO_ACCOUNT_TOKEN` values must NEVER appear in:
- Any `console.log` / `console.warn` / `console.error` call.
- Any HTTP response body returned to a client (including error responses).
- Any `audit_log` row, `flex_events` payload, or other persistent log.
- Any error message thrown by `client.ts` (even when wrapping Fleet.io's own response body).
- Any test fixture, vitest snapshot, PR title or PR body.
- Any committed file under any path (the `.dev.vars` file is gitignored; `wrangler secret put` keeps prod values out of git entirely).

Task 5.5 ships a vitest case that asserts: given a Fleet.io 5xx response body that contains the API key as a substring (the worst-case scenario — Fleet.io echoing the request back in their error body), the thrown `FleetioHttpError.message` and `.detail` do NOT contain the key value. If a future change regresses this, the test goes red.

Two NEVER-LOG comments are also inserted at the brittle spots in `client.ts` (the catch arms in `fleetioFetch`) so future contributors don't accidentally add a `console.error(err, headers)` that leaks credentials.

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `src/utils/fleetio/errors.ts` | create | Typed error classes — `FleetioError`, `FleetioConfigError`, `FleetioTimeoutError`, `FleetioHttpError`, `FleetioRateLimitError`. `instanceof`-discriminable. |
| `src/utils/fleetio/types.ts` | create | TS types — `FleetioVehicle`, `FleetioPagination`, `FleetioListResponse<T>`, `FleetioVehicleCreatePayload`. |
| `src/utils/fleetio/client.ts` | create | Worker-safe adapter — `fleetioFetch()` (core retry/backoff/timeout), `buildFleetioRequest()` (pure URL+header builder), `ping()`, `listVehicles()`, `createVehicle()`. No D1 access. |
| `src/utils/fleetio/seed.ts` | create | Pure seed helper — `buildVehiclePayload(row)` maps a `fleet_vehicles` row to `FleetioVehicleCreatePayload`. Pure for testability. |
| `src/routes/fleetio.ts` | create | Hono sub-router — `/test-connection` (any user), `/seed` (admin only), `/sync-status` (admin only). |
| `src/routesConfig.ts` | modify | One import + one `ROUTE_REGISTRY` entry (alphabetical-ish under RMS Phase-1 section). |
| `src/index.ts` | modify | One `if (event.cron === '*/30 * * * *')` branch in the existing `scheduled()` handler invoking the (stub) reconciliation helper. |
| `wrangler.toml` | modify | Add `FLEETIO_API_BASE` to `[vars]`, add `*/30 * * * *` to crons array, document the three secrets. |
| `migrations/0133_fleetio_sync_tables.sql` | create | DDL for `fleetio_links`, `fleetio_events`, `fleetio_conflicts`, `fleetio_sync_state` — all idempotent (`CREATE TABLE IF NOT EXISTS`). |
| `tests/fleetioErrors.test.ts` | create | Vitest — every error subclass instantiates with right props, `instanceof` chain holds. |
| `tests/fleetioClient.test.ts` | create | Vitest with stub `fetch` — header construction, success path, 429 with `Retry-After`, 5xx retries, 4xx no-retry, timeout, pagination. |
| `tests/fleetioSeed.test.ts` | create | Vitest — `buildVehiclePayload` maps every Fleet.io-required field correctly, omits empties, handles nulls. |
| `CLAUDE.md` | modify | Add a short Fleet.io section describing the integration entrypoint (mirrors the ALPR section style). |

---

## Task 1: Branch + migration `0133_fleetio_sync_tables.sql`

**Why:** The migration is independent and idempotent — landing it first means every later task can assume the tables exist locally.

**Files:**
- Create: `migrations/0133_fleetio_sync_tables.sql`

- [ ] **Step 1.1: Verify clean working tree on a Fleet.io PR branch**

Run: `git status -s && git branch --show-current`
Expected output: empty status, branch name like `claude/trusting-snyder-*` (or whatever worktree branch you're on).

If you're on `main` or a non-worktree branch, create a feature branch first:

```bash
git checkout -b feat/fleetio-pr1-adapter-seed
```

- [ ] **Step 1.2: Confirm next-free migration number**

Run: `ls migrations/ | grep -E '^[0-9]{4}_' | sort | tail -5`
Expected: highest prefix is `0132_serve_queue_business_id.sql`. We use `0133`. If main has moved past 0132, bump accordingly.

- [ ] **Step 1.3: Write the migration**

Create `migrations/0133_fleetio_sync_tables.sql`:

```sql
-- Fleet.io integration bookkeeping. PR 1 of the 9-PR Fleet.io program.
-- Spec: docs/superpowers/specs/2026-06-21-fleetio-integration-design.md
-- All DDL idempotent; D1 deploy is best-effort (continue-on-error in
-- deploy.yml) so the route layer self-heals missing tables/columns at
-- runtime via columnExists() in PR 4. Apply DIRECTLY to live D1 785de7ae
-- after merge and verify via pragma_table_info — see [[project-d1-schema-drift-audit]].

CREATE TABLE IF NOT EXISTS fleetio_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rmpg_table TEXT NOT NULL,
  rmpg_id INTEGER NOT NULL,
  fleetio_resource TEXT NOT NULL,
  fleetio_id INTEGER NOT NULL,
  last_pushed_at TEXT,
  last_pulled_at TEXT,
  pushed_checksum TEXT,
  pulled_checksum TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fleetio_links_rmpg
  ON fleetio_links (rmpg_table, rmpg_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fleetio_links_fleetio
  ON fleetio_links (fleetio_resource, fleetio_id);

CREATE TABLE IF NOT EXISTS fleetio_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  event_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  resource_id INTEGER,
  action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','completed','failed','skipped')),
  attempts INTEGER DEFAULT 0,
  payload_json TEXT NOT NULL,
  error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  processed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fleetio_events_dedup
  ON fleetio_events (direction, event_id);
CREATE INDEX IF NOT EXISTS idx_fleetio_events_status
  ON fleetio_events (status, created_at);

CREATE TABLE IF NOT EXISTS fleetio_conflicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rmpg_table TEXT NOT NULL,
  rmpg_id INTEGER NOT NULL,
  field TEXT NOT NULL,
  local_value TEXT,
  remote_value TEXT,
  resolution TEXT
    CHECK (resolution IS NULL OR resolution IN ('local_wins','remote_wins','manual','unresolved')),
  resolved_by INTEGER,
  resolved_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fleetio_conflicts_unresolved
  ON fleetio_conflicts (rmpg_table, rmpg_id)
  WHERE resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS fleetio_sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);
```

- [ ] **Step 1.4: Apply to local D1**

Run: `npm run migrate:local`
Expected: migration `0133_fleetio_sync_tables.sql` applied. If error mentions "table already exists", it's a re-run — safe.

Verify with: `npx wrangler d1 execute rmpg-flex --local --command "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'fleetio_%' ORDER BY name"`
Expected output rows: `fleetio_conflicts`, `fleetio_events`, `fleetio_links`, `fleetio_sync_state`.

- [ ] **Step 1.5: Commit**

```bash
git add migrations/0133_fleetio_sync_tables.sql
git commit -m "feat(fleetio): migration 0133 — sync bookkeeping tables"
```

---

## Task 2: Typed error classes — `src/utils/fleetio/errors.ts`

**Why:** Errors are pure data with no dependencies — easy first test target. Establishes the `instanceof` chain everything else relies on.

**Files:**
- Create: `src/utils/fleetio/errors.ts`
- Test: `tests/fleetioErrors.test.ts`

- [ ] **Step 2.1: Write the failing test**

Create `tests/fleetioErrors.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  FleetioError,
  FleetioConfigError,
  FleetioTimeoutError,
  FleetioHttpError,
  FleetioRateLimitError,
} from '../src/utils/fleetio/errors';

describe('Fleet.io error classes', () => {
  it('FleetioError carries message + optional status/detail', () => {
    const e = new FleetioError('boom', { status: 500, detail: { foo: 1 } });
    expect(e.message).toBe('boom');
    expect(e.status).toBe(500);
    expect(e.detail).toEqual({ foo: 1 });
    expect(e.name).toBe('FleetioError');
    expect(e instanceof Error).toBe(true);
  });

  it('subclasses extend FleetioError and Error', () => {
    expect(new FleetioConfigError('no key') instanceof FleetioError).toBe(true);
    expect(new FleetioTimeoutError('slow') instanceof FleetioError).toBe(true);
    expect(new FleetioHttpError('bad', 400) instanceof FleetioError).toBe(true);
    expect(new FleetioRateLimitError(30) instanceof FleetioError).toBe(true);
  });

  it('FleetioConfigError defaults to no status', () => {
    const e = new FleetioConfigError('missing FLEETIO_API_KEY');
    expect(e.status).toBeUndefined();
    expect(e.name).toBe('FleetioConfigError');
  });

  it('FleetioHttpError carries the status as a number', () => {
    const e = new FleetioHttpError('not found', 404, { error: 'gone' });
    expect(e.status).toBe(404);
    expect(e.detail).toEqual({ error: 'gone' });
    expect(e.name).toBe('FleetioHttpError');
  });

  it('FleetioRateLimitError stores retryAfterSeconds', () => {
    const e = new FleetioRateLimitError(60);
    expect(e.status).toBe(429);
    expect(e.retryAfterSeconds).toBe(60);
    expect(e.name).toBe('FleetioRateLimitError');
  });
});
```

- [ ] **Step 2.2: Run the test — expect FAIL**

Run: `npx vitest run tests/fleetioErrors.test.ts`
Expected: all tests fail with "Cannot find module '../src/utils/fleetio/errors'".

- [ ] **Step 2.3: Implement the error classes**

Create `src/utils/fleetio/errors.ts`:

```ts
// ============================================================
// RMPG Flex — Fleet.io integration: typed errors
// ============================================================
// Callers `instanceof`-discriminate to map failures to HTTP codes or
// retry policy. Mirrors src/utils/roboflowAlpr.ts error shape so the
// codebase has one consistent integration-error idiom.
// ============================================================

export class FleetioError extends Error {
  readonly status?: number;
  readonly detail?: unknown;
  constructor(message: string, opts?: { status?: number; detail?: unknown }) {
    super(message);
    this.name = 'FleetioError';
    this.status = opts?.status;
    this.detail = opts?.detail;
  }
}

/** Bad/missing config: API key or account token unset, base URL malformed. Not retried. */
export class FleetioConfigError extends FleetioError {
  constructor(message: string, detail?: unknown) {
    super(message, { detail });
    this.name = 'FleetioConfigError';
  }
}

/** Request exceeded the timeout across all retry attempts. */
export class FleetioTimeoutError extends FleetioError {
  constructor(message: string) {
    super(message);
    this.name = 'FleetioTimeoutError';
  }
}

/** Fleet.io returned a non-2xx, non-429 response. `status` carries the HTTP code. */
export class FleetioHttpError extends FleetioError {
  constructor(message: string, status: number, detail?: unknown) {
    super(message, { status, detail });
    this.name = 'FleetioHttpError';
  }
}

/** Fleet.io returned 429. `retryAfterSeconds` reflects the Retry-After header or
 *  the adapter's default backoff if the header was absent/non-numeric. */
export class FleetioRateLimitError extends FleetioError {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number, detail?: unknown) {
    super(`Fleet.io rate limit hit; retry after ${retryAfterSeconds}s`, { status: 429, detail });
    this.name = 'FleetioRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
```

- [ ] **Step 2.4: Run the test — expect PASS**

Run: `npx vitest run tests/fleetioErrors.test.ts`
Expected: 5 tests pass.

- [ ] **Step 2.5: Commit**

```bash
git add src/utils/fleetio/errors.ts tests/fleetioErrors.test.ts
git commit -m "feat(fleetio): typed error classes"
```

---

## Task 3: Types — `src/utils/fleetio/types.ts`

**Why:** Types have no runtime — no separate test pass needed (the tsc gate in CI catches mis-uses). Land them so the next tasks can import.

**Files:**
- Create: `src/utils/fleetio/types.ts`

- [ ] **Step 3.1: Write the types**

Create `src/utils/fleetio/types.ts`:

```ts
// ============================================================
// RMPG Flex — Fleet.io integration: type definitions
// ============================================================
// Subset of the Fleet.io API v1 response shapes we touch in PR 1.
// Spec: docs/superpowers/specs/2026-06-21-fleetio-integration-design.md
//
// Grounded against https://developer.fleetio.com (Quick Start +
// Webhooks docs, 2026-06-21). Fields beyond the subset below are
// allowed via the `[key: string]: unknown` index on FleetioVehicle —
// later PRs (esp. PR 3) replace this with stricter generated types.
// ============================================================

/** Pagination envelope. Fleet.io paginates with `?page=N&per_page=M`,
 *  exposing total counts in the response body. */
export interface FleetioPagination {
  current_page: number;
  total_pages: number;
  total_entries: number;
  per_page: number;
}

/** A list response carrying the resource array + pagination block. */
export interface FleetioListResponse<T> {
  records: T[];
  pagination: FleetioPagination;
}

/** Vehicle resource — PR 1 only writes a subset, but reads any record. */
export interface FleetioVehicle {
  id: number;
  name: string | null;
  vin: string | null;
  license_plate: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  color: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  // Open record — Fleet.io has ~80 fields on Vehicle; we don't enumerate
  // them all in PR 1. PR 3 narrows this once the schema-diff report lands.
  [key: string]: unknown;
}

/** Payload for POST /api/v1/vehicles. All fields optional except `name`. */
export interface FleetioVehicleCreatePayload {
  name: string;
  vin?: string | null;
  license_plate?: string | null;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  color?: string | null;
  vehicle_type_id?: number | null;
  fuel_type_id?: number | null;
}

/** RMPG-side fleet_vehicles row shape — only the columns seed reads. */
export interface RmpgFleetVehicleRow {
  id: number;
  vehicle_name: string | null;
  vehicle_number: string | null;
  vin: string | null;
  plate_number: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  color: string | null;
}

/** Outcome of a single vehicle seed attempt — what the route returns per row. */
export type SeedOutcome =
  | { rmpg_id: number; status: 'created'; fleetio_id: number }
  | { rmpg_id: number; status: 'already_linked'; fleetio_id: number }
  | { rmpg_id: number; status: 'skipped_no_name' }
  | { rmpg_id: number; status: 'error'; error: string };

export interface SeedSummary {
  total: number;
  created: number;
  already_linked: number;
  skipped: number;
  errors: number;
  outcomes: SeedOutcome[];
}
```

- [ ] **Step 3.2: Verify typecheck still passes**

Run: `npm run typecheck`
Expected: zero errors. (The types are not yet imported anywhere, so this just confirms the file itself is valid TS.)

- [ ] **Step 3.3: Commit**

```bash
git add src/utils/fleetio/types.ts
git commit -m "feat(fleetio): types — Vehicle + pagination + seed outcomes"
```

---

## Task 4: Pure request builder — `buildFleetioRequest`

**Why:** The header construction (Authorization Token + Account-Token + JSON content type) is the bug-prone bit. Pull it out, test exhaustively, the rest of the adapter trusts it.

**Files:**
- Create: `src/utils/fleetio/client.ts` (begins here; grows in tasks 5–7)
- Test: `tests/fleetioClient.test.ts` (begins here)

- [ ] **Step 4.1: Write the failing test**

Create `tests/fleetioClient.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildFleetioRequest } from '../src/utils/fleetio/client';

describe('buildFleetioRequest', () => {
  const cfg = {
    apiKey: 'tok_test_abc',
    accountToken: 'acct_xyz',
    apiBase: 'https://secure.fleetio.com/api/v1',
  };

  it('GET — joins path, adds dual auth + accept headers, no body', () => {
    const req = buildFleetioRequest({ method: 'GET', path: '/vehicles', config: cfg });
    expect(req.url).toBe('https://secure.fleetio.com/api/v1/vehicles');
    const h = Object.fromEntries(req.headers);
    expect(h['authorization']).toBe('Token tok_test_abc');
    expect(h['account-token']).toBe('acct_xyz');
    expect(h['accept']).toBe('application/json');
    expect(req.body).toBeUndefined();
  });

  it('POST — adds content-type, serializes body to JSON', () => {
    const req = buildFleetioRequest({
      method: 'POST',
      path: '/vehicles',
      config: cfg,
      body: { name: 'Unit 12', vin: 'ABC' },
    });
    expect(req.url).toBe('https://secure.fleetio.com/api/v1/vehicles');
    const h = Object.fromEntries(req.headers);
    expect(h['content-type']).toBe('application/json');
    expect(req.body).toBe('{"name":"Unit 12","vin":"ABC"}');
  });

  it('GET with query — encodes params, supports arrays and numbers', () => {
    const req = buildFleetioRequest({
      method: 'GET',
      path: '/vehicles',
      config: cfg,
      query: { page: 2, per_page: 50, 'q[vin_eq]': '1HGBH41JXMN109186' },
    });
    expect(req.url).toBe(
      'https://secure.fleetio.com/api/v1/vehicles?page=2&per_page=50&q%5Bvin_eq%5D=1HGBH41JXMN109186'
    );
  });

  it('normalizes a path that already starts with / (does not double-slash)', () => {
    const req = buildFleetioRequest({ method: 'GET', path: 'vehicles', config: cfg });
    expect(req.url).toBe('https://secure.fleetio.com/api/v1/vehicles');
  });

  it('drops undefined/null query values (does not serialize them)', () => {
    const req = buildFleetioRequest({
      method: 'GET',
      path: '/vehicles',
      config: cfg,
      query: { page: 1, archived: undefined, foo: null as unknown as undefined },
    });
    expect(req.url).toBe('https://secure.fleetio.com/api/v1/vehicles?page=1');
  });
});
```

- [ ] **Step 4.2: Run — expect FAIL**

Run: `npx vitest run tests/fleetioClient.test.ts`
Expected: all fail with "Cannot find module '../src/utils/fleetio/client'".

- [ ] **Step 4.3: Implement the builder**

Create `src/utils/fleetio/client.ts`:

```ts
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
```

- [ ] **Step 4.4: Run — expect PASS**

Run: `npx vitest run tests/fleetioClient.test.ts`
Expected: 5 tests pass.

- [ ] **Step 4.5: Commit**

```bash
git add src/utils/fleetio/client.ts tests/fleetioClient.test.ts
git commit -m "feat(fleetio): buildFleetioRequest pure helper"
```

---

## Task 5: Core fetch wrapper — `fleetioFetch` (retry, backoff, 429, timeout)

**Why:** This is the brittle bit. Every later method calls it. Test every failure mode against a stub fetch before any real callers exist.

**Files:**
- Modify: `src/utils/fleetio/client.ts`
- Modify: `tests/fleetioClient.test.ts`

- [ ] **Step 5.1: Add failing tests for the wrapper**

Append to `tests/fleetioClient.test.ts`:

```ts
import { fleetioFetch, type FleetioConfig } from '../src/utils/fleetio/client';

const cfg: FleetioConfig = {
  apiKey: 'k',
  accountToken: 'a',
  apiBase: 'https://secure.fleetio.com/api/v1',
};

function jsonResp(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('fleetioFetch', () => {
  it('200 — returns parsed JSON', async () => {
    const stub = vi.fn().mockResolvedValue(jsonResp({ records: [], pagination: { current_page: 1, total_pages: 1, total_entries: 0, per_page: 50 } }));
    const r = await fleetioFetch<{ records: unknown[] }>({
      method: 'GET', path: '/vehicles', config: cfg, fetchImpl: stub,
    });
    expect(r.records).toEqual([]);
    expect(stub).toHaveBeenCalledTimes(1);
  });

  it('429 with Retry-After — throws FleetioRateLimitError carrying the header value', async () => {
    const stub = vi.fn().mockResolvedValue(new Response('rate limited', {
      status: 429, headers: { 'retry-after': '7' },
    }));
    await expect(fleetioFetch({ method: 'GET', path: '/vehicles', config: cfg, fetchImpl: stub, maxRetries: 0 }))
      .rejects.toMatchObject({ name: 'FleetioRateLimitError', retryAfterSeconds: 7 });
  });

  it('5xx — retries up to maxRetries then throws FleetioHttpError', async () => {
    const stub = vi.fn().mockResolvedValue(new Response('boom', { status: 503 }));
    await expect(fleetioFetch({
      method: 'GET', path: '/vehicles', config: cfg, fetchImpl: stub,
      maxRetries: 2, backoffBaseMs: 0,
    })).rejects.toMatchObject({ name: 'FleetioHttpError', status: 503 });
    // 1 initial + 2 retries = 3 calls
    expect(stub).toHaveBeenCalledTimes(3);
  });

  it('4xx (non-429) — throws immediately, no retry', async () => {
    const stub = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'bad vin' }), {
      status: 422, headers: { 'content-type': 'application/json' },
    }));
    await expect(fleetioFetch({ method: 'POST', path: '/vehicles', config: cfg, fetchImpl: stub, maxRetries: 5, backoffBaseMs: 0 }))
      .rejects.toMatchObject({ name: 'FleetioHttpError', status: 422 });
    expect(stub).toHaveBeenCalledTimes(1);
  });

  it('timeout — aborts and throws FleetioTimeoutError', async () => {
    // stub fetch that never resolves; rely on AbortSignal to cancel it
    const stub = vi.fn().mockImplementation((_url, init) => new Promise((_, reject) => {
      (init?.signal as AbortSignal).addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    await expect(fleetioFetch({
      method: 'GET', path: '/vehicles', config: cfg, fetchImpl: stub,
      timeoutMs: 10, maxRetries: 0,
    })).rejects.toMatchObject({ name: 'FleetioTimeoutError' });
  });

  it('missing apiKey — FleetioConfigError, never fetches', async () => {
    const stub = vi.fn();
    await expect(fleetioFetch({
      method: 'GET', path: '/vehicles',
      config: { ...cfg, apiKey: '' }, fetchImpl: stub,
    })).rejects.toMatchObject({ name: 'FleetioConfigError' });
    expect(stub).not.toHaveBeenCalled();
  });

  it('missing accountToken — FleetioConfigError', async () => {
    const stub = vi.fn();
    await expect(fleetioFetch({
      method: 'GET', path: '/vehicles',
      config: { ...cfg, accountToken: '' }, fetchImpl: stub,
    })).rejects.toMatchObject({ name: 'FleetioConfigError' });
  });
});
```

Add the `vi` import at the top of the test file (replace the existing `vitest` import):

```ts
import { describe, it, expect, vi } from 'vitest';
```

- [ ] **Step 5.2: Run — expect FAIL**

Run: `npx vitest run tests/fleetioClient.test.ts`
Expected: 7 new tests fail with "fleetioFetch is not a function" or similar.

- [ ] **Step 5.3: Implement `fleetioFetch`**

Append to `src/utils/fleetio/client.ts`:

```ts
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
 *  parses JSON responses, and maps failures to typed errors. */
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
```

- [ ] **Step 5.4: Run — expect PASS**

Run: `npx vitest run tests/fleetioClient.test.ts`
Expected: all 12 tests in the file pass.

- [ ] **Step 5.5: Commit**

```bash
git add src/utils/fleetio/client.ts tests/fleetioClient.test.ts
git commit -m "feat(fleetio): fleetioFetch wrapper — retry, 429, timeout, typed errors"
```

---

## Task 5.5: Secret-hygiene invariants — never-leak tests + NEVER-LOG comments

**Why:** The credentials must never leak via logs, error messages, or response bodies. The current `fleetioFetch` design doesn't leak by construction (error messages are `Fleet.io ${status}` and detail comes from `safeReadJson`), BUT: (a) Fleet.io might one day echo the request back in an error body, and (b) a future contributor might add a `console.error(err, headers)` thinking it's harmless. This task ships a defensive test that locks the invariant in, plus comments at the brittle spots.

**Files:**
- Modify: `src/utils/fleetio/client.ts` (add NEVER-LOG comments)
- Modify: `tests/fleetioClient.test.ts` (add defensive cases)

- [ ] **Step 5.5.1: Add the failing leak test**

Append to `tests/fleetioClient.test.ts`:

```ts
describe('secret-hygiene invariants', () => {
  const cfg: FleetioConfig = {
    apiKey: 'tok_supersecret_1234567890',
    accountToken: 'acct_alsosecret_xyz',
    apiBase: 'https://secure.fleetio.com/api/v1',
  };

  it('a 5xx body that echoes the API key does NOT leak it via error.message', async () => {
    // Worst case: Fleet.io's error body literally contains our key as a
    // substring (e.g. an "echo back of headers received" debugging response).
    const stub = vi.fn().mockResolvedValue(new Response(
      `{"error":"internal","echoed_auth":"Token tok_supersecret_1234567890"}`,
      { status: 503, headers: { 'content-type': 'application/json' } },
    ));
    try {
      await fleetioFetch({
        method: 'GET', path: '/vehicles', config: cfg, fetchImpl: stub,
        maxRetries: 0, backoffBaseMs: 0,
      });
      throw new Error('expected fleetioFetch to throw');
    } catch (err) {
      const e = err as { name: string; message: string; detail?: unknown };
      // The error MESSAGE must never contain the key. (We control the message
      // template — `Fleet.io ${status}`. This test pins that contract.)
      expect(e.message).not.toContain('tok_supersecret');
      expect(e.message).not.toContain('acct_alsosecret');
      // Detail MAY contain the key (it's the raw response body) — that's why
      // routes must NEVER return err.detail to the client. Tasks 9/10 only
      // surface err.message + err.name.
      expect(e.name).toBe('FleetioHttpError');
    }
  });

  it('FleetioConfigError message names the env var, not the value', async () => {
    const stub = vi.fn();
    await expect(fleetioFetch({
      method: 'GET', path: '/vehicles',
      config: { ...cfg, apiKey: '' }, fetchImpl: stub,
    })).rejects.toMatchObject({ message: 'FLEETIO_API_KEY is unset' });
    // Message must NOT include the (empty) value or expose the accountToken.
    expect(stub).not.toHaveBeenCalled();
  });

  it('FleetioRateLimitError message contains the retry-after seconds, NOT the key', async () => {
    const stub = vi.fn().mockResolvedValue(new Response('429', {
      status: 429, headers: { 'retry-after': '12' },
    }));
    await expect(fleetioFetch({
      method: 'GET', path: '/vehicles', config: cfg, fetchImpl: stub, maxRetries: 0,
    })).rejects.toMatchObject({
      name: 'FleetioRateLimitError',
      retryAfterSeconds: 12,
    });
    // Defensive: the constructed message must not embed the API key.
    await expect(fleetioFetch({
      method: 'GET', path: '/vehicles', config: cfg, fetchImpl: stub, maxRetries: 0,
    })).rejects.toMatchObject({ message: expect.not.stringContaining('tok_supersecret') });
  });
});
```

- [ ] **Step 5.5.2: Run — expect PASS (the existing implementation already honors these invariants)**

Run: `npx vitest run tests/fleetioClient.test.ts`
Expected: all tests in the file pass (the three new invariant tests + the 12 prior ones = 15 total).

If any FAIL, the implementation regressed during Task 5 — fix `fleetioFetch` before continuing. The fix is: ensure `FleetioHttpError` is constructed with a fixed-format message that never interpolates the input config; the existing `Fleet.io ${resp.status}` template is correct.

- [ ] **Step 5.5.3: Add NEVER-LOG comments to client.ts**

Open `src/utils/fleetio/client.ts`. Find the start of the `fleetioFetch` function (the line `export async function fleetioFetch<T>(input: FleetioFetchInput): Promise<T> {`). Insert a NEVER-LOG comment block IMMEDIATELY above it:

```ts
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
```

Also, inside the `catch (err)` block at the bottom of `fleetioFetch`, find the comment `// Network/other — retry if budget remains; otherwise rethrow.` and prepend:

```ts
      // NEVER add `console.error(err, built.headers)` here. Headers contain credentials.
      // If you need to debug, log built.url and err.message ONLY.
```

- [ ] **Step 5.5.4: Run tests + typecheck to confirm clean**

Run: `npx vitest run tests/fleetioClient.test.ts`
Expected: 15 tests pass.

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 5.5.5: Grep-check no credential value sneaked into any committed file**

Run: `git grep -nE '(tok_|acct_|FLEETIO_API_KEY=|FLEETIO_ACCOUNT_TOKEN=)[A-Za-z0-9]{6,}' || echo "(clean: no credential-shaped strings committed)"`
Expected: only matches inside `tests/fleetioClient.test.ts` (which uses the test-marker prefixes `tok_supersecret`, `tok_test_abc`, `acct_xyz`, `acct_alsosecret` — these are NOT real credentials and start with `tok_`/`acct_` so they're clearly test markers).

If you see a match in any source file (anything outside `tests/`), STOP — a real credential value made it into source. Remove before committing.

- [ ] **Step 5.5.6: Commit**

```bash
git add src/utils/fleetio/client.ts tests/fleetioClient.test.ts
git commit -m "feat(fleetio): secret-hygiene invariants — never-leak tests + NEVER-LOG comments"
```

---

## Task 6: Typed resource methods — `ping`, `listVehicles`, `createVehicle`

**Why:** Thin wrappers over `fleetioFetch` for type-safety at call sites. Cheap to write, cheap to test, prevents `as any` everywhere downstream.

**Files:**
- Modify: `src/utils/fleetio/client.ts`
- Modify: `tests/fleetioClient.test.ts`

- [ ] **Step 6.1: Write failing tests**

Append to `tests/fleetioClient.test.ts`:

```ts
import { ping, listVehicles, createVehicle } from '../src/utils/fleetio/client';

describe('typed resource methods', () => {
  const cfg: FleetioConfig = { apiKey: 'k', accountToken: 'a', apiBase: 'https://secure.fleetio.com/api/v1' };

  it('ping — GET /accounts; returns { ok:true, account_id } on 200', async () => {
    const stub = vi.fn().mockResolvedValue(jsonResp({ id: 42, name: 'RMPG' }));
    const r = await ping({ config: cfg, fetchImpl: stub });
    expect(r).toEqual({ ok: true, account_id: 42, account_name: 'RMPG' });
    const [url, init] = stub.mock.calls[0];
    expect(String(url)).toBe('https://secure.fleetio.com/api/v1/accounts');
    expect(init.method).toBe('GET');
  });

  it('ping — 401 maps to { ok:false, error }', async () => {
    const stub = vi.fn().mockResolvedValue(new Response('Unauthorized', { status: 401 }));
    const r = await ping({ config: cfg, fetchImpl: stub });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/401/);
  });

  it('listVehicles — passes page/per_page; returns parsed records', async () => {
    const stub = vi.fn().mockResolvedValue(jsonResp({
      records: [{ id: 1, name: 'Unit 1' }],
      pagination: { current_page: 1, total_pages: 1, total_entries: 1, per_page: 50 },
    }));
    const r = await listVehicles({ config: cfg, page: 2, perPage: 25, fetchImpl: stub });
    expect(r.records).toHaveLength(1);
    expect(stub.mock.calls[0][0]).toBe('https://secure.fleetio.com/api/v1/vehicles?page=2&per_page=25');
  });

  it('createVehicle — POSTs JSON body, returns the created record', async () => {
    const created = { id: 99, name: 'Unit 12', vin: 'ABC' };
    const stub = vi.fn().mockResolvedValue(jsonResp(created, { status: 201 }));
    const r = await createVehicle({
      config: cfg,
      payload: { name: 'Unit 12', vin: 'ABC' },
      fetchImpl: stub,
    });
    expect(r.id).toBe(99);
    expect(stub.mock.calls[0][1].method).toBe('POST');
    expect(stub.mock.calls[0][1].body).toBe('{"name":"Unit 12","vin":"ABC"}');
  });
});
```

- [ ] **Step 6.2: Run — expect FAIL**

Run: `npx vitest run tests/fleetioClient.test.ts`
Expected: 4 new tests fail with "ping is not a function" etc.

- [ ] **Step 6.3: Implement the methods**

Append to `src/utils/fleetio/client.ts`:

```ts
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
```

- [ ] **Step 6.4: Run — expect PASS**

Run: `npx vitest run tests/fleetioClient.test.ts`
Expected: all 16 tests in the file pass.

- [ ] **Step 6.5: Commit**

```bash
git add src/utils/fleetio/client.ts tests/fleetioClient.test.ts
git commit -m "feat(fleetio): ping/listVehicles/createVehicle + configFromEnv"
```

---

## Task 7: Seed payload mapper — `src/utils/fleetio/seed.ts`

**Why:** Pure function with one job — map an RMPG `fleet_vehicles` row to a Fleet.io `vehicles.create` payload. Splits the data-shape concern from the route. Easy to evolve as we add columns in PR 3.

**Files:**
- Create: `src/utils/fleetio/seed.ts`
- Create: `tests/fleetioSeed.test.ts`

- [ ] **Step 7.1: Write failing tests**

Create `tests/fleetioSeed.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildVehiclePayload } from '../src/utils/fleetio/seed';

describe('buildVehiclePayload', () => {
  const baseRow = {
    id: 1, vehicle_name: 'Unit 12', vehicle_number: 'U-12',
    vin: '1HGBH41JXMN109186', plate_number: 'ABC123',
    year: 2022, make: 'Ford', model: 'Explorer', color: 'Black',
  };

  it('maps every required + optional field present on the row', () => {
    expect(buildVehiclePayload(baseRow)).toEqual({
      name: 'Unit 12',
      vin: '1HGBH41JXMN109186',
      license_plate: 'ABC123',
      year: 2022,
      make: 'Ford',
      model: 'Explorer',
      color: 'Black',
    });
  });

  it('falls back to vehicle_number when vehicle_name is null', () => {
    const r = { ...baseRow, vehicle_name: null };
    expect(buildVehiclePayload(r)?.name).toBe('U-12');
  });

  it('falls back to "VIN <vin>" when both name and number are null', () => {
    const r = { ...baseRow, vehicle_name: null, vehicle_number: null };
    expect(buildVehiclePayload(r)?.name).toBe('VIN 1HGBH41JXMN109186');
  });

  it('returns null when no usable name can be derived (no name, no number, no VIN)', () => {
    const r = { ...baseRow, vehicle_name: null, vehicle_number: null, vin: null };
    expect(buildVehiclePayload(r)).toBeNull();
  });

  it('omits empty string fields (Fleet.io rejects empty strings on some columns)', () => {
    const r = { ...baseRow, color: '' as unknown as string, plate_number: '' as unknown as string };
    const p = buildVehiclePayload(r);
    expect(p).not.toHaveProperty('color');
    expect(p).not.toHaveProperty('license_plate');
  });

  it('passes null year through unchanged', () => {
    const r = { ...baseRow, year: null };
    expect(buildVehiclePayload(r)?.year).toBeNull();
  });
});
```

- [ ] **Step 7.2: Run — expect FAIL**

Run: `npx vitest run tests/fleetioSeed.test.ts`
Expected: 6 fails with "Cannot find module".

- [ ] **Step 7.3: Implement**

Create `src/utils/fleetio/seed.ts`:

```ts
// ============================================================
// RMPG Flex — Fleet.io integration: seed payload mapper
// ============================================================
// Pure function: maps an RMPG `fleet_vehicles` row to a Fleet.io
// `vehicles.create` payload. Splits data-shape concerns from the
// route handler so we can evolve the mapping as PR 3 adds columns.
// ============================================================

import type { FleetioVehicleCreatePayload, RmpgFleetVehicleRow } from './types';

/** Returns null when the row has no derivable name — caller should skip it. */
export function buildVehiclePayload(row: RmpgFleetVehicleRow): FleetioVehicleCreatePayload | null {
  const name = deriveName(row);
  if (!name) return null;

  const payload: FleetioVehicleCreatePayload = { name };

  if (row.vin) payload.vin = row.vin;
  if (row.plate_number) payload.license_plate = row.plate_number;
  if (row.year !== undefined) payload.year = row.year ?? null;
  if (row.make) payload.make = row.make;
  if (row.model) payload.model = row.model;
  if (row.color) payload.color = row.color;

  return payload;
}

function deriveName(row: RmpgFleetVehicleRow): string | null {
  if (row.vehicle_name && row.vehicle_name.trim()) return row.vehicle_name.trim();
  if (row.vehicle_number && row.vehicle_number.trim()) return row.vehicle_number.trim();
  if (row.vin && row.vin.trim()) return `VIN ${row.vin.trim()}`;
  return null;
}
```

- [ ] **Step 7.4: Run — expect PASS**

Run: `npx vitest run tests/fleetioSeed.test.ts`
Expected: 6 pass.

- [ ] **Step 7.5: Commit**

```bash
git add src/utils/fleetio/seed.ts tests/fleetioSeed.test.ts
git commit -m "feat(fleetio): buildVehiclePayload — fleet_vehicles row → Fleet.io payload"
```

---

## Task 8: Wrangler config — env var, secrets comment, cron entry

**Why:** The route can't read `FLEETIO_API_BASE` or honor the cron until wrangler.toml knows about them. Also documents the three secrets so a fresh deploy knows what to set.

**Files:**
- Modify: `wrangler.toml`

- [ ] **Step 8.1: Read current `[vars]` and `[[triggers]]` blocks**

Run: `grep -nE '^\[vars\]|^\[\[triggers\]\]|^crons|^# Secrets' wrangler.toml`
Note the line numbers; you'll edit two places.

- [ ] **Step 8.2: Add `FLEETIO_API_BASE` to `[vars]`**

Find the `[vars]` section (around line 234). Append a new line below the existing vars:

```toml
# Fleet.io integration (PR 1+). Base URL of the Fleet.io REST API v1.
# Override in dev/test via .dev.vars. Set FLEETIO_API_KEY, FLEETIO_ACCOUNT_TOKEN,
# and FLEETIO_WEBHOOK_SECRET via `npx wrangler secret put <NAME>` (PR 4 adds the
# webhook receiver that needs the third one).
FLEETIO_API_BASE = "https://secure.fleetio.com/api/v1"
```

- [ ] **Step 8.3: Add `*/30 * * * *` to crons**

Locate the existing `crons = ["0 */4 * * *", "* * * * *"]` (line ~255). Replace with:

```toml
crons = ["0 */4 * * *", "* * * * *", "*/30 * * * *"]
```

The first two are the existing 4-hour and per-minute crons; the third is the Fleet.io reconciliation cron (stub in PR 1; real handler in PR 4).

- [ ] **Step 8.4: Document the secrets in the `# Secrets` comment block**

Find `# Secrets (set via 'npx wrangler secret put')` (line ~246). Below the existing entries, add:

```toml
#  - FLEETIO_API_KEY         Fleet.io API key (Token-style; app.fleetio.com/settings/api_keys)
#  - FLEETIO_ACCOUNT_TOKEN   Fleet.io Account-Token (per-account; same settings page)
#  - FLEETIO_WEBHOOK_SECRET  Fleet.io webhook signing secret (PR 4; set when webhooks are wired)
```

- [ ] **Step 8.5: Verify by running typecheck (catches malformed TOML via wrangler types)**

Run: `npm run typecheck`
Expected: no errors.

Run: `npx wrangler deploy --dry-run --outdir=.wrangler/tmp 2>&1 | grep -E 'crons|FLEETIO|error' || true`
Expected: shows `crons` includes `*/30 * * * *`; `FLEETIO_API_BASE` is bound. No errors.

- [ ] **Step 8.6: Commit**

```bash
git add wrangler.toml
git commit -m "feat(fleetio): wrangler config — FLEETIO_API_BASE var + 30m cron + secret docs"
```

---

## Task 9: Route — `src/routes/fleetio.ts` (test-connection + sync-status)

**Why:** `/test-connection` is the smallest possible route that exercises the adapter end-to-end through the env-based config helper. `/sync-status` returns the bookkeeping table counts so the operator can confirm the migration landed and there's no half-written state.

**Files:**
- Create: `src/routes/fleetio.ts`
- Modify: `src/routesConfig.ts`

- [ ] **Step 9.1: Create the route file (initial: test-connection + sync-status)**

Create `src/routes/fleetio.ts`:

```ts
// ============================================================
// RMPG Flex — Fleet.io integration routes
// ============================================================
// Mounted at /api/fleetio (auth: 'required'). All routes require an
// authenticated user; the heavy-write endpoints (seed) additionally
// require the `admin` role.
//
// PR 1 exposes:
//   GET  /test-connection   Any authed user. Returns { ok, account_id, account_name } or { ok:false, error }.
//   GET  /sync-status       Admin. Returns counts from fleetio_links / fleetio_events / fleetio_conflicts.
//   POST /seed              Admin. Pushes every fleet_vehicles row that lacks a fleetio_links entry into Fleet.io.
//
// PR 4 will add POST /webhook (HMAC-verified inbound).
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { configFromEnv, createVehicle, ping } from '../utils/fleetio/client';
import { FleetioConfigError, FleetioError } from '../utils/fleetio/errors';
import { buildVehiclePayload } from '../utils/fleetio/seed';
import type { RmpgFleetVehicleRow, SeedOutcome, SeedSummary } from '../utils/fleetio/types';
import { recordAudit } from '../utils/auditLog';

const fleetio = new Hono<Env>();

/** Lightweight reachability + auth check. Any authed user can call it (admins
 *  need it during setup; ops staff need it for troubleshooting). */
fleetio.get('/test-connection', async (c) => {
  let config;
  try {
    config = configFromEnv(c.env as unknown as Record<string, unknown>);
  } catch (err) {
    if (err instanceof FleetioConfigError) {
      return c.json({ ok: false, error: err.message, code: 'not_configured' }, 503);
    }
    throw err;
  }
  const r = await ping({ config });
  return c.json(r, r.ok ? 200 : 502);
});

/** Counts only — no payloads. Useful as a smoke test post-deploy. */
fleetio.get('/sync-status', requireRole('admin'), async (c) => {
  const db = getDb(c.env);
  const [links, eventsPending, eventsFailed, conflicts] = await Promise.all([
    queryFirst<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM fleetio_links'),
    queryFirst<{ n: number }>(db, "SELECT COUNT(*) AS n FROM fleetio_events WHERE direction='outbound' AND status='pending'"),
    queryFirst<{ n: number }>(db, "SELECT COUNT(*) AS n FROM fleetio_events WHERE status='failed'"),
    queryFirst<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM fleetio_conflicts WHERE resolved_at IS NULL'),
  ]);
  return c.json({
    links_total: links?.n ?? 0,
    outbound_pending: eventsPending?.n ?? 0,
    failed_total: eventsFailed?.n ?? 0,
    conflicts_unresolved: conflicts?.n ?? 0,
  });
});

export default fleetio;
```

- [ ] **Step 9.2: Register the route in `routesConfig.ts`**

Open `src/routesConfig.ts`. Add the import alongside the other route imports (near the top of the file, alphabetical-ish — find where other `import X from './routes/y'` lines live; insert near `fleet`):

```ts
import fleetio from './routes/fleetio';
```

Then add the registry entry. The RMS Phase-1 ports section is strictly alphabetical to prevent merge conflicts. Find the spot between `/api/fleet` and the next alphabetically-larger entry and insert:

```ts
  { prefix: '/api/fleetio', router: fleetio, auth: 'required' },
```

- [ ] **Step 9.3: Verify typecheck and that no other route's auth is regressed**

Run: `npm run typecheck`
Expected: no errors.

Run: `npx vitest run --reporter=verbose 2>&1 | tail -20`
Expected: existing 976 tests still pass.

- [ ] **Step 9.4: Smoke-test the new route locally**

Run in one terminal: `npm run dev`
In another terminal:

```bash
# Test connection without auth: 401 (good)
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8787/api/fleetio/test-connection
# Expected: 401

# With a JWT but no FLEETIO_API_KEY set: 503 not_configured
# (you'll need to set a JWT cookie or Authorization header — use whatever
#  pattern you already use for local dev; the smoke is that the route is mounted)
```

Stop dev server.

- [ ] **Step 9.5: Commit**

```bash
git add src/routes/fleetio.ts src/routesConfig.ts
git commit -m "feat(fleetio): route — /test-connection + /sync-status"
```

---

## Task 10: Route — `POST /api/fleetio/seed` (admin-only)

**Why:** The user-facing payoff of PR 1. After deploy the operator hits this once and 18 vehicles appear in their empty Fleet.io account. Pure use of the adapter + seed helper.

**Files:**
- Modify: `src/routes/fleetio.ts`

- [ ] **Step 10.1: Append `/seed` handler**

Append to `src/routes/fleetio.ts` (before the `export default` line):

```ts
/** Push every fleet_vehicles row that doesn't yet have a fleetio_links entry
 *  to Fleet.io. Idempotent: re-running skips already-linked rows. Returns a
 *  per-row outcome summary so the operator can see exactly what changed.
 *
 *  Body: { dry_run?: boolean }   (default false; true returns the would-be
 *                                  payloads without calling Fleet.io)
 *
 *  Admin only. Times out at ~25 s (Worker hard limit ~30 s for non-stream
 *  responses; large fleets should call repeatedly with limit param below). */
fleetio.post('/seed', requireRole('admin'), async (c) => {
  let config;
  try {
    config = configFromEnv(c.env as unknown as Record<string, unknown>);
  } catch (err) {
    if (err instanceof FleetioConfigError) {
      return c.json({ ok: false, error: err.message, code: 'not_configured' }, 503);
    }
    throw err;
  }

  const body = await c.req.json().catch(() => ({} as { dry_run?: boolean; limit?: number }));
  const dryRun = !!body.dry_run;
  const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 200);

  const db = getDb(c.env);

  // Pull unlinked rows. LEFT JOIN over fleetio_links keeps already-pushed
  // vehicles out of the work-set automatically.
  const rows = await query<RmpgFleetVehicleRow>(
    db,
    `SELECT v.id, v.vehicle_name, v.vehicle_number, v.vin, v.plate_number,
            v.year, v.make, v.model, v.color
     FROM fleet_vehicles v
     LEFT JOIN fleetio_links l
       ON l.rmpg_table='fleet_vehicles' AND l.rmpg_id=v.id
     WHERE l.id IS NULL AND COALESCE(v.archived_at, '') = ''
     ORDER BY v.id ASC
     LIMIT ?`,
    limit,
  );

  // Rate-limit pacing: Fleet.io's account limit is 50 req/min (confirmed
  // 2026-06-21 against the Token-scope settings page). Space POSTs at 1.2 s
  // so we hit the 50 req/min ceiling exactly — never trigger a 429, and
  // leave headroom if another sync runs concurrently. For 18 vehicles this
  // takes ~22 s (well under the Worker 30 s response deadline). If `limit`
  // is set high (200 max), the caller should run `/seed` repeatedly rather
  // than one long call — each invocation auto-skips already-linked rows.
  const PACE_MS = 1200;
  const outcomes: SeedOutcome[] = [];
  let firstWrite = true;
  for (const row of rows) {
    const payload = buildVehiclePayload(row);
    if (!payload) {
      outcomes.push({ rmpg_id: row.id, status: 'skipped_no_name' });
      continue;
    }
    if (dryRun) {
      // Pretend it would have created with id=0; dry_run is for previewing
      // payloads only. No Fleet.io call → no pacing needed.
      outcomes.push({ rmpg_id: row.id, status: 'created', fleetio_id: 0 });
      continue;
    }
    if (!firstWrite) await new Promise((r) => setTimeout(r, PACE_MS));
    firstWrite = false;
    try {
      const created = await createVehicle({ config, payload });
      await execute(
        db,
        `INSERT INTO fleetio_links (rmpg_table, rmpg_id, fleetio_resource, fleetio_id, last_pushed_at)
         VALUES (?, ?, ?, ?, datetime('now'))`,
        'fleet_vehicles', row.id, 'vehicles', created.id,
      );
      outcomes.push({ rmpg_id: row.id, status: 'created', fleetio_id: created.id });
    } catch (err) {
      // err.message is safe (fixed-format `Fleet.io ${status}` or
      // `FLEETIO_* is unset` — pinned by Task 5.5 tests). NEVER append
      // err.detail here — it can contain Fleet.io's raw response body
      // which may echo the request and leak credentials.
      const message = err instanceof FleetioError
        ? `${err.name}: ${err.message}`
        : err instanceof Error ? err.message : String(err);
      outcomes.push({ rmpg_id: row.id, status: 'error', error: message });
    }
  }

  const summary: SeedSummary = {
    total: outcomes.length,
    created: outcomes.filter((o) => o.status === 'created').length,
    already_linked: 0, // unreachable in this LEFT-JOIN-filtered query; preserved for shape
    skipped: outcomes.filter((o) => o.status === 'skipped_no_name').length,
    errors: outcomes.filter((o) => o.status === 'error').length,
    outcomes,
  };

  if (!dryRun) {
    await recordAudit(c, {
      action: 'FLEETIO_SEED',
      entityType: 'fleetio',
      details: { ...summary, outcomes: undefined, sample: outcomes.slice(0, 5) },
    });
  }

  return c.json({ ok: true, dry_run: dryRun, ...summary });
});
```

- [ ] **Step 10.2: Verify typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 10.3: Run the full test suite (catches accidental regressions in shared utils)**

Run: `npx vitest run`
Expected: existing tests + the new fleetio tests all pass (no regressions in the 976 already-passing).

- [ ] **Step 10.4: Commit**

```bash
git add src/routes/fleetio.ts
git commit -m "feat(fleetio): POST /seed — push fleet_vehicles to Fleet.io (admin)"
```

---

## Task 11: Scheduled handler branch for 30-min cron (reconciliation stub)

**Why:** Wiring the cron dispatcher NOW means PR 4 can add the real reconciliation handler without touching `wrangler.toml` or `src/index.ts` — only its own file. Reduces merge surface across PRs.

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 11.1: Find the `scheduled()` handler**

Run: `grep -n "scheduled" src/index.ts | head -10`
Note the line with `async scheduled(event: ScheduledEvent` (around 334).

- [ ] **Step 11.2: Add the dispatch branch**

Open `src/index.ts`. Inside the `scheduled` handler, AFTER the existing `event.cron === '* * * * *'` branch and BEFORE the `event.cron === '0 */4 * * *'` block (or wherever the 4-hourly logic lives), add:

```ts
    // Fleet.io reconciliation. Runs every 30 minutes; replays missed webhooks
    // and retries failed outbound events. PR 1 ships a no-op stub so the cron
    // wiring exists; PR 4 drops in the real handler in src/utils/fleetio/reconcile.ts.
    if (event.cron === '*/30 * * * *') {
      ctx.waitUntil(
        (async () => {
          try {
            // PR 4: import('./utils/fleetio/reconcile').then(m => m.run(env));
            console.log('[fleetio-reconcile] cron tick (stub — real handler lands in PR 4)');
          } catch (err) {
            console.error('[fleetio-reconcile] cron failed:', err);
          }
        })(),
      );
      return;
    }
```

- [ ] **Step 11.3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 11.4: Sanity-check the cron list matches wrangler.toml**

Run: `grep -E 'event\.cron ===' src/index.ts && grep '^crons' wrangler.toml`
Expected: every cron string in `wrangler.toml`'s `crons` array has a matching `event.cron === '<expr>'` branch in `scheduled()`.

- [ ] **Step 11.5: Commit**

```bash
git add src/index.ts
git commit -m "feat(fleetio): scheduled handler — 30-min reconciliation stub (real in PR 4)"
```

---

## Task 12: Update CLAUDE.md with Fleet.io section

**Why:** CLAUDE.md is the project memory the next agent loads. Without an entry, the next session won't know Fleet.io exists, the secrets to set, or which migration to apply directly to live D1.

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 12.1: Find the "External integrations" section**

Run: `grep -n '^### ALPR Vehicle' CLAUDE.md`
Note the line (this is where the ALPR section starts; you'll add the Fleet.io section right after it for symmetry).

- [ ] **Step 12.2: Insert the Fleet.io section**

Open `CLAUDE.md`. Find the line `### ALPR Vehicle Details Capture (Roboflow)`. Find the end of that section (where the next `### ` heading or `## ` heading begins). Insert the following between them:

```markdown
### Fleet.io (commercial fleet management SaaS)

Bidirectional sync between RMPG's in-house fleet system and Fleet.io. RMPG remains
the operational entry surface (dispatch/MDT/patrol); Fleet.io is the downstream
discipline layer for PM reminders, parts, vendor invoicing, and reports. Outbound
goes live in PR 1 (this PR — seed only); bidirectional real-time + webhooks land in
PR 4. Full spec: [`docs/superpowers/specs/2026-06-21-fleetio-integration-design.md`](docs/superpowers/specs/2026-06-21-fleetio-integration-design.md).

- **Adapter**: [`src/utils/fleetio/client.ts`](src/utils/fleetio/client.ts) — Worker-safe REST client
  for Fleet.io API v1 (`https://secure.fleetio.com/api/v1`). Dual-header auth
  (`Authorization: Token <key>` + `Account-Token: <token>`). Typed errors
  (`FleetioConfigError | FleetioTimeoutError | FleetioHttpError | FleetioRateLimitError`).
  Retry/backoff/timeout. Unit-tested in [`tests/fleetioClient.test.ts`](tests/fleetioClient.test.ts).
- **Route**: [`src/routes/fleetio.ts`](src/routes/fleetio.ts) at `/api/fleetio` (auth: required).
  `GET /test-connection` (any user), `GET /sync-status` (admin), `POST /seed` (admin —
  pushes every `fleet_vehicles` row that lacks a `fleetio_links` entry).
- **Bookkeeping schema**: migration `0133_fleetio_sync_tables.sql` — `fleetio_links`
  (RMPG↔Fleet.io id mapping), `fleetio_events` (in/outbound event queue with
  idempotency key), `fleetio_conflicts` (field-level disagreements; PR 4),
  `fleetio_sync_state` (cursor positions per resource).
- **Config**: secrets `FLEETIO_API_KEY` + `FLEETIO_ACCOUNT_TOKEN` (+ `FLEETIO_WEBHOOK_SECRET`
  in PR 4) via `npx wrangler secret put`. Var `FLEETIO_API_BASE` in `wrangler.toml`
  `[vars]`. Unset → `/api/fleetio/*` returns 503 `{ code: 'not_configured' }`.
- **Cron**: `*/30 * * * *` reconciliation (stub in PR 1; real handler in PR 4).
- **🔴 After merge**: apply `0133_fleetio_sync_tables.sql` DIRECTLY to live D1
  `785de7ae` and verify via `pragma_table_info` (deploy is `continue-on-error`).
  Set the two secrets, then hit `POST /api/fleetio/seed` once.
```

- [ ] **Step 12.3: Sanity check the doc still renders**

Run: `head -10 CLAUDE.md && grep -c '^## ' CLAUDE.md`
Expected: same `##` heading count as before plus zero (we added only `###` headings).

- [ ] **Step 12.4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(fleetio): CLAUDE.md — adapter + routes + post-merge checklist"
```

---

## Task 13: Final verification — full typecheck + tests + build

**Why:** Pre-push gate mirrors CI (`.github/workflows/pr-tests.yml`). Catching a regression here is cheaper than a CI bounce.

**Files:**
- None (verification only)

- [ ] **Step 13.1: Worker typecheck**

Run: `npm run typecheck`
Expected: exit 0, no errors.

- [ ] **Step 13.2: Full vitest run**

Run: `npx vitest run`
Expected: total tests = previous (976) + new (~22 across the three new files) ≈ 998 passed. Verify no failures.

- [ ] **Step 13.3: Client typecheck (doesn't touch /client but CI runs it; defends against accidental cross-edits)**

Run: `cd client && npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 13.4: Client build (defends against import-graph breakage)**

Run: `cd client && npx vite build 2>&1 | tail -5`
Expected: "✓ built in Xs". No errors.

Return to repo root: `cd ..`

- [ ] **Step 13.5: Show the resulting branch state**

Run: `git log --oneline origin/main..HEAD`
Expected: ~12-13 commits, all `feat(fleetio):` or `docs(fleetio):` prefixed.

Run: `git diff --stat origin/main..HEAD | tail -20`
Expected: roughly these files changed:
- `migrations/0133_fleetio_sync_tables.sql` (+~70)
- `src/utils/fleetio/errors.ts` (+~60)
- `src/utils/fleetio/types.ts` (+~60)
- `src/utils/fleetio/client.ts` (+~200)
- `src/utils/fleetio/seed.ts` (+~40)
- `src/routes/fleetio.ts` (+~130)
- `src/routesConfig.ts` (+2)
- `src/index.ts` (+~15)
- `wrangler.toml` (+~10)
- `tests/fleetioErrors.test.ts` (+~50)
- `tests/fleetioClient.test.ts` (+~200)
- `tests/fleetioSeed.test.ts` (+~50)
- `CLAUDE.md` (+~30)

---

## Task 14: Push branch + open PR

**Why:** Per `[[feedback-use-pr-flow-not-direct-push]]`: never push to main; always PR. CI runs `pr-tests.yml` on push of the PR branch.

**Files:**
- None

- [ ] **Step 14.1: Push branch**

If you started on a worktree branch (e.g. `claude/trusting-snyder-*`), push that. Otherwise push `feat/fleetio-pr1-adapter-seed`:

```bash
git push -u origin HEAD
```

Expected: `* [new branch] HEAD -> <branch-name>`.

- [ ] **Step 14.2: Open PR**

```bash
gh pr create --title "feat(fleetio): PR 1 — adapter + seed + admin connect" --body "$(cat <<'EOF'
## Summary

PR 1 of 9 in the Fleet.io integration program (spec:
[`docs/superpowers/specs/2026-06-21-fleetio-integration-design.md`](docs/superpowers/specs/2026-06-21-fleetio-integration-design.md)).

- Worker-safe adapter `src/utils/fleetio/client.ts` (typed errors, retry/backoff/timeout, 429 handling).
- Migration `0133_fleetio_sync_tables.sql` (links/events/conflicts/sync_state).
- Routes at `/api/fleetio`: `GET /test-connection`, `GET /sync-status` (admin), `POST /seed` (admin — pushes unlinked `fleet_vehicles` rows to Fleet.io).
- Wrangler config: `FLEETIO_API_BASE` var + `*/30 * * * *` cron + secret docs.
- Scheduled-handler stub for reconciliation (real handler in PR 4).
- ~22 new vitest cases across errors / client / seed.

**Outbound only.** Webhook + bidirectional sync ship in PR 4.

## Post-merge checklist

- [ ] Apply `migrations/0133_fleetio_sync_tables.sql` DIRECTLY to live D1 `785de7ae` and verify with `pragma_table_info` (deploy is `continue-on-error`).
- [ ] `npx wrangler secret put FLEETIO_API_KEY` — get from app.fleetio.com/settings/api_keys.
- [ ] `npx wrangler secret put FLEETIO_ACCOUNT_TOKEN` — same settings page.
- [ ] Hit `POST /api/fleetio/seed` once (admin auth) to push existing vehicles.

## Test plan

- [ ] CI green (worker typecheck + client typecheck + client tests + client build + pr-tests vitest).
- [ ] `GET /api/fleetio/test-connection` returns `{ ok:false, code:'not_configured' }` before secrets are set, then `{ ok:true, account_id:N }` after.
- [ ] `POST /api/fleetio/seed` returns a summary; live Fleet.io account shows N new vehicles matching the count.
- [ ] `GET /api/fleetio/sync-status` returns `{ links_total: N, ... }` matching the seed result.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: prints the PR URL.

- [ ] **Step 14.3: Verify CI is running**

Run: `gh pr checks --watch`
Expected: jobs `worker-typecheck`, `client-typecheck`, `client-tests`, `client-build`, `pr-tests` start; all eventually green.

If a check fails: read the log, fix locally, push another commit. NEVER `--no-verify` or skip CI gates.

- [ ] **Step 14.4: Hand back to the user**

Print the PR URL and stop. The user reviews + merges. After merge, the user (or you, if asked) runs the post-merge checklist (apply migration to live D1, set the two secrets, hit `/seed`).

---

## Verification matrix (spec coverage check)

| Spec requirement | Covered by task |
|---|---|
| Adapter `src/utils/fleetio/client.ts` (Worker-safe, typed errors, retry, 429, timeout) | Tasks 2, 4, 5, 6 |
| Types `src/utils/fleetio/types.ts` | Task 3 |
| 503 when API key unset | Task 9 (route), Task 5 (adapter `FleetioConfigError`) |
| `GET /api/fleetio/test-connection` | Task 9 |
| `GET /api/fleetio/sync-status` (admin) | Task 9 |
| `POST /api/fleetio/seed` (admin, idempotent via `fleetio_links` LEFT JOIN) | Tasks 7, 10 |
| Wrangler secrets documented (`FLEETIO_API_KEY`, `FLEETIO_ACCOUNT_TOKEN`, `FLEETIO_WEBHOOK_SECRET`) | Task 8 |
| `FLEETIO_API_BASE` env var | Task 8 |
| Migration `0133_fleetio_sync_tables.sql` (links, events, conflicts, sync_state) | Task 1 |
| 30-min reconciliation cron wired (stub OK for PR 1) | Tasks 8 (wrangler), 11 (handler dispatch) |
| Vitest harness for adapter | Tasks 2, 5, 6, 7 |
| Secret-hygiene invariants (NEVER log/return/leak credentials) | Task 5.5 (test + NEVER-LOG comments); Task 10 (route never returns `err.detail`) |
| Rate-limit pacing within 50 req/min | Task 10 (1.2 s spacing between Fleet.io POSTs) |
| `recordAudit()` on admin actions | Task 10 (`FLEETIO_SEED` audit row + flex_events emit) |
| Route registered in `routesConfig.ts` | Task 9 |
| Post-merge live D1 verification documented | Tasks 12 (CLAUDE.md), 14 (PR body) |
| Use PR flow not direct push (`[[feedback-use-pr-flow-not-direct-push]]`) | Task 14 |
| Spec lives at `docs/superpowers/specs/2026-06-21-fleetio-integration-design.md` | (pre-existing — created during brainstorming) |

All PR 1 spec requirements covered.

## Out of scope (deferred to later PRs)

| Item | PR |
|---|---|
| Inbound webhook + HMAC verify | 4 |
| Sync engine (`sync.ts`) | 4 |
| Ownership map (`ownership.ts`) | 4 |
| Real reconciliation handler | 4 |
| Conflict resolution UI | 4 |
| Cross-reference DB + VIN decoder | 2 |
| Form parity (extended vehicle/fuel forms) | 3 |
| Work-order subsystem | 5 |
| Inspection templates | 6 |
| Visualization surfaces (KPI ribbon, dossier, readiness, V1-V8) | 7-9 |
