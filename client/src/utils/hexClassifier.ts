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
  mapboxPaint: /(^|\/)(mapboxBasemap|mapboxSafeLayer|mapMarkers|mapboxMap)\.ts$/,
  // Tests and fixtures assert on literal values on purpose.
  tests: /(__tests__|\.test\.|\.spec\.)/,
  // The audit tooling itself must keep literal reference values.
  auditTooling: /(^|\/)(liveAudit|hexClassifier|chartPalette)\.ts$/,
};

export function classifyFile(path: string): 'excluded' | 'in-scope' {
  const normalized = path.replace(/\\/g, '/');
  for (const re of Object.values(EXCLUSION_REASONS)) {
    if (re.test(normalized)) return 'excluded';
  }
  return 'in-scope';
}
