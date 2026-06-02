// ============================================================
// RMPG Flex — Built-in Call Disposition Codes (client source of truth)
// ------------------------------------------------------------
// SHORT-CODED dispositions. Each entry carries a terse CODE (the value
// stored on the call + shown on every dispatch/CFS surface) and a
// detailed DESCRIPTION (shown ONLY in the selection dropdown to help the
// dispatcher pick the right code). Output surfaces render the code alone.
//
//   • General/patrol dispositions → short mnemonic code (RTF, GOA, ARR…).
//   • Process-service CFS          → "PS/###" codes in increments of 5,
//                                     each describing a service result.
//                                     Anchored on the live-configured
//                                     PS/055 = Personal/Individual.
//
// The LIVE worker's /admin/config does NOT yet return a `dispositions`
// array, so these hardcoded defaults are what render in production; any
// API/DB custom codes are merged ON TOP at the call sites. This chart is
// also seeded into system_config (disposition_code rows) so it is
// server-backed + manageable. Keep the two in sync.
// ============================================================

export interface DispositionDef {
  /** Terse code — the stored + displayed value (e.g. "RTF", "PS/055"). */
  code: string;
  /** Detailed description — shown in the selection dropdown only. */
  description: string;
  /** Badge color (hex). Semantic: green=resolved/served, gray=neutral,
   *  amber=enforcement/warning, red=negative/failed. Mirrors the
   *  {code,description,color} shape of the live system_config rows. */
  color: string;
}

export interface DispositionGroup {
  label: string;
  /** Set when this group is process-service specific (used to hoist it
   *  to the top of the dropdown for PSO / process_service calls). */
  processService?: boolean;
  codes: DispositionDef[];
}

// Semantic color tokens (kept on-theme: green/gray/amber/red, zero blue).
const C_OK = '#44ff00';     // resolved / served / positive outcome
const C_NEUTRAL = '#888888'; // informational / no-action
const C_ENF = '#d4a017';    // enforcement / warning (brand gold)
const C_NEG = '#ef4444';    // negative / failed / unable

export const DISPOSITION_GROUPS: DispositionGroup[] = [
  {
    label: 'Common Dispositions',
    codes: [
      { code: 'RTF', description: 'Report Taken / Filed',          color: C_OK },
      { code: 'RES', description: 'Resolved on Scene',             color: C_OK },
      { code: 'ARR', description: 'Arrest Made',                   color: C_ENF },
      { code: 'CIT', description: 'Citation Issued',               color: C_ENF },
      { code: 'WRN', description: 'Warning Issued',                color: C_ENF },
      { code: 'TRW', description: 'Trespass Warning Issued',       color: C_ENF },
      { code: 'TRN', description: 'Subject Transported',           color: C_OK },
      { code: 'REF', description: 'Referred to Other Agency',      color: C_NEUTRAL },
      { code: 'CIV', description: 'Civil Matter — No Action',      color: C_NEUTRAL },
      { code: 'NOA', description: 'No Action Required',            color: C_NEUTRAL },
      { code: 'GOA', description: 'Gone on Arrival',               color: C_NEG },
      { code: 'UNF', description: 'Unfounded',                     color: C_NEG },
      { code: 'FAL', description: 'False Alarm',                   color: C_NEG },
      { code: 'CNC', description: 'Call Cancelled',                color: C_NEG },
    ],
  },
  {
    label: 'Field Operations',
    codes: [
      { code: 'UTL', description: 'Unable to Locate',              color: C_NEG },
      { code: 'AST', description: 'Assist Rendered',               color: C_OK },
      { code: 'NCT', description: 'Negative Contact',              color: C_NEUTRAL },
      { code: 'PAT', description: 'Patrol Completed',              color: C_OK },
    ],
  },
  {
    label: 'Security',
    codes: [
      { code: 'SEC', description: 'Premise Secured',              color: C_OK },
      { code: 'KEY', description: 'Owner / Keyholder Notified',   color: C_NEUTRAL },
      { code: 'TOW', description: 'Vehicle Towed',                color: C_ENF },
      { code: 'STB', description: 'Standby Complete',             color: C_OK },
    ],
  },
  {
    label: 'Minor Enforcement',
    codes: [
      { code: 'VWN', description: 'Verbal Warning Issued',        color: C_ENF },
      { code: 'FIN', description: 'Field Interview (FI) Conducted', color: C_NEUTRAL },
      { code: 'CNS', description: 'Subject Counseled',            color: C_NEUTRAL },
      { code: 'DOC', description: 'Documentation Only',           color: C_NEUTRAL },
    ],
  },
  {
    // Process-service results. "PS/###" in increments of 5, anchored on the
    // live-configured PS/055 = Personal/Individual. Each code describes the
    // result of a service attempt.
    label: 'Process Service',
    processService: true,
    codes: [
      { code: 'PS/055', description: 'Personal/Individual — served on the named party',  color: C_OK },
      { code: 'PS/060', description: 'Substitute — competent member of household',       color: C_OK },
      { code: 'PS/065', description: 'Posted & Mailed',                                   color: C_OK },
      { code: 'PS/070', description: 'Corporate / Registered Agent',                      color: C_OK },
      { code: 'PS/075', description: 'Service by Mail',                                   color: C_OK },
      { code: 'PS/080', description: 'Non-Service — unable to serve (attempt logged)',    color: C_NEG },
      { code: 'PS/085', description: 'Evasive / Avoiding Service',                        color: C_NEG },
      { code: 'PS/090', description: 'Vacant / Unoccupied at address',                    color: C_NEG },
      { code: 'PS/095', description: 'Gated / No Access',                                 color: C_NEG },
      { code: 'PS/100', description: 'Recipient Unknown at Address',                      color: C_NEG },
      { code: 'PS/105', description: 'Out of Jurisdiction',                               color: C_NEUTRAL },
      { code: 'PS/110', description: 'Recalled by Client',                                color: C_NEUTRAL },
      { code: 'PS/115', description: 'Returned Non-Est (Return of Service Filed)',        color: C_NEUTRAL },
    ],
  },
];

/** Flat list of every built-in disposition (group order preserved). */
export const DEFAULT_DISPOSITIONS: DispositionDef[] =
  DISPOSITION_GROUPS.flatMap((g) => g.codes);

/** Set of built-in codes — used to de-dupe API custom codes against defaults. */
export const DEFAULT_DISPOSITION_CODES: Set<string> =
  new Set(DEFAULT_DISPOSITIONS.map((d) => d.code));

/** code → description lookup (for tooltips / humanizing a stored code). */
export const DISPOSITION_DESCRIPTION_BY_CODE: Record<string, string> =
  Object.fromEntries(DEFAULT_DISPOSITIONS.map((d) => [d.code, d.description]));

/** code → color lookup (for the output badge). */
export const DISPOSITION_COLOR_BY_CODE: Record<string, string> =
  Object.fromEntries(DEFAULT_DISPOSITIONS.map((d) => [d.code, d.color]));

const PROCESS_SERVICE_INCIDENT_TYPES = new Set(['pso_client_request', 'process_service', 'civil_paper_service']);

/** True when an incident type is a process-service CFS (PS/### codes apply). */
export function isProcessServiceIncident(incidentType?: string | null): boolean {
  return !!incidentType && PROCESS_SERVICE_INCIDENT_TYPES.has(incidentType);
}

/**
 * Returns the disposition groups in display order. For process-service
 * calls the Process Service group is hoisted to the top so its codes are
 * immediately reachable; otherwise the natural order is preserved.
 */
export function dispositionGroupsForIncident(incidentType?: string | null): DispositionGroup[] {
  if (isProcessServiceIncident(incidentType)) {
    const ps = DISPOSITION_GROUPS.filter((g) => g.processService);
    const rest = DISPOSITION_GROUPS.filter((g) => !g.processService);
    return [...ps, ...rest];
  }
  return DISPOSITION_GROUPS;
}
