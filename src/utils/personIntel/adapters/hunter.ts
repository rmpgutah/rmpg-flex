// src/utils/personIntel/adapters/hunter.ts
import type { IntelSeed, RawDataPoint, SourceResult } from '../types';
import { getKey, safeFetch, makeSourceResult } from './shared';

const SRC = 'HunterIO';

export async function queryHunter(db: D1Database, seed: IntelSeed): Promise<SourceResult> {
  const t0 = Date.now();
  if (!seed.email) return makeSourceResult(SRC, 2, 'skipped', [], [], Date.now() - t0);
  let apiKey = await getKey(db, 'hunter_api_key');
  if (!apiKey?.trim()) apiKey = await getKey(db, 'hunter_io_api_key');
  if (!apiKey) return makeSourceResult(SRC, 2, 'not_configured', [], [], Date.now() - t0);

  try {
    const json = await safeFetch(`https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(seed.email)}&api_key=${apiKey}`, { method: 'GET' });
    const pts: RawDataPoint[] = [];
    const d = json?.data;
    if (d?.result === 'deliverable') pts.push({ category: 'email', field: 'verified', value: 'true', source: SRC });
    if (d?.mx_records) pts.push({ category: 'email', field: 'mx_host', value: String(d.mx_records[0]?.hostname ?? ''), source: SRC });
    if (d?.smtp_server_accepts_all === false) pts.push({ category: 'email', field: 'disposable', value: 'false', source: SRC });
    return makeSourceResult(SRC, 2, 'success', pts, [], Date.now() - t0);
  } catch (e: any) {
    return makeSourceResult(SRC, 2, 'error', [], [], Date.now() - t0, String(e?.message ?? e));
  }
}
