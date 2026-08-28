import type { D1Database } from '@cloudflare/workers-types';
import { columnExists, execute } from '../db';

let ensured = false;

/**
 * Self-heal person-intel verification tables. deploy.yml's
 * `wrangler d1 migrations apply` aborts the whole pending batch on the
 * first duplicate-column file (0227), so 0265/0266 never reach live D1.
 * Without these tables, dossier list/detail 500s on `cross_refs_found`
 * and verified linking is a no-op.
 */
export async function ensurePersonIntelSchema(db: D1Database): Promise<void> {
  if (ensured) return;

  const run = async (sql: string) => {
    try { await execute(db, sql); } catch { /* race / already exists */ }
  };

  await run(`CREATE TABLE IF NOT EXISTS person_intel_cross_refs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dossier_id INTEGER NOT NULL,
    source TEXT NOT NULL,
    external_ref TEXT NOT NULL,
    external_url TEXT,
    label TEXT NOT NULL,
    matched_fields TEXT NOT NULL DEFAULT '[]',
    confidence REAL NOT NULL DEFAULT 0,
    is_criminal INTEGER NOT NULL DEFAULT 0,
    risk_flags TEXT NOT NULL DEFAULT '[]',
    verified_result TEXT,
    meta_json TEXT,
    captured_by INTEGER,
    captured_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (dossier_id, source, external_ref)
  )`);
  await run(`CREATE INDEX IF NOT EXISTS idx_picr_dossier ON person_intel_cross_refs(dossier_id)`);

  await run(`CREATE TABLE IF NOT EXISTS person_intel_verifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cross_ref_id INTEGER NOT NULL REFERENCES person_intel_cross_refs(id) ON DELETE CASCADE,
    method TEXT NOT NULL,
    result TEXT NOT NULL,
    evidence TEXT NOT NULL DEFAULT '',
    verified_by INTEGER NOT NULL,
    adjusted_confidence REAL NOT NULL,
    notes TEXT,
    verified_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  await run(`CREATE TABLE IF NOT EXISTS person_intel_opinions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dossier_id INTEGER REFERENCES person_intelligence(id) ON DELETE SET NULL,
    court_id TEXT NOT NULL,
    docket_number TEXT,
    r2_key TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    extracted JSON,
    extracted_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
  )`);

  for (const [table, col, type] of [
    ['person_intelligence', 'cross_refs_found', 'INTEGER DEFAULT 0'],
    ['person_intel_cross_refs', 'meta_json', 'TEXT'],
  ] as const) {
    if (!(await columnExists(db, table, col))) {
      try {
        await execute(db, `ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
      } catch { /* duplicate on a racing isolate */ }
    }
  }

  ensured = true;
}
