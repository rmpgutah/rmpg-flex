// ============================================================
// Utah DABC Liquor License Scraper
// ============================================================
// Scrapes the Utah Department of Alcoholic Beverage Control
// (DABC / abs.utah.gov) public license search for venues,
// clubs, bars, and event spaces — prime security clients.
//
// Source key: dabc_liquor
// Rate: 2s between requests
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

const SOURCE_KEY = 'dabc_liquor';
const BASE_URL = 'https://abs.utah.gov';
const SEARCH_URL = `${BASE_URL}/licensee_search.html`;
const REQUEST_DELAY_MS = 2_000;

// Target license types for security-relevant venues
const TARGET_LICENSE_TYPES = [
  'club', 'bar', 'tavern', 'event', 'venue', 'banquet',
  'restaurant', 'hotel', 'resort', 'arena', 'stadium',
  'concert', 'nightclub', 'lounge', 'reception center',
  'beer-only', 'full service', 'limited service',
  'on-premise', 'special event',
];

// ── Types ───────────────────────────────────────────────────

interface DabcLicense {
  licenseNumber: string;
  businessName: string;
  dba: string;
  licenseType: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  issueDate: string;
  expirationDate: string;
  status: string;
}

// ── HTML Parsing ────────────────────────────────────────────

/**
 * Parse the DABC license search results page.
 * Results are typically in a table with columns: License #, Name, DBA, Type, Address, etc.
 */
function parseLicenseResults(html: string): DabcLicense[] {
  const licenses: DabcLicense[] = [];

  // Pattern 1: Table-based results
  const rowRegex = /<tr[^>]*class=["']?(?:odd|even|row|result)[^"']*["']?[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const row = rowMatch[1];
    const cells: string[] = [];
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch: RegExpExecArray | null;

    while ((cellMatch = cellRegex.exec(row)) !== null) {
      cells.push(stripHtml(cellMatch[1]).trim());
    }

    if (cells.length < 4) continue;

    // Try to identify column mapping
    const license = parseCellsToLicense(cells);
    if (license && isTargetLicenseType(license.licenseType)) {
      licenses.push(license);
    }
  }

  // Pattern 2: Div/card-based results
  if (licenses.length === 0) {
    const cardRegex = /(?:license|permit)[_\-\s]*(?:no|number|#|num)[\s:]*['"]*([A-Z0-9\-]+)['"]*[\s\S]*?(?:name|business|establishment)[\s:]*['"]*([^'"<\n]+)['"]*[\s\S]*?(?:type|category|class)[\s:]*['"]*([^'"<\n]+)['"]*[\s\S]*?(?:address|location)[\s:]*['"]*([^'"<\n]+)['"]/gi;
    let cardMatch: RegExpExecArray | null;

    while ((cardMatch = cardRegex.exec(html)) !== null) {
      const licenseType = cardMatch[3].trim();
      if (!isTargetLicenseType(licenseType)) continue;

      const address = cardMatch[4].trim();
      const parsed = parseAddress(address);

      licenses.push({
        licenseNumber: cardMatch[1].trim(),
        businessName: cardMatch[2].trim(),
        dba: '',
        licenseType,
        address: parsed.street,
        city: parsed.city,
        state: 'UT',
        zip: parsed.zip,
        issueDate: '',
        expirationDate: '',
        status: 'Active',
      });
    }
  }

  // Pattern 3: JSON data embedded in page
  if (licenses.length === 0) {
    const jsonMatch = html.match(/(?:var\s+(?:data|results|licenses)\s*=\s*|data-licenses=["'])([\[{][\s\S]*?[}\]])(?:;|["'])/i);
    if (jsonMatch) {
      try {
        const jsonData = JSON.parse(jsonMatch[1]);
        const items = Array.isArray(jsonData) ? jsonData : jsonData.results || jsonData.data || [];
        for (const item of items) {
          const licenseType = item.license_type || item.type || item.category || '';
          if (!isTargetLicenseType(licenseType)) continue;

          licenses.push({
            licenseNumber: item.license_number || item.license_no || item.id || '',
            businessName: item.business_name || item.name || item.establishment || '',
            dba: item.dba || item.doing_business_as || '',
            licenseType,
            address: item.address || item.street || '',
            city: item.city || '',
            state: item.state || 'UT',
            zip: item.zip || item.zip_code || '',
            issueDate: item.issue_date || item.issued || '',
            expirationDate: item.expiration_date || item.expires || '',
            status: item.status || 'Active',
          });
        }
      } catch {
        // JSON parse failed, ignore
      }
    }
  }

  return licenses;
}

/**
 * Attempt to map table cells to a DabcLicense.
 */
function parseCellsToLicense(cells: string[]): DabcLicense | null {
  if (cells.length < 4) return null;

  // Try to identify by content patterns
  const licenseIdx = cells.findIndex(c => /^[A-Z]{0,2}\d{4,}/.test(c));
  if (licenseIdx < 0) return null;

  const licenseNumber = cells[licenseIdx];
  const remaining = [...cells.slice(0, licenseIdx), ...cells.slice(licenseIdx + 1)];

  // Business name is usually the longest non-address cell
  const nameIdx = remaining.findIndex(c => c.length > 3 && !/^\d/.test(c) && !/^(UT|Utah|active|inactive)/i.test(c));
  const businessName = nameIdx >= 0 ? remaining[nameIdx] : '';
  if (nameIdx >= 0) remaining.splice(nameIdx, 1);

  // License type
  const typeIdx = remaining.findIndex(c => TARGET_LICENSE_TYPES.some(t => c.toLowerCase().includes(t)));
  const licenseType = typeIdx >= 0 ? remaining[typeIdx] : '';
  if (typeIdx >= 0) remaining.splice(typeIdx, 1);

  // Address
  const addrIdx = remaining.findIndex(c => /^\d+\s/.test(c));
  const address = addrIdx >= 0 ? remaining[addrIdx] : '';
  if (addrIdx >= 0) remaining.splice(addrIdx, 1);

  // City
  const cityIdx = remaining.findIndex(c => /^[A-Z][a-z]/.test(c) && !/^(active|inactive|expired)/i.test(c));
  const city = cityIdx >= 0 ? remaining[cityIdx] : '';
  if (cityIdx >= 0) remaining.splice(cityIdx, 1);

  // Zip
  const zipIdx = remaining.findIndex(c => /^\d{5}/.test(c));
  const zip = zipIdx >= 0 ? remaining[zipIdx] : '';

  return {
    licenseNumber,
    businessName,
    dba: '',
    licenseType,
    address,
    city,
    state: 'UT',
    zip,
    issueDate: '',
    expirationDate: '',
    status: 'Active',
  };
}

// ── Utility Helpers ─────────────────────────────────────────

function isTargetLicenseType(type: string): boolean {
  const lower = type.toLowerCase();
  return TARGET_LICENSE_TYPES.some(t => lower.includes(t));
}

function stripHtml(html: string): string {
  return (html || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#?\w+;/g, '').trim();
}

function parseAddress(fullAddr: string): { street: string; city: string; zip: string } {
  const m = fullAddr.match(/^(.*?),?\s*([A-Z][a-z]+(?:\s[A-Z][a-z]+)*),?\s*(?:UT|Utah)\s*(\d{5}(?:-\d{4})?)?/);
  if (m) {
    return { street: m[1].trim(), city: m[2].trim(), zip: m[3] || '' };
  }
  return { street: fullAddr, city: '', zip: '' };
}

// ── Main Scraper Function ───────────────────────────────────

export async function scrapeDabcLicenses(): Promise<ScrapeResult> {
  const startTime = Date.now();
  let totalFound = 0;
  let totalImported = 0;
  let totalSkipped = 0;
  let lastError: string | undefined;

  const config = getSourceConfig(SOURCE_KEY);
  const extraConfig = config?.extra_config ? JSON.parse(config.extra_config) : {};
  const searchCity = extraConfig.city || 'Salt Lake City';

  try {
    const searchUrls = [
      `${SEARCH_URL}?city=${encodeURIComponent(searchCity)}&status=Active`,
      `${BASE_URL}/api/licenses?city=${encodeURIComponent(searchCity)}&status=active&limit=200`,
    ];

    let licenses: DabcLicense[] = [];

    for (const url of searchUrls) {
      if (licenses.length > 0) break;

      try {
        console.log(`[DABC] Fetching: ${url}`);
        const res = await fetchWithTimeout(url, {
          headers: { Accept: 'text/html, application/json' },
        });

        if (!res.ok) {
          console.warn(`[DABC] HTTP ${res.status} from ${url}`);
          await sleep(REQUEST_DELAY_MS);
          continue;
        }

        const contentType = res.headers.get('content-type') || '';
        const body = await res.text();

        if (contentType.includes('json')) {
          try {
            const data = JSON.parse(body);
            const items = Array.isArray(data) ? data : data.results || data.data || data.licenses || [];
            for (const item of items) {
              const lt = item.license_type || item.type || '';
              if (!isTargetLicenseType(lt)) continue;

              licenses.push({
                licenseNumber: item.license_number || item.id || '',
                businessName: item.business_name || item.name || '',
                dba: item.dba || '',
                licenseType: lt,
                address: item.address || '',
                city: item.city || searchCity,
                state: 'UT',
                zip: item.zip || '',
                issueDate: item.issue_date || '',
                expirationDate: item.expiration_date || '',
                status: item.status || 'Active',
              });
            }
          } catch {
            // Parse failed
          }
        } else {
          licenses = parseLicenseResults(body);
        }
      } catch (err: any) {
        lastError = `${url}: ${err.message}`;
        console.warn(`[DABC] Fetch failed: ${lastError}`);
      }

      await sleep(REQUEST_DELAY_MS);
    }

    totalFound = licenses.length;

    for (const license of licenses) {
      if (!license.licenseNumber || !license.businessName) {
        totalSkipped++;
        continue;
      }

      try {
        const displayName = license.dba || license.businessName;
        const result = upsertLead({
          source: SOURCE_KEY,
          source_id: license.licenseNumber,
          source_url: `${BASE_URL}/licensee_search.html`,
          business_name: displayName,
          business_type: license.licenseType,
          industry: 'hospitality',
          address: license.address || undefined,
          city: license.city || undefined,
          state: 'UT',
          zip: license.zip || undefined,
          license_number: license.licenseNumber,
          registration_date: license.issueDate || undefined,
          notes: license.expirationDate ? `License expires: ${license.expirationDate}` : undefined,
        });

        if (result.inserted) {
          totalImported++;
        } else {
          totalSkipped++;
        }
      } catch (err: any) {
        totalSkipped++;
        console.warn(`[DABC] Failed to upsert license ${license.licenseNumber}: ${err.message}`);
      }
    }
  } catch (err: any) {
    lastError = err.message;
    console.error(`[DABC] Fatal error:`, err.message);
  }

  const durationMs = Date.now() - startTime;
  const status = lastError && totalImported === 0 ? 'error' : totalImported > 0 ? 'success' : 'partial';

  console.log(`[DABC] Complete: found=${totalFound} imported=${totalImported} skipped=${totalSkipped} (${durationMs}ms)`);

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
registerScraper(SOURCE_KEY, scrapeDabcLicenses);
