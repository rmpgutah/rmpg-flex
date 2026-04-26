// ============================================================
// Case Narrative — detailed Who / What / Where / When / Why
// review of the Complaint document.
//
// This complements caseSynopsis.ts: synopsis is a 4-line elevator
// pitch ("WHAT YOU ARE SERVING + WHAT IT MEANS"), narrative is a
// deeper breakdown the dispatcher / PSO can read to understand the
// underlying facts of the suit without opening the Complaint PDF.
//
// All extraction is pattern-based regex over the court-docket text.
// No external API calls. Designed to fail gracefully — every section
// degrades to "(not stated in the Complaint)" rather than throwing.
// ============================================================

import type { AttorneyBlock } from './serveIntakeHelpers';
import type { CaseCategory } from './caseSynopsis';

export interface CaseNarrativeInput {
  /** Concatenated text of all court-docket PDFs (Complaint, Summons, etc.). */
  courtDocket: string;
  plaintiff: string;
  defendantFirst: string;
  defendantMiddle: string;
  defendantLast: string;
  /** Defendant entity-type if detected; affects pronoun/phrasing. */
  defendantEntityType: 'individual' | 'organization';
  attorney: AttorneyBlock;
  court: string;
  courtAddress: string;
  county: string;
  courtCaseNumber: string;
  signedDate: string;
  responseDeadlineDays: number;
  documents: string;
  category: CaseCategory;
  moneyAtStake: string | null;
}

export interface CaseNarrativeResult {
  /** 5-section who/what/where/when/why narrative formatted for a notes blob. */
  fullText: string;
  /** Structured fields exposed for downstream UI consumers if useful. */
  who: string;
  what: string;
  where: string;
  when: string;
  why: string;
}

// ─────────────────────────────────────────────────────────────────────
// Helper extractors
// ─────────────────────────────────────────────────────────────────────

const NOT_STATED = '(not stated in the Complaint)';

/**
 * Pull the first plausible "filing date" from the docket text.
 * Recognises "DATED this Nth day of [Month] [YYYY]" and "Filed: [date]".
 */
function extractFilingDate(text: string, fallback: string): string {
  if (!text) return fallback || NOT_STATED;
  const patterns: RegExp[] = [
    /DATED\s+this\s+(\d{1,2})(?:st|nd|rd|th)?\s+day\s+of\s+([A-Za-z]+),?\s*(\d{4})/i,
    /Filed[:\s]+([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i,
    /(?:Signed|Entered)[:\s]+([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i,
    /\bon\s+this\s+(\d{1,2})(?:st|nd|rd|th)?\s+day\s+of\s+([A-Za-z]+)\s+(\d{4})/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      if (m.length === 4) return `${m[2]} ${m[1]}, ${m[3]}`;
      return m[1];
    }
  }
  return fallback || NOT_STATED;
}

/**
 * "On or about [date]" — typical complaint phrasing for the incident date.
 * Returns the first one found (most likely the operative event).
 */
function extractIncidentDate(text: string): string | null {
  if (!text) return null;
  const m = text.match(/on\s+or\s+about\s+([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i)
    || text.match(/on\s+or\s+about\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
  return m ? m[1].trim() : null;
}

/**
 * Pull the first paragraph that looks like a substantive allegation —
 * sentences that begin with "Plaintiff alleges", "Plaintiffs allege",
 * "On information and belief", or that contain a cause-of-action keyword.
 */
function extractFirstAllegation(text: string): string | null {
  if (!text) return null;
  const patterns: RegExp[] = [
    /(?:Plaintiffs?\s+allege[s]?\s+(?:that\s+)?)([^.\n]{20,400}\.)/i,
    /(?:On\s+information\s+and\s+belief,?\s+)([^.\n]{20,400}\.)/i,
    /(?:Defendants?\s+(?:negligently|wrongfully|breached|failed)[^.\n]{10,400}\.)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const sentence = (m[1] || m[0]).replace(/\s+/g, ' ').trim();
      if (sentence.length >= 20) return sentence;
    }
  }
  return null;
}

/**
 * Extract a description of the alleged-incident location, distinct from
 * the court location. Looks for an address or place-name near "located at"
 * or near "premises" or near the first allegation.
 */
function extractIncidentLocation(text: string): string | null {
  if (!text) return null;
  const m = text.match(/(?:located\s+at|on\s+the\s+premises\s+of|at\s+the\s+property\s+(?:located\s+)?at)\s+([^.\n,]{8,80})/i);
  if (m) return m[1].replace(/\s+/g, ' ').trim();
  // Fallback: first complete US street address inside the body
  const addr = text.match(/(\d+\s+\w[^\n,]{4,60},\s*[A-Za-z .]+,\s*[A-Z]{2}\s*\d{5})/);
  return addr ? addr[1].trim() : null;
}

/**
 * Pull the first "FIRST CAUSE OF ACTION" / "COUNT I" header + the line
 * underneath it (typically the legal theory: e.g. "Negligence", "Breach
 * of Contract", "Conversion"). This anchors the WHY section.
 */
function extractFirstCauseOfAction(text: string): string | null {
  if (!text) return null;
  const patterns: RegExp[] = [
    /FIRST\s+(?:CAUSE\s+OF\s+ACTION|CLAIM\s+FOR\s+RELIEF)[\s\S]{0,80}?[\n:]\s*\(?([A-Z][A-Z &/-]{5,80}?)(?:\)|\n|$)/i,
    /COUNT\s+(?:I|1|ONE)[\s\S]{0,80}?[\n:]\s*\(?([A-Z][A-Z &/-]{5,80}?)(?:\)|\n|$)/i,
    /CAUSE\s+OF\s+ACTION\s*[:\n]\s*([A-Z][A-Z &/-]{5,80}?)(?:\n|$)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1].replace(/\s+/g, ' ').trim();
  }
  return null;
}

/**
 * Co-defendants beyond the named subject — many complaints list 5–30.
 * Extract a short comma-separated list capped at 6 names so the narrative
 * doesn't explode for mass-tort filings.
 */
function extractCoDefendants(text: string, primaryDefendantLast: string): string[] {
  if (!text) return [];
  // Look for the block between "v." and "Defendants," — this is the caption.
  const captionMatch = text.match(/v\.\s*([\s\S]{50,2000}?)Defendants/i);
  if (!captionMatch) return [];
  const block = captionMatch[1];
  // Split on semicolons or commas; filter out junk; cap to 6.
  const candidates = block
    .split(/[;,]\s*(?:and\s+)?/i)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 3 && s.length < 80)
    .filter((s) => /[A-Za-z]/.test(s) && !/^(an?\s+individual|inclusive|DOES?\s+\d)/i.test(s))
    .filter((s) => !s.toLowerCase().includes(primaryDefendantLast.toLowerCase()))
    .slice(0, 6);
  return candidates;
}

// ─────────────────────────────────────────────────────────────────────
// Phrasing helpers per category — keeps the WHY section concrete
// instead of generic "civil action seeking damages".
// ─────────────────────────────────────────────────────────────────────
function whyPhraseForCategory(cat: CaseCategory, money: string | null, firstCause: string | null): string {
  const causeFragment = firstCause ? ` (first cause of action: ${firstCause.toLowerCase()})` : '';
  switch (cat) {
    case 'debt_collection':
      return money
        ? `Plaintiff is asking the court to enter judgment requiring the Defendant to pay ${money}${causeFragment}. If unanswered, the plaintiff can obtain a default judgment and proceed to wage garnishment, bank levy, or seizure of personal property.`
        : `Plaintiff is asking the court to enter judgment requiring the Defendant to pay an outstanding debt${causeFragment}. If unanswered, default judgment and collection enforcement will follow.`;
    case 'eviction':
      return `Plaintiff (landlord/property owner) is asking the court for possession of the premises${causeFragment}. If the Defendant does not respond within the very short eviction window, the court can issue a writ of restitution and the constable can physically remove the occupants.`;
    case 'divorce_family':
      return `Petitioner is asking the court to dissolve the marriage and/or divide marital property and debts${causeFragment}. If the Respondent does not respond, the court may grant the petitioner's requested relief by default.`;
    case 'custody_visitation':
      return `Petitioner is asking the court to determine custody, parent-time, and/or child support${causeFragment}. Failure to respond means the court may set the requested arrangement by default.`;
    case 'protective_order':
      return `Petitioner has obtained or is seeking a court order restricting the Respondent's contact and/or movement${causeFragment}. The order's restrictions become enforceable upon service. Violation is a criminal offense.`;
    case 'subpoena':
      return `The court is commanding the Defendant to appear at a hearing and/or produce specified documents. Non-compliance carries contempt-of-court risk (fines, arrest warrant).`;
    case 'order_to_show_cause':
      return `The court is requiring the Defendant to appear and explain why they should not be sanctioned, held in contempt, or have an existing order modified${causeFragment}.`;
    case 'small_claims':
      return money
        ? `Plaintiff is asking the small-claims court to enter judgment for ${money}${causeFragment}. Defendant must appear at the hearing date stated on the summons; written answer is generally not required.`
        : `Plaintiff is asking the small-claims court to enter judgment against the Defendant${causeFragment}. Defendant must appear at the hearing date.`;
    case 'judgment_renewal':
      return `Plaintiff is seeking to enforce or renew an existing money judgment against the Defendant${causeFragment}. Service of these documents activates the plaintiff's collection remedies (garnishment, bank levy, seizure).`;
    case 'civil_suit_general':
      return money
        ? `Plaintiff is asking the court to award ${money} in damages${causeFragment}. If unanswered, default judgment will enter for the amount sought plus costs.`
        : `Plaintiff is asking the court to award damages and/or other relief${causeFragment}. If unanswered, default judgment may enter.`;
    case 'unknown':
    default:
      return money
        ? `The Plaintiff is seeking ${money} from the Defendant. Refer to the Complaint for the specific legal theory.`
        : `The Plaintiff is seeking court-ordered relief from the Defendant. Refer to the Complaint for the specific legal theory.`;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Main entry
// ─────────────────────────────────────────────────────────────────────
export function synthesizeCaseNarrative(input: CaseNarrativeInput): CaseNarrativeResult {
  const docket = input.courtDocket || '';
  const defendantFull = `${input.defendantFirst}${input.defendantMiddle ? ' ' + input.defendantMiddle : ''} ${input.defendantLast}`.trim() || 'the Defendant';
  const plaintiff = (input.plaintiff || 'The Plaintiff').split(',')[0].trim();
  const filingDate = extractFilingDate(docket, input.signedDate);
  const incidentDate = extractIncidentDate(docket);
  const incidentLocation = extractIncidentLocation(docket);
  const firstCause = extractFirstCauseOfAction(docket);
  const firstAllegation = extractFirstAllegation(docket);
  const coDefendants = extractCoDefendants(docket, input.defendantLast);

  // ── WHO ──
  const whoLines: string[] = [];
  whoLines.push(`PLAINTIFF: ${plaintiff}`);
  whoLines.push(`DEFENDANT BEING SERVED: ${defendantFull}${input.defendantEntityType === 'organization' ? ' (organization)' : ''}`);
  if (coDefendants.length > 0) {
    whoLines.push(`CO-DEFENDANTS: ${coDefendants.join('; ')}${coDefendants.length === 6 ? '; ... (more in caption)' : ''}`);
  }
  if (input.attorney.name) {
    const firmFrag = input.attorney.firm ? ` of ${input.attorney.firm}` : '';
    const barFrag = input.attorney.barNumber ? ` (Bar #${input.attorney.barNumber})` : '';
    whoLines.push(`PLAINTIFF'S COUNSEL: ${input.attorney.name}${firmFrag}${barFrag}`);
  }
  whoLines.push(`COURT: ${input.court || NOT_STATED}${input.courtCaseNumber ? `, Case No. ${input.courtCaseNumber}` : ''}`);
  const who = whoLines.join('\n');

  // ── WHAT ──
  const whatLines: string[] = [];
  const docList = (input.documents || '').split(/\s*;\s*/).map((s) => s.trim()).filter(Boolean).join(' + ') || 'the legal papers';
  whatLines.push(`Documents being served: ${docList}.`);
  if (firstCause) {
    whatLines.push(`The Complaint asserts at least one cause of action for ${firstCause.toLowerCase()}.`);
  }
  if (firstAllegation) {
    whatLines.push(`Allegation excerpt from the Complaint: "${firstAllegation.length > 280 ? firstAllegation.slice(0, 280) + '…' : firstAllegation}"`);
  } else {
    whatLines.push(`No specific allegation excerpt was auto-extracted; the operative facts are set forth in the Complaint body.`);
  }
  if (input.moneyAtStake) {
    whatLines.push(`Amount in controversy referenced in the filing: ${input.moneyAtStake}.`);
  }
  const what = whatLines.join(' ');

  // ── WHERE ──
  const whereLines: string[] = [];
  whereLines.push(`Court of filing: ${input.court || NOT_STATED}${input.county ? `, ${input.county} County` : ''}.`);
  if (input.courtAddress) whereLines.push(`Court address (where the answer must be filed): ${input.courtAddress}.`);
  if (incidentLocation) whereLines.push(`Location referenced in the underlying allegations: ${incidentLocation}.`);
  whereLines.push(`Service is being attempted at the Defendant's last-known address per the field sheet.`);
  const where = whereLines.join(' ');

  // ── WHEN ──
  const whenLines: string[] = [];
  whenLines.push(`Complaint filed / signed: ${filingDate}.`);
  if (incidentDate) whenLines.push(`Underlying incident: on or about ${incidentDate}.`);
  whenLines.push(`Defendant has ${input.responseDeadlineDays || 21} day(s) after service to file an Answer with the court.`);
  whenLines.push(`Failure to respond within that window allows the Plaintiff to seek a default judgment.`);
  const when = whenLines.join(' ');

  // ── WHY ──
  const why = whyPhraseForCategory(input.category, input.moneyAtStake, firstCause);

  // Compose final note text
  const sections: Array<[string, string]> = [
    ['WHO', who],
    ['WHAT', what],
    ['WHERE', where],
    ['WHEN', when],
    ['WHY', why],
  ];

  const lines: string[] = [];
  lines.push('📝 CASE NARRATIVE — Detailed review of the Complaint');
  lines.push('═'.repeat(60));
  lines.push('Auto-generated from the court-docket text. Verify against the underlying PDF before relying on for affidavits.');
  lines.push('');
  for (const [label, body] of sections) {
    lines.push(`▸ ${label}`);
    lines.push(body);
    lines.push('');
  }

  return {
    fullText: lines.join('\n').trimEnd(),
    who, what, where, when, why,
  };
}
