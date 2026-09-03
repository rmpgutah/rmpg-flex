import type { D1Database, D1Result } from '@cloudflare/workers-types';
import {
  RESIDENCE_FIELDS, PARCEL_RECORD_EXTRA_FIELDS,
  PARCEL_RECORD_STRUCTURAL_COLUMNS, PROMOTED_RECORD_FIELDS,
  PROMOTED_TARGET_TABLES, sqlType,
} from './sl-assessor/camaFields';
import { getTursoClient, type InValue } from './tursoClient';
import { log } from './logger';

export function getDb(env: { DB: D1Database }) {
  return env.DB;
}

/** Transient D1 failures (export lock, SQLITE_BUSY, platform blips). Do not retry schema errors. */
export function isRetryableD1Error(err: unknown): boolean {
  const msg = (err instanceof Error ? `${err.name} ${err.message}` : String(err)).toLowerCase();
  if (/no such (table|column)|unique constraint|foreign key|syntax error|datatype mismatch/.test(msg)) {
    return false;
  }
  return /busy|locked|sqlite_busy|sqlite_locked|d1_error|network|timeout|too many|internal error|503|429/.test(msg);
}

const D1_READ_RETRY_ATTEMPTS = 5;

export async function withD1Retry<T>(fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let i = 0; i < D1_READ_RETRY_ATTEMPTS; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!isRetryableD1Error(err) || i === D1_READ_RETRY_ATTEMPTS - 1) throw err;
      const delayMs = Math.min(1000, 80 * 2 ** i);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw last;
}

export async function query<T = unknown>(
  db: D1Database,
  sql: string,
  ...bindings: unknown[]
): Promise<T[]> {
  try {
    // Re-prepare on every attempt — a bound D1 statement cannot be reused
    // after a failed run, and bind() is not idempotent.
    const result = await withD1Retry(() => {
      const stmt = db.prepare(sql);
      return (bindings.length > 0 ? stmt.bind(...bindings) : stmt).all<T>();
    });
    return result.results ?? [];
  } catch (err) {
    const turso = getTursoClient();
    if (!turso) throw err;
    log.warn('D1 read failed — falling back to Turso', { sql, d1Err: err instanceof Error ? err.message : String(err) });
    const result = await turso.execute({ sql, args: bindings as InValue[] });
    return (result.rows ?? []) as T[];
  }
}

export async function queryFirst<T = unknown>(
  db: D1Database,
  sql: string,
  ...bindings: unknown[]
): Promise<T | null> {
  try {
    const result = await withD1Retry(() => {
      const stmt = db.prepare(sql);
      return (bindings.length > 0 ? stmt.bind(...bindings) : stmt).first<T>();
    });
    return result ?? null;
  } catch (err) {
    const turso = getTursoClient();
    if (!turso) throw err;
    log.warn('D1 queryFirst failed — falling back to Turso', { sql, d1Err: err instanceof Error ? err.message : String(err) });
    const result = await turso.execute({ sql, args: bindings as InValue[] });
    return (result.rows?.[0] as T) ?? null;
  }
}

export async function execute(
  db: D1Database,
  sql: string,
  ...bindings: unknown[]
): Promise<D1Result> {
  const turso = getTursoClient();

  const d1Promise = (bindings.length > 0
    ? db.prepare(sql).bind(...bindings)
    : db.prepare(sql)
  ).run();

  const tursoPromise = turso
    ? turso.execute({ sql, args: bindings as InValue[] }).catch((err: unknown) => {
        log.error('Turso dual-write failed', { sql },
          err instanceof Error ? err : new Error(String(err)));
      })
    : Promise.resolve(null);

  const [d1Result] = await Promise.allSettled([d1Promise, tursoPromise]);

  if (d1Result.status === 'rejected') {
    log.error('D1 write failed — Turso captured the row', { sql },
      d1Result.reason instanceof Error ? d1Result.reason : new Error(String(d1Result.reason)));
    throw d1Result.reason;
  }

  return d1Result.value;
}

/**
 * D1 rejects any query carrying more than 100 bound parameters
 * (https://developers.cloudflare.com/d1/platform/limits/). The rejection happens
 * at BIND time, before execution, so it surfaces as a thrown D1_ERROR out of
 * `query()`/`execute()` rather than as a SQL error — which means a route that
 * doesn't wrap the call has no error to log and simply 500s.
 *
 * This bites any `IN (?,?,…)` list built from a caller-supplied array, because
 * the query's SHAPE then grows with the data: it works in dev and in tests, then
 * fails the first time real data crosses 100 rows. Observed live 2026-07-26 on
 * `GET /api/fleetio/conflicts`, which sent 110 bindings once the fuel log held
 * 109 rows.
 */
export const D1_MAX_BOUND_PARAMS = 100;

/**
 * Split `items` into groups small enough that each resulting query stays under
 * D1's bound-parameter cap.
 *
 * `reservedBindings` is the count of parameters the query binds OUTSIDE the
 * IN-list (filters, a trailing id, etc.) — pass it so the chunk size accounts
 * for them instead of silently eating into the same budget.
 *
 * Returns `[]` for an empty input, so callers can short-circuit on
 * `chunks.length === 0` rather than issuing a query guaranteed to match nothing.
 */
export function chunkBindings<T>(items: readonly T[], reservedBindings = 0): T[][] {
  const budget = D1_MAX_BOUND_PARAMS - Math.max(0, reservedBindings);
  if (budget < 1) {
    throw new Error(
      `chunkBindings: ${reservedBindings} reserved bindings leaves no room under D1's ${D1_MAX_BOUND_PARAMS}-parameter cap`,
    );
  }
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += budget) chunks.push(items.slice(i, i + budget));
  return chunks;
}

/**
 * Run one `… IN (?,?,…)` SELECT per chunk and concatenate the rows.
 *
 * `buildSql` receives the placeholder string for the current chunk (e.g.
 * `"?,?,?"`) and returns the full SQL. `leadingBindings` are parameters bound
 * BEFORE the IN-list — they're re-bound on every chunk and counted against the
 * cap automatically.
 *
 * Row ORDER across chunks is the concatenation order, NOT a global sort: if the
 * caller needs a deterministic order it must sort the merged result itself, and
 * if it needs a LIMIT it must apply that after merging (a per-chunk LIMIT biases
 * the result toward whichever chunk was queried).
 */
export async function queryInChunks<T = unknown>(
  db: D1Database,
  items: readonly (string | number)[],
  buildSql: (placeholders: string) => string,
  leadingBindings: unknown[] = [],
): Promise<T[]> {
  const chunks = chunkBindings(items, leadingBindings.length);
  if (chunks.length === 0) return [];
  const results = await Promise.all(chunks.map((chunk) =>
    query<T>(db, buildSql(chunk.map(() => '?').join(',')), ...leadingBindings, ...chunk),
  ));
  return results.flat();
}

/**
 * Chunked counterpart of `execute` for a write whose `WHERE … IN (…)` list is
 * caller-sized. Returns the SUMMED `meta.changes` across chunks.
 *
 * ⚠️ NOT atomic across chunks — each chunk is its own statement, so a failure
 * partway through leaves earlier chunks applied. Callers that need
 * all-or-nothing must use `db.batch()` instead. For the bulk-reassign style
 * operations this replaces, partial application is the same exposure the
 * single-statement version already had against a mid-query failure.
 */
export async function executeInChunks(
  db: D1Database,
  items: readonly (string | number)[],
  buildSql: (placeholders: string) => string,
  leadingBindings: unknown[] = [],
): Promise<number> {
  const chunks = chunkBindings(items, leadingBindings.length);
  if (chunks.length === 0) return 0;
  let changes = 0;
  for (const chunk of chunks) {
    const r = await execute(db, buildSql(chunk.map(() => '?').join(',')), ...leadingBindings, ...chunk);
    changes += r.meta?.changes ?? 0;
  }
  return changes;
}

export async function columnExists(db: D1Database, table: string, column: string): Promise<boolean> {
  const row = await withD1Retry(() =>
    db.prepare(
      `SELECT 1 FROM pragma_table_info(?) WHERE name = ?`
    ).bind(table, column).first(),
  );
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
  // Curated CAMA fields promoted onto the operational record cards (mig
  // 0221). Generated from the registry so this list and the migration
  // cannot drift apart.
  ...PROMOTED_TARGET_TABLES.flatMap((t) =>
    PROMOTED_RECORD_FIELDS.map((f) => [t, f.col, f.sql] as [string, string, string]),
  ),
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
      recorded_document_url TEXT,
      recorded_document_type TEXT,
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

  // ── parcel_residence: full CAMA residence block (mig 0221) ──
  // Self-heals for the same reason as the tables above: the deploy's
  // migration step is continue-on-error, so a missing table here would
  // surface only as a runtime "no such table" inside a try/catch that
  // degrades silently.
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS parcel_residence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parcel_record_id INTEGER NOT NULL UNIQUE,
      ${RESIDENCE_FIELDS.map((f) => `${f.col} ${sqlType(f.type)}`).join(',\n      ')},
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (parcel_record_id) REFERENCES parcel_records(id) ON DELETE CASCADE
    )`).run();
  } catch { /* race or pre-existing — tolerated */ }
  try {
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_parcel_residence_record ON parcel_residence(parcel_record_id)`).run();
  } catch { /* ignore */ }

  // ── parcel_records-only columns (multi-county additions, mig 0188;
  //    full CAMA build, mig 0221) ──
  const PARCEL_RECORD_COLUMNS: Array<[string, string]> = [
    ['recorded_document_url', 'TEXT'],
    ['recorded_document_type', 'TEXT'],
    // Generated from the CAMA field registry so the reconciler and the
    // migration can never disagree about which columns exist.
    ...PARCEL_RECORD_EXTRA_FIELDS.map((f) => [f.col, sqlType(f.type)] as [string, string]),
    ...PARCEL_RECORD_STRUCTURAL_COLUMNS,
  ];
  for (const [col, type] of PARCEL_RECORD_COLUMNS) {
    try {
      if (!(await columnExists(db, 'parcel_records', col))) {
        await db.prepare(`ALTER TABLE parcel_records ADD COLUMN ${col} ${type}`).run();
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
  // If a partial failure occurred above, the cache flag stays false and the next
  // call retries the whole reconciliation. Cheap — one PRAGMA per cold start.
  _assessorColumnsEnsured = await columnExists(db, 'businesses', 'parcel_number');
}

// ── Time entry columns reconciler ──────────────────────────
// Migration 0150_time_entries_local_stamps.sql adds clock_in_local,
// clock_out_local, break_start_local to time_entries. D1 does not
// support IF NOT EXISTS on ADD COLUMN, and deploy.yml applies migrations
// with continue-on-error: true. This reconciler ensures the columns
// exist at runtime so POST /personnel/time/clock-in etc don't 500
// with "table time_entries has no column named clock_in_local".
//
// Call from any route handler that writes to time_entries columns
// (personnel clock-in/out/break, dispatch duty start/end). The flag
// is per-isolate (once per cold start).
let _timeEntryColumnsEnsured = false;

const TIME_ENTRY_LOCAL_COLS: Array<[string, string]> = [
  ['clock_in_local', 'TEXT'],
  ['clock_out_local', 'TEXT'],
  ['break_start_local', 'TEXT'],
];

export async function ensureTimeEntryColumns(db: D1Database): Promise<void> {
  if (_timeEntryColumnsEnsured) return;
  for (const [col, type] of TIME_ENTRY_LOCAL_COLS) {
    try {
      if (!(await columnExists(db, 'time_entries', col))) {
        await db.prepare(`ALTER TABLE time_entries ADD COLUMN ${col} ${type}`).run();
      }
    } catch {
      // Race or pre-existing column — tolerated by design (CLAUDE.md rule #5).
    }
  }
  _timeEntryColumnsEnsured = await columnExists(db, 'time_entries', 'clock_in_local');
}

// ── nav_favorites staging-flag reconciler ──────────────────
// Migration 0183_nav_favorites_staging.sql adds is_staging to
// nav_favorites so officers can flag a saved destination as a
// parking/staging spot. Same continue-on-error/no-IF-NOT-EXISTS
// situation as above — self-heal at runtime, once per isolate.
let _navFavoritesColumnsEnsured = false;

export async function ensureNavFavoritesColumns(db: D1Database): Promise<void> {
  if (_navFavoritesColumnsEnsured) return;
  try {
    if (!(await columnExists(db, 'nav_favorites', 'is_staging'))) {
      await db.prepare(`ALTER TABLE nav_favorites ADD COLUMN is_staging INTEGER DEFAULT 0`).run();
    }
  } catch {
    // Race or pre-existing column — tolerated by design (CLAUDE.md rule #5).
  }
  _navFavoritesColumnsEnsured = await columnExists(db, 'nav_favorites', 'is_staging');
}

// ── users.dialer_oidc_sub reconciler ───────────────────────
// Migration 0184_dialer_oidc_link.sql adds dialer_oidc_sub to users for
// "Sign in with Dialer" OIDC SSO linking. Same self-heal situation as above.
let _dialerOidcColumnsEnsured = false;

export async function ensureDialerOidcColumns(db: D1Database): Promise<void> {
  if (_dialerOidcColumnsEnsured) return;
  try {
    if (!(await columnExists(db, 'users', 'dialer_oidc_sub'))) {
      await db.prepare(`ALTER TABLE users ADD COLUMN dialer_oidc_sub TEXT`).run();
    }
    await db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_dialer_oidc_sub
         ON users(dialer_oidc_sub) WHERE dialer_oidc_sub IS NOT NULL`
    ).run();
  } catch {
    // Race or pre-existing column — tolerated by design (CLAUDE.md rule #5).
  }
  _dialerOidcColumnsEnsured = await columnExists(db, 'users', 'dialer_oidc_sub');
}

// ── Account lockout columns reconciler ──────────────────────
// Migration 0192_account_lockout.sql adds failed_login_count and
// locked_until to users for login-attempt lockout (see
// docs/superpowers/specs/2026-07-18-account-lockout-login-hardening-design.md).
// Same self-heal situation as above (CLAUDE.md rule #5).
let _accountLockoutColumnsEnsured = false;

const ACCOUNT_LOCKOUT_COLUMNS: Array<[string, string]> = [
  ['failed_login_count', 'INTEGER NOT NULL DEFAULT 0'],
  ['locked_until', 'TEXT'],
];

export async function ensureAccountLockoutColumns(db: D1Database): Promise<void> {
  if (_accountLockoutColumnsEnsured) return;
  for (const [col, type] of ACCOUNT_LOCKOUT_COLUMNS) {
    try {
      if (!(await columnExists(db, 'users', col))) {
        await db.prepare(`ALTER TABLE users ADD COLUMN ${col} ${type}`).run();
      }
    } catch {
      // Race or pre-existing column — tolerated by design (CLAUDE.md rule #5).
    }
  }
  _accountLockoutColumnsEnsured = await columnExists(db, 'users', 'failed_login_count').catch(() => false);
}

// ── Jurisdiction override + photo/layout reconciler ────────
// Migration 0189_jurisdiction_photo_layout.sql adds jurisdiction_override to
// businesses/properties, photo_url/layout_url to parcel_records, a `kind`
// column to business_photos, and creates property_photos. Same self-heal
// situation as above (CLAUDE.md rule #5).
let _jurisdictionPhotoColumnsEnsured = false;

export async function ensureJurisdictionAndPhotoColumns(db: D1Database): Promise<void> {
  if (_jurisdictionPhotoColumnsEnsured) return;
  const COLUMNS: Array<[string, string, string]> = [
    ['businesses', 'jurisdiction_override', 'TEXT'],
    ['properties', 'jurisdiction_override', 'TEXT'],
    ['parcel_records', 'photo_url', 'TEXT'],
    ['parcel_records', 'layout_url', 'TEXT'],
    ['business_photos', 'kind', `TEXT NOT NULL DEFAULT 'photo'`],
  ];
  for (const [table, col, type] of COLUMNS) {
    try {
      if (!(await columnExists(db, table, col))) {
        await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`).run();
      }
    } catch {
      // Race or pre-existing column — tolerated by design (CLAUDE.md rule #5).
    }
  }
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS property_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id INTEGER NOT NULL,
      url TEXT NOT NULL,
      caption TEXT,
      category TEXT,
      kind TEXT NOT NULL DEFAULT 'photo',
      uploaded_by INTEGER,
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
    )`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_property_photos_property ON property_photos(property_id)`).run();
  } catch {
    // Race or pre-existing table — tolerated by design (CLAUDE.md rule #5).
  }
  // Only cache success once every column AND the property_photos table are
  // actually confirmed present — a partial failure (e.g. property_photos
  // creation raced/failed while the column ALTERs succeeded) must leave the
  // flag false so the next call in this isolate retries the missing pieces,
  // rather than permanently skipping reconciliation for the isolate's life.
  const columnsOk = await Promise.all(
    COLUMNS.map(([table, col]) => columnExists(db, table, col)),
  ).then((results) => results.every(Boolean));
  const propertyPhotosOk = await db.prepare(
    `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'property_photos'`,
  ).first().then((row) => row !== null).catch(() => false);
  _jurisdictionPhotoColumnsEnsured = columnsOk && propertyPhotosOk;
}

// ── Driver Performance reconciler (mig 0222) ───────────────
// deploy.yml applies migrations with continue-on-error, and D1 has no
// IF NOT EXISTS on ADD COLUMN — gate each ALTER with columnExists().
let _driverPerformanceEnsured = false;

export async function ensureDriverPerformanceColumns(db: D1Database): Promise<void> {
  if (_driverPerformanceEnsured) return;

  // The three ALTERs below self-healed, but the TABLE they orbit did not — if
  // 0223 never reached live D1 (the deploy step is continue-on-error), every
  // rollup and every roster query failed with "no such table" and the feature
  // simply never worked. Create it here too, from the same DDL as the
  // migration, so a swallowed migration cannot leave a permanent hole.
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS driver_performance_daily (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      officer_id INTEGER NOT NULL REFERENCES users(id),
      perf_date TEXT NOT NULL,
      miles_driven REAL NOT NULL DEFAULT 0,
      drive_minutes REAL NOT NULL DEFAULT 0,
      trip_count INTEGER NOT NULL DEFAULT 0,
      events_critical INTEGER NOT NULL DEFAULT 0,
      events_high INTEGER NOT NULL DEFAULT 0,
      events_moderate INTEGER NOT NULL DEFAULT 0,
      events_low INTEGER NOT NULL DEFAULT 0,
      events_forward_collision INTEGER NOT NULL DEFAULT 0,
      events_lane_departure INTEGER NOT NULL DEFAULT 0,
      events_close_following INTEGER NOT NULL DEFAULT 0,
      events_harsh_brake INTEGER NOT NULL DEFAULT 0,
      events_harsh_accel INTEGER NOT NULL DEFAULT 0,
      events_speeding INTEGER NOT NULL DEFAULT 0,
      attribution_recorded_pct REAL NOT NULL DEFAULT 0,
      attribution_inferred_pct REAL NOT NULL DEFAULT 0,
      unattributed_events INTEGER NOT NULL DEFAULT 0,
      fuel_cost REAL NOT NULL DEFAULT 0,
      fuel_gallons REAL NOT NULL DEFAULT 0,
      maintenance_cost REAL NOT NULL DEFAULT 0,
      events_speed_high INTEGER NOT NULL DEFAULT 0,
      events_speed_very_high INTEGER NOT NULL DEFAULT 0,
      events_speed_extreme INTEGER NOT NULL DEFAULT 0,
      breadcrumb_samples INTEGER NOT NULL DEFAULT 0,
      excluded_call_samples INTEGER NOT NULL DEFAULT 0,
      score REAL,
      score_version TEXT NOT NULL,
      computed_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(officer_id, perf_date)
    )`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_dpd_date ON driver_performance_daily(perf_date)`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_dpd_officer_date ON driver_performance_daily(officer_id, perf_date)`).run();
  } catch {
    // Race or pre-existing table — tolerated by design (CLAUDE.md rule #5).
  }

  const COLUMNS: Array<[string, string, string]> = [
    ['fleet_assignments', 'officer_id', 'INTEGER'],
    ['dashcam_events', 'officer_id', 'INTEGER'],
    ['dashcam_events', 'officer_attribution_source', 'TEXT'],
    // Added after the table shipped: an existing (pre-0223-edit) table needs
    // the ALTER, a fresh one already has it from the CREATE above.
    ['driver_performance_daily', 'unattributed_events', 'INTEGER NOT NULL DEFAULT 0'],
    // 0224 — speed-event source (gps_breadcrumbs) replacing ClearPath dashcam
    // events. `breadcrumb_samples` is load-bearing, not decorative: 0 samples
    // against non-zero miles is a DEAD FEED, and a dead feed scores 100 unless
    // something records that nothing was observed.
    ['driver_performance_daily', 'events_speed_high', 'INTEGER NOT NULL DEFAULT 0'],
    ['driver_performance_daily', 'events_speed_very_high', 'INTEGER NOT NULL DEFAULT 0'],
    ['driver_performance_daily', 'events_speed_extreme', 'INTEGER NOT NULL DEFAULT 0'],
    ['driver_performance_daily', 'breadcrumb_samples', 'INTEGER NOT NULL DEFAULT 0'],
    // 0225 — of `breadcrumb_samples` (RAW, pre-exclusion), how many were
    // excluded as emergency-response (current_call_id set or unit_status in an
    // active-response state). `breadcrumb_samples` alone cannot tell "feed
    // dead" (raw=0) apart from "every sample was lawful code-3" (raw>0, all
    // excluded) — see src/utils/driverPerformance/rollup.ts.
    ['driver_performance_daily', 'excluded_call_samples', 'INTEGER NOT NULL DEFAULT 0'],
  ];
  for (const [table, col, type] of COLUMNS) {
    try {
      if (!(await columnExists(db, table, col))) {
        await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`).run();
      }
    } catch {
      // Race or pre-existing column — tolerated by design (CLAUDE.md rule #5).
    }
  }
  const columnsOk = await Promise.all(
    COLUMNS.map(([t, c]) => columnExists(db, t, c)),
  ).then((r) => r.every(Boolean));
  _driverPerformanceEnsured = columnsOk;
}

// ─── HR tables reconciler ────────────────────────────────────────────────────
// Ensures all tables from migration 0157_hr_tables_complete.sql exist on the
// live D1 instance. The deploy step is continue-on-error so the migration may
// never have landed; this self-heals the gap on the first request.
let _hrTablesEnsured = false;

export async function ensureHrTables(db: D1Database): Promise<void> {
  if (_hrTablesEnsured) return;
  const ddl = [
    `CREATE TABLE IF NOT EXISTS hr_pay_periods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      pay_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','processing','finalized','paid','closed')),
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (created_by) REFERENCES users(id)
    )`,
    `CREATE TABLE IF NOT EXISTS hr_pay_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      pay_type TEXT NOT NULL DEFAULT 'hourly',
      rate REAL NOT NULL DEFAULT 0,
      overtime_rate REAL NOT NULL DEFAULT 1.5,
      holiday_rate REAL NOT NULL DEFAULT 1.5,
      effective_date TEXT NOT NULL,
      end_date TEXT,
      notes TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    )`,
    `CREATE TABLE IF NOT EXISTS hr_payroll_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      pay_period_id INTEGER NOT NULL,
      pay_rate_id INTEGER,
      regular_hours REAL NOT NULL DEFAULT 0,
      overtime_hours REAL NOT NULL DEFAULT 0,
      holiday_hours REAL NOT NULL DEFAULT 0,
      pto_hours REAL NOT NULL DEFAULT 0,
      sick_hours REAL NOT NULL DEFAULT 0,
      other_hours REAL NOT NULL DEFAULT 0,
      other_hours_description TEXT,
      base_pay REAL NOT NULL DEFAULT 0,
      overtime_pay REAL NOT NULL DEFAULT 0,
      holiday_pay REAL NOT NULL DEFAULT 0,
      gross_pay REAL NOT NULL DEFAULT 0,
      total_deductions REAL NOT NULL DEFAULT 0,
      net_pay REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','paid')),
      notes TEXT,
      approved_by INTEGER,
      approved_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (pay_period_id) REFERENCES hr_pay_periods(id) ON DELETE CASCADE,
      FOREIGN KEY (pay_rate_id) REFERENCES hr_pay_rates(id),
      FOREIGN KEY (approved_by) REFERENCES users(id)
    )`,
    `CREATE TABLE IF NOT EXISTS overtime_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      officer_id INTEGER NOT NULL,
      officer_name TEXT,
      requested_date TEXT NOT NULL,
      hours_requested REAL NOT NULL,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','approved','denied')),
      reviewed_by INTEGER,
      reviewed_by_name TEXT,
      reviewed_at TEXT,
      review_notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (officer_id) REFERENCES users(id),
      FOREIGN KEY (reviewed_by) REFERENCES users(id)
    )`,
    `CREATE TABLE IF NOT EXISTS hr_grievances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      officer_id INTEGER NOT NULL,
      type TEXT NOT NULL DEFAULT 'general',
      subject TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'filed' CHECK(status IN ('filed','under_review','investigation','mediation','resolved','dismissed','appealed')),
      priority TEXT DEFAULT 'normal',
      assigned_to INTEGER,
      resolution TEXT,
      filed_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (officer_id) REFERENCES users(id),
      FOREIGN KEY (assigned_to) REFERENCES users(id)
    )`,
    `CREATE TABLE IF NOT EXISTS hr_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'policy',
      description TEXT,
      file_path TEXT,
      file_name TEXT,
      file_size INTEGER DEFAULT 0,
      uploaded_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (uploaded_by) REFERENCES users(id)
    )`,
    `CREATE TABLE IF NOT EXISTS hr_handbook_acknowledgments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      officer_id INTEGER NOT NULL,
      document_id INTEGER NOT NULL,
      acknowledged_at TEXT NOT NULL,
      signature TEXT,
      ip_address TEXT,
      FOREIGN KEY (officer_id) REFERENCES users(id),
      FOREIGN KEY (document_id) REFERENCES hr_documents(id),
      UNIQUE(officer_id, document_id)
    )`,
    `CREATE TABLE IF NOT EXISTS hr_attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      officer_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'absent' CHECK(type IN ('absent','tardy','early_departure','no_call_no_show')),
      minutes_late INTEGER DEFAULT 0,
      reason TEXT,
      excused INTEGER DEFAULT 0,
      documented_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (officer_id) REFERENCES users(id),
      FOREIGN KEY (documented_by) REFERENCES users(id)
    )`,
    `CREATE TABLE IF NOT EXISTS hr_pips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      officer_id INTEGER NOT NULL,
      supervisor_id INTEGER,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      reason TEXT NOT NULL,
      goals TEXT NOT NULL DEFAULT '[]',
      milestones TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','extended','failed','cancelled')),
      outcome TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (officer_id) REFERENCES users(id),
      FOREIGN KEY (supervisor_id) REFERENCES users(id)
    )`,
  ];
  for (const sql of ddl) {
    try { await db.prepare(sql).run(); } catch { /* race or pre-existing — tolerated */ }
  }
  try {
    if (!(await columnExists(db, 'hr_grievances', 'against_user_id'))) {
      await db.prepare(
        'ALTER TABLE hr_grievances ADD COLUMN against_user_id INTEGER REFERENCES users(id)',
      ).run();
    }
  } catch { /* duplicate column — tolerated */ }
  _hrTablesEnsured = true;
}

// ── attachments evidence-metadata reconciler (mig 0260) ────
// FileAttachments always POSTs taken_at (and optional lat/lon). The INSERT
// lists those columns. deploy.yml applies migrations continue-on-error, so
// live D1 can still be missing them — every Dispatch Files upload then 500s
// with the generic `{ error: "Upload failed" }` banner.
let _attachmentEvidenceColumnsEnsured = false;

const ATTACHMENT_EVIDENCE_COLUMNS: Array<[string, string]> = [
  ['latitude', 'REAL'],
  ['longitude', 'REAL'],
  ['taken_at', 'TEXT'],
  ['reference_notes', 'TEXT'],
];

export async function ensureAttachmentEvidenceColumns(db: D1Database): Promise<void> {
  if (_attachmentEvidenceColumnsEnsured) return;
  for (const [col, type] of ATTACHMENT_EVIDENCE_COLUMNS) {
    try {
      if (!(await columnExists(db, 'attachments', col))) {
        await db.prepare(`ALTER TABLE attachments ADD COLUMN ${col} ${type}`).run();
      }
    } catch {
      // Race or pre-existing column — tolerated by design (CLAUDE.md rule #5).
    }
  }
  _attachmentEvidenceColumnsEnsured = await columnExists(db, 'attachments', 'taken_at').catch(() => false);
}
