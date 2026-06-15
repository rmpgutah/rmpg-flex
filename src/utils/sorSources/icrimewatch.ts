import type { D1Database } from '@cloudflare/workers-types';
import type { Bindings } from '../../types';
import { execute, queryFirst } from '../db';
import { firecrawlScrapeHtml, FirecrawlConfigError } from '../browserFetch';
import { parseIcrimewatchDetail, extractOfndrIds, type SorScrapeRow } from './parseIcrimewatch';

const AGENCY = '54438';
const BASE = 'https://www.icrimewatch.net';
const MAX_PER_RUN = 2_000;
const PER_PAGE_DELAY_MS = 1_200;
const INCREMENTAL_STOP_STREAK = 25;

export function buildSearchUrl(lastName?: string): string {
  return lastName
    ? `${BASE}/results.php?AgencyID=${AGENCY}&lname=${encodeURIComponent(lastName)}`
    : `${BASE}/results.php?SubmitAllSearch=1&AgencyID=${AGENCY}`;
}

export function buildDetailUrl(ofndrId: string): string {
  return `${BASE}/offenderdetails.php?OfndrID=${encodeURIComponent(ofndrId)}&AgencyID=${AGENCY}`;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let detailColEnsured = false;
async function ensureDetailColumn(db: D1Database): Promise<void> {
  if (detailColEnsured) return;
  await execute(db, 'ALTER TABLE utah_sex_offenders ADD COLUMN detail_json TEXT').catch(() => {});
  detailColEnsured = true;
}

async function upsertRow(db: D1Database, r: SorScrapeRow): Promise<void> {
  const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM utah_sex_offenders WHERE registry_id = ?', r.registry_id);
  if (existing) {
    await execute(db, `UPDATE utah_sex_offenders SET first_name=?, middle_name=?, last_name=?, date_of_birth=?,
        sex=?, race=?, height=?, weight=?, hair_color=?, eye_color=?, scars_marks=?, address=?, city=?, state=?,
        zip=?, offense=?, registration_status=?, photo_url=?, detail_json=?, source='ICRIMEWATCH',
        last_seen_at=datetime('now'), updated_at=datetime('now') WHERE id=?`,
      r.first_name, r.middle_name, r.last_name, r.date_of_birth, r.sex, r.race, r.height, r.weight,
      r.hair_color, r.eye_color, r.scars_marks, r.address, r.city, r.state, r.zip, r.offense,
      r.registration_status, r.photo_url, r.detail_json, existing.id);
  } else {
    await execute(db, `INSERT INTO utah_sex_offenders (registry_id, first_name, middle_name, last_name, date_of_birth,
        sex, race, height, weight, hair_color, eye_color, scars_marks, address, city, state, zip, offense,
        registration_status, photo_url, detail_json, source, last_seen_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'ICRIMEWATCH', datetime('now'))`,
      r.registry_id, r.first_name, r.middle_name, r.last_name, r.date_of_birth, r.sex, r.race, r.height,
      r.weight, r.hair_color, r.eye_color, r.scars_marks, r.address, r.city, r.state, r.zip, r.offense,
      r.registration_status, r.photo_url, r.detail_json);
  }
}

export interface IcwScanOpts { mode?: 'incremental' | 'full' | 'name'; lastName?: string }
export interface IcwScanResult { configured: boolean; seen: number; upserted: number; error?: string }

/**
 * Scrape iCrimeWatch agency 54438 via Firecrawl into utah_sex_offenders.
 * configured:false (no-op) when FIRECRAWL_API_KEY is unset.
 */
export async function runIcrimewatchScan(env: Bindings, opts: IcwScanOpts = {}): Promise<IcwScanResult> {
  const db = env.DB;
  await ensureDetailColumn(db);
  let seen = 0, upserted = 0;
  try {
    const searchHtml = await firecrawlScrapeHtml(env, buildSearchUrl(opts.lastName));
    const ids = extractOfndrIds(searchHtml).slice(0, MAX_PER_RUN);
    if (ids.length === 0) {
      throw new Error('Search page returned no OfndrID links — possible block or empty registry');
    }
    let unchangedStreak = 0;
    for (const id of ids) {
      seen++;
      try {
        const detailHtml = await firecrawlScrapeHtml(env, buildDetailUrl(id));
        const row = parseIcrimewatchDetail(detailHtml, id);
        if (!row.last_name && !row.first_name) continue;
        await upsertRow(db, row);
        upserted++;
        if (opts.mode === 'incremental') {
          const known = await queryFirst<{ id: number }>(db, 'SELECT id FROM utah_sex_offenders WHERE registry_id = ?', id);
          if (known) { unchangedStreak++; if (unchangedStreak >= INCREMENTAL_STOP_STREAK) break; } else { unchangedStreak = 0; }
        }
      } catch (err) { console.warn(`[icw] OfndrID ${id} failed:`, err); }
      await sleep(PER_PAGE_DELAY_MS);
    }
    await execute(db, `INSERT INTO utah_sor_runs (status, records_seen, records_upserted, detail)
      VALUES ('ok', ?, ?, ?)`, seen, upserted, `icrimewatch agency=${AGENCY} mode=${opts.mode ?? 'incremental'}`);
    return { configured: true, seen, upserted };
  } catch (err) {
    if (err instanceof FirecrawlConfigError) return { configured: false, seen, upserted };
    const msg = err instanceof Error ? err.message : String(err);
    await execute(db, `INSERT INTO utah_sor_runs (status, records_seen, records_upserted, detail)
      VALUES ('error', ?, ?, ?)`, seen, upserted, `icrimewatch: ${msg.slice(0, 180)}`).catch(() => {});
    return { configured: true, seen, upserted, error: msg };
  }
}

