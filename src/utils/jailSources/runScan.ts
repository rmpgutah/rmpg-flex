// Jail roster scan orchestrator (Intel Wave 3a).
// Seeds the registry, then for each ACTIVE source fetches recent bookings
// and ingests+cross-hits them. Every source is try/catch-isolated and
// records its own last_status so one bad source never aborts the rest or
// throws the cron.
import type { D1Database } from '@cloudflare/workers-types';
import { query, execute } from '../db';
import { ingestBookings } from '../jailIngest';
import { seedJailSources } from './seed';
import { vinelinkAdapter } from './adapters/vinelink';
import { udcCredentialedAdapter } from './adapters/credentialed';
import type { JailSourceAdapter } from './types';

// UDC now runs as a credentialed adapter (live the moment an authorized feed
// URL/token lands in system_config); vinelink stays as a degrade-to-[] portal.
const ADAPTERS: JailSourceAdapter[] = [udcCredentialedAdapter, vinelinkAdapter];

export interface JailScanSummary { source_key: string; fetched: number; ingested: number; matched: number; alerts: number; status: string }

export async function runJailScan(env: { DB: D1Database } & Record<string, unknown>): Promise<JailScanSummary[]> {
  const db = env.DB;
  const summaries: JailScanSummary[] = [];
  try { await seedJailSources(db); }
  catch (err: any) { console.error('[jail-scan] seed failed:', err?.message); }

  let active: Set<string>;
  try {
    const rows = await query<any>(db, "SELECT source_key FROM jail_roster_sources WHERE status = 'active'");
    active = new Set(rows.map((r) => r.source_key));
  } catch (err: any) {
    console.error('[jail-scan] registry read failed (migration drift?):', err?.message);
    return summaries;
  }

  for (const adapter of ADAPTERS) {
    if (!active.has(adapter.meta.key)) continue;
    let status = 'ok', fetched = 0, ingested = 0, matched = 0, alerts = 0;
    try {
      const bookings = await adapter.fetchRecent(env);
      fetched = bookings.length;
      if (bookings.length) {
        const r = await ingestBookings(db, bookings, 'roster_scrape');
        ingested = r.ingested; matched = r.matched; alerts = r.alerts;
      } else {
        status = 'no_data';
      }
    } catch (err: any) {
      status = `error: ${err?.message || 'unknown'}`.slice(0, 200);
      console.error(`[jail-scan] ${adapter.meta.key} failed:`, err?.message);
    }
    try {
      await execute(db,
        `UPDATE jail_roster_sources SET last_run_at = datetime('now'), last_status = ?, row_count = row_count + ?, updated_at = datetime('now') WHERE source_key = ?`,
        status, ingested, adapter.meta.key);
    } catch (err: any) { console.error('[jail-scan] status update failed:', err?.message); }
    summaries.push({ source_key: adapter.meta.key, fetched, ingested, matched, alerts, status });
  }
  return summaries;
}
