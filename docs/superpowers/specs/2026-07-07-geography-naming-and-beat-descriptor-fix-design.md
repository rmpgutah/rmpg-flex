# Geography naming consistency + beat descriptor duplicate-label fix

**Date**: 2026-07-07
**Status**: Approved for implementation

## Problem

The user reported a map UI issue and asked to "reorganize the output of the Sector/Zone/District/Beat system" and ensure Mapbox is fully functional. Investigation (grounded in the current codebase, not assumptions) found:

1. **A concrete, system-wide duplicate-label bug.** All 719 rows seeded in `migrations/0012_seed_geography.sql` have `dispatch_beats.beat_descriptor` set to an exact copy of `beat_name` (e.g. beat 103: `beat_name='Midvale A-1'`, `beat_descriptor='Midvale A-1'`). Two render sites concatenate `beat_name` + `' — ' + beat_descriptor` whenever descriptor is truthy, so every beat displays as `"Midvale A-1 — Midvale A-1"` — a literal duplicate, in both the Beat dropdown (`SectorZoneBeatPicker`) and the map click popup. This matches the user's reported symptom ("A1 - Midvale A1 - Midvale").

2. **Sector/Zone naming drift.** The DB/API canon is `Area → Sector → Zone → Beat` (confirmed via `client/src/types/geography.ts:109` and the migration schema — there is no "District" table; `district_letter` is just one component of a composed `beat_code`, not a 5th tier). The map-overlay layer (`useDistrictHierarchyLayers.ts`, `useGeoJsonLayers.ts`, `districtGeoData.ts`) independently calls the Sector tier "Section" and the Zone tier "City" (the latter because the underlying beat GeoJSON carries UGRC's `city_code` field). The map's own click popup therefore shows "Section:" where the admin `GeographyPage.tsx` two clicks away shows "Sector:" for the identical data.

3. **`/dispatch/districts` field-naming ambiguity.** The flat endpoint (`src/routes/dispatch/geography.ts:139-170`) returns `sector_id` as the numeric `dispatch_sectors.id` row key, but `zone_id`/`beat_id` as string codes (`zone_code`/`beat_code`) — not their numeric PKs (those are separately exposed as `zone_db_id`/`beat_db_id`). This asymmetry under the same `_id` suffix already caused one production crash (documented in `useDistrictLookup.ts:65-73`, worked around via `normalizeSectorId()`).

Extensive recent history exists for Mapbox itself (7+ design specs in the last 3 weeks covering token resolution, map lifecycle, dead code, orphaned panels) and the user confirmed via clarifying questions that this task is specifically about the naming/labeling confusion, not a fresh Mapbox audit or a new rendering bug.

## Non-goals

- No broad Mapbox audit or new Mapbox feature work — extensively covered by recent specs (`2026-07-02-mapbox-integration-gaps-design.md`, `2026-07-03-mapbox-second-integration-cleanup-design.md`, the `2026-07-03` through `2026-07-06` map UI portal/theme/toolbar/marker specs).
- No wiring of the 27 orphaned map panel components / 13 orphaned hooks documented in `client/src/pages/map/_ORPHANS.md` — separate, much larger scope.
- No removal of the lingering `maplibre-gl` dependency / dead `useMapboxInit.ts` hook — unrelated cleanup, separate ticket.
- No rename of `/dispatch/districts` response field *values* or *names* (`sector_id`/`zone_id`/`beat_id` stay exactly as they are) — too wide a blast radius (10+ consumers already depend on current semantics, with a working `normalizeSectorId()` coercion in place). Only an additive field + a documenting comment are added.
- No rename of `useDistrictLookup.ts`'s internal `sections`/`sectionLabels`/`sectionCodes`/`getSectionCode` naming — consumed by name across 10+ pages; purely-cosmetic-internally with no user-visible benefit. Deferred as a known inconsistency, not fixed here.
- No change to `dispatch_sectors.description` / `dispatch_zones.description` / `dispatch_areas.description` — confirmed via grep these are unrelated freeform fields, never concatenated with name, not affected by the beat_descriptor bug.

## Design

### 1. Beat descriptor duplicate-label bug

- **Migration** `migrations/0177_null_duplicate_beat_descriptor.sql`:
  ```sql
  UPDATE dispatch_beats SET beat_descriptor = NULL WHERE beat_descriptor = beat_name;
  ```
  Idempotent (safe to re-run; a second run is a no-op since the WHERE clause no longer matches).
- **Guard both render sites** so a future data-entry duplicate can't resurface the bug even if descriptor drifts again:
  - `client/src/hooks/useDistrictLookup.ts:168` — change `d.beat_descriptor ? ' — ' + d.beat_descriptor : ''` to `d.beat_descriptor && d.beat_descriptor !== d.beat_name ? ' — ' + d.beat_descriptor : ''`.
  - `client/src/hooks/useGeoJsonLayers.ts:498` — same guard pattern on `entry.beatDescriptor` vs `entry.beatName`.
- Confirmed via grep: `beat_descriptor` has no other consumers, so this is a fully contained change.
- Apply the migration directly to live D1 (`785de7ae-3e7a-4e01-93bb-d24ddd813f6b`) after merge per `scripts/apply-migration.sh`, per CLAUDE.md's migration process (deploy step is `continue-on-error`).

### 2. Sector/Zone naming consistency

- **New file** `client/src/utils/geographyLabels.ts` — single source of truth:
  - Exports canonical tier labels: `TIER_LABELS = { area: 'Area', sector: 'Sector', zone: 'Zone', beat: 'Beat' }`.
  - Exports `getSectorColor(code)` and `getZoneColor(code)` — consolidating the currently-duplicated `getSectionColor`/`getCityColor` implementations (same hash-based color assignment logic, just renamed and unified into one module) so any future consumer imports from one place instead of reimplementing.
- **`client/src/hooks/useDistrictHierarchyLayers.ts`**:
  - `HierarchyLevelId` type: `'area' | 'section' | 'zone'` → `'area' | 'sector' | 'zone'`.
  - `HIERARCHY_CONFIGS`: `{ id: 'section', label: 'Section', description: 'Spillman sections (SL1, DV1…)' }` → `{ id: 'sector', label: 'Sector', description: 'Spillman sectors (SL1, DV1…)' }`.
  - `FIELD` map: `section: { key: '_section', name: '_sectionName', color: '_sectionColor' }` → `sector: { key: '_sector', name: '_sectorName', color: '_sectorColor' }`.
  - Popup HTML: `"Section:"` label → `"Sector:"`.
  - Module header comment updated from "Area/Section/Zone" to "Area/Sector/Zone".
- **`client/src/pages/map/utils/districtGeoData.ts`**:
  - `TaggedBeatProps` interface: `_section`/`_sectionName`/`_sectionColor` → `_sector`/`_sectorName`/`_sectorColor`.
  - `getTaggedBeats()` output updated to match.
  - The `sectorName`/`zoneName` intermediate variable naming (already correct) is unaffected.
- **`client/src/hooks/useGeoJsonLayers.ts`**:
  - `CITY_COLORS`/`getCityColor` removed; replaced with `getZoneColor` imported from `geographyLabels.ts`.
  - `getSectionColor` (used in the beat popup at line 496) replaced with `getSectorColor` imported from `geographyLabels.ts`.
  - Popup field labels ("Section:" → "Sector:") at line 499.
- **`src/utils/districtResolver.ts:28`** — fix the stray inline comment ("Area — top of the Area › Section › Zone › Beat hierarchy" → "Area › Sector › Zone › Beat") so the server's own canonical resolver doesn't contradict itself three lines from its own header comment.
- **Explicitly not touched**: `useDistrictLookup.ts`'s `sections`/`sectionLabels`/`sectionCodes`/`getSectionCode`/`sectionAreas` (internal names, wide consumer surface, no user-visible label currently reads "Section" from this file — its labels are consumed as raw data by callers who supply their own "Sector" label text, e.g. `SectorZoneBeatPicker.tsx:68` already renders `<label>Sector</label>`).

### 3. `/dispatch/districts` ID-field ambiguity

- **`src/routes/dispatch/geography.ts`**, in the `/districts` SELECT (line ~144): add `ds.id AS sector_db_id` alongside the existing `ds.id AS sector_id`, so all four tiers (`area_id`/`sector_db_id`/`zone_db_id`/`beat_db_id`) uniformly expose a numeric-PK field under a `_db_id` name. Purely additive — no existing field is renamed or removed.
- Add a code comment directly above the SELECT documenting the asymmetry: `sector_id`/`area_id` are numeric PKs; `zone_id`/`beat_id` are code strings (`zone_code`/`beat_code`), not their numeric PKs (those are `zone_db_id`/`beat_db_id`) — so a future reader doesn't assume all four `_id` fields share the same semantics.

## Testing

- Add a regression test for the beat-descriptor guard (e.g. `client/src/hooks/__tests__/useDistrictLookup.test.ts` or co-located with existing district/geography tests) covering: descriptor equal to name → not appended; descriptor different from name → appended; descriptor null/empty → not appended.
- `npm run typecheck` (Worker) + `cd client && npx tsc --noEmit` (client) — the renames touch type unions (`HierarchyLevelId`) so this will catch any missed call site.
- Manual browser verification after implementation: open `/map`, toggle the Sector hierarchy layer, click a beat, confirm the popup shows "Sector:"/"Zone:" (not "Section:"/"City:") and the beat name is not duplicated. Open a form using `SectorZoneBeatPicker` (e.g. a new call or case), confirm the Beat dropdown shows each beat name once, not twice.
- Verify migration 0177 locally (`npm run migrate:local`) before merge, then apply directly to live D1 per CLAUDE.md's migration process after merge (`scripts/apply-migration.sh 0177_null_duplicate_beat_descriptor.sql`), and spot-check `SELECT beat_code, beat_name, beat_descriptor FROM dispatch_beats WHERE beat_code = 'MID/A1'` returns `beat_descriptor = NULL`.
