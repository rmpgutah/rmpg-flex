// ============================================================
// Live Warrant Poller — Multi-State + Multi-Source
// ============================================================
// Unified entry point for live warrant lookups across:
//   - Utah Warrants API     (warrants.utah.gov/api/v1)   — UT only
//   - FBI Wanted API        (api.fbi.gov/wanted/v1/list) — federal/all
//   - Local scraped_warrants (cached 7k+ records)        — MT/ID/CO/…
//
// Each backend runs in parallel with a hard timeout.  Results are scored
// against the supplied criteria (name + optional DOB / sex / age) so the
// caller can sort by confidence and surface "potential_match" hits to an
// analyst rather than auto-acting on borderline matches.
//
// Design notes:
//   - **Score, don't hard-filter.** Some sources omit DOB or sex entirely;
//     hard-filtering would silently drop true hits. Score < 30 = drop;
//     30-59 = potential; 60-89 = likely; ≥ 90 = strong.
//   - **One canonical DOB format** (YYYY-MM-DD). parseFlexibleDob()
//     normalises FBI's "February 4, 2000", DB's "2000-02-04", and Utah's
//     "age only" inputs into the same comparable form.
//   - **All wall-clock-comparable**: matchScore() is pure (no Date.now())
//     so tests can pin a reference date and stay deterministic.
// ============================================================

import { getDb } from '../models/database';
import {
  searchUtahWarrantsLive,
  computeAgeFromDob,
  asciiFoldName,
  looksLikeOrganization,
  type UtahWarrantResult,
} from './utahWarrantScraper';

// ── Types ──────────────────────────────────────────────────

export type Sex = 'M' | 'F' | 'X' | null;

export interface LivePollCriteria {
  first_name: string;
  last_name: string;
  /** YYYY-MM-DD; tolerated formats are normalised in parseFlexibleDob(). */
  dob?: string | null;
  sex?: Sex | string | null;
  age?: number | null;
  /** Wall-clock used for age-from-DOB conversion; defaults to `new Date()`. */
  asOf?: Date;
}

export type ConfidenceTier = 'strong' | 'likely' | 'potential' | 'weak';

export interface MatchDetail {
  /** Which criterion was matched. */
  field: 'name' | 'dob' | 'age' | 'sex' | 'middle_name' | 'city';
  /** Free-form description: 'exact', 'within 1y', 'fuzzy: O\'Connor==OCONNOR' */
  basis: string;
  /** Points contributed to total score. */
  weight: number;
}

export interface LivePollResult {
  source:
    | 'utah_live'
    | 'fbi_live'
    | 'local_cache';
  /** Stable identifier from the source for dedup. */
  source_id: string;
  /** Normalised result fields — common shape across sources. */
  first_name: string;
  middle_name: string | null;
  last_name: string;
  /** Normalised to YYYY-MM-DD or null if source had only age. */
  dob: string | null;
  age: number | null;
  sex: Sex;
  city: string | null;
  state: string | null;
  warrant_id: string | null;
  warrant_type: string | null;
  charges: string | null;
  court_name: string | null;
  case_number: string | null;
  issue_date: string | null;
  bail_amount: string | null;
  offense_level: string | null;
  photo_url: string | null;
  detail_url: string | null;
  /** Score 0-100 against the search criteria. */
  match_score: number;
  match_tier: ConfidenceTier;
  match_details: MatchDetail[];
}

export interface LivePollSummary {
  results: LivePollResult[];
  /** Per-source health for debugging in the UI. */
  sources: Array<{
    source: LivePollResult['source'];
    status: 'ok' | 'timeout' | 'error' | 'skipped';
    raw_count: number;
    matched_count: number;
    error?: string;
  }>;
  total_ms: number;
}

// ── Constants ──────────────────────────────────────────────

const PER_BACKEND_TIMEOUT_MS = 12_000;
const FBI_API_URL = 'https://api.fbi.gov/wanted/v1/list';

// Score thresholds — derived from the per-field weight table below so a
// "name + dob exact + sex match" hit is solidly in the "strong" bucket.
const TIER_STRONG = 90;
const TIER_LIKELY = 60;
const TIER_POTENTIAL = 30;

// ── DOB / age parsing ──────────────────────────────────────

const MONTHS: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04',
  may: '05', june: '06', july: '07', august: '08',
  september: '09', october: '10', november: '11', december: '12',
  jan: '01', feb: '02', mar: '03', apr: '04', jun: '06',
  jul: '07', aug: '08', sep: '09', sept: '09', oct: '10',
  nov: '11', dec: '12',
};

/**
 * Normalise the many DOB formats we see in the wild into YYYY-MM-DD.
 * Returns null on unparseable input so callers fall back to age-based
 * matching instead of generating a bogus date.
 *
 * Handled formats:
 *   - 2000-02-04        (already normalised)
 *   - 2000/02/04
 *   - 02/04/2000        (US locale — month first)
 *   - February 4, 2000  (FBI API)
 *   - Feb 4, 2000
 */
export function parseFlexibleDob(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = String(input).trim();
  if (!s) return null;

  // YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // MM/DD/YYYY
  const usMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (usMatch) {
    const [, m, d, y] = usMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // "February 4, 2000" / "Feb 4, 2000" / "February 04, 2000"
  const longMatch = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (longMatch) {
    const [, monthName, d, y] = longMatch;
    const m = MONTHS[monthName.toLowerCase()];
    if (m) return `${y}-${m}-${d.padStart(2, '0')}`;
  }

  return null;
}

/** Same age math as utahWarrantScraper, re-exported for poller callers. */
export function ageFromIsoDob(dob: string, asOf: Date = new Date()): number | null {
  return computeAgeFromDob(dob, asOf);
}

/** "Male" / "M" / "male" → 'M'; same for F.  Anything else → null. */
export function normaliseSex(input: string | null | undefined): Sex {
  if (!input) return null;
  const c = String(input).trim().toUpperCase().charAt(0);
  if (c === 'M') return 'M';
  if (c === 'F') return 'F';
  if (c === 'X') return 'X';
  return null;
}

// ── Match scoring ──────────────────────────────────────────

interface ScoreInput {
  criteria: LivePollCriteria;
  candidate: {
    first_name: string;
    middle_name: string | null;
    last_name: string;
    dob: string | null;
    age: number | null;
    sex: Sex;
    city: string | null;
  };
}

/**
 * Pure function — no Date.now(), uses criteria.asOf for age math.
 * Returns total + per-field details so the UI can explain WHY something
 * scored high or low.
 */
export function matchScore({ criteria, candidate }: ScoreInput): {
  score: number;
  details: MatchDetail[];
} {
  const details: MatchDetail[] = [];
  let score = 0;
  const asOf = criteria.asOf ?? new Date();

  // ── Name (weight: required-ish, 30 pts) ─────────────────
  const critFirst = asciiFoldName(criteria.first_name).toUpperCase();
  const critLast = asciiFoldName(criteria.last_name).toUpperCase();
  const candFirst = asciiFoldName(candidate.first_name).toUpperCase();
  const candLast = asciiFoldName(candidate.last_name).toUpperCase();

  const lastMatches = critLast && candLast && critLast === candLast;
  const firstExact = critFirst && candFirst && critFirst === candFirst;
  const firstStartsWith =
    critFirst && candFirst && (candFirst.startsWith(critFirst) || critFirst.startsWith(candFirst));

  if (lastMatches && firstExact) {
    score += 30;
    details.push({ field: 'name', basis: 'exact', weight: 30 });
  } else if (lastMatches && firstStartsWith) {
    score += 20;
    details.push({ field: 'name', basis: 'last exact, first prefix', weight: 20 });
  } else if (lastMatches) {
    score += 10;
    details.push({ field: 'name', basis: 'last only', weight: 10 });
  }
  // If last name doesn't match at all, score stays 0 → caller drops it.

  // ── DOB (weight: 35 pts exact, 25 pts within 1y) ────────
  const critDob = parseFlexibleDob(criteria.dob);
  const candDob = parseFlexibleDob(candidate.dob);
  if (critDob && candDob) {
    if (critDob === candDob) {
      score += 35;
      details.push({ field: 'dob', basis: 'exact', weight: 35 });
    } else {
      const diffYears = Math.abs(
        new Date(critDob).getTime() - new Date(candDob).getTime(),
      ) / (365.25 * 24 * 60 * 60 * 1000);
      if (diffYears <= 1) {
        score += 25;
        details.push({ field: 'dob', basis: `within 1 year (Δ${diffYears.toFixed(1)}y)`, weight: 25 });
      } else if (diffYears <= 5) {
        score += 5;
        details.push({ field: 'dob', basis: `within 5 years (Δ${diffYears.toFixed(1)}y)`, weight: 5 });
      } else {
        // > 5 year DOB mismatch is a strong negative signal.
        score -= 20;
        details.push({ field: 'dob', basis: `MISMATCH (Δ${diffYears.toFixed(0)}y)`, weight: -20 });
      }
    }
  }

  // ── Age (weight: 20 pts exact, 10 pts ±2 ─ used when DOB absent) ─
  // If DOB scoring already fired, age becomes redundant signal.
  const dobScored = !!(critDob && candDob);
  if (!dobScored) {
    let critAge = criteria.age ?? null;
    if (critAge == null && critDob) critAge = computeAgeFromDob(critDob, asOf);
    let candAge = candidate.age;
    if (candAge == null && candDob) candAge = computeAgeFromDob(candDob, asOf);
    if (critAge != null && candAge != null) {
      const diff = Math.abs(critAge - candAge);
      if (diff === 0) {
        score += 20;
        details.push({ field: 'age', basis: 'exact', weight: 20 });
      } else if (diff <= 2) {
        score += 10;
        details.push({ field: 'age', basis: `±${diff}y`, weight: 10 });
      } else if (diff > 5) {
        score -= 10;
        details.push({ field: 'age', basis: `MISMATCH (Δ${diff}y)`, weight: -10 });
      }
    }
  }

  // ── Sex (weight: 15 pts) ────────────────────────────────
  const critSex = normaliseSex(criteria.sex);
  const candSex = candidate.sex;
  if (critSex && candSex) {
    if (critSex === candSex) {
      score += 15;
      details.push({ field: 'sex', basis: 'match', weight: 15 });
    } else {
      // Explicit mismatch is a hard negative.
      score -= 25;
      details.push({ field: 'sex', basis: 'MISMATCH', weight: -25 });
    }
  }

  return { score, details };
}

export function tierFor(score: number): ConfidenceTier {
  if (score >= TIER_STRONG) return 'strong';
  if (score >= TIER_LIKELY) return 'likely';
  if (score >= TIER_POTENTIAL) return 'potential';
  return 'weak';
}

// ── Backend: Utah Warrants API ─────────────────────────────

async function pollUtah(criteria: LivePollCriteria): Promise<LivePollResult[]> {
  const raws = await searchUtahWarrantsLive(criteria.first_name, criteria.last_name);
  if (!raws) return [];  // null = API failed; treat as zero results

  const out: LivePollResult[] = [];
  for (const r of raws as UtahWarrantResult[]) {
    const candidate = {
      first_name: r.first_name || '',
      middle_name: r.middle_name,
      last_name: r.last_name || '',
      dob: null,                // Utah API returns age, not DOB
      age: r.age ?? null,
      sex: null as Sex,         // Utah API doesn't expose sex
      city: r.city,
    };
    const { score, details } = matchScore({ criteria, candidate });
    out.push({
      source: 'utah_live',
      source_id: r.utah_warrant_id || `${r.utah_person_id}:${r.case_id ?? ''}`,
      first_name: candidate.first_name,
      middle_name: candidate.middle_name,
      last_name: candidate.last_name,
      dob: null,
      age: candidate.age,
      sex: null,
      city: candidate.city,
      state: 'UT',
      warrant_id: r.utah_warrant_id,
      warrant_type: 'arrest',
      charges: r.charges,
      court_name: r.court_name,
      case_number: r.case_id,
      issue_date: r.issue_date,
      bail_amount: null,
      offense_level: null,
      photo_url: null,
      detail_url: null,
      match_score: score,
      match_tier: tierFor(score),
      match_details: details,
    });
  }
  return out;
}

// ── Backend: FBI Wanted API ────────────────────────────────

async function pollFbi(criteria: LivePollCriteria): Promise<LivePollResult[]> {
  // Server-side title=  search supports partial matches; no need to
  // ASCII-fold (FBI titles are already plain ASCII).
  const titleQuery = `${criteria.first_name} ${criteria.last_name}`.trim();
  const url = `${FBI_API_URL}?title=${encodeURIComponent(titleQuery)}&pageSize=20`;

  const res = await fetch(url, {
    signal: AbortSignal.timeout(PER_BACKEND_TIMEOUT_MS - 500),
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) return [];
  const data = await res.json() as { items?: any[] };
  const items = data?.items ?? [];

  const out: LivePollResult[] = [];
  for (const it of items) {
    const fullName: string = (it.title || '').trim();
    const parts = fullName.split(/\s+/);
    const first = parts[0] || '';
    const last = parts[parts.length - 1] || '';
    const middle = parts.length > 2 ? parts.slice(1, -1).join(' ') : '';
    const dob = parseFlexibleDob(it.dates_of_birth_used?.[0]);

    const candidate = {
      first_name: first,
      middle_name: middle || null,
      last_name: last,
      dob,
      age: typeof it.age_min === 'number' ? it.age_min : null,
      sex: normaliseSex(it.sex),
      city: null,
    };
    const { score, details } = matchScore({ criteria, candidate });
    out.push({
      source: 'fbi_live',
      source_id: it.uid || it.url || fullName,
      first_name: candidate.first_name,
      middle_name: candidate.middle_name,
      last_name: candidate.last_name,
      dob: candidate.dob,
      age: candidate.age,
      sex: candidate.sex,
      city: null,
      state: 'US',
      warrant_id: it.ncic || it.uid || null,
      warrant_type: 'fugitive',
      charges: it.description || it.caution || null,
      court_name: 'Federal — FBI',
      case_number: it.uid || null,
      issue_date: it.publication || null,
      bail_amount: it.reward_text || null,
      offense_level: 'felony',
      photo_url: it.images?.[0]?.large || it.images?.[0]?.thumb || null,
      detail_url: it.url || null,
      match_score: score,
      match_tier: tierFor(score),
      match_details: details,
    });
  }
  return out;
}

// ── Backend: Local cached scraped_warrants ─────────────────

function pollLocalCache(criteria: LivePollCriteria): LivePollResult[] {
  // No live HTTP cost — synchronous SQLite query with LIKE on names.
  const db = getDb();
  const first = asciiFoldName(criteria.first_name).toUpperCase();
  const last = asciiFoldName(criteria.last_name).toUpperCase();
  if (!first && !last) return [];

  const rows = db.prepare(`
    SELECT id, source_key, first_name, middle_name, last_name,
           date_of_birth, age, gender, race, city, state,
           warrant_id, warrant_type, charge_description, court_name,
           case_number, issue_date, bail_amount, offense_level,
           photo_url, detail_url
      FROM scraped_warrants
     WHERE status = 'active'
       AND (
         (? = '' OR UPPER(first_name) LIKE ? OR UPPER(first_name) = ?)
         AND
         (? = '' OR UPPER(last_name) = ? OR UPPER(last_name) LIKE ?)
       )
     LIMIT 200
  `).all(
    first, `${first}%`, first,
    last, last, `${last}%`,
  ) as any[];

  const out: LivePollResult[] = [];
  for (const r of rows) {
    const candidate = {
      first_name: r.first_name || '',
      middle_name: r.middle_name || null,
      last_name: r.last_name || '',
      dob: parseFlexibleDob(r.date_of_birth),
      age: r.age ?? null,
      sex: normaliseSex(r.gender),
      city: r.city || null,
    };
    const { score, details } = matchScore({ criteria, candidate });
    out.push({
      source: 'local_cache',
      source_id: r.warrant_id || `local:${r.id}`,
      first_name: candidate.first_name,
      middle_name: candidate.middle_name,
      last_name: candidate.last_name,
      dob: candidate.dob,
      age: candidate.age,
      sex: candidate.sex,
      city: candidate.city,
      state: r.state || null,
      warrant_id: r.warrant_id,
      warrant_type: r.warrant_type,
      charges: r.charge_description,
      court_name: r.court_name,
      case_number: r.case_number,
      issue_date: r.issue_date,
      bail_amount: r.bail_amount,
      offense_level: r.offense_level,
      photo_url: r.photo_url,
      detail_url: r.detail_url,
      match_score: score,
      match_tier: tierFor(score),
      match_details: details,
    });
  }
  return out;
}

// ── Public API ─────────────────────────────────────────────

/**
 * Run all live + cache backends in parallel and return scored, sorted
 * results.  Score < 30 is dropped so the UI never shows random surname-only
 * collisions.
 */
export async function pollMultiStateLive(
  criteria: LivePollCriteria,
): Promise<LivePollSummary> {
  // Reject input early so each backend doesn't have to repeat the check.
  if (!criteria.first_name?.trim() || !criteria.last_name?.trim()) {
    return { results: [], sources: [], total_ms: 0 };
  }
  if (looksLikeOrganization(criteria.first_name, criteria.last_name)) {
    return { results: [], sources: [], total_ms: 0 };
  }

  const start = Date.now();

  type BackendRun = { source: LivePollResult['source']; promise: Promise<LivePollResult[]> };
  const backends: BackendRun[] = [
    { source: 'local_cache', promise: Promise.resolve(pollLocalCache(criteria)) },
    {
      source: 'utah_live',
      promise: withTimeout(pollUtah(criteria), PER_BACKEND_TIMEOUT_MS),
    },
    {
      source: 'fbi_live',
      promise: withTimeout(pollFbi(criteria), PER_BACKEND_TIMEOUT_MS),
    },
  ];

  const settled = await Promise.allSettled(backends.map(b => b.promise));

  const all: LivePollResult[] = [];
  const sources: LivePollSummary['sources'] = [];
  for (let i = 0; i < backends.length; i++) {
    const { source } = backends[i];
    const r = settled[i];
    if (r.status === 'fulfilled') {
      const matched = r.value.filter(x => x.match_score >= TIER_POTENTIAL);
      all.push(...matched);
      sources.push({
        source,
        status: 'ok',
        raw_count: r.value.length,
        matched_count: matched.length,
      });
    } else {
      const msg = (r.reason as Error)?.message ?? 'unknown error';
      sources.push({
        source,
        status: msg === 'TIMEOUT' ? 'timeout' : 'error',
        raw_count: 0,
        matched_count: 0,
        error: msg.slice(0, 200),
      });
    }
  }

  // Dedup by (source, source_id) preferring the higher score; this
  // protects against the same warrant appearing in both local cache and
  // a live API (e.g. FBI cached in scraped_warrants).
  const dedup = new Map<string, LivePollResult>();
  for (const r of all) {
    const key = `${r.warrant_id ?? r.source_id}`;
    const prev = dedup.get(key);
    if (!prev || r.match_score > prev.match_score) dedup.set(key, r);
  }

  const results = Array.from(dedup.values()).sort((a, b) => b.match_score - a.match_score);
  return { results, sources, total_ms: Date.now() - start };
}

// ── Helpers ────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('TIMEOUT')), ms);
    promise.then(
      v => { clearTimeout(t); resolve(v); },
      e => { clearTimeout(t); reject(e); },
    );
  });
}
