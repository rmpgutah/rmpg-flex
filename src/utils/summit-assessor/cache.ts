// Same normalization/cache strategy as sl-assessor/cache.ts, namespaced
// under 'summit_assessor:' keys.

const DIRECTIONALS: Record<string, string> = {
  north: 'n', south: 's', east: 'e', west: 'w',
  northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw',
};
const STREET_TYPES: Record<string, string> = {
  street: 'st', avenue: 'ave', boulevard: 'blvd', drive: 'dr',
  road: 'rd', lane: 'ln', court: 'ct', circle: 'cir', place: 'pl',
  parkway: 'pkwy', highway: 'hwy', terrace: 'ter', way: 'way',
};

export function normalizeAddress(addr: string): string {
  if (!addr) return '';
  let s = addr.toLowerCase().trim();
  const comma = s.indexOf(',');
  if (comma >= 0) s = s.slice(0, comma);
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const tokens = s.split(' ').map((t) => DIRECTIONALS[t] ?? STREET_TYPES[t] ?? t);
  return tokens.join(' ');
}

export function cacheKeyParcels(addr: string): string {
  return `summit_assessor:parcels:${normalizeAddress(addr)}`;
}
export function cacheKeyParcel(parcelNo: string): string {
  return `summit_assessor:parcel:${parcelNo}`;
}
export function durableKeyParcels(addr: string): string {
  return `summit_assessor:parcels:durable:${normalizeAddress(addr)}`;
}
export function durableKeyParcel(parcelNo: string): string {
  return `summit_assessor:parcel:durable:${parcelNo}`;
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
export async function putCachedDurable<T>(env: CacheEnv, key: string, value: T): Promise<void> {
  await env.KV.put(key, JSON.stringify(value));
}
export async function invalidate(env: CacheEnv, key: string): Promise<void> {
  await env.KV.delete(key);
}
