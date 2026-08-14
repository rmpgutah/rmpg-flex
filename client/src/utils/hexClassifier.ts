// client/src/utils/hexClassifier.ts
// Decides whether a file's hex literals are migratable chrome or load-bearing.
//
// Roughly 5,690 hex literals live across 549 client files, and a blind
// hex-to-token sweep breaks five separate categories. Exclusions are therefore
// deny-by-default and matched on path, because the cost of wrongly migrating a
// PDF color argument or a Mapbox paint literal is a broken document or a blank
// map, while the cost of wrongly excluding a file is only that a human looks at
// it later.

export const EXCLUSION_REASONS: Record<string, RegExp> = {
  // jsPDF / pdf-lib take literal color arguments; CSS variables are meaningless.
  pdfGenerator: /(^|\/)[^/]*[Pp]df[^/]*\.(ts|tsx)$/,
  pdfEditorCanvas: /(^|\/)pdf-editor\//,
  // Mapbox GL rejects var(--x); these modules own resolved color strings.
  //
  // osmIconArt/osmIcons are the same case one step removed: their hex ends up
  // inside SVG strings that are rasterized to ImageData and handed to
  // map.addImage. A var() never resolves there — the icon decodes to a
  // transparent bitmap and the symbol layer renders nothing, silently. The
  // material ramps (7-stop cylinder shading, specular bands) are also art, not
  // chrome: re-theming them onto a navy ramp would flatten the illustrations.
  mapboxPaint: /(^|\/)(mapboxBasemap|mapboxSafeLayer|mapMarkers|mapboxMap|osmIconArt|osmIcons)\.ts$/,
  // Tactical palette + map config: resolved hex for Mapbox markers, popup HTML
  // strings, and layer paint properties. The map tactical surface forces
  // .tactical-dark always (a bright map blinds a driver at night), so these
  // values are deliberately pinned to the night palette rather than CSS vars.
  // tacticalPalette.ts is the single source of those values; keep in sync with
  // the :root/.tactical-dark block in theme-palettes.css if the night palette ever
  // changes. Similarly, mapConstants.ts holds UNIT_STATUS_COLORS / priorityHex
  // that feed Mapbox marker paint; useMap3D / useMapBreadcrumbs / useMapConfig
  // all feed Mapbox layer paint properties that require literal hex strings.
  // districtGeoData.ts + landTypes.ts supply color values that flow into
  // Mapbox fill-color / line-color expressions via ['get', 'color'].
  mapboxTactical: /(^|\/)(tacticalPalette|mapConstants|useMap3D|useMapBreadcrumbs|useMapConfig|districtGeoData|landTypes)\.(ts|tsx)$/,
  // Color-picker tools where user-selected hex is also stored as a Mapbox paint
  // value (annotation.color → 'circle-color': ['get', 'color'], buffer/geofence
  // fill/stroke). The COLORS array values feed Mapbox directly; using CSS vars
  // would silently blank those layers. GpsReplayTool / NavOverlayTool have no
  // UI hex — all hex in those files is Mapbox line/circle paint.
  mapboxColorPickerTools: /(^|\/)(AnnotationTool|BufferRingTool|DrawGeofenceTool|GpsReplayTool|NavOverlayTool)\.(tsx)$/,
  // UnifiedMapLegend owns HSWATCH (hierarchy swatch colors that must match the
  // AREA_PALETTE Mapbox expressions in districtGeoData.ts — changing them would
  // make the legend lie about what color the map uses for each hierarchy level)
  // and the county/municipality line swatch hex values (#9a9a9a, #c9c9c9) which
  // similarly mirror the Mapbox layer stroke colors in useVectorTileLayers.ts.
  // These are categorical data-identity colors, not theme chrome.
  mapboxLegendSwatches: /(^|\/)UnifiedMapLegend\.(tsx)$/,
  // Tests and fixtures assert on literal values on purpose.
  tests: /(__tests__|\.test\.|\.spec\.)/,
  // The audit tooling itself must keep literal reference values.
  auditTooling: /(^|\/)(liveAudit|hexClassifier|chartPalette)\.ts$/,
  // Fixed CATEGORICAL palettes — the colors ARE the data, not chrome.
  //
  // connectionsGraphStyle.ts assigns one color per entity type in the relationship
  // graph, and its header documents deliberate collision-avoidance tuning
  // ("person + case both #d4a017 -> case bumped to #84cc16 lime"; "evidence +
  // arrest both #ef4444 -> arrest bumped to #f43f5e rose"). Every type must stay
  // visually distinct from every other type; re-theming them onto a navy/silver
  // ramp would collapse those distinctions and undo the tuning.
  //
  // geographyLabels.ts assigns identity colors to districts and sectors
  // (SL1-SL6, DV1-DV3, WB1-WB2, UC1-UC3) plus fallback ramps. Operators learn
  // these by sight — "SL2 is the gold one" — so recoloring changes district
  // identity on the map, not just its styling.
  categoricalPalette: /(^|\/)(connectionsGraphStyle|geographyLabels)\.ts$/,
};

export function classifyFile(path: string): 'excluded' | 'in-scope' {
  const normalized = path.replace(/\\/g, '/');
  for (const re of Object.values(EXCLUSION_REASONS)) {
    if (re.test(normalized)) return 'excluded';
  }
  return 'in-scope';
}
