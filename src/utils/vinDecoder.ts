// ============================================================
// RMPG Flex — NHTSA vPIC VIN decoder + lazy D1 cache
// ============================================================
// Worker-safe (no node:*). Public NHTSA vPIC endpoint:
//   GET https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/{vin}?format=json
//
// Response shape (relevant fields, lots more ignored):
//   { Results: [ {Variable: 'Make', Value: 'TOYOTA', VariableId, ValueId}, ... ] }
//
// Module structure mirrors src/utils/fleetio/client.ts:
//   - Pure validators + normalizer (unit-testable, no I/O)
//   - HTTP fetch with AbortController timeout + typed errors
//   - D1 cache lookup / write
//
// Used by:
//   - Fleet PR 3 vehicle form (autofill make/model/year/etc. on VIN entry)
//   - Monthly NHTSA bulk-refresh cron (PR 2b; cron stub registered in PR 2)
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';

// ─── Errors ──────────────────────────────────────────────────

export class VinDecoderError extends Error {
  readonly detail?: unknown;
  constructor(message: string, detail?: unknown) {
    super(message);
    this.name = 'VinDecoderError';
    this.detail = detail;
  }
}

/** VIN failed format validation (length, charset). Not retried. */
export class VinFormatError extends VinDecoderError {
  constructor(message: string, detail?: unknown) {
    super(message, detail);
    this.name = 'VinFormatError';
  }
}

/** Request exceeded the timeout. */
export class VinDecoderTimeoutError extends VinDecoderError {
  constructor(message: string) {
    super(message);
    this.name = 'VinDecoderTimeoutError';
  }
}

/** NHTSA returned a non-2xx. `status` carries the HTTP code. */
export class VinDecoderHttpError extends VinDecoderError {
  readonly status: number;
  constructor(message: string, status: number, detail?: unknown) {
    super(message, detail);
    this.name = 'VinDecoderHttpError';
    this.status = status;
  }
}

// ─── Public API types ────────────────────────────────────────

export interface DecodedVin {
  vin: string;
  make: string | null;
  model: string | null;
  year: number | null;
  body_type: string | null;
  drivetrain: string | null;
  transmission: string | null;
  engine_cylinders: number | null;
  displacement_l: number | null;
  fuel_type: string | null;
  gvwr_lbs: number | null;
  manufacturer: string | null;
  plant_country: string | null;
  source: 'nhtsa_vpic';
  fetched_at: string; // ISO datetime
}

/** Raw NHTSA vPIC item; we only consume Variable + Value. */
export interface VpicResultItem {
  Variable: string;
  Value: string | null;
}

export interface VpicPayload {
  Results?: VpicResultItem[];
}

// ─── Pure helpers ────────────────────────────────────────────

const VIN_REGEX = /^[A-HJ-NPR-Z0-9]{17}$/; // VIN: 17 chars, no I, O, Q

/** Normalize and validate. Throws VinFormatError on invalid input. */
export function normalizeVin(raw: string): string {
  if (typeof raw !== 'string') {
    throw new VinFormatError('VIN must be a string');
  }
  const candidate = raw.trim().toUpperCase();
  if (!VIN_REGEX.test(candidate)) {
    throw new VinFormatError(`Invalid VIN format: '${candidate}'. Must be 17 chars, A-Z (no I/O/Q) + 0-9.`);
  }
  return candidate;
}

/** Convert NHTSA Results array into the small typed shape we cache. */
export function normalizeVpicPayload(raw: VpicPayload, vin: string, nowIso: string): DecodedVin {
  const map = new Map<string, string>();
  for (const item of raw.Results ?? []) {
    if (item.Variable && item.Value != null && item.Value !== '') {
      map.set(item.Variable, item.Value);
    }
  }
  const pickInt = (key: string): number | null => {
    const v = map.get(key);
    if (!v) return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  };
  const pickFloat = (key: string): number | null => {
    const v = map.get(key);
    if (!v) return null;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };
  const pickStr = (key: string): string | null => {
    const v = map.get(key);
    return v ? v : null;
  };
  return {
    vin,
    make: pickStr('Make'),
    model: pickStr('Model'),
    year: pickInt('Model Year'),
    body_type: pickStr('Body Class'),
    drivetrain: pickStr('Drive Type'),
    transmission: pickStr('Transmission Style'),
    engine_cylinders: pickInt('Engine Number of Cylinders'),
    displacement_l: pickFloat('Displacement (L)'),
    fuel_type: pickStr('Fuel Type - Primary'),
    gvwr_lbs: pickInt('Gross Vehicle Weight Rating From'),
    manufacturer: pickStr('Manufacturer Name'),
    plant_country: pickStr('Plant Country'),
    source: 'nhtsa_vpic',
    fetched_at: nowIso,
  };
}

// ─── HTTP — testable via injected fetch ──────────────────────

export const NHTSA_VPIC_BASE_DEFAULT = 'https://vpic.nhtsa.dot.gov/api/vehicles';

export interface DecodeViaNhtsaOpts {
  apiBase?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch; // test injection point
  nowIso?: string;
}

/** Fetch + decode one VIN against NHTSA vPIC. Pure HTTP; no D1. */
export async function decodeViaNhtsa(vinRaw: string, opts: DecodeViaNhtsaOpts = {}): Promise<DecodedVin> {
  const vin = normalizeVin(vinRaw);
  const apiBase = (opts.apiBase ?? NHTSA_VPIC_BASE_DEFAULT).replace(/\/+$/, '');
  const url = `${apiBase}/decodevin/${vin}?format=json`;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const fetchFn = opts.fetchImpl ?? fetch;
  const nowIso = opts.nowIso ?? new Date().toISOString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let resp: Response;
  try {
    resp = await fetchFn(url, { signal: controller.signal, headers: { accept: 'application/json' } });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      throw new VinDecoderTimeoutError(`NHTSA vPIC timed out after ${timeoutMs}ms`);
    }
    throw new VinDecoderError(`NHTSA vPIC fetch failed`, err);
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) {
    let body: unknown;
    try { body = await resp.text(); } catch { /* swallow */ }
    throw new VinDecoderHttpError(`NHTSA vPIC returned ${resp.status}`, resp.status, body);
  }
  let payload: VpicPayload;
  try {
    payload = await resp.json() as VpicPayload;
  } catch (err) {
    throw new VinDecoderError('NHTSA vPIC returned non-JSON', err);
  }
  return normalizeVpicPayload(payload, vin, nowIso);
}

// ─── D1 cache layer ──────────────────────────────────────────

/** Look up a VIN in the cache; return null if absent or unparseable. */
export async function readCachedVin(db: D1Database, vin: string): Promise<DecodedVin | null> {
  const normalized = normalizeVin(vin);
  const row = await db.prepare(
    'SELECT decoded_json, fetched_at, source FROM vin_decode_cache WHERE vin = ?'
  ).bind(normalized).first<{ decoded_json: string; fetched_at: string; source: string }>();
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.decoded_json) as DecodedVin;
    return { ...parsed, vin: normalized, fetched_at: row.fetched_at, source: 'nhtsa_vpic' };
  } catch {
    return null;
  }
}

/** Persist a decoded VIN. INSERT OR REPLACE so a re-decode refreshes the cache. */
export async function writeCachedVin(db: D1Database, decoded: DecodedVin): Promise<void> {
  await db.prepare(
    `INSERT OR REPLACE INTO vin_decode_cache (vin, decoded_json, fetched_at, source)
     VALUES (?, ?, ?, ?)`
  ).bind(decoded.vin, JSON.stringify(decoded), decoded.fetched_at, decoded.source).run();
}

/**
 * Cache-first decode. On hit, returns immediately. On miss, fetches NHTSA,
 * persists, and returns the fresh result. Caller never sees the network
 * unless the VIN is new (or the cache row was deleted).
 */
export async function decodeVinCached(
  db: D1Database,
  vinRaw: string,
  opts: DecodeViaNhtsaOpts = {},
): Promise<DecodedVin> {
  const cached = await readCachedVin(db, vinRaw);
  if (cached) return cached;
  const fresh = await decodeViaNhtsa(vinRaw, opts);
  await writeCachedVin(db, fresh);
  return fresh;
}
