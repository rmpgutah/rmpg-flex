// ============================================================
// ClearPathGPS API Client
// ============================================================
// Handles authentication, token caching, and API requests
// to the ClearPathGPS Legacy API (api.clearpathgps.com).
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
  const [ivHex, authTagHex, ciphertext] = stored.split(':');
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
// API client
// ============================================================

const BASE_URL = 'https://api.clearpathgps.com/v1.0';

interface AuthTokens {
  token: string;
  refreshToken: string;
  userId: string;
  userIdCp: string;
  expiresAt: number;
}

let cachedAuth: AuthTokens | null = null;

export interface CpgAccount {
  accountId: string;
  accountName: string;
  [key: string]: any;
}

/** Discover available accounts for an email/password pair. */
async function fetchAccounts(email: string, password: string): Promise<CpgAccount[]> {
  const resp = await fetch(`${BASE_URL}/auth/accounts`, {
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
  return Array.isArray(data) ? data : data.items || data.accounts || [data];
}

/** Discover accounts using stored credentials — exposed for admin route. */
export async function discoverAccounts(): Promise<CpgAccount[]> {
  const email = getDecryptedValue(CONFIG_KEYS.email);
  const password = getDecryptedValue(CONFIG_KEYS.password);
  if (!email || !password) throw new Error('ClearPathGPS email/password not configured');
  return fetchAccounts(email, password);
}

/** Try to authenticate with a given accountId value. */
async function tryAuth(email: string, password: string, accountId: number | string): Promise<any> {
  const resp = await fetch(`${BASE_URL}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      emailId: email,
      password,
      accountId,
      appName: 'RMPG Flex',
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`ClearPathGPS auth failed (${resp.status}): ${text}`);
  }

  return resp.json();
}

/** Authenticate via /auth/accounts/switch/{accountId} after discovering accounts. */
async function tryAccountSwitch(email: string, password: string, accountId: string): Promise<any> {
  const resp = await fetch(`${BASE_URL}/auth/accounts/switch/${encodeURIComponent(accountId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emailId: email, password }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`ClearPathGPS account switch failed (${resp.status}): ${text}`);
  }

  return resp.json();
}

/** Authenticate with email/password/accountId and get JWT tokens.
 *  Strategy: 1) Try /auth/token directly  2) Discover accounts + switch */
async function authenticate(): Promise<AuthTokens> {
  const email = getDecryptedValue(CONFIG_KEYS.email);
  const password = getDecryptedValue(CONFIG_KEYS.password);
  const accountIdRaw = getDecryptedValue(CONFIG_KEYS.accountId);

  if (!email || !password || !accountIdRaw) {
    throw new Error('ClearPathGPS credentials not configured');
  }

  // Strategy 1: Try /auth/token directly with various accountId formats
  const numericId = parseInt(accountIdRaw.replace(/\D/g, ''), 10) || 0;
  const attempts: (number | string)[] = [numericId, accountIdRaw, 0];
  const unique = [...new Set(attempts.map(String))].map(v => /^\d+$/.test(v) ? Number(v) : v);

  let lastError = '';
  for (const id of unique) {
    try {
      const data = await tryAuth(email, password, id);
      cachedAuth = {
        token: data.token,
        refreshToken: data.refreshToken,
        userId: data.userId,
        userIdCp: data.userIdCp,
        expiresAt: Date.now() + 55 * 60 * 1000,
      };
      return cachedAuth;
    } catch (err: any) {
      lastError = err.message || 'Auth failed';
    }
  }

  // Strategy 2: Discover accounts, then switch to matching one
  try {
    console.log('[ClearPathGPS] Direct auth failed, trying account discovery...');
    const accounts = await fetchAccounts(email, password);
    console.log('[ClearPathGPS] Discovered accounts:', accounts.map(a => `${a.accountId} (${a.accountName})`).join(', '));

    if (accounts.length === 0) {
      throw new Error('No accounts found for this email');
    }

    // Try matching by stored accountId first, then try all accounts
    const sortedAccounts = [...accounts].sort((a, b) => {
      const aMatch = a.accountId === accountIdRaw || a.accountId === String(numericId);
      const bMatch = b.accountId === accountIdRaw || b.accountId === String(numericId);
      return (bMatch ? 1 : 0) - (aMatch ? 1 : 0);
    });

    for (const acct of sortedAccounts) {
      try {
        const data = await tryAccountSwitch(email, password, acct.accountId);
        cachedAuth = {
          token: data.token,
          refreshToken: data.refreshToken,
          userId: data.userId,
          userIdCp: data.userIdCp,
          expiresAt: Date.now() + 55 * 60 * 1000,
        };
        console.log(`[ClearPathGPS] Authenticated via account switch: ${acct.accountId} (${acct.accountName})`);
        return cachedAuth;
      } catch (err: any) {
        lastError = err.message || 'Account switch failed';
      }
    }

    // If switch didn't work, try /auth/token with discovered accountIds
    for (const acct of sortedAccounts) {
      try {
        const data = await tryAuth(email, password, acct.accountId);
        cachedAuth = {
          token: data.token,
          refreshToken: data.refreshToken,
          userId: data.userId,
          userIdCp: data.userIdCp,
          expiresAt: Date.now() + 55 * 60 * 1000,
        };
        console.log(`[ClearPathGPS] Authenticated with discovered accountId: ${acct.accountId}`);
        return cachedAuth;
      } catch (err: any) {
        lastError = err.message || 'Auth failed';
      }
    }
  } catch (discoverErr: any) {
    lastError = discoverErr.message || lastError;
  }

  throw new Error(lastError);
}

/** Refresh an existing JWT. */
async function refreshAuthToken(): Promise<AuthTokens> {
  if (!cachedAuth) throw new Error('No cached auth to refresh');

  const accountIdRaw = getDecryptedValue(CONFIG_KEYS.accountId);
  if (!accountIdRaw) throw new Error('ClearPathGPS account ID not configured');
  const numericId = parseInt(accountIdRaw.replace(/\D/g, ''), 10) || 0;

  const resp = await fetch(`${BASE_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accountId: numericId,
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
  cachedAuth = {
    token: data.token,
    refreshToken: data.refreshToken || cachedAuth.refreshToken,
    userId: data.userId || cachedAuth.userId,
    userIdCp: data.userIdCp || cachedAuth.userIdCp,
    expiresAt: Date.now() + 55 * 60 * 1000,
  };
  return cachedAuth;
}

/** Ensure we have a valid token — refresh or re-auth as needed. */
async function ensureAuth(): Promise<string> {
  if (cachedAuth && Date.now() < cachedAuth.expiresAt) {
    return cachedAuth.token;
  }

  // Try refresh first
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
    const resp = await fetch(`${BASE_URL}${endpoint}`, {
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
      // Re-authenticate and retry once
      cachedAuth = null;
      const newToken = await ensureAuth();
      return doFetch(newToken);
    }
    throw err;
  }
}

// ============================================================
// Public API methods
// ============================================================

export interface CpgDevice {
  gtsDeviceId: string;
  uniqueId: string;
  serialNumber: string;
  displayName: string;
  lastValidLatitude: number;
  lastValidLongitude: number;
  lastValidHeading: number;
  lastGpsTimestampUtc: string;
  vehicleMake: string;
  vehicleModel: string;
  vehiclePlateNumber: string;
  vin: string;
  driverName: string;
  ignitionState: string;
  [key: string]: any;
}

export interface CpgEventData {
  latitude: number;
  longitude: number;
  heading: number;
  speedMph: number;
  speedKmh: number;
  timestamp: string;
  ignition: boolean;
  address: string;
  streetAddress: string;
  city: string;
  stateProvince: string;
  deviceId: string;
  driverName: string;
  reportedOdometer: number;
  satelliteCount: number;
  statusCode: string;
  statusCodeText: string;
  [key: string]: any;
}

export interface CpgFleetEvent {
  eventData: CpgEventData[];
  trailPoints?: any[];
  device?: CpgDevice;
  [key: string]: any;
}

export interface CpgPaginatedResponse<T> {
  items: T[];
  totalItems: number;
  pageSize: number;
  page: number;
  [key: string]: any;
}

/** Fetch all devices registered in the ClearPathGPS account. */
export async function getDevices(): Promise<CpgDevice[]> {
  const data = await cpgFetch<CpgPaginatedResponse<CpgDevice>>('/devices?pageSize=500');
  return data.items || [];
}

/** Fetch latest fleet positions (one event per device with valid GPS). */
export async function getFleetLatest(): Promise<CpgFleetEvent[]> {
  const data = await cpgFetch<CpgPaginatedResponse<CpgFleetEvent>>(
    '/events/fleet/latest?hasValidGPS=true&pageSize=500'
  );
  return data.items || [];
}

/** Fetch event history for a specific device. */
export async function getDeviceHistory(
  deviceId: string,
  from: string,
  to: string
): Promise<CpgFleetEvent[]> {
  const data = await cpgFetch<CpgPaginatedResponse<CpgFleetEvent>>(
    `/events/device/${encodeURIComponent(deviceId)}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&hasValidGPS=true&pageSize=1000`
  );
  return data.items || [];
}

/** Test connection by authenticating and fetching device count. */
export async function testConnection(): Promise<{ success: boolean; deviceCount: number; error?: string }> {
  try {
    cachedAuth = null; // Force fresh auth
    await ensureAuth();
    const devices = await getDevices();
    return { success: true, deviceCount: devices.length };
  } catch (err: any) {
    return { success: false, deviceCount: 0, error: err.message || 'Connection failed' };
  }
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

/** Clear cached auth token (used when credentials change). */
export function clearCachedAuth(): void {
  cachedAuth = null;
}
