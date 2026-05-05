// ============================================================
// servemanager_job extractor — ServeManager "Information Form"
// ============================================================
// ServeManager (a third-party process-service SaaS) exports a
// per-job Information Form PDF that's a different layout from
// either court records or our internal info forms. Calibrated
// against the Guglielmo & Associates → ICU Investigations
// flow seen 2026-05-05.
//
// Distinguishing layout markers:
//   - Top "JOB" label followed by numeric job IDs
//   - CLIENT / SERVER / Job Type label triplet across one row
//   - Recipient block with "Recipient: NAME / DOB: ..."
//   - "Field Sheet" / "New Attempt" / "Service Attempts" subheaders

import type { DocumentExtractor, FieldAnchor } from '../types';

const anchors: FieldAnchor[] = [
  {
    key: 'job_number',
    label: 'Job Number',
    patterns: [
      // The job ID block sits directly under "JOB" — first all-digit
      // token of 6+ digits.
      /JOB\s*\n\s*(\d{6,12})/,
      // Fallback: any "Job #: NNNNN" label.
      /Job\s*#?\s*[:\-]?\s*(\d{6,12})/i,
    ],
  },
  {
    key: 'internal_id',
    label: 'Internal Reference ID',
    patterns: [
      // Second numeric token in the JOB header row (often the
      // ServeManager-internal id, distinct from the public job number).
      /JOB\s*\n\s*\d{6,12}\s+(\d{4,12})/,
    ],
  },
  {
    key: 'job_due_date',
    label: 'Due Date',
    patterns: [
      // "Due\n  May 7, 2026" pattern (label + value on adjacent lines)
      /\bDue\b\s*[:\-]?\s*\n?\s*([A-Z][a-z]+\s+\d{1,2},?\s+\d{4})/,
      /Due\s*[:\-]?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/,
    ],
  },
  {
    key: 'client_firm',
    label: 'Client / Law Firm',
    patterns: [
      // "CLIENT\n  Guglielmo & Associates, PLLC"
      /CLIENT\s*\n+\s*[\W]?\s*([A-Z][^\n]{3,120}?)(?:\n|$)/,
      /Client\s*[:\-]?\s*([A-Z][^\n]{3,120}?)(?:\n)/,
    ],
    postProcess: (s) => s.replace(/\s+/g, ' ').replace(/^[\W_]+/, '').trim(),
  },
  {
    key: 'server_firm',
    label: 'Server / Process Service Co.',
    patterns: [
      // "SERVER\n  ICU Investigations, LLC\n  Christopher Zamora\n  435-986-1200"
      // Capture only the first line (firm name).
      /SERVER\s*\n+\s*([A-Z][^\n]{3,120}?)(?:\n|$)/,
    ],
    postProcess: (s) => s.replace(/\s+/g, ' ').trim(),
  },
  {
    key: 'server_individual',
    label: 'Assigned Server',
    patterns: [
      // The line *immediately after* the SERVER firm name is usually the
      // assigned individual (matches a name pattern).
      /SERVER\s*\n+\s*[A-Z][^\n]{3,120}\n\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/,
    ],
  },
  {
    key: 'server_phone',
    label: 'Server Phone',
    patterns: [
      // First phone number after SERVER block.
      /SERVER[\s\S]{0,300}?(\(?\d{3}\)?[\s\-.]\d{3}[\s\-.]\d{4})/,
      /(\d{3}[\s\-.]\d{3}[\s\-.]\d{4})/,
    ],
  },
  {
    key: 'job_type',
    label: 'Job Type',
    patterns: [
      // "Job Type    G&A Service Type" — label + value on same line
      // separated by whitespace.
      /Job\s+Type\s+([A-Z][^\n]{1,80}?)(?:\n|$)/,
    ],
    postProcess: (s) => s.replace(/\s+/g, ' ').trim(),
  },
  {
    key: 'job_status',
    label: 'Status',
    patterns: [
      /\bStatus\s*[:\-]?\s*([A-Z][a-zA-Z ]{2,40}?)(?:\n)/,
    ],
  },
  {
    key: 'recipient_name',
    label: 'Recipient',
    patterns: [
      // "Recipient:\n  Darelis Montilla"
      /Recipient\s*[:\-]?\s*\n?\s*([A-Z][A-Za-z][^\n]{1,80}?)(?:\n|DOB)/,
    ],
    postProcess: (s) => s.replace(/\s+/g, ' ').trim(),
  },
  {
    key: 'recipient_dob',
    label: 'Recipient DOB',
    patterns: [
      /DOB\s*[:\-]?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    ],
  },
  {
    key: 'service_attempts_count',
    label: 'Service Attempts',
    patterns: [
      // The form has a "Service Attempts" header followed by either
      // "No Service Attempts" (= 0) or numbered entries.
      /Service\s+Attempts\b[\s\S]{0,200}?(?:No\s+Service\s+Attempts|Attempt\s+#?\s*(\d+))/i,
    ],
    postProcess: (s) => {
      // If the regex matched the "No Service Attempts" branch, the
      // capture is empty; if it matched "Attempt #N", capture is the
      // count. Normalize "no attempts yet" to "0" for consistent UI.
      return s.trim() || '0';
    },
  },
];

export const servemanagerJobExtractor: DocumentExtractor = {
  kind: 'servemanager_job',
  tier: 'implemented',
  detect(text) {
    const head = text.slice(0, 2500).toUpperCase();
    let score = 0;
    // Combo of "JOB" + "CLIENT" + "SERVER" + "RECIPIENT" labels in
    // close proximity is a strong signal — generic court forms don't
    // have this layout.
    if (/\bJOB\b/.test(head) && /\bCLIENT\b/.test(head) && /\bSERVER\b/.test(head)) score += 0.5;
    if (/SERVICE\s+ATTEMPTS/.test(head)) score += 0.2;
    if (/JOB\s+TYPE/.test(head)) score += 0.15;
    if (/FIELD\s+SHEET/.test(head)) score += 0.1;
    if (/RECIPIENT/.test(head)) score += 0.05;
    return Math.min(score, 1);
  },
  anchors,
};
