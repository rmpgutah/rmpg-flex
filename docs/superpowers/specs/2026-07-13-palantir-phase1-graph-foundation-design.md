# Palantir-Grade Platform — Phase 1: Graph Foundation & Coverage

**Date:** 2026-07-13
**Status:** Approved for planning
**Depends on:** [2026-07-13-forensics-government-standard-design.md](2026-07-13-forensics-government-standard-design.md)
  (specifically its `forensic_case_links` table)

## Context

The user asked to build the app's connections/forensics subsystems into a
"highly advanced Palantir system." Investigation showed `src/routes/
connections.ts` already implements a mature BFS entity-relationship graph
covering 16 node types (person, vehicle, property, business, evidence,
case, incident, warrant, citation, arrest, field_interview,
trespass_order, serve_job, call, report, intel_report) with two edge
sources: the generic `record_links` table and type-specific FK/junction
joins. `ConnectionsGraphPanel.tsx` renders it as a hand-rolled SVG
force-directed graph. This is already most of "a unified entity graph" —
a full rebuild would be wasted effort.

A true Palantir-style platform is necessarily multi-phase (see the
roadmap discussion in conversation — Phase 1: graph foundation, Phase 2:
investigation workbench, Phase 3: advanced visualization, Phase 4:
AI-assisted analysis). This spec covers **Phase 1 only**: closing the
gaps in graph *coverage* (ALPR, forensics, time, geo) without touching
the rendering engine or adding new UI paradigms — those come in later
phases.

Three gaps were confirmed by code inspection:
- **ALPR** (`alpr_captures`/`vehicle_sightings`) is already FK'd to
  `vehicles_records`, `calls_for_service`, and `incidents`, but
  `connections.ts`'s `findConnections()` has no branch that queries it —
  the data exists, it's just not graphed.
- **GPS** (`gps_breadcrumbs`) has no graph presence at all, and — being
  high-volume (one row per few seconds per unit) — is a poor fit for
  one-row-per-node graphing regardless.
- **Timeline** (`GET /connections/timeline`) is a fully-built, unused
  endpoint — `ConnectionsGraphPanel.tsx` never calls it.
- **Map/geo** has no presence in the connections UI at all (mapping
  lives entirely separately under `client/src/pages/map/*`).
- **Forensics** cases/exhibits aren't graph nodes yet — deferred here
  because they depend on the `forensic_case_links` table from the
  forensics spec (built in that spec's Phase 1, not this one).
- **Intel** is already fully graphed via `intel_reports`/
  `intel_report_links` — confirmed, no work needed.

## Goals

Extend the existing graph engine's *coverage* — more node types, a time
dimension, a geo dimension — without touching its traversal algorithm,
de-dup logic, `MAX_NODES` cap, or the SVG rendering approach. Every
addition follows the existing `switch`-per-type dispatch pattern already
established in `loadNode()`/`findConnections()`.

## Non-goals

- No graph library swap (stays hand-rolled SVG force-layout per user
  decision — sigma.js/vis-network work deferred to Phase 3 if ever).
- No GPS clustering/dwell-location nodes (GPS is map-overlay only, not
  graph nodes, per user decision — avoids blowing the 120-node cap on
  breadcrumb volume).
- No investigation boards, federated search, or saved workspaces (Phase
  2).
- No AI features (Phase 4).
- No changes to `record_links`, the generic cross-link table, beyond
  reading from it as today.

## Design

### 1. ALPR as graph nodes/edges

- Add `'alpr_sighting'` to `VALID_TYPES` (connections.ts:66-70).
- `loadNode()`: new `case 'alpr_sighting'` reading from `alpr_captures`
  (falling back to `vehicle_sightings` for rows with no `alpr_captures`
  counterpart — the pre-ALPR plate-log path). Label format: `"{plate}
  ({state}) — {location_text}"`.
- `findConnections()`: new join branches —
  - `case 'vehicle'` → sightings where `alpr_captures.vehicle_record_ids`
    JSON-contains the vehicle id, OR `vehicle_sightings.vehicle_id`
    matches directly.
  - `case 'call'` → sightings where `alpr_captures.call_id` matches.
  - `case 'incident'` → sightings where `alpr_captures.incident_id`
    matches.
  - Each branch caps results to the most recent 20 sightings per parent
    node (a frequently-scanned plate could otherwise flood a single
    node's edge count) — mirrors the spirit of `MAX_NODES`, applied
    per-edge-source rather than globally.
- Edge `relationship` value: `'alpr_capture'`.

### 2. Timeline scrubber

- `buildGraph()` (connections.ts:487-549) gains optional `dateFrom`/
  `dateTo` params, threaded through to `findConnections()` calls. Each
  type-specific branch already knows its own "dated" column (the
  existing `GET /connections/timeline` endpoint's `TIMELINE_TABLE`/
  `TIMELINE_QUERY` maps at connections.ts:751-770 already enumerate
  this per type) — reuse that map as the source of truth for which
  column to filter on, rather than duplicating it.
- Nodes/edges outside the range are simply not added during traversal —
  no new response fields, existing `GNode`/`GEdge` shape unchanged.
- `GET /connections/graph` accepts new optional query params
  `date_from`, `date_to` (ISO date strings), validated and passed
  through; absent = unfiltered (current behavior, unchanged default).
- Frontend: `ConnectionsGraphPanel.tsx` gets a new date-range control
  (reuse whatever date-range picker component the app already uses
  elsewhere — check `client/src/components/` for an existing one before
  building a new one) that re-fetches the graph with the range applied.

### 3. Map overlay panel

- New component `ConnectionsMapPanel.tsx`, mounted alongside the graph
  panel, visible when a node is selected.
- New read-only endpoints (no writes):
  - `GET /connections/:type/:id/gps-track?date_from=&date_to=` — for a
    `person` node, resolves their assigned `units` (via
    `units.officer_id`) and returns `gps_breadcrumbs` rows for those
    units in the range, shaped as a route (`[{lat,lng,recorded_at}]`).
    For a `call` node, returns breadcrumbs where
    `current_call_id` matches.
  - `GET /connections/:type/:id/geo-points?date_from=&date_to=` — for
    `vehicle`/`call`/`incident` nodes, returns `alpr_captures.lat/lng`
    and `dashcam_events.lat/lng` points in range as pins.
  - Both endpoints are additive to `connections.ts`, not new route
    files — they reuse the same auth/role gating as the rest of the
    file.
- Rendering reuses the existing Mapbox setup pattern from
  `client/src/pages/map/*` (same basemap/style helpers,
  `mapboxApiKey.ts`) rather than introducing a second map integration.
- No new node types are created for GPS — this panel is purely a detail
  view for whatever node is currently selected in the graph, not part of
  the graph traversal itself.

### 4. Forensics tie-in

- Add `'forensic_case'` and `'forensic_exhibit'` to `VALID_TYPES`.
- Wired via the `forensic_case_links` table from the forensics spec —
  once that table exists, `findConnections()` queries it exactly the way
  `record_links` is already queried (bidirectional `source`/`target`
  lookup), so this is a small addition once that table lands, not a new
  pattern.
- **Sequencing note**: this piece is blocked on the forensics spec's
  Phase 1 (hash/links/QC/templates) shipping first, specifically the
  `forensic_case_links` migration. If the forensics work and this Phase
  1 graph work are built as separate PRs, this piece should be the last
  thing added here, after confirming that table exists on the target
  branch.

## Data flow / migrations

No new tables required for items 1–3 (all read existing tables via new
query branches). Item 4 requires no new migration of its own — it
depends entirely on the forensics spec's migration already having run.

## Error handling

Follow `connections.ts`'s existing per-branch try/catch convention (one
bad join doesn't kill the whole graph — matches the pattern already used
for every existing type branch, e.g. sentinel-guarded person↔person
address/phone matching). New map/timeline endpoints follow the same
`try { query } catch { return c.json({data: []}, 200) }` best-effort
pattern used elsewhere in the file for read endpoints, so a missing
table or bad param degrades to an empty overlay rather than a 500.

## Testing

Add coverage under `test-workers/` (Miniflare) following the
`health.test.ts`/`auth.test.ts` pattern: ALPR node/edge inclusion in a
sample graph, timeline date-range filtering (in/out-of-range assertions),
GPS-track and geo-points endpoint shape. No existing Worker tests cover
`connections.ts` today per the earlier Explore pass — this is net-new
coverage, not a regression risk area to preserve.

## Deploy

No migration to apply post-merge (no new tables in this phase). Standard
deploy via `deploy.yml`; verify the new query branches against live D1
data for at least one person/vehicle/call node with real ALPR/GPS rows
before considering the phase complete.
