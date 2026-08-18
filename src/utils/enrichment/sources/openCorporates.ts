import type { EnrichmentSeed, SourceResult, EnrichedRecord } from '../types';
import type { Bindings } from '../../../types';

export async function search(seed: EnrichmentSeed, env: Bindings): Promise<SourceResult> {
  const start = Date.now();
  const source = 'open_corporates';
  const apiKey = (env as any).OPENCORPORATES_API_KEY as string | undefined;
  if (!apiKey) return { source, ok: false, latency_ms: 0, records: [], error: 'not_configured' };

  try {
    const params = new URLSearchParams({
      q: `${seed.first_name} ${seed.last_name}`,
      api_token: apiKey,
      per_page: '10',
    });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`https://api.opencorporates.com/v0.4/officers/search?${params}`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    }).finally(() => clearTimeout(timer));

    if (!res.ok) return { source, ok: false, latency_ms: Date.now() - start, records: [], error: `HTTP ${res.status}` };

    const data = await res.json() as { results?: { officers?: Array<{
      officer: {
        name?: string;
        date_of_birth?: string;
        nationality?: string;
        company?: { name?: string; registered_address?: { street_address?: string; locality?: string; region?: string; postal_code?: string; } };
      }
    }> } };

    const records: EnrichedRecord[] = (data.results?.officers ?? []).map(({ officer: o }) => ({
      name: o.name,
      dob: o.date_of_birth ?? undefined,
      addresses: o.company?.registered_address ? [{
        street: o.company.registered_address.street_address,
        city:   o.company.registered_address.locality,
        state:  o.company.registered_address.region,
        zip:    o.company.registered_address.postal_code,
        type: 'registered_agent',
        source,
      }] : [],
      phones: [],
      emails: [],
      business_associations: o.company?.name ? [o.company.name] : [],
      source,
      raw: o,
    }));

    return { source, ok: true, latency_ms: Date.now() - start, records };
  } catch (err) {
    return { source, ok: false, latency_ms: Date.now() - start, records: [],
      error: err instanceof Error ? err.message : 'unknown' };
  }
}
