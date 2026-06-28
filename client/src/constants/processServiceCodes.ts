// ============================================================
// RMPG Flex — Process Service Disposition Codes
//
// Canonical code library for the Notice of Attempt to Serve and
// the CFS→Process-Server cross-link. Codes follow a 5-increment
// hierarchy so new categories and sub-codes can be inserted later
// without renumbering existing values:
//
//   PS/00 — Non-Service                 (umbrella for unsuccessful attempts)
//   PS/05 — Personal Service            (handed directly to named recipient)
//   PS/10 — Substitute Service          (left with competent adult at usual abode)
//   PS/15 — Evasion of Service          (recipient actively avoiding)
//   PS/20 — Posting / Conspicuous       (Utah Rule 4(d))
//   PS/25 — Service by Mail
//   PS/30 — Service by Publication
//   PS/35 — Alternative / Court-Ordered
//   PS/40 — Administrative Outcomes
//   PS/45 — Pending / Scheduled
//
// Each category has sub-codes in increments of five (`.01`, `.05`,
// `.10` ...) so individual codes can be added without disturbing
// downstream codes either. The library is the single source of
// truth — the wizard picker, the disposition-to-result mapper,
// and the PDF renderer all import from here. Source of truth is
// this client copy; mirror any addition in
// `src/utils/processServiceCodes.ts` (worker copy — synced from here).
// ============================================================

/** Legacy `serve_attempts.result` CHECK enum — kept for back-compat. */
export type LegacyResult =
  | 'served'
  | 'sub_served'
  | 'posted'
  | 'no_answer'
  | 'refused'
  | 'bad_address'
  | 'moved'
  | 'deceased'
  | 'other';

/** Mapped queue status after a disposition is logged. */
export type QueueStatus = 'served' | 'attempted' | 'failed' | 'pending';

export interface PsoCode {
  /** Full code, e.g. "PS/15.05". Stored verbatim in disposition_code. */
  code: string;
  /** Human label, e.g. "Evasive — Departed Upon Sight of Server". */
  label: string;
  /** Short label for compact UI (table cells, chips). */
  short: string;
  /** Category code, e.g. "PS/15". Used to group in the picker. */
  category: string;
  /** Legacy serve_attempts.result for storage-back-compat. */
  result: LegacyResult;
  /** Whether the underlying serve_queue should transition (and to what). */
  queueOutcome: QueueStatus;
  /** Brief operator hint shown next to the code in the picker. */
  hint?: string;
}

export interface PsoCategory {
  /** Category code, e.g. "PS/15". */
  code: string;
  /** Display name, e.g. "Evasion of Service". */
  label: string;
  /** One-line description for the picker. */
  description: string;
  /** Whether this category represents a completed service (vs. an attempt). */
  isService: boolean;
  /** Visual hint for the UI — "danger" for evasion, "success" for completions. */
  tone: 'success' | 'attempt' | 'danger' | 'admin' | 'pending';
}

export const PSO_CATEGORIES: PsoCategory[] = [
  { code: 'PS/00', label: 'Non-Service',           description: 'Attempt made but service not completed',                       isService: false, tone: 'attempt'  },
  { code: 'PS/05', label: 'Personal Service',      description: 'Documents handed directly to the named recipient',             isService: true,  tone: 'success'  },
  { code: 'PS/10', label: 'Substitute Service',    description: 'Left with a competent adult at the recipient\'s usual abode',  isService: true,  tone: 'success'  },
  { code: 'PS/15', label: 'Evasion of Service',    description: 'Recipient is actively avoiding service',                        isService: false, tone: 'danger'   },
  { code: 'PS/20', label: 'Posting / Conspicuous', description: 'Affixed to the premises pursuant to Utah Rule 4(d)',            isService: true,  tone: 'success'  },
  { code: 'PS/25', label: 'Service by Mail',       description: 'Certified or restricted-delivery mail service',                 isService: true,  tone: 'success'  },
  { code: 'PS/30', label: 'Service by Publication',description: 'Court-ordered publication after other methods exhausted',       isService: true,  tone: 'success'  },
  { code: 'PS/35', label: 'Alternative / Ordered', description: 'Court-ordered alternative means of service',                    isService: true,  tone: 'success'  },
  { code: 'PS/40', label: 'Administrative',        description: 'Cancellation, recall, return-unserved, or other admin outcome',  isService: false, tone: 'admin'    },
  { code: 'PS/45', label: 'Pending / Scheduled',   description: 'Awaiting attempt, re-attempt, stakeout, or skip-trace result',  isService: false, tone: 'pending'  },
];

export const PSO_CODES: PsoCode[] = [
  // ─── PS/00 — Non-Service ─────────────────────────────────────────────
  { code: 'PS/00.01', category: 'PS/00', label: 'No Contact / No Answer',                      short: 'No Answer',          result: 'no_answer',   queueOutcome: 'attempted', hint: 'Knocked, no response' },
  { code: 'PS/00.05', category: 'PS/00', label: 'Premises Locked / Gated / Inaccessible',      short: 'Inaccessible',       result: 'no_answer',   queueOutcome: 'attempted', hint: 'Gate, guard, or locked lobby blocked entry' },
  { code: 'PS/00.10', category: 'PS/00', label: 'Bad Address / Address Does Not Exist',        short: 'Bad Address',        result: 'bad_address', queueOutcome: 'failed',    hint: 'Address invalid; needs re-research' },
  { code: 'PS/00.15', category: 'PS/00', label: 'Recipient Moved (forwarding unknown)',        short: 'Moved',              result: 'moved',       queueOutcome: 'failed',    hint: 'Occupant confirms recipient no longer here' },
  { code: 'PS/00.20', category: 'PS/00', label: 'Recipient Deceased',                          short: 'Deceased',           result: 'deceased',    queueOutcome: 'failed',    hint: 'Attach obit / death cert reference in notes' },
  { code: 'PS/00.25', category: 'PS/00', label: 'Refused — Recipient Verbally Declined',       short: 'Refused',            result: 'refused',     queueOutcome: 'attempted', hint: 'Service still effective in Utah; document refusal' },
  { code: 'PS/00.30', category: 'PS/00', label: 'Dangerous Conditions — Server Withdrew',      short: 'Unsafe',             result: 'other',       queueOutcome: 'attempted', hint: 'Animals, threats, or hazardous premises' },
  { code: 'PS/00.99', category: 'PS/00', label: 'Other Non-Service (see notes)',               short: 'Other',              result: 'other',       queueOutcome: 'attempted', hint: 'Free-text explanation required' },

  // ─── PS/05 — Personal Service ────────────────────────────────────────
  { code: 'PS/05.01', category: 'PS/05', label: 'Personal Service — In Hand',                  short: 'Personal',           result: 'served',      queueOutcome: 'served',    hint: 'Handed directly to the named recipient' },
  { code: 'PS/05.05', category: 'PS/05', label: 'Personal Service — Identified by Photo',      short: 'Personal (Photo ID)',result: 'served',      queueOutcome: 'served',    hint: 'Identification confirmed via photo' },
  { code: 'PS/05.10', category: 'PS/05', label: 'Personal Service — Identified by Statement',  short: 'Personal (Stmt)',    result: 'served',      queueOutcome: 'served',    hint: 'Recipient verbally confirmed identity' },
  { code: 'PS/05.15', category: 'PS/05', label: 'Personal Service — At Place of Employment',   short: 'Personal (Work)',    result: 'served',      queueOutcome: 'served',    hint: 'Served at workplace, not residence' },

  // ─── PS/10 — Substitute Service ──────────────────────────────────────
  { code: 'PS/10.01', category: 'PS/10', label: 'Sub-Service to Co-Resident (18+)',            short: 'Sub (Resident)',     result: 'sub_served',  queueOutcome: 'served',    hint: 'Adult resident at the dwelling' },
  { code: 'PS/10.05', category: 'PS/10', label: 'Sub-Service to Spouse / Domestic Partner',    short: 'Sub (Spouse)',       result: 'sub_served',  queueOutcome: 'served',    hint: 'Spouse/partner residing in the home' },
  { code: 'PS/10.10', category: 'PS/10', label: 'Sub-Service to Family Member',                short: 'Sub (Family)',       result: 'sub_served',  queueOutcome: 'served',    hint: 'Parent, adult child, sibling at the address' },
  { code: 'PS/10.15', category: 'PS/10', label: 'Sub-Service to Person in Charge at Business', short: 'Sub (Business)',     result: 'sub_served',  queueOutcome: 'served',    hint: 'Manager / authorized employee at workplace' },
  { code: 'PS/10.20', category: 'PS/10', label: 'Sub-Service to Authorized Agent',             short: 'Sub (Agent)',        result: 'sub_served',  queueOutcome: 'served',    hint: 'Registered agent or other legal designee' },

  // ─── PS/15 — Evasion of Service ──────────────────────────────────────
  { code: 'PS/15.01', category: 'PS/15', label: 'Evasive — Refused to Open Door / Hidden',     short: 'Evasive (Hidden)',   result: 'no_answer',   queueOutcome: 'attempted', hint: 'Lights/movement inside but no response' },
  { code: 'PS/15.05', category: 'PS/15', label: 'Evasive — Concealment by Co-Resident',        short: 'Evasive (Concealed)',result: 'no_answer',   queueOutcome: 'attempted', hint: 'Roommate denies recipient is home despite presence' },
  { code: 'PS/15.10', category: 'PS/15', label: 'Evasive — Departed Upon Sight of Server',     short: 'Evasive (Departed)', result: 'no_answer',   queueOutcome: 'attempted', hint: 'Recipient saw server and left the property' },
  { code: 'PS/15.15', category: 'PS/15', label: 'Evasive — Multiple Confirmed Evasions',       short: 'Evasive (Pattern)',  result: 'no_answer',   queueOutcome: 'attempted', hint: 'Pattern of evasion across ≥3 attempts; flag for alt service' },

  // ─── PS/20 — Posting / Conspicuous Service ───────────────────────────
  { code: 'PS/20.01', category: 'PS/20', label: 'Posted on Door (after due diligence)',        short: 'Posted',             result: 'posted',      queueOutcome: 'served',    hint: 'Requires 2+ prior failed attempts (Utah Rule 4(d))' },
  { code: 'PS/20.05', category: 'PS/20', label: 'Posted + Mailed (combined posting service)',  short: 'Posted + Mailed',    result: 'posted',      queueOutcome: 'served',    hint: 'Posted to door AND mailed copy to same address' },
  { code: 'PS/20.10', category: 'PS/20', label: 'Posted at Business Premises',                 short: 'Posted (Business)',  result: 'posted',      queueOutcome: 'served',    hint: 'Affixed at the front entry of a closed business' },

  // ─── PS/25 — Service by Mail ─────────────────────────────────────────
  { code: 'PS/25.01', category: 'PS/25', label: 'Certified Mail — Return Receipt',             short: 'Cert. Mail',         result: 'served',      queueOutcome: 'served',    hint: 'Green card signed and returned' },
  { code: 'PS/25.05', category: 'PS/25', label: 'Restricted Delivery — Certified',             short: 'Restricted',         result: 'served',      queueOutcome: 'served',    hint: 'Restricted Delivery to addressee only' },
  { code: 'PS/25.10', category: 'PS/25', label: 'First-Class Mail (statutory)',                short: 'First-Class',        result: 'served',      queueOutcome: 'served',    hint: 'Statutory mail where authorized by rule' },

  // ─── PS/30 — Service by Publication ──────────────────────────────────
  { code: 'PS/30.01', category: 'PS/30', label: 'Newspaper Publication — Ordered',             short: 'Pub Ordered',        result: 'other',       queueOutcome: 'pending',   hint: 'Court ordered publication; awaiting completion' },
  { code: 'PS/30.05', category: 'PS/30', label: 'Newspaper Publication — Complete',            short: 'Pub Complete',       result: 'served',      queueOutcome: 'served',    hint: 'Proof of publication attached' },

  // ─── PS/35 — Alternative / Court-Ordered ─────────────────────────────
  { code: 'PS/35.01', category: 'PS/35', label: 'Court-Ordered Alternative Means',             short: 'Alt. Service',       result: 'served',      queueOutcome: 'served',    hint: 'Authorized by court order; cite order in notes' },
  { code: 'PS/35.05', category: 'PS/35', label: 'Email Service (court-ordered)',               short: 'Email',              result: 'served',      queueOutcome: 'served',    hint: 'Email service per court order' },
  { code: 'PS/35.10', category: 'PS/35', label: 'Social Media Service (court-ordered)',        short: 'Social Media',       result: 'served',      queueOutcome: 'served',    hint: 'Permitted only by specific court order' },

  // ─── PS/40 — Administrative Outcomes ─────────────────────────────────
  { code: 'PS/40.01', category: 'PS/40', label: 'Cancelled by Client',                          short: 'Cancelled',          result: 'other',       queueOutcome: 'failed',    hint: 'Hiring party recalled the assignment' },
  { code: 'PS/40.05', category: 'PS/40', label: 'Recalled by Court',                            short: 'Recalled',           result: 'other',       queueOutcome: 'failed',    hint: 'Court withdrew or stayed the underlying matter' },
  { code: 'PS/40.10', category: 'PS/40', label: 'Already Served (by another server)',           short: 'Already Served',     result: 'other',       queueOutcome: 'served',    hint: 'Confirmed prior service by different server/agency' },
  { code: 'PS/40.15', category: 'PS/40', label: 'Returned Unserved (paper expired)',            short: 'Expired',            result: 'other',       queueOutcome: 'failed',    hint: 'Service deadline passed before completion' },
  { code: 'PS/40.20', category: 'PS/40', label: 'Returned to Client (no further attempts)',     short: 'Returned',           result: 'other',       queueOutcome: 'failed',    hint: 'Closed administratively; documents returned' },

  // ─── PS/45 — Pending / Scheduled ─────────────────────────────────────
  { code: 'PS/45.01', category: 'PS/45', label: 'Awaiting First Attempt',                       short: 'Awaiting 1st',       result: 'other',       queueOutcome: 'pending',   hint: 'In queue, no attempts yet' },
  { code: 'PS/45.05', category: 'PS/45', label: 'Awaiting Re-Attempt',                          short: 'Re-Attempt',         result: 'other',       queueOutcome: 'pending',   hint: 'Failed attempt logged; next attempt scheduled' },
  { code: 'PS/45.10', category: 'PS/45', label: 'Scheduled Stakeout',                           short: 'Stakeout',           result: 'other',       queueOutcome: 'pending',   hint: 'Operator will wait for arrival/return' },
  { code: 'PS/45.15', category: 'PS/45', label: 'Awaiting Skip-Trace Result',                   short: 'Skip-Trace',         result: 'other',       queueOutcome: 'pending',   hint: 'Locator search in progress' },
];

const CODE_INDEX: Record<string, PsoCode> = (() => {
  const m: Record<string, PsoCode> = {};
  for (const c of PSO_CODES) m[c.code] = c;
  return m;
})();

const CATEGORY_INDEX: Record<string, PsoCategory> = (() => {
  const m: Record<string, PsoCategory> = {};
  for (const c of PSO_CATEGORIES) m[c.code] = c;
  return m;
})();

/** Resolve a PsoCode by code; null if the code is unknown. */
export function lookupPsoCode(code: string | null | undefined): PsoCode | null {
  if (!code) return null;
  return CODE_INDEX[code.trim().toUpperCase()] || null;
}

/** Resolve a PsoCategory by category code; null if unknown. */
export function lookupPsoCategory(code: string | null | undefined): PsoCategory | null {
  if (!code) return null;
  return CATEGORY_INDEX[code.trim().toUpperCase()] || null;
}

/** All codes under a single category, in spec order. */
export function codesInCategory(category: string): PsoCode[] {
  return PSO_CODES.filter((c) => c.category === category);
}

/** Map a PsoCode → legacy serve_attempts.result enum. Falls back to 'other'. */
export function codeToLegacyResult(code: string | null | undefined): LegacyResult {
  return lookupPsoCode(code)?.result ?? 'other';
}

/** Map a PsoCode → derived queue status. Used by the cross-link helper. */
export function codeToQueueStatus(code: string | null | undefined): QueueStatus {
  return lookupPsoCode(code)?.queueOutcome ?? 'attempted';
}

/**
 * Heuristic: does the input LOOK like a PS code (PS/XX or PS/XX.YY)? Lets
 * the unknown-code formatter distinguish "operator typed an invalid PS
 * code" from "result is a plain English disposition we didn't recognize".
 */
function looksLikePsCode(code: string): boolean {
  return /^PS\/\d{1,3}(\.\d{1,3})?$/i.test(code.trim());
}

/** Render the code + short label for compact UI ("PS/15.05 EVASIVE (DEPARTED)"). */
export function formatCodeShort(code: string | null | undefined): string {
  const c = lookupPsoCode(code);
  if (!c) return code ? code.toUpperCase() : 'OTHER';
  return `${c.code} ${c.short.toUpperCase()}`;
}

/**
 * Render the code + full label for a Notice of Attempt cell or summary line.
 *
 * - Known code   → "PS/15.05 — Concealment by Co-Resident"
 * - Unknown PS/  → "PS/085 — Unrecognized code (see notes)" so a recipient
 *                   sees something coherent instead of a bare malformed token
 * - Free text    → upper-case the original, no suffix (it's already prose)
 * - Empty        → "OTHER (SEE NOTES)"
 */
export function formatCodeFull(code: string | null | undefined): string {
  const c = lookupPsoCode(code);
  if (c) return `${c.code} — ${c.label}`;
  if (!code) return 'OTHER (SEE NOTES)';
  const raw = code.trim();
  return looksLikePsCode(raw)
    ? `${raw.toUpperCase()} — Unrecognized code (see notes)`
    : raw.toUpperCase();
}

/**
 * Best-effort mapping from a free-text CFS disposition (legacy values like
 * "PS Served", "PS No Access", "Cancelled") to a structured PS code. Used by
 * the cross-link helper when a closed CFS hands its disposition off to the
 * serve_queue side and needs a structured code to log.
 */
export function dispositionToCode(disposition: string | null | undefined): string | null {
  if (!disposition) return null;
  const d = disposition.trim().toLowerCase();
  // Direct match (already a structured code).
  if (lookupPsoCode(d.toUpperCase())) return d.toUpperCase();
  if (/^ps\s*served|^served\b/.test(d)) return 'PS/05.01';
  if (/sub[-\s]?served|substitute/.test(d)) return 'PS/10.01';
  if (/posted/.test(d)) return 'PS/20.01';
  if (/no\s*answer|no\s*contact|negative\s*contact/.test(d)) return 'PS/00.01';
  if (/no\s*access|premises\s*locked/.test(d)) return 'PS/00.05';
  if (/bad\s*address|address\s*does\s*not\s*exist/.test(d)) return 'PS/00.10';
  if (/moved/.test(d)) return 'PS/00.15';
  if (/deceased/.test(d)) return 'PS/00.20';
  if (/refused/.test(d)) return 'PS/00.25';
  if (/evasive|evading|evasion/.test(d)) return 'PS/15.01';
  if (/^cancelled|cancel/.test(d)) return 'PS/40.01';
  if (/recall/.test(d)) return 'PS/40.05';
  if (/already\s*served/.test(d)) return 'PS/40.10';
  if (/expired/.test(d)) return 'PS/40.15';
  if (/return/.test(d)) return 'PS/40.20';
  if (/^ps\s*attempted|^attempted\b/.test(d)) return 'PS/00.99';
  if (/^ps\s*non[-\s]?service|non[-\s]?service|^utl|unable to locate/.test(d)) return 'PS/00.99';
  return null;
}
