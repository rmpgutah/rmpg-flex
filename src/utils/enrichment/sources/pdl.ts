import type { EnrichmentSeed, SourceResult, EnrichedRecord, Address } from '../types';
import type { Bindings } from '../../../types';
import { enrichmentHeaders, resolveSecret, splitPersonName, timedFetchJson } from './http';

const SOURCE = 'pdl';

/** Free-plan contact fields are booleans (true/false), not values. */
export function stringContactValues(values: unknown): string[] {
  if (typeof values === 'string' && values.trim()) return [values.trim()];
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  for (const item of values) {
    if (typeof item === 'boolean') continue;
    if (typeof item === 'string' && item.trim()) out.push(item.trim());
    else if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>;
      const nested = o.address ?? o.number ?? o.phone ?? o.email;
      if (typeof nested === 'string' && nested.trim()) out.push(nested.trim());
    }
  }
  return [...new Set(out)];
}

export function mapPdlPerson(data: Record<string, unknown> | null | undefined): EnrichedRecord | null {
  if (!data) return null;
  const first = typeof data.first_name === 'string' ? data.first_name : undefined;
  const last = typeof data.last_name === 'string' ? data.last_name : undefined;
  const name = (typeof data.full_name === 'string' && data.full_name.trim())
    || [first, last].filter(Boolean).join(' ').trim()
    || undefined;
  const emails = stringContactValues(data.emails ?? data.work_email ?? data.recommended_personal_email);
  const phones = stringContactValues(data.phone_numbers ?? data.mobile_phone);
  const streetAddrs = Array.isArray(data.street_addresses) ? data.street_addresses : [];
  const addresses: Address[] = [];
  for (const item of streetAddrs) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    addresses.push({
      street: typeof o.street_address === 'string' ? o.street_address : undefined,
      city: typeof o.locality === 'string' ? o.locality : undefined,
      state: typeof o.region === 'string' ? o.region : undefined,
      zip: typeof o.postal_code === 'string' ? o.postal_code : undefined,
      source: SOURCE,
    });
  }
  const locName = typeof data.location_name === 'string' ? data.location_name : undefined;
  if (!addresses.length && locName) {
    addresses.push({ city: locName, source: SOURCE });
  }
  if (!name && !emails.length && !phones.length && !addresses.length) return null;
  const job = [data.job_title, data.job_company_name].filter(v => typeof v === 'string' && v.trim()) as string[];
  return {
    name,
    addresses,
    phones,
    emails,
    business_associations: job.length ? job : undefined,
    source: SOURCE,
    raw: data,
  };
}

export function buildPdlEnrichUrl(seed: EnrichmentSeed): string {
  const { first, last } = splitPersonName(seed.first_name, seed.last_name);
  const params = new URLSearchParams();
  if (first) params.set('first_name', first);
  if (last) params.set('last_name', last);
  if (first && last) params.set('name', `${first} ${last}`);
  if (seed.email) params.set('email', seed.email.trim());
  if (seed.phone) params.set('phone', seed.phone.replace(/\D/g, ''));
  if (seed.city || seed.state) {
    params.set('location', [seed.city, seed.state].filter(Boolean).join(', '));
  }
  return `https://api.peopledatalabs.com/v5/person/enrich?${params}`;
}

export async function search(seed: EnrichmentSeed, env: Bindings): Promise<SourceResult> {
  const start = Date.now();
  const apiKey = await resolveSecret(env, 'PDL_API_KEY', ['pdl_api_key']);
  if (!apiKey) return { source: SOURCE, ok: false, latency_ms: 0, records: [], error: 'not_configured' };

  const { first, last } = splitPersonName(seed.first_name, seed.last_name);
  if (!first && !last && !seed.email && !seed.phone) {
    return { source: SOURCE, ok: true, latency_ms: Date.now() - start, records: [] };
  }

  const fetched = await timedFetchJson(buildPdlEnrichUrl(seed), {
    method: 'GET',
    headers: enrichmentHeaders({ 'X-Api-Key': apiKey }),
  }, 12000);

  if (!fetched.ok) {
    if (fetched.status === 404) {
      return { source: SOURCE, ok: true, latency_ms: Date.now() - start, records: [] };
    }
    return { source: SOURCE, ok: false, latency_ms: Date.now() - start, records: [], error: fetched.error };
  }

  const body = fetched.json as { data?: Record<string, unknown>; status?: number };
  const mapped = mapPdlPerson(body.data ?? (body as Record<string, unknown>));
  return {
    source: SOURCE,
    ok: true,
    latency_ms: Date.now() - start,
    records: mapped ? [mapped] : [],
  };
}
