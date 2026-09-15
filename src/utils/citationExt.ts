// ============================================================
// citationExt — overflow columns for the Utah Uniform Citation
// ============================================================
// The official State of Utah "UNIFORM CITATION OR INFORMATION AND
// SUMMONS TO APPEAR" carries ~45 fields the RMS never modeled. They
// live in `citations_ext` (1:1 with `citations`, migration 0291)
// rather than on `citations` itself: that table already has 72
// columns and D1's SQLite is compiled with SQLITE_MAX_COLUMN=100 —
// a 101st column makes the table UNREADABLE, not merely
// un-SELECTable. 72 + 45 = 117, so ALTERing it would brick the
// citations table outright.
//
// Same 1:1 overflow pattern as `calls_for_service_ext`.

import { execute, queryFirst } from './db';
import { log } from './logger';

type Db = D1Database;

/** Text columns on citations_ext, in migration order. */
export const CITATION_EXT_TEXT_COLUMNS = [
  'ori', 'issuing_agency', 'prosecuting_agency', 'caption_county', 'caption_city',
  'person_last', 'person_first', 'person_middle',
  'person_city', 'person_state', 'person_zip', 'person_phone',
  'dl_state', 'dl_expires', 'dl_restriction', 'birth_place', 'ssn',
  'person_sex', 'person_race', 'person_height', 'person_weight', 'person_eyes', 'person_hair',
  'vehicle_plate_expires', 'vehicle_type',
  'gvwr', 'company_unit', 'company_city_state', 'actual_weight', 'weight_limit',
  'incident_city', 'incident_county', 'mile_post', 'direction_of_travel',
  'court_phone', 'officer_id_number', 'complainant', 'complainant_phone',
  'final_charge', 'disposition', 'conviction_date', 'date_sent_to_dld',
  'docket_number', 'judge_name',
] as const;

/**
 * Tri-state booleans. NULL means "the officer never answered", which is
 * distinct from an explicit No — the form prints YES [] NO [] and an
 * unanswered question leaves BOTH boxes empty. Coercing NULL to 0 would
 * assert a fact on a court document that nobody stated.
 */
export const CITATION_EXT_BOOLEAN_COLUMNS = [
  'cdl_presented', 'motorcycle_endorsed', 'picture_id', 'occupants_16_plus',
  'interstate', 'military', 'felony_death', 'felony_serious_bodily',
] as const;

/** Numeric columns (REAL/INTEGER). */
export const CITATION_EXT_NUMERIC_COLUMNS = [
  'fine_imposed', 'fine_suspended', 'jail_days', 'jail_suspended',
] as const;

export const CITATION_EXT_COLUMNS: readonly string[] = [
  ...CITATION_EXT_TEXT_COLUMNS,
  ...CITATION_EXT_BOOLEAN_COLUMNS,
  ...CITATION_EXT_NUMERIC_COLUMNS,
];

const EXT_COLUMN_SET = new Set(CITATION_EXT_COLUMNS);
const BOOLEAN_SET: Set<string> = new Set(CITATION_EXT_BOOLEAN_COLUMNS);
const NUMERIC_SET: Set<string> = new Set(CITATION_EXT_NUMERIC_COLUMNS);

export function isCitationExtColumn(key: string): boolean {
  return EXT_COLUMN_SET.has(key);
}

/**
 * Coerce an incoming JSON value for its column type.
 * Booleans stay tri-state: undefined/null/'' → null.
 */
function coerce(column: string, value: unknown): unknown {
  if (value === undefined || value === null || value === '') return null;
  if (BOOLEAN_SET.has(column)) {
    if (typeof value === 'boolean') return value ? 1 : 0;
    const s = String(value).trim().toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes' || s === 'y') return 1;
    if (s === 'false' || s === '0' || s === 'no' || s === 'n') return 0;
    return null;
  }
  if (NUMERIC_SET.has(column)) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return String(value);
}

/**
 * Pull the citations_ext-bound keys out of a request body.
 * Returns null when the body carries none, so callers can skip the write.
 */
export function extractCitationExt(body: Record<string, unknown>): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!EXT_COLUMN_SET.has(k) || v === undefined) continue;
    out[k] = coerce(k, v);
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Runtime reconciler — the route stays functional on a deployment where
 * migration 0291 has not landed yet (same pattern as the ALPR route).
 * Idempotent and cheap; failures are logged, never thrown, because a
 * missing overflow table must not take the citation write down with it.
 */
export async function ensureCitationExt(db: Db): Promise<boolean> {
  try {
    const cols = [
      ...CITATION_EXT_TEXT_COLUMNS.map((c) => `${c} TEXT`),
      ...CITATION_EXT_BOOLEAN_COLUMNS.map((c) => `${c} INTEGER`),
      'fine_imposed REAL', 'fine_suspended REAL', 'jail_days INTEGER', 'jail_suspended INTEGER',
    ].join(', ');
    await execute(
      db,
      `CREATE TABLE IF NOT EXISTS citations_ext (
         citation_id INTEGER PRIMARY KEY, ${cols},
         created_at TEXT DEFAULT (datetime('now')),
         updated_at TEXT DEFAULT (datetime('now')),
         FOREIGN KEY (citation_id) REFERENCES citations(id) ON DELETE CASCADE
       )`,
    );
    return true;
  } catch (err) {
    log.error('ensureCitationExt failed', { src: 'src/utils/citationExt.ts' }, err);
    return false;
  }
}

/**
 * Upsert the overflow row. Only the keys present in `values` are written,
 * so a PATCH-shaped update never blanks a field the caller didn't mention.
 *
 * The parameter count is bounded by the column list (~55 max including the
 * id), comfortably under D1's 100-bound-parameter cap — but it is a fixed
 * schema list, never caller-supplied, so it cannot grow with the data.
 */
export async function upsertCitationExt(
  db: Db,
  citationId: number,
  values: Record<string, unknown>,
): Promise<void> {
  const cols = Object.keys(values).filter((k) => EXT_COLUMN_SET.has(k));
  if (cols.length === 0) return;
  const placeholders = cols.map(() => '?').join(', ');
  const updates = cols.map((c) => `${c} = excluded.${c}`).join(', ');
  await execute(
    db,
    `INSERT INTO citations_ext (citation_id, ${cols.join(', ')})
     VALUES (?, ${placeholders})
     ON CONFLICT(citation_id) DO UPDATE SET ${updates}, updated_at = datetime('now')`,
    citationId,
    ...cols.map((c) => values[c] ?? null),
  );
}

/** Read the overflow row, or an empty object when there isn't one. */
export async function readCitationExt(
  db: Db,
  citationId: number,
): Promise<Record<string, unknown>> {
  try {
    const row = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM citations_ext WHERE citation_id = ?', citationId,
    );
    if (!row) return {};
    const { citation_id: _id, created_at: _c, updated_at: _u, ...rest } = row;
    return rest;
  } catch (err) {
    // A missing table must degrade to "no extended data", not a 500 on the
    // officer's citation lookup.
    log.error('readCitationExt failed', { src: 'src/utils/citationExt.ts', citationId }, err);
    return {};
  }
}

/** Roles allowed to see the defendant's full SSN off the citation form. */
const SSN_ROLES = new Set(['admin', 'manager', 'supervisor', 'officer']);

/**
 * Redact the full SSN for readers who don't issue or supervise citations
 * (dispatcher, client_viewer, contract_manager, …). The number is on the
 * printed form because the state form has a box for it, which is not a
 * reason to hand it to every authenticated reader of the API.
 */
export function redactCitationExt(
  ext: Record<string, unknown>,
  role: string | undefined,
): Record<string, unknown> {
  if (!ext.ssn || (role && SSN_ROLES.has(role))) return ext;
  const last4 = String(ext.ssn).replace(/\D/g, '').slice(-4);
  return { ...ext, ssn: last4 ? `***-**-${last4}` : null };
}
