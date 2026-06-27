// src/utils/sl-assessor/parser.ts
// Pure HTML → typed parcel data. Two entrypoints:
//   parseParcelList(html) → ParcelSummary[]   (from query.cfm result page)
//   parseParcelDetail(html) → Parcel          (from individual parcel page)
// Both throw AssessorParseError on irrecoverable mismatches.
//
// Implementation note: Salt Lake County Assessor renders results in plain
// HTML tables. The parser uses regex / DOM-string scanning rather than
// pulling in a DOM lib (Workers don't ship cheerio or jsdom).

import { AssessorParseError } from './types';
import type { OwnerType, Parcel, ParcelSale, ParcelSummary } from './types';

const ENTITY_TOKENS = /\b(LLC|L\.L\.C\.|INC|INCORPORATED|CORP|CORPORATION|TRUST|LP|LLP|LTD|HOLDINGS|GROUP|COMPANY|CO|FOUNDATION|CHURCH)\b/;
const PARCEL_NO_RE = /(\d{2}-\d{2}-\d{3}-\d{3})/;

export function inferOwnerType(name: string | null | undefined): OwnerType {
  if (!name || !name.trim()) return 'unknown';
  const parts = name.split(/\s*&\s*|\s+AND\s+/i).filter(Boolean);
  const flags = parts.map((p) => ENTITY_TOKENS.test(p.toUpperCase()));
  const hasEntity = flags.some(Boolean);
  const hasPerson = flags.some((f) => !f);
  if (hasEntity && hasPerson) return 'mixed';
  if (hasEntity) return 'entity';
  return 'individual';
}

/** Strip HTML tags + collapse whitespace from a chunk. */
function stripTags(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function toInt(s: string | null | undefined): number | null {
  if (!s) return null;
  const n = parseInt(s.replace(/[$,]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}
function toFloat(s: string | null | undefined): number | null {
  if (!s) return null;
  const n = parseFloat(s.replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse the result-list HTML returned by query.cfm. Looks for table rows
 * containing a parcel number pattern; pulls owner + situs + sqft + value
 * from the surrounding cells.
 */
export function parseParcelList(html: string): ParcelSummary[] {
  if (!html || html.length < 100) return [];
  const rows = html.split(/<tr[^>]*>/i).slice(1);
  const out: ParcelSummary[] = [];
  for (const rowHtml of rows) {
    const parcelMatch = rowHtml.match(PARCEL_NO_RE);
    if (!parcelMatch) continue;
    const parcel_number = parcelMatch[1];
    const cells = rowHtml.split(/<\/?td[^>]*>/i).map(stripTags).filter(Boolean);
    if (cells.length < 2) continue;
    // Detail URL: search the row for a link to the parcel detail page
    const linkMatch = rowHtml.match(/href="([^"]+parcel[^"]*)"/i);
    const detail_url = linkMatch ? linkMatch[1] : `?parcel=${parcel_number}`;
    // Heuristic cell map: parcel #, owner, situs, sqft, value (order varies — pick by content)
    const owner = cells.find((c) => /[A-Z]{3,}/.test(c) && c.length > 3 && !c.match(PARCEL_NO_RE)) ?? null;
    const situs = cells.find((c) => /\d+\s+[NSEW]?\s*\d?/.test(c) && !c.match(PARCEL_NO_RE)) ?? null;
    const sqftCell = cells.find((c) => /^\d{3,7}$/.test(c.replace(/,/g, '')));
    const valueCell = cells.find((c) => /^\$/.test(c) || /^\d{1,3}(,\d{3})+$/.test(c));
    out.push({
      parcel_number,
      owner_of_record: owner,
      situs_address: situs,
      land_sqft: toInt(sqftCell ?? null),
      total_market_value: toInt(valueCell ?? null),
      detail_url,
    });
  }
  return out;
}

/** Pull a labelled value from a key/value-table HTML chunk. */
function pullByLabel(html: string, label: RegExp): string | null {
  // Wrap caller's regex in a non-capturing group so caller-side capture groups
  // (e.g. /(land\s*)?sq\s*ft/) don't shift the value-cell capture index.
  // `s` (dotAll) flag lets `.*?` match across newlines inside the value cell.
  // Value cells on valuationInfoExpanded.cfm often contain anchor tags like
  //   <a href="javascript:newwin(...)">14.65</a>
  // so `[^<]+` would miss them; `(.*?)` + stripTags() handles both cases.
  const re = new RegExp(
    `<t[dh][^>]*>[^<]*(?:${label.source})[^<]*<\\/t[dh]>\\s*<t[dh][^>]*>(.*?)<\\/t[dh]>`,
    'is',
  );
  const m = html.match(re);
  if (!m) return null;
  // The value cell is always the LAST capture group.
  const valueCell = m[m.length - 1];
  return valueCell ? stripTags(valueCell) : null;
}

export function parseParcelDetail(html: string): Parcel {
  if (!html || html.length < 200) {
    throw new AssessorParseError('detail page too short', html.slice(0, 200));
  }
  const parcelMatch = html.match(PARCEL_NO_RE);
  if (!parcelMatch) {
    throw new AssessorParseError('no parcel number on detail page', html.slice(0, 500));
  }
  const parcel_number = parcelMatch[1];
  const owner_of_record = pullByLabel(html, /owner/i);
  // Build raw_data_json from every labelled key/value we can detect
  const raw_data_json: Record<string, string> = {};
  const kvRe = /<t[dh][^>]*>([^<]{2,80})<\/t[dh]>\s*<t[dh][^>]*>(.*?)<\/t[dh]>/gis;
  let m: RegExpExecArray | null;
  while ((m = kvRe.exec(html)) !== null) {
    const k = stripTags(m[1]).replace(/[:\s]+$/, '');
    const v = stripTags(m[2]);
    if (k && v) raw_data_json[k] = v;
  }
  // Parse sales history table — rows after a "Sale History" heading
  const sales: ParcelSale[] = [];
  const salesIdx = html.search(/sale\s*history/i);
  if (salesIdx > 0) {
    const tail = html.slice(salesIdx);
    const saleRows = tail.split(/<tr[^>]*>/i).slice(1);
    for (const row of saleRows.slice(0, 50)) {
      const cells = row.split(/<\/?td[^>]*>/i).map(stripTags).filter(Boolean);
      if (cells.length < 2) continue;
      // Heuristic: first cell that parses as a date is the sale_date,
      // first $-prefixed or digit-grouped cell is the price.
      const dateCell = cells.find((c) => /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(c));
      const priceCell = cells.find((c) => /^\$?\d{1,3}(,\d{3})+(\.\d{2})?$/.test(c));
      if (!dateCell && !priceCell) continue;
      sales.push({
        sale_date: dateCell ?? null,
        sale_price: toInt(priceCell ?? null),
        doc_number: cells.find((c) => /^\d{6,}$/.test(c)) ?? null,
        buyer: null,
        seller: null,
        sale_type: null,
      });
    }
  }
  return {
    parcel_number,
    source: 'sl_county_assessor',
    source_url: '',  // filled by client
    account_number: pullByLabel(html, /account/i),
    serial_number: pullByLabel(html, /serial/i),
    tax_district: pullByLabel(html, /tax\s*district/i),
    owner_of_record,
    owner_type: inferOwnerType(owner_of_record),
    owner_mailing_address: pullByLabel(html, /mail/i),
    situs_address: pullByLabel(html, /situs|property\s*address/i),
    situs_city: pullByLabel(html, /city/i),
    situs_zip: pullByLabel(html, /zip/i),
    subdivision: pullByLabel(html, /subdivision/i),
    land_acres: toFloat(pullByLabel(html, /acres/i)),
    land_sqft: toInt(pullByLabel(html, /(land\s*)?sq\s*ft|square\s*feet/i)),
    land_value: toInt(pullByLabel(html, /land\s*value/i)),
    zoning: pullByLabel(html, /zoning/i),
    year_built: toInt(pullByLabel(html, /year\s*built/i)),
    effective_year_built: toInt(pullByLabel(html, /effective\s*year/i)),
    total_bldg_sqft: toInt(pullByLabel(html, /total.*sq\s*ft|building\s*sq/i)),
    finished_sqft: toInt(pullByLabel(html, /finished/i)),
    basement_sqft: toInt(pullByLabel(html, /basement/i)),
    garage_sqft: toInt(pullByLabel(html, /garage/i)),
    stories: toFloat(pullByLabel(html, /stories/i)),
    bedrooms: toInt(pullByLabel(html, /bedrooms?/i)),
    bathrooms: toFloat(pullByLabel(html, /bathrooms?/i)),
    construction_type: pullByLabel(html, /construction/i),
    improvement_class: pullByLabel(html, /improvement\s*class/i),
    improvement_value: toInt(pullByLabel(html, /improvement\s*value/i)),
    market_value_total: toInt(pullByLabel(html, /(total\s*)?market\s*value/i)),
    market_value_land: toInt(pullByLabel(html, /market.*land/i)),
    market_value_improvement: toInt(pullByLabel(html, /market.*improvement/i)),
    taxable_value: toInt(pullByLabel(html, /taxable\s*value/i)),
    assessed_value: toInt(pullByLabel(html, /assessed\s*value/i)),
    tax_year: toInt(pullByLabel(html, /tax\s*year/i)),
    legal_description: pullByLabel(html, /legal\s*desc/i),
    plat: pullByLabel(html, /plat/i),
    lot: pullByLabel(html, /lot/i),
    block: pullByLabel(html, /block/i),
    sales,
    raw_data_json,
  };
}
