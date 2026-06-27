// src/utils/personIntel/adapters/clearbit.ts
import type { IntelSeed, RawDataPoint, SourceResult } from '../types';
import { getKey, safeFetch, makeSourceResult } from './shared';

const SRC = 'Clearbit';

export async function queryClearbit(db: D1Database, seed: IntelSeed): Promise<SourceResult> {
  const t0 = Date.now();
  if (!seed.email) return makeSourceResult(SRC, 2, 'skipped', [], [], Date.now() - t0);
  const apiKey = await getKey(db, 'clearbit_api_key');
  if (!apiKey) return makeSourceResult(SRC, 2, 'not_configured', [], [], Date.now() - t0);

  try {
    const json = await safeFetch(`https://person.clearbit.com/v2/combined/find?email=${encodeURIComponent(seed.email)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const pts: RawDataPoint[] = [];
    const p = json?.person;
    if (p?.name?.fullName) pts.push({ category: 'legal', field: 'name', value: p.name.fullName, source: SRC });
    if (p?.employment?.name) pts.push({ category: 'business', field: 'employer', value: p.employment.name, source: SRC });
    if (p?.employment?.title) pts.push({ category: 'business', field: 'job_title', value: p.employment.title, source: SRC });
    for (const profile of p?.social?.profiles ?? []) {
      if (profile.url) pts.push({ category: 'social', field: 'profile', value: profile.url, source: SRC });
    }
    if (p?.geo?.city) pts.push({ category: 'address', field: 'city', value: p.geo.city, source: SRC });
    if (p?.geo?.state) pts.push({ category: 'address', field: 'state', value: p.geo.state, source: SRC });
    return makeSourceResult(SRC, 2, 'success', pts, [], Date.now() - t0);
  } catch (e: any) {
    return makeSourceResult(SRC, 2, 'error', [], [], Date.now() - t0, String(e?.message ?? e));
  }
}
