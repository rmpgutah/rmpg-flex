import type { EnrichmentSeed, SourceResult, EnrichedRecord } from '../types';
import type { Bindings } from '../../../types';

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function search(seed: EnrichmentSeed, env: Bindings): Promise<SourceResult> {
  const start = Date.now();
  const source = 'usps';
  const userId = (env as any).USPS_USER_ID as string | undefined;
  if (!userId) return { source, ok: false, latency_ms: 0, records: [], error: 'not_configured' };
  if (!seed.address) return { source, ok: true, latency_ms: 0, records: [], error: 'no_address_seed' };

  try {
    const xml = `<AddressValidateRequest USERID="${escXml(userId)}"><Revision>1</Revision><Address ID="0"><Address1></Address1><Address2>${escXml(seed.address)}</Address2><City>${escXml(seed.city ?? '')}</City><State>${escXml(seed.state ?? '')}</State><Zip5></Zip5><Zip4></Zip4></Address></AddressValidateRequest>`;
    const params = new URLSearchParams({ API: 'Verify', XML: xml });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`https://secure.shippingapis.com/ShippingAPI.dll?${params}`, {
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));

    if (!res.ok) return { source, ok: false, latency_ms: Date.now() - start, records: [], error: `HTTP ${res.status}` };

    const text = await res.text();
    // Parse XML fields: Address2 = street, City, State, Zip5
    const street = text.match(/<Address2>([^<]+)<\/Address2>/)?.[1];
    const city   = text.match(/<City>([^<]+)<\/City>/)?.[1];
    const state  = text.match(/<State>([^<]+)<\/State>/)?.[1];
    const zip    = text.match(/<Zip5>([^<]+)<\/Zip5>/)?.[1];

    if (!street) return { source, ok: true, latency_ms: Date.now() - start, records: [] };

    const records: EnrichedRecord[] = [{
      addresses: [{ street, city, state, zip, type: 'standardized', source }],
      phones: [], emails: [], source,
    }];

    return { source, ok: true, latency_ms: Date.now() - start, records };
  } catch (err) {
    return { source, ok: false, latency_ms: Date.now() - start, records: [],
      error: err instanceof Error ? err.message : 'unknown' };
  }
}
