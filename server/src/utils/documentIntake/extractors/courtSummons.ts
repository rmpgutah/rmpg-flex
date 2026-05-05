// ============================================================
// court_summons extractor — Utah / state district court summons
// ============================================================
// Calibrated against the layout used by Utah Third Judicial
// District Court summons documents (Capital One v. defendant
// pattern, Guglielmo & Associates plaintiff-side counsel, et al).
//
// Distinct from court_warrant: a summons is a civil notice to
// appear, not an arrest authorization. Anchor set captures the
// caption block (court name, plaintiff, defendant, civil
// number) plus the attorney/firm contact block on the cover sheet.

import type { DocumentExtractor, FieldAnchor } from '../types';

const anchors: FieldAnchor[] = [
  {
    key: 'court_name',
    label: 'Court Name',
    patterns: [
      /(IN\s+THE\s+(?:FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH)\s+JUDICIAL\s+DISTRICT\s+COURT[^\n]*)/i,
      /(IN\s+THE\s+\w+\s+(?:DISTRICT|SUPERIOR|JUSTICE|MUNICIPAL|CIRCUIT)\s+COURT[^\n]*)/i,
      /((?:Third|Second|First|Fourth)\s+Judicial\s+District\s+Court[^\n]*)/i,
    ],
  },
  {
    key: 'court_county',
    label: 'County',
    patterns: [
      /([A-Z][A-Z ]+\s+COUNTY)\s*,/,
      /([A-Z][A-Za-z ]+\s+County)\s*,/,
    ],
  },
  {
    key: 'court_state',
    label: 'State',
    patterns: [
      /STATE\s+OF\s+([A-Z][A-Za-z]+)/,
    ],
  },
  {
    key: 'civil_case_number',
    label: 'Civil Case Number',
    patterns: [
      /Civil\s+No\.?\s*[:\-]?\s*([A-Z0-9\-\.]+)/i,
      /Case\s+No\.?\s*[:\-]?\s*([A-Z0-9\-\.]+)/i,
      /Docket\s+No\.?\s*[:\-]?\s*([A-Z0-9\-\.]+)/i,
    ],
  },
  {
    key: 'plaintiff',
    label: 'Plaintiff',
    patterns: [
      // "Capital One, N.A., successor by merger to Discover Bank ,\n    Plaintiff,"
      // The party block ends right before the literal "Plaintiff," line.
      /^\s*([A-Z][^\n]{2,200}?)\s*,?\s*\n\s*Plaintiff,?/m,
      /Plaintiff[:\s]+([A-Z][^\n]{2,200}?)(?:\s*,?\s*\n|vs?\.)/i,
    ],
    postProcess: (s) => s.replace(/\s+/g, ' ').replace(/,?\s*$/, '').trim(),
  },
  {
    key: 'defendant',
    label: 'Defendant',
    patterns: [
      // After "vs." until "Defendant," or "Civil No." or end of line
      /vs?\.\s*\n?\s*([A-Z][A-Za-z][^\n]{2,200}?)\s*,?\s*\n\s*(?:Defendant|Civil)/i,
      /Defendant\s*[:\-]?\s*([A-Z][A-Za-z][^\n]{2,200}?)(?:\s*,?\s*\n)/,
    ],
    postProcess: (s) => s.replace(/\s+/g, ' ').replace(/,?\s*$/, '').trim(),
  },
  {
    key: 'attorney_firm',
    label: 'Attorney / Firm',
    patterns: [
      // First non-empty line of a typical caption is the firm name in
      // ALL CAPS, often followed by "& ASSOCIATES" / "LLC" / "PLLC" /
      // "LLP" — match conservatively.
      /^([A-Z][A-Z &,.\-]+(?:&\s+ASSOCIATES|LLC|PLLC|LLP|PC|P\.?C\.?))/m,
    ],
    postProcess: (s) => s.replace(/\s+/g, ' ').trim(),
  },
  {
    key: 'attorney_name',
    label: 'Attorney Name',
    patterns: [
      // "Heather Valerga, (Utah Attorney Bar# 14431)"
      /([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+)\s*,\s*\(?(?:Utah\s+)?(?:State\s+)?(?:Attorney\s+)?Bar\s*#?\s*\d+/i,
      // Generic "Attorney for Plaintiff" leader
      /([A-Z][a-z]+\s+[A-Z][a-z]+)\s*\n\s*Attorney\s+for\s+(?:Plaintiff|Petitioner)/i,
    ],
  },
  {
    key: 'attorney_bar_number',
    label: 'Attorney Bar #',
    patterns: [
      /Bar\s*#?\s*(\d{3,8})/i,
      /Bar\s+No\.?\s*(\d{3,8})/i,
    ],
  },
  {
    key: 'attorney_address',
    label: 'Attorney Address',
    patterns: [
      // PO Box pattern — common for collection-firm attorneys.
      /(PO\s+Box\s+\d+\s*\n[^\n]+,\s*[A-Z]{2}\s+\d{5})/i,
      // Street number address right before a City, ST ZIP line.
      /(\d+\s+[NEWS]?\.?\s*[A-Z][A-Za-z .]+\s*\n[A-Za-z .]+,\s*[A-Z]{2}\s+\d{5})/,
    ],
    postProcess: (s) => s.replace(/\s+/g, ' ').trim(),
  },
  {
    key: 'attorney_phone',
    label: 'Attorney Phone',
    patterns: [
      /Tel\s*[:\-]?\s*\(?(\d{3})\)?[\s\-.](\d{3})[\s\-.](\d{4})/i,
    ],
    postProcess: (s) => s.replace(/[\s.\-]/g, '-').replace(/^/, ''), // normalize separators
  },
  {
    key: 'attorney_email',
    label: 'Attorney Email',
    patterns: [
      /([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})/,
    ],
  },
  {
    key: 'attorney_for',
    label: 'Represents',
    patterns: [
      /Attorney\s+for\s+(Plaintiff|Defendant|Petitioner|Respondent|Appellant|Appellee)/i,
    ],
    postProcess: (s) => s.toLowerCase(),
  },
  {
    key: 'document_subtype',
    label: 'Document Subtype',
    patterns: [
      // Headline word — "SUMMONS" is usually the first standalone label
      // line in the caption block.
      /^\s*(SUMMONS(?:\s+AND\s+COMPLAINT)?|COMPLAINT|SUBPOENA|NOTICE\s+OF\s+HEARING|MOTION)\s*$/m,
    ],
  },
];

export const courtSummonsExtractor: DocumentExtractor = {
  kind: 'court_summons',
  tier: 'implemented',
  detect(text) {
    const head = text.slice(0, 3000).toUpperCase();
    let score = 0;
    if (/\bSUMMONS\b/.test(head)) score += 0.5;
    if (/PLAINTIFF/.test(head) && /VS?\.?/.test(head)) score += 0.2;
    if (/JUDICIAL\s+DISTRICT\s+COURT/.test(head)) score += 0.2;
    if (/CIVIL\s+NO\.?/.test(head)) score += 0.1;
    if (/ATTORNEY\s+FOR\s+(?:PLAINTIFF|PETITIONER)/.test(head)) score += 0.1;
    return Math.min(score, 1);
  },
  anchors,
};
