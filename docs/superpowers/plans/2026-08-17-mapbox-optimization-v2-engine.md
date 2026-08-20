# Mapbox Optimization V2 Async Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Mapbox Optimization V2 as a D1-backed async engine powering three CAD workflows — serve runs, patrol beat planning, and multi-unit dispatch optimization.

**Architecture:** V2 is async (POST → job ID → poll until complete). A new `mapbox_optimization_v2_jobs` D1 table tracks job state. Three pure problem-builder functions transform RMPG domain rows into V2 problem documents. A new Hono router handles submit/poll/list; on completion it writes ordered stops back into `serve_routes.optimized_order_json` so `ServePage` upgrades transparently.

**Tech Stack:** Hono (Worker), D1 (SQLite), Vitest + Miniflare (Worker tests), Vitest + msw (client tests), React hooks.

## Global Constraints

- D1 queries: always `await db.prepare('...').bind(...).all()` / `.first()` / `.run()` — never synchronous
- Unset token → `notConfigured(c, reason)` from `src/utils/notConfigured.ts` — returns HTTP 200 `{ok:false,skipped:true,code:'not_configured'}`, never 503
- Logging: `log.info/warn/error` from `src/utils/logger.ts` — no raw `console.*`
- Route registry: new routes go in `src/routesConfig.ts` ROUTE_REGISTRY + import, not directly in `src/index.ts`
- Role guard: `readOnlyRoleGuard` in auth middleware already excludes `client_viewer` globally; additional supervisor+ checks are per-route inline
- Tailwind tokens only — no hardcoded hex; `rounded-sm` (2 px) not `rounded-lg`; amber = `text-amber-400`/`bg-amber-400`
- V1 endpoint (`/api/mapbox/optimization`) is NOT removed — kept as fallback
- Migration numbering: next free is `0254` (verify with `ls migrations/ | tail` before creating)
- Always apply migration with `scripts/apply-migration.sh` after merge

---

### Task 1: D1 Migration

**Files:**
- Create: `migrations/0254_mapbox_optimization_v2_jobs.sql`

**Interfaces:**
- Produces: `mapbox_optimization_v2_jobs` table used by Task 3

- [ ] **Step 1: Verify next free migration number**

```bash
ls /Users/rmpgutah/RMPG\ Flex/.claude/worktrees/rate-limiter-issues-7e38cf/migrations/ | sort | tail -5
```

Expected: highest prefix shown is `0253`. If a `0254_*` file already exists, use `0255`.

- [ ] **Step 2: Create the migration file**

`migrations/0254_mapbox_optimization_v2_jobs.sql`:

```sql
-- Tracks Mapbox Optimization V2 async jobs.
-- V2 is async: POST returns a Mapbox UUID, GET polls for solution.
-- ref_id links serve_run jobs to their serve_routes row for write-back.
CREATE TABLE IF NOT EXISTS mapbox_optimization_v2_jobs (
  id            TEXT PRIMARY KEY,
  job_type      TEXT NOT NULL CHECK(job_type IN ('serve_run','patrol_beat','multi_unit_dispatch')),
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK(status IN ('pending','processing','complete','error')),
  problem_json  TEXT NOT NULL,
  solution_json TEXT,
  ref_id        INTEGER,
  created_by    INTEGER NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_opt_v2_jobs_type   ON mapbox_optimization_v2_jobs(job_type);
CREATE INDEX IF NOT EXISTS idx_opt_v2_jobs_user   ON mapbox_optimization_v2_jobs(created_by);
CREATE INDEX IF NOT EXISTS idx_opt_v2_jobs_status ON mapbox_optimization_v2_jobs(status);
```

- [ ] **Step 3: Apply locally and verify**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/rate-limiter-issues-7e38cf"
npm run migrate:local
npx wrangler d1 execute rmpg-flex --local \
  --command "SELECT name FROM sqlite_master WHERE type='table' AND name='mapbox_optimization_v2_jobs'"
```

Expected: one row with `name = mapbox_optimization_v2_jobs`.

- [ ] **Step 4: Commit**

```bash
git add migrations/0254_mapbox_optimization_v2_jobs.sql
git commit -m "feat(db): add mapbox_optimization_v2_jobs table for async V2 engine"
```

---

### Task 2: Problem Builders + Unit Tests

**Files:**
- Create: `src/utils/mapboxOptimizationV2.ts`
- Create: `tests/mapboxOptimizationV2.test.ts`

**Interfaces:**
- Produces:
  - `buildServeRunProblem(items: ServeStop[], officer: UnitRow, shiftStart: string, shiftEnd: string): V2ProblemDocument`
  - `buildPatrolBeatProblem(beats: BeatRow[], units: UnitRow[], shiftStart: string, shiftEnd: string): V2ProblemDocument`
  - `buildDispatchProblem(calls: CallRow[], units: UnitRow[]): V2ProblemDocument`
  - All shared types: `V2ProblemDocument`, `V2Solution`, `V2Stop`, `V2Route`, `ServeStop`, `UnitRow`, `BeatRow`, `CallRow`
- Consumed by: Task 3 (Worker route)

- [ ] **Step 1: Write the failing tests**

`tests/mapboxOptimizationV2.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  buildServeRunProblem,
  buildPatrolBeatProblem,
  buildDispatchProblem,
  type ServeStop,
  type UnitRow,
  type BeatRow,
  type CallRow,
} from '../src/utils/mapboxOptimizationV2';

const SHIFT_START = '2026-08-17T08:00:00Z';
const SHIFT_END   = '2026-08-17T17:00:00Z';

const officer: UnitRow = { id: 1, call_sign: 'A1', latitude: 40.76, longitude: -111.89 };

const stops: ServeStop[] = [
  { id: 10, recipient_address: '100 Main', recipient_lat: 40.77, recipient_lng: -111.88 },
  { id: 11, recipient_address: '200 Oak',  recipient_lat: 40.78, recipient_lng: -111.87,
    time_window: '09:00-11:00', priority: '1' },
  { id: 12, recipient_address: '300 Elm',  recipient_lat: 40.79, recipient_lng: -111.86,
    deadline: '2026-08-17T16:00:00Z', priority: '2' },
];

describe('buildServeRunProblem', () => {
  it('produces a valid V2 document shape', () => {
    const doc = buildServeRunProblem(stops, officer, SHIFT_START, SHIFT_END);
    expect(doc.version).toBe(1);
    expect(Array.isArray(doc.locations)).toBe(true);
    expect(Array.isArray(doc.vehicles)).toBe(true);
    expect(Array.isArray(doc.services)).toBe(true);
  });

  it('includes depot + one location per stop', () => {
    const doc = buildServeRunProblem(stops, officer, SHIFT_START, SHIFT_END);
    expect(doc.locations).toHaveLength(stops.length + 1); // depot + stops
  });

  it('has exactly one vehicle matching the officer call sign', () => {
    const doc = buildServeRunProblem(stops, officer, SHIFT_START, SHIFT_END);
    expect(doc.vehicles).toHaveLength(1);
    expect(doc.vehicles[0].name).toBe('A1');
    expect(doc.vehicles[0].routing_profile).toBe('mapbox/driving-traffic');
    expect(doc.vehicles[0].earliest_start).toBe(SHIFT_START);
    expect(doc.vehicles[0].latest_end).toBe(SHIFT_END);
  });

  it('sets service_times from time_window when present', () => {
    const doc = buildServeRunProblem(stops, officer, SHIFT_START, SHIFT_END);
    const svc11 = doc.services.find((s) => s.name === '11');
    expect(svc11?.service_times).toBeDefined();
    expect(svc11?.service_times![0].type).toBe('soft');
    expect(svc11?.service_times![0].earliest).toContain('09:00');
    expect(svc11?.service_times![0].latest).toContain('11:00');
  });

  it('sets service_times from deadline when no time_window', () => {
    const doc = buildServeRunProblem(stops, officer, SHIFT_START, SHIFT_END);
    const svc12 = doc.services.find((s) => s.name === '12');
    expect(svc12?.service_times![0].latest).toBe('2026-08-17T16:00:00Z');
    expect(svc12?.service_times![0].type).toBe('soft_end');
  });

  it('no service_times when neither time_window nor deadline', () => {
    const doc = buildServeRunProblem(stops, officer, SHIFT_START, SHIFT_END);
    const svc10 = doc.services.find((s) => s.name === '10');
    expect(svc10?.service_times).toBeUndefined();
  });

  it('priority 1 → 1800s duration, priority 2 → 1200s', () => {
    const doc = buildServeRunProblem(stops, officer, SHIFT_START, SHIFT_END);
    expect(doc.services.find((s) => s.name === '11')?.duration).toBe(1800);
    expect(doc.services.find((s) => s.name === '12')?.duration).toBe(1200);
  });

  it('uses min-schedule-completion-time objective', () => {
    const doc = buildServeRunProblem(stops, officer, SHIFT_START, SHIFT_END);
    expect(doc.options?.objectives).toContain('min-schedule-completion-time');
  });
});

const beats: BeatRow[] = [
  { id: 1, beat_code: 'B1', min_lat: 40.7, max_lat: 40.8, min_lng: -111.9, max_lng: -111.8 },
  { id: 2, beat_code: 'B2', min_lat: 40.8, max_lat: 40.9, min_lng: -111.9, max_lng: -111.8 },
];
const units: UnitRow[] = [
  { id: 1, call_sign: 'A1', latitude: 40.75, longitude: -111.85 },
  { id: 2, call_sign: 'A2', latitude: 40.76, longitude: -111.86 },
];

describe('buildPatrolBeatProblem', () => {
  it('produces a valid V2 document', () => {
    const doc = buildPatrolBeatProblem(beats, units, SHIFT_START, SHIFT_END);
    expect(doc.version).toBe(1);
  });

  it('vehicle count matches unit count', () => {
    const doc = buildPatrolBeatProblem(beats, units, SHIFT_START, SHIFT_END);
    expect(doc.vehicles).toHaveLength(units.length);
  });

  it('location count = units + beats', () => {
    const doc = buildPatrolBeatProblem(beats, units, SHIFT_START, SHIFT_END);
    expect(doc.locations).toHaveLength(units.length + beats.length);
  });

  it('service count matches beat count', () => {
    const doc = buildPatrolBeatProblem(beats, units, SHIFT_START, SHIFT_END);
    expect(doc.services).toHaveLength(beats.length);
  });

  it('uses min-total-travel-duration objective', () => {
    const doc = buildPatrolBeatProblem(beats, units, SHIFT_START, SHIFT_END);
    expect(doc.options?.objectives).toContain('min-total-travel-duration');
  });

  it('routing profile is mapbox/driving (not traffic)', () => {
    const doc = buildPatrolBeatProblem(beats, units, SHIFT_START, SHIFT_END);
    expect(doc.vehicles[0].routing_profile).toBe('mapbox/driving');
  });
});

const calls: CallRow[] = [
  { id: 100, latitude: 40.77, longitude: -111.87, priority: '1' },
  { id: 101, latitude: 40.78, longitude: -111.88, priority: '3' },
];

describe('buildDispatchProblem', () => {
  it('produces a valid V2 document', () => {
    const doc = buildDispatchProblem(calls, units);
    expect(doc.version).toBe(1);
  });

  it('vehicle count matches unit count', () => {
    const doc = buildDispatchProblem(calls, units);
    expect(doc.vehicles).toHaveLength(units.length);
  });

  it('service count matches call count', () => {
    const doc = buildDispatchProblem(calls, units);
    expect(doc.services).toHaveLength(calls.length);
  });

  it('priority 1 call → 1800s duration', () => {
    const doc = buildDispatchProblem(calls, units);
    expect(doc.services.find((s) => s.name === 'call-100')?.duration).toBe(1800);
  });

  it('priority 3 call → 600s duration', () => {
    const doc = buildDispatchProblem(calls, units);
    expect(doc.services.find((s) => s.name === 'call-101')?.duration).toBe(600);
  });

  it('uses mapbox/driving-traffic profile', () => {
    const doc = buildDispatchProblem(calls, units);
    expect(doc.vehicles[0].routing_profile).toBe('mapbox/driving-traffic');
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/rate-limiter-issues-7e38cf"
npx vitest run tests/mapboxOptimizationV2.test.ts
```

Expected: all tests fail with "Cannot find module '../src/utils/mapboxOptimizationV2'".

- [ ] **Step 3: Implement the builders**

`src/utils/mapboxOptimizationV2.ts`:

```ts
// ─── Shared V2 problem / solution types ──────────────────────────────────────

export interface V2Location {
  name: string;
  coordinates: [number, number]; // [lng, lat]
}

export interface V2Vehicle {
  name: string;
  routing_profile?: string;
  start_location?: string;
  end_location?: string;
  earliest_start?: string;
  latest_end?: string;
  breaks?: { earliest_start: string; latest_end: string; duration: number }[];
}

export interface V2ServiceTime {
  earliest: string;
  latest: string;
  type?: 'strict' | 'soft' | 'soft_start' | 'soft_end';
}

export interface V2Service {
  name: string;
  location: string;
  duration?: number;
  service_times?: V2ServiceTime[];
}

export interface V2ProblemDocument {
  version: 1;
  locations: V2Location[];
  vehicles: V2Vehicle[];
  services: V2Service[];
  options?: { objectives?: string[] };
}

export interface V2Stop {
  type: 'start' | 'service' | 'pickup' | 'dropoff' | 'break' | 'end';
  location: string;
  eta: string;
  odometer?: number;
  wait?: number;
  duration?: number;
  services?: string[];
}

export interface V2Route {
  vehicle: string;
  stops: V2Stop[];
}

export interface V2Solution {
  dropped: { services: string[]; shipments: string[] };
  routes: V2Route[];
}

// ─── Input row types (minimal — only what builders need) ─────────────────────

export interface ServeStop {
  id: number;
  recipient_address: string;
  recipient_lat: number;
  recipient_lng: number;
  time_window?: string | null; // "HH:MM-HH:MM"
  deadline?: string | null;    // ISO datetime
  priority?: string | null;    // '1' | '2' | '3' | 'high' | 'normal' | 'low'
}

export interface UnitRow {
  id: number;
  call_sign: string;
  latitude?: number | null;
  longitude?: number | null;
  earliest_start?: string | null;
  latest_end?: string | null;
}

export interface BeatRow {
  id: number;
  beat_code: string;
  min_lat?: number | null;
  max_lat?: number | null;
  min_lng?: number | null;
  max_lng?: number | null;
}

export interface CallRow {
  id: number;
  incident_number?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  priority?: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function serviceDuration(priority: string | null | undefined): number {
  if (priority === '1' || priority === 'high')   return 30 * 60;
  if (priority === '2' || priority === 'normal') return 20 * 60;
  return 10 * 60;
}

function parseTimeWindow(
  window: string,
  date: string,
): { earliest: string; latest: string } | null {
  const m = window.match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/);
  if (!m) return null;
  return { earliest: `${date}T${m[1]}:00`, latest: `${date}T${m[2]}:00` };
}

// ─── Problem builders ─────────────────────────────────────────────────────────

export function buildServeRunProblem(
  items: ServeStop[],
  officer: UnitRow,
  shiftStart: string,
  shiftEnd: string,
): V2ProblemDocument {
  const date = shiftStart.split('T')[0];
  const depotName = `officer-${officer.id}-depot`;

  const locations: V2Location[] = [
    { name: depotName, coordinates: [officer.longitude ?? 0, officer.latitude ?? 0] },
    ...items.map((s) => ({
      name: String(s.id),
      coordinates: [s.recipient_lng, s.recipient_lat] as [number, number],
    })),
  ];

  const vehicle: V2Vehicle = {
    name: officer.call_sign,
    routing_profile: 'mapbox/driving-traffic',
    start_location: depotName,
    end_location: depotName,
    earliest_start: shiftStart,
    latest_end: shiftEnd,
  };

  const services: V2Service[] = items.map((s) => {
    const svc: V2Service = {
      name: String(s.id),
      location: String(s.id),
      duration: serviceDuration(s.priority),
    };
    if (s.time_window) {
      const tw = parseTimeWindow(s.time_window, date);
      if (tw) svc.service_times = [{ ...tw, type: 'soft' }];
    } else if (s.deadline) {
      svc.service_times = [{ earliest: shiftStart, latest: s.deadline, type: 'soft_end' }];
    }
    return svc;
  });

  return { version: 1, locations, vehicles: [vehicle], services,
    options: { objectives: ['min-schedule-completion-time'] } };
}

export function buildPatrolBeatProblem(
  beats: BeatRow[],
  units: UnitRow[],
  shiftStart: string,
  shiftEnd: string,
): V2ProblemDocument {
  const locations: V2Location[] = [
    ...units.map((u) => ({
      name: `unit-${u.id}-start`,
      coordinates: [u.longitude ?? 0, u.latitude ?? 0] as [number, number],
    })),
    ...beats.map((b) => ({
      name: `beat-${b.id}`,
      coordinates: [
        ((b.min_lng ?? 0) + (b.max_lng ?? 0)) / 2,
        ((b.min_lat ?? 0) + (b.max_lat ?? 0)) / 2,
      ] as [number, number],
    })),
  ];

  const vehicles: V2Vehicle[] = units.map((u) => ({
    name: u.call_sign,
    routing_profile: 'mapbox/driving',
    start_location: `unit-${u.id}-start`,
    earliest_start: shiftStart,
    latest_end: shiftEnd,
  }));

  const services: V2Service[] = beats.map((b) => ({
    name: `beat-${b.id}`,
    location: `beat-${b.id}`,
  }));

  return { version: 1, locations, vehicles, services,
    options: { objectives: ['min-total-travel-duration'] } };
}

export function buildDispatchProblem(
  calls: CallRow[],
  units: UnitRow[],
): V2ProblemDocument {
  const locations: V2Location[] = [
    ...units.map((u) => ({
      name: `unit-${u.id}-start`,
      coordinates: [u.longitude ?? 0, u.latitude ?? 0] as [number, number],
    })),
    ...calls.map((c) => ({
      name: `call-${c.id}`,
      coordinates: [c.longitude ?? 0, c.latitude ?? 0] as [number, number],
    })),
  ];

  const vehicles: V2Vehicle[] = units.map((u) => ({
    name: u.call_sign,
    routing_profile: 'mapbox/driving-traffic',
    start_location: `unit-${u.id}-start`,
  }));

  const services: V2Service[] = calls.map((c) => ({
    name: `call-${c.id}`,
    location: `call-${c.id}`,
    duration: serviceDuration(c.priority),
  }));

  return { version: 1, locations, vehicles, services,
    options: { objectives: ['min-schedule-completion-time'] } };
}
```

- [ ] **Step 4: Run tests — expect all passing**

```bash
npx vitest run tests/mapboxOptimizationV2.test.ts
```

Expected: 19 tests pass.

- [ ] **Step 5: Full suite + typecheck**

```bash
npm run typecheck && npx vitest run
```

Expected: 0 typecheck errors, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/utils/mapboxOptimizationV2.ts tests/mapboxOptimizationV2.test.ts
git commit -m "feat(mapbox): V2 problem builders for serve-run, patrol-beat, dispatch"
```

---

### Task 3: Worker Route + Miniflare Tests

**Files:**
- Create: `src/routes/mapboxOptimizationV2.ts`
- Create: `test-workers/mapboxOptimizationV2.test.ts`

**Interfaces:**
- Consumes:
  - `buildServeRunProblem`, `buildPatrolBeatProblem`, `buildDispatchProblem`, all types from `src/utils/mapboxOptimizationV2.ts`
  - `notConfigured` from `src/utils/notConfigured.ts`
  - `log` from `src/utils/logger.ts`
  - `Env` from `src/types.ts`
- Produces: default export `Hono<Env>` router, consumed by Task 4

- [ ] **Step 1: Write failing Miniflare tests**

`test-workers/mapboxOptimizationV2.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const FAKE_JOB_ID = 'aaaabbbb-cccc-dddd-eeee-ffffgggghhhh';

// Minimal D1 stub
function makeDb(rows: Record<string, unknown>[] = []) {
  const stmt = {
    bind: (..._args: unknown[]) => stmt,
    all: async () => ({ results: rows }),
    first: async () => rows[0] ?? null,
    run: async () => ({ meta: { last_row_id: 1, changes: 1 } }),
  };
  return { prepare: () => stmt };
}

// Minimal KV stub
const kv = { get: async () => null, put: async () => undefined };

async function makeWorker(token: string | null, dbRows?: Record<string, unknown>[]) {
  const { default: app } = await import('../src/routes/mapboxOptimizationV2');
  const env = {
    MAPBOX_ACCESS_TOKEN: token,
    DB: makeDb(dbRows),
    KV: kv,
    JWT_SECRET: 'test',
  };
  const user = { id: 1, role: 'supervisor', org_id: 1 };
  return { app, env, user };
}

function makeReq(
  method: string,
  path: string,
  body?: unknown,
  user = { id: 1, role: 'supervisor', org_id: 1 },
) {
  const url = `http://localhost${path}`;
  const init: RequestInit = { method };
  if (body) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  const req = new Request(url, init) as any;
  // Simulate auth middleware having set the user on context
  req.__testUser = user;
  return req;
}

describe('POST /submit — token missing', () => {
  it('returns not_configured', async () => {
    const { app, env } = await makeWorker(null);
    const c = { env, get: () => ({ id: 1, role: 'supervisor' }), req: { json: async () => ({}) } } as any;
    // Direct unit test: call the handler with no token
    const res = await app.request('/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_type: 'serve_run' }),
    }, { ...env, MAPBOX_ACCESS_TOKEN: undefined });
    // notConfigured returns HTTP 200 with skipped:true
    const json = await res.json() as any;
    expect(json.skipped).toBe(true);
    expect(json.code).toBe('not_configured');
  });
});

describe('GET /:jobId — complete job', () => {
  it('returns solution from D1 without hitting Mapbox', async () => {
    const solution = { dropped: { services: [], shipments: [] }, routes: [] };
    const jobRow = {
      id: FAKE_JOB_ID,
      job_type: 'serve_run',
      status: 'complete',
      solution_json: JSON.stringify(solution),
      ref_id: null,
      created_by: 1,
    };
    const { app, env } = await makeWorker('pk.test', [jobRow]);
    const res = await app.request(`/${FAKE_JOB_ID}`, { method: 'GET' }, env);
    const json = await res.json() as any;
    expect(json.status).toBe('complete');
    expect(json.solution).toBeDefined();
  });
});

describe('GET / — list jobs', () => {
  it('returns empty array when no jobs exist', async () => {
    const { app, env } = await makeWorker('pk.test', []);
    const res = await app.request('/', { method: 'GET' }, env);
    const json = await res.json() as any;
    expect(Array.isArray(json.jobs)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/rate-limiter-issues-7e38cf"
npx vitest run --config vitest.workers.config.mts test-workers/mapboxOptimizationV2.test.ts
```

Expected: fail with "Cannot find module '../src/routes/mapboxOptimizationV2'".

- [ ] **Step 3: Implement the Worker route**

`src/routes/mapboxOptimizationV2.ts`:

```ts
// ============================================================
// Mapbox Optimization V2 async engine
// Backs three CAD workflows: serve_run, patrol_beat, multi_unit_dispatch
// POST /submit → Mapbox job ID → D1 row
// GET /:jobId  → polls Mapbox, updates D1, write-back on completion
// GET /        → list jobs (supervisor+ sees own; admin/manager see all)
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { notConfigured } from '../utils/notConfigured';
import { log } from '../utils/logger';
import {
  buildServeRunProblem,
  buildPatrolBeatProblem,
  buildDispatchProblem,
  type ServeStop,
  type UnitRow,
  type BeatRow,
  type CallRow,
  type V2Solution,
} from '../utils/mapboxOptimizationV2';

const app = new Hono<Env>();

const MB_V2 = 'https://api.mapbox.com/optimized-trips/v2';
const TIMEOUT_MS = 12_000;
const POLL_TIMEOUT_MIN = 5;

const SUPERVISOR_ROLES = new Set(['admin', 'manager', 'supervisor']);

function getToken(c: any): string | null {
  const t = (c.env?.MAPBOX_ACCESS_TOKEN as string) || null;
  if (t?.startsWith('sk.')) return null; // never proxy secret tokens
  return t || null;
}

async function mbFetch(url: string, init?: RequestInit): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let body: any = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
    if (!res.ok) {
      const e: any = new Error(`Mapbox ${res.status}`);
      e.status = res.status; e.body = body;
      throw e;
    }
    return body;
  } finally {
    clearTimeout(t);
  }
}

// ── POST /submit ─────────────────────────────────────────────────────────────
app.post('/submit', async (c) => {
  const tk = getToken(c);
  if (!tk) return notConfigured(c, 'Mapbox Optimization V2 requires MAPBOX_ACCESS_TOKEN');

  const user = c.get('user') as { id: number; role: string } | undefined;
  if (!user || !SUPERVISOR_ROLES.has(user.role)) {
    return c.json({ error: 'Forbidden — supervisor role required' }, 403);
  }

  const db = c.env.DB;
  let body: any;
  try { body = await c.req.json(); } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { job_type } = body as { job_type: string };
  if (!['serve_run', 'patrol_beat', 'multi_unit_dispatch'].includes(job_type)) {
    return c.json({ error: 'job_type must be serve_run, patrol_beat, or multi_unit_dispatch' }, 400);
  }

  let problem: any;
  let refId: number | null = null;

  try {
    if (job_type === 'serve_run') {
      const { serve_queue_ids, officer_unit_id, shift_start, shift_end, ref_id } = body as {
        serve_queue_ids: number[];
        officer_unit_id: number;
        shift_start: string;
        shift_end: string;
        ref_id: number;
      };
      if (!serve_queue_ids?.length || !officer_unit_id || !shift_start || !shift_end || !ref_id) {
        return c.json({ error: 'serve_run requires serve_queue_ids, officer_unit_id, shift_start, shift_end, ref_id' }, 400);
      }
      // Fetch stop rows
      const placeholders = serve_queue_ids.map(() => '?').join(',');
      const { results: stopRows } = await db
        .prepare(`SELECT id, recipient_address, recipient_lat, recipient_lng, time_window, deadline, priority FROM serve_queue WHERE id IN (${placeholders}) AND recipient_lat IS NOT NULL AND recipient_lng IS NOT NULL`)
        .bind(...serve_queue_ids)
        .all();
      const officerRow = await db
        .prepare('SELECT id, call_sign, latitude, longitude FROM units WHERE id = ? LIMIT 1')
        .bind(officer_unit_id)
        .first();
      if (!officerRow) return c.json({ error: 'officer unit not found' }, 404);
      problem = buildServeRunProblem(stopRows as ServeStop[], officerRow as UnitRow, shift_start, shift_end);
      refId = ref_id;
    } else if (job_type === 'patrol_beat') {
      const { beat_ids, unit_ids, shift_start, shift_end } = body as {
        beat_ids: number[];
        unit_ids: number[];
        shift_start: string;
        shift_end: string;
      };
      if (!beat_ids?.length || !unit_ids?.length || !shift_start || !shift_end) {
        return c.json({ error: 'patrol_beat requires beat_ids, unit_ids, shift_start, shift_end' }, 400);
      }
      const bPlaceholders = beat_ids.map(() => '?').join(',');
      const uPlaceholders = unit_ids.map(() => '?').join(',');
      const { results: beatRows } = await db
        .prepare(`SELECT id, beat_code, min_lat, max_lat, min_lng, max_lng FROM dispatch_beats WHERE id IN (${bPlaceholders}) AND active = 1`)
        .bind(...beat_ids)
        .all();
      const { results: unitRows } = await db
        .prepare(`SELECT id, call_sign, latitude, longitude FROM units WHERE id IN (${uPlaceholders})`)
        .bind(...unit_ids)
        .all();
      problem = buildPatrolBeatProblem(beatRows as BeatRow[], unitRows as UnitRow[], shift_start, shift_end);
    } else {
      // multi_unit_dispatch
      const { call_ids, unit_ids } = body as { call_ids: number[]; unit_ids: number[] };
      if (!call_ids?.length || !unit_ids?.length) {
        return c.json({ error: 'multi_unit_dispatch requires call_ids and unit_ids' }, 400);
      }
      const cPlaceholders = call_ids.map(() => '?').join(',');
      const uPlaceholders = unit_ids.map(() => '?').join(',');
      const { results: callRows } = await db
        .prepare(`SELECT id, incident_number, latitude, longitude, priority FROM calls_for_service WHERE id IN (${cPlaceholders}) AND latitude IS NOT NULL AND longitude IS NOT NULL`)
        .bind(...call_ids)
        .all();
      const { results: unitRows } = await db
        .prepare(`SELECT id, call_sign, latitude, longitude FROM units WHERE id IN (${uPlaceholders}) AND status IN ('available','on_scene')`)
        .bind(...unit_ids)
        .all();
      problem = buildDispatchProblem(callRows as CallRow[], unitRows as UnitRow[]);
    }
  } catch (err) {
    log.error('[optimization-v2] problem build failed', { job_type }, err as Error);
    return c.json({ error: 'Failed to build optimization problem' }, 500);
  }

  // Submit to Mapbox V2
  let mapboxJobId: string;
  try {
    const resp = await mbFetch(`${MB_V2}?access_token=${tk}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(problem),
    });
    if (!resp?.id) throw new Error('No job ID in Mapbox response');
    mapboxJobId = resp.id as string;
  } catch (err: any) {
    if (err?.status === 401) {
      return c.json({ error: 'Mapbox token lacks Optimization V2 access', code: 'optimization_v2_unauthorized' }, 503);
    }
    if (err?.status === 422) {
      return c.json({ error: 'Invalid optimization problem', detail: err?.body?.message }, 400);
    }
    log.error('[optimization-v2] Mapbox submit failed', {}, err);
    return c.json({ error: 'Mapbox submit failed' }, 502);
  }

  // Persist to D1
  await db
    .prepare(`INSERT INTO mapbox_optimization_v2_jobs (id, job_type, status, problem_json, ref_id, created_by) VALUES (?, ?, 'pending', ?, ?, ?)`)
    .bind(mapboxJobId, job_type, JSON.stringify(problem), refId, user.id)
    .run();

  log.info('[optimization-v2] job submitted', { jobId: mapboxJobId, job_type, refId });
  return c.json({ job_id: mapboxJobId, status: 'pending' }, 202);
});

// ── GET /:jobId ───────────────────────────────────────────────────────────────
app.get('/:jobId', async (c) => {
  const tk = getToken(c);
  if (!tk) return notConfigured(c, 'Mapbox Optimization V2 requires MAPBOX_ACCESS_TOKEN');

  const db = c.env.DB;
  const { jobId } = c.req.param();

  const row = await db
    .prepare('SELECT * FROM mapbox_optimization_v2_jobs WHERE id = ? LIMIT 1')
    .bind(jobId)
    .first() as any;

  if (!row) return c.json({ error: 'Job not found' }, 404);

  // Already terminal
  if (row.status === 'complete') {
    return c.json({ job_id: jobId, status: 'complete', solution: JSON.parse(row.solution_json) });
  }
  if (row.status === 'error') {
    return c.json({ job_id: jobId, status: 'error', error: row.error_message });
  }

  // Check timeout: if updated_at is >5min ago and still processing, mark error
  const updatedAt = new Date(row.updated_at + 'Z').getTime();
  if (Date.now() - updatedAt > POLL_TIMEOUT_MIN * 60 * 1000 && row.status !== 'pending') {
    await db
      .prepare(`UPDATE mapbox_optimization_v2_jobs SET status = 'error', error_message = 'timed_out', updated_at = datetime('now') WHERE id = ?`)
      .bind(jobId)
      .run();
    return c.json({ job_id: jobId, status: 'error', error: 'timed_out' });
  }

  // Poll Mapbox
  let mapboxResp: any;
  try {
    mapboxResp = await mbFetch(`${MB_V2}/${jobId}?access_token=${tk}`);
  } catch (err: any) {
    if (err?.status === 202) {
      // Still processing — update status in D1
      await db
        .prepare(`UPDATE mapbox_optimization_v2_jobs SET status = 'processing', updated_at = datetime('now') WHERE id = ?`)
        .bind(jobId)
        .run();
      return c.json({ job_id: jobId, status: 'processing' });
    }
    log.error('[optimization-v2] poll failed', { jobId }, err);
    return c.json({ job_id: jobId, status: 'processing', error: 'poll_failed' });
  }

  // 200 OK = complete
  const solution = mapboxResp as V2Solution;
  await db
    .prepare(`UPDATE mapbox_optimization_v2_jobs SET status = 'complete', solution_json = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(JSON.stringify(solution), jobId)
    .run();

  // Write-back for serve_run: update serve_routes.optimized_order_json
  if (row.job_type === 'serve_run' && row.ref_id) {
    try {
      const route = solution.routes[0];
      if (route) {
        const orderedStops = route.stops
          .filter((s) => s.type === 'service')
          .map((s) => ({ id: Number(s.location), eta: s.eta, wait: s.wait ?? 0 }));
        await db
          .prepare(`UPDATE serve_routes SET optimized_order_json = ?, updated_at = datetime('now') WHERE id = ?`)
          .bind(JSON.stringify(orderedStops), row.ref_id)
          .run();
        log.info('[optimization-v2] serve_routes write-back complete', { refId: row.ref_id, stops: orderedStops.length });
      }
    } catch (err) {
      log.error('[optimization-v2] serve_routes write-back failed', { refId: row.ref_id }, err as Error);
      // Don't fail the response — write-back failure is non-fatal
    }
  }

  log.info('[optimization-v2] job complete', { jobId, routes: solution.routes.length, dropped: solution.dropped.services.length });
  return c.json({ job_id: jobId, status: 'complete', solution });
});

// ── GET / ─────────────────────────────────────────────────────────────────────
app.get('/', async (c) => {
  const user = c.get('user') as { id: number; role: string } | undefined;
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const db = c.env.DB;
  const isAdminOrManager = ['admin', 'manager'].includes(user.role);

  const { results } = isAdminOrManager
    ? await db
        .prepare('SELECT id, job_type, status, ref_id, created_by, created_at, updated_at, error_message FROM mapbox_optimization_v2_jobs ORDER BY created_at DESC LIMIT 100')
        .all()
    : await db
        .prepare('SELECT id, job_type, status, ref_id, created_by, created_at, updated_at, error_message FROM mapbox_optimization_v2_jobs WHERE created_by = ? ORDER BY created_at DESC LIMIT 50')
        .bind(user.id)
        .all();

  return c.json({ jobs: results ?? [] });
});

export default app;
```

- [ ] **Step 4: Run Miniflare tests — expect passing**

```bash
npx vitest run --config vitest.workers.config.mts test-workers/mapboxOptimizationV2.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/routes/mapboxOptimizationV2.ts test-workers/mapboxOptimizationV2.test.ts
git commit -m "feat(mapbox): Optimization V2 Worker route — submit, poll, list"
```

---

### Task 4: Wire Route into Registry

**Files:**
- Modify: `src/routesConfig.ts` (import + ROUTE_REGISTRY entry)

**Interfaces:**
- Consumes: default export from `src/routes/mapboxOptimizationV2.ts`

- [ ] **Step 1: Add import to routesConfig.ts**

Find the existing Mapbox import line:

```ts
import mapbox from './routes/mapbox';
```

Add directly after it:

```ts
import optimizationV2 from './routes/mapboxOptimizationV2';
```

- [ ] **Step 2: Add ROUTE_REGISTRY entry**

Find the existing Mapbox entry in ROUTE_REGISTRY:

```ts
{ prefix: '/api/mapbox', router: mapbox, auth: 'required',
```

Add a new entry directly after the closing `},` of that entry:

```ts
{ prefix: '/api/mapbox/optimization-v2', router: optimizationV2, auth: 'required',
  note: 'Mapbox Optimization V2 async engine. POST /submit builds + submits a V2 problem; GET /:jobId polls + writes back to serve_routes on completion; GET / lists jobs. Supervisor+ to submit; any authed role to poll. 200 {skipped:true} when token unset.' },
```

**Important:** This entry must appear BEFORE the `/api/mapbox` entry in the array — Hono's trie matching dispatches more-specific prefixes first and `/api/mapbox/optimization-v2` must not be swallowed by the `/api/mapbox` catch-all. Check that the ROUTE_REGISTRY ordering comment at the top confirms longer prefixes before shorter ones.

- [ ] **Step 3: Verify ordering**

```bash
grep -n "optimization-v2\|/api/mapbox" /Users/rmpgutah/RMPG\ Flex/.claude/worktrees/rate-limiter-issues-7e38cf/src/routesConfig.ts | head -10
```

Expected: `optimization-v2` line number is LOWER (earlier) than the `/api/mapbox` line.

- [ ] **Step 4: Typecheck + full suite**

```bash
npm run typecheck && npx vitest run
```

Expected: 0 errors, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/routesConfig.ts
git commit -m "feat(routes): mount Optimization V2 router at /api/mapbox/optimization-v2"
```

---

### Task 5: Client Types + API Wrappers

**Files:**
- Create: `client/src/utils/mapboxOptimizationV2.ts`

**Interfaces:**
- Produces (consumed by Task 6):
  - `submitOptimizationJob(params: SubmitParams): Promise<{ job_id: string; status: string }>`
  - `pollOptimizationJob(jobId: string): Promise<JobPollResult>`
  - `OptimizationJobStatus`, `V2Solution`, `V2Stop`, `V2Route`, `SubmitParams`, `JobPollResult`

- [ ] **Step 1: Create the client utility**

`client/src/utils/mapboxOptimizationV2.ts`:

```ts
import { apiFetch } from '../hooks/useApi';

// ─── Solution types (mirrors src/utils/mapboxOptimizationV2.ts) ──────────────

export interface V2Stop {
  type: 'start' | 'service' | 'pickup' | 'dropoff' | 'break' | 'end';
  location: string;
  eta: string;
  odometer?: number;
  wait?: number;
  duration?: number;
  services?: string[];
}

export interface V2Route {
  vehicle: string;
  stops: V2Stop[];
}

export interface V2Solution {
  dropped: { services: string[]; shipments: string[] };
  routes: V2Route[];
}

// ─── Submit param shapes ─────────────────────────────────────────────────────

export interface ServeRunSubmitParams {
  job_type: 'serve_run';
  serve_queue_ids: number[];
  officer_unit_id: number;
  shift_start: string; // ISO 8601
  shift_end: string;
  ref_id: number; // serve_routes.id
}

export interface PatrolBeatSubmitParams {
  job_type: 'patrol_beat';
  beat_ids: number[];
  unit_ids: number[];
  shift_start: string;
  shift_end: string;
}

export interface DispatchSubmitParams {
  job_type: 'multi_unit_dispatch';
  call_ids: number[];
  unit_ids: number[];
}

export type SubmitParams = ServeRunSubmitParams | PatrolBeatSubmitParams | DispatchSubmitParams;

// ─── Response shapes ─────────────────────────────────────────────────────────

export type OptimizationJobStatus = 'idle' | 'pending' | 'processing' | 'complete' | 'error';

export interface SubmitResponse {
  job_id: string;
  status: string;
  // notConfigured shape
  skipped?: boolean;
  ok?: boolean;
  code?: string;
}

export interface JobPollResult {
  job_id: string;
  status: OptimizationJobStatus;
  solution?: V2Solution;
  error?: string;
  skipped?: boolean;
}

// ─── API wrappers ─────────────────────────────────────────────────────────────

export async function submitOptimizationJob(params: SubmitParams): Promise<SubmitResponse> {
  return apiFetch<SubmitResponse>('/mapbox/optimization-v2/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

export async function pollOptimizationJob(jobId: string): Promise<JobPollResult> {
  return apiFetch<JobPollResult>(`/mapbox/optimization-v2/${encodeURIComponent(jobId)}`);
}
```

- [ ] **Step 2: Typecheck client**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/rate-limiter-issues-7e38cf/client"
npx tsc --noEmit
```

Expected: 0 errors from the new file.

- [ ] **Step 3: Commit**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/rate-limiter-issues-7e38cf"
git add client/src/utils/mapboxOptimizationV2.ts
git commit -m "feat(client/mapbox): Optimization V2 API wrappers and shared types"
```

---

### Task 6: useOptimizationV2 Hook + Tests

**Files:**
- Create: `client/src/hooks/useOptimizationV2.ts`
- Create: `client/src/hooks/__tests__/useOptimizationV2.test.ts`

**Interfaces:**
- Consumes: `submitOptimizationJob`, `pollOptimizationJob`, all types from `client/src/utils/mapboxOptimizationV2.ts`
- Produces (consumed by Tasks 7 & 8):
  ```ts
  useOptimizationV2(): {
    submit(params: SubmitParams): Promise<void>
    status: OptimizationJobStatus
    solution: V2Solution | null
    elapsedMs: number
    error: string | null
    reset(): void
  }
  ```

- [ ] **Step 1: Write failing tests**

`client/src/hooks/__tests__/useOptimizationV2.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { useOptimizationV2 } from '../useOptimizationV2';

const BASE = 'http://localhost:8787';

const FAKE_JOB_ID = 'test-job-id-1234';
const SOLUTION = { dropped: { services: [], shipments: [] }, routes: [] };

let pollCount = 0;

const server = setupServer(
  http.post(`${BASE}/api/mapbox/optimization-v2/submit`, () =>
    HttpResponse.json({ job_id: FAKE_JOB_ID, status: 'pending' }, { status: 202 }),
  ),
  http.get(`${BASE}/api/mapbox/optimization-v2/${FAKE_JOB_ID}`, () => {
    pollCount += 1;
    if (pollCount < 3) return HttpResponse.json({ job_id: FAKE_JOB_ID, status: 'processing' });
    return HttpResponse.json({ job_id: FAKE_JOB_ID, status: 'complete', solution: SOLUTION });
  }),
);

beforeEach(() => { server.listen(); pollCount = 0; vi.useFakeTimers(); });
afterEach(() => { server.resetHandlers(); server.close(); vi.useRealTimers(); });

describe('useOptimizationV2', () => {
  it('starts idle', () => {
    const { result } = renderHook(() => useOptimizationV2());
    expect(result.current.status).toBe('idle');
    expect(result.current.solution).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('transitions: idle → pending → processing → complete', async () => {
    const { result } = renderHook(() => useOptimizationV2());

    await act(async () => {
      result.current.submit({
        job_type: 'multi_unit_dispatch',
        call_ids: [1],
        unit_ids: [1],
      });
    });

    // After submit resolves: status is pending or processing
    await waitFor(() => expect(['pending', 'processing']).toContain(result.current.status));

    // Advance timers to trigger 3 poll cycles (3s each)
    await act(async () => { vi.advanceTimersByTime(10_000); });

    await waitFor(() => expect(result.current.status).toBe('complete'));
    expect(result.current.solution).toEqual(SOLUTION);
    expect(result.current.error).toBeNull();
  });

  it('surfaces error when poll returns error status', async () => {
    server.use(
      http.get(`${BASE}/api/mapbox/optimization-v2/${FAKE_JOB_ID}`, () =>
        HttpResponse.json({ job_id: FAKE_JOB_ID, status: 'error', error: 'timed_out' }),
      ),
    );
    const { result } = renderHook(() => useOptimizationV2());
    await act(async () => { await result.current.submit({ job_type: 'multi_unit_dispatch', call_ids: [1], unit_ids: [1] }); });
    await act(async () => { vi.advanceTimersByTime(4_000); });
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('timed_out');
  });

  it('reset() returns to idle and clears solution', async () => {
    const { result } = renderHook(() => useOptimizationV2());
    await act(async () => { await result.current.submit({ job_type: 'multi_unit_dispatch', call_ids: [1], unit_ids: [1] }); });
    await act(async () => { vi.advanceTimersByTime(10_000); });
    await waitFor(() => expect(result.current.status).toBe('complete'));
    act(() => { result.current.reset(); });
    expect(result.current.status).toBe('idle');
    expect(result.current.solution).toBeNull();
  });

  it('elapsedMs increments while polling', async () => {
    const { result } = renderHook(() => useOptimizationV2());
    await act(async () => { await result.current.submit({ job_type: 'multi_unit_dispatch', call_ids: [1], unit_ids: [1] }); });
    await act(async () => { vi.advanceTimersByTime(6_000); });
    expect(result.current.elapsedMs).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/rate-limiter-issues-7e38cf/client"
npx vitest run src/hooks/__tests__/useOptimizationV2.test.ts
```

Expected: fail with "Cannot find module '../useOptimizationV2'".

- [ ] **Step 3: Implement the hook**

`client/src/hooks/useOptimizationV2.ts`:

```ts
import { useState, useRef, useCallback, useEffect } from 'react';
import {
  submitOptimizationJob,
  pollOptimizationJob,
  type SubmitParams,
  type OptimizationJobStatus,
  type V2Solution,
} from '../utils/mapboxOptimizationV2';

const POLL_INTERVAL_MS = 3_000;

export interface UseOptimizationV2 {
  submit(params: SubmitParams): Promise<void>;
  status: OptimizationJobStatus;
  solution: V2Solution | null;
  elapsedMs: number;
  error: string | null;
  reset(): void;
}

export function useOptimizationV2(): UseOptimizationV2 {
  const [status, setStatus] = useState<OptimizationJobStatus>('idle');
  const [solution, setSolution] = useState<V2Solution | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const jobIdRef = useRef<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startMsRef = useRef<number>(0);

  const clearPolling = useCallback(() => {
    if (intervalRef.current != null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    clearPolling();
    jobIdRef.current = null;
    setStatus('idle');
    setSolution(null);
    setElapsedMs(0);
    setError(null);
  }, [clearPolling]);

  // Clean up interval on unmount
  useEffect(() => () => { clearPolling(); }, [clearPolling]);

  const startPolling = useCallback((jobId: string) => {
    startMsRef.current = Date.now();

    intervalRef.current = setInterval(async () => {
      setElapsedMs(Date.now() - startMsRef.current);
      try {
        const result = await pollOptimizationJob(jobId);
        if (result.status === 'complete') {
          clearPolling();
          setSolution(result.solution ?? null);
          setStatus('complete');
        } else if (result.status === 'error') {
          clearPolling();
          setError(result.error ?? 'Unknown error');
          setStatus('error');
        } else {
          setStatus(result.status);
        }
      } catch {
        // Transient network error — keep polling
      }
    }, POLL_INTERVAL_MS);
  }, [clearPolling]);

  const submit = useCallback(async (params: SubmitParams) => {
    reset();
    setStatus('pending');
    try {
      const resp = await submitOptimizationJob(params);
      if (resp.skipped || !resp.job_id) {
        setError(resp.code ?? 'not_configured');
        setStatus('error');
        return;
      }
      jobIdRef.current = resp.job_id;
      setStatus('processing');
      startPolling(resp.job_id);
    } catch (err: any) {
      setError(err?.message ?? 'Submit failed');
      setStatus('error');
    }
  }, [reset, startPolling]);

  return { submit, status, solution, elapsedMs, error, reset };
}
```

- [ ] **Step 4: Run tests — expect passing**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/rate-limiter-issues-7e38cf/client"
npx vitest run src/hooks/__tests__/useOptimizationV2.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Full client suite + typecheck**

```bash
npx tsc --noEmit && npx vitest run
```

Expected: 0 typecheck errors, all tests pass.

- [ ] **Step 6: Commit**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/rate-limiter-issues-7e38cf"
git add client/src/hooks/useOptimizationV2.ts client/src/hooks/__tests__/useOptimizationV2.test.ts
git commit -m "feat(client): useOptimizationV2 hook with polling and status transitions"
```

---

### Task 7: ServePage V2 Upgrade

**Files:**
- Modify: `client/src/pages/ServePage.tsx` (locate the existing "Optimize Route" button and surrounding logic)

**Interfaces:**
- Consumes: `useOptimizationV2` from `client/src/hooks/useOptimizationV2.ts`

Before starting this task, read the current `ServePage.tsx` to understand how it calls the v1 optimization endpoint and how it reads `serve_routes`. The key things to find:
1. The `apiFetch('/mapbox/optimization'…)` call (or similar) — this is what you replace
2. How `optimized_order_json` is currently read and displayed
3. The current "Optimize Route" button JSX

- [ ] **Step 1: Read the relevant section of ServePage**

```bash
grep -n "optimization\|optimized_order\|Optimize\|optimiz" \
  "/Users/rmpgutah/RMPG Flex/.claude/worktrees/rate-limiter-issues-7e38cf/client/src/pages/ServePage.tsx" \
  | head -30
```

Note the line numbers of: (a) the v1 optimization call, (b) the Optimize Route button, (c) the `optimized_order_json` read.

- [ ] **Step 2: Add the hook import**

At the top of `ServePage.tsx`, add after the existing hook imports:

```tsx
import { useOptimizationV2 } from '../hooks/useOptimizationV2';
```

- [ ] **Step 3: Instantiate the hook inside the component**

Inside the `ServePage` component function, near the other `useState`/`useEffect` declarations, add:

```tsx
const optimization = useOptimizationV2();
```

- [ ] **Step 4: Replace the v1 optimization call**

Find the existing call to the v1 optimization endpoint (it will look like `apiFetch('/mapbox/optimization'…)` or a `getOptimizedRoute(…)` call from `mapboxServices.ts`). Replace the entire handler function with:

```tsx
// In the handler that fires when the user clicks "Optimize Route":
// You need to know: serveRouteId (the current serve_routes.id),
// officerUnitId (the current officer's unit id), and the serve queue IDs.
// These come from your existing page state — find them in the grep output.
const handleOptimizeRoute = async () => {
  if (!serveRouteId || !officerUnitId || !pendingServeIds.length) return;
  const now = new Date();
  const shiftStart = now.toISOString();
  const shiftEnd = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString(); // 8-hour default
  await optimization.submit({
    job_type: 'serve_run',
    serve_queue_ids: pendingServeIds,
    officer_unit_id: officerUnitId,
    shift_start: shiftStart,
    shift_end: shiftEnd,
    ref_id: serveRouteId,
  });
  // The hook polls until complete; when status === 'complete',
  // the Worker has already written back to serve_routes.
  // Refetch serve_routes to show the updated order:
  if (optimization.status === 'complete') {
    await refetchServeRoute(); // call your existing refetch function
  }
};
```

**Note:** `serveRouteId`, `officerUnitId`, `pendingServeIds`, and `refetchServeRoute` are names that exist in the current page — find the actual names from your grep output and substitute them.

- [ ] **Step 5: Replace the Optimize Route button JSX**

Find the existing Optimize Route button. Replace it with:

```tsx
<button
  onClick={handleOptimizeRoute}
  disabled={optimization.status === 'pending' || optimization.status === 'processing' || !pendingServeIds.length}
  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-rmpg-700 hover:bg-rmpg-600 text-rmpg-100 rounded-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
>
  {optimization.status === 'pending' || optimization.status === 'processing' ? (
    <>
      <span className="animate-spin inline-block w-3 h-3 border border-rmpg-400 border-t-transparent rounded-full" />
      Optimizing… {Math.round(optimization.elapsedMs / 1000)}s
    </>
  ) : (
    'Optimize Route'
  )}
</button>
{optimization.status === 'error' && (
  <span className="text-xs text-red-400 ml-2">
    {optimization.error === 'timed_out'
      ? 'Optimization timed out — try with fewer stops'
      : `Optimization failed: ${optimization.error}`}
  </span>
)}
```

- [ ] **Step 6: Add per-stop ETA badges**

Find where the serve stops are rendered in the route list. After each stop's address text, add:

```tsx
{/* Per-stop ETA from V2 solution */}
{optimization.status === 'complete' && optimization.solution && (() => {
  const route = optimization.solution.routes[0];
  if (!route) return null;
  const stop = route.stops.find((s) => s.location === String(stop.id) && s.type === 'service');
  if (!stop) return null;
  const eta = new Date(stop.eta);
  const timeStr = eta.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const isLate = stop.wait != null && stop.wait < 0; // negative wait = arrived past window
  return (
    <span className={`text-[10px] ml-1 ${isLate ? 'text-amber-400' : 'text-rmpg-300'}`}>
      ETA {timeStr}{isLate ? ' ⚠' : ''}
    </span>
  );
})()}
```

**Note:** `stop.id` refers to the serve_queue row id in your existing stop render — use the actual variable name from the component.

- [ ] **Step 7: After completing edits, refetch behaviour on completion**

Find where `optimization.status` can be observed (e.g., with `useEffect`) and add:

```tsx
useEffect(() => {
  if (optimization.status === 'complete') {
    refetchServeRoute(); // re-load serve_routes to get the V2-ordered list
  }
}, [optimization.status]); // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 8: Typecheck + full client suite**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/rate-limiter-issues-7e38cf/client"
npx tsc --noEmit && npx vitest run
```

Expected: 0 errors, all tests pass.

- [ ] **Step 9: Commit**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/rate-limiter-issues-7e38cf"
git add client/src/pages/ServePage.tsx
git commit -m "feat(serve): upgrade Optimize Route to Mapbox Optimization V2 with per-stop ETAs"
```

---

### Task 8: DispatchPage Optimize Assignments + PatrolBeatPlannerModal

**Files:**
- Modify: `client/src/pages/DispatchPage.tsx`
- Create: `client/src/components/PatrolBeatPlannerModal.tsx`
- Modify: `client/src/pages/MapPage.tsx`

**Interfaces:**
- Consumes: `useOptimizationV2`, all types from `client/src/utils/mapboxOptimizationV2.ts`

- [ ] **Step 1: Read current DispatchPage units panel**

```bash
grep -n "units.*panel\|Optimize\|supervisor\|admin\|available.*unit\|open.*call" \
  "/Users/rmpgutah/RMPG Flex/.claude/worktrees/rate-limiter-issues-7e38cf/client/src/pages/DispatchPage.tsx" \
  | head -20
```

Note where the units panel header is rendered and the role check pattern used.

- [ ] **Step 2: Add Optimize Assignments button to DispatchPage**

Import the hook at the top of `DispatchPage.tsx`:

```tsx
import { useOptimizationV2 } from '../hooks/useOptimizationV2';
import type { V2Route } from '../utils/mapboxOptimizationV2';
```

Inside the component, add:

```tsx
const dispatchOptimization = useOptimizationV2();
const [showAssignmentOverlay, setShowAssignmentOverlay] = useState(false);

const handleOptimizeAssignments = async () => {
  const availableUnitIds = units
    .filter((u: any) => ['available', 'on_scene'].includes(u.status))
    .map((u: any) => u.id);
  const openCallIds = calls
    .filter((c: any) => ['active', 'dispatched', 'pending'].includes(c.status))
    .map((c: any) => c.id);
  if (!availableUnitIds.length || !openCallIds.length) return;
  await dispatchOptimization.submit({
    job_type: 'multi_unit_dispatch',
    call_ids: openCallIds,
    unit_ids: availableUnitIds,
  });
};

useEffect(() => {
  if (dispatchOptimization.status === 'complete') setShowAssignmentOverlay(true);
}, [dispatchOptimization.status]);
```

**Note:** `units` and `calls` are the existing state variables in `DispatchPage` — use whatever names are in the file.

In the units panel header JSX (inside the supervisor/admin role guard that wraps the panel), add the button:

```tsx
{['admin', 'manager', 'supervisor'].includes(currentUser?.role ?? '') && (
  <button
    onClick={handleOptimizeAssignments}
    disabled={dispatchOptimization.status === 'pending' || dispatchOptimization.status === 'processing'}
    className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium bg-rmpg-700 hover:bg-rmpg-600 text-rmpg-100 rounded-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    title="Optimize unit-to-call assignments with Mapbox V2"
  >
    {dispatchOptimization.status === 'pending' || dispatchOptimization.status === 'processing'
      ? `Optimizing… ${Math.round(dispatchOptimization.elapsedMs / 1000)}s`
      : 'Optimize Assignments'}
  </button>
)}
```

Add the assignment overlay (dismissable, shows each vehicle's ordered call list):

```tsx
{showAssignmentOverlay && dispatchOptimization.solution && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
    <div className="bg-surface-base border border-rmpg-600 rounded-sm p-4 max-w-lg w-full mx-4 max-h-[80vh] flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-rmpg-100">Optimized Assignments</span>
        <button onClick={() => { setShowAssignmentOverlay(false); dispatchOptimization.reset(); }}
          className="text-rmpg-400 hover:text-rmpg-100 text-xs">Dismiss</button>
      </div>
      {dispatchOptimization.solution.dropped.services.length > 0 && (
        <div className="text-xs text-amber-400">
          ⚠ {dispatchOptimization.solution.dropped.services.length} call(s) could not be assigned
        </div>
      )}
      <div className="overflow-y-auto flex-1 space-y-3">
        {dispatchOptimization.solution.routes.map((route: V2Route) => (
          <div key={route.vehicle} className="bg-surface-raised rounded-sm p-2">
            <div className="text-xs font-semibold text-rmpg-200 mb-1">{route.vehicle}</div>
            {route.stops
              .filter((s) => s.type === 'service')
              .map((s, i) => (
                <div key={s.location} className="text-[11px] text-rmpg-300 py-0.5 flex gap-2">
                  <span className="text-rmpg-500">{i + 1}.</span>
                  <span>{s.location.replace('call-', 'Call #')}</span>
                  <span className="ml-auto text-rmpg-400">
                    {new Date(s.eta).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                  </span>
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 3: Create PatrolBeatPlannerModal**

`client/src/components/PatrolBeatPlannerModal.tsx`:

```tsx
import { useState, useEffect } from 'react';
import { apiFetch } from '../hooks/useApi';
import { useOptimizationV2 } from '../hooks/useOptimizationV2';
import type { V2Route } from '../utils/mapboxOptimizationV2';

interface Beat { id: number; beat_code: string; beat_name: string }
interface Unit { id: number; call_sign: string; status: string }

interface PatrolBeatPlannerModalProps {
  onClose(): void;
  onSolutionReady(routes: V2Route[]): void;
}

export default function PatrolBeatPlannerModal({ onClose, onSolutionReady }: PatrolBeatPlannerModalProps) {
  const [beats, setBeats] = useState<Beat[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [selectedBeatIds, setSelectedBeatIds] = useState<Set<number>>(new Set());
  const [selectedUnitIds, setSelectedUnitIds] = useState<Set<number>>(new Set());
  const [shiftStart, setShiftStart] = useState('');
  const [shiftEnd, setShiftEnd] = useState('');
  const optimization = useOptimizationV2();

  useEffect(() => {
    apiFetch<{ results: Beat[] }>('/dispatch/beats').then((r) => setBeats(r.results ?? [])).catch(() => {});
    apiFetch<Unit[]>('/dispatch/units').then((r) => setUnits(Array.isArray(r) ? r : [])).catch(() => {});
    // Default shift: today 07:00–15:00 Mountain
    const today = new Date().toISOString().split('T')[0];
    setShiftStart(`${today}T13:00:00Z`); // 07:00 MDT = 13:00 UTC
    setShiftEnd(`${today}T21:00:00Z`);   // 15:00 MDT = 21:00 UTC
  }, []);

  useEffect(() => {
    if (optimization.status === 'complete' && optimization.solution) {
      onSolutionReady(optimization.solution.routes);
    }
  }, [optimization.status, optimization.solution, onSolutionReady]);

  const canSubmit = selectedBeatIds.size > 0 && selectedUnitIds.size > 0 && shiftStart && shiftEnd
    && optimization.status !== 'pending' && optimization.status !== 'processing';

  const handleSubmit = () => {
    optimization.submit({
      job_type: 'patrol_beat',
      beat_ids: [...selectedBeatIds],
      unit_ids: [...selectedUnitIds],
      shift_start: shiftStart,
      shift_end: shiftEnd,
    });
  };

  const toggleBeat = (id: number) => setSelectedBeatIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggleUnit = (id: number) => setSelectedUnitIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-surface-base border border-rmpg-600 rounded-sm p-4 w-full max-w-md mx-4 max-h-[90vh] flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-rmpg-100">Patrol Beat Planner</span>
          <button onClick={onClose} className="text-rmpg-400 hover:text-rmpg-100 text-xs">✕</button>
        </div>

        <div className="grid grid-cols-2 gap-3 flex-1 overflow-hidden">
          <div className="flex flex-col gap-1 overflow-hidden">
            <span className="text-[11px] font-semibold text-[color:var(--field-label-color)]">Beats</span>
            <div className="overflow-y-auto flex-1 space-y-0.5">
              {beats.map((b) => (
                <label key={b.id} className="flex items-center gap-1.5 text-[11px] text-rmpg-300 cursor-pointer py-0.5">
                  <input type="checkbox" checked={selectedBeatIds.has(b.id)} onChange={() => toggleBeat(b.id)}
                    className="accent-rmpg-400" />
                  {b.beat_code} {b.beat_name}
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1 overflow-hidden">
            <span className="text-[11px] font-semibold text-[color:var(--field-label-color)]">Units</span>
            <div className="overflow-y-auto flex-1 space-y-0.5">
              {units.map((u) => (
                <label key={u.id} className="flex items-center gap-1.5 text-[11px] text-rmpg-300 cursor-pointer py-0.5">
                  <input type="checkbox" checked={selectedUnitIds.has(u.id)} onChange={() => toggleUnit(u.id)}
                    className="accent-rmpg-400" />
                  {u.call_sign}
                  <span className="text-rmpg-500">({u.status})</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-0.5">
            <label className="text-[10px] text-[color:var(--field-label-color)]">Shift Start (UTC)</label>
            <input type="datetime-local" value={shiftStart.slice(0, 16)} step={60}
              onChange={(e) => setShiftStart(e.target.value + ':00Z')}
              className="text-[11px] bg-surface-raised border border-rmpg-600 rounded-sm px-2 py-1 text-rmpg-200" />
          </div>
          <div className="flex flex-col gap-0.5">
            <label className="text-[10px] text-[color:var(--field-label-color)]">Shift End (UTC)</label>
            <input type="datetime-local" value={shiftEnd.slice(0, 16)} step={60}
              onChange={(e) => setShiftEnd(e.target.value + ':00Z')}
              className="text-[11px] bg-surface-raised border border-rmpg-600 rounded-sm px-2 py-1 text-rmpg-200" />
          </div>
        </div>

        {optimization.status === 'error' && (
          <div className="text-xs text-red-400">
            {optimization.error === 'timed_out'
              ? 'Optimization timed out — try fewer beats or units'
              : `Error: ${optimization.error}`}
          </div>
        )}

        {optimization.status === 'complete' && (
          <div className="text-xs text-green-400">
            Routes ready — {optimization.solution?.routes.length ?? 0} vehicle(s) assigned
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button onClick={onClose}
            className="px-3 py-1 text-xs text-rmpg-400 hover:text-rmpg-200 rounded-sm">
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={!canSubmit}
            className="px-3 py-1.5 text-xs font-medium bg-rmpg-600 hover:bg-rmpg-500 text-rmpg-100 rounded-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
            {optimization.status === 'pending' || optimization.status === 'processing'
              ? `Planning… ${Math.round(optimization.elapsedMs / 1000)}s`
              : 'Plan Beats'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add Beat Planner button to MapPage**

```bash
grep -n "toolbar\|ToolbarButton\|supervisor\|admin\|MapPage" \
  "/Users/rmpgutah/RMPG Flex/.claude/worktrees/rate-limiter-issues-7e38cf/client/src/pages/MapPage.tsx" \
  | head -20
```

Add to `MapPage.tsx`:

At the top imports:
```tsx
import PatrolBeatPlannerModal from '../components/PatrolBeatPlannerModal';
import type { V2Route } from '../utils/mapboxOptimizationV2';
```

Inside the component:
```tsx
const [showBeatPlanner, setShowBeatPlanner] = useState(false);
const [beatRoutes, setBeatRoutes] = useState<V2Route[] | null>(null);

const handleBeatSolution = (routes: V2Route[]) => {
  setBeatRoutes(routes);
  setShowBeatPlanner(false);
  // TODO Phase 2: draw route lines on the map per vehicle using beatRoutes
};
```

In the map toolbar JSX (inside a supervisor+ role guard):
```tsx
{['admin', 'manager', 'supervisor'].includes(currentUser?.role ?? '') && (
  <button
    onClick={() => setShowBeatPlanner(true)}
    className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium bg-rmpg-700 hover:bg-rmpg-600 text-rmpg-100 rounded-sm transition-colors"
    title="Optimize patrol beat assignments"
  >
    Beat Planner
  </button>
)}
{showBeatPlanner && (
  <PatrolBeatPlannerModal
    onClose={() => setShowBeatPlanner(false)}
    onSolutionReady={handleBeatSolution}
  />
)}
```

**Note:** `currentUser` is whatever the existing user context variable is called in `MapPage.tsx` — find it with `grep -n "role\|currentUser\|useAuth\|user\." client/src/pages/MapPage.tsx | head -10` and use the correct name.

- [ ] **Step 5: Typecheck + full client suite**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/rate-limiter-issues-7e38cf/client"
npx tsc --noEmit && npx vitest run
```

Expected: 0 errors, all tests pass.

- [ ] **Step 6: Full Worker typecheck + suite**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/rate-limiter-issues-7e38cf"
npm run typecheck && npx vitest run
```

Expected: 0 errors, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/DispatchPage.tsx \
        client/src/components/PatrolBeatPlannerModal.tsx \
        client/src/pages/MapPage.tsx
git commit -m "feat(dispatch/map): Optimize Assignments button and PatrolBeatPlannerModal"
```

---

## Post-Implementation Checklist

After all tasks are committed and PR is open:

- [ ] Apply migration to live D1: `scripts/apply-migration.sh 0254_mapbox_optimization_v2_jobs.sql`
- [ ] Verify migration landed: `npx wrangler d1 execute rmpg-flex --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name='mapbox_optimization_v2_jobs'"`
- [ ] Confirm `MAPBOX_ACCESS_TOKEN` Worker secret has Optimization V2 scope (test with `curl -X POST "https://api.mapbox.com/optimized-trips/v2?access_token=YOUR_TOKEN" -H "Content-Type: application/json" -d '{"version":1,"locations":[],"vehicles":[],"services":[]}'` — expect 422 not 401)
- [ ] Smoke test the submit endpoint: `POST /api/mapbox/optimization-v2/submit` with a minimal serve_run payload
- [ ] Confirm `GET /api/mapbox/optimization` (v1) still works — it must not be broken by the new router
