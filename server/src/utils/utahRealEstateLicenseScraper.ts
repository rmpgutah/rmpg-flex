/**
 * Utah Open Data — Real Estate License Directory Scraper
 *
 * Uses the Socrata SODA API on Utah's Open Data Portal to pull all
 * active real estate companies (property management, brokerages, etc.)
 * from the official state license directory. These are leads for RMPG's
 * repo/eviction security and process serving services.
 *
 * API: https://opendata.utah.gov/resource/ja4m-6xp7.json
 * Cost: Free, no auth required.
 */
import {
  fetchWithTimeout, sleep, upsertLead, registerScraper,
  getSourceConfig, type ScrapeResult,
} from './leadScraperBase';

const SOURCE_KEY = 'ut_real_estate_licenses';
const API_BASE = 'https://opendata.utah.gov/resource/ja4m-6xp7.json';
const PAGE_SIZE = 1_000;
const REQUEST_DELAY_MS = 500;

interface SodaLicenseRecord {
  license_type?: string;
  license_number?: string;
  status?: string;
  company_name?: string;
  full_name?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  issue_date?: string;
  expiration_date?: string;
}

/**
 * Determine which RMPG services map to this license type.
 */
function serviceForLicenseType(licType: string): string {
  const t = (licType || '').toLowerCase();
  if (/property.?manag/.test(t)) return 'repo_security,process_serving';
  if (/broker|real estate/.test(t)) return 'process_serving';
  return 'process_serving';
}

/**
 * Determine the business type label from the license type.
 */
function bizTypeForLicenseType(licType: string): string {
  const t = (licType || '').toLowerCase();
  if (/property.?manag/.test(t)) return 'Property Management';
  if (/broker/.test(t)) return 'Real Estate Brokerage';
  return 'Real Estate Company';
}

export async function scrapeUtahRealEstateLicenses(): Promise<ScrapeResult> {
  const startTime = Date.now();
  let totalFound = 0, totalImported = 0, totalSkipped = 0;
  let lastError: string | undefined;

  const config = getSourceConfig(SOURCE_KEY);
  let extraConfig: any = {};
  try { if (config?.extra_config) extraConfig = JSON.parse(config.extra_config); } catch { console.warn('[RealEstateLicense] Invalid extra_config JSON, using defaults'); }

  // Only pull active licenses; filter by company license types
  // The SODA API supports SoSQL for filtering
  const licenseTypes = extraConfig.license_types || [
    'Property Management Company',
    'Principal Broker',
    'Associate Broker',
    'Real Estate Company',
  ];

  try {
    for (const licType of licenseTypes) {
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        await sleep(REQUEST_DELAY_MS);

        // SoSQL query: active licenses of this type, paged
        const params = new URLSearchParams({
          '$where': `status = 'Active' AND license_type = '${licType}'`,
          '$limit': String(PAGE_SIZE),
          '$offset': String(offset),
          '$order': 'company_name ASC',
        });

        const url = `${API_BASE}?${params.toString()}`;
        console.log(`[UtRealEstate] Fetching ${licType} offset=${offset}`);

        const res = await fetchWithTimeout(url);
        if (!res.ok) {
          console.warn(`[UtRealEstate] HTTP ${res.status} for ${licType}`);
          lastError = `HTTP ${res.status} for ${licType}`;
          break;
        }

        const records: SodaLicenseRecord[] = await res.json();
        console.log(`[UtRealEstate] Got ${records.length} records for ${licType}`);
        totalFound += records.length;

        if (records.length === 0) {
          hasMore = false;
          break;
        }

        for (const rec of records) {
          // Skip records without a company name or license number
          if (!rec.company_name && !rec.full_name) {
            totalSkipped++;
            continue;
          }
          if (!rec.license_number) {
            totalSkipped++;
            continue;
          }

          try {
            const result = upsertLead({
              source: SOURCE_KEY,
              source_id: rec.license_number,
              source_url: `https://opendata.utah.gov/resource/ja4m-6xp7.json?license_number=${rec.license_number}`,
              business_name: rec.company_name || rec.full_name || 'Unknown',
              contact_name: rec.full_name || undefined,
              contact_phone: rec.phone || undefined,
              address: rec.address || undefined,
              city: rec.city || undefined,
              state: rec.state || 'UT',
              zip: rec.zip || undefined,
              license_number: rec.license_number,
              registration_date: rec.issue_date || undefined,
              industry: licType,
              business_type: bizTypeForLicenseType(licType),
              service_interest: serviceForLicenseType(licType),
            });

            if (result.inserted) totalImported++;
            else totalSkipped++;
          } catch (err: any) {
            totalSkipped++;
            console.warn(`[UtRealEstate] Failed to upsert ${rec.license_number}: ${err.message}`);
          }
        }

        offset += records.length;
        if (records.length < PAGE_SIZE) hasMore = false;
      }
    }
  } catch (err: any) {
    lastError = err.message;
    console.error(`[UtRealEstate] Fatal error: ${err.message}`);
  }

  const durationMs = Date.now() - startTime;
  const status = lastError && totalImported === 0 ? 'error' : totalImported > 0 ? 'success' : 'partial';

  console.log(`[UtRealEstate] Complete: found=${totalFound} imported=${totalImported} skipped=${totalSkipped} (${durationMs}ms)`);

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

registerScraper(SOURCE_KEY, scrapeUtahRealEstateLicenses);
