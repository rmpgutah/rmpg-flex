// ============================================================
// ServeManager API Client Utility
// ============================================================
// Handles: API key resolution (DB > env), encryption, HTTP requests.
// All SM API calls go through this module — never expose the key to clients.

import crypto from 'crypto';
import { getDb } from '../models/database';
import config from '../config';

const SM_BASE_URL = 'https://www.servemanager.com/api';

// ── Encryption helpers (AES-256-GCM keyed from JWT secret) ──

function deriveKey(): Buffer {
  return crypto.createHash('sha256').update(config.jwt.secret).digest();
}

export function encryptApiKey(plaintext: string): string {
  const key = deriveKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decryptApiKey(stored: string): string {
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

// ── API Key Resolution (DB first, env fallback) ─────────────

export function getApiKey(): string | null {
  try {
    const db = getDb();
    const row = db.prepare(
      "SELECT config_value FROM system_config WHERE config_key = 'servemanager_api_key' AND category = 'integrations' AND is_active = 1 LIMIT 1"
    ).get() as { config_value: string } | undefined;
    if (row?.config_value) {
      return decryptApiKey(row.config_value);
    }
  } catch (e: any) { console.warn('[ServeManager] API key decrypt failed:', e?.message); }

  return config.serveManagerApiKey || null;
}

// ── Types ────────────────────────────────────────────────────

export interface SMRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: Record<string, any>;
  params?: Record<string, string>;
}

export interface SMResponse<T = any> {
  data: T;
  links?: {
    self: string;
    first: string;
    last: string;
    prev: string | null;
    next: string | null;
  };
}

export class ServeManagerError extends Error {
  status: number;
  responseBody: any;
  constructor(message: string, status: number, body?: any) {
    super(message);
    this.name = 'ServeManagerError';
    this.status = status;
    this.responseBody = body;
  }
}

// ── Core HTTP helper ─────────────────────────────────────────

export async function smFetch<T = any>(
  endpoint: string,
  options: SMRequestOptions = {}
): Promise<SMResponse<T>> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new ServeManagerError('ServeManager API key not configured', 401);
  }

  const { method = 'GET', body, params } = options;

  if (endpoint.includes('..')) throw new ServeManagerError('Invalid endpoint path', 400);
  let url = `${SM_BASE_URL}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;
  if (params && Object.keys(params).length > 0) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      sp.append(k, v);
    }
    url += `?${sp.toString()}`;
  }

  const authHeader = 'Basic ' + Buffer.from(`${apiKey}:`).toString('base64');
  const headers: Record<string, string> = {
    'Authorization': authHeader,
    'Accept': 'application/json',
  };

  const fetchOpts: RequestInit = { method, headers };

  if (body && (method === 'POST' || method === 'PUT')) {
    headers['Content-Type'] = 'application/json';
    fetchOpts.body = JSON.stringify({ data: body });
  }

  const response = await fetch(url, fetchOpts);

  if (!response.ok) {
    let errBody: any;
    try { errBody = await response.json(); } catch { errBody = null; }
    throw new ServeManagerError(
      `ServeManager API error: ${response.status} ${response.statusText}`,
      response.status,
      errBody
    );
  }

  const json = await response.json();
  return json;
}

// ── Convenience wrappers ─────────────────────────────────────

export async function smGet<T = any>(endpoint: string, params?: Record<string, string>) {
  return smFetch<T>(endpoint, { method: 'GET', params });
}

export async function smPost<T = any>(endpoint: string, body: Record<string, any>) {
  return smFetch<T>(endpoint, { method: 'POST', body });
}

export async function smPut<T = any>(endpoint: string, body: Record<string, any>) {
  return smFetch<T>(endpoint, { method: 'PUT', body });
}

export async function smDelete<T = any>(endpoint: string) {
  return smFetch<T>(endpoint, { method: 'DELETE' });
}

// ── Test connection ──────────────────────────────────────────

export async function testConnection(): Promise<{ success: boolean; account?: any; error?: string }> {
  try {
    const result = await smGet('/account');
    return { success: true, account: result.data || result };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
