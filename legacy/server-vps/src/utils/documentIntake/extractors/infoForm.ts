// ============================================================
// info_form extractor — generic Information Form / Info Sheet
// ============================================================
// Used for general intake info forms attached to serve packets,
// supplemental incident reports, and standalone information
// reports. Many fields overlap with FI cards; the difference is
// usually that info forms have richer narrative + multiple
// person/property records.

import type { DocumentExtractor, FieldAnchor } from '../types';

const anchors: FieldAnchor[] = [
  {
    key: 'reference_number',
    label: 'Reference Number',
    patterns: [
      /(?:Reference|Reference\s+No|Ref|File)\s*(?:No\.?|#)?\s*[:\-]?\s*([A-Z0-9\-]+)/i,
      /(?:Report|Information)\s*(?:No\.?|Number|#)\s*[:\-]?\s*([A-Z0-9\-]+)/i,
    ],
  },
  {
    key: 'subject_name',
    label: 'Subject / Person Name',
    patterns: [
      /(?:Subject|Person|Name)\s*[:\-]?\s*([A-Z][A-Za-z\-'.,\s]{1,80}?)(?:\n|DOB)/i,
    ],
  },
  {
    key: 'subject_dob',
    label: 'Subject DOB',
    patterns: [
      /(?:DOB|Date\s+of\s+Birth)\s*[:\-]?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    ],
  },
  {
    key: 'subject_address',
    label: 'Subject Address',
    patterns: [
      /Address\s*[:\-]?\s*([^\n]{5,120}?)(?:\n|Phone|City)/i,
    ],
  },
  {
    key: 'subject_phone',
    label: 'Subject Phone',
    patterns: [
      /(?:Phone|Telephone|Cell)\s*[:\-]?\s*(\(?\d{3}\)?[\-.\s]?\d{3}[\-.\s]?\d{4})/i,
    ],
  },
  {
    key: 'occurrence_date',
    label: 'Occurrence Date',
    patterns: [
      /(?:Date\s+of\s+(?:Occurrence|Event|Incident)|Occurrence\s+Date)\s*[:\-]?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    ],
  },
  {
    key: 'occurrence_location',
    label: 'Occurrence Location',
    patterns: [
      /(?:Location|Place|Address\s+of\s+Occurrence)\s*[:\-]?\s*([^\n]{5,160}?)(?:\n|City|State)/i,
    ],
  },
  {
    key: 'reporting_party',
    label: 'Reporting Party',
    patterns: [
      /(?:Reporting\s+(?:Party|Person)|RP|Complainant)\s*[:\-]?\s*([A-Z][A-Za-z\-'.,\s]{1,80}?)(?:\n|Phone|Address)/i,
    ],
  },
  {
    key: 'narrative',
    label: 'Narrative',
    patterns: [
      /(?:Narrative|Details|Description|Information)\s*[:\-]?\s*\n([\s\S]{20,4000}?)(?:\n\s*Signature|\n\s*Officer\s|\n\s*Date\s*[:\-])/i,
    ],
    postProcess: (s) => s.trim().slice(0, 4000),
  },
  {
    key: 'reporting_officer',
    label: 'Reporting Officer',
    patterns: [
      /(?:Reporting\s+Officer|Officer)\s*[:\-]?\s*([A-Z][A-Za-z\-'.,\s]{2,80}?)(?:\n|Badge|#)/i,
    ],
  },
];

export const infoFormExtractor: DocumentExtractor = {
  kind: 'info_form',
  tier: 'implemented',
  detect(text) {
    const head = text.slice(0, 1500).toUpperCase();
    let score = 0;
    if (/INFORMATION\s+(?:FORM|SHEET|REPORT)|INFO\s+(?:FORM|SHEET)/.test(head)) score += 0.6;
    if (/SUPPLEMENTAL\s+REPORT/.test(head)) score += 0.4;
    if (/REPORTING\s+(?:PARTY|PERSON)/.test(head)) score += 0.1;
    if (/NARRATIVE/.test(head)) score += 0.1;
    return Math.min(score, 1);
  },
  anchors,
};
