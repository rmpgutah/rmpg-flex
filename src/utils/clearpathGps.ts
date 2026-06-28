// ============================================================
// RMPG Flex — ClearPath GPS / Media client (Worker-native)
// ============================================================
// Ported from legacy/server-vps/src/utils/clearPathGpsClient.ts +
// clearPathGpsMediaClient.ts, reduced to what the Cloudflare Worker needs
// and made runtime-native (no Buffer, no node:stream, no module globals).
//
// Two ClearPath APIs, one credential:
//   • GPS fleet API  — https://api.clearpathgps.com:8443/v3.0/...   (HTTP Basic)
//       Rich vehicle/device list with telemetry (make/model/plate/VIN/ignition).
//   • Media API      — https://api.clearpathgps.com/v2.0/media/...  (Bearer)
//       Dashcam cameras + clip listings + pre-signed S3 download URLs.
//
// The "token" is a deterministic base64 of the credentials, so we recompute it
// per request (no cross-invocation cache — Workers are stateless).
//
// The admin tab (client/src/pages/admin/AdminClearPathGpsTab.tsx) is the
// contract of record: it sends { email, password, account_id } and expects a
// rich CpgDevice list. So account_id → account, email → user.
// ============================================================

import { decryptSecret, isEncrypted } from './cpgCrypto';
import { query, queryFirst, execute } from './db';

const GPS_BASE_DEFAULT = 'https://api.clearpathgps.com:8443';
const MEDIA_BASE = 'https://api.clearpathgps.com';

// ── Typed errors ─────────────────────────────────────────────

export class CpgAuthError extends Error {
  constructor(msg = 'Invalid ClearPath credentials') { super(msg); this.name = 'CpgAuthError'; }
}
export class CpgRateLimitError extends Error {
  retryAfterSeconds: number;
  constructor(retryAfter: number) {
    super(`ClearPath rate limited — retry after ${retryAfter}s`);
    this.name = 'CpgRateLimitError';
    this.retryAfterSeconds = retryAfter;
  }
}
export class CpgHttpError extends Error {
  status: number;
  constructor(status: number, msg: string) { super(msg); this.name = 'CpgHttpError'; this.status = status; }
}

// ── Types ────────────────────────────────────────────────────

export interface CpgCredentials {
  account: string;   // ClearPath account id (admin tab: account_id)
  user: string;      // login email (admin tab: email)
  password: string;
  baseUrl: string;   // GPS API base (with :8443)
}

/** The rich device shape the admin tab renders (CpgDevice). */
export interface CpgDevice {
  deviceId: string;
  gtsDeviceId?: string;
  uniqueId: string;
  serialNumber: string;
  displayName: string;
  lastValidLatitude: number;
  lastValidLongitude: number;
  vehicleMake: string;
  vehicleModel: string;
  licensePlate: string;
  vehicleID: string;       // VIN
  driverName: string;
  ignitionState: string;
  description?: string;
  [key: string]: unknown;
}

/** v2.0 media camera. */
export interface CpgCamera {
  id: number;
  provider: string;
  name: string;
  providerId: string;
  notes: string;
  lastCommunication: number;
}

// ── Auth ─────────────────────────────────────────────────────

/** The base64 of `{account}/{user}:{password}` — used as Basic creds for the
 *  GPS API and as the Bearer token for the Media API (ClearPath's scheme). */
export function authToken(creds: Pick<CpgCredentials, 'account' | 'user' | 'password'>): string {
  return btoa(`${creds.account}/${creds.user}:${creds.password}`);
}

// ── Credential storage (system_config, category 'integrations') ──

const KEYS = {
  account: 'clearpathgps_account',
  user: 'clearpathgps_user',
  password: 'clearpathgps_password',
  baseUrl: 'clearpathgps_base_url',
  enabled: 'clearpathgps_enabled',
  pollInterval: 'clearpathgps_poll_interval',
  historyBackfill: 'clearpathgps_history_backfill',
  mediaEnabled: 'clearpathgps_media_sync_enabled',
  mediaPollInterval: 'clearpathgps_media_poll_interval',
} as const;
export const CPG_KEYS = KEYS;

type DB = D1Database;

export async function getConfigValue(db: DB, key: string): Promise<string | null> {
  try {
    const row = await queryFirst<{ config_value: string }>(
      db,
      "SELECT config_value FROM system_config WHERE config_key = ? AND category = 'integrations' AND is_active = 1 LIMIT 1",
      key,
    );
    return row?.config_value ?? null;
  } catch { return null; }
}

/** Safe upsert — system_config's UNIQUE is the composite (config_key,
 *  config_value), NOT config_key, so ON CONFLICT(config_key) throws. The
 *  established codebase-safe pattern is DELETE-then-INSERT per key. */
export async function setConfigValue(db: DB, key: string, value: string): Promise<void> {
  await execute(db, "DELETE FROM system_config WHERE config_key = ? AND category = 'integrations'", key);
  await execute(
    db,
    "INSERT INTO system_config (config_key, config_value, category, is_active) VALUES (?, ?, 'integrations', 1)",
    key, value,
  );
}

export async function deleteConfigValue(db: DB, key: string): Promise<void> {
  try { await execute(db, "DELETE FROM system_config WHERE config_key = ? AND category = 'integrations'", key); }
  catch { /* best-effort */ }
}

/** Load + decrypt credentials. Returns null when incomplete. The password may be
 *  stored either as a v1: encrypted blob or (legacy) plaintext. */
export async function getCredentials(db: DB, env: { CPG_ENC_KEY?: string }): Promise<CpgCredentials | null> {
  const account = await getConfigValue(db, KEYS.account);
  const user = await getConfigValue(db, KEYS.user);
  const storedPw = await getConfigValue(db, KEYS.password);
  const baseUrl = (await getConfigValue(db, KEYS.baseUrl)) || GPS_BASE_DEFAULT;
  if (!account || !user || !storedPw) return null;
  let password = storedPw;
  if (isEncrypted(storedPw)) {
    password = await decryptSecret(storedPw, env.CPG_ENC_KEY);
  }
  return { account, user, password, baseUrl };
}

export async function isEnabled(db: DB): Promise<boolean> {
  const v = await getConfigValue(db, KEYS.enabled);
  return v === '1' || v === 'true';
}

// ── HTTP helpers ─────────────────────────────────────────────

/** GPS v3.0 GET with Basic auth, 429-aware, typed errors. */
async function gpsFetch(creds: CpgCredentials, endpoint: string, params?: Record<string, string>): Promise<unknown> {
  const url = new URL(`/v3.0${endpoint}`, creds.baseUrl);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: { Authorization: `Basic ${authToken(creds)}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 401) throw new CpgAuthError();
  if (res.status === 429) throw new CpgRateLimitError(parseInt(res.headers.get('Retry-After') || '60', 10));
  if (!res.ok) throw new CpgHttpError(res.status, `ClearPath GPS API ${res.status}`);
  return res.json();
}

/** Media v2.0 GET with Bearer auth, 429-aware, typed errors. */
export async function mediaFetch<T>(creds: CpgCredentials, endpoint: string): Promise<T> {
  const res = await fetch(`${MEDIA_BASE}${endpoint}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${authToken(creds)}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 401) throw new CpgAuthError();
  if (res.status === 429) throw new CpgRateLimitError(parseInt(res.headers.get('Retry-After') || '60', 10));
  if (!res.ok) throw new CpgHttpError(res.status, `ClearPath Media API ${res.status}`);
  return res.json() as Promise<T>;
}

// ── Public methods ───────────────────────────────────────────

function asArray(data: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(data)) return data;
  const obj = (data ?? {}) as Record<string, unknown>;
  for (const k of keys) if (Array.isArray(obj[k])) return obj[k] as unknown[];
  return [];
}

/** Normalise one raw ClearPath vehicle/device record into a CpgDevice. The v3.0
 *  API uses a variety of field names across accounts; we read all the common
 *  aliases so the admin tab always gets a populated row. Exported (pure) for tests. */
export function toDevice(raw: Record<string, unknown>): CpgDevice {
  const s = (...keys: string[]): string => {
    for (const k of keys) { const v = raw[k]; if (v != null && v !== '') return String(v); }
    return '';
  };
  const n = (...keys: string[]): number => {
    for (const k of keys) { const v = raw[k]; if (v != null && v !== '' && Number.isFinite(Number(v))) return Number(v); }
    return NaN;
  };
  const deviceId = s('deviceId', 'gtsDeviceId', 'device_id', 'id', 'vehicleId', 'vehicle_id');
  return {
    deviceId,
    gtsDeviceId: s('gtsDeviceId', 'gts_device_id') || undefined,
    uniqueId: s('uniqueId', 'unique_id', 'serialNumber', 'imei') || deviceId,
    serialNumber: s('serialNumber', 'serial_number', 'imei', 'simSerial'),
    displayName: s('displayName', 'display_name', 'name', 'vehicleName', 'description', 'label') || deviceId,
    lastValidLatitude: n('lastValidLatitude', 'latitude', 'lat', 'lastLatitude'),
    lastValidLongitude: n('lastValidLongitude', 'longitude', 'lng', 'lon', 'lastLongitude'),
    vehicleMake: s('vehicleMake', 'make'),
    vehicleModel: s('vehicleModel', 'model'),
    licensePlate: s('licensePlate', 'license_plate', 'licensePlateNumber', 'plate'),
    vehicleID: s('vehicleID', 'vin', 'VIN', 'vehicle_vin'),
    driverName: s('driverName', 'driver_name', 'driver'),
    ignitionState: s('ignitionState', 'ignition_state', 'ignition'),
    description: s('description', 'notes') || undefined,
  };
}

/** Camera → device-ish shape (when an account exposes only dashcam cameras and
 *  no fleet vehicles). Pure, exported for tests. */
export function cameraToDevice(cam: CpgCamera): CpgDevice {
  return {
    deviceId: cam.providerId || String(cam.id),
    uniqueId: String(cam.id),
    serialNumber: cam.providerId || '',
    displayName: cam.name || cam.providerId || String(cam.id),
    lastValidLatitude: NaN,
    lastValidLongitude: NaN,
    vehicleMake: '',
    vehicleModel: '',
    licensePlate: '',
    vehicleID: '',
    driverName: '',
    ignitionState: '',
    description: cam.notes || undefined,
    cameraId: cam.id,
  };
}

/** List fleet devices (vehicles). Falls back to media cameras when the GPS API
 *  yields nothing — some accounts are camera-only. */
export async function listDevices(creds: CpgCredentials): Promise<CpgDevice[]> {
  const data = await gpsFetch(creds, '/vehicles');
  const rows = asArray(data, 'vehicles', 'data', 'items', 'devices');
  const devices = rows.map((r) => toDevice(r as Record<string, unknown>)).filter((d) => d.deviceId);
  if (devices.length > 0) return devices;
  try {
    const cams = await listCameras(creds);
    return cams.map(cameraToDevice);
  } catch { return devices; }
}

/** List dashcam cameras (v2.0 Media API). */
export async function listCameras(creds: CpgCredentials): Promise<CpgCamera[]> {
  const resp = await mediaFetch<{ items?: CpgCamera[] }>(creds, '/v2.0/media/cameras');
  return resp.items || [];
}

// ── Media clips (v2.0 Media API) — Phase B/C ─────────────────

export interface CpgMediaObject {
  channel: string;                  // "outside" | "inside"
  type: string;                     // "VIDEO" | "IMAGE"
  title: string;
  thumbnailUrl: string;             // pre-signed S3 URL (1h expiry)
  accessUrl: string;                // pre-signed S3 URL (1h expiry)
  status: string;                   // "AVAILABLE" | "PROCESSING" | ...
  lastUpdate: number;
  expiringSoon: boolean;
  eventType: string;
  location: { lat: number; lng: number } | null;
  gps?: Array<{ latitude: number; longitude: number; speed: number; altitude: number; timestamp: number }>;
  cameraId?: number;
  [key: string]: unknown;
}

export interface CpgMediaEvent {
  address: string;
  batchId: string;
  eventTimestamp: number;            // epoch ms
  lastUpdate: number;
  expiringSoon: boolean;
  status: string;
  mediaObject: CpgMediaObject[];
}

interface CpgMediaListResponse {
  total: number;
  totalPages: number;
  currentPage: number;
  pageSize: number;
  items: CpgMediaEvent[];
}

/** One page of media for a camera within [from, to] epoch-ms. */
export async function listMedia(
  creds: CpgCredentials, cameraId: number, from: number, to: number, page = 0, pageSize = 50,
): Promise<CpgMediaListResponse> {
  const qs = new URLSearchParams({ from: String(from), to: String(to), page: String(page), pageSize: String(pageSize) });
  return mediaFetch<CpgMediaListResponse>(creds, `/v2.0/media/legacy/cameras/${cameraId}/data?${qs}`);
}

/** All media across pages for a camera within [from, to]. Bounded by maxPages
 *  so a misbehaving account can't spin the cron. */
export async function listAllMedia(
  creds: CpgCredentials, cameraId: number, from: number, to: number, maxPages = 20,
): Promise<CpgMediaEvent[]> {
  const all: CpgMediaEvent[] = [];
  let page = 0;
  while (page < maxPages) {
    const resp = await listMedia(creds, cameraId, from, to, page, 50);
    if (resp.items?.length) all.push(...resp.items);
    if (page >= resp.totalPages - 1 || !resp.items?.length) break;
    page++;
  }
  return all;
}

/** Test connectivity: prefer the GPS vehicle list, fall back to media cameras.
 *  Returns the visible device/camera count or throws a typed error. */
export async function testConnection(creds: CpgCredentials): Promise<number> {
  try {
    const devices = await listDevices(creds);
    return devices.length;
  } catch (err) {
    if (err instanceof CpgAuthError) throw err;
    // GPS API unreachable — try the media API before giving up.
    const cams = await listCameras(creds);
    return cams.length;
  }
}

export { GPS_BASE_DEFAULT, MEDIA_BASE };
