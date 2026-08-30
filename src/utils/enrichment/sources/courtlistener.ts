import type { EnrichmentSeed, SourceResult, EnrichedRecord } from '../types';
import type { Bindings } from '../../../types';
import { splitPersonName } from './http';
import { lookupCourtRecords, type CourtRecord } from '../../courtRecordsLookup';

const SOURCE = 'courtlistener';

export function mapCourtRecords(name: string, records: CourtRecord[]): EnrichedRecord[] {
  return records.slice(0, 15).map(r => ({
    name,
    addresses: [],
    phones: [],
    emails: [],
    business_associations: [r.case_name].filter(Boolean),
    watchlist_flags: r.is_criminal ? ['federal_criminal_docket'] : ['court_record'],
    source: SOURCE,
    raw: r,
  }));
}

export async function search(seed: EnrichmentSeed, env: Bindings): Promise<SourceResult> {
  const start = Date.now();
  const { first, last } = splitPersonName(seed.first_name, seed.last_name);
  if (!last) return { source: SOURCE, ok: true, latency_ms: Date.now() - start, records: [] };

  try {
    const result = await lookupCourtRecords(env.DB, last, first);
    if (result.error) {
      return { source: SOURCE, ok: false, latency_ms: Date.now() - start, records: [], error: result.error };
    }
    const displayName = [first, last].filter(Boolean).join(' ');
    return {
      source: SOURCE,
      ok: true,
      latency_ms: Date.now() - start,
      records: mapCourtRecords(displayName, result.records),
    };
  } catch (err) {
    return { source: SOURCE, ok: false, latency_ms: Date.now() - start, records: [],
      error: err instanceof Error ? err.message : 'unknown' };
  }
}
