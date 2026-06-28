// src/utils/personIntel/adapters/numverify.ts
import type { IntelSeed, RawDataPoint, SourceResult } from '../types';
import { getKey, safeFetch, makeSourceResult } from './shared';

const SRC = 'NumVerify';

export async function queryNumverify(db: D1Database, seed: IntelSeed): Promise<SourceResult> {
  const t0 = Date.now();
  if (!seed.phone) return makeSourceResult(SRC, 2, 'skipped', [], [], Date.now() - t0);
  const apiKey = await getKey(db, 'numverify_api_key');
  if (!apiKey) return makeSourceResult(SRC, 2, 'not_configured', [], [], Date.now() - t0);

  try {
    const json = await safeFetch(`http://apilayer.net/api/validate?access_key=${apiKey}&number=${encodeURIComponent(seed.phone)}&format=1`, { method: 'GET' });
    const pts: RawDataPoint[] = [];
    if (json?.valid) {
      if (json.carrier) pts.push({ category: 'phone', field: 'carrier', value: json.carrier, source: SRC });
      if (json.line_type) pts.push({ category: 'phone', field: 'line_type', value: json.line_type, source: SRC });
      if (json.location) pts.push({ category: 'address', field: 'region', value: json.location, source: SRC });
    }
    return makeSourceResult(SRC, 2, json?.valid ? 'success' : 'error', pts, [], Date.now() - t0, json?.valid ? undefined : 'Invalid number');
  } catch (e: any) {
    return makeSourceResult(SRC, 2, 'error', [], [], Date.now() - t0, String(e?.message ?? e));
  }
}
