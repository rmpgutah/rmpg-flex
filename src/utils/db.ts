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
  // ── Tables first ──
  // Mirrors the alpr.ts pattern: inline DDL self-heals when the migration step
  // (continue-on-error) doesn't reach live D1. DDL is identical to
  // migrations/0142_assessor_integration.sql.
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS parcel_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parcel_number TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL DEFAULT 'sl_county_assessor',
      source_url TEXT,
      account_number TEXT,
      serial_number TEXT,
      tax_district TEXT,
      owner_of_record TEXT,
      owner_type TEXT,
      owner_mailing_address TEXT,
      situs_address TEXT,
      situs_city TEXT,
      situs_zip TEXT,
      subdivision TEXT,
      land_acres REAL,
      land_sqft INTEGER,
      land_value INTEGER,
      zoning TEXT,
      year_built INTEGER,
      effective_year_built INTEGER,
      total_bldg_sqft INTEGER,
      finished_sqft INTEGER,
      basement_sqft INTEGER,
      garage_sqft INTEGER,
      stories REAL,
      bedrooms INTEGER,
      bathrooms REAL,
      construction_type TEXT,
      improvement_class TEXT,
      improvement_value INTEGER,
      market_value_total INTEGER,
      market_value_land INTEGER,
      market_value_improvement INTEGER,
      taxable_value INTEGER,
      assessed_value INTEGER,
      tax_year INTEGER,
      legal_description TEXT,
      plat TEXT,
      lot TEXT,
      block TEXT,
      raw_data_json TEXT,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
      refreshed_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`).run();
  } catch { /* race or pre-existing — tolerated */ }
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS parcel_sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parcel_record_id INTEGER NOT NULL,
      sale_date TEXT,
      sale_price INTEGER,
      doc_number TEXT,
      buyer TEXT,
      seller TEXT,
      sale_type TEXT,
      FOREIGN KEY (parcel_record_id) REFERENCES parcel_records(id) ON DELETE CASCADE
    )`).run();
  } catch { /* race or pre-existing — tolerated */ }
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS assessor_backfill_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_type TEXT NOT NULL CHECK(record_type IN ('business','property')),
      record_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','applied','no_match','ambiguous','unfetchable','error')),
      matches_json TEXT,
      applied_parcel_number TEXT,
      error_message TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      started_at TEXT,
      completed_at TEXT,
      UNIQUE(record_type, record_id)
    )`).run();
  } catch { /* race or pre-existing — tolerated */ }

  // ── Columns on existing tables ──
  for (const [table, col, type] of ASSESSOR_COLUMNS) {
    try {
      if (!(await columnExists(db, table, col))) {
        await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`).run();
      }
    } catch {
      // Race or pre-existing column — tolerated by design (CLAUDE.md rule #5).
    }
  }

  // ── Indexes (all 6 from the migration) ──
  // Idempotent natively via IF NOT EXISTS.
  try {
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_businesses_parcel ON businesses(parcel_number)`).run();
  } catch { /* ignore */ }
  try {
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_properties_parcel ON properties(parcel_number)`).run();
  } catch { /* ignore */ }
  try {
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_parcel_records_situs ON parcel_records(situs_address)`).run();
  } catch { /* ignore */ }
  try {
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_parcel_records_owner ON parcel_records(owner_of_record)`).run();
  } catch { /* ignore */ }
  try {
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_parcel_sales_record ON parcel_sales(parcel_record_id)`).run();
  } catch { /* ignore */ }
  try {
    await db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_backfill_pending ON assessor_backfill_jobs(status, retry_count) WHERE status = 'pending'`
    ).run();
  } catch { /* ignore */ }

  // Canary verification (mirrors ensureOutboxRecordColumns in routes/email.ts):
  // only mark the cache flag true if a known new column actually landed.
  // If a partial failure occurred above, the canary stays false and the next
  // call retries the whole reconciliation. Cheap — one PRAGMA per cold start.
  _assessorColumnsEnsured = await columnExists(db, 'businesses', 'parcel_number');
}
