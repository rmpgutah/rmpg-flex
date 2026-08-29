import type { EnrichmentSeed, SourceResult, EnrichedRecord } from '../types';
import type { Bindings } from '../../../types';
import { splitPersonName } from './http';

export async function search(seed: EnrichmentSeed, env: Bindings): Promise<SourceResult> {
  const start = Date.now();
  const source = 'ofac_sdn';
  const { first, last } = splitPersonName(seed.first_name, seed.last_name);
  if (!last) {
    return { source, ok: true, latency_ms: Date.now() - start, records: [] };
  }

  try {
    // D1 LIKE cap is 50 chars; %pattern% uses 2, leaving 48 for the value.
    const lastLike = `%${last.toLowerCase().slice(0, 48)}%`;
    const rows = await env.DB.prepare(
      `SELECT sdn_name, sdn_type, program, aliases_json, dob, nationality, remarks
       FROM ofac_sdn
       WHERE sdn_type = 'individual'
         AND (lower(sdn_name) LIKE ? OR lower(COALESCE(aliases_json, '')) LIKE ?)
       LIMIT 50`,
    ).bind(lastLike, lastLike).all<{
      sdn_name: string; sdn_type: string; program: string | null;
      aliases_json: string | null; dob: string | null;
      nationality: string | null; remarks: string | null;
    }>();

    const firstLower = first.toLowerCase();
    const lastLower = last.toLowerCase();
    const matched = (rows.results ?? []).filter(r => {
      const haystacks = [r.sdn_name, r.aliases_json ?? ''].map(s => s.toLowerCase());
      const lastHit = haystacks.some(h => h.includes(lastLower));
      if (!lastHit) return false;
      if (!first) return true;
      return haystacks.some(h => h.includes(firstLower));
    }).slice(0, 20);

    const records: EnrichedRecord[] = matched.map(r => ({
      name: r.sdn_name,
      dob: r.dob ?? undefined,
      addresses: [],
      phones: [],
      emails: [],
      watchlist_flags: ['ofac_sdn'],
      business_associations: r.program ? [`OFAC Program: ${r.program}`] : [],
      source,
      raw: r,
    }));

    return { source, ok: true, latency_ms: Date.now() - start, records };
  } catch (err) {
    return { source, ok: false, latency_ms: Date.now() - start, records: [],
      error: err instanceof Error ? err.message : 'unknown' };
  }
}
