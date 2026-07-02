# Unified Drag-and-Drop Schedule Calendar

## Context

This is the first sub-project of a broader "cross-reference / integration configuration" audit across
Dispatch, Dashboard, Schedule, Process Server, Serve Intake, and Records. A research pass found the
Schedule module's actual gap: the unified agenda backend (`/api/scheduler`, `src/routes/scheduler.ts`)
already merges four sources (`serve`, `shift`, `court`, `custom`) correctly, and every source module
already has its own write endpoints. The gap is purely in the client — [SchedulerPage.tsx](../../../client/src/pages/SchedulerPage.tsx)
renders a read-only list; editing anything requires navigating away to that source's native page.

Other gaps found in the same audit (dead `/health` endpoint on the Dashboard, duplicate
`case_person_links`/`case_persons` schema, missing `case_serve_jobs` list endpoint, missing FK on
`serve_queue.recipient_person_id`) are explicitly **out of scope** here — each is its own sub-project.

## Goal

Replace the read-only agenda list with a drag-and-drop calendar grid so schedule changes across all
four sources can be made from one screen, without navigating to each source's native page.

## Non-goals

- No new tables or migrations — every mutation this needs already exists or is a thin wrapper over an
  existing one.
- No change to how `court_events` are imported or owned — they remain externally sourced and read-only.
- No redesign of `serve_attempt_schedules` auto-replan logic (serveIntake.ts) or shift-swap workflow —
  those are untouched; the calendar only calls their existing update endpoints.
- No change to the Dashboard's `/scheduler/upcoming` consumer (`UpcomingSchedulePanel.tsx`) — it keeps
  reading the same `GET /scheduler/agenda`/`upcoming` shape.

## Architecture

### Frontend

- New dependency: `@fullcalendar/react`, `@fullcalendar/daygrid`, `@fullcalendar/timegrid`,
  `@fullcalendar/interaction` (drag-and-drop + click).
- [SchedulerPage.tsx](../../../client/src/pages/SchedulerPage.tsx) is rebuilt around a `<FullCalendar>`
  component. The existing `GET /scheduler/agenda` response shape (`AgendaItem[]`: `date`, `start`, `end`,
  `title`, `source`, `officer_id`, `status`, `link`) maps directly to FullCalendar `EventInput` — no
  backend reshaping needed.
- Existing controls (day/week/month range, source toggle chips, officer filter, "New Event" modal) carry
  over unchanged; only the list body is replaced by the calendar grid. FullCalendar's own view switcher
  (`dayGridMonth`/`timeGridWeek`/`timeGridDay`) replaces the current `[3, 7, 14, 31]` day-range buttons.
- Per-source `editable` flag on each rendered event:
  - `serve`, `shift`, `custom` → draggable.
  - `court` → `editable: false`; an `eventDrop` handler intercepted before FullCalendar mutates state
    shows a toast ("Court dates are set by the court — not editable here") and reverts.
- Click (no drag) still follows `i.link` to the native page, same as today — dragging is additive, not a
  replacement for the detail view.

### Drag behavior by source

| Source | Drag action | Endpoint called | Backend change |
|--------|-------------|------------------|-----------------|
| `serve` | Move to new date and/or officer column | `PATCH /scheduler/agenda/serve/:id/reschedule` | **New** thin wrapper (see below) |
| `shift` | Move whole plan to new date | `PUT /shift-plans/:id` `{date: newDate}` | None — existing endpoint already accepts `date` |
| `custom` | Move to new date/time and/or officer | `PATCH /scheduler/events/:id` `{event_date, start_time, end_time, officer_id}` | None — existing endpoint already accepts these fields |
| `court` | Blocked | — | — |

### New backend endpoint

`PATCH /scheduler/agenda/serve/:id/reschedule` in `src/routes/scheduler.ts`:

- Body: `{ scheduled_date: 'YYYY-MM-DD', officer_id?: number }`.
- Validates `scheduled_date` with the existing `isoDate()` helper; 400 on invalid/missing.
- Role-gated with the existing `WRITE` set (`admin|manager|supervisor|officer|dispatcher`).
- Wraps the same `UPDATE serve_attempt_schedules SET scheduled_date = ?, officer_id = COALESCE(?,
  officer_id), manually_moved = 1 WHERE id = ?` pattern already used at
  [serveIntake.ts:1528](../../../src/routes/serveIntake.ts#L1528) — setting `manually_moved = 1` is
  required so the existing auto-replan sweep (serveIntake.ts:1807) does not silently move it back.
- Returns the updated row (same shape `collectAgenda()` reads), so the client can patch local state
  without a full agenda refetch.

### Optimistic update + failure handling

- On `eventDrop`, apply the move to local calendar state immediately, then fire the mutation.
- On non-2xx response, call FullCalendar's `revert()` (provided by the drop event) and show a toast with
  the server's error message.
- No new tables; no migration required for this sub-project.

## Testing

- `src/routes/scheduler.ts`: no existing Worker test suite for this router — add a smoke test alongside
  the new endpoint per CLAUDE.md's "prefer adding a smoke test in the same PR when adding a new route"
  guidance (Miniflare, `test-workers/`).
- Client: manual verification via `preview_*` tools — drag a serve item to a new date, a shift plan to a
  new date, a custom event to a new time; confirm a court event refuses to drop; confirm reverts on a
  simulated 403 (wrong role).

## Rollout

- Single PR: migration-free, one new backend endpoint, client dependency bump, `SchedulerPage.tsx`
  rewrite. Follows the standard branch → PR → `pr-tests.yml` → merge → `deploy.yml` flow (no direct
  push to main).
