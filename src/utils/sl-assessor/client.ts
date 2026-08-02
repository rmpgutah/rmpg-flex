// src/utils/sl-assessor/client.ts
// Worker-safe SLCo Assessor client.
//
// The assessor site uses a ColdFusion form that POSTs to resultsMain.cfm with
// four structured fields: street_Num, street_dir, street_name, street_type.
// A single-match search auto-redirects (302) to valuationInfoExpanded.cfm —
// fetch() follows the redirect automatically and we parse the full detail HTML
// directly. Multi-result stays on resultsMain.cfm with the parcel list injected
// by ParcelTools.js; for that path we send the GET-equivalent URL to Firecrawl.
//
// Parcel detail by number: GET valuationInfoExpanded.cfm?parcel_id=<digits>
// — no form POST or session required.

import { AssessorConfigError, AssessorHttpError, AssessorTimeoutError } from './types';
import type { Parcel, ParcelSummary } from './types';
import { parseParcelList, parseParcelDetail } from './parser';
import { fetchCamaParcel, toParcelId } from './camaClient';
import type { CamaParcel } from './camaParser';
import { log } from '../logger';

const RESULTS_URL = 'https://apps.saltlakecounty.gov/assessor/new/resultsMain.cfm';
const DETAIL_BASE  = 'https://apps.saltlakecounty.gov/assessor/new/valuationInfoExpanded.cfm';
const QUERY_PAGE   = 'https://apps.saltlakecounty.gov/assessor/new/query.cfm';
const FC_SCRAPE    = 'https://api.firecrawl.dev/v1/scrape';
const DIRECT_TIMEOUT_MS = 12_000;
const FC_TIMEOUT_MS     = 25_000;

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

export interface AssessorEnv { FIRECRAWL_API_KEY?: string; }

// ─── Address component parser ─────────────────────────────────────────────────
// SLC uses a Cartesian grid system where streets are numbered from Temple Square.
// "2200 S 500 E" means the intersection of 2200 South and 500 East streets.
// The POST form needs them split into separate fields.

const DIRS = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW']);
const DIR_EXPAND: Record<string, string> = {
  NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W',
};
const STREET_TYPES = new Set([
  'ST', 'AVE', 'BLVD', 'DR', 'LN', 'RD', 'CT', 'CIR', 'PL', 'WY',
  'TRL', 'HWY', 'PKWY', 'SQ', 'LOOP', 'PASS', 'PATH', 'XING', 'HTS',
]);
const TYPE_EXPAND: Record<string, string> = {
  STREET: 'ST', AVENUE: 'AVE', BOULEVARD: 'BLVD', DRIVE: 'DR',
  LANE: 'LN', ROAD: 'RD', COURT: 'CT', CIRCLE: 'CIR', PLACE: 'PL',
  TRAIL: 'TRL', HIGHWAY: 'HWY', PARKWAY: 'PKWY', SQUARE: 'SQ', HEIGHTS: 'HTS',
  // The SLCo Assessor form's own street-type abbreviation is "WY", not
  // "WAY" — verified 2026-07-14 against a live parcel (27-18-451-077-0000,
  // "10846 S INDIGO SKY WY"): searching with the literal "WAY" token
  // returned zero results even though the parcel exists, while "WY"
  // resolved it immediately via the single-match redirect.
  WAY: 'WY',
};

export interface AddressComponents {
  street_Num: string;
  street_dir: string;
  street_name: string;
  street_type: string;
}

export function parseAddressComponents(address: string): AddressComponents {
  // Callers may pass a full "street, city, state zip" address (needed for
  // county resolution upstream) — this parser only ever wants the street
  // portion, so drop everything from the first comma on. Un-truncated,
  // "10846 South Indigo Sky Way, South Jordan, UT" glues the city/state
  // onto street_name, guaranteeing a false "no match".
  const streetOnly = address.split(',')[0];
  const parts = streetOnly
    .toUpperCase()
    .replace(/[.#]+/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  let idx = 0;

  // 1. House number — first all-digit token
  const street_Num = /^\d+$/.test(parts[idx] ?? '') ? parts[idx++] : '';

  // 2. Optional leading direction (N/S/E/W or full word)
  let street_dir = '';
  const rawDir = parts[idx] ?? '';
  const normDir = DIR_EXPAND[rawDir] ?? rawDir;
  if (DIRS.has(normDir)) {
    street_dir = normDir;
    idx++;
  }

  // 3. Remaining tokens → name + optional trailing type/direction
  const rest = parts.slice(idx);
  let street_name = '';
  let street_type = '';

  if (rest.length > 0) {
    const last = rest[rest.length - 1];
    // Expand a spelled-out trailing DIRECTION as well as a street type.
    // SLC's grid names streets by direction ("465 East"), and the county's
    // form wants that as street_type="E". Previously only TYPE_EXPAND was
    // applied here, so "EAST" stayed a literal word, street_name became
    // "465 EAST", and the POST returned the search form instead of the
    // parcel — surfacing as "Could not reach the Assessor."
    // Verified live 2026-08-01 for 10506 S 465 E: {name:'465', type:'E'}
    // redirects to the detail page; {name:'465 EAST'} does not.
    const normType = TYPE_EXPAND[last] ?? DIR_EXPAND[last] ?? last;
    if (STREET_TYPES.has(normType) || DIRS.has(normType)) {
      street_type = normType;
      street_name = rest.slice(0, -1).join(' ');
    } else {
      street_name = rest.join(' ');
    }
  }

  return { street_Num, street_dir, street_name, street_type };
}

/**
 * Convert "16-18-355-003-0000" → "16183550030000" for the detail URLs.
 *
 * ⚠️ The id MUST end up 14 digits. A 10-digit id addresses a BLOCK, and the
 * county answers it with HTTP 200 + the SEARCH FORM rather than an error —
 * so a short id used to produce a page that parsed to nothing, with no
 * status code to notice. normalizeParcelNumber pads the 4-digit encumbrance
 * suffix; toParcelId throws on anything it cannot normalize.
 */
function parcelNoToId(parcelNo: string): string {
  return toParcelId(parcelNo);
}

/** Manual search page link surfaced to users when automated lookup fails. */
export function buildQueryUrl(address: string): string {
  return `${QUERY_PAGE}?address=${encodeURIComponent(address)}`;
}

// ─── Internal network helpers ─────────────────────────────────────────────────

async function fetchPost(fields: AddressComponents): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), DIRECT_TIMEOUT_MS);
  try {
    const body = new URLSearchParams({
      street_Num: fields.street_Num,
      street_dir: fields.street_dir,
      street_name: fields.street_name,
      street_type: fields.street_type,
    });
    const res = await fetch(RESULTS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml',
      },
      body: body.toString(),
      signal: ctl.signal,
      redirect: 'follow',
    });
    if (!res.ok) throw new AssessorHttpError(res.status, 'POST to resultsMain.cfm failed');
    return res;
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new AssessorTimeoutError('assessor POST timed out');
    if (e instanceof AssessorHttpError) throw e;
    throw new AssessorHttpError(0, e?.message ?? 'assessor POST failed');
  } finally {
    clearTimeout(t);
  }
}

async function fetchDetailHtml(parcelId: string): Promise<string> {
  const url = `${DETAIL_BASE}?parcel_id=${parcelId}`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), DIRECT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml' },
      signal: ctl.signal,
    });
    if (!res.ok) throw new AssessorHttpError(res.status, 'detail page fetch failed');
    return await res.text();
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new AssessorTimeoutError(`detail fetch timed out: ${url}`);
    if (e instanceof AssessorHttpError) throw e;
    throw new AssessorHttpError(0, e?.message ?? 'detail fetch failed');
  } finally {
    clearTimeout(t);
  }
}

async function scrapeViaFirecrawl(env: AssessorEnv, url: string): Promise<string> {
  if (!env.FIRECRAWL_API_KEY) throw new AssessorConfigError();
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), FC_TIMEOUT_MS);
  try {
    const res = await fetch(FC_SCRAPE, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url, formats: ['html'] }),
      signal: ctl.signal,
    });
    if (!res.ok) throw new AssessorHttpError(res.status, await res.text().catch(() => ''));
    const json = await res.json() as any;
    const html = json?.data?.html ?? '';
    if (typeof html !== 'string' || !html) throw new AssessorHttpError(0, 'firecrawl returned no html');
    return html;
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new AssessorTimeoutError(`firecrawl timed out: ${url}`);
    if (e instanceof AssessorHttpError) throw e;
    throw new AssessorHttpError(0, e?.message ?? 'firecrawl failed');
  } finally {
    clearTimeout(t);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Search parcels by address.
 *
 * Strategy:
 * 1. Parse address into structured components.
 * 2. POST to resultsMain.cfm. When the server 302-redirects to
 *    valuationInfoExpanded.cfm (single result), parse the detail page and
 *    return a one-item summary list.
 * 3. If no redirect (multi-result), send the GET-equivalent URL to Firecrawl
 *    so ParcelTools.js can inject the parcel rows.
 * 4. Progressive fallback: retry without street_type (mirrors the server's own
 *    JS retry logic when a type like "ST" isn't in the DB verbatim).
 */
export async function searchByAddress(env: AssessorEnv, address: string): Promise<ParcelSummary[]> {
  const comps = parseAddressComponents(address);
  const attempts: AddressComponents[] = [comps];
  if (comps.street_type) attempts.push({ ...comps, street_type: '' });

  // Track whether ANY attempt actually reached the county. Without this the
  // function returns [] for both "searched, no such parcel" and "every
  // request failed", and the caller cannot tell an answer from an outage —
  // it would report "No matching parcels" for an unreachable assessor.
  let reachedUpstream = false;
  let lastNetworkErr: unknown = null;

  for (const fields of attempts) {
    let res: Response;
    try {
      res = await fetchPost(fields);
      reachedUpstream = true;
    } catch (e) { lastNetworkErr = e; continue; }

    if (res.url.includes('valuationInfoExpanded.cfm')) {
      // Single-result redirect — fetch() resolved the 302 automatically.
      // Parse the full detail HTML and synthesize a summary.
      try {
        const html = await res.text();
        const parcel = parseParcelDetail(html);
        parcel.source_url = res.url;
        return [summarize(parcel, res.url)];
      } catch { continue; }
    }

    // Multi-result: page stayed on resultsMain.cfm — parcel rows are injected by
    // ParcelTools.js. Send the GET-equivalent URL to Firecrawl for JS rendering.
    if (env.FIRECRAWL_API_KEY) {
      const params = new URLSearchParams({
        street_num: fields.street_Num,
        street_dir: fields.street_dir,
        street_name: fields.street_name,
        street_type: fields.street_type,
        distance: '300',
        orderby: 'prev_frt_num',
      });
      try {
        const html = await scrapeViaFirecrawl(env, `${RESULTS_URL}?${params}`);
        const parsed = parseParcelList(html);
        if (parsed.length > 0) return parsed;
      } catch { /* fall through to next attempt */ }
    }
  }

  // Every attempt failed to reach the county — surface it rather than
  // returning an empty list that reads as "no such parcel".
  if (!reachedUpstream) {
    if (lastNetworkErr instanceof AssessorTimeoutError) throw lastNetworkErr;
    throw new AssessorHttpError(
      0,
      lastNetworkErr instanceof Error
        ? `assessor unreachable: ${lastNetworkErr.message}`
        : 'assessor unreachable',
    );
  }
  return [];
}

/**
 * Build the picker row from a parsed detail page.
 *
 * The picker renders "<parcel>  <owner>" over "<address> · <sqft> · <value>",
 * and each of those had a single source that is frequently null on the
 * expanded page — so rows rendered as "— · — · $54,138,800" even though the
 * data exists elsewhere in the same response. Each field now falls back
 * through every place the county actually publishes it.
 */
export function summarize(parcel: Parcel, detailUrl: string): ParcelSummary {
  const cama = parcel.cama as CamaParcel | null | undefined;
  const res = cama?.residence ?? {};
  const par = cama?.parcel ?? {};
  const land0 = cama?.land_records?.[0] ?? {};

  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;

  // "sqft" in the picker means BUILDING area — that is what an officer reads
  // (the Garlutzo row shows 1604, the county's Above Grade Area), not lot size.
  const sqft =
    num(parcel.total_bldg_sqft) ?? num(parcel.finished_sqft) ??
    num(res.above_grade_area) ?? num(res.main_floor_area) ??
    num(parcel.land_sqft) ?? num(land0.sqr_feet);

  const value =
    num(parcel.market_value_total) ?? num(par.val_final_value) ??
    num(parcel.taxable_value) ?? num(par.val_taxable_value);

  return {
    parcel_number: parcel.parcel_number,
    owner_of_record: parcel.owner_of_record ?? cama?.owner_of_record ?? null,
    situs_address:
      parcel.situs_address ?? cama?.situs_address ??
      (typeof par.par_site_name === 'string' ? par.par_site_name : null),
    land_sqft: sqft,
    total_market_value: value,
    detail_url: detailUrl,
  };
}

/**
 * Fetch and parse a single parcel detail page. Hits valuationInfoExpanded.cfm
 * directly with the numeric parcel ID — no form POST or session needed.
 */
export async function getParcel(env: AssessorEnv, parcelNo: string): Promise<Parcel> {
  const parcelId = parcelNoToId(parcelNo);
  const url = `${DETAIL_BASE}?parcel_id=${parcelId}`;
  const html = await fetchDetailHtml(parcelId);
  const parcel = parseParcelDetail(html);
  parcel.source_url = url;

  // ── Full CAMA build ────────────────────────────────────────────────────
  // Best-effort by design: a CAMA failure must never turn a working parcel
  // lookup into an error for the officer. The flat Parcel above is already
  // a usable answer; this only ever adds to it.
  try {
    const { parcel: cama } = await fetchCamaParcel(parcelNo);
    parcel.cama = cama;
    applyCamaToFlatParcel(parcel, cama);
  } catch (err) {
    log.warn('[sl-assessor] CAMA build failed — returning summary-only parcel', {
      parcel: parcelNo, error: err instanceof Error ? err.message : String(err),
    });
  }
  return parcel;
}

/**
 * Fill the flat Parcel's typed slots from the CAMA build.
 *
 * FILL-ONLY — CAMA never overwrites a value the expanded-page parser already
 * produced. In practice it fills a great deal: the residence block is
 * rendered as value-before-label <div>s on the expanded page, so
 * `parseParcelDetail` returns null for bedrooms, bathrooms, stories,
 * year_built, and every floor area on EVERY real Salt Lake County parcel.
 * Those are the fields officers actually read.
 */
export function applyCamaToFlatParcel(parcel: Parcel, cama: CamaParcel): void {
  const res = cama.residence;
  const par = cama.parcel;
  const land0 = cama.land_records[0] ?? {};

  const fill = <K extends keyof Parcel>(key: K, value: unknown) => {
    if (parcel[key] == null && value != null) (parcel as any)[key] = value;
  };

  fill('owner_of_record', cama.owner_of_record);
  fill('situs_address', cama.situs_address);
  fill('legal_description', cama.legal_description);
  fill('tax_district', par.par_tax_district);
  fill('year_built', res.year_built);
  fill('effective_year_built', res.effective_year_built);
  fill('stories', res.number_of_stories);
  fill('bedrooms', res.bedrooms);
  fill('construction_type', res.exterior_wall_type);
  fill('improvement_class', res.assessment_classification);
  fill('total_bldg_sqft', res.above_grade_area);
  fill('finished_sqft', res.above_grade_area);
  fill('basement_sqft', res.basement_area);
  fill('garage_sqft', res.builtin_garage_sqft ?? res.attached_garage_sqft);
  fill('land_acres', par.par_total_acreage);
  fill('zoning', land0.zone);
  fill('market_value_land', par.val_land_value);
  fill('market_value_improvement', par.val_building_value);
  fill('market_value_total', par.val_final_value);
  fill('improvement_value', par.val_building_value);

  // Bathrooms is a DERIVED total — the county reports full / three-quarter /
  // half separately and never publishes a single "bathrooms" figure. Counting
  // a half bath as 0.5 and a 3/4 bath as 0.75 matches the residential
  // appraisal convention the assessor's own grades assume.
  const full = numOrNull(res.full_baths);
  const three = numOrNull(res.three_quarter_baths);
  const half = numOrNull(res.half_baths);
  if (parcel.bathrooms == null && (full != null || three != null || half != null)) {
    parcel.bathrooms = (full ?? 0) + (three ?? 0) * 0.75 + (half ?? 0) * 0.5;
  }

  // land_sqft: prefer the county's own Sqr. Feet, else convert acres.
  // 43,560 ft² per acre.
  if (parcel.land_sqft == null) {
    const sqft = numOrNull(land0.sqr_feet);
    const acres = numOrNull(par.par_total_acreage);
    if (sqft != null) parcel.land_sqft = sqft;
    else if (acres != null) parcel.land_sqft = Math.round(acres * 43_560);
  }

  // Merge CAMA's labelled pairs into raw_data_json without clobbering
  // anything the expanded-page scan already captured.
  parcel.raw_data_json = { ...cama.raw_data_json, ...parcel.raw_data_json };
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
