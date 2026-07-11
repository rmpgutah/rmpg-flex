// ============================================================
// RMPG Flex — Built-in Call Disposition Codes (client source of truth)
// ------------------------------------------------------------
// SHORT-CODED dispositions. Each entry carries a terse CODE (the value
// stored on the call + shown on every dispatch/CFS surface) and a
// detailed DESCRIPTION (shown ONLY in the selection dropdown to help the
// dispatcher pick the right code). Output surfaces render the code alone.
//
//   • General/patrol dispositions → short mnemonic code (RTF, GOA, ARR…).
//   • Process-service CFS → PSO_DISPOSITION_GROUPS (10 categories, 53 codes
//     from processServiceCodes.ts — PS/00.01 … PS/45.04).
//
// The LIVE worker's /admin/config does NOT yet return a `dispositions`
// array, so these hardcoded defaults are what render in production; any
// API/DB custom codes are merged ON TOP at the call sites. This chart is
// also seeded into system_config (disposition_code rows) so it is
// server-backed + manageable. Keep the two in sync.
// ============================================================

import { PSO_CATEGORIES, codesInCategory } from './processServiceCodes';

export interface DispositionDef {
  /** Terse code — the stored + displayed value (e.g. "RTF", "PS/05.01"). */
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
  /** Set when this group is process-service specific. For PSO /
   *  process_service calls dispositionGroupsForIncident() returns ONLY
   *  groups flagged processService:true (not a mix of general + PS). */
  processService?: boolean;
  codes: DispositionDef[];
}

// Semantic color tokens (kept on-theme: green/gray/amber/red, zero blue).
const C_OK = '#44ff00';     // resolved / served / positive outcome
const C_NEUTRAL = '#888888'; // informational / no-action
const C_ENF = '#d4a017';    // enforcement / warning (brand gold)
const C_NEG = '#ef4444';    // negative / failed / unable

// PSO category tone → DispositionDef color
const TONE_TO_COLOR: Record<string, string> = {
  success: C_OK,
  attempt: C_ENF,
  danger:  C_NEG,
  admin:   C_NEUTRAL,
  pending: C_NEUTRAL,
};

// ── General dispatch groups (non-PSO calls) ──────────────────────────
// Process Service codes are intentionally absent — PSO calls get the
// richer PSO_DISPOSITION_GROUPS from processServiceCodes.ts instead.
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
];

// ── PSO-specific groups (10 categories × N sub-codes) ──────────────
// Generated at module init from processServiceCodes.ts — 53 structured
// codes in 10 categories. Displayed ONLY for pso_client_request /
// process_service / civil_paper_service calls.
export const PSO_DISPOSITION_GROUPS: DispositionGroup[] = PSO_CATEGORIES.map((cat) => ({
  label: `${cat.code} — ${cat.label}`,
  processService: true,
  codes: codesInCategory(cat.code).map((c) => ({
    code: c.code,
    description: c.hint ? `${c.label} — ${c.hint}` : c.label,
    color: TONE_TO_COLOR[cat.tone] ?? C_NEUTRAL,
  })),
}));

// ── Backward-compat legacy PS/0## codes ──────────────────────────────
// These were the original 13 Process Service codes (PS/055 … PS/115).
// Not offered in any dropdown, but kept in the lookup maps so CFS records
// that stored these codes before the v1249 upgrade still resolve to a
// description and color.
const LEGACY_PS_DEFS: DispositionDef[] = [
  { code: 'PS/055', description: 'Personal/Individual — served on the named party', color: C_OK },
  { code: 'PS/060', description: 'Substitute — competent member of household',      color: C_OK },
  { code: 'PS/065', description: 'Posted & Mailed',                                  color: C_OK },
  { code: 'PS/070', description: 'Corporate / Registered Agent',                     color: C_OK },
  { code: 'PS/075', description: 'Service by Mail',                                  color: C_OK },
  { code: 'PS/080', description: 'Non-Service — unable to serve (attempt logged)',   color: C_NEG },
  { code: 'PS/085', description: 'Evasive / Avoiding Service',                       color: C_NEG },
  { code: 'PS/090', description: 'Vacant / Unoccupied at address',                  color: C_NEG },
  { code: 'PS/095', description: 'Gated / No Access',                               color: C_NEG },
  { code: 'PS/100', description: 'Recipient Unknown at Address',                    color: C_NEG },
  { code: 'PS/105', description: 'Out of Jurisdiction',                              color: C_NEUTRAL },
  { code: 'PS/110', description: 'Recalled by Client',                               color: C_NEUTRAL },
  { code: 'PS/115', description: 'Returned Non-Est (Return of Service Filed)',       color: C_NEUTRAL },
];

/** Flat list of every general (non-PSO) built-in disposition. Used by
 *  DispositionPrompt as a loading-state fallback for non-PSO calls. */
export const DEFAULT_DISPOSITIONS: DispositionDef[] =
  DISPOSITION_GROUPS.flatMap((g) => g.codes);

// All codes for lookup purposes: general + PSO + legacy PS/0## backward-compat.
const _ALL_BUILT_IN: DispositionDef[] = [
  ...DEFAULT_DISPOSITIONS,
  ...PSO_DISPOSITION_GROUPS.flatMap((g) => g.codes),
  ...LEGACY_PS_DEFS,
];

/** Set of ALL built-in codes — used to de-dupe admin-custom codes. Covers
 *  general dispositions, the 53-code PSO library, and legacy PS/0## codes
 *  that may be stored on pre-v1249 CFS records. */
export const DEFAULT_DISPOSITION_CODES: Set<string> =
  new Set(_ALL_BUILT_IN.map((d) => d.code));

/** Dropdown-friendly human-readable disposition labels (used by edit modals). */
export const DISPOSITION_OPTIONS = [
  'Report Taken', 'Arrest Made', 'Citation Issued',
  'Warning Issued', 'Referred to Other Agency',
  'Unfounded', 'No Police Action Required',
  'Gone on Arrival', 'Cancelled by RP',
  'Cancelled by Dispatch', 'Cancelled by Officer',
  'Civil Matter', 'Mental Health Hold',
  'Trespass Warning', 'Mediated', 'Other',
] as const;

/** code → description lookup (for tooltips / humanizing a stored code).
 *  Covers all built-in codes including PSO and legacy PS/0## values. */
export const DISPOSITION_DESCRIPTION_BY_CODE: Record<string, string> =
  Object.fromEntries(_ALL_BUILT_IN.map((d) => [d.code, d.description]));

/** code → color lookup (for the output badge).
 *  Covers all built-in codes including PSO and legacy PS/0## values. */
export const DISPOSITION_COLOR_BY_CODE: Record<string, string> =
  Object.fromEntries(_ALL_BUILT_IN.map((d) => [d.code, d.color]));

// Exported as the single source of truth for "is this a PSO/process-service
// call" — this set drifted into several parallel local copies (DispatchPage.tsx,
// CallCard.tsx, NewCallModal.tsx) that each independently fell back to checking
// only 'pso_client_request', silently dropping process_service/civil_paper_service
// calls from PSO-specific UI. Import this instead of redeclaring it.
export const PROCESS_SERVICE_INCIDENT_TYPES = new Set(['pso_client_request', 'process_service', 'civil_paper_service']);

/** True when an incident type is a process-service CFS (PS codes apply). */
export function isProcessServiceIncident(incidentType?: string | null): boolean {
  return !!incidentType && PROCESS_SERVICE_INCIDENT_TYPES.has(incidentType);
}

/**
 * Returns the disposition groups for a given incident type.
 *
 * • pso_client_request / process_service / civil_paper_service →
 *   PSO_DISPOSITION_GROUPS only (53 codes across 10 categories). General
 *   police dispositions (RTF, ARR, etc.) are suppressed — they don't apply
 *   to a process-server job.
 *
 * • All other incident types → DISPOSITION_GROUPS (general codes only,
 *   no PS codes).
 */
export function dispositionGroupsForIncident(incidentType?: string | null): DispositionGroup[] {
  if (isProcessServiceIncident(incidentType)) {
    return PSO_DISPOSITION_GROUPS;
  }
  return DISPOSITION_GROUPS;
}
