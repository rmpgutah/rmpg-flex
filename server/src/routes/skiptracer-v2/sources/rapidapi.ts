// ============================================================
// Skip Tracer v2 — RapidAPI Skip Trace Adapter
// ============================================================
// Wraps the existing RapidAPI Skip Tracing Working API.
// Legacy config key: skiptracer_api_key (from v1 integration).

import { BaseDataSource } from './base';
import { SearchQuery, SourceCategory, SourceResult } from '../types';
import { getDb } from '../../../models/database';
import { localNow } from '../../../utils/timeUtils';
import crypto from 'crypto';
import { config } from '../../../config';

// ── Encryption helpers (read legacy keys) ──

function deriveKey(): Buffer {
  return crypto.createHash('sha256').update(config.jwt.secret).digest();
}

function decrypt(stored: string): string {
  const key = deriveKey();
  const parts = stored.split(':');
  if (parts.length < 3) throw new Error('Malformed encrypted value');
  const [ivHex, authTagHex, ciphertext] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ── Constants ──

const RAPIDAPI_HOST = 'skip-tracing-working-api.p.rapidapi.com';
const RAPIDAPI_BASE = `https://${RAPIDAPI_HOST}`;

export default class RapidApiSource extends BaseDataSource {
  readonly name = 'rapidapi';
  readonly displayName = 'RapidAPI Skip Trace';
  readonly category: SourceCategory = 'people';
  readonly costPerLookup = 0.01;

  protected maxRequestsPerMinute = 20;

  // ── Read legacy API key directly from system_config ──

  private getApiKey(): string | null {
    try {
      const db = getDb();
      const row = db.prepare(
        "SELECT config_value FROM system_config WHERE config_key = 'skiptracer_api_key' AND category = 'integrations' AND is_active = 1 LIMIT 1"
      ).get() as { config_value: string } | undefined;
      if (!row?.config_value) return null;
      return decrypt(row.config_value);
    } catch {
      return null;
    }
  }

  isConfigured(): boolean {
    return !!this.getApiKey();
  }

  // ── Search ──

  protected async doSearch(query: SearchQuery): Promise<SourceResult[]> {
    const apiKey = this.getApiKey();
    if (!apiKey) return [];

    const headers: Record<string, string> = {
      'x-rapidapi-key': apiKey,
      'x-rapidapi-host': RAPIDAPI_HOST,
    };

    // Determine which endpoint to call based on query fields
    let url: string;
    const fullName = query.name || [query.firstName, query.lastName].filter(Boolean).join(' ');

    if (query.phone) {
      url = `${RAPIDAPI_BASE}/api/v1/search/byphone?phone=${encodeURIComponent(query.phone)}`;
    } else if (query.email) {
      url = `${RAPIDAPI_BASE}/api/v1/search/byemail?email=${encodeURIComponent(query.email)}`;
    } else if (query.address) {
      url = `${RAPIDAPI_BASE}/api/v1/search/byaddress?address=${encodeURIComponent(query.address)}`;
    } else if (fullName) {
      url = `${RAPIDAPI_BASE}/api/v1/search/byname?name=${encodeURIComponent(fullName)}`;
    } else {
      return [];
    }

    // Timeout protection: abort if RapidAPI takes >10 seconds
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    let res: Response;
    try {
      res = await this.fetchWithRetry(url, { method: 'GET', headers, signal: controller.signal as any });
    } catch (err: any) {
      clearTimeout(timeout);
      if (err?.name === 'AbortError') {
        console.warn('[RapidApiSource] Request timed out after 10s — returning empty results');
        return [];
      }
      throw err;
    }
    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`RapidAPI error (${res.status}): ${text.slice(0, 300)}`);
    }

    const data = await res.json() as any;
    const people: any[] = Array.isArray(data?.PeopleDetails) ? data.PeopleDetails : [];

    return people.map(p => this.mapPerson(p));
  }

  // ── Map a single PeopleDetails record to SourceResult ──

  private mapPerson(p: any): SourceResult {
    const result: SourceResult = {
      source: this.name,
      sourceType: 'people',
      confidence: 0.7,
      fetchedAt: localNow(),
      rawResultCount: 1,
    };

    // Names
    const firstName = p.FirstName || p.first_name || '';
    const lastName = p.LastName || p.last_name || '';
    const middleName = p.MiddleName || p.middle_name || '';
    if (firstName || lastName) {
      result.names = [{
        source: this.name,
        full: [firstName, middleName, lastName].filter(Boolean).join(' '),
        first: firstName || undefined,
        middle: middleName || undefined,
        last: lastName || undefined,
      }];
    }

    // Date of birth
    const dob = p.DOB || p.dob || p.DateOfBirth;
    if (dob) {
      result.dobs = [{ source: this.name, dob: String(dob) }];
    }

    // Addresses
    const addrs = p.Addresses || p.addresses;
    if (Array.isArray(addrs) && addrs.length > 0) {
      result.addresses = addrs.map((a: any) => ({
        source: this.name,
        street: a.Street || a.street || a.address || '',
        city: a.City || a.city || '',
        state: a.State || a.state || '',
        zip: a.Zip || a.zip || '',
      }));
    } else if (p.Address || p.address) {
      result.addresses = [{
        source: this.name,
        street: p.Address || p.address || '',
        city: p.City || p.city || '',
        state: p.State || p.state || '',
        zip: p.Zip || p.zip || '',
      }];
    }

    // Phones
    const phones = p.Phones || p.phones;
    if (Array.isArray(phones) && phones.length > 0) {
      result.phones = phones.map((ph: any) => ({
        source: this.name,
        number: ph.Phone || ph.phone || ph.Number || String(ph),
        type: (ph.Type || ph.type || 'unknown') as any,
      }));
    } else if (p.Phone || p.phone) {
      result.phones = [{
        source: this.name,
        number: p.Phone || p.phone || '',
      }];
    }

    // Emails
    const emails = p.Emails || p.emails;
    if (Array.isArray(emails) && emails.length > 0) {
      result.emails = emails.map((e: any) => ({
        source: this.name,
        address: typeof e === 'string' ? e : (e.Email || e.email || ''),
      }));
    } else if (p.Email || p.email) {
      result.emails = [{
        source: this.name,
        address: p.Email || p.email || '',
      }];
    }

    // Associates / relatives
    const relatives = p.Relatives || p.relatives || p.Associates || p.associates;
    if (Array.isArray(relatives) && relatives.length > 0) {
      result.associates = relatives.map((r: any) => ({
        source: this.name,
        name: r.Name || r.name || [r.FirstName, r.LastName].filter(Boolean).join(' ') || 'Unknown',
        relationship: r.Relationship || r.relationship || undefined,
      }));
    }

    return result;
  }
}
