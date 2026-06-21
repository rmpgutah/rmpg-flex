// Pure address normalization + thin KV wrapper. Pure helpers are exported
// so the parser & client can compose them without importing KV.

const DIRECTIONALS: Record<string, string> = {
  north: 'n', south: 's', east: 'e', west: 'w',
  northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw',
};

const STREET_TYPES: Record<string, string> = {
  street: 'st', avenue: 'ave', boulevard: 'blvd', drive: 'dr',
  road: 'rd', lane: 'ln', court: 'ct', circle: 'cir', place: 'pl',
  parkway: 'pkwy', highway: 'hwy', terrace: 'ter', way: 'way',
};

/** Pure: normalize an address for cache-key equivalence. */
export function normalizeAddress(addr: string): string {
  if (!addr) return '';
  let s = addr.toLowerCase().trim();
  // Strip everything after the first comma (city/state/zip)
  const comma = s.indexOf(',');
  if (comma >= 0) s = s.slice(0, comma);
  // Collapse whitespace
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return '';
  // Canonicalise tokens
  const tokens = s.split(' ').map((t) => {
    if (DIRECTIONALS[t]) return DIRECTIONALS[t];
    if (STREET_TYPES[t]) return STREET_TYPES[t];
    return t;
  });
  return tokens.join(' ');
}

export function cacheKeyParcels(addr: string): string {
  return `assessor:parcels:${normalizeAddress(addr)}`;
}

export function cacheKeyParcel(parcelNo: string): string {
  return `assessor:parcel:${parcelNo}`;
}

const TTL_30_DAYS_S = 60 * 60 * 24 * 30;

export interface CacheEnv { KV: KVNamespace; }

export async function getCached<T>(env: CacheEnv, key: string): Promise<T | null> {
  const raw = await env.KV.get(key, 'json');
  return (raw as T) ?? null;
}

export async function putCached<T>(env: CacheEnv, key: string, value: T): Promise<void> {
  await env.KV.put(key, JSON.stringify(value), { expirationTtl: TTL_30_DAYS_S });
}

export async function invalidate(env: CacheEnv, key: string): Promise<void> {
  await env.KV.delete(key);
}
