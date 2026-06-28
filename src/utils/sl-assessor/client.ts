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
  'ST', 'AVE', 'BLVD', 'DR', 'LN', 'RD', 'CT', 'CIR', 'PL', 'WAY',
  'TRL', 'HWY', 'PKWY', 'SQ', 'LOOP', 'PASS', 'PATH', 'XING', 'HTS',
]);
const TYPE_EXPAND: Record<string, string> = {
  STREET: 'ST', AVENUE: 'AVE', BOULEVARD: 'BLVD', DRIVE: 'DR',
  LANE: 'LN', ROAD: 'RD', COURT: 'CT', CIRCLE: 'CIR', PLACE: 'PL',
  TRAIL: 'TRL', HIGHWAY: 'HWY', PARKWAY: 'PKWY', SQUARE: 'SQ', HEIGHTS: 'HTS',
};

export interface AddressComponents {
  street_Num: string;
  street_dir: string;
  street_name: string;
  street_type: string;
}

export function parseAddressComponents(address: string): AddressComponents {
  const parts = address
    .toUpperCase()
    .replace(/[.,#]+/g, '')
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
    const normType = TYPE_EXPAND[last] ?? last;
    if (STREET_TYPES.has(normType) || DIRS.has(normType)) {
      street_type = normType;
      street_name = rest.slice(0, -1).join(' ');
    } else {
      street_name = rest.join(' ');
    }
  }

  return { street_Num, street_dir, street_name, street_type };
}

/** Convert "16-18-355-003-0000" → "16183550030000" for valuationInfoExpanded URLs. */
function parcelNoToId(parcelNo: string): string {
  return parcelNo.replace(/-/g, '');
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

  for (const fields of attempts) {
    let res: Response;
    try {
      res = await fetchPost(fields);
    } catch { continue; }

    if (res.url.includes('valuationInfoExpanded.cfm')) {
      // Single-result redirect — fetch() resolved the 302 automatically.
      // Parse the full detail HTML and synthesize a summary.
      try {
        const html = await res.text();
        const parcel = parseParcelDetail(html);
        parcel.source_url = res.url;
        return [{
          parcel_number: parcel.parcel_number,
          owner_of_record: parcel.owner_of_record,
          situs_address: parcel.situs_address,
          land_sqft: parcel.land_sqft,
          total_market_value: parcel.market_value_total,
          detail_url: res.url,
        }];
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

  return [];
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
  return parcel;
}
