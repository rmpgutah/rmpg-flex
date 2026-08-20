# Process Server Map UI Enhancement — Design

**Date**: 2026-07-28
**Status**: Approved

## Context

The Process Server module's map surface (`client/src/components/serve/ServeIntakeMap.tsx`, 411 lines) currently renders a static `mapboxgl.Map` with one custom marker per queue item, a click-to-open popup, and an auto `fitBounds`. It has no clustering, no routing, no live location, and no risk/urgency visualization.

A separate active branch (`claude/process-server-ui-overhaul-6f71ac`) is concurrently adding diligence/queue-tools panels, analytics tabs, and clustering tweaks inside `ServeRoutePlanner.tsx`. That branch does **not** touch `ServeIntakeMap.tsx`. To minimize merge conflicts, this work enhances `ServeIntakeMap.tsx` in place and does not modify `ServeRoutePlanner.tsx`.

## Goals

Enhance the map UI across four dimensions the user prioritized (operational status, route/efficiency, risk/safety, analytics), and ship 10 concrete advanced functions, at a scale of <50 active jobs/servers (so heavy clustering libraries and viewport-paginated queries are not required — simple grid clustering is sufficient).

## Architecture

- **Enhance in place**: `client/src/components/serve/ServeIntakeMap.tsx` remains the single map component embedded wherever it's used today (no new tab/view, per approved scope).
- **New utility files** (keep `ServeIntakeMap.tsx` from growing unbounded):
  - `client/src/utils/serveMapClustering.ts` — lightweight grid-based clustering (group nearby markers at low zoom, split on zoom-in/click). Pure functions, unit-testable.
  - `client/src/utils/serveMapOverlays.ts` — pure calculation functions for deadline-urgency tier, risk/safety flag detection, and success-rate-by-area aggregation.
- **Reused existing modules** (no duplication):
  - `client/src/utils/mapboxServices.ts` — `forwardGeocode`/`reverseGeocode` for function 8.
  - `client/src/utils/mapboxRouting.ts` — Directions API wrapper for function 5 (single-stop preview), matching the retry/fallback pattern already used in `ServeRoutePlanner.tsx`.
  - `client/src/utils/serveJobSheetPdfGenerator.ts` — jsPDF layout pattern reused for function 10's export.
- **No backend changes required.** All 10 functions read from existing endpoints (`GET /success-rates`, `GET /:id/gps-trail`, `PUT /bulk-status`, `PUT /:id`) and existing `ServeJob` fields (`deadline`, `priority`, `service_instructions`, `recipient_lat/lng`).

## The 10 Advanced Functions

1. **Status/priority clustering** — nearby pending jobs group into a cluster badge (count + dominant status color) at low zoom; splits into individual markers on zoom-in or click. Implemented in `serveMapClustering.ts`.
2. **Deadline-urgency pulse rings** — jobs within 24h of `deadline` get an animated pulsing ring (amber→red as time runs out), computed client-side from the `deadline` field.
3. **Officer-safety risk halo** — jobs flagged via `service_instructions` text markers or `priority='urgent'` get a red halo + warning icon, visually distinct from routine status color, so safety concerns aren't confused with ordinary priority.
4. **Live server position + attempt-history trail** — overlays the assigned officer's live location (existing officer/unit GPS feed, joined via `officer_id`) plus historical visit attempts for that job via `GET /:id/gps-trail` (returns `{ trail: [...], polyline: [[lng,lat], ...] }` per `src/routes/serve.ts:1325`), rendered as a faded trail leading to the live dot.
5. **Single-stop drive-time preview** — clicking a job draws a live Directions-API route line + ETA badge from the server's current position to that one job. Lighter-weight than the full multi-stop planner in `ServeRoutePlanner.tsx` — this is for "should I go there next," not full route optimization.
6. **Success-rate choropleth/heatmap** — shades map areas by historical serve success rate from `GET /success-rates`, surfacing hard-to-serve neighborhoods.
7. **Deadline timeline filter** — a segmented control (Today / 3 days / This week / Overdue) filtering visible markers by `deadline`, reducing clutter from far-future jobs.
8. **Click-to-correct geocode** — drag a marker or click "fix location" to re-geocode a job whose `recipient_lat/lng` looks wrong, via `mapboxServices.ts` + `PUT /:id`.
9. **Bulk rectangle-select → bulk action** — drag a selection box to multi-select job markers, then apply a bulk status change or reassignment via the existing `PUT /bulk-status` endpoint, with a confirmation step before applying.
10. **Print/export route sheet** — exports the current (filtered) map view as a one-page PDF (address list + mini static map + priority markers), reusing the `serveJobSheetPdfGenerator.ts` layout pattern.

## Error Handling

- Directions/geocode calls use typed errors with a straight-line-distance fallback, matching the existing pattern in `ServeRoutePlanner.tsx`.
- Bulk actions (function 9) require an explicit confirm step before calling `PUT /bulk-status`.
- Missing/invalid `recipient_lat/lng` excludes a job from map rendering rather than crashing the map (existing behavior, preserved).

## Testing

- Unit tests for `serveMapClustering.ts` and `serveMapOverlays.ts` (pure functions: clustering math, urgency-tier classification, risk-flag detection).
- A client vitest smoke test for `ServeIntakeMap.tsx` mount with the new overlays enabled, following the existing `ServeJobCard.urgency.test.tsx` coverage style.

## Out of Scope

- No new D1 migrations or backend routes.
- No changes to `ServeRoutePlanner.tsx` or other files touched by the concurrent overhaul branch.
- No viewport-based pagination or heavy clustering library (not needed at <50 active jobs scale).
