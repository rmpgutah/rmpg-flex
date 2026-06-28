// src/utils/sl-assessor/lookup.ts
// Fallback orchestrator for the SLCo Assessor lookup. Order:
//   1. Fresh 30d KV cache
//   2. Live fetch via client.ts (POST → redirect → parse; Firecrawl for multi-result)
//   3. Stale durable cache (last-known-good from any prior success)
//
// Always returns a structured result — never throws. Routes use this so the
// UI gets one consistent shape regardless of which layer (if any) succeeded.

import { buildQueryUrl, searchByAddress, getParcel } from './client';
import {
  cacheKeyParcels, cacheKeyParcel,
  durableKeyParcels, durableKeyParcel,
  getCached, putCached, putCachedDurable,
} from './cache';
import type { Parcel, ParcelSummary } from './types';

export type LookupSource =
  | 'direct'         // structural parser on a direct POST (single-result redirect)
  | 'firecrawl'      // structural parser on Firecrawl-rendered HTML (multi-result)
  | 'stale_cache'    // last-known-good served because every live source failed
  | 'cache'          // fresh 30d-TTL cache hit (no upstream call needed)
  | 'none';          // nothing returned a result

export type LookupCode =
  | 'ok'
  | 'not_configured'   // no FIRECRAWL_API_KEY and no result from direct POST
  | 'no_match'         // chain ran, found nothing
  | 'upstream_error'   // every live source threw; stale cache also missing
  | 'timeout';

export interface LookupEnv {
  FIRECRAWL_API_KEY?: string;
  KV: KVNamespace;
  DB?: D1Database;
  AI?: Ai;
}

export interface LookupResult {
  parcels: ParcelSummary[];
  source: LookupSource;
  code: LookupCode;
  /** True when source is stale_cache — the user is looking at possibly outdated data. */
  degraded: boolean;
  /** Deep link to the manual SLCo Assessor search page — always present. */
  manual_url: string;
  /** Short diagnostic for operators / logs. */
  diagnostic?: string;
}

/**
 * Look up parcels for an address through the full fallback chain.
 *
 * Cache strategy:
 * - Fresh (30d TTL) and durable (no TTL) keys are written on every success.
 * - Fresh key is consulted BEFORE any network call.
 * - Durable key is consulted ONLY when every live source failed.
 *
 * @returns A LookupResult — never throws.
 */
export async function lookupParcelsWithFallback(
  env: LookupEnv,
  address: string,
): Promise<LookupResult> {
  const manual_url = buildQueryUrl(address);
  let lastErr = '';

  // 0. Fresh cache hit.
  const fresh = await getCached<ParcelSummary[]>({ KV: env.KV }, cacheKeyParcels(address));
  if (fresh && Array.isArray(fresh) && fresh.length > 0) {
    return { parcels: fresh, source: 'cache', code: 'ok', degraded: false, manual_url };
  }

  // 1. Live lookup (POST → single-result redirect, or Firecrawl for multi-result).
  try {
    const parcels = await searchByAddress(env, address);
    if (parcels.length > 0) {
      await putCached({ KV: env.KV }, cacheKeyParcels(address), parcels);
      await putCachedDurable({ KV: env.KV }, durableKeyParcels(address), parcels);
      return { parcels, source: 'direct', code: 'ok', degraded: false, manual_url };
    }
    lastErr = 'no match from direct POST or firecrawl';
  } catch (e) {
    lastErr = e instanceof Error ? e.message : String(e);
  }

  // 2. Stale durable cache — last-known-good from any prior success.
  const stale = await getCached<ParcelSummary[]>({ KV: env.KV }, durableKeyParcels(address));
  if (stale && Array.isArray(stale) && stale.length > 0) {
    return {
      parcels: stale,
      source: 'stale_cache',
      code: 'ok',
      degraded: true,
      manual_url,
      diagnostic: lastErr || undefined,
    };
  }

  // 3. Nothing worked.
  return {
    parcels: [],
    source: 'none',
    code: lastErr ? 'upstream_error' : 'no_match',
    degraded: false,
    manual_url,
    diagnostic: lastErr || undefined,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Single-parcel detail variant. Same chain shape; getParcel() hits the
// valuationInfoExpanded.cfm detail URL directly (no form POST needed).
// ────────────────────────────────────────────────────────────────────────────

export interface ParcelLookupResult {
  parcel: Parcel | null;
  source: LookupSource;
  code: LookupCode;
  degraded: boolean;
  manual_url: string;
  diagnostic?: string;
}

export async function lookupParcelWithFallback(
  env: LookupEnv,
  parcelNo: string,
): Promise<ParcelLookupResult> {
  const manual_url = buildQueryUrl(parcelNo);
  let lastErr = '';

  // 0. Fresh cache.
  const fresh = await getCached<Parcel>({ KV: env.KV }, cacheKeyParcel(parcelNo));
  if (fresh && fresh.parcel_number) {
    return { parcel: fresh, source: 'cache', code: 'ok', degraded: false, manual_url };
  }

  // 1. Direct detail page (valuationInfoExpanded.cfm?parcel_id=<digits>).
  try {
    const parcel = await getParcel(env, parcelNo);
    await putCached({ KV: env.KV }, cacheKeyParcel(parcelNo), parcel);
    await putCachedDurable({ KV: env.KV }, durableKeyParcel(parcelNo), parcel);
    return { parcel, source: 'direct', code: 'ok', degraded: false, manual_url };
  } catch (e) {
    lastErr = e instanceof Error ? e.message : String(e);
  }

  // 2. Stale durable cache.
  const stale = await getCached<Parcel>({ KV: env.KV }, durableKeyParcel(parcelNo));
  if (stale && stale.parcel_number) {
    return {
      parcel: stale,
      source: 'stale_cache',
      code: 'ok',
      degraded: true,
      manual_url,
      diagnostic: lastErr || undefined,
    };
  }

  return {
    parcel: null,
    source: 'none',
    code: lastErr ? 'upstream_error' : 'no_match',
    degraded: false,
    manual_url,
    diagnostic: lastErr || undefined,
  };
}
