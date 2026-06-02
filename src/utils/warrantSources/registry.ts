// Source adapter registry.
//
// Holds the code-resident list of all known warrant source adapters and
// resolves which of them are ENABLED for a given environment by checking the
// warrant_scraper_config table (one row per configured source_name).
//
// FAIL-OPEN policy: if the config query THROWS (e.g. the table is missing on a
// cold/fresh D1), default to ALL adapters so a fresh environment still scans
// rather than silently doing nothing — officer-safety monitoring should
// over-scan, never go dark on a misconfiguration. A SUCCESSFUL query that
// returns zero rows is treated as "operator deliberately disabled everything"
// and returns [] (distinct from the error case).

import type { D1Database } from '@cloudflare/workers-types';
import type { WarrantSourceAdapter } from './types';
import { utahApiAdapter } from './adapters/utahApi';
import { adaCountyAdapter } from './adapters/adaCounty';
import { natronaAdapter } from './adapters/natrona';
import { query } from '../db';

/** All known source adapters (code-resident). */
export const ADAPTERS: WarrantSourceAdapter[] = [utahApiAdapter, adaCountyAdapter, natronaAdapter];

/**
 * Adapters that have a warrant_scraper_config row (i.e. enabled for scanning).
 *
 * - Query succeeds with rows → return the ADAPTERS whose meta.key is configured.
 * - Query succeeds with zero rows → return [] (nothing configured = nothing enabled).
 * - Query THROWS (table missing / cold D1) → fail open to ALL ADAPTERS + warn.
 */
export async function getEnabledAdapters(db: D1Database): Promise<WarrantSourceAdapter[]> {
  try {
    const rows = await query<{ source_name: string }>(
      db,
      'SELECT source_name FROM warrant_scraper_config'
    );
    const configured = new Set(rows.map((r) => r.source_name));
    return ADAPTERS.filter((a) => configured.has(a.meta.key));
  } catch (err) {
    console.warn(
      '[warrantSources.registry] getEnabledAdapters: config query failed, ' +
        'failing open to ALL adapters so the environment still scans.',
      err
    );
    return ADAPTERS;
  }
}
