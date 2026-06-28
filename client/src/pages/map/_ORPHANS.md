# Map Module — Orphan Inventory

**Last audited: 2026-06-22.**

The following components and hooks in `client/src/pages/map/` are **fully built,
fully tokenized, and exported — but never imported anywhere in the live app**.
They were touched by the system-wide token-cleanup PRs in 2026-05 (Phase 2/3/5–8,
SW v991→v1015) without any audit of whether they were actually wired.

**Bundle impact:** Tree-shaking already drops them, so they don't ship to
operators. The cost is reader confusion ("is this used?") + maintenance drift
(token cleanups touch files no one sees).

**Disposition:** Keep in tree for now — they're a parked design library. A
future operator-driven sprint can wire any of these up rather than rebuilding
from scratch. **Do not import without first reading the file and confirming
the feature is actually wanted.** If a component here has visibly broken
contracts after schema drift, file an issue rather than silently fixing it.

---

## Orphan panels (`components/`)

These have **zero `import` statements anywhere in `client/src/`** outside their
own file. Verified 2026-06-22 via `grep -rn "import.*<name>" client/src/`.

| Component | Lines | Likely intent |
|-----------|-------|---------------|
| `AdvancedHeatmapPanel`   | — | Power-user heatmap controls (bandwidth, intensity, etc.) |
| `AlertSystemPanel`       | — | Aggregated alert ticker for the map's left rail |
| `CallHistoryPanel`       | — | "Past calls at this location" popup |
| `ClosestUnitPanel`       | — | Find closest available unit for a click target |
| `CorridorAnalysisPanel`  | — | Patrol corridor analysis sidebar |
| `CoverageTimeline`       | — | Beat coverage gaps over time |
| `DispatchToolPanel`      | — | One-click dispatch from a clicked address |
| `GeofenceManager`        | — | CRUD UI for tactical geofences |
| `HeatmapLegend`          | — | Standalone heatmap legend (superseded by `UnifiedMapLegend`) |
| `HeatmapPresets`         | — | Saved heatmap configurations |
| `IncidentReportsPanel`   | — | List of incident reports as map sidebar |
| `MapLayersPanel`         | — | Layer toggle dialog (separate from inline layer chips) |
| `MapLegend`              | — | Older legend; superseded by `UnifiedMapLegend` |
| `MapMobileSheet`         | — | Cohesive mobile bottom sheet (today's mobile UX is inline `!isMobile` branches) |
| `MapOverlays`            | — | Overlay layer dialog |
| `MapOverlaysPanel`       | — | Same idea as `MapOverlays` |
| `MapSidebar`             | — | Reusable sidebar shell |
| `MeasurementOverlay`     | — | Distance/area measurement toolbar |
| `PerimeterToolsPanel`    | — | Perimeter drawing tools |
| `RouteComparePanel`      | — | Side-by-side multi-route comparison |
| `SafetyAlertModal`       | — | Modal for officer-down / safety alerts |
| `SafetyDashboardPanel`   | — | Officer-safety dashboard widget |
| `SafetyZonesPanel`       | — | Safety-zone definition UI |
| `SpeedGraphOverlay`      | — | Per-unit speed graph over time |
| `TacticalSummaryPanel`   | — | Tactical-situation summary card |
| `ThreatAssessmentPanel`  | — | Threat-level scoring for a location |
| `WeatherPanel`           | — | Full weather sidebar (vs the inline weather strip) |
| `WeatherWidget`          | — | Compact weather widget (the dashboard has its own) |

### Wired in PR #1584 (2026-06-22)
- ✅ `MapCompassRose` — mounted bottom-right of the map
- ✅ `MapScaleBar` — mounted bottom-right of the map (above compass)
- ✅ `KeyboardShortcutsHelp` — opened by `?`; reads `MAP_SHORTCUT_BINDINGS`

## Orphan hooks (`hooks/`)

| Hook | Likely intent |
|------|---------------|
| `useMapCallHistory` | History query for a clicked location |
| `useMapClosestUnit` | Closest-unit dispatch helper |
| `useMapCorridor` | Corridor analysis math |
| `useMapCoverageGaps` | Patrol coverage gap detection |
| `useMapDwellTime` | Unit dwell-time stats |
| `useMapEnvironment` | Environment/lighting overlay |
| `useMapHeatmapTimelapse` | Animate heatmap across time |
| `useMapIncidentReports` | Incident-report fetcher for sidebar |
| `useMapPerimeter` | Perimeter geometry state |
| `useMapRepeatAddresses` | Repeat-call-location detection |
| `useMapSafetyZones` | Safety zone CRUD/state |
| `useMapThreatAssessment` | Threat-score calc |
| `useMapTrackingLines` | Unit tracking polylines |

## Rules going forward

1. **No silent edits.** Touching an orphan file requires a PR comment
   acknowledging it's orphan + the intent (wire, delete, or refactor).
2. **No reverse-imports.** A live file must never import an orphan (one rogue
   import resurrects the entire dead-code subtree).
3. **Delete or wire batches.** If a sprint wires N of these, audit + delete
   the rest in the same PR so the orphan list shrinks monotonically.
