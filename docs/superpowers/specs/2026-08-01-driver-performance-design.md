# Driver Performance — Design

**Date:** 2026-08-01
**Status:** Approved for planning
**Owner:** Rocky Mountain Protective Group

## Purpose

A supervisor-facing driver performance capability that scores personnel on driving
behavior using existing telematics, dashcam AI, and exposure data. It serves four
lenses over one dataset:

1. **Safety coaching** — supervisor-mediated, non-punitive trend visibility.
2. **Supervisory accountability** — ranked roster for review conversations.
3. **Liability and insurance defense** — reproducible, exportable evidence of what
   the system recorded and when.
4. **Fleet-cost attribution** — driver-keyed view of the fleet's existing cost data.

These are presentation lenses on a single scoring engine, not four subsystems.

## Guiding constraint

The dominant risk is not an outage. It is a **confident wrong number about a named
person**. Every design decision below favors an honest blank over a plausible score.

## Decisions

| Question | Decision |
|---|---|
| Attribution | Hybrid: stamped at ingest going forward, inferred from assignment history for the past, unattributed otherwise — always visibly distinguished |
| Normalization | Weighted events per 100 miles, with a 250-mile minimum-exposure floor |
| Visibility | Supervisor-only. Officers have no self-view |
| Architecture | Nightly rollup writing immutable daily snapshots |
| PDF export | In v1 |

## Architecture

Nightly cron resolves attribution and exposure per officer-day and writes one
immutable snapshot row. All reads aggregate over snapshots. Recomputation is
explicit, admin-triggered, and audited.

Snapshots exist because lens 3 requires answering *"what did this officer's score
say on a given date?"* A score recomputed from current data is unreproducible and
therefore weak as evidence.

## Data model

### New table — `driver_performance_daily`

One row per `(officer_id, perf_date)`.

- **Keys:** `officer_id`, `perf_date`
- **Exposure:** `miles_driven`, `drive_minutes`, `trip_count`
- **Events by severity:** `events_critical`, `events_high`, `events_moderate`, `events_low`
- **Events by type:** forward-collision, lane-departure, close-following,
  harsh-brake, harsh-accel, speeding
- **Attribution provenance:** `attribution_recorded_pct`, `attribution_inferred_pct`
- **Cost (lens 4):** `fuel_cost`, `fuel_gallons`, `maintenance_cost`, `damage_cost`
- **Result:** `score`, `score_version`, `computed_at`

**Cost is recorded and displayed but never folded into the safety score.** A driver
assigned an older, thirstier vehicle would otherwise score as unsafe for a fleet
decision they did not make. Cost is attributed through the same assignment window
as events, sourced from existing fuel entries and work orders, and shown as its own
column set beside the safety score — never blended into it.

`score_version` pins each snapshot to the weighting in force when it was computed.
Retuning weights must never silently restate historical scores.

Unique index on `(officer_id, perf_date)`; upserts are idempotent.

### Schema changes

**Migration `0222`** — `fleet_assignments.officer_id` (nullable FK to `users`).
Required going forward. A one-time resolver matches existing `officer_name` free
text to users and writes the FK **only on unambiguous single matches**; ambiguity
stays null rather than guessing.

**Migration `0223`** — `dashcam_events.officer_id` and
`dashcam_events.officer_attribution_source`. Stamped at ingest from here forward.
`dashcam_events` is far below the D1 100-column cap, so `ADD COLUMN` is safe here
(unlike `calls_for_service` / `persons`).

**Migration `0224`** — `driver_performance_daily` plus indexes.

Apply all three to live D1 `785de7ae` via `scripts/apply-migration.sh` after merge
and verify with `pragma_table_info`; the deploy step is `continue-on-error`.

### Attribution resolution

Per event, in order:

1. Stamped `dashcam_events.officer_id` → source `recorded`
2. `fleet_assignments` row whose `[assigned_at, unassigned_at)` window covers the
   event timestamp → source `inferred`
3. Otherwise → `unattributed`

**Unattributed events are excluded from both numerator and denominator.** They are
never assigned to the vehicle's current officer.

This corrects a defect that makes the existing path unusable for this purpose:
`src/routes/drivingEvents.ts` attributes via `units.officer_id`, which is the
officer in the vehicle *now*. That is correct for a live console and wrong for any
historical aggregate.

Parse D1 timestamps with `parseD1TimestampMs`. `datetime('now')` is zone-less and
`Date.parse` reads it as local time, which would skew every window-boundary test.

### Sources

- **Events:** `dashcam_events` (ClearPath AI, already severity-classified by
  `src/utils/drivingEvents.ts`)
- **Exposure:** `cpg_drive_job_trips`, `unit_trips`, `fleet_telemetry`,
  `mileage_anchor`
- **Own-fleet collisions:** the damage / work-order side.
  **Not** `crash_reports` — its `investigating_officer` column identifies the
  officer who investigated a public collision. Sourcing "crashes" from there would
  penalize personnel for doing their job.

## Scoring engine

`src/utils/driverPerformance/score.ts` — pure, no D1 access, numbers in and score
out. Isolated because this is the logic most likely to be quoted in a grievance or
a deposition, and it must be readable and testable on its own.

1. **Exposure gate** — under 250 miles in the window, return `insufficient_data`.
   Not a score, not a zero. A blank is honest; a zero is a claim.
2. **Weighted rate** — `(Σ severity_weight × count) ÷ (miles ÷ 100)`.
3. **Scale to 0–100**, higher is better, anchored to a **fixed reference rate** —
   not graded on a curve against the current roster. An officer's score must not
   move because a colleague drove badly. Peer ranking is a separate, labeled view.
4. **Band** — Excellent / Good / Needs Attention / At Risk.

Module invariants:

- A score computed from majority-inferred attribution returns
  `confidence: 'inferred'`, and the UI must render it visually distinct. An
  inferred score is a lead to investigate, never a finding.
- The module never returns a rank. Ranking happens in the route over scored
  officers only, so `insufficient_data` officers cannot land at the bottom of a
  leaderboard.

**Open for owner input at implementation:** the severity weights, and whether
repeat events in a short window escalate. This is a policy judgment about the
organization's risk tolerance, not a technical one. The function signature and
call site will be prepared for the owner to supply.

## API

`src/routes/driverPerformance.ts`, mounted at `/api/driver-performance`.

| Endpoint | Purpose |
|---|---|
| `GET /roster` | Scored roster for `?from=&to=`, ranked; `insufficient_data` officers returned in a separate unranked list |
| `GET /officer/:id` | Daily trend, event breakdown, exposure, attribution confidence, linked events |
| `GET /officer/:id/export` | PDF via the existing `pdfEngine` seam, stamped with window, `score_version`, attribution confidence, generation timestamp |
| `POST /recompute` | Admin-only, re-runs a date range. Explicit and audited, never automatic |

### Access control

Gated to `admin`, `manager`, `supervisor`, `human_resources`.
**Hard-excluded:** `client_viewer`, `contract_manager`, `officer`.

Enforced **on the GET handlers directly.** `readOnlyRoleGuard` backstops mutations
only, so an ungated read is open to `client_viewer` by default in this codebase.
That is the most likely path by which this feature would leak named officer risk
scores to an external contract client, so it carries a dedicated test per role.

### Query safety

Every officer-list query goes through `queryInChunks` / `chunkBindings` from
`src/utils/db.ts`. D1's 100-bound-parameter cap fails at bind time and, in
aggregation code that catches per-block, fails **silently as an empty result** —
which here would read as "no events," i.e. good driving. Dedupe before chunking.

## Cron

Nightly (not the per-minute sweep). Recomputes the **trailing 3 days**, since
late-arriving ClearPath events and assignment corrections are routine and a 3-day
window absorbs them without manual intervention.

Writes are idempotent upserts on `(officer_id, perf_date)`. Officers are processed
in batches to respect the hard 15-minute cron wall cap.

## UI

`FleetDriverPerformanceTab`, added to the existing fleet tab set alongside
`FleetAnalyticsTab` — no new navigation concept and no new page-level auth surface.

**Roster view** — dense house style (9px semibold headers `py-[3px]`, 11px rows
`py-[2px]`, no pill badges): officer, score, band, weighted rate per 100 miles,
miles, event count, attribution confidence, and cost columns (fuel, maintenance,
damage) presented as a separate visually-grouped set. Sortable. Officers below the exposure
floor appear in a separate "Insufficient exposure" block beneath the ranked table —
visible, structurally unrankable.

**Officer detail** — daily trend, breakdown by type and severity, event list
linking into existing dashcam and ALPR detail surfaces.

**Styling** — no hardcoded hex; `surface-*` / `rmpg-*` tokens, 2px radius. Score
bands use reserved CAD severity hues (`--sev-critical` et al.), which is exactly
their intended role here. Gold stays confined to `--field-label-color` and
`--panel-header-color`; never on a score or badge, since gold cannot signal state.

**Hard UI rule:** the score never renders without its denominator adjacent. No
sparkline-only summary, no bare score in a dashboard tile. A context-free "62" in a
screenshot is the easiest way for this tool to cause harm.

## Error handling

Fails loud and empty rather than degrading into a plausible score.

- Missing exposure for an officer-day → `insufficient_data`, never `0 miles`. A
  zero denominator must never become a division producing a huge rate.
- Unresolvable attribution → excluded from numerator and denominator.
- Cron failure on one officer → logged via the structured logger with officer and
  date; the batch continues. The day has no snapshot, visible as a gap.
- **No silent-skip pattern.** A caught-and-logged failure returning an empty result
  is indistinguishable from "no events," and "no events" reads as good driving.
  Partial computation is flagged in the response, not swallowed.

## Testing

Pure logic in `tests/`, routes in `test-workers/` (Miniflare).

- Exposure floor boundary (249 vs 250 miles); zero-mileage division safety
- Severity weighting; score monotonic in event rate
- Attribution order: stamped beats inferred beats unattributed; an event outside
  every assignment window resolves to unattributed, not to the nearest assignment
- Snapshot immutability: recompute under a new `score_version` does not rewrite
  prior-version rows
- **RBAC per role** — explicit 403 for `client_viewer`, `contract_manager`, and
  `officer` on every GET
- Chunked-query correctness above 100 officers (invisible below the cap)

## Deliberately out of scope for v1

- **Officer self-service view.** Visibility is supervisor-only by decision.
- **Notifications / automated alerts on a falling score.** An automated message to
  a supervisor is a disciplinary trigger with no human in the loop. That is a
  policy decision to be made deliberately, not shipped quietly.
- **Peer-cohort normalization.** Statistically thin at this headcount.
- **Fleet.io write-back.** Scores stay in Rocky Mountain Protective Group systems.

## Post-merge checklist

1. Apply `0222`, `0223`, `0224` to live D1 `785de7ae` via
   `scripts/apply-migration.sh`; verify with `pragma_table_info`.
2. Run the `fleet_assignments.officer_id` resolver; review the unmatched report.
3. Backfill `driver_performance_daily` for the desired history window.
4. Verify the tab renders in the live fleet shell and that RBAC returns 403 for
   `client_viewer`.
