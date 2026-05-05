// ============================================================
// documentIntake/types — public shapes for the intake framework
// ============================================================
// The framework's job: given a PDF (born-digital or scanned),
// return a structured field bag that a clerk can review and
// commit into Dispatch/Records. It deliberately does NOT write
// to the DB — every intake flow uses a "review then save"
// pattern so a regex miss can never silently corrupt records.
//
// Coverage tiers (see extractors/index.ts):
//   - implemented: full anchor map, tested against synthetic
//     samples that match the expected layout.
//   - stub: registered with a minimal anchor set; returns
//     low-confidence results until real samples are calibrated.
//
// The clerk UI threshold: confidence < 0.5 should always be
// reviewed; >= 0.7 is a reasonable auto-accept default for
// fields that aren't safety-critical.

export type DocumentKind =
  // Court Records
  | 'court_warrant'
  | 'court_order'
  | 'trespass_order'
  | 'court_summons'
  | 'protective_order'
  // ICU Investigations
  | 'witness_statement'
  | 'evidence_log'
  | 'investigation_report'
  | 'search_warrant_return'
  // Information Forms
  | 'info_form'
  | 'supplemental_report'
  // Field Sheets
  | 'fi_card'
  | 'field_contact_report'
  // Catch-all
  | 'unknown';

export interface ExtractedField {
  /** System-canonical key (e.g. 'defendant_name', 'docket_number'). */
  key: string;
  /** Extracted value as string (callers convert to date/number as needed). */
  value: string;
  /** 0–1 confidence. 1 = anchor matched exactly; 0.5 = fuzzy match; 0 = scanner heuristic only. */
  confidence: number;
  /** Optional anchor label that produced the match — useful for UI debug. */
  matchedAnchor?: string;
}

export interface DocumentExtraction {
  kind: DocumentKind;
  /** Coverage tier — set by the extractor registration, NOT computed. */
  tier: 'implemented' | 'stub';
  /** Best-effort sub-classification (e.g. 'bench_warrant', 'criminal_warrant'). */
  subtype?: string;
  /** Structured fields keyed by canonical name. Same order as the extractor's anchor list. */
  fields: ExtractedField[];
  /** 0–1 score = (anchor-matched fields) / (total expected fields). */
  confidence: number;
  /** Page count from pdftotext / ocrmypdf. */
  pageCount: number;
  /** Whether the extractor ran on OCR'd text (true) or pdftotext output (false). */
  usedOcr: boolean;
  /** Raw extracted text — capped at 50KB so the response stays bounded. */
  rawTextPreview: string;
  /** Detector category from courtFormDetector if this was a court form, else null. */
  courtCategory?: string | null;
  /** Two-letter state code if detected. */
  state?: string | null;
}

/**
 * An anchor pattern bundle: each entry captures one logical field
 * with multiple regex alternatives (different vendor templates).
 * The first alternative that matches wins.
 *
 * Conventions:
 *   - Always use case-insensitive (`i`) flag.
 *   - Capture group 1 is the value.
 *   - Trim and collapse internal whitespace at extraction time.
 */
export interface FieldAnchor {
  /** Canonical key written to ExtractedField.key. */
  key: string;
  /** Human label for UI labels and matchedAnchor diagnostics. */
  label: string;
  /** Ordered regex alternatives — first match wins. */
  patterns: RegExp[];
  /** Optional post-processor (date normalisation, name casing, etc.). */
  postProcess?: (raw: string) => string;
}

export interface DocumentExtractor {
  kind: DocumentKind;
  tier: 'implemented' | 'stub';
  /**
   * Heuristic detector — ran when the upstream classifier is
   * unsure. Should return a 0–1 likelihood that the text
   * belongs to this kind based on header/title patterns.
   */
  detect: (text: string) => number;
  anchors: FieldAnchor[];
  /**
   * Optional override for full extraction — used when the kind
   * needs scanner-driven extraction (e.g. multiple witness blocks)
   * rather than flat anchor-per-field. Falls back to the default
   * applyAnchors() implementation when unset.
   */
  extract?: (text: string) => ExtractedField[];
}
