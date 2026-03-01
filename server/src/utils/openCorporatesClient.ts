// ============================================================
// OpenCorporates API Client
// ============================================================
// Searches global corporate registries for company and officer
// records. Free tier: 200 req/month, 50 req/day.
// API token stored encrypted in system_config (same AES-256-GCM
// pattern as Criminal Checks / FMCSA / ServeManager).
// Docs: https://api.opencorporates.com/documentation/API-Reference

import crypto from 'crypto';
import { getDb } from '../models/database';
import config from '../config';

const OC_BASE = 'https://api.opencorporates.com/v0.4';

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

function decryptCredential(stored: string): string {
  const key = deriveKey();
  const [ivHex, authTagHex, encrypted] = stored.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ── Credential resolution (DB first → env fallback) ─────────

export function getApiToken(): string | null {
  try {
    const db = getDb();
    const row = db.prepare(
      `SELECT config_value FROM system_config WHERE config_key = 'opencorporates_api_token'`
    ).get() as any;
    if (row?.config_value) return decryptCredential(row.config_value);
  } catch { /* fall through */ }
  return process.env.OPENCORPORATES_API_TOKEN || null;
}

export function isConfigured(): boolean {
  return !!getApiToken();
}

// ── Interfaces ───────────────────────────────────────────────

export interface OCOfficer {
  name: string;
  position: string;
  startDate: string | null;
  endDate: string | null;
}

export interface OCCompany {
  name: string;
  companyNumber: string;
  jurisdictionCode: string;
  incorporationDate: string | null;
  dissolutionDate: string | null;
  companyType: string;
  currentStatus: string;
  registeredAddress: string;
  registryUrl: string;
  opencorporatesUrl: string;
  branchStatus: string | null;
  officers: OCOfficer[];
}

export interface OCSearchResult {
  success: boolean;
  query: string;
  companies: OCCompany[];
  totalCount: number;
  page: number;
  perPage: number;
  error?: string;
}

export interface OCOfficerSearchResult {
  success: boolean;
  query: string;
  officers: { name: string; position: string; companyName: string; companyNumber: string; jurisdictionCode: string }[];
  totalCount: number;
  page: number;
  perPage: number;
  error?: string;
}

// ── HTTP helper ──────────────────────────────────────────────

async function ocFetch(endpoint: string, params: Record<string, string> = {}, timeoutMs = 15000): Promise<any> {
  const token = getApiToken();
  if (token) params.api_token = token;

  const qs = new URLSearchParams(params).toString();
  const url = `${OC_BASE}${endpoint}${qs ? `?${qs}` : ''}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { success: false, error: `OpenCorporates API returned ${res.status}: ${res.statusText}. ${text}`.trim() };
    }

    return await res.json();
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return { success: false, error: 'OpenCorporates API request timed out' };
    }
    return { success: false, error: err.message || 'Unknown error' };
  } finally {
    clearTimeout(timer);
  }
}

// ── Normalize company from API response ──────────────────────

function normalizeCompany(raw: any): OCCompany {
  const c = raw.company || raw;
  return {
    name:              c.name || '',
    companyNumber:     c.company_number || '',
    jurisdictionCode:  c.jurisdiction_code || '',
    incorporationDate: c.incorporation_date || null,
    dissolutionDate:   c.dissolution_date || null,
    companyType:       c.company_type || '',
    currentStatus:     c.current_status || '',
    registeredAddress: c.registered_address_in_full || c.registered_address?.in_full || '',
    registryUrl:       c.registry_url || '',
    opencorporatesUrl: c.opencorporates_url || '',
    branchStatus:      c.branch_status || null,
    officers:          (c.officers || []).map((o: any) => {
      const off = o.officer || o;
      return {
        name:      off.name || '',
        position:  off.position || '',
        startDate: off.start_date || null,
        endDate:   off.end_date || null,
      };
    }),
  };
}

// ── Search Companies ─────────────────────────────────────────

export async function searchCompanies(
  query: string,
  jurisdictionCode?: string,
  page: number = 1,
): Promise<OCSearchResult> {
  if (!isConfigured()) {
    return {
      success: false, query, companies: [], totalCount: 0, page: 1, perPage: 30,
      error: 'OpenCorporates API token not configured. Set it in Admin > Records.',
    };
  }

  const params: Record<string, string> = {
    q: query,
    page: String(page),
    per_page: '30',
  };
  if (jurisdictionCode) params.jurisdiction_code = jurisdictionCode;

  const raw = await ocFetch('/companies/search', params);

  if (raw.success === false) {
    return {
      success: false, query, companies: [], totalCount: 0, page, perPage: 30,
      error: raw.error,
    };
  }

  const results = raw.results || raw;
  const companiesRaw = results.companies || [];
  const companies = companiesRaw.map((c: any) => normalizeCompany(c));

  return {
    success: true,
    query,
    companies,
    totalCount: results.total_count || companies.length,
    page: results.page || page,
    perPage: results.per_page || 30,
  };
}

// ── Search Officers ──────────────────────────────────────────

export async function searchOfficers(
  query: string,
  jurisdictionCode?: string,
  page: number = 1,
): Promise<OCOfficerSearchResult> {
  if (!isConfigured()) {
    return {
      success: false, query, officers: [], totalCount: 0, page: 1, perPage: 30,
      error: 'OpenCorporates API token not configured.',
    };
  }

  const params: Record<string, string> = {
    q: query,
    page: String(page),
    per_page: '30',
  };
  if (jurisdictionCode) params.jurisdiction_code = jurisdictionCode;

  const raw = await ocFetch('/officers/search', params);

  if (raw.success === false) {
    return {
      success: false, query, officers: [], totalCount: 0, page, perPage: 30,
      error: raw.error,
    };
  }

  const results = raw.results || raw;
  const officersRaw = results.officers || [];
  const officers = officersRaw.map((o: any) => {
    const off = o.officer || o;
    return {
      name: off.name || '',
      position: off.position || '',
      companyName: off.company?.name || '',
      companyNumber: off.company?.company_number || '',
      jurisdictionCode: off.company?.jurisdiction_code || '',
    };
  });

  return {
    success: true,
    query,
    officers,
    totalCount: results.total_count || officers.length,
    page: results.page || page,
    perPage: results.per_page || 30,
  };
}

// ── Get Specific Company ─────────────────────────────────────

export async function getCompany(
  jurisdictionCode: string,
  companyNumber: string,
): Promise<{ success: boolean; company?: OCCompany; error?: string }> {
  if (!isConfigured()) {
    return { success: false, error: 'OpenCorporates API token not configured.' };
  }

  const raw = await ocFetch(`/companies/${jurisdictionCode}/${companyNumber}`);

  if (raw.success === false) {
    return { success: false, error: raw.error };
  }

  const companyData = raw.results?.company || raw.company || raw;
  return { success: true, company: normalizeCompany(companyData) };
}

// ── Test Connection ──────────────────────────────────────────

export async function testConnection(): Promise<{ success: boolean; message: string }> {
  const token = getApiToken();
  if (!token) return { success: false, message: 'No OpenCorporates API token configured' };

  // Use a minimal query to verify the token works
  const result = await searchCompanies('test');
  if (result.success) {
    return {
      success: true,
      message: `API connected — ${result.totalCount} results (free tier: 200 req/month)`,
    };
  }
  return { success: false, message: result.error || 'Connection failed' };
}
