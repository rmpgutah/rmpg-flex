// ============================================================
// ClearPathGPS API Client — v3.0
// ============================================================
// Handles authentication, token caching, and API requests
// to the ClearPathGPS v3.0 API (api.clearpathgps.com/v3.0).
// Credentials are AES-256-GCM encrypted using JWT_SECRET.

import crypto from 'crypto';
import { getDb } from '../models/database';
import { localNow } from './timeUtils';
import config from '../config';

// ============================================================
// Encryption helpers (same pattern as microbilt.ts)
// ============================================================

function deriveKey(): Buffer {
  return crypto.createHash('sha256').update(config.jwt.secret).digest();
}

function encrypt(plaintext: string): string {
  const key = deriveKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(stored: string): string {
  const key = deriveKey();
  const parts = stored.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted format');
  const [ivHex, authTagHex, ciphertext] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ============================================================
// Config helpers
// ============================================================

export const CONFIG_KEYS = {
  email: 'clearpathgps_email',
  password: 'clearpathgps_password',
  accountId: 'clearpathgps_account_id',
  enabled: 'clearpathgps_enabled',
  pollInterval: 'clearpathgps_poll_interval',
} as const;

export function getConfigValue(key: string): string | null {
  try {
    const db = getDb();
    const row = db.prepare(
      "SELECT config_value FROM system_config WHERE config_key = ? AND category = 'integrations' AND is_active = 1 LIMIT 1"
    ).get(key) as { config_value: string } | undefined;
    return row?.config_value || null;
  } catch { return null; }
}

export function getDecryptedValue(key: string): string | null {
  const val = getConfigValue(key);
  if (!val) return null;
  try { return decrypt(val); } catch { return null; }
}

export function setConfigValue(key: string, value: string, shouldEncrypt = false): void {
  const db = getDb();
  const now = localNow();
  const stored = shouldEncrypt ? encrypt(value) : value;

  db.prepare(
    "DELETE FROM system_config WHERE config_key = ? AND category = 'integrations'"
  ).run(key);

  db.prepare(
    "INSERT INTO system_config (config_key, config_value, category, sort_order, is_active, created_at, updated_at) VALUES (?, ?, 'integrations', 0, 1, ?, ?)"
  ).run(key, stored, now, now);
}

export function deleteConfigValue(key: string): void {
  const db = getDb();
  db.prepare(
    "DELETE FROM system_config WHERE config_key = ? AND category = 'integrations'"
  ).run(key);
}

// ============================================================
// API client — v3.0
// ============================================================

// v3.0 primary, v1.0 fallback for legacy accounts
const BASE_URL_V3 = 'https://api.clearpathgps.com/v3.0';
const BASE_URL_V1 = 'https://api.clearpathgps.com/v1.0';
let activeBaseUrl = BASE_URL_V3;

interface AuthTokens {
  token: string;
  refreshToken: string;
  userId: string;   // email or user identifier
  userIdCp: number; // numeric ClearPathGPS user ID
  accountIdCp: number; // numeric ClearPathGPS account ID
  expiresAt: number;
}

let cachedAuth: AuthTokens | null = null;

/** Parse a ClearPathGPS auth response into our AuthTokens format. */
function parseAuthResponse(data: any): AuthTokens {
  return {
    token: data.token,
    refreshToken: data.refreshToken || '',
    userId: data.userId || '',
    userIdCp: data.userIdCP || data.userIdCp || 0,
    accountIdCp: data.accountIdCP || data.accountIdCp || 0,
    expiresAt: data.exp ? data.exp * 1000 : Date.now() + 55 * 60 * 1000,
  };
}

export interface CpgAccount {
  accountId: string;
  accountName: string;
  [key: string]: any;
}

/** Discover available accounts for an email/password pair. */
async function fetchAccounts(email: string, password: string): Promise<{ accounts: CpgAccount[] }> {
  const resp = await fetch(`${activeBaseUrl}/auth/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emailId: email, password }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`ClearPathGPS account discovery failed (${resp.status}): ${text}`);
  }

  const data = await resp.json();
  const accounts: CpgAccount[] = data.items || (Array.isArray(data) ? data : []);
  return { accounts };
}

/** Discover accounts using stored credentials — exposed for admin route. */
export async function discoverAccounts(): Promise<CpgAccount[]> {
  const email = getDecryptedValue(CONFIG_KEYS.email);
  const password = getDecryptedValue(CONFIG_KEYS.password);
  if (!email || !password) throw new Error('ClearPathGPS email/password not configured');
  const result = await fetchAccounts(email, password);
  return result.accounts;
}

/** Try to authenticate with a given accountId value. */
async function tryAuth(email: string, password: string, accountId: number | string): Promise<any> {
  const resp = await fetch(`${activeBaseUrl}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emailId: email, password, accountId }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`ClearPathGPS auth failed (${resp.status}): ${text}`);
  }

  return resp.json();
}

/** Authenticate via /auth/accounts/switch/{accountId} after discovering accounts. */
async function tryAccountSwitch(accountId: string, sessionToken: string): Promise<any> {
  const resp = await fetch(`${activeBaseUrl}/auth/accounts/switch/${encodeURIComponent(accountId)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`ClearPathGPS account switch failed (${resp.status}): ${text}`);
  }

  return resp.json();
}

/** Authenticate with email/password/accountId and get JWT tokens.
 *  Strategy: 1) Try v3.0 /auth/token  2) Fall back to v1.0  3) Discover accounts */
async function authenticate(): Promise<AuthTokens> {
  const email = getDecryptedValue(CONFIG_KEYS.email);
  const password = getDecryptedValue(CONFIG_KEYS.password);
  const accountIdRaw = getDecryptedValue(CONFIG_KEYS.accountId) || '';

  if (!email || !password) {
    throw new Error('ClearPathGPS credentials not configured');
  }

  let lastError = '';

  // Strategy 1: Try /auth/token directly with stored accountId formats
  // Try v3.0 first, then v1.0 fallback
  if (accountIdRaw) {
    const numericId = parseInt(accountIdRaw.replace(/\D/g, ''), 10) || 0;
    const attempts: (number | string)[] = [numericId, accountIdRaw];
    if (numericId !== 0) attempts.push(numericId);
    const unique = [...new Set(attempts.map(String))].map(v => /^\d+$/.test(v) ? Number(v) : v);

    for (const baseUrl of [BASE_URL_V3, BASE_URL_V1]) {
      activeBaseUrl = baseUrl;
      for (const id of unique) {
        try {
          const data = await tryAuth(email, password, id);
          cachedAuth = parseAuthResponse(data);
          const version = baseUrl === BASE_URL_V3 ? 'v3.0' : 'v1.0';
          console.log(`[ClearPathGPS] Authenticated (${version}) with stored accountId=${JSON.stringify(id)}`);
          return cachedAuth;
        } catch (err: any) {
          lastError = err.message || 'Auth failed';
        }
      }
    }
  }

  // Strategy 2: Discover accounts, then try /auth/token with correct numeric ID
  // Try both v3.0 and v1.0 for discovery
  console.log('[ClearPathGPS] Direct auth failed, trying account discovery...');
  activeBaseUrl = BASE_URL_V3;
  let accounts: CpgAccount[] = [];
  try {
    const result = await fetchAccounts(email, password);
    accounts = result.accounts;
  } catch {
    // v3.0 discovery failed, try v1.0
    activeBaseUrl = BASE_URL_V1;
    try {
      const result = await fetchAccounts(email, password);
      accounts = result.accounts;
    } catch (err: any) {
      lastError = err.message || 'Discovery failed';
    }
  }

  if (accounts.length === 0) {
    throw new Error(lastError || 'No accounts found for this email');
  }

  console.log('[ClearPathGPS] Discovered accounts:', accounts.map(a =>
    `${a.accountId} / ${a.accountIdGts || '?'} (${a.description || '?'})`
  ).join(', '));

  for (const acct of accounts) {
    const numId = Number(acct.accountId);
    if (!isNaN(numId) && numId > 0) {
      try {
        console.log(`[ClearPathGPS] Trying /auth/token with discovered accountId=${numId}`);
        const data = await tryAuth(email, password, numId);
        cachedAuth = parseAuthResponse(data);
        console.log(`[ClearPathGPS] Authenticated via discovery with accountId=${numId}`);
        setConfigValue(CONFIG_KEYS.accountId, String(numId), true);
        return cachedAuth;
      } catch (err: any) {
        console.log(`[ClearPathGPS] /auth/token failed with accountId=${numId}: ${err.message}`);
        lastError = err.message || 'Auth failed';
      }
    }

    if (acct.accountIdGts) {
      try {
        const data = await tryAuth(email, password, acct.accountIdGts);
        cachedAuth = parseAuthResponse(data);
        console.log(`[ClearPathGPS] Authenticated with accountIdGts=${acct.accountIdGts}`);
        setConfigValue(CONFIG_KEYS.accountId, acct.accountIdGts, true);
        return cachedAuth;
      } catch (err: any) {
        lastError = err.message || 'Auth failed';
      }
    }
  }

  throw new Error(lastError);
}

/** Refresh an existing JWT. */
async function refreshAuthToken(): Promise<AuthTokens> {
  if (!cachedAuth) throw new Error('No cached auth to refresh');
  if (!cachedAuth.refreshToken) throw new Error('No refresh token available');

  const resp = await fetch(`${activeBaseUrl}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accountId: cachedAuth.accountIdCp,
      refreshTokenString: cachedAuth.refreshToken,
      userId: cachedAuth.userId,
      userIdCp: cachedAuth.userIdCp,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) {
    cachedAuth = null;
    throw new Error(`ClearPathGPS token refresh failed (${resp.status})`);
  }

  const data = await resp.json();
  const prev = cachedAuth;
  cachedAuth = {
    ...parseAuthResponse(data),
    refreshToken: data.refreshToken || prev.refreshToken,
    userId: data.userId || prev.userId,
    userIdCp: data.userIdCP || data.userIdCp || prev.userIdCp,
    accountIdCp: data.accountIdCP || data.accountIdCp || prev.accountIdCp,
  };
  return cachedAuth;
}

/** Ensure we have a valid token — refresh or re-auth as needed. */
async function ensureAuth(): Promise<string> {
  if (cachedAuth && Date.now() < cachedAuth.expiresAt) {
    return cachedAuth.token;
  }

  if (cachedAuth) {
    try {
      const refreshed = await refreshAuthToken();
      return refreshed.token;
    } catch {
      // Refresh failed — fall through to full auth
    }
  }

  const auth = await authenticate();
  return auth.token;
}

/** Generic fetch wrapper with auth header and 401 retry. */
async function cpgFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = await ensureAuth();

  const doFetch = async (authToken: string) => {
    const resp = await fetch(`${activeBaseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (resp.status === 401) {
      throw { status: 401 };
    }

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`ClearPathGPS API error (${resp.status}): ${text}`);
    }

    return resp.json() as Promise<T>;
  };

  try {
    return await doFetch(token);
  } catch (err: any) {
    if (err?.status === 401) {
      cachedAuth = null;
      const newToken = await ensureAuth();
      return doFetch(newToken);
    }
    throw err;
  }
}

/** Fetch binary content (for media downloads) — returns buffer for small files. */
async function cpgFetchBinary(endpoint: string): Promise<{ buffer: Buffer; contentType: string }> {
  const token = await ensureAuth();
  const resp = await fetch(`${activeBaseUrl}${endpoint}`, {
    headers: { 'Authorization': `Bearer ${token}` },
    signal: AbortSignal.timeout(120_000), // 2min for large video files
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`ClearPathGPS media error (${resp.status}): ${text}`);
  }

  const buffer = Buffer.from(await resp.arrayBuffer());
  const contentType = resp.headers.get('content-type') || 'application/octet-stream';
  return { buffer, contentType };
}

/** Stream binary content directly to an Express response — avoids buffering. */
export async function cpgStreamTo(endpoint: string, res: import('express').Response): Promise<void> {
  const token = await ensureAuth();
  const resp = await fetch(`${activeBaseUrl}${endpoint}`, {
    headers: { 'Authorization': `Bearer ${token}` },
    signal: AbortSignal.timeout(300_000), // 5min for large downloads
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`ClearPathGPS stream error (${resp.status}): ${text}`);
  }

  const contentType = resp.headers.get('content-type') || 'application/octet-stream';
  const contentLength = resp.headers.get('content-length');

  res.setHeader('Content-Type', contentType);
  if (contentLength) res.setHeader('Content-Length', contentLength);
  res.setHeader('Cache-Control', 'private, max-age=3600');

  // Stream the response body directly — no buffering
  if (resp.body) {
    const reader = resp.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    } catch (err) {
      reader.cancel();
      if (!res.headersSent) throw err;
    }
  } else {
    // Fallback: buffer (shouldn't happen with modern fetch)
    const buffer = Buffer.from(await resp.arrayBuffer());
    res.send(buffer);
  }
}

// ============================================================
// Timestamp helpers
// ============================================================

/** Convert ISO date string or Date to epoch seconds for v3.0 API. */
export function toEpochSeconds(dateStr: string | Date): number {
  const d = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
  return Math.floor(d.getTime() / 1000);
}

/** Convert epoch (seconds or milliseconds) to ISO string. */
export function fromEpochToIso(epoch: number): string {
  // Heuristic: if > year 2100 in seconds, it's milliseconds
  const ms = epoch > 4_102_444_800 ? epoch : epoch * 1000;
  return new Date(ms).toISOString();
}

// ============================================================
// v3.0 Interfaces
// ============================================================

export interface CpgDevice {
  deviceId: string;
  uniqueId: string;
  displayName: string;
  description: string;
  deviceCode?: string;
  deviceType?: string;
  driverId?: string;
  driverName: string;
  vehicleID: string;         // VIN
  vehicleMake: string;
  vehicleModel: string;
  licensePlate: string;
  // v3.0: lat/lng are numbers on DeviceModel (only EventDataModel has strings)
  lastValidLatitude: number;
  lastValidLongitude: number;
  lastValidHeading: number;
  lastGPSTimestamp: number;
  lastEventTimestamp?: number;
  lastOdometerKM?: number;
  lastEngineHours?: number;
  maximumSpeed?: number;
  suspended?: boolean;
  mediaEnabled?: boolean;
  ignitionState?: string;
  notes?: string;
  [key: string]: any;
}

export interface CpgEventData {
  // v3.0: lat/lng are STRINGS in EventDataModel
  latitude: string;
  longitude: string;
  heading: number;
  speedMph: number;
  speedKmh: number;
  timestamp: number; // v3.0: epoch integer
  ignition: string;  // v3.0: string not boolean
  address: string;
  streetAddress: string;
  city: string;
  stateProvince: string;
  deviceId: string;
  driverId?: string;
  driverName?: string;
  statusCode: number | string;
  statusCodeText: string;
  statusColor?: string;
  odometerKm?: number;
  reportedOdometer?: number;
  satelliteCount: number;
  acceleration?: number;
  deceleration?: number;
  altitude?: number;
  signalStrength?: number;
  batteryVolts?: number;
  vbatteryVolts?: number;
  fuelLevel?: number;
  engineHours?: number;
  gpsAge?: number;
  hdop?: number;
  [key: string]: any;
}

/** v3.0 EventDataSetModel — wraps eventData array with device metadata. */
export interface CpgFleetEvent {
  id?: string;
  displayName?: string;
  description?: string;
  driverId?: string;
  driverName?: string;
  shortName?: string;
  mediaEnabled?: boolean;
  lastOdometerKM?: number;
  lastEngineHours?: number;
  eventData: CpgEventData[];
  [key: string]: any;
}

/** v3.0 Media object within a media event. */
export interface CpgMediaObject {
  channel: string;
  eventType: string;
  type: string;           // "video" or "image"
  title?: string;
  status?: string;
  accessUrl?: string;
  thumbnailUrl?: string;
  mediaCapturedTimestamp?: number;
  lastUpdate?: number;
  expiringSoon?: boolean;
  accelerometer?: { timestamp: number; x: number; y: number; z: number }[];
  gps?: { latitude: number; longitude: number; speed: number; altitude: number; bearing: number; accuracy: number; timestamp: number }[];
  [key: string]: any;
}

/** v3.0 Media event for a device. */
export interface CpgMediaEvent {
  deviceId: string;
  displayName?: string;
  address?: string;
  eventTimestamp: number;
  lastUpdate?: number;
  statusCode?: number;
  statusCodeText?: string;
  expiringSoon?: boolean;
  mediaObject: CpgMediaObject[];
}

/** v3.0 Paginated media response. */
export interface CpgMediaListResponse {
  pageData: CpgMediaEvent[];
  currentPage: number;
  totalPages: number;
}

/** v3.0 Geozone model. */
export interface CpgGeozone {
  geozoneId: string;
  displayName: string;
  description?: string;
  type?: string;
  radius?: number;
  arrivalZone?: boolean;
  departureZone?: boolean;
  zoneColor?: string;
  coordinates?: { index: number; latitude: string; longitude: string }[];
  [key: string]: any;
}

/** v3.0 Driver model. */
export interface CpgDriver {
  driverId: string;
  name: string;
  displayName: string;
  description?: string;
  badgeId?: string;
  contactEmail?: string;
  contactPhone?: string;
  licenseNumber?: string;
  licenseType?: string;
  licenseExpiresAt?: number;
  deviceId?: string;
  [key: string]: any;
}

/** v3.0 Camera ping response. */
export interface CpgCameraPing {
  status: string;
}

/** v3.0 Media request body. */
export interface CpgMediaRequest {
  insideCam?: boolean;
  outsideCam?: boolean;
  insideType?: 'video' | 'image';
  outsideType?: 'video' | 'image';
  timestamp?: number;
}

// ============================================================
// Coordinate parsing — v3.0 returns lat/lng as strings
// ============================================================

/** Parse lat/lng from v3.0 EventDataModel (strings) to numbers. */
export function parseLat(ed: CpgEventData): number {
  return typeof ed.latitude === 'string' ? parseFloat(ed.latitude) : Number(ed.latitude) || 0;
}

export function parseLng(ed: CpgEventData): number {
  return typeof ed.longitude === 'string' ? parseFloat(ed.longitude) : Number(ed.longitude) || 0;
}

/** Parse ignition from v3.0 (string) to boolean. */
export function parseIgnition(ed: CpgEventData): boolean {
  if (typeof ed.ignition === 'boolean') return ed.ignition;
  if (typeof ed.ignition === 'string') return ed.ignition.toLowerCase() === 'true' || ed.ignition === '1' || ed.ignition.toLowerCase() === 'on';
  return false;
}

/** Get odometer in km — v3.0 uses odometerKm field. */
export function parseOdometer(ed: CpgEventData): number | null {
  return ed.odometerKm ?? ed.reportedOdometer ?? null;
}

/** Convert timestamp (epoch number or ISO string) to formatted string for DB storage. */
export function formatEventTimestamp(ts: number | string | undefined): string {
  if (!ts) return localNow();
  if (typeof ts === 'string') {
    // v1.0 returns ISO strings
    return new Date(ts).toISOString().replace('T', ' ').replace('Z', '');
  }
  // v3.0 returns epoch integers (seconds or ms)
  const ms = ts > 4_102_444_800 ? ts : ts * 1000;
  return new Date(ms).toISOString().replace('T', ' ').replace('Z', '');
}

// ============================================================
// Public API methods — Devices
// ============================================================

/** Fetch all devices — v3.0 uses /devices/all, v1.0 uses /devices. */
export async function getDevices(): Promise<CpgDevice[]> {
  const endpoint = activeBaseUrl === BASE_URL_V3
    ? '/devices/all?includeInactive=false&mediaEnabled=true'
    : '/devices?pageSize=500';
  const data = await cpgFetch<any>(endpoint);
  // Handle both array and paginated response formats
  return Array.isArray(data) ? data : (data.items || []);
}

// ============================================================
// Public API methods — Events
// ============================================================

/** Fetch latest fleet positions — one EventDataSetModel per device. */
export async function getFleetLatest(): Promise<CpgFleetEvent[]> {
  const endpoint = activeBaseUrl === BASE_URL_V3
    ? '/events/fleet/latest?includeInactive=false'
    : '/events/fleet/latest?hasValidGPS=true&pageSize=500';
  const data = await cpgFetch<any>(endpoint);
  // v3.0 returns array directly, v1.0 returns { items: [...] }
  return Array.isArray(data) ? data : (data.items || []);
}

/** Fetch latest event for a single device. */
export async function getDeviceLatest(deviceId: string): Promise<CpgFleetEvent | null> {
  try {
    const data = await cpgFetch<CpgFleetEvent>(
      `/events/device/${encodeURIComponent(deviceId)}/latest`
    );
    return data || null;
  } catch { return null; }
}

/** Fetch event history for a specific device — up to 6000 points.
 *  from/to accept ISO strings or epoch integers. */
export async function getDeviceHistory(
  deviceId: string,
  from: string | number,
  to: string | number
): Promise<CpgFleetEvent[]> {
  if (activeBaseUrl === BASE_URL_V3) {
    // v3.0: epoch seconds, limit/limitType params
    const fromEpoch = typeof from === 'number' ? from : toEpochSeconds(from);
    const toEpoch = typeof to === 'number' ? to : toEpochSeconds(to);
    const data = await cpgFetch<any>(
      `/events/device/${encodeURIComponent(deviceId)}?from=${fromEpoch}&to=${toEpoch}&limit=6000&limitType=last`
    );
    // v3.0 returns a single EventDataSetModel
    return data ? [data] : [];
  } else {
    // v1.0: ISO strings, pageSize param
    const fromStr = typeof from === 'number' ? fromEpochToIso(from) : from;
    const toStr = typeof to === 'number' ? fromEpochToIso(to) : to;
    const data = await cpgFetch<any>(
      `/events/device/${encodeURIComponent(deviceId)}?from=${encodeURIComponent(fromStr)}&to=${encodeURIComponent(toStr)}&hasValidGPS=true&pageSize=5000`
    );
    return Array.isArray(data) ? data : (data.items || []);
  }
}

/** Fetch all event status codes. */
export async function getStatusCodes(): Promise<any> {
  return cpgFetch<any>('/events/statuscodes');
}

/** Fetch event type mappings. */
export async function getEventTypes(): Promise<any> {
  return cpgFetch<any>('/events/types');
}

// ============================================================
// Public API methods — Media (NEW in v3.0)
// ============================================================

/** List media events for a device within a time range. */
export async function getMediaList(
  deviceId: string,
  from: number,
  to: number,
  options?: { mediaType?: 'image' | 'video'; eventType?: string; page?: number; pageSize?: number }
): Promise<CpgMediaListResponse> {
  let url = `/media/list/${encodeURIComponent(deviceId)}?from=${from}&to=${to}`;
  if (options?.mediaType) url += `&mediaType=${options.mediaType}`;
  if (options?.eventType) url += `&eventType=${encodeURIComponent(options.eventType)}`;
  if (options?.page) url += `&page=${options.page}`;
  if (options?.pageSize) url += `&pageSize=${options.pageSize}`;

  return cpgFetch<CpgMediaListResponse>(url);
}

/** Get media detail for a specific device + timestamp. */
export async function getMediaDetail(deviceId: string, timestamp: number): Promise<CpgMediaEvent> {
  return cpgFetch<CpgMediaEvent>(
    `/media/${encodeURIComponent(deviceId)}?timestamp=${timestamp}`
  );
}

/** Download media file — returns binary buffer and content type. */
export async function downloadMedia(deviceId: string, timestamp: number): Promise<{ buffer: Buffer; contentType: string }> {
  return cpgFetchBinary(
    `/media/download/${encodeURIComponent(deviceId)}?timestamp=${timestamp}`
  );
}

/** Request new media capture from camera. */
export async function requestMedia(deviceId: string, body: CpgMediaRequest): Promise<string> {
  return cpgFetch<string>(
    `/media/request/${encodeURIComponent(deviceId)}`,
    { method: 'POST', body: JSON.stringify(body) }
  );
}

/** Ping camera to check status. */
export async function pingCamera(deviceId: string): Promise<CpgCameraPing> {
  return cpgFetch<CpgCameraPing>(
    `/media/ping/${encodeURIComponent(deviceId)}`
  );
}

// ============================================================
// Public API methods — Geozones (NEW in v3.0)
// ============================================================

/** Fetch all geozones. */
export async function getGeozones(): Promise<CpgGeozone[]> {
  return cpgFetch<CpgGeozone[]>('/geozones/all');
}

/** Fetch a single geozone. */
export async function getGeozone(geozoneId: string): Promise<CpgGeozone> {
  return cpgFetch<CpgGeozone>(`/geozones/${encodeURIComponent(geozoneId)}`);
}

/** Get geozone activity within a time range. */
export async function getGeozoneActivity(geozoneId: string, from: number, to: number): Promise<any> {
  return cpgFetch<any>(`/geozones/activity/${encodeURIComponent(geozoneId)}?from=${from}&to=${to}`);
}

// ============================================================
// Public API methods — Drivers (NEW in v3.0)
// ============================================================

/** Fetch all drivers. */
export async function getDrivers(): Promise<CpgDriver[]> {
  return cpgFetch<CpgDriver[]>('/drivers/all');
}

/** Fetch a single driver. */
export async function getDriver(driverId: string): Promise<CpgDriver> {
  return cpgFetch<CpgDriver>(`/drivers/get/${encodeURIComponent(driverId)}`);
}

// ============================================================
// Public API methods — Device Groups (NEW in v3.0)
// ============================================================

/** Fetch all device groups. */
export async function getDeviceGroups(withDevices = false): Promise<any[]> {
  return cpgFetch<any[]>(`/groups/all?withDevices=${withDevices}`);
}

// ============================================================
// Public API methods — Search (NEW in v3.0)
// ============================================================

/** Search devices, groups, geozones, drivers. */
export async function search(query: string): Promise<any[]> {
  if (query.length < 3) return [];
  return cpgFetch<any[]>(`/search?search=${encodeURIComponent(query)}`);
}

// ============================================================
// Connection test + config checks
// ============================================================

/** Test connection by authenticating and fetching device count. */
export async function testConnection(): Promise<{ success: boolean; deviceCount: number; apiVersion: string; error?: string }> {
  try {
    cachedAuth = null;
    await ensureAuth();
    const devices = await getDevices();
    const version = activeBaseUrl === BASE_URL_V3 ? '3.0' : '1.0';
    return { success: true, deviceCount: devices.length, apiVersion: version };
  } catch (err: any) {
    return { success: false, deviceCount: 0, apiVersion: 'unknown', error: err.message || 'Connection failed' };
  }
}

/** Get the currently active API version. */
export function getActiveApiVersion(): string {
  return activeBaseUrl === BASE_URL_V3 ? '3.0' : '1.0';
}

/** Check if credentials are configured. */
export function isConfigured(): boolean {
  return !!(
    getConfigValue(CONFIG_KEYS.email) &&
    getConfigValue(CONFIG_KEYS.password) &&
    getConfigValue(CONFIG_KEYS.accountId)
  );
}

/** Check if integration is enabled. */
export function isEnabled(): boolean {
  return getConfigValue(CONFIG_KEYS.enabled) === 'true';
}

/** Get a valid auth token for use by other modules (e.g. v3.0 media client).
 *  Reuses the cached token, refreshes if expired, or re-authenticates. */
export async function getAuthToken(): Promise<string> {
  return ensureAuth();
}

/** Clear cached auth token (used when credentials change). */
export function clearCachedAuth(): void {
  cachedAuth = null;
  activeBaseUrl = BASE_URL_V3; // Reset to try v3.0 first on next auth
}
