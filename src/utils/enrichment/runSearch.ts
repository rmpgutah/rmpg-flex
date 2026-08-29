import { query, queryFirst, execute } from '../db';
import { computeCacheKey } from './normalize';
import { hardLock } from './matcher';
import type { EnrichmentSeed, EnrichmentResponse, SourceResult, EnrichedRecord } from './types';
import type { Bindings } from '../../types';
import { OPEN_SOURCE_ENRICHMENT_SOURCES, type EnrichmentSourceDefinition } from './catalog';

/** Sources that work without a person name (address-only enrichment). */
const ADDRESS_ONLY_SOURCES = new Set(['census_geocoder', 'sl_assessor']);

export function seedHasPersonName(seed: EnrichmentSeed): boolean {
  return Boolean(seed.first_name?.trim() && seed.last_name?.trim());
}

function sourcesForSeed(
  sources: EnrichmentSourceDefinition[],
  seed: EnrichmentSeed,
): EnrichmentSourceDefinition[] {
  if (seedHasPersonName(seed)) return sources;
  if (seed.address?.trim()) {
    return sources.filter(s => ADDRESS_ONLY_SOURCES.has(s.key));
  }
  return sources;
}

export interface RunEnrichmentSearchOptions {
  sources?: EnrichmentSourceDefinition[];
  searchedBy?: number | null;
  useCache?: boolean;
}

export async function runEnrichmentSearch(
  db: D1Database,
  env: Record<string, unknown>,
  seed: EnrichmentSeed,
  options: RunEnrichmentSearchOptions = {},
): Promise<EnrichmentResponse> {
  const sources = sourcesForSeed(options.sources ?? OPEN_SOURCE_ENRICHMENT_SOURCES, seed);
  const useCache = options.useCache !== false;
  const cacheKey = await computeCacheKey(seed);
  const now = new Date();

  if (useCache) {
    const cached = await queryFirst<{
      results_json: string; expires_at: string;
    }>(db,
      `SELECT results_json, expires_at FROM enrichment_cache WHERE cache_key = ?`, cacheKey);
    if (cached) {
      const isStale = new Date(cached.expires_at) < now;
      const parsed = JSON.parse(cached.results_json) as EnrichmentResponse;
      return { ...parsed, cached: true, stale: isStale };
    }
  }

  const knownCityStates: string[] = [];
  const personRows = await query<{ city: string | null; state: string | null }>(
    db,
    `SELECT city, state FROM persons
     WHERE lower(trim(first_name)) = ? AND lower(trim(last_name)) = ? LIMIT 20`,
    seed.first_name.toLowerCase(), seed.last_name.toLowerCase(),
  );
  for (const r of personRows) {
    if (r.city && r.state) knownCityStates.push(`${r.city.toLowerCase()}|${r.state.toLowerCase()}`);
  }

  const settled = await Promise.allSettled(
    sources.map(s => s.mod.search(seed, env as Bindings)),
  );

  const sourceResults: SourceResult[] = settled.map((r, i) =>
    r.status === 'fulfilled' ? r.value : {
      source: sources[i].key, ok: false, latency_ms: 0, records: [],
      error: r.reason instanceof Error ? r.reason.message : 'unknown',
    },
  );

  const confirmedRecords: EnrichedRecord[] = [];
  const unconfirmedRecords: EnrichedRecord[] = [];
  let confirmedCount = 0;
  const allAnchors = new Set<string>();

  for (const src of sourceResults) {
    for (const rec of src.records) {
      const lock = hardLock(seed, rec, knownCityStates);
      if (lock.confirmed) {
        confirmedCount++;
        lock.anchors.forEach(a => allAnchors.add(a));
        confirmedRecords.push(rec);
      } else {
        unconfirmedRecords.push(rec);
      }
    }
  }

  const matchTier = confirmedCount > 0 ? 'CONFIRMED' : 'UNCONFIRMED';
  const searchedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  const response: EnrichmentResponse = {
    match_tier: matchTier,
    anchors: Array.from(allAnchors),
    sources: sourceResults,
    records: [...confirmedRecords, ...unconfirmedRecords],
    confirmed_count: confirmedCount,
    cached: false,
    stale: false,
    searched_at: searchedAt,
  };

  await execute(db,
    `INSERT INTO enrichment_cache
       (cache_key, seed_json, results_json, match_tier, anchors_json, source_count, searched_at, expires_at, searched_by)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(cache_key) DO UPDATE SET
       results_json=excluded.results_json, match_tier=excluded.match_tier,
       anchors_json=excluded.anchors_json, source_count=excluded.source_count,
       searched_at=excluded.searched_at, expires_at=excluded.expires_at,
       searched_by=excluded.searched_by`,
    cacheKey, JSON.stringify(seed), JSON.stringify(response),
    matchTier, JSON.stringify(Array.from(allAnchors)), sourceResults.length,
    searchedAt, expiresAt, options.searchedBy ?? null,
  );

  return response;
}
