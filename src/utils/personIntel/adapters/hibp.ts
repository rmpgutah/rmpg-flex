// src/utils/personIntel/adapters/hibp.ts
import type { IntelSeed, RawDataPoint, SourceResult, RiskFlag } from '../types';
import { getKey, safeFetch, makeSourceResult } from './shared';

const SRC = 'HIBP';

export async function queryHibp(db: D1Database, seed: IntelSeed): Promise<{ result: SourceResult; riskFlags: RiskFlag[] }> {
  const t0 = Date.now();
  if (!seed.email) return { result: makeSourceResult(SRC, 2, 'skipped', [], [], Date.now() - t0), riskFlags: [] };
  const apiKey = await getKey(db, 'hibp_api_key');
  if (!apiKey) return { result: makeSourceResult(SRC, 2, 'not_configured', [], [], Date.now() - t0), riskFlags: [] };

  try {
    const json = await safeFetch(`https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(seed.email)}`, {
      method: 'GET',
      headers: { 'hibp-api-key': apiKey, 'User-Agent': 'RMPG-Flex-PersonIntel/1.0' },
    });
    const breaches: any[] = Array.isArray(json) ? json : [];
    const pts: RawDataPoint[] = breaches.map(b => ({ category: 'online' as const, field: 'breach', value: b.Name ?? 'Unknown', source: SRC }));
    const riskFlags: RiskFlag[] = breaches.length >= 3 ? ['hibp_breach'] : [];
    return { result: makeSourceResult(SRC, 2, 'success', pts, [], Date.now() - t0), riskFlags };
  } catch (e: any) {
    if (String(e?.message).includes('404')) return { result: makeSourceResult(SRC, 2, 'success', [], [], Date.now() - t0), riskFlags: [] };
    return { result: makeSourceResult(SRC, 2, 'error', [], [], Date.now() - t0, String(e?.message ?? e)), riskFlags: [] };
  }
}
