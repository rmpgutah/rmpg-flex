# Map Tier-Color Hierarchy Design

**Date**: 2026-05-03
**Status**: Approved, ready for implementation plan
**Related**: builds on the Section/Zone/Beat alignment work shipped in commits `776539e8`..`1ad788c9` (rounds 1-8 of the 2026-05-03 chart-format session).

## Problem

The map currently renders all 269 beat polygons in a single shared color
(`#22c55e` @ 20% opacity). After the schema rebuild, every beat now has a
canonical hierarchy — Area → Section → Zone → Beat — that's invisible at a
glance. Dispatchers can read the chart code from labels but can't visually
group "all SL1 beats" or "everything in the Wasatch Front area" without
clicking through.

## Goal

Encode all four hierarchy tiers visually in the existing beat-polygon
rendering so dispatchers see operational structure at a glance, with no
new geometry surfaces and no extra fetches.

## Non-goals

- Live admin UI for editing tier colors (today: JSON or DB directly)
- Heatmap-style beat coloring (call density — separate visual axis)
- Mobile-specific tuning (covered in a separate ticket if Android tile
  rendering surfaces issues)
- Replacing the existing single-color "off" mode (kept as a fallback)

## Approach: Section fill + tier-encoded borders + area boundary line

| Channel | Tier | Visual encoding |
|---|---|---|
| Polygon **fill** | **Section** | `dispatch_sectors.color` @ 30% opacity (primary signal) |
| Polygon **border** | **Zone** | `dispatch_zones.color` @ 1.5 px solid (secondary) |
| Inter-area **line overlay** | **Area** | `dispatch_areas.color` @ 3 px @ 85% opacity, drawn only on the *boundary* between adjacent areas (dissolved geometry) |
| Centroid **label** | **Beat** | full chart code `SL1/MUR/A` in section color, 1px dark text-shadow |

Trade-offs vs. rejected alternatives:

| Approach | Why rejected |
|---|---|
| **A — Stratified opacity stack** (Area wash + Section fill + Zone hatch + Beat stroke) | Hatched fills aren't natively supported in Google Maps Data Layer; would require a custom `OverlayView` canvas. Visually busy at the wrong zoom. |
| **C — Tier-driven label + uniform fill** | Forces dispatchers to read labels to know the area/section. Loses at-a-glance signal that's the entire point. |

## Data flow

The existing `/api/dispatch/districts` route is the single source. After
last round's FK reconcile (`70031b4d`) it returns 269 rows with
sector/zone/beat codes joined. Two new SELECT columns needed (one route
edit):

```sql
ds.area_id          AS area_id,
ds.color            AS sector_color,
dz.color            AS zone_color
```

Client builds three lookup maps from the response:

| Map | Key | Value |
|---|---|---|
| `sectionColors` | `sector_code` ("SL1") | `sector_color` (or hash fallback) |
| `zoneColors` | `zone_code` ("SL1-MUR") | `zone_color` (or hash fallback) |
| `beatToArea` | `beat_code` ("SL1-MUR/A") | `area_id` |

For tiers without a stored `color`, derive via
`hashToHsl(code)` with golden-ratio hue distribution to guarantee 22
visually-distinct sector hues.

## Components

| File | Change | LOC est. |
|---|---|---|
| `server/src/routes/dispatch/aggregates.ts:843` | Add `ds.area_id`, `ds.color AS sector_color`, `dz.color AS zone_color` to SELECT | +3 |
| `client/src/utils/colorLookup.ts` (new) | `hashToHsl()` deterministic palette helper | +30 |
| `client/src/utils/dissolveAreas.ts` (new) | `dissolveBeatsByArea(features, beatToArea) → Feature<LineString>[]` using `@turf/dissolve` + ring extraction | +60 |
| `client/src/pages/map/MapPage.tsx:560` | Build `sectionColors`/`zoneColors`/`beatToArea` lookups in the `/dispatch/districts` resolver | +20 |
| `client/src/pages/map/MapPage.tsx` Spatial Layers panel | New toggle row `[ ] Hierarchy Colors`, default ON, persists in localStorage `rmpg.map.hierarchyColors` | +15 |
| `client/src/hooks/useGeoJsonLayers.ts` | New prop `hierarchyColors: { sectionColors, zoneColors, areaColors, beatToArea } \| undefined`. When defined, beat polygon styler uses fill+stroke from tables. When undefined, current single-color path. | +40 |
| `client/src/hooks/useGeoJsonLayers.ts` | Add 5-feature area-boundary line overlay (separate `data.Feature` collection above beats) when hierarchy colors active | +30 |
| `client/src/utils/__tests__/dissolveAreas.test.ts` (new) | 3 tests — see Testing | +50 |
| `client/src/utils/__tests__/colorLookup.test.ts` (new) | 3 tests — see Testing | +30 |

Total estimate: ~280 LOC across 7 files (3 new).

### Beat polygon styler (pseudocode)

```ts
function styleBeatPolygon(props: BeatProps): GeoStyle {
  if (!hierarchyColors) return DEFAULT_BEAT_STYLE;       // toggle off
  const sectorCode = beatLookup.get(props.beat_code)?.sector_code;
  const zoneCode   = beatLookup.get(props.beat_code)?.zone_code;
  if (!sectorCode) {                                     // unincorporated fallback
    return { fillColor: '#3a3a3a', fillOpacity: 0.20,
             strokeColor: '#444', strokeWeight: 1 };
  }
  return {
    fillColor:    hierarchyColors.sectionColors.get(sectorCode) ?? hashToHsl(sectorCode),
    fillOpacity:  0.30,
    strokeColor:  hierarchyColors.zoneColors.get(zoneCode) ?? '#666',
    strokeWeight: 1.5,
    strokePattern: zoneCode ? 'solid' : 'dashed',        // missing zone signal
  };
}
```

## Edge cases

| Case | Behavior |
|---|---|
| Beat with no `sector_id` (geofence-only / unincorporated) | Fill `#3a3a3a` @ 20%; default border; chart label degrades to bare `beat_code` |
| Beat with `sector_id` but no `zone_id` | Section fill normal; border `#666` 1px **dashed** (signals "no zone"); label `SECTION/—/beat_code` |
| Adjacent sections with collision-prone hues | Stored `dispatch_sectors.color` takes precedence; null falls back to `hashToHsl(sector_code)` with golden-ratio hue rotation guaranteeing >16° hue separation across 22 sectors |
| Beat label legibility against 30% fill | 1px dark text-shadow + `font-weight: bold` (matches existing label markers) |
| Zoom < 10 | Beat labels hidden (existing behavior); section fills + area boundaries remain |
| Zoom < 9 | Beat polygons hidden; only area-boundary lines + section-fill polygons visible (already 50× cheaper) |
| `/dispatch/districts` fetch fails (offline Electron) | Toggle disabled with tooltip "Districts unavailable offline"; map falls back to single-color beats |
| Toggle persistence | localStorage `rmpg.map.hierarchyColors` = `'on'` \| `'off'`. Default `'on'` |
| Dispatch console & other surfaces | Out of scope — map-only enhancement |

## Performance

| Concern | Cost | Mitigation |
|---|---|---|
| Color lookup map build on every map load | ~1 ms for 269 entries | Built once after `/dispatch/districts` resolves; cached in `useRef` keyed by response identity |
| `@turf/dissolve` of 269 beats by `area_id` | ~50 ms one-time | Runs once after both beats GeoJSON + districts resolve; cached in ref keyed by `(beatCount, areaCount)`; invalidated only if either count changes |
| Per-feature `setStyle` callback rebuild on pan/zoom | None | Google Maps Data Layer calls the styler lazily; lookups are O(1) Map gets |
| Bundle size of `@turf/dissolve` | ~12 KB gzipped (already a transitive of `@turf/turf`; needs explicit add if not) | Acceptable; lazy-imported only when hierarchy colors are enabled |
| Re-style on toggle flip | O(269) per polygon | Acceptable; one-shot when user clicks toggle |

## Testing

### Unit tests

`client/src/utils/__tests__/dissolveAreas.test.ts`
1. 4-beat fixture across 2 areas dissolves to exactly 2 boundary linestrings
2. Beats with no `area_id` are excluded from dissolve input
3. All-same-area input returns 1 outer-boundary linestring

`client/src/utils/__tests__/colorLookup.test.ts`
1. `hashToHsl` is deterministic for the same input
2. Returns syntactically valid HSL strings
3. 22 distinct sector_codes produce 22 hues all >16° apart on the wheel

### Manual visual verification (post-deploy)

- [ ] Toggle ON → 22 distinct beat fill colors visible at zoom 11
- [ ] Toggle ON → 5 area-boundary lines visible at zoom 8
- [ ] Toggle OFF → existing single-color beats, no area boundaries
- [ ] Zoom 9 → only area boundaries + section fills, no beat labels
- [ ] Zoom 8 → only area boundaries
- [ ] Click a beat → info window still shows full chart Section/Zone/Beat (no regression)
- [ ] localStorage state survives reload + Electron quit/restart
- [ ] Offline mode → toggle disabled with tooltip

### Smoke

Existing PDF + map smoke suites continue to pass with no changes.

## Rollout

1. Single deploy, no feature flag — toggle defaults ON; dispatchers can
   switch off if they hate it.
2. Bump SW `v489` → `v490`.
3. Add a 1-paragraph entry to the "Maps" section of CLAUDE.md so the
   tier-color contract is discoverable.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| `@turf/dissolve` produces unexpected geometry on edge-touching but not edge-sharing beats (Utah's beat polygons may have minor topology gaps) | Medium | Pre-validate dissolve output count = expected area count; if mismatch, log warning and fall back to per-beat boundary stroke |
| 22 stored `dispatch_sectors.color` values are insufficiently distinct | Medium | Hash-fallback ensures distinct hues; stored colors only used if present |
| Performance regression at low zoom on slow devices | Low | Polygons are already loaded; this change only restyles. Section-only mode at z<10 reduces per-frame draws |
| Toggle adds visual clutter that confuses dispatchers used to single-color | Low | Toggle off restores previous behavior identically |

## Future work (out of scope)

- Server route `/api/dispatch/geography/colors` that returns just the
  three color tables — would let other surfaces (dispatch console, PDFs)
  reuse the same palette without re-querying districts
- Admin UI tab to live-edit `dispatch_areas.color`/`sectors.color`/
  `zones.color` and watch the map repaint in real time
- Color-blind-friendly palette toggle (deuteranopia/protanopia variants)
