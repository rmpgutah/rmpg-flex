// ============================================================
// RMPG Flex — Disposition config assembly
// ============================================================
// Dispositions live in system_config under TWO historical namespaces:
//
//   1. config_key = 'disposition.<CODE>'   (legacy, one row per code)
//   2. category   = 'dispositions'         (what AdminSystemTab.tsx writes
//                                           today, with a constant
//                                           config_key of 'disposition_code')
//
// GET /admin/config used to recognize only (1), so every disposition created
// in Admin -> System Config -> Dispositions was invisible to DispatchPage and
// IncidentsPage — it saved, appeared in the admin table, and never reached the
// dropdowns. This module recognizes both and is the single place the
// precedence rules live.
//
// Pure: no D1, no Hono. Unit-tested in tests/dispositionConfig.test.ts.
// ============================================================

export interface DispositionConfigRow {
  config_key: string;
  config_value: string;
  category?: string | null;
}

export interface Disposition {
  code: string;
  description: string;
  color?: string;
  is_active: boolean;
  /** Retained for backward-compat: existing clients JSON.parse this field. */
  config_value: string;
}

/**
 * Baked-in roster so the dropdown is never empty on a fresh database.
 * Custom rows override these BY CODE, so an admin can retune wording or color
 * without losing the built-ins.
 */
export const DEFAULT_DISPOSITIONS: { code: string; description: string }[] = [
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
  { code: 'Verbal Warning',   description: 'Verbal Warning Issued' },
  { code: 'Field Interview',  description: 'Field Interview (FI) Conducted' },
  { code: 'Counseled',        description: 'Subject Counseled' },
  { code: 'Documentation Only', description: 'Documentation Only' },
  { code: 'UTL',              description: 'Unable to Locate' },
  { code: 'Assist Rendered',  description: 'Assist Rendered' },
  { code: 'Negative Contact', description: 'Negative Contact' },
  { code: 'Patrol Completed', description: 'Patrol Completed' },
  { code: 'Premise Secured',  description: 'Premise Secured' },
  { code: 'Owner Notified',   description: 'Owner/Keyholder Notified' },
  { code: 'Vehicle Towed',    description: 'Vehicle Towed' },
  { code: 'Standby Complete', description: 'Standby Complete' },
  // Process Service outcomes (paper service — pso_client_request /
  // process_service calls). Namespaced with a 'PS ' code prefix so they group
  // together and never collide with the law-enforcement codes above.
  // Per-attempt diligence tracking still lives in the dedicated serve
  // subsystem (serve_attempts); these are the call-level closeout codes.
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
  { code: 'Cancelled',        description: 'Call Cancelled' },
];

const LEGACY_KEY_PREFIX = 'disposition.';

/** True when this system_config row carries a disposition, in either namespace. */
export function isDispositionRow(row: DispositionConfigRow): boolean {
  return row.config_key.startsWith(LEGACY_KEY_PREFIX) || row.category === 'dispositions';
}

function parseRow(row: DispositionConfigRow): Disposition | null {
  try {
    const parsed = JSON.parse(row.config_value) as {
      code?: unknown; description?: unknown; color?: unknown; is_active?: unknown;
    };
    const code = typeof parsed.code === 'string' ? parsed.code.trim() : '';
    if (!code) return null;
    return {
      code,
      description: typeof parsed.description === 'string' ? parsed.description : code,
      color: typeof parsed.color === 'string' ? parsed.color : undefined,
      is_active: parsed.is_active !== false,
      config_value: row.config_value,
    };
  } catch {
    return null; // Malformed row — skip rather than fail the whole response.
  }
}

/**
 * Assemble the effective disposition roster: custom rows from both namespaces
 * first (legacy `disposition.<code>` keys take precedence over category rows so
 * a pre-existing explicit override is never silently replaced), then the
 * built-in defaults for any code not already present. Deduped by code.
 */
export function mergeDispositions(rows: DispositionConfigRow[]): Disposition[] {
  const dispositionRows = rows.filter(isDispositionRow);
  const legacy = dispositionRows.filter((r) => r.config_key.startsWith(LEGACY_KEY_PREFIX));
  const byCategory = dispositionRows.filter((r) => !r.config_key.startsWith(LEGACY_KEY_PREFIX));

  const out: Disposition[] = [];
  const seen = new Set<string>();

  for (const row of [...legacy, ...byCategory]) {
    const parsed = parseRow(row);
    if (!parsed || seen.has(parsed.code)) continue;
    seen.add(parsed.code);
    out.push(parsed);
  }

  for (const d of DEFAULT_DISPOSITIONS) {
    if (seen.has(d.code)) continue;
    seen.add(d.code);
    out.push({ ...d, is_active: true, config_value: JSON.stringify(d) });
  }

  return out;
}
