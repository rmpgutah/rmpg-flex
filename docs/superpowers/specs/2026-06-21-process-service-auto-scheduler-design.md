# Process Service Auto-Scheduler — Advanced Calendar + Smart Algorithm

**Date:** 2026-06-21
**Status:** Design approved → implementation plan pending
**Scope:** ~3-4 PRs, one D1 migration

## Goal

Turn the existing intake-time attempt planner into a calendar-driven scheduling
surface visible from the dashboard, with manual drag-to-reschedule, geographic
clustering, automatic re-planning after failed attempts, and deadline-aware
urgency tiers.

## What's already built (do not rebuild)

- `serve_queue`, `serve_attempts`, `serve_attempt_schedules`, `serve_routes`,
  `serve_nudges` D1 tables
- `serveDiligencePlanner.ts::planAttemptWindows()` — pure function that turns
  (now, deadline, location-note constraints) into 3 dated attempt windows
- `serveAttemptScheduler.ts::persistAttemptSchedule()` — writes the windows
  with `notify_at` chosen randomly 30 min – 6 h before the window
- `GET /serve-intake/schedule` — 14-day forward feed grouped by date
- `ServeAttemptCalendar.tsx` — vertical list-by-day view, lives on
  `ServeIntakePage` "schedule" tab
- Per-minute cron drives `notify_at` push notifications to dispatch
- `serve_nudges` table + settings — dedupe escalation alerts

This work extends those pieces. The existing pure planner stays as the base
layer; new pure functions wrap or follow it.

## Scope

### In
- True calendar grid on the Dashboard (week timeline default, month toggle)
- Drag-to-reschedule on the calendar (dashboard panel + full page)
- Geographic co-location of nearby attempts on the same officer's day
- Auto-replan after failed attempt (`no_answer | refused | bad_address | moved`)
- Court-deadline-aware urgency tiers + auto-promotion of `priority` field
- Full-page scheduler at `/serve-intake/scheduler` with multi-officer swim lanes,
  unassigned-queue sidebar, batch rebalance with preview

### Out
- Multi-officer swim lanes on the dashboard panel (full-page only)
- True TSP / route optimization — existing `ServeRoutePlanner` handles intra-day
  routing once papers are picked; do not duplicate
- Native iOS scheduler — Phase 2 (the iOS app gets its own simplified slot view
  via `LiveCounts`)
- ServeManager integration sync — separate program
- Recurring service patterns (e.g. weekly attempts) — not in real-world use

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ CLIENT (React)                                                   │
│                                                                  │
│  DashboardPage                                                   │
│    └─ ServeSchedulerPanel (NEW) week-timeline + month toggle    │
│                                                                  │
│  /serve-intake/scheduler  (NEW page route)                       │
│    └─ ServeSchedulerPage  full-page batch + officer swim lanes  │
│                                                                  │
│  components/scheduler/WeekTimeline.tsx        (NEW)              │
│  components/scheduler/MonthGrid.tsx           (NEW)              │
│  components/scheduler/AttemptChip.tsx         (NEW)              │
│  components/scheduler/dnd.ts          (NEW, pure drag math)      │
│  utils/schedulerView.ts               (NEW, pure)                │
│      groupByDay() / groupByHour() / fitsInWindow() /             │
│      snapToBand()                                                │
└─────────────────────────────────────────────────────────────────┘
                          │ apiFetch
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ WORKER (Hono)                                                    │
│                                                                  │
│  src/routes/serveIntake.ts   (extended)                          │
│    GET    /serve-intake/schedule         (existing, expanded)    │
│    PATCH  /serve-intake/schedule/:id     (NEW reschedule)        │
│    POST   /serve-intake/schedule/rebalance (NEW bulk replan)     │
│    POST   /serve-intake/queue/:id/attempts (existing, hooks      │
│           the new auto-replanner)                                │
│                                                                  │
│  src/utils/serveDiligencePlanner.ts  (extended, pure)            │
│    planAttemptWindows()         (existing)                       │
│    clusterByProximity()         (NEW)                            │
│    replanAfterFailedAttempt()   (NEW)                            │
│    applyUrgencyTier()           (NEW)                            │
│                                                                  │
│  src/utils/serveAttemptScheduler.ts  (extended)                  │
│    persistAttemptSchedule()     (existing)                       │
│    moveScheduleSlot()           (NEW)                            │
│    replaceUpcomingSlots()       (NEW, respects manually_moved)   │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ D1                                                               │
│  serve_attempt_schedules    (+ 5 columns via migration 0140)     │
│  serve_queue                (+ 3 columns)                        │
└─────────────────────────────────────────────────────────────────┘
```

**Layering rule:** all algorithm code is pure (no D1, no `Date.now`, no `fetch`).
Routes call them and persist. UI components are dumb — they render whatever
`schedulerView.ts` shapes for them. Matches the project's
[`themeSchedule.ts`](../../client/src/utils/themeSchedule.ts) /
[`planAttemptWindows`](../../src/utils/serveDiligencePlanner.ts) pattern.

## Schema delta — migration `0140_serve_scheduler_advanced.sql`

```sql
ALTER TABLE serve_attempt_schedules ADD COLUMN manually_moved      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE serve_attempt_schedules ADD COLUMN moved_by_user_id    INTEGER;
ALTER TABLE serve_attempt_schedules ADD COLUMN moved_at            TEXT;
ALTER TABLE serve_attempt_schedules ADD COLUMN auto_replan_source  INTEGER;
                                              -- serve_attempts.id that triggered replan
ALTER TABLE serve_attempt_schedules ADD COLUMN officer_id          INTEGER;
                                              -- snapshot at slot time (queue.officer_id is mutable)

CREATE INDEX IF NOT EXISTS idx_sas_date_officer
  ON serve_attempt_schedules(scheduled_date, officer_id);

ALTER TABLE serve_queue ADD COLUMN geo_cluster_id       TEXT;
                                              -- 'g-{lat3}-{lng3}' or 'z-{zip5}'
ALTER TABLE serve_queue ADD COLUMN urgency_tier         TEXT;
                                              -- 'standard'|'tight'|'critical' — derived
ALTER TABLE serve_queue ADD COLUMN urgency_computed_at  TEXT;

CREATE INDEX IF NOT EXISTS idx_serve_queue_cluster
  ON serve_queue(geo_cluster_id, status);
CREATE INDEX IF NOT EXISTS idx_serve_queue_urgency
  ON serve_queue(urgency_tier, deadline);
```

**Decisions:**

| Column | Rationale |
|---|---|
| `manually_moved` | Auto-replanner / daily rebalance must respect operator overrides — without it, the cron sweep would obliterate dispatch's drag-drop |
| `auto_replan_source` (FK→`serve_attempts.id`) | Lineage for "why is this slot here?" — drawer shows "auto-replanned after attempt #2 (no_answer)" |
| `officer_id` snapshot on slot | `serve_queue.officer_id` can change after schedule is built (reassignment); slot needs to remember who it was for at planning time |
| `geo_cluster_id` as TEXT (not INTEGER) | Two clustering bases: 3-decimal lat/lng truncation (~110 m cell) preferred, ZIP fallback. TEXT keeps both. No H3 library dep — `'g-{lat3}-{lng3}'` is sufficient for "same neighborhood" |
| `urgency_tier` derived, not authoritative | Source of truth stays `priority` + `deadline`. Tier is a cached derivation refreshed by the rebalance cron so the calendar can sort/color without recomputing per query |
| Index on `(scheduled_date, officer_id)` | Hot path: week timeline queries "next 7 days, all officers" |

**Deploy gotcha** ([CLAUDE.md gotcha #5](../../CLAUDE.md)): `ALTER ADD COLUMN` is
not idempotent in D1. Two defenses:
1. Route layer uses `columnExists()` reconciler at boot (same as
   [`alpr.ts`](../../src/routes/alpr.ts))
2. **Manual post-merge step**: apply `0140` directly to live D1
   `785de7ae` via Cloudflare API, verify with
   `pragma_table_info('serve_attempt_schedules')` and `pragma_table_info('serve_queue')`

## Algorithm upgrades (pure functions in `serveDiligencePlanner.ts`)

### `clusterByProximity(lat, lng, zip) → string | null`

```ts
// 3-decimal lat/lng truncation ≈ 110 m cell. Two papers in the same
// building share a cluster; two in different ZIPs do not.
// Falls back to ZIP when lat/lng is missing.
export function clusterByProximity(
  lat: number | null,
  lng: number | null,
  zip: string | null,
): string | null {
  if (lat != null && lng != null) {
    return `g-${lat.toFixed(3)}-${lng.toFixed(3)}`;
  }
  return zip ? `z-${zip.slice(0, 5)}` : null;
}
```

**Effect on scheduling:** at intake, after `planAttemptWindows()` produces
windows, a follow-up pass `groupClusterPeers(officerId, date, windows)` looks
for other pending papers in the same `geo_cluster_id` on the same officer +
same date and **co-locates** them in the same window when there's room. **Soft
cap: 4 papers per window per officer.** Anything past that bleeds into the next
window.

This is intentionally not a TSP solver — the existing `ServeRoutePlanner`
component does intra-day optimization once the day's papers are picked.

### `replanAfterFailedAttempt(failedAttempt, queueRow, tz) → AttemptWindow | null`

Triggered from `POST /serve-intake/queue/:id/attempts` when result is
`no_answer | refused | bad_address | moved`. Returns a single new
`AttemptWindow` that:

1. Starts **at least 24 h** after the failed attempt (no same-day retry)
2. Uses a **different time-of-day band** than the failed attempt
   (failed AM → next is PM or evening, etc.) — diligence doctrine
3. Respects business hours / location-note constraints from the queue row
4. Honors deadline — pulls in if `days_until_deadline ≤ remaining_attempts`
5. Returns `null` if `max_attempts` already exhausted (caller marks
   `serve_queue.status='failed'`)

**Where it hooks:** the existing attempts route logs the attempt and updates
`attempt_count`. We add one step after: if result is in the retry set AND
`attempt_count < max_attempts`, call `replanAfterFailedAttempt()` and insert a
new row into `serve_attempt_schedules` with `auto_replan_source` = the new
attempt's id.

**Bad address / moved exception:** when result is `bad_address` or `moved`, we
still create the replan slot but:
- Set `serve_queue.status='in_progress'` with a `needs_skip_trace` flag (a
  `notes` field annotation — no new column)
- Write a `serve_nudges` row with `condition='address_unknown'`
- The new slot renders with a `⚠ address unknown` overlay until skip trace
  completes

### `applyUrgencyTier(deadline, attemptCount, maxAttempts, nowIso) → 'critical' | 'tight' | 'standard'`

```ts
// critical : deadline ≤ 2 days away OR < remaining_attempts
// tight    : 3–5 days away
// standard : > 5 days, or no deadline
```

**What it controls:**

1. **Calendar color/badge** — `critical=red`, `tight=amber`, `standard=blue`
   (using the project's CSS-variable-backed Tailwind tokens `red-*`/`amber-*`/`blue-*`
   that re-theme between night and day, not hardcoded hex)
2. **Sort order** — `critical` floats to the top of each day column on dashboard
   and the unassigned-queue sidebar on full-page
3. **Auto-escalation** — when tier flips to `critical`, the planner sets
   `serve_queue.priority='rush'` (**one-way ratchet** — never demotes a
   manually-set `urgent`)
4. **Slot reshuffling** — when a new `critical` paper arrives, the rebalance
   pass may re-plan any **non-`manually_moved`** slot to make room for an early
   window

**Two trigger sites:**
- At intake commit (one-shot for the new paper)
- Daily 04:00 Denver cron sweep (rebalance all `pending`/`assigned` papers —
  catches the case where today's tier flipped because a calendar day elapsed
  without service). Runs when the existing per-minute cron sees
  `UTC hour=10 AND minute=0`. DST drift of 1 h is accepted — rebalance is not
  time-critical.

## API surface (`/api/serve-intake/*`)

### `GET /serve-intake/schedule` — extended

| Query param | Default | Behavior |
|---|---|---|
| `start_date` | today (Denver) | `YYYY-MM-DD` lower bound |
| `end_date` | start + 14d | `YYYY-MM-DD` upper bound — supports month view (~31d) |
| `officer_id` | unset | filter to one officer (full-page scheduler tab) |
| `include` | unset | comma list: `tier`, `cluster`, `attempts` |

Response shape adds (always): `officer_id`, `manually_moved`,
`auto_replan_source`. With `include=tier`: `urgency_tier`. With
`include=cluster`: `geo_cluster_id`, `cluster_peer_count`. With
`include=attempts`: `prior_attempts[]`.

### `PATCH /serve-intake/schedule/:slotId` — NEW (drag-drop)

```ts
Body: {
  scheduled_date?: string;   // YYYY-MM-DD (Denver)
  window_start?: string;     // HH:MM
  window_end?: string;       // HH:MM
  officer_id?: number | null;
  reason?: string;           // free text — written to audit_log
}
Headers: {
  If-Unmodified-Since: <slot.updated_at>  // optimistic concurrency
}
Response:
  200 { slot: ScheduleSlot }
  | 409 { error: 'stale' | 'overlap', current?: ScheduleSlot, conflicts?: ScheduleSlot[] }
  | 404
```

**Behavior:**
1. Stale check: if the row's `updated_at` advanced beyond the header value,
   return `409 { error: 'stale', current: <slot> }`.
2. Overlap check: convert proposed window to ISO range; query for any other
   slot on `(officer_id, scheduled_date)` with overlapping `(window_start,
   window_end)`. If found, return `409 { error: 'overlap', conflicts }`.
3. Client may retry with `?force=1` to bypass overlap — writes an
   `audit_log` entry `serve_schedule.force_overlap` so supervisors can see
   when overlapping became a habit.
4. On success: set `manually_moved=1`, `moved_by_user_id`, `moved_at`,
   `updated_at`. Recompute `notify_at` (random 30 min – 6 h before new
   window). Reset `notified=0`. Write `audit_log` via the central
   `recordAudit()` seam. Broadcast `slot_changed` on WS topic `serve-schedule`.
5. If `officer_id` changed, also update `serve_queue.officer_id`.

### `POST /serve-intake/schedule/rebalance` — NEW (full-page batch button)

Admin/dispatcher only. Triggers the same cron-driven rebalance pass on demand
for a specific date range.

```ts
Body: { start_date: string; end_date: string; dry_run?: boolean }
Response: {
  changed: Array<{ slot_id: number; from: SlotSummary; to: SlotSummary;
                   reason: 'cluster_co_location' | 'urgency_promotion' |
                           'overload_redistribution' }>;
  skipped_manual: number;
  geo_co_located: number;
  urgency_promoted: number;
}
```

`dry_run=true` shows what would change without writing — for the
"Preview rebalance" button. Otherwise applies and broadcasts via realtime.

### `POST /serve-intake/queue/:id/attempts` — existing, hook added

No signature change. Adds an after-step: if result is in the retry set AND
`attempt_count < max_attempts`, call `replanAfterFailedAttempt()` and persist
a new schedule row with `auto_replan_source` set. Response gains:

```ts
{ ...existing fields, replan?: { slot_id, scheduled_date, window } }
```

### Authorization

| Endpoint | Roles allowed |
|---|---|
| `GET /schedule` | any authenticated user (RLS by officer for `officer` role) |
| `PATCH /schedule/:id` | `dispatcher`, `supervisor`, `manager`, `admin` |
| `POST /rebalance` | `supervisor`, `manager`, `admin` |
| `POST /queue/:id/attempts` (existing) | unchanged |

### Realtime broadcast

After `PATCH /schedule/:slotId`, cron rebalance changes, and auto-replan
inserts, broadcast on `/api/ws` topic `serve-schedule`:

```ts
{ type: 'slot_changed', slot_id, queue_id, scheduled_date, window_start,
  officer_id, updated_at }
```

Dashboard panel and full-page scheduler both subscribe.

## UI — Dashboard panel (`ServeSchedulerPanel`)

### Layout (large panel, full row)

```
┌─ SERVE SCHEDULER ──────────────────── [Week] [Month]  [Open scheduler ↗] ┐
│                                                                          │
│         Sat 21   Sun 22   Mon 23   Tue 24   Wed 25   Thu 26   Fri 27    │
│         ─────────────────────────────────────────────────────────────    │
│  06:00                                                                  │
│  08:00          ┌────────┐                                              │
│  10:00          │J.SMITH │ ┌────────┐                                   │
│                 │summons │ │WALSH   │                                   │
│  12:00          └────────┘ │subpoena│                                   │
│  14:00 ┌─────┐             └────────┘ ┌─────────┐                       │
│        │MARTI│                        │CRITICAL │                       │
│  16:00 │eviction                      │R.JONES  │                       │
│        └─────┘                        │ deadline│                       │
│  18:00                                │ in 1d   │                       │
│  20:00 ┌─────┐ ┌─────┐                └─────────┘                       │
│        │+3   │ │PEREZ│                                                  │
│  22:00 └─────┘ └─────┘                                                  │
│                                                                          │
│  Today (Sat 21):  4 attempts • 2 unassigned • 1 critical                │
└──────────────────────────────────────────────────────────────────────────┘
```

### Visual rules (Spillman tokens, day/night-safe)

| Element | Token / value |
|---|---|
| Panel chrome | `<SpmGroup title="SERVE SCHEDULER">` — matches existing dashboard |
| Day column header | `bg-surface-raised text-rmpg-200`, sticky on scroll |
| Hour row gridlines | `border-rmpg-700`, 1 px, **2-hour bands so 06–22 fits** |
| Chip — standard | `bg-blue-700/30 border-l-2 border-blue-400 text-blue-100` |
| Chip — tight | `bg-amber-700/30 border-l-2 border-amber-400` |
| Chip — critical | `bg-red-700/30 border-l-2 border-red-500`, slow pulse |
| Manually-moved badge | `<Pin size={8}>` in the chip corner |
| Cluster co-location | `×N` counter when a chip represents N stacked papers |
| Drop hover target | `outline outline-1 outline-brand-400 bg-brand-400/10` |
| Past-due | `opacity-50` + struck-through time |

Brand gold (`#d4a017`, the `brand-500` token) is reserved for "Today" column
highlight only; chips inherit their tier color.

### Chip contents (density by chip height)

- **≥90 min slot:** recipient surname, document type icon, time range,
  case# truncated
- **60–90 min slot:** surname + icon only
- **<60 min slot:** icon only — full info on hover/tap

### Interactions

| Gesture | Behavior |
|---|---|
| Drag chip to different `(day, hour band)` | Optimistic UI update → `PATCH` → on 409 conflict, snap back + toast "Officer X already has N attempts in this window — drag anyway? [Force move]" |
| Drag chip to a day header (not a band) | Auto-pick same window-of-day shape from the diligence playbook (residential evening, business mid-morning, etc.) |
| Click empty cell | "+ Schedule attempt" popover — search-pick a `serve_queue` item, snap to band |
| Cmd/Ctrl+Z | Undo last move (one-deep — re-issues the inverse PATCH) |
| Right-click chip | Quick-action menu: Reassign / Skip / Open / Mark attempted now / Reset to auto |
| Cmd/Ctrl+scroll | Zoom day-column width (3-day ↔ 7-day ↔ 10-day) |
| Click chip | Side drawer with full slot details, prior attempts, audit history |

### Density & overflow

- More than 6 chips per day visible → collapse the bottom into `+N more` pill
  that expands the column.

### Loading & realtime

- Skeleton chips on first paint (panel doesn't block other dashboard panels)
- Subscribe to `serve-schedule` WS topic on mount; on `slot_changed` event
  for a visible date, patch the local state in place — no full refetch
- Reconnect handler: refetch the visible date window when the socket comes
  back from a network blip

### Top-right toolbar

- `[Week] [Month]` segmented control — **Week is default**
- `[Open scheduler ↗]` → navigates to `/serve-intake/scheduler`
- `[Filter]` chip — filter by officer / priority / status (state in
  `localStorage` key `rmpg_scheduler_filter`)

### Bottom status strip

`Today (Sat 21): 4 attempts • 2 unassigned • 1 critical` — pulls from
`GET /schedule?include=tier` aggregates. Critical count gets a red dot when >0.

### Patrol view

The `'patrol'` dashboard view does NOT include this panel — too dense for
phone. Patrol gets the existing `myActivity` panel which already shows their
assigned slots inline. iOS app gets a phase-2 native variant (not in scope).

### Dashboard view config delta

Add `'serveSchedule'` to `PanelId` and `VIEW_PANELS`:
- `dispatch`: append `'serveSchedule'`
- `admin`: append `'serveSchedule'`
- `patrol`: do NOT include

## UI — Full-page scheduler (`/serve-intake/scheduler`)

When the dashboard panel isn't enough — batch operations, multi-day
reassignments, rebalance previews.

### Layout

```
┌─ SERVE SCHEDULER — FULL ──────────────────────────────[Back to dashboard]┐
│ ┌─ Filters ──────────────────────────────────────────────────────┐       │
│ │ Officer: [All ▾]  Priority: [All ▾]  Status: [Active ▾]  ☐Mine │       │
│ └────────────────────────────────────────────────────────────────┘       │
│ ┌─ Range  [‹] [Jun 22 – Jul 19] [›]   View: [Week] [2-Week] [Month] ─┐   │
│ └────────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌─ Unassigned Queue ────┐ ┌─ Calendar grid (multi-officer mode) ──────┐ │
│  │ ▣ R.JONES eviction    │ │       Mon 23     Tue 24     Wed 25  ...   │ │
│  │   case 240-0301       │ │ ─── Ofc Park ───────────────────────────  │ │
│  │   deadline 1d ▲       │ │       J.SMITH   WALSH                     │ │
│  │ ▣ J.SMITH summons     │ │       PEREZ                               │ │
│  │   case 240-0119       │ │ ─── Ofc Chen ───────────────────────────  │ │
│  │   deadline 6d         │ │       MARTI    RAY ▲critical              │ │
│  │ ▣ M.PEREZ subpoena    │ │       JONES                               │ │
│  │   case 240-0223       │ │ ─── Unassigned ─────────────────────────  │ │
│  │   deadline 12d        │ │       (drop here to clear assignment)     │ │
│  │ ▣ 12 more …            │ └───────────────────────────────────────────┘ │
│  └────────────────────────┘                                              │
│                                                                          │
│  ┌─ Actions ───────────────────────────────────────────────────┐         │
│  │ [Preview Rebalance]  [Apply Rebalance]  [Auto-cluster nearby]│         │
│  └─────────────────────────────────────────────────────────────┘         │
└──────────────────────────────────────────────────────────────────────────┘
```

### What it adds beyond the dashboard panel

1. **Multi-officer swim lanes** — each officer gets a horizontal lane within
   each day column. Drag a chip between lanes = reassign officer (calls
   `PATCH /schedule/:id` with `officer_id`).
2. **Unassigned Queue sidebar** — `serve_queue` rows where `officer_id IS NULL`
   AND `status IN ('pending','assigned')`. Drag from sidebar onto a calendar
   cell = assign + schedule in one gesture. **Default sort: `deadline ASC
   NULLS LAST, urgency_tier`** (tier is derived from deadline anyway, so
   sorting by deadline first is more direct).
3. **Range picker** — Week / 2-Week / Month. Larger ranges fetch with
   `?include=tier` only (skip `cluster`/`attempts`) so wire size stays small.
   State persists in `localStorage` key `rmpg_scheduler_range`.
4. **Rebalance preview/apply** —
   - `[Preview Rebalance]` → `POST /schedule/rebalance` with `dry_run=true`.
     Modal shows diff:
     ```
     Auto-rebalance proposal (Jun 22 – Jul 19)
     ─────────────────────────────────────────
       12 slots co-located by neighborhood
       3 urgency tiers promoted to critical
       1 slot would move (Officer Park overloaded Wed)
       7 manually-moved slots skipped (locked)
       [Cancel] [Apply changes]
     ```
   - `[Apply Rebalance]` = same call with `dry_run=false`. Realtime broadcasts.
5. **Auto-cluster nearby** — select one chip → button suggests other
   unscheduled papers in the same `geo_cluster_id` and offers to co-locate
   them in the selected slot's window (up to the 4-per-window cap). One
   click, plural assignment.
6. **Bulk selection** — Shift-click chips to multi-select, then drag the group
   or apply group actions (reassign all to officer X, cancel all). Useful
   when reshuffling a sick officer's load.
7. **Audit trail in side drawer** — chip click drawer shows full history:
   `created at intake → moved by Chris @14:22 (reason: 'recipient travels')
   → auto-replanned after attempt #2 (no_answer)`. Reads from `audit_log`
   filtered to `entity_type='serve_schedule_slot' + entity_id`.

### Routing

- New route entry in `client/src/App.tsx` → `/serve-intake/scheduler`
  lazy-loaded
- Sidebar nav (`Sidebar.tsx`) gets "Scheduler" under the existing
  "Process Service" group, with badge showing today's critical count (poll
  every 60 s)
- "Open scheduler ↗" button on dashboard panel deep-links here

### Permissions

- Officers (role `officer`) → read-only single-lane view of own slots only
- Dispatchers / supervisors / managers / admins → full drag-drop multi-officer
- Rebalance buttons gated on `supervisor+`

### State management

Match the existing pattern: a single `useScheduleData(range, filters)` hook
with refetch on WS event. The project uses plain `apiFetch` + local React
state (see `useApi.ts`), not TanStack Query — stay consistent.

## Error handling & edge cases

### Concurrent edits (two dispatchers, same slot)

- `PATCH /schedule/:slotId` reads the row's `updated_at` before writing
- Client sends `If-Unmodified-Since: <updated_at>` header from the slot it has loaded
- If the row's `updated_at` advanced, return `409 { error: 'stale', current: <slot> }`
- Client refreshes that one slot in place and shows toast
- Realtime broadcast carries new `updated_at` so the second dispatcher's chip updates *before* they drag

### Window overlap on same officer

- Overlap check inside `PATCH` after timezone normalization
- Query: `serve_attempt_schedules WHERE officer_id = ? AND scheduled_date = ?
  AND NOT (window_end <= ? OR window_start >= ?)`
- Return `409 { error: 'overlap', conflicts: [<slot, slot…>] }`
- Client surfaces "Officer Park has 2 attempts in this window — drag anyway?
  [Force]" → re-issues `PATCH ?force=1`
- `?force=1` writes the new slot AND emits `audit_log` entry
  `serve_schedule.force_overlap`

### Auto-replan when `max_attempts` exhausted

- `replanAfterFailedAttempt()` returns `null`
- Attempts handler interprets `null` as: set `serve_queue.status='failed'`,
  write `serve_nudges` row `condition='attempts_exhausted'`, broadcast on WS
- No new slot created — calendar stays clean

### Bad address / move detected

- `replanAfterFailedAttempt()` still returns a window (timer keeps ticking) but:
  - Sets `serve_queue.status='in_progress'` with `notes` annotation
    `needs_skip_trace`
  - Writes `serve_nudges` with `condition='address_unknown'`
  - New slot renders with `⚠ address unknown` overlay until skip trace completes
- Skip trace completion (existing `serve_skip_traces` flow) clears the
  annotation and removes the overlay automatically

### Timezone — Denver only, everywhere

- All `scheduled_date` / `window_start` / `window_end` are Denver-local strings
- The existing `denverNow()` helper is the single source
- All new pure functions take `tz='America/Denver'` as default param (testable
  with any TZ)
- D1 stores nothing as UTC for this feature — lexicographic comparison on
  Denver-local strings is the existing pattern (per migration 0130 comment)
- 04:00 cron rebalance runs when `UTC hour=10 AND minute=0` (04:00 MST,
  03:00 MDT) — 1-hour DST drift accepted

### Slot for a cancelled / served paper

- When `serve_queue.status` flips to `cancelled` or `served`, sweep upcoming
  slots: `UPDATE serve_attempt_schedules SET dismissed=1
  WHERE queue_id=? AND scheduled_date >= today`
- Existing `GET /schedule` already filters `dismissed=0` AND
  `status NOT IN ('served','cancelled','failed')` — defense in depth

### Manually-moved slot ≠ frozen forever

- `manually_moved=1` means "don't auto-replan or rebalance this slot"
- But the paper getting marked `served` still dismisses the slot
- Right-click "Reset to auto" sets `manually_moved=0` and the next rebalance
  picks it up

### Rebalance touches a slot whose `notify_at` already fired

- Cron rebalance respects `notified=1` — once a notification fired, that slot is fixed
- Manual `PATCH` from drag-drop can move a notified slot, but resets
  `notified=0` and recomputes a new `notify_at`. New notification fires.

### Realtime drop, network blip

- WS reconnect handler refetches the visible date window once and replays from there
- No "missed-event" replay queue — too much complexity for the ops surface

## Data flow (happy path)

```
[1] Operator commits intake on ServeIntakePage
     └─ commitIntake() in serveIntakeRecords.ts:
        ├─ planAttemptWindows()                      (existing)
        ├─ clusterByProximity()                      (NEW)
        ├─ applyUrgencyTier()                        (NEW)
        ├─ INSERT serve_queue (+ geo_cluster_id, urgency_tier)
        ├─ INSERT serve_attempt_schedules × N        (extended — adds officer_id)
        └─ broadcast { type: 'slot_changed', ... }  per slot

[2] Dispatcher opens dashboard → ServeSchedulerPanel
     └─ GET /serve-intake/schedule?include=tier
        → renders week timeline, subscribes to serve-schedule WS

[3] Dispatcher drags chip Mon 14:00 → Tue 10:00
     └─ optimistic UI update
     └─ PATCH /serve-intake/schedule/42 { scheduled_date, window_start, window_end }
        ├─ stale check passes (If-Unmodified-Since matches)
        ├─ overlap check passes
        ├─ UPDATE row, manually_moved=1, moved_by=..., updated_at=now
        ├─ recordAudit('serve_schedule.move', ...)
        ├─ recompute notify_at, reset notified=0
        └─ broadcast { type: 'slot_changed', ... }
     └─ all other open panels receive the WS update and patch in place

[4] Officer logs failed attempt: result='no_answer'
     └─ POST /serve-intake/queue/15/attempts
        ├─ INSERT serve_attempts
        ├─ UPDATE serve_queue.attempt_count++
        ├─ replanAfterFailedAttempt()              (NEW)
        │  → returns Wed 18:00 window
        ├─ INSERT serve_attempt_schedules (auto_replan_source=<new attempt id>)
        └─ broadcast { type: 'slot_changed', ... }

[5] Daily 04:00 Denver cron sweep (UTC hour=10, minute=0)
     └─ For each pending/assigned queue row:
        ├─ recompute urgency_tier
        ├─ if tier flipped to 'critical' AND priority != 'urgent': set priority='rush'
        ├─ for non-manually_moved slots: re-cluster, re-color, persist if changed
        └─ broadcast aggregate count to dashboards
```

## Testing strategy

### Pure-function unit tests (vitest, no D1, no fetch)

- `serveDiligencePlanner.test.ts` — extend existing
  - `clusterByProximity()`: lat/lng truncation correctness, ZIP fallback,
    null-handling
  - `applyUrgencyTier()`: boundary tests at 2-day, 5-day, no-deadline
  - `replanAfterFailedAttempt()`: 24-hour min gap, time-of-day variation,
    business-hours respect, `null` on exhaustion, `bad_address` path
- `schedulerView.test.ts` — new
  - `groupByDay()`, `groupByHour()`, `fitsInWindow()`, `snapToBand()`
- `dnd.test.ts` — new
  - Drop math: `(pixel_x, pixel_y) → (date, hour_band)`, snap rules

### Route-level smoke tests (Miniflare planned per CLAUDE.md tech debt; otherwise
manual via `wrangler dev` + curl)

- `PATCH /schedule/:id` happy path
- `PATCH /schedule/:id` stale → 409
- `PATCH /schedule/:id` overlap → 409 + `?force=1` overrides
- `POST /schedule/rebalance` `dry_run=true` returns counts, no DB writes
- `POST /attempts` with `no_answer` creates a new schedule slot
- `POST /attempts` at `max_attempts` exhausts → no slot, status=failed

### Client component tests (vitest + jsdom)

- `WeekTimeline` renders empty state without crash
- `WeekTimeline` renders chips at correct band positions for sample data
- Drag drop dispatches `PATCH` with normalized payload
- WS `slot_changed` event mutates state in place (no refetch)

### Browser smoke (manual — CLAUDE.md note that browser eyeball is required)

- Open `rmpgutah.us`, log in, see panel on dashboard
- Drag a chip, confirm overlap toast on overlapping band
- Open full-page scheduler, run dry-run rebalance, verify diff
- Log a failed attempt on a paper, confirm replan appears within 5 s

## Phases

Land in three PRs to keep each merge sized for the project's squash-merge
flow (project memory `feedback-verify-main-compiles-after-stack-merge`):

1. **PR 1 — Schema + algorithm + auto-replan + tier rebalance**
   - Migration 0140
   - `clusterByProximity`, `applyUrgencyTier`, `replanAfterFailedAttempt`
     pure functions + tests
   - `commitIntake` hook (cluster + tier at intake)
   - `POST /attempts` hook (auto-replan after failure)
   - Daily 04:00 cron sweep
   - **No UI changes** — purely backend. Manual D1 SQL verification.

2. **PR 2 — Dashboard panel**
   - `WeekTimeline`, `MonthGrid`, `AttemptChip`, `dnd`, `schedulerView`
   - `ServeSchedulerPanel` on dashboard (dispatch + admin views only)
   - `PATCH /schedule/:slotId` endpoint
   - WS `serve-schedule` topic broadcast
   - Service worker `CACHE_NAME` bump

3. **PR 3 — Full-page scheduler**
   - `/serve-intake/scheduler` route
   - Multi-officer swim lanes, unassigned-queue sidebar, range picker
   - `POST /schedule/rebalance` endpoint + preview modal
   - Auto-cluster nearby action
   - Bulk selection
   - Audit trail drawer
   - Sidebar nav entry with critical-count badge
   - Service worker `CACHE_NAME` bump

## Open questions / deferred

- **Native iOS scheduler** — Phase 2. The iOS app will get a simplified slot
  view via `LiveCounts` for now.
- **ServeManager integration** — separate program (per existing
  serveIntake.ts comment). Not affected by this work.
- **Recurring service patterns** — not in real-world use; not built.

## References

- [`src/utils/serveDiligencePlanner.ts`](../../src/utils/serveDiligencePlanner.ts) — existing planner (extended)
- [`src/utils/serveAttemptScheduler.ts`](../../src/utils/serveAttemptScheduler.ts) — existing scheduler (extended)
- [`src/routes/serveIntake.ts`](../../src/routes/serveIntake.ts) — extended route
- [`migrations/0130_serve_attempt_schedules.sql`](../../migrations/0130_serve_attempt_schedules.sql) — base table
- [`client/src/components/serve/ServeAttemptCalendar.tsx`](../../client/src/components/serve/ServeAttemptCalendar.tsx) — existing list view (kept; complements new grid)
- [`client/src/pages/dashboard/dashboardViews.ts`](../../client/src/pages/dashboard/dashboardViews.ts) — panel config (delta needed)
- [CLAUDE.md gotcha #5](../../CLAUDE.md) — D1 migration manual application requirement
