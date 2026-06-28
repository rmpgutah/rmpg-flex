// ============================================================
// documentIntakeSaveHandlers — map an extracted field bag to the
// shape each /api/<destination> POST endpoint expects
// ============================================================
// Pure mapping logic — no fetch, no React. Tested directly so the
// review UI's "Save to Records" button has predictable payload
// shapes.
//
// Each handler takes the user-edited field bag (key→value strings,
// post-review) and returns the JSON the server endpoint accepts.
// Field kinds that don't have a direct save target are not listed
// here — those use the "Download JSON" fallback in the UI.

export interface SaveResult<P = unknown> {
  /** The /api path the UI will POST to (no /api prefix). */
  endpoint: string;
  /** JSON body for the POST. */
  payload: P;
  /** Human label for the success toast. */
  label: string;
}

/**
 * Split a "LAST, FIRST" or "FIRST LAST" name string into parts.
 * OCR most often captures the comma form on official forms; the
 * fallback handles informal layouts.
 */
export function splitPersonName(raw: string): { first: string; last: string } {
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  if (!cleaned) return { first: '', last: '' };
  if (cleaned.includes(',')) {
    const [last, ...rest] = cleaned.split(',');
    return { first: rest.join(',').trim(), last: last.trim() };
  }
  // FIRST LAST → take last token as last name, the rest as first.
  const tokens = cleaned.split(' ');
  if (tokens.length === 1) return { first: '', last: tokens[0] };
  return { first: tokens.slice(0, -1).join(' '), last: tokens[tokens.length - 1] };
}

/**
 * Parse a money string ("$5,000.00" / "5000" / "5,000") into a
 * float; returns null on anything unparseable so we never write
 * NaN to the bail_amount column.
 */
export function parseMoney(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[$,\s]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Convert a "M/D/YYYY" or "MM/DD/YYYY" date string into ISO
 * "YYYY-MM-DD" format — what the server's date columns store.
 * Returns the raw string unchanged if it doesn't match (the
 * server will reject malformed values, which is what we want
 * rather than silently coercing wrong dates).
 */
export function normalizeDate(raw: string): string {
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return raw;
  let [, mo, d, y] = m;
  if (y.length === 2) y = `20${y}`;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

type FieldBag = Record<string, string>;
const get = (bag: FieldBag, key: string): string => (bag[key] ?? '').trim();

// ── court_warrant → POST /api/warrants ──────────────────────
export function buildWarrantPayload(bag: FieldBag): SaveResult {
  const charges = get(bag, 'charges');
  const warrantTypeRaw = get(bag, 'warrant_type').toUpperCase();
  // The server's warrants.type CHECK constraint accepts a known set;
  // map the OCR-captured label to it. Unknown→'arrest' (most common
  // default for warrant intake).
  const type =
    /BENCH/.test(warrantTypeRaw) ? 'bench'
    : /FTA|FAILURE/.test(warrantTypeRaw) ? 'fta'
    : /SEARCH/.test(warrantTypeRaw) ? 'search'
    : 'arrest';

  // Build a notes block for fields that don't map 1:1 to the
  // warrants table columns. Preserves the OCR'd context so a
  // reviewer can verify against the source PDF later.
  const notesLines: string[] = [];
  const defendantName = get(bag, 'defendant_name');
  const defendantDob = get(bag, 'defendant_dob');
  const docket = get(bag, 'docket_number');
  const issuedDate = get(bag, 'issued_date');
  if (defendantName) notesLines.push(`Defendant: ${defendantName}${defendantDob ? ` (DOB ${defendantDob})` : ''}`);
  if (docket) notesLines.push(`Docket: ${docket}`);
  if (issuedDate) notesLines.push(`Issued: ${issuedDate}`);

  return {
    endpoint: '/warrants',
    label: 'Warrant',
    payload: {
      type,
      charge_description: charges || '(see notes)',
      issuing_court: get(bag, 'court_name') || undefined,
      issuing_judge: get(bag, 'issuing_judge') || undefined,
      bail_amount: parseMoney(get(bag, 'bond_amount')) ?? undefined,
      notes: notesLines.join('\n') || undefined,
    },
  };
}

// ── fi_card → POST /api/field-interviews ────────────────────
export function buildFiPayload(bag: FieldBag): SaveResult {
  const subjectName = get(bag, 'subject_name');
  const { first, last } = splitPersonName(subjectName);

  const narrativeParts: string[] = [];
  const subjectAddress = get(bag, 'subject_address');
  const phone = get(bag, 'phone');
  if (subjectAddress) narrativeParts.push(`Address: ${subjectAddress}`);
  if (phone) narrativeParts.push(`Phone: ${phone}`);

  return {
    endpoint: '/field-interviews',
    label: 'Field Interview',
    payload: {
      // /api/field-interviews requires `date` — pull from the
      // OCR contact_date or fall back to today's ISO date.
      date: normalizeDate(get(bag, 'contact_date')) || new Date().toISOString().slice(0, 10),
      location: get(bag, 'contact_location') || undefined,
      reason: get(bag, 'reason_for_contact') || 'other',
      disposition: get(bag, 'action_taken') || 'none',
      contact_type: 'field',
      subject_first_name: first || undefined,
      subject_last_name: last || undefined,
      subject_dob: normalizeDate(get(bag, 'subject_dob')) || undefined,
      vehicle_plate: get(bag, 'vehicle_plate') || undefined,
      vehicle_description: get(bag, 'vehicle_description') || undefined,
      narrative: narrativeParts.join('\n') || undefined,
    },
  };
}

// ── Supplement builders (attach to existing incident) ───────
// witness_statement and info_form/supplemental_report don't have
// their own destination tables — they're filed as supplemental
// reports against an existing incident the clerk picks. Server
// route: POST /api/incidents/:id/supplements with
// { report_type, subject, narrative }.

export interface SaveContext {
  /** Required for kinds where requiresIncident is true. */
  incidentId?: number;
  /** Optional human label for the toast (e.g. "INC-2024-0123"). */
  incidentNumber?: string;
}

export function buildWitnessStatementSupplement(bag: FieldBag, ctx: SaveContext): SaveResult {
  if (!ctx.incidentId) {
    throw new Error('witness_statement requires an incidentId');
  }
  const witness = get(bag, 'witness_name') || 'Unknown Witness';
  const dob = get(bag, 'witness_dob');
  const address = get(bag, 'witness_address');
  const phone = get(bag, 'witness_phone');
  const officer = get(bag, 'interviewing_officer');
  const statement = get(bag, 'statement_body');
  const incidentDate = get(bag, 'incident_date');
  const incidentLocation = get(bag, 'incident_location');

  // Compose a narrative that preserves the OCR'd identity block
  // ABOVE the statement body so a reviewer can audit who the
  // witness is alongside what they said.
  const lines: string[] = [];
  lines.push(`Witness: ${witness}`);
  if (dob) lines.push(`DOB: ${dob}`);
  if (address) lines.push(`Address: ${address}`);
  if (phone) lines.push(`Phone: ${phone}`);
  if (officer) lines.push(`Interviewing Officer: ${officer}`);
  if (incidentDate) lines.push(`Incident Date: ${incidentDate}`);
  if (incidentLocation) lines.push(`Incident Location: ${incidentLocation}`);
  if (statement) {
    lines.push('');
    lines.push('--- STATEMENT ---');
    lines.push(statement);
  }

  return {
    endpoint: `/incidents/${ctx.incidentId}/supplements`,
    label: `Witness Statement attached to ${ctx.incidentNumber ?? `incident #${ctx.incidentId}`}`,
    payload: {
      report_type: 'witness_statement',
      subject: `Statement of ${witness}`,
      narrative: lines.join('\n'),
    },
  };
}

export function buildInfoFormSupplement(bag: FieldBag, ctx: SaveContext): SaveResult {
  if (!ctx.incidentId) {
    throw new Error('info_form requires an incidentId');
  }
  const ref = get(bag, 'reference_number');
  const subject = get(bag, 'subject_name') || 'Unknown Subject';
  const dob = get(bag, 'subject_dob');
  const address = get(bag, 'subject_address');
  const phone = get(bag, 'subject_phone');
  const occurrenceDate = get(bag, 'occurrence_date');
  const occurrenceLocation = get(bag, 'occurrence_location');
  const reportingParty = get(bag, 'reporting_party');
  const reportingOfficer = get(bag, 'reporting_officer');
  const narrative = get(bag, 'narrative');

  const lines: string[] = [];
  if (ref) lines.push(`Reference #: ${ref}`);
  lines.push(`Subject: ${subject}`);
  if (dob) lines.push(`Subject DOB: ${dob}`);
  if (address) lines.push(`Subject Address: ${address}`);
  if (phone) lines.push(`Subject Phone: ${phone}`);
  if (occurrenceDate) lines.push(`Occurrence Date: ${occurrenceDate}`);
  if (occurrenceLocation) lines.push(`Occurrence Location: ${occurrenceLocation}`);
  if (reportingParty) lines.push(`Reporting Party: ${reportingParty}`);
  if (reportingOfficer) lines.push(`Reporting Officer: ${reportingOfficer}`);
  if (narrative) {
    lines.push('');
    lines.push('--- NARRATIVE ---');
    lines.push(narrative);
  }

  return {
    endpoint: `/incidents/${ctx.incidentId}/supplements`,
    label: `Information Report attached to ${ctx.incidentNumber ?? `incident #${ctx.incidentId}`}`,
    payload: {
      report_type: 'supplemental',
      subject: ref ? `Info Report ${ref}` : `Info Report — ${subject}`,
      narrative: lines.join('\n'),
    },
  };
}

// ── Registry ────────────────────────────────────────────────
// Kinds NOT in this map use the JSON download fallback in the UI.
// `requiresIncident` flag tells the reviewer to render the
// IncidentPicker as a save-prerequisite for that kind.
type Builder = (bag: FieldBag, ctx: SaveContext) => SaveResult;
interface Registration {
  build: Builder;
  requiresIncident: boolean;
}

const REGISTRY: Partial<Record<string, Registration>> = {
  court_warrant: { build: (bag) => buildWarrantPayload(bag), requiresIncident: false },
  fi_card: { build: (bag) => buildFiPayload(bag), requiresIncident: false },
  witness_statement: { build: buildWitnessStatementSupplement, requiresIncident: true },
  info_form: { build: buildInfoFormSupplement, requiresIncident: true },
  supplemental_report: { build: buildInfoFormSupplement, requiresIncident: true },
};

export function getSaveBuilder(kind: string): Builder | null {
  return REGISTRY[kind]?.build ?? null;
}

export function hasSaveHandler(kind: string): boolean {
  return kind in REGISTRY;
}

export function requiresIncident(kind: string): boolean {
  return REGISTRY[kind]?.requiresIncident ?? false;
}
