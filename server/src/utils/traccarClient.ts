// ============================================================
// Traccar GPS Tracking Server — API Client
// ============================================================
// Handles authentication and API requests to a Traccar instance.
// Uses HTTP Basic Auth (no JWT dance — much simpler than CPG).
// Credentials are AES-256-GCM encrypted using JWT_SECRET.
//
// Traccar API docs: https://www.traccar.org/api-reference/

import crypto from 'crypto';
import { getDb } from '../models/database';
import { localNow } from './timeUtils';
import config from '../config';

// ============================================================
// Encryption helpers (same pattern as clearPathGpsClient.ts)
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
// Config keys (stored in system_config, category='integrations')
// ============================================================

export const CONFIG_KEYS = {
  url: 'traccar_url',
  email: 'traccar_email',
  password: 'traccar_password',
  enabled: 'traccar_enabled',
  pollInterval: 'traccar_poll_interval',
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
// Types
// ============================================================

export interface TraccarDevice {
  id: number;
  name: string;
  uniqueId: string;         // IMEI or serial — used as device identifier
  status: string;            // 'online' | 'offline' | 'unknown'
  disabled: boolean;
  lastUpdate: string;        // ISO timestamp
  positionId: number;
  phone: string;
  model: string;
  category: string;
  attributes: Record<string, any>;
}

export interface TraccarPosition {
  id: number;
  deviceId: number;
  protocol: string;
  deviceTime: string;        // ISO — device clock time
  fixTime: string;           // ISO — when GPS fix was taken
  serverTime: string;        // ISO — when Traccar received it
  outdated: boolean;
  valid: boolean;
  latitude: number;
  longitude: number;
  altitude: number;
  speed: number;             // ★ IN KNOTS — must convert to mph (* 1.15078)
  course: number;            // heading in degrees (0-360)
  address: string | null;
  accuracy: number;
  attributes: {
    ignition?: boolean;
    odometer?: number;        // meters
    satellites?: number;
    distance?: number;        // meters since last position
    totalDistance?: number;    // meters total
    motion?: boolean;
    hours?: number;           // engine hours in ms
    alarm?: string;           // 'hardBraking', 'hardAcceleration', 'overspeed', etc.
    event?: string;
    [key: string]: any;
  };
}

// ============================================================
// Conversion helpers
// ============================================================

const KNOTS_TO_MPH = 1.15078;
const METERS_TO_MILES = 1 / 1609.344;

/** Convert Traccar speed (knots) to mph */
export function knotsToMph(knots: number): number {
  return Math.round(knots * KNOTS_TO_MPH * 10) / 10;
}

/** Convert meters to miles */
export function metersToMiles(meters: number): number {
  return Math.round(meters * METERS_TO_MILES * 100) / 100;
}

// ============================================================
// API client
// ============================================================

/** Build Basic Auth header value from stored credentials. */
function getBasicAuth(): string {
  const email = getDecryptedValue(CONFIG_KEYS.email);
  const password = getDecryptedValue(CONFIG_KEYS.password);
  if (!email || !password) throw new Error('Traccar credentials not configured');
  return 'Basic ' + Buffer.from(`${email}:${password}`).toString('base64');
}

/** Get the Traccar API base URL (default: http://localhost:8082) */
function getBaseUrl(): string {
  const url = getConfigValue(CONFIG_KEYS.url) || 'http://localhost:8082';
  return url.replace(/\/+$/, ''); // Strip trailing slash
}

/** Generic fetch wrapper with Basic Auth. */
async function traccarFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const auth = getBasicAuth();
  const base = getBaseUrl();

  const resp = await fetch(`${base}/api${endpoint}`, {
    ...options,
    headers: {
      'Authorization': auth,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Traccar API error (${resp.status}): ${text}`);
  }

  return resp.json() as Promise<T>;
}

// ============================================================
// Public API methods
// ============================================================

/** Fetch all devices registered in Traccar. */
export async function getDevices(): Promise<TraccarDevice[]> {
  return traccarFetch<TraccarDevice[]>('/devices');
}

/** Fetch latest positions — one per device (no params = all devices). */
export async function getPositions(): Promise<TraccarPosition[]> {
  return traccarFetch<TraccarPosition[]>('/positions');
}

/** Fetch position history for a specific device in a time range. */
export async function getPositionHistory(
  deviceId: number,
  from: string,
  to: string
): Promise<TraccarPosition[]> {
  return traccarFetch<TraccarPosition[]>(
    `/positions?deviceId=${deviceId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  );
}

/** Test connection by authenticating and fetching device count. */
export async function testConnection(): Promise<{ success: boolean; deviceCount: number; error?: string }> {
  try {
    const devices = await getDevices();
    return { success: true, deviceCount: devices.length };
  } catch (err: any) {
    return { success: false, deviceCount: 0, error: err.message || 'Connection failed' };
  }
}

/** Check if credentials are configured. */
export function isConfigured(): boolean {
  return !!(
    getConfigValue(CONFIG_KEYS.url) &&
    getConfigValue(CONFIG_KEYS.email) &&
    getConfigValue(CONFIG_KEYS.password)
  );
}

/** Check if integration is enabled. */
export function isEnabled(): boolean {
  return getConfigValue(CONFIG_KEYS.enabled) === 'true';
}
