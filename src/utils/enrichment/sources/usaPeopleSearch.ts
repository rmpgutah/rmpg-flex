import type { EnrichmentSeed, SourceResult, EnrichedRecord, Address } from '../types';
import type { Bindings } from '../../../types';
import { enrichmentHeaders, resolveSecret, splitPersonName, timedFetchJson } from './http';
import { normalizeResponse } from '../../personIntel/adapters/skiptracer';

export const USA_PEOPLE_SEARCH_HOST = 'usa-people-search-public-records.p.rapidapi.com';
export const USA_PEOPLE_SEARCH_PATH = '/search';

const SOURCE = 'usa_people_search';

function str(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}

function collectStrings(record: Record<string, unknown>, keys: string[]): string[] {
  const out: string[] = [];
  for (const key of keys) {
    const v = record[key];
    if (typeof v === 'string' && v.trim()) out.push(v.trim());
    else if (Array.isArray(v)) {
      for (const item of v) {
        if (typeof item === 'string' && item.trim()) out.push(item.trim());
        else if (item && typeof item === 'object') {
          const o = item as Record<string, unknown>;
          const nested = str(o.number ?? o.phone ?? o.phone_number ?? o.email ?? o.address ?? o.value);
          if (nested) out.push(nested);
        }
      }
    }
  }
  return [...new Set(out)];
}

function addressesFrom(record: Record<string, unknown>): Address[] {
  const addresses: Address[] = [];
  const street = str(record.street ?? record.streetAddress ?? record.address ?? record['Street Address'] ?? record.currentAddress);
  const city = str(record.city ?? record.addressLocality ?? record['Address Locality'] ?? record.AddressLocality);
  const state = str(record.state ?? record.addressRegion ?? record['Address Region']);
  const zip = str(record.zip ?? record.zipcode ?? record.postalCode ?? record['Postal Code']);
  if (street || city || state || zip) {
    addresses.push({ street, city, state, zip, type: 'current', source: SOURCE });
  }
  const hist = record.previous_addresses ?? record.previousAddresses ?? record.past_addresses;
  if (Array.isArray(hist)) {
    for (const item of hist) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      addresses.push({
        street: str(o.street ?? o.streetAddress ?? o.address),
        city: str(o.city ?? o.addressLocality),
        state: str(o.state ?? o.addressRegion),
        zip: str(o.zip ?? o.postalCode),
        type: 'previous',
        source: SOURCE,
      });
    }
  }
  return addresses;
}

export function mapUsaPeopleRecords(raw: unknown): EnrichedRecord[] {
  const records = normalizeResponse(raw);
  const out: EnrichedRecord[] = [];
  for (const rec of records) {
    if (!rec || typeof rec !== 'object') continue;
    const r = rec as Record<string, unknown>;
    const first = str(r.firstName ?? r.first_name ?? r['First Name']);
    const last = str(r.lastName ?? r.last_name ?? r['Last Name']);
    const name = str(r.name ?? r.fullName ?? r.full_name)
      || [first, last].filter(Boolean).join(' ').trim()
      || undefined;
    const emails = collectStrings(r, ['emails', 'email', 'Email-1', 'email_addresses']);
    const phones = collectStrings(r, ['phones', 'phone', 'phone_numbers', 'Phone-1', 'telephone']);
    const addresses = addressesFrom(r);
    if (!name && !emails.length && !phones.length && !addresses.length) continue;
    out.push({
      name,
      dob: str(r.dob ?? r.born ?? r.Born ?? r.date_of_birth),
      addresses,
      phones,
      emails,
      source: SOURCE,
      raw: rec,
    });
  }
  return out.slice(0, 10);
}

export function buildUsaPeopleSearchUrl(
  seed: EnrichmentSeed,
  host = USA_PEOPLE_SEARCH_HOST,
  path = USA_PEOPLE_SEARCH_PATH,
): string | null {
  const params = new URLSearchParams();
  if (seed.phone?.trim()) {
    params.set('phone', seed.phone.replace(/\D/g, ''));
  } else if (seed.email?.trim()) {
    params.set('email', seed.email.trim());
  } else {
    const { first, last } = splitPersonName(seed.first_name, seed.last_name);
    const name = [first, last].filter(Boolean).join(' ').trim();
    if (!name) return null;
    params.set('name', name);
    if (seed.city) params.set('city', seed.city);
    if (seed.state) params.set('state', seed.state);
  }
  return `https://${host}${path}?${params}`;
}

export async function search(seed: EnrichmentSeed, env: Bindings): Promise<SourceResult> {
  const start = Date.now();
    const apiKey = await resolveSecret(env, 'USA_PEOPLE_SEARCH_RAPIDAPI_KEY', [
    'usa_people_search_rapidapi_key',
    'skiptracer_rapidapi_key',
    'plate_check_rapidapi_key',
  ]);
  if (!apiKey) return { source: SOURCE, ok: false, latency_ms: 0, records: [], error: 'not_configured' };

  const host = (await resolveSecret(env, 'USA_PEOPLE_SEARCH_HOST', ['usa_people_search_host']))
    || USA_PEOPLE_SEARCH_HOST;
  const path = (await resolveSecret(env, 'USA_PEOPLE_SEARCH_PATH', ['usa_people_search_path']))
    || USA_PEOPLE_SEARCH_PATH;
  const url = buildUsaPeopleSearchUrl(seed, host, path.startsWith('/') ? path : `/${path}`);
  if (!url) return { source: SOURCE, ok: true, latency_ms: Date.now() - start, records: [] };

  const fetched = await timedFetchJson(url, {
    method: 'GET',
    headers: enrichmentHeaders({
      'X-RapidAPI-Key': apiKey,
      'X-RapidAPI-Host': host,
    }),
  }, 15000);

  if (!fetched.ok) {
    return { source: SOURCE, ok: false, latency_ms: Date.now() - start, records: [], error: fetched.error };
  }
  return {
    source: SOURCE,
    ok: true,
    latency_ms: Date.now() - start,
    records: mapUsaPeopleRecords(fetched.json),
  };
}
