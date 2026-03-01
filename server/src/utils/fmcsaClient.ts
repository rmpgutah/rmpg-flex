// ============================================================
// FMCSA (Federal Motor Carrier Safety Administration) Client
// ============================================================
// Queries carrier safety data via the QCMobile API.
// Requires a free webkey from Login.gov → mobile.fmcsa.dot.gov/QCDevsite
// Useful for: commercial vehicle stops, DOT number lookups, carrier authority checks.

import crypto from 'crypto';
import { getDb } from '../models/database';
import config from '../config';

const FMCSA_BASE = 'https://mobile.fmcsa.dot.gov/qc/services';

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

export function getWebKey(): string | null {
  try {
    const db = getDb();
    const row = db.prepare(`SELECT config_value FROM system_config WHERE config_key = 'fmcsa_webkey'`).get() as any;
    if (row?.config_value) return decryptCredential(row.config_value);
  } catch { /* fall through */ }
  return process.env.FMCSA_WEBKEY || null;
}

export function isConfigured(): boolean {
  return !!getWebKey();
}

// ── Interfaces ───────────────────────────────────────────────

export interface CarrierRecord {
  dotNumber: string;
  legalName: string;
  dbaName: string;
  carrierOperation: string;
  hmFlag: string;          // Hazmat flag
  pcFlag: string;          // Passenger carrier flag
  phyStreet: string;
  phyCity: string;
  phyState: string;
  phyZipcode: string;
  phyCountry: string;
  mailingStreet: string;
  mailingCity: string;
  mailingState: string;
  mailingZipcode: string;
  telephone: string;
  totalDrivers: string;
  totalPowerUnits: string;
  // Safety data
  safetyRating: string;
  safetyRatingDate: string;
  oosDate: string;         // Out-of-service date
  oosReason: string;
  // Authority status
  commonAuthorityStatus: string;
  contractAuthorityStatus: string;
  brokerAuthorityStatus: string;
}

export interface FmcsaResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}

// ── HTTP helper ──────────────────────────────────────────────

async function fmcsaFetch<T>(url: string, timeoutMs = 10000): Promise<FmcsaResponse<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });

    if (!res.ok) {
      return { success: false, data: {} as T, error: `FMCSA API returned ${res.status}: ${res.statusText}` };
    }

    const json = await res.json();
    return { success: true, data: json };
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return { success: false, data: {} as T, error: 'FMCSA API request timed out' };
    }
    return { success: false, data: {} as T, error: err.message || 'Unknown error' };
  } finally {
    clearTimeout(timer);
  }
}

// ── Carrier Lookup by DOT Number ─────────────────────────────

export async function lookupCarrier(dotNumber: string): Promise<FmcsaResponse<CarrierRecord>> {
  const webKey = getWebKey();
  if (!webKey) {
    return { success: false, data: {} as CarrierRecord, error: 'FMCSA webkey not configured. Get one free at mobile.fmcsa.dot.gov/QCDevsite' };
  }

  const url = `${FMCSA_BASE}/carriers/${encodeURIComponent(dotNumber)}?webKey=${encodeURIComponent(webKey)}`;
  const raw = await fmcsaFetch<any>(url);

  if (!raw.success) return { success: false, data: {} as CarrierRecord, error: raw.error };

  const c = raw.data?.content?.carrier || raw.data?.carrier || raw.data;

  const carrier: CarrierRecord = {
    dotNumber:                c.dotNumber?.toString() || dotNumber,
    legalName:                c.legalName || '',
    dbaName:                  c.dbaName || '',
    carrierOperation:         c.carrierOperation?.carrierOperationDesc || c.carrierOperation || '',
    hmFlag:                   c.hmFlag || 'N',
    pcFlag:                   c.pcFlag || 'N',
    phyStreet:                c.phyStreet || '',
    phyCity:                  c.phyCity || '',
    phyState:                 c.phyState || '',
    phyZipcode:               c.phyZipcode || '',
    phyCountry:               c.phyCountry || '',
    mailingStreet:            c.mailingStreet || '',
    mailingCity:              c.mailingCity || '',
    mailingState:             c.mailingState || '',
    mailingZipcode:           c.mailingZipcode || '',
    telephone:                c.telephone || '',
    totalDrivers:             c.totalDrivers?.toString() || '',
    totalPowerUnits:          c.totalPowerUnits?.toString() || '',
    safetyRating:             c.safetyRating || 'Not Rated',
    safetyRatingDate:         c.safetyRatingDate || '',
    oosDate:                  c.oosDate || '',
    oosReason:                c.oosReason || '',
    commonAuthorityStatus:    c.commonAuthorityStatus || '',
    contractAuthorityStatus:  c.contractAuthorityStatus || '',
    brokerAuthorityStatus:    c.brokerAuthorityStatus || '',
  };

  return { success: true, data: carrier };
}

// ── Carrier Lookup by Name ───────────────────────────────────

export async function searchCarrierByName(name: string): Promise<FmcsaResponse<CarrierRecord[]>> {
  const webKey = getWebKey();
  if (!webKey) {
    return { success: false, data: [], error: 'FMCSA webkey not configured. Get one free at mobile.fmcsa.dot.gov/QCDevsite' };
  }

  const url = `${FMCSA_BASE}/carriers/name/${encodeURIComponent(name)}?webKey=${encodeURIComponent(webKey)}&size=10`;
  const raw = await fmcsaFetch<any>(url);

  if (!raw.success) return { success: false, data: [], error: raw.error };

  const carriers = (raw.data?.content || []).map((item: any) => {
    const c = item.carrier || item;
    return {
      dotNumber:                c.dotNumber?.toString() || '',
      legalName:                c.legalName || '',
      dbaName:                  c.dbaName || '',
      carrierOperation:         c.carrierOperation?.carrierOperationDesc || c.carrierOperation || '',
      hmFlag:                   c.hmFlag || 'N',
      pcFlag:                   c.pcFlag || 'N',
      phyStreet:                c.phyStreet || '',
      phyCity:                  c.phyCity || '',
      phyState:                 c.phyState || '',
      phyZipcode:               c.phyZipcode || '',
      phyCountry:               c.phyCountry || '',
      mailingStreet:            c.mailingStreet || '',
      mailingCity:              c.mailingCity || '',
      mailingState:             c.mailingState || '',
      mailingZipcode:           c.mailingZipcode || '',
      telephone:                c.telephone || '',
      totalDrivers:             c.totalDrivers?.toString() || '',
      totalPowerUnits:          c.totalPowerUnits?.toString() || '',
      safetyRating:             c.safetyRating || 'Not Rated',
      safetyRatingDate:         c.safetyRatingDate || '',
      oosDate:                  c.oosDate || '',
      oosReason:                c.oosReason || '',
      commonAuthorityStatus:    c.commonAuthorityStatus || '',
      contractAuthorityStatus:  c.contractAuthorityStatus || '',
      brokerAuthorityStatus:    c.brokerAuthorityStatus || '',
    } as CarrierRecord;
  });

  return { success: true, data: carriers };
}

// ── Test Connection ──────────────────────────────────────────

export async function testConnection(): Promise<{ success: boolean; message: string }> {
  const webKey = getWebKey();
  if (!webKey) return { success: false, message: 'No FMCSA webkey configured' };

  // Query a known DOT number (FMCSA itself) to verify connectivity
  const result = await lookupCarrier('1');
  return result.success
    ? { success: true, message: 'FMCSA API connection verified' }
    : { success: false, message: result.error || 'Connection failed' };
}
