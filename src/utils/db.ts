import type { D1Database, D1Result } from '@cloudflare/workers-types';

export function getDb(env: { DB: D1Database }) {
  return env.DB;
}

export async function query<T = unknown>(
  db: D1Database,
  sql: string,
  ...bindings: unknown[]
): Promise<T[]> {
  const stmt = db.prepare(sql);
  const result = await (bindings.length > 0 ? stmt.bind(...bindings) : stmt).all<T>();
  return result.results ?? [];
}

export async function queryFirst<T = unknown>(
  db: D1Database,
  sql: string,
  ...bindings: unknown[]
): Promise<T | null> {
  const stmt = db.prepare(sql);
  const result = await (bindings.length > 0 ? stmt.bind(...bindings) : stmt).first<T>();
  return result ?? null;
}

export async function execute(
  db: D1Database,
  sql: string,
  ...bindings: unknown[]
): Promise<D1Result> {
  const stmt = db.prepare(sql);
  return await (bindings.length > 0 ? stmt.bind(...bindings) : stmt).run();
}

export async function columnExists(db: D1Database, table: string, column: string): Promise<boolean> {
  const row = await db.prepare(
    `SELECT 1 FROM pragma_table_info(?) WHERE name = ?`
  ).bind(table, column).first();
  return row !== null;
}

export async function executeBatch(
  db: D1Database,
  statements: { sql: string; bindings?: unknown[] }[]
): Promise<D1Result[]> {
  return await db.batch(
    statements.map((s) => {
      const stmt = db.prepare(s.sql);
      return s.bindings?.length ? stmt.bind(...s.bindings) : stmt;
    })
  );
}

// ── Salt Lake County Assessor integration (mig 0134) ──
// The Worker reconciles missing columns at runtime since deploy.yml applies
// migrations with `continue-on-error: true` (CLAUDE.md rule #5). D1 does NOT
// support `IF NOT EXISTS` on `ADD COLUMN`, so we gate each ALTER with a
// columnExists() check. Mirrors the pattern used by routes like alpr.ts and
// clearpathAlpr.ts. Idempotent: safe to call on every assessor route invocation.
const ASSESSOR_COLUMNS: Array<[string, string, string]> = [
  ['businesses', 'parcel_number', 'TEXT'],
  ['businesses', 'owner_of_record', 'TEXT'],
  ['businesses', 'owner_type', 'TEXT'],
  ['businesses', 'owner_mailing_address', 'TEXT'],
  ['businesses', 'year_built', 'INTEGER'],
  ['businesses', 'total_market_value', 'INTEGER'],
  ['businesses', 'land_sqft', 'INTEGER'],
  ['businesses', 'last_sale_date', 'TEXT'],
  ['businesses', 'last_sale_price', 'INTEGER'],
  ['businesses', 'legal_description', 'TEXT'],
  ['businesses', 'tax_district', 'TEXT'],
  ['businesses', 'assessor_last_synced_at', 'TEXT'],
  ['businesses', 'assessor_source_url', 'TEXT'],
  ['properties', 'parcel_number', 'TEXT'],
  ['properties', 'owner_of_record', 'TEXT'],
  ['properties', 'owner_type', 'TEXT'],
  ['properties', 'owner_mailing_address', 'TEXT'],
  ['properties', 'year_built', 'INTEGER'],
  ['properties', 'total_market_value', 'INTEGER'],
  ['properties', 'land_sqft', 'INTEGER'],
  ['properties', 'last_sale_date', 'TEXT'],
  ['properties', 'last_sale_price', 'INTEGER'],
  ['properties', 'legal_description', 'TEXT'],
  ['properties', 'tax_district', 'TEXT'],
  ['properties', 'assessor_last_synced_at', 'TEXT'],
  ['properties', 'assessor_source_url', 'TEXT'],
];

let _assessorColumnsEnsured = false;

export async function ensureAssessorColumns(db: D1Database): Promise<void> {
  if (_assessorColumnsEnsured) return;
  for (const [table, col, type] of ASSESSOR_COLUMNS) {
    try {
      if (!(await columnExists(db, table, col))) {
        await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`).run();
      }
    } catch {
      // Race or pre-existing column — tolerated by design (CLAUDE.md rule #5).
    }
  }
  // Indexes are idempotent natively.
  try {
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_businesses_parcel ON businesses(parcel_number)`).run();
  } catch { /* ignore */ }
  try {
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_properties_parcel ON properties(parcel_number)`).run();
  } catch { /* ignore */ }
  _assessorColumnsEnsured = true;
}
