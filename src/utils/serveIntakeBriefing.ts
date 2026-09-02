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
import { addressClassLabel, isSpecificOfficeClass } from './serveAddressClass';
import {
  DEFAULT_RESIDENTIAL_WINDOWS, DEFAULT_BUSINESS_WINDOWS,
  DEFAULT_CORPORATE_WINDOWS, DEFAULT_SMALL_BUSINESS_WINDOWS,
  DEFAULT_GOVERNMENT_WINDOWS,
} from './serveAttemptWindows';
import { buildOutputTree, renderOutputTreeNote, inferVenueKind, VENUE_LABELS } from './serveIntakeOutputTree';

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
//
// R1 (fix round 2): the two predicates were combined with OR, which was the
// whole bug. Nearly every real `service_instructions` contains the word
// "serve", so a line like "Please serve defendant at the residence. Gate code
// 4412." satisfied hasRestrictionLanguage() alone and was printed under
// SERVICE WINDOWS as `__Client restriction (verbatim):__ …` followed by "Do
// NOT attempt outside these hours" — an hours restriction containing no
// hours, and an instruction to log a restriction that does not exist. The
// same text was ALSO printed verbatim under CLIENT INSTRUCTIONS, so the
// report contradicted itself. Both predicates are now REQUIRED (AND), which
// is what the test at tests/serveIntakeBriefing.test.ts has been named for
// all along ("paired with clock times").
const CLOCK_VALUE_RE = /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi;
// 'diligence' is attempt-cadence language in this domain ("Diligence is 1
// between 6AM-9AM…") and must count, or the AND above would reject a genuine
// client band statement that never uses the word "serve".
const RESTRICTION_KEYWORDS = ['serve', 'service', 'attempt', 'diligence', 'do not serve', 'no service'];

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
      if (!hasClockTimeRange(t) || !hasRestrictionLanguage(t)) continue;
      return t;
    }
  }
  return null;
}

// ── Dynamic instruction extraction (hardening pass) ──────────
// service_instructions routinely carries explicit MANNER-of-service rules,
// first-attempt timing directives, diligence cadences, and day authorizations.
// These detectors pull the governing SENTENCES out so each notation can quote
// exactly what the client wrote next to the relevant doctrine, instead of the
// officer finding it buried in the verbatim block at the bottom of the feed.
// All are sentence-scoped, deterministic, and return null/false when nothing
// matches — a detector that cannot find evidence must stay silent, never
// paraphrase into an instruction the client did not give (same discipline as
// the R1/R3 fixes below).
function instructionSentences(queueRow: QueueRow): string[] {
  return (queueRow.service_instructions || '')
    .split(/\n+|(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Sentences stating HOW to serve: personal-first hierarchies, abode
// subservice rules, employment-only constraints.
const MANNER_KW = ['personal', 'abode', 'subserv', 'employment'];

export function clientServiceRuleText(queueRow: QueueRow): string | null {
  const hits = instructionSentences(queueRow).filter((s) => {
    const l = s.toLowerCase();
    return MANNER_KW.some((k) => l.includes(k));
  });
  return hits.length ? hits.join(' ') : null;
}

export function firstAttemptDirective(queueRow: QueueRow): string | null {
  for (const s of instructionSentences(queueRow)) {
    if (/\b(?:start|begin|commence)\s+(?:the\s+)?(?:attempts?|service|trying)\b/i.test(s)) return s;
  }
  return null;
}

// A client-stated diligence cadence only counts when the sentence carries a
// genuine clock range — otherwise it is prose, and quoting it under a
// "cadence" label would imply structure that was never parsed.
export function diligenceCadenceText(queueRow: QueueRow): string | null {
  for (const s of instructionSentences(queueRow)) {
    if (/\bdiligence\b/i.test(s) && hasClockTimeRange(s)) return s;
  }
  return null;
}

// Positive day-scope authorization ("7 days/week"). Deliberately narrow so
// "5 days/week" does NOT read as all-week authorization.
export function allDaysAuthorized(queueRow: QueueRow): boolean {
  return /\b(?:7|seven)\s*days\s*(?:\/|per\s+)?a?\s*week/i.test(queueRow.service_instructions || '');
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
  business_type?: string | null;
}

// R5: findOrCreateBusiness stamps every row IT creates with these markers.
// A row this pipeline invented is not independent evidence of anything, so it
// must never be allowed to CONFIRM an address class. Exported so the marker
// lives in exactly one place alongside the record shape that carries it.
export const AUTO_CREATED_BUSINESS_NOTE = 'Auto-created via serve intake';
export const AUTO_CREATED_BUSINESS_TYPE = 'process_service_recipient';

export function isAutoCreatedBusinessRecord(b: BusinessRecord | null | undefined): boolean {
  if (!b) return false;
  return (b.notes || '').startsWith('Auto-created')
    || (b.business_type || '') === AUTO_CREATED_BUSINESS_TYPE;
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
  addressClassConfirmed?: boolean;
  scheduleImpossible?: boolean;
  hasClientSchedule?: boolean;  // true only when the client actually dictated attempt bands
  // R3 — fail-closed must be VISIBLE. parseClientBands()/parseAllowedDays()
  // correctly return []/null on anything they cannot read, but that made
  // "the client dictated nothing" indistinguishable from "the client
  // dictated something we could not parse". The raw source strings are
  // carried here so the report can say so (spec §6) instead of silently
  // applying defaults over a restriction the client actually imposed.
  unparsedClientSchedule?: string | null;
  unparsedAllowedDays?: string | null;
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
function officeLike(addressClass: AddressClass, isBusiness: boolean): boolean {
  return isBusiness || isSpecificOfficeClass(addressClass) || addressClass === 'business' || addressClass === 'po_box';
}

function serviceAuthorityLines(isBusiness: boolean, hint: string, addressClass: AddressClass): string[] {
  const lines: string[] = [];
  if (!isBusiness && (addressClass === 'business' || isSpecificOfficeClass(addressClass))) {
    lines.push('SERVICE AT A PLACE OF EMPLOYMENT: substitute service on a co-worker is NOT dwelling substitute service. Unless the client expressly authorizes it, the recipient must be served PERSONALLY at a business address.');
  }
  if (addressClass === 'government') {
    lines.push('Government-office service: deliver to the clerk, records counter, or person designated to accept legal papers — ask for the authorized agent by title, not a random employee in the lobby.');
    lines.push('Expect a security checkpoint and posted public hours. Do not attempt after the counter closes; after-hours drop boxes are not personal service unless the hiring party authorizes it in writing.');
    lines.push('If the office will not accept: record the name/title of the person who refused, photograph the posted hours and the counter, and notify the hiring party — do not leave papers with security.');
  } else if (officeLike(addressClass, isBusiness)) {
    lines.push('Corporate/LLC service per URCP 4(d)(1)(E): deliver to an officer, a managing or general agent, or the registered agent. Any employee 18+ expressly authorized to accept also qualifies at the business location.');
    lines.push('If serving at a RESIDENCE: personal delivery to the registered agent or an owner/member only — a spouse or co-resident may accept ONLY if authorized or a member of the company.');
    lines.push('If the entity cannot be located after diligence, Utah law permits service on the Division of Corporations as statutory agent — that is a counsel decision; report the failed diligence, do not self-initiate.');
  } else {
    lines.push('Individual service per URCP 4(d)(1)(A): personal delivery, or substitute service at the dwelling on a resident of suitable age and discretion, or delivery to an authorized agent.');
    lines.push('A minor or obviously impaired resident is NOT of suitable age and discretion — do not substitute-serve on them; re-attempt instead.');
  }
  if (addressClass === 'po_box') {
    lines.push('PO BOX: a post-office box is not a lawful place of personal service. Identify the physical street address (box holder, skip trace, Division of Corporations) and re-plan — do not leave papers at the box.');
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

  const klass = input.addressClass || 'unknown';
  if (klass === 'government') {
    lines.push('Attempt during posted PUBLIC counter hours only (typically weekday mornings and early afternoon). Confirm you are at the correct agency/division on the directory before tendering.');
    lines.push('Ask for the clerk or person authorized to accept legal papers. Note the full name AND title. Security is not an authorized recipient unless they so state.');
    lines.push('If the counter is closed or the office has moved: photograph the frontage and posted hours, obtain a forwarding address from an adjacent office, and flag for skip trace — do not leave papers with after-hours security.');
  } else if (klass === 'small_business') {
    lines.push('Attempt during posted shop hours; small businesses often close midday or one weekday. Confirm the DBA on the door matches the packet before tendering. Ask for the owner or manager by name.');
    lines.push('If closed or vacated: photograph the frontage, note neighboring tenant info, and flag for skip trace — do not leave papers in a mail slot or under the door.');
    lines.push('Note the full name AND title of whoever accepts — "authorized to accept" must be supportable in the affidavit.');
  } else if (klass === 'corporate' || klass === 'business' || klass === 'po_box' || (isBusiness && klass !== 'residential' && klass !== 'gated')) {
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
function diligenceLines(klass: AddressClass): string[] {
  const office = isSpecificOfficeClass(klass) || klass === 'business' || klass === 'po_box';
  const stagger = office
    ? (klass === 'government'
      ? 'Minimum three attempts before requesting alternative service: stagger across morning counter hours (08:30–11:30) and afternoon (13:00–15:30) on different weekdays. Do not count a weekend attempt at a closed government office as diligence.'
      : klass === 'small_business'
        ? 'Minimum three attempts before requesting alternative service: stagger across morning (09:00–11:00) and afternoon (13:00–16:00) on different weekdays. Confirm posted hours; a closed-for-lunch attempt is not a completed diligence contact.'
        : 'Minimum three attempts before requesting alternative service: stagger across mid-morning (09:30–11:30) and afternoon (13:30–16:00) on different weekdays. Weekend attempts at a closed corporate office do not count toward diligence.')
    : 'Minimum three attempts before requesting alternative service: stagger across morning (07:00–09:00), midday, and evening (17:00–20:30), and include at least one weekend attempt — residential hit rates peak early morning and early evening.';
  return [
    stagger,
    'First attempt within 48 hours of assignment. Log every attempt in the system at the scene, not end-of-shift — timestamps and GPS are the diligence record.',
    office
      ? 'BAD ADDRESS: confirm with staff or neighboring tenants, photograph the frontage/suite, and request skip trace immediately — do not burn additional attempts on a confirmed vacated unit.'
      : 'BAD ADDRESS: confirm with an occupant or neighbor, photograph the location, and request skip trace immediately — do not burn additional attempts on a confirmed bad address.',
    'After exhausting attempts: compile the attempt log and notify the hiring party — alternative service (URCP 4(d)(5)) is counsel\'s motion to make, supported by your documented diligence.',
  ];
}

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
  const recipientSet = new Set(recipientTokens);
  for (const p of validParties) {
    const partyTokens = normalizeNameTokens(p);
    const partySet = new Set(partyTokens);
    // R10: containment was DIRECTIONAL — party ⊇ recipient only. Recipient
    // "JOHN SMITH JR" against defendant "SMITH, JOHN" failed that test (the
    // suffix JR has no counterpart), so the report told the officer the
    // ACTUAL defendant "is NOT a named party in this case". Accept a match
    // in EITHER direction. The reverse direction still requires the party
    // side to carry >= 2 tokens, so a single-token party string ("SMITH")
    // cannot swallow an unrelated recipient.
    if (recipientTokens.every((t) => partySet.has(t))) return 'party';
    if (partyTokens.length >= 2 && partyTokens.every((t) => recipientSet.has(t))) return 'party';
    // R10b: both containment checks fail when EACH side carries one extra token
    // the other lacks — e.g. "JOHN SMITH JR" vs "JOHN DAVID SMITH". The shared
    // core {JOHN, SMITH} is ≥ 2 tokens and identifies the same person; the
    // diverging tokens (suffix vs middle name) are not grounds for asserting
    // non-party. Match when: shared tokens ≥ 2 AND neither side contributes
    // more than 1 token beyond the shared core (keeps the check conservative).
    const sharedCount = recipientTokens.filter((t) => partySet.has(t)).length;
    if (sharedCount >= 2 && recipientTokens.length - sharedCount <= 1 && partyTokens.length - sharedCount <= 1) return 'party';
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

  const klass = input.addressClass || 'unknown';
  lines.push('**■ SERVICE PROFILE**');
  lines.push(`Location type: ${addressClassLabel(klass)}${input.addressClassConfirmed ? ' (confirmed)' : ''}`);
  {
    const venue = inferVenueKind(fullLocation, queueRow.recipient_name || f('recipient_business_name'), queueRow.service_instructions);
    if (venue !== 'none') lines.push(`Venue overlay: ${VENUE_LABELS[venue]}`);
  }
  if (isBusiness || isSpecificOfficeClass(klass)) {
    lines.push(`Target Entity: ${queueRow.recipient_name || f('recipient_business_name') || 'Unknown business'}`);
    if (agentName) lines.push(`Accept-Service Party: Registered Agent ${agentName}`);
  } else {
    lines.push(`Target: ${queueRow.recipient_name || 'Unknown'}${f('recipient_dob') ? `  (DOB ${f('recipient_dob')})` : ''}`);
  }
  if (fullLocation) lines.push(`Service Address: ${fullLocation}${f('recipient_county') ? ` (${f('recipient_county')} County)` : ''}`);
  if (f('recipient_phone')) lines.push(`Recipient phone on file: ${f('recipient_phone')}`);
  if (f('process_type')) lines.push(`Process type: ${f('process_type')}`);
  if (f('document_subtype') && f('document_subtype') !== queueRow.document_type) {
    lines.push(`Document class: ${queueRow.document_type || 'civil paper'} / ${f('document_subtype')}`);
  }
  const docItems = (f('documents_to_serve') || '')
    .split(/[;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (docItems.length > 1) {
    lines.push('Documents to Serve:');
    docItems.forEach((d, i) => lines.push(`${i + 1}. ${d}`));
    lines.push(`• (${docCount} file${docCount === 1 ? '' : 's'} on record)`);
  } else {
    lines.push(`Documents to Serve: ${f('documents_to_serve') || queueRow.document_type || 'Civil paper'}  (${docCount} file${docCount === 1 ? '' : 's'} on record)`);
  }
  if (f('witness_fee_instrument')) {
    lines.push(`__CARRY WITH YOU: ${f('witness_fee_instrument')}__ — a witness fee must be tendered at service. Arriving without it fails the attempt.`);
  }

  if (caseLine || parties) {
    lines.push('**■ CASE DETAILS**');
    if (queueRow.case_number) lines.push(`1. CASE #: ${queueRow.case_number}`);
    if (queueRow.court_name || queueRow.jurisdiction) {
      lines.push(`1a. ${[queueRow.court_name, queueRow.jurisdiction].filter(Boolean).join(' — ')}`);
    }
    if (parties) lines.push(`1b. ${queueRow.plaintiff ? `Plaintiff: ${queueRow.plaintiff}` : 'Plaintiff: (not on file)'}${queueRow.defendant ? ` v. Defendant: ${queueRow.defendant}` : ''}`);
    if (f('filing_date')) lines.push(`1c. DATE OF FILING: ${f('filing_date')}`);
    if (queueRow.deadline) lines.push(`1d. SERVICE DEADLINE: ${queueRow.deadline}`);
    if (!queueRow.case_number && caseLine) lines.push(caseLine);
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
  const clientRule = clientServiceRuleText(queueRow);
  if (clientRule) {
    lines.push(`• __CLIENT SERVICE RULE (verbatim):__ ${clientRule}`);
    lines.push('• The client rule above governs the manner of service where it is stricter than standard practice — follow it exactly and quote it in the affidavit.');
  }
  if (allDaysAuthorized(queueRow)) {
    lines.push('• Client authorizes attempts ALL 7 DAYS — weekend attempts are permitted on this job.');
  }

  if (input.locationNote) {
    const note = input.locationNote;
    lines.push('**■ SERVICE CONSTRAINTS** _(recorded system notation — must be observed)_');
    lines.push(`• ${note.note_text}`);
    const summary = noteConstraintSummary(note);
    if (summary && summary !== note.note_type) {
      lines.push(`• Structured constraint: **${summary}**`);
    }
    // R7: this used to assert compliance unconditionally, from the mere
    // PRESENCE of a note. Client bands OUTRANK the site note and
    // selectWindows() returns them WITHOUT intersecting it — so a note with
    // cutoff_time 15:00 plus a client band of 18:00-21:00 printed
    // "18:00-21:00 [client-specified]" under a sentence claiming it complied
    // with the 15:00 cutoff, and the officer arrived at a locked gate. Only
    // claim compliance when a window in the emitted plan actually carries
    // `authority === 'site note'`; otherwise name the conflict, which is
    // exactly what the officer needs to know.
    const planAuthorities = new Set((input.attemptPlan ?? []).map((w) => w.authority));
    if (planAuthorities.has('site note')) {
      lines.push('• Attempt windows above have been adjusted to comply with these constraints. Any attempt outside the noted hours or days may be legally challenged — document attempts with timestamps.');
    } else if (planAuthorities.has('client-specified')) {
      lines.push('• __CONFLICT — READ BEFORE DEPARTING: the client-specified attempt windows above OUTRANK this site constraint and have NOT been narrowed to fit it.__ One or more planned windows may fall outside the noted hours or days. Confirm access before the attempt; if the site constraint blocks entry, do NOT attempt outside the client window — document the conflict and notify the hiring party.');
    } else {
      lines.push('• These constraints did NOT shape the attempt windows above (those came from the standard address-class windows). Observe the noted hours and days in the field, and document any attempt made outside them with timestamps.');
    }
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
    const directive = firstAttemptDirective(queueRow);
    if (directive) {
      lines.push(`• __FIRST-ATTEMPT DIRECTIVE (verbatim):__ ${directive}`);
      lines.push('• Honor this start-by timing — re-sequence the windows above to satisfy it and record the first attempt timestamp against it.');
    }
    const cadence = diligenceCadenceText(queueRow);
    if (cadence) {
      const applied = new Set((input.attemptPlan ?? []).map((x) => x.authority)).has('client-specified');
      lines.push(applied
        ? `• Client-stated diligence cadence (verbatim): ${cadence} — reflected in the [client-specified] windows above.`
        : `• __Client-stated diligence cadence found in the packet (verbatim):__ ${cadence} — NOT parsed into structured bands; verify with the hiring party before treating it as the authorized schedule.`);
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
  } else {
    // No plan was generated (typically: no service address resolved). A
    // missing section must explain itself — silence reads as "planner
    // forgot" and the officer departs with no authorized-hours guidance.
    lines.push('**■ RECOMMENDED ATTEMPT PLAN**');
    lines.push('• __No attempt plan could be generated — confirm the service address before departing.__ Standard diligence windows below apply once an address is confirmed.');
  }

  // ── SERVICE WINDOWS — always present so the officer knows the answer ──
  // to "when can I go?" regardless of whether the client specified one.
  //
  // R2: this block used to re-derive everything from a regex over free text,
  // ignoring the timing engine entirely. Two consequences, both shipped:
  //   • the canonical 24-hour client schedule ('06:00-09:00;18:00-21:00')
  //     carries no am/pm, so CLOCK_VALUE_RE never matched it — the note said
  //     "No client restriction — standard diligence windows apply" directly
  //     beneath three [client-specified] windows;
  //   • the "standard" business hours it printed (09:00–11:00 / 13:00–16:00)
  //     were not the hours the planner used (09:30-11:30 / 13:30-15:30), so
  //     one report stated two different sets of business hours.
  // It is now driven by the STRUCTURED signals — hasClientSchedule and the
  // authority values actually present in attemptPlan — and the default hours
  // are rendered from the same constants selectWindows() plans from.
  lines.push('**■ SERVICE WINDOWS**');
  const planAuthorities = new Set((input.attemptPlan ?? []).map((w) => w.authority));
  const clientDictated = input.hasClientSchedule === true || planAuthorities.has('client-specified');
  const clientWindows = clientWindowText(queueRow);

  const windowList = (specs: readonly { window: string; focus: string }[]) =>
    specs.map((s) => `${s.window.replace('-', '–')} (${s.focus})`).join('; ');

  if (clientDictated) {
    lines.push('• __The client dictated the attempt hours.__ Every window above marked [client-specified] came from the client\'s own instruction — those are the authorized hours.');
    if (clientWindows) {
      // Verbatim source language, for the affidavit if service is challenged.
      lines.push(`• __Client restriction (verbatim):__ ${clientWindows}`);
    }
    lines.push('• Do NOT attempt outside these hours — off-hours service may be challenged in court. If you arrive outside the window, note "client-imposed restriction — departed without contact" in the attempt log.');
    lines.push('• Within the authorized window, vary day and time across attempts — time variance is the diligence standard even when hours are constrained.');
  } else if (clientWindows) {
    // Restriction language IS present in the packet, but the timing engine
    // produced no client bands from it. Say exactly that; do not present the
    // quoted text as if it had been applied to the plan.
    lines.push(`• __Client timing language found in the packet (verbatim):__ ${clientWindows}`);
    lines.push('• __This language was NOT parsed into structured attempt bands — the windows above are the standard defaults, not the client\'s.__ Read the quoted line yourself and verify with the hiring party before attempting outside the hours it states.');
  } else {
    lines.push('• No client restriction on file — standard diligence windows apply:');
  }

  if (!clientDictated) {
    // Print only the window set that actually governs this job when the plan
    // says which one it is; print both when there is no plan to read.
    const showResidential = planAuthorities.has('residential default');
    const showCorporate = planAuthorities.has('corporate default');
    const showSmall = planAuthorities.has('small_business default');
    const showGov = planAuthorities.has('government default');
    const showBusiness = planAuthorities.has('business default');
    const showVenue = planAuthorities.has('venue default');
    const noClassSignal = !showResidential && !showCorporate && !showSmall && !showGov && !showBusiness && !showVenue && !planAuthorities.has('site note');
    if (showResidential || noClassSignal) {
      lines.push(`• Residential: ${windowList(DEFAULT_RESIDENTIAL_WINDOWS)}. Include at least one weekend attempt — residential hit rates peak Saturday 08:00–10:00.`);
    }
    if (showCorporate || noClassSignal) {
      lines.push(`• Corporate / large business: ${windowList(DEFAULT_CORPORATE_WINDOWS)} weekdays during posted office hours. Confirm the entity still operates at the suite before tendering.`);
    }
    if (showSmall || noClassSignal) {
      lines.push(`• Small business: ${windowList(DEFAULT_SMALL_BUSINESS_WINDOWS)} weekdays; confirm posted shop hours (midday closures are common).`);
    }
    if (showGov || noClassSignal) {
      lines.push(`• Government offices: ${windowList(DEFAULT_GOVERNMENT_WINDOWS)} weekdays at the public counter. Weekend attempts do not count.`);
    }
    if (showBusiness) {
      lines.push(`• Business (CONFIRMED generic business location): ${windowList(DEFAULT_BUSINESS_WINDOWS)} during posted business hours.`);
    }
    if (showVenue) {
      lines.push('• Venue overlay windows (see RECOMMENDED ATTEMPT PLAN [venue default]) replace the generic office bands for this site type — warehouse receiving, school office, hotel desk, or medical admin hours.');
    }
    if (planAuthorities.has('site note')) {
      lines.push('• The windows above came from a recorded site notation for this address — see SERVICE CONSTRAINTS in the intake note.');
    }
  }

  // R3: a NON-EMPTY client schedule / day restriction that the parser could
  // not read must be disclosed. Silently falling back to defaults is the
  // fail-OPEN failure the fail-closed parsers were supposed to prevent —
  // e.g. service_days_allowed "no service on sunday" yields a null day set,
  // every day becomes allowed, and a Sunday attempt gets scheduled on a job
  // where the client forbade Sunday.
  const unparsed: string[] = [];
  if (input.unparsedClientSchedule) unparsed.push(`attempt hours: "${input.unparsedClientSchedule}"`);
  if (input.unparsedAllowedDays) unparsed.push(`days allowed: "${input.unparsedAllowedDays}"`);
  if (unparsed.length) {
    lines.push(`• __CLIENT SCHEDULE/DAY RESTRICTION PRESENT BUT COULD NOT BE PARSED — DEFAULTS APPLIED, VERIFY WITH THE HIRING PARTY.__ Unreadable value(s) — ${unparsed.join('; ')}. The plan above does NOT reflect this restriction. Do not attempt until the hiring party confirms the authorized hours and days.`);
  }

  lines.push('**■ DILIGENCE STANDARD**');
  for (const l of diligenceLines(input.addressClass || 'unknown')) lines.push(`• ${l}`);

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
  lines.push('**PROCESS SERVICE — CONTRACT DETAILS AND CONTACTS** *(auto-generated)*');

  if (hiringParty) {
    lines.push('**■ CONTRACT DETAILS AND CONTACTS**');
    lines.push(`1. Hiring Party: ${hiringParty}${callback ? ` | Phone: ${callback}` : ''}${f('attorney_email') ? ` | Email: ${f('attorney_email')}` : ''}`);
    if (f('attorney_bar_number')) lines.push(`   Attorney bar #: ${f('attorney_bar_number')}`);
    if (f('job_number')) lines.push(`2. Client Job #: ${f('job_number')}`);
    if (f('client_reference')) lines.push(`3. Client Ref #: ${f('client_reference')}`);
    if (f('server_name')) lines.push(`4. Assigned PSO: ${f('server_name')}`);
    if (f('fee_amount')) lines.push(`5. Service Fee: ${f('fee_amount')}`);
    lines.push('IMPORTANT NOTICE: All recipient questions about the case → refer to the issuing court or the hiring attorney. Servers do not interpret documents.');
  } else {
    // No hiring party extracted — say so and give the officer the field
    // contacts that DO exist rather than an empty header-only note.
    lines.push('**■ CONTACTS**');
    lines.push('__No hiring party on file — confirm the client before departing.__');
    if (queueRow.recipient_name || f('recipient_phone')) {
      lines.push(`Recipient contact on file: ${queueRow.recipient_name || '(name unknown)'}${f('recipient_phone') ? `  ·  ${f('recipient_phone')}` : ''} — for logistics only (access, timing); never discuss the case.`);
    }
    lines.push('All recipient questions about the case → refer to the issuing court. Servers do not interpret documents.');
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

  // Source provenance — one compact line per document (item 57).
  // Engine label + confidence sit on the same line as the filename so the
  // officer can scan source quality at a glance without reading a table.
  lines.push('**■ SOURCE DOCUMENTS**');
  for (const d of docs) {
    const engine = ENGINE_LABEL[d.ocr_engine || ''] || d.ocr_engine || 'unknown';
    const pct = `${Math.round((d.confidence || 0) * 100)}%`;
    const pages = d.page_count ? ` · ${d.page_count}pp` : '';
    lines.push(d.success
      ? `• ${d.file_name} (${d.doc_type || 'unclassified'}, ${engine}, ${pct}${pages})`
      : `• ${d.file_name} — __extraction FAILED — review manually__`);
  }

  // Extraction summary in the operator's prose register (item 56).
  const docWord = docs.length === 1 ? 'document' : 'documents';
  const fieldWord = filled === 1 ? 'field' : 'fields';
  lines.push('**■ EXTRACTION SUMMARY**');
  lines.push(`Auto-populated ${filled} ${fieldWord} from ${docs.length} ${docWord} on ${nowIso.slice(0, 10)}.`);
  if (missingCritical.length) {
    lines.push(`**Verify before service** — not found in documents: ${missingCritical.join(', ')}.`);
  }
  if (allDates.length) {
    lines.push(`Dates seen: ${[...allDates].sort().join(', ')}.`);
  }
  lines.push('*Cross-check all extracted fields against source documents before filing affidavits.*');

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
  const tree = buildOutputTree({
    addressClass: input.addressClass || 'unknown',
    addressClassConfirmed: input.addressClassConfirmed,
    isBusiness: input.isBusiness,
    fields: input.fields,
    queueRow: input.queueRow,
    agentName: input.agentName,
    fullLocation: input.fullLocation,
    docCount: input.docCount,
    nowIso,
    gateCode: input.propertyRecord?.gate_code,
    hazardNotes: input.propertyRecord?.hazard_notes,
  });
  push('OPS', renderOutputTreeNote(tree));
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
