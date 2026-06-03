// ============================================================
// RMPG Flex — Document Intake extraction (deterministic, container-free)
// ============================================================
// Classifies a law-enforcement document from its extracted text and
// pulls structured fields via label anchors. NO AI, NO container —
// the PDF_TOOLS container is intentionally off in prod (see memory
// project-pdf-tools-container-off), so text arrives already extracted
// by the client's pdfjs pass (DocumentIntakePage), and we do
// deterministic, unit-testable anchor matching here.
//
// The output envelope (DocumentExtraction) is consumed verbatim by
// client/src/components/DocumentIntakeReviewer.tsx — keep the shape in
// lock-step. The field KEYS per kind are the ones
// client/src/utils/documentIntakeSaveHandlers.ts reads when building
// the destination-record payload (warrant / FI / supplement), so the
// review→save flow round-trips cleanly.
//
// Extraction is best-effort by design: every field surfaces with a
// confidence the reviewer renders as a color, and the clerk verifies
// and edits before saving. Partial/low-confidence extraction is the
// expected path, not a failure.

export interface ExtractedField {
  key: string;
  value: string;
  confidence: number;       // 0..1
  matchedAnchor?: string;   // the label text we anchored on (UI shows it)
}

export interface DocumentExtraction {
  kind: string;
  tier: 'implemented' | 'stub';
  fields: ExtractedField[];
  confidence: number;       // overall, 0..1
  pageCount: number;
  usedOcr: boolean;
  rawTextPreview: string;
  courtCategory?: string | null;
  state?: string | null;
}

type FieldType = 'text' | 'date' | 'money' | 'name' | 'multiline';

interface FieldDef {
  key: string;
  /** Label synonyms to anchor on (case-insensitive, whitespace-flexible). */
  labels: string[];
  type: FieldType;
}

// Known label keywords used to STOP a captured value (so
// "JOHN SMITH DOB 01/02/1990" anchored on "Name" yields "JOHN SMITH",
// not the trailing DOB). Built from every label across all kinds.
const STOP_LABELS = [
  'DOB', 'D.O.B', 'Date of Birth', 'Date', 'Charge', 'Charges', 'Bond', 'Bail',
  'Docket', 'Case', 'Court', 'Judge', 'Address', 'Phone', 'Plate', 'Vehicle',
  'Reason', 'Action', 'Disposition', 'Location', 'Officer', 'Subject', 'Witness',
  'Defendant', 'Issued', 'Reference', 'Occurrence', 'Reporting', 'Narrative',
  'Statement', 'Contact', 'Incident', 'Type', 'SSN', 'Race', 'Sex', 'Height',
  'Weight',
];

// ── Per-kind field definitions ──────────────────────────────
// Keys MUST match what documentIntakeSaveHandlers.ts reads.
const FIELD_DEFS: Record<string, FieldDef[]> = {
  court_warrant: [
    { key: 'warrant_type', labels: ['Warrant Type', 'Type of Warrant', 'Warrant'], type: 'text' },
    { key: 'defendant_name', labels: ['Defendant', 'Defendant Name', 'Name of Defendant', 'In re', 'The State of .* vs\\.?', 'vs\\.?'], type: 'name' },
    { key: 'defendant_dob', labels: ['DOB', 'D\\.O\\.B', 'Date of Birth'], type: 'date' },
    { key: 'docket_number', labels: ['Docket No', 'Docket Number', 'Docket', 'Case No', 'Case Number', 'Cause No'], type: 'text' },
    { key: 'charges', labels: ['Charges', 'Charge', 'Offense', 'Offenses', 'Count', 'Violation'], type: 'multiline' },
    { key: 'bond_amount', labels: ['Bond Amount', 'Bond', 'Bail Amount', 'Bail', 'Bail set at'], type: 'money' },
    { key: 'court_name', labels: ['Court', 'Issuing Court', 'In the .* Court'], type: 'text' },
    { key: 'issuing_judge', labels: ['Judge', 'Issuing Judge', 'Honorable', 'By the Court'], type: 'name' },
    { key: 'issued_date', labels: ['Issued', 'Date Issued', 'Issued on', 'Dated'], type: 'date' },
  ],
  fi_card: [
    { key: 'subject_name', labels: ['Subject', 'Subject Name', 'Name', 'Individual'], type: 'name' },
    { key: 'subject_dob', labels: ['DOB', 'D\\.O\\.B', 'Date of Birth'], type: 'date' },
    { key: 'subject_address', labels: ['Address', 'Home Address', 'Residence'], type: 'text' },
    { key: 'phone', labels: ['Phone', 'Telephone', 'Cell', 'Contact Number'], type: 'text' },
    { key: 'contact_date', labels: ['Date of Contact', 'Contact Date', 'Date'], type: 'date' },
    { key: 'contact_location', labels: ['Location of Contact', 'Contact Location', 'Location'], type: 'text' },
    { key: 'reason_for_contact', labels: ['Reason for Contact', 'Reason', 'Basis for Stop'], type: 'multiline' },
    { key: 'action_taken', labels: ['Action Taken', 'Disposition', 'Outcome'], type: 'multiline' },
    { key: 'vehicle_plate', labels: ['Plate', 'License Plate', 'Tag'], type: 'text' },
    { key: 'vehicle_description', labels: ['Vehicle', 'Vehicle Description', 'Veh'], type: 'text' },
  ],
  witness_statement: [
    { key: 'witness_name', labels: ['Witness', 'Witness Name', 'Statement of', 'Name'], type: 'name' },
    { key: 'witness_dob', labels: ['DOB', 'D\\.O\\.B', 'Date of Birth'], type: 'date' },
    { key: 'witness_address', labels: ['Address', 'Home Address', 'Residence'], type: 'text' },
    { key: 'witness_phone', labels: ['Phone', 'Telephone', 'Cell'], type: 'text' },
    { key: 'interviewing_officer', labels: ['Interviewing Officer', 'Officer', 'Taken by'], type: 'name' },
    { key: 'incident_date', labels: ['Incident Date', 'Date of Incident', 'Date'], type: 'date' },
    { key: 'incident_location', labels: ['Incident Location', 'Location of Incident', 'Location'], type: 'text' },
    { key: 'statement_body', labels: ['Statement', 'I,? .* state', 'The following'], type: 'multiline' },
  ],
  info_form: [
    { key: 'reference_number', labels: ['Reference No', 'Reference Number', 'Report No', 'Case No', 'Ref'], type: 'text' },
    { key: 'subject_name', labels: ['Subject', 'Subject Name', 'Name'], type: 'name' },
    { key: 'subject_dob', labels: ['DOB', 'D\\.O\\.B', 'Date of Birth'], type: 'date' },
    { key: 'subject_address', labels: ['Address', 'Home Address', 'Residence'], type: 'text' },
    { key: 'subject_phone', labels: ['Phone', 'Telephone', 'Cell'], type: 'text' },
    { key: 'occurrence_date', labels: ['Occurrence Date', 'Date of Occurrence', 'Date'], type: 'date' },
    { key: 'occurrence_location', labels: ['Occurrence Location', 'Location'], type: 'text' },
    { key: 'reporting_party', labels: ['Reporting Party', 'Complainant', 'RP'], type: 'name' },
    { key: 'reporting_officer', labels: ['Reporting Officer', 'Officer', 'Reported by'], type: 'name' },
    { key: 'narrative', labels: ['Narrative', 'Details', 'Summary', 'Description'], type: 'multiline' },
  ],
};

// info_form and supplemental_report share the same field set + save builder.
FIELD_DEFS.supplemental_report = FIELD_DEFS.info_form;

const IMPLEMENTED_KINDS = new Set(Object.keys(FIELD_DEFS));

// ── Classification ──────────────────────────────────────────
interface KindSignal { kind: string; patterns: RegExp[]; weight?: number }

const KIND_SIGNALS: KindSignal[] = [
  { kind: 'court_warrant', patterns: [/\bwarrant\b/i, /\b(bench|arrest|failure to appear|FTA)\b/i, /\b(bond|bail|docket|defendant|issuing judge)\b/i] },
  { kind: 'witness_statement', patterns: [/\bwitness statement\b/i, /\bstatement of\b/i, /\bi,? .{0,40}\bdeclare\b/i, /\bunder penalty of perjury\b/i] },
  { kind: 'fi_card', patterns: [/\bfield (interview|contact|interrogation)\b/i, /\bFI card\b/i, /\breason for contact\b/i, /\bsubject\b.*\bstop\b/i] },
  { kind: 'info_form', patterns: [/\binformation (report|form)\b/i, /\binfo report\b/i, /\breporting party\b/i, /\bsupplement(al)?\b/i] },
];

export function classifyDocument(text: string): { kind: string; confidence: number; courtCategory: string | null; state: string | null } {
  const scores = KIND_SIGNALS.map((sig) => {
    const hits = sig.patterns.reduce((n, p) => n + (p.test(text) ? 1 : 0), 0);
    return { kind: sig.kind, score: hits / sig.patterns.length };
  });
  scores.sort((a, b) => b.score - a.score);
  const top = scores[0];
  const kind = top && top.score >= 0.34 ? top.kind : 'unknown';
  // Confidence in the classification itself (separates a clear win from a tie).
  const runnerUp = scores[1]?.score ?? 0;
  const classConfidence = top ? Math.min(1, top.score + (top.score - runnerUp) * 0.5) : 0;

  return {
    kind,
    confidence: kind === 'unknown' ? 0 : classConfidence,
    courtCategory: detectCourtCategory(text),
    state: detectState(text),
  };
}

function detectCourtCategory(text: string): string | null {
  if (/\bjustice court\b/i.test(text)) return 'Justice Court';
  if (/\bdistrict court\b/i.test(text)) return 'District Court';
  if (/\bjuvenile court\b/i.test(text)) return 'Juvenile Court';
  if (/\bmunicipal court\b/i.test(text)) return 'Municipal Court';
  if (/\bappeals?\b/i.test(text) && /\bcourt\b/i.test(text)) return 'Court of Appeals';
  return null;
}

function detectState(text: string): string | null {
  const m = text.match(/\bstate of ([A-Z][a-zA-Z]+)\b/i);
  if (m) return titleCase(m[1]);
  if (/\butah\b/i.test(text)) return 'Utah';
  return null;
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// ── Field extraction ────────────────────────────────────────
const STOP_PAT = new RegExp(`\\b(?:${STOP_LABELS.map((l) => l.replace(/\./g, '\\.')).join('|')})\\b`, 'i');
const DATE_PAT = /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}-\d{2}-\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b/i;
const MONEY_PAT = /\$?\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/;

function findField(text: string, def: FieldDef): ExtractedField {
  for (const label of def.labels) {
    // labels may already contain regex (e.g. 'vs\\.?'); also flex whitespace.
    const labelPat = label.replace(/ /g, '\\s+');
    const re = new RegExp(`${labelPat}\\s*[:#\\-\\.]?\\s*([^\\n]{1,${def.type === 'multiline' ? 400 : 90}})`, 'i');
    const m = text.match(re);
    if (!m || !m[1]) continue;
    let val = m[1].trim();
    if (def.type !== 'multiline') val = trimAtNextLabel(val);
    val = postProcess(val, def.type);
    if (val) {
      return { key: def.key, value: val, confidence: confidenceFor(def.type, val), matchedAnchor: prettyLabel(label) };
    }
  }
  return { key: def.key, value: '', confidence: 0 };
}

function trimAtNextLabel(val: string): string {
  const m = val.match(STOP_PAT);
  if (m && m.index != null && m.index > 0) return val.slice(0, m.index).trim();
  return val;
}

function postProcess(val: string, type: FieldType): string {
  let v = val.replace(/\s{2,}/g, ' ').replace(/[\s,;:.\-]+$/, '').trim();
  if (type === 'date') {
    const m = v.match(DATE_PAT);
    return m ? m[0].trim() : v;
  }
  if (type === 'money') {
    const m = v.match(MONEY_PAT);
    return m ? m[0].trim() : v;
  }
  return v;
}

function confidenceFor(type: FieldType, val: string): number {
  switch (type) {
    case 'date': return DATE_PAT.test(val) ? 0.9 : 0.45;
    case 'money': return MONEY_PAT.test(val) ? 0.9 : 0.45;
    case 'name': return /[A-Za-z]{2,}/.test(val) ? 0.8 : 0.4;
    case 'multiline': return val.length > 8 ? 0.7 : 0.5;
    default: return val.length > 1 ? 0.75 : 0.4;
  }
}

function prettyLabel(label: string): string {
  // Strip regex artifacts so the UI shows a clean anchor.
  return label.replace(/\\\.\?|\\\.|\.\*|\\s\+/g, ' ').replace(/[\\^$]/g, '').replace(/\s{2,}/g, ' ').trim();
}

// ── Envelope builder ────────────────────────────────────────
export interface ExtractInput {
  text: string;
  pageCount?: number;
  usedOcr?: boolean;
}

export function buildDocumentExtraction(input: ExtractInput): DocumentExtraction {
  const text = (input.text || '').replace(/\r/g, '');
  const cls = classifyDocument(text);
  const defs = FIELD_DEFS[cls.kind];

  // Unknown / unimplemented kind: return a stub envelope. The reviewer
  // shows "no save handler" + Download JSON, and the clerk can still see
  // the raw text preview.
  if (!defs) {
    return {
      kind: cls.kind,
      tier: 'stub',
      fields: [],
      confidence: 0,
      pageCount: input.pageCount ?? 0,
      usedOcr: !!input.usedOcr,
      rawTextPreview: text.slice(0, 4000),
      courtCategory: cls.courtCategory,
      state: cls.state,
    };
  }

  const fields = defs.map((d) => findField(text, d));
  const found = fields.filter((f) => f.confidence > 0);
  // Overall confidence blends classification certainty with field coverage,
  // so a confidently-classified doc with sparse fields still reads as
  // "needs review" rather than falsely high.
  const coverage = found.length / fields.length;
  const fieldMean = found.length ? found.reduce((s, f) => s + f.confidence, 0) / found.length : 0;
  const overall = Math.min(1, Number((cls.confidence * 0.4 + coverage * 0.4 + fieldMean * 0.2).toFixed(3)));

  return {
    kind: cls.kind,
    tier: IMPLEMENTED_KINDS.has(cls.kind) ? 'implemented' : 'stub',
    fields,
    confidence: overall,
    pageCount: input.pageCount ?? 0,
    usedOcr: !!input.usedOcr,
    rawTextPreview: text.slice(0, 4000),
    courtCategory: cls.courtCategory,
    state: cls.state,
  };
}
