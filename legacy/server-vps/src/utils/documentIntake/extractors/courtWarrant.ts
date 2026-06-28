// ============================================================
// court_warrant extractor
// ============================================================
// Covers: bench warrant, arrest warrant, FTA (failure to appear)
// warrant, and writ-of-arrest variants from Utah courts and
// adjacent jurisdictions. Anchor list ordered by reliability —
// the most distinctive label per field is tried first.

import type { DocumentExtractor, FieldAnchor } from '../types';

const anchors: FieldAnchor[] = [
  {
    key: 'docket_number',
    label: 'Docket / Case Number',
    patterns: [
      /(?:Docket|Case)\s*(?:No\.?|Number|#)\s*[:\-]?\s*([A-Z0-9\-]+)/i,
      /Case\s*ID\s*[:\-]?\s*([A-Z0-9\-]+)/i,
    ],
  },
  {
    key: 'warrant_type',
    label: 'Warrant Type',
    patterns: [
      /(?:Type\s+of\s+Warrant|Warrant\s+Type)\s*[:\-]?\s*([A-Za-z ]+?)(?:\n|$)/i,
      /\b(BENCH\s+WARRANT|ARREST\s+WARRANT|FTA\s+WARRANT)\b/i,
    ],
  },
  {
    key: 'defendant_name',
    label: 'Defendant Name',
    patterns: [
      /Defendant\s*[:\-]?\s*([A-Z][A-Za-z\-'.,\s]{1,80}?)(?:\n|DOB|Date)/,
      /Name\s+of\s+(?:Defendant|Accused|Subject)\s*[:\-]?\s*([A-Z][A-Za-z\-'.,\s]{1,80}?)(?:\n|DOB)/,
      /vs?\.\s+([A-Z][A-Za-z\-'.,\s]{1,80}?)(?:\n|,)/,
    ],
  },
  {
    key: 'defendant_dob',
    label: 'Defendant Date of Birth',
    patterns: [
      /(?:DOB|Date\s+of\s+Birth)\s*[:\-]?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
      /Born\s*[:\-]?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    ],
  },
  {
    key: 'charges',
    label: 'Charges',
    patterns: [
      /(?:Charges?|Offen[sc]es?|Counts?)\s*[:\-]?\s*([\s\S]{1,400}?)(?:\n\s*\n|Bond\s+Amount|Issued)/i,
    ],
    postProcess: (s) => s.replace(/\s+/g, ' ').trim().slice(0, 400),
  },
  {
    key: 'bond_amount',
    label: 'Bond Amount',
    patterns: [
      /Bond\s*(?:Amount)?\s*[:\-]?\s*\$?\s*([\d,]+(?:\.\d{2})?)/i,
      /Bail\s*[:\-]?\s*\$?\s*([\d,]+(?:\.\d{2})?)/i,
    ],
    postProcess: (s) => s.replace(/,/g, ''),
  },
  {
    key: 'issuing_judge',
    label: 'Issuing Judge',
    patterns: [
      /(?:Issuing\s+Judge|Judge|Magistrate)\s*[:\-]?\s*(?:Hon(?:orable)?\.?\s*)?([A-Z][A-Za-z\-'.,\s]{2,80}?)(?:\n|,|$)/i,
      /\/s\/\s*([A-Z][A-Za-z\-'.,\s]{2,80}?)(?:\s+Judge|\n)/,
    ],
  },
  {
    key: 'issued_date',
    label: 'Issued Date',
    patterns: [
      /(?:Date\s+(?:of\s+)?Issuanc?e|Issued\s+(?:on|this))\s*[:\-]?\s*(\d{1,2}\/\d{1,2}\/\d{2,4}|[A-Z][a-z]+\s+\d{1,2},?\s+\d{4})/i,
    ],
  },
  {
    key: 'court_name',
    label: 'Court Name',
    patterns: [
      /([A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]*)*\s+(?:District|Justice|Municipal|Circuit|Superior|Magistrate|County)\s+Court(?:\s+of\s+[A-Z][A-Za-z\s]+)?)/,
    ],
  },
];

export const courtWarrantExtractor: DocumentExtractor = {
  kind: 'court_warrant',
  tier: 'implemented',
  detect(text) {
    const head = text.slice(0, 2000).toUpperCase();
    let score = 0;
    if (/\bWARRANT\b/.test(head)) score += 0.5;
    if (/\bBENCH\s+WARRANT\b|\bARREST\s+WARRANT\b/.test(head)) score += 0.3;
    if (/THE\s+STATE\s+OF\s+\w+\s+VS?\.?/.test(head)) score += 0.1;
    if (/DOCKET|CASE\s+(?:NO|NUMBER)/.test(head)) score += 0.1;
    return Math.min(score, 1);
  },
  anchors,
};
