/**
 * Utah State Bar Directory Scraper
 *
 * Scrapes the Utah State Bar member directory for attorneys practicing in
 * debt collection, civil litigation, bankruptcy, and creditor's rights.
 * These attorneys are leads for RMPG's process serving, repo security,
 * and skip tracing services.
 */
import {
  fetchWithTimeout, sleep, upsertLead, registerScraper,
  getSourceConfig, type ScrapeResult,
} from './leadScraperBase';

const SOURCE_KEY = 'utah_bar';
const BASE_URL = 'https://services.utahbar.org';
const REQUEST_DELAY_MS = 2_000;

// Practice areas that map to RMPG services
const PRACTICE_AREAS = [
  { query: 'Collections', service: 'process_serving,skip_tracing' },
  { query: 'Civil Litigation', service: 'process_serving' },
  { query: 'Bankruptcy', service: 'process_serving' },
  { query: 'Creditors Rights', service: 'process_serving,skip_tracing' },
  { query: 'Real Estate', service: 'repo_security' },
];

interface BarAttorney {
  barNumber: string;
  name: string;
  firm: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  practiceAreas: string;
  profileUrl: string;
  serviceInterest: string;
}

/**
 * Parse attorney listing from search results HTML.
 * The Bar directory typically returns a table or card list of members.
 */
function parseAttorneyList(html: string): Partial<BarAttorney>[] {
  const attorneys: Partial<BarAttorney>[] = [];

  // Match attorney card/row blocks — adapt regex to actual HTML structure
  // Pattern: look for bar number, name, firm, contact info
  const blocks = html.split(/(?=<div[^>]*class="[^"]*member[^"]*"|<tr[^>]*class="[^"]*member)/i);

  for (const block of blocks) {
    const barNum = block.match(/(?:Bar\s*(?:#|No\.?|Number)?:?\s*)(\d{4,8})/i)?.[1];
    if (!barNum) continue;

    // Extract name — typically in a heading or strong tag
    const name = block.match(/<(?:h[2-4]|strong|a)[^>]*>([^<]+)<\/(?:h[2-4]|strong|a)>/i)?.[1]?.trim();
    if (!name) continue;

    // Extract firm
    const firm = block.match(/(?:Firm|Company|Organization)[:\s]*([^<\n]+)/i)?.[1]?.trim()
      || block.match(/<(?:span|div)[^>]*class="[^"]*firm[^"]*"[^>]*>([^<]+)/i)?.[1]?.trim();

    // Extract contact info
    const phone = block.match(/(?:Phone|Tel)[:\s]*([\d\-\(\)\.\s]{10,})/i)?.[1]?.trim()
      || block.match(/(\(\d{3}\)\s*\d{3}[\-\.]\d{4})/)?.[1]?.trim();
    const email = block.match(/([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/)?.[1]?.trim();

    // Extract address
    const addrMatch = block.match(/(?:Address)[:\s]*([^<\n]+)/i);
    const cityMatch = block.match(/(?:City)[:\s]*([^<\n,]+)/i);
    const stateMatch = block.match(/\b(UT|Utah)\b/i);
    const zipMatch = block.match(/\b(\d{5}(?:-\d{4})?)\b/);

    attorneys.push({
      barNumber: barNum,
      name: stripHtmlEntities(name),
      firm: firm ? stripHtmlEntities(firm) : undefined,
      phone: phone || undefined,
      email: email || undefined,
      address: addrMatch?.[1]?.trim() || undefined,
      city: cityMatch?.[1]?.trim() || undefined,
      state: stateMatch?.[1] || 'UT',
      zip: zipMatch?.[1] || undefined,
    });
  }

  return attorneys;
}

function stripHtmlEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#?\w+;/g, ' ').trim();
}

export async function scrapeUtahBar(): Promise<ScrapeResult> {
  const startTime = Date.now();
  let totalFound = 0, totalImported = 0, totalSkipped = 0;
  let lastError: string | undefined;
  const seen = new Set<string>(); // track bar numbers across practice areas

  const config = getSourceConfig(SOURCE_KEY);
  const extraConfig = config?.extra_config ? JSON.parse(config.extra_config) : {};
  const practiceAreas = extraConfig.practice_areas || PRACTICE_AREAS;

  try {
    for (const area of practiceAreas) {
      try {
        console.log(`[UtahBar] Searching practice area: ${area.query}`);
        await sleep(REQUEST_DELAY_MS);

        // Search the member directory by practice area
        const searchUrl = `${BASE_URL}/Member-Directory?PracticeArea=${encodeURIComponent(area.query)}`;
        const res = await fetchWithTimeout(searchUrl);
        if (!res.ok) {
          console.warn(`[UtahBar] HTTP ${res.status} for ${area.query}`);
          continue;
        }

        const html = await res.text();
        const attorneys = parseAttorneyList(html);
        console.log(`[UtahBar] Found ${attorneys.length} attorneys for ${area.query}`);
        totalFound += attorneys.length;

        for (const atty of attorneys) {
          if (!atty.barNumber || seen.has(atty.barNumber)) {
            totalSkipped++;
            continue;
          }
          seen.add(atty.barNumber);

          try {
            const result = upsertLead({
              source: SOURCE_KEY,
              source_id: atty.barNumber,
              source_url: atty.profileUrl || `${BASE_URL}/Member-Directory?BarNumber=${atty.barNumber}`,
              business_name: atty.firm || atty.name || 'Unknown',
              contact_name: atty.name,
              contact_email: atty.email,
              contact_phone: atty.phone,
              address: atty.address,
              city: atty.city,
              state: atty.state || 'UT',
              zip: atty.zip,
              industry: area.query,
              business_type: 'Law Firm',
              service_interest: area.service,
            });

            if (result.inserted) totalImported++;
            else totalSkipped++;
          } catch (err: any) {
            totalSkipped++;
            console.warn(`[UtahBar] Failed to upsert ${atty.barNumber}: ${err.message}`);
          }
        }
      } catch (err: any) {
        lastError = `${area.query}: ${err.message}`;
        console.error(`[UtahBar] Error scraping ${area.query}: ${err.message}`);
      }
    }
  } catch (err: any) {
    lastError = err.message;
    console.error(`[UtahBar] Fatal error: ${err.message}`);
  }

  const durationMs = Date.now() - startTime;
  const status = lastError && totalImported === 0 ? 'error' : totalImported > 0 ? 'success' : 'partial';

  console.log(`[UtahBar] Complete: found=${totalFound} imported=${totalImported} skipped=${totalSkipped} (${durationMs}ms)`);

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

registerScraper(SOURCE_KEY, scrapeUtahBar);
