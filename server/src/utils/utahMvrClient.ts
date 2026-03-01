// ============================================================
// Utah Motor Vehicle Records (MVR) Client Utility
// ============================================================
// Handles: credential resolution (DB > env), encryption, HTTP requests
// to the Utah Division of Motor Vehicles (DLD) API at secure.utah.gov.
// Mirrors the serveManagerClient.ts pattern exactly.

import crypto from 'crypto';
import { getDb } from '../models/database';
import config from '../config';

// Utah DLD API base URL (electronic records access)
const UTAH_MVR_BASE_URL = 'https://secure.utah.gov/dhr/api';

// ── Encryption helpers (reuse same AES-256-GCM keyed from JWT secret) ──

function deriveKey(): Buffer {
  return crypto.createHash('sha256').update(config.jwt.secret).digest();
}

export function encryptCredential(plaintext: string): string {
  const key = deriveKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decryptCredential(stored: string): string {
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

// ── Credential Resolution (DB first, env fallback) ─────────────

export interface MvrCredentials {
  username: string;
  password: string;
}

export function getMvrCredentials(): MvrCredentials | null {
  try {
    const db = getDb();
    const usernameRow = db.prepare(
      "SELECT config_value FROM system_config WHERE config_key = 'utah_mvr_username' AND category = 'integrations' AND is_active = 1 LIMIT 1"
    ).get() as { config_value: string } | undefined;
    const passwordRow = db.prepare(
      "SELECT config_value FROM system_config WHERE config_key = 'utah_mvr_password' AND category = 'integrations' AND is_active = 1 LIMIT 1"
    ).get() as { config_value: string } | undefined;

    if (usernameRow?.config_value && passwordRow?.config_value) {
      return {
        username: decryptCredential(usernameRow.config_value),
        password: decryptCredential(passwordRow.config_value),
      };
    }
  } catch { /* DB credentials not set or decrypt failed */ }

  // Env fallback
  const envUser = process.env.UTAH_MVR_USERNAME;
  const envPass = process.env.UTAH_MVR_PASSWORD;
  if (envUser && envPass) {
    return { username: envUser, password: envPass };
  }

  return null;
}

export function isConfigured(): boolean {
  return getMvrCredentials() !== null;
}

// ── Types ────────────────────────────────────────────────────

export interface MvrRequestOptions {
  method?: 'GET' | 'POST';
  body?: Record<string, any>;
  params?: Record<string, string>;
}

export interface MvrResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

export class UtahMvrError extends Error {
  status: number;
  responseBody: any;
  constructor(message: string, status: number, body?: any) {
    super(message);
    this.name = 'UtahMvrError';
    this.status = status;
    this.responseBody = body;
  }
}

// ── Core HTTP helper ─────────────────────────────────────────

export async function mvrFetch<T = any>(
  endpoint: string,
  options: MvrRequestOptions = {}
): Promise<MvrResponse<T>> {
  const creds = getMvrCredentials();
  if (!creds) {
    throw new UtahMvrError('Utah MVR credentials not configured', 401);
  }

  const { method = 'GET', body, params } = options;

  let url = `${UTAH_MVR_BASE_URL}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;
  if (params && Object.keys(params).length > 0) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      sp.append(k, v);
    }
    url += `?${sp.toString()}`;
  }

  // Utah DLD uses Basic Auth with username:password
  const authHeader = 'Basic ' + Buffer.from(`${creds.username}:${creds.password}`).toString('base64');
  const headers: Record<string, string> = {
    'Authorization': authHeader,
    'Accept': 'application/json',
  };

  const fetchOpts: RequestInit = { method, headers };

  if (body && method === 'POST') {
    headers['Content-Type'] = 'application/json';
    fetchOpts.body = JSON.stringify(body);
  }

  const response = await fetch(url, fetchOpts);

  if (!response.ok) {
    let errBody: any;
    try { errBody = await response.json(); } catch { errBody = null; }
    throw new UtahMvrError(
      `Utah MVR API error: ${response.status} ${response.statusText}`,
      response.status,
      errBody
    );
  }

  const json = await response.json();
  return { success: true, data: json };
}

// ── Query helpers ────────────────────────────────────────────

export interface MvrRegistrationRecord {
  plate_number: string;
  plate_state: string;
  vin: string;
  year: number;
  make: string;
  model: string;
  color: string;
  body_style: string;
  registration_status: string;
  registration_expiry: string;
  owner_first_name: string;
  owner_last_name: string;
  owner_address: string;
  owner_city: string;
  owner_state: string;
  owner_zip: string;
  insurance_company: string;
  insurance_policy: string;
  insurance_expiry: string;
  title_number: string;
  title_date: string;
  lien_holder: string;
  odometer: number;
  flags: string[];
}

export interface MvrDriverRecord {
  dl_number: string;
  dl_class: string;
  dl_status: string;
  dl_expiry: string;
  first_name: string;
  last_name: string;
  middle_name: string;
  date_of_birth: string;
  sex: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  restrictions: string[];
  endorsements: string[];
  violations: MvrViolation[];
  suspensions: MvrSuspension[];
  points_total: number;
}

export interface MvrViolation {
  date: string;
  description: string;
  statute: string;
  disposition: string;
  points: number;
  court: string;
}

export interface MvrSuspension {
  type: string;
  start_date: string;
  end_date: string;
  reason: string;
  status: string;
}

export async function queryRegistration(plate: string, state: string = 'UT'): Promise<MvrResponse<MvrRegistrationRecord>> {
  return mvrFetch<MvrRegistrationRecord>('/registration', {
    params: { plate: plate.toUpperCase().replace(/\s/g, ''), state: state.toUpperCase() },
  });
}

export async function queryDriverRecord(dlNumber: string): Promise<MvrResponse<MvrDriverRecord>> {
  return mvrFetch<MvrDriverRecord>('/driver', {
    params: { dl: dlNumber.replace(/\s/g, '') },
  });
}

export async function queryByVin(vin: string): Promise<MvrResponse<MvrRegistrationRecord>> {
  return mvrFetch<MvrRegistrationRecord>('/vin', {
    params: { vin: vin.toUpperCase().replace(/\s/g, '') },
  });
}

// ── Connection test ──────────────────────────────────────────

export async function testConnection(): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    // Hit a lightweight account/status endpoint to verify credentials
    await mvrFetch('/status');
    return { success: true, message: 'Successfully connected to Utah DLD' };
  } catch (err: any) {
    if (err.status === 401 || err.status === 403) {
      return { success: false, error: 'Invalid credentials — check your username and password' };
    }
    // Connection failed but we can still store credentials for when the API is available
    return { success: false, error: err.message || 'Connection failed' };
  }
}
