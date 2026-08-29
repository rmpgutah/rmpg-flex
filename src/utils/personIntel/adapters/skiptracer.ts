import type { IntelSeed, RawDataPoint, SourceResult, CapturedCrossRef } from '../types';
import { getKey, safeFetch, makeSourceResult } from './shared';
import { confirmIdentity, parsePersonName } from '../../identityConfirm';

const SRC = 'SkipTracerFlex';

interface SkipTracerConfig {
  apiKey: string | null;
  apiHost: string;
}

async function getConfig(db: D1Database): Promise<SkipTracerConfig> {
  let apiKey = await getKey(db, 'skiptracer_rapidapi_key');
  if (!apiKey?.trim()) {
    apiKey = await getKey(db, 'plate_check_rapidapi_key');
  }
  const hostRow = await db.prepare(
    "SELECT config_value FROM system_config WHERE config_key = 'skiptracer_api_host' AND is_active = 1 LIMIT 1"
  ).bind().first<{ config_value: string }>();

  return {
    apiKey,
    apiHost: hostRow?.config_value || 'skip-tracing-api-people-search-lookup.p.rapidapi.com',
  };
}

export async function querySkipTracer(db: D1Database, seed: IntelSeed): Promise<SourceResult> {
  const t0 = Date.now();
  const config = await getConfig(db);

  if (!config.apiKey) {
    return makeSourceResult(SRC, 2, 'not_configured', [], [], Date.now() - t0);
  }

  try {
    const headers = {
      'X-RapidAPI-Key': config.apiKey,
      'X-RapidAPI-Host': config.apiHost,
      'Content-Type': 'application/json',
    };

    let url: string | null = null;
    const params = new URLSearchParams();

    // Build URL based on available seed data
    if (seed.phone) {
      // Reverse Person Search by phone
      url = `https://${config.apiHost}/api/person/reverse`;
      params.set('phone', seed.phone.replace(/\D/g, ''));
    } else if (seed.email) {
      // Reverse Person Search by email
      url = `https://${config.apiHost}/api/person/reverse`;
      params.set('email', seed.email);
    } else if (seed.address) {
      // Reverse Person Search by address
      url = `https://${config.apiHost}/api/person/reverse`;
      params.set('address', seed.address);
    } else if (seed.name) {
      // Search Person by Name
      url = `https://${config.apiHost}/api/person/search`;
      const nameParts = seed.name.split(/\s+/).filter(Boolean);
      params.set('firstName', nameParts[0] || '');
      params.set('lastName', nameParts.length > 1 ? nameParts[nameParts.length - 1] : '');
    } else {
      return makeSourceResult(SRC, 2, 'skipped', [], [], Date.now() - t0);
    }

    if (!url) {
      return makeSourceResult(SRC, 2, 'skipped', [], [], Date.now() - t0);
    }

    // Append params to URL
    const fullUrl = `${url}?${params.toString()}`;

    const result = await safeFetch(fullUrl, {
      method: 'GET',
      headers,
    }, 20000);

    // Normalize results from various response shapes
    const records = normalizeResponse(result);

    if (records.length > 0) {
      const pts: RawDataPoint[] = [];
      const crossRefs: CapturedCrossRef[] = [];

      for (const record of records) {
        const profileName = extractProfileName(record);
        if (seed.name && (seed.dob || seed.age)) {
          const parsed = parsePersonName(seed.name);
          const addrs = extractAddresses(record);
          const verdict = confirmIdentity(
            { first: parsed.first, last: parsed.last, dob: seed.dob, age: seed.age, city: seed.city, state: seed.state },
            {
              first: profileName.first, last: profileName.last,
              dob: profileName.born, age: profileName.age,
              city: addrs[0]?.city, state: addrs[0]?.state,
            },
          );
          if (!verdict.matched) continue;
        }

        // Identity (WebOlivia model: First/Last/Age/Born)
        if (profileName.first || profileName.last) {
          if (profileName.first) pts.push({ category: 'legal', field: 'first_name', value: profileName.first, source: SRC });
          if (profileName.last) pts.push({ category: 'legal', field: 'last_name', value: profileName.last, source: SRC });
        }
        if (profileName.age) pts.push({ category: 'legal', field: 'age', value: profileName.age, source: SRC });
        if (profileName.born) pts.push({ category: 'legal', field: 'born', value: profileName.born, source: SRC });

        // Current address (structured)
        for (const addr of extractAddresses(record)) {
          if (addr.street) pts.push({ category: 'address', field: 'street', value: addr.street, source: SRC });
          if (addr.city) pts.push({ category: 'address', field: 'city', value: addr.city, source: SRC });
          if (addr.state) pts.push({ category: 'address', field: 'state', value: addr.state, source: SRC });
          if (addr.zip) pts.push({ category: 'address', field: 'zip', value: addr.zip, source: SRC });
          if (addr.county) pts.push({ category: 'address', field: 'county', value: addr.county, source: SRC });
        }

        // Phones with type/provider (WebOlivia: Phone-1..5 + Phone Type + Provider)
        for (const phone of extractPhones(record)) {
          pts.push({ category: 'phone', field: 'number', value: phone.number, source: SRC });
          if (phone.type) pts.push({ category: 'phone', field: 'phone_type', value: `${phone.number}|${phone.type}`, source: SRC });
          if (phone.provider) pts.push({ category: 'phone', field: 'provider', value: phone.provider, source: SRC });
        }

        // Email addresses
        for (const email of extractEmails(record)) {
          pts.push({ category: 'email', field: 'address', value: email, source: SRC });
        }

        // Previous addresses (WebOlivia: Previous Addresses w/ timespan + county)
        for (const prev of extractPreviousAddresses(record)) {
          const prevStr = [prev.street, prev.city, prev.state, prev.zip].filter(Boolean).join(', ');
          if (prevStr) pts.push({ category: 'address', field: 'previous_address', value: prevStr, source: SRC });
          if (prev.timespan) pts.push({ category: 'address', field: 'previous_address_timespan', value: `${prevStr}|${prev.timespan}`, source: SRC });
        }

        // Relatives with age (WebOlivia: Relatives [{Name,Age}])
        for (const rel of extractRelatives(record)) {
          pts.push({ category: 'associate', field: 'relative', value: rel.name, source: SRC });
          if (rel.age) pts.push({ category: 'associate', field: 'relative_age', value: `${rel.name}|${rel.age}`, source: SRC });
        }

        // Associates with age (WebOlivia: Associates [{Name,Age}])
        for (const asc of extractAssociates(record)) {
          pts.push({ category: 'associate', field: 'associate', value: asc.name, source: SRC });
          if (asc.age) pts.push({ category: 'associate', field: 'associate_age', value: `${asc.name}|${asc.age}`, source: SRC });
        }

        // Person link — the source profile URL for deeper verification
        const personLink = extractPersonLink(record);
        const prev = extractPreviousAddresses(record);
        if (personLink) {
          pts.push({ category: 'online', field: 'person_link', value: personLink, source: SRC });
          crossRefs.push({
            source: 'SKIP_TRACE',
            externalRef: personLink,
            externalUrl: personLink,
            label: [profileName.first, profileName.last].filter(Boolean).join(' ') || 'Skip-trace profile',
            matchedFields: [{ field: 'name', value: seed.name || '' }],
            // A commercial skip-trace profile is a strong lead but unverified.
            confidence: 0.5,
            isCriminal: false,
            riskFlags: [],
            meta: buildSkipTraceMeta(record),
          });
        }
      }

      return makeSourceResult(SRC, 2, 'success', pts, [], Date.now() - t0, undefined, crossRefs);
    }

    return makeSourceResult(SRC, 2, 'success', [], [], Date.now() - t0);
  } catch (e: any) {
    return makeSourceResult(SRC, 2, 'error', [], [], Date.now() - t0, String(e?.message ?? e));
  }
}

export function normalizeResponse(data: any): any[] {
  // Handle the actual API structure: { success: true, data: { results: [...] } }
  if (data.success && data.data && Array.isArray(data.data.results)) {
    return data.data.results;
  }
  if (data.results && Array.isArray(data.results)) return data.results;
  if (data.data && Array.isArray(data.data)) return data.data;
  if (Array.isArray(data)) return data;
  if (data.persons && Array.isArray(data.persons)) return data.persons;
  if (data.people && Array.isArray(data.people)) return data.people;
  if (data.matches && Array.isArray(data.matches)) return data.matches;
  if (data.record) return [data.record];
  if (data.person) return [data.person];
  if (data.response) {
    if (Array.isArray(data.response)) return data.response;
    if (data.response.results) return data.response.results;
    return [data.response];
  }
  return [data];
}

function extractProfileName(record: any): { first?: string; last?: string; age?: string; born?: string } {
  if (!record || typeof record !== 'object') return {};
  const get = (k: string) => {
    const v = record[k];
    return typeof v === 'string' ? v.trim() : (v == null ? '' : String(v).trim());
  };
  return {
    first: get('firstName') || get('first_name') || get('First Name'),
    last: get('lastName') || get('last_name') || get('Last Name'),
    age: get('age') || get('Age'),
    born: get('born') || get('Born') || get('dob') || get('date_of_birth'),
  };
}

function extractAddresses(record: any): Array<{ street?: string; city?: string; state?: string; zip?: string; county?: string }> {
  const addresses: Array<{ street?: string; city?: string; state?: string; zip?: string; county?: string }> = [];

  // Handle currentAddress as a single string (this API's format)
  if (record.currentAddress && typeof record.currentAddress === 'string') {
    addresses.push({ street: record.currentAddress });
  }
  if (record.county && typeof record.county === 'string') {
    // fold county onto the last current address if it lacks one
    const last = addresses[addresses.length - 1];
    if (last) last.county = record.county;
    else addresses.push({ county: record.county });
  }

  const fields = ['addresses', 'address_list', 'current_addresses', 'locations', 'address_history', 'current_address'];
  for (const field of fields) {
    if (record[field]) {
      if (Array.isArray(record[field])) {
        for (const addr of record[field]) {
          if (typeof addr === 'string') {
            addresses.push({ street: addr });
          } else {
            addresses.push({
              street: addr.street || addr.street1 || addr.line1,
              city: addr.city,
              state: addr.state || addr.state_code,
              zip: addr.zipcode || addr.zip || addr.postal_code,
              county: addr.county,
            });
          }
        }
      } else if (typeof record[field] === 'object') {
        addresses.push({
          street: record[field].street || record[field].line1,
          city: record[field].city,
          state: record[field].state,
          zip: record[field].zip,
          county: record[field].county,
        });
      }
    }
  }

  return addresses;
}

function extractPhones(record: any): Array<{ number: string; type?: string; provider?: string }> {
  const phones: Array<{ number: string; type?: string; provider?: string }> = [];
  if (!record || typeof record !== 'object') return phones;

  const fields = ['phones', 'phone_numbers', 'phone_list', 'telephone'];
  for (const field of fields) {
    if (Array.isArray(record[field])) {
      for (const ph of record[field]) {
        if (typeof ph === 'string') {
          phones.push({ number: ph });
        } else {
          const num = ph.number || ph.phone || ph.phone_number;
          if (num) phones.push({ number: String(num), type: ph.type || ph.line_type, provider: ph.provider || ph.carrier });
        }
      }
    } else if (typeof record[field] === 'string') {
      phones.push({ number: record[field] });
    }
  }

  // Dedupe by number, preserving the first type/provider seen.
  const seen = new Map<string, { number: string; type?: string; provider?: string }>();
  for (const p of phones) if (!seen.has(p.number)) seen.set(p.number, p);
  return [...seen.values()];
}

function extractEmails(record: any): string[] {
  const emails: string[] = [];

  const fields = ['emails', 'email_addresses', 'email_list'];
  for (const field of fields) {
    if (Array.isArray(record[field])) {
      for (const em of record[field]) {
        if (typeof em === 'string') emails.push(em);
        else if (em.address || em.email) emails.push(em.address || em.email);
      }
    } else if (typeof record[field] === 'string') {
      emails.push(record[field]);
    }
  }

  return [...new Set(emails)];
}

function extractPreviousAddresses(record: any): Array<{ street?: string; city?: string; state?: string; zip?: string; county?: string; timespan?: string }> {
  const out: Array<{ street?: string; city?: string; state?: string; zip?: string; county?: string; timespan?: string }> = [];
  const fields = ['previous_addresses', 'previousAddresses', 'past_addresses', 'address_history', 'prior_addresses'];
  for (const field of fields) {
    if (Array.isArray(record[field])) {
      for (const addr of record[field]) {
        if (typeof addr !== 'object' || addr === null) continue;
        out.push({
          street: addr.streetAddress || addr.street_address || addr.street || addr.line1,
          city: addr.addressLocality || addr.city,
          state: addr.addressRegion || addr.state || addr.state_code,
          zip: addr.postalCode || addr.postal_code || addr.zip,
          county: addr.county,
          timespan: addr.timespan || addr.timespan_text || addr.dates,
        });
      }
    }
  }
  return out;
}

function extractRelatives(record: any): Array<{ name: string; age?: string }> {
  const out: Array<{ name: string; age?: string }> = [];
  const fields = ['relatives', 'family_members'];
  for (const field of fields) {
    if (Array.isArray(record[field])) {
      for (const rel of record[field]) {
        if (typeof rel === 'string') out.push({ name: rel });
        else if (rel && (rel.name || rel.full_name || rel.Name)) {
          out.push({ name: rel.name || rel.full_name || rel.Name, age: rel.age || rel.Age ? String(rel.age ?? rel.Age) : undefined });
        }
      }
    }
  }
  // dedupe by name
  const seen = new Map<string, { name: string; age?: string }>();
  for (const r of out) if (!seen.has(r.name)) seen.set(r.name, r);
  return [...seen.values()];
}

function extractAssociates(record: any): Array<{ name: string; age?: string }> {
  const out: Array<{ name: string; age?: string }> = [];
  const fields = ['associates', 'known_associates', 'Associates'];
  for (const field of fields) {
    if (Array.isArray(record[field])) {
      for (const rel of record[field]) {
        if (typeof rel === 'string') out.push({ name: rel });
        else if (rel && (rel.name || rel.full_name || rel.Name)) {
          out.push({ name: rel.name || rel.full_name || rel.Name, age: rel.age || rel.Age ? String(rel.age ?? rel.Age) : undefined });
        }
      }
    }
  }
  const seen = new Map<string, { name: string; age?: string }>();
  for (const r of out) if (!seen.has(r.name)) seen.set(r.name, r);
  return [...seen.values()];
}

function extractPersonLink(record: any): string | undefined {
  const v = record.personLink || record.person_link || record.profile_url || record.url || record.source_url;
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/**
 * Map normalized RapidAPI skip-trace records into dossier-ready profiles.
 */
export function mapSkipTracerRecordsToProfiles(records: unknown[]): Array<{
  fullName: string;
  firstName?: string;
  lastName?: string;
  dob?: string;
  age?: number;
  addresses: Array<{ address?: string; city?: string; state?: string; zip?: string; source: string }>;
  phones: Array<{ number: string; type?: string; source: string }>;
  emails: Array<{ email?: string; source: string }>;
  associates: Array<{ name: string; relationship?: string; source: string }>;
}> {
  const profiles: ReturnType<typeof mapSkipTracerRecordsToProfiles> = [];
  for (const rec of records) {
    const name = extractProfileName(rec);
    const fullName = [name.first, name.last].filter(Boolean).join(' ').trim();
    if (!fullName) continue;
    profiles.push({
      fullName,
      firstName: name.first || undefined,
      lastName: name.last || undefined,
      dob: name.born || undefined,
      age: name.age ? Number(name.age) : undefined,
      addresses: extractAddresses(rec).map(a => ({
        address: a.street || [a.city, a.state, a.zip].filter(Boolean).join(', '),
        city: a.city,
        state: a.state,
        zip: a.zip,
        source: 'rapidapi_skiptrace',
      })),
      phones: extractPhones(rec).map(p => ({
        number: p.number,
        type: p.type,
        source: 'rapidapi_skiptrace',
      })),
      emails: extractEmails(rec).map(e => ({ email: e, source: 'rapidapi_skiptrace' })),
      associates: [
        ...extractRelatives(rec).map(r => ({ name: r.name, relationship: 'relative', source: 'rapidapi_skiptrace' })),
        ...extractAssociates(rec).map(a => ({ name: a.name, relationship: 'associate', source: 'rapidapi_skiptrace' })),
      ],
    });
  }
  return profiles;
}

/**
 * Full WebOlivia/skip-trace profile as a structured payload for the
 * cross-ref's meta_json — keeps the shape the flat RawDataPoints lose
 * (phone↔type/provider pairing, address↔timespan pairing, relative ages).
 * Exported for unit tests.
 */
export function buildSkipTraceMeta(record: any): Record<string, unknown> {
  if (!record || typeof record !== 'object') {
    return { phones: [], previousAddresses: [], relatives: [], associates: [] };
  }
  const name = extractProfileName(record);
  return {
    firstName: name.first,
    lastName: name.last,
    age: name.age,
    born: name.born,
    phones: extractPhones(record),
    previousAddresses: extractPreviousAddresses(record),
    relatives: extractRelatives(record),
    associates: extractAssociates(record),
    personLink: extractPersonLink(record),
  };
}
