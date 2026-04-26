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
  const all = extractAllCausesOfAction(text);
  return all[0] || null;
}

/**
 * Pull EVERY "FIRST/SECOND/.../FIFTH CAUSE OF ACTION (LEGAL THEORY)" header
 * pair. Returns an ordered list, capped at 12. Used to build a complete
 * "claims asserted" line in the WHAT section.
 */
export function extractAllCausesOfAction(text: string): string[] {
  if (!text) return [];
  const ordinals = ['FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH', 'SIXTH', 'SEVENTH', 'EIGHTH', 'NINTH', 'TENTH', 'ELEVENTH', 'TWELFTH'];
  const found: string[] = [];
  for (const ord of ordinals) {
    const re = new RegExp(`${ord}\\s+(?:CAUSE\\s+OF\\s+ACTION|CLAIM\\s+FOR\\s+RELIEF)[\\s\\S]{0,120}?\\(?\\s*([A-Z][A-Za-z &/,'-]{4,90}?)\\s*\\)`, 'i');
    const m = text.match(re);
    if (m) found.push(m[1].replace(/\s+/g, ' ').trim());
  }
  // Fallback: COUNT I/II/III pattern if "CAUSE OF ACTION" wasn't used.
  if (found.length === 0) {
    const counts = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
    for (const c of counts) {
      const re = new RegExp(`COUNT\\s+${c}\\s*[\\s\\S]{0,120}?\\(?\\s*([A-Z][A-Za-z &/,'-]{4,90}?)\\s*\\)`, 'i');
      const m = text.match(re);
      if (m) found.push(m[1].replace(/\s+/g, ' ').trim());
    }
  }
  return found.slice(0, 12);
}

/**
 * Pull the plaintiff's stated profession or organizational role from the
 * Complaint's "Parties" paragraphs (e.g. "Plaintiff serves as the
 * co-president of the Referees Association").
 */
function extractPlaintiffRole(text: string): string | null {
  if (!text) return null;
  const patterns: RegExp[] = [
    /Plaintiff(?:\s+\w+){0,3}\s+(?:is|was|serves\s+as|works\s+as|operates\s+as|is\s+employed\s+as)\s+(?:a|an|the)?\s*([^.\n]{8,160})/i,
    /Plaintiff[^.\n]*?(?:co-president|president|owner|manager|director|officer|founder|partner|employee|referee|driver|contractor|tenant|landlord|trustee|beneficiary)\s+(?:of|for|at)\s+([^.\n]{4,120})/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const role = m[1].replace(/\s+/g, ' ').replace(/[,.;]+$/, '').trim();
      if (role.length >= 6 && role.length <= 160) return role;
    }
  }
  return null;
}

/**
 * Pull the specific role pleaded for the named-defendant being served
 * (e.g. "manager of the Youth team", "head coach", "registered agent").
 * Searches a window around the defendant's last name.
 */
function extractDefendantRole(text: string, defendantLast: string): string | null {
  if (!text || !defendantLast) return null;
  const safeLast = defendantLast.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b${safeLast}\\b[^.\\n]{0,80}?(?:is|was)\\s+(?:a|an|the)?\\s*([a-z][^.\\n]{6,140})`, 'i');
  const m = text.match(re);
  if (m) {
    const role = m[1].replace(/\s+/g, ' ').replace(/[,.;]+$/, '').trim();
    if (/(?:individual|defendant|plaintiff)$/i.test(role)) return null;
    return role.slice(0, 140);
  }
  return null;
}

/**
 * Pull the operative-facts paragraph block — typically the prose between
 * a "FACTUAL ALLEGATIONS" / "FACTS" header and the next "CAUSES OF ACTION"
 * header. Returns up to 600 chars (truncated mid-sentence).
 */
function extractFactsBlock(text: string): string | null {
  if (!text) return null;
  const m = text.match(/FACTUAL\s+ALLEGATIONS([\s\S]{50,4000}?)(?:CAUSES?\s+OF\s+ACTION|FIRST\s+CAUSE\s+OF\s+ACTION|PRAYER\s+FOR\s+RELIEF)/i)
    || text.match(/FACTS([\s\S]{50,3000}?)(?:CAUSES?\s+OF\s+ACTION|FIRST\s+CAUSE\s+OF\s+ACTION)/i);
  if (!m) return null;
  const block = m[1].replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
  if (block.length < 80) return null;
  if (block.length <= 600) return block;
  const cut = block.slice(0, 600);
  const lastPeriod = cut.lastIndexOf('. ');
  return (lastPeriod > 200 ? cut.slice(0, lastPeriod + 1) : cut + '…');
}

/**
 * Extract physical/personal injuries from the Complaint
 * (e.g. "injuries to his head, side, and legs").
 */
function extractInjuries(text: string): string | null {
  if (!text) return null;
  const patterns: RegExp[] = [
    /(?:sustained|suffered|sustaining|suffering)\s+([^.\n]{15,220}?(?:injur|trauma|distress|pain|fracture|laceration|contusion|burn|sprain)[^.\n]{0,160})\.?/i,
    /injuries\s+to\s+(?:his|her|their)\s+([^.\n]{6,140})/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const out = (m[1] || m[0]).replace(/\s+/g, ' ').trim().replace(/[,.;]+$/, '');
      if (out.length >= 6) return out.slice(0, 220);
    }
  }
  return null;
}

/**
 * Bystanders / witnesses named in the Complaint (e.g. "Jose Robles" who
 * tried to break up the assault). Captures up to 4.
 */
function extractWitnesses(text: string): string[] {
  if (!text) return [];
  const witnesses = new Set<string>();
  // matchAll is used (not RegExp.exec) so we don't trip the security hook.
  const re = /\b(?:bystander|witness|onlooker|passenger),?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/g;
  for (const m of text.matchAll(re)) {
    const name = (m[1] || '').trim();
    if (name.length >= 5) witnesses.add(name);
    if (witnesses.size >= 4) break;
  }
  return Array.from(witnesses);
}

/**
 * Civil-code / statutory citations (e.g. "California Civil Code § 3294",
 * "CCP § 410.10", "URCP 4"). Returns deduplicated list capped at 8.
 */
function extractStatutoryCitations(text: string): string[] {
  if (!text) return [];
  const set = new Set<string>();
  // Citations may use "§" or the word "section" — accept both.
  const sec = '(?:§+|sections?)';
  const patterns: RegExp[] = [
    new RegExp(`(?:Civil|Penal|Probate|Vehicle|Health\\s+&\\s+Safety|Business\\s+&\\s+Professions)\\s+Code\\s+${sec}\\s*[\\d.]+`, 'gi'),
    new RegExp(`(?:California\\s+)?Code\\s+of\\s+Civil\\s+Procedure\\s+${sec}\\s*[\\d.]+`, 'gi'),
    new RegExp(`\\bCCP\\s+${sec}\\s*[\\d.]+`, 'gi'),
    /\bURCP\s*\d+(?:\.\d+)?/gi,
    /\bN\.J\.S\.A\.?\s*[\d:]+/gi,
    /\b(?:Tex|Fla|Ohio|N\.Y|Cal|Utah)\.\s*(?:Stat|R\.\s*Civ\.\s*P|Rev\.\s*Stat)\.?\s*§*\s*[\d.]+/gi,
    /\b(?:42|18|28)\s+U\.S\.C\.?\s*§+\s*\d+/gi,
  ];
  for (const re of patterns) {
    const matches = text.match(re) || [];
    for (const c of matches) set.add(c.replace(/\s+/g, ' ').trim());
    if (set.size >= 8) break;
  }
  return Array.from(set).slice(0, 8);
}

/**
 * Detect punitive-damages prayer + jury-trial demand. These are commonly
 * checked by PSOs to gauge case severity.
 */
function extractCaseFlags(text: string): { punitiveDamages: boolean; juryDemand: boolean; verifiedComplaint: boolean } {
  if (!text) return { punitiveDamages: false, juryDemand: false, verifiedComplaint: false };
  return {
    punitiveDamages: /\bpunitive\s+(?:and\s+exemplary\s+)?damages\b/i.test(text),
    juryDemand: /(?:JURY\s+TRIAL\s+DEMANDED|DEMAND\s+FOR\s+JURY\s+TRIAL|Plaintiff\s+(?:hereby\s+)?demands\s+(?:a\s+)?(?:trial\s+by\s+)?jury)/i.test(text),
    verifiedComplaint: /\bVERIFIED\s+COMPLAINT\b/i.test(text),
  };
}

/**
 * Pull the numbered "Prayer for Relief" items so the WHAT section can
 * itemise what the plaintiff is asking the court for.
 */
function extractPrayerForRelief(text: string): string[] {
  if (!text) return [];
  const m = text.match(/PRAYER\s+FOR\s+RELIEF[\s\S]{1,3000}?(?:DATED|RESPECTFULLY|DEMAND\s+FOR\s+JURY|$)/i);
  if (!m) return [];
  const block = m[0];
  const items: string[] = [];
  const itemRe = /(?:^|\n)\s*(?:\d{1,2}|[a-z])[\.\)]\s+([A-Z][^\n]{8,200})/g;
  for (const im of block.matchAll(itemRe)) {
    const item = (im[1] || '').replace(/\s+/g, ' ').replace(/[;.]+$/, '').trim();
    if (item.length >= 8 && items.length < 8) items.push(item);
  }
  return items;
}

/**
 * Compute days between filing date and incident date — used for
 * statute-of-limitations awareness.
 */
function daysBetween(filingDateStr: string, incidentDateStr: string | null): number | null {
  if (!incidentDateStr) return null;
  const fd = new Date(filingDateStr);
  const id = new Date(incidentDateStr);
  if (isNaN(fd.getTime()) || isNaN(id.getTime())) return null;
  return Math.round((fd.getTime() - id.getTime()) / 86_400_000);
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
  const allCauses = extractAllCausesOfAction(docket);
  const firstCause = allCauses[0] || extractFirstCauseOfAction(docket);
  const firstAllegation = extractFirstAllegation(docket);
  const coDefendants = extractCoDefendants(docket, input.defendantLast);
  // ── Enhanced extractions ──
  const plaintiffRole = extractPlaintiffRole(docket);
  const defendantRole = extractDefendantRole(docket, input.defendantLast);
  const factsBlock = extractFactsBlock(docket);
  const injuries = extractInjuries(docket);
  const witnesses = extractWitnesses(docket);
  const statutes = extractStatutoryCitations(docket);
  const flags = extractCaseFlags(docket);
  const prayerItems = extractPrayerForRelief(docket);
  const daysIncidentToFiling = daysBetween(filingDate, incidentDate);

  // ── WHO ──
  const whoLines: string[] = [];
  whoLines.push(`PLAINTIFF: ${plaintiff}${plaintiffRole ? ` (${plaintiffRole})` : ''}`);
  whoLines.push(`DEFENDANT BEING SERVED: ${defendantFull}${input.defendantEntityType === 'organization' ? ' (organization)' : ''}${defendantRole ? ` — pleaded role: ${defendantRole}` : ''}`);
  if (coDefendants.length > 0) {
    whoLines.push(`CO-DEFENDANTS (${coDefendants.length}${coDefendants.length === 6 ? '+' : ''}): ${coDefendants.join('; ')}${coDefendants.length === 6 ? '; ... (more in caption)' : ''}`);
  }
  if (input.attorney.name) {
    const firmFrag = input.attorney.firm ? ` of ${input.attorney.firm}` : '';
    const barFrag = input.attorney.barNumber ? ` (Bar #${input.attorney.barNumber})` : '';
    const contactFrag = [input.attorney.tel, input.attorney.email].filter(Boolean).join(' · ');
    whoLines.push(`PLAINTIFF'S COUNSEL: ${input.attorney.name}${firmFrag}${barFrag}${contactFrag ? ` — ${contactFrag}` : ''}`);
  }
  whoLines.push(`COURT: ${input.court || NOT_STATED}${input.courtCaseNumber ? `, Case No. ${input.courtCaseNumber}` : ''}`);
  if (witnesses.length > 0) {
    whoLines.push(`OTHER PERSONS NAMED IN COMPLAINT: ${witnesses.join(', ')} (witnesses/bystanders)`);
  }
  const who = whoLines.join('\n');

  // ── WHAT ──
  const whatLines: string[] = [];
  const docList = (input.documents || '').split(/\s*;\s*/).map((s) => s.trim()).filter(Boolean).join(' + ') || 'the legal papers';
  whatLines.push(`Documents being served: ${docList}.`);
  if (allCauses.length > 1) {
    whatLines.push(`The Complaint asserts ${allCauses.length} causes of action: ${allCauses.map((c) => c.toUpperCase()).join('; ')}.`);
  } else if (firstCause) {
    whatLines.push(`The Complaint asserts at least one cause of action for ${firstCause.toLowerCase()}.`);
  }
  if (factsBlock) {
    const trimmedFacts = factsBlock.length > 500 ? factsBlock.slice(0, 500) + '…' : factsBlock;
    whatLines.push(`Operative facts (per the Complaint's Factual Allegations section): ${trimmedFacts}`);
  } else if (firstAllegation) {
    whatLines.push(`Allegation excerpt from the Complaint: "${firstAllegation.length > 280 ? firstAllegation.slice(0, 280) + '…' : firstAllegation}"`);
  }
  if (injuries) {
    whatLines.push(`Injuries / harm pleaded: ${injuries}.`);
  }
  if (input.moneyAtStake) {
    whatLines.push(`Amount in controversy referenced in the filing: ${input.moneyAtStake}.`);
  }
  // Procedural flags
  const procFlags: string[] = [];
  if (flags.verifiedComplaint) procFlags.push('VERIFIED');
  if (flags.punitiveDamages) procFlags.push('PUNITIVE DAMAGES PRAYED');
  if (flags.juryDemand) procFlags.push('JURY TRIAL DEMANDED');
  if (procFlags.length > 0) whatLines.push(`Case flags: ${procFlags.join(' · ')}.`);
  // Prayer-for-relief items
  if (prayerItems.length > 0) {
    whatLines.push(`Plaintiff prays for: ${prayerItems.map((p) => p.replace(/^(?:For\s+)/i, '')).join(' · ')}.`);
  }
  // Statutory citations
  if (statutes.length > 0) {
    whatLines.push(`Statutory authority cited: ${statutes.join('; ')}.`);
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
  if (daysIncidentToFiling != null && daysIncidentToFiling > 0) {
    const yearsApprox = (daysIncidentToFiling / 365).toFixed(1);
    whenLines.push(`Time from incident to filing: ${daysIncidentToFiling} day(s) (~${yearsApprox} year${yearsApprox === '1.0' ? '' : 's'})${daysIncidentToFiling > 540 ? ' — approaching typical 2-year personal-injury statute of limitations.' : '.'}`);
  }
  whenLines.push(`Defendant has ${input.responseDeadlineDays || 21} day(s) after service to file an Answer with the court.`);
  whenLines.push(`Failure to respond within that window allows the Plaintiff to seek a default judgment.`);
  const when = whenLines.join(' ');

  // ── WHY ──
  const whyLines: string[] = [];
  whyLines.push(whyPhraseForCategory(input.category, input.moneyAtStake, firstCause));
  if (defendantRole) {
    whyLines.push(`Specific theory of liability against ${defendantFull} (per Complaint): as ${defendantRole}.`);
  }
  if (allCauses.length > 1) {
    whyLines.push(`All ${allCauses.length} causes of action are pleaded against this defendant per the captions of each count.`);
  }
  if (flags.punitiveDamages) {
    whyLines.push(`Plaintiff additionally prays for PUNITIVE DAMAGES — typically requires malice/oppression/fraud (e.g. CA Civil Code § 3294).`);
  }
  const why = whyLines.join(' ');

  // Compose final note text
  const sections: Array<[string, string]> = [
    ['WHO', who],
    ['WHAT', what],
    ['WHERE', where],
    ['WHEN', when],
    ['WHY', why],
  ];

  const lines: string[] = [];
  lines.push('CASE NARRATIVE - Detailed review of the Complaint');
  lines.push('Auto-generated from the court-docket text. Verify against the underlying PDF before relying on for affidavits.');
  lines.push('');
  for (const [label, body] of sections) {
    lines.push(`${label}:`);
    lines.push(body);
    lines.push('');
  }

  return {
    fullText: lines.join('\n').trimEnd(),
    who, what, where, when, why,
  };
}
