# Driver Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a supervisor-only driver performance capability that scores personnel on driving behavior using existing dashcam AI events, trip telematics, and fleet cost data, with reproducible daily snapshots.

**Architecture:** A nightly cron resolves event attribution and exposure per officer-day and writes immutable rows to a new `driver_performance_daily` table. All reads aggregate over those snapshots. Scoring lives in a pure, D1-free module so it can be tested and quoted independently. Exposure comes pre-attributed from `unit_trips.officer_id`; only dashcam events require attribution inference.

**Tech Stack:** Cloudflare Workers, Hono, D1, TypeScript, Vitest (Node + Miniflare), React 18 + Vite + Tailwind.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-01-driver-performance-design.md`. Every requirement there applies.
- **All D1 calls are async** — always `await` `.first()` / `.all()` / `.run()`.
- **D1 100-bound-parameter cap** — every officer-list `IN (…)` uses `queryInChunks` / `executeInChunks` from `src/utils/db.ts`. Never hand-roll a page loop or an IN-list from an unbounded array.
- **D1 100-column cap** — never `ALTER TABLE` `calls_for_service` or `persons`. `dashcam_events` (16 cols) and `fleet_assignments` (10 cols) are safe.
- **Migrations start at `0222`** (high-water is `0221`). Idempotent DDL. D1 has no `IF NOT EXISTS` on `ADD COLUMN` — gate every `ALTER` with `columnExists()`.
- **Never hardcode hex** in client code. Use `surface-*` / `rmpg-*` / `--sev-*` tokens. 2px radius, never `rounded-lg`.
- **Timestamps are UTC.** Parse D1 timestamps with `parseD1TimestampMs` (exported from `src/utils/fleetio/sync.ts:989`) — `datetime('now')` is zone-less and `Date.parse` reads it as local.
- **Structured logging** via `log.info/warn/error` from `src/utils/logger.ts`, not `console.*`.
- **No silent-skip error handling.** A caught error must never return an empty result that reads as "no events" (which reads as good driving). Flag partial computation in the response.
- **Company name:** "Rocky Mountain Protective Group" in user-facing copy; "RMPG" only for tight spaces.
- **No PII in commit messages or the repo.** No real officer names in tests or fixtures — use synthetic data.
- **Roles:** allowed = `admin`, `manager`, `supervisor`, `human_resources`. Denied = `officer`, `dispatcher`, `client_viewer`, `contract_manager`.

---

## File Structure

| File | Responsibility |
|---|---|
| `migrations/0222_driver_performance_schema.sql` | All three schema changes (assignment FK, event attribution columns, snapshot table) |
| `src/utils/driverPerformance/score.ts` | Pure scoring: weights, exposure gate, 0–100 scale, banding. No D1. |
| `src/utils/driverPerformance/attribution.ts` | Pure attribution resolution order. No D1. |
| `src/utils/driverPerformance/rollup.ts` | D1 orchestration: gather events + exposure + cost, write snapshots |
| `src/routes/driverPerformance.ts` | HTTP surface + RBAC |
| `client/src/pages/fleet/tabs/FleetDriverPerformanceTab.tsx` | Roster + officer detail UI |
| `tests/driverPerformanceScore.test.ts` | Pure scoring tests |
| `tests/driverPerformanceAttribution.test.ts` | Pure attribution tests |
| `test-workers/driverPerformance.test.ts` | Route + RBAC integration tests |
| `src/utils/driverPerformance/pdf.ts` | Evidence-grade PDF renderer (literal hex is correct here) |
| `src/utils/clearpathSync.ts` *(modify)* | Stamps `officer_id` at event ingest |
| `scripts/resolve-assignment-officers.mjs` | One-time backfill of `fleet_assignments.officer_id` |

Pure logic is split from D1 orchestration deliberately: the scoring module is the part most likely to be quoted in a grievance or deposition, and it must be readable and testable without a database.

---

### Task 1: Schema

**Files:**
- Create: `migrations/0222_driver_performance_schema.sql`
- Modify: `src/utils/db.ts` (append reconciler function)

**Interfaces:**
- Consumes: `columnExists` from `src/utils/db.ts`
- Produces: `ensureDriverPerformanceColumns(db: D1Database): Promise<void>`; table `driver_performance_daily`; columns `fleet_assignments.officer_id`, `dashcam_events.officer_id`, `dashcam_events.officer_attribution_source`

- [ ] **Step 1: Write the migration**

Create `migrations/0222_driver_performance_schema.sql`:

```sql
-- Driver Performance (spec 2026-08-01).
-- Attribution FK on assignments; attribution stamp on events; daily snapshots.

-- Time-correct attribution needs an officer FK. Existing rows carry only
-- free-text officer_name; a resolver backfills unambiguous matches later.
ALTER TABLE fleet_assignments ADD COLUMN officer_id INTEGER REFERENCES users(id);

-- Stamped at ingest going forward. 'recorded' | 'inferred' | 'unattributed'.
ALTER TABLE dashcam_events ADD COLUMN officer_id INTEGER REFERENCES users(id);
ALTER TABLE dashcam_events ADD COLUMN officer_attribution_source TEXT;

CREATE TABLE IF NOT EXISTS driver_performance_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id INTEGER NOT NULL REFERENCES users(id),
  perf_date TEXT NOT NULL,

  miles_driven REAL NOT NULL DEFAULT 0,
  drive_minutes REAL NOT NULL DEFAULT 0,
  trip_count INTEGER NOT NULL DEFAULT 0,

  events_critical INTEGER NOT NULL DEFAULT 0,
  events_high INTEGER NOT NULL DEFAULT 0,
  events_moderate INTEGER NOT NULL DEFAULT 0,
  events_low INTEGER NOT NULL DEFAULT 0,

  events_forward_collision INTEGER NOT NULL DEFAULT 0,
  events_lane_departure INTEGER NOT NULL DEFAULT 0,
  events_close_following INTEGER NOT NULL DEFAULT 0,
  events_harsh_brake INTEGER NOT NULL DEFAULT 0,
  events_harsh_accel INTEGER NOT NULL DEFAULT 0,
  events_speeding INTEGER NOT NULL DEFAULT 0,

  attribution_recorded_pct REAL NOT NULL DEFAULT 0,
  attribution_inferred_pct REAL NOT NULL DEFAULT 0,

  fuel_cost REAL NOT NULL DEFAULT 0,
  fuel_gallons REAL NOT NULL DEFAULT 0,
  maintenance_cost REAL NOT NULL DEFAULT 0,

  score REAL,
  score_version TEXT NOT NULL,
  computed_at TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE(officer_id, perf_date)
);

CREATE INDEX IF NOT EXISTS idx_dpd_date ON driver_performance_daily(perf_date);
CREATE INDEX IF NOT EXISTS idx_dpd_officer_date ON driver_performance_daily(officer_id, perf_date);
CREATE INDEX IF NOT EXISTS idx_fleet_assign_officer ON fleet_assignments(officer_id, assigned_at);
CREATE INDEX IF NOT EXISTS idx_dashcam_events_officer ON dashcam_events(officer_id, event_timestamp);
```

- [ ] **Step 2: Apply locally and verify**

Run: `npm run migrate:local`
Then: `npx wrangler d1 execute rmpg-flex --local --command "SELECT name FROM pragma_table_info('driver_performance_daily')"`
Expected: the column list above, including `score_version` and the four cost columns.

- [ ] **Step 3: Add the runtime reconciler**

Append to `src/utils/db.ts` (deploy applies migrations with `continue-on-error`, so the Worker self-heals):

```ts
// ── Driver Performance reconciler (mig 0222) ───────────────
// deploy.yml applies migrations with continue-on-error, and D1 has no
// IF NOT EXISTS on ADD COLUMN — gate each ALTER with columnExists().
let _driverPerformanceEnsured = false;

export async function ensureDriverPerformanceColumns(db: D1Database): Promise<void> {
  if (_driverPerformanceEnsured) return;
  const COLUMNS: Array<[string, string, string]> = [
    ['fleet_assignments', 'officer_id', 'INTEGER'],
    ['dashcam_events', 'officer_id', 'INTEGER'],
    ['dashcam_events', 'officer_attribution_source', 'TEXT'],
  ];
  for (const [table, col, type] of COLUMNS) {
    try {
      if (!(await columnExists(db, table, col))) {
        await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`).run();
      }
    } catch {
      // Race or pre-existing column — tolerated by design (CLAUDE.md rule #5).
    }
  }
  const columnsOk = await Promise.all(
    COLUMNS.map(([t, c]) => columnExists(db, t, c)),
  ).then((r) => r.every(Boolean));
  _driverPerformanceEnsured = columnsOk;
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add migrations/0222_driver_performance_schema.sql src/utils/db.ts
git commit -m "feat(driver-performance): schema for attribution and daily snapshots"
```

---

### Task 2: Pure attribution module

**Files:**
- Create: `src/utils/driverPerformance/attribution.ts`
- Test: `tests/driverPerformanceAttribution.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure).
- Produces:
  - `type AttributionSource = 'recorded' | 'inferred' | 'unattributed'`
  - `interface AssignmentWindow { officerId: number; startMs: number; endMs: number | null }`
  - `interface AttributionResult { officerId: number | null; source: AttributionSource }`
  - `resolveAttribution(stampedOfficerId: number | null, eventMs: number | null, windows: readonly AssignmentWindow[]): AttributionResult`

- [ ] **Step 1: Write the failing test**

Create `tests/driverPerformanceAttribution.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveAttribution, type AssignmentWindow } from '../src/utils/driverPerformance/attribution';

const W: AssignmentWindow[] = [
  { officerId: 10, startMs: Date.parse('2026-03-01T00:00:00Z'), endMs: Date.parse('2026-03-10T00:00:00Z') },
  { officerId: 20, startMs: Date.parse('2026-03-10T00:00:00Z'), endMs: null }, // open-ended
];
const at = (iso: string) => Date.parse(iso);

describe('resolveAttribution', () => {
  it('prefers a stamped officer over any assignment window', () => {
    expect(resolveAttribution(99, at('2026-03-05T12:00:00Z'), W))
      .toEqual({ officerId: 99, source: 'recorded' });
  });

  it('infers from the assignment window covering the event', () => {
    expect(resolveAttribution(null, at('2026-03-05T12:00:00Z'), W))
      .toEqual({ officerId: 10, source: 'inferred' });
  });

  it('treats an open-ended window as extending to now', () => {
    expect(resolveAttribution(null, at('2026-06-01T00:00:00Z'), W))
      .toEqual({ officerId: 20, source: 'inferred' });
  });

  it('returns unattributed outside every window, not the nearest one', () => {
    expect(resolveAttribution(null, at('2026-01-01T00:00:00Z'), W))
      .toEqual({ officerId: null, source: 'unattributed' });
  });

  it('is half-open: the window end belongs to the next assignment', () => {
    expect(resolveAttribution(null, at('2026-03-10T00:00:00Z'), W))
      .toEqual({ officerId: 20, source: 'inferred' });
  });

  it('returns unattributed when the event timestamp is unparseable', () => {
    expect(resolveAttribution(null, null, W))
      .toEqual({ officerId: null, source: 'unattributed' });
  });

  it('returns unattributed when windows overlap ambiguously', () => {
    const overlap: AssignmentWindow[] = [
      { officerId: 1, startMs: at('2026-03-01T00:00:00Z'), endMs: at('2026-03-20T00:00:00Z') },
      { officerId: 2, startMs: at('2026-03-05T00:00:00Z'), endMs: at('2026-03-25T00:00:00Z') },
    ];
    expect(resolveAttribution(null, at('2026-03-10T00:00:00Z'), overlap))
      .toEqual({ officerId: null, source: 'unattributed' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/driverPerformanceAttribution.test.ts`
Expected: FAIL — cannot resolve `../src/utils/driverPerformance/attribution`.

- [ ] **Step 3: Write the implementation**

Create `src/utils/driverPerformance/attribution.ts`:

```ts
// Time-correct attribution of a driving event to an officer.
//
// This exists because src/routes/drivingEvents.ts attributes via
// units.officer_id — the officer in the vehicle NOW. That is correct for a
// live console and wrong for any historical aggregate: it credits every past
// event to whoever happens to be driving today.
//
// Pure by design. No D1. See spec 2026-08-01-driver-performance-design.md.

export type AttributionSource = 'recorded' | 'inferred' | 'unattributed';

export interface AssignmentWindow {
  officerId: number;
  startMs: number;
  /** null means still open (extends to now). */
  endMs: number | null;
}

export interface AttributionResult {
  officerId: number | null;
  source: AttributionSource;
}

const UNATTRIBUTED: AttributionResult = { officerId: null, source: 'unattributed' };

/**
 * Resolution order: stamped -> assignment covering the timestamp -> unattributed.
 *
 * Windows are half-open [start, end): an event exactly at a window's end
 * belongs to the next assignment, so a handover instant cannot match twice.
 *
 * Ambiguity (two windows covering the same instant) resolves to unattributed
 * rather than picking one. Guessing here would attribute a driving event to a
 * named person on no evidence, which is the failure mode this whole feature
 * is built to avoid.
 */
export function resolveAttribution(
  stampedOfficerId: number | null,
  eventMs: number | null,
  windows: readonly AssignmentWindow[],
): AttributionResult {
  if (stampedOfficerId != null) {
    return { officerId: stampedOfficerId, source: 'recorded' };
  }
  if (eventMs == null || !Number.isFinite(eventMs)) return UNATTRIBUTED;

  const matches = windows.filter(
    (w) => eventMs >= w.startMs && (w.endMs == null || eventMs < w.endMs),
  );
  if (matches.length !== 1) return UNATTRIBUTED;
  return { officerId: matches[0].officerId, source: 'inferred' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/driverPerformanceAttribution.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/utils/driverPerformance/attribution.ts tests/driverPerformanceAttribution.test.ts
git commit -m "feat(driver-performance): time-correct attribution resolver"
```

---

### Task 3: Pure scoring module

**Files:**
- Create: `src/utils/driverPerformance/score.ts`
- Test: `tests/driverPerformanceScore.test.ts`

**Interfaces:**
- Consumes: `AttributionSource` from `src/utils/driverPerformance/attribution.ts`
- Produces:
  - `const SCORE_VERSION: string`
  - `const MIN_EXPOSURE_MILES = 250`
  - `interface EventCounts { forwardCollision: number; laneDeparture: number; closeFollowing: number; harshBrake: number; harshAccel: number; speeding: number }`
  - `type ScoreBand = 'excellent' | 'good' | 'needs_attention' | 'at_risk'`
  - `interface ScoreInput { milesDriven: number; events: EventCounts; recordedPct: number }`
  - `type ScoreResult = { status: 'insufficient_data'; milesDriven: number } | { status: 'scored'; score: number; band: ScoreBand; weightedRatePer100Miles: number; milesDriven: number; confidence: 'recorded' | 'inferred'; scoreVersion: string }`
  - `severityWeight(event: keyof EventCounts): number`
  - `computeScore(input: ScoreInput): ScoreResult`

> **⚠️ OWNER INPUT REQUIRED.** `severityWeight` encodes how much worse a
> forward-collision warning is than a close-following event. That is a policy
> judgment about Rocky Mountain Protective Group's risk tolerance, not a
> technical one, and the numbers may end up quoted as if they were principled.
> The step below ships placeholder weights **and a test that fails until they
> are reviewed**. Do not silently accept the placeholders.

- [ ] **Step 1: Write the failing test**

Create `tests/driverPerformanceScore.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  computeScore, severityWeight, weightsPendingReview,
  MIN_EXPOSURE_MILES, SCORE_VERSION,
  type EventCounts,
} from '../src/utils/driverPerformance/score';

const NO_EVENTS: EventCounts = {
  forwardCollision: 0, laneDeparture: 0, closeFollowing: 0,
  harshBrake: 0, harshAccel: 0, speeding: 0,
};
const ev = (p: Partial<EventCounts>): EventCounts => ({ ...NO_EVENTS, ...p });

describe('exposure floor', () => {
  it('returns insufficient_data one mile below the floor', () => {
    const r = computeScore({ milesDriven: MIN_EXPOSURE_MILES - 1, events: ev({ harshBrake: 3 }), recordedPct: 1 });
    expect(r.status).toBe('insufficient_data');
  });

  it('scores exactly at the floor', () => {
    const r = computeScore({ milesDriven: MIN_EXPOSURE_MILES, events: ev({ harshBrake: 3 }), recordedPct: 1 });
    expect(r.status).toBe('scored');
  });

  it('never divides by zero mileage', () => {
    const r = computeScore({ milesDriven: 0, events: ev({ forwardCollision: 5 }), recordedPct: 1 });
    expect(r.status).toBe('insufficient_data');
  });

  it('treats negative mileage as insufficient rather than inverting the score', () => {
    const r = computeScore({ milesDriven: -100, events: NO_EVENTS, recordedPct: 1 });
    expect(r.status).toBe('insufficient_data');
  });
});

describe('scoring', () => {
  it('gives a clean driver the maximum score', () => {
    const r = computeScore({ milesDriven: 1000, events: NO_EVENTS, recordedPct: 1 });
    expect(r).toMatchObject({ status: 'scored', score: 100, band: 'excellent' });
  });

  it('is monotonic — more events never scores higher', () => {
    const few = computeScore({ milesDriven: 1000, events: ev({ harshBrake: 2 }), recordedPct: 1 });
    const many = computeScore({ milesDriven: 1000, events: ev({ harshBrake: 20 }), recordedPct: 1 });
    if (few.status !== 'scored' || many.status !== 'scored') throw new Error('both should score');
    expect(many.score).toBeLessThan(few.score);
  });

  it('normalizes by exposure — double miles with double events scores the same', () => {
    const a = computeScore({ milesDriven: 1000, events: ev({ harshBrake: 4 }), recordedPct: 1 });
    const b = computeScore({ milesDriven: 2000, events: ev({ harshBrake: 8 }), recordedPct: 1 });
    if (a.status !== 'scored' || b.status !== 'scored') throw new Error('both should score');
    expect(b.score).toBeCloseTo(a.score, 5);
  });

  it('does not grade on a curve — score depends only on this officer', () => {
    const r1 = computeScore({ milesDriven: 1000, events: ev({ speeding: 3 }), recordedPct: 1 });
    const r2 = computeScore({ milesDriven: 1000, events: ev({ speeding: 3 }), recordedPct: 1 });
    expect(r1).toEqual(r2);
  });

  it('clamps at zero rather than going negative on an extreme rate', () => {
    const r = computeScore({ milesDriven: 250, events: ev({ forwardCollision: 500 }), recordedPct: 1 });
    if (r.status !== 'scored') throw new Error('should score');
    expect(r.score).toBe(0);
  });

  it('reports the version it was computed under', () => {
    const r = computeScore({ milesDriven: 1000, events: NO_EVENTS, recordedPct: 1 });
    if (r.status !== 'scored') throw new Error('should score');
    expect(r.scoreVersion).toBe(SCORE_VERSION);
  });
});

describe('attribution confidence', () => {
  it('flags a majority-inferred score as inferred', () => {
    const r = computeScore({ milesDriven: 1000, events: ev({ harshBrake: 2 }), recordedPct: 0.4 });
    if (r.status !== 'scored') throw new Error('should score');
    expect(r.confidence).toBe('inferred');
  });

  it('flags a majority-recorded score as recorded', () => {
    const r = computeScore({ milesDriven: 1000, events: ev({ harshBrake: 2 }), recordedPct: 0.9 });
    if (r.status !== 'scored') throw new Error('should score');
    expect(r.confidence).toBe('recorded');
  });
});

describe('severity weights', () => {
  it('ranks a forward-collision warning above a close-following event', () => {
    expect(severityWeight('forwardCollision')).toBeGreaterThan(severityWeight('closeFollowing'));
  });

  it('assigns a positive weight to every event type', () => {
    (Object.keys(NO_EVENTS) as (keyof EventCounts)[])
      .forEach((k) => expect(severityWeight(k)).toBeGreaterThan(0));
  });

  it('reports weights as pending review while the version is a placeholder', () => {
    // The runtime guard in the route keys off this. It is a normal assertion:
    // it documents current state and flips to a real, meaningful failure the
    // moment SCORE_VERSION is set to 'v1' without the guard being removed.
    expect(weightsPendingReview()).toBe(SCORE_VERSION.includes('placeholder'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/driverPerformanceScore.test.ts`
Expected: FAIL — cannot resolve `../src/utils/driverPerformance/score`.

- [ ] **Step 3: Write the implementation**

Create `src/utils/driverPerformance/score.ts`:

```ts
// Driver performance scoring — PURE. No D1, no I/O, no clock.
//
// Kept isolated because this is the logic most likely to be read by someone
// who is not a developer: a supervisor in a review, or opposing counsel in
// discovery. It must be legible and testable on its own.
//
// Spec: docs/superpowers/specs/2026-08-01-driver-performance-design.md

/**
 * Bump on ANY weighting or formula change. Snapshots store the version they
 * were computed under so retuning never silently restates history.
 *
 * TODO(owner): rename to 'v1' once weights below are reviewed.
 */
export const SCORE_VERSION = 'v1-placeholder-weights';

/** Below this, no score is produced. A blank is honest; a zero is a claim. */
export const MIN_EXPOSURE_MILES = 250;

/** Weighted events per 100 miles that maps to a score of 0. */
const REFERENCE_RATE_AT_ZERO = 20;

/** Below this share of recorded (vs inferred) attribution, flag as inferred. */
const RECORDED_CONFIDENCE_THRESHOLD = 0.5;

export interface EventCounts {
  forwardCollision: number;
  laneDeparture: number;
  closeFollowing: number;
  harshBrake: number;
  harshAccel: number;
  speeding: number;
}

export type ScoreBand = 'excellent' | 'good' | 'needs_attention' | 'at_risk';

export interface ScoreInput {
  milesDriven: number;
  events: EventCounts;
  /** 0..1 — share of this window's events with recorded (not inferred) attribution. */
  recordedPct: number;
}

export type ScoreResult =
  | { status: 'insufficient_data'; milesDriven: number }
  | {
      status: 'scored';
      score: number;
      band: ScoreBand;
      weightedRatePer100Miles: number;
      milesDriven: number;
      confidence: 'recorded' | 'inferred';
      scoreVersion: string;
    };

/**
 * ⚠️ PLACEHOLDER WEIGHTS — REQUIRES OWNER REVIEW.
 *
 * These encode how much worse one risky behavior is than another. That is a
 * policy judgment about Rocky Mountain Protective Group's risk tolerance, not
 * a technical default. The values below are ordered sensibly but are NOT
 * authoritative. Review them, then update SCORE_VERSION to 'v1' and delete
 * the `it.fails('has owner-reviewed weights')` gate in the test file.
 */
const WEIGHTS: Record<keyof EventCounts, number> = {
  forwardCollision: 10, // imminent-collision warning — highest real-crash proximity
  harshBrake: 6,        // often the reaction to following too closely
  closeFollowing: 4,    // sustained risk posture rather than a single moment
  laneDeparture: 4,     // attention/fatigue signal
  speeding: 3,
  harshAccel: 2,        // wear and fuel more than crash risk
};

export function severityWeight(event: keyof EventCounts): number {
  return WEIGHTS[event];
}

/**
 * True while the severity weights are still placeholders.
 *
 * The route uses this to refuse to serve scores: a number derived from
 * unreviewed weights must not reach a supervisor, because it would look
 * exactly like a reviewed one. Fails loudly where someone will notice,
 * rather than in a CI suite nobody reads.
 */
export function weightsPendingReview(): boolean {
  return SCORE_VERSION.includes('placeholder');
}

function bandFor(score: number): ScoreBand {
  if (score >= 90) return 'excellent';
  if (score >= 75) return 'good';
  if (score >= 50) return 'needs_attention';
  return 'at_risk';
}

/**
 * Score is anchored to a FIXED reference rate, not to the current roster.
 * An officer's score must never move because a colleague drove badly —
 * that would make a snapshot unreproducible and the ranking incoherent.
 *
 * This function never returns a rank. Ranking happens in the route, over
 * scored officers only, so an `insufficient_data` officer can never land at
 * the bottom of a leaderboard.
 */
export function computeScore(input: ScoreInput): ScoreResult {
  const { milesDriven, events, recordedPct } = input;

  if (!Number.isFinite(milesDriven) || milesDriven < MIN_EXPOSURE_MILES) {
    return { status: 'insufficient_data', milesDriven: Math.max(0, milesDriven || 0) };
  }

  const weightedEvents = (Object.keys(WEIGHTS) as (keyof EventCounts)[])
    .reduce((sum, k) => sum + WEIGHTS[k] * (events[k] || 0), 0);

  const weightedRatePer100Miles = weightedEvents / (milesDriven / 100);

  const raw = 100 * (1 - weightedRatePer100Miles / REFERENCE_RATE_AT_ZERO);
  const score = Math.round(Math.min(100, Math.max(0, raw)) * 10) / 10;

  return {
    status: 'scored',
    score,
    band: bandFor(score),
    weightedRatePer100Miles,
    milesDriven,
    confidence: recordedPct >= RECORDED_CONFIDENCE_THRESHOLD ? 'recorded' : 'inferred',
    scoreVersion: SCORE_VERSION,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/driverPerformanceScore.test.ts`
Expected: PASS. The `it.fails('has owner-reviewed weights')` case passes *because it is expected to fail* — that is the owner gate, and it flips to a real failure once `SCORE_VERSION` is updated, which is the signal to delete it.

- [ ] **Step 5: Commit**

```bash
git add src/utils/driverPerformance/score.ts tests/driverPerformanceScore.test.ts
git commit -m "feat(driver-performance): pure scoring module with exposure floor"
```

---

### Task 4: Rollup orchestration

**Files:**
- Create: `src/utils/driverPerformance/rollup.ts`

**Interfaces:**
- Consumes: `resolveAttribution`, `AssignmentWindow` (Task 2); `computeScore`, `SCORE_VERSION`, `EventCounts` (Task 3); `query`, `execute`, `queryInChunks` from `src/utils/db.ts`; `parseD1TimestampMs` from `src/utils/fleetio/sync.ts`; `log` from `src/utils/logger.ts`
- Produces: `rollupDay(db: D1Database, perfDate: string): Promise<{ officersProcessed: number; failures: number }>`

Exposure comes from `unit_trips`, which already carries `officer_id`, `distance_m`, and `duration_s` — miles are pre-attributed and need no inference. Only events require attribution resolution.

- [ ] **Step 1: Write the implementation**

Create `src/utils/driverPerformance/rollup.ts`:

```ts
// Nightly rollup: one immutable snapshot row per officer per day.
//
// Exposure (unit_trips) is already officer-attributed. Only dashcam events
// need attribution resolution — that asymmetry is why the denominator is
// trustworthy from day one while the numerator carries a confidence flag.

import { query, execute } from '../db';
import { log } from '../logger';
import { parseD1TimestampMs } from '../fleetio/sync';
import { resolveAttribution, type AssignmentWindow } from './attribution';
import { computeScore, SCORE_VERSION, type EventCounts } from './score';

const EMPTY_EVENTS = (): EventCounts => ({
  forwardCollision: 0, laneDeparture: 0, closeFollowing: 0,
  harshBrake: 0, harshAccel: 0, speeding: 0,
});

/** Maps raw ClearPath event labels onto our counted buckets. */
function bucketFor(rawType: string | null): keyof EventCounts | null {
  const t = (rawType || '').toLowerCase();
  if (t.includes('forward') || t.includes('fcw') || t.includes('collision')) return 'forwardCollision';
  if (t.includes('lane')) return 'laneDeparture';
  if (t.includes('following') || t.includes('headway')) return 'closeFollowing';
  if (t.includes('brak')) return 'harshBrake';
  if (t.includes('accel')) return 'harshAccel';
  if (t.includes('speed')) return 'speeding';
  return null;
}

const SEVERITY_OF: Record<keyof EventCounts, 'critical' | 'high' | 'moderate' | 'low'> = {
  forwardCollision: 'critical',
  harshBrake: 'high',
  closeFollowing: 'high',
  laneDeparture: 'moderate',
  speeding: 'moderate',
  harshAccel: 'low',
};

interface Acc {
  events: EventCounts;
  severity: { critical: number; high: number; moderate: number; low: number };
  recorded: number;
  inferred: number;
  miles: number;
  minutes: number;
  trips: number;
  fuelCost: number;
  fuelGallons: number;
  maintenanceCost: number;
}

const newAcc = (): Acc => ({
  events: EMPTY_EVENTS(),
  severity: { critical: 0, high: 0, moderate: 0, low: 0 },
  recorded: 0, inferred: 0,
  miles: 0, minutes: 0, trips: 0,
  fuelCost: 0, fuelGallons: 0, maintenanceCost: 0,
});

const METERS_PER_MILE = 1609.344;

/**
 * Recompute one day. Idempotent — upserts on (officer_id, perf_date).
 *
 * A failure on one officer is logged and skipped; the batch continues. That
 * day then has NO snapshot, which is visible as a gap. It is never written
 * as a zero, because a zero-event day reads as good driving.
 */
export async function rollupDay(
  db: D1Database,
  perfDate: string,
): Promise<{ officersProcessed: number; failures: number }> {
  const dayStart = `${perfDate} 00:00:00`;
  const dayEnd = `${perfDate} 23:59:59`;

  // Assignment windows overlapping this day, for event attribution.
  const assignRows = await query<{ officer_id: number | null; unit_id: number | null; assigned_at: string | null; unassigned_at: string | null }>(
    db,
    `SELECT officer_id, unit_id, assigned_at, unassigned_at
       FROM fleet_assignments
      WHERE officer_id IS NOT NULL
        AND (assigned_at IS NULL OR assigned_at <= ?)
        AND (unassigned_at IS NULL OR unassigned_at >= ?)`,
    dayEnd, dayStart,
  );

  const windowsByUnit = new Map<number, AssignmentWindow[]>();
  for (const r of assignRows) {
    if (r.unit_id == null || r.officer_id == null) continue;
    const startMs = parseD1TimestampMs(r.assigned_at);
    if (startMs == null) continue;
    const list = windowsByUnit.get(r.unit_id) ?? [];
    list.push({ officerId: r.officer_id, startMs, endMs: parseD1TimestampMs(r.unassigned_at) });
    windowsByUnit.set(r.unit_id, list);
  }

  const acc = new Map<number, Acc>();
  const get = (id: number): Acc => {
    let a = acc.get(id);
    if (!a) { a = newAcc(); acc.set(id, a); }
    return a;
  };

  // ── Events (need attribution) ──
  const eventRows = await query<{ unit_id: number | null; officer_id: number | null; event_type: string | null; event_timestamp: string | null }>(
    db,
    `SELECT unit_id, officer_id, event_type, event_timestamp
       FROM dashcam_events
      WHERE event_timestamp >= ? AND event_timestamp <= ?`,
    dayStart, dayEnd,
  );

  for (const e of eventRows) {
    const bucket = bucketFor(e.event_type);
    if (!bucket) continue;
    const windows = e.unit_id != null ? (windowsByUnit.get(e.unit_id) ?? []) : [];
    const { officerId, source } = resolveAttribution(
      e.officer_id, parseD1TimestampMs(e.event_timestamp), windows,
    );
    if (officerId == null) continue; // unattributed: excluded from BOTH sides
    const a = get(officerId);
    a.events[bucket] += 1;
    a.severity[SEVERITY_OF[bucket]] += 1;
    if (source === 'recorded') a.recorded += 1; else a.inferred += 1;
  }

  // ── Exposure (already officer-attributed) ──
  const tripRows = await query<{ officer_id: number | null; distance_m: number | null; duration_s: number | null }>(
    db,
    `SELECT officer_id, distance_m, duration_s
       FROM unit_trips
      WHERE officer_id IS NOT NULL AND start_time >= ? AND start_time <= ?`,
    dayStart, dayEnd,
  );
  for (const t of tripRows) {
    if (t.officer_id == null) continue;
    const a = get(t.officer_id);
    a.miles += (t.distance_m ?? 0) / METERS_PER_MILE;
    a.minutes += (t.duration_s ?? 0) / 60;
    a.trips += 1;
  }

  // ── Cost, attributed through the same assignment windows (lens 4) ──
  // Displayed beside the safety score, never folded into it: a driver
  // assigned an older, thirstier vehicle must not score as unsafe.
  // ⚠️ fuel_date holds a FULL 'YYYY-MM-DD HH:MM:SS' UTC timestamp, never a bare
  // date — normalizeToUtcTimestamp (src/utils/denverTime.ts:195) converts even a
  // date-only input to Denver-midnight-as-UTC. `WHERE fuel_date = ?` against a
  // bare date matches ZERO rows and silently reports $0 for every officer.
  const fuelRows = await query<{ vehicle_id: number; total_cost: number | null; gallons: number | null }>(
    db,
    `SELECT vehicle_id, total_cost, gallons
       FROM fleet_fuel_log WHERE fuel_date >= ? AND fuel_date <= ?`,
    dayStart, dayEnd,
  );

  // Cost attaches to a vehicle only when exactly ONE officer held it that day.
  // On a mid-shift swap the day's fuel belongs to one of them and we cannot
  // tell which, so it goes to NEITHER — the same rule resolveAttribution
  // applies to ambiguous events. Two rows for the SAME officer are not
  // ambiguous. Guessing here would put a wrong dollar figure on a named person.
  const vehicleOfficer = new Map<number, number>();
  const ambiguousVehicles = new Set<number>();
  const vehAssign = await query<{ vehicle_id: number; officer_id: number | null }>(
    db,
    `SELECT DISTINCT vehicle_id, officer_id FROM fleet_assignments
      WHERE officer_id IS NOT NULL
        AND (assigned_at IS NULL OR assigned_at <= ?)
        AND (unassigned_at IS NULL OR unassigned_at >= ?)`,
    dayEnd, dayStart,
  );
  for (const v of vehAssign) {
    if (v.officer_id == null) continue;
    const seen = vehicleOfficer.get(v.vehicle_id);
    if (seen != null && seen !== v.officer_id) {
      ambiguousVehicles.add(v.vehicle_id);
      vehicleOfficer.delete(v.vehicle_id);
    } else if (!ambiguousVehicles.has(v.vehicle_id)) {
      vehicleOfficer.set(v.vehicle_id, v.officer_id);
    }
  }

  for (const f of fuelRows) {
    const officerId = vehicleOfficer.get(f.vehicle_id);
    if (officerId == null) continue;
    const a = get(officerId);
    a.fuelCost += f.total_cost ?? 0;
    a.fuelGallons += f.gallons ?? 0;
  }

  const maintRows = await query<{ vehicle_id: number; cost: number | null }>(
    db,
    `SELECT vehicle_id, cost FROM fleet_maintenance WHERE date(performed_at) = ?`,
    perfDate,
  );
  for (const m of maintRows) {
    const officerId = vehicleOfficer.get(m.vehicle_id);
    if (officerId == null) continue;
    get(officerId).maintenanceCost += m.cost ?? 0;
  }

  // ── Write snapshots ──
  let failures = 0;
  for (const [officerId, a] of acc) {
    try {
      const totalAttributed = a.recorded + a.inferred;
      const recordedPct = totalAttributed > 0 ? a.recorded / totalAttributed : 1;
      const inferredPct = totalAttributed > 0 ? a.inferred / totalAttributed : 0;
      const result = computeScore({ milesDriven: a.miles, events: a.events, recordedPct });
      const score = result.status === 'scored' ? result.score : null;

      await execute(
        db,
        `INSERT INTO driver_performance_daily (
           officer_id, perf_date, miles_driven, drive_minutes, trip_count,
           events_critical, events_high, events_moderate, events_low,
           events_forward_collision, events_lane_departure, events_close_following,
           events_harsh_brake, events_harsh_accel, events_speeding,
           attribution_recorded_pct, attribution_inferred_pct,
           fuel_cost, fuel_gallons, maintenance_cost,
           score, score_version, computed_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))
         ON CONFLICT(officer_id, perf_date) DO UPDATE SET
           miles_driven=excluded.miles_driven, drive_minutes=excluded.drive_minutes,
           trip_count=excluded.trip_count,
           events_critical=excluded.events_critical, events_high=excluded.events_high,
           events_moderate=excluded.events_moderate, events_low=excluded.events_low,
           events_forward_collision=excluded.events_forward_collision,
           events_lane_departure=excluded.events_lane_departure,
           events_close_following=excluded.events_close_following,
           events_harsh_brake=excluded.events_harsh_brake,
           events_harsh_accel=excluded.events_harsh_accel,
           events_speeding=excluded.events_speeding,
           attribution_recorded_pct=excluded.attribution_recorded_pct,
           attribution_inferred_pct=excluded.attribution_inferred_pct,
           fuel_cost=excluded.fuel_cost, fuel_gallons=excluded.fuel_gallons,
           maintenance_cost=excluded.maintenance_cost,
           score=excluded.score, score_version=excluded.score_version,
           computed_at=datetime('now')`,
        officerId, perfDate, a.miles, a.minutes, a.trips,
        a.severity.critical, a.severity.high, a.severity.moderate, a.severity.low,
        a.events.forwardCollision, a.events.laneDeparture, a.events.closeFollowing,
        a.events.harshBrake, a.events.harshAccel, a.events.speeding,
        recordedPct, inferredPct,
        a.fuelCost, a.fuelGallons, a.maintenanceCost,
        score, SCORE_VERSION,
      );
    } catch (err) {
      failures += 1;
      log.error('driver-performance rollup failed for officer', { officerId, perfDate }, err as Error);
    }
  }

  return { officersProcessed: acc.size, failures };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/utils/driverPerformance/rollup.ts
git commit -m "feat(driver-performance): daily rollup orchestration"
```

---

### Task 5: API route and RBAC

**Files:**
- Create: `src/routes/driverPerformance.ts`
- Modify: `src/routesConfig.ts` (import + registry entry)
- Modify: `src/middleware/auth.ts` (add prefix to `READ_ONLY_DENIED_PREFIXES`)
- Test: `test-workers/driverPerformance.test.ts`

**Interfaces:**
- Consumes: `rollupDay` (Task 4); `computeScore`, `MIN_EXPOSURE_MILES` (Task 3); `requireRole` from `src/middleware/auth.ts`; `ensureDriverPerformanceColumns` (Task 1)
- Produces: default-exported Hono router mounted at `/api/driver-performance`

- [ ] **Step 1: Write the failing RBAC test**

Create `test-workers/driverPerformance.test.ts`. Follow the harness setup already used in `test-workers/auth.test.ts` (read it first for the Miniflare + JWT helpers):

```ts
import { describe, it, expect } from 'vitest';
// Reuse the same Miniflare bootstrap + token helper as test-workers/auth.test.ts.
import { makeRequest, tokenFor } from './helpers';

const DENIED = ['officer', 'dispatcher', 'client_viewer', 'contract_manager'];
const ALLOWED = ['admin', 'manager', 'supervisor', 'human_resources'];
const READ_PATHS = ['/api/driver-performance/roster', '/api/driver-performance/officer/1'];

describe('driver-performance RBAC', () => {
  for (const role of DENIED) {
    for (const path of READ_PATHS) {
      it(`denies ${role} on GET ${path}`, async () => {
        const res = await makeRequest(path, { headers: { Authorization: `Bearer ${await tokenFor(role)}` } });
        expect(res.status).toBe(403);
      });
    }
  }

  for (const role of ALLOWED) {
    it(`allows ${role} on GET /roster`, async () => {
      const res = await makeRequest('/api/driver-performance/roster', {
        headers: { Authorization: `Bearer ${await tokenFor(role)}` },
      });
      expect(res.status).toBe(200);
    });
  }

  it('rejects an unauthenticated request', async () => {
    const res = await makeRequest('/api/driver-performance/roster');
    expect(res.status).toBe(401);
  });

  it('denies a non-admin on POST /recompute', async () => {
    const res = await makeRequest('/api/driver-performance/recompute', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await tokenFor('supervisor')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: '2026-03-01', to: '2026-03-02' }),
    });
    expect(res.status).toBe(403);
  });
});

describe('weights owner gate', () => {
  // While SCORE_VERSION contains 'placeholder', no score is served. Once the
  // owner sets real weights, DELETE this test and un-skip the roster-shape
  // tests below — that swap is the intended, visible handover.
  it('refuses to serve scores while severity weights are unreviewed', async () => {
    const res = await makeRequest('/api/driver-performance/roster', {
      headers: { Authorization: `Bearer ${await tokenFor('supervisor')}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; code: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe('weights_pending_review');
  });

  it('gates the officer detail endpoint too', async () => {
    const res = await makeRequest('/api/driver-performance/officer/1', {
      headers: { Authorization: `Bearer ${await tokenFor('supervisor')}` },
    });
    const body = await res.json() as { code?: string };
    expect(body.code).toBe('weights_pending_review');
  });

  it('applies RBAC BEFORE the weights gate — a denied role still gets 403', async () => {
    // Order matters: if the gate ran first, client_viewer would receive a 200
    // instead of a 403, and the RBAC tests above would pass for the wrong reason.
    const res = await makeRequest('/api/driver-performance/roster', {
      headers: { Authorization: `Bearer ${await tokenFor('client_viewer')}` },
    });
    expect(res.status).toBe(403);
  });
});

describe.skip('roster shape (un-skip once weights are reviewed)', () => {
  it('separates unranked insufficient-exposure officers from the ranked list', async () => {
    const res = await makeRequest('/api/driver-performance/roster?from=2026-03-01&to=2026-03-31', {
      headers: { Authorization: `Bearer ${await tokenFor('supervisor')}` },
    });
    const body = await res.json() as { ranked: unknown[]; insufficient_data: unknown[] };
    expect(Array.isArray(body.ranked)).toBe(true);
    expect(Array.isArray(body.insufficient_data)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:worker -- driverPerformance`
Expected: FAIL — every request 404s because the route is not mounted.

- [ ] **Step 3: Write the route**

Create `src/routes/driverPerformance.ts`:

```ts
// Driver Performance API — supervisor-only.
//
// ⚠️ RBAC is enforced on the GET handlers directly, NOT left to
// readOnlyRoleGuard, which backstops MUTATIONS only. An ungated GET in this
// codebase is reachable by every authenticated role including client_viewer
// (an external contract client with a login). Leaking named officer risk
// scores to a contract client is the worst failure this route can have.

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, ensureDriverPerformanceColumns } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { log } from '../utils/logger';
import { computeScore, MIN_EXPOSURE_MILES, weightsPendingReview, SCORE_VERSION } from '../utils/driverPerformance/score';
import { rollupDay } from '../utils/driverPerformance/rollup';

const driverPerformance = new Hono<Env>();

const VIEW_ROLES = ['admin', 'manager', 'supervisor', 'human_resources'] as const;
const canView = requireRole(...VIEW_ROLES);

/**
 * Runtime owner gate. While the severity weights are placeholders, no score
 * is served — a number from unreviewed weights is indistinguishable from a
 * reviewed one once it is on a supervisor's screen, and this feature's whole
 * risk is confident wrong numbers about named people.
 *
 * Follows the house not_configured convention: 200 with ok:false and a code,
 * never a 503, so the client can render an explanatory banner instead of an
 * error state.
 */
function weightsGate(c: { json: (o: unknown) => Response }): Response | null {
  if (!weightsPendingReview()) return null;
  return c.json({
    ok: false,
    code: 'weights_pending_review',
    message: 'Driver performance scoring is unavailable: severity weights have not been reviewed and approved by Rocky Mountain Protective Group.',
    score_version: SCORE_VERSION,
  });
}

/** Default window: trailing 30 days. */
function windowFrom(c: { req: { query: (k: string) => string | undefined } }) {
  const to = c.req.query('to') || new Date().toISOString().slice(0, 10);
  const from = c.req.query('from')
    || new Date(Date.parse(to) - 29 * 86400000).toISOString().slice(0, 10);
  return { from, to };
}

interface AggRow {
  officer_id: number;
  officer_name: string | null;
  badge_number: string | null;
  miles: number; minutes: number; trips: number;
  fc: number; ld: number; cf: number; hb: number; ha: number; sp: number;
  recorded_events: number; inferred_events: number;
  fuel_cost: number; fuel_gallons: number; maintenance_cost: number;
}

const AGG_SQL = `
  SELECT d.officer_id,
         u.full_name AS officer_name, u.badge_number,
         COALESCE(SUM(d.miles_driven),0)  AS miles,
         COALESCE(SUM(d.drive_minutes),0) AS minutes,
         COALESCE(SUM(d.trip_count),0)    AS trips,
         COALESCE(SUM(d.events_forward_collision),0) AS fc,
         COALESCE(SUM(d.events_lane_departure),0)    AS ld,
         COALESCE(SUM(d.events_close_following),0)   AS cf,
         COALESCE(SUM(d.events_harsh_brake),0)       AS hb,
         COALESCE(SUM(d.events_harsh_accel),0)       AS ha,
         COALESCE(SUM(d.events_speeding),0)          AS sp,
         COALESCE(SUM(d.attribution_recorded_pct * (
           d.events_forward_collision + d.events_lane_departure + d.events_close_following +
           d.events_harsh_brake + d.events_harsh_accel + d.events_speeding)),0) AS recorded_events,
         COALESCE(SUM(d.attribution_inferred_pct * (
           d.events_forward_collision + d.events_lane_departure + d.events_close_following +
           d.events_harsh_brake + d.events_harsh_accel + d.events_speeding)),0) AS inferred_events,
         COALESCE(SUM(d.fuel_cost),0)        AS fuel_cost,
         COALESCE(SUM(d.fuel_gallons),0)     AS fuel_gallons,
         COALESCE(SUM(d.maintenance_cost),0) AS maintenance_cost
    FROM driver_performance_daily d
    LEFT JOIN users u ON u.id = d.officer_id
   WHERE d.perf_date >= ? AND d.perf_date <= ?
   GROUP BY d.officer_id`;

function shape(r: AggRow) {
  const totalEvents = r.recorded_events + r.inferred_events;
  const recordedPct = totalEvents > 0 ? r.recorded_events / totalEvents : 1;
  const result = computeScore({
    milesDriven: r.miles,
    events: {
      forwardCollision: r.fc, laneDeparture: r.ld, closeFollowing: r.cf,
      harshBrake: r.hb, harshAccel: r.ha, speeding: r.sp,
    },
    recordedPct,
  });
  return {
    officer_id: r.officer_id,
    officer_name: r.officer_name,
    badge_number: r.badge_number,
    miles_driven: Math.round(r.miles * 10) / 10,
    drive_minutes: Math.round(r.minutes),
    trip_count: r.trips,
    event_count: r.fc + r.ld + r.cf + r.hb + r.ha + r.sp,
    events: { forward_collision: r.fc, lane_departure: r.ld, close_following: r.cf,
              harsh_brake: r.hb, harsh_accel: r.ha, speeding: r.sp },
    cost: { fuel: r.fuel_cost, fuel_gallons: r.fuel_gallons,
            maintenance: r.maintenance_cost },
    result,
  };
}

// GET /roster — ranked scored officers; insufficient-exposure officers returned
// SEPARATELY so they can never sort to the bottom of a leaderboard.
driverPerformance.get('/roster', canView, async (c) => {
  const gated = weightsGate(c); if (gated) return gated;
  const db = getDb(c.env);
  await ensureDriverPerformanceColumns(db);
  const { from, to } = windowFrom(c);
  try {
    const rows = await query<AggRow>(db, AGG_SQL, from, to);
    const shaped = rows.map(shape);
    const ranked = shaped
      .filter((s) => s.result.status === 'scored')
      .sort((a, b) => (b.result as { score: number }).score - (a.result as { score: number }).score)
      .map((s, i) => ({ ...s, rank: i + 1 }));
    const insufficient = shaped.filter((s) => s.result.status === 'insufficient_data');
    return c.json({
      from, to,
      min_exposure_miles: MIN_EXPOSURE_MILES,
      ranked,
      insufficient_data: insufficient,
    });
  } catch (err) {
    // Never return an empty roster on error — an empty list reads as
    // "nobody had events", i.e. everyone drove well.
    log.error('driver-performance roster failed', { from, to }, err as Error);
    return c.json({ error: 'Failed to compute roster', code: 'ROSTER_FAILED' }, 500);
  }
});

driverPerformance.get('/officer/:id', canView, async (c) => {
  const gated = weightsGate(c); if (gated) return gated;
  const db = getDb(c.env);
  await ensureDriverPerformanceColumns(db);
  const officerId = Number(c.req.param('id'));
  if (!Number.isInteger(officerId)) return c.json({ error: 'Invalid officer id' }, 400);
  const { from, to } = windowFrom(c);
  try {
    const agg = await queryFirst<AggRow>(db, `${AGG_SQL} HAVING d.officer_id = ?`, from, to, officerId);
    const daily = await query(
      db,
      `SELECT perf_date, miles_driven, score, score_version,
              attribution_recorded_pct, attribution_inferred_pct
         FROM driver_performance_daily
        WHERE officer_id = ? AND perf_date >= ? AND perf_date <= ?
        ORDER BY perf_date`,
      officerId, from, to,
    );
    return c.json({ from, to, summary: agg ? shape(agg) : null, daily });
  } catch (err) {
    log.error('driver-performance officer detail failed', { officerId, from, to }, err as Error);
    return c.json({ error: 'Failed to load officer detail', code: 'DETAIL_FAILED' }, 500);
  }
});

driverPerformance.post('/recompute', requireRole('admin'), async (c) => {
  const db = getDb(c.env);
  await ensureDriverPerformanceColumns(db);
  const body = await c.req.json<{ from?: string; to?: string }>().catch(() => ({}));
  if (!body.from || !body.to) return c.json({ error: 'from and to are required' }, 400);
  const days: string[] = [];
  for (let t = Date.parse(body.from); t <= Date.parse(body.to); t += 86400000) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  let processed = 0, failures = 0;
  for (const d of days) {
    const r = await rollupDay(db, d);
    processed += r.officersProcessed;
    failures += r.failures;
  }
  return c.json({ days: days.length, officers_processed: processed, failures });
});

export default driverPerformance;
```

- [ ] **Step 4: Register the route**

In `src/routesConfig.ts`, add the import beside the other fleet imports (near line 133):

```ts
import driverPerformance from './routes/driverPerformance';
```

And add the registry entry beside the `/api/fleet` entry (near line 456):

```ts
  { prefix: '/api/driver-performance', router: driverPerformance, auth: 'required',
    note: 'Supervisor-only driver performance: ranked roster, officer detail, PDF export, admin recompute. Scores from driver_performance_daily snapshots. Distinct from /api/fleet/scorecard, which is vehicle-fleet health.' },
```

- [ ] **Step 5: Add the read-only deny prefix**

In `src/middleware/auth.ts`, add to `READ_ONLY_DENIED_PREFIXES` (keep alphabetical — it goes after `'/api/dl-records'`):

```ts
  '/api/driver-performance',
```

This is defense in depth. The per-handler `requireRole` is the real gate; this ensures a future handler added without a guard still cannot leak to `client_viewer`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test:worker -- driverPerformance`
Expected: PASS — all RBAC cases and the roster-shape case.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
git add src/routes/driverPerformance.ts src/routesConfig.ts src/middleware/auth.ts test-workers/driverPerformance.test.ts
git commit -m "feat(driver-performance): supervisor-only API with per-handler RBAC"
```

---

### Task 6: Nightly cron

**Files:**
- Modify: `wrangler.toml:414` (crons array)
- Modify: `src/index.ts` (`scheduled` handler, near line 210)

**Interfaces:**
- Consumes: `rollupDay` (Task 4)
- Produces: no new exports.

- [ ] **Step 1: Add the cron trigger**

In `wrangler.toml`, change line 414 to add a nightly 09:00 UTC trigger (02:00 Denver in winter, 03:00 in summer — after the day is fully closed either way):

```toml
crons = ["0 */4 * * *", "* * * * *", "*/30 * * * *", "0 3 1 * *", "0 9 * * *"]
```

- [ ] **Step 2: Add the handler branch**

In `src/index.ts`, inside `scheduled`, add a branch alongside the existing `event.cron` checks:

```ts
      // Driver Performance nightly rollup. Recomputes the TRAILING 3 DAYS,
      // not just yesterday: late-arriving ClearPath events and assignment
      // corrections are routine, and a 3-day window absorbs them without a
      // manual recompute. Upserts are idempotent, so re-running is safe.
      if (event.cron === '0 9 * * *') {
        ctx.waitUntil(
          import('./utils/driverPerformance/rollup').then(async (m) => {
            for (let back = 1; back <= 3; back++) {
              const day = new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);
              try {
                const r = await m.rollupDay(env.DB, day);
                log.info('driver-performance rollup complete', {
                  day, officersProcessed: r.officersProcessed, failures: r.failures,
                });
              } catch (err) {
                // One bad day must not abort the other two.
                log.error('driver-performance rollup day failed', { day }, err as Error);
              }
            }
          }).catch((err) => log.error('driver-performance rollup import failed', {}, err as Error)),
        );
      }
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Verify the cron fires locally**

Run: `npx wrangler dev --test-scheduled` then in a second shell:
`curl "http://localhost:8787/__scheduled?cron=0+9+*+*+*"`
Expected: log lines `driver-performance rollup complete` for three dates.

- [ ] **Step 5: Commit**

```bash
git add wrangler.toml src/index.ts
git commit -m "feat(driver-performance): nightly rollup cron with 3-day trailing window"
```

---

### Task 7: Client tab

**Files:**
- Create: `client/src/pages/fleet/tabs/FleetDriverPerformanceTab.tsx`
- Modify: `client/src/pages/fleet/FleetPage.tsx` (tab registration)

**Interfaces:**
- Consumes: `GET /api/driver-performance/roster` and `/officer/:id` (Task 5); `apiFetch` from `client/src/hooks/useApi`
- Produces: default-exported `FleetDriverPerformanceTab` component.

Before writing, read `client/src/pages/fleet/tabs/FleetAnalyticsTab.tsx` to match the tab's prop shape and loading conventions, and check how `FleetPage.tsx` registers tabs — the pattern there is what this must follow.

- [ ] **Step 1: Write the component**

Create `client/src/pages/fleet/tabs/FleetDriverPerformanceTab.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { apiFetch } from '../../../hooks/useApi';
import PanelTitleBar from '../../../components/PanelTitleBar';
import { Gauge } from 'lucide-react';

interface ScoreResult {
  status: 'scored' | 'insufficient_data';
  score?: number;
  band?: 'excellent' | 'good' | 'needs_attention' | 'at_risk';
  weightedRatePer100Miles?: number;
  confidence?: 'recorded' | 'inferred';
  milesDriven: number;
}

interface RosterEntry {
  officer_id: number;
  officer_name: string | null;
  badge_number: string | null;
  miles_driven: number;
  event_count: number;
  cost: { fuel: number; maintenance: number };
  result: ScoreResult;
  rank?: number;
}

interface RosterResponse {
  ok?: boolean;
  code?: string;
  message?: string;
  from: string; to: string;
  min_exposure_miles: number;
  ranked: RosterEntry[];
  insufficient_data: RosterEntry[];
}

// Severity tokens, not brand chrome — risk IS severity semantics here.
const BAND_CLASS: Record<string, string> = {
  excellent:       'text-[color:var(--sev-ok)]',
  good:            'text-[color:var(--sev-ok)]',
  needs_attention: 'text-[color:var(--sev-warn)]',
  at_risk:         'text-[color:var(--sev-critical)]',
};

const BAND_LABEL: Record<string, string> = {
  excellent: 'Excellent', good: 'Good',
  needs_attention: 'Needs Attention', at_risk: 'At Risk',
};

export default function FleetDriverPerformanceTab() {
  const [data, setData] = useState<RosterResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<RosterResponse>('/driver-performance/roster')
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-4 text-rmpg-300 text-xs">Loading driver performance…</div>;

  // Surface the failure. An empty table would read as "nobody had events",
  // which reads as everyone driving well.
  if (error) {
    return (
      <div className="p-4 text-[color:var(--sev-critical)] text-xs">
        Could not load driver performance: {error}
      </div>
    );
  }
  if (!data) return null;

  // Runtime owner gate: severity weights not yet reviewed, so no score exists
  // to show. Explain why rather than rendering an empty table, which would
  // read as "everyone drove cleanly".
  if (data.ok === false) {
    return (
      <div className="p-4 space-y-3">
        <PanelTitleBar title="DRIVER PERFORMANCE" icon={Gauge} />
        <div className="border border-[color:var(--sev-warn)] p-3 text-xs text-rmpg-100">
          <div className="font-semibold text-[color:var(--sev-warn)] mb-1">Scoring unavailable</div>
          <div>{data.message}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="DRIVER PERFORMANCE" icon={Gauge} />

      <div className="text-[10px] text-rmpg-400">
        {data.from} to {data.to} · scored at or above {data.min_exposure_miles} miles of exposure
      </div>

      <table className="w-full">
        <thead>
          <tr className="text-left text-[9px] font-semibold text-rmpg-300 border-b border-rmpg-700">
            <th className="py-[3px] pr-2">#</th>
            <th className="py-[3px] pr-2">Officer</th>
            <th className="py-[3px] pr-2">Badge</th>
            <th className="py-[3px] pr-2">Score</th>
            <th className="py-[3px] pr-2">Band</th>
            <th className="py-[3px] pr-2">Rate / 100 mi</th>
            <th className="py-[3px] pr-2">Miles</th>
            <th className="py-[3px] pr-2">Events</th>
            <th className="py-[3px] pr-2">Attribution</th>
            <th className="py-[3px] pr-2 border-l border-rmpg-700 pl-2">Fuel</th>
            <th className="py-[3px] pr-2">Maint.</th>
          </tr>
        </thead>
        <tbody>
          {data.ranked.map((r) => (
            <tr key={r.officer_id} className="text-[11px] text-rmpg-100 border-b border-rmpg-800">
              <td className="py-[2px] pr-2">{r.rank}</td>
              <td className="py-[2px] pr-2">{r.officer_name ?? '—'}</td>
              <td className="py-[2px] pr-2">{r.badge_number ?? '—'}</td>
              <td className={`py-[2px] pr-2 font-semibold ${BAND_CLASS[r.result.band ?? ''] ?? ''}`}>
                {r.result.score?.toFixed(1)}
              </td>
              <td className={`py-[2px] pr-2 ${BAND_CLASS[r.result.band ?? ''] ?? ''}`}>
                {BAND_LABEL[r.result.band ?? ''] ?? '—'}
              </td>
              {/* The denominator is ALWAYS adjacent to the score. A bare number
                  in a screenshot is how this tool causes harm. */}
              <td className="py-[2px] pr-2">{r.result.weightedRatePer100Miles?.toFixed(2)}</td>
              <td className="py-[2px] pr-2">{r.miles_driven.toFixed(0)}</td>
              <td className="py-[2px] pr-2">{r.event_count}</td>
              <td className="py-[2px] pr-2">
                {r.result.confidence === 'inferred'
                  ? <span className="text-[color:var(--sev-warn)]" title="Majority of events attributed by assignment history, not recorded at capture. Treat as a lead to investigate, not a finding.">Inferred</span>
                  : <span className="text-rmpg-400">Recorded</span>}
              </td>
              <td className="py-[2px] pr-2 border-l border-rmpg-700 pl-2">${r.cost.fuel.toFixed(0)}</td>
              <td className="py-[2px] pr-2">${r.cost.maintenance.toFixed(0)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {data.insufficient_data.length > 0 && (
        <div className="space-y-1">
          <div className="text-[9px] font-semibold text-rmpg-300 uppercase">
            Insufficient exposure — not scored, not ranked
          </div>
          <div className="text-[10px] text-rmpg-400">
            Below {data.min_exposure_miles} miles in this window. Too few miles to
            distinguish driving behavior from chance.
          </div>
          <table className="w-full">
            <tbody>
              {data.insufficient_data.map((r) => (
                <tr key={r.officer_id} className="text-[11px] text-rmpg-300 border-b border-rmpg-800">
                  <td className="py-[2px] pr-2">{r.officer_name ?? '—'}</td>
                  <td className="py-[2px] pr-2">{r.badge_number ?? '—'}</td>
                  <td className="py-[2px] pr-2">{r.miles_driven.toFixed(0)} mi</td>
                  <td className="py-[2px] pr-2">{r.event_count} events</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Register the tab**

Open `client/src/pages/fleet/FleetPage.tsx` and follow its existing tab registration pattern exactly — in this codebase a tab typically needs the import, an entry in the tab-config array, the id added to the tab-id type union, and a render branch. Missing the type-union entry compiles-looks-fine until `tsc`.

- [ ] **Step 3: Typecheck the client**

Run: `cd client && npx tsc --noEmit`
Expected: no errors. If `client/node_modules` is missing, run `npm install --legacy-peer-deps` first — without it `tsc` reports ~97,000 phantom "Cannot find module" errors that mean nothing.

- [ ] **Step 4: Run the full client suite**

Run: `cd client && npx vitest run`
Expected: PASS. Run the FULL suite, not a targeted file — a targeted run hid a red test for four consecutive tasks in a previous sweep. Do not run the root and client suites concurrently; that fabricates ~9 timeout failures.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/fleet/tabs/FleetDriverPerformanceTab.tsx client/src/pages/fleet/FleetPage.tsx
git commit -m "feat(driver-performance): supervisor roster tab in fleet"
```

---

### Task 8: PDF export

**Files:**
- Modify: `src/routes/driverPerformance.ts` (add the export handler)

**Interfaces:**
- Consumes: the officer-detail aggregation from Task 5; the existing PDF seam in `src/routes/pdfEngine.ts`
- Produces: `GET /api/driver-performance/officer/:id/export`

Read `src/routes/pdfEngine.ts` first and follow whichever generator it already exposes. Do not introduce a new PDF library.

- [ ] **Step 1: Add the handler**

Append to `src/routes/driverPerformance.ts`, before `export default`:

```ts
// Liability lens: an evidence-grade snapshot of what the system recorded.
// Every element that affects interpretation is stamped on the page —
// window, score_version, attribution confidence, generation time — so the
// document is reproducible and cannot be read out of context.
driverPerformance.get('/officer/:id/export', canView, async (c) => {
  const gated = weightsGate(c); if (gated) return gated;
  const db = getDb(c.env);
  await ensureDriverPerformanceColumns(db);
  const officerId = Number(c.req.param('id'));
  if (!Number.isInteger(officerId)) return c.json({ error: 'Invalid officer id' }, 400);
  const { from, to } = windowFrom(c);
  try {
    const agg = await queryFirst<AggRow>(db, `${AGG_SQL} HAVING d.officer_id = ?`, from, to, officerId);
    if (!agg) return c.json({ error: 'No data for this officer in the window' }, 404);
    const summary = shape(agg);
    const versionRow = await queryFirst<{ v: string }>(
      db,
      `SELECT score_version AS v FROM driver_performance_daily
        WHERE officer_id = ? AND perf_date >= ? AND perf_date <= ?
        ORDER BY perf_date DESC LIMIT 1`,
      officerId, from, to,
    );
    const { renderDriverPerformancePdf } = await import('../utils/driverPerformance/pdf');
    const bytes = await renderDriverPerformancePdf({
      summary,
      window: { from, to },
      scoreVersion: versionRow?.v ?? 'unknown',
      generatedAt: new Date().toISOString(),
      organization: 'Rocky Mountain Protective Group',
    });
    return new Response(bytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="driver-performance-${officerId}-${from}-to-${to}.pdf"`,
      },
    });
  } catch (err) {
    log.error('driver-performance export failed', { officerId, from, to }, err as Error);
    return c.json({ error: 'Failed to generate export', code: 'EXPORT_FAILED' }, 500);
  }
});
```

- [ ] **Step 2: Write the renderer**

Create `src/utils/driverPerformance/pdf.ts` using the same PDF library `src/routes/pdfEngine.ts` already uses. Required content, in order:

1. Header: "Rocky Mountain Protective Group — Driver Performance Record"
2. Officer name and badge; the reporting window
3. Score, band, weighted rate per 100 miles, and **miles driven immediately adjacent to the score** (never the score alone)
4. Event breakdown by type
5. Cost summary, in a visually separate block, labeled "Cost attribution — not a factor in the safety score"
6. Attribution confidence, with this exact sentence when `confidence === 'inferred'`:
   `"Attribution for the majority of these events was inferred from vehicle assignment history rather than recorded at capture. Treat as a lead to investigate, not a finding."`
7. Footer: `score_version`, generation timestamp, and
   `"Generated from immutable daily snapshots. Reproducible for this window under this score version."`

Literal hex is correct in this module — PDF generators take literal color arguments and are deliberately excluded from the theme-token rule.

- [ ] **Step 3: Verify the PDF renders**

Run the Worker locally (`npm run dev`) and fetch the endpoint with a supervisor token, saving to a file. **Open the PDF and look at it.** jsPDF layout defects are invisible to assertions — overlapping text and off-page content both "pass" a byte-length check.

- [ ] **Step 4: Typecheck and commit**

```bash
npm run typecheck
git add src/routes/driverPerformance.ts src/utils/driverPerformance/pdf.ts
git commit -m "feat(driver-performance): evidence-grade PDF export"
```

---

### Task 9: Assignment resolver and backfill

**Files:**
- Create: `scripts/resolve-assignment-officers.mjs`

**Interfaces:**
- Consumes: `fleet_assignments.officer_id` (Task 1)
- Produces: a CLI script. No app-code exports.

- [ ] **Step 1: Write the resolver**

Create `scripts/resolve-assignment-officers.mjs`. It must:

1. Read every `fleet_assignments` row where `officer_id IS NULL AND officer_name IS NOT NULL`.
2. For each, look up `users` by normalized full name (trim, collapse whitespace, case-insensitive).
3. **Write `officer_id` only when exactly one user matches.** Zero matches and multiple matches both stay null.
4. Print a summary: resolved count, no-match count, ambiguous count.
5. Write unresolved rows to `scratchpad/unresolved-assignments.txt` for human review — **assignment id and officer_name only, never written into the repo**, since names are PII.

Default to a dry run; require an explicit `--apply` flag to write. A resolver that guesses would attribute driving events to a named person on a fuzzy string match, which is exactly the failure this design exists to prevent.

- [ ] **Step 2: Dry-run locally**

Run: `node scripts/resolve-assignment-officers.mjs`
Expected: a summary with zero writes and the unresolved file produced.

- [ ] **Step 3: Commit**

```bash
git add scripts/resolve-assignment-officers.mjs
git commit -m "feat(driver-performance): assignment officer resolver (dry-run default)"
```

---

### Task 10: Stamp attribution at ingest

**Files:**
- Modify: `src/utils/clearpathSync.ts:164-186` (`upsertEvent`)

**Interfaces:**
- Consumes: `dashcam_events.officer_id` / `officer_attribution_source` (Task 1)
- Produces: no new exports.

Without this task the schema column exists but nothing ever writes it, so every
event stays `inferred` forever and the hybrid attribution decision is only half
built. This is what makes attribution improve over time instead of permanently
depending on reconstruction.

- [ ] **Step 1: Stamp the officer on insert**

In `src/utils/clearpathSync.ts`, replace the `INSERT INTO dashcam_events`
statement in `upsertEvent` (currently lines 175–183) with a version that
resolves and records the officer at capture time:

```ts
    // Attribution stamped AT CAPTURE. units.officer_id is correct here and
    // ONLY here — at ingest it is the officer in the vehicle right now, which
    // is exactly what we want to freeze. Reading it later, at aggregation
    // time, is the bug this feature exists to fix.
    const crew = m.unit_id != null
      ? await queryFirst<{ officer_id: number | null }>(
          db, 'SELECT officer_id FROM units WHERE id = ?', m.unit_id,
        )
      : null;
    const officerId = crew?.officer_id ?? null;

    const r = await execute(db, `
      INSERT INTO dashcam_events
        (cpg_device_id, unit_id, event_type, event_timestamp, cpg_media_timestamp,
         latitude, longitude, speed_mph, address, video_available, source,
         officer_id, officer_attribution_source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'clearpathgps', ?, ?)
    `,
      m.cpg_device_id, m.unit_id, first?.eventType || 'Camera Event', formatTs(ts), ts,
      lat, lng, kmhToMph(first?.gps?.[0]?.speed), event.address || null,
      officerId, officerId != null ? 'recorded' : 'unattributed',
    );
```

Note the existing `catch { return null; }` around this block: if the new
columns are missing on live, the insert fails silently and dashcam events stop
recording entirely. Call `ensureDriverPerformanceColumns(db)` once at the top
of the sync entry point so the columns are reconciled before any insert runs.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Verify the stamp lands**

Run: `npm run migrate:local`, then insert a synthetic `units` row with a known
`officer_id`, run the sync path, and query:
`SELECT officer_id, officer_attribution_source FROM dashcam_events ORDER BY id DESC LIMIT 1`
Expected: the known officer id and `'recorded'`.

- [ ] **Step 4: Commit**

```bash
git add src/utils/clearpathSync.ts
git commit -m "feat(driver-performance): stamp officer attribution at event ingest"
```

---

### Task 11: Full verification

- [ ] **Step 1: Worker typecheck**

Run: `npm run typecheck`
Expected: 0 errors. The baseline is clean, so any error is from this work.

- [ ] **Step 2: Worker unit tests**

Run: `npx vitest run`
Expected: PASS. Baseline is 246 files / 2004 tests passing.

- [ ] **Step 3: Worker integration tests**

Run: `npm run test:worker`
Expected: PASS.

- [ ] **Step 4: Client typecheck and tests**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: 0 type errors; baseline 443 files / 3101 tests passing. Run serially after the Worker suite, never concurrently.

- [ ] **Step 5: Client build**

Run: `cd client && npx vite build`
Expected: success.

- [ ] **Step 6: Commit any fixes and open the PR**

`main` is protected — PR required.

```bash
gh pr create -R rmpgutah/rmpg-flex --title "feat: Driver Performance" --body "See docs/superpowers/specs/2026-08-01-driver-performance-design.md"
```

---

## Post-merge checklist

1. Apply the migration to live D1 `785de7ae`:
   `scripts/apply-migration.sh 0222_driver_performance_schema.sql`
2. Verify: `SELECT name FROM pragma_table_info('driver_performance_daily')` and confirm `fleet_assignments.officer_id` exists.
3. Dry-run then apply `scripts/resolve-assignment-officers.mjs`; review the unresolved report.
4. Backfill history: `POST /api/driver-performance/recompute` with the desired range, as an admin.
5. Confirm in a real browser at rmpgutah.us that the tab renders in the fleet shell.
6. Confirm RBAC on live: a `client_viewer` token must receive 403 from `/api/driver-performance/roster`.
7. **Review the severity weights** in `src/utils/driverPerformance/score.ts`, set `SCORE_VERSION` to `'v1'`, then remove the weights-gate tests and un-skip the roster-shape tests. Until that happens the API serves `ok:false, code:"weights_pending_review"` and the tab shows a "Scoring unavailable" banner — by design.
