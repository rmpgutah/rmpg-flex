import type { EnrichmentSeed, SourceResult, EnrichedRecord } from '../types';
import type { Bindings } from '../../../types';

/** Cloudflare Workers often send an empty UA; several LE APIs (FBI, etc.)
 *  treat that as a bot and return a Cloudflare challenge page (HTTP 403). */
export const WORKER_UA = 'RMPG-Flex/1.0 (Cloudflare Workers; sworn LE; enrichment)';

export function enrichmentHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    Accept: 'application/json',
    'User-Agent': WORKER_UA,
    ...extra,
  };
}

/** Env binding first, then D1 system_config keys (first non-empty wins). */
export async function resolveSecret(
  env: Bindings,
  envKey: string,
  configKeys: string[],
): Promise<string | null> {
  const fromEnv = (env[envKey as keyof Bindings] as string | undefined)?.trim();
  if (fromEnv) return fromEnv;
  for (const key of configKeys) {
    try {
      const row = await env.DB.prepare(
        `SELECT config_value FROM system_config
          WHERE config_key = ? AND is_active = 1 LIMIT 1`,
      ).bind(key).first<{ config_value: string }>();
      const value = row?.config_value?.trim();
      if (value) return value;
    } catch {
      /* table may be missing in tests */
    }
  }
  return null;
}

export async function timedFetchJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ ok: true; status: number; json: unknown } | { ok: false; status: number; error: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const snippet = body.replace(/\s+/g, ' ').slice(0, 120);
      return { ok: false, status: res.status, error: `HTTP ${res.status}${snippet ? `: ${snippet}` : ''}` };
    }
    return { ok: true, status: res.status, json: await res.json() };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : 'unknown' };
  } finally {
    clearTimeout(timer);
  }
}

/** Split a full name into first/last for APIs that only accept two fields.
 *  "Karl Allen Turley" → first "Karl", last "Turley" (middle dropped). */
export function splitPersonName(first: string, last: string, q?: string): { first: string; last: string } {
  const f = first.trim();
  const l = last.trim();
  // Always normalize multi-token names to first-token / last-token so
  // "Karl Allen"+"Turley", "Karl"+"Allen Turley", and "Karl Allen Turley"
  // all resolve the same way for registry APIs.
  const raw = [f, l].filter(Boolean).join(' ').trim() || (q ?? '').trim();
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '', last: '' };
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts[0], last: parts[parts.length - 1] };
}
