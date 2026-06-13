# Case Management v2 — Design

**Date:** 2026-06-13
**Status:** Approved (design decisions confirmed by owner)
**Scope:** Extend the now-functional Case Management subsystem with four cohesive feature sets, delivered as one PR with four self-contained commits.

## Context

`/cases` (`client/src/pages/CaseManagementPage.tsx` ↔ `src/routes/cases.ts`, mounted `/api/cases`) was brought to baseline functionality in PR #1210: entity linking (all 8 record types), solvability (live read + manual calc), notes, the submit→approve review workflow, status changes, CSV export, and a **client-only** timeline (calls + incidents + notes, no audit trail). The `cases` table already carries unused `deadline` / `sla_hours` / `due_date` columns. There is no investigative-task tracking and no case-to-case linking.

The live Worker serving `rmpgutah.us` is the `/src/` build (confirmed in #1210), so these changes reach users via the normal PR → `deploy.yml` flow.

## Design decisions (owner-confirmed)

1. **My Tasks / Dashboard live inside the `/cases` page** via a top-level view toggle (`Cases | My Tasks | Dashboard`). No new routes.
2. **Task permissions:** `admin/manager/supervisor/officer` create tasks and assign to **any** user (matches the existing link/unlink role set).
3. **PDF report:** **full packet** by default — every section, no toggles.

## Delivery

- **Extends the existing PR #1210 branch (`claude/wizardly-hoover-4160e9`), four added commits** (one per phase). v2 builds directly on #1210's handlers (Phase 1 logs activity from the junction/solvability code #1210 added), so it must sit on top of that work. Stacking a *separate* branch on an unmerged PR is the squash-drop hazard from past incidents; folding the phases into the same branch keeps one atomic PR with no stacking. PR #1210 is retitled to reflect the expanded "Case Management overhaul" scope. (The urgent live fix — the `/api/docs` 500 — was already resolved out-of-band by the direct D1 migration, so nothing time-sensitive is blocked by the larger PR.)
- **One migration:** `0108_case_management_v2.sql` (all three new tables, idempotent `CREATE TABLE/INDEX IF NOT EXISTS`). Applied to live D1 `785de7ae` after merge, per the project's established direct-apply pattern.
- SW `CACHE_NAME` bumped once more (v928 → v929). Worker + client typecheck/build + the full vitest suite green before updating the PR.

---

## Phase 1 — Activity Timeline & Audit *(foundational)*

**Why first:** it's a cross-cutting logging concern every other phase emits into.

### Data
`case_activity`:
| col | type | notes |
|-----|------|-------|
| id | INTEGER PK | |
| case_id | INTEGER NOT NULL | indexed |
| action | TEXT NOT NULL | machine key, e.g. `case.created`, `status.changed`, `link.added`, `note.added`, `task.created`, `review.approved` |
| actor_id | INTEGER | |
| actor_name | TEXT | denormalized for display without a join |
| detail | TEXT | JSON blob (e.g. `{"from":"open","to":"closed"}`, `{"entity":"evidence","entity_id":5}`) |
| created_at | TEXT DEFAULT datetime('now','localtime') | |

### Server
- `logCaseActivity(c, caseId, action, detail?)` helper in `cases.ts` — best-effort, wrapped in try/catch so a logging failure never breaks the mutation it records.
- Wire into: create, `status`, `submit-review`, `approve`, `calculate-solvability`, every junction link/unlink (persons + the 7 generic), note add, and Phase 2 task mutations.
- `GET /:id/activity` → `{ data: [...] }`, newest first, capped (e.g. 200).

### Client
- Timeline tab merges `case_activity` events with the existing call/incident/note-derived events into one chronological stream, each with an icon + actor + human label. A small `formatActivity(action, detail)` pure helper maps action keys → label/icon (unit-tested).

### Testing
- Pure `formatActivity` unit tests (`tests/caseActivityFormat.test.ts`).

---

## Phase 2 — Investigative Tasks & Leads

### Data
`case_tasks`:
| col | type | notes |
|-----|------|-------|
| id | INTEGER PK | |
| case_id | INTEGER NOT NULL | indexed |
| title | TEXT NOT NULL | |
| description | TEXT | |
| status | TEXT DEFAULT 'open' | `open` / `in_progress` / `done` / `canceled` |
| priority | TEXT DEFAULT 'normal' | `low` / `normal` / `high` / `urgent` |
| assignee_id | INTEGER | indexed (for My Tasks) |
| assignee_name | TEXT | denormalized |
| due_date | TEXT | date |
| created_by | INTEGER | |
| created_at / updated_at / completed_at | TEXT | `completed_at` set when status → done |

### Server (role: admin/manager/supervisor/officer for write)
- `GET /:id/tasks` — tasks for a case.
- `POST /:id/tasks` — create (title required; assignee optional → resolves `assignee_name` from `users`).
- `PUT /:id/tasks/:taskId` — update fields / status (sets `completed_at` on done).
- `DELETE /:id/tasks/:taskId`.
- `GET /tasks/mine?status=&overdue=true` — cross-case, assigned to the current user (registered before `/:id` collision concerns — distinct static prefix `/tasks`).
- A pure `taskStatusTransition`/validation helper (allowed statuses, completed_at rule) — unit-tested.
- Each mutation calls `logCaseActivity`.

### Client
- **Tasks tab** in the detail view: list (status pill, priority, assignee, due date with overdue highlight), add/edit/complete/delete via a small form + row actions.
- **My Tasks** view (top-level toggle): tasks assigned to me across all cases, overdue first, click-through to the case.

### Testing
- `tests/caseTaskRules.test.ts` (status transitions, overdue computation, completed_at).

---

## Phase 3 — Deadlines, SLA & Dashboard

### Logic
- Pure `computeSlaStatus({ opened_date, sla_hours, due_date, status, now })` → `{ state: 'on_track'|'due_soon'|'overdue'|'none', dueAt, hoursRemaining }`. Closed cases → `none`. `due_date` wins if present; else `opened_date + sla_hours`. `due_soon` threshold = within 25% of the window or 24h, whichever larger. Unit-tested thoroughly (this is the highest-value pure logic to TDD).

### Server
- Extend `GET /stats` payload with: aging buckets (`0-7`, `8-30`, `31-90`, `90+` days open), clearance rate (closed / total), counts by lead investigator, overdue count.
- `GET /?overdue=true` (or `&sla=overdue`) filter on the existing list endpoint for the attention queue.

### Client
- SLA badge (green/amber/red) on case list rows and the detail header, computed via `computeSlaStatus`.
- **Dashboard** view (top-level toggle): stat cards (open/closed/clearance/overdue), aging bar, by-investigator table — built from `/stats`, reusing existing `StatsCard`/table styles.
- **My Cases** quick filter (lead_investigator = me) + an Overdue filter on the list.

### Testing
- `tests/caseSla.test.ts` (every branch of `computeSlaStatus`).

---

## Phase 4 — Case PDF packet + Related cases

### Data
`case_links`:
| col | type | notes |
|-----|------|-------|
| id | INTEGER PK | |
| case_id | INTEGER NOT NULL | |
| related_case_id | INTEGER NOT NULL | |
| link_type | TEXT DEFAULT 'related' | `related` / `series` / `parent` / `child` |
| created_by | INTEGER | |
| created_at | TEXT | |
| UNIQUE(case_id, related_case_id) | | |

### Server
- `GET /:id/related` — related cases (join `cases` for number/title/status), both directions.
- `POST /:id/related` `{ related_case_id, link_type }` — inserts the pair (and optionally the inverse for `series`/`related`). Guards self-link + existence. Logs activity.
- `DELETE /:id/related/:relatedId`.
- Include `related` in `GET /:id/full`.

### Client
- **Related Cases** section in the Overview tab (the existing `LinkedIncidentsGraph` already reads `linked_cases`): list + link/unlink via case search.
- **Full case-report PDF**: a `caseReportPdf(caseFull, activity, tasks, related)` generator (new `client/src/utils/caseReportGenerator.ts`), client-side jsPDF, **Arial-only** (`registerArialFont` at the jsPDF site, per project rule). Sections: cover (case number/title/status/priority/dates), summary/narrative, solvability, linked records (calls, incidents, persons, vehicles, properties, evidence, warrants, citations), notes, tasks, activity log, related cases. "Export PDF" button in the detail header. All currency/number/date formatting guarded against null/NaN (per prior PDF-audit lessons).

### Testing
- `tests/caseReportData.test.ts` for any pure data-shaping helper (section ordering, empty-section omission). Canvas/jsPDF output itself is not unit-testable in jsdom (per project note).

---

## Cross-cutting & risks

- **Route ordering:** `/tasks/mine` and other static prefixes registered so they don't collide with `/:id` param routes (loop-registered static paths, as done for junctions in #1210).
- **Column-cap:** no `ALTER` on `calls_for_service`/`persons`; all new columns live in new tables — safe.
- **Live D1 apply:** after merge, apply `0108` directly to `785de7ae` and verify with `pragma_table_info`.
- **No regressions:** existing 420 tests must stay green; new pure-logic tests added per phase.

## Out of scope (YAGNI)

- Real-time task notifications / WS push (cross-device poll already exists).
- Task comments/subtasks, recurring tasks.
- Configurable SLA policies per case type (single global formula for now).
- PDF section toggles (full packet only, per decision 3).
