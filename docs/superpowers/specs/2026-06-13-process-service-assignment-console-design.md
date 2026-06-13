# Process-Service Assignment Console, Officer Run & Overdue Nudges — Design

**Date:** 2026-06-13
**Status:** Approved (design); ready for implementation planning
**Surface:** Serve subsystem ([ServePage.tsx](../../../client/src/pages/ServePage.tsx)) + `/api/serve` + cron
**Phase:** 2 of 3 (see [Phase 1 spec](2026-06-13-process-service-contracts-billing-design.md) §11 roadmap)

---

## 1. Goal & boundary

Phase 2 adds the **supervisor side** of process serving — the piece the existing
officer-centric tooling lacks:

- A **supervisor assignment console** (Roster + jobs split layout) to assign / reassign /
  balance serve jobs across officers, with single and bulk assignment.
- A polished **officer "My Run"** — today's assigned jobs in priority order with quick
  navigate / log-attempt / mark-served actions.
- A **needs-attention engine** flagging four conditions — deadline approaching, deadline
  passed, diligence gap (stalled), unassigned near deadline — surfaced **passively**
  (badges + a Needs-Attention view) **and proactively** (a cron sweep → in-app
  notifications + supervisor email).

### Out of scope (Phase 2)
- Patrol tours / checkpoint scanning (a separate subsystem; not this phase).
- Route **auto-optimization** — the existing per-officer optimizer (`/routes`, `/reorder`)
  stays as-is; this phase assigns work, it doesn't re-solve TSP.
- **Reusable named route templates** — process-serve jobs are inherently one-off (a unique
  legal document to a unique address), so the "named routes" idea from the original patrol
  brainstorm does not apply here. "Route" = an officer's daily set of jobs.

---

## 2. Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| Phase 2 focus | **Process-service** assignment + run + nudges (not patrol) |
| Assignment console layout | **Roster + jobs split** (officer list w/ counts → selected officer's run + unassigned pool) |
| Attention conditions | **All four**: deadline approaching · deadline passed · diligence gap · unassigned near deadline |
| Nudge delivery | **Passive (badges + view) AND proactive (cron push)** |
| Proactive channel | Assigned officer → in-app notification; supervisors → in-app **+ email digest** (MS Graph) |
| Assignment audit | Reuse existing **`activity_log`** (no new table, no `serve_queue` ALTER) |
| Thresholds | **Editable** via a single-row settings table (dynamic, no deploy to change) |

---

## 3. What already exists (build on, don't reinvent)

- `serve_queue` jobs carry `officer_id` (assignment), `priority`, `deadline`, `time_window`,
  `status` (pending/assigned/in_progress/served/attempted/failed/cancelled), `attempt_count`,
  `max_attempts`, `sort_order`, `defendant_name`, `recipient_name`, `case_number`.
- `serve_attempts` (`attempt_at`, `result`, `officer_id`) — drives the **diligence gap**.
- Endpoints in [serve.ts](../../../src/routes/serve.ts): `GET /priority-queue` (officer-filterable,
  urgent→rush→deadline order), `GET /deadlines`, `GET /success-rates` (per-officer counts),
  `PUT /:id` (sets `officer_id`), `PUT /reorder`, `GET /routes/:date` + `POST /routes`.
- `notifications` table (`type, priority, title, message, entity_type, entity_id, user_id, is_read`).
- Cron triggers in [wrangler.toml](../../../wrangler.toml): `"0 */4 * * *"` (4-hourly) + `"* * * * *"`;
  handled by `scheduled()` in [src/index.ts](../../../src/index.ts).
- MS Graph send path: `src/utils/msGraph.ts` (+ `src/routes/email.ts`).
- `serveDiligencePlanner.ts` (`daysUntilDeadline`, attempt-cadence) — reuse for thresholds/diligence.

---

## 4. Data model

Migration **`01NN_serve_assignment_nudges.sql`** — ⚠️ **pick the next truly-free integer at
implementation time**: there is active migration-number contention (PRs #1187/#1189/#1191/#1192
all grabbed `0104`). Run `ls migrations/` AND check open PRs; do not hardcode `0105` blindly.
Idempotent DDL; also apply directly to live D1 `785de7ae` post-merge (deploy step is
`continue-on-error`).

- **`serve_nudges`** — dedup so the cron never re-spams the same job+condition:
  ```
  id INTEGER PK, serve_queue_id INTEGER NOT NULL, condition TEXT NOT NULL,
  last_notified_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(serve_queue_id, condition)
  ```
- **`serve_nudge_settings`** — single editable row (id=1), seeded with defaults:
  ```
  id INTEGER PK CHECK(id=1), approaching_hours INTEGER DEFAULT 48,
  diligence_gap_days INTEGER DEFAULT 3, unassigned_window_hours INTEGER DEFAULT 72,
  renotify_hours INTEGER DEFAULT 24, notify_supervisor_email INTEGER DEFAULT 1,
  updated_at TEXT, updated_by INTEGER
  ```
- **Assignment audit** → reuse `activity_log` with `entity_type='serve_assignment'`,
  `entity_id=serve_queue_id`, `details={ from_officer, to_officer, reason }`. **No
  `serve_queue` ALTER** (it's already wide; assignment is the existing `officer_id`).

---

## 5. Needs-attention classifier (pure, unit-tested core)

`src/utils/serveAttention.ts` — `classifyServeJob(job, nowIso, settings) → AttentionCondition[]`.
Pure, no DB; shared by the board flags, the Needs-Attention endpoint, and the cron. A job is
only classified if **open** (`status NOT IN ('served','cancelled','failed')`).

| Condition | Rule |
|---|---|
| `deadline_passed` | `deadline` present and `< now` |
| `deadline_approaching` | `deadline` present, `>= now`, and within `approaching_hours` |
| `diligence_gap` | assigned (`officer_id` set), open, and (no attempts **or** last `attempt_at` older than `diligence_gap_days`) |
| `unassigned_near_deadline` | `officer_id` IS NULL and `deadline` within `unassigned_window_hours` |

`deadline_passed` outranks `deadline_approaching` (a job is never both). A job may carry several
conditions (e.g. `unassigned_near_deadline` + `deadline_passed`). Severity order for badges /
push priority: `deadline_passed` > `unassigned_near_deadline` > `deadline_approaching` >
`diligence_gap`.

---

## 6. Backend — `src/routes/serve.ts` (extend) + cron

Writes gated `admin/manager/supervisor` (reuse the file's local `requireRole`); reads use the
existing READ roles.

- **`GET /assignments/board?date=`** — one payload: `{ officers:[{id,name,count,attention:{...}}],
  unassigned:[job…], byOfficer:{ officerId:[job…] } }`. Counts + attention flags via the classifier.
- **`POST /assignments/assign`** — `{ job_ids:[…], officer_id:number|null, reason?:string }`;
  bulk assign / reassign / unassign (`officer_id:null`). Sets `serve_queue.officer_id` +
  `status='assigned'` when assigning (leaves served/closed untouched); writes one `activity_log`
  row per job (`serve_assignment`).
- **`GET /assignments/needs-attention?date=`** — open jobs with ≥1 condition, classified.
- **`GET /assignments/settings` / `PUT /assignments/settings`** — read/update
  `serve_nudge_settings` (gated; audited as `serve_nudge_settings`).
- **Cron sweep** — in `scheduled()` ([src/index.ts](../../../src/index.ts)), on the **4-hourly**
  trigger only (guard on `event.cron === '0 */4 * * *'` so the every-minute trigger doesn't fire it):
  1. Load settings + open jobs; classify each.
  2. For each `(job, condition)` whose `serve_nudges.last_notified_at` is null or older than
     `renotify_hours`: INSERT a `notifications` row for the assigned officer (if any) and for each
     supervisor (`role IN ('admin','manager','supervisor')`); upsert `serve_nudges`.
  3. For `deadline_passed` / due-today, also send a **supervisor email digest** via `msGraph`
     when `notify_supervisor_email=1`.
  Wrapped so a sweep failure never throws out of `scheduled()`.

---

## 7. Frontend — `ServePage.tsx`

Follows existing tokens (pure-black, gold `#d4a017`, 2px radius) and the deadline color language
from the approved mockup (rush = `#e0533d`, overdue = highlighted).

- **New "Assign" supervisor tab** (gated; hidden for plain officers) — the **Roster + jobs split**:
  left = officer roster with live load counts + attention badges + an Unassigned entry; click an
  officer → right shows their run (job cards in priority order) and the **unassigned pool** with
  per-job `[assign ▾]` + multi-select **bulk assign**. Reassign by selecting + choosing another
  officer.
- **Needs-Attention** — a badge on the Assign tab (`⚠ N overdue`), a filter/segment to show only
  flagged jobs, and per-row color-coding by condition.
- **Officer "My Run"** — tighten the existing Queue into a focused today-view from
  `/priority-queue?officer_id=<me>`: ordered jobs, quick **navigate / log attempt / mark served**,
  a served-vs-remaining progress count. (Reuses `ServeAttemptModal`, existing status writes.)
- SW `CACHE_NAME` bump.

---

## 8. Data flow

```
Supervisor opens Assign tab → GET /assignments/board?date=today
   → roster + per-officer jobs + unassigned pool (each classified)
Supervisor selects unassigned jobs → POST /assignments/assign {job_ids, officer_id}
   → serve_queue.officer_id set, status=assigned, activity_log written
Officer opens My Run → GET /priority-queue?officer_id=me → works the list

Every 4h cron → classify open jobs → for fresh (job,condition):
   notifications row(s) for officer + supervisors  [+ supervisor email if overdue]
   → serve_nudges upserted (dedup window = renotify_hours)
```

---

## 9. Error handling & edge cases

- **Assigning a closed job** (served/cancelled/failed) → rejected per-job; the bulk endpoint
  reports which ids were skipped rather than silently flipping a served job back to assigned.
- **Reassign** → `from_officer`/`to_officer` captured in `activity_log`; the new officer sees it
  in My Run, the old officer's count drops.
- **Nudge dedup** → `serve_nudges` UNIQUE(job,condition) + `renotify_hours` prevents 4-hourly spam;
  when a condition clears (job served/assigned), it simply stops being re-classified (stale
  `serve_nudges` rows are harmless and can be pruned later).
- **No deadline on a job** → deadline conditions don't fire (only diligence/unassigned can).
- **Cron isolation** → the sweep is wrapped in try/catch inside `scheduled()`; a failure can't
  break the existing warrant-poll cron or the per-minute trigger.
- **Timezone** — all comparisons in America/Denver via `datetime('now','localtime')`, matching the
  rest of the serve subsystem.

---

## 10. Testing

- **Pure `classifyServeJob`** across the matrix: each condition on/off; threshold boundaries
  (exactly at `approaching_hours`, just past `deadline`); served/cancelled excluded; multi-condition
  jobs; null-deadline; unassigned logic. No Miniflare.
- **Pure `shouldNotify(lastNotifiedAt, nowIso, renotifyHours)`** dedup decision.
- **Client:** the board assign-state reducer (select/clear/assign) + roster-count helper.
- **Smoke** the new `/assignments/*` routes in the same PR (per CLAUDE.md).
- CI: existing `pr-tests.yml` + `column-cap-check.yml` (no watched-table ALTER → passes).

---

## 11. Build milestones (for the plan)

1. Migration + `classifyServeJob` + `shouldNotify` + unit tests.
2. `/assignments/board` + `/assignments/assign` + `/assignments/settings` + audit.
3. Assign tab (Roster + jobs split) + bulk assign.
4. Needs-Attention badges/view + `/assignments/needs-attention`.
5. Cron sweep + notifications + supervisor email + dedup.

---

## 12. Project-specific implementation notes

- **Ship via PR flow** ([[feedback-use-pr-flow-not-direct-push]]): feature branch, `gh pr create`.
- **Migration number contention** — confirm the next free integer against `ls migrations/` AND open
  PRs at implementation time; rename if it collides (multiple PRs are racing `0104`/`0105`).
- **Live D1 apply** — after merge, apply the migration directly to live `785de7ae` and verify with
  `pragma_table_info`.
- **SW bump** — increment `CACHE_NAME` in `client/public/sw.js`.
- **Roles** — assignment/settings writes `admin/manager/supervisor`; reads use existing serve READ
  roles; supervisors for nudges = `role IN ('admin','manager','supervisor')`.
- **Cron guard** — gate the sweep to `event.cron === '0 */4 * * *'` so the `* * * * *` trigger
  (used elsewhere) doesn't run it 1,440×/day.

---

## 13. Roadmap context

- **Phase 1** (shipped, PR #1189): Process Service Contracts + dynamic pricing + serve→invoice billing.
- **Phase 2** (this spec): assignment console + officer run + overdue nudges.
- **Phase 3:** exceptions → dispatch CFS; patrol/serve status on the dispatch board + map; and
  **external accounting integration with Business Accounting Pro software for Rocky Mountain
  Protective Group, LLC** (push approved charges / invoices / clients / contracts / payments to the
  books of record via an idempotent, status-tracked outbound adapter).
