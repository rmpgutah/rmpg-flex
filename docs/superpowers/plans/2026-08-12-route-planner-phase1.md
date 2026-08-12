# Route Planner Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the Process Server Route Planner from straight-line geometric optimization to a real road-network optimizer with Mapbox Matrix API costs, traffic-aware ETAs, time-window enforcement, deadline-weighted sequencing, historical dwell-time learning, geocoding quality warnings, and mid-shift traffic suggestion.

**Architecture:** The existing `serveRouteOptimizer.ts` is upgraded to call the Mapbox Matrix API server-side (new `MAPBOX_SECRET_TOKEN` Worker secret) to build a real drive-time cost matrix; the nearest-neighbor + 2-opt solver runs on this matrix with deadline coefficients and time-window penalties applied as multipliers; a new polling endpoint (`POST /api/serve/route/traffic-check`) detects mid-shift traffic degradation and returns a re-optimized suggestion; the client renders ETAs, geocode warnings, and a dismissible traffic suggestion banner.

**Tech Stack:** Hono + Cloudflare Workers (D1, KV), Mapbox Matrix API v1, React 18 + TypeScript, Vitest (Node + Miniflare), Web Crypto API (SHA-256 hashing)

## Global Constraints

- Never hardcode hex colors — use CSS variable–backed Tailwind tokens
- All D1 queries must `await` the `.all()` / `.first()` / `.run()` call
- Secrets accessed via `c.env.MAPBOX_SECRET_TOKEN` — never in client bundle
- New D1 migrations must be idempotent (`CREATE TABLE IF NOT EXISTS`)
- Apply migrations to live D1 `785de7ae` via `scripts/apply-migration.sh` after merge
- `serve_queue` has 100-column D1 cap — `geocode_source` column goes via `ALTER TABLE` (exactly 1 column added, current count is safe)
- Run `npm run typecheck` after every Worker-side task; run `cd client && npx tsc --noEmit` after every client-side task
- Run `npx vitest run` (root) after every server task; run `cd client && npx vitest run` after every client task
- Company name in UI copy: Rocky Mountain Protective Group (RMPG only for brief refs)

---

## File Map

| File | Status | Responsibility |
|------|--------|---------------|
| `migrations/0240_serve_dwell_times.sql` | Create | `serve_dwell_times` table |
| `migrations/0241_serve_queue_geocode_source.sql` | Create | `geocode_source` column on `serve_queue` |
| `src/utils/serveRouteOptimizer.ts` | Modify | All optimizer logic: types, matrix, penalties, coefficients, dwell, geocode quality, traffic check |
| `src/routes/serve.ts` | Modify | Attempt logging endpoint — write dwell time on attempt |
| `src/routes/serveQueueEnhanced.ts` | Modify | Optimize endpoint response shape; add traffic-check endpoint |
| `tests/serveRouteOptimizer.test.ts` | Modify | Extend with all new optimizer function tests |
| `tests/serveDwellTimes.test.ts` | Create | Write-path bounds, read-path query, address hash |
| `client/src/components/serve/ServeRoutePlanner.tsx` | Modify | ETA display, geocode warning banner, traffic polling + suggestion banner |
| `client/src/components/serve/__tests__/ServeRoutePlanner.clustering.test.ts` | Modify | Geocode warning + traffic banner rendering tests |

---

### Task 1: D1 Migrations

**Files:**
- Create: `migrations/0240_serve_dwell_times.sql`
- Create: `migrations/0241_serve_queue_geocode_source.sql`

**Interfaces:**
- Produces: `serve_dwell_times(id, address_hash, defendant_type, dwell_seconds, logged_at)` table; `serve_queue.geocode_source` nullable TEXT column

---

- [ ] **Step 1: Create `0240_serve_dwell_times.sql`**

```sql
-- migrations/0240_serve_dwell_times.sql
CREATE TABLE IF NOT EXISTS serve_dwell_times (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address_hash TEXT NOT NULL,
  defendant_type TEXT NOT NULL CHECK(defendant_type IN ('individual','business')),
  dwell_seconds INTEGER NOT NULL CHECK(dwell_seconds > 30 AND dwell_seconds < 7200),
  logged_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sdt_address ON serve_dwell_times(address_hash);
```

- [ ] **Step 2: Create `0241_serve_queue_geocode_source.sql`**

```sql
-- migrations/0241_serve_queue_geocode_source.sql
ALTER TABLE serve_queue ADD COLUMN geocode_source TEXT;
```

- [ ] **Step 3: Apply migrations locally**

```bash
npm run migrate:local
```

Expected: both migrations apply without error. If `serve_dwell_times` already exists from a prior attempt, `CREATE TABLE IF NOT EXISTS` silences it. If `geocode_source` already exists, the Worker boot reconciler handles the duplicate-column error (consistent with CLAUDE.md pattern — `continue-on-error` on deploy).

- [ ] **Step 4: Verify schema**

```bash
npx wrangler d1 execute rmpg-flex --local --command "SELECT name FROM sqlite_master WHERE type='table' AND name='serve_dwell_times'"
npx wrangler d1 execute rmpg-flex --local --command "SELECT name FROM pragma_table_info('serve_queue') WHERE name='geocode_source'"
```

Expected: one row each.

- [ ] **Step 5: Commit**

```bash
git add migrations/0240_serve_dwell_times.sql migrations/0241_serve_queue_geocode_source.sql
git commit -m "feat(migrations): add serve_dwell_times table and geocode_source column (0240, 0241)"
```

---

### Task 2: RouteStop Types + Optimizer Skeleton

**Files:**
- Modify: `src/utils/serveRouteOptimizer.ts`

**Interfaces:**
- Produces:
  - `RouteStop` interface — all fields the optimizer needs per stop
  - `OptimizeResult` interface — what the endpoint returns
  - `TrafficCheckResult` interface — what the traffic-check endpoint returns
  - `haversineDistance(a, b): number` — fallback distance function
  - `haversineMatrix(stops): number[][]` — fallback matrix

---

- [ ] **Step 1: Read the current `serveRouteOptimizer.ts`**

```bash
cat src/utils/serveRouteOptimizer.ts
```

Note all exported functions and their current signatures — they will be preserved or extended, not removed.

- [ ] **Step 2: Write failing type tests in `tests/serveRouteOptimizer.test.ts`**

Open `tests/serveRouteOptimizer.test.ts` and add a new `describe` block at the top of the file (before existing tests):

```typescript
import type { RouteStop, OptimizeResult, TrafficCheckResult } from '../src/utils/serveRouteOptimizer';

describe('RouteStop type shape', () => {
  it('compiles with all required fields', () => {
    const stop: RouteStop = {
      jobId: 1,
      lat: 40.76,
      lng: -111.89,
      geocodeSource: 'point',
      deadlineAt: '2026-08-13T17:00:00Z',
      defendantType: 'individual',
      addressHash: 'abc123',
      defendant: 'Jane Smith',
      address: '123 Main St, Salt Lake City',
      locationNote: { serveStart: '08:00', serveEnd: '12:00' },
    };
    expect(stop.jobId).toBe(1);
  });
});

describe('haversineMatrix', () => {
  it('returns an n×n matrix of numbers', () => {
    const { haversineMatrix } = await import('../src/utils/serveRouteOptimizer');
    const stops: RouteStop[] = [
      { jobId: 1, lat: 40.76, lng: -111.89, geocodeSource: 'point', deadlineAt: null, defendantType: 'individual', addressHash: 'a', defendant: 'A', address: '1 A St', locationNote: null },
      { jobId: 2, lat: 40.77, lng: -111.88, geocodeSource: 'point', deadlineAt: null, defendantType: 'individual', addressHash: 'b', defendant: 'B', address: '2 B St', locationNote: null },
      { jobId: 3, lat: 40.78, lng: -111.87, geocodeSource: 'point', deadlineAt: null, defendantType: 'business', addressHash: 'c', defendant: 'C Corp', address: '3 C Ave', locationNote: null },
    ];
    const matrix = haversineMatrix(stops);
    expect(matrix).toHaveLength(3);
    expect(matrix[0]).toHaveLength(3);
    expect(matrix[0][0]).toBe(0);
    expect(matrix[0][1]).toBeGreaterThan(0);
    expect(matrix[1][0]).toBeCloseTo(matrix[0][1], 0);
  });
});
```

- [ ] **Step 3: Run — expect compile error (types not exported yet)**

```bash
npx vitest run tests/serveRouteOptimizer.test.ts
```

Expected: FAIL — "RouteStop" not exported

- [ ] **Step 4: Add types and haversine functions to `serveRouteOptimizer.ts`**

Add to the TOP of `src/utils/serveRouteOptimizer.ts` (before any existing code, which is preserved below):

```typescript
export interface RouteStop {
  jobId: number;
  lat: number;
  lng: number;
  geocodeSource: 'point' | 'centroid' | null;
  deadlineAt: string | null;
  defendantType: 'individual' | 'business';
  addressHash: string;
  defendant: string;
  address: string;
  locationNote: { serveStart: string | null; serveEnd: string | null } | null;
}

export interface GeocodeWarning {
  jobId: number;
  defendant: string;
  address: string;
  quality: 'low' | 'none';
}

export interface OptimizeResult {
  orderedStops: RouteStop[];
  etaPerStop: string[];
  matrixFallback: boolean;
  geocodeWarnings: GeocodeWarning[];
}

export interface TrafficCheckResult {
  degraded: boolean;
  addedMinutes: number;
  newOrder: RouteStop[];
  newEtas: string[];
  degradedSegments: Array<{ fromJobId: number; toJobId: number; addedSeconds: number }>;
  matrixFallback: boolean;
}

export function haversineDistance(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const x =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export function haversineMatrix(stops: Array<{ lat: number; lng: number }>): number[][] {
  return stops.map(a => stops.map(b => haversineDistance(a, b)));
}
```

- [ ] **Step 5: Run tests — expect pass**

```bash
npx vitest run tests/serveRouteOptimizer.test.ts
```

Expected: PASS for the two new describe blocks; all pre-existing tests still green.

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/utils/serveRouteOptimizer.ts tests/serveRouteOptimizer.test.ts
git commit -m "feat(optimizer): add RouteStop types and haversine matrix to serveRouteOptimizer"
```

---

### Task 3: Mapbox Matrix API — `buildCostMatrix()`

**Files:**
- Modify: `src/utils/serveRouteOptimizer.ts`
- Modify: `tests/serveRouteOptimizer.test.ts`

**Interfaces:**
- Consumes: `RouteStop[]`, `departAt: string`, `mapboxToken: string`
- Produces: `buildCostMatrix(stops, departAt, mapboxToken): Promise<{ matrix: number[][]; fallback: boolean }>`

---

- [ ] **Step 1: Write failing tests**

Add to `tests/serveRouteOptimizer.test.ts`:

```typescript
import { buildCostMatrix, haversineMatrix } from '../src/utils/serveRouteOptimizer';

const STOPS_3: RouteStop[] = [
  { jobId: 1, lat: 40.760, lng: -111.890, geocodeSource: 'point', deadlineAt: null, defendantType: 'individual', addressHash: 'a', defendant: 'A', address: '1 A St', locationNote: null },
  { jobId: 2, lat: 40.770, lng: -111.880, geocodeSource: 'point', deadlineAt: null, defendantType: 'individual', addressHash: 'b', defendant: 'B', address: '2 B St', locationNote: null },
  { jobId: 3, lat: 40.780, lng: -111.870, geocodeSource: 'point', deadlineAt: null, defendantType: 'business', addressHash: 'c', defendant: 'C Corp', address: '3 C Ave', locationNote: null },
];

describe('buildCostMatrix', () => {
  it('returns Mapbox duration matrix when API succeeds', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        durations: [
          [0, 120, 240],
          [120, 0, 120],
          [240, 120, 0],
        ],
      }),
    } as unknown as Response);

    const result = await buildCostMatrix(STOPS_3, '2026-08-12T07:00:00Z', 'sk.fake');
    expect(result.fallback).toBe(false);
    expect(result.matrix[0][1]).toBe(120);
    expect(result.matrix[1][2]).toBe(120);
  });

  it('falls back to haversine when API returns non-ok status', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 422,
    } as unknown as Response);

    const result = await buildCostMatrix(STOPS_3, '2026-08-12T07:00:00Z', 'sk.fake');
    expect(result.fallback).toBe(true);
    expect(result.matrix[0][0]).toBe(0);
    expect(result.matrix[0][1]).toBeGreaterThan(0);
  });

  it('falls back to haversine when token is empty string', async () => {
    global.fetch = vi.fn();
    const result = await buildCostMatrix(STOPS_3, '2026-08-12T07:00:00Z', '');
    expect(result.fallback).toBe(true);
    expect((global.fetch as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('chunks stops into ≤25-stop windows and merges', async () => {
    const bigStops: RouteStop[] = Array.from({ length: 26 }, (_, i) => ({
      jobId: i + 1,
      lat: 40.7 + i * 0.01,
      lng: -111.9 + i * 0.01,
      geocodeSource: 'point' as const,
      deadlineAt: null,
      defendantType: 'individual' as const,
      addressHash: String(i),
      defendant: `D${i}`,
      address: `${i} St`,
      locationNote: null,
    }));

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        durations: Array.from({ length: 25 }, (_, r) =>
          Array.from({ length: 25 }, (_, c) => (r === c ? 0 : 100))
        ),
      }),
    } as unknown as Response);

    const result = await buildCostMatrix(bigStops, '2026-08-12T07:00:00Z', 'sk.fake');
    expect(result.matrix).toHaveLength(26);
    expect(result.matrix[0]).toHaveLength(26);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run tests/serveRouteOptimizer.test.ts 2>&1 | grep -E 'FAIL|buildCostMatrix'
```

Expected: FAIL — `buildCostMatrix is not a function`

- [ ] **Step 3: Implement `buildCostMatrix()` in `src/utils/serveRouteOptimizer.ts`**

Add after the haversine functions:

```typescript
const MATRIX_CHUNK_SIZE = 25;

export async function buildCostMatrix(
  stops: RouteStop[],
  departAt: string,
  mapboxToken: string
): Promise<{ matrix: number[][]; fallback: boolean }> {
  if (!mapboxToken) {
    return { matrix: haversineMatrix(stops), fallback: true };
  }

  if (stops.length <= MATRIX_CHUNK_SIZE) {
    return fetchMatrixChunk(stops, departAt, mapboxToken);
  }

  // Chunk into overlapping 25-stop windows and merge
  const n = stops.length;
  const result: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  let fallback = false;

  for (let start = 0; start < n; start += MATRIX_CHUNK_SIZE) {
    const end = Math.min(start + MATRIX_CHUNK_SIZE, n);
    const chunk = stops.slice(start, end);
    const { matrix: chunkMatrix, fallback: chunkFallback } = await fetchMatrixChunk(
      chunk,
      departAt,
      mapboxToken
    );
    if (chunkFallback) fallback = true;
    for (let i = start; i < end; i++) {
      for (let j = start; j < end; j++) {
        result[i][j] = chunkMatrix[i - start][j - start];
      }
    }
    // Fill cross-chunk cells with haversine fallback
    for (let i = 0; i < start; i++) {
      for (let j = start; j < end; j++) {
        if (result[i][j] === 0 && i !== j) {
          result[i][j] = haversineDistance(stops[i], stops[j]);
          result[j][i] = result[i][j];
        }
      }
    }
  }
  return { matrix: result, fallback };
}

async function fetchMatrixChunk(
  stops: RouteStop[],
  departAt: string,
  mapboxToken: string
): Promise<{ matrix: number[][]; fallback: boolean }> {
  const coords = stops.map(s => `${s.lng},${s.lat}`).join(';');
  const url = new URL(
    `https://api.mapbox.com/directions-matrix/v1/mapbox/driving-traffic/${coords}`
  );
  url.searchParams.set('sources', 'all');
  url.searchParams.set('destinations', 'all');
  url.searchParams.set('depart_at', departAt);
  url.searchParams.set('access_token', mapboxToken);

  try {
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`Mapbox Matrix HTTP ${res.status}`);
    const data = await res.json<{ durations: number[][] }>();
    return { matrix: data.durations, fallback: false };
  } catch {
    return { matrix: haversineMatrix(stops), fallback: true };
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run tests/serveRouteOptimizer.test.ts
```

Expected: all `buildCostMatrix` tests PASS; all pre-existing tests still green.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/utils/serveRouteOptimizer.ts tests/serveRouteOptimizer.test.ts
git commit -m "feat(optimizer): Mapbox Matrix API cost matrix with haversine fallback and 25-stop chunking"
```

---

### Task 4: Time-Window Penalties + Deadline Coefficients + Solver Integration

**Files:**
- Modify: `src/utils/serveRouteOptimizer.ts`
- Modify: `tests/serveRouteOptimizer.test.ts`

**Interfaces:**
- Consumes: `number[][]` cost matrix, `RouteStop[]`, `departAt: string`, `now: Date`
- Produces:
  - `deadlineCoefficient(stop: RouteStop, now: Date): number`
  - `applyTimeWindowPenalties(matrix, stops, departAt, dwellSeconds): number[][]`
  - `nearestNeighborOrder(matrix, n): number[]`
  - `twoOpt(matrix, order): number[]`
  - `optimizeRoute(stops, matrix, departAt, now, dwellSeconds): number[]`

---

- [ ] **Step 1: Write failing tests**

Add to `tests/serveRouteOptimizer.test.ts`:

```typescript
import {
  deadlineCoefficient,
  applyTimeWindowPenalties,
  optimizeRoute,
} from '../src/utils/serveRouteOptimizer';

describe('deadlineCoefficient', () => {
  const now = new Date('2026-08-12T08:00:00Z');

  it('returns 1.0 for deadline > 72 hours away', () => {
    const stop = { ...STOPS_3[0], deadlineAt: '2026-08-15T10:00:00Z' };
    expect(deadlineCoefficient(stop, now)).toBe(1.0);
  });

  it('returns 0.7 for deadline 24–72 hours away', () => {
    const stop = { ...STOPS_3[0], deadlineAt: '2026-08-13T10:00:00Z' };
    expect(deadlineCoefficient(stop, now)).toBe(0.7);
  });

  it('returns 0.4 for deadline < 24 hours away', () => {
    const stop = { ...STOPS_3[0], deadlineAt: '2026-08-12T20:00:00Z' };
    expect(deadlineCoefficient(stop, now)).toBe(0.4);
  });

  it('returns 0.1 for past-deadline stop', () => {
    const stop = { ...STOPS_3[0], deadlineAt: '2026-08-11T08:00:00Z' };
    expect(deadlineCoefficient(stop, now)).toBe(0.1);
  });

  it('returns 1.0 when deadlineAt is null', () => {
    const stop = { ...STOPS_3[0], deadlineAt: null };
    expect(deadlineCoefficient(stop, now)).toBe(1.0);
  });
});

describe('applyTimeWindowPenalties', () => {
  it('adds penalty when projected arrival falls outside serve window', () => {
    const stops: RouteStop[] = [
      { ...STOPS_3[0], locationNote: null },
      {
        ...STOPS_3[1],
        locationNote: { serveStart: '08:00', serveEnd: '08:05' }, // extremely tight window
      },
    ];
    const matrix = [[0, 300], [300, 0]]; // 5 min travel
    const departAt = '2026-08-12T09:00:00-06:00'; // 9 AM MDT — arrives at stop[1] at 9:05, outside 08:00–08:05
    const penalized = applyTimeWindowPenalties(matrix, stops, departAt, [0, 0]);
    expect(penalized[0][1]).toBeGreaterThan(matrix[0][1]);
  });

  it('does not penalize stops with no location note', () => {
    const stops = STOPS_3.map(s => ({ ...s, locationNote: null }));
    const matrix = [[0, 300, 600], [300, 0, 300], [600, 300, 0]];
    const penalized = applyTimeWindowPenalties(matrix, stops, '2026-08-12T08:00:00Z', [0, 0, 0]);
    expect(penalized).toEqual(matrix);
  });
});

describe('optimizeRoute', () => {
  it('returns an ordering of all stop indices', () => {
    const matrix = [[0, 100, 200], [100, 0, 100], [200, 100, 0]];
    const now = new Date('2026-08-12T08:00:00Z');
    const order = optimizeRoute(STOPS_3, matrix, '2026-08-12T08:00:00Z', now, [300, 300, 600]);
    expect(order).toHaveLength(3);
    expect(new Set(order).size).toBe(3);
  });

  it('places a critically overdue stop first regardless of geometry', () => {
    const stops: RouteStop[] = [
      { ...STOPS_3[0], deadlineAt: null },
      { ...STOPS_3[1], deadlineAt: null },
      { ...STOPS_3[2], deadlineAt: '2026-08-11T00:00:00Z' }, // past deadline
    ];
    // matrix is symmetric and uniform — geometry alone would give [0,1,2]
    const matrix = [[0, 100, 100], [100, 0, 100], [100, 100, 0]];
    const now = new Date('2026-08-12T08:00:00Z');
    const order = optimizeRoute(stops, matrix, '2026-08-12T08:00:00Z', now, [0, 0, 0]);
    expect(order[0]).toBe(2); // overdue stop must be first
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run tests/serveRouteOptimizer.test.ts 2>&1 | grep -E 'FAIL|deadlineCoefficient|applyTimeWindow|optimizeRoute'
```

Expected: FAIL — functions not yet exported

- [ ] **Step 3: Implement in `src/utils/serveRouteOptimizer.ts`**

Add after `buildCostMatrix`:

```typescript
export function deadlineCoefficient(stop: RouteStop, now: Date): number {
  if (!stop.deadlineAt) return 1.0;
  const hoursRemaining =
    (new Date(stop.deadlineAt).getTime() - now.getTime()) / 3_600_000;
  if (hoursRemaining > 72) return 1.0;
  if (hoursRemaining > 24) return 0.7;
  if (hoursRemaining > 0) return 0.4;
  return 0.1;
}

function parseTimeOfDay(timeStr: string, referenceDate: string): number {
  const [h, m] = timeStr.split(':').map(Number);
  const d = new Date(referenceDate);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

export function applyTimeWindowPenalties(
  matrix: number[][],
  stops: RouteStop[],
  departAt: string,
  dwellSeconds: number[]
): number[][] {
  const n = stops.length;
  const flat = matrix.flat();
  const maxCost = Math.max(...flat.filter(v => isFinite(v)), 1);
  const PENALTY = 10 * maxCost;
  const result = matrix.map(row => [...row]);
  const departMs = new Date(departAt).getTime();

  for (let j = 0; j < n; j++) {
    const note = stops[j].locationNote;
    if (!note?.serveStart || !note?.serveEnd) continue;
    const windowStart = parseTimeOfDay(note.serveStart, departAt);
    const windowEnd = parseTimeOfDay(note.serveEnd, departAt);

    for (let i = 0; i < n; i++) {
      if (i === j) continue;
      const arrivalMs = departMs + matrix[i][j] * 1000;
      if (arrivalMs < windowStart || arrivalMs > windowEnd) {
        result[i][j] += PENALTY;
      }
    }
  }
  return result;
}

function nearestNeighborOrder(matrix: number[][], n: number): number[] {
  const visited = new Set<number>([0]);
  const order: number[] = [0];
  while (order.length < n) {
    const last = order[order.length - 1];
    let best = -1;
    let bestCost = Infinity;
    for (let j = 0; j < n; j++) {
      if (!visited.has(j) && matrix[last][j] < bestCost) {
        bestCost = matrix[last][j];
        best = j;
      }
    }
    order.push(best);
    visited.add(best);
  }
  return order;
}

function twoOpt(matrix: number[][], order: number[]): number[] {
  const n = order.length;
  let best = [...order];
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const nextJ = j + 1 < n ? j + 1 : 0;
        const before = matrix[best[i - 1]][best[i]] + matrix[best[j]][best[nextJ]];
        const after = matrix[best[i - 1]][best[j]] + matrix[best[i]][best[nextJ]];
        if (after < before - 0.001) {
          best = [
            ...best.slice(0, i),
            ...best.slice(i, j + 1).reverse(),
            ...best.slice(j + 1),
          ];
          improved = true;
        }
      }
    }
  }
  return best;
}

export function optimizeRoute(
  stops: RouteStop[],
  matrix: number[][],
  departAt: string,
  now: Date,
  dwellSeconds: number[]
): number[] {
  const n = stops.length;
  if (n === 0) return [];
  if (n === 1) return [0];

  // Apply deadline coefficients to matrix
  const weighted = matrix.map((row, i) =>
    row.map((cost, j) => cost * deadlineCoefficient(stops[j], now))
  );

  // Apply time-window penalties on top of weighted costs
  const penalized = applyTimeWindowPenalties(weighted, stops, departAt, dwellSeconds);

  const seed = nearestNeighborOrder(penalized, n);
  return twoOpt(penalized, seed);
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run tests/serveRouteOptimizer.test.ts
```

Expected: all new tests PASS; all pre-existing tests green.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/utils/serveRouteOptimizer.ts tests/serveRouteOptimizer.test.ts
git commit -m "feat(optimizer): deadline coefficients, time-window penalties, nearest-neighbor + 2-opt solver"
```

---

### Task 5: Dwell-Time Write Path

**Files:**
- Modify: `src/routes/serve.ts`
- Create: `tests/serveDwellTimes.test.ts`

**Interfaces:**
- Consumes: `POST /api/serve/:id/attempt` request body with optional `arrivedAt: string` (ISO timestamp)
- Produces: row inserted into `serve_dwell_times` when `arrivedAt` is valid and delta is 30–7200 s

---

- [ ] **Step 1: Write failing tests**

Create `tests/serveDwellTimes.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { hashAddress, shouldRecordDwell, dwellSeconds } from '../src/utils/serveRouteOptimizer';

describe('hashAddress', () => {
  it('normalizes and hashes an address to a 64-char hex string', async () => {
    const hash = await hashAddress('123 Main St, Salt Lake City');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it('produces the same hash for different-casing of the same address', async () => {
    const a = await hashAddress('123 MAIN ST, SALT LAKE CITY');
    const b = await hashAddress('  123 main st, salt lake city  ');
    expect(a).toBe(b);
  });
});

describe('shouldRecordDwell', () => {
  it('returns true for dwell of 31 seconds', () => {
    expect(shouldRecordDwell(31)).toBe(true);
  });

  it('returns false for dwell ≤ 30 seconds (GPS noise)', () => {
    expect(shouldRecordDwell(30)).toBe(false);
    expect(shouldRecordDwell(5)).toBe(false);
  });

  it('returns false for dwell ≥ 7200 seconds (forgotten app)', () => {
    expect(shouldRecordDwell(7200)).toBe(false);
    expect(shouldRecordDwell(9000)).toBe(false);
  });
});

describe('dwellSeconds', () => {
  it('computes positive delta between two ISO timestamps', () => {
    const arrived = '2026-08-12T09:00:00Z';
    const logged = '2026-08-12T09:07:30Z';
    expect(dwellSeconds(arrived, logged)).toBe(450);
  });

  it('returns 0 for identical timestamps', () => {
    const t = '2026-08-12T09:00:00Z';
    expect(dwellSeconds(t, t)).toBe(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run tests/serveDwellTimes.test.ts
```

Expected: FAIL — `hashAddress`, `shouldRecordDwell`, `dwellSeconds` not exported

- [ ] **Step 3: Add helper functions to `src/utils/serveRouteOptimizer.ts`**

Add after the existing exports:

```typescript
export async function hashAddress(address: string): Promise<string> {
  const normalized = address.toUpperCase().trim().replace(/\s+/g, ' ');
  const data = new TextEncoder().encode(normalized);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function shouldRecordDwell(seconds: number): boolean {
  return seconds > 30 && seconds < 7200;
}

export function dwellSeconds(arrivedAt: string, loggedAt: string): number {
  return Math.round(
    (new Date(loggedAt).getTime() - new Date(arrivedAt).getTime()) / 1000
  );
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run tests/serveDwellTimes.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Wire dwell-time write into the attempt logging endpoint in `src/routes/serve.ts`**

Find the `POST /:id/attempt` handler (search for `'/:id/attempt'` or `'/attempt'` in `src/routes/serve.ts`). Inside the handler, after the attempt INSERT succeeds, add:

```typescript
// Dwell-time learning — write path
const arrivedAt = body.arrivedAt as string | undefined;
if (arrivedAt) {
  const loggedAt = new Date().toISOString();
  const dwell = dwellSeconds(arrivedAt, loggedAt);
  if (shouldRecordDwell(dwell)) {
    const addrHash = await hashAddress(job.address ?? '');
    c.executionCtx.waitUntil(
      c.env.DB.prepare(
        'INSERT INTO serve_dwell_times (address_hash, defendant_type, dwell_seconds) VALUES (?, ?, ?)'
      )
        .bind(addrHash, job.defendant_type ?? 'individual', dwell)
        .run()
    );
  }
}
```

Add the import at the top of `src/routes/serve.ts`:

```typescript
import { hashAddress, shouldRecordDwell, dwellSeconds } from '../utils/serveRouteOptimizer';
```

(`job` here refers to the existing serve queue row already fetched by the handler to validate the attempt — check the exact variable name in the handler and use it.)

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/utils/serveRouteOptimizer.ts src/routes/serve.ts tests/serveDwellTimes.test.ts
git commit -m "feat(optimizer): dwell-time helpers + write path in attempt logging endpoint"
```

---

### Task 6: Dwell-Time Read Path + ETA Computation

**Files:**
- Modify: `src/utils/serveRouteOptimizer.ts`
- Modify: `tests/serveRouteOptimizer.test.ts`

**Interfaces:**
- Consumes: `D1Database`, `RouteStop[]`
- Produces:
  - `fetchDwellSeconds(db, stops): Promise<number[]>` — indexed parallel to `stops`
  - `computeEtas(orderedIndices, matrix, dwellSeconds, departAt): string[]`

---

- [ ] **Step 1: Write failing tests**

Add to `tests/serveRouteOptimizer.test.ts`:

```typescript
import { computeEtas } from '../src/utils/serveRouteOptimizer';

describe('computeEtas', () => {
  it('returns ISO timestamps advancing by travel + dwell time', () => {
    // orderedIndices [0, 1, 2], matrix with 5-min legs, dwell 5 min each
    const matrix = [[0, 300, 600], [300, 0, 300], [600, 300, 0]];
    const dwell = [300, 300, 300];
    const departAt = '2026-08-12T08:00:00.000Z';

    const etas = computeEtas([0, 1, 2], matrix, dwell, departAt);

    // stop 0: 0 travel + 300 dwell = 8:05
    expect(etas[0]).toBe('2026-08-12T08:05:00.000Z');
    // stop 1: 300 travel + 300 dwell = +10 min from stop 0 ETA = 8:15
    expect(etas[1]).toBe('2026-08-12T08:15:00.000Z');
    // stop 2: 300 travel + 300 dwell = +10 min = 8:25
    expect(etas[2]).toBe('2026-08-12T08:25:00.000Z');
  });

  it('handles single stop with no travel', () => {
    const matrix = [[0]];
    const etas = computeEtas([0], matrix, [600], '2026-08-12T08:00:00.000Z');
    expect(etas[0]).toBe('2026-08-12T08:10:00.000Z');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run tests/serveRouteOptimizer.test.ts 2>&1 | grep -E 'computeEtas'
```

Expected: FAIL — `computeEtas` not exported

- [ ] **Step 3: Implement in `src/utils/serveRouteOptimizer.ts`**

```typescript
export function computeEtas(
  orderedIndices: number[],
  matrix: number[][],
  dwellSeconds: number[],
  departAt: string
): string[] {
  const etas: string[] = [];
  let currentMs = new Date(departAt).getTime();
  for (let step = 0; step < orderedIndices.length; step++) {
    const idx = orderedIndices[step];
    const prevIdx = step === 0 ? -1 : orderedIndices[step - 1];
    const travelSeconds = step === 0 ? 0 : (matrix[prevIdx][idx] ?? 0);
    currentMs += (travelSeconds + (dwellSeconds[idx] ?? 0)) * 1000;
    etas.push(new Date(currentMs).toISOString());
  }
  return etas;
}

const DEFAULT_DWELL: Record<RouteStop['defendantType'], number> = {
  individual: 300,
  business: 600,
};

export async function fetchDwellSeconds(
  db: D1Database,
  stops: RouteStop[]
): Promise<number[]> {
  if (stops.length === 0) return [];

  const hashes = stops.map(s => s.addressHash);
  // D1 100-param cap — stops per run rarely exceed 25, but guard anyway
  const placeholders = hashes.map(() => '?').join(',');
  const rows = await db
    .prepare(
      `SELECT address_hash, CAST(AVG(dwell_seconds) AS INTEGER) AS avg_dwell
       FROM serve_dwell_times
       WHERE address_hash IN (${placeholders})
         AND logged_at > datetime('now', '-90 days')
       GROUP BY address_hash`
    )
    .bind(...hashes)
    .all<{ address_hash: string; avg_dwell: number }>();

  const byHash = new Map(rows.results.map(r => [r.address_hash, r.avg_dwell]));
  return stops.map(s => byHash.get(s.addressHash) ?? DEFAULT_DWELL[s.defendantType]);
}
```

Add `D1Database` to the imports at the top of the file (it comes from the `@cloudflare/workers-types` package already in the project):

```typescript
/// <reference types="@cloudflare/workers-types" />
```

Or, if the project already uses a global types reference, skip this line — check `src/types.ts` or `tsconfig.json` for how `D1Database` is currently resolved.

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run tests/serveRouteOptimizer.test.ts
```

Expected: all `computeEtas` tests PASS; full suite green.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/utils/serveRouteOptimizer.ts tests/serveRouteOptimizer.test.ts
git commit -m "feat(optimizer): fetchDwellSeconds read path and computeEtas with per-stop dwell time"
```

---

### Task 7: Geocode Quality + Updated Optimize Endpoint

**Files:**
- Modify: `src/utils/serveRouteOptimizer.ts`
- Modify: `src/routes/serveQueueEnhanced.ts`
- Modify: `tests/serveRouteOptimizer.test.ts`

**Interfaces:**
- Consumes: `RouteStop[]`
- Produces:
  - `geocodeQualityScore(stop): 'high' | 'low' | 'none'`
  - `collectGeocodeWarnings(stops): GeocodeWarning[]`
  - `optimizeRouteFullPipeline(stops, departAt, db, mapboxToken): Promise<OptimizeResult>` — the single entry point the endpoint calls

---

- [ ] **Step 1: Write failing tests**

Add to `tests/serveRouteOptimizer.test.ts`:

```typescript
import { geocodeQualityScore, collectGeocodeWarnings, optimizeRouteFullPipeline } from '../src/utils/serveRouteOptimizer';

describe('geocodeQualityScore', () => {
  it('returns high for point geocode', () => {
    expect(geocodeQualityScore({ ...STOPS_3[0], geocodeSource: 'point' })).toBe('high');
  });
  it('returns low for centroid geocode', () => {
    expect(geocodeQualityScore({ ...STOPS_3[0], geocodeSource: 'centroid' })).toBe('low');
  });
  it('returns none when geocodeSource is null', () => {
    expect(geocodeQualityScore({ ...STOPS_3[0], geocodeSource: null })).toBe('none');
  });
});

describe('collectGeocodeWarnings', () => {
  it('includes low and none stops, excludes high', () => {
    const stops: RouteStop[] = [
      { ...STOPS_3[0], geocodeSource: 'point' },
      { ...STOPS_3[1], geocodeSource: 'centroid' },
      { ...STOPS_3[2], geocodeSource: null },
    ];
    const warnings = collectGeocodeWarnings(stops);
    expect(warnings).toHaveLength(2);
    expect(warnings[0].jobId).toBe(2);
    expect(warnings[0].quality).toBe('low');
    expect(warnings[1].jobId).toBe(3);
    expect(warnings[1].quality).toBe('none');
  });

  it('returns empty array when all stops have high quality', () => {
    const stops = STOPS_3.map(s => ({ ...s, geocodeSource: 'point' as const }));
    expect(collectGeocodeWarnings(stops)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run tests/serveRouteOptimizer.test.ts 2>&1 | grep -E 'geocodeQualityScore|collectGeocodeWarnings'
```

Expected: FAIL — functions not exported

- [ ] **Step 3: Implement in `src/utils/serveRouteOptimizer.ts`**

```typescript
export function geocodeQualityScore(stop: RouteStop): 'high' | 'low' | 'none' {
  if (stop.geocodeSource === 'point') return 'high';
  if (stop.geocodeSource === 'centroid') return 'low';
  return 'none';
}

export function collectGeocodeWarnings(stops: RouteStop[]): GeocodeWarning[] {
  return stops
    .map(s => ({ stop: s, quality: geocodeQualityScore(s) }))
    .filter(({ quality }) => quality !== 'high')
    .map(({ stop, quality }) => ({
      jobId: stop.jobId,
      defendant: stop.defendant,
      address: stop.address,
      quality: quality as 'low' | 'none',
    }));
}

export async function optimizeRouteFullPipeline(
  stops: RouteStop[],
  departAt: string,
  db: D1Database,
  mapboxToken: string
): Promise<OptimizeResult> {
  const now = new Date();
  const geocodeWarnings = collectGeocodeWarnings(stops);
  const dwellSecs = await fetchDwellSeconds(db, stops);
  const { matrix, fallback } = await buildCostMatrix(stops, departAt, mapboxToken);
  const orderedIndices = optimizeRoute(stops, matrix, departAt, now, dwellSecs);
  const orderedStops = orderedIndices.map(i => stops[i]);
  const etaPerStop = computeEtas(orderedIndices, matrix, dwellSecs, departAt);

  return { orderedStops, etaPerStop, matrixFallback: fallback, geocodeWarnings };
}
```

- [ ] **Step 4: Update the optimize endpoint in `src/routes/serveQueueEnhanced.ts`**

Find the route handler for `POST .../optimize` or `POST .../route` (search for `'route'` or `'optimize'` in `serveQueueEnhanced.ts`). Replace its body with:

```typescript
import { optimizeRouteFullPipeline, RouteStop } from '../utils/serveRouteOptimizer';

// Inside the handler:
const body = await c.req.json<{
  stops: RouteStop[];
  departAt?: string;
}>();

const departAt = body.departAt ?? new Date().toISOString();
const mapboxToken = c.env.MAPBOX_SECRET_TOKEN ?? '';

const result = await optimizeRouteFullPipeline(
  body.stops,
  departAt,
  c.env.DB,
  mapboxToken
);

return c.json(result);
```

If `MAPBOX_SECRET_TOKEN` is not yet in the `Bindings` type (`src/types.ts`), add it:

```typescript
// In src/types.ts — find the Bindings or Env interface and add:
MAPBOX_SECRET_TOKEN: string;
```

- [ ] **Step 5: Run all tests — expect PASS**

```bash
npx vitest run tests/serveRouteOptimizer.test.ts tests/serveDwellTimes.test.ts
```

Expected: full suite green.

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/utils/serveRouteOptimizer.ts src/routes/serveQueueEnhanced.ts src/types.ts tests/serveRouteOptimizer.test.ts
git commit -m "feat(optimizer): geocode quality scoring, warnings collection, full pipeline entry point, endpoint wired"
```

---

### Task 8: Mid-Shift Traffic Suggestion — Server Side

**Files:**
- Modify: `src/utils/serveRouteOptimizer.ts`
- Modify: `src/routes/serveQueueEnhanced.ts`
- Modify: `tests/serveRouteOptimizer.test.ts`

**Interfaces:**
- Consumes: `remainingStops: RouteStop[]`, `currentOrder: number[]`, `currentPosition: {lat,lng}`, `originalEtas: string[]`, `db: D1Database`, `mapboxToken: string`
- Produces: `checkTrafficDegradation(...): Promise<TrafficCheckResult>` and `POST /api/serve/route/traffic-check`

---

- [ ] **Step 1: Write failing tests**

Add to `tests/serveRouteOptimizer.test.ts`:

```typescript
import { checkTrafficDegradation } from '../src/utils/serveRouteOptimizer';

describe('checkTrafficDegradation', () => {
  const origin = { lat: 40.755, lng: -111.895 };
  const originalEtas = [
    '2026-08-12T08:10:00Z',
    '2026-08-12T08:20:00Z',
    '2026-08-12T08:30:00Z',
  ];

  it('returns degraded:false when traffic is unchanged', async () => {
    // Matrix API returns same costs as original ETAs imply
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        durations: [
          [0, 300, 300, 300],   // origin row
          [300, 0, 300, 600],
          [300, 300, 0, 300],
          [300, 600, 300, 0],
        ],
      }),
    } as unknown as Response);

    const mockDb = {
      prepare: () => ({
        bind: () => ({
          all: async () => ({ results: [] }),
        }),
      }),
    } as unknown as D1Database;

    const result = await checkTrafficDegradation(
      STOPS_3,
      [0, 1, 2],
      origin,
      originalEtas,
      mockDb,
      'sk.fake'
    );
    expect(result.degraded).toBe(false);
    expect(result.addedMinutes).toBeLessThan(15);
  });

  it('returns degraded:true when total added time exceeds 15 minutes', async () => {
    // Matrix API returns costs 30 min worse on every segment
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        durations: [
          [0, 2100, 2100, 2100],   // origin: 35 min to each stop
          [2100, 0, 2100, 2100],
          [2100, 2100, 0, 2100],
          [2100, 2100, 2100, 0],
        ],
      }),
    } as unknown as Response);

    const mockDb = {
      prepare: () => ({
        bind: () => ({
          all: async () => ({ results: [] }),
        }),
      }),
    } as unknown as D1Database;

    const result = await checkTrafficDegradation(
      STOPS_3,
      [0, 1, 2],
      origin,
      originalEtas,
      mockDb,
      'sk.fake'
    );
    expect(result.degraded).toBe(true);
    expect(result.addedMinutes).toBeGreaterThanOrEqual(15);
  });

  it('returns matrixFallback:true and degraded:false when API fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response);

    const mockDb = {
      prepare: () => ({
        bind: () => ({
          all: async () => ({ results: [] }),
        }),
      }),
    } as unknown as D1Database;

    const result = await checkTrafficDegradation(
      STOPS_3,
      [0, 1, 2],
      origin,
      originalEtas,
      mockDb,
      'sk.fake'
    );
    expect(result.matrixFallback).toBe(true);
    expect(result.degraded).toBe(false); // suppress banner on fallback
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run tests/serveRouteOptimizer.test.ts 2>&1 | grep -E 'checkTrafficDegradation'
```

Expected: FAIL — function not exported

- [ ] **Step 3: Implement `checkTrafficDegradation()` in `src/utils/serveRouteOptimizer.ts`**

```typescript
const TRAFFIC_DEGRADE_THRESHOLD_S = 900;   // 15 min total
const TRAFFIC_SEGMENT_THRESHOLD_S = 600;   // 10 min per segment

export async function checkTrafficDegradation(
  remainingStops: RouteStop[],
  currentOrder: number[],
  currentPosition: { lat: number; lng: number },
  originalEtas: string[],
  db: D1Database,
  mapboxToken: string
): Promise<TrafficCheckResult> {
  const origin: RouteStop = {
    jobId: -1,
    lat: currentPosition.lat,
    lng: currentPosition.lng,
    geocodeSource: 'point',
    deadlineAt: null,
    defendantType: 'individual',
    addressHash: '',
    defendant: '__origin__',
    address: '',
    locationNote: null,
  };

  const allStops = [origin, ...remainingStops];
  const nowIso = new Date().toISOString();
  const { matrix, fallback } = await buildCostMatrix(allStops, nowIso, mapboxToken);

  if (fallback) {
    return {
      degraded: false,
      addedMinutes: 0,
      newOrder: currentOrder.map(i => remainingStops[i]),
      newEtas: originalEtas,
      degradedSegments: [],
      matrixFallback: true,
    };
  }

  // Reconstruct original per-segment durations from ETA timestamps
  const departMs = Date.now();
  const originalSegmentSeconds: number[] = currentOrder.map((stopIdx, step) => {
    if (step === 0) return (new Date(originalEtas[0]).getTime() - departMs) / 1000;
    return (
      (new Date(originalEtas[step]).getTime() - new Date(originalEtas[step - 1]).getTime()) / 1000
    );
  });

  // Compare new segment costs against original
  const degradedSegments: TrafficCheckResult['degradedSegments'] = [];
  let totalAddedSeconds = 0;

  for (let step = 0; step < currentOrder.length; step++) {
    const stopIdx = currentOrder[step];
    const matrixStopIdx = stopIdx + 1; // +1 because origin is [0] in allStops
    const prevMatrixIdx = step === 0 ? 0 : currentOrder[step - 1] + 1;
    const newCost = matrix[prevMatrixIdx][matrixStopIdx];
    const originalCost = originalSegmentSeconds[step];
    const added = newCost - originalCost;

    if (added > TRAFFIC_SEGMENT_THRESHOLD_S) {
      degradedSegments.push({
        fromJobId: step === 0 ? -1 : remainingStops[currentOrder[step - 1]].jobId,
        toJobId: remainingStops[stopIdx].jobId,
        addedSeconds: Math.round(added),
      });
    }
    totalAddedSeconds += Math.max(0, added);
  }

  const degraded = totalAddedSeconds > TRAFFIC_DEGRADE_THRESHOLD_S;

  // Re-optimize remaining stops with new traffic matrix if degraded
  const now = new Date();
  const dwellSecs = await fetchDwellSeconds(db, remainingStops);
  const remainingMatrix = matrix.slice(1).map(row => row.slice(1)); // strip origin row/col
  const newOrderIndices = degraded
    ? optimizeRoute(remainingStops, remainingMatrix, nowIso, now, dwellSecs)
    : currentOrder;

  const newOrder = newOrderIndices.map(i => remainingStops[i]);
  const newEtas = computeEtas(newOrderIndices, remainingMatrix, dwellSecs, nowIso);

  return {
    degraded,
    addedMinutes: Math.round(totalAddedSeconds / 60),
    newOrder,
    newEtas,
    degradedSegments,
    matrixFallback: false,
  };
}
```

- [ ] **Step 4: Add `POST /api/serve/route/traffic-check` endpoint to `src/routes/serveQueueEnhanced.ts`**

Add after the existing optimize route handler:

```typescript
import { checkTrafficDegradation, RouteStop, TrafficCheckResult } from '../utils/serveRouteOptimizer';

serveQueueEnhanced.post('/route/traffic-check', authMiddleware, async (c) => {
  const body = await c.req.json<{
    remainingStops: RouteStop[];
    currentOrder: number[];
    currentPosition: { lat: number; lng: number };
    originalEtas: string[];
  }>();

  const { remainingStops, currentOrder, currentPosition, originalEtas } = body;

  if (!remainingStops?.length) {
    return c.json<TrafficCheckResult>({
      degraded: false,
      addedMinutes: 0,
      newOrder: [],
      newEtas: [],
      degradedSegments: [],
      matrixFallback: false,
    });
  }

  const result = await checkTrafficDegradation(
    remainingStops,
    currentOrder,
    currentPosition,
    originalEtas,
    c.env.DB,
    c.env.MAPBOX_SECRET_TOKEN ?? ''
  );

  return c.json(result);
});
```

(Replace `serveQueueEnhanced` with the actual Hono app variable name used in that file — check the top of `serveQueueEnhanced.ts` to confirm.)

- [ ] **Step 5: Run all tests — expect PASS**

```bash
npx vitest run tests/serveRouteOptimizer.test.ts tests/serveDwellTimes.test.ts
```

Expected: all tests green including the 3 new `checkTrafficDegradation` tests.

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/utils/serveRouteOptimizer.ts src/routes/serveQueueEnhanced.ts tests/serveRouteOptimizer.test.ts
git commit -m "feat(optimizer): mid-shift traffic degradation detection and traffic-check endpoint"
```

---

### Task 9: Client — ETA Display + Geocode Warning Banner

**Files:**
- Modify: `client/src/components/serve/ServeRoutePlanner.tsx`
- Modify: `client/src/components/serve/__tests__/ServeRoutePlanner.clustering.test.ts`

**Interfaces:**
- Consumes: `OptimizeResult` from the API (`orderedStops`, `etaPerStop`, `matrixFallback`, `geocodeWarnings`)
- Produces: ETA timestamp rendered per stop; amber geocode warning banner with dismiss + verify link

---

- [ ] **Step 1: Read the current `ServeRoutePlanner.tsx`**

```bash
wc -l client/src/components/serve/ServeRoutePlanner.tsx
head -80 client/src/components/serve/ServeRoutePlanner.tsx
```

Identify: (a) the state variable holding ordered stops, (b) where the API response is consumed after route generation, (c) how each stop row is rendered.

- [ ] **Step 2: Write failing tests**

Open `client/src/components/serve/__tests__/ServeRoutePlanner.clustering.test.ts` and add a new `describe` block:

```typescript
describe('geocode warning banner', () => {
  it('renders amber banner when geocodeWarnings present', async () => {
    // Mock apiFetch to return a result with geocode warnings
    vi.mock('../../../hooks/useApi', () => ({
      apiFetch: vi.fn().mockResolvedValue({
        orderedStops: [],
        etaPerStop: [],
        matrixFallback: false,
        geocodeWarnings: [
          { jobId: 42, defendant: 'Jane Smith', address: 'Rural Rt 4', quality: 'low' },
        ],
      }),
    }));

    // Render ServeRoutePlanner in a state where route has been generated
    // (check the existing test setup in the file for the render pattern)
    // Assert:
    expect(screen.getByText(/unverified address/i)).toBeInTheDocument();
    expect(screen.getByText('Jane Smith')).toBeInTheDocument();
  });

  it('does not render geocode banner when warnings array is empty', async () => {
    vi.mock('../../../hooks/useApi', () => ({
      apiFetch: vi.fn().mockResolvedValue({
        orderedStops: [],
        etaPerStop: [],
        matrixFallback: false,
        geocodeWarnings: [],
      }),
    }));

    expect(screen.queryByText(/unverified address/i)).not.toBeInTheDocument();
  });

  it('renders matrixFallback notice when fallback is true', async () => {
    vi.mock('../../../hooks/useApi', () => ({
      apiFetch: vi.fn().mockResolvedValue({
        orderedStops: [],
        etaPerStop: [],
        matrixFallback: true,
        geocodeWarnings: [],
      }),
    }));

    expect(screen.getByText(/using estimated distances/i)).toBeInTheDocument();
  });
});
```

(Adapt the render call to match the existing test setup in the file — look at how other tests in that file render the component and reuse that pattern.)

- [ ] **Step 3: Run — expect FAIL**

```bash
cd client && npx vitest run src/components/serve/__tests__/ServeRoutePlanner.clustering.test.ts
```

Expected: FAIL — banner text not found

- [ ] **Step 4: Update `ServeRoutePlanner.tsx`**

**Step 4a — extend state:**

```typescript
// Add alongside existing route state:
const [etaPerStop, setEtaPerStop] = useState<string[]>([]);
const [geocodeWarnings, setGeocodeWarnings] = useState<Array<{
  jobId: number;
  defendant: string;
  address: string;
  quality: 'low' | 'none';
}>>([]);
const [matrixFallback, setMatrixFallback] = useState(false);
const [geocodeWarningDismissed, setGeocodeWarningDismissed] = useState(false);
```

**Step 4b — consume the extended API response:**

Find where the optimize API result is assigned to state (the `apiFetch` call for route generation). Extend:

```typescript
// After: setOrderedStops(result.orderedStops)
setEtaPerStop(result.etaPerStop ?? []);
setGeocodeWarnings(result.geocodeWarnings ?? []);
setMatrixFallback(result.matrixFallback ?? false);
setGeocodeWarningDismissed(false);
```

**Step 4c — add ETA display per stop row:**

In the stop list render, find the JSX that renders each stop. Add after the stop address/name:

```tsx
{etaPerStop[index] && (
  <span className="text-xs text-rmpg-300 tabular-nums">
    ETA {new Date(etaPerStop[index]).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/Denver',
    })}
  </span>
)}
```

**Step 4d — add geocode warning banner:**

Add above the stop list, inside the route panel:

```tsx
{matrixFallback && (
  <div className="rounded px-3 py-2 text-xs bg-amber-900/30 text-amber-300 border border-amber-700/40">
    Route distances are estimated — traffic data unavailable.
  </div>
)}

{!geocodeWarningDismissed && geocodeWarnings.length > 0 && (
  <div className="rounded px-3 py-2 text-xs bg-amber-900/30 text-amber-300 border border-amber-700/40 space-y-1">
    <div className="flex items-center justify-between">
      <span className="font-semibold">
        {geocodeWarnings.length} stop{geocodeWarnings.length > 1 ? 's' : ''} with unverified address
        {geocodeWarnings.length > 1 ? 'es' : ''} — route generated but pins may be inaccurate.
      </span>
      <button
        onClick={() => setGeocodeWarningDismissed(true)}
        className="ml-2 text-amber-400 hover:text-amber-200"
        aria-label="Dismiss geocode warning"
      >
        ✕
      </button>
    </div>
    {geocodeWarnings.map(w => (
      <div key={w.jobId} className="flex items-center justify-between">
        <span>{w.defendant} — {w.address}</span>
        <button
          onClick={() => onVerifyAddress?.(w.jobId)}
          className="text-accent-gold-300 hover:underline text-xs"
        >
          Verify →
        </button>
      </div>
    ))}
  </div>
)}
```

Add `onVerifyAddress?: (jobId: number) => void` to the component's props interface. Wire it in `ServePage.tsx` to open the existing serve job edit modal for that jobId.

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd client && npx vitest run src/components/serve/__tests__/ServeRoutePlanner.clustering.test.ts
```

Expected: all new tests PASS; existing clustering tests still green.

- [ ] **Step 6: Typecheck**

```bash
cd client && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add client/src/components/serve/ServeRoutePlanner.tsx \
        client/src/components/serve/__tests__/ServeRoutePlanner.clustering.test.ts
git commit -m "feat(serve-ui): ETA per stop display, geocode warning banner, matrix fallback notice"
```

---

### Task 10: Client — Mid-Shift Traffic Polling + Suggestion Banner

**Files:**
- Modify: `client/src/components/serve/ServeRoutePlanner.tsx`
- Modify: `client/src/components/serve/__tests__/ServeRoutePlanner.clustering.test.ts`

**Interfaces:**
- Consumes: `POST /api/serve/route/traffic-check` → `TrafficCheckResult`
- Produces: 10-min polling effect; amber traffic suggestion banner with Accept / Dismiss; polling stops when all remaining stops are completed

---

- [ ] **Step 1: Write failing tests**

Add to `client/src/components/serve/__tests__/ServeRoutePlanner.clustering.test.ts`:

```typescript
describe('traffic suggestion banner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows traffic banner after 10 minutes when degraded:true', async () => {
    // Set up: component has an accepted route (routeAccepted = true)
    // Mock the traffic-check endpoint to return degraded:true
    vi.mock('../../../hooks/useApi', () => ({
      apiFetch: vi.fn()
        .mockResolvedValueOnce({ /* initial optimize result */ orderedStops: [STOP_A, STOP_B], etaPerStop: [], matrixFallback: false, geocodeWarnings: [] })
        .mockResolvedValueOnce({ /* traffic-check */ degraded: true, addedMinutes: 22, newOrder: [STOP_B, STOP_A], newEtas: [], degradedSegments: [], matrixFallback: false }),
    }));

    // render component, generate route, accept it
    // advance timer 10 minutes
    vi.advanceTimersByTime(600_000);
    await vi.runAllTimersAsync();

    expect(screen.getByText(/traffic has changed/i)).toBeInTheDocument();
    expect(screen.getByText(/\+22 min/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /accept updated route/i })).toBeInTheDocument();
  });

  it('does not show banner when degraded:false', async () => {
    vi.mock('../../../hooks/useApi', () => ({
      apiFetch: vi.fn()
        .mockResolvedValueOnce({ orderedStops: [], etaPerStop: [], matrixFallback: false, geocodeWarnings: [] })
        .mockResolvedValueOnce({ degraded: false, addedMinutes: 3, newOrder: [], newEtas: [], degradedSegments: [], matrixFallback: false }),
    }));

    vi.advanceTimersByTime(600_000);
    await vi.runAllTimersAsync();

    expect(screen.queryByText(/traffic has changed/i)).not.toBeInTheDocument();
  });

  it('suppresses banner when matrixFallback:true on traffic check', async () => {
    vi.mock('../../../hooks/useApi', () => ({
      apiFetch: vi.fn()
        .mockResolvedValueOnce({ orderedStops: [], etaPerStop: [], matrixFallback: false, geocodeWarnings: [] })
        .mockResolvedValueOnce({ degraded: true, addedMinutes: 20, newOrder: [], newEtas: [], degradedSegments: [], matrixFallback: true }),
    }));

    vi.advanceTimersByTime(600_000);
    await vi.runAllTimersAsync();

    expect(screen.queryByText(/traffic has changed/i)).not.toBeInTheDocument();
  });

  it('accepting updated route replaces stop order and clears banner', async () => {
    // Banner visible → click Accept → banner gone, stop order updated
    // assert screen.queryByText(/traffic has changed/i) is null after click
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd client && npx vitest run src/components/serve/__tests__/ServeRoutePlanner.clustering.test.ts 2>&1 | grep -E 'traffic'
```

Expected: FAIL — banner not rendered

- [ ] **Step 3: Add polling + banner to `ServeRoutePlanner.tsx`**

**Step 3a — add traffic suggestion state:**

```typescript
const [trafficSuggestion, setTrafficSuggestion] = useState<{
  addedMinutes: number;
  newOrder: typeof orderedStops;
  newEtas: string[];
} | null>(null);
const [routeAccepted, setRouteAccepted] = useState(false);
```

Mark `setRouteAccepted(true)` when the officer taps an "Accept Route" / "Start Route" button (check for the existing route-acceptance action in the component and hook into it).

**Step 3b — polling effect:**

```typescript
const POLL_INTERVAL_MS = 600_000; // 10 minutes

useEffect(() => {
  if (!routeAccepted || orderedStops.length === 0) return;

  const allCompleted = orderedStops.every(
    s => s.status === 'served' || s.status === 'archived' || s.status === 'non_service'
  );
  if (allCompleted) return;

  const check = async () => {
    try {
      const position = await new Promise<GeolocationPosition>((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 })
      );
      const result = await apiFetch<{
        degraded: boolean;
        addedMinutes: number;
        newOrder: typeof orderedStops;
        newEtas: string[];
        matrixFallback: boolean;
      }>('/api/serve/route/traffic-check', {
        method: 'POST',
        body: JSON.stringify({
          remainingStops: orderedStops.filter(
            s => s.status !== 'served' && s.status !== 'archived' && s.status !== 'non_service'
          ),
          currentOrder: orderedStops
            .map((s, i) => i)
            .filter(i => {
              const s = orderedStops[i];
              return s.status !== 'served' && s.status !== 'archived' && s.status !== 'non_service';
            }),
          currentPosition: {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          },
          originalEtas: etaPerStop,
        }),
      });

      if (result.degraded && !result.matrixFallback) {
        setTrafficSuggestion({
          addedMinutes: result.addedMinutes,
          newOrder: result.newOrder,
          newEtas: result.newEtas,
        });
      }
    } catch {
      // geolocation denied or network error — skip silently
    }
  };

  const id = setInterval(check, POLL_INTERVAL_MS);
  return () => clearInterval(id);
}, [routeAccepted, orderedStops, etaPerStop]);
```

**Step 3c — traffic suggestion banner JSX:**

Add above the geocode warning banner:

```tsx
{trafficSuggestion && (
  <div className="rounded px-3 py-2 text-xs bg-amber-900/30 text-amber-300 border border-amber-700/40 space-y-2">
    <div className="flex items-center justify-between">
      <span className="font-semibold">
        Traffic has changed — route is now +{trafficSuggestion.addedMinutes} min behind schedule.
      </span>
      <button
        onClick={() => setTrafficSuggestion(null)}
        className="ml-2 text-amber-400 hover:text-amber-200"
        aria-label="Dismiss traffic suggestion"
      >
        ✕
      </button>
    </div>
    <div className="flex gap-2">
      <button
        onClick={() => {
          setOrderedStops(trafficSuggestion.newOrder);
          setEtaPerStop(trafficSuggestion.newEtas);
          setTrafficSuggestion(null);
        }}
        className="rounded bg-amber-700/50 hover:bg-amber-700/70 px-2 py-1 text-amber-100 font-semibold"
      >
        Accept Updated Route
      </button>
      <button
        onClick={() => setTrafficSuggestion(null)}
        className="rounded px-2 py-1 text-amber-400 hover:text-amber-200"
      >
        Dismiss
      </button>
    </div>
  </div>
)}
```

- [ ] **Step 4: Run full client test suite**

```bash
cd client && npx vitest run
```

Expected: all tests pass including all new traffic banner tests.

- [ ] **Step 5: Typecheck**

```bash
cd client && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 6: Run full Worker test suite**

```bash
npx vitest run
```

Expected: all 3400+ tests pass.

- [ ] **Step 7: Commit**

```bash
git add client/src/components/serve/ServeRoutePlanner.tsx \
        client/src/components/serve/__tests__/ServeRoutePlanner.clustering.test.ts
git commit -m "feat(serve-ui): mid-shift traffic polling, degradation detection banner, accept/dismiss flow"
```

---

## Post-Merge Deployment Steps

Run these after the PR merges to main and CI deploys:

```bash
# 1. Set the new secret
wrangler secret put MAPBOX_SECRET_TOKEN
# Paste the Mapbox secret token (sk.ey...) when prompted

# 2. Apply migrations to live D1
scripts/apply-migration.sh migrations/0240_serve_dwell_times.sql
scripts/apply-migration.sh migrations/0241_serve_queue_geocode_source.sql

# 3. Verify schema landed
npx wrangler d1 execute rmpg-flex --remote --command \
  "SELECT name FROM sqlite_master WHERE type='table' AND name='serve_dwell_times'"
npx wrangler d1 execute rmpg-flex --remote --command \
  "SELECT name FROM pragma_table_info('serve_queue') WHERE name='geocode_source'"

# 4. Smoke test the optimize endpoint (browser — WAF blocks curl)
# Open https://rmpgutah.us, log in, open Process Server → Route Planner,
# generate a route, confirm etaPerStop values appear per stop.

# 5. Confirm matrixFallback is false in the browser DevTools Network tab
# (Response should include "matrixFallback": false)

# 6. Add MAPBOX_SECRET_TOKEN to local .dev.vars for dev server testing
echo "MAPBOX_SECRET_TOKEN=sk.ey..." >> .dev.vars
```
