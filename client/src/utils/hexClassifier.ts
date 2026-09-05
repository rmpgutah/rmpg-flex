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
  mapboxPaint: /(^|\/)(mapboxBasemap|mapboxSafeLayer|mapMarkers|mapboxMap|osmIconArt|osmIcons|osmCamera|osmOverlayStyle|AssignmentArcLayer)\.tsx?$/,
  // Canvas fingerprinting uses deliberately arbitrary sentinel colors; migrating
  // them to CSS vars changes the fingerprint signal and defeats the purpose.
  canvasFingerprint: /(^|\/)VerifyNoticePage\.tsx$|(^|\/)deviceCapture\.ts$/,
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
  // UnifiedMapLegend HSWATCH and county/municipality strokes must match
  // districtGeoData AREA_PALETTE and useGeoJsonLayers stroke hex.
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
  categoricalPalette: /(^|\/)(connectionsGraphStyle|geographyLabels|geoLayers)\.ts$/,
  // RouteBuilderPage feeds hex into Mapbox paint, marker DOM CSS, and popup HTML — CSS vars don't resolve there.
  mapboxRouteBuilder: /(^|\/)RouteBuilderPage\.(tsx)$/,
  // ForensicDashcamPlayer uses Canvas 2D API for evidence export — CSS vars don't resolve in canvas context.
  forensicDashcamCanvas: /(^|\/)ForensicDashcamPlayer\.(tsx)$/,
  // skipTracerPalette holds categorical identity colors per entity/engine type (same reason as connectionsGraphStyle).
  skipTracerPalette: /(^|\/)skipTracerPalette\.(ts)$/,
  // DesktopSystemPreferences holds ACCENT_PRESETS — a fixed color-picker palette
  // whose hex values are stored in localStorage and written directly to a CSS
  // custom property via style.setProperty('--desktop-shell-accent', hex).
  // Replacing them with var() names would break the color picker entirely since
  // setProperty expects a resolved color string, not a CSS function call.
  // DesktopLockScreen holds AVATAR_PALETTE — a fixed set of identity colors
  // used to assign a consistent avatar background per officer login name. These
  // are categorical identity values, not theme chrome.
  accentColorPicker: /(^|\/)DesktopSystemPreferences\.tsx$|(^|\/)DesktopLockScreen\.tsx$/,
  // Document Writer generates HTML content exported to standalone HTML, print
  // iframes, RTF, or .docx where CSS variables do not resolve. Hex defines the
  // output document appearance (police form borders, letterhead, stamps), not
  // app chrome. components/ subdirectory stays in-scope (DOM-rendering React).
  documentWriterContent: /(^|\/)document-writer\/(?!components\/)/,
  // Radio module constants — THEME_VARS defines the mini-theme palette (onyx/amber/nvg/
  // contrast/cyan/magenta) that is applied as CSS custom properties via style.setProperty
  // in RadioPage. Like mapboxBasemap.ts, the values here ARE the palette; using var()
  // would be circular. STATUS_QUICKSET and COLOR_LABELS are operational status data
  // values similar to AdminRadioTab's COLOR_SWATCHES.
  radioThemePalette: /(^|\/)radio\/constants\.(ts)$/,
  // Admin config tabs whose hex literals are stored data values, not CSS chrome:
  // AdminMapSettingsTab — Mapbox paint color defaults (CSS vars blank vector layers).
  // AdminSystemTab — color picker defaults persisted to D1 (var() writes literal string).
  // AdminRadioTab — COLOR_SWATCHES for <input type="color"> stored to API as hex.
  // AdminSkipTracerV2Tab — categorical identity colors per skip-tracer source.
  adminDataColorValues: /(^|\/)Admin(MapSettings|System|Radio|SkipTracerV2)Tab\.(tsx)$|(^|\/)hrConstants\.(ts)$/,
  // EmailPage has three categories of load-bearing color that cannot be tokens:
  // (1) CSS injected into isolated srcdoc iframe documents — var() cannot resolve
  //     inside an iframe's isolated document; literal values are required.
  // (2) Print stylesheet strings injected as string literals — same isolation issue.
  // (3) CATEGORY_PRESET_COLORS — user-assignable categorical identity colors stored
  //     as data values, not theme chrome (analogous to connectionsGraphStyle).
  emailIframePrintData: /(^|\/)EmailPage\.(tsx)$/,
  // FlexCamFootagePage uses Canvas 2D API for evidence export (captureAndDraw overlay):
  // ctx.fillStyle literals on lines 509/523/551/559/646 require resolved hex strings.
  // CSS variables do not resolve in a Canvas 2D context. UI chrome hex was migrated;
  // the canvas draw function retains literal amber/red values required for evidence export.
  flexCamCanvas: /(^|\/)FlexCamFootagePage\.(tsx)$/,
  // ConnectionsPage owns TIMELINE_KIND_COLOR — a categorical entity-type identity palette
  // identical in tuning rationale to connectionsGraphStyle.ts (collision-avoidance tuning,
  // same color set, referenced in comments). It also exports a PNG via canvas with a
  // literal background color. Re-theming either would change entity identity across the
  // timeline and relationship graph simultaneously.
  connectionsPageCategorical: /(^|\/)ConnectionsPage\.(tsx)$/,
  // ServePage has Mapbox GL line-color paint properties (lines 1884, 1931) that require
  // literal hex — CSS vars blank the layer. The marker DOM functions (buildServeJobMarkerElement,
  // buildServeClusterMarkerElement) and popup HTML buttons use resolved colors for the
  // Mapbox marker lifecycle where var() values cannot be guaranteed to resolve.
  serveMapboxPaint: /(^|\/)ServePage\.(tsx)$/,
  // Navigation module — tactical-dark and Mapbox-paint contexts:
  //
  // TripReplayMap.tsx — every hex literal is a Mapbox paint property
  // (line-color, circle-color, circle-stroke-color). CSS vars blank the layer.
  //
  // NavigationPage.tsx — mixed: Mapbox paint hex throughout (route layer,
  // crime heat, patrol breadcrumb, geofence corridor) plus tactical SVG
  // values pinned to the night palette so the HUD never blinds a driver.
  //
  // HudInstruments.tsx — the always-dark nav overlay. Values like #1c1c1c /
  // #3a3a3a / #f0d28a are intentionally pinned to the night palette (same
  // .tactical-dark rationale as mapboxBasemap.ts). Re-theming them would
  // make the HUD fight the map brightness.
  //
  // NavSettingsPanel.tsx — floats over the nav map with an explicit
  // rgba(5,5,5,0.95) near-black background. Its segmented controls use
  // #0a0a0a / #000 / #888 as tactical fixed values (same rationale).
  //
  // drivingScoreColor.ts / hudUnits.ts — return fixed operational-severity
  // tier colors (green/amber/red) that the test suite asserts on by literal
  // hex value. Changing to CSS vars would break those assertions, and the
  // severity palette is fixed CAD semantics, not theme chrome.
  navTacticalAndMapbox: /(^|\/)(TripReplayMap|NavigationPage|HudInstruments|NavSettingsPanel|drivingScoreColor|hudUnits)\.(tsx?|ts)$/,
  // NavMapView contains 22+ Mapbox paint property calls (addLayer line-color/circle-color/
  // circle-stroke-color) that require literal hex strings — CSS vars blank those layers.
  // The UI overlay elements are mixed throughout the same component with the paint calls,
  // making selective migration unsafe. Same rationale as NavigationPage.tsx exclusion.
  navMapViewMapboxPaint: /(^|\/)NavMapView\.(tsx)$/,
  // Map layer paint hooks — every hex literal feeds Mapbox GL addLayer / setPaintProperty /
  // setFilter paint expressions. CSS var() cannot resolve in those contexts; the layer silently
  // blanks. Covers: GeoJSON feature layers, vector-tile styling, route lines, geofence outlines,
  // incident markers, safety-zone fills, and draw-mode paint. useMapboxHistoryCalls is also
  // excluded under mapboxTactical above (via mapConstants) but its direct paint hook is here.
  mapboxLayerPaintHooks: /(^|\/)use(GeoJsonLayers|VectorTileLayers|MapRouting|MapGeofenceAlerts|MapboxIncidents|MapboxSafetyZones|MapboxDraw)\.(ts)$/,
  // useMapAtmosphere configures Mapbox GL fog / sky via map.setFog(). The setFog() API takes
  // the same literal color values as paint properties; CSS var() is not resolved there.
  mapboxAtmosphere: /(^|\/)useMapAtmosphere\.(ts)$/,
  // serveMapUtils builds Mapbox GL addLayer / addSource / setPaintProperty calls. CSS vars
  // cannot resolve in those contexts; literal hex is required for layer paint properties.
  serveMapUtils: /(^|\/)serveMapUtils\.(ts)$/,
  // statusColors defines UNIT_STATUS_HEX, PRIORITY_HEX, and priorityHex() which flow directly
  // into Mapbox addLayer circle-color paint expressions (useMapboxHistoryCalls, mapMarkers).
  // These are also operational-severity constants that tests assert on by literal value.
  statusColors: /(^|\/)statusColors\.(ts)$/,
  // useMapPlacesSearch and useMapInfoPanel build Mapbox popup / marker DOM via string
  // interpolation (el.style.cssText, .setHTML()). The operational colors (POI categories:
  // hospital=red, fire=orange, police=blue, etc.; unit=green, call=red, location=blue) have
  // fixed semantic meaning that does not map to CSS-var tokens — same rationale as ServePage.tsx.
  mapboxPopupOperationalColors: /(^|\/)use(MapPlacesSearch|MapInfoPanel)\.(ts)$/,
  // ServeIntakeMap and ServeRoutePlanner contain Mapbox GL addLayer paint properties
  // (line-color) and marker DOM el.style.cssText with resolved hex. CSS var() cannot
  // resolve in Mapbox paint or in style strings handed to the Mapbox marker lifecycle.
  // recordVisuals.ts defines BADGE_TONES — a fixed palette of text/bg/border/glow values
  // deliberately tuned to sit on the pure-black Spillman surface. The header comment
  // documents this intent: re-theming would break the tuned alpha ratios. Same rationale
  // as connectionsGraphStyle.ts (categorical palette, not theme chrome).
  recordBadgeTones: /(^|\/)recordVisuals\.(ts)$/,
  serveIntakeAndRoutePlannerMapbox: /(^|\/)(ServeIntakeMap|ServeRoutePlanner)\.(tsx)$/,
  // navMapHelpers supplies resolved color strings to map.setPaintProperty for route
  // line-color and position circle-color. Literal hex is required; CSS vars blank the layer.
  navMapHelpersMapboxPaint: /(^|\/)navMapHelpers\.(ts)$/,
  // networkGraph.ts configures Graphology/Sigma node and edge colors — third-party
  // graph viz library that consumes resolved hex strings directly.
  networkGraphViz: /(^|\/)networkGraph\.(ts)$/,
  // visTimeline.ts injects a CSS template string for the vis-timeline third-party library.
  // Hex values in those styles are scoped to the timeline's own DOM subtree and cannot
  // use CSS variables that live outside its shadow scope.
  visTimelineThirdParty: /(^|\/)visTimeline\.(ts)$/,
  // useMapWeatherAlerts feeds NWS alert polygon colors into Mapbox addLayer fill-color /
  // line-color paint expressions via ['get', 'color']. CSS var() does not resolve there.
  mapWeatherAlertsPaint: /(^|\/)useMapWeatherAlerts\.(ts)$/,
  // VideoHudOverlay renders a video HUD with fixed operational indicator colors:
  // EVIDENCE=yellow, FLAGGED=orange, RESTRICTED=red, GPS=green, REC=red.
  // These encode document-classification levels and recording state — fixed CAD semantics
  // that must remain constant regardless of theme, analogous to tactical-dark surfaces.
  videoHudOperational: /(^|\/)VideoHudOverlay\.(tsx)$/,
  // DashCamVideoPlayer is a tactical dashcam viewer surface (always-dark, same rationale as
  // HudInstruments). border-[#2b2b2b] / divide-[#2b2b2b] are intentional near-black separators
  // in the dashcam control bar; speed-indicator hex values are operational severity fixed to the
  // night palette so the dashcam UI never blinds a driver. CSS vars would change these under the
  // day theme and hurt usability.
  dashcamPlayerTactical: /(^|\/)DashCamVideoPlayer\.(tsx)$/,
  // useWhatsHere builds Mapbox popup HTML via template-string interpolation. The hex colors
  // (WHAT'S HERE header gold, label grey, premise stat amber) are inlined into a raw HTML string
  // handed to map.setPopup/.setHTML() — CSS var() cannot resolve inside Mapbox popup HTML.
  // Same rationale as mapboxPopupOperationalColors (useMapPlacesSearch / useMapInfoPanel).
  mapboxWhatsHerePopup: /(^|\/)useWhatsHere\.(ts)$/,
  // useMapWeatherRadar's legend color array represents the actual display colors of NOAA/NWS
  // radar tiles — they must match the pre-rendered radar imagery, not the app theme. Changing
  // them would misrepresent radar intensity to an officer reading the map.
  weatherRadarLegendColors: /(^|\/)useMapWeatherRadar\.(ts)$/,
  // Observable Plot API (fill / stroke / style.background) consumes resolved color strings —
  // var() is not meaningful as a Plot spec value.
  observablePlot: /(^|\/)observablePlot\.(ts)$/,
  // Mapbox popup HTML (setHTML / innerHTML) and paint-property hooks that feed addLayer
  // circle-color / line-color expressions. The BOOKMARK_COLORS / SHAPE_COLORS arrays feed
  // directly into Mapbox marker and layer paint; CSS vars cannot resolve there.
  mapboxBookmarksAndDrawing: /(^|\/)use(MapBookmarks|MapDrawing|MapClustering)\.(ts)$/,
  // Speed/response-time heatmap hooks — every hex is a Mapbox paint step expression value
  // (circle-color step, line-color case). These return resolved hex strings for Mapbox too.
  mapboxHeatmapHooks: /(^|\/)use(MapboxResponseTime|MapboxSpeedViolations)\.(ts)$/,
  // Choropleth and traffic layer hooks — Mapbox fill-color / line-color paint properties.
  mapboxChoroplethTraffic: /(^|\/)use(ActivityChoropleth|MapTraffic)\.(ts)$/,
  // District hierarchy: Mapbox paint (text-color, fill-color) plus popup HTML template strings.
  // osmPopup builds the "What's Here?" popup HTML via template literals handed to setHTML().
  mapboxDistrictPopupHtml: /(^|\/)use(DistrictHierarchyLayers)\.(ts)$|(^|\/)osmPopup\.(ts)$/,
  // Canvas 2D drawing — ctx.fillStyle / ctx.strokeStyle require resolved hex strings.
  // graphToPng: canvas background color. photoStamp: officer stamp overlay with ctx.fillStyle.
  // renderRedacted: canvas redaction bar with ctx.fillStyle. blur: canvas box fill.
  canvas2dDrawing: /(^|\/)(graphToPng|photoStamp)\.(ts)$|(^|\/)redaction\/(renderRedacted|blur)\.(ts)$/,
  // Excalidraw / tacticalWhiteboard API (strokeColor, viewBackgroundColor) consumes resolved
  // color strings — same reason as Observable Plot.
  excalidrawApi: /(^|\/)tacticalWhiteboard\.(ts)$/,
  // theme.ts passes resolved hex to <meta name="theme-color"> and Capacitor StatusBar.setBackgroundColor
  // — both are native browser/OS APIs that require literal hex strings, not CSS variables.
  // mapboxLoader.ts injects a CSS snippet into the Mapbox GL container and builds fill-extrusion
  // paint properties; CSS var() cannot resolve in either context.
  nativeThemeAndMapboxLoader: /(^|\/)theme\.(ts)$|(^|\/)mapboxLoader\.(ts)$/,
  // richTextEditor.ts creates React elements via React.createElement (no JSX) and assembles
  // class strings for a headless text editor. The active-format highlight (#d4a017 → token) is
  // an edge case but the file is a third-party-adapter integration that is safer to audit
  // manually than to auto-migrate; all other hex is tactical-dark editor chrome.
  richTextEditorIntegration: /(^|\/)richTextEditor\.(ts)$/,
  // alertFlash.ts applies a flash overlay to the document body using hex color strings that are
  // interpolated into a CSS rgba() call at runtime (peakAlpha is dynamic). The flash overlay
  // cannot use CSS variables because it is a transient imperative DOM mutation, not themed chrome.
  alertFlashRuntime: /(^|\/)alertFlash\.(ts)$/,
  // caseSla.ts returns operational severity color objects consumed by React inline styles.
  // navUnits.ts / tacticalForensics.ts return resolved hex strings for CAD severity tiers —
  // same pattern as drivingScoreColor.ts / hudUnits.ts (already excluded under navTacticalAndMapbox).
  cadSeverityColorHelpers: /(^|\/)caseSla\.(ts)$|(^|\/)navUnits\.(ts)$|(^|\/)tacticalForensics\.(ts)$/,
  // redaction module — both canvas2D files already covered above. uiTrapDiagnostic.ts injects
  // inline CSS strings that are removed from the DOM after a short timeout (diagnostic overlay);
  // the hex values never persist in styled components.
  uiTrapDiagnosticOverlay: /(^|\/)uiTrapDiagnostic\.(ts)$/,
  // Desktop canvas widgets that use Canvas 2D API for drawing (ctx.fillStyle / ctx.clearRect).
  // CSS variables cannot resolve in a canvas 2D context — same rationale as photoStamp.ts.
  // DesktopCitationGenerator: signature canvas with ctx.strokeStyle.
  // DesktopHotZonesWidget: heatmap drawing loop with ctx.fillStyle.
  desktopCanvas: /(^|\/)(DesktopCitationGenerator|DesktopHotZonesWidget)\.(tsx)$/,
  // Additional Mapbox paint hooks — hex flows into addLayer / setPaintProperty expressions.
  // CSS var() cannot resolve in Mapbox paint contexts; the layer silently blanks.
  // useMapMeasure / useMapMeasureDraw: ruler line-color + polygon fill-color paint.
  // useMapMatchTrace: trace line-color paint for GPS match overlays.
  // useMapboxRepeatAddresses: circle-color heat step expressions.
  // useMapboxHistoryCalls: circle-color / line-color paint for call history heatmap.
  // useMapboxPursuitSegments: line-color per pursuit segment.
  // useMapboxSpeedHeatmap: circle-color step expressions for speed violations.
  // useEventPlanning: fill-color / line-color per event zone polygon.
  // useMapCoordinateGrid: line-color for grid overlay.
  // useMapDaylight: addLayer fill-color for day/night shadow polygon.
  // useNavGuidanceEngine: Mapbox route paint + nav overlay resolved colors.
  // useMapDirectionsPanel: line-color paint for direction route layer.
  // useMapProjection: map.setFog() atmosphere API — same restriction as mapboxAtmosphere.
  // useMapPrintExport: Canvas 2D ctx.fillStyle for the print-export stamp overlay.
  mapboxAdditionalPaintHooks: /(^|\/)use(MapMeasure|MapMeasureDraw|MapMatchTrace|MapboxRepeatAddresses|MapboxHistoryCalls|MapboxPursuitSegments|MapboxSpeedHeatmap|MapHeatmap|MapboxCoverageGaps|EventPlanning|MapCoordinateGrid|MapDaylight|NavGuidanceEngine|MapDirectionsPanel|MapProjection|MapPrintExport)\.(ts)$/,
  // Operational severity / grade color helpers — return fixed color strings for CAD score tiers
  // (patrol zone grades A–F, subject risk levels low/moderate/high/extreme, shift type identity).
  // Same rationale as drivingScoreColor.ts / hudUnits.ts (excluded under navTacticalAndMapbox):
  // the severity palette encodes CAD semantics and tests assert on the literal values.
  cadGradeAndRiskColors: /(^|\/)use(PatrolZone|OfficerSafety)\.(ts)$|(^|\/)useShiftPlanning\.(ts)$/,
  // helpReferenceData.ts holds PRIORITY_LEVELS and UNIT_STATUS_CODES — CAD operational data
  // tables (P1–P5 priority colors, AVL/DSP/ONS unit status colors) whose hex values encode
  // the same fixed severity semantics as statusColors.ts. They are consumed as inline style
  // color strings in React components, not as theme chrome.
  cadReferenceDataColors: /(^|\/)helpReferenceData\.(ts)$/,
  // desktopAccents.ts defines ACCENT_PRESETS — a fixed color-picker palette whose hex values
  // are stored in localStorage and written directly to a CSS custom property via
  // style.setProperty('--desktop-shell-accent', hex). var() values would break the picker.
  desktopAccentPresets: /(^|\/)desktopAccents\.(ts)$/,
  // DesktopColorPicker is a hex color picker component — #3b82f6 default and preview swatch
  // are color DATA values (the picked color itself), not theme chrome. Same rationale as
  // AdminSystemTab color picker defaults.
  desktopColorPickerData: /(^|\/)DesktopColorPicker\.(tsx)$/,
  // PDF v2 engine — context.ts calls jsPDF setFillColor/setTextColor; style.ts is the
  // PDF design-token palette for printed document output. CSS vars are meaningless in jsPDF.
  pdfV2Engine: /(^|\/)pdf\/v2\//,
  // devtools/pdfGallery — fixture data files hold test/preview color values for the PDF
  // gallery renderer. renderToCanvas.ts uses Canvas 2D ctx.strokeStyle for geometry preview.
  // These are devtools-only and not production theme chrome.
  pdfGalleryDevtools: /(^|\/)devtools\//,
  // Operational severity / activity tier colors returned as string values for inline styles.
  // caseActivity.ts — GREEN/AMBER/GOLD/GRAY/RED tier palette for case activity event badges.
  // dispatchTimers.ts — returns timer status colors (green/amber/red) per operational tier.
  // alprSource.ts — ALPR source categorical identity colors (purple=dashcam, blue=camera, etc.).
  // dispositionCodes.ts — C_OK/C_NEUTRAL/C_ENF/C_NEG palette per disposition category.
  // accessibilityPreferences.ts — named high-contrast color preset values written to CSS vars via setProperty.
  // withAlpha.ts — hex manipulation utility; all hex in file is JSDoc documentation examples.
  // recordLinks.ts and markdown.tsx — isolated dark-surface inline styles / code-block styles not tied to theme.
  cadOperationalColorHelpers: /(^|\/)caseActivity\.(ts)$|(^|\/)dispatchTimers\.(ts)$|(^|\/)alprSource\.(ts)$|(^|\/)dispositionCodes\.(ts)$|(^|\/)accessibilityPreferences\.(ts)$|(^|\/)withAlpha\.(ts)$|(^|\/)recordLinks\.(ts)$|(^|\/)markdown\.(tsx)$/,
  // rmpg-pdf-engine native layer uses Canvas 2D ctx.fillStyle for PDF page rasterization.
  // CSS variables cannot resolve in a canvas 2D context.
  rmpgPdfEngineNative: /(^|\/)rmpg-pdf-engine\//,
  // Mixed Mapbox + React components — contain both addLayer/setPaintProperty paint calls
  // and React JSX. Excluding the whole file is safer than attempting to migrate individual
  // hex values: a wrong replacement in a paint expression silently blanks a map layer.
  // ConnectionsMapPanel: addLayer circle-color + fill-color + line-color for sightings map.
  // ForensicTrackMap: addLayer line-color for GPS trail rendering.
  // GeoDataMapView: addLayer fill-color / line-color for geographic data overlay.
  // SightingsMap: addLayer circle-color step expression for person sightings heat.
  // DashCamDetailPage: setPaintProperty line-color for dashcam route segment coloring.
  // PatrolPage: addLayer circle-color / line-color for patrol trail rendering.
  mixedMapboxReactComponents: /(^|\/)(ConnectionsMapPanel|ForensicTrackMap|GeoDataMapView|SightingsMap|DashCamDetailPage|PatrolPage)\.(tsx)$/,
  // RedactionStudio defines KIND_COLOR — a categorical identity palette per redaction kind
  // (plate=cyan, face=pink, person=lime, manual=gold). Each kind must be visually distinct in
  // the video overlay; re-theming would collapse those distinctions. Same rationale as
  // connectionsGraphStyle.ts categorical exclusion.
  redactionStudioCategorical: /(^|\/)RedactionStudio\.(tsx)$/,
  // LawBookPage defines CHAPTER_META — a categorical accent per Utah Code chapter type
  // (person, property, vehicle, juvenile, wildlife, alcohol, protective, fraud, …).
  // Each type must be visually distinct; re-theming would collapse those distinctions.
  // SEVERITY_CLASSES similarly assigns fixed operational severity identity colors.
  // Same rationale as connectionsGraphStyle.ts categorical exclusion.
  lawBookCategoricalPalette: /(^|\/)LawBookPage\.(tsx)$/,
  // SignaturePad uses Canvas 2D API (ctx.strokeStyle / ctx.fillStyle) for signature rendering.
  // CSS variables cannot resolve in a canvas 2D context.
  signaturePadCanvas: /(^|\/)SignaturePad\.(tsx)$/,
  // PersonIntelGraphTab uses react-force-graph-2d (canvas-rendered) for the force-directed
  // relationship graph. nodeColor/linkColor props and ctx.fillStyle are library/canvas APIs
  // that cannot accept CSS variables. backgroundColor is a direct library prop.
  intelForceGraphCanvas: /(^|\/)PersonIntelGraphTab\.(tsx)$/,
  // ContextMenu renders with explicit dark surface colors (#141414, #1e1e1e, #2a2a2a) pinned to
  // the tactical-dark palette — same rationale as NavSettingsPanel. The context menu appears
  // over any surface including map tiles and video, so it must always be near-black.
  contextMenuTactical: /(^|\/)ContextMenu\.(tsx)$/,
  // recordVisuals.ts defines a categorical badge-color palette (red, orange, amber, gold,
  // purple, pink, blue, teal, green, gray) for record severity visual tokens — each shade
  // used directly in style props. Same rationale as connectionsGraphStyle.ts exclusion.
  recordVisualsCategorical: /(^|\/)recordVisuals\.(ts)$/,
  // agendaToCalendarEvents.ts defines a categorical event-type palette (serve, shift, court,
  // custom, etc.). Each event type maps to a fixed, visually distinct color used directly by
  // the calendar library. Same rationale as connectionsGraphStyle.ts categorical exclusion.
  calendarEventTypePalette: /(^|\/)agendaToCalendarEvents\.(ts)$/,
  // The entire document-writer subtree produces document HTML/CSS content that is rendered
  // as the user's document (not the app's UI). HTML attribute strings (style="…") and
  // print CSS at-rules inside JS strings cannot reference CSS variables.
  // Covers: docActions*.ts, docTools.ts, features/*.ts, templates/**/*.ts, writer.css,
  // analysis.ts, types.ts, _shared.ts, components/AppearanceDialog.tsx (color picker input value).
  // DocumentWriterPage.tsx pageBg/textColor are also document-content colors, not app UI.
  documentWriterSubtree: /(^|\/)pages\/document-writer\//,
  // DashCameraTab renders status cards with near-black tinted backgrounds pinned to the
  // tactical-dark palette: #0a1a0a (green-tinted for Available), #1a150a (amber for
  // Maintenance), #1a0a0a (red for Damaged/Lost), #140a1a (purple for Videos). Each shade
  // encodes a distinct operational status and must remain visually distinct across themes.
  dashCamStatusCardsTactical: /(^|\/)DashCameraTab\.(tsx)$/,
  // FirecrawlTab includes an <input type="color"> for a user-selectable accent color
  // stored to the API. The input type="color" value attribute requires a 6-digit hex
  // string — CSS variables or named colors are not valid there.
  firecrawlColorPicker: /(^|\/)FirecrawlTab\.(tsx)$/,
  // Mapbox paint modules not yet covered by the mapboxPaint rule:
  // mapboxOptimizationLayer: route-color palette array feeding addLayer line-color paint.
  // mapCadInk: named export constants (MAP_CAD_INK, MAP_CAD_WARN, …) for Mapbox CAD paint.
  // useBeatCoverage: covered/undermanned/uncovered status colors for Mapbox fill paint.
  // CSS var() cannot resolve in Mapbox paint expressions; these layers silently blank.
  mapboxRemainingPaintModules: /(^|\/)(mapboxOptimizationLayer|mapCadInk|useBeatCoverage)\.(ts)$/,
  // Step5SignSubmit renders a signature capture canvas. The `backgroundColor: '#ffffff'` is the
  // required document-white canvas background for the signature output — it must be literal white
  // for the canvas to render the signature correctly regardless of the app theme.
  signatureDocumentCanvas: /(^|\/)Step5SignSubmit\.(tsx)$/,
  // Desktop screen saver surfaces — always-dark tactical display (runs on a full-screen pure-black
  // canvas set in DesktopScreenSaver.tsx). NVG night-vision reds (#ef4444, #dc2626), P1-Emergency
  // severity red, and battery-stealth slate (#64748b) are intentionally pinned to the night palette
  // (same rationale as HudInstruments / NavSettingsPanel). Migrating them would make the screen
  // saver fight the display environment. DesktopScreenSaverModes is excluded together because all
  // its hex lives on that same always-dark surface.
  desktopScreenSaverTactical: /(^|\/)DesktopScreenSaver(Modes)?\.(tsx)$/,
  // Desktop diagnostic display panels — always-dark surfaces (#0f172a, #0b1329, #090d16) showing
  // fixed data-display indicator colors (sky-400 for connectivity, amber for IP highlights, emerald
  // for OK/yes states). Same tactical-dark rationale as DashCamVideoPlayer: re-theming these would
  // make diagnostic readouts fight the always-dark UI environment.
  // DesktopEmergencyAccessModal is excluded for the same reason: its audit-log terminal uses green
  // (#10b981) as a fixed diagnostic-terminal color on a near-black backdrop, not theme chrome.
  desktopDiagnosticDisplays: /(^|\/)(Desktop500FeaturesBoard|DesktopHardwareTelemetryPanel|DesktopEmergencyAccessModal)\.(tsx)$/,
  // NewCallModal uses border-[var(--spm-border,#334155)] — the hex is a CSS-var fallback inside a
  // Tailwind arbitrary-value expression, already correctly using the CSS variable system.
  // AssignmentProposalModal uses var(--brand-blue,#1d4ed8) — same pattern, already var-backed.
  // DialerPanel has rgba(0,0,0,0.45) inside a Tailwind shadow utility — drop shadows are always black
  // and the opacity is the only meaningful value; CSS var() adds no semantic benefit here.
  // FileAttachments uses rgba(0,0,0,…) for lightbox gradient scrims and fullscreen overlay
  // backgrounds — black overlay scrims are always correct regardless of theme.
  // useIncidentHeatmap has rgba(0,0,0,0) as a Mapbox heatmap color stop (paint context).
  cssVarFallbacksAndOverlayScrims: /(^|\/)(NewCallModal|AssignmentProposalModal|DialerPanel|FileAttachments|useIncidentHeatmap)\.(tsx?)$/,
  // FeatureInspectorPanel has a single `color: '#0a1422'` on a button whose background is
  // `var(--brand-gold)` — which renders as silver in the blue-silver theme, as #d4a017 gold in the
  // night theme, and as #936c0a darker gold in the light theme. The dark-navy text is load-bearing
  // contrast: no single CSS surface token stays dark across all four theme variants (in the light
  // theme, --surface-sunken is #d6d3c8, which would fail contrast on #936c0a). Migrating this
  // single literal to a theme variable would regress accessibility in the light theme.
  brandGoldButtonContrastText: /(^|\/)FeatureInspectorPanel\.(tsx)$/,
};

export function classifyFile(path: string): 'excluded' | 'in-scope' {
  const normalized = path.replace(/\\/g, '/');
  for (const re of Object.values(EXCLUSION_REASONS)) {
    if (re.test(normalized)) return 'excluded';
  }
  return 'in-scope';
}
