import type { EnrichmentSeed, SourceResult, EnrichedRecord } from '../types';
import type { Bindings } from '../../../types';
import { enrichmentHeaders, resolveSecret, splitPersonName, timedFetchJson } from './http';

const SOURCE = 'apollo';

export function apolloSearchBody(seed: EnrichmentSeed): Record<string, unknown> {
  const { first, last } = splitPersonName(seed.first_name, seed.last_name);
  const body: Record<string, unknown> = {
    page: 1,
    per_page: 10,
  };
  const name = [first, last].filter(Boolean).join(' ').trim();
  if (name) body.q_person_name = name;
  if (seed.city || seed.state) {
    body.person_locations = [[seed.city, seed.state].filter(Boolean).join(', ')];
  }
  return body;
}

export function mapApolloPeople(people: unknown[]): EnrichedRecord[] {
  const out: EnrichedRecord[] = [];
  for (const item of people) {
    if (!item || typeof item !== 'object') continue;
    const p = item as Record<string, unknown>;
    const name = (typeof p.name === 'string' && p.name.trim())
      || [p.first_name, p.last_name].filter(v => typeof v === 'string').join(' ').trim()
      || undefined;
    const org = p.organization && typeof p.organization === 'object'
      ? (p.organization as { name?: string }).name
      : typeof p.organization_name === 'string' ? p.organization_name : undefined;
    const title = typeof p.title === 'string' ? p.title : undefined;
    const city = typeof p.city === 'string' ? p.city : undefined;
    const state = typeof p.state === 'string' ? p.state : undefined;
    if (!name) continue;
    out.push({
      name,
      addresses: (city || state) ? [{ city, state, source: SOURCE }] : [],
      phones: [],
      emails: [],
      business_associations: [title, org].filter((v): v is string => Boolean(v)),
      source: SOURCE,
      raw: p,
    });
  }
  return out;
}

export async function search(seed: EnrichmentSeed, env: Bindings): Promise<SourceResult> {
  const start = Date.now();
  const apiKey = await resolveSecret(env, 'APOLLO_API_KEY', ['apollo_api_key']);
  if (!apiKey) return { source: SOURCE, ok: false, latency_ms: 0, records: [], error: 'not_configured' };

  const { first, last } = splitPersonName(seed.first_name, seed.last_name);
  if (!first && !last) {
    return { source: SOURCE, ok: true, latency_ms: Date.now() - start, records: [] };
  }

  const fetched = await timedFetchJson('https://api.apollo.io/api/v1/mixed_people/api_search', {
    method: 'POST',
    headers: enrichmentHeaders({
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    }),
    body: JSON.stringify(apolloSearchBody(seed)),
  }, 12000);

  if (!fetched.ok) {
    return { source: SOURCE, ok: false, latency_ms: Date.now() - start, records: [], error: fetched.error };
  }

  const people = (fetched.json as { people?: unknown[] })?.people ?? [];
  return {
    source: SOURCE,
    ok: true,
    latency_ms: Date.now() - start,
    records: mapApolloPeople(people),
  };
}
