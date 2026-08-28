import type { EnrichmentSeed, SourceResult, EnrichedRecord } from '../types';
import type { Bindings } from '../../../types';
import { nsopwSearch, resolveClientConfig } from '../../nsopw/client';
import { parseSearchResponse } from '../../nsopw/parse';

export async function search(seed: EnrichmentSeed, env: Bindings): Promise<SourceResult> {
  const start = Date.now();
  const source = 'nsopw';
  const config = resolveClientConfig(env);
  if (!config.enabled) {
    return { source, ok: false, latency_ms: 0, records: [], error: 'not_configured' };
  }

  try {
    const { response } = await nsopwSearch(env, {
      forename: seed.first_name,
      surname: seed.last_name,
      city: seed.city,
      county: undefined,
      zip: undefined,
    }, config);

    const parsed = parseSearchResponse(response);
    const records: EnrichedRecord[] = parsed.offenders.map(o => ({
      name: [o.firstName, o.middleName, o.lastName].filter(Boolean).join(' '),
      dob: o.dateOfBirth ?? undefined,
      addresses: o.locations.length > 0
        ? o.locations.map(loc => ({
            street: loc.streetAddress ?? undefined,
            city: loc.city ?? undefined,
            state: loc.state ?? undefined,
            zip: loc.zipCode ?? undefined,
            type: loc.type?.toLowerCase(),
            source,
          }))
        : (o.address ? [{
            street: o.address,
            city: o.city ?? undefined,
            state: o.state ?? undefined,
            zip: o.zip ?? undefined,
            source,
          }] : []),
      phones: [],
      emails: [],
      watchlist_flags: ['sex_offender_registry'],
      source,
      raw: o.raw,
    }));

    return { source, ok: true, latency_ms: Date.now() - start, records };
  } catch (err) {
    return { source, ok: false, latency_ms: Date.now() - start, records: [],
      error: err instanceof Error ? err.message : 'unknown' };
  }
}
