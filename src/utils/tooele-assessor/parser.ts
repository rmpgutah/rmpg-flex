// Tooele County has no assessor valuation site at the given URL — only a
// Recorder document index (grantor/grantee, legal description, recorded
// document link). AUTOFILL_FIELDS in autofill.ts is deliberately a subset
// for this source; every value field this parser doesn't set stays null
// rather than being guessed.

import type { Parcel, ParcelSummary } from '../parcel-lookup/types';
import { AssessorParseError } from '../parcel-lookup/types';

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

export function parseParcelDetail(html: string): Parcel {
  const rows = extractRows(html);
  const parcelNumber = rows['Parcel Number'];
  if (!parcelNumber) {
    throw new AssessorParseError('no Parcel Number found in Tooele County recorder page', html.slice(0, 500));
  }

  return {
    parcel_number: parcelNumber,
    source: 'tooele_county_recorder',
    source_url: '',
    account_number: null,
    serial_number: null,
    tax_district: null,
    owner_of_record: rows['Grantee'] ?? null,
    owner_type: 'unknown',
    owner_mailing_address: rows['Mailing Address'] ?? null,
    situs_address: null,
    situs_city: null,
    situs_zip: null,
    subdivision: null,
    land_acres: null,
    land_sqft: null,
    land_value: null,
    zoning: null,
    year_built: null,
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
    market_value_total: null,
    market_value_land: null,
    market_value_improvement: null,
    taxable_value: null,
    assessed_value: null,
    tax_year: null,
    legal_description: rows['Legal Description'] ?? null,
    plat: null,
    lot: null,
    block: null,
    recorded_document_url: rows['Document Link'] ?? null,
    recorded_document_type: rows['Document Type'] ?? null,
    sales: [],
    raw_data_json: rows,
  };
}

export function parseParcelList(html: string): ParcelSummary[] {
  const results: ParcelSummary[] = [];
  const rowRe = /<tr>\s*<td>\s*([\d-]+)\s*<\/td>\s*<td>\s*([^<]*)\s*<\/td>\s*<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html))) {
    results.push({
      parcel_number: m[1].trim(),
      owner_of_record: m[2].trim() || null,
      situs_address: null,
      land_sqft: null,
      total_market_value: null,
      detail_url: `https://erecording.tooeleco.gov/eaglesoftware/web/?parcel=${m[1].trim()}`,
    });
  }
  return results;
}
