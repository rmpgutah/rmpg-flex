# Features Overlay Inspector — Design

**Date:** 2026-08-02
**Status:** Approved, ready for implementation planning
**Scope:** The map's Identify tool (`useMapFeatureInspect`) and the OSM feature
description layer it shares with the existing feature-click popup.

---

## Problem

The Identify tool answers a Mapbox debugging question — "what vector geometry is
under my cursor?" — when an officer on scene is asking "what is *here*?"

A click on Woodstock Elementary School currently returns twelve rows. Eleven are
noise:

- `rmpg-coverage-gaps-fill` — an internal RMPG render layer id, leaked verbatim
- `landuse (school)`, `landuse (surface) 30 ft` — basemap polygons
- `road (sidewalk) 4 ft`, `road (crossing) 6 ft`, `road (service) 37 ft` — basemap roads
- `+4 more` — truncation with no way to see the remainder

The one operationally meaningful row, the school, is buried by construction. It
also renders less information than the app already has: no OSM tags, no address,
no hours, no RMPG-verified badge, no link to the OpenStreetMap record.

### Root causes

1. **No relevance filter.** [`useMapFeatureInspect.ts`](../../../client/src/hooks/useMapFeatureInspect.ts)
   takes the first 15 `queryRenderedFeatures` hits with an empty filter — every
   basemap and internal layer included.
2. **A duplicate renderer.** The hook builds its own inline HTML rather than
   using [`buildOsmPopupHtml`](../../../client/src/utils/osmPopup.ts), which
   already does labelled fields, US-unit conversion, the RMPG edit layer, and
   the OSM deep link. Two renderers, diverging.
3. **A pointless network call.** The hook queries the Tilequery API against
   `mapbox.mapbox-streets-v8` — Mapbox's *basemap* tileset. None of RMPG's
   overlays live there, so under an overlays-only filter every Tilequery row is
   discarded. It is a billed round-trip per click that contributes nothing, and
   it is the sole source of the misleading `4 ft` / `36 ft` distances.

---

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| What is listed | **RMPG overlays only** | Basemap geometry and internal render layers are suppressed entirely, not collapsed. `isOverlayLayer` already encodes exactly this predicate. |
| Presentation | **Floating panel over the map** | A panel has room for a full tag table without generalizing `MapRightDock` (a 220px fixed toggle-row renderer) or colliding with `MapLeftDock`. |
| Multi-hit layout | **List + selected detail** | One layout handles 1 or 12 hits. |
| Empty state | **Widen, then report** | Progressive re-query, then an explicit "nothing here" — never silence. |

### Accepted tradeoff

A panel moves the answer away from the point on the map the officer is looking
at. Mitigated by dropping a marker at the clicked point and highlighting the
hovered feature's geometry on the map, so panel rows stay visually tied to the
map. This is a mitigation, not an elimination, and was accepted knowingly.

---

## Architecture

### Module changes

| File | Change |
|---|---|
| `client/src/utils/osmFeatureDescription.ts` | **New.** Pure `describeOsmFeature(props, opts) → FeatureDescription`. The `FIELDS` table and every unit formatter move here. No HTML, no React, no Mapbox. |
| `client/src/utils/osmPopup.ts` | Becomes a thin HTML renderer over `describeOsmFeature`. Re-exports the formatters so existing imports and tests keep working. |
| `client/src/hooks/useMapFeatureInspect.ts` | Rewritten: synchronous, overlay-only, no network, returns structured results. |
| `client/src/pages/map/components/FeatureInspectorPanel.tsx` | **New.** Floating panel, list + selected detail. |
| `client/src/pages/map/MapboxMapPage.tsx` | Renders the panel. No dock wiring. |

### Why the description layer is extracted

`buildOsmPopupHtml` returns an HTML string, which is useless to a React panel.
Duplicating the field table into the panel would recreate the exact divergence
this design exists to remove. Splitting the *description* (what to say) from the
*rendering* (how to say it) lets the popup and the panel share one source of
truth for field selection, unit conversion, and ordering.

It also makes the logic testable by value rather than by regexing an HTML blob.

### `FeatureDescription`

```ts
export interface DescriptionRow {
  label: string;      // "Clearance"
  value: string;      // "12' 6\""   — already converted, already US units
  key: string;        // "maxheight" — original OSM tag, for keys/debugging
}

export interface FeatureDescription {
  title: string;                    // name, else categoryLabel, else "Feature"
  categoryLabel?: string;           // "Schools & childcare"
  groupLabel?: string;              // "Sensitive & high-risk sites"
  rows: DescriptionRow[];           // known fields, in FIELDS order
  extras: DescriptionRow[];         // captured tags absent from FIELDS (cap 8)
  coverage?: string;                // layer coverage caveat
  rmpg: {
    verified: boolean;
    verifiedAt?: string;            // YYYY-MM-DD
    note?: string;
    overriddenFields: string[];
  };
  provenance: {
    extractDate: string;
    editedDate?: string;            // from osm_timestamp
  };
  osmLink?: { id: string; url: string };  // canonical openstreetmap.org record
}
```

`describeOsmFeature` performs **no HTML escaping** — it returns plain values.
Escaping is the renderer's job: `osmPopup.ts` escapes on the way into
`innerHTML`; the React panel gets it for free from JSX. This must be stated in
the module docblock, because a value that is safe in JSX and unsafe in
`innerHTML` is exactly the kind of seam that rots into an injection bug.

---

## Behavior

### Hit testing

1. Click with Identify active.
2. `map.queryRenderedFeatures(box)` where `box` is an **8px square** around the
   click point — not an exact point, so a near-miss on a hydrant still
   registers.
3. Keep only features where `isOverlayLayer(feature.layer.id)` is true. This is
   the whole noise filter: `rmpg-coverage-gaps-fill`, `landuse`, and `road` all
   fail it, because `isOverlayLayer` returns true only for `vt-osm_*` config ids
   present in the generated catalog and the two UGRC layers.
4. Dedupe by `osm_id`; when absent, by `layerId + name`. A polygon spanning
   several tiles returns several features for one real-world object.
5. Rank by the catalog's `OSM_GROUPS` declaration order, then category order
   within the group, then name. This is deterministic and matches the order the
   same categories appear in the layer picker.

### Panel

- Header: hit count and the clicked coordinates.
- Ranked list: per-category icon, title, category label. The icon comes from
  `OSM_ICON_BY_CAT[cat].svg` in [`osmIcons.ts`](../../../client/src/utils/osmIcons.ts),
  so the panel and the map show the same silhouette for a category. That export
  is a raw SVG **string** built for `map.addImage`, not a React component, so the
  panel renders it via `dangerouslySetInnerHTML` — acceptable only because it is
  an in-repo constant and never OSM-derived text. A category with no registered
  icon falls back to a neutral marker glyph rather than rendering nothing.
  Selecting a row expands its full detail below; the first row
  is selected by default, so a single hit shows detail immediately with no
  extra click.
- Detail: `rows`, then `extras`, then the RMPG edit block, then provenance and
  the OSM link — the same order and content as the existing popup.
- Hovering a row highlights that feature's geometry on the map. This uses a
  dedicated GeoJSON highlight source fed the hovered feature's geometry —
  **not** `setFeatureState`, which requires a stable per-feature `id` that the
  OSM pmtiles archives do not guarantee. `queryRenderedFeatures` already hands
  back WGS84 GeoJSON geometry, so the highlight source needs no id at all.
- A marker drops at the clicked coordinate while a result is open.
- Dismissible; also cleared when Identify is toggled off.

Identify shows **no popup**. The direct feature-click popup wired in
[`useVectorTileLayers.ts:553`](../../../client/src/hooks/useVectorTileLayers.ts:553)
is untouched and keeps using `buildOsmPopupHtml`.

### No distance column in the normal path

Every hit inside an 8px box is within a few feet at any usable zoom. The
`4 ft` / `36 ft` values in the current popup are Tilequery artifacts dressed as
information. Distance appears **only** in the nearest-feature fallback, where it
is load-bearing.

### Empty state

Zero overlay hits at 8px → re-query at 40px → 120px. The first expansion that
returns a hit shows that feature with a real distance and bearing, e.g.
"Fire hydrant — 90 ft NE", computed with the already-exported
[`haversineDistance`](../../../client/src/utils/unitRecommendation.ts) against
the feature centroid, formatted through the existing `metresToUsDistance` and
`formatBearing` helpers.

Still nothing at 120px → a one-line "No overlay features here" with the
coordinates. The tool never goes silent, so "nothing here" is never confusable
with "the tool is broken or switched off."

`haversineDistance` is reused deliberately: there are already ten hand-rolled
haversine implementations in `client/src/utils/`, and `@turf/distance` is not
installed. Adding an eleventh, or a dependency, is not acceptable here.

---

## Deletions

- The Tilequery call and the `mapboxTilequery` import.
- The inline HTML template in the hook.
- The hook-local `esc()` duplicate.
- The hardcoded `slice(0, 15)` and `limit: 10`.
- `InspectedFeature.distance` in its current always-zero-or-Tilequery form.

`mapboxTilequery` in `mapboxApiService` has exactly one consumer — the line
being deleted — and becomes unused. **Leave the service export in place** and
note it. Widening this change into the API service layer buys nothing and adds
review surface.

---

## Testing

### `osmFeatureDescription` (pure, new)

Assert on values, not markup:

- `maxheight: "3.8"` → row `Clearance` = `12' 6"` (bare OSM value is metres)
- `maxspeed: "72"` → row `Speed limit` = `45 mph (72 km/h)`
- `maxspeed: "45 mph"` → passes through unchanged
- A tag absent from `FIELDS` lands in `extras`, capped at 8
- Absent fields are **omitted**, never rendered as "Unknown"
- `phone` and `contact:phone` collapse to one `Phone` row
- `__rmpg_*` markers populate `rmpg`, never `rows` or `extras`
- `osm_id: "w12345"` → `osmLink.url` ends `/way/12345`

### `osmPopup` (existing)

[`osmPopup.test.ts`](../../../client/src/utils/__tests__/osmPopup.test.ts) must
stay green **unmodified**. That is the proof the refactor changed no rendering.
A `<script>` in a name must still emerge escaped from `buildOsmPopupHtml`.

### `useMapFeatureInspect` (rewritten)

With a stubbed map whose `queryRenderedFeatures` returns the exact layer set
from the reported screenshot:

- `rmpg-coverage-gaps-fill`, `road`, and `landuse` are filtered out
- The `vt-osm_sites_school-*` hit survives
- Twelve input features yield **one** result — a direct regression test for the
  screenshot
- Duplicate `osm_id` across two features collapses to one
- Zero hits at 8px triggers the 40px re-query
- No network call is made

### Gates

Full client suite (`cd client && npx vitest run`), client typecheck, and
`vite build`. The baseline is clean, so any failure is caused by this change.

---

## Out of scope

Deliberately excluded, each with its own reason:

- **The ten duplicate haversines** — a real problem, unrelated to this feature.
- **Hex literals in `osmPopup.ts`** — the popup is being refactored, not
  re-themed; mixing a theme migration into a behavioral change makes both harder
  to review. The new React panel uses theme tokens from the start.
- **The overlay layer picker, the per-feature popup's field coverage, and the
  on-map labels/icons** — three separate areas the operator also wants improved.
  Each gets its own spec, plan, and PR.
