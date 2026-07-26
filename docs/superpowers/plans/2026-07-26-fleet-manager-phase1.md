# Fleet Manager Phase 1 (Correctness / a11y / Theme) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the nine confirmed correctness, accessibility, and theme defects on `/fleet` without moving any code, so the page tells the truth about the data it shows and no failure is invisible.

**Architecture:** The Worker's `GET /fleet/analytics` gains an optional `?vehicle_id=` filter built through a pure, unit-tested helper module (mirroring how `src/utils/fleetViz.ts` backs `fleetViz.ts` routes). The client then requests the scoped variant for the per-vehicle Analytics tab and renders a scope banner plus a fleet-comparison band. Every remaining fix is a local edit inside `client/src/pages/fleet/FleetPage.tsx` — no hooks are extracted and no files move (that is Phase 2).

**Tech Stack:** Hono on Cloudflare Workers, D1, React 18 + TypeScript + Vite 6 + Tailwind, Vitest + @testing-library/react.

**Spec:** [`docs/superpowers/specs/2026-07-26-fleet-manager-hardening-design.md`](../specs/2026-07-26-fleet-manager-hardening-design.md)

## Global Constraints

- **Never hardcode hex.** Colors come from CSS-variable-backed Tailwind tokens. The one exception in scope: existing severity/status literals (`STATUS_COLOR`, utilization band colors) are fixed CAD semantics and must be left alone.
- **`#d4a017` is banned** in the blue-silver theme block: fails WCAG AA (4.50 / 3.57 / 5.41) and has a 1.11 luminance ratio to `--sev-warn`, making it confusable with a real alert.
- **Gold has exactly two roles**, `--field-label-color` (field labels) and `--panel-header-color` (section/panel headers). A tab is neither. Tabs use the **silver** ramp. Never write a raw `text-accent-gold-*` class in a component.
- **`brand-gold-*` Tailwind classes render SILVER** — a deliberate compat alias consumed by ~500 files. Do not "fix" it.
- **Radius is 2px everywhere.** Never `rounded-lg`.
- **All D1 `.first()` / `.all()` / `.run()` are async** — always `await`.
- **Never `SELECT v.*`** from `calls_for_service` (100 cols) or `persons` (94 cols) — D1 caps SELECT result sets at ~100 columns.
- **User input goes in `?` binds, never string interpolation.** The existing period fragments are interpolated because they come from a closed whitelist; `vehicle_id` is user input and must be bound.
- **Run the FULL client suite**, not targeted tests, before landing. The measured baseline is clean on all gates, so any failure is caused by the change in hand.
- **Fresh-worktree prerequisite:** `cd client && npm install --legacy-peer-deps` before any client `tsc`, or `tsc` reports ~97,000 phantom `Cannot find module` errors.

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/utils/fleetAnalyticsScope.ts` | Pure helpers: parse + validate `vehicle_id`, build the SQL predicate and binds | Create |
| `tests/fleetAnalyticsScope.test.ts` | Unit tests for the above | Create |
| `src/routes/fleet.ts` | Wire the scope into `GET /analytics`; add `scope`, `fleet_comparison`, `omitted_for_vehicle_scope` | Modify |
| `client/src/types/index.ts` | Extend `FleetAnalytics` with the three new fields | Modify |
| `client/src/pages/fleet/FleetPage.tsx` | Findings 1, 2, 3, 4, 5, 6, 7, 8, 9 | Modify |
| `client/src/pages/fleet/tabs/FleetAnalyticsTab.tsx` | Scope banner, comparison band, hide fleet-only cards when scoped | Modify |
| `client/src/pages/fleet/__tests__/FleetPage.phase1.test.tsx` | Client regression tests for findings 3, 4, 6, 7 | Create |
| `client/src/pages/fleet/tabs/__tests__/FleetAnalyticsTab.scope.test.tsx` | Scope banner + rollout tolerance | Create |

---

### Task 1: Pure vehicle-scope helper for fleet analytics

**Files:**
- Create: `src/utils/fleetAnalyticsScope.ts`
- Test: `tests/fleetAnalyticsScope.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `parseVehicleScope(raw: string | undefined | null): number | null`
  - `scopeAnd(column: string, vehicleId: number | null): string`
  - `scopeBinds(vehicleId: number | null, times?: number): number[]`
  - `type AnalyticsScope = 'vehicle' | 'fleet'`
  - `FLEET_ONLY_BLOCKS: readonly string[]`

- [ ] **Step 1: Write the failing test**

Create `tests/fleetAnalyticsScope.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  parseVehicleScope,
  scopeAnd,
  scopeBinds,
  FLEET_ONLY_BLOCKS,
} from '../src/utils/fleetAnalyticsScope';

describe('parseVehicleScope', () => {
  it('returns the id for a positive integer string', () => {
    expect(parseVehicleScope('42')).toBe(42);
  });

  it('returns null for absent input (fleet-wide is the default)', () => {
    expect(parseVehicleScope(undefined)).toBeNull();
    expect(parseVehicleScope(null)).toBeNull();
    expect(parseVehicleScope('')).toBeNull();
  });

  it('rejects non-numeric input rather than binding NaN', () => {
    expect(parseVehicleScope('abc')).toBeNull();
    expect(parseVehicleScope('7; DROP TABLE fleet_vehicles')).toBeNull();
  });

  it('rejects zero, negatives, and floats — ids are positive integers', () => {
    expect(parseVehicleScope('0')).toBeNull();
    expect(parseVehicleScope('-3')).toBeNull();
    expect(parseVehicleScope('4.5')).toBeNull();
  });

  it('rejects Infinity', () => {
    expect(parseVehicleScope('Infinity')).toBeNull();
  });
});

describe('scopeAnd', () => {
  it('emits a bound predicate when scoped', () => {
    expect(scopeAnd('vehicle_id', 42)).toBe('AND vehicle_id = ?');
  });

  it('emits an empty string when fleet-wide, leaving the query unchanged', () => {
    expect(scopeAnd('vehicle_id', null)).toBe('');
  });

  it('never interpolates the id into the SQL text', () => {
    expect(scopeAnd('vehicle_id', 42)).not.toContain('42');
  });

  it('supports a qualified column for joined queries', () => {
    expect(scopeAnd('fv.id', 7)).toBe('AND fv.id = ?');
  });
});

describe('scopeBinds', () => {
  it('returns one bind per predicate when scoped', () => {
    expect(scopeBinds(42)).toEqual([42]);
    expect(scopeBinds(42, 3)).toEqual([42, 42, 42]);
  });

  it('returns no binds when fleet-wide', () => {
    expect(scopeBinds(null)).toEqual([]);
    expect(scopeBinds(null, 3)).toEqual([]);
  });
});

describe('FLEET_ONLY_BLOCKS', () => {
  it('names the blocks that are meaningless for a single vehicle', () => {
    expect(FLEET_ONLY_BLOCKS).toContain('mileage_distribution');
    expect(FLEET_ONLY_BLOCKS).toContain('status_breakdown');
    expect(FLEET_ONLY_BLOCKS).toContain('utilization');
    expect(FLEET_ONLY_BLOCKS).toContain('service_compliance');
    expect(FLEET_ONLY_BLOCKS).toContain('cost_per_mile_ranking');
    expect(FLEET_ONLY_BLOCKS).toContain('fuel_economy_ranking');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/fleetAnalyticsScope.test.ts
```

Expected: FAIL — `Failed to resolve import "../src/utils/fleetAnalyticsScope"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/utils/fleetAnalyticsScope.ts`:

```ts
// ============================================================
// RMPG Flex — Fleet analytics vehicle-scope helpers
//
// GET /api/fleet/analytics serves two audiences: the fleet-wide
// dashboard (no ?vehicle_id) and the per-vehicle Analytics tab
// (?vehicle_id=N). Before this module the per-vehicle tab rendered
// fleet aggregates under per-vehicle labels.
//
// These helpers are pure so they can be unit-tested without D1 or
// Miniflare — the same split used by src/utils/fleetViz.ts.
//
// SECURITY: vehicle_id is user input, so it is always emitted as a
// `?` bind, never interpolated. parseVehicleScope is the only gate;
// anything it cannot prove is a positive integer becomes null
// (fleet-wide), which is the safe default rather than an error.
// ============================================================

export type AnalyticsScope = 'vehicle' | 'fleet';

/**
 * Blocks that describe a FLEET and carry no meaning for one vehicle
 * (a single vehicle's "status breakdown" is just its status). When
 * scoped, the route returns these zeroed and names them here so the
 * client can hide the cards instead of drawing an empty chart that
 * reads as "no data".
 */
export const FLEET_ONLY_BLOCKS = [
  'mileage_distribution',
  'status_breakdown',
  'utilization',
  'service_compliance',
  'cost_per_mile_ranking',
  'fuel_economy_ranking',
] as const;

/**
 * Parse a `?vehicle_id=` query value into a positive integer id.
 * Returns null for anything else — absent, empty, non-numeric,
 * zero, negative, fractional, or non-finite.
 */
export function parseVehicleScope(raw: string | undefined | null): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

/** `AND <column> = ?` when scoped; '' when fleet-wide. */
export function scopeAnd(column: string, vehicleId: number | null): string {
  return vehicleId == null ? '' : `AND ${column} = ?`;
}

/**
 * Bind arguments to append after the query's existing binds — one per
 * scopeAnd() call in that query. Empty when fleet-wide, so spreading
 * it into a query() call is a no-op.
 */
export function scopeBinds(vehicleId: number | null, times = 1): number[] {
  if (vehicleId == null) return [];
  return Array.from({ length: times }, () => vehicleId);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/fleetAnalyticsScope.test.ts
```

Expected: PASS — 12 tests.

Note `Number('Infinity')` is `Infinity`, which `Number.isInteger` rejects, and `Number('')` is `0` — which is why the empty-string check comes first.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
```

Expected: no output (clean).

```bash
git add src/utils/fleetAnalyticsScope.ts tests/fleetAnalyticsScope.test.ts
git commit -m "feat(fleet): pure vehicle-scope helpers for fleet analytics"
```

---

### Task 2: Scope `GET /fleet/analytics` by vehicle

**Files:**
- Modify: `src/routes/fleet.ts` (the `fleet.get('/analytics', …)` handler, starting at the `// GET /analytics` comment block)

**Interfaces:**
- Consumes: `parseVehicleScope`, `scopeAnd`, `scopeBinds`, `FLEET_ONLY_BLOCKS` from Task 1.
- Produces: the response gains
  - `scope: 'vehicle' | 'fleet'`
  - `omitted_for_vehicle_scope: string[]` — empty when fleet-wide
  - `fleet_comparison: { avg_mileage, avg_mpg, total_maintenance_cost, total_fuel_cost } | null` — non-null only when scoped

- [ ] **Step 1: Add the import**

At the top of `src/routes/fleet.ts`, alongside the existing util imports:

```ts
import {
  parseVehicleScope,
  scopeAnd,
  scopeBinds,
  FLEET_ONLY_BLOCKS,
} from '../utils/fleetAnalyticsScope';
```

- [ ] **Step 2: Parse the scope inside the handler**

Immediately after the existing `periodMod` / `maintPeriod` / `fuelPeriod` / `inspPeriod` fragment block, add:

```ts
  // ?vehicle_id=N scopes every per-vehicle-meaningful block. Absent or
  // invalid → null → fleet-wide, byte-identical to the previous behavior.
  const vehicleId = parseVehicleScope(c.req.query('vehicle_id'));
  const scope: 'vehicle' | 'fleet' = vehicleId == null ? 'fleet' : 'vehicle';
```

- [ ] **Step 3: Scope `maintenance_cost_trend`**

Replace the existing `maintenance_cost_trend` query with:

```ts
  const maintenance_cost_trend = await safe(() => query<{ month: string; total_cost: number; count: number }>(
    db,
    `SELECT strftime('%Y-%m', performed_at) as month,
            COALESCE(SUM(cost), 0) as total_cost,
            COUNT(*) as count
     FROM fleet_maintenance
     WHERE performed_at >= datetime('now', '-12 months')
       ${scopeAnd('vehicle_id', vehicleId)}
     GROUP BY month
     ORDER BY month`,
    ...scopeBinds(vehicleId),
  ), []);
```

- [ ] **Step 4: Scope `fuel_economy_trend`**

In the `fuel_economy_trend` query, add the predicate to the inner `monthly` CTE's `WHERE`
(after `WHERE fuel_date >= date('now', '-12 months')`):

```
       ${scopeAnd('vehicle_id', vehicleId)}
```

and append `...scopeBinds(vehicleId),` as the query's final argument.

- [ ] **Step 5: Scope the summary and build `fleet_comparison`**

Replace the whole `const summary = await safe(async () => { … }, null);` block with a
reusable inner function plus two calls:

```ts
  // Summary is computed twice when scoped: once for this vehicle, once
  // fleet-wide, so the UI can show "this vehicle vs. the fleet".
  const computeSummary = async (scopeId: number | null) => {
    const veh = await queryFirst<{ total_vehicles: number; avg_mileage: number }>(
      db,
      `SELECT COUNT(*) as total_vehicles, COALESCE(AVG(current_mileage), 0) as avg_mileage
       FROM fleet_vehicles WHERE archived_at IS NULL ${scopeAnd('id', scopeId)}`,
      ...scopeBinds(scopeId),
    );
    const maint = await queryFirst<{ total: number }>(
      db,
      `SELECT COALESCE(SUM(cost), 0) as total FROM fleet_maintenance
       WHERE 1=1 ${maintPeriod} ${scopeAnd('vehicle_id', scopeId)}`,
      ...scopeBinds(scopeId),
    );
    const fuel = await queryFirst<{ total: number }>(
      db,
      `SELECT COALESCE(SUM(total_cost), 0) as total FROM fleet_fuel_log
       WHERE 1=1 ${fuelPeriod} ${scopeAnd('vehicle_id', scopeId)}`,
      ...scopeBinds(scopeId),
    );
    const mpg = await queryFirst<{ avg_mpg: number | null }>(
      db,
      `WITH per_vehicle AS (
         SELECT vehicle_id,
                MAX(odometer) - MIN(odometer) as miles,
                SUM(gallons) as gallons
         FROM fleet_fuel_log
         WHERE odometer IS NOT NULL AND gallons > 0
           ${scopeAnd('vehicle_id', scopeId)}
         GROUP BY vehicle_id
         HAVING COUNT(*) >= 2 AND miles > 0
       )
       SELECT ROUND(AVG(miles * 1.0 / gallons), 1) as avg_mpg FROM per_vehicle`,
      ...scopeBinds(scopeId),
    );
    return {
      total_vehicles: veh?.total_vehicles ?? 0,
      avg_mileage: veh?.avg_mileage ?? 0,
      avg_mpg: mpg?.avg_mpg ?? null,
      total_maintenance_cost: maint?.total ?? 0,
      total_fuel_cost: fuel?.total ?? 0,
    };
  };

  const summary = await safe(() => computeSummary(vehicleId), null);

  // Fleet baseline for the comparison band — only when scoped, and only
  // the four comparable figures (a vehicle count comparison is noise).
  const fleet_comparison = vehicleId == null ? null : await safe(async () => {
    const f = await computeSummary(null);
    return {
      avg_mileage: f.avg_mileage,
      avg_mpg: f.avg_mpg,
      total_maintenance_cost: f.total_maintenance_cost,
      total_fuel_cost: f.total_fuel_cost,
    };
  }, null);
```

- [ ] **Step 6: Scope the remaining per-vehicle counters**

`vehicles_needing_service` — for a single vehicle this is 0 or 1:

```ts
  const vehicles_needing_service = (await safe(() => queryFirst<{ n: number }>(
    db,
    `SELECT COUNT(*) as n FROM fleet_vehicles
     WHERE archived_at IS NULL
       AND ((next_service_due IS NOT NULL AND date(next_service_due) <= date('now'))
            OR (next_service_mileage IS NOT NULL AND current_mileage >= next_service_mileage))
       ${scopeAnd('id', vehicleId)}`,
    ...scopeBinds(vehicleId),
  ), null))?.n ?? 0;
```

`inspections_failing`:

```ts
  const inspections_failing = (await safe(() => queryFirst<{ n: number }>(
    db,
    `SELECT COUNT(*) as n FROM fleet_inspections
     WHERE overall_result = 'fail'
       AND inspection_date >= date('now', '-90 days')
       ${scopeAnd('vehicle_id', vehicleId)}`,
    ...scopeBinds(vehicleId),
  ), null))?.n ?? 0;
```

`fuel_entries_total`:

```ts
  const fuel_entries_total = (await safe(() => queryFirst<{ n: number }>(
    db,
    `SELECT COUNT(*) as n FROM fleet_fuel_log
     WHERE 1=1 ${fuelPeriod} ${scopeAnd('vehicle_id', vehicleId)}`,
    ...scopeBinds(vehicleId),
  ), null))?.n ?? 0;
```

`inspection_pass_rate` — add `${scopeAnd('vehicle_id', vehicleId)}` after `WHERE 1=1 ${inspPeriod}`
and append `...scopeBinds(vehicleId),`.

`daily_usage` — the join is already aliased, so add `${scopeAnd('fv.id', vehicleId)}` after
`WHERE g.recorded_at >= datetime('now', '-30 days')` and append `...scopeBinds(vehicleId),`.

- [ ] **Step 7: Zero the fleet-only blocks when scoped**

Each of the fleet-only computations is left untouched, but its **assignment** is short-circuited
when scoped. For `mileage_distribution`, `status_breakdown`, `utilization`, and
`service_compliance`, wrap the existing `await safe(...)` expression so the scoped path skips it:

```ts
  const mileage_distribution = vehicleId != null ? [] : await safe(async () => {
    // ...existing bucket loop unchanged...
  }, []);
```

```ts
  const status_breakdown = vehicleId != null ? [] : await safe(async () => {
    // ...existing body unchanged...
  }, []);
```

```ts
  const utilization = vehicleId != null
    ? { assigned: 0, unassigned: 0, rate: 0 }
    : await safe(async () => {
      // ...existing body unchanged...
    }, { assigned: 0, unassigned: 0, rate: 0 });
```

```ts
  const service_compliance = vehicleId != null
    ? { compliant: 0, overdue: 0, rate: 100 }
    : await safe(async () => {
      // ...existing body unchanged...
    }, { compliant: 0, overdue: 0, rate: 100 });
```

Apply the same `vehicleId != null ? [] : …` pattern to `cost_per_mile_ranking` and
`fuel_economy_ranking`. Locate their assignments first — they may live in this handler or be
assembled from a helper:

```bash
grep -n "cost_per_mile_ranking\|fuel_economy_ranking" src/routes/fleet.ts
```

If either is not computed inside this handler at all, it is already absent from the response
and needs no change — note that in the commit message rather than inventing a computation for
it. Zeroing rather than
nulling keeps the existing `FleetAnalytics` field types valid and lets the tab's existing
`.length > 0` guards render an empty state safely; the client hides these cards outright
using the list added in the next step.

- [ ] **Step 8: Add the three new fields to the response**

In the handler's final `c.json({ … })`, add:

```ts
    scope,
    omitted_for_vehicle_scope: vehicleId == null ? [] : [...FLEET_ONLY_BLOCKS],
    fleet_comparison,
```

- [ ] **Step 9: Typecheck and run the Worker suites**

```bash
npm run typecheck
```

Expected: no output.

```bash
npx vitest run
```

Expected: all pass, including the 12 new tests from Task 1.

```bash
npm run test:worker
```

Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add src/routes/fleet.ts
git commit -m "fix(fleet): scope GET /analytics by vehicle_id; add fleet_comparison

The per-vehicle Analytics tab rendered fleet aggregates under per-vehicle
labels. ?vehicle_id=N now scopes every per-vehicle-meaningful block, and
the response declares its own scope so a mismatch surfaces instead of
being papered over. Fleet-only blocks are zeroed and named in
omitted_for_vehicle_scope so the client hides those cards rather than
drawing an empty chart."
```

---

### Task 3: Client consumes the scoped analytics (finding 1)

**Files:**
- Modify: `client/src/types/index.ts:1861-1895` (the `FleetAnalytics` interface)
- Modify: `client/src/pages/fleet/FleetPage.tsx` (`fetchVehicleAnalytics`, and the `activeTab === 'analytics'` branch of the lazy-load effect)
- Modify: `client/src/pages/fleet/tabs/FleetAnalyticsTab.tsx`
- Test: `client/src/pages/fleet/tabs/__tests__/FleetAnalyticsTab.scope.test.tsx`

**Interfaces:**
- Consumes: the Task 2 response fields `scope`, `omitted_for_vehicle_scope`, `fleet_comparison`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Extend the type**

In `client/src/types/index.ts`, inside `interface FleetAnalytics`, add:

```ts
  /**
   * What this payload actually describes. Optional because Pages and the
   * Worker deploy independently and can be briefly mismatched — a missing
   * value is treated as 'fleet', which is the pre-scoping behavior.
   */
  scope?: 'vehicle' | 'fleet';
  /** Block names that are fleet-only and must be hidden in vehicle scope. */
  omitted_for_vehicle_scope?: string[];
  /** Fleet baseline for the comparison band; null/absent when fleet-wide. */
  fleet_comparison?: {
    avg_mileage: number;
    avg_mpg: number | null;
    total_maintenance_cost: number;
    total_fuel_cost: number;
  } | null;
```

- [ ] **Step 2: Write the failing test**

Create `client/src/pages/fleet/tabs/__tests__/FleetAnalyticsTab.scope.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import FleetAnalyticsTab from '../FleetAnalyticsTab';
import type { FleetAnalytics } from '../../../../types';

const BASE: FleetAnalytics = {
  maintenance_cost_trend: [],
  mileage_distribution: [],
  status_breakdown: [],
  fuel_economy_trend: [],
  fleet_summary: {
    total_vehicles: 1, avg_mileage: 80000, avg_mpg: 18.5,
    total_maintenance_cost: 1200, total_fuel_cost: 900,
    vehicles_needing_service: 0, inspections_failing: 0,
  },
};

describe('FleetAnalyticsTab scope labelling', () => {
  it('labels a vehicle-scoped payload as this vehicle', () => {
    render(<FleetAnalyticsTab analytics={{ ...BASE, scope: 'vehicle' }} />);
    expect(screen.getByTestId('analytics-scope-banner')).toHaveTextContent(/this vehicle/i);
  });

  it('labels a fleet-scoped payload as fleet-wide', () => {
    render(<FleetAnalyticsTab analytics={{ ...BASE, scope: 'fleet' }} />);
    expect(screen.getByTestId('analytics-scope-banner')).toHaveTextContent(/fleet-wide/i);
  });

  it('treats a payload with no scope field as fleet-wide (old Worker, new client)', () => {
    render(<FleetAnalyticsTab analytics={BASE} />);
    expect(screen.getByTestId('analytics-scope-banner')).toHaveTextContent(/fleet-wide/i);
  });

  it('renders the fleet comparison band only when one is supplied', () => {
    const { rerender } = render(<FleetAnalyticsTab analytics={{ ...BASE, scope: 'vehicle' }} />);
    expect(screen.queryByTestId('fleet-comparison')).toBeNull();

    rerender(<FleetAnalyticsTab analytics={{
      ...BASE,
      scope: 'vehicle',
      fleet_comparison: {
        avg_mileage: 95000, avg_mpg: 16.2,
        total_maintenance_cost: 2000, total_fuel_cost: 1500,
      },
    }} />);
    const band = screen.getByTestId('fleet-comparison');
    expect(band).toHaveTextContent('16.2');
    expect(band).toHaveTextContent(/fleet avg/i);
  });

  it('hides a card named in omitted_for_vehicle_scope', () => {
    render(<FleetAnalyticsTab analytics={{
      ...BASE, scope: 'vehicle', omitted_for_vehicle_scope: ['status_breakdown'],
    }} />);
    expect(screen.queryByTestId('card-status_breakdown')).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd client && npx vitest run src/pages/fleet/tabs/__tests__/FleetAnalyticsTab.scope.test.tsx
```

Expected: FAIL — `Unable to find an element by: [data-testid="analytics-scope-banner"]`.

- [ ] **Step 4: Implement the banner, band, and card hiding**

In `FleetAnalyticsTab.tsx`, add to the destructuring block near line 385:

```tsx
    scope = 'fleet',
    omitted_for_vehicle_scope = [],
    fleet_comparison = null,
```

Add a helper just above the component's `return`:

```tsx
  // A card named by the server as fleet-only is hidden outright — an empty
  // chart reads as "no data for this vehicle", which is a different and
  // false claim.
  const isOmitted = (block: string) => omitted_for_vehicle_scope.includes(block);
```

Render the banner as the first child of the component's outermost returned element:

```tsx
      <div
        data-testid="analytics-scope-banner"
        className="px-3 py-1.5 text-[9px] uppercase tracking-wider font-semibold text-rmpg-400 border-b border-rmpg-700 bg-surface-sunken"
      >
        {scope === 'vehicle' ? 'Scope: this vehicle' : 'Scope: fleet-wide'}
      </div>
```

Render the comparison band immediately after the banner:

```tsx
      {fleet_comparison && (
        <div
          data-testid="fleet-comparison"
          className="px-3 py-1.5 flex items-center gap-4 text-[10px] font-mono border-b border-rmpg-700 bg-surface-sunken"
        >
          <span className="text-rmpg-500 uppercase tracking-wider text-[9px]">Fleet avg</span>
          <span className="text-rmpg-300">
            MPG <strong className="text-rmpg-100 tabular-nums">
              {fleet_comparison.avg_mpg != null ? fleet_comparison.avg_mpg.toFixed(1) : '--'}
            </strong>
          </span>
          <span className="text-rmpg-300">
            Miles <strong className="text-rmpg-100 tabular-nums">
              {Math.round(fleet_comparison.avg_mileage).toLocaleString()}
            </strong>
          </span>
          <span className="text-rmpg-300">
            Maint <strong className="text-rmpg-100 tabular-nums">
              ${Math.round(fleet_comparison.total_maintenance_cost).toLocaleString()}
            </strong>
          </span>
          <span className="text-rmpg-300">
            Fuel <strong className="text-rmpg-100 tabular-nums">
              ${Math.round(fleet_comparison.total_fuel_cost).toLocaleString()}
            </strong>
          </span>
        </div>
      )}
```

Then, for each of the six fleet-only blocks, find its card wrapper and gate it. Locate them with:

```bash
cd client && grep -n "status_breakdown\|mileage_distribution\|utilization\|service_compliance\|cost_per_mile_ranking\|fuel_economy_ranking" src/pages/fleet/tabs/FleetAnalyticsTab.tsx
```

Add `data-testid={`card-${blockName}`}` to each card's outermost element and wrap it:

```tsx
      {!isOmitted('status_breakdown') && (
        <div data-testid="card-status_breakdown" className="...existing classes...">
          {/* ...existing card body unchanged... */}
        </div>
      )}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd client && npx vitest run src/pages/fleet/tabs/__tests__/FleetAnalyticsTab.scope.test.tsx
```

Expected: PASS — 5 tests.

- [ ] **Step 6: Pass the vehicle scope from the page**

In `FleetPage.tsx`, replace `fetchVehicleAnalytics`:

```tsx
  const fetchVehicleAnalytics = async (id: string | number) => {
    setAnalyticsLoading(true);
    try {
      const data = await apiFetch<FleetAnalytics>(`/fleet/analytics?vehicle_id=${encodeURIComponent(String(id))}`);
      setAnalytics(data);
    } catch { addToast('Failed to load analytics', 'error'); }
    finally { setAnalyticsLoading(false); }
  };
```

In the lazy-load effect, change the analytics line to pass the id:

```tsx
    if (activeTab === 'analytics') fetchVehicleAnalytics(selectedId);
```

- [ ] **Step 7: Verify and commit**

```bash
cd client && npx tsc --noEmit
```

Expected: no output.

```bash
cd client && npx vitest run
```

Expected: all pass.

```bash
git add client/src/types/index.ts client/src/pages/fleet/FleetPage.tsx client/src/pages/fleet/tabs/FleetAnalyticsTab.tsx client/src/pages/fleet/tabs/__tests__/FleetAnalyticsTab.scope.test.tsx
git commit -m "fix(fleet): request per-vehicle analytics and label the scope

The Analytics tab now passes ?vehicle_id and renders the scope the server
declares, with a fleet-average comparison band. Fleet-only cards are
hidden in vehicle scope. A payload without the new fields is treated as
fleet-wide so an older Worker degrades to the previous behavior."
```

---

### Task 4: Tablist semantics, silver theme, persisted view mode (findings 2 and 9)

These are one JSX block; splitting them would mean editing the same five buttons twice.

**Files:**
- Modify: `client/src/pages/fleet/FleetPage.tsx` (the `viewMode` declaration and the fleet-wide tab strip)

**Interfaces:**
- Consumes: `usePersistedTab` (already imported in this file).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Persist `viewMode`**

Replace:

```tsx
  const [viewMode, setViewMode] = useState<'dashboard' | 'analysis' | 'work_orders' | 'vendors' | 'service'>('dashboard');
```

with:

```tsx
  // Persisted with the same mechanism as activeTab — the two mode
  // mechanisms behaving differently is what produced this page's tab bugs.
  const [viewMode, setViewMode] = usePersistedTab(
    'rmpg_fleet_view_mode',
    'dashboard' as FleetViewMode,
    ['dashboard', 'analysis', 'work_orders', 'vendors', 'service'] as const,
  );
```

Add the type alias above the component (next to `type ModalMode`):

```tsx
type FleetViewMode = 'dashboard' | 'analysis' | 'work_orders' | 'vendors' | 'service';
```

- [ ] **Step 2: Replace the tab strip**

Replace the entire `<div className="flex border-b border-subtle bg-surface-sunken flex-shrink-0">` block and its five hardcoded-hex buttons with a config-driven tablist. Add the config above the component:

```tsx
// Fleet-wide views. Rendered as a real tablist — the previous version had
// no tab semantics and hardcoded #d4a017, which is banned in the
// blue-silver theme (fails AA and is confusable with --sev-warn).
const FLEET_VIEWS: { id: FleetViewMode; label: string; icon?: typeof FileText }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'analysis', label: 'Analysis Reports', icon: FileText },
  { id: 'work_orders', label: 'Work Orders' },
  { id: 'vendors', label: 'Vendors' },
  { id: 'service', label: 'Service' },
];
```

Then the strip itself:

```tsx
              <div
                className="flex items-center border-b border-rmpg-700 bg-surface-sunken flex-shrink-0"
                role="tablist"
                aria-label="Fleet-wide views"
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                  e.preventDefault();
                  const idx = FLEET_VIEWS.findIndex((v) => v.id === viewMode);
                  const next = e.key === 'ArrowRight'
                    ? (idx + 1) % FLEET_VIEWS.length
                    : (idx - 1 + FLEET_VIEWS.length) % FLEET_VIEWS.length;
                  const target = FLEET_VIEWS[next];
                  if (target.id === 'work_orders') setWorkOrdersVehicleFilter(null);
                  setViewMode(target.id);
                }}
              >
                {FLEET_VIEWS.map(({ id, label, icon: Icon }) => (
                  <button
                    type="button"
                    key={id}
                    role="tab"
                    id={`fleet-view-tab-${id}`}
                    aria-selected={viewMode === id}
                    aria-controls="fleet-view-panel"
                    tabIndex={viewMode === id ? 0 : -1}
                    onClick={() => {
                      if (id === 'work_orders') setWorkOrdersVehicleFilter(null);
                      setViewMode(id);
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-all duration-150 border-b-2 ${
                      viewMode === id
                        ? 'text-brand-gold-500 border-brand-gold-500 bg-brand-gold-500/5'
                        : 'text-rmpg-400 border-transparent hover:text-rmpg-200 hover:border-rmpg-600'
                    }`}
                  >
                    {Icon && <Icon size={10} />}
                    {label}
                  </button>
                ))}
              </div>
```

The active-state classes are copied verbatim from the equivalent strip at
`client/src/pages/ServePage.tsx:1495`. `brand-gold-*` renders **silver** — the deliberate
compat alias — which is correct here because gold is restricted to field labels and panel
headers, and a tab is neither.

- [ ] **Step 3: Give the panel its tab-panel identity**

On the content wrapper immediately below the strip (currently `<div className="flex-1 min-h-0 overflow-y-auto">`), add:

```tsx
              <div
                className="flex-1 min-h-0 overflow-y-auto"
                role="tabpanel"
                id="fleet-view-panel"
                aria-labelledby={`fleet-view-tab-${viewMode}`}
              >
```

- [ ] **Step 4: Verify no banned literal remains**

```bash
cd client && grep -n "d4a017\|#888" src/pages/fleet/FleetPage.tsx
```

Expected: no output.

```bash
cd client && npx tsx scripts/audit-hex.mjs --list src/pages/fleet | head -20
```

Expected: `FleetPage.tsx`'s count is lower than before this task (the severity literals remain and are correct).

- [ ] **Step 5: Verify and commit**

```bash
cd client && npx tsc --noEmit && npx vitest run
```

Expected: no typecheck output; all tests pass.

```bash
git add client/src/pages/fleet/FleetPage.tsx
git commit -m "fix(fleet): real tablist for fleet-wide views; drop banned gold literals

The five fleet-wide view buttons had no tab semantics, no keyboard
navigation, and hardcoded #d4a017 (banned in blue-silver: fails AA and is
confusable with --sev-warn) plus #888. They now use the silver ramp
classes from the equivalent ServePage strip, expose role=tablist with
arrow-key navigation, and persist the selected view like activeTab does."
```

---

### Task 5: Pre-trip modal — unique ids and dismissal guard (findings 3 and 8)

Both defects live in the same modal; fixing one without the other means touching it twice.

**Files:**
- Modify: `client/src/pages/fleet/FleetPage.tsx` (the pre-trip modal block and the page-level `keydown` effect)
- Test: `client/src/pages/fleet/__tests__/FleetPage.phase1.test.tsx`

**Interfaces:**
- Consumes: `useId` from React (add to the existing React import).
- Produces: nothing consumed by later tasks.

**Scope note:** No modal in this app implements a focus *trap*. Adding one only here would be
inconsistent, so this task matches the house convention established by `VehicleFormModal`
(`role="dialog"` + `aria-modal` + `aria-labelledby` via `useId`, a dirty-guarded Escape, and a
dirty-guarded backdrop click) and adds initial focus. An app-wide focus trap is a separate change.

- [ ] **Step 1: Extract the checklist config above the component**

```tsx
// Pre-trip checklist items. Extracted from the JSX so each checkbox can
// derive a unique DOM id from its key — the inline version hardcoded one
// literal id inside a .map(), producing ten duplicate ids.
const PRETRIP_ITEMS: { key: string; label: string }[] = [
  { key: 'lights_ok', label: 'Lights & Signals' },
  { key: 'brakes_ok', label: 'Brakes' },
  { key: 'radio_ok', label: 'Radio/Comms' },
  { key: 'mdt_ok', label: 'MDT/Computer' },
  { key: 'camera_ok', label: 'Dash Camera' },
  { key: 'tires_ok', label: 'Tires' },
  { key: 'fluids_ok', label: 'Fluids (Oil/Coolant)' },
  { key: 'exterior_ok', label: 'Exterior Condition' },
  { key: 'interior_ok', label: 'Interior Condition' },
  { key: 'emergency_equipment_ok', label: 'Emergency Equipment' },
];

// A pre-trip is "answered" once any item is failed or a note is typed —
// all-pass with no note is the untouched default and is safe to discard.
const PRETRIP_DEFAULTS = PRETRIP_ITEMS.reduce<Record<string, boolean>>(
  (acc, i) => { acc[i.key] = true; return acc; }, {},
);
```

- [ ] **Step 2: Write the failing test**

Create `client/src/pages/fleet/__tests__/FleetPage.phase1.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import FleetPage from '../FleetPage';
import { ToastProvider } from '../../../components/ToastProvider';

vi.mock('../../../hooks/useApi', () => ({ apiFetch: vi.fn(), apiPostForm: vi.fn() }));
import { apiFetch } from '../../../hooks/useApi';
const mockedApiFetch = vi.mocked(apiFetch);

const VEHICLE = {
  id: 1, vehicle_number: 'PS-D19', make: 'Ford', model: 'Explorer', year: 2021,
  status: 'in_service', current_mileage: 42000,
};

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <FleetPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('FleetPage — pre-trip modal', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
    localStorage.clear();
    mockedApiFetch.mockImplementation((url: string) => {
      if (url.startsWith('/fleet?')) {
        return Promise.resolve({ data: [VEHICLE], pagination: { total: 1 } });
      }
      if (url === '/fleet/1') return Promise.resolve(VEHICLE);
      if (url.startsWith('/fleet/analytics')) return Promise.resolve({ scope: 'fleet', fleet_summary: {} });
      return Promise.resolve({ data: [] });
    });
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('gives every checklist item a distinct id bound to its label', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText('PS-D19'));
    await user.click(await screen.findByRole('button', { name: /pre-trip/i }));

    const dialog = await screen.findByRole('dialog', { name: /pre-trip/i });
    const boxes = within(dialog).getAllByRole('checkbox');
    expect(boxes).toHaveLength(10);

    const ids = boxes.map((b) => b.id);
    expect(new Set(ids).size).toBe(10);
    expect(ids.every(Boolean)).toBe(true);

    // Label association: clicking the text toggles the box.
    const brakes = within(dialog).getByLabelText(/brakes/i);
    expect(brakes).toBeChecked();
    await user.click(within(dialog).getByText('Brakes'));
    expect(brakes).not.toBeChecked();
  });

  it('does not discard an answered checklist on a backdrop click', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();
    await user.click(await screen.findByText('PS-D19'));
    await user.click(await screen.findByRole('button', { name: /pre-trip/i }));

    const dialog = await screen.findByRole('dialog', { name: /pre-trip/i });
    await user.click(within(dialog).getByText('Brakes')); // now answered

    await user.click(screen.getByTestId('pretrip-backdrop'));

    expect(confirmSpy).toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: /pre-trip/i })).toBeInTheDocument();
  });

  it('closes without a prompt when the checklist is untouched', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm');
    renderPage();
    await user.click(await screen.findByText('PS-D19'));
    await user.click(await screen.findByRole('button', { name: /pre-trip/i }));
    await user.click(screen.getByTestId('pretrip-backdrop'));

    expect(confirmSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /pre-trip/i })).toBeNull());
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd client && npx vitest run src/pages/fleet/__tests__/FleetPage.phase1.test.tsx
```

Expected: FAIL — duplicate ids (`new Set(ids).size` is 1, not 10) and no `pretrip-backdrop` testid.

- [ ] **Step 4: Rewrite the modal**

Add `useId` to the React import at the top of the file, and inside the component:

```tsx
  const pretripTitleId = useId();
  const pretripDirty = PRETRIP_ITEMS.some((it) => !(pretripForm as any)[it.key])
    || pretripForm.notes.trim() !== '';

  const closePretrip = useCallback(() => {
    if (pretripSaving) return;
    if (pretripDirty && !window.confirm('Discard this pre-trip checklist?')) return;
    setPretripForm({ ...PRETRIP_DEFAULTS, notes: '' } as typeof pretripForm);
    setShowPretripModal(false);
  }, [pretripDirty, pretripSaving]);
```

Replace the page-level Escape effect (which existed only to close this modal) with one that
routes through the guard:

```tsx
  useEffect(() => {
    if (!showPretripModal) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') closePretrip(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showPretripModal, closePretrip]);
```

Update the modal markup — backdrop, labelling, and the mapped items:

```tsx
      {showPretripModal && selectedVehicle && (
        <div
          data-testid="pretrip-backdrop"
          className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/60 p-2"
          onClick={closePretrip}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={pretripTitleId}
            className="bg-surface-raised border border-rmpg-600 w-[450px] max-w-[95vw] max-h-[90vh] md:max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-3 border-b border-rmpg-600">
              <h3 id={pretripTitleId} className="text-sm font-bold text-rmpg-100">
                Pre-Trip Inspection: {selectedVehicle.vehicle_number}
              </h3>
              <button type="button" onClick={closePretrip} aria-label="Close pre-trip inspection" className="text-rmpg-400 hover:text-rmpg-100 text-lg">&times;</button>
            </div>
            <div className="p-3 flex-1 overflow-auto space-y-2">
              {PRETRIP_ITEMS.map((item, idx) => {
                const inputId = `ff-pretrip-${item.key}`;
                return (
                  <label key={item.key} htmlFor={inputId} className="flex items-center gap-3 p-2 min-h-[44px] bg-surface-base cursor-pointer hover:bg-surface-raised">
                    <input
                      id={inputId}
                      ref={idx === 0 ? pretripFirstItemRef : undefined}
                      type="checkbox"
                      checked={(pretripForm as any)[item.key]}
                      onChange={(e) => setPretripForm((prev) => ({ ...prev, [item.key]: e.target.checked }))}
                      className="w-4 h-4 accent-green-500"
                    />
                    <span className={`text-sm ${(pretripForm as any)[item.key] ? 'text-green-300' : 'text-red-300'}`}>{item.label}</span>
                    <span className="ml-auto text-[10px] font-mono">{(pretripForm as any)[item.key] ? 'PASS' : 'FAIL'}</span>
                  </label>
                );
              })}
              <RichTextArea
                value={pretripForm.notes}
                onChange={(e) => setPretripForm((prev) => ({ ...prev, notes: e.target.value }))}
                className="input-dark w-full h-16 text-sm mt-2 min-h-[36px]"
                placeholder="Notes (defects, damage, etc.)..."
              />
            </div>
            <div className="flex justify-end gap-2 p-3 border-t border-rmpg-600">
              <button type="button" onClick={closePretrip} className="toolbar-btn">Cancel</button>
              <button type="button" onClick={submitPretrip} disabled={pretripSaving} className="toolbar-btn toolbar-btn-primary print:hidden">
                {pretripSaving ? 'Saving...' : 'Submit Pre-Trip'}
              </button>
            </div>
          </div>
        </div>
      )}
```

Declare the focus ref beside the other refs and focus it on open, matching how
`VehicleFormModal` focuses its first field:

```tsx
  const pretripFirstItemRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (showPretripModal) pretripFirstItemRef.current?.focus();
  }, [showPretripModal]);
```

Add `useRef` to the React import if it is not already there.

Finally, make a successful submit reset the form so the next open starts clean — inside
`submitPretrip`, replace `setShowPretripModal(false);` with:

```tsx
      setPretripForm({ ...PRETRIP_DEFAULTS, notes: '' } as typeof pretripForm);
      setShowPretripModal(false);
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd client && npx vitest run src/pages/fleet/__tests__/FleetPage.phase1.test.tsx
```

Expected: PASS — 3 tests.

- [ ] **Step 6: Verify the fix is load-bearing**

Temporarily change `inputId` back to the literal `'ff-fleetpage-2'` and re-run. Expected: the
first test FAILS on `new Set(ids).size`. Restore the fix. A test that passes against both the
bug and the fix asserts nothing.

- [ ] **Step 7: Commit**

```bash
cd client && npx tsc --noEmit && npx vitest run
```

Expected: no typecheck output; all tests pass.

```bash
git add client/src/pages/fleet/FleetPage.tsx client/src/pages/fleet/__tests__/FleetPage.phase1.test.tsx
git commit -m "fix(fleet): unique pre-trip checkbox ids; guard checklist dismissal

Ten checkboxes shared id=ff-fleetpage-2 (a literal inside a .map), which
broke label association. The modal also discarded a filled-in checklist on
any backdrop click. Ids now derive from the item key, labels are
associated, and dismissal is guarded when answered — matching the
convention in VehicleFormModal."
```

---

### Task 6: Stop clobbering the persisted per-vehicle tab (finding 4)

**Files:**
- Modify: `client/src/pages/fleet/FleetPage.tsx` (the `useEffect` that resets state on `selectedId` change)
- Test: `client/src/pages/fleet/__tests__/FleetPage.phase1.test.tsx` (append)

- [ ] **Step 1: Write the failing test**

Append to `FleetPage.phase1.test.tsx`:

```tsx
describe('FleetPage — tab persistence', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
    localStorage.clear();
    mockedApiFetch.mockImplementation((url: string) => {
      if (url.startsWith('/fleet?')) {
        return Promise.resolve({ data: [VEHICLE, { ...VEHICLE, id: 2, vehicle_number: 'PS-D20' }], pagination: { total: 2 } });
      }
      if (url === '/fleet/1' || url === '/fleet/2') return Promise.resolve(VEHICLE);
      if (url.startsWith('/fleet/analytics')) return Promise.resolve({ scope: 'vehicle', fleet_summary: {} });
      return Promise.resolve({ data: [] });
    });
  });

  it('restores the persisted tab on mount instead of forcing overview', async () => {
    localStorage.setItem('rmpg_fleet_tab', JSON.stringify('fuel'));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText('PS-D19'));

    await waitFor(() => {
      expect(mockedApiFetch).toHaveBeenCalledWith(expect.stringContaining('/fleet/1/fuel'));
    });
  });

  it('still resets to overview when switching to a different vehicle', async () => {
    localStorage.setItem('rmpg_fleet_tab', JSON.stringify('fuel'));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText('PS-D19'));
    await waitFor(() => expect(mockedApiFetch).toHaveBeenCalledWith(expect.stringContaining('/fleet/1/fuel')));

    mockedApiFetch.mockClear();
    await user.click(screen.getByText('PS-D20'));

    // Overview needs no per-tab fetch, so the assertion is the absence of one.
    await waitFor(() => expect(mockedApiFetch).toHaveBeenCalledWith('/fleet/2'));
    expect(mockedApiFetch).not.toHaveBeenCalledWith(expect.stringContaining('/fleet/2/fuel'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd client && npx vitest run src/pages/fleet/__tests__/FleetPage.phase1.test.tsx -t "restores the persisted tab"
```

Expected: FAIL — no `/fleet/1/fuel` call, because the reset effect forced `overview` on mount.

- [ ] **Step 3: Add the mount guard**

Declare a ref beside the other refs:

```tsx
  // The reset-on-vehicle-change effect must not run on mount, or it
  // clobbers the tab usePersistedTab just restored — which made that
  // persistence dead code.
  const didMountRef = useRef(false);
```

Then, in the `useEffect` that resets tab and sub-record state on `[selectedId]`, make the tab
reset conditional while leaving the data clearing unconditional (stale data from a previous
vehicle must never render against a new one):

```tsx
  useEffect(() => {
    if (didMountRef.current) setActiveTab('overview');
    else didMountRef.current = true;
    setFuelLogs([]);
    setFuelSummary(null);
    setInspections([]);
    setAssignments([]);
    setAnalytics(null);
    setPersonnelData(null);
    setLoans([]);
    setInsurancePolicies([]);
    setAccessories([]);
    setUtilities([]);
    setOtherCosts([]);
    setCostSummary(null);
    setGpsMileage(null);
  }, [selectedId]);
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd client && npx vitest run src/pages/fleet/__tests__/FleetPage.phase1.test.tsx
```

Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
cd client && npx tsc --noEmit
git add client/src/pages/fleet/FleetPage.tsx client/src/pages/fleet/__tests__/FleetPage.phase1.test.tsx
git commit -m "fix(fleet): stop clobbering the persisted per-vehicle tab on mount

The reset effect ran on mount and forced activeTab to overview, so
usePersistedTab('rmpg_fleet_tab') was dead code. A mount guard keeps the
restore while still resetting when the operator switches vehicles."
```

---

### Task 7: Navigate to Daily Reports without a page reload (finding 5)

**Files:**
- Modify: `client/src/pages/fleet/FleetPage.tsx` (the Daily Reports toolbar button)

- [ ] **Step 1: Add the import and hook**

Add to the imports:

```tsx
import { useNavigate } from 'react-router-dom';
```

Inside the component, beside the other hooks:

```tsx
  const navigate = useNavigate();
```

- [ ] **Step 2: Replace the handler**

Replace `onClick={() => { window.location.href = '/fleet/reports'; }}` with:

```tsx
            onClick={() => navigate('/fleet/reports')}
```

- [ ] **Step 3: Verify no full-reload navigation remains**

```bash
cd client && grep -n "window.location.href" src/pages/fleet/FleetPage.tsx
```

Expected: no output.

- [ ] **Step 4: Verify and commit**

```bash
cd client && npx tsc --noEmit && npx vitest run src/pages/fleet
```

Expected: no typecheck output; fleet tests pass. (`FleetPage.phase1.test.tsx` already wraps the
page in `MemoryRouter`, so `useNavigate` has a router in tests.)

```bash
git add client/src/pages/fleet/FleetPage.tsx
git commit -m "fix(fleet): use SPA navigation for the Daily Reports link

window.location.href discarded all React state and re-downloaded the
bundle on every click."
```

---

### Task 8: Surface cost-per-mile failures (finding 7)

**Files:**
- Modify: `client/src/pages/fleet/FleetPage.tsx` (`loadCostPerMile`, the `Cost/Mi` toolbar button)
- Test: `client/src/pages/fleet/__tests__/FleetPage.phase1.test.tsx` (append)

- [ ] **Step 1: Write the failing test**

Append to `FleetPage.phase1.test.tsx`:

```tsx
describe('FleetPage — cost-per-mile failure is visible', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
    localStorage.clear();
    mockedApiFetch.mockImplementation((url: string) => {
      if (url.startsWith('/fleet?')) return Promise.resolve({ data: [VEHICLE], pagination: { total: 1 } });
      if (url === '/fleet/1') return Promise.resolve(VEHICLE);
      if (url.startsWith('/fleet/cost-per-mile/')) return Promise.reject(new Error('Upstream 500'));
      if (url.startsWith('/fleet/analytics')) return Promise.resolve({ scope: 'fleet', fleet_summary: {} });
      return Promise.resolve({ data: [] });
    });
  });

  it('toasts instead of silently doing nothing when the fetch fails', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText('PS-D19'));
    await user.click(await screen.findByRole('button', { name: /cost\/mi/i }));

    expect(await screen.findByText(/failed to load cost per mile/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd client && npx vitest run src/pages/fleet/__tests__/FleetPage.phase1.test.tsx -t "toasts instead"
```

Expected: FAIL — no such text, because the `catch` swallowed the error to `null`.

- [ ] **Step 3: Add a loading flag and an error toast**

Add the state beside `costPerMile`:

```tsx
  const [costPerMileLoading, setCostPerMileLoading] = useState(false);
```

Replace `loadCostPerMile`:

```tsx
  const loadCostPerMile = useCallback(async (vehicleId: string | number) => {
    setCostPerMileLoading(true);
    try {
      const data = await apiFetch<any>(`/fleet/cost-per-mile/${vehicleId}`);
      setCostPerMile(data);
    } catch (err) {
      // Previously swallowed to null, which made a failed click
      // indistinguishable from a dead button.
      setCostPerMile(null);
      addToast(err instanceof Error ? err.message : 'Failed to load cost per mile', 'error');
    } finally {
      setCostPerMileLoading(false);
    }
  }, [addToast]);
```

Note `fetchCosts` also calls `loadCostPerMile`; the added toast is correct there too, since a
missing cost-per-mile silently zeroed the TCO/mile stat.

Give the button its pending state:

```tsx
                <button type="button" className="toolbar-btn" disabled={costPerMileLoading} onClick={() => loadCostPerMile(selectedVehicle.id)}>
                  <Gauge className="w-3 h-3" /> {costPerMileLoading ? 'Loading…' : 'Cost/Mi'}
                </button>
```

The test matches `/cost\/mi/i`, so it still finds the button in its idle state.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd client && npx vitest run src/pages/fleet/__tests__/FleetPage.phase1.test.tsx
```

Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
cd client && npx tsc --noEmit
git add client/src/pages/fleet/FleetPage.tsx client/src/pages/fleet/__tests__/FleetPage.phase1.test.tsx
git commit -m "fix(fleet): surface cost-per-mile failures instead of swallowing them

loadCostPerMile caught to null with no toast and no pending state, so a
failed Cost/Mi click looked identical to a broken button."
```

---

### Task 9: Make vehicle-list truncation visible (finding 6)

**Files:**
- Modify: `client/src/pages/fleet/FleetPage.tsx` (`fetchVehicles`, plus a count line in the list header)
- Test: `client/src/pages/fleet/__tests__/FleetPage.phase1.test.tsx` (append)

- [ ] **Step 1: Write the failing test**

Append to `FleetPage.phase1.test.tsx`:

```tsx
describe('FleetPage — list truncation is visible', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
    localStorage.clear();
  });

  it('reports the shortfall when the server returns fewer rows than exist', async () => {
    mockedApiFetch.mockImplementation((url: string) => {
      if (url.startsWith('/fleet?')) {
        return Promise.resolve({ data: [VEHICLE], pagination: { total: 240 } });
      }
      if (url.startsWith('/fleet/analytics')) return Promise.resolve({ scope: 'fleet', fleet_summary: {} });
      return Promise.resolve({ data: [] });
    });
    renderPage();
    expect(await screen.findByTestId('vehicle-count')).toHaveTextContent('1 of 240');
  });

  it('shows a plain count when nothing is truncated', async () => {
    mockedApiFetch.mockImplementation((url: string) => {
      if (url.startsWith('/fleet?')) {
        return Promise.resolve({ data: [VEHICLE], pagination: { total: 1 } });
      }
      if (url.startsWith('/fleet/analytics')) return Promise.resolve({ scope: 'fleet', fleet_summary: {} });
      return Promise.resolve({ data: [] });
    });
    renderPage();
    const el = await screen.findByTestId('vehicle-count');
    expect(el).toHaveTextContent('1');
    expect(el).not.toHaveTextContent('of');
  });

  it('requests an explicit page size rather than relying on the server default', async () => {
    mockedApiFetch.mockImplementation((url: string) => {
      if (url.startsWith('/fleet?')) return Promise.resolve({ data: [], pagination: { total: 0 } });
      if (url.startsWith('/fleet/analytics')) return Promise.resolve({ scope: 'fleet', fleet_summary: {} });
      return Promise.resolve({ data: [] });
    });
    renderPage();
    await waitFor(() => {
      expect(mockedApiFetch).toHaveBeenCalledWith(expect.stringContaining('per_page='));
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd client && npx vitest run src/pages/fleet/__tests__/FleetPage.phase1.test.tsx -t "truncation"
```

Expected: FAIL — no `vehicle-count` testid.

- [ ] **Step 3: Track the server total**

Add the state beside `vehicles`:

```tsx
  // Server-reported total. The list is a page, not necessarily the whole
  // fleet — without this the client silently dropped rows past the cap.
  const [vehicleTotal, setVehicleTotal] = useState<number | null>(null);
```

Replace `fetchVehicles`:

```tsx
  const FLEET_PAGE_SIZE = 500;

  const fetchVehicles = useCallback(async (options?: { silent?: boolean }) => {
    try {
      const resp = await apiFetch<{ data: FleetVehicle[]; pagination?: { total?: number } }>(
        `/fleet?archived=${showArchived}&per_page=${FLEET_PAGE_SIZE}`,
      );
      const rows = Array.isArray(resp) ? resp : resp.data || [];
      setVehicles(rows);
      const total = Array.isArray(resp) ? rows.length : resp.pagination?.total;
      setVehicleTotal(typeof total === 'number' ? total : rows.length);
    } catch (err) {
      if (!options?.silent) addToast('Failed to load fleet vehicles', 'error');
    }
  }, [addToast, showArchived]);
```

Declare `FLEET_PAGE_SIZE` above the component rather than inside it if the linter objects to a
const inside the render body; either placement is fine as long as it is not recreated per render
in a way that changes the `useCallback` identity.

- [ ] **Step 4: Render the count**

In the list filter header (the row containing the status `<select>` and the search input), add
after the search field:

```tsx
            <span
              data-testid="vehicle-count"
              className="flex-shrink-0 text-[9px] font-mono text-rmpg-500 tabular-nums"
              title={vehicleTotal != null && vehicleTotal > vehicles.length
                ? `Showing ${vehicles.length} of ${vehicleTotal} vehicles — narrow your filters to see the rest`
                : `${vehicles.length} vehicles`}
            >
              {vehicleTotal != null && vehicleTotal > vehicles.length
                ? `${vehicles.length} of ${vehicleTotal}`
                : `${vehicles.length}`}
            </span>
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd client && npx vitest run src/pages/fleet/__tests__/FleetPage.phase1.test.tsx
```

Expected: PASS — 9 tests.

- [ ] **Step 6: Commit**

```bash
cd client && npx tsc --noEmit
git add client/src/pages/fleet/FleetPage.tsx client/src/pages/fleet/__tests__/FleetPage.phase1.test.tsx
git commit -m "fix(fleet): make vehicle-list truncation visible

The client sent no per_page and ignored resp.pagination, so a fleet past
the server's 200-row default silently lost rows. It now requests an
explicit page size and reports 'N of M' whenever the two differ."
```

---

### Task 10: Full-gate verification and PR

**Files:** none modified.

- [ ] **Step 1: Confirm the branch is off current main**

```bash
git fetch origin && git log --oneline origin/main -1 && git status --short
```

Expected: a clean tree, and a branch whose base is current `origin/main`.

- [ ] **Step 2: Worker gates**

```bash
npm run typecheck && npx vitest run && npm run test:worker
```

Expected: no typecheck output; both suites green.

If `tests/pdfSign.test.ts` or `tests/footage/flexcamRoute.test.ts` time out, that is the known
load-dependent flake, not a regression — re-run them in isolation to confirm.

- [ ] **Step 3: Client gates — full suite, not targeted**

```bash
cd client && npx tsc --noEmit && npx vitest run && npx vite build
```

Expected: no typecheck output; the full suite green; a successful build.

A targeted run is not sufficient — a red test hid behind green targeted runs for four
consecutive tasks in the 2026-07-24 sweep.

- [ ] **Step 4: Confirm the hex count went down**

```bash
cd client && npx tsx scripts/audit-hex.mjs --list src/pages/fleet
```

Expected: `FleetPage.tsx`'s in-scope literal count is lower than at the start of this plan. The
remaining literals are the severity/status colors, which are correct.

- [ ] **Step 5: Confirm every finding is closed**

```bash
cd client && grep -n "d4a017\|#888\|window.location.href\|ff-fleetpage-2" src/pages/fleet/FleetPage.tsx
```

Expected: no output.

```bash
cd client && grep -n "apiFetch<FleetAnalytics>('/fleet/analytics')" src/pages/fleet/FleetPage.tsx
```

Expected: no output (the unscoped per-vehicle call is gone).

- [ ] **Step 6: Push and open the PR**

Check whether the desktop gate matters for this change before deciding on the push hook:

```bash
git diff --name-only origin/main | grep ^desktop/ || echo "no desktop changes"
```

Expected: `no desktop changes` — this plan touches no `desktop/` file.

```bash
git push -u origin HEAD
```

The pre-push hook runs four stages and often takes 5–15 minutes because it rebuilds
`better-sqlite3` twice for the desktop tests. Let it finish rather than killing it — a killed
push leaves the branch unpushed while the commits exist locally. If it prints "no commits ahead
of origin/main" on a branch you know has commits, the gate silently skipped (a known fail-open
when `origin/main` is missing locally) and the gates above must be trusted instead.

```bash
gh pr create -R rmpgutah/rmpg-flex --base main \
  --title "fix(fleet): Phase 1 hardening — correctness, a11y, theme" \
  --body "$(cat <<'EOF'
Phase 1 of the Fleet Manager hardening program.
Spec: docs/superpowers/specs/2026-07-26-fleet-manager-hardening-design.md
Plan: docs/superpowers/plans/2026-07-26-fleet-manager-phase1.md

## Findings closed

1. Per-vehicle Analytics tab rendered fleet aggregates under per-vehicle labels. `GET /fleet/analytics` now accepts `?vehicle_id=`; the response declares its own `scope` and carries a `fleet_comparison` band. Fleet-only blocks are named in `omitted_for_vehicle_scope` so the client hides those cards instead of drawing an empty chart.
2. Banned `#d4a017` (10 sites) and `#888` removed from the fleet-wide tab strip; it now uses the silver ramp classes from the equivalent `ServePage` strip.
3. Ten pre-trip checkboxes shared `id="ff-fleetpage-2"`; ids now derive from the item key and labels are associated.
4. The reset effect ran on mount and clobbered the tab `usePersistedTab` had just restored, making that persistence dead code.
5. Daily Reports did a full page reload via `window.location.href`.
6. The vehicle list silently truncated past the server's 200-row default; it now requests an explicit page size and reports "N of M".
7. `Cost/Mi` failures were swallowed to `null` with no toast and no pending state.
8. The pre-trip modal discarded an answered checklist on any backdrop click and lacked dialog labelling.
9. The fleet-wide tab strip had no `role="tablist"`, no arrow-key navigation, and no persistence.

## Compatibility

The three new response fields are additive and optional on the client, so an older Worker paired with a newer client degrades to the previous fleet-wide behavior rather than rendering `undefined`. This matters because Pages and the Worker deploy independently.

## Not in scope

No hooks were extracted and no files moved — that is Phase 2. No focus *trap* was added: no modal in this app has one, and adding it only here would be inconsistent. The severity/status color literals are unchanged; they are fixed CAD semantics.

## Verification

- `npm run typecheck` — clean
- `npx vitest run` (Worker) — green
- `npm run test:worker` (Miniflare) — green
- `cd client && npx tsc --noEmit` — clean
- `cd client && npx vitest run` — full suite green
- `cd client && npx vite build` — succeeds
- `scripts/audit-hex.mjs` — FleetPage.tsx literal count reduced

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 7: Confirm nothing was dropped by the merge**

After the PR merges, verify the wiring survived the squash — a squash-merge has dropped a
registration line three times in this repo:

```bash
git fetch origin && git show origin/main:src/routes/fleet.ts | grep -n "fleetAnalyticsScope"
```

Expected: the import line is present. If it is absent, the squash dropped it and it must be
re-applied.

---

## Post-merge

No migration ships in this phase, so there is no live-D1 step. Verify the deployed behavior in a
real browser (the WAF managed challenge blocks `curl` on every path except `/api/health`):

1. Open `https://rmpgutah.us/fleet`, select a vehicle, open the **Analytics** tab, and confirm
   the banner reads "Scope: this vehicle" and the fleet-average band is present.
2. Deselect the vehicle and confirm the fleet-wide dashboard still reads "Scope: fleet-wide"
   with all cards present.
3. Tab into the fleet-wide view strip and confirm arrow keys move between views.
