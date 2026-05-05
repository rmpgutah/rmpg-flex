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

// Line-aware caption bleed stripper. Real court documents have 2-column
// layouts where right-column header text (Civil No., Judge, COUNTY CIVIL
// DIVISION, "IN THE ... COURT") wraps onto the same physical lines as the
// left-column party caption. pdftotext -layout preserves both columns
// adjacent to each other, so the per-line filter is more robust than a
// global regex (which can over-strip when the label appears at the start
// of the capture rather than the end).
// Each alternative anchors itself at line start; the trailing \b that was
// here originally broke the COUNTY branch because "," and " " are both
// non-word chars (no boundary between them). Per-alternative anchoring
// is more verbose but correct.
const LABEL_LINE_PATTERN = /^(?:Civil\s+No\b|Case\s+No\b|Docket\s+No\b|Judge\s*[:.]|Tier\s+\d|CASE\s+NO\b|COUNTY\s+CIVIL\s+DIVISION|IN\s+THE\s+(?:COUNTY\s+COURT|.+\s+CIRCUIT|.+\s+JUDICIAL)|FOR\s+\w+\s+COUNTY\b|FLORIDA\.?$|UTAH\.?$|[A-Z][A-Z\s]+COUNTY[,\s]|Filing\s+#)/i;

// Mid-line right-bleed: when a 2-column layout appends court-header text
// to the right side of the same physical line as a party name, the line
// reads like "MCKENZIE CAPITAL LLC, IN THE COUNTY COURT OF THE". Strip
// from the bleed marker onwards so we keep just the party portion.
const MIDLINE_BLEED_PATTERNS: RegExp[] = [
  /\s+IN\s+THE\s+(?:COUNTY\s+COURT|.+?\s+JUDICIAL\s+(?:DISTRICT|CIRCUIT)).*$/i,
  /\s+\d+(?:ST|ND|RD|TH)\s+JUDICIAL.*$/i,
  /\s+IN\s+AND\s+FOR\s+\w+\s+COUNTY.*$/i,
  /\s+[A-Z][A-Z\s]+COUNTY,\s+[A-Z].*$/, // "SALT LAKE COUNTY, Salt Lake City"
  /\s+CASE\s+NO\.?.*$/i,
  /\s+COUNTY\s+CIVIL\s+DIVISION.*$/i,
  /\s+Civil\s+No\.?.*$/i,
];
const ENTITY_QUALIFIER = /,?\s*(?:an\s+individual|a\s+\w+(?:\s+\w+)*\s+(?:LLC|Limited\s+Liability\s+Company|Corporation|Corp\.?))\s*,?\s*$/i;

function stripCaptionBleed(raw: string): string {
  return raw.split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !LABEL_LINE_PATTERN.test(l))
    .map((l) => MIDLINE_BLEED_PATTERNS.reduce((acc, re) => acc.replace(re, ''), l).trim())
    .filter(Boolean)
    .join(' ')
    .replace(ENTITY_QUALIFIER, '')
    .replace(/,?\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const anchors: FieldAnchor[] = [
  {
    key: 'court_name',
    label: 'Court Name',
    patterns: [
      /(IN\s+THE\s+(?:FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH)\s+JUDICIAL\s+DISTRICT\s+COURT[^\n]*)/i,
      /(IN\s+THE\s+\w+\s+(?:DISTRICT|SUPERIOR|JUSTICE|MUNICIPAL|CIRCUIT)\s+COURT[^\n]*)/i,
      // Florida 2-column header — "IN THE COUNTY COURT OF THE\n  11TH JUDICIAL CIRCUIT"
      // is split across lines so we match the leading "IN THE COUNTY COURT" alone
      // and rely on the rest as bleed.
      /(IN\s+THE\s+COUNTY\s+COURT[^\n]*)/i,
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
      // Must contain at least one digit cluster of 3+ to avoid grabbing the
      // next line's name when the case # is blank in a draft form
      // (real bug observed 2026-05-05: captured "Abbey" / "Dazya").
      // Allow trailing optional " MI" / division code (Utah convention).
      /(?:Civil|Case)\s+No\.?\s*[:\-]?\s*((?=[\w\-]*\d{3})[A-Z0-9][A-Z0-9\-\.]{2,30})/i,
      /Docket\s+No\.?\s*[:\-]?\s*((?=[\w\-]*\d{3})[A-Z0-9][A-Z0-9\-\.]{2,30})/i,
      // Florida convention — "CASE NO. 2026-053140-CC-05" (allow inline)
      /CASE\s+NO\.?\s*([A-Z0-9][\dA-Z\-]{6,30})/i,
      // Utah AOC barcode trailer on summons cover sheets — "*S10000633570*"
      // is the document tracking ID; useful when the visible Civil No. is
      // blank on a draft form.
      /\*([A-Z]\d{8,12})\*/,
    ],
  },
  {
    key: 'plaintiff',
    label: 'Plaintiff',
    patterns: [
      // Caption block right before the literal "Plaintiff," marker.
      // Real layouts span 1-3 lines AND a 2-column layout can have
      // court-header text in the right column of the same physical lines.
      // Capture is wide; the post-processor handles the strip.
      /\n((?:[^\n]+\n){1,3})[ \t]+Plaintiff[\s,]/,
      /Plaintiff\s*[:]\s*([A-Z][^\n]{2,200}?)(?:\s*,?\s*\n|vs?\.)/i,
    ],
    postProcess: stripCaptionBleed,
  },
  {
    key: 'defendant',
    label: 'Defendant',
    patterns: [
      // Caption block between "vs." and the literal "Defendant" / "Defendant(s)"
      // label. Tolerates trailing same-line column bleed after "vs." (Florida
      // 2-column layout puts "FOR  MIAMI-DADE  COUNTY," on the same physical
      // line as "vs.") via [^\n]* before the captured block.
      /vs?\.[^\n]*\n([\s\S]{2,500}?)\n[ \t]+Defendant\(?s?\)?\b/,
      /Defendant\(?s?\)?\s*[:]\s*([A-Z][^\n]{2,200}?)(?:\s*,?\s*\n)/,
    ],
    postProcess: stripCaptionBleed,
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
      // "GARY R. GUELKER (8474)" — all-caps name with parenthesized bar #
      /^([A-Z][A-Z\.]+(?:\s+[A-Z]\.?)*\s+[A-Z][A-Z\.]+)\s+\((\d{3,8})\)/m,
      // Generic "Attorney for Plaintiff" leader
      /([A-Z][a-z]+\s+[A-Z][a-z]+)\s*\n\s*Attorney\s+for\s+(?:Plaintiff|Petitioner)/i,
    ],
    // Re-case ALLCAPS names to Title Case so the saved value matches what
    // appears in records. "GARY R. GUELKER" → "Gary R. Guelker".
    postProcess: (s) =>
      /^[A-Z][A-Z\s\.]+$/.test(s.trim())
        ? s.trim().split(/\s+/).map((t) =>
            t.length <= 2 ? t : t[0] + t.slice(1).toLowerCase(),
          ).join(' ')
        : s.trim(),
  },
  {
    key: 'attorney_bar_number',
    label: 'Attorney Bar #',
    patterns: [
      /Bar\s*#?\s*(\d{3,8})/i,
      /Bar\s+No\.?\s*(\d{3,8})/i,
      // Inline parenthesized bar # next to the attorney name:
      // "GARY R. GUELKER (8474)" or "K. TAYLOR SORENSEN (17323)"
      /^[A-Z][A-Z\.\s]+\((\d{3,8})\)/m,
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
      // Tel/Telephone/Phone label, optional separator after "(NNN)",
      // any of space/dash/dot/none between the trios. Real samples
      // observed: "Tel: (877)325-5700", "Telephone: 801.960.3655".
      /(?:Tel(?:ephone)?|Phone)\s*[:\-]?\s*(\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})/i,
    ],
    postProcess: (s) => s.replace(/[\s.()]/g, '').replace(/^(\d{3})/, '$1-').replace(/(\d{4})$/, '-$1').replace(/--+/g, '-'),
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
      // Headline word — appears either on a standalone line OR as a
      // right-column label aligned next to the party caption (Utah AOC
      // formatting). Allow either by dropping the strict line anchors;
      // we just need it to appear within the first 2KB of the doc which
      // the regex engine handles naturally on the head-only input.
      /\b(CORPORATE\s+SUMMONS|SUMMONS(?:\s+AND\s+COMPLAINT)?|COMPLAINT|SUBPOENA(?:\s+(?:DUCES\s+TECUM|TO\s+APPEAR))?|NOTICE\s+OF\s+HEARING|MOTION|PETITION)\b/,
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
