import type { EnrichmentSeed, SourceResult, EnrichedRecord } from '../types';
import type { Bindings } from '../../../types';
import { splitPersonName } from './http';

export async function search(seed: EnrichmentSeed, _env: Bindings): Promise<SourceResult> {
  const start = Date.now();
  const source = 'bop_inmates';
  const { first, last } = splitPersonName(seed.first_name, seed.last_name);
  if (!first && !last) {
    return { source, ok: true, latency_ms: Date.now() - start, records: [] };
  }
  try {
    const body = new URLSearchParams({
      nameFirst: first,
      nameMiddle: '',
      nameLast: last,
      age: '',
      race: 'U',
      sex: 'U',
      output: 'json',
    });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(
      'https://www.bop.gov/PublicInfo/execute/inmateloc',
      {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': 'https://www.bop.gov/inmateloc/',
          'Origin': 'https://www.bop.gov',
          'Accept': 'application/json',
          'User-Agent': 'RMPG-Flex/1.0 (Cloudflare Workers; sworn LE; enrichment)',
        },
        body: body.toString(),
      },
    ).finally(() => clearTimeout(timer));

    if (!res.ok) return { source, ok: false, latency_ms: Date.now() - start, records: [], error: `HTTP ${res.status}` };

    const data = await res.json() as { InmateLocator?: Array<{
      inmate_num: string;
      firstName: string;
      middleName?: string;
      lastName: string;
      age: number;
      race: string;
      sex: string;
      releaseDate?: string;
      releaseDateType?: string;
      facCode?: string;
      facName?: string;
    }> };

    const records: EnrichedRecord[] = (data.InmateLocator ?? []).map(inmate => {
      const nameParts = [inmate.firstName, inmate.middleName, inmate.lastName].filter(Boolean);
      const released = inmate.releaseDateType?.toUpperCase().includes('RELEASED') ?? false;
      const flags = released ? [] : ['federal_inmate'];

      const addresses = inmate.facName
        ? [{ type: 'facility', source, city: inmate.facCode ?? undefined, street: inmate.facName }]
        : [];

      return {
        name: nameParts.join(' '),
        addresses,
        phones: [],
        emails: [],
        watchlist_flags: flags,
        source,
        raw: inmate,
      };
    });

    return { source, ok: true, latency_ms: Date.now() - start, records };
  } catch (err) {
    return { source, ok: false, latency_ms: Date.now() - start, records: [],
      error: err instanceof Error ? err.message : 'unknown' };
  }
}
