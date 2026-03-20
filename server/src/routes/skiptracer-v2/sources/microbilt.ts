// ============================================================
// Skip Tracer v2 — MicroBilt DL Records Adapter
// ============================================================
// Wraps the existing MicroBilt API integration for driver's
// license lookups. Reads credentials from system_config using
// the legacy config keys (microbilt_client_id, etc.).

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

const MB_BASE_URLS: Record<string, string> = {
  sandbox: 'https://apitest.microbilt.com',
  production: 'https://api.microbilt.com',
};

const CONFIG_KEYS = {
  clientId: 'microbilt_client_id',
  clientSecret: 'microbilt_client_secret',
  subscriberId: 'microbilt_subscriber_id',
  environment: 'microbilt_environment',
} as const;

// ── Token cache ──

let cachedToken: { token: string; expiresAt: number } | null = null;

export default class MicrobiltSource extends BaseDataSource {
  readonly name = 'microbilt';
  readonly displayName = 'MicroBilt DL Records';
  readonly category: SourceCategory = 'people';
  readonly costPerLookup = 0.10;

  protected maxRequestsPerMinute = 10;

  // ── Read legacy config ──

  private getLegacyConfig(key: string): string | null {
    try {
      const db = getDb();
      const row = db.prepare(
        "SELECT config_value FROM system_config WHERE config_key = ? AND category = 'integrations' AND is_active = 1 LIMIT 1"
      ).get(key) as { config_value: string } | undefined;
      return row?.config_value || null;
    } catch {
      return null;
    }
  }

  private getDecryptedLegacy(key: string): string | null {
    const val = this.getLegacyConfig(key);
    if (!val) return null;
    try { return decrypt(val); } catch { return null; }
  }

  isConfigured(): boolean {
    const clientId = this.getDecryptedLegacy(CONFIG_KEYS.clientId);
    const clientSecret = this.getDecryptedLegacy(CONFIG_KEYS.clientSecret);
    return !!(clientId && clientSecret);
  }

  // ── OAuth token ──

  private async getAccessToken(): Promise<string | null> {
    // Return cached token if still valid (with 60s buffer)
    if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
      return cachedToken.token;
    }

    const clientId = this.getDecryptedLegacy(CONFIG_KEYS.clientId);
    const clientSecret = this.getDecryptedLegacy(CONFIG_KEYS.clientSecret);
    if (!clientId || !clientSecret) return null;

    const env = this.getLegacyConfig(CONFIG_KEYS.environment) || 'sandbox';
    const baseUrl = MB_BASE_URLS[env] || MB_BASE_URLS.sandbox;

    try {
      const res = await this.fetchWithRetry(`${baseUrl}/OAuth/GetAccessToken`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
        }).toString(),
      });

      if (!res.ok) return null;

      const data = await res.json() as any;
      if (data.access_token) {
        cachedToken = {
          token: data.access_token,
          expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
        };
        return data.access_token;
      }
      return null;
    } catch {
      return null;
    }
  }

  // ── Search ──

  protected async doSearch(query: SearchQuery): Promise<SourceResult[]> {
    if (!this.isConfigured()) return [];

    const fullName = query.name || [query.firstName, query.lastName].filter(Boolean).join(' ');
    if (!fullName) return [];

    const token = await this.getAccessToken();
    if (!token) return [];

    const subscriberId = this.getDecryptedLegacy(CONFIG_KEYS.subscriberId) || '';
    const env = this.getLegacyConfig(CONFIG_KEYS.environment) || 'sandbox';
    const baseUrl = MB_BASE_URLS[env] || MB_BASE_URLS.sandbox;

    try {
      const firstName = query.firstName || fullName.split(' ')[0] || '';
      const lastName = query.lastName || fullName.split(' ').slice(1).join(' ') || fullName;

      const requestBody = {
        SubscriberCode: subscriberId,
        PersonInfo: {
          PersonName: {
            FirstName: firstName,
            LastName: lastName,
          },
          ...(query.dob ? { BirthDt: query.dob } : {}),
          ...(query.state ? { ContactInfo: { PostAddr: { StateProv: query.state } } } : {}),
        },
      };

      const res = await this.fetchWithRetry(`${baseUrl}/BPS/DLVerify`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`MicroBilt DL error (${res.status}): ${text.slice(0, 300)}`);
      }

      const data = await res.json() as any;
      return [this.mapDlResponse(data)];
    } catch (err) {
      console.error('[MicrobiltSource] Search error:', err);
      return [];
    }
  }

  private mapDlResponse(data: any): SourceResult {
    const result: SourceResult = {
      source: this.name,
      sourceType: 'people',
      confidence: 0.9,
      fetchedAt: localNow(),
      rawResultCount: 1,
    };

    // Try to extract person info from response
    const person = data?.PersonInfo || data?.Subject || data;
    const personName = person?.PersonName || {};

    if (personName.FirstName || personName.LastName) {
      result.names = [{
        source: this.name,
        full: [personName.FirstName, personName.MiddleName, personName.LastName].filter(Boolean).join(' '),
        first: personName.FirstName || undefined,
        middle: personName.MiddleName || undefined,
        last: personName.LastName || undefined,
        suffix: personName.NameSuffix || undefined,
      }];
    }

    // DOB
    const dob = person?.BirthDt || person?.DateOfBirth;
    if (dob) {
      result.dobs = [{ source: this.name, dob: String(dob) }];
    }

    // Address from contact info
    const addr = person?.ContactInfo?.PostAddr || {};
    if (addr.Addr1 || addr.City) {
      result.addresses = [{
        source: this.name,
        street: addr.Addr1 || '',
        street2: addr.Addr2 || undefined,
        city: addr.City || '',
        state: addr.StateProv || '',
        zip: addr.PostalCode || '',
      }];
    }

    // Driver's license info
    const dlInfo = data?.DLInfo || data?.DriverLicense || {};
    if (dlInfo.DLNumber || dlInfo.LicenseNumber) {
      result.licenses = [{
        source: this.name,
        type: 'driver',
        licenseNumber: dlInfo.DLNumber || dlInfo.LicenseNumber || undefined,
        state: dlInfo.IssuingState || dlInfo.State || '',
        status: dlInfo.Status ? dlInfo.Status.toLowerCase() as any : undefined,
        expirationDate: dlInfo.ExpirationDt || dlInfo.ExpirationDate || undefined,
        issueDate: dlInfo.IssueDt || dlInfo.IssueDate || undefined,
      }];
    }

    return result;
  }
}
