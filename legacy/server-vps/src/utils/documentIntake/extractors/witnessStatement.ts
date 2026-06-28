// ============================================================
// witness_statement extractor — ICU investigation interview form
// ============================================================
// Common shape for police-issued witness statement forms:
//   header block (case #, incident #), witness identity block,
//   narrative body (free-form, often multi-page), signature block.
// We extract the structured fields; the narrative goes into
// `statement_body` for review.

import type { DocumentExtractor, FieldAnchor } from '../types';

const anchors: FieldAnchor[] = [
  {
    key: 'case_number',
    label: 'Case Number',
    patterns: [
      /Case\s*(?:No\.?|Number|#)\s*[:\-]?\s*([A-Z0-9\-]+)/i,
      /Investigation\s*(?:No\.?|Number|#)\s*[:\-]?\s*([A-Z0-9\-]+)/i,
    ],
  },
  {
    key: 'incident_number',
    label: 'Incident Number',
    patterns: [
      /Incident\s*(?:No\.?|Number|#)\s*[:\-]?\s*([A-Z0-9\-]+)/i,
      /Report\s*(?:No\.?|Number|#)\s*[:\-]?\s*([A-Z0-9\-]+)/i,
    ],
  },
  {
    key: 'witness_name',
    label: 'Witness Name',
    patterns: [
      /(?:Witness(?:'s)?\s+Name|Name\s+of\s+Witness|Statement\s+of)\s*[:\-]?\s*([A-Z][A-Za-z\-'.,\s]{1,80}?)(?:\n|DOB|Date)/i,
    ],
  },
  {
    key: 'witness_dob',
    label: 'Witness DOB',
    patterns: [
      /(?:DOB|Date\s+of\s+Birth)\s*[:\-]?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    ],
  },
  {
    key: 'witness_address',
    label: 'Witness Address',
    patterns: [
      /Address\s*[:\-]?\s*([^\n]{5,120}?)(?:\n|Phone)/i,
    ],
  },
  {
    key: 'witness_phone',
    label: 'Witness Phone',
    patterns: [
      /(?:Phone|Telephone|Cell)\s*[:\-]?\s*(\(?\d{3}\)?[\-.\s]?\d{3}[\-.\s]?\d{4})/i,
    ],
  },
  {
    key: 'incident_date',
    label: 'Incident Date',
    patterns: [
      /(?:Incident\s+Date|Date\s+of\s+Incident|Date\s+of\s+Occurrence)\s*[:\-]?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    ],
  },
  {
    key: 'incident_location',
    label: 'Incident Location',
    patterns: [
      /(?:Incident\s+Location|Location\s+of\s+Incident|Place\s+of\s+Occurrence)\s*[:\-]?\s*([^\n]{5,160}?)(?:\n|City|State)/i,
    ],
  },
  {
    key: 'interviewing_officer',
    label: 'Interviewing Officer',
    patterns: [
      /(?:Interviewing\s+Officer|Investigator|Reporting\s+Officer)\s*[:\-]?\s*([A-Z][A-Za-z\-'.,\s]{2,80}?)(?:\n|Badge|#)/i,
    ],
  },
  {
    key: 'badge_number',
    label: 'Badge #',
    patterns: [
      /(?:Badge|Star)\s*#?\s*[:\-]?\s*([A-Z0-9\-]{1,12})/i,
    ],
  },
  {
    key: 'statement_date',
    label: 'Statement Date',
    patterns: [
      /(?:Statement\s+Date|Date\s+(?:of\s+)?Statement|Date\s+Taken)\s*[:\-]?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    ],
  },
  {
    key: 'statement_body',
    label: 'Statement Body',
    patterns: [
      /(?:Statement|Narrative)\s*[:\-]?\s*\n([\s\S]{20,4000}?)(?:\n\s*Signature|\n\s*X\s*_+|\n\s*I[,\s].{0,80}?(?:declare|affirm|certify|swear)\s+under)/i,
    ],
    postProcess: (s) => s.trim().slice(0, 4000),
  },
];

export const witnessStatementExtractor: DocumentExtractor = {
  kind: 'witness_statement',
  tier: 'implemented',
  detect(text) {
    const head = text.slice(0, 2000).toUpperCase();
    let score = 0;
    if (/WITNESS\s+STATEMENT|STATEMENT\s+OF\s+WITNESS/.test(head)) score += 0.7;
    if (/I,\s+[A-Z]/.test(head) && /(?:DECLARE|AFFIRM|SWEAR|CERTIFY)\s+UNDER\s+PENALTY/.test(text.toUpperCase())) score += 0.2;
    if (/INCIDENT\s+(?:NO|NUMBER|#)|CASE\s+(?:NO|NUMBER|#)/.test(head)) score += 0.1;
    return Math.min(score, 1);
  },
  anchors,
};
