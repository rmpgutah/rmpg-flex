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
//   • descriptionPrefix     — a ⚠ marker prepended to the call
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
export interface BriefingInput {
  fields: Record<string, ExtractedField>;
  queueRow: QueueRow;
  isBusiness: boolean;
  agentName: string;            // registered agent (corporate service)
  fullLocation: string;         // assembled address string
  docCount: number;
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
  descriptionPrefix: string;    // '' or '⚠ OFFICER SAFETY · '
}

// Build the full structured "INTAKE BRIEFING" note + (when triggered) a
// distinct "OFFICER SAFETY" note. Markdown bold (**) is rendered by the
// Notes tab's renderFormattedText, so section labels stand out.
function buildBriefingNoteText(input: BriefingInput): string {
  const { fields, queueRow, isBusiness, agentName, fullLocation, docCount } = input;
  const f = (k: string) => get(fields, k);

  const recipientLine = isBusiness
    ? `${queueRow.recipient_name || f('recipient_business_name') || 'Unknown business'}`
      + (agentName ? `  ·  Registered Agent: ${agentName}` : '')
    : `${queueRow.recipient_name || 'Unknown'}`
      + (f('recipient_dob') ? `  (DOB ${f('recipient_dob')})` : '');

  const hiringParty = [queueRow.client_name, queueRow.attorney_name]
    .filter(Boolean).join(' / ');
  const callback = f('attorney_phone');

  const lines: string[] = [];
  lines.push('**📋 PROCESS SERVICE — INTAKE BRIEFING** _(auto-generated)_');
  lines.push(`**Document:** ${queueRow.document_type || 'Civil paper'}`);
  lines.push(`**${isBusiness ? 'Serve (business)' : 'Recipient'}:** ${recipientLine}`);
  if (f('process_type')) lines.push(`**Serve type:** ${f('process_type')}`);
  if (fullLocation) lines.push(`**Address:** ${fullLocation}`);
  if (queueRow.case_number || queueRow.court_name) {
    lines.push(`**Case:** ${[queueRow.case_number, queueRow.court_name, queueRow.jurisdiction].filter(Boolean).join(' — ')}`);
  }
  if (queueRow.deadline) lines.push(`**Service deadline:** ${queueRow.deadline}`);
  if (hiringParty) lines.push(`**Hiring party:** ${hiringParty}${callback ? `  (${callback})` : ''}`);
  if (queueRow.notes) lines.push(`**Service windows:** ${queueRow.notes}`);
  if (queueRow.service_instructions) lines.push(`**Special instructions:** ${queueRow.service_instructions}`);
  lines.push(`**Documents on file:** ${docCount}`);
  return lines.join('\n');
}

export function buildPsoBriefing(input: BriefingInput, nowIso: string): PsoBriefing {
  const assessment = assessOfficerSafety(input.fields, input.queueRow);
  const notes: BriefingNote[] = [];

  // Safety note FIRST so it sits at the top of the feed the PSO scans.
  if (assessment.caution) {
    const label = assessment.severity === 'high' ? '⚠️ OFFICER SAFETY — ELEVATED' : '⚠️ OFFICER SAFETY';
    notes.push({
      id: `intake-safety-${Date.now()}`,
      author: 'OFFICER SAFETY',
      text: `**${label}**\n${assessment.reasons.map((r) => `• ${r}`).join('\n')}`,
      timestamp: nowIso,
    });
  }

  notes.push({
    id: `intake-brief-${Date.now() + 1}`,
    author: 'INTAKE',
    text: buildBriefingNoteText(input),
    timestamp: nowIso,
  });

  return {
    notes,
    sceneSafety: assessment.sceneSafety,
    officerSafetyCaution: assessment.caution ? 1 : 0,
    domesticViolence: assessment.domesticViolence ? 1 : 0,
    descriptionPrefix: assessment.severity === 'high' ? '⚠ OFFICER SAFETY · ' : '',
  };
}
