import type { EnrichmentSeed, SourceResult, EnrichedRecord } from '../types';
import type { Bindings } from '../../../types';
import { lookupParcelsWithFallback, type LookupEnv } from '../../sl-assessor/lookup';

export async function search(seed: EnrichmentSeed, env: Bindings): Promise<SourceResult> {
  const start = Date.now();
  const source = 'sl_assessor';
  // Assessor lookup requires an address seed; skip gracefully when absent.
  if (!seed.address && !seed.city) {
    return { source, ok: true, latency_ms: Date.now() - start, records: [],
      error: 'no_address_seed' };
  }
  try {
    const addressQuery = [seed.address, seed.city, seed.state].filter(Boolean).join(' ');
    // Call the utility directly instead of looping back through HTTP (which
    // would require a valid JWT — "Bearer internal" is not a valid JWT and
    // always fails jose.jwtVerify() with 401).
    const result = await lookupParcelsWithFallback(env as unknown as LookupEnv, addressQuery);

    const records: EnrichedRecord[] = result.parcels.map(p => ({
      name: p.owner_of_record ?? undefined,
      addresses: p.situs_address ? [{
        street: p.situs_address,
        city: undefined,
        state: 'UT',
        zip: undefined,
        source,
      }] : [],
      phones: [], emails: [], source, raw: p,
    }));

    return { source, ok: true, latency_ms: Date.now() - start, records };
  } catch (err) {
    return { source, ok: false, latency_ms: Date.now() - start, records: [],
      error: err instanceof Error ? err.message : 'unknown' };
  }
}
