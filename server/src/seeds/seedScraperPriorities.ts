// ============================================================
// RMPG Flex — Warrant Scraper Priority Tier Seeder
// ============================================================
// Assigns priority tiers to existing warrant_scraper_config rows:
//   Tier 1: FBI + Utah state + SLC metro (highest priority)
//   Tier 2: Other UT counties + Denver + LV + Phoenix area
//   Tier 3: Default (everything else, left unchanged)
//   Tier 4: Low-volume states (AK, HI, ND, SD, VT, WY, ME)
// Safe to re-run — only updates rows where priority IS NULL or = 3.
// ============================================================

import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { argv } from 'node:process';
import { getDb } from '../models/database';

// both legacy and current keys for FBI
const TIER_1_SOURCES = new Set<string>([
  'federal_fbi_wanted',
  'fed_fbi_wanted',
  'utah_state_warrants',
  'ut_slc_metro_warrants',
]);

const TIER_2_EXPLICIT_SOURCES = new Set<string>([
  'co_denver_warrants',
  'nv_clark_warrants',
  'nv_washoe_warrants',
  'az_maricopa_warrants',
  'az_pima_warrants',
]);

const TIER_4_LOW_STATES = new Set<string>([
  'HI',
  'AK',
  'ND',
  'SD',
  'VT',
  'WY',
  'ME',
]);

interface ScraperRow {
  source_key: string;
  state: string | null;
  priority: number | null;
}

function determineTier(sourceKey: string, state: string | null): number | null {
  if (TIER_1_SOURCES.has(sourceKey)) {
    return 1;
  }
  // Order matters: SLC metro (ut_slc_metro_warrants) is caught by TIER_1_SOURCES above
  // before falling into this ut_ prefix check, so it stays tier 1.
  if (TIER_2_EXPLICIT_SOURCES.has(sourceKey) || sourceKey.startsWith('ut_')) {
    return 2;
  }
  if (state && TIER_4_LOW_STATES.has(state)) {
    return 4;
  }
  // Stays at tier 3 (default) — don't update
  return null;
}

export function seedScraperPriorities(
  dbOverride?: Database.Database
): { updated: number } {
  const db = dbOverride ?? getDb();

  const rows = db
    .prepare(
      'SELECT source_key, state, priority FROM warrant_scraper_config WHERE priority IS NULL OR priority = 3'
    )
    .all() as ScraperRow[];

  const updateStmt = db.prepare(
    'UPDATE warrant_scraper_config SET priority = ? WHERE source_key = ?'
  );

  let updated = 0;
  for (const row of rows) {
    const tier = determineTier(row.source_key, row.state);
    if (tier !== null) {
      updateStmt.run(tier, row.source_key);
      updated++;
    }
  }

  return { updated };
}

// Allow running as a script: `npx tsx src/seeds/seedScraperPriorities.ts`
// Run as CLI when invoked directly (ESM equivalent of require.main === module)
const isMain = fileURLToPath(import.meta.url) === argv[1];
if (isMain) {
  const result = seedScraperPriorities();
  console.log(`[Scraper Priority Seed] Updated ${result.updated} sources`);
  process.exit(0);
}
