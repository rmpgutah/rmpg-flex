# Warrants Watch List — Design Spec

**Date**: 2026-07-18
**Status**: Approved for planning

## Purpose

Let a user flag a specific warrant for ongoing personal attention ("My Watched
Warrants"), with opt-in alerts when: the warrant's status changes, it's about
to expire, or its subject shows up in a new call/field interview/citation.
Personal per-user, not shared/team-visible.

## Non-goals

- Not a team/shared watch list — each user has their own.
- Not a new standalone page/route — lives inside the existing `WarrantsPage`.
- Not a new top-level tab — the page already has
  `dashboard/warrants/search-all/screening/watch/sources/scrapers`, and it
  already has an unrelated tab literally named `watch` (a 4-hourly automated
  person/vehicle screening scan). The new feature is labeled **"My Watched
  Warrants"** everywhere in the UI to avoid confusion with that existing tab,
  and is a filter within the `warrants` tab, not a new tab.
- Not fixing the pre-existing `'quashed'` status mismatch (client's
  `WARRANT_STATUSES` includes it; the DB `CHECK` constraint on
  `warrants.status` doesn't) — flagged, left alone, out of scope.
- Not a new notification delivery mechanism — reuses the existing
  `notifications` table/inbox/bell.

## Architecture

### Extending `intel_watchlist`, not a new table

The existing `intel_watchlist` table
([migrations/0099_intel_watchlist.sql](../../../migrations/0099_intel_watchlist.sql):
`entity_type, entity_id, reason, added_by, active, last_alert_at`) already
supports `entity_type IN ('person', 'vehicle')` with full CRUD at
[`src/routes/intel.ts:317-363`](../../../src/routes/intel.ts) (`GET/POST
/api/intel/watchlist`, `DELETE /api/intel/watchlist/:entityType/:entityId`).
This feature adds `'warrant'` as a third `WATCHABLE` entry, reusing the same
table, routes, and ownership model (`added_by`, matching "personal,
per-user") — no new table.

```sql
-- migrations/0193_warrant_watch_extensions.sql
ALTER TABLE intel_watchlist ADD COLUMN last_known_status TEXT;
ALTER TABLE intel_watchlist ADD COLUMN expiry_alerted_at TEXT;
```

Both columns are nullable and only populated for `entity_type = 'warrant'`
watches:
- `last_known_status` — the warrant's `status` as observed at the last
  sweep. Set to the *current* status at watch-creation time, so the very
  first sweep after creating a watch doesn't spuriously fire a "status
  changed" alert.
- `expiry_alerted_at` — set once the "expiring soon" alert fires for that
  watch, so it never re-fires.

`POST /api/intel/watchlist`'s validation becomes
`WATCHABLE = ['person', 'vehicle', 'warrant']`; the handler additionally
confirms the referenced `entity_id` is a real row in `warrants` when
`entity_type === 'warrant'` (404 if not), and seeds `last_known_status` from
that warrant's current `status` at insert time.

### Fixing dead cron wiring (required for this feature to function at all)

`sweepWatchlist()` in
[`src/utils/intelWatchlist.ts:81-114`](../../../src/utils/intelWatchlist.ts)
already exists (person/vehicle activity alerts) but has **zero call sites** —
it is never invoked by the per-minute cron in `src/index.ts` (which only
calls `schedulerReminders`, `serveAttemptScheduler.sweepAttemptNotifications`,
and `panicEscalationSweep`). The existing person/vehicle watchlist-alerting
feature has therefore been dead code in production. Since the new warrant
alerts depend on this cron hook existing, it gets wired in as part of this
work (`ctx.waitUntil(import('./utils/intelWatchlist').then(m =>
m.sweepWatchlist(env.DB)))` alongside the other per-minute jobs) — as a side
effect, person/vehicle watch alerts start actually firing for the first time.

## Alert Detection Logic

`sweepWatchlist()`'s current dispatch is a two-way ternary
(`w.entity_type === 'vehicle' ? hitsForVehicle(...) : hitsForPerson(...)`) —
any entity_type other than `'vehicle'` falls through to `hitsForPerson`,
which would silently misroute a `'warrant'` watch (treating the warrant's row
ID as a person ID). This becomes an explicit three-way branch:
`if (entity_type === 'vehicle') ... else if (entity_type === 'person') ...
else if (entity_type === 'warrant') ...`.

For a warrant watch, each sweep runs three independent checks (any/all can
fire in the same sweep, each becoming its own `notifications` row):

1. **Status change** — fetch the warrant's current `status`; if it differs
   from `last_known_status`, fire an alert (`"Warrant #<number> status
   changed: active → served"`) and update the snapshot to the new status.
2. **Expiring soon** — if `status === 'active'`, `expires_at` is within 7
   days of now, and `expiry_alerted_at` is null, fire one alert (`"Warrant
   #<number> expires in <N> days"`) and set `expiry_alerted_at =
   datetime('now')`.
3. **Subject encountered** — `warrants.person_id` is nullable (not every
   warrant has a linked person); when set, reuse the existing
   `hitsForPerson(db, personId, since)` detection (new calls/field
   interviews/citations), but label the resulting alert with warrant context
   (`"Subject of warrant #<number> (John Doe) appeared in new call
   CFS-2026-01542"`) rather than the generic person-watch wording, so the two
   features stay visually distinguishable in the notification inbox even
   though they share detection code.

## Notification Delivery & Error Handling

No new delivery mechanism. Each hit inserts one row into the existing
`notifications` table (`type: 'warrant_watch_hit'`, `priority: 'high'`,
`entity_type: 'warrant'`, `entity_id`), surfaced through the existing
per-user inbox/bell. Each watch is try/catch-isolated in the sweep loop
(matching the existing pattern for person/vehicle watches) so one broken
watch (e.g. its warrant was hard-deleted) can't take down the whole
per-minute cron — a failure logs and the sweep moves to the next watch.

## UI

**Toggle** — reuses the existing `useWatchToggle` hook
([`client/src/pages/intel/useWatchToggle.ts`](../../../client/src/pages/intel/useWatchToggle.ts):
optimistic POST/DELETE against `/intel/watchlist`, rollback on failure),
which already generalizes over `entity_type` and should work for `'warrant'`
with no changes to the hook itself. `WarrantsListTab.tsx` has no per-row icon
slot today (rows render inline in a `<table>`, no dedicated row component),
so the toggle is added as a new "★ Watch" / "☆ Unwatch" item in the existing
right-click context menu
([`buildWarrantMenu(w)`](../../../client/src/pages/warrants/WarrantsListTab.tsx):686),
consistent with every other row action there.

**"My Watched Warrants" view** — a filter chip within the existing
`warrants` tab (not a new tab), next to the status `<select>`. When active,
it sends `watched_only=1` to the list endpoint instead of the normal
status/type filter set; the backend joins against `intel_watchlist WHERE
entity_type='warrant' AND added_by=<current user> AND active=1` for that
request. Each row in this filtered view shows a small badge indicating which
alert(s) recently fired (status/expiring/subject), reusing the
notification's `type` field rather than inventing new UI state.

## Testing

- Worker: a Miniflare route test for `POST /intel/watchlist` accepting
  `entity_type: 'warrant'` and rejecting an invalid `entity_id` (404); a unit
  test for the new three-branch sweep logic — status-change fires once and
  updates the snapshot, expiring-soon fires once and doesn't repeat,
  subject-encountered reuses `hitsForPerson` correctly and labels the alert
  with warrant context. This is the first real test coverage
  `intelWatchlist.ts` will have had, since it has never run in production.
- Client: a test for `WarrantsListTab.tsx`'s new `watched_only` filter chip,
  and for the context-menu's watch/unwatch item (optimistic toggle + rollback
  on API failure).
