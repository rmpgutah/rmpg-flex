import type { D1Database } from '@cloudflare/workers-types';
import { query, execute } from '../db';
import { getAdapterForJurisdiction } from './registry';
import { log } from '../logger';

const MAX_PER_RUN = 25;
const FETCH_TIMEOUT_MS = 10_000;

export interface EnrichmentSummary {
  attempted: number;
  succeeded: number;
  failed: number;
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Backfills offense/risk_level/tier/registration_status on
 * national_sex_offenders rows for the 6 supported jurisdictions, by
 * fetching each row's already-known detail_url and running it through the
 * matching state's pure parser. Bounded to MAX_PER_RUN rows per invocation
 * (this runs inside a Worker cron tick, not an unbounded background job).
 * A per-row failure (network error, no matching adapter) never aborts the
 * batch — matches the existing warrant-poller pattern.
 */
export async function enrichPendingOffenders(db: D1Database): Promise<EnrichmentSummary> {
  const rows = await query<{ id: number; jurisdiction: string; detail_url: string }>(
    db,
    `SELECT id, jurisdiction, detail_url FROM national_sex_offenders
     WHERE jurisdiction IN ('UT','ID','NV','WY','CO','AZ')
       AND detail_url IS NOT NULL AND detail_url != ''
       AND offense IS NULL
     LIMIT ?`,
    MAX_PER_RUN,
  );

  let attempted = 0;
  let succeeded = 0;
  let failed = 0;

  for (const row of rows) {
    const adapter = getAdapterForJurisdiction(row.jurisdiction);
    if (!adapter) continue; // no matching state parser — skip silently, not a failure

    attempted++;
    try {
      const res = await fetchWithTimeout(row.detail_url, FETCH_TIMEOUT_MS);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const html = await res.text();
      const parsed = adapter.parseDetailPage(html);

      await execute(
        db,
        `UPDATE national_sex_offenders
         SET offense = ?, risk_level = ?, tier = ?, registration_status = ?, updated_at = datetime('now')
         WHERE id = ?`,
        parsed.offense, parsed.risk_level, parsed.tier, parsed.registration_status, row.id,
      );
      await execute(
        db,
        `INSERT INTO sor_enrichment_runs
         (offender_id, jurisdiction, detail_url, success, http_status, parsed_offense, parsed_risk_level, raw_snippet)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?)`,
        row.id, row.jurisdiction, row.detail_url, res.status,
        parsed.offense, parsed.risk_level, html.slice(0, 2000),
      );
      succeeded++;
    } catch (err) {
      failed++;
      log.error('SOR enrichment row failed', { jurisdiction: row.jurisdiction, offenderId: row.id }, err);
      await execute(
        db,
        `INSERT INTO sor_enrichment_runs
         (offender_id, jurisdiction, detail_url, success, error_message)
         VALUES (?, ?, ?, 0, ?)`,
        row.id, row.jurisdiction, row.detail_url,
        err instanceof Error ? err.message : String(err),
      ).catch(() => {}); // logging the failure must never itself throw and abort the batch
    }
  }

  return { attempted, succeeded, failed };
}
