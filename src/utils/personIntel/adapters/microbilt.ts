import type { IntelSeed, RawDataPoint, SourceResult } from '../types';
import { getKey, safeFetch, makeSourceResult } from './shared';

const SRC = 'MicroBilt';

export async function queryMicrobilt(db: D1Database, seed: IntelSeed): Promise<SourceResult> {
  const t0 = Date.now();
  const apiKey = await getKey(db, 'microbilt_api_key');
  if (!apiKey) return makeSourceResult(SRC, 2, 'not_configured', [], [], Date.now() - t0);

  try {
    const body: any = {};
    if (seed.name) { const parts = seed.name.trim().split(' '); body.first_name = parts[0]; body.last_name = parts.slice(1).join(' ') || undefined; }
    if (seed.dob) body.dob = seed.dob;
    if (seed.phone) body.phone = seed.phone;
    if (seed.email) body.email = seed.email;

    const json = await safeFetch('https://api.microbilt.com/v2/getpersonreport', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });

    const pts: RawDataPoint[] = [];
    for (const addr of json?.addresses ?? []) {
      if (addr.street) pts.push({ category: 'address', field: 'street', value: addr.street, source: SRC });
      if (addr.city) pts.push({ category: 'address', field: 'city', value: addr.city, source: SRC });
      if (addr.state) pts.push({ category: 'address', field: 'state', value: addr.state, source: SRC });
      if (addr.zip) pts.push({ category: 'address', field: 'zip', value: addr.zip, source: SRC });
    }
    for (const ph of json?.phones ?? []) {
      if (ph.number) pts.push({ category: 'phone', field: 'number', value: ph.number, source: SRC });
    }
    for (const em of json?.emails ?? []) {
      if (em.address) pts.push({ category: 'email', field: 'address', value: em.address, source: SRC });
    }
    if (json?.dob) pts.push({ category: 'legal', field: 'dob', value: json.dob, source: SRC });

    return makeSourceResult(SRC, 2, 'success', pts, [], Date.now() - t0);
  } catch (e: any) {
    return makeSourceResult(SRC, 2, 'error', [], [], Date.now() - t0, String(e?.message ?? e));
  }
}
