// Tolerant label-driven parser for Summit County's Eagle Software TaxWeb
// detail page. Same approach as utah-assessor/parser.ts — no DOM library,
// raw key/value catch-all into raw_data_json.

import type { Parcel, ParcelSummary, OwnerType } from '../parcel-lookup/types';
import { AssessorParseError } from '../parcel-lookup/types';

const ENTITY_MARKERS = /\b(LLC|INC|CORP|TRUST|LP|LLP|LTD|CO)\b/i;

function inferOwnerType(name: string | null): OwnerType {
  if (!name) return 'unknown';
  return ENTITY_MARKERS.test(name) ? 'entity' : 'individual';
}

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
  const parcelNumber = rows['Account Number'];
  if (!parcelNumber) {
    throw new AssessorParseError('no Account Number found in Summit County detail page', html.slice(0, 500));
  }

  const owner = rows['Owner'] ?? null;
  const saleDate = toDateIso(rows['Last Sale Date']);
  const salePrice = toNumber(rows['Last Sale Price']);

  return {
    parcel_number: parcelNumber,
    source: 'summit_county_assessor',
    source_url: '',
    account_number: parcelNumber,
    serial_number: null,
    tax_district: rows['Tax Area'] ?? null,
    owner_of_record: owner,
    owner_type: inferOwnerType(owner),
    owner_mailing_address: rows['Mailing Address'] ?? null,
    situs_address: rows['Situs Address'] ?? null,
    situs_city: rows['Situs City'] ?? null,
    situs_zip: rows['Situs Zip'] ?? null,
    subdivision: null,
    land_acres: null,
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
    market_value_total: toNumber(rows['Total Market Value']),
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

export function parseParcelList(html: string): ParcelSummary[] {
  const results: ParcelSummary[] = [];
  const rowRe = /<tr>\s*<td>\s*([A-Za-z0-9-]+)\s*<\/td>\s*<td>\s*([^<]*)\s*<\/td>\s*<td>\s*([^<]*)\s*<\/td>\s*<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html))) {
    results.push({
      parcel_number: m[1].trim(),
      owner_of_record: m[2].trim() || null,
      situs_address: m[3].trim() || null,
      land_sqft: null,
      total_market_value: null,
      detail_url: `https://property.summitcounty.org/eaglesoftware/taxweb/search.jsp?account=${m[1].trim()}`,
    });
  }
  return results;
}
