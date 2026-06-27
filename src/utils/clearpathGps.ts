// ============================================================
// RMPG Flex — ClearPath GPS / Media client (Worker-native)
// ============================================================
// ClearPathGPS migrated to GPS Insight's platform: the data API is now
// https://api.clearpathgps.com (port 443) on /v1.0 + /v2.0, authenticated with
// a **Bearer JWT** minted by FusionAuth at https://auth.gpsinsight.io. The old
// `Basic base64(account/user:password)` scheme against :8443/v3.0 is DEAD (that
// host returns 404). See the project-clearpathgps-integration-auth note.
//
// Auth model (the portal's own scheme, replicated server-side — no secret):
//   • A long-lived (~30-day, non-rotating) **refresh token** obtained from a
//     logged-in ClearPath session. We exchange it at
//     `POST https://api.clearpathgps.com/v1.0/auth/refresh`
//     (body { refreshTokenString, accountId, userIdCp }, header
//     `X-Security-App-Name: web`) for a ~60-min access token. ClearPath's
//     backend holds any IdP secret; we only need the refresh token + user id.
//   • The access token is cached in KV (Workers are stateless) and re-minted on
//     expiry or a 401. The refresh token never leaves the Worker.
//
// Data plane (Bearer <access_token>):
//   • GPS fleet  — GET /v1.0/vehicles → { items: [...] }  (rich vehicle list).
//   • Media      — GET /v2.0/media/data?assetId=&from=&to=&page=  (dashcam clips
//     + pre-signed S3 URLs). Raw items are normalized into the CpgMediaEvent
//     shape the sync pipeline (clearpathSync.ts) and ALPR pass already consume.
// ============================================================

import { log } from './logger';
import { decryptSecret, isEncrypted } from './cpgCrypto';
import { queryFirst, execute } from './db';

const API_BASE = 'https://api.clearpathgps.com';
const TOKEN_KV_KEY = 'cpg:access_token';

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

/** A resolved, ready-to-use API client. The refresh token is captured in the
 *  `getToken` closure and never exposed on the object. */
export interface CpgClient {
  account: string | null;     // numeric GPS-Insight account id (e.g. '3637'), for display
  userId: string | null;      // userIdCp (e.g. '47647')
  getToken: () => Promise<string>;
}

/** The rich device shape the admin tab renders (CpgDevice). */
export interface CpgDevice {
  deviceId: string;
  assetId?: string;
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
  mediaEnabled?: boolean;
  description?: string;
  [key: string]: unknown;
}

/** A media-capable asset (dashcam-equipped vehicle), keyed by assetId. */
export interface CpgCamera {
  id: number;              // assetId used by /v2.0/media/data
  provider: string;
  name: string;
  providerId: string;      // deviceId
  notes: string;
  lastCommunication: number;
}

// ── Credential storage (system_config, category 'integrations') ──

const KEYS = {
  refreshToken: 'clearpathgps_refresh_token',   // encrypted at rest (cpgCrypto)
  userId: 'clearpathgps_user_id',               // userIdCp
  account: 'clearpathgps_account',
  enabled: 'clearpathgps_enabled',
  pollInterval: 'clearpathgps_poll_interval',
  historyBackfill: 'clearpathgps_history_backfill',
  mediaEnabled: 'clearpathgps_media_sync_enabled',
  mediaPollInterval: 'clearpathgps_media_poll_interval',
  // Legacy keys (dead schemes) — kept only so delete/cleanup can purge them.
  legacyUser: 'clearpathgps_user',
  legacyPassword: 'clearpathgps_password',
  legacyBaseUrl: 'clearpathgps_base_url',
  legacyClientId: 'clearpathgps_client_id',
  legacyClientSecret: 'clearpathgps_client_secret',
} as const;
export const CPG_KEYS = KEYS;

type DB = D1Database;
type EnvLike = { KV: KVNamespace; CPG_ENC_KEY?: string; CPG_REFRESH_TOKEN?: string; CPG_USER_ID?: string };

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

// ── Self-heal: a durable KV backup of the connection config ──────
// The refresh token / user / account live in system_config (D1), but a stray
// migration, manual edit, or accidental row delete could wipe them. We keep a
// durable copy in KV (the encrypted token blob — never plaintext) and restore
// the D1 rows from it on demand. `ensureCpgConfig` is cheap to call on every
// read path: it only writes when D1 is actually missing the token.

const CONFIG_BACKUP_KV_KEY = 'cpg:config_backup';

interface CpgConfigBackup { refreshToken: string; userId: string | null; account: string | null }

/** Persist a durable backup of the connection config to KV. `refreshToken`
 *  must already be the encrypted (v1:…) blob — we never store it in the clear. */
export async function backupConfig(env: EnvLike, backup: CpgConfigBackup): Promise<void> {
  try { await env.KV.put(CONFIG_BACKUP_KV_KEY, JSON.stringify(backup)); } catch { /* KV optional */ }
}

export async function readConfigBackup(env: EnvLike): Promise<CpgConfigBackup | null> {
  try { return (await env.KV.get(CONFIG_BACKUP_KV_KEY, 'json')) as CpgConfigBackup | null; }
  catch { return null; }
}

export async function clearConfigBackup(env: EnvLike): Promise<void> {
  try { await env.KV.delete(CONFIG_BACKUP_KV_KEY); } catch { /* */ }
}

/** Repair the D1 config rows from the KV backup (or env) when they've been
 *  deleted. Returns true when a repair was performed. Idempotent + cheap: a
 *  no-op when D1 already has the refresh token. */
export async function ensureCpgConfig(db: DB, env: EnvLike): Promise<boolean> {
  // If env supplies the token, D1 rows are optional — but still re-seed account/
  // user for display. If D1 already has the token, nothing to do.
  const hasD1Token = !!(await getConfigValue(db, KEYS.refreshToken));
  if (hasD1Token) return false;
  if (env.CPG_REFRESH_TOKEN) return false; // env override keeps working regardless
  const backup = await readConfigBackup(env);
  if (!backup?.refreshToken) return false;
  try {
    await setConfigValue(db, KEYS.refreshToken, backup.refreshToken);
    if (backup.userId) await setConfigValue(db, KEYS.userId, backup.userId);
    if (backup.account) await setConfigValue(db, KEYS.account, backup.account);
    log.info('config self-healed from KV backup');
    return true;
  } catch (err) { log.error('config restore failed', {}, err); return false; }
}

// ── Auth: refresh token → cached access token ────────────────

/** Exchange a ClearPath refresh token for a ~60-min access token via the
 *  portal's own backend endpoint (no IdP secret needed). Throws a typed error
 *  on rejection so callers can surface a clear message. */
async function mintToken(
  refreshToken: string, userId: string | null, account: string | null,
): Promise<{ token: string; ttl: number }> {
  const res = await fetch(`${API_BASE}/v1.0/auth/refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Security-App-Name': 'web',
      ...(account ? { 'X-Security-Account-ID': account } : {}),
    },
    body: JSON.stringify({ refreshTokenString: refreshToken, accountId: account ?? '', userIdCp: userId ?? '' }),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 401 || res.status === 400 || res.status === 403) {
    throw new CpgAuthError(`ClearPath refresh rejected (${res.status}) — reconnect required (refresh token expired/invalid)`);
  }
  if (!res.ok) throw new CpgHttpError(res.status, `ClearPath auth endpoint ${res.status}`);
  const json = await res.json() as { token?: string; exp?: number; iat?: number };
  if (!json.token) throw new CpgAuthError('Auth response missing token');
  // Cache slightly inside the token's lifetime; fall back to ~55 min.
  const ttl = json.exp && json.iat ? Math.max(60, (json.exp - json.iat) - 60) : 55 * 60;
  return { token: json.token, ttl };
}

/** Build a getToken() that serves a KV-cached access token, re-minting on
 *  expiry. The refresh token is captured here and never returned. */
function makeTokenGetter(env: EnvLike, refreshToken: string, userId: string | null, account: string | null): () => Promise<string> {
  return async function getToken(): Promise<string> {
    try {
      const cached = await env.KV.get(TOKEN_KV_KEY, 'json') as { token: string; exp: number } | null;
      if (cached && cached.exp - Date.now() > 60_000) return cached.token;
    } catch { /* KV optional */ }
    const { token, ttl } = await mintToken(refreshToken, userId, account);
    try {
      await env.KV.put(TOKEN_KV_KEY, JSON.stringify({ token, exp: Date.now() + ttl * 1000 }), { expirationTtl: ttl });
    } catch { /* KV optional */ }
    return token;
  };
}

/** Drop the cached token (after a 401) so the next call re-mints. */
async function invalidateToken(env: EnvLike): Promise<void> {
  try { await env.KV.delete(TOKEN_KV_KEY); } catch { /* */ }
}

/** Resolve the configured API client. The refresh token comes from env
 *  (CPG_REFRESH_TOKEN) when present, else from system_config (decrypted via
 *  CPG_ENC_KEY when stored encrypted). Returns null when not configured. */
export async function getApiConfig(db: DB, env: EnvLike): Promise<CpgClient | null> {
  let refreshToken = env.CPG_REFRESH_TOKEN || null;
  let userId = env.CPG_USER_ID || (await getConfigValue(db, KEYS.userId));
  let account = await getConfigValue(db, KEYS.account);
  if (!refreshToken) {
    let stored = await getConfigValue(db, KEYS.refreshToken);
    // Self-heal: if D1 lost the token but we have a durable KV backup, restore it.
    if (!stored) {
      if (await ensureCpgConfig(db, env)) {
        stored = await getConfigValue(db, KEYS.refreshToken);
        userId = userId || (await getConfigValue(db, KEYS.userId));
        account = account || (await getConfigValue(db, KEYS.account));
      }
    }
    if (stored) refreshToken = isEncrypted(stored) ? await decryptSecret(stored, env.CPG_ENC_KEY) : stored;
  }
  if (!refreshToken) return null;
  return { account, userId, getToken: makeTokenGetter(env, refreshToken, userId, account) };
}

export async function isEnabled(db: DB): Promise<boolean> {
  const v = await getConfigValue(db, KEYS.enabled);
  return v === '1' || v === 'true';
}

// ── HTTP helper (Bearer, 401-refresh, 429-aware) ─────────────

async function apiGet(env: EnvLike, client: CpgClient, path: string, params?: Record<string, string>): Promise<unknown> {
  const attempt = async (retried: boolean): Promise<unknown> => {
    const token = await client.getToken();
    const url = new URL(path, API_BASE);
    if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 401) {
      if (!retried) { await invalidateToken(env); return attempt(true); }
      throw new CpgAuthError();
    }
    if (res.status === 429) throw new CpgRateLimitError(parseInt(res.headers.get('Retry-After') || '60', 10));
    if (!res.ok) throw new CpgHttpError(res.status, `ClearPath API ${res.status}`);
    return res.json();
  };
  return attempt(false);
}

// ── Normalisers (pure, exported for tests) ───────────────────

function asArray(data: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(data)) return data;
  const obj = (data ?? {}) as Record<string, unknown>;
  for (const k of keys) if (Array.isArray(obj[k])) return obj[k] as unknown[];
  return [];
}

/** Normalise one raw ClearPath v1.0 vehicle record into a CpgDevice. The API
 *  uses a variety of field names across accounts; we read all the common
 *  aliases so the admin tab always gets a populated row. */
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
  const assetId = s('assetId', 'asset_id');
  return {
    deviceId: deviceId || assetId,
    assetId: assetId || undefined,
    uniqueId: s('uniqueId', 'unique_id', 'serialNumber', 'imei') || deviceId || assetId,
    serialNumber: s('serialNumber', 'serial_number', 'imei', 'simSerial'),
    displayName: s('displayName', 'display_name', 'name', 'vehicleName', 'description', 'label') || deviceId || assetId,
    lastValidLatitude: n('lastValidLatitude', 'latitude', 'lat', 'lastLatitude'),
    lastValidLongitude: n('lastValidLongitude', 'longitude', 'lng', 'lon', 'lastLongitude'),
    vehicleMake: s('vehicleMake', 'make'),
    vehicleModel: s('vehicleModel', 'model'),
    licensePlate: s('licensePlate', 'license_plate', 'licensePlateNumber', 'plate'),
    vehicleID: s('vehicleID', 'vin', 'VIN', 'vehicle_vin'),
    driverName: s('driverName', 'driver_name', 'driverDescription', 'driver'),
    ignitionState: s('ignitionState', 'ignition_state', 'ignition'),
    mediaEnabled: raw.mediaEnabled === true || raw.mediaEnabled === 'true' || undefined,
    description: s('description', 'notes') || undefined,
  };
}

/** Media-capable vehicle → camera-ish shape (assetId keys the media API). */
export function vehicleToCamera(d: CpgDevice): CpgCamera | null {
  const assetId = Number(d.assetId);
  if (!Number.isFinite(assetId)) return null;
  return {
    id: assetId,
    provider: 'clearpathgps',
    name: d.displayName || d.deviceId,
    providerId: d.deviceId,
    notes: d.description || '',
    lastCommunication: 0,
  };
}

// ── Public methods ───────────────────────────────────────────

/** List fleet devices (vehicles) from /v1.0/vehicles, across pages. */
export async function listDevices(env: EnvLike, client: CpgClient): Promise<CpgDevice[]> {
  const out: CpgDevice[] = [];
  let page = 0;
  const maxPages = 20;
  while (page < maxPages) {
    const data = await apiGet(env, client, '/v1.0/vehicles', { page: String(page), pageSize: '200' }) as
      { items?: unknown[]; totalPages?: number } | unknown[];
    const rows = asArray(data, 'items', 'vehicles', 'data');
    out.push(...rows.map((r) => toDevice(r as Record<string, unknown>)).filter((d) => d.deviceId));
    const totalPages = Array.isArray(data) ? 1 : (data?.totalPages ?? 1);
    if (page >= totalPages - 1 || !rows.length) break;
    page++;
  }
  return out;
}

/** Media-capable assets (dashcam-equipped vehicles), keyed by assetId. */
export async function listCameras(env: EnvLike, client: CpgClient): Promise<CpgCamera[]> {
  const devices = await listDevices(env, client);
  return devices.filter((d) => d.mediaEnabled).map(vehicleToCamera).filter((c): c is CpgCamera => !!c);
}

/** Resolve the camera-service ID for a given assetId.
 *  The on-demand request endpoint (/v2.0/media/cameras/{cameraId}/request-media)
 *  uses camera.id from /v1.0/assets/ids, which is DIFFERENT from the assetId. */
export async function getCameraIdForAsset(
  env: EnvLike, client: CpgClient, assetId: number,
): Promise<number | null> {
  try {
    const data = await apiGet(env, client, '/v1.0/assets/ids', {
      withDashcamsOnly: 'true', includeInactive: 'false', page: '0', pageSize: '200',
    }) as { items?: unknown[] };
    for (const item of asArray(data, 'items')) {
      const it = item as Record<string, unknown>;
      if (Number(it.id) === assetId) {
        const cam = it.camera as Record<string, unknown> | undefined;
        const camId = Number(cam?.id);
        return Number.isFinite(camId) && camId > 0 ? camId : null;
      }
    }
  } catch { /* not fatal — requestChunk will surface the error */ }
  return null;
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
  durationSec?: number | null;
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

/** Normalise one raw /v2.0/media/data mediaObject into the internal shape.
 *  The API uses cameraType/lat-lng; the pipeline consumes channel/latitude.
 *  Pure + exported for tests. */
export function normalizeMediaObject(raw: Record<string, unknown>, eventTypes: string): CpgMediaObject {
  const gpsRaw = Array.isArray(raw.gps) ? raw.gps as Array<Record<string, unknown>> : [];
  const gps = gpsRaw.map((g) => ({
    latitude: Number(g.lat ?? g.latitude ?? NaN),
    longitude: Number(g.lng ?? g.longitude ?? NaN),
    speed: Number(g.speed ?? 0),
    altitude: Number(g.altitude ?? 0),
    timestamp: Number(g.timestamp ?? 0),
  }));
  const first = gps[0];
  return {
    channel: String(raw.cameraType ?? raw.channel ?? 'outside').toLowerCase(),
    type: String(raw.type ?? 'VIDEO').toUpperCase(),
    title: String(raw.title ?? ''),
    thumbnailUrl: String(raw.thumbnailUrl ?? ''),
    accessUrl: String(raw.accessUrl ?? ''),
    status: String(raw.status ?? 'AVAILABLE').toUpperCase(),
    lastUpdate: Number(raw.lastUpdate ?? 0),
    expiringSoon: raw.expiringSoon === true,
    eventType: String(raw.eventType ?? eventTypes ?? ''),
    location: first && Number.isFinite(first.latitude) && Number.isFinite(first.longitude)
      ? { lat: first.latitude, lng: first.longitude } : null,
    gps: gps.length ? gps : undefined,
    durationSec: raw.duration != null && Number.isFinite(Number(raw.duration)) ? Number(raw.duration) : null,
  };
}

/** Normalise one raw /v2.0/media/data event into the internal CpgMediaEvent. */
export function normalizeMediaEvent(raw: Record<string, unknown>): CpgMediaEvent {
  const eventTypes = Array.isArray(raw.eventTypes) ? (raw.eventTypes as unknown[]).join(', ') : String(raw.eventType ?? '');
  const objsRaw = Array.isArray(raw.mediaObjects) ? raw.mediaObjects
    : Array.isArray(raw.mediaObject) ? raw.mediaObject : [];
  return {
    address: String(raw.address ?? ''),
    batchId: String(raw.batchId ?? ''),
    eventTimestamp: Number(raw.timestamp ?? raw.eventTimestamp ?? 0),
    lastUpdate: Number(raw.lastUpdate ?? 0),
    expiringSoon: raw.expiringSoon === true,
    status: String(raw.status ?? 'AVAILABLE').toUpperCase(),
    mediaObject: (objsRaw as Array<Record<string, unknown>>).map((o) => normalizeMediaObject(o, eventTypes)),
  };
}

/** One page of media for an asset within [from, to] epoch-ms. */
export async function listMedia(
  env: EnvLike, client: CpgClient, assetId: number, from: number, to: number, page = 0, pageSize = 50,
): Promise<CpgMediaListResponse> {
  const data = await apiGet(env, client, '/v2.0/media/data', {
    assetId: String(assetId), from: String(from), to: String(to), page: String(page), pageSize: String(pageSize),
  }) as Record<string, unknown>;
  const itemsRaw = Array.isArray(data.items) ? data.items as Array<Record<string, unknown>> : [];
  return {
    total: Number(data.total ?? itemsRaw.length),
    totalPages: Number(data.totalPages ?? 1),
    currentPage: Number(data.currentPage ?? page),
    pageSize: Number(data.pageSize ?? pageSize),
    items: itemsRaw.map(normalizeMediaEvent),
  };
}

/** All media across pages for an asset within [from, to]. Bounded by maxPages
 *  so a misbehaving account can't spin the cron. */
export async function listAllMedia(
  env: EnvLike, client: CpgClient, assetId: number, from: number, to: number, maxPages = 20,
): Promise<CpgMediaEvent[]> {
  const all: CpgMediaEvent[] = [];
  let page = 0;
  while (page < maxPages) {
    const resp = await listMedia(env, client, assetId, from, to, page, 50);
    if (resp.items?.length) all.push(...resp.items);
    if (page >= resp.totalPages - 1 || !resp.items?.length) break;
    page++;
  }
  return all;
}

/** Test connectivity: count visible fleet vehicles or throw a typed error. */
export async function testConnection(env: EnvLike, client: CpgClient): Promise<number> {
  const devices = await listDevices(env, client);
  return devices.length;
}

export { API_BASE };
