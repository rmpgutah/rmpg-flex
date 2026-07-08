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
import { fbiAdapter } from './adapters/fbi';
import { utahCountyAdapter } from './adapters/utahCounty';
import { ohioPvalAdapter } from './adapters/ohioPval';
import { getConfigAdapters } from './configRegistry';
import { query } from '../db';

/** All known source adapters (code-resident). */
export const ADAPTERS: WarrantSourceAdapter[] = [utahApiAdapter, adaCountyAdapter, natronaAdapter, fbiAdapter, utahCountyAdapter, ohioPvalAdapter];

/**
 * Adapters that have an ENABLED warrant_scraper_config row (enabled = 1).
 *
 * - Query succeeds with rows → return the ADAPTERS whose meta.key has an
 *   enabled config row. A row with enabled = 0 (operator disabled it via the
 *   AdminWarrantScrapersTab bulk-action UI, see migration 0151) is excluded —
 *   having a config row is NOT the same as being enabled.
 * - Query succeeds with zero rows → return [] (nothing enabled).
 * - Query THROWS (table missing / cold D1) → fail open to ALL ADAPTERS + warn.
 */
export async function getEnabledAdapters(db: D1Database): Promise<WarrantSourceAdapter[]> {
  try {
    const rows = await query<{ source_name: string }>(
      db,
      'SELECT source_name FROM warrant_scraper_config WHERE enabled = 1'
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

/**
 * Full enabled set = configured code adapters (getEnabledAdapters) + the
 * always-on federal/home code adapters (fbi, utah-county) + config-row adapters
 * (national_warrant_sources). Deduped by meta.key.
 */
export async function getAllEnabledAdapters(db: D1Database): Promise<WarrantSourceAdapter[]> {
  const code = await getEnabledAdapters(db);
  const config = await getConfigAdapters(db);
  const always = ADAPTERS.filter((a) => a.meta.family === 'fbi' || a.meta.family === 'utah-county');
  const byKey = new Map<string, WarrantSourceAdapter>();
  for (const a of [...code, ...always, ...config]) byKey.set(a.meta.key, a);
  return [...byKey.values()];
}
