// ============================================================
// RMPG Flex — NSOPW query cache (D1-backed).
// ------------------------------------------------------------
// Caches every federated query for `CACHE_TTL_DAYS` (default 14) keyed
// by normalized identity (cacheKeyOf). Hits and misses both cache —
// a known-empty name doesn't burn MOU quota on every CFS subject add.
//
// D1 is used (not KV) because we want SQL TTL via `expires_at`
// comparison + a queryable history for ops dashboards. KV would
// require per-key TTL and a separate audit log; D1 collapses both.
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import type { Bindings } from '../../types';
import { getDb, query, queryFirst, execute } from '../db';
import { cacheKeyOf } from './normalize';
import type { NsopwQuery, NsopwSearchResponse } from './types';

export const CACHE_TTL_DAYS = 14;

export interface CachedQuery {
  cacheKey: string;
  resultCount: number;
  hitOffenderIds: number[];
  rawResponse: NsopwSearchResponse;
  queriedAt: string;
  expiresAt: string;
}

/**
 * Look up a cache entry. Returns null when missing or expired.
 * Note: D1 has no built-in TTL — we just check `expires_at > now`.
 */
export async function readCache(
  db: D1Database,
  query: NsopwQuery,
): Promise<CachedQuery | null> {
  const key = cacheKeyOf(query);
  const row = await queryFirst<{
    cache_key: string;
    result_count: number;
    hit_offender_ids: string | null;
    raw_response: string | null;
    queried_at: string;
    expires_at: string;
  }>(
    db,
    `SELECT cache_key, result_count, hit_offender_ids, raw_response, queried_at, expires_at
       FROM nsopw_query_cache
      WHERE cache_key = ? AND expires_at > datetime('now')`,
    key,
  ).catch(() => null);
  if (!row) return null;

  let hitIds: number[] = [];
  let rawResponse: NsopwSearchResponse = {
    offenders: [], jurisdictionCoverage: {},
    jurisdictionRecordCounts: {}, jurisdictionResponseTime: {}, raw: null,
  };
  try {
    hitIds = JSON.parse(row.hit_offender_ids ?? '[]');
  } catch { /* ignore */ }
  try {
    rawResponse = JSON.parse(row.raw_response ?? '{}') as NsopwSearchResponse;
  } catch { /* ignore */ }

  return {
    cacheKey: row.cache_key,
    resultCount: row.result_count,
    hitOffenderIds: Array.isArray(hitIds) ? hitIds : [],
    rawResponse,
    queriedAt: row.queried_at,
    expiresAt: row.expires_at,
  };
}

export async function writeCache(
  db: D1Database,
  query: NsopwQuery,
  resp: NsopwSearchResponse,
  hitOffenderIds: number[],
  ttlDays = CACHE_TTL_DAYS,
): Promise<void> {
  const key = cacheKeyOf(query);
  await execute(
    db,
    `INSERT INTO nsopw_query_cache
       (cache_key, query_surname, query_forename, query_dob,
        result_count, hit_offender_ids, raw_response, jurisdiction_coverage,
        queried_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?,
             datetime('now'),
             datetime('now', '+' || ? || ' days'))
     ON CONFLICT(cache_key) DO UPDATE SET
       result_count = excluded.result_count,
       hit_offender_ids = excluded.hit_offender_ids,
       raw_response = excluded.raw_response,
       jurisdiction_coverage = excluded.jurisdiction_coverage,
       queried_at = excluded.queried_at,
       expires_at = excluded.expires_at`,
    key,
    query.surname ?? '',
    query.forename ?? '',
    query.dob ?? '',
    resp.offenders.length,
    JSON.stringify(hitOffenderIds),
    JSON.stringify(resp),
    JSON.stringify(resp.jurisdictionCoverage),
    ttlDays,
  );
}

/** Vacuum expired cache rows. Cheap; safe to call on cron. */
export async function vacuumCache(env: Bindings): Promise<number> {
  const db = getDb(env);
  const res = await execute(db, `DELETE FROM nsopw_query_cache WHERE expires_at <= datetime('now')`);
  // D1 returns meta.changes; null-safe access for older shapes.
  const meta = (res as { meta?: { changes?: number } }).meta;
  return meta?.changes ?? 0;
}

export async function listRecentQueries(env: Bindings, limit = 50) {
  return query<Record<string, unknown>>(
    getDb(env),
    `SELECT cache_key, query_surname, query_forename, query_dob,
            result_count, queried_at, expires_at
       FROM nsopw_query_cache
      ORDER BY queried_at DESC LIMIT ?`,
    limit,
  );
}
