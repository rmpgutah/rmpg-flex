import type { EnrichmentSeed, SourceResult, EnrichedRecord } from '../types';
import type { Bindings } from '../../../types';
import { enrichmentHeaders, splitPersonName } from './http';

async function resolveApiKey(env: Bindings): Promise<string | null> {
  const fromEnv = env.OPENSANCTIONS_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  try {
    const row = await env.DB.prepare(
      `SELECT config_value FROM system_config
        WHERE config_key = 'opensanctions_api_key' AND is_active = 1 LIMIT 1`,
    ).first<{ config_value: string }>();
    return row?.config_value?.trim() || null;
  } catch {
    return null;
  }
}

export async function search(seed: EnrichmentSeed, env: Bindings): Promise<SourceResult> {
  const start = Date.now();
  const source = 'open_sanctions';
  const apiKey = await resolveApiKey(env);
  if (!apiKey) {
    return { source, ok: false, latency_ms: 0, records: [], error: 'not_configured' };
  }

  try {
    const { first, last } = splitPersonName(seed.first_name, seed.last_name);
    const params = new URLSearchParams({
      q: [first, last].filter(Boolean).join(' '),
      schema: 'Person',
      limit: '10',
    });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(`https://api.opensanctions.org/search/default?${params}`, {
      signal: ctrl.signal,
      headers: enrichmentHeaders({ Authorization: `ApiKey ${apiKey}` }),
    }).finally(() => clearTimeout(timer));

    if (!res.ok) return { source, ok: false, latency_ms: Date.now() - start, records: [], error: `HTTP ${res.status}` };

    const data = await res.json() as { results?: Array<{
      caption?: string;
      properties?: {
        name?: string[];
        birthDate?: string[];
        country?: string[];
        position?: string[];
        topics?: string[];
      };
    }> };

    const records: EnrichedRecord[] = (data.results ?? []).map(r => ({
      name: r.caption ?? r.properties?.name?.[0],
      dob: r.properties?.birthDate?.[0],
      addresses: [],
      phones: [],
      emails: [],
      watchlist_flags: r.properties?.topics ?? [],
      business_associations: r.properties?.position,
      source,
      raw: r,
    }));

    return { source, ok: true, latency_ms: Date.now() - start, records };
  } catch (err) {
    return { source, ok: false, latency_ms: Date.now() - start, records: [],
      error: err instanceof Error ? err.message : 'unknown' };
  }
}
