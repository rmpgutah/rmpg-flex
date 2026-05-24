// ============================================================
// ClearPathGPS API Client v3.0
// Reusable utility for communicating with ClearPathGPS fleet
// tracking API. Handles authentication, pagination, date-range
// chunking, and retry with exponential backoff.
// ============================================================

import crypto from 'crypto';
import { getDb } from '../models/database';
import config from '../config';

// ─── Encryption (same pattern as microbilt.ts) ──────────────

function deriveKey(): Buffer {
  return crypto.createHash('sha256').update(config.jwt.secret).digest();
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

// ─── Config keys ────────────────────────────────────────────

export const CONFIG_KEYS = {
  account: 'clearpathgps_account',
  user: 'clearpathgps_user',
  password: 'clearpathgps_password',
  baseUrl: 'clearpathgps_base_url',
  enabled: 'clearpathgps_enabled',
  pollInterval: 'clearpathgps_poll_interval',
} as const;

// ─── Config helpers ─────────────────────────────────────────

export function getConfigValue(key: string): string | null {
  try {
    const db = getDb();
    const row = db.prepare(
      "SELECT config_value FROM system_config WHERE config_key = ? AND category = 'integrations' AND is_active = 1 LIMIT 1"
    ).get(key) as { config_value: string } | undefined;
    return row?.config_value || null;
  } catch { return null; }
}

function getDecryptedValue(key: string): string | null {
  const val = getConfigValue(key);
  if (!val) return null;
  try { return decrypt(val); } catch { return null; }
}

export interface ClearPathGpsCredentials {
  account: string;
  user: string;
  password: string;
  baseUrl: string;
}

export function getCredentials(): ClearPathGpsCredentials | null {
  const account = getDecryptedValue('clearpathgps_account');
  const user = getDecryptedValue('clearpathgps_user');
  const password = getDecryptedValue('clearpathgps_password');
  const baseUrl = getConfigValue('clearpathgps_base_url') || 'https://api.clearpathgps.com:8443';
  if (!account || !user || !password) return null;
  return { account, user, password, baseUrl };
}

export function isConfigured(): boolean {
  return getCredentials() !== null;
}

// ─── API request helper ─────────────────────────────────────

async function apiRequest(
  creds: ClearPathGpsCredentials,
  endpoint: string,
  params?: Record<string, string>,
  retries = 3,
): Promise<any> {
  const url = new URL(`/v3.0${endpoint}`, creds.baseUrl);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const authHeader = 'Basic ' + Buffer.from(`${creds.account}/${creds.user}:${creds.password}`).toString('base64');

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(30000),
      });

      if (res.status === 429) {
        // Rate limited — wait and retry
        const waitMs = Math.min(1000 * Math.pow(2, attempt), 10000);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`ClearPathGPS API ${res.status}: ${text}`);
      }

      return await res.json();
    } catch (err: any) {
      if (attempt === retries - 1) throw err;
      const waitMs = Math.min(1000 * Math.pow(2, attempt), 10000);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }
}

// ─── Public API methods ─────────────────────────────────────

export async function testConnection(creds: ClearPathGpsCredentials): Promise<boolean> {
  try {
    await apiRequest(creds, '/vehicles', { limit: '1' });
    return true;
  } catch {
    return false;
  }
}

export async function getVehicles(creds: ClearPathGpsCredentials): Promise<any[]> {
  const data = await apiRequest(creds, '/vehicles');
  return Array.isArray(data) ? data : (data?.vehicles || data?.data || []);
}

export async function getTrips(
  creds: ClearPathGpsCredentials,
  vehicleId: string,
  startDate: string,
  endDate: string,
): Promise<any[]> {
  const data = await apiRequest(creds, `/vehicles/${vehicleId}/trips`, {
    startDate,
    endDate,
  });
  return Array.isArray(data) ? data : (data?.trips || data?.data || []);
}

export async function getLocations(
  creds: ClearPathGpsCredentials,
  vehicleId: string,
  startDate: string,
  endDate: string,
): Promise<any[]> {
  const data = await apiRequest(creds, `/vehicles/${vehicleId}/locations`, {
    startDate,
    endDate,
  });
  return Array.isArray(data) ? data : (data?.locations || data?.data || []);
}

export async function getAlerts(
  creds: ClearPathGpsCredentials,
  vehicleId: string,
  startDate: string,
  endDate: string,
): Promise<any[]> {
  const data = await apiRequest(creds, `/vehicles/${vehicleId}/alerts`, {
    startDate,
    endDate,
  });
  return Array.isArray(data) ? data : (data?.alerts || data?.data || []);
}

// ─── Date chunking utility ──────────────────────────────────

/** Generate 30-day date range chunks going back from today to a given start date. */
export function generateDateChunks(startDate: Date, endDate: Date = new Date()): Array<{ start: string; end: string }> {
  const chunks: Array<{ start: string; end: string }> = [];
  let current = new Date(endDate);

  while (current > startDate) {
    const chunkEnd = new Date(current);
    const chunkStart = new Date(current);
    chunkStart.setDate(chunkStart.getDate() - 30);
    if (chunkStart < startDate) chunkStart.setTime(startDate.getTime());

    chunks.push({
      start: chunkStart.toISOString().split('T')[0],
      end: chunkEnd.toISOString().split('T')[0],
    });

    current = new Date(chunkStart);
    current.setDate(current.getDate() - 1);
  }

  return chunks.reverse();
}

// ─── Fleet event types ──────────────────────────────────────

export interface CpgEventData {
  deviceId: string;
  latitude: number;
  longitude: number;
  heading?: number;
  speedMph?: number;
  timestamp?: string | number;
  statusCode?: string;
  statusCodeText?: string;
  address?: string;
  streetAddress?: string;
  odometer?: number;
  reportedOdometer?: number;
  satelliteCount?: number;
  ignition?: boolean;
  driverName?: string;
}

export interface CpgFleetEvent {
  eventData?: CpgEventData[];
  device?: {
    id?: string;
    name?: string;
    dashcam_id?: string;
    [key: string]: any;
  };
}

// ─── Enabled check ──────────────────────────────────────────

export function isEnabled(): boolean {
  const val = getConfigValue(CONFIG_KEYS.enabled);
  return val === '1' || val === 'true';
}

// ─── Fleet latest positions ─────────────────────────────────

export async function getFleetLatest(): Promise<CpgFleetEvent[]> {
  const creds = getCredentials();
  if (!creds) return [];
  const data = await apiRequest(creds, '/fleet/latest');
  return Array.isArray(data) ? data : (data?.events || data?.data || []);
}

// ─── Device history ─────────────────────────────────────────

export async function getDeviceHistory(
  deviceId: string,
  startDate: string,
  endDate: string,
): Promise<CpgFleetEvent[]> {
  const creds = getCredentials();
  if (!creds) return [];
  const data = await apiRequest(creds, `/devices/${deviceId}/history`, {
    startDate,
    endDate,
  });
  return Array.isArray(data) ? data : (data?.events || data?.data || []);
}

// ─── Auth token helpers (for media API) ─────────────────────

let cachedAuthToken: string | null = null;

export async function getAuthToken(): Promise<string | null> {
  if (cachedAuthToken) return cachedAuthToken;
  const creds = getCredentials();
  if (!creds) return null;
  cachedAuthToken = Buffer.from(`${creds.account}/${creds.user}:${creds.password}`).toString('base64');
  return cachedAuthToken;
}

export function clearCachedAuth(): void {
  cachedAuthToken = null;
}
