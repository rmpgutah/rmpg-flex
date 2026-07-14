// Tolerant label-driven parser for Utah County's ASP Land Records detail
// page. No DOM library (Workers don't ship cheerio/jsdom) — every field is
// pulled via a label→value regex, and every row is also captured into
// raw_data_json for forward-compat with fields we haven't typed yet.

import type { Parcel, ParcelSummary, OwnerType } from '../parcel-lookup/types';
import { AssessorParseError } from '../parcel-lookup/types';

const ENTITY_MARKERS = /\b(LLC|INC|CORP|TRUST|LP|LLP|LTD|CO)\b/i;

function inferOwnerType(name: string | null): OwnerType {
  if (!name) return 'unknown';
  return ENTITY_MARKERS.test(name) ? 'entity' : 'individual';
}

/** Pull every `<td>Label:</td><td>Value</td>` row into a flat map. */
function extractRows(html: string): Record<string, string> {
  const rows: Record<string, string> = {};
  const re = /<td>\s*([^<:]+):\s*<\/td>\s*<td>\s*([^<]*?)\s*<\/td>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const label = m[1].trim();
    const value = m[2].trim();
    if (label) rows[label] = value;
  }
  return rows;
}

/**
 * Best-effort: find an `<img src="...">` inside the value cell of a
 * `<td>Label:</td><td><img src="X"></td>` row. Most county detail pages
 * don't expose a photo/sketch at all — this returns null in that case
 * rather than guessing, matching the raw_data_json catch-all philosophy.
 */
function extractImageByLabel(html: string, labelRegex: RegExp): string | null {
  const re = new RegExp(
    `<td>\\s*(?:${labelRegex.source})\\s*:?\\s*<\\/td>\\s*<td[^>]*>[^<]*<img[^>]+src="([^"]+)"`,
    'i',
  );
  const m = html.match(re);
  return m ? m[1] : null;
}

function toNumber(v: string | undefined): number | null {
  if (!v) return null;
  const cleaned = v.replace(/[$,]/g, '').trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function toDateIso(v: string | undefined): string | null {
  if (!v) return null;
  const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

export function parseParcelDetail(html: string): Parcel {
  const rows = extractRows(html);
  const parcelNumber = rows['Serial Number'];
  if (!parcelNumber) {
    throw new AssessorParseError('no Serial Number found in Utah County detail page', html.slice(0, 500));
  }

  const owner = rows['Owner Name'] ?? null;
  const saleDate = toDateIso(rows['Last Sale Date']);
  const salePrice = toNumber(rows['Last Sale Price']);

  return {
    parcel_number: parcelNumber,
    source: 'utah_county_assessor',
    source_url: '',
    account_number: null,
    serial_number: parcelNumber,
    tax_district: rows['Tax District'] ?? null,
    owner_of_record: owner,
    owner_type: inferOwnerType(owner),
    owner_mailing_address: rows['Mailing Address'] ?? null,
    situs_address: rows['Property Address'] ?? null,
    situs_city: rows['City'] ?? null,
    situs_zip: rows['Zip'] ?? null,
    subdivision: null,
    land_acres: toNumber(rows['Acreage']),
    land_sqft: null,
    land_value: toNumber(rows['Land Value']),
    zoning: null,
    year_built: toNumber(rows['Year Built']),
    effective_year_built: null,
    total_bldg_sqft: null,
    finished_sqft: null,
    basement_sqft: null,
    garage_sqft: null,
    stories: null,
    bedrooms: null,
    bathrooms: null,
    construction_type: null,
    improvement_class: null,
    improvement_value: null,
    market_value_total: toNumber(rows['Total Value']),
    market_value_land: toNumber(rows['Land Value']),
    market_value_improvement: null,
    taxable_value: null,
    assessed_value: null,
    tax_year: null,
    legal_description: rows['Legal Description'] ?? null,
    plat: null,
    lot: null,
    block: null,
    recorded_document_url: null,
    recorded_document_type: null,
    photo_url: extractImageByLabel(html, /Photo|Property\s*Photo/i),
    layout_url: extractImageByLabel(html, /Sketch|Floor\s*Plan|Layout/i),
    sales: saleDate || salePrice ? [{
      sale_date: saleDate,
      sale_price: salePrice,
      doc_number: null,
      buyer: owner,
      seller: null,
      sale_type: null,
    }] : [],
    raw_data_json: rows,
  };
}

/** Multi-result list page — same row-table shape, one row per parcel. */
export function parseParcelList(html: string): ParcelSummary[] {
  const results: ParcelSummary[] = [];
  const rowRe = /<tr>\s*<td>\s*([\d:]+)\s*<\/td>\s*<td>\s*([^<]*)\s*<\/td>\s*<td>\s*([^<]*)\s*<\/td>\s*<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html))) {
    results.push({
      parcel_number: m[1].trim(),
      owner_of_record: m[2].trim() || null,
      situs_address: m[3].trim() || null,
      land_sqft: null,
      total_market_value: null,
      detail_url: `https://www.utahcounty.gov/LandRecords/PropertyForm.asp?serial_no=${m[1].trim()}`,
    });
  }
  return results;
}
