import type { EnrichmentSeed, SourceResult, EnrichedRecord } from '../types';
import type { Bindings } from '../../../types';

export async function search(seed: EnrichmentSeed, env: Bindings): Promise<SourceResult> {
  const start = Date.now();
  const source = 'ofac_sdn';
  try {
    // D1 LIKE cap is 50 chars; %pattern% uses 2, leaving 48 for the value.
    const nameLike = `%${seed.last_name.toLowerCase().slice(0, 48)}%`;
    // Search both name and aliases_json
    const rows = await env.DB.prepare(
      `SELECT sdn_name, sdn_type, program, aliases_json, dob, nationality, remarks
       FROM ofac_sdn
       WHERE lower(sdn_name) LIKE ? AND sdn_type = 'individual'
       LIMIT 20`,
    ).bind(nameLike).all<{
      sdn_name: string; sdn_type: string; program: string | null;
      aliases_json: string | null; dob: string | null;
      nationality: string | null; remarks: string | null;
    }>();

    const records: EnrichedRecord[] = (rows.results ?? []).map(r => ({
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
