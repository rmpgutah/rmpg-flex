import { bytesToBase64 } from './anthropic';
import { callAi } from './callAi';
import { precleanText } from './serveIntakePreclean';

// ============================================================
// RMPG Flex — Serve Intake structured-field extraction
// ============================================================
// Two paths, both Workers-AI native:
//
//   extractFromText() — Tesseract / pdftotext / pdfjs already gave
//   us raw text. Run Llama 3.3 70B (instruct) with a JSON-schema
//   response_format to project the text into the field shape the
//   client UI expects (OcrScanResult).
//
//   extractFromImage() — uploaded raster (no PDF text layer). Send
//   the bytes to Llama 3.2 11B Vision — single-pass OCR + extraction.
//   Avoids round-tripping through the container Tesseract path.
//
// Both paths return the same shape so the route handler doesn't
// branch on which engine ran. confidence is the model's own
// self-report when present, else derived from how many target
// fields it filled.
// ============================================================

// ── Model selection ───────────────────────────────────────────
// ⚠️ LLAMA 4 SCOUT WAS MEASURED AND REJECTED (2026-07-26). This is a
// SETTLED decision, not an unfinished migration — do not "complete" it.
//
// scripts/serve-intake-model-ab.ts graded all three candidates against
// tests/fixtures/serve-intake/expected.json:
//   llama-3.3-70b-instruct-fp8-fast (incumbent)  33/36  (35/36 after prompt fixes)
//   mistral-small-3.1-24b-instruct               32/36  (33/36)
//   llama-4-scout-17b-16e-instruct               26/36  (28/36)
// The later prompt fixes lifted every candidate and reordered nothing.
// Note the harness grades RAW model output, before normalizeFields —
// see the header of scripts/serve-intake-model-ab.ts.
//
// Scout's failure is not merely "lower accuracy". It read the ICU
// LETTERHEAD address (250 N Red Cliffs Dr, Saint George) as the SERVICE
// address. For a process server that is a wrong-building dispatch — an
// officer sent to their own company's office instead of the recipient.
// A cheaper model that confidently emits a wrong service address is
// strictly worse than a dearer one that emits the right one.
//
// Scout does bill less per token (77,273 neurons/M output vs 204,805),
// but the incumbent was retained, so the packet cost stays at ~520
// neurons — see the cost envelope in the design spec §3.5.
//
// (The LoRA hazard once noted here is moot: SERVE_INTAKE_LORA is
// unconfigured, so no fine-tune is at risk either way. It is not a
// reason to keep the incumbent; the measured accuracy is.)
export const TEXT_MODEL_LEGACY = '@cf/meta/llama-3.3-70b-instruct-fp8-fast' as const;
export const TEXT_MODEL_SCOUT = '@cf/meta/llama-4-scout-17b-16e-instruct' as const;
export const VISION_MODEL_LEGACY = '@cf/meta/llama-3.2-11b-vision-instruct' as const;
// Moondream 3.1 is a CANDIDATE only — the vision A/B the spec §6 requires
// before adoption has not been run. Only the three text models were measured.
export const VISION_MODEL_MOONDREAM = '@cf/moondream/moondream3.1-9B-A2B' as const;

// Defaults stay on the measured winners: the incumbent text model (A/B
// above) and the incumbent vision model (no vision A/B run yet).
const TEXT_MODEL = TEXT_MODEL_LEGACY;
const VISION_MODEL = VISION_MODEL_LEGACY;

// Field set sourced from the client's OcrScanResult + IntakeResult
// shapes (client/src/pages/ServeIntakePage.tsx). Keeping the list
// in one place so the JSON-schema prompt and the post-processor
// stay aligned. Add a field here and both ends pick it up.
export const TARGET_FIELDS = [
  // ── Recipient (the party being served) ────────────────────
  // recipient_type lets the commit step decide whether to create a
  // person row (last_name='Smith'), a business row (Steel Encounters
  // Inc.), or both (corporate service to a registered agent).
  'recipient_type',                       // 'person' | 'business'
  'recipient_first_name', 'recipient_middle_name', 'recipient_last_name',
  'recipient_business_name',              // populated when recipient_type='business'
  'recipient_dob', 'recipient_address', 'recipient_city',
  'recipient_state', 'recipient_zip', 'recipient_phone',
  // Registered agent — separate from recipient because for corporate
  // service the agent IS the human person we physically serve.
  'registered_agent_name',
  // ── Case / court ──────────────────────────────────────────
  'plaintiff', 'defendant', 'case_number', 'court_name', 'jurisdiction',
  'document_type', 'document_subtype', 'filing_date', 'service_deadline',
  'hearing_date',
  'recipient_county',                     // service_county on ServeManager exports
  // ── Counsel / hiring party ────────────────────────────────
  'attorney_name', 'attorney_phone', 'attorney_email', 'attorney_bar_number',
  'client_name', 'job_number', 'fee_amount',
  // client_reference = the CLIENT's own job number (ServeManager
  // "client_job_number", e.g. 880231), distinct from the larger ServeManager
  // job_number in the page header (e.g. 13572468).
  'client_reference',
  // documents_to_serve = the full "Docs to Be Served" / document_titles
  // string verbatim (e.g. "Summons and Complaint; Bilingual Notice"),
  // kept alongside the single-value document_type enum.
  'documents_to_serve',
  // ── Service mechanics ─────────────────────────────────────
  'process_type', 'service_windows', 'service_instructions',
  'server_name', 'priority',
  // ── Timing & service constraints (PR 1, 2026-07-26) ───────
  // address_class is a property of the LOCATION, never the recipient —
  // a registered agent may sit at a residence and must then get
  // residential attempt windows (operator decision D-2).
  'address_class',                  // residential | corporate | small_business | government | business | unknown
  'service_days_allowed',           // 'all' | 'weekdays' | 'friday' | 'no_sunday' | free text
  'client_attempt_schedule',        // 'HH:MM-HH:MM;HH:MM-HH:MM' verbatim bands
  'attempt_start_not_before',       // ISO date — "start attempts on or after X"
  // ── Physical items & service authority (PR 1, 2026-07-26) ──
  // A witness fee is a THING the server must carry. It appears inside the
  // Documents list ("Check VV787 $18.50") and was previously invisible to
  // the officer until they opened the packet.
  'witness_fee_tendered',                    // yes | no | ''
  'witness_fee_instrument',                  // verbatim, e.g. 'Check VV787 $18.50'
  'registered_agent_address',                // distinct from recipient_address
  'sub_service_authorized_first_attempt',    // yes | no | ''
] as const;

export type TargetField = typeof TARGET_FIELDS[number];

export interface ExtractedField { value: string; confidence: number }

export interface ExtractionResult {
  success: boolean;
  documentType: string;
  confidence: number;
  fields: Record<string, ExtractedField>;
  rawText: string;
  allDates: string[];
  model: string;
  ms: number;
  error?: string;
}

// ── Extraction prompt ────────────────────────────────────────
// Llama 3.3 follows JSON-mode constraints reliably when the schema
// is concrete and the system prompt is unambiguous. We pin the doc
// type to a closed enum that matches the client's DOCUMENT_TYPES
// list so the dropdown value lands correctly without translation.
const DOC_TYPES = [
  'court_filing', 'field_sheet', 'info_page', 'affidavit', 'summons',
  'complaint', 'subpoena', 'eviction', 'restraining_order',
  'identification', 'correspondence', 'other',
] as const;

export const SYSTEM_PROMPT = `You are an extraction system for legal process-service (civil paper service) documents.
You return STRICT JSON only — no commentary, no markdown fences.

Confidence is your own per-field self-report on a 0..1 scale:
  • 1.0 — value is unambiguously printed in the document
  • 0.7 — value is present but partially obscured or inferred from context
  • 0.4 — best guess; reader should verify
  • 0.0 — field is not present; return empty string with confidence 0
Never invent values. If unsure, return empty string with confidence 0.
For dates use ISO format (YYYY-MM-DD); for phone numbers use digits only.

DOCUMENT FAMILIES you will see (a packet may contain several concatenated):
A) ServeManager job export / Information Form — the AUTHORITATIVE intake page.
   Layout cues: a "JOB" header with a large ServeManager job number then a
   smaller client job number and a due date; "CLIENT" and "SERVER" blocks; a
   "Recipient:" block with the party-to-serve name, "DOB:" and the service
   address; a "Service Instructions" block; "Docs to Be Served"; and a "Court
   Case" block (Plaintiff, Defendant, Court, Address, County, Case). It often
   embeds an "Imported CSV Row" JSON with keys like recipient_name_party_to_serve,
   service_address_1, service_city, service_state, service_postal_code, plaintiff,
   defendant, court_case_number, client_job_number, due_date, document_titles,
   service_instructions. When that JSON is present, TRUST IT as the primary source.
B) Court forms — Summons (e.g. CA Judicial Council SUM-100), Complaint, Civil
   Case Cover Sheet, Docket. Cues: "NOTICE TO DEFENDANT" / "AVISO AL DEMANDADO"
   → defendant; "YOU ARE BEING SUED BY PLAINTIFF" / "LO ESTÁ DEMANDANDO EL
   DEMANDANTE" → plaintiff; "CASE NUMBER" / "Número del Caso" → case_number;
   "The name and address of the court is" → court_name; "plaintiff's attorney" →
   attorney_name/phone.

EXTRACTION RULES (learned from real packets):
  • job_number = the FIRST number in the page header (e.g. "Job: 90000001 (90000002)").
    client_reference = the SECOND value, printed in parentheses right after it — the client's
    own job number. Go by POSITION, not size: client_reference is frequently the larger number
    and is sometimes non-numeric (an alphanumeric client code like "AZ900001E"), so never use
    magnitude or "is it numeric" to decide which is which.
  • Recipient name: split into first / middle / last. A single middle initial
    ("John Q Sample") → middle="Q". Keep suffixes (Jr/Sr/III) with the last name.
  • DOB frequently appears as a bare date after "DOB:" OR inside a free-text
    "description"/"recipient_description" field (e.g. a description whose entire
    value is a date like "03/04/1985"). Pull it into recipient_dob as ISO.
  • Address: prefer the "Recipient:" service-address block; map street→
    recipient_address, city→recipient_city (use the city shown directly under
    the recipient, not a generic county seat), state→recipient_state (2-letter),
    zip→recipient_zip, county→recipient_county.
  • recipient_type: 'business' when the party is a company (LLC, Inc., Corp.,
    Co., LLP, business entity) — put the company in recipient_business_name and,
    if a registered agent / "authorized person" is named, put them in
    registered_agent_name. Otherwise 'person'.
  • document_type: the single best enum for the lead document (a "Summons and
    Complaint" packet → 'summons'). documents_to_serve = the full title string
    verbatim ("Summons and Complaint; Bilingual Notice").
  • case_number is OFTEN BLANK on pre-filing summonses ("Civil No." empty,
    "Case [not provided]"). Leave it empty rather than guessing.
  • service_deadline: ONLY a concrete calendar date (e.g. a due date). A relative
    answer window like "30 calendar days" / "21 days" is NOT a deadline — leave
    service_deadline empty (capture the phrase in service_windows if useful).
    POSITIVE CASE: the date printed in the ServeManager / ICU JOB header — the third
    value on the header line, and any date labeled "Due:" / "Due Date" — IS the
    service_deadline. Emit it as ISO. A 2-digit year is 20xx ("6/15/26" → 2026-06-15).
  • priority: one of 'routine' | 'normal' | 'rush' | 'urgent'. A "RUSH" stamp,
    banner, or instruction anywhere on the document → 'rush'. "HOT RUSH",
    "SAME DAY", "EMERGENCY" → 'urgent'. Explicit "routine"/"standard" →
    'routine'. No urgency language at all → '' (do not guess).
  • Bilingual documents (English + Spanish, etc.): extract from the ENGLISH text;
    ignore the translated duplicate.
  • Multiple defendants on a court form: list them in 'defendant'; do not force a
    single recipient unless the ServeManager Recipient block names the party to serve.
  • plaintiff / defendant = the PARTY NAME ONLY. Do NOT include the label
    "Attorney for Plaintiff/Defendant", monetary or damages amounts ("$300,000"),
    e-filing stamps ("Filing# … E-Filed …"), judge names, or the margin line
    numbers California pleadings print down the left edge (1, 2, 3 …). Strip
    trailing party descriptors ("an individual", "a Domestic Business Corporation")
    — keep just the name(s).
  • Some courts (especially California family law — FL-300 and similar) caption
    the parties as PETITIONER / RESPONDENT rather than Plaintiff / Defendant. Map
    Petitioner → plaintiff and Respondent → defendant.
  • If an embedded "Imported CSV Row" shows a service_city that disagrees with the
    city printed in the rendered "Recipient:" block, TRUST the rendered
    Recipient-block city — the CSV value is often a county seat, not the actual
    municipality (e.g. CSV "Salt Lake City" vs printed "Holladay" → use Holladay).

TIMING & SERVICE CONSTRAINTS — read the Instructions block carefully:
• address_class — classify the SERVICE LOCATION, not the recipient:
  'residential' for a home/abode/dwelling/apartment;
  'corporate' for an LLC/Inc/Corp at a suite, floor, or office tower;
  'small_business' for a shop/store/DBA/storefront without a corporate suite;
  'government' for a courthouse, city hall, county/federal building, or agency counter;
  'unknown' otherwise.
  A "registered agent" mention is NOT evidence of a business address — agents are frequently at residences.
• service_days_allowed — e.g. "Service allowed 7 days a week" → 'all';
  "NO SERVICE ON SUNDAY" → 'no_sunday'; "SERVE ON FRIDAY" → 'friday'.
• client_attempt_schedule — when the client dictates attempt bands ("1 between 6AM-9AM,
  1 between 9AM-6PM and 1 between 6PM-9PM"), emit them as 24h ranges joined by semicolons:
  "06:00-09:00;09:00-18:00;18:00-21:00". Empty when the client dictates nothing.
• attempt_start_not_before — "Start attempts on or after June 26" → the ISO date.

PHYSICAL ITEMS & SERVICE AUTHORITY:
• witness_fee_instrument — a subpoena packet often lists a witness-fee check inside the
  documents line ("Check VV787 $18.50"). Copy it VERBATIM. Set witness_fee_tendered='yes'
  when such an instrument is listed, 'no' when the document says no fee is tendered, else ''.
• registered_agent_address — the agent's service address when it differs from the entity's
  own address (e.g. a corporate-agent service company). Empty when they are the same.
• sub_service_authorized_first_attempt — 'yes' when the client expressly permits substitute
  service on the FIRST attempt ("may be sub-served on the 1st attempt"), else ''.`;

// Llama 3.3 70B has a 128K-token context. 24K chars (~6K tokens) was
// far too conservative — a multi-document packet (e.g. a 47K-char court
// docket bundled with field sheets) got truncated mid-stream, and the
// recipient data could fall past the cut. 90K chars (~22K tokens) leaves
// generous headroom for the system prompt + JSON schema while covering
// virtually every real serve packet in one pass.
const MAX_PROMPT_CHARS = 90_000;

// A SYNTHETIC one-shot — fabricated names/addresses/numbers that mirror the
// ServeManager Information-Form layout. It teaches the field LOCATIONS (header
// job vs client job, DOB-in-recipient-block, city-under-recipient, pre-filing
// blank case number, doc-titles string) without embedding any real case data.
// Do NOT replace these with values from real packets.
const FEWSHOT_INPUT = `JOB
13572468 880231  6/15/26 G&A-Need Invoice
CLIENT  Example Collections, PLLC      SERVER  ICU Investigations, LLC  (435) 555-0100
Recipient: John Q Sample
DOB: 03/04/1985
742 W Sample Loop APT 3
Midvale, UT 84047
Service Instructions: Sub-serve on 1st attempt to any occupant 16+. Personal only at POE.
Docs to Be Served 11 pages  Summons and Complaint; Bilingual Notice
Court Case  Case [not provided]
Plaintiff  Sample Bank, N.A.
Defendant  John Q Sample
Court  THIRD JUDICIAL DISTRICT COURT, STATE OF UTAH - MATHESON
Address 450 S STATE ST, SALT LAKE CITY, UT 84114   County SALT LAKE`;

const FEWSHOT_OUTPUT = JSON.stringify({
  documentType: 'info_page',
  confidence: 0.9,
  allDates: ['03/04/1985', '6/15/26'],
  fields: {
    recipient_type: { value: 'person', confidence: 1 },
    recipient_first_name: { value: 'John', confidence: 1 },
    recipient_middle_name: { value: 'Q', confidence: 0.9 },
    recipient_last_name: { value: 'Sample', confidence: 1 },
    recipient_dob: { value: '1985-03-04', confidence: 1 },
    recipient_address: { value: '742 W Sample Loop APT 3', confidence: 1 },
    recipient_city: { value: 'Midvale', confidence: 1 },
    recipient_state: { value: 'UT', confidence: 1 },
    recipient_zip: { value: '84047', confidence: 1 },
    recipient_county: { value: 'Salt Lake', confidence: 0.9 },
    plaintiff: { value: 'Sample Bank, N.A.', confidence: 1 },
    defendant: { value: 'John Q Sample', confidence: 1 },
    case_number: { value: '', confidence: 0 },
    court_name: { value: 'Third Judicial District Court, State of Utah - Matheson', confidence: 1 },
    jurisdiction: { value: 'Salt Lake', confidence: 0.9 },
    document_type: { value: 'summons', confidence: 0.8 },
    documents_to_serve: { value: 'Summons and Complaint; Bilingual Notice', confidence: 1 },
    client_name: { value: 'Example Collections, PLLC', confidence: 1 },
    job_number: { value: '13572468', confidence: 1 },
    client_reference: { value: '880231', confidence: 0.9 },
    // The header's third value (6/15/26) IS the due date. Omitting this from
    // the one-shot actively taught the model that a header due date does not
    // populate service_deadline, and it came back empty on every fixture.
    service_deadline: { value: '2026-06-15', confidence: 0.9 },
    server_name: { value: 'ICU Investigations, LLC', confidence: 1 },
    service_instructions: { value: 'Sub-serve on 1st attempt to any occupant 16+. Personal only at POE.', confidence: 1 },
  },
});

export function buildUserPrompt(text: string): string {
  return `Extract the fields below from this process-service document.

Return JSON with EXACTLY this shape:
{
  "documentType": one of ${JSON.stringify(DOC_TYPES)},
  "confidence": overall 0..1,
  "allDates": [list of every date string you see, original format],
  "fields": {
    ${TARGET_FIELDS.map((f) => `"${f}": { "value": "...", "confidence": 0..1 }`).join(',\n    ')}
  }
}

EXAMPLE (format illustration only — fabricated data; never copy these values):
Input:
"""
${FEWSHOT_INPUT}
"""
Output:
${FEWSHOT_OUTPUT}

Now extract from the ACTUAL document below.
Document text:
"""
${text.slice(0, MAX_PROMPT_CHARS)}
"""`;
}

// CANONICAL chat-message shape for the extraction task. BOTH production
// inference (extractFromText) AND the offline LoRA dataset builder
// (training/build-dataset.ts) import this single function, so the prompt
// the adapter is trained on is byte-identical to the prompt it sees in
// prod. Diverging here silently degrades a fine-tune ("train/serve skew");
// keeping it in one place makes that class of bug structurally impossible.
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

// ── Document-family prompts ───────────────────────────────────
// One universal prompt makes the model hedge across layouts it isn't
// looking at. A packet has three distinct document families (ServeManager
// Information Form, ICU Field Sheet, court filing), each with its own
// layout and its own hazards. Each gets guidance for ITS hazards.
const FAMILY_PROMPTS: Record<string, string> = {
  field_sheet: `This is an ICU Investigations FIELD SHEET.
Layout: a header with Job / Party to Serve / Due date; a table of Case, Court, Plaintiff,
Defendant; a Documents line; and a free-text Instructions block.
HAZARD: a diagonal watermark ("RUSH") can leave stray single letters inside the table cells.
Ignore isolated single letters that do not form a word.
The Instructions block is the richest source of timing constraints, address class, and
substitute-service authorization — read it in full.`,

  court_filing: `This is a COURT FILING (summons, subpoena, complaint, or docket).
The caption is authoritative for case_number, court_name, plaintiff, and defendant — prefer it
over any other document. Utah courts caption as "<Ordinal> Judicial District Court, State of
Utah - <courthouse name>" (e.g. "Third Judicial District Court, State of Utah - Matheson") —
capture that whole phrase as court_name verbatim; it does not name the county. Do NOT treat the
party being served as a case party: on a subpoena the recipient is usually a non-party witness.`,

  info_page: `This is a ServeManager INFORMATION FORM — the authoritative operational record.
Prefer it for recipient, service address, service instructions, job numbers, and due date.
The JOB header carries two numbers: the FIRST (position, not size) is job_number; the SECOND
— printed in parentheses right after it, e.g. "Job: 90000001 (90000002)" — is client_reference.
Go by position, not magnitude: client_reference is often the larger number, and it is sometimes
not numeric at all (an alphanumeric client code like "AZ900001E"), so "larger"/"numeric" is never
a safe test — only position after the job number is reliable.
The DATE in that same JOB header (the value printed after the two job numbers, and any
"Due:" / "Due Date" / due_date field) IS service_deadline — emit it as ISO, reading a
2-digit year as 20xx. It is a concrete calendar date, not a relative answer window.
An embedded "Imported CSV Row" JSON block, when present, is the single most reliable source.`,
};

const GENERIC_FAMILY_PROMPT =
  'Extract every field you can locate. Return empty strings for fields not present.';

export function buildFamilyPrompt(docType: string): string {
  return FAMILY_PROMPTS[docType] ?? GENERIC_FAMILY_PROMPT;
}

// ── File-name → document family ───────────────────────────────
// Intake packets follow a fixed ICU naming convention: each file in a
// packet is named "<job number> Field Sheet.pdf" / "<job number> Court
// Docket.pdf" / "<job number> Information Form.pdf" (or close human-typed
// variants — casing, spacing, punctuation all drift). Matching on a
// distinctive substring (not exact equality) lets this survive that drift.
// Returns undefined rather than guessing on anything that doesn't clearly
// match one of the three known conventions — a WRONG family prompt would
// describe the wrong layout to the model, which is worse than none.
const FIELD_SHEET_NAME_HINT = /field[\s_-]*sheet/i;
const COURT_FILING_NAME_HINT = /court[\s_-]*(docket|filing)|docket/i;
const INFO_PAGE_NAME_HINT = /information[\s_-]*(form|page)|info[\s_-]*(form|page)/i;

export function familyFromFileName(fileName: string): string | undefined {
  const name = (fileName || '').trim();
  if (!name) return undefined;
  if (FIELD_SHEET_NAME_HINT.test(name)) return 'field_sheet';
  if (COURT_FILING_NAME_HINT.test(name)) return 'court_filing';
  if (INFO_PAGE_NAME_HINT.test(name)) return 'info_page';
  return undefined;
}

// ── Bounded critic pass ───────────────────────────────────────
// Re-asking the model about EVERY field would double neuron spend on
// every packet. Only genuinely doubtful critical fields qualify, capped
// so a badly-scanned document cannot blow the daily free allocation.
const CRITIC_FIELDS: TargetField[] = [
  'case_number', 'court_name', 'recipient_address', 'service_deadline',
  'recipient_dob', 'recipient_phone', 'address_class',
];
const CRITIC_CONFIDENCE_FLOOR = 0.6;
const CRITIC_MAX_FIELDS = 5;

export function needsCriticPass(
  fields: Record<string, ExtractedField>,
  issues: Array<{ field: string; severity: 'warn' | 'error' }>,
): string[] {
  const flagged = new Set(
    issues.filter((i) => i.severity === 'error').map((i) => i.field),
  );
  // Validator-flagged errors qualify even for fields outside the fixed
  // CRITIC_FIELDS list (the validator already knows the field is wrong;
  // that's a stronger signal than the static critical-field allowlist).
  // Checked first, in issue order, before the low-confidence sweep, so a
  // known-bad field never loses its slot under the cap to a merely-doubtful one.
  const candidates: TargetField[] = [
    ...(Array.from(flagged) as TargetField[]),
    ...CRITIC_FIELDS.filter((f) => !flagged.has(f)),
  ];
  const out: string[] = [];
  for (const f of candidates) {
    const ef = fields[f];
    if (!ef) continue;
    const doubtful = !!ef.value && ef.confidence < CRITIC_CONFIDENCE_FLOOR;
    if (doubtful || flagged.has(f)) out.push(f);
    if (out.length >= CRITIC_MAX_FIELDS) break;
  }
  return out;
}

// Merge a critic pass's answers back over the original field map. Only
// fields the critic was actually asked about are eligible, and an empty
// critic answer never destroys a value the first pass found — a second
// opinion that says "I don't know" is not evidence the first was wrong.
export function applyCriticResults(
  fields: Record<string, ExtractedField>,
  critic: Partial<Record<string, ExtractedField>>,
): Record<string, ExtractedField> {
  const out: Record<string, ExtractedField> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = { ...v };
  for (const [k, v] of Object.entries(critic)) {
    if (!v) continue;
    if (!(k in out)) continue;                 // not a target field — ignore
    const value = (v.value || '').trim();
    if (!value) continue;                      // critic had nothing — keep the original
    out[k] = { value, confidence: v.confidence ?? 0.5 };
  }
  return out;
}

// A SECOND look at a SHORT list of doubtful fields. Deliberately not a
// full re-extraction: the prompt names only the requested fields, so the
// model has one narrow job and the output is small. Cost is bounded by
// needsCriticPass's cap (CRITIC_MAX_FIELDS), so a badly-scanned packet
// cannot blow the 10,000-neuron/day free allocation.
export const CRITIC_TIMEOUT_MS = 20_000;

const CRITIC_SYSTEM = `You are re-checking a SMALL number of fields another extraction pass was unsure about, in a legal process-service document.
Return STRICT JSON only — no commentary, no markdown fences — shaped exactly:
{"<field>": {"value": "<string>", "confidence": <0..1>}, ...}
Include ONLY the fields you were asked about.
If you cannot find a field, return an empty string with confidence 0. NEVER guess — an empty answer leaves the first pass's value in place, which is the safe outcome.
Dates use ISO YYYY-MM-DD. Phone numbers are digits only.`;

export async function criticExtract(
  env: { DB: D1Database; AI: Ai; KV?: KVNamespace },
  rawText: string,
  fieldNames: string[],
): Promise<Partial<Record<string, ExtractedField>>> {
  if (!fieldNames.length || !rawText.trim()) return {};
  const asked = fieldNames.join(', ');
  const res = await callAi(env, {
    system: CRITIC_SYSTEM,
    text: `Re-read the document below and report ONLY these fields: ${asked}\n\n---\n${rawText.slice(0, 24_000)}`,
    maxTokens: 512,
  });
  const parsed = tryParseModelJson({ response: res.text });
  const out: Partial<Record<string, ExtractedField>> = {};
  for (const name of fieldNames) {
    const v = (parsed as any)?.[name];
    if (!v) continue;
    const value = typeof v === 'string' ? v : String(v?.value ?? '');
    const confidence = typeof v === 'object' && typeof v.confidence === 'number' ? v.confidence : 0.5;
    out[name] = { value: value.trim(), confidence };
  }
  return out;
}

// docType is optional: extractFromText doesn't know the document's family
// until AFTER extraction, so its call site omits it and behavior is
// unchanged. Callers that already know the family (e.g. a future critic
// pass re-invocation) can pass it to sharpen the system prompt for that
// family's specific hazards.
export function buildExtractionMessages(rawText: string, docType?: string): ChatMessage[] {
  const system = docType
    ? `${SYSTEM_PROMPT}\n\n${buildFamilyPrompt(docType)}`
    : SYSTEM_PROMPT;
  return [
    { role: 'system', content: system },
    { role: 'user', content: buildUserPrompt(rawText.trim()) },
  ];
}

// ── Response schema (RETAINED FOR REFERENCE — NOT CURRENTLY USED) ──
// We removed response_format from the ai.run() calls: strict grammar-
// constrained decoding over this 30+-field schema was timing out the
// extraction (>25s even on tiny inputs) in prod. We now rely on the
// prompt-specified JSON shape + lenient tryParseModelJson() instead.
// Kept here documented so the schema is easy to re-enable if a future
// Workers AI model handles constrained decoding fast enough to be worth
// the accuracy guarantee. Prefixed _ to signal "intentionally unused".
const _RESPONSE_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'serve_intake_extraction',
    schema: {
      type: 'object',
      required: ['documentType', 'confidence', 'fields'],
      additionalProperties: false,
      properties: {
        documentType: { type: 'string', enum: [...DOC_TYPES] },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        allDates: { type: 'array', items: { type: 'string' } },
        fields: {
          type: 'object',
          additionalProperties: false,
          properties: Object.fromEntries(
            TARGET_FIELDS.map((f) => [f, {
              type: 'object',
              required: ['value', 'confidence'],
              additionalProperties: false,
              properties: {
                value: { type: 'string' },
                confidence: { type: 'number', minimum: 0, maximum: 1 },
              },
            }]),
          ),
        },
      },
    },
    strict: true,
  },
} as const;

// Placeholder values process-service docs routinely carry ("Case [not
// provided]", "—", "None", "N/A"). The model frequently echoes them verbatim,
// which would otherwise land in the DB as a literal case_number / address / etc.
// Anchored to the WHOLE trimmed value so it never clips a real value that merely
// contains one of these tokens (e.g. plaintiff "Capital One, N.A.").
const PLACEHOLDER_VALUE = /^\[?\s*(not provided|none|n\/?a|unknown|tbd|pending|null|—|-{1,})\s*\]?$/i;

// Deterministic DOB recovery for ServeManager exports, where the date of birth
// often sits as a bare date after "DOB:" or alone inside a description field
// rather than in a dedicated DOB field. Only runs when the model left
// recipient_dob empty, so it never overrides a confidently-read value.
export function recoverDob(rawText: string): string | null {
  const t = rawText || '';
  const labeled = t.match(/\b(?:DOB|D\.O\.B\.?|date of birth|born)\b[:\s]*?(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{1,2}-\d{1,2})/i);
  if (labeled) { const iso = toIsoDate(labeled[1]); if (iso) return iso; }
  // "recipient_description": "03/04/1985" — a description whose entire value is a date.
  const desc = t.match(/"recipient_description"\s*:\s*"(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})"/i);
  if (desc) { const iso = toIsoDate(desc[1]); if (iso) return iso; }
  return null;
}

function normalize(parsed: any, rawText: string, model: string, ms: number): ExtractionResult {
  const fields: Record<string, ExtractedField> = {};
  const incoming = (parsed?.fields ?? {}) as Record<string, any>;
  for (const f of TARGET_FIELDS) {
    const v = incoming[f];
    if (v && typeof v === 'object') {
      let value = typeof v.value === 'string' ? v.value : '';
      if (PLACEHOLDER_VALUE.test(value.trim())) value = ''; // scrub placeholders → empty
      fields[f] = {
        value,
        confidence: value && typeof v.confidence === 'number' ? Math.max(0, Math.min(1, v.confidence)) : 0,
      };
    } else {
      fields[f] = { value: '', confidence: 0 };
    }
  }
  // DOB safety net: only when the model didn't already supply one.
  if (!fields.recipient_dob.value) {
    const dob = recoverDob(rawText);
    if (dob) fields.recipient_dob = { value: dob, confidence: 0.6 };
  }
  const filled = Object.values(fields).filter((f) => f.value && f.confidence > 0.3).length;
  const fallbackConfidence = Math.min(1, filled / 8);
  const docType = DOC_TYPES.includes(parsed?.documentType) ? parsed.documentType : 'other';

  return {
    success: filled > 0,
    documentType: docType,
    confidence: typeof parsed?.confidence === 'number'
      ? Math.max(0, Math.min(1, parsed.confidence))
      : fallbackConfidence,
    fields,
    rawText,
    allDates: Array.isArray(parsed?.allDates) ? parsed.allDates.slice(0, 50).map(String) : [],
    model,
    ms,
  };
}

export function tryParseModelJson(out: any): any {
  // Workers AI returns either { response: string } or
  // { response: { … parsed JSON object … } } depending on whether
  // response_format coerced server-side. Handle both.
  const raw = out?.response;
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return {};
  // Strip ```json fences if the model added them anyway.
  const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  // Last-ditch: pull the first {...} block out of free text.
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch { /* ignore */ }
  }
  return {};
}

// Parse + normalize a raw Workers-AI text-generation response into the
// canonical ExtractionResult. extractFromText() uses this internally; the
// offline eval runner (training/run-eval.ts) calls it directly so its
// scoring sees the EXACT post-processing prod applies — no reimplementation.
export function normalizeModelOutput(
  out: any,
  rawText: string,
  model: string = TEXT_MODEL,
  ms: number = 0,
): ExtractionResult {
  return normalize(tryParseModelJson(out), rawText, model, ms);
}

export async function extractFromText(
  ai: Ai,
  rawText: string,
  // Optional fine-tune. When set (from env SERVE_INTAKE_LORA), Workers AI
  // applies the uploaded LoRA adapter and we pass raw:true so the model
  // uses the chat template the adapter was trained on (the one emitted by
  // training/build-dataset.ts) instead of the default. Unset → stock 70B.
  lora?: string,
  // Optional document family (see familyFromFileName / buildFamilyPrompt).
  // Callers that can derive it from the source file name should pass it so
  // the system prompt gets that family's specific layout guidance. Unset →
  // behavior is byte-identical to before this parameter existed.
  docType?: string,
): Promise<ExtractionResult> {
  const trimmed = rawText.trim();
  if (trimmed.length < 20) {
    return {
      success: false, documentType: 'other', confidence: 0,
      fields: Object.fromEntries(TARGET_FIELDS.map((f) => [f, { value: '', confidence: 0 }])) as any,
      rawText, allDates: [], model: TEXT_MODEL, ms: 0,
      error: 'Insufficient text to extract',
    };
  }
  const started = Date.now();
  // NOTE: we deliberately do NOT pass response_format/json_schema here.
  // Strict grammar-constrained decoding over our 30+-field nested schema
  // made the gateway build a huge FSM and constrain every token, which
  // pushed even a 1KB field-sheet extraction past 25s and timed out in
  // prod (jobs 14901313, 16009904, 2026-05-28). The prompt already
  // specifies the exact JSON shape and the system prompt forbids prose/
  // fences, so a 70B reliably emits parseable JSON under FREE generation
  // — dramatically faster. tryParseModelJson() handles any stray fences.
  //
  // One retry covers transient gateway errors / the rare unparseable
  // response. lastErr is surfaced so the caller can record WHY a doc
  // came back with no fields instead of a silent confidence=0.
  let lastErr = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const out = await ai.run(TEXT_MODEL, {
        messages: buildExtractionMessages(trimmed, docType),
        temperature: 0.1,
        max_tokens: 2048,
        // raw:true ONLY with a LoRA — the adapter's training data carries the
        // chat template, so we must not let Workers AI apply the default one
        // on top. Without a LoRA we keep the default template (raw stays off).
        ...(lora ? { lora, raw: true } : {}),
      } as any);
      const parsed = tryParseModelJson(out);
      const result = normalize(parsed, rawText, TEXT_MODEL, Date.now() - started);
      if (result.success || attempt === 1) {
        if (!result.success && !result.error) result.error = 'Model returned no extractable fields';
        return result;
      }
      lastErr = 'First pass returned no fields; retrying';
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      // fall through to retry (or exit on second attempt)
    }
  }
  return {
    success: false, documentType: 'other', confidence: 0,
    fields: Object.fromEntries(TARGET_FIELDS.map((f) => [f, { value: '', confidence: 0 }])) as any,
    rawText, allDates: [], model: TEXT_MODEL, ms: Date.now() - started,
    error: lastErr || 'Extraction failed after retry',
  };
}

// Llama 3.2 Vision accepts the image as a number-array of bytes.
// Going over ~5 MB causes the model gateway to reject the call, so
// callers must downscale large rasters before getting here.
const MAX_VISION_BYTES = 4 * 1024 * 1024;

export async function extractFromImage(
  ai: Ai,
  imageBytes: Uint8Array,
): Promise<ExtractionResult> {
  if (imageBytes.byteLength === 0 || imageBytes.byteLength > MAX_VISION_BYTES) {
    return {
      success: false, documentType: 'other', confidence: 0,
      fields: Object.fromEntries(TARGET_FIELDS.map((f) => [f, { value: '', confidence: 0 }])) as any,
      rawText: '', allDates: [], model: VISION_MODEL, ms: 0,
      error: `Image size out of range (0 < n <= ${MAX_VISION_BYTES})`,
    };
  }
  const started = Date.now();
  try {
    const out = await ai.run(VISION_MODEL, {
      image: Array.from(imageBytes),
      prompt: `${SYSTEM_PROMPT}\n\n${buildUserPrompt('(image-only document — read text via OCR then extract)')}`,
      max_tokens: 2048,
      temperature: 0.1,
    } as any);
    const parsed = tryParseModelJson(out);
    // Vision model doesn't always echo back rawText; synthesise it
    // from whatever values it returned so the audit trail has something.
    const synthesized = Object.values<any>(parsed?.fields ?? {})
      .map((f) => f?.value).filter(Boolean).join(' | ');
    return normalize(parsed, synthesized, VISION_MODEL, Date.now() - started);
  } catch (err) {
    return {
      success: false, documentType: 'other', confidence: 0,
      fields: Object.fromEntries(TARGET_FIELDS.map((f) => [f, { value: '', confidence: 0 }])) as any,
      rawText: '', allDates: [], model: VISION_MODEL, ms: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Advanced OCR: Claude vision (when anthropic_api_key is configured) ─────
// Drop-in for extractFromImage that uses the Claude Messages API instead of the
// Workers-AI llama vision model — markedly stronger document OCR + structured
// extraction. Reuses the SAME prompt + parser + normalizer so the result shape
// is identical. Returns null (NOT a failure result) when the key is absent or
// the call errors, so callers fall back to the Workers-AI path.
export async function extractFromImageClaude(
  env: { DB: D1Database; AI: Ai },
  imageBytes: Uint8Array,
  mediaType = 'image/jpeg',
): Promise<ExtractionResult | null> {
  if (imageBytes.byteLength === 0 || imageBytes.byteLength > MAX_VISION_BYTES) return null;
  const started = Date.now();
  try {
    const r = await callAi(env, {
      system: SYSTEM_PROMPT,
      text: `${buildUserPrompt('(image-only document — OCR the visible text, then extract)')}\n\nReturn ONLY the JSON object, no prose.`,
      image: { base64: bytesToBase64(imageBytes), mediaType },
      maxTokens: 2048,
      providers: ['claude', 'openai'], // paid only — caller falls back to Workers AI
    });
    const parsed = tryParseModelJson({ response: r.text });
    const synthesized = Object.values<any>(parsed?.fields ?? {})
      .map((f) => f?.value).filter(Boolean).join(' | ');
    return normalize(parsed, synthesized, `${r.provider}:${r.model}`, Date.now() - started);
  } catch {
    return null; // fall back to Workers AI
  }
}

// Advanced OCR: Claude text extraction (when anthropic_api_key is configured) —
// drop-in for extractFromText that runs the SAME rich serve-doc system prompt on
// Claude instead of Llama-70B. Returns null (not a failure result) when the key
// is absent or the call errors, so callers fall back to the Workers-AI path.
// `docType` is the packet family (see familyFromFileName / buildFamilyPrompt).
// It appends the family's layout-specific guidance to the system prompt the
// SAME way the Workers-AI leg does, so the family wiring is not silently inert
// on the primary path the moment anthropic_api_key is set. Omitting it yields
// the bare SYSTEM_PROMPT — byte-identical to the pre-parameter behavior.
export async function extractFromTextClaude(
  env: { DB: D1Database; AI: Ai }, rawText: string, docType?: string,
): Promise<ExtractionResult | null> {
  const trimmed = (rawText || '').trim();
  if (trimmed.length < 20) return null;
  const started = Date.now();
  try {
    const r = await callAi(env, {
      system: docType ? `${SYSTEM_PROMPT}\n\n${buildFamilyPrompt(docType)}` : SYSTEM_PROMPT,
      text: `${buildUserPrompt(trimmed)}\n\nReturn ONLY the JSON object, no prose.`,
      maxTokens: 2048,
      providers: ['claude', 'openai'],
    });
    const parsed = tryParseModelJson({ response: r.text });
    return normalize(parsed, rawText, `${r.provider}:${r.model}`, Date.now() - started);
  } catch {
    return null;
  }
}

// ── Structured PDF text via Workers AI Markdown Conversion ────
// env.AI.toMarkdown() converts PDFs WITHOUT invoking a model: it walks
// the PDF StructTree (ISO 14289 / PDF-UA) and emits semantic Markdown,
// falling back to raw text extraction when no structure tree exists.
// That means it costs ZERO neurons and — critically — it does not
// interleave the two-column Information Form the way positional text
// extraction does.
//
// Verified against the Cloudflare docs 2026-07-26. Prefer this over the
// container /extract-text round-trip; keep the container as fallback for
// documents toMarkdown cannot read.

export interface PdfTextResult {
  text: string;
  source: 'tomarkdown' | 'container' | 'empty';
  structured: boolean;     // true when the converter produced heading structure
  page_count: number;
}

interface ConversionResult {
  name?: string;
  format?: 'markdown' | 'text' | 'error';
  data?: string;
  error?: string;
}

// Workers AI toMarkdown() emits a FIXED scaffold around EVERY successful
// conversion, model-free or not — verified against the live endpoint
// 2026-07-26:
//   # <filename>
//   ## Metadata
//   - PDFFormatVersion=1.4
//   ...
//   ## Contents
//   ### Page 1
//   <page text>
// Those four heading forms (`# <name>`, `## Metadata`, `## Contents`,
// `### Page N`) are unconditional boilerplate the converter prints
// regardless of whether it found a real StructTree — a flat-text fallback
// produces exactly this scaffold too. The old `HAS_STRUCTURE = /^#{1,6}\s+\S/m`
// matched ANY ATX heading, so it matched the scaffold on every successful
// call and `structured` was always true, unable to distinguish a genuine
// semantic conversion from flat text wrapped in boilerplate.
//
// Only a heading that appears WITHIN the page content, beyond that fixed
// scaffold, is evidence the converter actually walked the PDF's StructTree.
const SCAFFOLD_HEADING = /^(#\s+\S.*|##\s+Metadata\s*|##\s+Contents\s*|###\s+Page\s+\d+\s*)$/;
const ANY_HEADING = /^#{1,6}\s+\S/;

function hasSemanticStructure(markdown: string): boolean {
  return markdown.split('\n').some((rawLine) => {
    const line = rawLine.trimEnd();
    return ANY_HEADING.test(line) && !SCAFFOLD_HEADING.test(line);
  });
}

// `Pick<Ai, 'toMarkdown'>` (not a hand-rolled `(files: unknown) => Promise<unknown>`
// shape) so the real `env.AI` binding — whose `toMarkdown` is overloaded
// (0-arg service accessor / array-in / single-doc-in) — is structurally
// assignable. A collapsed single-signature shape rejects `Ai` at the call
// site because TS resolves overload assignability against the FIRST
// matching signature, which for `toMarkdown` is the 0-arg
// `ToMarkdownService` accessor.
export async function extractPdfMarkdown(
  ai: Pick<Ai, 'toMarkdown'>,
  pdfBytes: Uint8Array,
  fileName: string,
): Promise<PdfTextResult> {
  const empty: PdfTextResult = { text: '', source: 'empty', structured: false, page_count: 0 };
  try {
    const raw = await ai.toMarkdown({
      name: fileName,
      blob: new Blob([pdfBytes], { type: 'application/pdf' }),
    });
    const list: ConversionResult[] = Array.isArray(raw) ? raw as ConversionResult[] : [raw as ConversionResult];
    const doc = list.find((d) => d?.name === fileName) ?? list[0];
    if (!doc || doc.format === 'error' || !doc.data) return empty;

    const structured = hasSemanticStructure(doc.data);
    // Page count is derivable from the converter's own page headings.
    const page_count = (doc.data.match(/^#{2,4}\s+Page\s+\d+/gim) || []).length;
    return {
      text: precleanText(doc.data),
      source: 'tomarkdown',
      structured,
      page_count,
    };
  } catch {
    // Binding unavailable or conversion blew up — the caller falls back to
    // the container path. Never throw: a single unreadable document must
    // not fail the whole packet.
    return empty;
  }
}

// A document whose text layer is a scan stub needs vision OCR. Threshold
// is per-page so a 10-page scan isn't rescued by one page of metadata.
const MIN_CHARS_PER_PAGE = 40;

export function isScanStub(text: string, pageCount: number): boolean {
  const len = (text || '').trim().length;
  if (len === 0) return true;
  const pages = Math.max(1, pageCount || 1);
  return len / pages < MIN_CHARS_PER_PAGE;
}

// ── Container OCR helper ──────────────────────────────────────
// Forward an in-memory buffer to the PDF Tools container's
// /extract-text endpoint. The container handles pdftotext + Tesseract
// fallback; we just wrap the multipart request.
export async function extractTextFromPdf(
  container: { fetch: (req: Request) => Promise<Response> },
  pdfBytes: Uint8Array,
  fileName: string,
): Promise<{ text: string; page_count: number; ocr_used: boolean }> {
  const form = new FormData();
  form.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), fileName);
  const res = await container.fetch(new Request('http://container/extract-text', {
    method: 'POST',
    body: form,
  }));
  if (!res.ok) {
    throw new Error(`extract-text container ${res.status}: ${await res.text().catch(() => '')}`);
  }
  const body = await res.json() as { text?: string; page_count?: number; ocr_used?: boolean };
  return {
    text: body.text ?? '',
    page_count: body.page_count ?? 0,
    ocr_used: !!body.ocr_used,
  };
}

// Map the LLM-extracted fields into the column shape serve_queue expects.
// The client's `processIntake` POST shape (IntakeResult.extracted) is
// derived from this — keep the mapping in lock-step.
// Allowed serve_queue.priority values (from migration 0030 CHECK).
// The CAD `calls_for_service.priority` ladder is P1..P4 — see
// serveIntakeRecords.cadPriority() for the mapping into that ladder.
export type ServePriority = 'routine' | 'normal' | 'rush' | 'urgent';

const SERVE_PRIORITIES: ServePriority[] = ['routine', 'normal', 'rush', 'urgent'];

export function normalizePriority(raw: string): ServePriority {
  const lower = raw.trim().toLowerCase();
  if (lower === 'hot rush' || lower === 'hot_rush') return 'urgent';
  if (SERVE_PRIORITIES.includes(lower as ServePriority)) return lower as ServePriority;
  return 'normal';
}

// serve_queue.deadline must hold a real calendar date (it drives the
// overdue check: WHERE deadline < datetime('now')). The LLM sometimes
// returns a RELATIVE phrase instead — e.g. "21 days" lifted from a
// summons's "answer within 21 days" language — which would compare
// lexically against ISO dates and silently never trip overdue. Only
// accept values that parse as an actual date; otherwise null.
// Accepts ISO (YYYY-MM-DD) and common US (M/D/YYYY) forms, normalizing
// to ISO. Returns null for anything that isn't a concrete date.
export function normalizeDeadline(raw: string): string | null {
  return toIsoDate(raw);
}

// ── Field-level normalizers (deterministic post-extraction pass) ──
// The LLM is *asked* to emit digits-only phones and ISO dates, but it
// complies only ~80% of the time. These enforce the invariants in code
// so the wrong shape never reaches a typed/CHECK-constrained column
// (state is CHAR(2) on persons/properties, deadline drives an ISO date
// comparison, phone feeds the dedupe key in findOrCreatePerson).

// ISO-or-US calendar date → ISO YYYY-MM-DD, else null. Shared by the
// deadline check and every other date field (DOB, filing/hearing dates).
export function toIsoDate(raw: string): string | null {
  const s = (raw || '').trim();
  if (!s) return null;
  // ISO: 2026-05-22 (optionally with time) — take the date part.
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  // US: 5/22/2026, 05/22/26, or dash form 5-22-2026.
  const us = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (us) {
    const mm = us[1].padStart(2, '0');
    const dd = us[2].padStart(2, '0');
    const yyyy = us[3].length === 2 ? `20${us[3]}` : us[3];
    // Reject impossible month/day so OCR noise ("13/45/2026") doesn't
    // become a silently-wrong date that still parses lexically.
    if (Number(mm) > 12 || Number(dd) > 31) return null;
    return `${yyyy}-${mm}-${dd}`;
  }
  // Anything else ("21 days", "upon service", free text) → not a date.
  return null;
}

// DOB-aware date: like toIsoDate, but a 2-digit year that resolves into the
// FUTURE is rolled back a century — nobody being served has a future birth
// date, so "3/4/85" is 1985, not 2085 (toIsoDate's blanket "20"+yy rule is
// correct for due dates but wrong for births). 4-digit-year input is untouched,
// which is what the real packets carry. refYear is injectable for tests.
export function normalizeBirthDate(raw: string, refYear?: number): string | null {
  const iso = toIsoDate(raw);
  if (!iso) return null;
  const [y, m, d] = iso.split('-');
  let year = Number(y);
  const ref = refYear ?? new Date().getUTCFullYear();
  // Only correct when the source was a 2-digit year (toIsoDate already
  // expanded it). A real 4-digit future year stays as-is (and is rejected
  // downstream if implausible).
  if (year > ref && /[/-]\d{2}$/.test(raw.trim())) year -= 100;
  return `${year}-${m}-${d}`;
}

// Full state name OR 2-letter code → uppercase 2-letter. Unknown input
// is returned uppercased+trimmed (we'd rather keep a 3-letter oddity
// than blank a column), but a 2-char column will reject >2 chars, so the
// commit caps to 2 for the persons/properties writes.
const US_STATES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY', 'district of columbia': 'DC',
};

export function normalizeState(raw: string): string {
  const s = (raw || '').trim();
  if (!s) return '';
  const lower = s.toLowerCase().replace(/\./g, '');
  if (US_STATES[lower]) return US_STATES[lower];
  // Strip dots/spaces so a dotted abbreviation ("U.T.") still reads as a code.
  const compact = s.replace(/[.\s]/g, '');
  if (/^[a-z]{2}$/i.test(compact)) return compact.toUpperCase();
  return s.toUpperCase();
}

// Digits only; drop a leading US country code so 11-digit "1XXXXXXXXXX"
// stores the same 10 digits as a bare local number (keeps the person
// dedupe key stable across documents that format phones differently).
export function normalizePhone(raw: string): string {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits;
}

// First 5 digits as the ZIP, optionally "+4". Strips OCR'd letters and
// stray punctuation ("UT 84102-1234" pasted into the zip field → 84102-1234).
export function normalizeZip(raw: string): string {
  const m = (raw || '').match(/(\d{5})(?:[-\s]?(\d{4}))?/);
  if (!m) return '';
  return m[2] ? `${m[1]}-${m[2]}` : m[1];
}

// Deterministic party/name de-noiser. Court-docket captions interleave the
// party name with text that the model (or a layout-extractor) sometimes sweeps
// into plaintiff/defendant/name fields: the "Attorney for Plaintiff" label, a
// damages/Tier line, an e-filing stamp, the margin line-numbers California
// pleadings print, and trailing party descriptors. These were observed verbatim
// in real packets ("$300,000) MICHAEL J BURGESS", "Filing# 237921303 E-Filed …
// HERIBERTO VALIENTE", "Attorney for Plaintiff Capital One, N.A."). The system
// prompt also instructs against them, but this guarantees the garbage never
// reaches a record even if the model ignores the instruction. Each pattern is
// chosen to have ~zero false-positive risk on a real party/court/attorney name.
export function scrubPartyNoise(raw: string): string {
  let s = (raw || '').trim();
  if (!s) return '';
  s = s.replace(/^\s*attorneys?\s+for\s+(?:the\s+)?(?:plaintiff|defendant|petitioner|respondent)s?\b[\s:,.-]*/i, '');
  s = s.replace(/\(?\s*tier\s+\d+\s+damages[^)]*\)?/ig, ' ');     // "(Tier 3 Damages exceed $300,000)"
  s = s.replace(/\$\s?[\d,]+(?:\.\d+)?\)?/g, ' ');                 // bare "$300,000"
  s = s.replace(/\bfiling\s*#?\s*\d+/ig, ' ');                     // "Filing# 237921303"
  s = s.replace(/\be-?filed\b[^,;]*?(?:\bam\b|\bpm\b|\d{4})/ig, ' '); // "E-Filed 12/17/2025 11:28:33 AM"
  s = s.replace(/\b\d{1,3}(?:\s+\d{1,3}){1,}\b/g, ' ');            // line-number runs "8 9 10" (2+ only → keeps "Pizzeria 24")
  // "et al" appears in the wild as "et al", "et al.", AND "et. al." — the
  // period-after-"et" spelling is common on real captions and used to survive
  // into `defendant` verbatim. `\bet\.?\s+al\.?` covers all three. The
  // leading `\b` is required: without it "et" also matches mid-word (e.g.
  // "Comet. Al Ventures" → "et. Al" inside "Comet." matches and truncates
  // the name to "Com Ventures").
  s = s.replace(/,?\s*(?:an\s+individual|individually|a\s+domestic[^,;]*|\bet\.?\s+al\.?)\b\.?/ig, ''); // trailing descriptors
  // Trim leftover separators — but keep a TRAILING period/hyphen: it's usually
  // part of an abbreviation ("N.A.", "Inc.", "L.L.C."), not noise.
  return s.replace(/\s{2,}/g, ' ').replace(/^[\s,;:.-]+/, '').replace(/[\s,;:]+$/, '').trim();
}

// Address class drives which attempt-window defaults apply. Only
// CONFIRMED business language yields 'business'; everything else falls to
// 'unknown', which the planner treats as residential (wider windows —
// being wrong that way costs a wasted window, not a missed service).
const BUSINESS_HINTS = /\b(business address|place of employment|commercial|office|suite|corporate address)\b/i;
const RESIDENTIAL_HINTS = /\b(residen\w*|abode|dwelling|home address|apartment|apt\b)/i;

export function normalizeAddressClass(raw: string): string {
  const s = (raw || '').trim();
  if (!s) return 'unknown';
  const lower = s.toLowerCase().replace(/\s+/g, '_');
  if (lower === 'business' || lower === 'residential' || lower === 'unknown') return lower;
  if (lower === 'corporate' || lower === 'corporate_business' || lower === 'large_business') return 'corporate';
  if (lower === 'small_business' || lower === 'small_businesses') return 'small_business';
  if (lower === 'government' || lower === 'government_office' || lower === 'government_offices') return 'government';
  if (lower === 'commercial') return 'small_business';
  if (lower === 'office') return 'corporate';
  if (lower === 'gated' || lower === 'hoa' || lower === 'gated_/_hoa') return 'gated';
  if (lower === 'po_box' || lower === 'pobox' || lower === 'po-box') return 'po_box';
  if (RESIDENTIAL_HINTS.test(s)) return 'residential';
  if (/\b(city hall|courthouse|county (?:building|clerk)|government office)\b/i.test(s)) return 'government';
  if (/\b(corporate address|llc|incorporated)\b/i.test(s) && /\b(suite|floor|office)\b/i.test(s)) return 'corporate';
  if (BUSINESS_HINTS.test(s)) return 'business';
  return 'unknown';
}

// Tri-state: 'yes' | 'no' | '' (unknown). Never guess — an unknown
// sub-service authorization must read as unknown, not as permission.
export function normalizeYesNo(raw: string): string {
  const s = (raw || '').trim().toLowerCase();
  if (!s) return '';
  if (/^(y|yes|true|1|authorized|permitted|allowed)$/.test(s)) return 'yes';
  if (/^(n|no|false|0|not authorized|prohibited|denied)$/.test(s)) return 'no';
  return '';
}

// Which target fields get which normalizer. Centralized so adding a new
// date/phone field is a one-line change, not a scattered edit.
const PHONE_FIELDS = new Set<TargetField>(['recipient_phone', 'attorney_phone']);
const STATE_FIELDS = new Set<TargetField>(['recipient_state']);
const ZIP_FIELDS = new Set<TargetField>(['recipient_zip']);
const DATE_FIELDS = new Set<TargetField>([
  'recipient_dob', 'filing_date', 'service_deadline', 'hearing_date',
  'attempt_start_not_before',
]);
const ADDRESS_CLASS_FIELDS = new Set<TargetField>(['address_class']);
// Party / institutional name fields that get the caption de-noiser.
// ⚠️ ADDRESS FIELDS DO NOT BELONG HERE. scrubPartyNoise is a party-NAME
// de-noiser; its line-number rule (`\b\d{1,3}(?:\s+\d{1,3}){1,}\b`) strips
// any run of two or more short number tokens, which mangles a real street
// address: "Apt 5 210 Main St" → "Apt Main St". registered_agent_address was
// in this set and survived only because the sample's house number happened
// to be four digits.
const NAME_FIELDS = new Set<TargetField>([
  'plaintiff', 'defendant', 'recipient_business_name', 'registered_agent_name',
  'court_name', 'attorney_name',
]);
// Tri-state yes/no/'' fields — see normalizeYesNo.
const YES_NO_FIELDS = new Set<TargetField>([
  'witness_fee_tendered', 'sub_service_authorized_first_attempt',
]);

// Apply the deterministic normalizers across a merged field map. Returns
// a NEW map (doesn't mutate the input) with confidence preserved. A date
// field that fails to parse is blanked (confidence→0) rather than left as
// free text, so a garbage DOB never lands in persons.dob.
export function normalizeFields(
  fields: Record<string, ExtractedField>,
): Record<string, ExtractedField> {
  const out: Record<string, ExtractedField> = {};
  for (const [k, v] of Object.entries(fields)) {
    const key = k as TargetField;
    let value = (v?.value || '').trim();
    let conf = v?.confidence ?? 0;
    // Final placeholder guard before the DB — scrub "[not provided]", "None",
    // "—", etc. even if they slipped past the model-output pass. Idempotent.
    if (PLACEHOLDER_VALUE.test(value)) { value = ''; conf = 0; }
    let next = value;
    if (value) {
      if (PHONE_FIELDS.has(key)) next = normalizePhone(value);
      else if (STATE_FIELDS.has(key)) next = normalizeState(value);
      else if (ZIP_FIELDS.has(key)) next = normalizeZip(value);
      else if (DATE_FIELDS.has(key)) {
        // DOB gets the birth-aware parse (2-digit future year → previous
        // century); other dates (filing/deadline/hearing) take the plain ISO.
        const iso = key === 'recipient_dob' ? normalizeBirthDate(value) : toIsoDate(value);
        if (iso) next = iso;
        else { next = ''; conf = 0; }   // unparseable date → drop, don't guess
      }
      else if (ADDRESS_CLASS_FIELDS.has(key)) next = normalizeAddressClass(value);
      else if (YES_NO_FIELDS.has(key)) next = normalizeYesNo(value);
      else if (NAME_FIELDS.has(key)) {
        next = scrubPartyNoise(value);
        if (!next) conf = 0;            // scrubbed to nothing → it was all noise
      }
    }
    out[k] = { value: next, confidence: conf };
  }
  return out;
}

export interface QueueRow {
  recipient_name: string | null;
  recipient_address: string | null;
  recipient_city: string | null;
  recipient_state: string | null;
  recipient_zip: string | null;
  document_type: string | null;
  case_number: string | null;
  court_name: string | null;
  jurisdiction: string | null;
  client_name: string | null;
  attorney_name: string | null;
  priority: ServePriority;
  deadline: string | null;
  service_instructions: string | null;
  notes: string | null;
  // Case parties + hearing date. These were extracted but previously dropped on
  // commit; serve_queue has dedicated columns (plaintiff_name / defendant_name /
  // court_date) the client PDF + court-records views already read.
  plaintiff: string | null;
  defendant: string | null;
  court_date: string | null;
  // Attorney/client job reference extracted from the document header (e.g. "Job: 16623863").
  // Stored in sm_job_id when the intake is not sourced from ServeManager directly.
  sm_job_id: string | null;
  // Process Server / Dispatch columns that used to live only in parsed_data.
  recipient_phone: string | null;
  recipient_dob: string | null;
  recipient_type: 'individual' | 'business' | null;
  business_name: string | null;
  registered_agent_name: string | null;
  registered_office_address: string | null;
  attorney_phone: string | null;
  attorney_email: string | null;
  attorney_bar_number: string | null;
  serve_type: 'personal' | 'substituted' | 'corporate' | 'posting' | 'publication' | null;
  serve_fee: number | null;
  time_window: 'morning' | 'afternoon' | 'evening' | 'anytime' | null;
}

/** Intake OCR uses person|business; serve_queue.recipient_type is individual|business. */
export function mapRecipientType(raw: string | null | undefined): 'individual' | 'business' | null {
  const s = (raw || '').trim().toLowerCase();
  if (s === 'business' || s === 'corporate' || s === 'entity' || s === 'company') return 'business';
  if (s === 'person' || s === 'individual' || s === 'person_individual') return 'individual';
  return null;
}

/** Map intake process_type onto serve_queue.serve_type. */
export function mapIntakeServeType(
  processType: string | null | undefined,
  isBusiness: boolean,
): QueueRow['serve_type'] {
  const s = (processType || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (s === 'substitute' || s === 'substituted' || s === 'sub_service' || s === 'substitute_service') {
    return 'substituted';
  }
  if (s === 'posted' || s === 'posting' || s === 'post' || s === 'nail_and_mail') return 'posting';
  if (s === 'mail' || s === 'publication' || s === 'certified_mail') return 'publication';
  if (s === 'corporate' || (isBusiness && (s === 'personal' || s === ''))) return 'corporate';
  if (s) return 'personal';
  return isBusiness ? 'corporate' : 'personal';
}

/** Parse "$54.23" / "54.23" / "1,200.00" into a number; null if unparseable. */
export function parseFeeAmount(raw: string | null | undefined): number | null {
  const s = (raw || '').trim();
  if (!s) return null;
  const m = s.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

export type PsoWindowsJson = {
  early_morning: boolean;
  daytime: boolean;
  evening: boolean;
  weekend: boolean;
};

/**
 * Dispatch checkboxes expect JSON `{early_morning,daytime,evening,weekend}`.
 * Intake stores free text ("Anytime", "evenings and weekends").
 */
export function encodePsoServiceWindows(raw: string | null | undefined): string | null {
  const s = (raw || '').trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  const all = /\b(anytime|any time|24\/7|all hours|all day)\b/.test(lower);
  const w: PsoWindowsJson = {
    early_morning: all || /\b(early|mornings?|6\s*a|before\s*9)\b/.test(lower),
    daytime: all || /\b(daytime|afternoons?|business hours|9\s*a|weekdays?)\b/.test(lower),
    evening: all || /\b(evenings?|nights?|after\s*6|after\s*5)\b/.test(lower),
    weekend: all || /\b(weekends?|saturdays?|sundays?|\bsat\b|\bsun\b)\b/.test(lower),
  };
  if (!w.early_morning && !w.daytime && !w.evening && !w.weekend) {
    // Unrecognized free text still means "serve when you can" — treat as anytime
    // so Dispatch's compliance checklist is not all-false (which hides entirely).
    w.early_morning = w.daytime = w.evening = w.weekend = true;
  }
  return JSON.stringify(w);
}

export function mapTimeWindow(raw: string | null | undefined): QueueRow['time_window'] {
  const s = (raw || '').trim().toLowerCase();
  if (!s) return null;
  if (/\b(anytime|any time|24\/7)\b/.test(s)) return 'anytime';
  if (/\b(evenings?|nights?)\b/.test(s)) return 'evening';
  if (/\b(mornings?|early)\b/.test(s)) return 'morning';
  if (/\b(afternoons?|daytime|day)\b/.test(s)) return 'afternoon';
  return 'anytime';
}

export function fieldsToQueueRow(fields: Record<string, ExtractedField>): QueueRow {
  const get = (k: TargetField) => (fields[k]?.value || '').trim() || null;
  const isBusiness = (get('recipient_type') || '').toLowerCase() === 'business';
  const businessName = get('recipient_business_name');
  const personName = [get('recipient_first_name'), get('recipient_middle_name'), get('recipient_last_name')]
    .filter(Boolean).join(' ').trim() || null;
  // For corporate recipients the queue's "recipient_name" is the company
  // (so the queue list reads naturally — "STEEL ENCOUNTERS, INC." not
  // "Joan Lind"). The actual person we serve (the registered agent) lives
  // on the linked persons row via recipient_person_id.
  const recipient_name = isBusiness
    ? (businessName || personName)
    : (personName || businessName);

  const processType = get('process_type');
  const windows = get('service_windows');

  return {
    recipient_name,
    recipient_address: get('recipient_address'),
    recipient_city: get('recipient_city'),
    recipient_state: get('recipient_state'),
    recipient_zip: get('recipient_zip'),
    document_type: get('document_type') || get('document_subtype'),
    case_number: get('case_number'),
    court_name: get('court_name'),
    jurisdiction: get('jurisdiction'),
    client_name: get('client_name'),
    attorney_name: get('attorney_name'),
    priority: normalizePriority(get('priority') || ''),
    // Only store a real calendar date — a relative phrase like "21 days"
    // would silently break the overdue check (see normalizeDeadline).
    deadline: normalizeDeadline(get('service_deadline') || ''),
    service_instructions: get('service_instructions'),
    notes: windows,
    plaintiff: get('plaintiff'),
    defendant: get('defendant'),
    // hearing date → court_date; only a real calendar date (same guard as deadline).
    court_date: normalizeDeadline(get('hearing_date') || ''),
    // Attorney/client job reference number from the document header.
    sm_job_id: get('job_number'),
    recipient_phone: get('recipient_phone'),
    recipient_dob: get('recipient_dob'),
    recipient_type: mapRecipientType(get('recipient_type'))
      || (isBusiness ? 'business' : (personName ? 'individual' : null)),
    business_name: isBusiness ? (businessName || null) : get('recipient_business_name'),
    registered_agent_name: get('registered_agent_name'),
    registered_office_address: get('registered_agent_address'),
    attorney_phone: get('attorney_phone'),
    attorney_email: get('attorney_email'),
    attorney_bar_number: get('attorney_bar_number'),
    serve_type: mapIntakeServeType(processType, isBusiness),
    serve_fee: parseFeeAmount(get('fee_amount')),
    time_window: mapTimeWindow(windows),
  };
}
