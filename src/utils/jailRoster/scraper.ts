// ============================================================
// Jail Roster — scrape orchestrator (Worker-safe).
// Drives a county's parser, upserts bookings into arrest_records, maintains
// per-county circuit-breaker state in jail_roster_config, and logs each run to
// jail_roster_sync_log. runDueScrapes() is the cron entry point.
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import { query, queryFirst, execute } from '../db';
import { COUNTY_PARSERS, getAvailableParsers, type RosterEntry } from './parsers';

const CIRCUIT_THRESHOLD = 5;   // consecutive errors before the breaker trips
const UPSERT_CHUNK = 40;        // bookings per D1 batch

export interface CountyConfig {
  county: string; display_name: string; roster_url: string; roster_type: string;
  state: string; enabled: number; scrape_interval_minutes: number;
  last_scrape_at: string | null; last_sync: string | null;
  consecutive_errors: number; circuit_broken: number; is_scheduled: number;
}

// Idempotent schema reconcile — the deploy migration step is continue-on-error,
// so create the tables + the arrest upsert index at runtime too.
export async function ensureJailRosterSchema(db: D1Database): Promise<void> {
  await execute(db, `CREATE TABLE IF NOT EXISTS jail_roster_config (
    county TEXT PRIMARY KEY,
    display_name TEXT,
    roster_url TEXT,
    roster_type TEXT,
    state TEXT DEFAULT 'UT',
    enabled INTEGER DEFAULT 0,
    scrape_interval_minutes INTEGER DEFAULT 60,
    last_scrape_at TEXT,
    last_sync TEXT,
    consecutive_errors INTEGER DEFAULT 0,
    circuit_broken INTEGER DEFAULT 0,
    is_scheduled INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS jail_roster_sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    county TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    status TEXT,
    records_found INTEGER DEFAULT 0,
    records_new INTEGER DEFAULT 0,
    error TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  await execute(db, `CREATE INDEX IF NOT EXISTS idx_jrsl_county ON jail_roster_sync_log(county, id DESC)`);
  // arrest_records is empty on live; the unique index makes the ON CONFLICT
  // upsert below safe + idempotent across re-scrapes.
  await execute(db, `CREATE UNIQUE INDEX IF NOT EXISTS idx_arrest_jailbase_source ON arrest_records(jailbase_id, source_id)`);
}

export async function getCountyConfigs(db: D1Database): Promise<CountyConfig[]> {
  return query<CountyConfig>(db, 'SELECT * FROM jail_roster_config ORDER BY state, display_name');
}

export async function getCountyConfig(db: D1Database, county: string): Promise<CountyConfig | null> {
  return queryFirst<CountyConfig>(db, 'SELECT * FROM jail_roster_config WHERE county = ?', county);
}

// Upsert a county's current roster into arrest_records. Returns rows written.
async function upsertEntries(db: D1Database, cfg: CountyConfig, entries: RosterEntry[]): Promise<number> {
  let written = 0;
  for (let i = 0; i < entries.length; i += UPSERT_CHUNK) {
    const chunk = entries.slice(i, i + UPSERT_CHUNK);
    const stmts = chunk.map((e) => {
      const jailbaseId = `roster-${cfg.county}-${e.roster_id}`;
      const bail = e.bail_amount ? parseFloat(e.bail_amount.replace(/[$,]/g, '')) || 0 : 0;
      return db.prepare(
        `INSERT INTO arrest_records
           (jailbase_id, source_id, source_name, full_name, first_name, last_name, middle_name,
            booking_date, charges, gender, bail_amount, county, state, status, entry_source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'scraper', datetime('now'), datetime('now'))
         ON CONFLICT(jailbase_id, source_id) DO UPDATE SET
           full_name=excluded.full_name, booking_date=excluded.booking_date, charges=excluded.charges,
           gender=excluded.gender, bail_amount=excluded.bail_amount, state=excluded.state,
           status='active', updated_at=datetime('now')`
      ).bind(
        jailbaseId, cfg.county, cfg.display_name, e.full_name, e.first_name, e.last_name, e.middle_name,
        e.booking_date, JSON.stringify(e.charges), e.gender, bail, cfg.county, cfg.state
      );
    });
    if (stmts.length) { await db.batch(stmts); written += stmts.length; }
  }
  return written;
}

export interface ScrapeResult { success: boolean; message: string; found?: number; written?: number }

// Scrape a single county end-to-end with circuit-breaker + sync-log bookkeeping.
export async function scrapeCounty(db: D1Database, county: string): Promise<ScrapeResult> {
  const cfg = await getCountyConfig(db, county);
  if (!cfg) return { success: false, message: 'Unknown county' };
  const parser = COUNTY_PARSERS[county];
  if (!parser) {
    await execute(db, `UPDATE jail_roster_config SET enabled=0, updated_at=datetime('now') WHERE county=?`, county);
    return { success: false, message: 'No parser registered — county disabled' };
  }

  const startedAt = new Date().toISOString();
  try {
    const entries = await parser.scrape();
    const written = await upsertEntries(db, cfg, entries);
    await execute(db,
      `UPDATE jail_roster_config
          SET last_scrape_at=datetime('now'), last_sync=datetime('now'),
              consecutive_errors=0, circuit_broken=0, updated_at=datetime('now')
        WHERE county=?`, county);
    await execute(db,
      `INSERT INTO jail_roster_sync_log (county, started_at, finished_at, status, records_found, records_new)
       VALUES (?, ?, datetime('now'), 'success', ?, ?)`,
      county, startedAt, entries.length, written);
    return { success: true, message: `Scraped ${entries.length} bookings`, found: entries.length, written };
  } catch (err) {
    const errors = (cfg.consecutive_errors || 0) + 1;
    const broken = errors >= CIRCUIT_THRESHOLD ? 1 : 0;
    await execute(db,
      `UPDATE jail_roster_config SET consecutive_errors=?, circuit_broken=?, updated_at=datetime('now') WHERE county=?`,
      errors, broken, county);
    await execute(db,
      `INSERT INTO jail_roster_sync_log (county, started_at, finished_at, status, error)
       VALUES (?, ?, datetime('now'), 'error', ?)`,
      county, startedAt, (err as Error)?.message?.slice(0, 500) ?? 'scrape failed');
    return { success: false, message: `Scrape failed${broken ? ' — circuit broken' : ''}: ${(err as Error)?.message}` };
  }
}

export async function resetCountyErrors(db: D1Database, county: string): Promise<boolean> {
  const r = await execute(db,
    `UPDATE jail_roster_config SET consecutive_errors=0, circuit_broken=0, updated_at=datetime('now') WHERE county=?`, county);
  return (r.meta?.changes ?? 0) > 0;
}

export async function updateCountyConfig(
  db: D1Database, county: string, updates: { enabled?: boolean; scrape_interval_minutes?: number }
): Promise<boolean> {
  const sets: string[] = []; const vals: unknown[] = [];
  if (updates.enabled !== undefined) { sets.push('enabled=?'); vals.push(updates.enabled ? 1 : 0); }
  if (updates.scrape_interval_minutes !== undefined) { sets.push('scrape_interval_minutes=?'); vals.push(updates.scrape_interval_minutes); }
  if (!sets.length) return false;
  sets.push(`updated_at=datetime('now')`);
  const r = await execute(db, `UPDATE jail_roster_config SET ${sets.join(', ')} WHERE county=?`, ...vals, county);
  return (r.meta?.changes ?? 0) > 0;
}

export async function getStatus(db: D1Database) {
  const counties = await getCountyConfigs(db);
  const parsers = getAvailableParsers();
  return {
    counties: counties.map((c) => ({ ...c, has_parser: parsers.includes(c.county) })),
    available_parsers: parsers,
  };
}

export async function getStatistics(db: D1Database) {
  const totals = await queryFirst<{ counties: number; enabled: number; broken: number }>(db,
    `SELECT COUNT(*) counties, SUM(enabled) enabled, SUM(circuit_broken) broken FROM jail_roster_config`);
  const bookings = await queryFirst<{ n: number }>(db,
    `SELECT COUNT(*) n FROM arrest_records WHERE entry_source='scraper' AND status='active'`);
  const recent = await query<Record<string, unknown>>(db,
    `SELECT county, status, records_found, records_new, finished_at, error
       FROM jail_roster_sync_log ORDER BY id DESC LIMIT 20`);
  return {
    counties: totals?.counties ?? 0, enabled: totals?.enabled ?? 0, circuit_broken: totals?.broken ?? 0,
    active_bookings: bookings?.n ?? 0, recent_syncs: recent,
  };
}

// Cron entry point: scrape the single most-overdue enabled, unbroken county.
// One per tick keeps Worker subrequest/CPU use bounded.
export async function runDueScrapes(db: D1Database): Promise<{ ran: string | null }> {
  await ensureJailRosterSchema(db);
  const due = await queryFirst<{ county: string }>(db,
    `SELECT county FROM jail_roster_config
      WHERE enabled=1 AND circuit_broken=0
        AND (last_scrape_at IS NULL
             OR julianday('now') - julianday(last_scrape_at) >= scrape_interval_minutes / 1440.0)
      ORDER BY (last_scrape_at IS NULL) DESC, last_scrape_at ASC
      LIMIT 1`);
  if (!due) return { ran: null };
  await scrapeCounty(db, due.county);
  return { ran: due.county };
}
