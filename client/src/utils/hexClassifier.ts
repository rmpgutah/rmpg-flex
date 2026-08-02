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
