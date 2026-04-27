import { downloadRecordPdf } from '../recordPdfGenerator';

// ─────────────────────────────────────────────────────────────────────
// Single-engine PDF facade.
//
// The codebase historically had two PDF engines: v1 (legacy monolithic
// generators in pdfGenerator.ts / recordPdfGenerator.ts) and v2 (a
// schema-driven engine under ./v2). The v2 source is preserved on disk
// for future migration work, but is INTENTIONALLY NOT WIRED UP here —
// having two engines active confused the system. v1 is the single
// active engine for all PDF output.
//
// To migrate to v2 in the future, this is the only routing point that
// needs to change. Do that as a deliberate, scoped PR per form type
// with side-by-side visual review against v1, not a global flip.
// ─────────────────────────────────────────────────────────────────────

export async function downloadPdf(formType: string, data: unknown, filename: string): Promise<unknown> {
  return await downloadRecordPdf(formType as any, data as any, filename);
}

// Compat shims — kept so callers / tests that still import these don't
// break during cleanup. They are no-ops now that the single engine path
// has no flag cache to invalidate.
export function invalidateFlagsCache(): void { /* no-op (single engine) */ }
export function _resetFacadeCacheForTest(): void { /* no-op (single engine) */ }
export function _setFlagsForTest(_flags: Record<string, boolean>): void { /* no-op (single engine) */ }
