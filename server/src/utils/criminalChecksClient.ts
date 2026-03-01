// ============================================================
// Complete Criminal Checks API Client
// ============================================================
// Searches arrest records, sex offender registries, DOC inmate
// databases, and court records by name.
// API key stored encrypted in system_config (same AES-256-GCM
// pattern as FMCSA/ServeManager).
// Docs: https://completecriminalchecks.com/Developers/

import crypto from 'crypto';
import { getDb } from '../models/database';
import config from '../config';

const CCC_BASE = 'https://completecriminalchecks.com/api/search.php';

// ── Feeds available ─────────────────────────────────────────

export const AVAILABLE_FEEDS = ['sex_offender', 'doc', 'arrest_warrants', 'court'] as const;
export type CriminalFeed = typeof AVAILABLE_FEEDS[number];

// ── Encryption (same AES-256-GCM as other integrations) ─────

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
  const [ivHex, authTagHex, encrypted] = stored.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ── Credential resolution (DB first → env fallback) ─────────

export function getApiKey(): string | null {
  try {
    const db = getDb();
    const row = db.prepare(`SELECT config_value FROM system_config WHERE config_key = 'criminal_checks_api_key'`).get() as any;
    if (row?.config_value) return decryptCredential(row.config_value);
  } catch { /* fall through */ }
  return process.env.CRIMINAL_CHECKS_API_KEY || null;
}

export function isConfigured(): boolean {
  return !!getApiKey();
}

// ── Interfaces ───────────────────────────────────────────────

export interface CriminalRecord {
  source: CriminalFeed;
  name: string;
  aka: string;
  dob: string;
  sex: string;
  race: string;
  hair: string;
  eyes: string;
  height: string;
  weight: string;
  address: string;
  crime: string;
  state: string;
  imageUrl: string | null;
  latitude: string | null;
  longitude: string | null;
  updated: string;
  // Court-specific
  caseNumber: string;
  court: string;
  disposition: string;
  // DOC-specific
  facility: string;
  status: string;
}

export interface CriminalSearchResult {
  success: boolean;
  query: string;
  feedsSearched: string[];
  totalRecords: number;
  records: CriminalRecord[];
  creditsUsed: number;
  remainingCredits: number;
  error?: string;
}

// ── HTTP helper ──────────────────────────────────────────────

async function cccFetch(url: string, timeoutMs = 45000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });

    if (!res.ok) {
      return { success: false, error: `API returned ${res.status}: ${res.statusText}` };
    }

    return await res.json();
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return { success: false, error: 'Criminal Checks API request timed out' };
    }
    return { success: false, error: err.message || 'Unknown error' };
  } finally {
    clearTimeout(timer);
  }
}

// ── Normalize records from different feeds ───────────────────

function normalizeRecord(raw: any, source: CriminalFeed): CriminalRecord {
  return {
    source,
    name:        raw.name || raw.offender_name || '',
    aka:         raw.aka || '',
    dob:         raw.dob || '',
    sex:         raw.sex || raw.gender || '',
    race:        raw.race || '',
    hair:        raw.hair || '',
    eyes:        raw.eyes || '',
    height:      raw.height || '',
    weight:      raw.weight || '',
    address:     (raw.address || '').replace(/\n/g, ', ').trim(),
    crime:       raw.crime || raw.charges || raw.charge || raw.offense || '',
    state:       raw._state || raw._source || raw.state || '',
    imageUrl:    raw.image_url || null,
    latitude:    raw.latitude || null,
    longitude:   raw.longitude || null,
    updated:     raw.updated || raw.last_updated || raw.created_at || '',
    caseNumber:  raw.case_number || raw.caseid || raw.court_docket || '',
    court:       raw.court || raw.court_name || '',
    disposition: raw.disposition || raw.outcome || '',
    facility:    raw.facility || raw.institution || raw._database || '',
    status:      raw.status || raw.active || raw.bond_type || '',
  };
}

// ── Main Search Function ─────────────────────────────────────

export async function searchCriminalRecords(
  name: string,
  feeds?: CriminalFeed[],
): Promise<CriminalSearchResult> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      success: false, query: name, feedsSearched: [], totalRecords: 0,
      records: [], creditsUsed: 0, remainingCredits: 0,
      error: 'Criminal Checks API key not configured. Set it in Admin > MVR.',
    };
  }

  const feedList = feeds && feeds.length > 0 ? feeds.join(',') : '';
  const params = new URLSearchParams({ name, api_key: apiKey });
  if (feedList) params.set('feeds', feedList);

  const url = `${CCC_BASE}?${params.toString()}`;
  const raw = await cccFetch(url);

  if (!raw.success) {
    return {
      success: false, query: name, feedsSearched: [], totalRecords: 0,
      records: [], creditsUsed: 0, remainingCredits: 0,
      error: raw.error || 'Search failed',
    };
  }

  // Normalize records from all feeds
  const records: CriminalRecord[] = [];
  const feedsSearched: string[] = raw.query?.feeds_searched || [];

  for (const feed of feedsSearched) {
    const feedData = raw.results?.[feed];
    if (feedData?.records && Array.isArray(feedData.records)) {
      for (const r of feedData.records) {
        records.push(normalizeRecord(r, feed as CriminalFeed));
      }
    }
  }

  return {
    success: true,
    query: name,
    feedsSearched,
    totalRecords: records.length,
    records,
    creditsUsed: raw.summary?.credits_used || 0,
    remainingCredits: raw.summary?.credits_remaining || 0,
  };
}

// ── Test Connection ──────────────────────────────────────────

export async function testConnection(): Promise<{ success: boolean; message: string; remainingCredits?: number }> {
  const apiKey = getApiKey();
  if (!apiKey) return { success: false, message: 'No Criminal Checks API key configured' };

  // Use a minimal query to verify the key works
  const result = await searchCriminalRecords('TEST CONNECTION VERIFY');
  if (result.success) {
    return {
      success: true,
      message: `API connected — ${result.remainingCredits} credits remaining`,
      remainingCredits: result.remainingCredits,
    };
  }
  return { success: false, message: result.error || 'Connection failed' };
}
