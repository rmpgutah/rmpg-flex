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

// Durable (no-TTL) companion keys. The orchestrator writes both the 30d-TTL
// fresh key AND the durable key on every successful fetch so a future fetch
// failure can serve last-known-good as a stale fallback. Durable keys are
// only read when the live chain produces nothing — they NEVER override a
// fresh result.
export function durableKeyParcels(addr: string): string {
  return `assessor:parcels:durable:${normalizeAddress(addr)}`;
}
export function durableKeyParcel(parcelNo: string): string {
  return `assessor:parcel:durable:${parcelNo}`;
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

/** Write WITHOUT an expirationTtl so the value survives past the 30d TTL. Used
 *  for the "stale fallback" tier — last-known-good is better than nothing when
 *  every live source is failing. */
export async function putCachedDurable<T>(env: CacheEnv, key: string, value: T): Promise<void> {
  await env.KV.put(key, JSON.stringify(value));
}

export async function invalidate(env: CacheEnv, key: string): Promise<void> {
  await env.KV.delete(key);
}

// ── Poisoned-cache self-heal ─────────────────────────────────────────────
//
// Before the 2026-08-01 parser fix, the picker wrote summaries whose
// parcel_number was the county search form's placeholder ("00-00-000-000")
// or a 12-digit BLOCK id. Those payloads are still in KV, and clearing them
// is NOT a matter of waiting them out: putCachedDurable() writes a companion
// key with NO expirationTtl, so a poisoned durable entry survives forever and
// is served as "last-known-good" the moment the fresh key is cleared. A
// manual Refresh deletes the fresh key and the durable key answers with the
// same corrupt value.
//
// So validate on READ. A cached payload carrying an impossible parcel number
// is treated as a miss and deleted, which self-heals every affected record on
// first access with no operator action and no KV enumeration.

/** All-zero placeholder from <input id="parcelid" placeholder="00-00-000-000-0000">. */
const PLACEHOLDER_PARCEL_RE = /^0{2}-0{2}-0{3}-0{3}(?:-0{4})?$/;
/** The only shape the county actually issues: 14 digits, dashed. */
const VALID_PARCEL_RE = /^\d{2}-\d{2}-\d{3}-\d{3}-\d{4}$/;

/**
 * True when a parcel number is one the county could really have issued.
 *
 * Rejects the placeholder AND the 12-digit block form — a block id is not
 * merely cosmetic, it is the value the county answers with HTTP 200 + its
 * search form, so caching one guarantees silent downstream failure.
 */
export function isValidParcelNumber(p: unknown): boolean {
  return typeof p === 'string' && VALID_PARCEL_RE.test(p) && !PLACEHOLDER_PARCEL_RE.test(p);
}

/**
 * Read a cached value, dropping it if it is poisoned.
 *
 * `extract` pulls every parcel number out of the payload. If ANY is invalid
 * the whole entry is deleted and null is returned, so the caller falls
 * through to a live fetch. Deleting the whole entry rather than filtering is
 * deliberate: a summary list with one bad row was produced by the broken
 * parser, so its other rows are not trustworthy either.
 */
export async function getCachedValidated<T>(
  env: CacheEnv,
  key: string,
  extract: (value: T) => Array<unknown>,
): Promise<T | null> {
  const value = await getCached<T>(env, key);
  if (value == null) return null;
  let numbers: Array<unknown>;
  try {
    numbers = extract(value);
  } catch {
    return value;   // unexpected shape — leave it alone rather than deleting data
  }
  if (numbers.length === 0) return value;
  if (numbers.every(isValidParcelNumber)) return value;
  // Poisoned. Drop it so the next read repopulates from the live source.
  await invalidate(env, key).catch(() => { /* best-effort */ });
  return null;
}
