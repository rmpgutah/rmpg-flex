import type { EnrichmentSeed, SourceResult, EnrichedRecord } from '../types';
import type { Bindings } from '../../../types';

export async function search(seed: EnrichmentSeed, env: Bindings): Promise<SourceResult> {
  const start = Date.now();
  const source = 'sl_assessor';
  // Assessor lookup requires an address seed; skip gracefully when absent.
  if (!seed.address && !seed.city) {
    return { source, ok: true, latency_ms: 0, records: [],
      error: 'no_address_seed' };
  }
  try {
    const addressQuery = [seed.address, seed.city, seed.state].filter(Boolean).join(' ');
    const params = new URLSearchParams({ address: addressQuery });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    // Route is already in the Worker; call via internal fetch to avoid N+1 auth overhead
    const base = (env as Record<string, unknown>)['SELF_URL'] as string | undefined ?? 'https://api.rmpgutah.us';
    const res = await fetch(`${base}/api/assessor/parcels?${params}`, {
      signal: ctrl.signal,
      headers: { Authorization: `Bearer internal` },
    }).finally(() => clearTimeout(timer));

    if (!res.ok) return { source, ok: false, latency_ms: Date.now() - start, records: [], error: `HTTP ${res.status}` };

    const parcels = await res.json() as Array<{
      owner_name?: string; site_address?: string; city?: string; state?: string; zip?: string;
    }>;

    const records: EnrichedRecord[] = parcels.map(p => ({
      name: p.owner_name,
      addresses: p.site_address ? [{
        street: p.site_address, city: p.city, state: p.state, zip: p.zip, source,
      }] : [],
      phones: [], emails: [], source, raw: p,
    }));

    return { source, ok: true, latency_ms: Date.now() - start, records };
  } catch (err) {
    return { source, ok: false, latency_ms: Date.now() - start, records: [],
      error: err instanceof Error ? err.message : 'unknown' };
  }
}
