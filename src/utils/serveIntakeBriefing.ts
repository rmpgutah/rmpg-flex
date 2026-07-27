// ============================================================
// RMPG Flex — Serve Intake → PSO pre-arrival briefing
// ============================================================
// Turns the extracted/merged fields into the officer-facing
// notations a PSO reads on the dispatch CFS BEFORE arrival:
//
//   • notes[]               — the JSON note feed the dispatch call
//                             panel renders in the Notes tab. Same
//                             shape dispatch/extensions.ts writes:
//                             { id, author, text, timestamp }.
//   • scene_safety          — short text shown in the Info tab's
//                             Scene section.
//   • officer_safety_caution / domestic_violence
//                           — INTEGER 0/1 flags shown as red badges
//                             and in the Flags tab.
//   • descriptionPrefix     — an OFFICER SAFETY marker prepended to the call
//                             description so the queue row itself
//                             reads "hot" at a glance.
//
// All target columns were verified present on LIVE D1
// (785de7ae) 2026-05-29 before this writer was wired in.
//
// Officer-safety policy (set 2026-05-29 by the RMPG operator):
//   every civil paper carries a BASELINE caution; evictions and
//   protective/restraining orders escalate to HIGH; weapon/violence
//   keywords in the documents escalate regardless of type; protective
//   orders additionally set the domestic_violence flag.
// Flip the constants below to change that policy in one place.
// ============================================================

import type { ExtractedField, QueueRow } from './serveIntakeExtract';
import type { AttemptWindow } from './serveDiligencePlanner';
import type { ServiceLocationNote } from './serveLocationNotes';
import { noteConstraintSummary } from './serveLocationNotes';
import type { AddressClass } from './serveAddressClass';

// ── Operator policy switches ─────────────────────────────────
const FLAG_EVICTION = true;        // eviction / unlawful detainer → HIGH
const FLAG_PROTECTIVE = true;      // restraining / protective order → HIGH + DV
const FLAG_KEYWORDS = true;        // weapon/violence keywords → escalate
const FLAG_ALL_CIVIL = true;       // every civil paper → at least BASELINE caution

// ── Keyword sets ─────────────────────────────────────────────
const EVICTION_KW = ['evict', 'unlawful detainer', 'forcible entry', 'notice to quit', 'notice to vacate'];
const PROTECTIVE_KW = ['restrain', 'protective order', 'protection order', 'order of protection', 'no contact', 'stalking injunction', 'civil stalking'];
const DANGER_KW = ['weapon', 'firearm', 'armed', 'handgun', 'knife', 'violent', 'assault', 'do not approach', 'dangerous', 'threat', 'hostile', 'combative', 'felony'];

type Severity = 'none' | 'baseline' | 'high';

export interface SafetyAssessment {
  caution: boolean;
  domesticViolence: boolean;
  severity: Severity;
  sceneSafety: string;       // '' when no caution
  reasons: string[];         // human-readable lines for the safety note
}

const get = (fields: Record<string, ExtractedField>, k: string) =>
  (fields[k]?.value || '').trim();

// Concatenate the free-text fields most likely to mention a hazard so a
// single lowercased scan can catch weapon/violence language the field
// sheet noted, independent of the document classification.
function hazardHintText(fields: Record<string, ExtractedField>, queueRow: QueueRow): string {
  return [
    queueRow.document_type, get(fields, 'document_subtype'),
    queueRow.service_instructions, queueRow.notes,
    get(fields, 'service_windows'), get(fields, 'process_type'),
  ].filter(Boolean).join(' ').toLowerCase();
}

function hasAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

// Finding 2 FIX: a bare weekday mention or a bare digit-with-colon/am/pm
// was too permissive — "Attorney available Monday-Friday for questions" or
// "Hearing set for Friday, 6/20" would be printed as a verbatim client
// ATTEMPT-TIME restriction ("Do NOT attempt outside these hours"), which is
// a fabricated instruction the client never gave. A line only counts as a
// restriction when it has EITHER a genuine clock-time RANGE (two distinct
// clock values, e.g. "9AM-3:30PM" or "between 9am and 3:30pm") OR explicit
// service/attempt language tied to timing. Mentioning a day of the week or
// a bare date is not, by itself, evidence of an attempt-window restriction.
const CLOCK_VALUE_RE = /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi;
const RESTRICTION_KEYWORDS = ['serve', 'service', 'attempt', 'do not serve', 'no service'];

function hasClockTimeRange(line: string): boolean {
  const matches = line.match(CLOCK_VALUE_RE);
  return !!matches && matches.length >= 2;
}

function hasRestrictionLanguage(line: string): boolean {
  const lower = line.toLowerCase();
  return RESTRICTION_KEYWORDS.some((kw) => lower.includes(kw));
}

// D2 FIX: the client's attempt restriction is written in
// service_instructions far more often than in notes, and notes' first
// line is usually the OCR provenance stamp. Reading only notes[0] made
// the report print "no client restriction" on packets whose own
// description quoted the client's schedule.
export function clientWindowText(queueRow: QueueRow): string | null {
  const candidates = [queueRow.service_instructions, queueRow.notes];
  for (const raw of candidates) {
    if (!raw) continue;
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      if (t.startsWith('[OCR')) continue;           // provenance stamp, not a restriction
      if (!hasClockTimeRange(t) && !hasRestrictionLanguage(t)) continue;
      return t;
    }
  }
  return null;
}

// ── The decision point ───────────────────────────────────────
// Maps the document into an officer-safety posture. This is policy for
// a law-enforcement system — kept as one auditable function so the
// rules are reviewable and changeable without touching the writers.
export function assessOfficerSafety(
  fields: Record<string, ExtractedField>,
  queueRow: QueueRow,
): SafetyAssessment {
  const hint = hazardHintText(fields, queueRow);
  const reasons: string[] = [];
  let severity: Severity = 'none';
  let domesticViolence = false;

  const isEviction = hasAny(hint, EVICTION_KW);
  const isProtective = hasAny(hint, PROTECTIVE_KW);
  const hasDanger = hasAny(hint, DANGER_KW);

  if (FLAG_PROTECTIVE && isProtective) {
    severity = 'high';
    domesticViolence = true;
    reasons.push('Protective/restraining order — domestic-violence context. Do NOT serve in the presence of the protected party; coordinate timing. Respondent may be agitated.');
  }
  if (FLAG_EVICTION && isEviction) {
    severity = 'high';
    reasons.push('Eviction / unlawful detainer — elevated risk of a hostile or distressed occupant. Verify occupancy and maintain situational awareness before contact.');
  }
  if (FLAG_KEYWORDS && hasDanger) {
    severity = 'high';
    reasons.push('Document text references weapons, violence, or a "do not approach" caution. Treat as elevated risk; consider backup.');
  }
  if (severity === 'none' && FLAG_ALL_CIVIL) {
    severity = 'baseline';
    reasons.push('Routine civil paper service. Standard approach precautions; confirm identity before serving.');
  }

  const caution = severity !== 'none';
  const sceneSafety = !caution ? '' : (
    severity === 'high'
      ? `ELEVATED RISK — ${reasons[0]}`
      : 'Routine civil paper service — standard approach precautions.'
  );

  return { caution, domesticViolence, severity, sceneSafety, reasons };
}

// ── Briefing inputs ──────────────────────────────────────────

// Existing property record fields relevant to service operations.
// Only populated when findOrCreateProperty returned created=false (existing row).
export interface PropertyRecord {
  gate_code?: string | null;
  alarm_code?: string | null;
  alarm_account?: string | null;
  alarm_company?: string | null;
  key_holder_name?: string | null;
  key_holder_phone?: string | null;
  post_orders?: string | null;
  access_instructions?: string | null;
  hazard_notes?: string | null;
}

// Existing business record fields relevant to service operations.
// Only populated when findOrCreateBusiness returned created=false (existing row).
export interface BusinessRecord {
  owner_name?: string | null;
  owner_phone?: string | null;
  contact_name?: string | null;
  contact_phone?: string | null;
  phone?: string | null;
  notes?: string | null;
}

export interface BriefingInput {
  fields: Record<string, ExtractedField>;
  queueRow: QueueRow;
  isBusiness: boolean;
  agentName: string;            // registered agent (corporate service)
  fullLocation: string;         // assembled address string
  docCount: number;
  attemptPlan?: AttemptWindow[];              // diligence planner output (dated windows)
  locationNote?: ServiceLocationNote | null;  // system notation for this address/entity
  propertyRecord?: PropertyRecord | null;
  businessRecord?: BusinessRecord | null;
  addressClass?: AddressClass;
  scheduleImpossible?: boolean;
  hasClientSchedule?: boolean;  // true only when the client actually dictated attempt bands
}

export interface BriefingNote {
  id: string;
  author: string;
  text: string;
  timestamp: string;
}

export interface PsoBriefing {
  notes: BriefingNote[];
  sceneSafety: string;
  officerSafetyCaution: 0 | 1;
  domesticViolence: 0 | 1;
  descriptionPrefix: string;    // '' or 'OFFICER SAFETY · '
}

// ── Tactical knowledge base ──────────────────────────────────
// Deterministic, reviewable guidance keyed off the document class and
// recipient type — never LLM-generated, so rule citations stay accurate.
// Utah Rules of Civil Procedure references current as of 2026.

// Who may lawfully accept service, by recipient class (URCP 4(d)).
function serviceAuthorityLines(isBusiness: boolean, hint: string, addressClass: AddressClass): string[] {
  const lines: string[] = [];
  if (!isBusiness && addressClass === 'business') {
    lines.push('SERVICE AT A PLACE OF EMPLOYMENT: substitute service on a co-worker is NOT dwelling substitute service. Unless the client expressly authorizes it, the recipient must be served PERSONALLY at a business address.');
  }
  if (isBusiness) {
    lines.push('Corporate/LLC service per URCP 4(d)(1)(E): deliver to an officer, a managing or general agent, or the registered agent. Any employee 18+ expressly authorized to accept also qualifies at the business location.');
    lines.push('If serving at a RESIDENCE: personal delivery to the registered agent or an owner/member only — a spouse or co-resident may accept ONLY if authorized or a member of the company.');
    lines.push('If the entity cannot be located after diligence, Utah law permits service on the Division of Corporations as statutory agent — that is a counsel decision; report the failed diligence, do not self-initiate.');
  } else {
    lines.push('Individual service per URCP 4(d)(1)(A): personal delivery, or substitute service at the dwelling on a resident of suitable age and discretion, or delivery to an authorized agent.');
    lines.push('A minor or obviously impaired resident is NOT of suitable age and discretion — do not substitute-serve on them; re-attempt instead.');
  }
  if (hint.includes('summons') || hint.includes('complaint')) {
    lines.push('Summons/complaint: the recipient has 21 days to answer if served in Utah, 30 days if served out of state (URCP 12(a)) — clock starts on the date of service; the affidavit date is jurisdictional. Do not advise the recipient beyond what is printed on the summons.');
  }
  if (hint.includes('subpoena')) {
    lines.push('Subpoena (URCP 45): confirm whether witness fees must be tendered at service — check with the hiring party before attempt if not provided.');
  }
  if (hasAny(hint, EVICTION_KW)) {
    lines.push('Eviction/UD papers: personal or substitute service preferred; post-and-mail ONLY where the court has authorized alternative service — verify the order before posting.');
  }
  if (hint.includes('garnish')) {
    lines.push('Garnishment papers: serve the garnishee (employer/bank) through its authorized agent; interrogatory deadlines run from service — record exact time.');
  }
  return lines;
}

// Approach guidance derived from the document class + extracted facts.
function tacticalApproachLines(input: BriefingInput, hint: string): string[] {
  const { fields, queueRow, isBusiness } = input;
  const f = (k: string) => get(fields, k);
  const lines: string[] = [];

  if (isBusiness) {
    lines.push('Attempt during posted business hours first; confirm the entity actually operates at the address (signage, suite directory, staff acknowledgment) before tendering. Ask for the registered agent or a manager by name.');
    lines.push('If the business has vacated: photograph the frontage/suite, obtain a forwarding address from neighboring tenants or property management, and flag for skip trace — do not leave papers at a vacated unit.');
    lines.push('Note the full name AND title of whoever accepts — "authorized to accept" must be supportable in the affidavit.');
  } else {
    lines.push('Verify identity before tender: name confirmation plus DOB or physical description when available. A verbal "yes, that\'s me" at the correct address is sufficient; note exactly how identity was established.');
    lines.push('If substitute-serving, record the resident\'s name, relationship to the recipient, and physical description, and confirm they actually reside there (not a guest or visitor).');
  }
  const docs = (f('documents_to_serve') || '').toLowerCase();
  if (docs.includes('bilingual') || docs.includes('spanish')) {
    lines.push('Packet includes a BILINGUAL NOTICE — anticipate a Spanish-speaking recipient; serve the complete packet including the translated notice.');
  }
  if (hasAny(hint, EVICTION_KW)) {
    lines.push('Eviction context: occupant may be distressed or displaced mid-move. De-escalate; do not discuss case merits — refer all questions to the court or counsel.');
  }
  if (hasAny(hint, PROTECTIVE_KW)) {
    lines.push('Protective-order context: do NOT stage or serve in the presence of the protected party. Time the approach to avoid contact between parties.');
  }
  // Refusal + evasion doctrine — applies to every paper type.
  lines.push('REFUSAL: once identity is reasonably confirmed, a refusal to take the papers does not defeat service — announce the nature of the documents, leave them in plain view near the person, and record their words and actions verbatim. Never force papers into hands or wedge them in a door.');
  lines.push('EVASION INDICATORS: vehicle in drive, lights/TV on, movement or voices inside with no answer — document each indicator with time; they are evidence for an alternative-service motion. Neighbor contact is permitted to confirm residency ONLY — never disclose the nature of the documents or case details to third parties.');
  lines.push('Body-camera/GPS on at every attempt; photograph the location on no-answer attempts to support the diligence affidavit. See ■ SERVICE WINDOWS below for authorized attempt hours.');
  return lines;
}

// Attempt-cadence and proof-of-service doctrine — paper-type independent.
const DILIGENCE_LINES = [
  'Minimum three attempts before requesting alternative service: stagger across morning (07:00–09:00), midday, and evening (17:00–20:30), and include at least one weekend attempt — residential hit rates peak early morning and early evening.',
  'First attempt within 48 hours of assignment. Log every attempt in the system at the scene, not end-of-shift — timestamps and GPS are the diligence record.',
  'BAD ADDRESS: confirm with an occupant or neighbor, photograph the location, and request skip trace immediately — do not burn additional attempts on a confirmed bad address.',
  'After exhausting attempts: compile the attempt log and notify the hiring party — alternative service (URCP 4(d)(5)) is counsel\'s motion to make, supported by your documented diligence.',
];

const AFFIDAVIT_LINES = [
  'Each attempt: date, exact time, GPS coordinates, and outcome.',
  'On completed service: full name and title/relationship of the person served, manner of service (personal / substitute / corporate-agent), and a physical description (sex, approximate age, height, build, hair) — required if service is later contested.',
  'On refusal or evasion: the recipient\'s exact words and actions, and where the documents were left.',
  'On no-answer: photograph of the door/frontage with timestamp; note evasion indicators observed.',
];

// Days from nowIso to deadlineIso (negative = overdue). Ceiling so "today"
// reads as 1 rather than 0, giving the officer accurate language at a glance.
function daysUntil(deadlineIso: string, nowIso: string): number {
  const dl = new Date(deadlineIso + 'T00:00:00Z').getTime(); // new-date-ok: parsing an ISO string from DB, not clock-reading
  const now = new Date(nowIso).getTime();                    // new-date-ok: nowIso is the caller's already-captured clock value
  return Math.ceil((dl - now) / 86_400_000);
}

// ── Finding 1 FIX: reliable state-code resolution for the UIDDA check ──
// `queueRow.jurisdiction` is a COUNTY/COURT descriptor in practice (the
// extraction few-shot teaches 'Salt Lake', and the intake UI defaults it to
// 'Salt Lake County, Utah') — it is NOT a state code. Comparing it directly
// against `recipient_state` ('UT') mismatched on almost every routine
// in-state job, telling the officer a domestic subpoena "must be
// domesticated under UIDDA" — a fabricated legal instruction. Only trust a
// value that is UNAMBIGUOUSLY a two-letter USPS state code; never guess by
// parsing a county name or substring-matching court_name.
const US_STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
]);

function reliableStateCode(raw: string | null): string | null {
  const t = (raw || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(t) && US_STATE_CODES.has(t) ? t : null;
}

// ── Finding 4 FIX: robust, confidence-aware party matching ─────────────
// `.includes()` substring matching was wrong in BOTH directions: it false-
// MATCHED whenever the recipient's (possibly truncated) name happened to be
// a literal substring of a party string (e.g. "erica james".includes("eric")),
// and it false-NON-matched on ordinary formatting variance ("SMITH, JOHN"
// vs "JOHN SMITH"). The `target.length > 3` guard was also backwards — it
// unconditionally branded any short name (<=3 chars) a non-party regardless
// of evidence. Compare normalized whole-token sets instead, and require
// EVERY recipient token to appear as a whole token in the party string —
// a partial overlap (e.g. a surname alone appearing inside an unrelated
// company name) must NOT count as a match. When the recipient's name
// doesn't carry enough tokens to compare confidently, or there is no party
// text to compare against, report 'unknown' — the caller must stay silent
// rather than assert a status it cannot substantiate.
function normalizeNameTokens(s: string): string[] {
  return s.toUpperCase().replace(/[.,]/g, '').split(/\s+/).filter(Boolean);
}

export type PartyMatchStatus = 'party' | 'non-party' | 'unknown';

export function recipientPartyStatus(recipientName: string, parties: Array<string | null | undefined>): PartyMatchStatus {
  const recipientTokens = normalizeNameTokens(recipientName || '');
  const validParties = parties.filter((p): p is string => !!(p && p.trim()));
  // Fewer than 2 tokens (e.g. a single name, or missing entirely) isn't
  // enough to confidently assert "not a party" — stay silent instead.
  if (recipientTokens.length < 2 || !validParties.length) return 'unknown';
  for (const p of validParties) {
    const partyTokens = new Set(normalizeNameTokens(p));
    if (recipientTokens.every((t) => partyTokens.has(t))) return 'party';
  }
  return 'non-party';
}

// ── Split briefing note builders (spec §3.3) ────────────────────────────
// Each builder owns one topical entry so the PSO reads six focused notes
// instead of one long one. Markdown bold (**) is rendered by the Notes
// tab's renderFormattedText, so section labels stand out. This is a MOVE
// of the sections that used to live in a single buildBriefingNoteText —
// content is unchanged; only the grouping and the per-note title line
// (added so each entry is self-describing when read alone) are new.

// Author: OFFICER SAFETY. Was the `if (assessment.caution)` block inside
// the old buildPsoBriefing. Returns '' when there is no caution so the
// caller's push() skips it — no empty "safety" entry on a baseline job.
function buildSafetyNote(assessment: SafetyAssessment): string {
  if (!assessment.caution) return '';
  const high = assessment.severity === 'high';
  const lines: string[] = [];
  lines.push(`**OFFICER SAFETY — RISK ASSESSMENT: ${high ? 'ELEVATED' : 'BASELINE'}**`);
  lines.push('**Indicators:**');
  for (const r of assessment.reasons) lines.push(`• ${r}`);
  lines.push('**Posture:**');
  if (high) {
    lines.push('• Two-officer response recommended. Notify dispatch on arrival and clear.');
    lines.push('• Park short of the address; approach offset from the door, knock from the hinge side, hands free. Do not enter the residence under any circumstance.');
    lines.push('• Position for egress before initiating contact. Disengage and re-attempt if the contact turns hostile — the paper is not worth an escalation.');
  } else {
    lines.push('• Single-officer standard. Notify dispatch on arrival and clear.');
    lines.push('• Announce purpose, confirm identity, maintain reactionary gap at the door; stand offset, not square to the threshold.');
    lines.push('• Watch for dogs, additional occupants, and vehicle movement on approach; note plates of vehicles at the address for the attempt log.');
  }
  if (assessment.domesticViolence) {
    lines.push('• DV flag set: verify the protected party is not present before approach; document timing in the attempt notes.');
  }
  return lines.join('\n');
}

// Author: INTAKE. Sections: SERVICE PROFILE, CASE, TIMELINE, SERVICE
// AUTHORITY, SERVICE CONSTRAINTS, PROPERTY RECORD, BUSINESS RECORD.
function buildIntakeNote(input: BriefingInput, nowIso: string): string {
  const { fields, queueRow, isBusiness, agentName, fullLocation, docCount } = input;
  const f = (k: string) => get(fields, k);
  const hint = hazardHintText(fields, queueRow);

  const caseLine = [queueRow.case_number, queueRow.court_name, queueRow.jurisdiction]
    .filter(Boolean).join(' · ');
  const parties = [queueRow.plaintiff, queueRow.defendant].filter(Boolean).join(' v. ');

  const lines: string[] = [];
  lines.push('**PROCESS SERVICE — INTAKE PROFILE** *(auto-generated)*');

  lines.push('**■ SERVICE PROFILE**');
  if (isBusiness) {
    lines.push(`Target entity: ${queueRow.recipient_name || f('recipient_business_name') || 'Unknown business'}`);
    if (agentName) lines.push(`Accept-service party: Registered Agent ${agentName}`);
  } else {
    lines.push(`Target: ${queueRow.recipient_name || 'Unknown'}${f('recipient_dob') ? `  (DOB ${f('recipient_dob')})` : ''}`);
  }
  if (fullLocation) lines.push(`Service address: ${fullLocation}${f('recipient_county') ? `  (${f('recipient_county')} County)` : ''}`);
  if (f('recipient_phone')) lines.push(`Recipient phone on file: ${f('recipient_phone')}`);
  if (f('process_type')) lines.push(`Process type: ${f('process_type')}`);
  if (f('document_subtype') && f('document_subtype') !== queueRow.document_type) {
    lines.push(`Document class: ${queueRow.document_type || 'civil paper'} / ${f('document_subtype')}`);
  }
  lines.push(`Documents to serve: ${f('documents_to_serve') || queueRow.document_type || 'Civil paper'}  (${docCount} file${docCount === 1 ? '' : 's'} on record)`);
  if (f('witness_fee_instrument')) {
    lines.push(`__CARRY WITH YOU: ${f('witness_fee_instrument')}__ — a witness fee must be tendered at service. Arriving without it fails the attempt.`);
  }

  if (caseLine || parties) {
    lines.push('**■ CASE**');
    if (caseLine) lines.push(caseLine);
    if (parties) lines.push(`Parties: ${parties}`);
    if (f('filing_date')) lines.push(`Filed: ${f('filing_date')}`);
    if (queueRow.deadline) lines.push(`__SERVICE DEADLINE: ${queueRow.deadline}__`);
    if (queueRow.court_date) lines.push(`Hearing date: ${queueRow.court_date} — service must be perfected with enough lead time for the recipient's appearance.`);

    const target = queueRow.recipient_name || '';
    const partyStatus = recipientPartyStatus(target, [queueRow.plaintiff, queueRow.defendant]);
    if (partyStatus === 'non-party') {
      lines.push(`NOTE: ${target} is NOT a named party in this case — they are a non-party recipient (typical for a subpoena). Do not discuss the case; refer questions to the issuing court or hiring attorney.`);
    }

    const courtState = reliableStateCode(queueRow.jurisdiction);
    const serviceState = reliableStateCode(queueRow.recipient_state);
    if (courtState && serviceState && courtState !== serviceState) {
      lines.push(`OUT-OF-STATE PROCESS: the issuing court is in ${courtState} and service is in ${serviceState}. Under the Uniform Interstate Depositions and Discovery Act the subpoena must be domesticated in the service state — confirm with the hiring party that this has been done before attempting.`);
    }
  }

  // ── TIMELINE: computed urgency for the officer reading this ───
  // "8 days" is actionable. "2026-07-15" is not. Both appear; days-
  // remaining turns an abstract date into a concrete scheduling pressure.
  {
    const dlDays = queueRow.deadline ? daysUntil(queueRow.deadline, nowIso) : null;
    const hDays  = queueRow.court_date ? daysUntil(queueRow.court_date, nowIso) : null;

    const hasUrgency = dlDays !== null || hDays !== null
      || queueRow.priority === 'urgent' || queueRow.priority === 'rush';

    if (hasUrgency) {
      lines.push('**■ TIMELINE**');
      if (dlDays !== null) {
        const tag = dlDays <= 0 ? ' — __PAST DUE — escalate immediately__'
          : dlDays === 1 ? ' — __1 DAY REMAINING ⚠ URGENT__'
          : dlDays <= 3 ? ` — __${dlDays} days remaining ⚠ URGENT — attempt today__`
          : dlDays <= 7 ? ` — ${dlDays} days remaining ⚠ RUSH — front-load attempts`
          : ` — ${dlDays} days remaining`;
        lines.push(`• Deadline: ${queueRow.deadline}${tag}`);
        if (dlDays > 0 && dlDays <= 5) {
          lines.push('• At this deadline distance, alternative service (URCP 4(d)(5)) requires a court motion that needs 3–5 business days — exhaust personal attempts NOW; do not defer.');
        }
      } else {
        lines.push('• No service deadline on file — treat as routine (first attempt within 48h).');
      }
      if (hDays !== null) {
        const htag = hDays <= 0 ? ' — __hearing has passed__'
          : hDays <= 7 ? ` — ${hDays} days until hearing ⚠ immediate service required`
          : ` — ${hDays} days until hearing`;
        lines.push(`• Court / hearing date: ${queueRow.court_date}${htag}`);
        if (hDays > 0 && hDays <= 21) {
          lines.push('• The respondent needs at minimum 21 days from service to appear (URCP 12(a)) — serve immediately or the hearing may need to be continued.');
        }
      }
      if (queueRow.priority === 'urgent' || queueRow.priority === 'rush') {
        lines.push(`• Priority classification: ${queueRow.priority.toUpperCase()} — this packet has been escalated; do not let it sit in queue beyond today's shift.`);
      }
    }
  }

  lines.push('**■ SERVICE AUTHORITY**');
  for (const l of serviceAuthorityLines(isBusiness, hint, input.addressClass || 'unknown')) lines.push(`• ${l}`);

  if (input.locationNote) {
    const note = input.locationNote;
    lines.push('**■ SERVICE CONSTRAINTS** _(recorded system notation — must be observed)_');
    lines.push(`• ${note.note_text}`);
    const summary = noteConstraintSummary(note);
    if (summary && summary !== note.note_type) {
      lines.push(`• Structured constraint: **${summary}**`);
    }
    lines.push('• Attempt windows above have been adjusted to comply with these constraints. Any attempt outside the noted hours or days may be legally challenged — document attempts with timestamps.');
  }

  // ── Property / Business record enrichment ─────────────────
  // When the intake address matched an EXISTING property row, surface its
  // operator-authored security fields so the officer sees them before
  // departure — no need to open a separate records tab.
  if (input.propertyRecord) {
    const p = input.propertyRecord;
    const hasData = p.gate_code || p.alarm_code || p.alarm_company || p.key_holder_name
      || p.access_instructions || p.hazard_notes || p.post_orders;
    if (hasData) {
      lines.push('**■ PROPERTY RECORD** _(on file — verify currency with records)_');
      if (p.gate_code) lines.push(`• Gate code: \`${p.gate_code}\``);
      if (p.alarm_code) lines.push(`• Alarm code: \`${p.alarm_code}\`${p.alarm_account ? `  (acct: ${p.alarm_account})` : ''}${p.alarm_company ? `  via ${p.alarm_company}` : ''}`);
      if (p.key_holder_name) lines.push(`• Key holder: ${p.key_holder_name}${p.key_holder_phone ? `  ·  ${p.key_holder_phone}` : ''}`);
      if (p.access_instructions) lines.push(`• Access: ${p.access_instructions}`);
      if (p.hazard_notes) lines.push(`• ⚠ Hazard notes: ${p.hazard_notes}`);
      if (p.post_orders && !p.post_orders.startsWith('Auto-created')) lines.push(`• Post orders: ${p.post_orders}`);
    }
  }

  if (input.businessRecord) {
    const b = input.businessRecord;
    const hasData = b.owner_name || b.contact_name || b.contact_phone || b.phone || b.notes;
    if (hasData) {
      lines.push('**■ BUSINESS RECORD** _(on file — verify currency with records)_');
      if (b.owner_name) lines.push(`• Owner: ${b.owner_name}${b.owner_phone ? `  ·  ${b.owner_phone}` : ''}`);
      if (b.contact_name) lines.push(`• Contact: ${b.contact_name}${b.contact_phone ? `  ·  ${b.contact_phone}` : ''}`);
      if (b.phone && b.phone !== b.owner_phone && b.phone !== b.contact_phone) {
        lines.push(`• Main phone: ${b.phone}`);
      }
      if (b.notes && !b.notes.startsWith('Auto-created')) lines.push(`• Notes: ${b.notes}`);
    }
  }

  return lines.join('\n');
}

// Author: DISPATCH. Section: TACTICAL APPROACH.
function buildTacticalNote(input: BriefingInput, hint: string): string {
  const lines: string[] = [];
  lines.push('**PROCESS SERVICE — TACTICAL APPROACH** *(auto-generated)*');
  lines.push('**■ TACTICAL APPROACH**');
  for (const l of tacticalApproachLines(input, hint)) lines.push(`• ${l}`);
  return lines.join('\n');
}

// Author: DISPATCH. Sections: RECOMMENDED ATTEMPT PLAN, SERVICE WINDOWS,
// DILIGENCE STANDARD, plus the Task 6 impossible-schedule warning.
function buildPlanNote(input: BriefingInput): string {
  const { queueRow } = input;
  const lines: string[] = [];
  lines.push('**PROCESS SERVICE — ATTEMPT PLAN** *(auto-generated)*');

  if (input.attemptPlan?.length) {
    lines.push('**■ RECOMMENDED ATTEMPT PLAN**');
    for (const w of input.attemptPlan) {
      lines.push(`• Attempt ${w.attempt}: ${w.weekday} ${w.date}, ${w.window}  (${w.focus}) [${w.authority}]`);
    }
    lines.push('• Adjust to client-specified windows and field conditions; following the plan satisfies the time-variance diligence standard.');
    // Finding 3 FIX: only blame "the client's own attempt schedule" when the
    // client actually dictated one — otherwise the plan's band count comes
    // from the standard residential/business defaults, not any client
    // instruction, and saying so would fabricate a client requirement.
    if (input.scheduleImpossible) {
      lines.push(input.hasClientSchedule
        ? '__WARNING: the client\'s own attempt schedule requires more distinct days than remain before the deadline.__ Notify the hiring party — either the deadline moves or the schedule does. Do not silently attempt fewer times.'
        : '__WARNING: the standard diligence sequence cannot fit within the days remaining before the deadline.__ Notify the hiring party — either the deadline moves or fewer attempts must be made. Do not silently attempt fewer times.');
    }
  }

  // ── SERVICE WINDOWS — always present so the officer knows the answer ──
  // to "when can I go?" regardless of whether the client specified one.
  lines.push('**■ SERVICE WINDOWS**');
  const clientWindows = clientWindowText(queueRow);
  if (clientWindows) {
    // Client imposed a specific window restriction — show verbatim so the
    // officer has the exact language for the affidavit if challenged.
    lines.push(`• __Client restriction (verbatim):__ ${clientWindows}`);
    lines.push('• Do NOT attempt outside these hours — off-hours service may be challenged in court. If you arrive outside the window, note "client-imposed restriction — departed without contact" in the attempt log.');
    lines.push('• Within the authorized window, vary day and time across attempts — time variance is the diligence standard even when hours are constrained.');
  } else {
    // No restriction: give the officer the standard-optimal windows.
    lines.push('• No client restriction — standard diligence windows apply:');
    lines.push('• Residential: early morning 07:00–09:00 (pre-work), midday 11:00–13:00, early evening 17:00–20:30 (post-work). Include at least one weekend attempt — residential hit rates peak Saturday 08:00–10:00.');
    lines.push('• Business: mid-morning 09:00–11:00 and early afternoon 13:00–16:00 during posted business hours. Confirm the entity still operates at the address before tendering.');
  }

  lines.push('**■ DILIGENCE STANDARD**');
  for (const l of DILIGENCE_LINES) lines.push(`• ${l}`);

  return lines.join('\n');
}

// Author: DISPATCH. Sections: AFFIDAVIT / DOCUMENTATION REQUIREMENTS,
// CLIENT INSTRUCTIONS (verbatim), plus the Task 6 document checklist.
function buildAffidavitNote(input: BriefingInput): string {
  const { fields, queueRow } = input;
  const f = (k: string) => get(fields, k);
  const lines: string[] = [];
  lines.push('**PROCESS SERVICE — AFFIDAVIT / DOCUMENTATION** *(auto-generated)*');

  const docList = (f('documents_to_serve') || '').split(';').map((s) => s.trim()).filter(Boolean);
  if (docList.length > 1) {
    lines.push('**■ DOCUMENT CHECKLIST** — confirm every item is in the packet before departing:');
    for (const d of docList) lines.push(`- [ ] ${d}`);
  }

  lines.push('**■ AFFIDAVIT / DOCUMENTATION REQUIREMENTS**');
  for (const l of AFFIDAVIT_LINES) lines.push(`• ${l}`);

  if (queueRow.service_instructions) {
    lines.push('**■ CLIENT INSTRUCTIONS (verbatim)**');
    lines.push(queueRow.service_instructions);
  }

  return lines.join('\n');
}

// Author: DISPATCH. Section: CONTACTS.
function buildContactsNote(input: BriefingInput): string {
  const { fields, queueRow } = input;
  const f = (k: string) => get(fields, k);
  const hiringParty = [queueRow.client_name, queueRow.attorney_name]
    .filter(Boolean).join(' / ');
  const callback = f('attorney_phone');
  const lines: string[] = [];
  lines.push('**PROCESS SERVICE — CONTACTS** *(auto-generated)*');

  if (hiringParty) {
    lines.push('**■ CONTACTS**');
    lines.push(`Hiring party: ${hiringParty}${callback ? `  ·  Callback: ${callback}` : ''}${f('attorney_email') ? `  ·  ${f('attorney_email')}` : ''}`);
    if (f('attorney_bar_number')) lines.push(`Attorney bar #: ${f('attorney_bar_number')}`);
    if (f('job_number')) lines.push(`Client job #: ${f('job_number')}${f('client_reference') ? `  ·  Ref: ${f('client_reference')}` : ''}${f('server_name') ? `  ·  Assigned server: ${f('server_name')}` : ''}`);
    if (f('fee_amount')) lines.push(`Service fee: ${f('fee_amount')}`);
    lines.push('All recipient questions about the case → refer to the issuing court or the hiring attorney. Servers do not interpret documents.');
  }

  return lines.join('\n');
}

// ── OCR & extraction context ─────────────────────────────────
// Per-upload provenance the briefing note deliberately omits: which file
// each piece of data came from, what OCR engine read it, per-document
// confidence, every date the extractor saw, and which critical fields it
// could NOT find. Filed three ways by commitIntake:
//   1. full markdown note on the CFS Notes feed (author 'OCR')
//   2. compact one-liner appended to serve_queue.notes
//   3. machine-readable `_intake` block inside serve_queue.parsed_data

export interface IntakeDocMeta {
  file_name: string;
  doc_type: string | null;
  ocr_engine: string | null;
  confidence: number;          // 0..1
  success: boolean;
  page_count?: number | null;
}

// Fields an officer needs before knocking — reported explicitly when the
// extractor came up empty so a blank never reads as "OCR forgot".
const CRITICAL_FIELDS: Array<[key: string, label: string]> = [
  ['recipient_first_name', 'recipient name'],
  ['recipient_address', 'address'],
  ['case_number', 'case number'],
  ['court_name', 'court'],
  ['service_deadline', 'service deadline'],
  ['recipient_dob', 'DOB'],
  ['recipient_phone', 'phone'],
];

const ENGINE_LABEL: Record<string, string> = {
  'pdfjs-client': 'PDF text layer',
  'workers-ai-vision': 'Vision OCR',
  'workers-ai-tomarkdown': 'Structured PDF (Markdown)',
  tesseract: 'Tesseract OCR',
  pdftotext: 'pdftotext',
};

export interface OcrContext {
  noteText: string;            // full markdown note (CFS Notes feed)
  queueLine: string;           // compact line for serve_queue.notes
  missingCritical: string[];   // labels of critical fields not found
}

export function buildOcrContext(
  docs: IntakeDocMeta[],
  fields: Record<string, ExtractedField>,
  allDates: string[],
  nowIso: string,
): OcrContext {
  const filled = Object.values(fields).filter((f) => (f.value || '').trim()).length;
  const missingCritical = CRITICAL_FIELDS
    .filter(([k]) => {
      // Name counts as present if EITHER the person name or business name landed.
      if (k === 'recipient_first_name') {
        return !get(fields, 'recipient_first_name') && !get(fields, 'recipient_business_name');
      }
      return !get(fields, k);
    })
    .map(([, label]) => label);

  const lines: string[] = [];
  lines.push('**OCR & EXTRACTION CONTEXT** *(auto-generated)*');
  lines.push('**■ SOURCE DOCUMENTS**');
  for (const d of docs) {
    const engine = ENGINE_LABEL[d.ocr_engine || ''] || d.ocr_engine || 'unknown';
    const pct = `${Math.round((d.confidence || 0) * 100)}%`;
    lines.push(d.success
      ? `• ${d.file_name} — ${d.doc_type || 'unclassified'} · ${engine} · ${pct} confidence${d.page_count ? ` · ${d.page_count} pg` : ''}`
      : `• ${d.file_name} — __extraction FAILED__ (review manually)`);
  }
  lines.push('**■ DATA QUALITY**');
  lines.push(`• Auto-populated ${filled} field${filled === 1 ? '' : 's'} from ${docs.length} document${docs.length === 1 ? '' : 's'}`);
  if (missingCritical.length) {
    lines.push(`• __NOT FOUND in documents — verify before service:__ ${missingCritical.join(', ')}`);
  }
  if (allDates.length) {
    lines.push(`• Dates seen in documents: ${[...allDates].sort().join(', ')}`);
  }
  lines.push(`*Extracted ${nowIso.slice(0, 10)} — verify against source documents before filing affidavits.*`);

  const okDocs = docs.filter((d) => d.success).length;
  const topConf = Math.max(0, ...docs.map((d) => d.confidence || 0));
  const queueLine = `[OCR intake ${nowIso.slice(0, 10)}: ${okDocs}/${docs.length} docs read, ${Math.round(topConf * 100)}% confidence`
    + (missingCritical.length ? `; verify: ${missingCritical.join(', ')}` : '') + ']';

  return { noteText: lines.join('\n'), queueLine, missingCritical };
}

export function buildPsoBriefing(input: BriefingInput, nowIso: string): PsoBriefing {
  const assessment = assessOfficerSafety(input.fields, input.queueRow);
  const hint = hazardHintText(input.fields, input.queueRow);
  const notes: BriefingNote[] = [];
  // Id scheme is nowIso + a counter rather than Date.now() — Date.now()
  // inside a loop can collide, and this function must stay deterministic
  // for a given nowIso.
  let seq = 0;
  const push = (author: string, text: string) => {
    if (!text.trim()) return;
    notes.push({ id: `intake-${author.toLowerCase().replace(/\s+/g, '-')}-${nowIso}-${seq++}`, author, text, timestamp: nowIso });
  };

  // Safety note FIRST so it sits at the top of the feed the PSO scans.
  push('OFFICER SAFETY', buildSafetyNote(assessment));
  push('INTAKE', buildIntakeNote(input, nowIso));
  push('DISPATCH', buildTacticalNote(input, hint));
  push('DISPATCH', buildPlanNote(input));
  push('DISPATCH', buildAffidavitNote(input));
  push('DISPATCH', buildContactsNote(input));

  return {
    notes,
    sceneSafety: assessment.sceneSafety,
    officerSafetyCaution: assessment.caution ? 1 : 0,
    domesticViolence: assessment.domesticViolence ? 1 : 0,
    descriptionPrefix: assessment.severity === 'high' ? 'OFFICER SAFETY · ' : '',
  };
}
