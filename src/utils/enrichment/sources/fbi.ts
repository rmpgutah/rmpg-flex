import type { EnrichmentSeed, SourceResult, EnrichedRecord } from '../types';
import type { Bindings } from '../../../types';

export async function search(seed: EnrichmentSeed, _env: Bindings): Promise<SourceResult> {
  const start = Date.now();
  const source = 'fbi_wanted';
  try {
    const params = new URLSearchParams({
      title: seed.last_name,
      pageSize: '20',
    });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(
      `https://api.fbi.gov/wanted/v1/list?${params}`,
      { signal: ctrl.signal, headers: { Accept: 'application/json' } },
    ).finally(() => clearTimeout(timer));

    if (!res.ok) return { source, ok: false, latency_ms: Date.now() - start, records: [], error: `HTTP ${res.status}` };

    const data = await res.json() as { items?: Array<{
      title?: string;
      description?: string;
      dates_of_birth_used?: string[];
      aliases?: string[];
      status?: string;
      images?: Array<{ large: string }>;
    }> };

    const records: EnrichedRecord[] = (data.items ?? []).map(item => ({
      name: item.title ?? undefined,
      dob: item.dates_of_birth_used?.[0] ?? undefined,
      addresses: [],
      phones: [],
      emails: [],
      watchlist_flags: ['fbi_wanted'],
      source,
      raw: { status: item.status, aliases: item.aliases, description: item.description },
    }));

    return { source, ok: true, latency_ms: Date.now() - start, records };
  } catch (err) {
    return { source, ok: false, latency_ms: Date.now() - start, records: [],
      error: err instanceof Error ? err.message : 'unknown' };
  }
}
