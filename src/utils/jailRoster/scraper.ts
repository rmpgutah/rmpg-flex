// ============================================================
// Jail Roster — scrape orchestrator (Worker-safe).
// Drives a county's parser, upserts bookings into arrest_records, maintains
// per-county circuit-breaker state in jail_roster_config, and logs each run to
// jail_roster_sync_log. runDueScrapes() is the cron entry point.
// ============================================================

import type { D1Database, KVNamespace } from '@cloudflare/workers-types';
import { query, queryFirst, execute } from '../db';
import {
  COUNTY_PARSERS, getAvailableParsers, type RosterEntry,
  openSaltLakeSession, fetchSaltLakeDetail,
} from './parsers';

const CIRCUIT_THRESHOLD = 5;   // consecutive errors before the breaker trips
const UPSERT_CHUNK = 40;        // bookings per D1 batch

// Detail-enrichment tuning (Salt Lake). Steady + polite: a small batch per
// per-minute cron tick with a short delay between profile fetches, so the full
// roster fills in over ~30 min without hammering the county server.
const ENRICH_BATCH = 20;
const ENRICH_DELAY_MS = 600;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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
      // raw_record carries the detail tokens (sysID/imgSysID) so the enrichment
      // pass can fetch the full profile document. detail_at (added by enrichment)
      // marks a row as already scraped; we preserve it across re-scrapes.
      const rawRecord = JSON.stringify({ sysID: e.sys_id ?? '', imgSysID: e.img_sys_id ?? '' });
      return db.prepare(
        `INSERT INTO arrest_records
           (jailbase_id, source_id, source_name, full_name, first_name, last_name, middle_name,
            booking_date, date_of_birth, charges, gender, bail_amount, county, state, status, entry_source, raw_record, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'scraper', ?, datetime('now'), datetime('now'))
         ON CONFLICT(jailbase_id, source_id) DO UPDATE SET
           full_name=excluded.full_name,
           -- Listing carries no date/charges/bond; never overwrite enriched
           -- detail with the listing's empty values.
           booking_date=COALESCE(NULLIF(excluded.booking_date,''), arrest_records.booking_date),
           date_of_birth=COALESCE(NULLIF(excluded.date_of_birth,''), arrest_records.date_of_birth),
           charges=CASE WHEN excluded.charges IN ('[]','') THEN arrest_records.charges ELSE excluded.charges END,
           gender=COALESCE(NULLIF(excluded.gender,''), arrest_records.gender),
           bail_amount=CASE WHEN excluded.bail_amount=0 THEN arrest_records.bail_amount ELSE excluded.bail_amount END,
           state=excluded.state, status='active',
           -- Refresh the detail tokens but keep detail_at (don't force re-scrape).
           raw_record=json_set(
             json_set(COALESCE(NULLIF(arrest_records.raw_record,''),'{}'),
               '$.sysID', json_extract(excluded.raw_record,'$.sysID')),
               '$.imgSysID', json_extract(excluded.raw_record,'$.imgSysID')),
           updated_at=datetime('now')`
      ).bind(
        jailbaseId, cfg.county, cfg.display_name, e.full_name, e.first_name, e.last_name, e.middle_name,
        e.booking_date, e.date_of_birth ?? '', JSON.stringify(e.charges), e.gender, bail, cfg.county, cfg.state,
        rawRecord
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

  // Population summary + per-county breakdown over the whole arrest_records table
  // (what the Arrest Records page lists). The previous shape omitted these, so the
  // page's summary cards + county stats sat at 0 while the list showed the real
  // rows. booking_date/release_date are '' for name-only scraper rows, so the
  // date() comparisons safely yield 0 rather than miscounting. Best-effort: a
  // missing arrest_records table (fresh env) degrades to empty stats, not a 500.
  let population_summary = {
    total_records: 0, total_active: 0, total_released: 0,
    counties_with_data: 0, intakes_today: 0, releases_today: 0,
  };
  let per_county: Record<string, unknown>[] = [];
  try {
    const pop = await queryFirst<typeof population_summary>(db, `
      SELECT
        COUNT(*) total_records,
        SUM(CASE WHEN status='active'   THEN 1 ELSE 0 END) total_active,
        SUM(CASE WHEN status='released' THEN 1 ELSE 0 END) total_released,
        COUNT(DISTINCT NULLIF(county,'')) counties_with_data,
        SUM(CASE WHEN date(NULLIF(booking_date,'')) = date('now') THEN 1 ELSE 0 END) intakes_today,
        SUM(CASE WHEN date(NULLIF(release_date,'')) = date('now') THEN 1 ELSE 0 END) releases_today
      FROM arrest_records`);
    if (pop) population_summary = {
      total_records: pop.total_records ?? 0, total_active: pop.total_active ?? 0,
      total_released: pop.total_released ?? 0, counties_with_data: pop.counties_with_data ?? 0,
      intakes_today: pop.intakes_today ?? 0, releases_today: pop.releases_today ?? 0,
    };
    const rows = await query<Record<string, unknown>>(db, `
      SELECT
        county,
        COALESCE(NULLIF(source_name,''), county) display_name,
        COUNT(*) total_records,
        SUM(CASE WHEN status='active'   THEN 1 ELSE 0 END) active_count,
        SUM(CASE WHEN status='released' THEN 1 ELSE 0 END) released_count,
        MIN(NULLIF(booking_date,'')) earliest_booking,
        MAX(NULLIF(booking_date,'')) newest_booking,
        SUM(CASE WHEN lower(gender) IN ('m','male')   THEN 1 ELSE 0 END) male_count,
        SUM(CASE WHEN lower(gender) IN ('f','female') THEN 1 ELSE 0 END) female_count,
        SUM(CASE WHEN NULLIF(date_of_birth,'') IS NOT NULL THEN 1 ELSE 0 END) details_fetched
      FROM arrest_records
      WHERE NULLIF(county,'') IS NOT NULL
      GROUP BY county, display_name
      ORDER BY total_records DESC`);
    per_county = rows.map((r) => ({ ...r, avg_stay_days: null }));
  } catch { /* arrest_records absent on a fresh env — return empty stats */ }

  return {
    counties: totals?.counties ?? 0, enabled: totals?.enabled ?? 0, circuit_broken: totals?.broken ?? 0,
    active_bookings: bookings?.n ?? 0, recent_syncs: recent,
    population_summary, per_county,
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

// ── Salt Lake detail enrichment ─────────────────────────────
// The listing scrape stores only name + booking # + the detail tokens. This
// pass fetches each inmate's full profile document (booking date, charges,
// bond) and writes it back. Bounded per call (ENRICH_BATCH) + polite delay so
// the per-minute cron drains the backlog steadily without hammering IML.

// Rows scraped from Salt Lake that still need their profile document fetched
// (have a sysID token, not yet stamped detail_at).
const PENDING_DETAIL_WHERE =
  `source_id='salt_lake' AND entry_source='scraper'
     AND json_extract(raw_record,'$.sysID') IS NOT NULL
     AND json_extract(raw_record,'$.sysID') <> ''
     AND json_extract(raw_record,'$.detail_at') IS NULL`;

export async function countPendingSaltLakeDetails(db: D1Database): Promise<number> {
  const r = await queryFirst<{ n: number }>(db,
    `SELECT COUNT(*) n FROM arrest_records WHERE ${PENDING_DETAIL_WHERE}`);
  return r?.n ?? 0;
}

export async function enrichSaltLakeDetails(
  db: D1Database, limit = ENRICH_BATCH,
): Promise<{ enriched: number; attempted: number; remaining: number }> {
  const due = await query<{ id: number; raw_record: string }>(db,
    `SELECT id, raw_record FROM arrest_records
      WHERE ${PENDING_DETAIL_WHERE}
      ORDER BY id DESC LIMIT ?`, limit);
  if (!due.length) return { enriched: 0, attempted: 0, remaining: 0 };

  let cookie: string;
  try {
    cookie = await openSaltLakeSession();
  } catch {
    return { enriched: 0, attempted: 0, remaining: await countPendingSaltLakeDetails(db) };
  }

  let enriched = 0;
  let attempted = 0;
  for (const row of due) {
    let sysID = '', imgSysID = '';
    try { const r = JSON.parse(row.raw_record || '{}'); sysID = r.sysID || ''; imgSysID = r.imgSysID || ''; } catch { /* skip */ }
    if (!sysID) continue;
    attempted++;

    const detail = await fetchSaltLakeDetail(cookie, sysID, imgSysID);
    // Always stamp detail_at so a blank/gone record isn't retried forever.
    const detailAt = new Date().toISOString();
    if (detail) {
      const raw = JSON.stringify({ sysID, imgSysID, detail_at: detailAt, detail });
      await execute(db,
        `UPDATE arrest_records SET
           booking_date=COALESCE(NULLIF(?,''), booking_date),
           charges=CASE WHEN ?='[]' THEN charges ELSE ? END,
           bail_amount=CASE WHEN ?=0 THEN bail_amount ELSE ? END,
           raw_record=?, updated_at=datetime('now')
         WHERE id=?`,
        detail.booking_date,
        JSON.stringify(detail.charges), JSON.stringify(detail.charges),
        detail.bail_amount, detail.bail_amount,
        raw, row.id);
      enriched++;
    } else {
      const raw = JSON.stringify({ sysID, imgSysID, detail_at: detailAt });
      await execute(db,
        `UPDATE arrest_records SET raw_record=?, updated_at=datetime('now') WHERE id=?`,
        raw, row.id);
    }
    if (attempted < due.length) await sleep(ENRICH_DELAY_MS);
  }

  return { enriched, attempted, remaining: await countPendingSaltLakeDetails(db) };
}

// Cron-friendly wrapper: KV-locked (prevents overlapping per-minute ticks) and
// cheap when there's nothing to do. No-ops without a KV binding.
export async function maybeEnrichSaltLakeDetails(
  env: { DB: D1Database; KV?: KVNamespace },
): Promise<{ enriched: number; attempted: number; remaining: number } | null> {
  if (await countPendingSaltLakeDetails(env.DB) === 0) return null;
  const LOCK = 'jail_enrich_lock_salt_lake';
  if (env.KV) {
    if (await env.KV.get(LOCK)) return null;           // a tick is already running
    await env.KV.put(LOCK, '1', { expirationTtl: 120 });
  }
  try {
    return await enrichSaltLakeDetails(env.DB);
  } finally {
    if (env.KV) await env.KV.delete(LOCK).catch(() => {});
  }
}
