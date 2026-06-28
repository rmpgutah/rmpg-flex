// ============================================================
// Skip Tracker 3.5 — MicroBilt Full Search Adapter
// ============================================================
// Calls ALL available MicroBilt API endpoints in parallel:
//   - /BPS/DLVerify        — Driver's License verification
//   - /BPS/PersonSearch    — People/address/phone search
//   - /BPS/BackgroundCheck — Criminal + court records
//   - /BPS/SSNTrace        — SSN-anchored address history
//   - /BPS/PhoneSearch     — Reverse phone lookup
//   - /BPS/EmailSearch     — Reverse email lookup
//   - /BPS/PropertySearch  — Property records by address
//   - /BPS/VehicleSearch   — Vehicle records by person
//
// Reads credentials from system_config using the legacy config
// keys (microbilt_client_id, etc.).

import { BaseDataSource } from './base';
import { SearchQuery, SkipTracerSourceCategory, SourceResult, AddressRecord, CourtRecord, AssociateRecord } from '../types';
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
  readonly displayName = 'MicroBilt Full Search';
  readonly category: SkipTracerSourceCategory = 'people';
  readonly costPerLookup = 0.50;

  protected maxRequestsPerMinute = 20;

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

  // ── Helper: build API request headers ──

  private buildHeaders(token: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    const subscriberId = this.getDecryptedLegacy(CONFIG_KEYS.subscriberId);
    if (subscriberId) {
      headers['SubscriberId'] = subscriberId;
    }
    return headers;
  }

  // ── Helper: get base URL ──

  private getBaseUrl(): string {
    const env = this.getLegacyConfig(CONFIG_KEYS.environment) || 'sandbox';
    return MB_BASE_URLS[env] || MB_BASE_URLS.sandbox;
  }

  // ── Helper: parse name parts from query ──

  private parseNameParts(query: SearchQuery): { firstName: string; lastName: string } {
    const fullName = query.name || [query.firstName, query.lastName].filter(Boolean).join(' ');
    const firstName = query.firstName || fullName.split(' ')[0] || '';
    const lastName = query.lastName || fullName.split(' ').slice(1).join(' ') || fullName;
    return { firstName, lastName };
  }

  // ── Helper: build subscriber code body ──

  private getSubscriberCode(): string {
    return this.getDecryptedLegacy(CONFIG_KEYS.subscriberId) || '';
  }

  // ============================================================
  // Main search — calls ALL endpoints in parallel
  // ============================================================

  protected async doSearch(query: SearchQuery): Promise<SourceResult[]> {
    if (!this.isConfigured()) return [];

    const fullName = query.name || [query.firstName, query.lastName].filter(Boolean).join(' ');
    // Must have at least name, phone, email, or address
    if (!fullName && !query.phone && !query.email && !query.address) return [];

    const token = await this.getAccessToken();
    if (!token) return [];

    const results: SourceResult[] = [];

    // Call ALL endpoints in parallel — failures in one don't block others
    const endpoints = await Promise.allSettled([
      fullName ? this.searchDl(query, token) : Promise.resolve(null),
      fullName ? this.searchPerson(query, token) : Promise.resolve(null),
      fullName ? this.searchBackground(query, token) : Promise.resolve(null),
      this.searchSsnTrace(query, token),
      this.searchPhone(query, token),
      this.searchEmail(query, token),
      this.searchProperty(query, token),
      fullName ? this.searchVehicle(query, token) : Promise.resolve(null),
    ]);

    const endpointNames = ['DLVerify', 'PersonSearch', 'BackgroundCheck', 'SSNTrace', 'PhoneSearch', 'EmailSearch', 'PropertySearch', 'VehicleSearch'];

    endpoints.forEach((outcome, i) => {
      if (outcome.status === 'fulfilled' && outcome.value) {
        results.push(outcome.value);
      } else if (outcome.status === 'rejected') {
        console.error(`[MicrobiltSource] ${endpointNames[i]} failed:`, outcome.reason);
      }
    });

    return results;
  }

  // ============================================================
  // 1. Driver's License Verify — /BPS/DLVerify
  // ============================================================

  private async searchDl(query: SearchQuery, token: string): Promise<SourceResult | null> {
    const { firstName, lastName } = this.parseNameParts(query);
    const baseUrl = this.getBaseUrl();

    const requestBody: any = {
      SubscriberCode: this.getSubscriberCode(),
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
      headers: this.buildHeaders(token),
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[MicrobiltSource] DL Verify error (${res.status}): ${text.slice(0, 300)}`);
      return null;
    }

    const data = await res.json() as any;
    return this.mapDlResponse(data);
  }

  private mapDlResponse(data: any): SourceResult {
    const result: SourceResult = {
      source: this.name,
      sourceType: 'people',
      confidence: 0.9,
      fetchedAt: localNow(),
      rawResultCount: 1,
    };

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

    const dob = person?.BirthDt || person?.DateOfBirth;
    if (dob) {
      result.dobs = [{ source: this.name, dob: String(dob) }];
    }

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

  // ============================================================
  // 2. Person Search — /BPS/PersonSearch
  // ============================================================

  private async searchPerson(query: SearchQuery, token: string): Promise<SourceResult | null> {
    const { firstName, lastName } = this.parseNameParts(query);
    const baseUrl = this.getBaseUrl();

    const personInfo: any = {
      PersonName: {
        FirstName: firstName,
        LastName: lastName,
      },
    };

    if (query.dob) personInfo.BirthDt = query.dob;
    if (query.ssn_last4) personInfo.SSNLast4 = query.ssn_last4;

    if (query.address || query.city || query.state || query.zip) {
      personInfo.ContactInfo = {
        PostAddr: {
          ...(query.address ? { Addr1: query.address } : {}),
          ...(query.city ? { City: query.city } : {}),
          ...(query.state ? { StateProv: query.state } : {}),
          ...(query.zip ? { PostalCode: query.zip } : {}),
        },
      };
    }

    if (query.phone) {
      if (!personInfo.ContactInfo) personInfo.ContactInfo = {};
      personInfo.ContactInfo.PhoneNum = { Phone: query.phone };
    }

    if (query.email) {
      if (!personInfo.ContactInfo) personInfo.ContactInfo = {};
      personInfo.ContactInfo.EmailAddress = query.email;
    }

    const requestBody = {
      SubscriberCode: this.getSubscriberCode(),
      PersonInfo: personInfo,
    };

    const res = await this.fetchWithRetry(`${baseUrl}/BPS/PersonSearch`, {
      method: 'POST',
      headers: this.buildHeaders(token),
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[MicrobiltSource] PersonSearch error (${res.status}): ${text.slice(0, 300)}`);
      return null;
    }

    const data = await res.json() as any;
    return this.mapPersonResponse(data);
  }

  private mapPersonResponse(data: any): SourceResult {
    const result: SourceResult = {
      source: this.name,
      sourceType: 'people',
      confidence: 0.85,
      fetchedAt: localNow(),
      rawResultCount: 0,
    };

    // PersonSearch returns records as an array or single object
    const records = data?.PersonSearchInfo?.PersonSearchRecord
      || data?.PersonInfo
      || data?.Records
      || data?.Subjects;
    const recordList = Array.isArray(records) ? records : records ? [records] : [];
    result.rawResultCount = recordList.length;

    if (recordList.length === 0) return result;

    const names: SourceResult['names'] = [];
    const dobs: SourceResult['dobs'] = [];
    const ssns: SourceResult['ssns'] = [];
    const addresses: AddressRecord[] = [];
    const phones: SourceResult['phones'] = [];
    const emails: SourceResult['emails'] = [];
    const associates: AssociateRecord[] = [];

    for (const rec of recordList) {
      if (!rec) continue;

      // --- Names ---
      const pn = rec.PersonName || rec.PersonInfo?.PersonName || {};
      if (pn.FirstName || pn.LastName || pn.FullName) {
        names.push({
          source: this.name,
          full: pn.FullName || [pn.FirstName, pn.MiddleName, pn.LastName].filter(Boolean).join(' '),
          first: pn.FirstName || undefined,
          middle: pn.MiddleName || undefined,
          last: pn.LastName || undefined,
          suffix: pn.NameSuffix || undefined,
        });
      }

      // --- Also capture aliases / AKA names ---
      const aliases = rec.AKAs || rec.Aliases || rec.AlsoKnownAs;
      if (aliases) {
        const aliasList = Array.isArray(aliases) ? aliases : [aliases];
        for (const aka of aliasList) {
          const akaName = aka?.PersonName || aka;
          if (akaName.FirstName || akaName.LastName || akaName.FullName) {
            names.push({
              source: this.name,
              full: akaName.FullName || [akaName.FirstName, akaName.MiddleName, akaName.LastName].filter(Boolean).join(' '),
              first: akaName.FirstName || undefined,
              middle: akaName.MiddleName || undefined,
              last: akaName.LastName || undefined,
              suffix: akaName.NameSuffix || undefined,
            });
          }
        }
      }

      // --- DOB ---
      const dob = rec.BirthDt || rec.PersonInfo?.BirthDt || rec.DateOfBirth;
      if (dob) {
        dobs.push({ source: this.name, dob: String(dob) });
      }

      // --- SSN last 4 ---
      const ssn = rec.SSNLast4 || rec.PersonInfo?.SSNLast4 || rec.SSN?.Last4;
      if (ssn) {
        ssns.push({ source: this.name, last4: String(ssn) });
      }

      // --- Addresses (may be array) ---
      const addrField = rec.ContactInfo?.PostAddr
        || rec.PersonInfo?.ContactInfo?.PostAddr
        || rec.Addresses;
      const addrList = addrField ? (Array.isArray(addrField) ? addrField : [addrField]) : [];
      for (const a of addrList) {
        if (!a) continue;
        if (a.Addr1 || a.StreetAddress || a.City) {
          addresses.push({
            source: this.name,
            street: a.Addr1 || a.StreetAddress || '',
            street2: a.Addr2 || undefined,
            city: a.City || '',
            state: a.StateProv || a.State || '',
            zip: a.PostalCode || a.ZipCode || '',
            county: a.County || undefined,
            type: a.AddrType === 'Current' ? 'current'
              : a.AddrType === 'Previous' ? 'previous'
              : a.AddrType === 'Mailing' ? 'mailing'
              : 'unknown',
            firstSeen: a.FirstReportedDt || a.FirstSeen || undefined,
            lastSeen: a.LastReportedDt || a.LastSeen || undefined,
          });
        }
      }

      // --- Phones (may be array) ---
      const phoneField = rec.ContactInfo?.PhoneNum
        || rec.PersonInfo?.ContactInfo?.PhoneNum
        || rec.Phones;
      const phoneList = phoneField ? (Array.isArray(phoneField) ? phoneField : [phoneField]) : [];
      for (const p of phoneList) {
        if (!p) continue;
        const phoneNum = p.Phone || p.PhoneNumber || p.Number;
        if (phoneNum) {
          phones.push({
            source: this.name,
            number: String(phoneNum),
            type: p.PhoneType === 'Mobile' ? 'mobile'
              : p.PhoneType === 'Landline' ? 'landline'
              : p.PhoneType === 'VoIP' ? 'voip'
              : 'unknown',
            carrier: p.Carrier || undefined,
            lineStatus: p.Status === 'Active' ? 'active'
              : p.Status === 'Inactive' ? 'inactive'
              : 'unknown',
            firstSeen: p.FirstReportedDt || undefined,
            lastSeen: p.LastReportedDt || undefined,
          });
        }
      }

      // --- Emails (may be array) ---
      const emailField = rec.ContactInfo?.EmailAddress
        || rec.PersonInfo?.ContactInfo?.EmailAddress
        || rec.Emails;
      const emailList = emailField
        ? (Array.isArray(emailField) ? emailField : [emailField])
        : [];
      for (const e of emailList) {
        if (!e) continue;
        const emailAddr = typeof e === 'string' ? e : (e.Address || e.EmailAddress || e.Email);
        if (emailAddr) {
          emails.push({
            source: this.name,
            address: String(emailAddr),
            type: typeof e === 'object' ? (e.Type || e.EmailType || undefined) : undefined,
          });
        }
      }

      // --- Associates / Relatives ---
      const assocField = rec.Associates || rec.Relatives || rec.RelatedPersons;
      const assocList = assocField ? (Array.isArray(assocField) ? assocField : [assocField]) : [];
      for (const a of assocList) {
        if (!a) continue;
        const assocName = a.PersonName
          ? (a.PersonName.FullName || [a.PersonName.FirstName, a.PersonName.LastName].filter(Boolean).join(' '))
          : (a.FullName || a.Name || '');
        if (assocName) {
          associates.push({
            source: this.name,
            name: assocName,
            relationship: a.Relationship || a.RelationType || undefined,
            address: a.Address || a.ContactInfo?.PostAddr?.Addr1 || undefined,
            phone: a.Phone || a.ContactInfo?.PhoneNum?.Phone || undefined,
          });
        }
      }
    }

    if (names.length > 0) result.names = names;
    if (dobs.length > 0) result.dobs = dobs;
    if (ssns.length > 0) result.ssns = ssns;
    if (addresses.length > 0) result.addresses = addresses;
    if (phones.length > 0) result.phones = phones;
    if (emails.length > 0) result.emails = emails;
    if (associates.length > 0) result.associates = associates;

    return result;
  }

  // ============================================================
  // 3. Background Check — /BPS/BackgroundCheck
  // ============================================================

  private async searchBackground(query: SearchQuery, token: string): Promise<SourceResult | null> {
    const { firstName, lastName } = this.parseNameParts(query);
    const baseUrl = this.getBaseUrl();

    const personInfo: any = {
      PersonName: {
        FirstName: firstName,
        LastName: lastName,
      },
    };

    if (query.dob) personInfo.BirthDt = query.dob;
    if (query.ssn_last4) personInfo.SSNLast4 = query.ssn_last4;

    if (query.state) {
      personInfo.ContactInfo = {
        PostAddr: { StateProv: query.state },
      };
    }

    const requestBody = {
      SubscriberCode: this.getSubscriberCode(),
      PersonInfo: personInfo,
    };

    const res = await this.fetchWithRetry(`${baseUrl}/BPS/BackgroundCheck`, {
      method: 'POST',
      headers: this.buildHeaders(token),
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[MicrobiltSource] BackgroundCheck error (${res.status}): ${text.slice(0, 300)}`);
      return null;
    }

    const data = await res.json() as any;
    return this.mapBackgroundResponse(data);
  }

  private mapBackgroundResponse(data: any): SourceResult {
    const result: SourceResult = {
      source: this.name,
      sourceType: 'court',
      confidence: 0.85,
      fetchedAt: localNow(),
      rawResultCount: 0,
    };

    // --- Court / criminal records ---
    const courtRecords: CourtRecord[] = [];

    // Criminal records may appear under several keys
    const criminalField = data?.CriminalRecords
      || data?.BackgroundCheckInfo?.CriminalRecords
      || data?.CriminalHistory
      || data?.BackgroundCheckInfo?.CriminalHistory;
    const crimList = criminalField ? (Array.isArray(criminalField) ? criminalField : [criminalField]) : [];

    for (const rec of crimList) {
      if (!rec) continue;
      const charges = rec.Charges || rec.Offense || rec.Offenses;
      const chargeList = charges
        ? (Array.isArray(charges) ? charges : [charges])
        : [];

      courtRecords.push({
        source: this.name,
        caseNumber: rec.CaseNumber || rec.CaseNum || rec.DocketNumber || '',
        court: rec.Court || rec.CourtName || rec.Jurisdiction || '',
        state: rec.State || rec.StateProv || '',
        county: rec.County || undefined,
        caseType: 'criminal',
        filingDate: rec.FilingDate || rec.FilingDt || rec.ArrestDate || rec.ArrestDt || undefined,
        dispositionDate: rec.DispositionDate || rec.DispositionDt || undefined,
        disposition: rec.Disposition || rec.CaseDisposition || undefined,
        charges: chargeList.map((c: any) =>
          typeof c === 'string' ? c : (c.Description || c.ChargeDescription || c.OffenseDescription || c.Charge || '')
        ).filter(Boolean),
        status: rec.CaseStatus === 'Open' ? 'open'
          : rec.CaseStatus === 'Closed' ? 'closed'
          : rec.CaseStatus === 'Pending' ? 'pending'
          : 'unknown',
        defendant: rec.DefendantName || rec.Defendant || undefined,
        judge: rec.Judge || rec.JudgeName || undefined,
      });
    }

    // Court records (civil/general) may be separate
    const courtField = data?.CourtRecords
      || data?.BackgroundCheckInfo?.CourtRecords
      || data?.CivilRecords
      || data?.BackgroundCheckInfo?.CivilRecords;
    const courtList = courtField ? (Array.isArray(courtField) ? courtField : [courtField]) : [];

    for (const rec of courtList) {
      if (!rec) continue;
      courtRecords.push({
        source: this.name,
        caseNumber: rec.CaseNumber || rec.CaseNum || rec.DocketNumber || '',
        court: rec.Court || rec.CourtName || rec.Jurisdiction || '',
        state: rec.State || rec.StateProv || '',
        county: rec.County || undefined,
        caseType: rec.CaseType === 'Criminal' ? 'criminal'
          : rec.CaseType === 'Civil' ? 'civil'
          : rec.CaseType === 'Traffic' ? 'traffic'
          : rec.CaseType === 'Family' ? 'family'
          : rec.CaseType === 'Bankruptcy' ? 'bankruptcy'
          : 'other',
        filingDate: rec.FilingDate || rec.FilingDt || undefined,
        dispositionDate: rec.DispositionDate || rec.DispositionDt || undefined,
        disposition: rec.Disposition || rec.CaseDisposition || undefined,
        charges: rec.Charges ? (Array.isArray(rec.Charges) ? rec.Charges : [rec.Charges]).map((c: any) =>
          typeof c === 'string' ? c : (c.Description || c.Charge || '')
        ).filter(Boolean) : undefined,
        status: rec.CaseStatus === 'Open' ? 'open'
          : rec.CaseStatus === 'Closed' ? 'closed'
          : rec.CaseStatus === 'Pending' ? 'pending'
          : 'unknown',
        plaintiff: rec.Plaintiff || rec.PlaintiffName || undefined,
        defendant: rec.Defendant || rec.DefendantName || undefined,
        judge: rec.Judge || rec.JudgeName || undefined,
      });
    }

    // --- Sex offender records ---
    const sexOffField = data?.SexOffenderRecords
      || data?.BackgroundCheckInfo?.SexOffenderRecords
      || data?.SexOffender;
    const sexOffList = sexOffField ? (Array.isArray(sexOffField) ? sexOffField : [sexOffField]) : [];

    if (sexOffList.length > 0) {
      result.sexOffenderRecords = [];
      for (const rec of sexOffList) {
        if (!rec) continue;
        const offenses = rec.Offenses || rec.Offense;
        const offenseList = offenses
          ? (Array.isArray(offenses) ? offenses : [offenses])
          : [];

        result.sexOffenderRecords.push({
          source: this.name,
          name: rec.Name || rec.PersonName?.FullName
            || [rec.PersonName?.FirstName, rec.PersonName?.LastName].filter(Boolean).join(' ')
            || '',
          registryState: rec.State || rec.RegistryState || '',
          tier: rec.Tier || rec.Level || undefined,
          offenses: offenseList.map((o: any) =>
            typeof o === 'string' ? o : (o.Description || o.Offense || '')
          ).filter(Boolean),
          registrationDate: rec.RegistrationDate || rec.RegistrationDt || undefined,
          address: rec.Address || rec.ResidenceAddress || undefined,
          photoUrl: rec.PhotoUrl || rec.Photo || undefined,
          status: rec.Status === 'Compliant' ? 'compliant'
            : rec.Status === 'Non-Compliant' ? 'non-compliant'
            : rec.Status === 'Absconded' ? 'absconded'
            : 'unknown',
        });
      }
    }

    // --- Custody / incarceration records ---
    const custodyField = data?.IncarcerationRecords
      || data?.BackgroundCheckInfo?.IncarcerationRecords
      || data?.CustodyRecords;
    const custodyList = custodyField ? (Array.isArray(custodyField) ? custodyField : [custodyField]) : [];

    if (custodyList.length > 0) {
      result.custodyRecords = [];
      for (const rec of custodyList) {
        if (!rec) continue;
        result.custodyRecords.push({
          source: this.name,
          facility: rec.Facility || rec.FacilityName || rec.Institution || '',
          facilityState: rec.State || rec.FacilityState || '',
          facilityType: rec.FacilityType === 'Jail' ? 'jail'
            : rec.FacilityType === 'Prison' ? 'prison'
            : rec.FacilityType === 'Federal' ? 'federal'
            : 'unknown',
          inmateId: rec.InmateId || rec.InmateNumber || undefined,
          bookingDate: rec.BookingDate || rec.BookingDt || rec.AdmissionDate || undefined,
          releaseDate: rec.ReleaseDate || rec.ReleaseDt || undefined,
          charges: rec.Charges ? (Array.isArray(rec.Charges) ? rec.Charges : [rec.Charges]).map((c: any) =>
            typeof c === 'string' ? c : (c.Description || c.Charge || '')
          ).filter(Boolean) : undefined,
          status: rec.Status === 'In Custody' ? 'in_custody'
            : rec.Status === 'Released' ? 'released'
            : rec.Status === 'Transferred' ? 'transferred'
            : 'unknown',
          bond: rec.BondAmount ? parseFloat(rec.BondAmount) : undefined,
          bondStatus: rec.BondStatus === 'Set' ? 'set'
            : rec.BondStatus === 'Posted' ? 'posted'
            : rec.BondStatus === 'Denied' ? 'denied'
            : rec.BondStatus === 'No Bond' ? 'no_bond'
            : undefined,
        });
      }
    }

    result.rawResultCount = courtRecords.length
      + (result.sexOffenderRecords?.length || 0)
      + (result.custodyRecords?.length || 0);

    if (courtRecords.length > 0) result.courtRecords = courtRecords;

    return result;
  }

  // ============================================================
  // 4. SSN Trace — /BPS/SSNTrace
  // ============================================================

  private async searchSsnTrace(query: SearchQuery, token: string): Promise<SourceResult | null> {
    if (!query.ssn_last4 && !query.dob) return null;
    const { firstName, lastName } = this.parseNameParts(query);
    if (!firstName && !lastName) return null;
    const baseUrl = this.getBaseUrl();

    const requestBody: any = {
      SubscriberCode: this.getSubscriberCode(),
      PersonInfo: {
        PersonName: { FirstName: firstName, LastName: lastName },
        ...(query.ssn_last4 ? { TaxId: { SSNLast4: query.ssn_last4 } } : {}),
        ...(query.dob ? { BirthDt: query.dob } : {}),
      },
    };

    const res = await this.fetchWithRetry(`${baseUrl}/BPS/SSNTrace`, {
      method: 'POST',
      headers: this.buildHeaders(token),
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      console.error(`[MicrobiltSource] SSNTrace error (${res.status})`);
      return null;
    }

    const data = await res.json() as any;
    return this.mapSsnTraceResponse(data);
  }

  private mapSsnTraceResponse(data: any): SourceResult {
    const result: SourceResult = {
      source: this.name,
      sourceType: 'people',
      confidence: 0.92,
      fetchedAt: localNow(),
      rawResultCount: 0,
    };

    const records = data?.SSNTraceInfo?.SSNTraceRecord || data?.Records || [];
    const recordList = Array.isArray(records) ? records : records ? [records] : [];
    result.rawResultCount = recordList.length;

    const names: SourceResult['names'] = [];
    const dobs: SourceResult['dobs'] = [];
    const addresses: AddressRecord[] = [];

    for (const rec of recordList) {
      if (!rec) continue;
      const pn = rec.PersonName || {};
      if (pn.FirstName || pn.LastName) {
        names.push({
          source: this.name,
          full: [pn.FirstName, pn.MiddleName, pn.LastName].filter(Boolean).join(' '),
          first: pn.FirstName || undefined,
          middle: pn.MiddleName || undefined,
          last: pn.LastName || undefined,
        });
      }
      const dob = rec.BirthDt || rec.DateOfBirth;
      if (dob) dobs.push({ source: this.name, dob: String(dob) });

      const addr = rec.ContactInfo?.PostAddr || rec.Address || {};
      if (addr.Addr1 || addr.City) {
        addresses.push({
          source: this.name,
          street: addr.Addr1 || addr.StreetAddress || '',
          city: addr.City || '',
          state: addr.StateProv || addr.State || '',
          zip: addr.PostalCode || '',
          firstSeen: addr.FirstReportedDt || undefined,
          lastSeen: addr.LastReportedDt || undefined,
        });
      }
    }

    if (names.length) result.names = names;
    if (dobs.length) result.dobs = dobs;
    if (addresses.length) result.addresses = addresses;
    return result;
  }

  // ============================================================
  // 5. Phone Search — /BPS/PhoneSearch
  // ============================================================

  private async searchPhone(query: SearchQuery, token: string): Promise<SourceResult | null> {
    if (!query.phone) return null;
    const baseUrl = this.getBaseUrl();

    const requestBody = {
      SubscriberCode: this.getSubscriberCode(),
      PhoneInfo: {
        PhoneNum: { Phone: query.phone.replace(/\D/g, '') },
      },
    };

    const res = await this.fetchWithRetry(`${baseUrl}/BPS/PhoneSearch`, {
      method: 'POST',
      headers: this.buildHeaders(token),
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) return null;
    const data = await res.json() as any;
    return this.mapPhoneResponse(data);
  }

  private mapPhoneResponse(data: any): SourceResult {
    const result: SourceResult = {
      source: this.name,
      sourceType: 'people',
      confidence: 0.88,
      fetchedAt: localNow(),
      rawResultCount: 0,
    };

    const records = data?.PhoneSearchInfo?.PhoneSearchRecord || data?.Records || [];
    const recordList = Array.isArray(records) ? records : records ? [records] : [];
    result.rawResultCount = recordList.length;

    const names: SourceResult['names'] = [];
    const phones: SourceResult['phones'] = [];
    const addresses: AddressRecord[] = [];

    for (const rec of recordList) {
      if (!rec) continue;
      const pn = rec.PersonName || rec.SubscriberName || {};
      if (pn.FirstName || pn.LastName || pn.FullName) {
        names.push({
          source: this.name,
          full: pn.FullName || [pn.FirstName, pn.LastName].filter(Boolean).join(' '),
          first: pn.FirstName || undefined,
          last: pn.LastName || undefined,
        });
      }

      const phoneNum = rec.PhoneNum?.Phone || rec.Phone || rec.PhoneNumber;
      if (phoneNum) {
        phones.push({
          source: this.name,
          number: String(phoneNum),
          type: rec.PhoneType === 'Mobile' ? 'mobile' : rec.PhoneType === 'Landline' ? 'landline' : 'unknown',
          carrier: rec.Carrier || rec.PhoneCompany || undefined,
          lineStatus: rec.Status === 'Active' ? 'active' : rec.Status === 'Inactive' ? 'inactive' : 'unknown',
        });
      }

      const addr = rec.ContactInfo?.PostAddr || rec.Address || {};
      if (addr.Addr1 || addr.City) {
        addresses.push({
          source: this.name,
          street: addr.Addr1 || '',
          city: addr.City || '',
          state: addr.StateProv || '',
          zip: addr.PostalCode || '',
        });
      }
    }

    if (names.length) result.names = names;
    if (phones.length) result.phones = phones;
    if (addresses.length) result.addresses = addresses;
    return result;
  }

  // ============================================================
  // 6. Email Search — /BPS/EmailSearch
  // ============================================================

  private async searchEmail(query: SearchQuery, token: string): Promise<SourceResult | null> {
    if (!query.email) return null;
    const baseUrl = this.getBaseUrl();

    const requestBody = {
      SubscriberCode: this.getSubscriberCode(),
      EmailInfo: {
        EmailAddress: query.email,
      },
    };

    const res = await this.fetchWithRetry(`${baseUrl}/BPS/EmailSearch`, {
      method: 'POST',
      headers: this.buildHeaders(token),
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) return null;
    const data = await res.json() as any;
    return this.mapEmailResponse(data);
  }

  private mapEmailResponse(data: any): SourceResult {
    const result: SourceResult = {
      source: this.name,
      sourceType: 'people',
      confidence: 0.85,
      fetchedAt: localNow(),
      rawResultCount: 0,
    };

    const records = data?.EmailSearchInfo?.EmailSearchRecord || data?.Records || [];
    const recordList = Array.isArray(records) ? records : records ? [records] : [];
    result.rawResultCount = recordList.length;

    const names: SourceResult['names'] = [];
    const emails: SourceResult['emails'] = [];
    const addresses: AddressRecord[] = [];

    for (const rec of recordList) {
      if (!rec) continue;
      const pn = rec.PersonName || {};
      if (pn.FirstName || pn.LastName || pn.FullName) {
        names.push({
          source: this.name,
          full: pn.FullName || [pn.FirstName, pn.LastName].filter(Boolean).join(' '),
          first: pn.FirstName || undefined,
          last: pn.LastName || undefined,
        });
      }

      const emailAddr = rec.EmailAddress || rec.Email;
      if (emailAddr) {
        emails.push({
          source: this.name,
          address: String(emailAddr),
          type: rec.EmailType || undefined,
        });
      }

      const addr = rec.ContactInfo?.PostAddr || {};
      if (addr.Addr1 || addr.City) {
        addresses.push({
          source: this.name,
          street: addr.Addr1 || '',
          city: addr.City || '',
          state: addr.StateProv || '',
          zip: addr.PostalCode || '',
        });
      }
    }

    if (names.length) result.names = names;
    if (emails.length) result.emails = emails;
    if (addresses.length) result.addresses = addresses;
    return result;
  }

  // ============================================================
  // 7. Property Search — /BPS/PropertySearch
  // ============================================================

  private async searchProperty(query: SearchQuery, token: string): Promise<SourceResult | null> {
    if (!query.address) return null;
    const baseUrl = this.getBaseUrl();

    const requestBody = {
      SubscriberCode: this.getSubscriberCode(),
      PropertyInfo: {
        PostAddr: {
          ...(query.address ? { Addr1: query.address } : {}),
          ...(query.city ? { City: query.city } : {}),
          ...(query.state ? { StateProv: query.state } : {}),
          ...(query.zip ? { PostalCode: query.zip } : {}),
        },
      },
    };

    const res = await this.fetchWithRetry(`${baseUrl}/BPS/PropertySearch`, {
      method: 'POST',
      headers: this.buildHeaders(token),
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) return null;
    const data = await res.json() as any;
    return this.mapPropertyResponse(data);
  }

  private mapPropertyResponse(data: any): SourceResult {
    const result: SourceResult = {
      source: this.name,
      sourceType: 'property',
      confidence: 0.9,
      fetchedAt: localNow(),
      rawResultCount: 0,
    };

    const records = data?.PropertySearchInfo?.PropertySearchRecord || data?.Records || [];
    const recordList = Array.isArray(records) ? records : records ? [records] : [];
    result.rawResultCount = recordList.length;

    const propertyRecords: SourceResult['propertyRecords'] = [];

    for (const rec of recordList) {
      if (!rec) continue;
      const rawType = (rec.PropertyType || rec.LandUse || '').toLowerCase();
      const propType: 'residential' | 'commercial' | 'land' | 'industrial' | 'unknown' =
        rawType.includes('resid') ? 'residential'
        : rawType.includes('commerc') ? 'commercial'
        : rawType.includes('land') || rawType.includes('vacant') ? 'land'
        : rawType.includes('industr') ? 'industrial'
        : 'unknown';

      propertyRecords!.push({
        source: this.name,
        address: rec.Address?.Addr1 || rec.PropertyAddress || '',
        city: rec.Address?.City || '',
        state: rec.Address?.StateProv || '',
        zip: rec.Address?.PostalCode || '',
        ownerName: rec.OwnerName || rec.Owner || undefined,
        propertyType: propType,
        assessedValue: rec.AssessedValue ? parseFloat(rec.AssessedValue) : undefined,
        marketValue: rec.MarketValue ? parseFloat(rec.MarketValue) : undefined,
        salePrice: rec.SalePrice ? parseFloat(rec.SalePrice) : undefined,
        saleDate: rec.SaleDate || undefined,
        yearBuilt: rec.YearBuilt ? parseInt(rec.YearBuilt) : undefined,
        squareFeet: rec.SquareFeet ? parseInt(rec.SquareFeet) : undefined,
      });
    }

    if (propertyRecords!.length) result.propertyRecords = propertyRecords;
    return result;
  }

  // ============================================================
  // 8. Vehicle Search — /BPS/VehicleSearch
  // ============================================================

  private async searchVehicle(query: SearchQuery, token: string): Promise<SourceResult | null> {
    const { firstName, lastName } = this.parseNameParts(query);
    if (!firstName && !lastName) return null;
    const baseUrl = this.getBaseUrl();

    const requestBody = {
      SubscriberCode: this.getSubscriberCode(),
      PersonInfo: {
        PersonName: { FirstName: firstName, LastName: lastName },
        ...(query.state ? { ContactInfo: { PostAddr: { StateProv: query.state } } } : {}),
      },
    };

    const res = await this.fetchWithRetry(`${baseUrl}/BPS/VehicleSearch`, {
      method: 'POST',
      headers: this.buildHeaders(token),
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) return null;
    const data = await res.json() as any;
    return this.mapVehicleResponse(data);
  }

  private mapVehicleResponse(data: any): SourceResult {
    const result: SourceResult = {
      source: this.name,
      sourceType: 'people',
      confidence: 0.85,
      fetchedAt: localNow(),
      rawResultCount: 0,
    };

    const records = data?.VehicleSearchInfo?.VehicleRecord || data?.Vehicles || data?.Records || [];
    const recordList = Array.isArray(records) ? records : records ? [records] : [];
    result.rawResultCount = recordList.length;

    const vehicles: SourceResult['vehicles'] = [];

    for (const rec of recordList) {
      if (!rec) continue;
      const rawRegStatus = (rec.RegistrationStatus || '').toLowerCase();
      const regStatus: 'active' | 'expired' | 'suspended' | 'unknown' =
        rawRegStatus.includes('active') ? 'active'
        : rawRegStatus.includes('expir') ? 'expired'
        : rawRegStatus.includes('suspend') ? 'suspended'
        : 'unknown';

      const yearVal = rec.Year || rec.ModelYear;
      vehicles!.push({
        source: this.name,
        vin: rec.VIN || rec.Vin || undefined,
        plate: rec.PlateNumber || rec.LicensePlate || rec.TagNumber || undefined,
        plateState: rec.PlateState || rec.RegistrationState || undefined,
        year: yearVal ? parseInt(String(yearVal)) || undefined : undefined,
        make: rec.Make || undefined,
        model: rec.Model || undefined,
        color: rec.Color || undefined,
        registeredOwner: rec.RegisteredOwner || rec.OwnerName || undefined,
        registrationStatus: regStatus,
      });
    }

    if (vehicles!.length) result.vehicles = vehicles;
    return result;
  }

  // ============================================================
  // Health Check — tests OAuth token endpoint
  // ============================================================

  async healthCheck(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
    if (!this.isConfigured()) {
      return { ok: false, error: 'MicroBilt credentials not configured' };
    }
    if (!this.isEnabled()) {
      return { ok: false, error: 'MicroBilt source is disabled' };
    }

    const start = Date.now();
    try {
      const token = await this.getAccessToken();
      const latencyMs = Date.now() - start;

      if (!token) {
        return { ok: false, latencyMs, error: 'Failed to obtain access token — check credentials' };
      }

      return { ok: true, latencyMs };
    } catch (err) {
      const latencyMs = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, latencyMs, error: `Token endpoint error: ${message}` };
    }
  }
}
