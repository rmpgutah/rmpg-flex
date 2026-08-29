import type { EnrichmentSeed, SourceResult, EnrichedRecord } from '../types';
import type { Bindings } from '../../../types';
import { enrichmentHeaders } from './http';

async function resolveApiKey(env: Bindings): Promise<string | null> {
  const fromEnv = (env.NUMVERIFY_API_KEY as string | undefined)?.trim();
  if (fromEnv) return fromEnv;
  try {
    const row = await env.DB.prepare(
      `SELECT config_value FROM system_config
        WHERE config_key = 'numverify_api_key' AND is_active = 1 LIMIT 1`,
    ).first<{ config_value: string }>();
    return row?.config_value?.trim() || null;
  } catch {
    return null;
  }
}

export async function search(seed: EnrichmentSeed, env: Bindings): Promise<SourceResult> {
  const start = Date.now();
  const source = 'numverify';
  const apiKey = await resolveApiKey(env);
  if (!apiKey) return { source, ok: false, latency_ms: 0, records: [], error: 'not_configured' };
  if (!seed.phone) return { source, ok: true, latency_ms: 0, records: [] };

  const digitsOnly = seed.phone.replace(/\D/g, '');
  if (digitsOnly.length < 10) return { source, ok: true, latency_ms: Date.now() - start, records: [] };

  try {
    const params = new URLSearchParams({ access_key: apiKey, number: digitsOnly, country_code: 'US' });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`https://apilayer.net/api/validate?${params}`, {
      signal: ctrl.signal,
      headers: enrichmentHeaders(),
    }).finally(() => clearTimeout(timer));

    if (!res.ok) return { source, ok: false, latency_ms: Date.now() - start, records: [], error: `HTTP ${res.status}` };

    const data = await res.json() as {
      valid?: boolean; number?: string; carrier?: string; line_type?: string; success?: boolean; error?: { info?: string };
    };

    if (data.success === false || data.error) {
      return {
        source, ok: false, latency_ms: Date.now() - start, records: [],
        error: data.error?.info?.slice(0, 120) || 'numverify_error',
      };
    }

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
