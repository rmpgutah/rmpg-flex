import type { EnrichmentSeed, SourceResult, EnrichedRecord } from '../types';
import type { Bindings } from '../../../types';

export async function search(seed: EnrichmentSeed, _env: Bindings): Promise<SourceResult> {
  const start = Date.now();
  const source = 'open_sanctions';
  try {
    const params = new URLSearchParams({
      q: `${seed.first_name} ${seed.last_name}`,
      schema: 'Person',
      limit: '10',
    });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`https://api.opensanctions.org/entities/?${params}`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    }).finally(() => clearTimeout(timer));

    if (!res.ok) return { source, ok: false, latency_ms: Date.now() - start, records: [], error: `HTTP ${res.status}` };

    const data = await res.json() as { results?: Array<{
      caption?: string;
      properties?: {
        name?: string[];
        birthDate?: string[];
        country?: string[];
        position?: string[];
        topics?: string[];
      };
    }> };

    const records: EnrichedRecord[] = (data.results ?? []).map(r => ({
      name: r.caption ?? r.properties?.name?.[0],
      dob: r.properties?.birthDate?.[0],
      addresses: [],
      phones: [],
      emails: [],
      watchlist_flags: r.properties?.topics ?? [],
      business_associations: r.properties?.position,
      source,
      raw: r,
    }));

    return { source, ok: true, latency_ms: Date.now() - start, records };
  } catch (err) {
    return { source, ok: false, latency_ms: Date.now() - start, records: [],
      error: err instanceof Error ? err.message : 'unknown' };
  }
}
