# Serve Mileage Attribution Repair — Design

**Date:** 2026-08-02
**Status:** Approved for planning
**Author:** Claude (session), reviewed by Christopher Zamora

## Context

The Process Server module already computes GPS-based mileage for client
billing — this was not previously understood; earlier documentation and a
prior session's stats endpoint both assumed no serve-side mileage source
existed. It exists, and it has two defects that make it unsafe to keep as-is,
plus a disconnect between where it's computed and where it's shown.

### What exists today

- **`computeMileageForQueue(db, queueId)`** in
  [`src/utils/serveBillingEnhanced.ts:1121`](../../../src/utils/serveBillingEnhanced.ts)
  — sums haversine distance across `gps_breadcrumbs` rows joined to
  `serve_attempts` by `officer_id`, where
  `gb.recorded_at BETWEEN sa.attempt_at AND datetime(sa.attempt_at, '+2 hours')`,
  scoped to attempts on one `serve_queue_id`. Feeds a `mileage` billing line
  item at `resolveRate('mileage', DEFAULT_MILEAGE_RATE)` — the rate resolution
  itself is correctly configurable (admin pricing overrides via `pricingMap`)
  and is **out of scope** for this repair.
- **`ServePage.tsx`** (client, per-job billing preview) reads the computed
  `mileage`/`mileage_fee` from that billing line item and renders it — this
  path is correct given a correct input.
- **`GET /serve/stats`** in [`src/routes/serve.ts:174`](../../../src/routes/serve.ts)
  (the daily Stats tab aggregate) hardcodes `mileage: null` with a comment
  stating no serve-side actual-mileage source exists — written without
  awareness of `computeMileageForQueue`. `planned_mileage` (from
  `serve_routes.total_distance_miles`) is unaffected and stays as-is.
- **`MyRunTab.tsx`** (officer's own run view) has no mileage display at all.

### Schema (unchanged by this repair)

```sql
-- serve_attempts (migrations/0030_serve_intake.sql)
id, serve_queue_id, attempt_number, attempt_at, officer_id,
result, latitude, longitude, notes, attempt_type, status, created_at, ...

-- gps_breadcrumbs (migrations/0001_initial_schema.sql)
id, unit_id, officer_id, latitude, longitude, accuracy, heading, speed,
recorded_at, ...
```

Both tables already exist and are populated; no migration is needed.

### Root-cause defects

1. **Cross-job double counting.** The `attempt_at → +2h` window is not
   exclusive to one job. An officer with two attempts 30 minutes apart on
   different `serve_queue_id`s (normal on a multi-stop run) has overlapping
   windows — the same breadcrumbs, and therefore the same driven distance,
   get summed into **both** jobs' billing previews. Two different clients
   would be billed for the same mile of driving.
2. **Unbounded window.** `+2 hours` is not tied to when the officer actually
   left that attempt's location. A long stakeout, a lunch break, or an
   unrelated errand inside the window is attributed to that job.
3. **No pre-invoice visibility.** Mileage is only ever computed at billing-
   preview generation time. The officer who drove the miles has no surface
   showing what will appear on the client's invoice before it's generated.
4. **Disconnected daily aggregate.** The Stats tab shows `mileage: null`
   with messaging implying the capability doesn't exist, even though a
   per-job version of the same computation already works elsewhere.

## Approach

Reuse the pattern already established in
[`src/routes/patrolMileage.ts`](../../../src/routes/patrolMileage.ts) for the
PS-211 Trip Log: partition an officer's breadcrumb timeline into **segments
bounded by consecutive attempts**, so each breadcrumb belongs to exactly one
segment by construction — no overlap is possible, because segments don't
overlap.

### New shared module: `src/utils/serveMileage.ts`

Replaces `computeMileageForQueue` (which is deleted from
`serveBillingEnhanced.ts` in favor of importing from here).

```ts
export interface AttemptMileageSegment {
  attemptId: number;
  serveQueueId: number;
  officerId: number;
  attemptAt: string;
  miles: number;
}

/**
 * Compute driven mileage for a single officer over [from, to] (inclusive,
 * ISO datetime strings), attributing every gps_breadcrumbs row to exactly
 * one attempt: the segment [previous attempt's attempt_at (or `from` for the
 * first), this attempt's attempt_at]. A breadcrumb outside every officer's
 * attempt on that day (e.g. before the first attempt, or after the last) is
 * not attributed to any job — it's driving time not tied to a serve
 * attempt, and billing only reflects attributable segments.
 */
export async function computeOfficerMileageSegments(
  db: D1Database,
  officerId: number,
  from: string,
  to: string,
): Promise<AttemptMileageSegment[]>;

/** Sum of segments for one serve_queue_id — replaces computeMileageForQueue. */
export async function computeMileageForQueue(
  db: D1Database,
  queueId: number,
): Promise<number>;

/** Sum of segments for one officer across all their jobs on a given day —
 *  powers the /serve/stats daily aggregate. */
export async function computeOfficerMileageForDay(
  db: D1Database,
  officerId: number,
  day: string, // YYYY-MM-DD, America/Denver
): Promise<number>;
```

Implementation notes:
- Query breadcrumbs once per officer for the requested window (single
  `officer_id` + `recorded_at` range predicate — no IN-list, no D1
  100-bound-parameter risk).
- Sort the officer's attempts for the window chronologically, sort
  breadcrumbs chronologically, then walk both in one pass assigning each
  breadcrumb to the segment ending at the next attempt's `attempt_at`
  (mirrors the "PATROL rows between calls" walk in `patrolMileage.ts`'s trip
  log builder — same technique, different source tables).
- `computeMileageForQueue(db, queueId)` becomes a thin wrapper: look up the
  queue's officer(s) and attempt date range, call
  `computeOfficerMileageSegments`, filter to that `serveQueueId`, sum
  `miles`. Existing callers (`serveBillingEnhanced.ts` line 334) need no
  signature change.
- `computeOfficerMileageForDay` sums all segments for that officer whose
  `attemptAt` falls on that calendar day (America/Denver, matching the
  existing day-bucketing convention in `serve.ts`).

### `serve.ts` `/stats` repair

Replace the hardcoded `mileage: null` with a real aggregate: sum
`computeOfficerMileageForDay` across every officer with an attempt that day
(officers derived from the existing `attempts` query's underlying rows —
no new query shape, just don't discard officer_id). Keep `planned_mileage`
untouched. If the sum errors (e.g. malformed breadcrumb data), fall back to
`null` with the existing comment's honesty rationale preserved — never
silently substitute the planned figure.

### `MyRunTab.tsx` surface

Add a read-only "Mileage today" line to the tab's per-officer header (where
the served/total progress bar already lives), fetching from a new endpoint:

```
GET /serve/mileage/mine?date=YYYY-MM-DD   (defaults to today, America/Denver)
→ { miles: number, by_job: Array<{ serve_queue_id, miles }> }
```

Backed by `computeOfficerMileageForDay` + `computeOfficerMileageSegments`
grouped by `serveQueueId`. Auth: officer sees their own mileage only
(`officer_id` taken from the authenticated user, not a query param — no IDOR
surface). This is the pre-invoice visibility fix: the officer sees the same
number that will later appear on the client's bill, before it's generated.

## Data flow

```
gps_breadcrumbs (per officer, continuous)          serve_attempts (per job)
        │                                                    │
        └──────────────── computeOfficerMileageSegments ─────┘
                                    │
                ┌───────────────────┼───────────────────┐
                ▼                   ▼                   ▼
   computeMileageForQueue   computeOfficerMileageForDay   (segments, for
   (billing line item,      (Stats tab daily aggregate)    MyRunTab grouping)
    unchanged callers)
```

## Error handling

- No breadcrumbs in range → `0` miles, not an error (officer may have driven
  a personal vehicle with location services off; existing `planned_mileage`
  fallback in the UI already covers this case).
- Malformed/null lat-lng rows are filtered at the query level (matches
  existing `WHERE gb.latitude IS NOT NULL AND gb.longitude IS NOT NULL`).
- `/serve/mileage/mine` and the `/stats` aggregate both wrap the computation
  in try/catch consistent with every other handler in `serve.ts`
  (`dbErrorResponse` / safe-fallback pattern), so a computation error never
  501s the whole Stats tab or My Run view.

## Testing

1. **Unit test for `computeOfficerMileageSegments`** (new
   `tests/serveMileage.test.ts`): construct two attempts 30 minutes apart on
   *different* `serve_queue_id`s sharing one officer's breadcrumb trail, and
   assert the sum of both jobs' individual mileage equals the *total* distance
   travelled — not double the distance (this is the regression test pinning
   the double-counting bug as fixed).
2. Unit test: breadcrumbs before the first attempt or after the last are
   excluded from any job's total.
3. Unit test: `computeMileageForQueue` returns the same value as calling
   `serveBillingEnhanced.ts`'s billing preview did before the refactor, for a
   single-attempt job (no behavior change in the common case).
4. Miniflare test (`test-workers/serveMileage.test.ts`): hit
   `GET /serve/stats` and confirm `mileage` is a number (not `null`) when
   attempts + breadcrumbs exist for the day; hit
   `GET /serve/mileage/mine` and confirm officer-scoping (cannot read another
   officer's mileage).
5. Full existing `tests/serveBillingEnhanced*.test.ts` /
   `tests/serveDenverBuckets.test.ts` suites must stay green — no billing
   rate/format changes.

## Explicitly out of scope

- Mileage billing rate or dollar-conversion changes (`DEFAULT_MILEAGE_RATE`,
  `resolveRate`) — deferred per explicit instruction.
- ClearPathGPS vehicle-based mileage — officer/phone location tracking only.
- Any change to `serve_routes.total_distance_miles` (planned mileage) or the
  Route Efficiency card's use of it.
- Fleet.io, Dispatch cross-integration, and Serve Intake workflow
  improvements — separate sub-projects, tracked independently.
