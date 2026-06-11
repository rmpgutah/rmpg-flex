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

// ── Tactical knowledge base ──────────────────────────────────
// Deterministic, reviewable guidance keyed off the document class and
// recipient type — never LLM-generated, so rule citations stay accurate.
// Utah Rules of Civil Procedure references current as of 2026.

// Who may lawfully accept service, by recipient class (URCP 4(d)).
function serviceAuthorityLines(isBusiness: boolean, hint: string): string[] {
  const lines: string[] = [];
  if (isBusiness) {
    lines.push('Corporate/LLC service per URCP 4(d)(1)(E): deliver to an officer, a managing or general agent, or the registered agent. Any employee 18+ expressly authorized to accept also qualifies at the business location.');
    lines.push('If serving at a RESIDENCE: personal delivery to the registered agent or an owner/member only — a spouse or co-resident may accept ONLY if authorized or a member of the company.');
  } else {
    lines.push('Individual service per URCP 4(d)(1)(A): personal delivery, or substitute service at the dwelling on a resident of suitable age and discretion, or delivery to an authorized agent.');
  }
  if (hint.includes('subpoena')) {
    lines.push('Subpoena (URCP 45): confirm whether witness fees must be tendered at service — check with the hiring party before attempt if not provided.');
  }
  if (hasAny(hint, EVICTION_KW)) {
    lines.push('Eviction/UD papers: personal or substitute service preferred; post-and-mail ONLY where the court has authorized alternative service — verify the order before posting.');
  }
  return lines;
}

// Approach guidance derived from the document class + extracted facts.
function tacticalApproachLines(input: BriefingInput, hint: string): string[] {
  const { fields, queueRow, isBusiness } = input;
  const f = (k: string) => get(fields, k);
  const lines: string[] = [];

  if (isBusiness) {
    lines.push('Attempt during posted business hours first; ask for the registered agent or a manager by name. Note the title and full name of whoever accepts — required for the affidavit.');
  } else {
    lines.push('Verify identity before tender (name + DOB/description if available). If substitute-serving, record the resident’s name, relationship, and physical description.');
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
  if (queueRow.notes) lines.push(`Client-specified service windows: ${queueRow.notes}.`);
  if (!queueRow.deadline) {
    lines.push('No service deadline on file — treat per diligence standard (first attempt within 48h; vary day/time across attempts).');
  }
  lines.push('Body-camera/GPS on at every attempt; photograph the location on no-answer attempts to support the diligence affidavit.');
  return lines;
}

// Build the full structured "INTAKE BRIEFING" note + (when triggered) a
// distinct "OFFICER SAFETY" note. Markdown bold (**) is rendered by the
// Notes tab's renderFormattedText, so section labels stand out.
function buildBriefingNoteText(input: BriefingInput): string {
  const { fields, queueRow, isBusiness, agentName, fullLocation, docCount } = input;
  const f = (k: string) => get(fields, k);
  const hint = hazardHintText(fields, queueRow);

  const hiringParty = [queueRow.client_name, queueRow.attorney_name]
    .filter(Boolean).join(' / ');
  const callback = f('attorney_phone');
  const caseLine = [queueRow.case_number, queueRow.court_name, queueRow.jurisdiction]
    .filter(Boolean).join(' · ');
  const parties = [queueRow.plaintiff, queueRow.defendant].filter(Boolean).join(' v. ');

  const lines: string[] = [];
  lines.push('**📋 PROCESS SERVICE — INTAKE BRIEFING** _(auto-generated)_');

  lines.push('**■ SERVICE PROFILE**');
  if (isBusiness) {
    lines.push(`Target entity: ${queueRow.recipient_name || f('recipient_business_name') || 'Unknown business'}`);
    if (agentName) lines.push(`Accept-service party: Registered Agent ${agentName}`);
  } else {
    lines.push(`Target: ${queueRow.recipient_name || 'Unknown'}${f('recipient_dob') ? `  (DOB ${f('recipient_dob')})` : ''}`);
  }
  if (fullLocation) lines.push(`Service address: ${fullLocation}`);
  if (f('process_type')) lines.push(`Process type: ${f('process_type')}`);
  lines.push(`Documents to serve: ${f('documents_to_serve') || queueRow.document_type || 'Civil paper'}  (${docCount} file${docCount === 1 ? '' : 's'} on record)`);

  if (caseLine || parties) {
    lines.push('**■ CASE**');
    if (caseLine) lines.push(caseLine);
    if (parties) lines.push(`Parties: ${parties}`);
    if (queueRow.deadline) lines.push(`SERVICE DEADLINE: ${queueRow.deadline}`);
    if (queueRow.court_date) lines.push(`Hearing date: ${queueRow.court_date}`);
  }

  lines.push('**■ SERVICE AUTHORITY**');
  for (const l of serviceAuthorityLines(isBusiness, hint)) lines.push(`• ${l}`);

  lines.push('**■ TACTICAL APPROACH**');
  for (const l of tacticalApproachLines(input, hint)) lines.push(`• ${l}`);

  if (queueRow.service_instructions) {
    lines.push('**■ CLIENT INSTRUCTIONS (verbatim)**');
    lines.push(queueRow.service_instructions);
  }

  if (hiringParty) {
    lines.push('**■ CONTACTS**');
    lines.push(`Hiring party: ${hiringParty}${callback ? `  ·  Callback: ${callback}` : ''}${f('attorney_email') ? `  ·  ${f('attorney_email')}` : ''}`);
    if (f('job_number')) lines.push(`Client job #: ${f('job_number')}${f('server_name') ? `  ·  Assigned server: ${f('server_name')}` : ''}`);
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
  lines.push('**🔍 OCR & EXTRACTION CONTEXT** _(auto-generated)_');
  lines.push('**■ SOURCE DOCUMENTS**');
  for (const d of docs) {
    const engine = ENGINE_LABEL[d.ocr_engine || ''] || d.ocr_engine || 'unknown';
    const pct = `${Math.round((d.confidence || 0) * 100)}%`;
    lines.push(d.success
      ? `• ${d.file_name} — ${d.doc_type || 'unclassified'} · ${engine} · ${pct} confidence${d.page_count ? ` · ${d.page_count} pg` : ''}`
      : `• ${d.file_name} — ⚠ extraction FAILED (review manually)`);
  }
  lines.push('**■ DATA QUALITY**');
  lines.push(`• Auto-populated ${filled} field${filled === 1 ? '' : 's'} from ${docs.length} document${docs.length === 1 ? '' : 's'}`);
  if (missingCritical.length) {
    lines.push(`• NOT FOUND in documents — verify before service: ${missingCritical.join(', ')}`);
  }
  if (allDates.length) {
    lines.push(`• Dates seen in documents: ${[...allDates].sort().join(', ')}`);
  }
  lines.push(`_Extracted ${nowIso.slice(0, 10)} — verify against source documents before filing affidavits._`);

  const okDocs = docs.filter((d) => d.success).length;
  const topConf = Math.max(0, ...docs.map((d) => d.confidence || 0));
  const queueLine = `[OCR intake ${nowIso.slice(0, 10)}: ${okDocs}/${docs.length} docs read, ${Math.round(topConf * 100)}% confidence`
    + (missingCritical.length ? `; verify: ${missingCritical.join(', ')}` : '') + ']';

  return { noteText: lines.join('\n'), queueLine, missingCritical };
}

export function buildPsoBriefing(input: BriefingInput, nowIso: string): PsoBriefing {
  const assessment = assessOfficerSafety(input.fields, input.queueRow);
  const notes: BriefingNote[] = [];

  // Safety note FIRST so it sits at the top of the feed the PSO scans.
  if (assessment.caution) {
    const high = assessment.severity === 'high';
    const lines: string[] = [];
    lines.push(`**⚠️ OFFICER SAFETY — RISK ASSESSMENT: ${high ? 'ELEVATED' : 'BASELINE'}**`);
    lines.push('**Indicators:**');
    for (const r of assessment.reasons) lines.push(`• ${r}`);
    lines.push('**Posture:**');
    lines.push(high
      ? '• Two-officer response recommended. Position for egress; do not enter the residence. Notify dispatch on arrival and clear. Disengage and re-attempt if the contact turns hostile — the paper is not worth an escalation.'
      : '• Single-officer standard. Announce purpose, confirm identity, maintain reactionary gap at the door. Notify dispatch on arrival and clear.');
    if (assessment.domesticViolence) {
      lines.push('• DV flag set: verify the protected party is not present before approach; document timing in the attempt notes.');
    }
    notes.push({
      id: `intake-safety-${Date.now()}`,
      author: 'OFFICER SAFETY',
      text: lines.join('\n'),
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
