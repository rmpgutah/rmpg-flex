# Property Location Map — Real Boundaries + Site-Survey Observations

**Status:** Approved for spec review.

## Background

The property/business "Location Map" section (`addLocationMapSection()` in
`client/src/utils/recordPdfGenerator.ts`, shared with the CFS call map) was
recently reworked into a monochrome technical-blueprint style
([2026-07-03-v1-report-color-restoration-letterhead-design.md](2026-07-03-v1-report-color-restoration-letterhead-design.md),
[2026-07-04 zoom/blueprint follow-ups](../plans/)). The user asked for two
further additions:

1. A drawn building footprint and property line on the map.
2. Markers for site-survey observations (vehicles, trees, mailboxes, etc.)
   plotted on the map.

Neither exists today, and — critically — **no real geometry or observation
data exists anywhere in the codebase to draw from**. The existing Salt Lake
County Assessor integration (`src/utils/sl-assessor/`) only has numeric/text
parcel attributes (square footage, owner, sale price); it has zero polygon
geometry. Drawing an invented building outline on an official property
record would be fabricating a fact on a law-enforcement document, so this
spec is scoped around sourcing REAL geometry, not approximating one.

## Research finding (grounds this spec)

Confirmed via live query (not assumed): Salt Lake County / Utah SGID publish
public, no-auth ArcGIS FeatureServers with real polygon geometry:

- **Parcel boundaries**: `https://services1.arcgis.com/99lidPhWCzftIe9K/arcgis/rest/services/Parcels_SaltLake_LIR/FeatureServer/0/query` — queryable by `PARCEL_ID` (`where=PARCEL_ID='...'`) or by address (`where=PARCEL_ADD LIKE '%...%'`) or by point (`geometryType=esriGeometryPoint`). Returns `esriGeometryPolygon` rings, `f=geojson` supported, `outFields=*` returns `BLDG_SQFT`/`BUILT_YR`/`SUBDIV_NAME` alongside the boundary.
- **Building footprints**: `https://services1.arcgis.com/DJP723NX3ukQ2LtF/arcgis/rest/services/SLCo_BuildingFootprints/FeatureServer/0/query` — real polygons, `PARCEL_ID`-joinable (though many footprint rows have null `ADDRESS`/`PARCEL_ID` — join by spatial intersection with the parcel polygon, not by the null attribute fields, when precision matters).

Both are subject to Esri's default ~2000-record page limit (paginate via
`resultOffset` if ever needed — a single-parcel query never hits this) and
the building-footprint layer's license explicitly disclaims survey/legal
accuracy ("not field verified... not intended to... replace a certified
boundary survey") — fine for a CAD/RMS visual reference, not for legal
boundary determinations. The rendered map must carry a caption saying so.

The existing Assessor scraper already stores `parcel_number` on
`properties`/`businesses` after backfill (`src/routes/assessor.ts`), which is
the same identifier these GIS services query by — real join key already
exists, no new lookup step needed when a parcel number is on file.

## Scope

**In scope:**
1. A Worker-side proxy route (`GET /api/parcel-geometry`) that queries both
   FeatureServers by `parcel_number` (falling back to a lat/lng point query
   when no parcel number is on file) and returns simplified GeoJSON — parcel
   boundary ring + building footprint ring(s), each with a small metadata
   set. Lightly KV-cached (same pattern as the existing Mapbox proxy) since
   boundaries don't change often.
2. `addLocationMapSection()` fetches this once per property/business map
   render, converts the returned lng/lat rings to page coordinates using the
   SAME Web Mercator math the function already uses for hazard-diamond
   placement, and draws them as jsPDF vector paths: property line dashed,
   building footprint solid — both in the existing navy/black blueprint
   palette, not a new color.
3. A caption line under the map: "Boundaries per Salt Lake Co. GIS — not a
   certified survey" whenever a boundary/footprint was actually drawn.
4. A new `property_site_observations` table (migration) + CRUD Worker route
   + a small "Site Observations" panel on the property/business record page
   (add an entry: type from a short enum — VEHICLE / TREE / MAILBOX /
   OTHER — plus a label and a position, either dropped on the existing
   live Mapbox view or entered as lat/lng).
5. The PDF map plots each observation as a small lettered marker (same
   visual pattern as the existing hazard diamonds — letter-in-shape, cased
   white/dark stroke) with a legend row listing type + label underneath the
   map, inside the existing LOCATION DATA grid area.

**Out of scope:**
- Legal/certified survey accuracy — explicitly disclaimed per the data
  source's own license.
- Applying boundary/footprint drawing to the CFS call map (shares the same
  function, but calls report on a call location, not a property the org
  tracks — parcel_number isn't available there; skip unless requested).
- Editing/deleting observations from the PDF itself (PDF is read-only
  output; management happens in the app).
- Historical observation tracking/audit trail beyond the standard
  `recordAudit()` seam already used app-wide.

## Data Model

```sql
CREATE TABLE IF NOT EXISTS property_site_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL,
  record_type TEXT NOT NULL DEFAULT 'property', -- 'property' | 'business' (mirrors the properties/businesses split)
  observation_type TEXT NOT NULL, -- 'vehicle' | 'tree' | 'mailbox' | 'other'
  label TEXT,
  notes TEXT,
  latitude REAL,
  longitude REAL,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_property_site_obs_property ON property_site_observations(property_id, record_type);
```

## API

- `GET /api/parcel-geometry?parcel_number=...` or `?lat=...&lng=...` → `{ parcelBoundary: GeoJSON.Polygon | null, buildingFootprints: GeoJSON.Polygon[] }`. Returns `{ parcelBoundary: null, buildingFootprints: [] }` (200, not an error) when nothing is found — the map section already handles an absent overlay gracefully (same pattern as absent hazards today).
- `GET /api/properties/:id/observations` / `POST` / `DELETE /:obsId` — standard CRUD, auth-gated same as other property sub-resources.

## Rendering detail

Both the boundary ring and footprint ring(s) reuse the exact Mercator
projection helpers already inline in `addLocationMapSection()` (`mercX`/
`mercY`/`pxPerMmX`/`pxPerMmY` — currently duplicated per-call; this program
should extract them into a small shared helper since three features now need
the same math: hazards, this, and route baking). Property line: `setLineDash`
if available (same guarded pattern already used for range rings), navy,
1px. Building footprint: solid navy, slightly heavier line weight, filled
with a very light navy tint (near-transparent) so it reads as "the
structure" against the blueprint base without competing with the map's own
line art.

Observation markers reuse the same lettered-diamond drawing helper as
hazards (extract that into a shared `drawMapMarker()` if it isn't already
factored out) with a distinct shape (small circle, not diamond, to visually
distinguish "officer-logged observation" from "GIS hazard proximity") and a
neutral gray fill (not the hazard red — these aren't safety warnings).

## Testing

- Worker route: unit test the GeoJSON→simplified-shape transform with a
  fixture response (don't hit the live ArcGIS service in CI).
- Client: extend `recordPdfGenerator.smoke.test.ts` to confirm a property
  render with a mocked `/api/parcel-geometry` response doesn't throw and
  produces more page content; a null-response case behaves identically to
  today (no crash, map renders without the overlay).
- Existing Mercator-math tests (if any) extended to cover the extracted
  shared helper.
