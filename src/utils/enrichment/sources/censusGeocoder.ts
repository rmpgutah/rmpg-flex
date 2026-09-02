import type { EnrichmentSeed, SourceResult, EnrichedRecord } from '../types';
import type { Bindings } from '../../../types';
import { enrichmentHeaders } from './http';

export async function search(seed: EnrichmentSeed, _env: Bindings): Promise<SourceResult> {
  const start = Date.now();
  const source = 'census_geocoder';

  if (!seed.address) {
    return { source, ok: true, latency_ms: Date.now() - start, records: [] };
  }

  try {
    const addressQuery = [seed.address, seed.city ?? '', seed.state ?? ''].join(' ').trim();
    const params = new URLSearchParams({
      address: addressQuery,
      benchmark: 'Public_AR_Current',
      format: 'json',
    });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(
      `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?${params}`,
      { signal: ctrl.signal, headers: enrichmentHeaders() },
    ).finally(() => clearTimeout(timer));

    if (!res.ok) return { source, ok: false, latency_ms: Date.now() - start, records: [], error: `HTTP ${res.status}` };

    const data = await res.json() as { result?: { addressMatches?: Array<{
      matchedAddress: string;
      coordinates: { x: number; y: number };
      addressComponents: {
        zip: string;
        streetName: string;
        city: string;
        state: string;
        fromAddress?: string;
        toAddress?: string;
        suffixType?: string;
      };
    }> } };

    const records: EnrichedRecord[] = (data.result?.addressMatches ?? []).map(match => {
      const c = match.addressComponents;
      const streetParts = [c.fromAddress, c.streetName, c.suffixType].filter(Boolean);
      return {
        addresses: [{
          street: streetParts.join(' ') || undefined,
          city: c.city || undefined,
          state: c.state || undefined,
          zip: c.zip || undefined,
          source,
        }],
        phones: [],
        emails: [],
        source,
        raw: { lat: match.coordinates.y, lng: match.coordinates.x, matchedAddress: match.matchedAddress },
      };
    });

    return { source, ok: true, latency_ms: Date.now() - start, records };
  } catch (err) {
    return { source, ok: false, latency_ms: Date.now() - start, records: [],
      error: err instanceof Error ? err.message : 'unknown' };
  }
}
