// ============================================================
// FBI Wanted — official public API (api.fbi.gov)
// ============================================================
// The FBI publishes its Wanted/fugitive list through a free, official,
// no-auth public API. This queries it by name and caches results in
// court_records_cache (shared cache table, keyed with an `fbi:` prefix).
//
// This is a sanctioned government API — not a scrape. The data is the
// FBI's own public bulletins, which carry the officer-safety fields that
// matter most: warning_message ("ARMED AND DANGEROUS") and caution.
//
// ⚠️ Identity caveat: the API matches on NAME. A wanted bulletin named
// "John Smith" is a LEAD to verify, not proof THIS subject is wanted.
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import { execute, queryFirst } from './db';

const API = 'https://api.fbi.gov/wanted/v1/list';
const CACHE_TTL_HOURS = 24;
const REQUEST_TIMEOUT_MS = 12_000;
// api.fbi.gov 403s identifier-style UAs (same WAF behaviour as the Utah
// warrant source); a real browser UA is required.
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

export interface FbiWantedRecord {
  title: string;
  warning: string;       // warning_message (e.g. ARMED AND DANGEROUS)
  caution: string;       // plain-text caution narrative (HTML stripped)
  subjects: string;      // classification(s)
  sex: string;
  race: string;
  dob: string;           // first dates_of_birth_used entry
  aliases: string;
  reward: string;
  url: string;           // fbi.gov bulletin
  image: string | null;  // thumb/original
  is_danger: boolean;    // any warning/armed designation
}

function stripHtml(s: string): string {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalize(raw: any): FbiWantedRecord | null {
  const title = String(raw?.title || '').trim();
  if (!title) return null;
  const warning = String(raw?.warning_message || '').trim();
  const images = Array.isArray(raw?.images) ? raw.images : [];
  return {
    title,
    warning,
    caution: stripHtml(raw?.caution).slice(0, 400),
    subjects: Array.isArray(raw?.subjects) ? raw.subjects.join(', ') : '',
    sex: String(raw?.sex || '').trim(),
    race: String(raw?.race_raw || raw?.race || '').trim(),
    dob: Array.isArray(raw?.dates_of_birth_used) && raw.dates_of_birth_used[0] ? String(raw.dates_of_birth_used[0]) : '',
    aliases: Array.isArray(raw?.aliases) ? raw.aliases.join(', ') : '',
    reward: stripHtml(raw?.reward_text).slice(0, 160),
    url: String(raw?.url || '').trim(),
    image: images[0]?.thumb || images[0]?.original || null,
    is_danger: /armed|dangerous|caution|violent/i.test(warning) || !!warning,
  };
}

export interface FbiLookupResult {
  source: string;
  records: FbiWantedRecord[];
  cached: boolean;
  error?: string;
}

/** Look up FBI Wanted bulletins by name (cache-first, 24h). */
export async function lookupFbiWanted(
  db: D1Database, lastName: string, firstName: string,
): Promise<FbiLookupResult> {
  const last = (lastName || '').trim();
  const first = (firstName || '').trim();
  if (last.length < 2) return { source: 'FBI_WANTED', records: [], cached: false };

  const term = `${first} ${last}`.trim();
  const key = `fbi:${last.toLowerCase()}|${first.toLowerCase()}`;

  try {
    const cached = await queryFirst<{ results: string }>(
      db, `SELECT results FROM court_records_cache
            WHERE query_key = ? AND fetched_at > datetime('now', ?)
            ORDER BY id DESC LIMIT 1`, key, `-${CACHE_TTL_HOURS} hours`);
    if (cached?.results) return { source: 'FBI_WANTED', records: JSON.parse(cached.results), cached: true };
  } catch { /* miss → live fetch */ }

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    const resp = await fetch(`${API}?title=${encodeURIComponent(term)}`, {
      headers: { 'Accept': 'application/json', 'User-Agent': USER_AGENT },
      signal: ctrl.signal,
    }).finally(() => clearTimeout(t));
    if (!resp.ok) throw new Error(`FBI API HTTP ${resp.status}`);
    const json = await resp.json() as { items?: any[] };

    // The title filter is fuzzy; keep only items whose title actually
    // contains the last name (guards against broad partial matches).
    const lastLc = last.toLowerCase();
    const records = (json.items || [])
      .map(normalize)
      .filter((r): r is FbiWantedRecord => !!r && r.title.toLowerCase().includes(lastLc))
      .slice(0, 10);

    try {
      await execute(db,
        `INSERT INTO court_records_cache (query_key, last_name, first_name, source, results, result_count)
         VALUES (?, ?, ?, 'FBI_WANTED', ?, ?)`,
        key, last, first, JSON.stringify(records), records.length);
    } catch { /* cache write optional */ }

    return { source: 'FBI_WANTED', records, cached: false };
  } catch (err) {
    return { source: 'FBI_WANTED', records: [], cached: false, error: err instanceof Error ? err.message : String(err) };
  }
}
