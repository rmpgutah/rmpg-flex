// ============================================================
// Enformion (EnformionGO) API Client
// ============================================================
// People search, reverse phone, and address lookup across 600M+
// public records and 6,000+ data sources.
// Auth: 3 credentials (API key, AP name, AP password) sent as
// custom galaxy-* headers on every request.
// Base URL: https://devapi.enformion.com
// Free tier: 100 searches/month, charged per successful match.
// Docs: https://go.enformion.com/developer-apis/

import crypto from 'crypto';
import { getDb } from '../models/database';
import config from '../config';

const ENFORMION_BASE = 'https://devapi.enformion.com';

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

// ── Credential resolution (DB → env fallback) ───────────────

function getConfigValue(key: string): string | null {
  try {
    const db = getDb();
    const row = db.prepare(
      `SELECT config_value FROM system_config WHERE config_key = ?`
    ).get(key) as any;
    if (row?.config_value) return decryptCredential(row.config_value);
  } catch { /* fall through */ }
  return null;
}

export interface EnformionCredentials {
  apiKey: string;
  apName: string;
  apPassword: string;
}

export function getCredentials(): EnformionCredentials | null {
  const apiKey = getConfigValue('enformion_api_key') || process.env.ENFORMION_API_KEY || null;
  const apName = getConfigValue('enformion_ap_name') || process.env.ENFORMION_AP_NAME || null;
  const apPassword = getConfigValue('enformion_ap_password') || process.env.ENFORMION_AP_PASSWORD || null;

  if (apiKey && apName && apPassword) {
    return { apiKey, apName, apPassword };
  }
  return null;
}

export function isConfigured(): boolean {
  return !!getCredentials();
}

// ── Interfaces ──────────────────────────────────────────────

export interface EnformionAddress {
  addressLine1: string;
  city: string;
  state: string;
  zip: string;
  latitude: number | null;
  longitude: number | null;
}

export interface EnformionPhone {
  number: string;
  type: string;
  carrier: string;
}

export interface EnformionPerson {
  tahoeId: string;
  firstName: string;
  middleName: string;
  lastName: string;
  age: number | null;
  dob: string | null;
  addresses: EnformionAddress[];
  phones: EnformionPhone[];
  emails: string[];
  relatives: { name: string; relation: string }[];
  indicators: Record<string, boolean>;
}

export interface EnformionPersonSearchResult {
  success: boolean;
  query: string;
  persons: EnformionPerson[];
  totalCount: number;
  error?: string;
}

export interface EnformionPhoneResult {
  success: boolean;
  query: string;
  persons: EnformionPerson[];
  totalCount: number;
  phoneType?: string;
  carrier?: string;
  error?: string;
}

// ── HTTP helper ─────────────────────────────────────────────

async function enformionFetch(
  endpoint: string,
  searchType: string,
  body: Record<string, any>,
  timeoutMs = 20000,
): Promise<any> {
  const creds = getCredentials();
  if (!creds) {
    return { success: false, error: 'Enformion credentials not configured. Set them in Admin > Records.' };
  }

  const url = `${ENFORMION_BASE}${endpoint}`;
  const sessionId = crypto.randomUUID();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'galaxy-ap-name': creds.apName,
        'galaxy-ap-password': creds.apPassword,
        'galaxy-search-type': searchType,
        'galaxy-client-session-id': sessionId,
        'galaxy-client-type': 'direct',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      // 404 = no records found (normal for reverse phone with no match)
      if (res.status === 404) {
        return { success: true, persons: [], totalCount: 0 };
      }
      const text = await res.text().catch(() => '');
      return { success: false, error: `Enformion API returned ${res.status}: ${res.statusText}. ${text}`.trim() };
    }

    return await res.json();
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return { success: false, error: 'Enformion API request timed out' };
    }
    return { success: false, error: err.message || 'Unknown error' };
  } finally {
    clearTimeout(timer);
  }
}

// ── Normalize person from API response ──────────────────────

function normalizePerson(raw: any): EnformionPerson {
  const name = raw.name || raw.Name || {};

  // Addresses: real API uses fullAddress or houseNumber+streetName+streetType
  const addresses = (raw.addresses || raw.Addresses || []).map((a: any) => {
    const line1 = a.fullAddress
      || a.addressLine1
      || [a.houseNumber, a.streetPreDirection, a.streetName, a.streetType, a.streetPostDirection]
          .filter(Boolean).join(' ')
      || '';
    return {
      addressLine1: line1,
      city: a.city || a.City || '',
      state: a.state || a.State || '',
      zip: a.zip || a.Zip || a.postalCode || '',
      latitude: a.latitude || a.Latitude || null,
      longitude: a.longitude || a.Longitude || null,
    };
  });

  // Phones: real API uses phoneNumber (not number), company (not carrier), phoneType
  const phones = (raw.phoneNumbers || raw.PhoneNumbers || raw.Phones || []).map((p: any) => ({
    number: p.phoneNumber || p.number || p.Number || p.phone || '',
    type: p.phoneType || p.type || p.Type || '',
    carrier: p.company || p.carrier || p.Carrier || p.provider || '',
  }));

  // Emails: may be objects with emailAddress field or plain strings
  const emails = (raw.emailAddresses || raw.EmailAddresses || raw.Emails || []).map(
    (e: any) => (typeof e === 'string' ? e : e.emailAddress || e.address || e.Address || e.email || '')
  );

  // Relatives: real API uses firstName/lastName/relativeType
  const relatives = (raw.relativesSummary || raw.RelativesSummary || raw.relatives || []).map((r: any) => ({
    name: r.name || r.Name || `${r.firstName || r.FirstName || ''} ${r.lastName || r.LastName || ''}`.trim(),
    relation: r.relativeType || r.relation || r.Relation || r.relationship || '',
  }));

  // Indicators: real API returns numeric counts (e.g. hasBankruptcyRecords: 3)
  // Convert to boolean (> 0 means true)
  const rawIndicators = raw.indicators || raw.Indicators || {};
  const indicators: Record<string, boolean> = {};
  if (typeof rawIndicators === 'object' && !Array.isArray(rawIndicators)) {
    for (const [k, v] of Object.entries(rawIndicators)) {
      // Strip "has" prefix and "Records" suffix for cleaner keys
      const cleanKey = k.replace(/^has/, '').replace(/Records$/, '').toLowerCase();
      indicators[cleanKey] = typeof v === 'number' ? v > 0 : !!v;
    }
  }

  return {
    tahoeId: raw.tahoeId || raw.TahoeId || raw.id || '',
    firstName: name.firstName || name.First || name.first || raw.FirstName || '',
    middleName: name.middleName || name.Middle || name.middle || raw.MiddleName || '',
    lastName: name.lastName || name.Last || name.last || raw.LastName || '',
    age: raw.age || raw.Age || null,
    dob: raw.dob || raw.Dob || raw.DateOfBirth || raw.dateOfBirth || null,
    addresses,
    phones,
    emails,
    relatives,
    indicators,
  };
}

// ── Person Search ───────────────────────────────────────────

export async function searchPerson(
  query: string,
): Promise<EnformionPersonSearchResult> {
  if (!isConfigured()) {
    return {
      success: false, query, persons: [], totalCount: 0,
      error: 'Enformion credentials not configured. Set them in Admin > Records.',
    };
  }

  // Parse query into name parts: "JOHN DOE" → FirstName + LastName
  const parts = query.trim().split(/\s+/);
  let firstName = '';
  let lastName = '';

  if (parts.length === 1) {
    lastName = parts[0];
  } else if (parts.length === 2) {
    firstName = parts[0];
    lastName = parts[1];
  } else {
    firstName = parts[0];
    lastName = parts.slice(1).join(' ');
  }

  const body: Record<string, any> = {
    FirstName: firstName,
    LastName: lastName,
  };

  const raw = await enformionFetch('/PersonSearch', 'Person', body);

  if (raw.success === false) {
    return { success: false, query, persons: [], totalCount: 0, error: raw.error };
  }

  // Response may come as array of persons or nested object
  const personsRaw = raw.persons || raw.Persons || raw.data || raw.Data || raw.results || raw.Results || [];
  const personArray = Array.isArray(personsRaw) ? personsRaw : [personsRaw];
  const persons = personArray.filter(Boolean).map(normalizePerson);

  return {
    success: true,
    query,
    persons,
    totalCount: raw.totalCount || raw.TotalCount || raw.total || persons.length,
  };
}

// ── Reverse Phone ───────────────────────────────────────────

export async function reversePhone(
  phone: string,
): Promise<EnformionPhoneResult> {
  if (!isConfigured()) {
    return {
      success: false, query: phone, persons: [], totalCount: 0,
      error: 'Enformion credentials not configured.',
    };
  }

  // Strip non-digits
  const cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.length < 10) {
    return { success: false, query: phone, persons: [], totalCount: 0, error: 'Phone number must be at least 10 digits' };
  }

  const body = { Phone: cleanPhone };
  const raw = await enformionFetch('/ReversePhone', 'ReversePhone', body);

  if (raw.success === false) {
    return { success: false, query: phone, persons: [], totalCount: 0, error: raw.error };
  }

  const personsRaw = raw.persons || raw.Persons || raw.data || raw.Data || raw.results || raw.Results || [];
  const personArray = Array.isArray(personsRaw) ? personsRaw : [personsRaw];
  const persons = personArray.filter(Boolean).map(normalizePerson);

  return {
    success: true,
    query: phone,
    persons,
    totalCount: raw.totalCount || raw.TotalCount || persons.length,
    phoneType: raw.phoneType || raw.PhoneType || undefined,
    carrier: raw.carrier || raw.Carrier || undefined,
  };
}

// ── Address Search ──────────────────────────────────────────

export async function searchAddress(
  query: string,
): Promise<EnformionPersonSearchResult> {
  if (!isConfigured()) {
    return {
      success: false, query, persons: [], totalCount: 0,
      error: 'Enformion credentials not configured.',
    };
  }

  // Parse address: try to split "123 Main St, Salt Lake City, UT 84101"
  const addressParts = query.split(',').map(p => p.trim());
  const body: Record<string, any> = {
    Addresses: [{
      addressLine1: addressParts[0] || query,
      city: addressParts[1] || '',
      state: addressParts[2]?.replace(/\s*\d+$/, '').trim() || '',
      zip: addressParts[2]?.match(/\d{5}/)?.[0] || addressParts[3]?.trim() || '',
    }],
  };

  const raw = await enformionFetch('/AddressID', 'Property', body);

  if (raw.success === false) {
    return { success: false, query, persons: [], totalCount: 0, error: raw.error };
  }

  const personsRaw = raw.persons || raw.Persons || raw.data || raw.Data || raw.results || raw.Results || [];
  const personArray = Array.isArray(personsRaw) ? personsRaw : [personsRaw];
  const persons = personArray.filter(Boolean).map(normalizePerson);

  return {
    success: true,
    query,
    persons,
    totalCount: raw.totalCount || raw.TotalCount || persons.length,
  };
}

// ── Test Connection ─────────────────────────────────────────

export async function testConnection(): Promise<{ success: boolean; message: string }> {
  const creds = getCredentials();
  if (!creds) return { success: false, message: 'Enformion credentials not configured' };

  // Minimal test — person search (Enformion requires FirstName + LastName)
  const result = await searchPerson('JOHN SMITH');
  if (result.success) {
    return {
      success: true,
      message: `API connected — ${result.totalCount} results (free tier: 100 matches/month)`,
    };
  }
  return { success: false, message: result.error || 'Connection failed' };
}
