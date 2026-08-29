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
