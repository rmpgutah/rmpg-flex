# Map UI & Portal Redesign — Phase 4: Aggregated Safety Alert Ticker

**Date:** 2026-07-04
**Status:** Approved for planning

## Context

Phase 4 of the 4-phase Map UI redesign program was originally scoped against
`client/src/pages/map/_ORPHANS.md` (last audited 2026-06-22), which listed
~27 unwired panel components including `SafetyDashboardPanel`,
`SafetyZonesPanel`, `ThreatAssessmentPanel`, `AlertSystemPanel`, and
`ClosestUnitPanel`. Re-investigating found this inventory is stale:

- Safety Zones, Incidents, Coverage Gaps, and Call History overlays are
  **already fully wired** (via `safetyZonesEnabled`/`incidentsEnabled`/
  `coverageGapsEnabled`/`historyCallsEnabled` state + dedicated hooks,
  surfaced through the existing `MapOverlaysPanel` layer-toggle list) —
  built by a separate, parallel session's work that landed on `main`.
- Closest-unit lookup is already implemented in `DispatchPage.tsx`
  (`handleSuggestClosestUnit`) and `MapboxDispatchConnections.tsx`.
- The named orphan component files themselves no longer exist in the
  codebase — presumably deleted/superseded when the above was built.

The one genuine remaining gap: **no unified view of active safety-critical
alerts on the Map page.** Panic alerts (`GET /dispatch/panic`), officer
welfare emergencies (`GET /dispatch/welfare/status`), and geofence/premise
alerts (`useMapGeofenceAlerts`) each exist as independent data sources with
no consolidated display — a dispatcher watching the map has no single place
to see "everything safety-relevant happening right now."

## Goals

- Add a `SafetyAlertTicker` panel to the Map page showing a merged,
  live-updating list of:
  - Active panic alerts (status `active` or `acknowledged`)
  - Officers in `emergency` or `overdue` welfare status
  - Active geofence/premise alerts within view
- Real-time updates via the existing WebSocket `subscribe()` pattern already
  used elsewhere in `MapboxMapPage.tsx` — subscribe to `panic_alert` and
  `welfare_alert` for those two sources. Premise alerts have no WS broadcast
  on create/update (checked `src/routes/dispatch/extensions.ts`'s
  premise_alerts CRUD routes — none call `broadcastAll`/`sendToUser`), so
  that source polls on a plain interval (60s) instead — this is a scope
  decision, not a gap to fix in this phase; adding a premise-alert broadcast
  would be backend work outside a Map-UI-only phase.
- Badge count on the panel's collapsed trigger (number of active items).
- The 3 highest-severity items (by recency + type: panic > welfare-emergency
  > geofence) stay visible even when the panel is collapsed, mirroring the
  Phase 3 "safety controls stay reachable" principle — this is a *display*
  surface, not a control, so "always visible" means the top items render as
  a compact strip, not that the panel can't be collapsed at all.

## Non-goals

- No new backend aggregation endpoint. The client merges 3 existing,
  independently-fetchable data sources — a new endpoint would just
  re-serialize what's already available, adding a maintenance surface for
  no real benefit.
- No changes to the underlying panic/welfare/geofence hooks or routes
  themselves (already fixed for correctness in the prior dispatch-safety
  PRs #2597/#2598) — this phase is purely a new display surface.
- No theme/toolbar-declutter changes — those are Phases 2/3, already done.
- No mobile-specific layout — desktop/dispatcher-console only, matching
  this Map page's existing scope (a separate mobile field-camera/dispatch
  surface already exists elsewhere in the app).

## Design

### Data

- `usePanicAlerts()` — new client hook, fetches `GET /api/dispatch/panic`
  on mount, subscribes to `panic_alert` WS events to refetch/patch in place.
- `useWelfareAlerts()` — new client hook, fetches `GET /api/dispatch/welfare/status`
  on mount, subscribes to `welfare_alert` WS events, filters to
  `status IN ('emergency', 'overdue')` client-side (the endpoint returns all
  officers' welfare rows, not just at-risk ones).
- `usePremiseAlerts()` — new client hook, fetches `GET /api/dispatch/geography/premise-alerts`
  (no query params → returns all active, unexpired premise alerts globally,
  confirmed via the route's own `where` clause defaulting to
  `active = 1 AND (expires_at IS NULL OR expires_at >= datetime('now'))`).
  **Correction from initial design:** the existing `useMapGeofenceAlerts`
  hook's `activeAlerts` state is populated only by clicking a location on
  the map (a lookup, not a passive feed) — it is NOT a suitable data source
  for a ticker that needs to show all currently-active alerts. This new
  hook reads the same underlying `premise_alerts` table via the global-list
  endpoint instead, independent of `useMapGeofenceAlerts`.

### Merge & sort

A single `useSafetyAlertFeed()` hook composes the 3 sources above into one
sorted array: `{ id, type: 'panic' | 'welfare' | 'premise', severity, label,
timestamp, ... }[]`, sorted by severity (panic > welfare > premise) then
recency. This hook is a new file — it doesn't touch the 3 underlying hooks'
internals, only reads their outputs.

### UI

`SafetyAlertTicker` component, mounted in `MapboxMapPage.tsx` near the other
top-level panels (alongside `MapOverlaysPanel`), anchored top-left. Collapsed
state shows the top 3 items in a compact horizontal strip + a badge count;
expanded state shows the full list in a scrollable panel. Follows the
existing steel-blue tactical-dark token conventions from Phase 2 (no new
hex, reuse `tacticalPalette.ts`/Tailwind tokens as appropriate for each
render context).

## Testing

- Unit tests for `useSafetyAlertFeed`'s merge/sort logic (pure function,
  easy to test in isolation with mocked hook outputs).
- Component test for `SafetyAlertTicker` covering collapsed/expanded
  states and the top-3-always-visible behavior, following the existing
  `ToolbarDropdownGroup.test.tsx` pattern.
- No Miniflare/route tests needed — no new backend routes.
- Manual browser verification not performed this session (same recurring
  constraint — shared-worktree dev-server port conflicts); flag for the
  user to eyeball before considering this phase done.
