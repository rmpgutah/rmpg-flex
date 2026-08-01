// src/utils/sl-assessor/camaClient.ts
//
// Retrieval for the full CAMA build. Fetches the county's three complementary
// renderings and merges them into one CamaParcel (see camaParser.ts for why
// no single page is sufficient).
//
// Worker-safe: fetch + AbortController only, no node:* imports.
//
// ⚠️ PARCEL IDs MUST BE 14 DIGITS. The county's detail endpoints answer a
// 10-digit id with HTTP 200 and the SEARCH FORM — not a 404, not an error.
// Verified live 2026-08-01 against 16-31-127-029-0000:
//
//   parcel_id=1631127029      → 200, 17 KB, no owner   (search form)
//   parcel_id=16311270290000  → 200, 39 KB, owner present
//
// A 10-digit id addresses a BLOCK, and the county's own form labels the field
// "6 - 14 digits". So a truncated id degrades silently into a page that parses
// to nothing. normalizeParcelNumber() pads it and parseCamaDetail() throws on
// the search-form shape, so the failure is now loud at both ends.

import {
  parseCamaDetail, parseLandRecords, parseValueHistory, parseCoordinate,
  parseLegalDescription, extractLandRecordUrl, normalizeParcelNumber,
  type CamaParcel,
} from './camaParser';
import { mergeCama } from './camaParser';
import { AssessorHttpError, AssessorTimeoutError } from './types';
import { log } from '../logger';

const BASE = 'https://apps.saltlakecounty.gov/assessor/new';
const PUBMORE_BASE = `${BASE}/PubMore`;
const EXPANDED_BASE = `${BASE}/valuationInfoExpanded.cfm`;
const TIMEOUT_MS = 12_000;

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

/** Flat 14-digit id for URL construction. Throws rather than truncating. */
export function toParcelId(parcelNo: string): string {
  const normalized = normalizeParcelNumber(parcelNo);
  if (!normalized) {
    throw new AssessorHttpError(0, `unusable parcel number: ${parcelNo}`);
  }
  return normalized.replace(/-/g, '');
}

async function fetchHtml(url: string): Promise<string> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml' },
      signal: ctl.signal,
    });
    if (!res.ok) throw new AssessorHttpError(res.status, `CAMA fetch failed: ${url}`);
    return await res.text();
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new AssessorTimeoutError(`CAMA fetch timed out: ${url}`);
    if (e instanceof AssessorHttpError) throw e;
    throw new AssessorHttpError(0, e?.message ?? 'CAMA fetch failed');
  } finally {
    clearTimeout(t);
  }
}

export interface CamaFetchResult {
  parcel: CamaParcel;
  /** Which sources actually contributed — surfaced so a partial build is
   *  visible in the record rather than looking like missing county data. */
  sources: string[];
  /** Sources that failed. A degraded build is NOT an error: the primary
   *  page alone is still 96 of 146 fields. */
  degraded: string[];
}

/**
 * Build the complete CAMA record for a parcel.
 *
 * The PRIMARY page is required — if it fails, the whole call fails, because
 * without it there is no parcel. The two enrichment pages are best-effort and
 * each failure is recorded in `degraded` instead of throwing. This asymmetry
 * is deliberate: an officer looking up a property should still get 54
 * residence fields when the coordinates endpoint is briefly down.
 */
export async function fetchCamaParcel(parcelNo: string): Promise<CamaFetchResult> {
  const parcelId = toParcelId(parcelNo);
  const sources: string[] = [];
  const degraded: string[] = [];

  // ── Primary: the More Details Report ───────────────────────────────────
  const pubmoreUrl = `${PUBMORE_BASE}/detail.cfm?parcel_id=${parcelId}`;
  const pubmoreHtml = await fetchHtml(pubmoreUrl);
  let parcel = parseCamaDetail(pubmoreHtml);   // throws on the search-form shape
  sources.push('PubMore/detail.cfm');

  // ── Enrichment 1: every land record beyond the first ───────────────────
  // The main report renders "1 of N" and shows record 1 only; the
  // continuation link carries the link_id we cannot construct ourselves.
  const landPath = extractLandRecordUrl(pubmoreHtml);
  if (landPath) {
    try {
      const landHtml = await fetchHtml(`${PUBMORE_BASE}/${landPath}`);
      const landRecords = parseLandRecords(landHtml);
      if (landRecords.length) {
        parcel = mergeCama(parcel, { land_records: landRecords });
        sources.push('PubMore/landRecord2.cfm');
      }
    } catch (err) {
      degraded.push('PubMore/landRecord2.cfm');
      log.warn('[cama] land-record continuation failed', {
        parcel: parcelNo, error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── Enrichment 2: coordinates, legal description, taxable value ────────
  // None of these exist on the More Details Report at all.
  try {
    const expandedHtml = await fetchHtml(`${EXPANDED_BASE}?parcel_id=${parcelId}`);
    parcel = mergeCama(parcel, {
      latitude: parseCoordinate(expandedHtml, 'polyx'),
      longitude: parseCoordinate(expandedHtml, 'polyy'),
      legal_description: parseLegalDescription(expandedHtml),
      value_history: parseValueHistory(expandedHtml),
    });
    sources.push('valuationInfoExpanded.cfm');
  } catch (err) {
    degraded.push('valuationInfoExpanded.cfm');
    log.warn('[cama] expanded page failed', {
      parcel: parcelNo, error: err instanceof Error ? err.message : String(err),
    });
  }

  parcel.cama_source_variant = sources.join('+');
  return { parcel, sources, degraded };
}
