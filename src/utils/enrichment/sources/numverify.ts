import type { EnrichmentSeed, SourceResult, EnrichedRecord } from '../types';
import type { Bindings } from '../../../types';

export async function search(seed: EnrichmentSeed, env: Bindings): Promise<SourceResult> {
  const start = Date.now();
  const source = 'numverify';
  const apiKey = (env as any).NUMVERIFY_API_KEY as string | undefined;
  if (!apiKey) return { source, ok: false, latency_ms: 0, records: [], error: 'not_configured' };
  if (!seed.phone) return { source, ok: true, latency_ms: 0, records: [], error: 'no_phone_seed' };

  const digitsOnly = seed.phone.replace(/\D/g, '');
  try {
    const params = new URLSearchParams({ access_key: apiKey, number: digitsOnly, country_code: 'US' });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`https://apilayer.net/api/validate?${params}`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    }).finally(() => clearTimeout(timer));

    if (!res.ok) return { source, ok: false, latency_ms: Date.now() - start, records: [], error: `HTTP ${res.status}` };

    const data = await res.json() as {
      valid?: boolean; number?: string; carrier?: string; line_type?: string;
    };

    if (!data.valid) return { source, ok: true, latency_ms: Date.now() - start, records: [] };

    const records: EnrichedRecord[] = [{
      phones: [data.number ?? digitsOnly],
      addresses: [],
      emails: [],
      source,
      raw: data,
    }];

    return { source, ok: true, latency_ms: Date.now() - start, records };
  } catch (err) {
    return { source, ok: false, latency_ms: Date.now() - start, records: [],
      error: err instanceof Error ? err.message : 'unknown' };
  }
}
