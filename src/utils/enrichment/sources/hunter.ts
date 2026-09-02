import type { EnrichmentSeed, SourceResult, EnrichedRecord } from '../types';
import type { Bindings } from '../../../types';
import { enrichmentHeaders, resolveSecret, splitPersonName, timedFetchJson } from './http';

const SOURCE = 'hunter';

export function domainFromEmail(email: string): string | undefined {
  const at = email.lastIndexOf('@');
  if (at < 1) return undefined;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain.includes('.') ? domain : undefined;
}

export function hunterVerifierUrl(email: string, apiKey: string): string {
  const params = new URLSearchParams({ email, api_key: apiKey });
  return `https://api.hunter.io/v2/email-verifier?${params}`;
}

export function hunterFinderUrl(
  first: string,
  last: string,
  domain: string,
  apiKey: string,
): string {
  const params = new URLSearchParams({
    first_name: first,
    last_name: last,
    domain,
    api_key: apiKey,
  });
  return `https://api.hunter.io/v2/email-finder?${params}`;
}

export async function search(seed: EnrichmentSeed, env: Bindings): Promise<SourceResult> {
  const start = Date.now();
  const apiKey = await resolveSecret(env, 'HUNTER_API_KEY', ['hunter_io_api_key', 'hunter_api_key']);
  if (!apiKey) return { source: SOURCE, ok: false, latency_ms: 0, records: [], error: 'not_configured' };

  const email = seed.email?.trim();
  const { first, last } = splitPersonName(seed.first_name, seed.last_name);
  const domain = email ? domainFromEmail(email) : undefined;

  try {
    if (email) {
      const fetched = await timedFetchJson(hunterVerifierUrl(email, apiKey), {
        method: 'GET',
        headers: enrichmentHeaders(),
      }, 10000);
      if (!fetched.ok) {
        return { source: SOURCE, ok: false, latency_ms: Date.now() - start, records: [], error: fetched.error };
      }
      const data = (fetched.json as { data?: { result?: string; score?: number } })?.data;
      const records: EnrichedRecord[] = [];
      if (data?.result === 'deliverable' || data?.result === 'risky') {
        records.push({
          name: [first, last].filter(Boolean).join(' ') || undefined,
          addresses: [],
          phones: [],
          emails: [email],
          source: SOURCE,
          raw: data,
        });
      }
      return { source: SOURCE, ok: true, latency_ms: Date.now() - start, records };
    }

    if (first && last && domain) {
      const fetched = await timedFetchJson(hunterFinderUrl(first, last, domain, apiKey), {
        method: 'GET',
        headers: enrichmentHeaders(),
      }, 10000);
      if (!fetched.ok) {
        return { source: SOURCE, ok: false, latency_ms: Date.now() - start, records: [], error: fetched.error };
      }
      const found = (fetched.json as { data?: { email?: string } })?.data?.email?.trim();
      const records: EnrichedRecord[] = found ? [{
        name: [first, last].filter(Boolean).join(' '),
        addresses: [],
        phones: [],
        emails: [found],
        source: SOURCE,
        raw: fetched.json,
      }] : [];
      return { source: SOURCE, ok: true, latency_ms: Date.now() - start, records };
    }

    return { source: SOURCE, ok: true, latency_ms: Date.now() - start, records: [] };
  } catch (err) {
    return { source: SOURCE, ok: false, latency_ms: Date.now() - start, records: [],
      error: err instanceof Error ? err.message : 'unknown' };
  }
}
