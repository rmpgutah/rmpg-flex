/**
 * Utah Division of Commerce — Collection Agency Scraper
 *
 * Scrapes the Utah Division of Commerce for licensed collection agencies.
 * These are direct targets for RMPG's process serving, repo security,
 * and skip tracing services.
 */
import {
  fetchWithTimeout, sleep, upsertLead, registerScraper,
  getSourceConfig, type ScrapeResult,
} from './leadScraperBase';

const SOURCE_KEY = 'ut_commerce_collections';
const BASE_URL = 'https://commerce.utah.gov';
const REQUEST_DELAY_MS = 1_500;

interface CommerceLicense {
  licenseNumber: string;
  businessName: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  licenseStatus: string;
  registrationDate: string;
  detailUrl: string;
}

/**
 * Parse collection agency listings from search results.
 */
function parseLicenseResults(html: string): CommerceLicense[] {
  const results: CommerceLicense[] = [];

  // Split into individual license blocks
  const blocks = html.split(/(?=<(?:tr|div)[^>]*(?:license|result|row))/i);

  for (const block of blocks) {
    // Extract license number
    const licNum = block.match(/(?:License|Lic|Registration)\s*(?:#|No\.?|Number)?[:\s]*([A-Z0-9\-]{3,20})/i)?.[1];
    if (!licNum) continue;

    // Only process active licenses
    const status = block.match(/(?:Status)[:\s]*([A-Za-z]+)/i)?.[1]?.toLowerCase() || '';
    if (status && status !== 'active' && status !== 'current') continue;

    const name = block.match(/<(?:td|span|a|strong)[^>]*>([^<]{3,80})<\/(?:td|span|a|strong)>/i)?.[1]?.trim();
    if (!name) continue;

    const contact = block.match(/(?:Contact|Agent|Owner)[:\s]*([^<\n]{2,60})/i)?.[1]?.trim();
    const phone = block.match(/(\(\d{3}\)\s*\d{3}[\-\.]\d{4}|\d{3}[\-\.]\d{3}[\-\.]\d{4})/)?.[1];
    const email = block.match(/([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/)?.[1];
    const addr = block.match(/(?:Address)[:\s]*([^<\n]{5,80})/i)?.[1]?.trim();
    const city = block.match(/(?:City)[:\s]*([^<\n,]{2,40})/i)?.[1]?.trim();
    const zip = block.match(/\b(\d{5}(?:-\d{4})?)\b/)?.[1];
    const regDate = block.match(/(?:Issued|Registered|Date)[:\s]*([\d\/\-]{8,10})/i)?.[1];
    const detailHref = block.match(/href="([^"]*license[^"]*)"/i)?.[1];

    results.push({
      licenseNumber: licNum,
      businessName: name.replace(/&amp;/g, '&').trim(),
      contactName: contact || '',
      phone: phone || '',
      email: email || '',
      address: addr || '',
      city: city || '',
      state: 'UT',
      zip: zip || '',
      licenseStatus: 'active',
      registrationDate: regDate ? normalizeDate(regDate) : '',
      detailUrl: detailHref ? (detailHref.startsWith('http') ? detailHref : `${BASE_URL}${detailHref}`) : '',
    });
  }

  return results;
}

function normalizeDate(d: string): string {
  // Convert MM/DD/YYYY -> YYYY-MM-DD
  const m = d.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return d;
}

export async function scrapeUtCommerceCollections(): Promise<ScrapeResult> {
  const startTime = Date.now();
  let totalFound = 0, totalImported = 0, totalSkipped = 0;
  let lastError: string | undefined;

  const config = getSourceConfig(SOURCE_KEY);
  let extraConfig: any = {};
  try { if (config?.extra_config) extraConfig = JSON.parse(config.extra_config); } catch { console.warn('[Collections] Invalid extra_config JSON, using defaults'); }

  try {
    // Search for collection agency licenses
    const searchTerms = extraConfig.search_terms || ['collection agency', 'debt collector', 'collection bureau'];

    for (const term of searchTerms) {
      await sleep(REQUEST_DELAY_MS);
      console.log(`[UtCommerce] Searching: ${term}`);

      const searchUrl = `${BASE_URL}/search?q=${encodeURIComponent(term)}&type=license&division=dfi`;
      const res = await fetchWithTimeout(searchUrl);

      if (!res.ok) {
        console.warn(`[UtCommerce] HTTP ${res.status} for "${term}"`);
        continue;
      }

      const html = await res.text();
      const licenses = parseLicenseResults(html);
      console.log(`[UtCommerce] Found ${licenses.length} active licenses for "${term}"`);
      totalFound += licenses.length;

      for (const lic of licenses) {
        try {
          const result = upsertLead({
            source: SOURCE_KEY,
            source_id: lic.licenseNumber,
            source_url: lic.detailUrl || undefined,
            business_name: lic.businessName,
            contact_name: lic.contactName || undefined,
            contact_email: lic.email || undefined,
            contact_phone: lic.phone || undefined,
            address: lic.address || undefined,
            city: lic.city || undefined,
            state: 'UT',
            zip: lic.zip || undefined,
            license_number: lic.licenseNumber,
            registration_date: lic.registrationDate || undefined,
            industry: 'Debt Collection',
            business_type: 'Collection Agency',
            service_interest: 'process_serving,skip_tracing,repo_security',
          });

          if (result.inserted) totalImported++;
          else totalSkipped++;
        } catch (err: any) {
          totalSkipped++;
          console.warn(`[UtCommerce] Failed to upsert ${lic.licenseNumber}: ${err.message}`);
        }
      }
    }
  } catch (err: any) {
    lastError = err.message;
    console.error(`[UtCommerce] Fatal error: ${err.message}`);
  }

  const durationMs = Date.now() - startTime;
  const status = lastError && totalImported === 0 ? 'error' : totalImported > 0 ? 'success' : 'partial';

  console.log(`[UtCommerce] Complete: found=${totalFound} imported=${totalImported} skipped=${totalSkipped} (${durationMs}ms)`);

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

registerScraper(SOURCE_KEY, scrapeUtCommerceCollections);
