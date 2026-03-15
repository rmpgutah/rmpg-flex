// ============================================================
// Utah Business Registration Scraper
// ============================================================
// Scrapes the Utah Division of Corporations & Commercial Code
// (DBES) public search for new business entity registrations.
// Targets LLCs, Corporations, and LPs as potential security
// service leads.
//
// Source key: utah_biz
// Rate: 2s between requests, max 10 pages per cycle
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

const SOURCE_KEY = 'utah_biz';
const BASE_URL = 'https://secure.utah.gov/bes';
const SEARCH_URL = `${BASE_URL}/action/search`;
const DETAIL_URL = `${BASE_URL}/action/details`;
const REQUEST_DELAY_MS = 2_000;
const MAX_PAGES = 10;
const ENTITY_TYPES = ['LLC', 'Corporation', 'LP', 'Limited Liability Company', 'Limited Partnership'];

// ── HTML Parsing Helpers ────────────────────────────────────

interface BizEntity {
  entityNumber: string;
  entityName: string;
  entityType: string;
  registrationDate: string;
  status: string;
  detailUrl: string;
}

interface BizDetail {
  address: string;
  city: string;
  state: string;
  zip: string;
  agentName: string;
  agentAddress: string;
  industry: string;
}

/**
 * Parse the search results page HTML for entity listings.
 * The DBES search results contain table rows with entity data.
 */
function parseSearchResults(html: string): BizEntity[] {
  const entities: BizEntity[] = [];

  // Match table rows containing entity data
  // Pattern: entity number, name, type, registration date, status in <td> cells
  const rowRegex = /<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi;
  let match: RegExpExecArray | null;

  while ((match = rowRegex.exec(html)) !== null) {
    const entityNumber = stripHtml(match[1]).trim();
    const rawName = match[2];
    const entityType = stripHtml(match[3]).trim();
    const regDate = stripHtml(match[4]).trim();
    const status = stripHtml(match[5]).trim();

    // Skip header rows or empty entries
    if (!entityNumber || /entity\s*number/i.test(entityNumber)) continue;
    if (!entityNumber.match(/^\d+/)) continue;

    // Extract entity name and link
    const linkMatch = rawName.match(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    const entityName = linkMatch ? stripHtml(linkMatch[2]).trim() : stripHtml(rawName).trim();
    const detailUrl = linkMatch ? resolveUrl(linkMatch[1]) : `${DETAIL_URL}?entity=${entityNumber}`;

    // Filter to desired entity types
    const typeMatch = ENTITY_TYPES.some(t => entityType.toLowerCase().includes(t.toLowerCase()));
    if (!typeMatch) continue;

    // Only active registrations
    if (status.toLowerCase() !== 'active' && status.toLowerCase() !== 'current') continue;

    entities.push({
      entityNumber,
      entityName,
      entityType,
      registrationDate: normalizeDate(regDate),
      status,
      detailUrl,
    });
  }

  // Fallback: try alternate listing format (div-based or dl-based)
  if (entities.length === 0) {
    const altRegex = /entity[_\-]?(?:number|no|id)['":\s]*['"]*(\d+)['"]*[\s\S]*?(?:name|entity_name)['":\s]*['"]*([\w\s&.,'-]+)['"]*[\s\S]*?(?:type|entity_type)['":\s]*['"]*([\w\s]+)['"]*[\s\S]*?(?:date|reg(?:istration)?_date)['":\s]*['"]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})['"]/gi;
    let altMatch: RegExpExecArray | null;

    while ((altMatch = altRegex.exec(html)) !== null) {
      const entityType = altMatch[3].trim();
      const typeOk = ENTITY_TYPES.some(t => entityType.toLowerCase().includes(t.toLowerCase()));
      if (!typeOk) continue;

      entities.push({
        entityNumber: altMatch[1],
        entityName: altMatch[2].trim(),
        entityType,
        registrationDate: normalizeDate(altMatch[4]),
        status: 'Active',
        detailUrl: `${DETAIL_URL}?entity=${altMatch[1]}`,
      });
    }
  }

  return entities;
}

/**
 * Parse the entity detail page for address and contact info.
 */
function parseDetailPage(html: string): BizDetail {
  const detail: BizDetail = {
    address: '',
    city: '',
    state: 'UT',
    zip: '',
    agentName: '',
    agentAddress: '',
    industry: '',
  };

  // Extract principal address
  const addrMatch = html.match(/(?:principal|business|mailing)\s*(?:office\s*)?address[\s\S]*?<[^>]*>([^<]+)/i);
  if (addrMatch) {
    const addr = addrMatch[1].trim();
    detail.address = addr;

    // Try to parse city/state/zip from subsequent lines
    const cszMatch = html.match(new RegExp(escapeRegex(addr) + '[\\s\\S]*?([A-Za-z\\s]+),?\\s*(UT|Utah)\\s*(\\d{5}(?:-\\d{4})?)', 'i'));
    if (cszMatch) {
      detail.city = cszMatch[1].trim();
      detail.state = 'UT';
      detail.zip = cszMatch[3];
    }
  }

  // Broader city/state/zip search
  if (!detail.city) {
    const cszBroad = html.match(/([A-Z][a-z]+(?:\s[A-Z][a-z]+)*),?\s*(?:UT|Utah)\s+(\d{5}(?:-\d{4})?)/);
    if (cszBroad) {
      detail.city = cszBroad[1].trim();
      detail.zip = cszBroad[2];
    }
  }

  // Registered agent
  const agentMatch = html.match(/registered\s*agent[\s\S]*?<[^>]*>([^<]+)/i);
  if (agentMatch) {
    detail.agentName = agentMatch[1].trim();
  }

  // NAICS / industry code
  const naicsMatch = html.match(/(?:naics|sic|industry)[\s:]*([^<\n]+)/i);
  if (naicsMatch) {
    detail.industry = naicsMatch[1].trim();
  }

  return detail;
}

// ── Utility Helpers ─────────────────────────────────────────

function stripHtml(html: string): string {
  return (html || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#?\w+;/g, '').trim();
}

function resolveUrl(href: string): string {
  if (href.startsWith('http')) return href;
  if (href.startsWith('/')) return `https://secure.utah.gov${href}`;
  return `${BASE_URL}/${href}`;
}

function normalizeDate(dateStr: string): string {
  // Convert MM/DD/YYYY or M/D/YYYY to YYYY-MM-DD
  const m = dateStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return dateStr;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Main Scraper Function ───────────────────────────────────

export async function scrapeUtahBiz(): Promise<ScrapeResult> {
  const startTime = Date.now();
  let totalFound = 0;
  let totalImported = 0;
  let totalSkipped = 0;
  let lastError: string | undefined;

  const config = getSourceConfig(SOURCE_KEY);
  const extraConfig = config?.extra_config ? JSON.parse(config.extra_config) : {};
  const daysBack = extraConfig.days_back || 30;

  // Build date range for recent registrations
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysBack);
  const startStr = `${(startDate.getMonth() + 1).toString().padStart(2, '0')}/${startDate.getDate().toString().padStart(2, '0')}/${startDate.getFullYear()}`;
  const endStr = `${(endDate.getMonth() + 1).toString().padStart(2, '0')}/${endDate.getDate().toString().padStart(2, '0')}/${endDate.getFullYear()}`;

  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      console.log(`[UtahBiz] Fetching page ${page} (${startStr} - ${endStr})`);

      // Build search URL with date range parameters
      const searchParams = new URLSearchParams({
        type: 'advancedsearch',
        startDate: startStr,
        endDate: endStr,
        page: String(page),
      });

      let searchHtml: string;
      try {
        const res = await fetchWithTimeout(`${SEARCH_URL}?${searchParams}`, {
          headers: { Accept: 'text/html' },
        });
        if (!res.ok) {
          lastError = `Search page ${page}: HTTP ${res.status}`;
          console.warn(`[UtahBiz] ${lastError}`);
          break;
        }
        searchHtml = await res.text();
      } catch (err: any) {
        lastError = `Search page ${page}: ${err.message}`;
        console.warn(`[UtahBiz] ${lastError}`);
        break;
      }

      const entities = parseSearchResults(searchHtml);
      if (entities.length === 0) {
        console.log(`[UtahBiz] No entities found on page ${page}, stopping`);
        break;
      }

      totalFound += entities.length;

      // Process each entity
      for (const entity of entities) {
        try {
          // Fetch detail page for address info
          await sleep(REQUEST_DELAY_MS);

          let detail: BizDetail = { address: '', city: '', state: 'UT', zip: '', agentName: '', agentAddress: '', industry: '' };
          try {
            const detailRes = await fetchWithTimeout(entity.detailUrl);
            if (detailRes.ok) {
              const detailHtml = await detailRes.text();
              detail = parseDetailPage(detailHtml);
            }
          } catch (err: any) {
            console.warn(`[UtahBiz] Detail fetch failed for ${entity.entityNumber}: ${err.message}`);
          }

          const result = upsertLead({
            source: SOURCE_KEY,
            source_id: entity.entityNumber,
            source_url: entity.detailUrl,
            business_name: entity.entityName,
            business_type: entity.entityType,
            industry: detail.industry || undefined,
            contact_name: detail.agentName || undefined,
            address: detail.address || undefined,
            city: detail.city || undefined,
            state: detail.state || 'UT',
            zip: detail.zip || undefined,
            registration_date: entity.registrationDate,
          });

          if (result.inserted) {
            totalImported++;
          } else {
            totalSkipped++;
          }
        } catch (err: any) {
          totalSkipped++;
          console.warn(`[UtahBiz] Failed to process entity ${entity.entityNumber}: ${err.message}`);
        }
      }

      await sleep(REQUEST_DELAY_MS);
    }
  } catch (err: any) {
    lastError = err.message;
    console.error(`[UtahBiz] Fatal error:`, err.message);
  }

  const durationMs = Date.now() - startTime;
  const status = lastError && totalImported === 0 ? 'error' : totalImported > 0 ? 'success' : 'partial';

  console.log(`[UtahBiz] Complete: found=${totalFound} imported=${totalImported} skipped=${totalSkipped} (${durationMs}ms)`);

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
registerScraper(SOURCE_KEY, scrapeUtahBiz);
