# Shift Plans — Notification Engine Integration (Sub-project 1 of 4)

**Status:** Approved for implementation
**Date:** 2026-08-08
**Author:** Claude (session with Christopher Zamora)

## Context

Shift Plans (`src/routes/shiftPlans.ts`, `client/src/pages/ShiftPlansPage.tsx`) has
grown a rich feature set — CRUD, swap requests, overtime tracking, staffing-level
minimums, conflict detection, templates, CSV/PDF export — but its "notifications"
(`GET /shift-notifications`) are entirely ephemeral: computed fresh on every page
load and rendered as a banner. An officer who isn't looking at the Shift Plans page
right now never finds out their swap was approved, or that tomorrow's graveyard
shift has no coverage.

This is sub-project 1 of a 4-part program on Shift Plans (order: **comms
integration → approval workflow → auto-scheduling → calendar sync**). This spec
covers comms integration only.

**Explicitly out of scope:** external email/SMS. No such adapter exists anywhere
in this codebase today (no Twilio/SendGrid/etc. client). Wiring one in is a
separate, larger integration (new secrets, new provider, its own design) and
should be proposed as a future sub-project once a provider is chosen — Cloudflare
Email Service is available as a skill and is the natural first candidate.

## Goal

Wire real shift-plan events into the existing in-app notification infrastructure
(`notification_rules` table + `src/routes/notificationEngine.ts`) — the same
engine dispatch, warrants, Fleet.io, and fleet-maintenance reminders already use.
This gets shift-plan alerts into the persistent `notifications` table, the
notification bell, and the live AlertHub push, with zero new services.

## Events

1. `shift_swap_requested` — fired when an officer submits a swap request.
   Targets: `admin`, `manager`, `supervisor` (role-based, static — these are the
   only roles that can approve/deny per the existing `PUT /shift-swaps/:id`
   role gate).
2. `shift_swap_approved` / `shift_swap_denied` — fired when a supervisor resolves
   a swap request. Targets: the requester (`requester_id`), plus the named
   target officer (`target_id`) if one was specified. **Dynamic per-event** —
   see Engine Change below.
3. `shift_understaffed` — fired by a daily sweep for any of the next 7 days
   where an active shift's assignment count is below its configured minimum.
   Targets: `admin`, `manager`, `supervisor`, `dispatcher` (mirrors the existing
   `requireRole` gate on `/staffing-levels`).
4. `shift_no_active_plan` — fired by the same daily sweep for any of the next 7
   days with zero active shift plan. Same targets as #3.

Overtime-threshold notifications are explicitly excluded from this sub-project
(informational, not time-sensitive like the above four — can be added later by
seeding one more rule + one more sweep check, no architecture change needed).

## Engine change: dynamic per-event targets

`evaluateNotificationRules` / `fireRule` in `notificationEngine.ts` currently
resolve notification targets ONLY from the rule row's static `target_roles` /
`target_user_ids` columns — there's no way for a caller to say "also notify this
specific person," which `shift_swap_approved`/`shift_swap_denied` needs (the
requester is different every time; it can't be baked into a rule).

**Change:** add an optional `dynamicUserIds?: number[]` parameter to both
functions. `fireRule` unions it with the rule's statically-resolved targets
(deduped via the same `Set<number>` pattern `resolveTargets` already uses) before
inserting notification rows and emitting the AlertHub frame. Fully
backward-compatible — every existing caller omits the new param and behavior is
unchanged.

```ts
export async function evaluateNotificationRules(
  db: D1Database,
  triggerEvent: string,
  context: NotifyContext = {},
  env?: { ALERT_HUB?: DurableObjectNamespace },
  dynamicUserIds?: number[],
): Promise<{ rulesMatched: number; notified: number }>
```

This is a small, reusable fix — any future event with a per-instance recipient
(e.g. a future time-off approval) gets the same capability for free.

## Call sites

### `POST /shift-swaps` (src/routes/shiftPlans.ts)

After the existing `INSERT INTO shift_swap_requests`, call:

```ts
await evaluateNotificationRules(db, 'shift_swap_requested', {
  title: 'Shift swap requested',
  message: `${user.full_name ?? 'An officer'} requested a swap for ${body.shift_date}`,
  priority: 'normal',
  entity_type: 'shift_swap_request',
  entity_id: r.meta.last_row_id,
}, c.env);
```
Best-effort — wrapped so a notification failure never fails the swap-request
response (matches the engine's own "never throws" contract, but the call site
itself should still `.catch()` defensively since `c.env` might lack `ALERT_HUB`
in tests).

### `PUT /shift-swaps/:id` (src/routes/shiftPlans.ts)

After the existing status UPDATE, look up `requester_id`/`target_id` from the
row (already fetched or a cheap follow-up `SELECT`), then:

```ts
const dynamicTargets = [swap.requester_id, swap.target_id].filter((x): x is number => typeof x === 'number');
await evaluateNotificationRules(db, `shift_swap_${body.status}`, {
  title: body.status === 'approved' ? 'Shift swap approved' : 'Shift swap denied',
  message: `Your swap request for ${swap.shift_date} was ${body.status}`,
  priority: 'normal',
  entity_type: 'shift_swap_request',
  entity_id: id,
}, c.env, dynamicTargets);
```

### Daily sweep — `src/utils/shiftPlanNotifySweep.ts` (new file)

Same shape as `sweepFleetMaintenanceReminders`/`sweepCertExpirations`:

```ts
export async function sweepShiftPlanNotifications(
  db: D1Database,
  env: { ALERT_HUB?: DurableObjectNamespace },
): Promise<{ understaffed: number; noPlan: number; notified: number }>
```

For each of the next 7 Denver-local dates: reuse the exact logic already in
`GET /staffing-levels` (minimums `{day:2, swing:2, graveyard:1}`) and
`GET /shift-notifications` (no-active-plan check) to compute the same two
conditions, but instead of returning them as a response, call
`evaluateNotificationRules` once per matching date/condition. Wrapped in its own
try/catch (per the codebase's cron convention) so a sweep failure never breaks
the rest of the cron tick.

**Hook into `src/index.ts`:** add a call inside the existing
`if (denverHour === 4 && denverMinute === 0)` block, alongside
`sweepFleetMaintenanceReminders`/`sweepCertExpirations` — same
`ctx.waitUntil(...).catch(() => {})` pattern, same `console.log` summary line.

## Default notification rules (migration)

Following the precedent set by `0203_fleetio_health_alert_rules.sql` (seeding
default rules so an alert works without manual admin setup, rather than the
"no-op until an admin configures a rule" pattern used for
`fleet_maintenance_due`/`certification_expiring`): these four events are
safety/accountability-relevant enough to ship active by default. New migration
`0228_shift_plan_notification_rules.sql`, idempotent via `WHERE NOT EXISTS` on
`trigger_event` (matching the Fleet.io migration exactly, since
`notification_rules` has no unique index on that column):

| trigger_event | target_roles | notification_type | is_active |
|---|---|---|---|
| `shift_swap_requested` | `["admin","manager","supervisor"]` | `in_app` | 1 |
| `shift_swap_approved` | `[]` (dynamic only) | `in_app` | 1 |
| `shift_swap_denied` | `[]` (dynamic only) | `in_app` | 1 |
| `shift_understaffed` | `["admin","manager","supervisor","dispatcher"]` | `in_app` | 1 |
| `shift_no_active_plan` | `["admin","manager","supervisor","dispatcher"]` | `in_app` | 1 |

An admin can edit or disable any of these five afterward from Admin → Alert
Rules like any other rule — nothing here is hardcoded outside the seed.

⚠️ Per CLAUDE.md: apply this migration to live D1 (`785de7ae`) via
`scripts/apply-migration.sh` after merge — deploy's migration step is
`continue-on-error`.

## Client changes

None required for this sub-project. The existing `GET /shift-notifications`
banner and the `ShiftPlansPage` swap/staffing panels keep working exactly as
they do today — this spec adds a second, persistent delivery path
(bell/AlertHub), it doesn't replace the in-page ephemeral view. A future pass
could de-duplicate by having the page read from the real `notifications` table
instead of recomputing, but that's not needed for comms to work and is left
alone to keep this change small.

## Testing

- `tests/` (Node/Vitest): unit test for the `dynamicUserIds` merge in
  `notificationEngine.ts` (dedup with static targets, empty-array no-op,
  backward-compat with no 5th arg).
- `tests/` : unit test for `sweepShiftPlanNotifications` — understaffed
  detection, no-active-plan detection, both against a fake D1/miniflare DB,
  confirming it fires once per matching date (not once per matching shift-type
  row) to avoid the exact multi-fire-per-tick bug the 04:00 gate comment in
  `src/index.ts` already warns about.
- `test-workers/` (Miniflare): smoke test that `POST /shift-swaps` and
  `PUT /shift-swaps/:id` still 2xx and don't throw when `ALERT_HUB` is unbound
  (mirrors the existing "best-effort" contract other integrations rely on).
- Manual: after deploy, submit a real swap request as a non-admin test user,
  approve it as admin, confirm both users see the notification in the bell.

## Migration numbering

Current high-water is `0227`. This sub-project uses `0228`.
