# Process Service Auto-Scheduler — PR 1 (Backend + Algorithm) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the backend half of the auto-scheduler — schema migration, three new pure scheduling functions (`clusterByProximity`, `applyUrgencyTier`, `replanAfterFailedAttempt`), intake-time wiring, attempts-route auto-replan hook, and the daily 04:00 Denver rebalance cron. No UI changes; PR 2 (dashboard panel) and PR 3 (full-page scheduler) follow on separate plans once this lands and is verified in prod.

**Architecture:** Pure functions in `serveDiligencePlanner.ts` (no D1, no `Date.now`, no fetch) → called from existing `commitIntake()` + `POST /attempts` handler + a new `runDailyRebalance()` driven by `src/index.ts`'s scheduled handler. Single migration `0140_serve_scheduler_advanced.sql` reconciled at boot via `columnExists()` (same pattern as `alpr.ts`) so deploy-step failure doesn't block runtime.

**Tech Stack:** Cloudflare Workers + Hono (Worker), D1 (SQLite) for storage, vitest for unit tests, TypeScript strict throughout. America/Denver-local string timestamps for all schedule dates (the project's existing convention — lexicographic comparison is reliable when timezone is fixed).

---

## File structure

| Action | Path | Responsibility |
|---|---|---|
| Create | `migrations/0140_serve_scheduler_advanced.sql` | 5 new cols on `serve_attempt_schedules` + 3 new cols on `serve_queue` + 3 indexes |
| Modify | `src/utils/serveDiligencePlanner.ts` | Append 3 pure functions: `clusterByProximity`, `applyUrgencyTier`, `replanAfterFailedAttempt` |
| Modify | `src/utils/serveIntakeRecords.ts` | Wire cluster + tier into the `INSERT INTO serve_queue` site at intake commit |
| Modify | `src/routes/serveIntake.ts` | (a) `columnExists` reconcile for new cols at first request; (b) `POST /attempts` calls `replanAfterFailedAttempt` + persists new slot |
| Create | `src/utils/serveRebalance.ts` | `runDailyRebalance(db, nowIso, env?)` — pure orchestration that recomputes tiers, escalates priority, refreshes non-`manually_moved` slots, returns counters |
| Modify | `src/index.ts` | Hook `runDailyRebalance` into the scheduled handler at UTC hour=10, minute=0 |
| Modify | `tests/serveDiligencePlanner.test.ts` | Add suites for the 3 new pure functions |
| Create | `tests/serveRebalance.test.ts` | Suite for `runDailyRebalance` orchestration with a mock db |

**Why these boundaries:** Each pure function is a single file change in `serveDiligencePlanner.ts`. The orchestrator lives in its own file (`serveRebalance.ts`) because it touches D1 — separating it keeps the pure-vs-impure boundary clean and matches the existing `serveAttemptScheduler.ts` shape. Tests stay co-mounted by topic (planner tests in one file, orchestrator tests in another) so a future reader running `vitest run tests/serveDiligencePlanner.test.ts` gets all algorithm tests in one shot.

---

## Task 1: Migration 0140 — schema delta

**Files:**
- Create: `migrations/0140_serve_scheduler_advanced.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- migrations/0140_serve_scheduler_advanced.sql
--
-- PR 1 of the process-service auto-scheduler:
-- 1. serve_attempt_schedules: track manually-moved slots, replan lineage, and
--    snapshot the officer at slot creation time (queue.officer_id is mutable).
-- 2. serve_queue: geographic cluster id + derived urgency tier (cached for
--    fast calendar sort/color without per-query recomputation).
--
-- ⚠️ D1 has no "ADD COLUMN IF NOT EXISTS". This migration WILL fail on
-- re-apply. Two defenses:
--   (a) src/routes/serveIntake.ts uses columnExists() at first request and
--       runs the ALTERs idempotently. (Same pattern as src/routes/alpr.ts.)
--   (b) After merge, apply this DDL directly to live D1 (785de7ae) via the
--       Cloudflare API and verify with pragma_table_info(...).

ALTER TABLE serve_attempt_schedules ADD COLUMN manually_moved      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE serve_attempt_schedules ADD COLUMN moved_by_user_id    INTEGER;
ALTER TABLE serve_attempt_schedules ADD COLUMN moved_at            TEXT;
ALTER TABLE serve_attempt_schedules ADD COLUMN auto_replan_source  INTEGER;
ALTER TABLE serve_attempt_schedules ADD COLUMN officer_id          INTEGER;

CREATE INDEX IF NOT EXISTS idx_sas_date_officer
  ON serve_attempt_schedules(scheduled_date, officer_id);

ALTER TABLE serve_queue ADD COLUMN geo_cluster_id       TEXT;
ALTER TABLE serve_queue ADD COLUMN urgency_tier         TEXT;
ALTER TABLE serve_queue ADD COLUMN urgency_computed_at  TEXT;

CREATE INDEX IF NOT EXISTS idx_serve_queue_cluster
  ON serve_queue(geo_cluster_id, status);

CREATE INDEX IF NOT EXISTS idx_serve_queue_urgency
  ON serve_queue(urgency_tier, deadline);
```

- [ ] **Step 2: Verify the migration prefix is free**

Run: `ls migrations/ | grep -E "^0140"`
Expected: only your new file shows up (no duplicate prefix). If another `0134_*.sql` already exists, rename yours to the next free prefix and update Step 1's filename + the migration's leading comment.

- [ ] **Step 3: Commit**

```bash
git add migrations/0140_serve_scheduler_advanced.sql
git commit -m "feat(serve): migration 0140 — auto-scheduler schema delta (cluster + tier + manual-move tracking)"
```

---

## Task 2: `clusterByProximity()` — pure function + tests

**Files:**
- Modify: `src/utils/serveDiligencePlanner.ts` (append at end, before any trailing `export {}` if present)
- Test: `tests/serveDiligencePlanner.test.ts`

- [ ] **Step 1: Write failing tests** — append to `tests/serveDiligencePlanner.test.ts`

```ts
import { clusterByProximity } from '../src/utils/serveDiligencePlanner';

describe('clusterByProximity', () => {
  it('returns a 3-decimal lat/lng cluster id when coordinates are present', () => {
    expect(clusterByProximity(40.76078, -111.89105, '84101')).toBe('g-40.761--111.891');
  });
  it('truncates rather than rounds so adjacent buildings can still share a cluster id', () => {
    const a = clusterByProximity(40.7609, -111.8919, null);
    const b = clusterByProximity(40.7611, -111.8919, null);
    // Both fall in the same 3-decimal cell once truncated, even though they round differently.
    expect(a).toBe('g-40.761--111.892');
    expect(b).toBe('g-40.761--111.892');
  });
  it('falls back to ZIP when lat/lng is missing', () => {
    expect(clusterByProximity(null, null, '84101')).toBe('z-84101');
    expect(clusterByProximity(null, null, '84101-1234')).toBe('z-84101');
  });
  it('returns null when nothing is known about location', () => {
    expect(clusterByProximity(null, null, null)).toBeNull();
    expect(clusterByProximity(null, null, '')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `npx vitest run tests/serveDiligencePlanner.test.ts -t clusterByProximity`
Expected: 4 failures with `clusterByProximity is not a function` (or import error).

- [ ] **Step 3: Implement the function** — append to `src/utils/serveDiligencePlanner.ts`

```ts
// ── Geographic clustering (PR 1) ─────────────────────────────────
// Stable cluster id for grouping nearby attempts on the same officer's day.
// 3-decimal lat/lng truncation = ~110 m cell — same building shares; different
// ZIPs do not. Falls back to ZIP5 when lat/lng is missing.
// IMPORTANT: uses Math.trunc(x * 1000) / 1000, NOT toFixed(3), because
// toFixed rounds, which would split adjacent buildings between two cells.
export function clusterByProximity(
  lat: number | null,
  lng: number | null,
  zip: string | null,
): string | null {
  if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
    const lat3 = (Math.trunc(lat * 1000) / 1000).toFixed(3);
    const lng3 = (Math.trunc(lng * 1000) / 1000).toFixed(3);
    return `g-${lat3}--${lng3}`;
  }
  if (zip && /^\d{5}/.test(zip)) {
    return `z-${zip.slice(0, 5)}`;
  }
  return null;
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run tests/serveDiligencePlanner.test.ts -t clusterByProximity`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/serveDiligencePlanner.ts tests/serveDiligencePlanner.test.ts
git commit -m "feat(serve): clusterByProximity() — lat/lng truncation + ZIP fallback"
```

---

## Task 3: `applyUrgencyTier()` — pure function + tests

**Files:**
- Modify: `src/utils/serveDiligencePlanner.ts`
- Test: `tests/serveDiligencePlanner.test.ts`

- [ ] **Step 1: Write failing tests** — append to `tests/serveDiligencePlanner.test.ts`

```ts
import { applyUrgencyTier } from '../src/utils/serveDiligencePlanner';

describe('applyUrgencyTier', () => {
  const NOW = '2026-06-11T18:00:00.000Z'; // Thursday, noon Denver MDT

  it('returns "standard" when there is no deadline', () => {
    expect(applyUrgencyTier(null, 0, 3, NOW)).toBe('standard');
  });
  it('returns "standard" when deadline is more than 5 days out', () => {
    expect(applyUrgencyTier('2026-06-20', 0, 3, NOW)).toBe('standard');
  });
  it('returns "tight" at exactly 5 days', () => {
    expect(applyUrgencyTier('2026-06-16', 0, 3, NOW)).toBe('tight');
  });
  it('returns "tight" at 3 days', () => {
    expect(applyUrgencyTier('2026-06-14', 0, 3, NOW)).toBe('tight');
  });
  it('returns "critical" at exactly 2 days', () => {
    expect(applyUrgencyTier('2026-06-13', 0, 3, NOW)).toBe('critical');
  });
  it('returns "critical" when days remaining are fewer than attempts left', () => {
    // 4 days out, 1 attempt used of 5 max → 4 attempts left in 4 days = critical
    expect(applyUrgencyTier('2026-06-15', 1, 5, NOW)).toBe('critical');
  });
  it('returns "critical" when the deadline is already past', () => {
    expect(applyUrgencyTier('2026-06-09', 0, 3, NOW)).toBe('critical');
  });
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `npx vitest run tests/serveDiligencePlanner.test.ts -t applyUrgencyTier`
Expected: 7 failures with `applyUrgencyTier is not a function`.

- [ ] **Step 3: Implement** — append to `src/utils/serveDiligencePlanner.ts`

```ts
// ── Court-deadline urgency tier (PR 1) ───────────────────────────
// Pure derivation called at intake commit AND by the daily rebalance cron.
//   critical : deadline ≤ 2 days away, already past, OR days_remaining < attempts_remaining
//   tight    : 3–5 days away
//   standard : > 5 days, or no deadline
//
// Source of truth is (priority, deadline) — tier is a CACHE the calendar reads
// to color/sort without per-query recomputation. Stays in sync via the cron.
export type UrgencyTier = 'critical' | 'tight' | 'standard';

export function applyUrgencyTier(
  deadline: string | null,
  attemptCount: number,
  maxAttempts: number,
  nowIso: string,
): UrgencyTier {
  const days = daysUntilDeadline(nowIso, deadline);
  if (days === null) return 'standard';
  if (days < 0 || days <= 2) return 'critical';
  const remaining = Math.max(0, maxAttempts - attemptCount);
  if (remaining > 0 && days < remaining) return 'critical';
  if (days <= 5) return 'tight';
  return 'standard';
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run tests/serveDiligencePlanner.test.ts -t applyUrgencyTier`
Expected: 7 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/serveDiligencePlanner.ts tests/serveDiligencePlanner.test.ts
git commit -m "feat(serve): applyUrgencyTier() — deadline-aware critical/tight/standard"
```

---

## Task 4: `replanAfterFailedAttempt()` — pure function + tests

**Files:**
- Modify: `src/utils/serveDiligencePlanner.ts`
- Test: `tests/serveDiligencePlanner.test.ts`

- [ ] **Step 1: Write failing tests** — append to `tests/serveDiligencePlanner.test.ts`

```ts
import { replanAfterFailedAttempt } from '../src/utils/serveDiligencePlanner';

describe('replanAfterFailedAttempt', () => {
  const baseQueue = {
    deadline: null as string | null,
    max_attempts: 3,
    attempt_count: 1,
    recipient_lat: null as number | null,
    recipient_lng: null as number | null,
    isBusiness: false,
    locationNote: null,
  };

  it('returns null when max_attempts is already exhausted', () => {
    const failed = { attempt_at: '2026-06-11T18:00:00.000Z', result: 'no_answer', window: '17:00–20:30' };
    expect(replanAfterFailedAttempt(failed, { ...baseQueue, attempt_count: 3 })).toBeNull();
  });

  it('schedules the next attempt at least 24 h after the failed attempt', () => {
    const failed = { attempt_at: '2026-06-11T18:00:00.000Z', result: 'no_answer', window: '17:00–20:30' };
    const next = replanAfterFailedAttempt(failed, baseQueue);
    expect(next).not.toBeNull();
    // Denver MDT: 2026-06-11 18:00 UTC = 12:00 local. +24h = 2026-06-12 12:00 local.
    expect(next!.date >= '2026-06-12').toBe(true);
  });

  it('picks a different time-of-day band than the failed attempt (evening fail → morning/midday next)', () => {
    const failed = { attempt_at: '2026-06-11T03:00:00.000Z', result: 'no_answer', window: '17:00–20:30' };
    const next = replanAfterFailedAttempt(failed, baseQueue);
    // failed window started 17:xx; next should start before 17:00
    expect(next).not.toBeNull();
    const startHour = parseInt(next!.window.split('–')[0].split(':')[0], 10);
    expect(startHour).toBeLessThan(17);
  });

  it('picks a different time-of-day band when failed window was morning (next should be afternoon/evening)', () => {
    const failed = { attempt_at: '2026-06-11T13:00:00.000Z', result: 'no_answer', window: '07:00–09:00' };
    const next = replanAfterFailedAttempt(failed, baseQueue);
    expect(next).not.toBeNull();
    const startHour = parseInt(next!.window.split('–')[0].split(':')[0], 10);
    expect(startHour).toBeGreaterThanOrEqual(11);
  });

  it('still returns a window for bad_address — caller flags skip-trace separately', () => {
    const failed = { attempt_at: '2026-06-11T18:00:00.000Z', result: 'bad_address', window: '17:00–20:30' };
    const next = replanAfterFailedAttempt(failed, baseQueue);
    expect(next).not.toBeNull();
  });

  it('pulls the next attempt closer when deadline pressure is high', () => {
    const failed = { attempt_at: '2026-06-11T18:00:00.000Z', result: 'no_answer', window: '17:00–20:30' };
    const tight = { ...baseQueue, deadline: '2026-06-13', max_attempts: 5 };
    const next = replanAfterFailedAttempt(failed, tight);
    expect(next).not.toBeNull();
    // With 2 days until deadline and 4 attempts remaining, next must be on 06-12 (tomorrow) not later.
    expect(next!.date).toBe('2026-06-12');
  });
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `npx vitest run tests/serveDiligencePlanner.test.ts -t replanAfterFailedAttempt`
Expected: 6 failures with `replanAfterFailedAttempt is not a function`.

- [ ] **Step 3: Implement** — append to `src/utils/serveDiligencePlanner.ts`

```ts
// ── Auto-replan after a failed attempt (PR 1) ────────────────────
// Returns the NEXT AttemptWindow to schedule when an officer logs a failed
// attempt (no_answer | refused | bad_address | moved). The new window:
//   1. Starts ≥ 24 h after the failed attempt (no same-day retry)
//   2. Uses a different time-of-day band than the failed attempt
//   3. Respects deadline pressure — pulls closer when days_remaining is tight
//   4. Respects business hours / location-note constraints via planAttemptWindows()
//   5. Returns null if max_attempts is exhausted (caller marks status=failed)
//
// Implementation strategy: replan the FULL plan from `attempt_count + 1`'s
// start time, then return the first window. This re-uses every existing
// scheduling rule (weekend inclusion, business-hours, location-note) without
// duplicating logic.
export interface FailedAttemptCtx {
  attempt_at: string;          // ISO timestamp of the failed attempt
  result: string;              // 'no_answer' | 'refused' | 'bad_address' | 'moved'
  window: string | null;       // e.g. '17:00–20:30' — the band that failed
}

export interface ReplanQueueCtx {
  deadline: string | null;
  max_attempts: number;
  attempt_count: number;       // count BEFORE the failed attempt was recorded
  recipient_lat: number | null;
  recipient_lng: number | null;
  isBusiness?: boolean;
  locationNote?: PlanOptions['locationNote'];
}

function failedBandKind(window: string | null): 'morning' | 'midday' | 'afternoon' | 'evening' | null {
  if (!window) return null;
  const startH = parseInt(window.split('–')[0]?.split(':')[0] ?? '', 10);
  if (Number.isNaN(startH)) return null;
  if (startH < 11) return 'morning';
  if (startH < 14) return 'midday';
  if (startH < 17) return 'afternoon';
  return 'evening';
}

export function replanAfterFailedAttempt(
  failed: FailedAttemptCtx,
  queue: ReplanQueueCtx,
  tz = 'America/Denver',
): AttemptWindow | null {
  // Already at max → caller transitions queue to status='failed'.
  if (queue.attempt_count + 1 > queue.max_attempts) return null;

  // Start re-planning ≥ 24 h after the failed attempt.
  const replanStart = new Date(Date.parse(failed.attempt_at) + DAY_MS).toISOString();

  const plan = planAttemptWindows(replanStart, queue.deadline, tz, {
    isBusiness: queue.isBusiness ?? false,
    locationNote: queue.locationNote ?? null,
  });
  if (!plan.length) return null;

  // Diligence rule: vary time-of-day from the failed attempt.
  const failedKind = failedBandKind(failed.window);
  if (failedKind) {
    const differentBand = plan.find((w) => failedBandKind(w.window) !== failedKind);
    if (differentBand) return { ...differentBand, attempt: queue.attempt_count + 1 };
  }
  return { ...plan[0], attempt: queue.attempt_count + 1 };
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run tests/serveDiligencePlanner.test.ts -t replanAfterFailedAttempt`
Expected: 6 PASS.

- [ ] **Step 5: Run the full planner test file to confirm nothing else broke**

Run: `npx vitest run tests/serveDiligencePlanner.test.ts`
Expected: all tests in the file PASS, including the pre-existing `daysUntilDeadline` and `planAttemptWindows` suites.

- [ ] **Step 6: Commit**

```bash
git add src/utils/serveDiligencePlanner.ts tests/serveDiligencePlanner.test.ts
git commit -m "feat(serve): replanAfterFailedAttempt() — 24h gap, different band, deadline pull-in"
```

---

## Task 5: Wire cluster + tier into `commitIntake`

**Files:**
- Modify: `src/utils/serveIntakeRecords.ts:867` (the `INSERT INTO serve_queue` site)

- [ ] **Step 1: Read context around the INSERT**

Run: `sed -n '860,920p' src/utils/serveIntakeRecords.ts`
Expected: see the INSERT INTO serve_queue (…) VALUES (…) — note the existing column list. You'll add `geo_cluster_id`, `urgency_tier`, `urgency_computed_at` to both the column list and the VALUES tuple.

- [ ] **Step 2: Add imports at the top of the file**

In `src/utils/serveIntakeRecords.ts`, find the existing import:

```ts
import { planAttemptWindows, escalatePriorityForDeadline } from './serveDiligencePlanner';
```

Replace with:

```ts
import {
  planAttemptWindows, escalatePriorityForDeadline,
  clusterByProximity, applyUrgencyTier,
} from './serveDiligencePlanner';
```

- [ ] **Step 3: Compute cluster + tier before the INSERT**

Just before the `INSERT INTO serve_queue (...)` call (line ~867), insert:

```ts
const geoClusterId = clusterByProximity(
  queueRow.recipient_lat ?? null,
  queueRow.recipient_lng ?? null,
  queueRow.recipient_zip ?? null,
);
const urgencyTier = applyUrgencyTier(
  queueRow.deadline ?? null,
  0,                                // intake = no attempts yet
  Number(queueRow.max_attempts ?? 3),
  nowIso,
);
const urgencyComputedAt = nowIso;
```

(Adjust property names if `queueRow` uses different field casing — read the existing `queueRow` object definition above the INSERT to confirm; the spec assumes `recipient_lat`, `recipient_lng`, `recipient_zip`, `deadline`, `max_attempts`.)

- [ ] **Step 4: Extend the INSERT column list and VALUES tuple**

In the `INSERT INTO serve_queue (…)` block, append `, geo_cluster_id, urgency_tier, urgency_computed_at` to the column list, and add three `?` placeholders to the VALUES tuple. Add the three values (`geoClusterId, urgencyTier, urgencyComputedAt`) to the `.bind()` chain in the same order.

The columns may not exist on live D1 yet at first request — Task 7 adds the boot-time `columnExists()` reconciler. If you hit a `no such column` error during local testing, run `npx wrangler d1 execute rmpg-flex --local --file migrations/0140_serve_scheduler_advanced.sql` once.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors. If you see `Property 'recipient_zip' does not exist on type ...`, the `queueRow` builder doesn't pass ZIP through — fall back to deriving it from `recipient_address` or pass `null` to `clusterByProximity()`.

- [ ] **Step 6: Commit**

```bash
git add src/utils/serveIntakeRecords.ts
git commit -m "feat(serve): wire cluster id + urgency tier into commitIntake"
```

---

## Task 6: Wire auto-replan into `POST /serve-intake/queue/:id/attempts`

**Files:**
- Modify: `src/routes/serveIntake.ts` (find the `POST /queue/:id/attempts` handler around line 1328 — it starts with the comment "NB: live serve_attempts does NOT have the `status` column…")

- [ ] **Step 1: Locate the handler**

Run: `grep -n "queue/:id/attempts\|/queue/:queueId/attempts" src/routes/serveIntake.ts`
Expected: a single hit pointing at the handler. Open the file and read from that line down through the `INSERT INTO serve_attempts (...)`, the `UPDATE serve_queue SET attempt_count = attempt_count + 1`, and the `c.json(...)` return.

- [ ] **Step 2: Add imports at the top of `src/routes/serveIntake.ts`**

If not already imported, ensure these are available near the top of the file:

```ts
import {
  replanAfterFailedAttempt,
  applyUrgencyTier,
  type AttemptWindow,
} from '../utils/serveDiligencePlanner';
import { persistAttemptSchedule } from '../utils/serveAttemptScheduler';
```

(Use `grep -n "serveDiligencePlanner\|serveAttemptScheduler" src/routes/serveIntake.ts` to see what's already imported.)

- [ ] **Step 3: After the INSERT INTO serve_attempts + UPDATE serve_queue lines, add the auto-replan hook**

Inside the handler, after `attempt_count` is incremented, BEFORE the `c.json(...)` return, insert:

```ts
const REPLAN_RESULTS = new Set(['no_answer', 'refused', 'bad_address', 'moved']);
let replanSummary: { slot_id: number; scheduled_date: string; window: string } | null = null;

if (REPLAN_RESULTS.has(String(body.result ?? ''))) {
  // Re-read the queue row to get the post-increment attempt_count + recipient details.
  const q = await queryFirst<{
    id: number; deadline: string | null; max_attempts: number;
    attempt_count: number; recipient_lat: number | null;
    recipient_lng: number | null; document_type: string | null;
  }>(
    db,
    `SELECT id, deadline, max_attempts, attempt_count, recipient_lat,
            recipient_lng, document_type
       FROM serve_queue WHERE id = ?`,
    queueId,
  );

  if (q && q.attempt_count < q.max_attempts) {
    const isBusiness = (q.document_type ?? '').toLowerCase().includes('corporate')
      || (q.document_type ?? '').toLowerCase().includes('business');

    const next = replanAfterFailedAttempt(
      {
        attempt_at: new Date().toISOString(),
        result: String(body.result),
        window: typeof body.window === 'string' ? body.window : null,
      },
      {
        deadline: q.deadline,
        max_attempts: q.max_attempts,
        attempt_count: q.attempt_count,
        recipient_lat: q.recipient_lat,
        recipient_lng: q.recipient_lng,
        isBusiness,
      },
    );

    if (next) {
      // Persist as a single-window schedule (re-uses the existing helper).
      await persistAttemptSchedule(db, queueId, [next], new Date().toISOString());

      // Look up the newly-inserted slot for the response payload.
      const slot = await queryFirst<{ id: number; scheduled_date: string; window_start: string; window_end: string }>(
        db,
        `SELECT id, scheduled_date, window_start, window_end
           FROM serve_attempt_schedules
          WHERE queue_id = ? AND scheduled_date = ?
          ORDER BY id DESC LIMIT 1`,
        queueId, next.date,
      );
      if (slot) {
        // Stamp the auto_replan_source FK to the attempt we just inserted.
        await execute(
          db,
          `UPDATE serve_attempt_schedules SET auto_replan_source = ? WHERE id = ?`,
          attemptId, slot.id,
        );
        replanSummary = {
          slot_id: slot.id,
          scheduled_date: slot.scheduled_date,
          window: `${slot.window_start}–${slot.window_end}`,
        };
      }

      // Recompute tier; bump priority to 'rush' on flip-to-critical (one-way ratchet).
      const tier = applyUrgencyTier(q.deadline, q.attempt_count, q.max_attempts, new Date().toISOString());
      const priorityClause = tier === 'critical'
        ? `, priority = CASE WHEN priority IN ('urgent') THEN priority ELSE 'rush' END`
        : '';
      await execute(
        db,
        `UPDATE serve_queue SET urgency_tier = ?, urgency_computed_at = datetime('now') ${priorityClause}
           WHERE id = ?`,
        tier, queueId,
      );
    } else {
      // Exhausted — caller / cron will see status reflect this.
      await execute(
        db,
        `UPDATE serve_queue SET status = 'failed', updated_at = datetime('now') WHERE id = ?`,
        queueId,
      );
    }
  }
}
```

Note: the variable `attemptId` is whatever the existing handler stores from `INSERT INTO serve_attempts ... RETURNING id` or `result.meta.last_row_id`. If the existing code does not capture it, capture it now from the `execute()` / `prepare().run()` return value (`.meta.last_row_id`).

- [ ] **Step 4: Extend the response payload**

In the final `c.json({...})` call of the handler, add:

```ts
return c.json({
  ...existingResponseFields,
  ...(replanSummary ? { replan: replanSummary } : {}),
});
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 6: Run the existing tests to verify no regressions**

Run: `npm test`
Expected: all 1173+ tests still passing.

- [ ] **Step 7: Commit**

```bash
git add src/routes/serveIntake.ts
git commit -m "feat(serve): auto-replan a new schedule slot when an attempt fails"
```

---

## Task 7: Boot-time `columnExists()` reconciler for the new columns

**Files:**
- Modify: `src/routes/serveIntake.ts`

- [ ] **Step 1: Locate where the reconciler should run**

Search for an existing per-route boot-time reconciler. If `serveIntake.ts` doesn't have one yet, model after `src/routes/alpr.ts:134`:

Run: `sed -n '125,200p' src/routes/alpr.ts`
Expected: a `reconcileSchema(db)` function called once on first request via a module-level `let reconciled = false`.

- [ ] **Step 2: Add the reconciler near the top of `src/routes/serveIntake.ts`**

After imports, before the `const si = new Hono(...)` declaration, add:

```ts
import { columnExists } from '../utils/db';

let scheduleSchemaReconciled = false;
async function reconcileScheduleSchema(db: D1Database): Promise<void> {
  if (scheduleSchemaReconciled) return;
  scheduleSchemaReconciled = true;

  // serve_attempt_schedules columns from migration 0140
  for (const [name, type] of [
    ['manually_moved', 'INTEGER NOT NULL DEFAULT 0'],
    ['moved_by_user_id', 'INTEGER'],
    ['moved_at', 'TEXT'],
    ['auto_replan_source', 'INTEGER'],
    ['officer_id', 'INTEGER'],
  ] as const) {
    try {
      if (!(await columnExists(db, 'serve_attempt_schedules', name))) {
        await execute(db, `ALTER TABLE serve_attempt_schedules ADD COLUMN ${name} ${type}`);
      }
    } catch (err) { console.warn(`[serve-intake] reconcile ${name} failed:`, err); }
  }

  // serve_queue columns from migration 0140
  for (const [name, type] of [
    ['geo_cluster_id', 'TEXT'],
    ['urgency_tier', 'TEXT'],
    ['urgency_computed_at', 'TEXT'],
  ] as const) {
    try {
      if (!(await columnExists(db, 'serve_queue', name))) {
        await execute(db, `ALTER TABLE serve_queue ADD COLUMN ${name} ${type}`);
      }
    } catch (err) { console.warn(`[serve-intake] reconcile ${name} failed:`, err); }
  }
}
```

- [ ] **Step 3: Call the reconciler from the routes that touch the new columns**

At the top of the `POST /queue/:id/attempts` handler AND the `GET /schedule` handler, add:

```ts
const db = getDb(c.env);
await reconcileScheduleSchema(db);
```

(If `const db = getDb(c.env);` already exists, just add the `reconcileScheduleSchema(db)` line right after.)

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/routes/serveIntake.ts
git commit -m "feat(serve): reconcile migration 0140 columns at first request (alpr.ts pattern)"
```

---

## Task 8: `runDailyRebalance()` — pure-ish orchestrator + tests

**Files:**
- Create: `src/utils/serveRebalance.ts`
- Create: `tests/serveRebalance.test.ts`

- [ ] **Step 1: Write the failing test** — create `tests/serveRebalance.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { runDailyRebalance } from '../src/utils/serveRebalance';

// Minimal mock of the D1 surface we touch — query/queryFirst/execute.
function mockDb(queueRows: Array<Record<string, unknown>>) {
  const executed: Array<{ sql: string; binds: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      const binds: unknown[] = [];
      return {
        bind: (...args: unknown[]) => { binds.push(...args); return this; },
        all: async () => ({ results: queueRows }),
        first: async () => queueRows[0] ?? null,
        run: async () => { executed.push({ sql, binds }); return { success: true, meta: { last_row_id: 0 } }; },
      };
    },
  } as unknown as Parameters<typeof runDailyRebalance>[0];
  return { db, executed };
}

const NOW = '2026-06-11T10:00:00.000Z'; // Thursday 04:00 Denver MDT — cron firing time

describe('runDailyRebalance', () => {
  it('returns zeroed counts on an empty queue', async () => {
    const { db } = mockDb([]);
    const result = await runDailyRebalance(db, NOW);
    expect(result).toEqual({
      tiers_recomputed: 0,
      tiers_promoted_critical: 0,
      priority_escalated: 0,
      slots_skipped_manual: 0,
    });
  });

  it('escalates priority when tier flips to critical and current priority is not "urgent"', async () => {
    const { db, executed } = mockDb([
      { id: 1, deadline: '2026-06-12', max_attempts: 3, attempt_count: 0,
        priority: 'normal', urgency_tier: 'standard' },
    ]);
    const result = await runDailyRebalance(db, NOW);
    expect(result.tiers_promoted_critical).toBe(1);
    expect(result.priority_escalated).toBe(1);
    // Must update serve_queue with new tier + rushed priority.
    expect(executed.some((e) => e.sql.includes('UPDATE serve_queue') && e.binds.includes('critical'))).toBe(true);
  });

  it('does NOT demote a manually-set "urgent" priority', async () => {
    const { db, executed } = mockDb([
      { id: 2, deadline: '2026-08-12', max_attempts: 3, attempt_count: 0,
        priority: 'urgent', urgency_tier: 'critical' },
    ]);
    const result = await runDailyRebalance(db, NOW);
    expect(result.priority_escalated).toBe(0);
    // Must not touch priority for already-urgent rows.
    expect(executed.every((e) => !e.binds.includes('rush'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `npx vitest run tests/serveRebalance.test.ts`
Expected: failures with `Cannot find module '../src/utils/serveRebalance'`.

- [ ] **Step 3: Implement** — create `src/utils/serveRebalance.ts`

```ts
// ============================================================
// RMPG Flex — Daily serve schedule rebalance
// ============================================================
// Runs at 04:00 America/Denver (driven by src/index.ts at UTC hour=10).
// For every pending/assigned serve_queue row:
//   1. Recompute urgency_tier from deadline + remaining attempts
//   2. If tier flipped to 'critical' AND priority NOT IN ('urgent'),
//      escalate priority='rush' (one-way ratchet — never demotes)
//   3. (PR 2/3 will add slot reshuffling here for non-manually_moved slots)
//
// Designed to be safe to run repeatedly. Returns counters for observability.
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import { query, execute } from './db';
import { applyUrgencyTier, type UrgencyTier } from './serveDiligencePlanner';

export interface RebalanceResult {
  tiers_recomputed: number;
  tiers_promoted_critical: number;
  priority_escalated: number;
  slots_skipped_manual: number;
}

interface QueueRow {
  id: number;
  deadline: string | null;
  max_attempts: number;
  attempt_count: number;
  priority: string;
  urgency_tier: string | null;
}

export async function runDailyRebalance(db: D1Database, nowIso: string): Promise<RebalanceResult> {
  const rows = await query<QueueRow>(
    db,
    `SELECT id, deadline, max_attempts, attempt_count, priority, urgency_tier
       FROM serve_queue
      WHERE status IN ('pending', 'assigned', 'in_progress')`,
  );

  let tiers_recomputed = 0;
  let tiers_promoted_critical = 0;
  let priority_escalated = 0;
  const slots_skipped_manual = 0; // populated in PR 2/3 when slot reshuffling lands

  for (const row of rows) {
    const newTier: UrgencyTier = applyUrgencyTier(
      row.deadline,
      row.attempt_count,
      row.max_attempts,
      nowIso,
    );

    const escalate = newTier === 'critical'
      && row.urgency_tier !== 'critical'
      && row.priority !== 'urgent';

    if (newTier !== row.urgency_tier) tiers_recomputed++;
    if (newTier === 'critical' && row.urgency_tier !== 'critical') tiers_promoted_critical++;
    if (escalate) priority_escalated++;

    const priorityClause = escalate ? `, priority = 'rush'` : '';
    await execute(
      db,
      `UPDATE serve_queue
          SET urgency_tier = ?, urgency_computed_at = datetime('now') ${priorityClause}
        WHERE id = ?`,
      newTier, row.id,
    );
  }

  return { tiers_recomputed, tiers_promoted_critical, priority_escalated, slots_skipped_manual };
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run tests/serveRebalance.test.ts`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/serveRebalance.ts tests/serveRebalance.test.ts
git commit -m "feat(serve): runDailyRebalance() — recompute tiers + escalate priority"
```

---

## Task 9: Hook the daily rebalance into the cron handler

**Files:**
- Modify: `src/index.ts` (the `async scheduled(...)` block near line 334)

- [ ] **Step 1: Locate the per-minute cron handler**

Run: `sed -n '330,460p' src/index.ts`
Expected: see `async scheduled(event, env, ctx)` with `if (event.cron === '* * * * *') { ... }`.

- [ ] **Step 2: Inside the `* * * * *` branch, add a gated rebalance call**

Inside the existing `if (event.cron === '* * * * *') { ... }` block, after the D1 connectivity check passes, add:

```ts
// Daily 04:00 America/Denver rebalance — UTC hour=10, minute=0 (DST drift accepted).
const utcNow = new Date();
if (utcNow.getUTCHours() === 10 && utcNow.getUTCMinutes() === 0) {
  ctx.waitUntil(
    import('./utils/serveRebalance').then(({ runDailyRebalance }) =>
      runDailyRebalance(env.DB, utcNow.toISOString()),
    )
    .then((r) => console.log('[serve-rebalance] daily:', JSON.stringify(r)))
    .catch((err) => console.error('[serve-rebalance] daily failed:', err)),
  );
}
```

The dynamic `import(...)` keeps the cron handler's cold-start path light — `serveRebalance` is only pulled in when the minute matches.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat(serve): wire 04:00 Denver rebalance into the per-minute cron"
```

---

## Task 10: Pre-flight — full test + typecheck + push

**Files:** none (verification + push)

- [ ] **Step 1: Run the full Worker typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 2: Run the full Worker test suite**

Run: `npm test`
Expected: 1180+ tests passing, 0 failures (1173 baseline + the 16 new tests from this PR: 4 cluster + 7 tier + 6 replan + 3 rebalance = 20, less any I miscounted).

- [ ] **Step 3: Run the client typecheck (defense — no client changes but the husky pre-push hook will)**

Run: `cd client && npx tsc --noEmit && cd ..`
Expected: 0 errors.

- [ ] **Step 4: Confirm git log is clean and the spec commit is included**

Run: `git log --oneline origin/main..HEAD`
Expected: ~10 commits — 1 spec commit + 1 migration + 3 pure-function feats + 1 commitIntake wire + 1 attempts hook + 1 reconciler + 1 rebalance + 1 cron wire (some commits may have been squashed into the same step if you committed conservatively).

- [ ] **Step 5: Push the branch and open a PR**

Run:
```bash
git push -u origin claude/modest-faraday-90b9f8
gh pr create --title "feat(serve): auto-scheduler PR 1 — backend (cluster + tier + auto-replan + rebalance cron)" --body "$(cat <<'EOF'
## Summary
- Adds three pure scheduling functions to `serveDiligencePlanner.ts`: `clusterByProximity`, `applyUrgencyTier`, `replanAfterFailedAttempt`
- Wires cluster id + urgency tier into `commitIntake`
- Hooks the `POST /queue/:id/attempts` route to auto-replan a new schedule slot when an attempt fails (`no_answer | refused | bad_address | moved`)
- Adds a daily 04:00 Denver rebalance cron that recomputes tiers and escalates `priority='rush'` on flip-to-critical (one-way ratchet)
- Migration 0140 + boot-time `columnExists()` reconciler (alpr.ts pattern)

No UI changes — dashboard panel lands in PR 2, full-page scheduler in PR 3. Spec at [docs/superpowers/specs/2026-06-21-process-service-auto-scheduler-design.md](docs/superpowers/specs/2026-06-21-process-service-auto-scheduler-design.md).

## Test plan
- [x] `npm test` — all pure functions covered (20 new tests)
- [x] `npm run typecheck` — Worker clean
- [x] `cd client && npx tsc --noEmit` — Client clean (defense)
- [ ] Post-merge: apply `0140_serve_scheduler_advanced.sql` directly to live D1 `785de7ae` via Cloudflare API and verify with `pragma_table_info('serve_attempt_schedules')` + `pragma_table_info('serve_queue')`
- [ ] Post-merge: file a sample serve intake via the existing intake page, verify `serve_queue.geo_cluster_id` and `urgency_tier` are populated
- [ ] Post-merge: log a `no_answer` attempt, confirm a new `serve_attempt_schedules` row appears with `auto_replan_source` set
- [ ] Post-merge: confirm the `[serve-rebalance] daily:` log line appears in Worker logs at the next 10:00 UTC tick

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed; no force-push, no merge — leave the PR for the user to review.

---

## Self-review checklist

After the implementation lands, the spec asks for one manual post-merge step that no plan task can do for you:

- Apply `migrations/0140_serve_scheduler_advanced.sql` directly to live D1 `rmpg-flex` (id `785de7ae-3e7a-4e01-93bb-d24ddd813f6b`) via the Cloudflare API. The `continue-on-error` deploy step is unreliable for `ALTER TABLE ADD COLUMN` (D1 lacks `IF NOT EXISTS`).
- Verify with `pragma_table_info('serve_attempt_schedules')` (expect 5 new columns) and `pragma_table_info('serve_queue')` (expect 3 new columns).
- The `reconcileScheduleSchema()` boot-time reconciler in Task 7 is the runtime safety net — but applying the migration directly first means the very first user request doesn't pay a multi-`ALTER` latency tax.

## Scope coverage

| Spec section | Plan task(s) |
|---|---|
| Schema delta — migration 0140 | Task 1 |
| Algorithm — `clusterByProximity` | Task 2 |
| Algorithm — `applyUrgencyTier` | Task 3 |
| Algorithm — `replanAfterFailedAttempt` (incl. bad_address path) | Task 4 |
| Wire cluster + tier into intake | Task 5 |
| Wire auto-replan into attempts route | Task 6 |
| Boot-time schema reconciler | Task 7 |
| Daily 04:00 cron rebalance + tier escalation | Tasks 8 & 9 |
| Verification + PR | Task 10 |
| **Deferred to PR 2** (dashboard panel, drag-drop endpoint, WS broadcast) | future plan |
| **Deferred to PR 3** (full-page scheduler, batch rebalance endpoint) | future plan |
