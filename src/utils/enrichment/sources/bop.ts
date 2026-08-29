import type { EnrichmentSeed, SourceResult, EnrichedRecord } from '../types';
import type { Bindings } from '../../../types';
import { enrichmentHeaders, splitPersonName } from './http';

interface BopInmate {
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
}

interface BopResponse {
  InmateLocator?: BopInmate[];
  Captcha?: boolean;
  FormToken?: string;
  Messages?: Record<string, unknown>;
  Validations?: unknown[];
}

export async function search(seed: EnrichmentSeed, _env: Bindings): Promise<SourceResult> {
  const start = Date.now();
  const source = 'bop_inmates';
  const { first, last } = splitPersonName(seed.first_name, seed.last_name);
  if (!first && !last) {
    return { source, ok: true, latency_ms: Date.now() - start, records: [] };
  }
  try {
    // `todo=query` is required — without it the endpoint only returns a FormToken
    // and never runs the inmate search (silent empty results).
    const body = new URLSearchParams({
      todo: 'query',
      nameFirst: first,
      nameMiddle: '',
      nameLast: last,
      age: '',
      race: 'U',
      sex: 'U',
      output: 'json',
    });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(
      'https://www.bop.gov/PublicInfo/execute/inmateloc',
      {
        method: 'POST',
        signal: ctrl.signal,
        headers: enrichmentHeaders({
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest',
          Referer: 'https://www.bop.gov/inmateloc/',
          Origin: 'https://www.bop.gov',
        }),
        body: body.toString(),
      },
    ).finally(() => clearTimeout(timer));

    if (!res.ok) return { source, ok: false, latency_ms: Date.now() - start, records: [], error: `HTTP ${res.status}` };

    const data = await res.json() as BopResponse;

    // Captcha challenge or token-only response = search did not run.
    if (data.Captcha) {
      return { source, ok: false, latency_ms: Date.now() - start, records: [], error: 'captcha_required' };
    }
    if (!Array.isArray(data.InmateLocator)) {
      return {
        source, ok: false, latency_ms: Date.now() - start, records: [],
        error: 'no_search_result (missing InmateLocator — check todo=query)',
      };
    }

    const records: EnrichedRecord[] = data.InmateLocator.map(inmate => {
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
