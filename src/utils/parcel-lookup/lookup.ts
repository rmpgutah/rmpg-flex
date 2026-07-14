// Thin dispatch layer: resolves the county for an address (or takes an
// explicit county when the caller already knows it, e.g. from
// parcel_records.source) and calls the matching package's
// searchByAddress/getParcel. Each county package owns its own cache/fallback
// chain internally via its own lookup usage in routes/assessor.ts — this
// module is purely the routing switch, not a duplicate fallback chain.

import type { Parcel, ParcelSummary } from './types';
import { resolveCountyFromAddress, type County } from './router';

import * as slClient from '../sl-assessor/client';
import * as utahClient from '../utah-assessor/client';
import * as summitClient from '../summit-assessor/client';
import * as tooeleClient from '../tooele-assessor/client';

export interface DispatchEnv { FIRECRAWL_API_KEY?: string; }

function clientFor(county: County) {
  switch (county) {
    case 'salt_lake': return slClient;
    case 'utah': return utahClient;
    case 'summit': return summitClient;
    case 'tooele': return tooeleClient;
    case 'unsupported': return null;
  }
}

export const COUNTY_LABELS: Record<County, string> = {
  salt_lake: 'Salt Lake County',
  utah: 'Utah County',
  summit: 'Summit County',
  tooele: 'Tooele County',
  unsupported: 'Unsupported',
};

/** The four counties a jurisdiction override may be set to (not 'unsupported'). */
export const OVERRIDABLE_COUNTIES = ['salt_lake', 'utah', 'summit', 'tooele'] as const;
export type OverridableCounty = (typeof OVERRIDABLE_COUNTIES)[number];

export function isOverridableCounty(value: unknown): value is OverridableCounty {
  return typeof value === 'string' && (OVERRIDABLE_COUNTIES as readonly string[]).includes(value);
}

/** Manual county-search page for a given address, or '' when unsupported. */
export function buildManualUrl(county: County, address: string): string {
  switch (county) {
    case 'salt_lake': return slClient.buildQueryUrl(address);
    case 'utah': return utahClient.buildQueryUrl(address);
    case 'summit': return summitClient.buildQueryUrl(address);
    case 'tooele': return tooeleClient.buildQueryUrl(address);
    case 'unsupported': return '';
  }
}

/**
 * Resolve the county to use for an address, honoring a stored override
 * (e.g. businesses.jurisdiction_override / properties.jurisdiction_override)
 * over the automatic router. An override always wins when set, even if it
 * disagrees with what the address would normally resolve to — that's the
 * whole point of letting an operator correct a misrouted address.
 */
export function resolveEffectiveCounty(address: string, override?: string | null): County {
  if (isOverridableCounty(override)) return override;
  return resolveCountyFromAddress(address);
}

export async function dispatchSearchByAddress(
  env: DispatchEnv,
  address: string,
  override?: string | null,
): Promise<ParcelSummary[]> {
  const county = resolveEffectiveCounty(address, override);
  const client = clientFor(county);
  if (!client) return [];
  return client.searchByAddress(env, address);
}

/**
 * Detail lookups are keyed by parcel_number, which carries no county
 * signal by itself — callers that already know the county (e.g. from a
 * previously-stored parcel_records.source) MUST pass it explicitly rather
 * than re-deriving from an address that may not be available at this call
 * site (the /parcel/:parcel_no route, the backfill worker's second pass).
 */
export async function dispatchGetParcel(
  env: DispatchEnv,
  parcelNo: string,
  county: County,
): Promise<Parcel> {
  const client = clientFor(county);
  if (!client) throw new Error(`dispatchGetParcel: unsupported county for parcel ${parcelNo}`);
  return client.getParcel(env, parcelNo);
}

export { resolveCountyFromAddress };
export type { County };
