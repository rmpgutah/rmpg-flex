# Case Management v3 — Design

**Date:** 2026-06-13
**Status:** Approved (owner picked all four; design decisions confirmed)
**Builds on:** v2 (PR #1216, open) — uses `case_tasks`, `case_links`, `logCaseActivity`, `/stats`.

## Delivery

- **Stacks on the v2 branch.** New branch `claude/case-management-v3`; PR base = `claude/case-management-v2` so the diff shows only v3. Retarget to `main` + rebase once #1216 merges (the rebase auto-skips already-applied commits, as proven with #1210→v2).
- **Zero migrations.** Completeness is computed; task templates are typed code config; bulk actions use existing columns; saved views are localStorage; nudge dedup queries the `notifications` table.
- SW bump v929 → v930. Worker + client typecheck/build + full test suites green before push.

## Owner decisions
1. **Checklist:** built-in per-case-type defaults (typed config in code).
2. **Readiness gate:** advisory — warn + confirm on incomplete submit/close, never block.
3. **Task nudges:** notify assignee + supervisors (admin/manager/supervisor), daily-cadence cron.

---

## Phase 1 — Completeness & Readiness

**Pure logic** `src/utils/caseCompleteness.ts`:
- `CASE_CHECKLISTS: Record<caseType, ChecklistItem[]>` with a `default` fallback. Items reference computed signals: `lead_investigator`, `narrative`, `persons>=1`, `evidence>=1`, `suspect_identified`, `tasks_all_done`, `solvability_done`, etc. Each item: `{ key, label, required }`.
- `evaluateCompleteness(signals)` → `{ percent, total, met, items: {key,label,required,met}[], missing: string[] }`. Percent = met-required / total-required.
- Worker unit tests (`tests/caseCompleteness.test.ts`).

**Server** `GET /:id/completeness`: gather signals (case row fields + junction counts via the same safe per-table tallies as `/full` + a tasks tally) → `evaluateCompleteness`.

**Client:** a **Readiness** card (Overview tab) — radial %, checklist with met/unmet, missing-items list. Advisory confirm in `handleSubmitForReview` and `handleStatusChange` (when closing) if `percent < 100`: "This case is N% complete (missing: …). Proceed anyway?"

---

## Phase 2 — Task nudges & templates

**Nudge sweep** `src/utils/caseTaskNudges.ts` → `sweepCaseTaskNudges(db, env)`:
- Find active (`open`/`in_progress`) tasks with an `assignee_id` that are overdue or due within 24h.
- Dedup: skip if a `notifications` row already exists for that task (`entity_type='case_task'`, `entity_id=task.id`) within the last 20h.
- Insert notifications for assignee + supervisors (`role IN ('admin','manager','supervisor')`), priority by overdue vs due-soon. Returns count.
- Register in `src/index.ts` `scheduled()` via `ctx.waitUntil(import(...))`, mirroring `serveNudgeSweep`.

**Templates** (typed config in `src/utils/caseTaskTemplates.ts`): `CASE_TASK_TEMPLATES: Record<caseType, {title, priority}[]>` (+ `default`). 
- `POST /:id/tasks/apply-template` — inserts the case-type's standard leads (skips titles already present), logs activity.
- Client: "Apply template" button in the Tasks tab (only shown when no/few tasks).

Pure helpers (`pickTemplate`, nudge classification) unit-tested.

---

## Phase 3 — Workload & bulk actions

**Server** `POST /bulk` `{ ids: number[], action: 'status'|'assign'|'archive', value? }`:
- Role-gated (admin/manager/supervisor). Caps `ids` length (e.g. 200). Applies per-id with `logCaseActivity`. Returns `{ updated }`.
- `status` → set status (+closed_date if closed); `assign` → set lead_investigator_id (resolve name); `archive` → set archived_at.

**Client:** bulk-select checkboxes on the case list rows + a sticky bulk-action bar (Assign / Status / Archive) when ≥1 selected. Workload is already surfaced by the Dashboard's `by_investigator`; add open-vs-overdue split there if cheap.

---

## Phase 4 — Realtime & saved views

**Realtime:** a best-effort `broadcastCasesChanged(env, entity)` helper calling `broadcastAll('data_changed', { module: 'records', entity })` after case/task mutations (create/update/status/link/task). Client: add `useLiveSync('records', refresh)` on the detail (refetch `caseFull`) and My Tasks views. (Same-isolate best-effort, consistent with the existing `useLiveSync('records')` on the list.)

**Saved views:** localStorage-backed named filter presets (`client/src/utils/caseSavedViews.ts`, pure get/save/delete) — capture {search,status,type,priority,mine,overdue}; a small dropdown on the filters row to save/apply/delete. Pure helpers unit-tested.

---

## Cross-cutting
- All new endpoints role-gated like existing case handlers; bulk + apply-template log activity.
- No `ALTER` on capped tables; no migrations at all.
- Existing worker (429) + client (1025) suites stay green; new pure-logic tests per phase.

## Out of scope (YAGNI)
- Recurring tasks, task comments/subtasks.
- Server-persisted saved views / shared team views (localStorage per-user for now).
- Cross-isolate guaranteed realtime (Durable Object fan-out) — best-effort WS only.
- Admin-configurable checklists/templates (typed code config for now).
