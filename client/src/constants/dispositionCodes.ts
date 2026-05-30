// ============================================================
// RMPG Flex — Built-in Call Disposition Codes (client source of truth)
// ------------------------------------------------------------
// The LIVE worker's /admin/config does NOT return a `dispositions`
// array (that merge + the admin UI to manage it are rewrite-only and
// not yet deployed), so these hardcoded defaults are what actually
// render in production. Both disposition surfaces consume this list:
//   • the Clear-call prompt  (components/DispositionPrompt.tsx)
//   • the Info-tab dropdown  (pages/dispatch/DispatchPage.tsx)
// Any API-provided "custom codes" are merged ON TOP at the call sites.
//
// Keep this list aligned with the server defaults in src/routes/admin.ts
// so behavior matches once the rewrite worker eventually serves config.
// ============================================================

export interface DispositionDef {
  code: string;
  description: string;
}

export interface DispositionGroup {
  label: string;
  /** Set when this group is process-service specific (used to hoist it
   *  to the top of the dropdown for PSO / process_service calls). */
  processService?: boolean;
  codes: DispositionDef[];
}

export const DISPOSITION_GROUPS: DispositionGroup[] = [
  {
    label: 'Common Dispositions',
    codes: [
      { code: 'Report Taken',     description: 'Report Taken' },
      { code: 'Unfounded',        description: 'Unfounded' },
      { code: 'GOA',              description: 'Gone on Arrival' },
      { code: 'Referred',         description: 'Referred to other agency' },
      { code: 'No Action',        description: 'No Action Required' },
      { code: 'Arrest',           description: 'Arrest Made' },
      { code: 'Warning',          description: 'Warning Issued' },
      { code: 'Citation',         description: 'Citation Issued' },
      { code: 'Trespass Warning', description: 'Trespass Warning Issued' },
      { code: 'Civil Matter',     description: 'Civil Matter — No Action' },
      { code: 'Resolved',         description: 'Resolved on Scene' },
      { code: 'Transported',      description: 'Subject Transported' },
      { code: 'False Alarm',      description: 'False Alarm' },
      { code: 'Cancelled',        description: 'Call Cancelled' },
    ],
  },
  {
    label: 'Field Operations',
    codes: [
      { code: 'UTL',              description: 'Unable to Locate' },
      { code: 'Assist Rendered',  description: 'Assist Rendered' },
      { code: 'Negative Contact', description: 'Negative Contact' },
      { code: 'Patrol Completed', description: 'Patrol Completed' },
    ],
  },
  {
    label: 'Security',
    codes: [
      { code: 'Premise Secured',  description: 'Premise Secured' },
      { code: 'Owner Notified',   description: 'Owner/Keyholder Notified' },
      { code: 'Vehicle Towed',    description: 'Vehicle Towed' },
      { code: 'Standby Complete', description: 'Standby Complete' },
    ],
  },
  {
    label: 'Minor Enforcement',
    codes: [
      { code: 'Verbal Warning',     description: 'Verbal Warning Issued' },
      { code: 'Field Interview',    description: 'Field Interview (FI) Conducted' },
      { code: 'Counseled',          description: 'Subject Counseled' },
      { code: 'Documentation Only', description: 'Documentation Only' },
    ],
  },
  {
    label: 'Process Service',
    processService: true,
    codes: [
      { code: 'PS Served',            description: 'Process Served — Personal' },
      { code: 'PS Sub-Served',        description: 'Process Served — Substitute' },
      { code: 'PS Posted',            description: 'Process Served — Posted & Mailed' },
      { code: 'PS Corporate',         description: 'Process Served — Corporate/Registered Agent' },
      { code: 'PS Mailed',            description: 'Process Served — By Mail' },
      { code: 'PS Non-Service',       description: 'Process — Unable to Serve' },
      { code: 'PS Evasive',           description: 'Process — Evasive / Avoiding Service' },
      { code: 'PS Vacant',            description: 'Process — Vacant / Unoccupied' },
      { code: 'PS No Access',         description: 'Process — Gated / No Access' },
      { code: 'PS Unknown',           description: 'Process — Recipient Unknown at Address' },
      { code: 'PS Out of Jurisdiction', description: 'Process — Out of Jurisdiction' },
      { code: 'PS Recalled',          description: 'Process — Recalled by Client' },
      { code: 'PS Non Est',           description: 'Process — Returned Non-Est (Return of Service Filed)' },
    ],
  },
];

/** Flat list of every built-in disposition (group order preserved). */
export const DEFAULT_DISPOSITIONS: DispositionDef[] =
  DISPOSITION_GROUPS.flatMap((g) => g.codes);

/** Set of built-in codes — used to de-dupe API custom codes against defaults. */
export const DEFAULT_DISPOSITION_CODES: Set<string> =
  new Set(DEFAULT_DISPOSITIONS.map((d) => d.code));

const PROCESS_SERVICE_INCIDENT_TYPES = new Set(['pso_client_request', 'process_service']);

/**
 * Returns the disposition groups in display order. For process-service
 * calls the Process Service group is hoisted to the top so its codes are
 * immediately reachable; otherwise the natural order is preserved.
 */
export function dispositionGroupsForIncident(incidentType?: string | null): DispositionGroup[] {
  if (incidentType && PROCESS_SERVICE_INCIDENT_TYPES.has(incidentType)) {
    const ps = DISPOSITION_GROUPS.filter((g) => g.processService);
    const rest = DISPOSITION_GROUPS.filter((g) => !g.processService);
    return [...ps, ...rest];
  }
  return DISPOSITION_GROUPS;
}
