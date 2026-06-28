// ============================================================
// Open-source court records — CourtListener / RECAP (federal)
// ============================================================
// CourtListener (Free Law Project, a 501(c)(3)) publishes federal PACER
// dockets + court opinions through a sanctioned public REST API. This
// queries it by party name on a scan and caches results in D1.
//
// This is genuinely open data with a provider-intended API — NOT a scrape
// of a bot-protected/ToU-restricted site. An optional API token
// (system_config courtlistener_token) raises the rate limit; anonymous
// access works without one.
//
// ⚠️ Identity caveat: court records match on NAME only. A federal docket
// naming "John Smith" is not proof THIS John Smith is a party. Results are
// surfaced as leads to verify (DOB/identifiers), never as confirmed facts.
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import { execute, query, queryFirst } from './db';

const API = 'https://www.courtlistener.com/api/rest/v4/search/';
const CACHE_TTL_HOURS = 24;
const REQUEST_TIMEOUT_MS = 12_000;

export interface CourtRecord {
  case_name: string;
  docket_number: string;
  court: string;
  date_filed: string;
  url: string;          // absolute CourtListener URL
  is_criminal: boolean; // "United States v. <name>" = federal criminal
}

async function getToken(db: D1Database): Promise<string> {
  try {
    const r = await queryFirst<{ config_value: string }>(
      db, `SELECT config_value FROM system_config WHERE config_key = 'courtlistener_token' ORDER BY id DESC LIMIT 1`);
    return (r?.config_value || '').trim();
  } catch { return ''; }
}

function normalize(raw: any): CourtRecord | null {
  const caseName = String(raw?.caseName || raw?.case_name_full || '').trim();
  if (!caseName) return null;
  const docketPath = raw?.docket_absolute_url || raw?.absolute_url || '';
  return {
    case_name: caseName,
    docket_number: String(raw?.docketNumber || '').trim(),
    court: String(raw?.court || raw?.court_citation_string || '').trim(),
    date_filed: String(raw?.dateFiled || '').slice(0, 10),
    url: docketPath ? `https://www.courtlistener.com${docketPath}` : '',
    // Federal criminal cases are captioned "United States v. <defendant>".
    is_criminal: /^united states (of america )?v\.?\s/i.test(caseName),
  };
}

export interface CourtLookupResult {
  source: string;
  records: CourtRecord[];
  cached: boolean;
  error?: string;
}

/**
 * Look up federal court records for a name via CourtListener (cache-first).
 * Returns [] quietly on any upstream/parse failure.
 */
export async function lookupCourtRecords(
  db: D1Database, lastName: string, firstName: string,
): Promise<CourtLookupResult> {
  const last = (lastName || '').trim();
  const first = (firstName || '').trim();
  if (last.length < 2) return { source: 'COURTLISTENER', records: [], cached: false };

  const key = `cl:${last.toLowerCase()}|${first.toLowerCase()}`;

  // Cache-first (24h TTL).
  try {
    const cached = await queryFirst<{ results: string; fetched_at: string }>(
      db, `SELECT results, fetched_at FROM court_records_cache
            WHERE query_key = ? AND fetched_at > datetime('now', ?)
            ORDER BY id DESC LIMIT 1`, key, `-${CACHE_TTL_HOURS} hours`);
    if (cached?.results) {
      return { source: 'COURTLISTENER', records: JSON.parse(cached.results), cached: true };
    }
  } catch { /* cache miss path below */ }

  try {
    const token = await getToken(db);
    // party_name targets the actual parties; order newest first.
    const params = new URLSearchParams({
      type: 'r',
      party_name: first ? `${first} ${last}` : last,
      order_by: 'dateFiled desc',
    });
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    const resp = await fetch(`${API}?${params}`, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'RMPG-Flex/1.0 (law enforcement records check)',
        ...(token ? { 'Authorization': `Token ${token}` } : {}),
      },
      signal: ctrl.signal,
    }).finally(() => clearTimeout(t));

    if (!resp.ok) throw new Error(`CourtListener HTTP ${resp.status}`);
    const json = await resp.json() as { results?: any[] };
    const records = (json.results || []).map(normalize).filter((r): r is CourtRecord => !!r).slice(0, 15);

    // Cache (best-effort).
    try {
      await execute(db,
        `INSERT INTO court_records_cache (query_key, last_name, first_name, source, results, result_count)
         VALUES (?, ?, ?, 'COURTLISTENER', ?, ?)`,
        key, last, first, JSON.stringify(records), records.length);
    } catch { /* cache write optional */ }

    return { source: 'COURTLISTENER', records, cached: false };
  } catch (err) {
    return { source: 'COURTLISTENER', records: [], cached: false, error: err instanceof Error ? err.message : String(err) };
  }
}
