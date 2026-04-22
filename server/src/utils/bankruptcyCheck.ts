// ============================================================
// RMPG Flex — CourtListener Bankruptcy pre-check
// Queries CourtListener's RECAP bankruptcy-court search API to
// flag defendants with possible open BK cases. Results are cached
// in-process for 7 days per (lastName|firstName) pair.
//
// Activation: set the courtlistener_api_token row in system_config.
// If unset, checkBankruptcy returns { found: false, source: 'skipped' }
// — the feature is inert, not broken.
// ============================================================

import { getDb } from '../models/database';

const BK_CACHE_TTL_MS = 7 * 24 * 3600_000;
const bkCache = new Map<string, { at: number; result: BkResult }>();

export interface BkCase {
  caseNumber: string;
  filed: string;
  court: string;
  status: string;
}

export interface BkResult {
  found: boolean;
  cases: BkCase[];
  checked_at: string;
  source: 'courtlistener' | 'cache' | 'skipped';
}

async function getApiToken(): Promise<string | null> {
  try {
    const db = getDb();
    const row = db.prepare(
      "SELECT config_value FROM system_config WHERE config_key = 'courtlistener_api_token' LIMIT 1",
    ).get() as any;
    const dbVal = row?.config_value;
    if (dbVal && String(dbVal).trim()) return String(dbVal).trim();
  } catch { /* system_config may not exist in tests — fall through to env */ }
  const envVal = process.env.COURTLISTENER_API_TOKEN;
  return envVal && envVal.trim() ? envVal.trim() : null;
}

export function _clearBkCacheForTests(): void {
  bkCache.clear();
}

export async function checkBankruptcy(firstName: string, lastName: string): Promise<BkResult> {
  const first = (firstName || '').trim();
  const last = (lastName || '').trim();
  if (!first || !last) {
    return { found: false, cases: [], checked_at: new Date().toISOString(), source: 'skipped' };
  }
  const key = `${last.toLowerCase()}|${first.toLowerCase()}`;
  const cached = bkCache.get(key);
  if (cached && Date.now() - cached.at < BK_CACHE_TTL_MS) {
    return { ...cached.result, source: 'cache' };
  }
  const token = await getApiToken();
  if (!token) {
    return { found: false, cases: [], checked_at: new Date().toISOString(), source: 'skipped' };
  }
  try {
    const q = encodeURIComponent(`${last} ${first}`);
    const url = `https://www.courtlistener.com/api/rest/v3/search/?type=r&q=${q}&court_type=bankruptcy&order_by=dateFiled+desc`;
    const resp = await fetch(url, {
      headers: { Authorization: `Token ${token}`, Accept: 'application/json' },
    });
    if (!resp.ok) {
      return { found: false, cases: [], checked_at: new Date().toISOString(), source: 'courtlistener' };
    }
    const data: any = await resp.json();
    const cases: BkCase[] = (data?.results || []).slice(0, 5).map((r: any) => ({
      caseNumber: r.docketNumber || r.caseName || '',
      filed: r.dateFiled || '',
      court: r.court || r.court_id || '',
      status: r.status || '',
    }));
    const result: BkResult = {
      found: cases.length > 0,
      cases,
      checked_at: new Date().toISOString(),
      source: 'courtlistener',
    };
    bkCache.set(key, { at: Date.now(), result });
    return result;
  } catch {
    return { found: false, cases: [], checked_at: new Date().toISOString(), source: 'courtlistener' };
  }
}
