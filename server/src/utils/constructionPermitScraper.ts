// ============================================================
// Salt Lake County Construction Permit Scraper
// ============================================================
// Scrapes construction permit data from Salt Lake County open
// data / GIS endpoints. Targets commercial permits with values
// over $50k as potential security service leads.
//
// Source key: slc_permits
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

const SOURCE_KEY = 'slc_permits';
const REQUEST_DELAY_MS = 3_000;
const MIN_VALUE = 50_000;
const MAX_RECORDS_PER_CYCLE = 200;

// Open data API endpoints (ArcGIS REST or Socrata patterns)
const API_ENDPOINTS = [
  'https://gis.slco.org/arcgis/rest/services/BuildingPermits/MapServer/0/query',
  'https://opendata.slco.org/resource/permits.json',
];

// ── Types ───────────────────────────────────────────────────

interface PermitRecord {
  permitNumber: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  projectType: string;
  description: string;
  estimatedValue: number;
  contractorName: string;
  issueDate: string;
  ownerName: string;
  latitude?: number;
  longitude?: number;
}

// ── JSON Parsing ────────────────────────────────────────────

/**
 * Parse ArcGIS REST API response for construction permits.
 */
function parseArcGisResponse(data: any): PermitRecord[] {
  const records: PermitRecord[] = [];
  const features = data?.features || [];

  for (const feature of features) {
    const attrs = feature.attributes || feature.properties || {};
    const geom = feature.geometry || {};

    const permitNumber = attrs.PERMIT_NUM || attrs.PermitNumber || attrs.permit_number || attrs.PERMIT_NO || '';
    if (!permitNumber) continue;

    const estimatedValue = parseFloat(attrs.EST_VALUE || attrs.EstimatedValue || attrs.estimated_value || attrs.VALUATION || '0') || 0;
    if (estimatedValue < MIN_VALUE) continue;

    const projectType = (attrs.PERMIT_TYPE || attrs.PermitType || attrs.permit_type || attrs.TYPE || '').toString();
    // Filter: commercial permits only
    if (!isCommercialPermit(projectType, attrs.DESCRIPTION || attrs.description || '')) continue;

    records.push({
      permitNumber: String(permitNumber),
      address: attrs.ADDRESS || attrs.address || attrs.LOCATION || '',
      city: attrs.CITY || attrs.city || 'Salt Lake City',
      state: 'UT',
      zip: attrs.ZIP || attrs.zip || attrs.ZIP_CODE || '',
      projectType,
      description: attrs.DESCRIPTION || attrs.description || attrs.WORK_DESC || '',
      estimatedValue,
      contractorName: attrs.CONTRACTOR || attrs.contractor_name || attrs.CONTRACTOR_NAME || '',
      issueDate: normalizeDate(attrs.ISSUE_DATE || attrs.issue_date || attrs.IssuedDate || ''),
      ownerName: attrs.OWNER || attrs.owner_name || attrs.OWNER_NAME || '',
      latitude: geom.y || geom.lat || undefined,
      longitude: geom.x || geom.lng || geom.lon || undefined,
    });
  }

  return records;
}

/**
 * Parse Socrata-style JSON response.
 */
function parseSocrataResponse(data: any[]): PermitRecord[] {
  const records: PermitRecord[] = [];

  for (const row of data) {
    const permitNumber = row.permit_number || row.permit_num || row.id || '';
    if (!permitNumber) continue;

    const estimatedValue = parseFloat(row.estimated_value || row.valuation || row.est_value || '0') || 0;
    if (estimatedValue < MIN_VALUE) continue;

    const projectType = row.permit_type || row.type || row.project_type || '';
    if (!isCommercialPermit(projectType, row.description || '')) continue;

    records.push({
      permitNumber: String(permitNumber),
      address: row.address || row.location || '',
      city: row.city || 'Salt Lake City',
      state: 'UT',
      zip: row.zip || row.zip_code || '',
      projectType,
      description: row.description || row.work_description || '',
      estimatedValue,
      contractorName: row.contractor || row.contractor_name || '',
      issueDate: normalizeDate(row.issue_date || row.issued_date || ''),
      ownerName: row.owner || row.owner_name || '',
      latitude: parseFloat(row.latitude || '0') || undefined,
      longitude: parseFloat(row.longitude || '0') || undefined,
    });
  }

  return records;
}

// ── Utility Helpers ─────────────────────────────────────────

function isCommercialPermit(type: string, description: string): boolean {
  const combined = `${type} ${description}`.toLowerCase();
  const commercialTerms = [
    'commercial', 'retail', 'office', 'warehouse', 'industrial',
    'restaurant', 'hotel', 'mixed use', 'mixed-use', 'tenant improvement',
    'new construction', 'addition', 'remodel', 'renovation',
    'building', 'structure', 'multi-family', 'apartment',
  ];
  const residentialOnly = ['single family', 'single-family', 'sfr', 'residential deck', 'residential fence'];

  // Exclude purely residential
  if (residentialOnly.some(t => combined.includes(t))) return false;

  return commercialTerms.some(t => combined.includes(t));
}

function normalizeDate(dateStr: string): string {
  if (!dateStr) return '';

  // ISO timestamp
  if (dateStr.includes('T')) return dateStr.slice(0, 10);

  // Unix timestamp in ms
  if (/^\d{13}$/.test(dateStr)) {
    return new Date(parseInt(dateStr, 10)).toISOString().slice(0, 10);
  }

  // MM/DD/YYYY
  const m = dateStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }

  return dateStr;
}

// ── Main Scraper Function ───────────────────────────────────

export async function scrapeConstructionPermits(): Promise<ScrapeResult> {
  const startTime = Date.now();
  let totalFound = 0;
  let totalImported = 0;
  let totalSkipped = 0;
  let lastError: string | undefined;

  const config = getSourceConfig(SOURCE_KEY);
  const extraConfig = config?.extra_config ? JSON.parse(config.extra_config) : {};
  const daysBack = extraConfig.days_back || 60;

  // Date filter: permits issued in the last N days
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - daysBack);
  const sinceDateStr = sinceDate.toISOString().slice(0, 10);

  let fetched = false;

  // Try each endpoint until one works
  for (const endpoint of API_ENDPOINTS) {
    if (fetched) break;

    try {
      let url: string;
      let records: PermitRecord[] = [];

      if (endpoint.includes('arcgis')) {
        // ArcGIS REST API query
        const params = new URLSearchParams({
          where: `ISSUE_DATE >= '${sinceDateStr}' AND EST_VALUE >= ${MIN_VALUE}`,
          outFields: '*',
          returnGeometry: 'true',
          f: 'json',
          resultRecordCount: String(MAX_RECORDS_PER_CYCLE),
          orderByFields: 'ISSUE_DATE DESC',
        });
        url = `${endpoint}?${params}`;

        console.log(`[SLCPermits] Querying ArcGIS endpoint...`);
        const res = await fetchWithTimeout(url);
        if (!res.ok) {
          console.warn(`[SLCPermits] ArcGIS HTTP ${res.status}, trying next endpoint`);
          continue;
        }

        const data = await res.json();
        records = parseArcGisResponse(data);
        fetched = true;
      } else {
        // Socrata-style open data API
        const params = new URLSearchParams({
          '$where': `issue_date >= '${sinceDateStr}' AND estimated_value >= ${MIN_VALUE}`,
          '$limit': String(MAX_RECORDS_PER_CYCLE),
          '$order': 'issue_date DESC',
        });
        url = `${endpoint}?${params}`;

        console.log(`[SLCPermits] Querying Socrata endpoint...`);
        const res = await fetchWithTimeout(url);
        if (!res.ok) {
          console.warn(`[SLCPermits] Socrata HTTP ${res.status}, trying next endpoint`);
          continue;
        }

        const data = await res.json();
        if (Array.isArray(data)) {
          records = parseSocrataResponse(data);
          fetched = true;
        }
      }

      totalFound += records.length;

      // Upsert each permit as a lead
      for (const permit of records) {
        try {
          const result = upsertLead({
            source: SOURCE_KEY,
            source_id: permit.permitNumber,
            business_name: permit.contractorName || `Permit ${permit.permitNumber}`,
            business_type: permit.projectType,
            contact_name: permit.ownerName || permit.contractorName || undefined,
            address: permit.address || undefined,
            city: permit.city || undefined,
            state: 'UT',
            zip: permit.zip || undefined,
            latitude: permit.latitude,
            longitude: permit.longitude,
            estimated_value: permit.estimatedValue,
            permit_number: permit.permitNumber,
            registration_date: permit.issueDate,
            project_type: permit.projectType,
            notes: permit.description || undefined,
          });

          if (result.inserted) {
            totalImported++;
          } else {
            totalSkipped++;
          }
        } catch (err: any) {
          totalSkipped++;
          console.warn(`[SLCPermits] Failed to upsert permit ${permit.permitNumber}: ${err.message}`);
        }

        await sleep(100); // Light delay between DB operations
      }
    } catch (err: any) {
      lastError = `${endpoint}: ${err.message}`;
      console.warn(`[SLCPermits] Endpoint failed: ${lastError}`);
    }

    await sleep(REQUEST_DELAY_MS);
  }

  if (!fetched && !lastError) {
    lastError = 'No data endpoints responded successfully';
  }

  const durationMs = Date.now() - startTime;
  const status = lastError && totalImported === 0 ? 'error' : totalImported > 0 ? 'success' : 'partial';

  console.log(`[SLCPermits] Complete: found=${totalFound} imported=${totalImported} skipped=${totalSkipped} (${durationMs}ms)`);

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
registerScraper(SOURCE_KEY, scrapeConstructionPermits);
