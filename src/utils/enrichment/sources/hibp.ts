import type { EnrichmentSeed, SourceResult, EnrichedRecord } from '../types';
import type { Bindings } from '../../../types';
import { enrichmentHeaders, resolveSecret, timedFetchJson } from './http';

const SOURCE = 'hibp';

export function hibpBreachedAccountUrl(email: string): string {
  return `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=true`;
}

export function mapHibpBreaches(email: string, json: unknown): EnrichedRecord[] {
  if (!Array.isArray(json) || json.length === 0) return [];
  const names = json
    .map(item => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object' && typeof (item as { Name?: string }).Name === 'string') {
        return (item as { Name: string }).Name;
      }
      return null;
    })
    .filter((n): n is string => Boolean(n));
  if (!names.length) return [];
  return [{
    emails: [email],
    addresses: [],
    phones: [],
    watchlist_flags: names.map(n => `hibp:${n}`),
    source: SOURCE,
    raw: json,
  }];
}

export async function search(seed: EnrichmentSeed, env: Bindings): Promise<SourceResult> {
  const start = Date.now();
  const email = seed.email?.trim();
  if (!email) return { source: SOURCE, ok: true, latency_ms: Date.now() - start, records: [] };

  const apiKey = await resolveSecret(env, 'HIBP_API_KEY', ['hibp_api_key', 'have_i_been_pwned_key']);
  if (!apiKey) return { source: SOURCE, ok: false, latency_ms: 0, records: [], error: 'not_configured' };

  const fetched = await timedFetchJson(hibpBreachedAccountUrl(email), {
    method: 'GET',
    headers: enrichmentHeaders({
      'hibp-api-key': apiKey,
    }),
  }, 12000);

  if (!fetched.ok) {
    if (fetched.status === 404) {
      return { source: SOURCE, ok: true, latency_ms: Date.now() - start, records: [] };
    }
    return { source: SOURCE, ok: false, latency_ms: Date.now() - start, records: [], error: fetched.error };
  }

  return {
    source: SOURCE,
    ok: true,
    latency_ms: Date.now() - start,
    records: mapHibpBreaches(email, fetched.json),
  };
}
