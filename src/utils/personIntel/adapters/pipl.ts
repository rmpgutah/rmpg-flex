import type { IntelSeed, RawDataPoint, IntelConnection, SourceResult } from '../types';
import { getKey, safeFetch, makeSourceResult } from './shared';

const SRC = 'Pipl';

export async function queryPipl(db: D1Database, seed: IntelSeed): Promise<SourceResult> {
  const t0 = Date.now();
  const apiKey = await getKey(db, 'pipl_api_key');
  if (!apiKey) return makeSourceResult(SRC, 2, 'not_configured', [], [], Date.now() - t0);

  try {
    const params = new URLSearchParams({ key: apiKey, pretty: 'false' });
    const person: any = {};
    if (seed.name) person.names = [{ full: seed.name }];
    if (seed.email) person.emails = [{ address: seed.email }];
    if (seed.phone) person.phones = [{ number: seed.phone }];
    if (seed.dob) person.dob = { display: seed.dob };

    const json = await safeFetch(`https://api.pipl.com/search/?${params}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ person }),
    });

    const pts: RawDataPoint[] = [];
    const conns: IntelConnection[] = [];
    const p = json?.person;
    for (const addr of p?.addresses ?? []) {
      if (addr.street) pts.push({ category: 'address', field: 'street', value: addr.display ?? addr.street, source: SRC });
      if (addr.city) pts.push({ category: 'address', field: 'city', value: addr.city, source: SRC });
      if (addr.state) pts.push({ category: 'address', field: 'state', value: addr.state, source: SRC });
    }
    for (const ph of p?.phones ?? []) {
      if (ph.display) pts.push({ category: 'phone', field: 'number', value: ph.display, source: SRC });
    }
    for (const em of p?.emails ?? []) {
      if (em.address) pts.push({ category: 'email', field: 'address', value: em.address, source: SRC });
    }
    for (const rel of p?.relationships ?? []) {
      const name = rel.names?.[0]?.display;
      if (name) conns.push({ fromSubject: seed.name ?? seed.email ?? '', relationship: 'associate', toSubject: name, confidence: 0.55, sources: [SRC] });
    }

    return makeSourceResult(SRC, 2, 'success', pts, conns, Date.now() - t0);
  } catch (e: any) {
    return makeSourceResult(SRC, 2, 'error', [], [], Date.now() - t0, String(e?.message ?? e));
  }
}
