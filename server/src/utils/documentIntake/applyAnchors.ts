// ============================================================
// applyAnchors — shared anchor-pattern execution
// ============================================================
// Walks a FieldAnchor[] over the OCR'd text. First matching
// pattern per anchor wins; non-matching anchors emit a zero-
// confidence placeholder so the UI can show "not found" rather
// than dropping the field silently.

import type { FieldAnchor, ExtractedField } from './types';

const collapseWs = (s: string): string => s.replace(/\s+/g, ' ').trim();

export function applyAnchors(text: string, anchors: FieldAnchor[]): ExtractedField[] {
  const out: ExtractedField[] = [];
  for (const anchor of anchors) {
    let matched = false;
    for (const pattern of anchor.patterns) {
      const m = text.match(pattern);
      if (m && m[1]) {
        // When the anchor declares a postProcess, hand it the RAW match
        // (newlines preserved) so line-aware filtering can run. Without
        // a custom post-process, collapse whitespace as the safe default
        // — single-line anchors (DOB, case#, phone) want the trim.
        const value = anchor.postProcess
          ? anchor.postProcess(m[1])
          : collapseWs(m[1]);
        out.push({
          key: anchor.key,
          value,
          // Confidence model: first-pattern hit = 1.0, later
          // patterns shade down so the UI can flag "this matched
          // a fallback alias" for review-prone documents.
          confidence: 1 - (anchor.patterns.indexOf(pattern) * 0.15),
          matchedAnchor: anchor.label,
        });
        matched = true;
        break;
      }
    }
    if (!matched) {
      out.push({ key: anchor.key, value: '', confidence: 0, matchedAnchor: anchor.label });
    }
  }
  return out;
}

/**
 * Compute the rolled-up confidence: fraction of anchors that
 * matched, weighted by per-anchor confidence. A document with
 * 8 anchors and 6 high-confidence matches scores 0.75.
 */
export function rollupConfidence(fields: ExtractedField[]): number {
  if (fields.length === 0) return 0;
  const sum = fields.reduce((a, f) => a + f.confidence, 0);
  return sum / fields.length;
}
