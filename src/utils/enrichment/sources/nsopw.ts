import type { EnrichmentSeed, SourceResult, EnrichedRecord } from '../types';
import type { Bindings } from '../../../types';

export async function search(seed: EnrichmentSeed, _env: Bindings): Promise<SourceResult> {
  const start = Date.now();
  const source = 'nsopw';
  try {
    const params = new URLSearchParams({
      firstName: seed.first_name,
      lastName:  seed.last_name,
      ...(seed.state ? { stateFilter: seed.state } : {}),
    });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(
      `https://www.nsopw.gov/api/Search/SearchPublicSite?${params}`,
      { signal: ctrl.signal, headers: { Accept: 'application/json' } },
    ).finally(() => clearTimeout(timer));

    if (!res.ok) return { source, ok: false, latency_ms: Date.now() - start, records: [], error: `HTTP ${res.status}` };

    const data = await res.json() as { Registrants?: Array<{
      FirstName?: string; LastName?: string; DateOfBirth?: string;
      ResidenceAddress?: { City?: string; State?: string; Zip?: string; };
    }> };

    const records: EnrichedRecord[] = (data.Registrants ?? []).map(r => ({
      name: [r.FirstName, r.LastName].filter(Boolean).join(' '),
      dob: r.DateOfBirth ?? undefined,
      addresses: r.ResidenceAddress ? [{
        city: r.ResidenceAddress.City,
        state: r.ResidenceAddress.State,
        zip: r.ResidenceAddress.Zip,
        source,
      }] : [],
      phones: [], emails: [],
      watchlist_flags: ['sex_offender_registry'],
      source,
      raw: r,
    }));

    return { source, ok: true, latency_ms: Date.now() - start, records };
  } catch (err) {
    return { source, ok: false, latency_ms: Date.now() - start, records: [],
      error: err instanceof Error ? err.message : 'unknown' };
  }
}
