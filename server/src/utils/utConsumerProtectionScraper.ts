/**
 * Utah Consumer Protection — Debt Collector Scraper
 *
 * Scrapes the Utah Division of Consumer Protection for registered
 * debt collection businesses. These are leads for RMPG's process
 * serving and skip tracing services.
 */
import {
  fetchWithTimeout, sleep, upsertLead, registerScraper,
  getSourceConfig, type ScrapeResult,
} from './leadScraperBase';

const SOURCE_KEY = 'ut_consumer_protection';
const BASE_URL = 'https://dcp.utah.gov';
const REQUEST_DELAY_MS = 1_500;

interface ConsumerProtectionBiz {
  registrationNumber: string;
  businessName: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  registrationDate: string;
  detailUrl: string;
}

/**
 * Parse registered business listings from search results.
 */
function parseRegisteredBusinesses(html: string): ConsumerProtectionBiz[] {
  const results: ConsumerProtectionBiz[] = [];

  const blocks = html.split(/(?=<(?:tr|div)[^>]*(?:registration|result|row|record))/i);

  for (const block of blocks) {
    // Extract registration number
    const regNum = block.match(/(?:Registration|Reg|ID)\s*(?:#|No\.?|Number)?[:\s]*([A-Z0-9\-]{3,20})/i)?.[1];
    if (!regNum) continue;

    // Only active registrations
    const status = block.match(/(?:Status)[:\s]*([A-Za-z]+)/i)?.[1]?.toLowerCase() || '';
    if (status && status !== 'active' && status !== 'current' && status !== 'registered') continue;

    const name = block.match(/<(?:td|span|a|strong)[^>]*>([^<]{3,80})<\/(?:td|span|a|strong)>/i)?.[1]?.trim();
    if (!name) continue;

    const contact = block.match(/(?:Contact|Agent|Owner|Principal)[:\s]*([^<\n]{2,60})/i)?.[1]?.trim();
    const phone = block.match(/(\(\d{3}\)\s*\d{3}[\-\.]\d{4}|\d{3}[\-\.]\d{3}[\-\.]\d{4})/)?.[1];
    const email = block.match(/([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/)?.[1];
    const addr = block.match(/(?:Address)[:\s]*([^<\n]{5,80})/i)?.[1]?.trim();
    const city = block.match(/(?:City)[:\s]*([^<\n,]{2,40})/i)?.[1]?.trim();
    const zip = block.match(/\b(\d{5}(?:-\d{4})?)\b/)?.[1];
    const regDate = block.match(/(?:Issued|Registered|Date)[:\s]*([\d\/\-]{8,10})/i)?.[1];
    const detailHref = block.match(/href="([^"]*(?:registration|detail|record)[^"]*)"/i)?.[1];

    results.push({
      registrationNumber: regNum,
      businessName: name.replace(/&amp;/g, '&').trim(),
      contactName: contact || '',
      phone: phone || '',
      email: email || '',
      address: addr || '',
      city: city || '',
      state: 'UT',
      zip: zip || '',
      registrationDate: regDate ? normalizeDate(regDate) : '',
      detailUrl: detailHref ? (detailHref.startsWith('http') ? detailHref : `${BASE_URL}${detailHref}`) : '',
    });
  }

  return results;
}

function normalizeDate(d: string): string {
  const m = d.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return d;
}

export async function scrapeUtConsumerProtection(): Promise<ScrapeResult> {
  const startTime = Date.now();
  let totalFound = 0, totalImported = 0, totalSkipped = 0;
  let lastError: string | undefined;

  const config = getSourceConfig(SOURCE_KEY);
  const extraConfig = config?.extra_config ? JSON.parse(config.extra_config) : {};

  try {
    const searchTerms = extraConfig.search_terms || ['debt collection', 'collection service'];

    for (const term of searchTerms) {
      await sleep(REQUEST_DELAY_MS);
      console.log(`[UtConsumer] Searching: ${term}`);

      const searchUrl = `${BASE_URL}/search?q=${encodeURIComponent(term)}&category=debt_collection`;
      const res = await fetchWithTimeout(searchUrl);

      if (!res.ok) {
        console.warn(`[UtConsumer] HTTP ${res.status} for "${term}"`);
        continue;
      }

      const html = await res.text();
      const businesses = parseRegisteredBusinesses(html);
      console.log(`[UtConsumer] Found ${businesses.length} registered businesses for "${term}"`);
      totalFound += businesses.length;

      for (const biz of businesses) {
        try {
          const result = upsertLead({
            source: SOURCE_KEY,
            source_id: biz.registrationNumber,
            source_url: biz.detailUrl || undefined,
            business_name: biz.businessName,
            contact_name: biz.contactName || undefined,
            contact_email: biz.email || undefined,
            contact_phone: biz.phone || undefined,
            address: biz.address || undefined,
            city: biz.city || undefined,
            state: 'UT',
            zip: biz.zip || undefined,
            license_number: biz.registrationNumber,
            registration_date: biz.registrationDate || undefined,
            industry: 'Consumer Debt Collection',
            business_type: 'Registered Debt Collector',
            service_interest: 'process_serving,skip_tracing',
          });

          if (result.inserted) totalImported++;
          else totalSkipped++;
        } catch (err: any) {
          totalSkipped++;
          console.warn(`[UtConsumer] Failed to upsert ${biz.registrationNumber}: ${err.message}`);
        }
      }
    }
  } catch (err: any) {
    lastError = err.message;
    console.error(`[UtConsumer] Fatal error: ${err.message}`);
  }

  const durationMs = Date.now() - startTime;
  const status = lastError && totalImported === 0 ? 'error' : totalImported > 0 ? 'success' : 'partial';

  console.log(`[UtConsumer] Complete: found=${totalFound} imported=${totalImported} skipped=${totalSkipped} (${durationMs}ms)`);

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

registerScraper(SOURCE_KEY, scrapeUtConsumerProtection);
