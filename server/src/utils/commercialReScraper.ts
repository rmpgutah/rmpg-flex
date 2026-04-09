// ============================================================
// Commercial Real Estate / County Assessor Scraper
// ============================================================
// Scrapes Salt Lake County assessor public records for
// commercial property data. Targets properties with recent
// activity (sales, permits, zoning changes) as security leads.
//
// Source key: commercial_re
// Rate: 3s between requests
// ============================================================

import {
  fetchWithTimeout,
  sleep,
  upsertLead,
  registerScraper,
  getSourceConfig,
  type ScrapeResult,
} from './leadScraperBase';

// ── Constants ───────────────────────────────────────────────

const SOURCE_KEY = 'commercial_re';
const REQUEST_DELAY_MS = 3_000;
const MAX_RECORDS_PER_CYCLE = 150;

// Salt Lake County assessor / GIS endpoints
const ASSESSOR_ENDPOINTS = [
  'https://slco.org/assessor/new/api/property/search',
  'https://gis.slco.org/arcgis/rest/services/Assessor/CommercialParcels/MapServer/0/query',
  'https://opendata.slco.org/resource/parcels.json',
];

// ── Types ───────────────────────────────────────────────────

interface PropertyRecord {
  parcelNumber: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  propertyType: string;
  assessedValue: number;
  marketValue: number;
  ownerName: string;
  ownerAddress: string;
  lastSaleDate: string;
  lastSalePrice: number;
  zoning: string;
  sqft: string;
  yearBuilt: string;
  latitude?: number;
  longitude?: number;
}

// ── JSON Parsing ────────────────────────────────────────────

/**
 * Parse ArcGIS REST API response for commercial parcels.
 */
function parseArcGisResponse(data: any): PropertyRecord[] {
  const records: PropertyRecord[] = [];
  const features = data?.features || [];

  for (const feature of features) {
    const attrs = feature.attributes || feature.properties || {};
    const geom = feature.geometry || {};

    const parcelNumber = attrs.PARCEL_ID || attrs.ParcelNumber || attrs.parcel_number || attrs.PARCEL_NO || attrs.PIN || '';
    if (!parcelNumber) continue;

    const propertyType = attrs.PROPERTY_TYPE || attrs.PropertyType || attrs.property_type || attrs.LAND_USE || attrs.USE_CODE || '';
    if (!isCommercialProperty(propertyType)) continue;

    const assessedValue = parseFloat(attrs.ASSESSED_VALUE || attrs.AssessedValue || attrs.assessed_value || attrs.TOTAL_ASSESSED || '0') || 0;
    const marketValue = parseFloat(attrs.MARKET_VALUE || attrs.MarketValue || attrs.market_value || attrs.TOTAL_MARKET || '0') || 0;

    records.push({
      parcelNumber: String(parcelNumber),
      address: attrs.ADDRESS || attrs.SITUS_ADDRESS || attrs.address || attrs.LOCATION || '',
      city: attrs.CITY || attrs.SITUS_CITY || attrs.city || 'Salt Lake City',
      state: 'UT',
      zip: attrs.ZIP || attrs.SITUS_ZIP || attrs.zip || '',
      propertyType,
      assessedValue,
      marketValue,
      ownerName: attrs.OWNER || attrs.OWNER_NAME || attrs.owner_name || '',
      ownerAddress: attrs.OWNER_ADDRESS || attrs.MAIL_ADDRESS || '',
      lastSaleDate: normalizeDate(attrs.SALE_DATE || attrs.LAST_SALE_DATE || attrs.sale_date || ''),
      lastSalePrice: parseFloat(attrs.SALE_PRICE || attrs.LAST_SALE_PRICE || attrs.sale_price || '0') || 0,
      zoning: attrs.ZONING || attrs.ZONE || attrs.zoning || '',
      sqft: attrs.SQFT || attrs.BUILDING_SQFT || attrs.sqft || '',
      yearBuilt: attrs.YEAR_BUILT || attrs.year_built || attrs.YR_BUILT || '',
      latitude: geom.y ?? geom.lat ?? undefined,
      longitude: geom.x ?? geom.lng ?? geom.lon ?? undefined,
    });
  }

  return records;
}

/**
 * Parse Socrata-style JSON response.
 */
function parseSocrataResponse(data: any[]): PropertyRecord[] {
  const records: PropertyRecord[] = [];

  for (const row of data) {
    const parcelNumber = row.parcel_number || row.parcel_id || row.pin || '';
    if (!parcelNumber) continue;

    const propertyType = row.property_type || row.land_use || row.use_code || '';
    if (!isCommercialProperty(propertyType)) continue;

    records.push({
      parcelNumber: String(parcelNumber),
      address: row.address || row.situs_address || '',
      city: row.city || row.situs_city || 'Salt Lake City',
      state: 'UT',
      zip: row.zip || row.situs_zip || '',
      propertyType,
      assessedValue: parseFloat(row.assessed_value || row.total_assessed || '0') || 0,
      marketValue: parseFloat(row.market_value || row.total_market || '0') || 0,
      ownerName: row.owner || row.owner_name || '',
      ownerAddress: row.owner_address || row.mail_address || '',
      lastSaleDate: normalizeDate(row.sale_date || row.last_sale_date || ''),
      lastSalePrice: parseFloat(row.sale_price || row.last_sale_price || '0') || 0,
      zoning: row.zoning || row.zone || '',
      sqft: row.sqft || row.building_sqft || '',
      yearBuilt: row.year_built || row.yr_built || '',
    });
  }

  return records;
}

/**
 * Parse HTML assessor search results as a fallback.
 */
function parseHtmlResults(html: string): PropertyRecord[] {
  const records: PropertyRecord[] = [];

  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const row = rowMatch[1];
    const cells: string[] = [];
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch: RegExpExecArray | null;

    while ((cellMatch = cellRegex.exec(row)) !== null) {
      cells.push(stripHtml(cellMatch[1]).trim());
    }

    if (cells.length < 3) continue;

    // Try to extract parcel number (typically numeric pattern like 16-12-345-001)
    const parcelIdx = cells.findIndex(c => /^\d{2}[\-\.]\d{2}[\-\.]\d{3}[\-\.]\d{3}/.test(c) || /^\d{8,}/.test(c));
    if (parcelIdx < 0) continue;

    const parcelNumber = cells[parcelIdx];
    const remaining = [...cells.slice(0, parcelIdx), ...cells.slice(parcelIdx + 1)];

    // Address contains street number
    const addrIdx = remaining.findIndex(c => /^\d+\s+\w/.test(c));
    const address = addrIdx >= 0 ? remaining[addrIdx] : '';

    // Owner name
    const ownerIdx = remaining.findIndex(c => c.length > 3 && /^[A-Z]/.test(c) && c !== address);
    const ownerName = ownerIdx >= 0 ? remaining[ownerIdx] : '';

    // Value
    const valueIdx = remaining.findIndex(c => /^\$?[\d,]+$/.test(c.replace(/[,\$]/g, '')));
    const assessedValue = valueIdx >= 0 ? parseFloat(remaining[valueIdx].replace(/[,\$]/g, '')) : 0;

    records.push({
      parcelNumber,
      address,
      city: '',
      state: 'UT',
      zip: '',
      propertyType: 'commercial',
      assessedValue,
      marketValue: 0,
      ownerName,
      ownerAddress: '',
      lastSaleDate: '',
      lastSalePrice: 0,
      zoning: '',
      sqft: '',
      yearBuilt: '',
    });
  }

  return records;
}

// ── Utility Helpers ─────────────────────────────────────────

function isCommercialProperty(type: string): boolean {
  const lower = (type || '').toLowerCase();
  const commercialTerms = [
    'commercial', 'retail', 'office', 'industrial', 'warehouse',
    'mixed use', 'mixed-use', 'hotel', 'motel', 'restaurant',
    'shopping', 'strip mall', 'medical', 'hospital', 'church',
    'school', 'institutional', 'multi-family', 'apartment',
    'condo', 'parking', 'storage', 'manufacturing',
  ];
  const excludeTerms = ['vacant land', 'agricultural', 'farm'];

  if (excludeTerms.some(t => lower.includes(t))) return false;
  return commercialTerms.some(t => lower.includes(t));
}

function normalizeDate(dateStr: string): string {
  if (!dateStr) return '';
  if (dateStr.includes('T')) return dateStr.slice(0, 10);
  if (/^\d{13}$/.test(dateStr)) return new Date(parseInt(dateStr, 10)).toISOString().slice(0, 10);
  const m = dateStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return dateStr;
}

function stripHtml(html: string): string {
  return (html || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#?\w+;/g, '').trim();
}

// ── Main Scraper Function ───────────────────────────────────

export async function scrapeCommercialRe(): Promise<ScrapeResult> {
  const startTime = Date.now();
  let totalFound = 0;
  let totalImported = 0;
  let totalSkipped = 0;
  let lastError: string | undefined;

  const config = getSourceConfig(SOURCE_KEY);
  let extraConfig: any = {};
  try { if (config?.extra_config) extraConfig = JSON.parse(config.extra_config); } catch { /* malformed config — use defaults */ }
  const minValue = extraConfig.min_value || 100_000;

  let fetched = false;

  for (const endpoint of ASSESSOR_ENDPOINTS) {
    if (fetched) break;

    try {
      let url: string;
      let records: PropertyRecord[] = [];

      if (endpoint.includes('arcgis')) {
        const params = new URLSearchParams({
          where: `TOTAL_ASSESSED >= ${minValue}`,
          outFields: '*',
          returnGeometry: 'true',
          f: 'json',
          resultRecordCount: String(MAX_RECORDS_PER_CYCLE),
          orderByFields: 'TOTAL_ASSESSED DESC',
        });
        url = `${endpoint}?${params}`;

        console.log(`[CommercialRE] Querying ArcGIS endpoint...`);
        const res = await fetchWithTimeout(url);
        if (!res.ok) {
          console.warn(`[CommercialRE] ArcGIS HTTP ${res.status}, trying next endpoint`);
          await sleep(REQUEST_DELAY_MS);
          continue;
        }

        const data = await res.json();
        records = parseArcGisResponse(data);
        fetched = true;
      } else if (endpoint.includes('opendata')) {
        const params = new URLSearchParams({
          '$where': `assessed_value >= ${minValue}`,
          '$limit': String(MAX_RECORDS_PER_CYCLE),
          '$order': 'assessed_value DESC',
        });
        url = `${endpoint}?${params}`;

        console.log(`[CommercialRE] Querying Socrata endpoint...`);
        const res = await fetchWithTimeout(url);
        if (!res.ok) {
          console.warn(`[CommercialRE] Socrata HTTP ${res.status}, trying next endpoint`);
          await sleep(REQUEST_DELAY_MS);
          continue;
        }

        const data = await res.json();
        if (Array.isArray(data)) {
          records = parseSocrataResponse(data);
          fetched = true;
        }
      } else {
        url = endpoint;
        console.log(`[CommercialRE] Querying assessor website...`);
        const res = await fetchWithTimeout(url, {
          headers: { Accept: 'text/html, application/json' },
        });
        if (!res.ok) {
          console.warn(`[CommercialRE] Assessor HTTP ${res.status}, trying next endpoint`);
          await sleep(REQUEST_DELAY_MS);
          continue;
        }

        const contentType = res.headers.get('content-type') || '';
        const body = await res.text();

        if (contentType.includes('json')) {
          try {
            const data = JSON.parse(body);
            records = Array.isArray(data) ? parseSocrataResponse(data) : parseArcGisResponse(data);
          } catch (e: any) {
            console.warn('[CommercialRE] Parse failure:', e?.message);
          }
        } else {
          records = parseHtmlResults(body);
        }

        if (records.length > 0) fetched = true;
      }

      totalFound += records.length;

      for (const prop of records) {
        if (!prop.parcelNumber) {
          totalSkipped++;
          continue;
        }

        try {
          const businessName = prop.ownerName || `Property ${prop.parcelNumber}`;
          const estimatedValue = prop.marketValue || prop.assessedValue || prop.lastSalePrice;

          const result = upsertLead({
            source: SOURCE_KEY,
            source_id: prop.parcelNumber,
            business_name: businessName,
            business_type: prop.propertyType,
            industry: 'real_estate',
            contact_name: prop.ownerName || undefined,
            address: prop.address || undefined,
            city: prop.city || undefined,
            state: 'UT',
            zip: prop.zip || undefined,
            latitude: prop.latitude,
            longitude: prop.longitude,
            estimated_value: estimatedValue || undefined,
            property_size: prop.sqft || undefined,
            project_type: prop.zoning || undefined,
            notes: [
              prop.yearBuilt ? `Built: ${prop.yearBuilt}` : '',
              prop.lastSaleDate ? `Last sale: ${prop.lastSaleDate}` : '',
              prop.lastSalePrice ? `Sale price: $${prop.lastSalePrice.toLocaleString()}` : '',
            ].filter(Boolean).join('; ') || undefined,
          });

          if (result.inserted) {
            totalImported++;
          } else {
            totalSkipped++;
          }
        } catch (err: any) {
          totalSkipped++;
          console.warn(`[CommercialRE] Failed to upsert parcel ${prop.parcelNumber}: ${err.message}`);
        }

        await sleep(100);
      }
    } catch (err: any) {
      lastError = `${endpoint}: ${err.message}`;
      console.warn(`[CommercialRE] Endpoint failed: ${lastError}`);
    }

    await sleep(REQUEST_DELAY_MS);
  }

  if (!fetched && !lastError) {
    lastError = 'No data endpoints responded successfully';
  }

  const durationMs = Date.now() - startTime;
  const status = lastError && totalImported === 0 ? 'error' : totalImported > 0 ? 'success' : 'partial';

  console.log(`[CommercialRE] Complete: found=${totalFound} imported=${totalImported} skipped=${totalSkipped} (${durationMs}ms)`);

  return {
    source_key: SOURCE_KEY,
    status,
    records_found: totalFound,
    records_imported: totalImported,
    records_skipped: totalSkipped,
    error_message: lastError,
    duration_ms: durationMs,
  };
}

// ── Register with scheduler ─────────────────────────────────
registerScraper(SOURCE_KEY, scrapeCommercialRe);
