import type { IntelSeed, RawDataPoint, SourceResult } from '../types';
import { getKey, safeFetch, makeSourceResult } from './shared';

const SRC = 'Spokeo';

export async function querySpokeo(db: D1Database, seed: IntelSeed): Promise<SourceResult> {
  const t0 = Date.now();
  const apiKey = await getKey(db, 'spokeo_api_key');
  if (!apiKey) return makeSourceResult(SRC, 2, 'not_configured', [], [], Date.now() - t0);

  try {
    const params = new URLSearchParams({ api_key: apiKey });
    if (seed.email) params.set('email', seed.email);
    else if (seed.phone) params.set('phone', seed.phone);
    else if (seed.name) params.set('name', seed.name);
    else return makeSourceResult(SRC, 2, 'skipped', [], [], Date.now() - t0);

    const json = await safeFetch(`https://api.spokeo.com/v2/people/search?${params}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    const pts: RawDataPoint[] = [];
    for (const person of json?.results ?? []) {
      for (const addr of person?.addresses ?? []) {
        if (addr.street) pts.push({ category: 'address', field: 'street', value: addr.street, source: SRC });
        if (addr.city) pts.push({ category: 'address', field: 'city', value: addr.city, source: SRC });
        if (addr.state) pts.push({ category: 'address', field: 'state', value: addr.state, source: SRC });
      }
      for (const ph of person?.phones ?? []) {
        if (ph.number) pts.push({ category: 'phone', field: 'number', value: ph.number, source: SRC });
      }
    }

    return makeSourceResult(SRC, 2, 'success', pts, [], Date.now() - t0);
  } catch (e: any) {
    return makeSourceResult(SRC, 2, 'error', [], [], Date.now() - t0, String(e?.message ?? e));
  }
}
