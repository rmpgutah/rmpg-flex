import type { EnrichmentSeed, SourceResult, EnrichedRecord } from '../types';
import type { Bindings } from '../../../types';
import { enrichmentHeaders } from './http';

async function resolveUserId(env: Bindings): Promise<string | null> {
  const fromEnv = (env.USPS_USER_ID as string | undefined)?.trim();
  if (fromEnv) return fromEnv;
  try {
    const row = await env.DB.prepare(
      `SELECT config_value FROM system_config
        WHERE config_key = 'usps_user_id' AND is_active = 1 LIMIT 1`,
    ).first<{ config_value: string }>();
    return row?.config_value?.trim() || null;
  } catch {
    return null;
  }
}

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function search(seed: EnrichmentSeed, env: Bindings): Promise<SourceResult> {
  const start = Date.now();
  const source = 'usps';
  const userId = await resolveUserId(env);
  if (!userId) return { source, ok: false, latency_ms: 0, records: [], error: 'not_configured' };
  if (!seed.address) return { source, ok: true, latency_ms: 0, records: [] };

  try {
    const xml = `<AddressValidateRequest USERID="${escXml(userId)}"><Revision>1</Revision><Address ID="0"><Address1></Address1><Address2>${escXml(seed.address)}</Address2><City>${escXml(seed.city ?? '')}</City><State>${escXml(seed.state ?? '')}</State><Zip5></Zip5><Zip4></Zip4></Address></AddressValidateRequest>`;
    const params = new URLSearchParams({ API: 'Verify', XML: xml });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`https://secure.shippingapis.com/ShippingAPI.dll?${params}`, {
      signal: ctrl.signal,
      headers: enrichmentHeaders(),
    }).finally(() => clearTimeout(timer));

    if (!res.ok) return { source, ok: false, latency_ms: Date.now() - start, records: [], error: `HTTP ${res.status}` };

    const text = await res.text();
    if (/<Error>/i.test(text)) {
      const desc = text.match(/<Description>([^<]+)<\/Description>/)?.[1] ?? 'usps_error';
      return { source, ok: false, latency_ms: Date.now() - start, records: [], error: desc.slice(0, 120) };
    }
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
